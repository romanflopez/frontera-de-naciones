/**
 * Server de Frontera de Naciones, basado en el server MIT de base (ver LICENSE.base-game):
 * acepta WebSockets en /ws, autentica una vez por conexión, manda los paquetes al mundo
 * donde está el jugador, maneja la gracia de reconexión y guarda el personaje al salir.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '@fdn/proto';
import { RestartCountdown, changelogLines, handleClientReport } from './ops.ts';
import { DATA_DIR, loadSettings, type GameWorldConfig } from './config.ts';
import { MAPS, MOB_TYPES, canonicalMapId, factionHome, getMapDef, type MapDef } from '@fdn/world';
import { loadPosition, resolveSaved, savePosition } from './persist.ts';
import * as M from './messages.ts';
import type { PersistedPlayer } from './player.ts';
import { WorldBossService } from './worldBoss.ts';
import { WorldRegistry } from './registry.ts';
import { authenticate, charKeysOf, createCharacter, deleteCharacter, findChar, MAX_CHARS } from './accounts.ts';
import { Economy, newEconChecked, toCharSave } from './economy.ts';
import { FileStorage, PgStorage, type Storage } from './storage.ts';
import { AuctionHouse, setAuctionHouse } from './auction.ts';
import { Depot, setDepot } from './deposit.ts';
import { TradeService, setTradeService } from './trade.ts';
import { PartyService, setParties } from './party.ts';
import { ArenaService } from './arena.ts';
import { ChatManager } from './systems/chat.ts';

const MAX_INCOMING_BYTES = 24576;
/** Cuánto puede quedarse una conexión autenticada en la pantalla de personajes sin hacer nada. */
const SELECT_IDLE_MS = 10 * 60 * 1000;

const settings = loadSettings();
// el estado económico (oro, bolsa, equipo, nivel) es del server; se guarda en la cuenta por el mismo Storage
/** Dónde se guardan cuentas y personajes: DATA_DIR (env) o, por defecto, la carpeta data del server. */
const SAVE_DIR = process.env.DATA_DIR || DATA_DIR;
// con DATABASE_URL las cuentas van a Postgres (sobreviven a los redeploys); sin ella, archivos JSON
const storage: Storage & { close?: () => Promise<void> } = process.env.DATABASE_URL ? await PgStorage.create(process.env.DATABASE_URL) : new FileStorage(SAVE_DIR);
const economy = new Economy(storage);
// Los mundos se crean a pedido desde el registro de mapas de @fdn/world (un GameWorld por mapa), con un solo reloj; ver registry.ts.
if (!getMapDef(settings.initialMap)) throw new Error(`initialMap '${settings.initialMap}' no es un mapa conocido (ver packages/world/src/maps.ts)`);
const registry = new WorldRegistry({ settings, economy });
registry.ensure(settings.initialMap); // el mapa de entrada ya listo; los demás se crean la primera vez que alguien llega
registry.start();
// jefe de mundo (docs/JEFE_DE_MUNDO.md): una vez por día, a hora y en mapa del T4 al azar; se anuncia a todos los conectados
const worldBoss = new WorldBossService({
    ensure: (id) => registry.ensure(id), get: (id) => registry.get(id),
    announce: (text) => { const m = encode(M.sendMessage(`[Jefe de mundo] ${text}`)); for (const s of sessionsById.values()) if (s.socket?.readyState === s.socket?.OPEN) s.socket?.send(m); },
});
setInterval(() => worldBoss.tick(), 5000).unref();
const worldConfigs: GameWorldConfig[] = Object.values(MAPS).map((d) => ({ id: d.id, name: d.name, map: d.id, spawn: d.spawn }));
console.log(`[Server] ${worldConfigs.length} mapas registrados (${worldConfigs.map((w) => w.id).join(', ')}); mundo inicial '${settings.initialMap}'.`);
// casa de subastas compartida por todos los mundos (docs/SUBASTAS.md): mismo Storage; avisa a los vendedores conectados
const auction = new AuctionHouse(storage); setAuctionHouse(auction); auction.start();
auction.notify = (key, ...msgs) => { const s = sessionsByNetworkId.get(`acc:${key}`)?.socket; if (s?.readyState === s?.OPEN) for (const m of msgs) s?.send(encode(m)); };
// depósito por cuenta (docs/DEPOSITO.md): vive dentro del registro de la cuenta, en el mismo Storage
setDepot(new Depot(storage));
const trade = new TradeService(storage); setTradeService(trade); trade.start(); // Dar e Intercambiar (docs/INTERCAMBIO.md)

const worldsListMessage = M.worldsList(worldConfigs);

// ---------- posición del personaje (B1) ----------
// Vive en el registro de la cuenta (`AccountRecord.pos`), junto al estado económico: con Postgres sobrevive a los redeploys.
// Los guardados viejos en `chars/<id>.json` (disco) se leen una sola vez como respaldo y en el próximo guardado pasan a la cuenta.
const legacyCharFile = (networkId: string) => join(SAVE_DIR, 'chars', `${networkId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
function readLegacyChar(networkId: string): PersistedPlayer | undefined {
    const f = legacyCharFile(networkId);
    if (!existsSync(f)) return undefined;
    try { return JSON.parse(readFileSync(f, 'utf8')) as PersistedPlayer; } catch { return undefined; }
}
const loadChar = (networkId: string) => loadPosition(storage, networkId, readLegacyChar);
const saveChar = (networkId: string, state: PersistedPlayer | undefined) => savePosition(storage, networkId, state, (id) => registry.mapOf(id));
/** Foto periódica de dónde está cada conectado: si el proceso muere sin avisar (OOM, corte), se pierde como mucho este intervalo. */
const POS_CHECKPOINT_MS = 60_000;
setInterval(() => {
    for (const s of sessionsByNetworkId.values()) if (s.socket) saveChar(s.networkId, worldOf(s)?.snapshot(s.sessionId));
}, POS_CHECKPOINT_MS).unref();

// ---------- cuentas y progreso (ver docs/PERSISTENCIA.md) ----------
const clientIp = (req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }) => {
    const xf = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || 'desconocida';
};
// ---------- sesiones ----------
interface Session {
    networkId: string;
    /** Clave de la cuenta dueña del personaje. */
    owner: string;
    sessionId: string;
    worldId: string;
    characterName: string;
    socket: WebSocket | null;
    /** Mientras está desconectado en gracia: hasta cuándo puede volver. */
    disconnectDeadline: number | null;
    logoutAllowedAt: number | null;
}
const sessionsByNetworkId = new Map<string, Session>();
const sessionsById = new Map<string, Session>();
const worldOf = (s: Session) => registry.get(s.worldId);
const saveOf = (s: Session) => (state: PersistedPlayer) => saveChar(s.networkId, state);
// respawn con punto de reaparición en otro mapa: el mundo le pide al registro el cruce
registry.sessionHook = (sessionId) => { const s = sessionsById.get(sessionId); return s ? { session: s, save: saveOf(s) } : undefined; };

function encode(m: ServerMessage): Uint8Array { return ServerMessage.encode(m).finish(); }

/** Lista de personajes de la cuenta para la pantalla de selección (`error` no vacío = falló la última acción). */
function characterListMsg(accKey: string, error = ''): ServerMessage {
    const list = charKeysOf(storage, accKey).map((k) => {
        const rec = storage.get(k)!, econ = economy.load(k), mapId = canonicalMapId(rec.pos?.mapId ?? rec.pos?.worldId);
        return { name: rec.name, cls: econ?.cls ?? '', faction: econ?.faction ?? '', level: econ?.lvl ?? 1, zone: (mapId && getMapDef(mapId)?.name) || '' };
    });
    return M.characterList(list, MAX_CHARS, error);
}

// Party (docs/PARTY_Y_ARENAS.md): vive fuera de los mundos; la identidad es el sessionId.
const parties = new PartyService({
    sessionByName: (name) => { const n = name.toLowerCase(); for (const s of sessionsById.values()) if (s.socket && s.characterName.toLowerCase() === n) return s.sessionId; return undefined; },
    send: (sid, m) => { const s = sessionsById.get(sid); if (s?.socket && s.socket.readyState === s.socket.OPEN) s.socket.send(encode(m)); },
    info: (sid) => {
        const s = sessionsById.get(sid), w = s ? worldOf(s) : undefined, p = w?.playerOf(sid); if (!s || !w || !p) return undefined;
        return { name: s.characterName, faction: p.profile.split(';')[0], level: p.econ?.lvl ?? 1, hp: Math.round(p.hp), maxHp: Math.round(p.maxHp), mp: Math.round(p.mp), maxMp: Math.round(p.combat.maxMp), map: w.mapId, online: !!s.socket };
    },
    left: (sid, by) => arena.partyLeft(sid, by), // arena se crea más abajo; esto corre recién cuando alguien deja una party
});
setParties(parties);
setInterval(() => parties.tick(), 1000).unref();

// Arenas 2v2 / 3v3 (docs/PARTY_Y_ARENAS.md §2): cola, invitación, partida y ranking por temporada. Se maneja con /arena en el chat.
// FDN_ARENA_TEMPORADA = número de temporada (al cambiarlo, los ratings vuelven hacia el medio); FDN_ARENA_PRUEBA=1 deja entrar sin party
// o con una party más chica que el modo (para probar con menos gente).
const arena = new ArenaService({
    send: (sid, m) => { const s = sessionsById.get(sid); if (s?.socket && s.socket.readyState === s.socket.OPEN) s.socket.send(encode(m)); },
    session: (sid) => { const s = sessionsById.get(sid); return s && { name: s.characterName, accountKey: s.networkId.replace(/^acc:/, ''), worldKey: s.worldId, online: !!s.socket }; },
    partyMembers: (sid) => parties.partyMembers(sid),
    isLeader: (sid) => parties.isLeader(sid),
    world: (key) => registry.get(key),
    ensure: (map, iid) => registry.ensure(map, iid),
    transfer: (sid, dest) => { const s = sessionsById.get(sid); return !!s && registry.beginTransfer(s, dest, saveOf(s)); },
    pending: (sid) => !!registry.pendingOf(sid),
}, storage, { season: Number(process.env.FDN_ARENA_TEMPORADA) || 1, allowSmallTeams: process.env.FDN_ARENA_PRUEBA === '1' });
setInterval(() => arena.tick(), 1000).unref();

/** Saca del mundo a los que se desconectaron y no volvieron dentro de la gracia. */
setInterval(() => {
    const now = Date.now();
    for (const s of sessionsByNetworkId.values()) {
        if (s.socket || s.disconnectDeadline === null || s.disconnectDeadline > now) continue;
        const world = worldOf(s);
        world?.persistVitals(s.sessionId);
        saveChar(s.networkId, world?.removePlayer(s.sessionId));
        storage.flush();
        arena.sessionGone(s.sessionId, s.networkId.replace(/^acc:/, ''));
        parties.leave(s.sessionId);
        sessionsByNetworkId.delete(s.networkId); sessionsById.delete(s.sessionId);
    }
}, 1000).unref();

// Si existe el cliente compilado (apps/client/dist), el mismo server lo sirve: una sola URL para jugar.
const CLIENT_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const http = createServer((req, res) => {
    if (handleClientReport(req, res, SAVE_DIR)) return;
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = normalize(join(CLIENT_DIST, path === '/' ? 'index.html' : path));
    if (file.startsWith(CLIENT_DIST) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.includes('assets') && !file.endsWith('meta.json') ? 'public, max-age=3600' : 'no-cache' });
        res.end(readFileSync(file)); return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Frontera de Naciones: server en marcha. Conectate por WebSocket a /ws.\n');
});
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_INCOMING_BYTES });

wss.on('connection', (ws, req) => {
    const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    console.log(`[Server] WebSocket abierto desde ${remote}`);
    let session: Session | null = null;
    let closing = false;
    let lastSaveAt = 0;

    const send = (m: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(encode(m)); };
    const disconnect = (reason: string) => {
        if (closing) return;
        closing = true;
        ws.close(1000, reason.slice(0, 120));
    };

    /** Cuenta autenticada que todavía no eligió personaje. */
    let acct: string | null = null;
    let preJoinMsgs = 0;
    let selectTimer: NodeJS.Timeout | null = null;
    const armSelectTimer = () => {
        if (selectTimer) clearTimeout(selectTimer);
        selectTimer = setTimeout(() => { if (!session) disconnect('Te quedaste mucho tiempo sin elegir personaje.'); }, SELECT_IDLE_MS); selectTimer.unref();
    };
    /** Entra al mundo con el personaje `key` de la cuenta `accKey` (o retoma la sesión en gracia). */
    const joinWorld = (accKey: string, key: string, characterName: string): void => {
        const networkId = `acc:${key}`;
        // un solo personaje por cuenta en el mundo a la vez (el depósito es compartido: evita pasarse cosas entre personajes propios)
        for (const o of sessionsByNetworkId.values()) if (o.socket && o.owner === accKey && o.networkId !== networkId) { send(characterListMsg(accKey, 'Ya tenés otro personaje de esta cuenta conectado.')); return; }
        const existing = sessionsByNetworkId.get(networkId);
        if (existing && (existing.socket || existing.disconnectDeadline === null)) { send(characterListMsg(accKey, 'Ese personaje ya está conectado.')); return; }
        if (existing && existing.disconnectDeadline !== null && existing.disconnectDeadline <= Date.now()) { send(characterListMsg(accKey, 'Se venció el tiempo para reconectarte. Probá de nuevo en un momento.')); return; }
        if (selectTimer) { clearTimeout(selectTimer); selectTimer = null; }
        // lo que ve el cliente sale del estado del server (cuentas viejas: se importa una sola vez lo que el cliente tenía)
        const econ = economy.load(key);
        send(M.characterLoaded(!!econ, econ ? toCharSave(econ) : ''));
        const rec = storage.get(key); if (rec) { rec.lastLogin = Date.now(); storage.put(key, rec); }

        if (existing) {
            existing.socket = ws;
            existing.disconnectDeadline = null;
            existing.characterName = characterName;
            session = existing;
            worldOf(session)?.playerReconnected(session.sessionId, characterName, send, disconnect);
            worldOf(session)?.resendEconomy(session.sessionId); // el cliente nuevo necesita la foto del estado
            return;
        }

        // un personaje guardado sin mapa (guardado viejo: 'solmar' vale como el mapa original) o en un mapa que ya no existe arranca en el mapa por defecto
        const saved = loadChar(networkId);
        const { persisted, mapId } = resolveSaved(saved, settings.initialMap);
        const world = registry.ensure(mapId);
        session = { networkId, owner: accKey, sessionId: randomUUID(), worldId: world.id, characterName, socket: ws, disconnectDeadline: null, logoutAllowedAt: null };
        sessionsByNetworkId.set(networkId, session); sessionsById.set(session.sessionId, session);
        world.playerConnected(session.sessionId, characterName, send, disconnect, persisted);
        world.bindAccount(session.sessionId, key);
    };

    send(worldsListMessage);
    const authTimeout = setTimeout(() => { if (!session) disconnect('No llegó la autenticación a tiempo.'); }, settings.ping.timeout);

    ws.on('message', (data, isBinary) => {
        if (!isBinary) { if (!session) disconnect('Mandá el mensaje de autenticación en binario antes que cualquier otra cosa.'); return; }
        let message: ClientMessage;
        try {
            message = ClientMessage.decode(new Uint8Array(data as Buffer));
        } catch {
            disconnect('No se pudo leer el mensaje del cliente.');
            return;
        }
        const payload = message.payload;

        if (!session) {
            // 1) autenticar la cuenta; 2) elegir / crear / borrar personajes; 3) recién ahí se entra al mundo
            if (!acct) {
                if (payload?.$case !== 'authenticateRequest') { disconnect('Autenticate antes de mandar otros mensajes.'); return; }
                clearTimeout(authTimeout);
                if (!payload.value.characterName.trim()) { disconnect('Falta el nombre de la cuenta.'); return; }
                const auth = authenticate(storage, payload.value.characterName, payload.value.password ?? '', clientIp(req));
                if (!auth.ok) { disconnect(auth.error); return; }
                acct = auth.key;
                armSelectTimer();
                send(characterListMsg(acct));
                return;
            }
            armSelectTimer();
            if (++preJoinMsgs > 60) { disconnect('Demasiados pedidos sin elegir personaje.'); return; }
            const accKey = acct;
            switch (payload?.$case) {
                case 'createCharacterRequest': {
                    const v = payload.value, econ = newEconChecked(v.cls, v.faction);
                    if (!econ) { send(characterListMsg(accKey, 'Elegí una clase y una facción válidas.')); return; }
                    const r = createCharacter(storage, accKey, v.name.slice(0, 40), econ);
                    if (r.ok) console.log(`[Cuentas] personaje nuevo '${r.name}' (${econ.cls}, ${econ.faction}) en la cuenta ${accKey.slice(0, 12)}…`);
                    send(characterListMsg(accKey, r.ok ? '' : r.error));
                    return;
                }
                case 'deleteCharacterRequest': {
                    const f = findChar(storage, accKey, payload.value.name.slice(0, 40));
                    let err = '';
                    if (!f) err = 'Ese personaje no existe.';
                    else if (sessionsByNetworkId.has(`acc:${f.key}`)) err = 'Ese personaje todavía está en el mundo. Esperá un minuto y probá de nuevo.';
                    else if (auction.mine(f.key).length > 0 || auction.mailbox(f.key).length > 0) err = 'Ese personaje tiene publicaciones o reclamos en la casa de subastas: retiralos antes de borrarlo.';
                    else { const r = deleteCharacter(storage, accKey, f!.rec.name); if (!r.ok) err = r.error; else console.log(`[Cuentas] personaje borrado '${r.name}' de la cuenta ${accKey.slice(0, 12)}…`); }
                    send(characterListMsg(accKey, err));
                    return;
                }
                case 'selectCharacterRequest': {
                    const f = findChar(storage, accKey, payload.value.name.slice(0, 40));
                    if (!f) { send(characterListMsg(accKey, 'Ese personaje no existe.')); return; }
                    joinWorld(accKey, f.key, f.rec.name);
                    return;
                }
                default:
                    if (payload?.$case === 'authenticateRequest') disconnect('La autenticación se manda una sola vez por conexión.');
                    return; // el resto (pings, movimiento) no vale hasta entrar al mundo
            }
        }

        switch (payload?.$case) {
            case 'authenticateRequest':
                disconnect('La autenticación se manda una sola vez por conexión.');
                return;
            case 'logoutRequest': {
                const wait = worldOf(session)?.logoutWait(session.sessionId) ?? settings.logoutTime;
                session.logoutAllowedAt = wait > 0 ? Date.now() + wait * 1000 - 500 : Date.now();
                send(M.logoutResponse(wait));
                return;
            }
            case 'logoutCancelledRequest':
                session.logoutAllowedAt = null;
                return;
            case 'chatMessageSendRequest':
                handleChat(session, payload.value.message, send);
                return;
            case 'clientChatMessage': {
                const err = chat.handle(chatSender(session), payload.value.channel, payload.value.text);
                if (err) send(M.sendMessage(err));
                return;
            }
            case 'saveCharacterRequest': {
                // el guardado del cliente ya NO define oro, items ni nivel: solo sirve para crear el personaje de una cuenta nueva (clase y bando)
                const t = Date.now(); if (t - lastSaveAt < 800) return; lastSaveAt = t;
                if (payload.value.data.length > 20000) return;
                worldOf(session)?.onClientSave(session.sessionId, payload.value.data);
                return;
            }
            case 'partyRequest': {
                parties.handle(session.sessionId, payload.value.action.slice(0, 16), payload.value.name);
                return;
            }
            case 'portalRequest': {
                // cruce de mapa: el server valida distancia, requisitos y estado; el cliente solo manda el id del vínculo
                registry.handlePortal(session, payload.value.portalId.slice(0, 64), saveOf(session));
                return;
            }
            case 'mapReady': {
                registry.completeTransfer(session.sessionId, payload.value.mapId.slice(0, 64), payload.value.mapHash.slice(0, 16));
                return;
            }
            default:
                worldOf(session)?.handleClientPacket(session.sessionId, message);
        }
    });

    ws.on('close', (code, reasonBuf) => {
        clearTimeout(authTimeout); if (selectTimer) clearTimeout(selectTimer);
        console.log(`[Server] WebSocket cerrado desde ${remote} (código ${code}${reasonBuf.length ? `: ${reasonBuf.toString()}` : ''})`);
        if (!session || session.socket !== ws) return;
        session.socket = null;
        const now = Date.now();
        const graceful = session.logoutAllowedAt !== null && now >= session.logoutAllowedAt;
        session.disconnectDeadline = graceful ? now : now + settings.timings.disconnectTime * 1000;
        session.logoutAllowedAt = null;
        const remainsActive = session.disconnectDeadline > now;
        registry.flushPending(session.sessionId); // si cortó entre MapTransfer y MapReady, queda en el mundo nuevo (ya guardado ahí)
        const world = worldOf(session);
        world?.persistVitals(session.sessionId);
        saveChar(session.networkId, world?.snapshot(session.sessionId));
        storage.flush(); // la economía se guarda ya al desconectar
        world?.playerDisconnected(session.sessionId, remainsActive);
        if (!remainsActive) { arena.sessionGone(session.sessionId, session.networkId.replace(/^acc:/, '')); parties.leave(session.sessionId); chat.forget(session.sessionId); sessionsByNetworkId.delete(session.networkId); sessionsById.delete(session.sessionId); }
    });

    ws.on('error', (err) => console.error(`[Server] Error de WebSocket (${remote}):`, err.message));
});

// ---------- comandos de GM (solo pruebas) ----------
// Por defecto solo es GM la cuenta 'rowena'. FDN_GM=nombre1,nombre2 → solo esos personajes; FDN_GM=1 → cualquier cuenta (server local de pruebas); FDN_GM= (vacío) → nadie.
const GM_ENV = (process.env.FDN_GM ?? 'rowena').trim().toLowerCase();
const isGm = (name: string) => GM_ENV === '1' || GM_ENV === 'all' || GM_ENV.split(',').map((x) => x.trim()).filter(Boolean).includes(name.toLowerCase());
/**
 * Mapas del menú GM: solo lo que hoy está en el juego (las dos ciudades, los mapas de caza y las mazmorras), en orden de tier y nivel.
 * Afuera los interiores de las ciudades (se entra caminando), el mapa viejo y los de prueba; la arena sí, porque todavía no tiene otra entrada.
 */
function gmMaps() {
    const cities = new Set(['solmar', 'vhar'].map((f) => factionHome(f)?.map));
    const kindOf = (d: MapDef): 'ciudad' | 'caza' | 'mazmorra' | 'sin_entrada' | null =>
        d.debugOnly ? (d.region === 'arena' ? 'sin_entrada' : null) : d.safe ? (cities.has(d.id) ? 'ciudad' : null) : d.temporary ? 'mazmorra' : 'caza';
    return Object.values(MAPS).flatMap((d) => { const kind = kindOf(d); return kind ? [{ d, kind }] : []; })
        .sort((a, b) => (a.d.tier ?? 0) - (b.d.tier ?? 0) || (a.d.lvl?.[0] ?? 0) - (b.d.lvl?.[0] ?? 0))
        .map(({ d, kind }) => ({ id: d.id, name: d.name, lvl: d.lvl ? `${d.lvl[0]}-${d.lvl[1]}` : '', tier: d.tier ?? 0, kind, dungeon: kind === 'mazmorra' }));
}

const GM_HELP = [
    'Comandos GM: /gm mapas · /gm ir <mapa> [x y] · /gm pos [x y] · /gm nivel <n> · /gm oro <n> · /gm curar · /gm dios',
    '/gm mobs · /gm mob <tipo> [nivel] [cantidad] · /gm limpiar · /gm llaves [n] · /gm espada [crit] · /gm traer <jugador> · /gm ira <jugador> · /gm menu (o F9)',
    '/gm reiniciar [segundos] (cuenta regresiva y reinicio; por defecto 300) · /gm reiniciar cancelar',
    '/gm jefemundo (estado) · /gm jefemundo aca (sale al lado tuyo) · /gm jefemundo ya (sale ahora en un mapa al azar)',
];
/** Prefijo con el que el server le manda al cliente el contenido del menú GM (el cliente lo abre en vez de mostrarlo en el chat). */
const GM_MENU_TAG = '\u0001GMMENU';
/** Sesión conectada por nombre de personaje (exacto o por prefijo, sin importar mayúsculas). */
function findOnline(name: string | undefined): Session | undefined {
    const q = (name ?? '').toLowerCase(); if (!q) return undefined;
    const live = [...sessionsByNetworkId.values()].filter((x) => x.socket?.readyState === x.socket?.OPEN);
    return live.find((x) => x.characterName.toLowerCase() === q) ?? live.find((x) => x.characterName.toLowerCase().startsWith(q));
}
/** Primera celda caminable en espiral desde (x, y), para no caer en una pared al viajar. */
function nearestWalkable(map: ReturnType<WorldRegistry['mapOf']>, x: number, y: number): { x: number; y: number } | undefined {
    for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx, cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < map.size && cy < map.size && !map.blocked[cy][cx]) return { x: cx, y: cy };
    }
    return undefined;
}
function handleGm(s: Session, text: string, reply: (m: ServerMessage) => void): void {
    const say = (...lines: string[]) => { for (const l of lines) reply(M.sendMessage(l)); };
    if (!isGm(s.characterName)) { say('No sos GM.'); return; }
    const [, cmd = 'ayuda', ...args] = text.split(/\s+/);
    const c = cmd.toLowerCase();
    if (c === 'ayuda' || c === 'help') { say(...GM_HELP); return; }
    if (c === 'reiniciar') {
        if ((args[0] ?? '').toLowerCase() === 'cancelar') { if (restart.cancel()) { broadcastChat('Se canceló el reinicio del servidor.'); say('Reinicio cancelado.'); } else say('No hay un reinicio en marcha.'); return; }
        const secs = args[0] === undefined ? 300 : Math.floor(Number(args[0]));
        if (!Number.isFinite(secs) || secs < 5 || secs > 3600) { say('Usá /gm reiniciar <segundos entre 5 y 3600>, o /gm reiniciar cancelar.'); return; }
        restart.start(secs); say(`Reinicio en ${secs} s. /gm reiniciar cancelar lo frena.`); return;
    }
    if (c === 'jefemundo') {
        const sub = (args[0] ?? '').toLowerCase(), w = worldOf(s), p = w?.playerOf(s.sessionId);
        if (sub === 'aca') { if (!w || !p) { say('No estás en un mundo.'); return; } say(worldBoss.spawn(Date.now(), w.id, { x: p.posX, y: p.posY })); return; }
        if (sub === 'ya') { say(worldBoss.spawn()); return; }
        say(worldBoss.status()); return;
    }
    if (c === 'mapas') {
        say(...gmMaps().map((d) => `${d.id} — ${d.name} (${d.lvl ? `Nv ${d.lvl}` : 'sin nivel'}${d.dungeon ? ', mazmorra' : ''})`), 'Los interiores y los mapas de prueba no se listan, pero /gm ir los acepta igual.');
        return;
    }
    if (c === 'ir') {
        const def = getMapDef(args[0]);
        if (!def) { say('Mapa desconocido. Los ids salen con /gm mapas.'); return; }
        const rx = Number(args[1]), ry = Number(args[2]);
        const map = registry.mapOf(def.id);
        const spot = nearestWalkable(map, Number.isFinite(rx) && args[1] !== undefined ? rx : def.spawn.x, Number.isFinite(ry) && args[2] !== undefined ? ry : def.spawn.y);
        if (!spot) { say('No encontré una celda caminable.'); return; }
        if (!registry.beginTransfer(s, { map: def.id, x: spot.x, y: spot.y }, saveOf(s))) say('No pude viajar ahora (¿ya estás cruzando o estás muerto?).');
        else say(`Viajando a ${def.name} (${spot.x}, ${spot.y})…`);
        return;
    }
    if (c === 'menu') {
        const maps = gmMaps();
        const here = worldOf(s)?.mapId ?? '';
        const players = [...sessionsByNetworkId.values()].filter((x) => x.socket?.readyState === x.socket?.OPEN && x !== s).map((x) => ({ name: x.characterName, map: registry.get(x.worldId)?.mapId ?? '' }));
        reply(M.sendMessage(GM_MENU_TAG + JSON.stringify({ maps, players, here, mobs: MOB_TYPES })));
        return;
    }
    if (c === 'traer' || c === 'ira') {
        const other = findOnline(args[0]);
        if (!other || other === s) { say('No encontré a ese jugador conectado (podés escribir el principio del nombre).'); return; }
        const [mover, anchor] = c === 'traer' ? [other, s] : [s, other];
        const aw = worldOf(anchor), ap = aw?.playerOf(anchor.sessionId);
        if (!aw || !ap) { say('No pude ubicar el destino.'); return; }
        const spot = nearestWalkable(registry.mapOf(aw.mapId), ap.posX + 1, ap.posY);
        if (!spot) { say('No encontré una celda libre cerca.'); return; }
        if (!registry.beginTransfer(mover, { map: aw.mapId, x: spot.x, y: spot.y }, saveOf(mover))) say('No se pudo mover (¿está cruzando o muerto?).');
        else say(c === 'traer' ? `Trajiste a ${other.characterName}.` : `Fuiste con ${other.characterName}.`);
        return;
    }
    const out = worldOf(s)?.gmCommand(s.sessionId, c, args);
    if (!out || out.length === 0) say('Comando GM desconocido. /gm ayuda');
    else say(...out);
}

/** Chat global: le llega a todos los conectados. Port de GlobalWorld.HandleChatMessageSendRequest. */
/**
 * Chat por canales (docs/PARTY_Y_ARENAS.md §3): global (por defecto, o `/g `), comercio (`/c `), nación (`/n `, la facción), party (`/p `) y guild (`/gu `, todavía no existe).
 * El canal manda en el mensaje (`channel`) para que el cliente lo pinte distinto.
 */
function handleChat(sender: Session, raw: string, reply: (m: ServerMessage) => void): void {
    let text = raw.trim(), channel = 'global';
    if (/^\/gm(\s|$)/i.test(text)) { handleGm(sender, text, reply); return; } // comandos de GM (modo GM)
    if (/^\/novedades(\s|$)/i.test(text)) { for (const l of changelogLines(2)) reply(M.sendMessage(l)); return; }
    if (/^\/arena(\s|$)/i.test(text)) { arena.command(sender.sessionId, text); return; } // arenas 2v2 / 3v3
    const pre = /^\/(gu|g|n|p|a|c)\s+/i.exec(text);
    if (pre) { channel = ({ gu: 'guild', g: 'global', n: 'nacion', p: 'party', a: 'area', c: 'comercio' } as Record<string, string>)[pre[1].toLowerCase()]; text = text.slice(pre[0].length); }
    const err = chat.handle(chatSender(sender), channel, text);
    if (err) reply(M.sendMessage(err));
}
const chatSender = (s: Session) => ({ sessionId: s.sessionId, name: s.characterName, playerId: worldOf(s)?.playerOf(s.sessionId)?.playerId.toString() ?? '' });
const chat = new ChatManager({
    maxLength: settings.chatMessageMaxLength,
    allSessions: () => [...sessionsById.values()].filter((s) => s.socket?.readyState === s.socket?.OPEN).map((s) => s.sessionId),
    viewersOf: (sid) => { const s = sessionsById.get(sid); return s ? worldOf(s)?.viewersOf(sid) ?? [sid] : []; },
    partyOf: (sid) => parties.partyMembers(sid),
    factionOf: (sid) => { const s = sessionsById.get(sid); return s ? factionOfSession(s) : undefined; },
    send: (sid, m) => { const s = sessionsById.get(sid); if (s?.socket && s.socket.readyState === s.socket.OPEN) s.socket.send(encode(m)); },
});
// la oferta estrella de la tienda avisa en el chat global a todo el server (la sirve el mismo Economy de todos los mundos)
economy.announce = (text) => { const m = M.serverChat('global', 'Tienda', text, ''); for (const s of sessionsById.values()) if (s.socket && s.socket.readyState === s.socket.OPEN) s.socket.send(encode(m)); };
/** Aviso del server a todos los conectados (canal global, remitente «Servidor»). */
function broadcastChat(text: string): void { const m = M.serverChat('global', 'Servidor', text, ''); for (const x of sessionsById.values()) if (x.socket && x.socket.readyState === x.socket.OPEN) x.socket.send(encode(m)); }
/** Reinicio avisado: cuenta regresiva en el chat y, en cero, el mismo cierre ordenado que SIGTERM (guarda a todos). */
const restart = new RestartCountdown(broadcastChat, () => { setTimeout(() => void shutdown(), 500); }); // medio segundo para que el último aviso salga por los sockets
const factionOfSession = (s: Session): string | undefined => worldOf(s)?.playerOf(s.sessionId)?.profile.split(';')[0] || undefined;

async function shutdown(): Promise<void> {
    console.log('[Server] Cerrando: guardando personajes…');
    registry.flushAllPending();
    for (const s of sessionsByNetworkId.values()) { worldOf(s)?.persistVitals(s.sessionId); saveChar(s.networkId, worldOf(s)?.snapshot(s.sessionId)); }
    registry.dispose();
    auction.stop();
    try { if (storage.close) await storage.close(); else storage.flush(); } catch (e) { console.error('[Storage] Error al cerrar:', (e as Error).message); }
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', () => { if (!restart.active) broadcastChat('El servidor se reinicia ahora (actualización). Tu personaje queda guardado: volvé a entrar en un minuto.'); setTimeout(() => void shutdown(), 300); });

http.listen(settings.port, '0.0.0.0', () => {
    console.log(`[Server] Escuchando en ws://localhost:${settings.port}/ws`);
});
