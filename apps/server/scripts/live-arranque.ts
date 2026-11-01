/**
 * Validación de sim-arranque.ts contra un server REAL en marcha: un bot por clase pelea contra los goblins de la zona
 * ('Campamento goblin' o 'Avanzada goblin' de solmar_legacy) con las mismas reglas del cliente (Proyectil del mago, ataque
 * cuerpo a cuerpo del guerrero, pociones a <40 % de vida) y se anota si gana o muere y cuánto tarda.
 *
 *   cd apps/server
 *   DATA_DIR=<carpeta vacía> PORT=8211 FDN_DEBUG_TRUST_SAVE=1 FDN_DEBUG_WARP=1 npx tsx src/index.ts   (en otra terminal)
 *   npx tsx scripts/live-arranque.ts ws://localhost:8211/ws [pruebas=3]
 */
import { WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '@fdn/proto';
import { MOB_TYPES, buildMap } from '@fdn/world';

const URL = process.argv[2] ?? 'ws://localhost:8211/ws', TRIALS = Number(process.argv[3]) || 3;
const RUN = Math.random().toString(36).slice(2, 5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rint = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
type Payload = NonNullable<ClientMessage['payload']>;
type Srv = NonNullable<ServerMessage['payload']>;
const map = buildMap('solmar_legacy');

interface Mob { id: number; x: number; y: number; hp: number }
class Bot {
    ws!: WebSocket; id = 0n; x = 0; y = 0;
    hp = 0; maxHp = 0; mp = 0; maxMp = 0; dead = false; pots = { hp: 3, mp: 3 };
    mobs: Mob[] = []; types = new Map<number, string>(); kills = 0; taken: { t: number; dmg: number; mob: number }[] = [];
    constructor(readonly name: string, readonly cls: 'mago' | 'guerrero', readonly lvl: number) { }
    async connect() {
        this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
        let ready!: () => void; const got = new Promise<void>((r) => (ready = r));
        this.ws.on('message', (d: Buffer) => {
            const p = ServerMessage.decode(new Uint8Array(d)).payload as Srv | undefined; if (!p) return;
            switch (p.$case) {
                case 'initialState': this.id = p.value.playerId; break;
                case 'initialGameWorldState': this.x = p.value.playerX; this.y = p.value.playerY; ready(); break;
                case 'vitals': this.hp = p.value.hp; this.maxHp = p.value.maxHp; this.mp = p.value.mp; this.maxMp = p.value.maxMp; this.dead = p.value.dead; break;
                case 'mobsSnapshot': for (const m of p.value.mobs) this.types.set(m.id, MOB_TYPES[m.type]); this.mobs = p.value.mobs.map((m) => ({ id: m.id, x: m.x, y: m.y, hp: m.hp, zone: m.zone })) as never; break;
                case 'mobHitPlayer': this.taken.push({ t: Date.now(), dmg: p.value.dmg, mob: p.value.mobId }); break;
                case 'killReward': this.kills++; break;
                case 'inventoryState': this.pots = { hp: p.value.potsHp, mp: p.value.potsMp }; break;
            }
        });
        await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
        this.send({ $case: 'authenticateRequest', value: { id: '', characterName: this.name, password: 'test1234' } });
        await Promise.race([got, sleep(5000).then(() => { throw new Error('no entró'); })]);
    }
    send(p: Payload) { this.ws.send(ClientMessage.encode({ payload: p } as ClientMessage).finish()); }
    async setup() {
        const eq = this.cls === 'mago' ? { arma: { n: 'Báculo de fresno', r: 0, a: [] }, armadura: { n: 'Túnica de mago', r: 0, a: [] } } : { arma: { n: 'Espada corta', r: 0, a: [] }, armadura: { n: 'Coraza de cuero', r: 0, a: [] } };
        const json = JSON.stringify({ v: 1, faction: 'solmar', cls: this.cls, lvl: this.lvl, exp: 0, gold: 0, hp: 99999, mp: 99999, bag: [], eq: { cabeza: null, anillo: null, ...eq }, q: { i: 0, st: 'new', prog: 0, keys: {}, shards: {} }, pots: { hp: 3, mp: 3 }, u: [] });
        this.send({ $case: 'saveCharacterRequest', value: { data: json } });
        await sleep(1000);
    }
}

/** Celda caminable y no segura a ~6 celdas del centro de la zona, del lado más despejado. */
let cellIdx = 0;
function standCell(z: { x: number; y: number }): [number, number] {
    const cands: { c: [number, number]; s: number }[] = [];
    for (let y = 1; y < map.size - 1; y++) for (let x = 1; x < map.size - 1; x++) {
        if (map.blocked[y][x] || map.safe[y][x]) continue;
        const d = Math.hypot(x - z.x, y - z.y); if (d < 5.5 || d > 6.5) continue;
        const other = map.zones.filter((o) => o !== z).reduce((m, o) => Math.min(m, Math.hypot(o.x - x, o.y - y)), 99);
        cands.push({ c: [x, y], s: other });
    }
    cands.sort((a, b) => b.s - a.s);
    return cands[(cellIdx++ * 3) % Math.min(cands.length, 30)].c; // una celda distinta por prueba: los bots anteriores siguen en el mundo
}

async function trial(cls: 'mago' | 'guerrero', lvl: number, zoneName: string) {
    const zi = map.zones.findIndex((z) => z.name === zoneName), z = map.zones[zi], [sx, sy] = standCell(z);
    const b = new Bot(`${cls[0]}${lvl}${zi}${RUN}${Math.random().toString(36).slice(2, 5)}`, cls, lvl);
    await b.connect(); await b.setup();
    b.send({ $case: 'playerTeleportRequested', value: { x: sx, y: sy } }); await sleep(600);
    b.x = sx; b.y = sy;
    await sleep(21000); // el server da 20 s de protección al entrar (settings.spawnProtectionTime): sin esperar, el bot quieto no recibiría daño. También deja reaparecer a los mobs.
    if (b.dead) { b.ws.close(); return { result: 'inválida (lo mataron otros mobs mientras esperaba)', t: 0, tDeath: 0, kills: 0, hpLeft: 0, hits: 0, dmg: 0 }; }
    b.taken = []; b.kills = 0;
    const t0 = Date.now(), melee: [number, number] = cls === 'mago' ? [2, 4] : [5, 9], wd: [number, number] = cls === 'mago' ? [2, 4] : [4, 8], mag = cls === 'mago' ? 9 : 0;
    let nextAct = 0, lowAt = 0, potAt = 0, result = 'tiempo', mobsTotal = z.n;
    const present = (b.mobs as unknown as { zone: number }[]).filter((m) => m.zone === zi).length; if (present < z.n) mobsTotal = present;
    while (Date.now() - t0 < 90000) {
        const now = Date.now(), mine = (b.mobs as unknown as (Mob & { zone: number })[]).filter((m) => m.zone === zi && m.hp > 0);
        if (b.dead) { result = 'murió'; break; }
        if (b.kills >= mobsTotal && !mine.length) { result = 'ganó'; break; }
        if (b.hp > 0 && b.hp < b.maxHp * 0.4) { lowAt ||= now; if (now - lowAt > 500 && now - potAt > 1700 && b.pots.hp > 0) { potAt = now; b.pots.hp--; b.send({ $case: 'potionRequest', value: { kind: 0 } }); } } else lowAt = 0;
        if (cls === 'mago' && b.mp < 8 && b.pots.mp > 0 && now - potAt > 1700) { potAt = now; b.pots.mp--; b.send({ $case: 'potionRequest', value: { kind: 1 } }); }
        const tgt = mine.map((m) => ({ m, d: Math.hypot(b.x + 0.5 - m.x, b.y + 0.5 - m.y) })).sort((a, c) => a.d - c.d)[0];
        if (tgt && now >= nextAct) {
            if (cls === 'mago' && b.mp >= 8 && tgt.d <= 7.5) { nextAct = now + 900; const dmg = rint(12, 18) + 2 * lvl + mag; setTimeout(() => b.send({ $case: 'mobHitRequest', value: { mobId: tgt.m.id, dmg: 0, melee: false, crit: false, parSecs: 0, poisonSecs: 0, spell: 'proyectil' } }), 500 + tgt.d * 90); b.mp -= 8; }
            else if (cls === 'guerrero' && tgt.d <= 1.9) { nextAct = now + 850; const dmg = rint(...melee) + lvl + rint(...wd); setTimeout(() => b.send({ $case: 'mobHitRequest', value: { mobId: tgt.m.id, dmg: 0, melee: true, crit: false, parSecs: 0, poisonSecs: 0, spell: 'ataque' } }), 180); }
            else if (cls === 'guerrero' && tgt.d > 1.9 && tgt.d < 5) { // sale al encuentro: un paso por vez hacia el blanco
                const nx = b.x + Math.sign(Math.round(tgt.m.x - 0.5) - b.x), ny = b.y + Math.sign(Math.round(tgt.m.y - 0.5) - b.y);
                if (!map.blocked[ny]?.[nx]) { b.send({ $case: 'requestMovement', value: { curX: b.x, curY: b.y, destX: nx, destY: ny, gameWorldId: '', dashAttack: false } }); b.x = nx; b.y = ny; nextAct = now + 300; }
            }
            else if (cls === 'mago' && b.mp < 8 && tgt.d <= 1.9) { nextAct = now + 850; setTimeout(() => b.send({ $case: 'mobHitRequest', value: { mobId: tgt.m.id, dmg: 0, melee: true, crit: false, parSecs: 0, poisonSecs: 0, spell: 'ataque' } }), 180); }
        }
        // el guerrero espera en su sitio hasta que alguien se acerque a 4,5 celdas (los mobs lo notan solos); el mago pega primero
        if (cls === 'guerrero' && mine.length && !b.taken.length && now - t0 > 1000 && tgt && tgt.d > 5) { /* se acerca hasta 4 celdas */ }
        await sleep(50);
    }
    const t = (Date.now() - t0) / 1000, first = b.taken[0]?.t, tDeath = first ? (Date.now() - first) / 1000 : 0;
    const by: Record<string, number> = {}; for (const h of b.taken) { const k = b.types.get(h.mob) ?? '?'; by[k] = (by[k] ?? 0) + 1; }
    if (Object.keys(by).length) console.log('  golpes por tipo de mob:', JSON.stringify(by));
    if (process.env.VERBOSE) console.log(b.taken.map((h) => `${((h.t - t0) / 1000).toFixed(2)}:m${h.mob}:${h.dmg}`).join(' '));
    b.ws.close();
    return { result, t, tDeath, kills: b.kills, hpLeft: b.hp / (b.maxHp || 1), hits: b.taken.length, dmg: b.taken.reduce((a, x) => a + x.dmg, 0) };
}

console.log(`Validación en vivo (${TRIALS} pruebas por celda, la zona tiene su cantidad real de mobs)`);
for (const [zone, label] of [['Campamento goblin', 'goblins (3)'], ['Avanzada goblin', 'élites (3)']] as const) {
    for (const cls of ['mago', 'guerrero'] as const) {
        if (process.env.ONLY && process.env.ONLY !== `${cls}:${zone}`) continue; // ej. ONLY='guerrero:Avanzada goblin'
        const rs = [];
        for (let i = 0; i < TRIALS; i++) { rs.push(await trial(cls, 1, zone)); await sleep(1000); }
        console.log(`${cls} Nv1 vs ${label}: ${rs.map((r) => `${r.result} ${r.t.toFixed(1)} s (kills ${r.kills}, vida ${Math.round(r.hpLeft * 100)} %, ${r.hits} golpes recibidos / ${r.dmg} de daño crudo)`).join(' | ')}`);
        await sleep(2000);
    }
}
process.exit(0);
