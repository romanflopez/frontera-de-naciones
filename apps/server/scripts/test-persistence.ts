/**
 * Prueba de punta a punta de la posición en la cuenta (B1): el personaje vuelve donde estaba después de reiniciar el server,
 * incluso con una carpeta de datos NUEVA (como un redeploy de Render free) si las cuentas están en Postgres.
 *
 *   # 1) server con Postgres y teletransporte libre (solo pruebas)
 *   DATABASE_URL=postgres://... DATABASE_SSL=off DATA_DIR=$(mktemp -d) PORT=8114 FDN_DEBUG_WARP=1 pnpm --filter @fdn/server start
 *   cd apps/server && npx tsx scripts/test-persistence.ts setup  ws://localhost:8114/ws
 *   # 2) matar el server, levantarlo de nuevo con OTRO DATA_DIR vacío y la misma DATABASE_URL
 *   cd apps/server && npx tsx scripts/test-persistence.ts check  ws://localhost:8114/ws
 */
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync } from 'node:fs';
import { ClientMessage, ServerMessage } from '@fdn/proto';
import { getMapDef } from '@fdn/world';

const [phase = 'setup', URL = 'ws://localhost:8114/ws'] = process.argv.slice(2);
const NAME = process.env.TEST_NAME ?? 'persistencia1', STATE = process.env.TEST_STATE ?? '/tmp/fdn-persist-state.json';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect() {
    const ws = new WebSocket(URL); ws.binaryType = 'nodebuffer';
    const st = { x: -1, y: -1, mapName: '', teleports: 0, ready: false };
    ws.on('message', (d: Buffer) => {
        const p = ServerMessage.decode(new Uint8Array(d)).payload;
        if (p?.$case === 'initialGameWorldState') { st.x = p.value.playerX; st.y = p.value.playerY; st.mapName = p.value.mapName; st.ready = true; }
        if (p?.$case === 'playerTeleported') { st.x = p.value.x; st.y = p.value.y; st.teleports++; }
    });
    await new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', j); });
    const send = (payload: NonNullable<ClientMessage['payload']>) => ws.send(ClientMessage.encode({ payload } as ClientMessage).finish());
    send({ $case: 'authenticateRequest', value: { id: '', characterName: NAME, password: 'test1234' } });
    for (let i = 0; i < 120 && !st.ready; i++) await sleep(50);
    if (!st.ready) throw new Error('no entró al mundo');
    await sleep(300);
    return { ws, st, send };
}

async function main() {
    const { ws, st, send } = await connect();
    if (phase === 'setup') {
        // cuenta nueva: se crea el personaje (clase y bando) y se mueve a una celda libre distinta del spawn
        send({ $case: 'saveCharacterRequest', value: { data: JSON.stringify({ v: 1, faction: 'solmar', cls: 'mago', lvl: 1, exp: 0, gold: 0, hp: 100, mp: 50, bag: [], eq: {}, q: { i: 0, st: 'new', prog: 0, keys: {}, shards: {} }, pots: { hp: 3, mp: 3 }, u: [] }) } });
        await sleep(1000);
        const def = getMapDef('solmar_legacy')!, map = def.build();
        const target = [[6, 6], [8, 5], [5, 9], [10, 10]].map(([dx, dy]) => [def.spawn.x + dx, def.spawn.y + dy]).find(([x, y]) => !map.blocked[y]?.[x])!;
        const before = st.teleports;
        send({ $case: 'playerTeleportRequested', value: { x: target[0], y: target[1] } });
        for (let i = 0; i < 40 && st.teleports === before; i++) await sleep(50);
        if (st.teleports === before) throw new Error('el server no aceptó el teletransporte (¿falta FDN_DEBUG_WARP=1?)');
        writeFileSync(STATE, JSON.stringify({ x: st.x, y: st.y, spawn: def.spawn }));
        console.log(`SETUP  ${NAME} quedó en (${st.x},${st.y}); spawn del mapa (${def.spawn.x},${def.spawn.y})`);
        ws.close(); await sleep(500);
    } else {
        const want = JSON.parse(readFileSync(STATE, 'utf8')) as { x: number; y: number; spawn: { x: number; y: number } };
        console.log(`CHECK  entró en (${st.x},${st.y}); esperado (${want.x},${want.y})`);
        const ok = st.x === want.x && st.y === want.y;
        console.log(ok ? 'OK    la posición sobrevivió al reinicio' : 'FAIL  la posición NO sobrevivió');
        ws.close(); await sleep(300);
        process.exit(ok ? 0 : 1);
    }
}
main().catch((e) => { console.error('FAIL ', e.message); process.exit(1); });
