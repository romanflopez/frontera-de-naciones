/**
 * Prueba de combate contra un server en marcha (ver docs/COMBATE.md):
 *   (a) el daño con DF = 0, 100 y 300 (físico) y RM = 0, 100, 300 (mágico) coincide con la fórmula 100/(100+X);
 *   (b) la parálisis se acorta con la RM (y con la resistencia a parálisis);
 *   (c) dos pociones dentro del delay global de 1,75 s: solo cuenta una;
 *   (d) la poción de vida cura 20 % al instante y el resto en 4 ticks de 0,5 s (total exacto).
 *
 * Uso (server NUEVO y con carpeta de datos vacía en cada corrida; los bots quedan 60 s en el mundo y ocupan celdas):
 *   cd apps/server
 *   DATA_DIR=<carpeta vacía> PORT=8213 FDN_DEBUG_TRUST_SAVE=1 FDN_DEBUG_WARP=1 npx tsx src/index.ts   (en otra terminal)
 *   npx tsx scripts/test-combat.ts ws://localhost:8213/ws
 *
 * FDN_DEBUG_TRUST_SAVE=1 es imprescindible: sin él el server ignora los guardados del cliente (la economía es autoritativa)
 * y todos los bots quedan con el kit inicial (nivel 1), así que ningún rango de daño calza. Los bots entran en el mapa inicial
 * 'solmar_legacy' (donde se arma la prueba); si el server los manda a otro mapa, el script lo avisa y corta.
 */
import { WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '@fdn/proto';
import { buildMap, mapLinks } from '@fdn/world';

const URL = process.argv[2] ?? 'ws://localhost:8111/ws';
const RUN = Math.random().toString(36).slice(2, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0, checks = 0;
const check = (ok: boolean, msg: string) => { checks++; if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); };

type Payload = NonNullable<ClientMessage['payload']>;
type Srv = NonNullable<ServerMessage['payload']>;
interface Item { n: string; r: number; a: { id: string; v: number }[] }

class Bot {
    ws!: WebSocket;
    id = 0n; x = 0; y = 0; ms = 270; mapName = '';
    vitals = { hp: 0, maxHp: 0, mp: 0, maxMp: 0, dead: false };
    vitalsLog: { t: number; hp: number; mp: number }[] = [];
    hits: { casterId: bigint; fx: string; targetId: bigint; dmg: number; secs: number }[] = [];
    bad: string[] = [];
    constructor(readonly name: string) { }

    async connect() {
        this.ws = new WebSocket(URL);
        this.ws.binaryType = 'nodebuffer';
        let ready!: () => void; const got = new Promise<void>((r) => (ready = r));
        this.ws.on('message', (d: Buffer) => {
            const p = ServerMessage.decode(new Uint8Array(d)).payload as Srv | undefined; if (!p) return;
            switch (p.$case) {
                case 'initialState': this.id = p.value.playerId; this.ms = p.value.movementSpeedMs || 270; break;
                case 'initialGameWorldState': this.mapName = p.value.mapName; this.x = p.value.playerX; this.y = p.value.playerY; ready(); break;
                case 'vitals': this.vitals = { hp: p.value.hp, maxHp: p.value.maxHp, mp: p.value.mp, maxMp: p.value.maxMp, dead: p.value.dead }; this.vitalsLog.push({ t: Date.now(), hp: p.value.hp, mp: p.value.mp }); break;
                case 'pvpHit': this.hits.push({ casterId: p.value.casterId, fx: p.value.fx, targetId: p.value.targetId, dmg: p.value.dmg, secs: p.value.secs }); break;
                case 'resetPosition': case 'positionCorrected': this.bad.push(p.$case); break;
            }
        });
        await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
        this.send({ $case: 'authenticateRequest', value: { id: '', characterName: this.name, password: 'test1234' } });
        await Promise.race([got, sleep(5000).then(() => { throw new Error(`${this.name}: no entró al mundo`); })]);
        if (this.mapName && this.mapName !== 'solmar_legacy') throw new Error(`${this.name}: entró en el mapa '${this.mapName}', la prueba se arma en 'solmar_legacy'`);
    }
    send(p: Payload) { this.ws.send(ClientMessage.encode({ payload: p } as ClientMessage).finish()); }
    close() { this.ws.close(); }

    /** Guarda un personaje (el server lo valida y recalcula los stats de combate); el server limita los guardados a uno cada 0,8 s. */
    async save(o: { cls: 'guerrero' | 'mago'; lvl: number; eq?: Partial<Record<'arma' | 'armadura' | 'cabeza' | 'anillo', Item | null>>; hp?: number; mp?: number }) {
        const json = JSON.stringify({ v: 1, faction: 'solmar', cls: o.cls, lvl: o.lvl, exp: 0, gold: 0, hp: o.hp ?? 99999, mp: o.mp ?? 99999, bag: [], eq: { arma: null, armadura: null, cabeza: null, anillo: null, ...o.eq }, q: { i: 0, st: 'new', prog: 0, keys: {}, shards: {} }, pots: { hp: 3, mp: 3 }, u: [] });
        this.send({ $case: 'saveCharacterRequest', value: { data: json } });
        await sleep(950);
    }
    profile(faction: string) { this.send({ $case: 'changePlayerProfileRequest', value: { profile: `${faction};x;` } }); }

    async walk(path: [number, number][]) {
        for (const [nx, ny] of path) {
            this.send({ $case: 'requestMovement', value: { curX: this.x, curY: this.y, destX: nx, destY: ny, gameWorldId: '', dashAttack: false } });
            this.x = nx; this.y = ny;
            await sleep(this.ms + 40);
        }
        if (this.bad.length) throw new Error(`${this.name}: el server corrigió la posición (${this.bad.join(',')})`);
    }
    cast(spell: string, target: Bot, secs = 0) {
        this.send({ $case: 'pvpHitRequest', value: { fx: '', x: target.x, y: target.y, targetId: target.id, dmg: 0, secs, r: 0, spell } });
    }
    /** Mis golpes confirmados por el server sobre `target` (el aviso propio: fx vacío). */
    myHits(target: Bot) { return this.hits.filter((h) => h.fx === '' && h.targetId === target.id && h.casterId === this.id); }
}

// ---------- mapa: celdas de pasto fuera de las zonas seguras, cerca del spawn ----------
const map = buildMap('solmar_legacy');
const N = map.size, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
/** Celdas que no se pisan: portales/escaleras, vínculos entre mapas, waypoints y NPC, por si pisarlas teletransporta o el server las ocupa. */
const avoidCells = new Set<string>();
for (const c of [...(map.portals ?? []).flatMap((q) => [q, { x: q.tx, y: q.ty }]), ...(map.waypoints ?? []), ...map.npcs, ...mapLinks('solmar_legacy')])
    avoidCells.add(`${Math.floor(c.x)},${Math.floor(c.y)}`);
const free = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && !map.blocked[y][x] && !avoidCells.has(`${x},${y}`);
/** Camino (BFS, 8 direcciones sin cortar esquinas) de `from` a `to` evitando celdas ocupadas. */
function route(from: [number, number], to: [number, number], avoid: Set<string>): [number, number][] {
    const key = (x: number, y: number) => `${x},${y}`, prev = new Map<string, string>(), q = [from]; prev.set(key(...from), '');
    while (q.length) {
        const [x, y] = q.shift()!;
        if (x === to[0] && y === to[1]) break;
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy, k = key(nx, ny);
            if (prev.has(k) || !free(nx, ny) || (avoid.has(k) && !(nx === to[0] && ny === to[1]))) continue;
            if (dx && dy && (!free(x + dx, y) || !free(x, y + dy))) continue;
            prev.set(k, key(x, y)); q.push([nx, ny]);
        }
    }
    const out: [number, number][] = []; let k = key(...to);
    if (!prev.has(k)) throw new Error(`sin camino a ${to}`);
    while (k !== key(...from)) { const [a, b] = k.split(',').map(Number); out.unshift([a, b]); k = prev.get(k)!; }
    return out;
}
/** Celdas libres y no seguras más cercanas al spawn, en orden de cercanía (para ubicar a todos juntos). */
function openCells(n: number): [number, number][] {
    const sp = map.spawn, seen = new Set<string>(), q: [number, number][] = [[sp.x, sp.y]], out: [number, number][] = []; seen.add(`${sp.x},${sp.y}`);
    while (q.length && out.length < n) {
        const [x, y] = q.shift()!;
        if (free(x, y) && !map.safe[y][x] && !map.safe[y - 1]?.[x] && !map.safe[y + 1]?.[x] && !map.safe[y][x - 1] && !map.safe[y][x + 1]) out.push([x, y]);
        for (const [dx, dy] of dirs) { const nx = x + dx, ny = y + dy, k = `${nx},${ny}`; if (!seen.has(k) && free(nx, ny)) { seen.add(k); q.push([nx, ny]); } }
    }
    return out;
}

const mit = (raw: number, x: number) => Math.max(1, Math.round((raw * 100) / (100 + x)));
const ring = (a: { id: string; v: number }[]): Item => ({ n: 'Anillo opaco', r: 3, a });

async function main() {
    const cells = openCells(40), used = new Set<string>();
    // posiciones: el que pega y los blancos quedan en una fila, a 1 celda de distancia entre sí
    const row = cells.filter((c, i, arr) => arr.some((o, j) => j !== i && o[1] === c[1] && o[0] === c[0] + 1));
    if (row.length < 8) throw new Error('no hay suficiente espacio abierto cerca del spawn');
    const everyone: Bot[] = [];
    const place = async (b: Bot, c: [number, number]) => { const others = new Set(everyone.filter((o) => o !== b).map((o) => `${o.x},${o.y}`)); await b.walk(route([b.x, b.y], c, others)); used.add(`${c[0]},${c[1]}`); };

    const A = new Bot(`ata${RUN}`); everyone.push(A);
    await A.connect(); A.profile('vhar');
    const targets = Array.from({ length: 6 }, (_, i) => new Bot(`bl${i}${RUN}`));
    for (const t of targets) { everyone.push(t); await t.connect(); t.profile('solmar'); await sleep(60); }
    // sacar a todos de la ciudad, uno por vez, a celdas contiguas
    const spots = row.slice(0, 7);
    await place(A, spots[0]);
    for (let i = 0; i < targets.length; i++) await place(targets[i], spots[i + 1]);
    console.log(`posiciones: ${A.x},${A.y} y blancos en ${targets.map((t) => `${t.x},${t.y}`).join(' ')}`);

    // ---------- (a) daño físico y mágico ----------
    // atacante guerrero nivel 2 sin arma: 'ataque' = rint(5,9) + nivel -> crudo 7..11
    await A.save({ cls: 'guerrero', lvl: 2 });
    const cases = [0, 100, 300];
    const dfOf = (x: number): Item => ring(x === 0 ? [] : x === 300 ? [{ id: 'df', v: 200 }, { id: 'df', v: 100 }] : [{ id: 'df', v: x }]);
    // los blancos 0..2 son para DF; la RM se prueba en los mismos con otro equipo
    for (let i = 0; i < 3; i++) await targets[i].save({ cls: 'guerrero', lvl: 60, eq: { anillo: dfOf(cases[i]) } });
    for (let i = 0; i < 3; i++) {
        const T = targets[i], df = cases[i];
        for (let k = 0; k < 6; k++) { A.cast('ataque', T); await sleep(330); }
        const d = A.myHits(T).map((h) => h.dmg), ok = new Set<number>(); for (let raw = 7; raw <= 11; raw++) ok.add(mit(raw, df));
        check(d.length >= 5 && d.every((x) => ok.has(x)), `(a) físico, DF=${df}: daños ${[...new Set(d)].join(',')} esperados ⊂ {${[...ok].join(',')}} (${Math.round((df / (100 + df)) * 100)} % menos)`);
    }
    // mágico: 'proyectil' del mago nivel 3 = rint(12,18) + 2*nivel -> crudo 18..24 (sin báculo)
    await A.save({ cls: 'mago', lvl: 3 });
    const rmOf = (x: number): Item => ring(x === 0 ? [] : x === 300 ? [{ id: 'rm', v: 200 }, { id: 'rm', v: 100 }] : [{ id: 'rm', v: x }]);
    // 'Anillo opaco' ya trae RM 8 de base: la RM total es x + 8; para RM=0 exacto se usa un anillo con otro nombre base (sin RM)
    const noRm = (x: number): Item => (x === 0 ? { n: 'Espada corta', r: 0, a: [] } : rmOf(x));
    for (let i = 0; i < 3; i++) await targets[i].save({ cls: 'guerrero', lvl: 60, eq: i === 0 ? { arma: noRm(0) } : { anillo: noRm(cases[i]) } });
    for (let i = 0; i < 3; i++) {
        const T = targets[i], rm = i === 0 ? 0 : cases[i] + 8; A.hits.length = 0;
        for (let k = 0; k < 3; k++) { A.cast('proyectil', T); await sleep(420); }
        const d = A.myHits(T).map((h) => h.dmg), ok = new Set<number>(); for (let raw = 18; raw <= 24; raw++) ok.add(mit(raw, rm));
        check(d.length >= 2 && d.every((x) => ok.has(x)), `(a) mágico, RM=${rm}: daños ${[...new Set(d)].join(',')} esperados ⊂ {${[...ok].join(',')}}`);
    }
    // el DF no protege del daño mágico ni la RM del físico
    await targets[3].save({ cls: 'guerrero', lvl: 60, eq: { anillo: dfOf(300) } }); A.hits.length = 0;
    for (let k = 0; k < 2; k++) { A.cast('proyectil', targets[3]); await sleep(420); }
    const dm = A.myHits(targets[3]).map((h) => h.dmg);
    check(dm.length >= 1 && dm.every((x) => x >= mit(18, 8) && x <= 24), `(a) DF=300 no reduce el daño mágico (RM 8): ${dm.join(',')}`);

    // ---------- (b) parálisis acortada por la RM (un blanco por caso: después de paralizar hay 8 s de inmunidad) ----------
    // 'paralisis' dura 3 s: base × 100/(100+RM) × (1 - %resistencia a parálisis), mínimo 0,4 s
    await A.save({ cls: 'mago', lvl: 4 }); // sube de nivel: maná lleno
    const para: { T: Bot; rm: number; rpar: number; eq: Item }[] = [
        { T: targets[0], rm: 0, rpar: 0, eq: { n: 'Espada corta', r: 0, a: [] } },
        { T: targets[1], rm: 108, rpar: 0, eq: ring([{ id: 'rm', v: 100 }]) },
        { T: targets[2], rm: 308, rpar: 0, eq: ring([{ id: 'rm', v: 200 }, { id: 'rm', v: 100 }]) },
        { T: targets[3], rm: 108, rpar: 50, eq: ring([{ id: 'rm', v: 100 }, { id: 'rpar', v: 50 }]) },
    ];
    for (const c of para) await c.T.save({ cls: 'guerrero', lvl: 60, eq: c.eq.n === 'Espada corta' ? { arma: c.eq } : { anillo: c.eq } });
    for (const c of para) {
        A.hits.length = 0; A.cast('paralisis', c.T, 1); await sleep(500);
        const want = Math.max(0.4, Math.round(((3 * 100) / (100 + c.rm)) * (1 - c.rpar / 100) * 100) / 100), got = A.myHits(c.T).find((h) => h.secs > 0)?.secs ?? -1;
        check(Math.abs(got - want) < 0.011, `(b) parálisis con RM=${c.rm}${c.rpar ? ` y resist. parálisis ${c.rpar} %` : ''}: ${got} s (esperado ${want} s)`);
        await sleep(3500); // el mismo hechizo tiene 4 s de recarga
    }

    // ---------- (c) y (d) pociones ----------
    // V: guerrero nivel 5 (vida máx. 212, maná máx. 56). Lo lastimo ~100 y le gasto maná para poder tomar pociones.
    const V = targets[0]; // al lado del atacante
    await V.save({ cls: 'guerrero', lvl: 5 });
    await A.save({ cls: 'guerrero', lvl: 6 });
    for (let k = 0; k < 14 && V.vitals.hp > V.vitals.maxHp - 110; k++) { A.cast('ataque', V); await sleep(330); }
    V.send({ $case: 'hpReport', value: { hp: V.vitals.hp, mpSpent: 40, mp: 16, meditating: false } });
    await sleep(400);
    const hp0 = V.vitals.hp, mp0 = V.vitals.mp, max = V.vitals.maxHp, maxMp = V.vitals.maxMp;
    const total = Math.max(50, Math.round(max * 0.4)), first = Math.round(total * 0.2), potMp = Math.max(40, Math.round(maxMp * 0.5));
    console.log(`pociones: vida ${hp0}/${max}, maná ${mp0}/${maxMp}; poción de vida = ${total} (${first} al instante + 4 ticks)`);
    V.vitalsLog.length = 0; const t0 = Date.now();
    V.send({ $case: 'potionRequest', value: { kind: 0 } });
    await sleep(300); V.send({ $case: 'potionRequest', value: { kind: 0 } });  // dentro del GCD: se ignora
    await sleep(300); V.send({ $case: 'potionRequest', value: { kind: 1 } });  // maná dentro del GCD: también se ignora
    await sleep(2000);
    const log = V.vitalsLog.filter((v) => v.t >= t0), inc: { t: number; d: number }[] = [];
    log.forEach((v, i) => { const prev = i ? log[i - 1].hp : hp0; if (v.hp > prev) inc.push({ t: v.t - t0, d: v.hp - prev }); });
    const gained = inc.reduce((a, x) => a + x.d, 0);
    // se mide la suma de las subas de vida (si un mob le pega en medio, la vida final puede bajar, pero lo curado no)
    check(gained === total, `(c)(d) dos pociones de vida dentro del GCD: solo cuenta una (curado +${gained}, esperado +${total}; vida ${hp0} -> ${V.vitals.hp})`);
    check(V.vitals.mp - mp0 < potMp / 2, `(c) la poción de maná dentro del GCD también se ignora (maná ${mp0} -> ${V.vitals.mp}; la regeneración sube ~2/s)`);
    check(inc[0]?.d === first, `(d) 20 % al instante: +${inc[0]?.d} (esperado +${first})`);
    const ticks = inc.slice(1), span = ticks.length ? ticks[ticks.length - 1].t - ticks[0].t : 0;
    check(inc.length === 5 && span >= 1300 && span <= 1900 && ticks.reduce((a, x) => a + x.d, 0) === total - first, `(d) el resto en 4 ticks cada ~0,5 s: ${inc.map((x) => `+${x.d}@${x.t}ms`).join(' ')}`);
    // pasado el GCD, la de maná sí entra
    await sleep(400); V.send({ $case: 'potionRequest', value: { kind: 1 } }); await sleep(400);
    check(V.vitals.mp >= Math.min(maxMp, mp0 + potMp), `(c) pasado el GCD (1,75 s) la poción de maná sí entra (maná ${mp0} -> ${V.vitals.mp})`);
    // el maná no se puede subir con un hpReport (solo con potionRequest o la regeneración del server)
    V.send({ $case: 'hpReport', value: { hp: V.vitals.hp, mpSpent: 30, mp: maxMp, meditating: false } }); await sleep(300);
    check(V.vitals.mp <= maxMp - 30 + 4, `(c) un hpReport no sube el maná (queda ${V.vitals.mp} de ${maxMp} tras gastar 30)`);

    for (const b of [A, ...targets]) b.close();
    console.log(failures ? `\n${failures} de ${checks} comprobaciones FALLARON` : `\n${checks} comprobaciones OK`);
    process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
