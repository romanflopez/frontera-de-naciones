/**
 * Server de Frontera de Naciones. Port del Server.cs de helbreath-base-game (MIT):
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
import { DATA_DIR, loadCatalogs, loadSettings, type GameWorldConfig } from './config.ts';
import { MAPS, MOB_TYPES, getMapDef } from '@fdn/world';
import { loadPosition, resolveSaved, savePosition } from './persist.ts';
import * as M from './messages.ts';
import type { PersistedPlayer } from './player.ts';
import { WorldRegistry } from './registry.ts';
import { authenticate } from './accounts.ts';
import { Economy, toCharSave } from './economy.ts';
import { FileStorage, PgStorage, type Storage } from './storage.ts';
import { AuctionHouse, setAuctionHouse } from './auction.ts';
import { Depot, setDepot } from './deposit.ts';
import { PartyService, setParties } from './party.ts';

const MAX_INCOMING_BYTES = 24576;

const settings = loadSettings();
const catalogs = loadCatalogs();
// el estado económico (oro, bolsa, equipo, nivel) es del server; se guarda en la cuenta por el mismo Storage
/** Dónde se guardan cuentas y personajes: DATA_DIR (env) o, por defecto, la carpeta data del server. */
const SAVE_DIR = process.env.DATA_DIR || DATA_DIR;
// con DATABASE_URL las cuentas van a Postgres (sobreviven a los redeploys); sin ella, archivos JSON
const storage: Storage & { close?: () => Promise<void> } = process.env.DATABASE_URL ? await PgStorage.create(process.env.DATABASE_URL) : new FileStorage(SAVE_DIR);
const economy = new Economy(storage);
// Los mundos se crean a pedido desde el registro de mapas de @fdn/world (un GameWorld por mapa), con un solo reloj; ver registry.ts.
if (!getMapDef(settings.initialMap)) throw new Error(`initialMap '${settings.initialMap}' no es un mapa conocido (ver packages/world/src/maps.ts)`);
const registry = new WorldRegistry({ settings, catalogs, economy });
registry.ensure(settings.initialMap); // el mapa de entrada ya listo; los demás se crean la primera vez que alguien llega
registry.start();
const worldConfigs: GameWorldConfig[] = Object.values(MAPS).map((d) => ({ id: d.id, name: d.name, map: d.id, spawn: d.spawn }));
console.log(`[Server] ${worldConfigs.length} mapas registrados (${worldConfigs.map((w) => w.id).join(', ')}); mundo inicial '${settings.initialMap}'.`);
// casa de subastas compartida por todos los mundos (docs/SUBASTAS.md): mismo Storage; avisa a los vendedores conectados
const auction = new AuctionHouse(storage); setAuctionHouse(auction); auction.start();
auction.notify = (key, ...msgs) => { const s = sessionsByNetworkId.get(`acc:${key}`)?.socket; if (s?.readyState === s?.OPEN) for (const m of msgs) s?.send(encode(m)); };
// depósito por cuenta (docs/DEPOSITO.md): vive dentro del registro de la cuenta, en el mismo Storage
setDepot(new Depot(storage));

const worldsListMessage = M.worldsList(worldConfigs);
const monstersListMessage = M.monstersList(catalogs);

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

// Party (docs/PARTY_Y_ARENAS.md): vive fuera de los mundos; la identidad es el sessionId.
const parties = new PartyService({
    sessionByName: (name) => { const n = name.toLowerCase(); for (const s of sessionsById.values()) if (s.socket && s.characterName.toLowerCase() === n) return s.sessionId; return undefined; },
    send: (sid, m) => { const s = sessionsById.get(sid); if (s?.socket && s.socket.readyState === s.socket.OPEN) s.socket.send(encode(m)); },
    info: (sid) => {
        const s = sessionsById.get(sid), w = s ? worldOf(s) : undefined, p = w?.playerOf(sid); if (!s || !w || !p) return undefined;
        return { name: s.characterName, faction: p.profile.split(';')[0], level: p.econ?.lvl ?? 1, hp: Math.round(p.hp), maxHp: Math.round(p.maxHp), map: w.mapId, online: !!s.socket };
    },
});
setParties(parties);
setInterval(() => parties.tick(), 1000).unref();

/** Saca del mundo a los que se desconectaron y no volvieron dentro de la gracia. */
setInterval(() => {
    const now = Date.now();
    for (const s of sessionsByNetworkId.values()) {
        if (s.socket || s.disconnectDeadline === null || s.disconnectDeadline > now) continue;
        const world = worldOf(s);
        world?.persistVitals(s.sessionId);
        saveChar(s.networkId, world?.removePlayer(s.sessionId));
        storage.flush();
        parties.leave(s.sessionId);
        sessionsByNetworkId.delete(s.networkId); sessionsById.delete(s.sessionId);
    }
}, 1000).unref();

// Si existe el cliente compilado (apps/client/dist), el mismo server lo sirve: una sola URL para jugar.
const CLIENT_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const http = createServer((req, res) => {
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

    send(worldsListMessage);
    send(monstersListMessage);
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
            if (payload?.$case !== 'authenticateRequest') { disconnect('Autenticate antes de mandar otros mensajes.'); return; }
            clearTimeout(authTimeout);
            if (!payload.value.characterName.trim()) { disconnect('Falta el nombre del personaje.'); return; }
            const auth = authenticate(storage, payload.value.characterName, payload.value.password ?? '', clientIp(req));
            if (!auth.ok) { disconnect(auth.error); return; }
            // la identidad la define la cuenta, no lo que mande el cliente
            const networkId = `acc:${auth.key}`, characterName = auth.account.name;
            // lo que ve el cliente sale del estado del server (cuentas viejas: se importa una sola vez lo que el cliente tenía)
            const econ = economy.load(auth.key);
            send(M.characterLoaded(!!econ, econ ? toCharSave(econ) : ''));

            const existing = sessionsByNetworkId.get(networkId);
            if (existing) {
                if (existing.socket || existing.disconnectDeadline === null) { disconnect('Ese personaje ya está conectado.'); return; }
                if (existing.disconnectDeadline <= Date.now()) { disconnect('Se venció el tiempo para reconectarte.'); return; }
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
            session = { networkId, sessionId: randomUUID(), worldId: world.id, characterName, socket: ws, disconnectDeadline: null, logoutAllowedAt: null };
            sessionsByNetworkId.set(networkId, session); sessionsById.set(session.sessionId, session);
            world.playerConnected(session.sessionId, characterName, send, disconnect, persisted);
            world.bindAccount(session.sessionId, auth.key);
            return;
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
        clearTimeout(authTimeout);
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
        if (!remainsActive) { parties.leave(session.sessionId); sessionsByNetworkId.delete(session.networkId); sessionsById.delete(session.sessionId); }
    });

    ws.on('error', (err) => console.error(`[Server] Error de WebSocket (${remote}):`, err.message));
});

// ---------- comandos de GM (solo pruebas) ----------
// Por defecto solo es GM la cuenta 'rowena'. FDN_GM=nombre1,nombre2 → solo esos personajes; FDN_GM=1 → cualquier cuenta (server local de pruebas); FDN_GM= (vacío) → nadie.
const GM_ENV = (process.env.FDN_GM ?? 'rowena').trim().toLowerCase();
const isGm = (name: string) => GM_ENV === '1' || GM_ENV === 'all' || GM_ENV.split(',').map((x) => x.trim()).filter(Boolean).includes(name.toLowerCase());
const GM_HELP = [
    'Comandos GM: /gm mapas · /gm ir <mapa> [x y] · /gm pos [x y] · /gm nivel <n> · /gm oro <n> · /gm curar · /gm dios',
    '/gm mobs · /gm mob <tipo> [nivel] [cantidad] · /gm limpiar · /gm llaves [n] · /gm traer <jugador> · /gm ira <jugador> · /gm menu (o F9)',
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
    if (c === 'mapas') {
        say(...Object.values(MAPS).map((d) => `${d.id} — ${d.name} (${d.lvl ? `Nv ${d.lvl[0]}-${d.lvl[1]}` : 'sin nivel'}${d.temporary ? ', mazmorra' : ''})`));
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
        const maps = Object.values(MAPS).map((d) => ({ id: d.id, name: d.name, lvl: d.lvl ? `${d.lvl[0]}-${d.lvl[1]}` : '', dungeon: !!d.temporary }));
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
 * Chat por canales (docs/PARTY_Y_ARENAS.md §3): global (por defecto, o `/g `), nación (`/n `, la facción), party (`/p `) y guild (`/gu `, todavía no existe).
 * El canal manda en el mensaje (`channel`) para que el cliente lo pinte distinto.
 */
function handleChat(sender: Session, raw: string, reply: (m: ServerMessage) => void): void {
    let text = raw.trim(), channel: 'global' | 'nacion' | 'party' | 'guild' = 'global';
    if (/^\/gm(\s|$)/i.test(text)) { handleGm(sender, text, reply); return; } // comandos de GM (modo GM)
    const pre = /^\/(gu|g|n|p)\s+/i.exec(text);
    if (pre) { channel = ({ gu: 'guild', g: 'global', n: 'nacion', p: 'party' } as const)[pre[1].toLowerCase() as 'gu' | 'g' | 'n' | 'p']; text = text.slice(pre[0].length).trim(); }
    if (!text) { reply(M.sendMessage('El mensaje no puede estar vacío.')); return; }
    if (text.length > settings.chatMessageMaxLength) { reply(M.sendMessage(`El mensaje no puede pasar los ${settings.chatMessageMaxLength} caracteres.`)); return; }
    if (channel === 'guild') { reply(M.sendMessage('Las guilds llegan próximamente.')); return; }
    if (channel === 'party') { if (!parties.chat(sender.sessionId, text, sender.characterName)) reply(M.sendMessage('No estás en una party.')); return; }
    const data = encode(M.chatMessageReceived(sender.characterName, text, channel));
    if (channel === 'nacion') {
        const fac = factionOfSession(sender); if (!fac) { reply(M.sendMessage('Todavía no tenés nación.')); return; }
        for (const s of sessionsByNetworkId.values()) if (s.socket?.readyState === s.socket?.OPEN && factionOfSession(s) === fac) s.socket?.send(data);
        return;
    }
    for (const s of sessionsByNetworkId.values()) if (s.socket?.readyState === s.socket?.OPEN) s.socket?.send(data);
}
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
process.on('SIGTERM', shutdown);

http.listen(settings.port, '0.0.0.0', () => {
    console.log(`[Server] Escuchando en ws://localhost:${settings.port}/ws`);
});
