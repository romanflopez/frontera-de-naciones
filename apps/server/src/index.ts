/**
 * Server de Frontera de Naciones. Port del Server.cs de helbreath-base-game (MIT):
 * acepta WebSockets en /ws, autentica una vez por conexión, manda los paquetes al mundo
 * donde está el jugador, maneja la gracia de reconexión y guarda el personaje al salir.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '@fdn/proto';
import { DATA_DIR, loadCatalogs, loadSettings, loadWorlds } from './config.ts';
import { MAPS } from '@fdn/world';
import { loadOccupancy, occupancyFromGrid } from './map.ts';
import * as M from './messages.ts';
import type { PersistedPlayer } from './player.ts';
import { GameWorld } from './world.ts';

const MAX_INCOMING_BYTES = 4096;

const settings = loadSettings();
const catalogs = loadCatalogs();
const worldConfigs = loadWorlds();
const worlds = new Map<string, GameWorld>();
for (const wc of worldConfigs) {
    const teleportCells = (wc.teleportLocs ?? []).flatMap((t) => t.locs);
    // Mapas generados por código (iguales en cliente y server) o, si no, un .amd en data/maps
    const generated = MAPS[wc.map];
    const occ = generated ? occupancyFromGrid(generated().blocked, teleportCells) : loadOccupancy(wc.map, teleportCells);
    worlds.set(wc.id, new GameWorld(wc, settings, catalogs, occ));
    console.log(`[Server] Mundo '${wc.id}' (${wc.name}): mapa ${wc.map}, ${occ.sizeX}x${occ.sizeY}, ${occ.occupiedCount} celdas bloqueadas`);
}
if (!worlds.has(settings.initialMap)) throw new Error(`initialMap '${settings.initialMap}' no está en worlds.json`);

const worldsListMessage = M.worldsList(worldConfigs);
const monstersListMessage = M.monstersList(catalogs);

// ---------- guardado de personajes (un JSON por id, igual que el original: solo para desarrollo) ----------
const charsDir = join(DATA_DIR, 'chars');
mkdirSync(charsDir, { recursive: true });
const charFile = (networkId: string) => join(charsDir, `${networkId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
function loadChar(networkId: string): PersistedPlayer | undefined {
    const f = charFile(networkId);
    if (!existsSync(f)) return undefined;
    try { return JSON.parse(readFileSync(f, 'utf8')) as PersistedPlayer; } catch { return undefined; }
}
function saveChar(networkId: string, state: PersistedPlayer | undefined): void {
    if (state) writeFileSync(charFile(networkId), JSON.stringify(state, null, 2));
}

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

function encode(m: ServerMessage): Uint8Array { return ServerMessage.encode(m).finish(); }

/** Saca del mundo a los que se desconectaron y no volvieron dentro de la gracia. */
setInterval(() => {
    const now = Date.now();
    for (const s of sessionsByNetworkId.values()) {
        if (s.socket || s.disconnectDeadline === null || s.disconnectDeadline > now) continue;
        const world = worlds.get(s.worldId);
        saveChar(s.networkId, world?.removePlayer(s.sessionId));
        sessionsByNetworkId.delete(s.networkId);
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
            const networkId = payload.value.id.trim();
            const characterName = payload.value.characterName.trim();
            if (!networkId) { disconnect('Falta el id de autenticación.'); return; }
            if (!characterName) { disconnect('Falta el nombre del personaje.'); return; }

            const existing = sessionsByNetworkId.get(networkId);
            if (existing) {
                if (existing.socket || existing.disconnectDeadline === null) { disconnect('Ese personaje ya está conectado.'); return; }
                if (existing.disconnectDeadline <= Date.now()) { disconnect('Se venció el tiempo para reconectarte.'); return; }
                existing.socket = ws;
                existing.disconnectDeadline = null;
                existing.characterName = characterName;
                session = existing;
                worlds.get(session.worldId)?.playerReconnected(session.sessionId, characterName, send, disconnect);
                return;
            }

            // un personaje guardado en un mundo que ya no existe arranca de cero
            const saved = loadChar(networkId);
            const persisted = saved && worlds.has(saved.worldId) ? saved : undefined;
            const worldId = persisted ? persisted.worldId : settings.initialMap;
            session = { networkId, sessionId: randomUUID(), worldId, characterName, socket: ws, disconnectDeadline: null, logoutAllowedAt: null };
            sessionsByNetworkId.set(networkId, session);
            worlds.get(worldId)!.playerConnected(session.sessionId, characterName, send, disconnect, persisted);
            return;
        }

        switch (payload?.$case) {
            case 'authenticateRequest':
                disconnect('La autenticación se manda una sola vez por conexión.');
                return;
            case 'logoutRequest': {
                const wait = settings.logoutTime;
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
            default:
                worlds.get(session.worldId)?.handleClientPacket(session.sessionId, message);
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
        const world = worlds.get(session.worldId);
        saveChar(session.networkId, world?.snapshot(session.sessionId));
        world?.playerDisconnected(session.sessionId, remainsActive);
        if (!remainsActive) sessionsByNetworkId.delete(session.networkId);
    });

    ws.on('error', (err) => console.error(`[Server] Error de WebSocket (${remote}):`, err.message));
});

/** Chat global: le llega a todos los conectados. Port de GlobalWorld.HandleChatMessageSendRequest. */
function handleChat(sender: Session, raw: string, reply: (m: ServerMessage) => void): void {
    const text = raw.trim();
    if (!text) { reply(M.sendMessage('El mensaje no puede estar vacío.')); return; }
    if (text.length > settings.chatMessageMaxLength) { reply(M.sendMessage(`El mensaje no puede pasar los ${settings.chatMessageMaxLength} caracteres.`)); return; }
    const data = encode(M.chatMessageReceived(sender.characterName, text));
    for (const s of sessionsByNetworkId.values()) if (s.socket?.readyState === s.socket?.OPEN) s.socket?.send(data);
}

function shutdown(): void {
    console.log('[Server] Cerrando: guardando personajes…');
    for (const s of sessionsByNetworkId.values()) saveChar(s.networkId, worlds.get(s.worldId)?.snapshot(s.sessionId));
    for (const w of worlds.values()) w.dispose();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

http.listen(settings.port, '0.0.0.0', () => {
    console.log(`[Server] Escuchando en ws://localhost:${settings.port}/ws`);
});
