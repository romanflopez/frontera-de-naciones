/**
 * Prueba del movimiento libre por la red con dos jugadores contra un server en marcha (ver docs/COMBATE.md):
 *   DATA_DIR=<carpeta vacía> PORT=8115 FDN_DEBUG_WARP=1 pnpm --filter @fdn/server start
 *   DATA_DIR=<la misma carpeta> npx tsx scripts/test-movimiento.ts [ws://localhost:8115/ws]
 * Verifica: caminar a la velocidad legal no dispara correcciones y el que mira recibe las posiciones; una ráfaga por lag se tolera;
 * ir a 8 veces la velocidad corrige (resetPosition) y a la quinta violación paraliza.
 */
import { WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { ClientMessage, ServerMessage } from '@fdn/proto';

const URL = process.argv[2] ?? 'ws://localhost:8115/ws';
const DATA_DIR = process.env.DATA_DIR ?? '';
const RUN = Math.random().toString(36).slice(2, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); };
type Payload = NonNullable<ClientMessage['payload']>;
type Srv = NonNullable<ServerMessage['payload']>;

class Bot {
    ws!: WebSocket; id = 0n; teleports = 0; resets = 0; paralyzed = 0; seen = new Set<bigint>(); speedMs = 0;
    posUpdates: { id: bigint; x: number; y: number }[] = []; pos = { x: 0, y: 0 };
    constructor(readonly name: string) {}
    async connect() {
        this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
        let ready!: () => void; const got = new Promise<void>((r) => (ready = r));
        this.ws.on('message', (d: Buffer) => {
            const p = ServerMessage.decode(new Uint8Array(d)).payload as Srv | undefined; if (!p) return;
            switch (p.$case) {
                case 'characterList': this.send(p.value.characters.some((c) => c.name === this.name) ? { $case: 'selectCharacterRequest', value: { name: this.name } } : { $case: 'selectCharacterRequest', value: { name: this.name } }); break;
                case 'initialState': this.id = p.value.playerId; this.speedMs = p.value.movementSpeedMs; break;
                case 'initialGameWorldState': this.pos = { x: p.value.playerX + 0.5, y: p.value.playerY + 0.5 }; ready(); break;
                case 'playerTeleported': this.teleports++; this.pos = { x: p.value.x + 0.5, y: p.value.y + 0.5 }; break;
                case 'resetPosition': this.resets++; this.pos = { x: p.value.x + 0.5, y: p.value.y + 0.5 }; break;
                case 'playerParalyzed': this.paralyzed++; break;
                case 'playersEnteredRange': for (const q of p.value.players) this.seen.add(q.playerId); break;
                case 'playersLeftRange': for (const id of p.value.playerIds) this.seen.delete(id); break;
                case 'playerPositionUpdate': this.posUpdates.push({ id: p.value.playerId, x: p.value.x, y: p.value.y }); break;
            }
        });
        await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
        this.send({ $case: 'authenticateRequest', value: { id: '', characterName: this.name, password: 'test1234' } });
        await Promise.race([got, sleep(6000).then(() => { throw new Error(`${this.name}: no entró al mundo`); })]);
        await sleep(300);
    }
    send(p: Payload) { this.ws.send(ClientMessage.encode({ payload: p } as ClientMessage).finish()); }
    close() { this.ws.close(); }
    async warp(x: number, y: number) { const n = this.teleports; this.send({ $case: 'playerTeleportRequested', value: { x, y } }); for (let i = 0; i < 40 && this.teleports === n; i++) await sleep(50); return this.teleports > n; }
    move(x: number, y: number) { this.pos = { x, y }; this.send({ $case: 'playerPositionRequest', value: { x, y } }); }
    async waitSees(o: Bot) { for (let i = 0; i < 60 && !this.seen.has(o.id); i++) await sleep(50); return this.seen.has(o.id); }
}

function seed(name: string) {
    const dir = join(DATA_DIR, 'accounts'); mkdirSync(dir, { recursive: true });
    const salt = randomBytes(16), key = Buffer.from(name.normalize('NFC').toLowerCase(), 'utf8').toString('hex');
    const character = { v: 1, faction: 'solmar', cls: 'guerrero', lvl: 20, exp: 0, gold: 0, hp: 500, mp: 50, bag: [], eq: { arma: null, armadura: null, cabeza: null, anillo: null },
        q: { i: 0, st: 'new', prog: 0, keys: { cripta: 0, foso: 0 }, shards: { cripta: 0, foso: 0 } }, pots: { hp: 3, mp: 0 }, u: [] };
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ name, salt: salt.toString('hex'), hash: scryptSync('test1234', salt, 32).toString('hex'), created: Date.now(), lastLogin: Date.now(), character: JSON.stringify(character) }));
}

async function main() {
    if (!DATA_DIR) throw new Error('Falta DATA_DIR (el mismo del server).');
    const an = `ana${RUN}`, bn = `beto${RUN}`; seed(an); seed(bn);
    const a = new Bot(an), b = new Bot(bn); await a.connect(); await b.connect();
    check(a.speedMs === 300, `el server fija la velocidad base en 300 ms/celda (llegó ${a.speedMs})`);
    // una fila libre: probar de a poco hasta encontrar donde caminar sin pared
    let row = -1;
    for (const y of [20, 24, 28, 32, 36, 16, 12]) { if (await a.warp(20, y) && await b.warp(22, y + 2)) { await sleep(400); a.resets = 0; row = y; break; } }
    check(row > 0 && await a.waitSees(b) && await b.waitSees(a), 'los dos se ven entre sí');
    const V = 1000 / a.speedMs, STEP = 100;

    // ---------- 1. caminar a la velocidad legal: sin correcciones, y el otro lo ve ----------
    let x = a.pos.x; const y0 = a.pos.y; b.posUpdates.length = 0; a.resets = 0;
    for (let i = 0; i < 25; i++) { x += V * (STEP / 1000) * 0.97; a.move(x, y0); await sleep(STEP); }
    await sleep(300);
    const seenA = b.posUpdates.filter((u) => u.id === a.id);
    check(a.resets === 0, `caminar 2,5 s a la velocidad legal no dispara correcciones (resets: ${a.resets})`);
    check(seenA.length >= 15, `el observador recibe las posiciones decimales (${seenA.length} de 25)`);
    check(seenA.length > 0 && Math.abs(seenA[seenA.length - 1].x - x) < 0.01, `la última posición que ve coincide con la de Ana (${seenA[seenA.length - 1]?.x.toFixed(2)} vs ${x.toFixed(2)})`);

    // ---------- 2. ráfaga por lag: dos pedidos juntos de 200 ms de camino se toleran ----------
    a.resets = 0; x += V * 0.1; a.move(x, y0); x += V * 0.1; a.move(x, y0); await sleep(300);
    check(a.resets === 0, 'una ráfaga chica por lag de red se tolera');

    // ---------- 3. a 8 veces la velocidad: corrige, y a la quinta paraliza ----------
    a.resets = 0; a.paralyzed = 0;
    for (let i = 0; i < 40 && a.paralyzed === 0; i++) { const nx = a.pos.x + V * 8 * (STEP / 1000); a.move(nx, y0); await sleep(STEP); }
    check(a.resets >= 1, `ir a 8 veces la velocidad dispara correcciones (resetPosition: ${a.resets})`);
    check(a.paralyzed >= 1, 'y a la quinta violación el server paraliza');

    a.close(); b.close();
    console.log(failures ? `\n${failures} fallas` : '\nTodo OK');
    process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
