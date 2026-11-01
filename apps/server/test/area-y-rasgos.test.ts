/** Paso 1.4 (docs/PLAN_DE_TRABAJO.md): tope de objetivos y caída de daño en área, huida de mobs, anti-físico/anti-mágico, tóxico, explosivo, mutantes y salvajes. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import {
    ANTI_DAMAGE_MULT, FLEE_HP_FRAC, MUTANT_DROP_MULT, TRAIT_ANTI_MAGIC, TRAIT_ANTI_PHYS, TRAIT_EXPLOSIVE, TRAIT_MUTANT, TRAIT_TOXIC, TRAIT_WILD,
    fleeChance, mobDef, traitDropMult, traitExpMult, traitHpMult, traitLabel, type MobType, type WorldMap,
} from '@fdn/world';
import { MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';
import { AOE_MAX_TARGETS, PvpLimiter, aoeMult, statsFromChar } from '../src/systems/pvpCombat.ts';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { Economy, type EconCtx, type KillInfo } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';

const N = 40;
let clock = 9_000_000;
mock.method(Date, 'now', () => clock);

type Raw = { hp: number; hpMax: number; par: number; imm: number; poison: number; traits: number; state: string; fled: boolean; id: number; x: number; y: number };
interface Opts { type?: MobType; n?: number; r?: number; at?: { x: number; y: number }; cls?: string; lvl?: number; eq?: Record<string, never> }

function setup(o: Opts = {}) {
    clock += 100_000;
    const { type = 'goblin', n = 1, r = 0, at = { x: 14, y: 20 }, cls = 'guerrero', lvl = 10 } = o;
    const sent: ServerMessage[] = [], hurts: { raw: number; source: string }[] = [], timers: { at: number; fn: () => void }[] = [];
    const combat = statsFromChar({ lvl, cls, eq: {} });
    const p = { playerId: 7n, posX: at.x, posY: at.y, disconnected: false, isDead: false, status: { isInvisible: false }, combat, pvp: new PvpLimiter(), send: (m: ServerMessage) => sent.push(m) } as unknown as Player;
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type, x: 10, y: 20, r, n, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const rewards: { traits: number }[] = [];
    const host: MobHost = {
        players: () => [p], playerById: (id) => (id === p.playerId ? p : undefined), nearby: () => [p],
        after: (ms, fn) => { timers.push({ at: clock + ms, fn }); },
        hurt: (_p, raw, source) => { hurts.push({ raw, source }); }, stun: () => 0, pay: () => true, heal: () => {},
        reward: (_p, info) => { rewards.push({ traits: info.traits }); },
    };
    const sim = new MobSim(map, host);
    const raws = [...(sim as unknown as { mobs: Map<number, Raw> }).mobs.values()];
    for (const m of raws) { m.traits = 0; m.hp = m.hpMax = 1e6; } // sin rasgos al azar y sin que se mueran en medio de la prueba
    const fire = () => { for (const t of timers.filter((x) => x.at <= clock)) { timers.splice(timers.indexOf(t), 1); t.fn(); } };
    const hit = (m: Raw, spell: string, extra: Record<string, unknown> = {}) => sim.hit(p, { mobId: m.id, dmg: 0, melee: spell === 'ataque', crit: false, parSecs: 0, poisonSecs: 0, spell, ...extra });
    const dmgs = () => sent.filter((m) => m.payload?.$case === 'mobDamaged').map((m) => (m.payload as { value: { mobId: number; dmg: number } }).value);
    return { sim, p, raws, hit, dmgs, hurts, rewards, fire, sent, tick: (ms: number, steps = 1) => { for (let i = 0; i < steps; i++) { clock += ms; sim.update(); fire(); } } };
}

// ---------- A. fórmula de caída ----------
test('área: 100 %, 88 %, 76 %, 64 %, 52 % y nunca menos de 50 %', () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(aoeMult), [1, 0.88, 0.76, 0.64, 0.52]);
    assert.equal(aoeMult(5), 0.5); assert.equal(aoeMult(50), 0.5); assert.equal(aoeMult(-3), 1);
    assert.equal(AOE_MAX_TARGETS.bola, 5); assert.equal(AOE_MAX_TARGETS.lluvia, 5); assert.equal(AOE_MAX_TARGETS.giro, 4);
});

test('área: el daño total con 1, 2, 3 y 6 objetivos crece pero cada vez menos', () => {
    const total = (n: number) => Array.from({ length: Math.min(n, 5) }, (_, i) => aoeMult(i)).reduce((a, b) => a + b, 0);
    assert.deepEqual([1, 2, 3, 6].map(total).map((x) => Math.round(x * 100) / 100), [1, 1.88, 2.64, 3.8]);
});

// ---------- B. tope de objetivos en el server ----------
test('área: de 8 mobs en el área, "bola" solo le pega a 5, con daño decreciente', () => {
    const { raws, hit, dmgs } = setup({ cls: 'mago', n: 8, r: 1.5, at: { x: 12, y: 20 } });
    assert.equal(raws.length, 8);
    for (const m of raws) hit(m, 'bola'); // el cliente manda a todos los del área
    const d = dmgs();
    assert.equal(d.length, 5, 'tope de 5 objetivos');
    assert.equal(new Set(d.map((x) => x.mobId)).size, 5);
    // el primero pega más fuerte que el último (misma tirada base ±15 %, 100 % contra 52 %)
    assert.ok(d[0].dmg > d[4].dmg * 1.2, `${d[0].dmg} vs ${d[4].dmg}`);
});

test('área: un cliente tramposo que repite el golpe sobre otros mobs dentro del mismo lanzamiento no pasa del tope', () => {
    const { raws, hit, dmgs } = setup({ cls: 'mago', n: 8, r: 1.5, at: { x: 12, y: 20 } });
    for (let k = 0; k < 20; k++) for (const m of raws) hit(m, 'bola');
    assert.equal(dmgs().length, 5);
});

test('área: la recarga habilita otro lanzamiento y vuelven a entrar 5', () => {
    const { raws, hit, dmgs } = setup({ cls: 'mago', n: 8, r: 1.5, at: { x: 12, y: 20 } });
    for (const m of raws) hit(m, 'bola');
    clock += 4000;
    for (const m of raws) hit(m, 'bola');
    assert.equal(dmgs().length, 10);
});

test('un solo objetivo no tiene castigo: pega el daño completo', () => {
    const { raws, hit, dmgs } = setup({ cls: 'mago', n: 1 });
    hit(raws[0], 'bola');
    // bola de nivel 10: (18..26) + 2·10 sin arma/Magia, ×0,85..1,15
    assert.ok(dmgs()[0].dmg >= Math.round(38 * 0.85) - 1 && dmgs()[0].dmg <= Math.round(46 * 1.15) + 1, String(dmgs()[0].dmg));
});

// ---------- B. huida ----------
test('huida: un mob cobarde con ≤ 7 % de vida corre; con más vida no', () => {
    const rnd = mock.method(Math, 'random', () => 0); // la tirada de valentía sale "cobarde"
    try {
        assert.ok(fleeChance('goblin') > 0);
        const a = setup({ type: 'goblin' }); const m = a.raws[0]; m.hp = m.hpMax = 10_000; // el golpe (~20) no lo mata
        m.hp = 5000; a.hit(m, 'ataque'); assert.notEqual(m.state, 'flee', 'con 50 % no huye');
        clock += 2000; m.hp = Math.round(10_000 * FLEE_HP_FRAC) - 100; a.hit(m, 'ataque');
        assert.equal(m.state, 'flee', `con ${m.hp}/10000 huye`);
    } finally { rnd.mock.restore(); }
});

test('huida: no huye si es valiente (zombi) ni si es jefe', () => {
    const rnd = mock.method(Math, 'random', () => 0);
    try {
        assert.equal(fleeChance('zombie'), 0); assert.equal(fleeChance('goblin_jefe'), 0);
        for (const type of ['zombie', 'goblin_jefe'] as MobType[]) {
            const a = setup({ type }); const m = a.raws[0]; m.hpMax = 10_000; m.hp = 600;
            a.hit(m, 'ataque'); assert.notEqual(m.state, 'flee', type);
        }
    } finally { rnd.mock.restore(); }
});

test('huida: un mob paralizado no huye', () => {
    const rnd = mock.method(Math, 'random', () => 0);
    try {
        const a = setup({ type: 'goblin', cls: 'mago' }); const m = a.raws[0]; m.hpMax = 10_000; m.hp = 600;
        m.par = clock / 1000 + 5; // paralizado
        a.hit(m, 'ataque'); assert.notEqual(m.state, 'flee');
    } finally { rnd.mock.restore(); }
});

test('huida: se aleja, y a los segundos vuelve a casa y se cura; mientras corre no se contagia ni vuelve a pelear', () => {
    const rnd = mock.method(Math, 'random', () => 0);
    try {
        const a = setup({ type: 'goblin', at: { x: 11, y: 20 } }); const m = a.raws[0]; m.hpMax = 10_000; m.hp = 600;
        m.state = 'chase';
        a.hit(m, 'ataque'); assert.equal(m.state, 'flee');
        const d0 = Math.hypot(m.x - 11.5, m.y - 20.5);
        a.tick(100, 10);
        assert.ok(Math.hypot(m.x - 11.5, m.y - 20.5) > d0 + 0.5, 'se alejó del jugador');
        a.hit(m, 'golpe'); // lo siguen golpeando: sigue huyendo, no se pone a perseguir
        assert.equal(m.state, 'flee');
        a.tick(100, 80); // 8 s: ya pasó la huida
        assert.notEqual(m.state, 'flee');
    } finally { rnd.mock.restore(); }
});

// ---------- B. habilidades de mob ----------
test('anti-físico: el daño físico se reduce a la mitad de verdad; el mágico no', () => {
    const base = setup({ type: 'goblin', cls: 'guerrero', lvl: 20 }), anti = setup({ type: 'goblin', cls: 'guerrero', lvl: 20 });
    anti.raws[0].traits = TRAIT_ANTI_PHYS;
    let a = 0, b = 0, n = 0;
    for (let i = 0; i < 400; i++) { base.hit(base.raws[0], 'ataque'); anti.hit(anti.raws[0], 'ataque'); clock += 1000; n++; }
    a = base.dmgs().reduce((s, x) => s + x.dmg, 0) / n; b = anti.dmgs().reduce((s, x) => s + x.dmg, 0) / n;
    assert.ok(Math.abs(b / a - ANTI_DAMAGE_MULT) < 0.05, `razón ${(b / a).toFixed(3)}`);
    // el mismo mob anti-físico recibe el hechizo mágico completo
    const mg = setup({ type: 'goblin', cls: 'mago', lvl: 20 }), mg0 = setup({ type: 'goblin', cls: 'mago', lvl: 20 });
    mg.raws[0].traits = TRAIT_ANTI_PHYS;
    let x = 0, y = 0; for (let i = 0; i < 100; i++) { mg.hit(mg.raws[0], 'hoja'); mg0.hit(mg0.raws[0], 'hoja'); clock += 2000; }
    x = mg.dmgs().reduce((s, t) => s + t.dmg, 0); y = mg0.dmgs().reduce((s, t) => s + t.dmg, 0);
    assert.ok(Math.abs(x / y - 1) < 0.05, `magia contra anti-físico ${(x / y).toFixed(3)}`);
});

test('anti-mágico: el daño mágico se reduce a la mitad; el físico no', () => {
    const base = setup({ type: 'goblin', cls: 'mago', lvl: 20 }), anti = setup({ type: 'goblin', cls: 'mago', lvl: 20 });
    anti.raws[0].traits = TRAIT_ANTI_MAGIC;
    for (let i = 0; i < 100; i++) { base.hit(base.raws[0], 'hoja'); anti.hit(anti.raws[0], 'hoja'); clock += 2000; }
    const a = base.dmgs().reduce((s, x) => s + x.dmg, 0), b = anti.dmgs().reduce((s, x) => s + x.dmg, 0);
    assert.ok(Math.abs(b / a - ANTI_DAMAGE_MULT) < 0.05, `razón ${(b / a).toFixed(3)}`);
    const f = setup({ type: 'goblin', cls: 'guerrero', lvl: 20 }), f0 = setup({ type: 'goblin', cls: 'guerrero', lvl: 20 });
    f.raws[0].traits = TRAIT_ANTI_MAGIC;
    for (let i = 0; i < 300; i++) { f.hit(f.raws[0], 'ataque'); f0.hit(f0.raws[0], 'ataque'); clock += 1000; }
    const x = f.dmgs().reduce((s, t) => s + t.dmg, 0), y = f0.dmgs().reduce((s, t) => s + t.dmg, 0);
    assert.ok(Math.abs(x / y - 1) < 0.06, `físico contra anti-mágico ${(x / y).toFixed(3)}`);
});

test('tóxico: cada golpe deja un sangrado de 3 ticks; sin el rasgo no', () => {
    for (const toxic of [true, false]) {
        const a = setup({ type: 'goblin', at: { x: 10, y: 20 } }); const m = a.raws[0];
        if (toxic) m.traits = TRAIT_TOXIC;
        m.state = 'chase'; (m as unknown as { target: bigint }).target = 7n;
        a.tick(100, 30); // el mob pega (hay ticks de 200 ms de retraso del golpe)
        a.tick(1000, 5); // y se vencen los sangrados
        const hits = a.hurts.length;
        assert.ok(hits > 0, 'el mob tiene que pegar');
        const names = new Set(a.hurts.map((h) => h.source)); assert.ok(names.has('Goblin lancero'));
        if (toxic) assert.ok(hits >= 4, `con tóxico hay golpes + sangrados (${hits})`);
        else assert.ok(hits <= 6, `sin tóxico solo golpes (${hits})`);
    }
});

test('explosivo: al morir pega a los jugadores que están cerca, y a nadie si están lejos', () => {
    const near = setup({ type: 'goblin', at: { x: 10, y: 20 } }); near.raws[0].traits = TRAIT_EXPLOSIVE; near.raws[0].hp = 1;
    near.hit(near.raws[0], 'ataque');
    assert.equal(near.hurts.filter((h) => h.source.includes('explosión')).length, 1);
    const far = setup({ type: 'goblin', at: { x: 14, y: 20 } }); far.raws[0].traits = TRAIT_EXPLOSIVE; far.raws[0].hp = 1;
    far.hit(far.raws[0], 'ataque'); // el jugador pega a 4 celdas: fuera del radio de la explosión
    assert.equal(far.hurts.filter((h) => h.source.includes('explosión')).length, 0);
});

// ---------- exp y botín ----------
test('exp: multiplicadores por rasgo (mutante ×3, anti ×1,5, tóxico ×1,3, explosivo ×1,5, salvaje +25 %) y se combinan', () => {
    assert.equal(traitExpMult(0), 1); assert.equal(traitExpMult(TRAIT_MUTANT), 3);
    assert.equal(traitExpMult(TRAIT_ANTI_PHYS), 1.5); assert.equal(traitExpMult(TRAIT_ANTI_MAGIC), 1.5);
    assert.equal(traitExpMult(TRAIT_TOXIC), 1.3); assert.equal(traitExpMult(TRAIT_EXPLOSIVE), 1.5); assert.equal(traitExpMult(TRAIT_WILD), 1.25);
    assert.ok(Math.abs(traitExpMult(TRAIT_MUTANT | TRAIT_EXPLOSIVE) - 4.5) < 1e-9);
    assert.equal(traitDropMult(TRAIT_MUTANT), MUTANT_DROP_MULT); assert.equal(traitDropMult(TRAIT_EXPLOSIVE), 1);
    assert.ok(traitHpMult(TRAIT_MUTANT) > 1);
    assert.equal(traitLabel(TRAIT_MUTANT | TRAIT_TOXIC), 'Mutante Tóxico');
});

class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
test('exp en el server: matar un mutante da el triple, un salvaje +25 % y los rasgos llegan desde el mob', () => {
    const settings = loadSettings(), catalogs = loadCatalogs();
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const world: GameWorld = reg.ensure('solmar_legacy');
    const session: TransferSession = { sessionId: 's-x', worldId: world.id };
    const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: 11, y: 11, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true } as unknown as PersistedPlayer;
    world.playerConnected(session.sessionId, 'x', () => {}, () => {}, persisted);
    mem.put('acc-x', { name: 'x', salt: '', hash: '', created: 0, lastLogin: 0 });
    world.bindAccount(session.sessionId, 'acc-x');
    world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
    const p = world.playerOf(session.sessionId)!, st = p.econ!;
    const ctx: EconCtx = { npcs: [], restat: () => {}, ground: { add: () => {} } as never };
    const k = (traits: number): KillInfo => ({ mobId: 1, type: 'goblin', def: mobDef('goblin', { lvl: 1 }), zoneName: 'prueba', origin: 'pit', x: 0, y: 0, traits });
    const gain = (traits: number) => { st.lvl = 1; st.exp = 0; eco.reward(p, ctx, k(traits)); return st.exp; };
    const base = gain(0);
    assert.equal(gain(TRAIT_MUTANT), base * 3);
    assert.equal(gain(TRAIT_WILD), Math.round(base * 1.25));
    assert.equal(gain(TRAIT_ANTI_PHYS), Math.round(base * 1.5));
});

// ---------- el sorteo de rasgos al nacer ----------
test('rasgos al nacer: mutantes y habilidades salen en las proporciones del diseño, nunca en jefes, y los sueltos son salvajes', () => {
    let mut = 0, skill = 0, total = 0;
    // Se prueba el sorteo con el simulador real sin pisar los rasgos: se construye uno y se leen directo.
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const mk = (type: MobType, name: string, n: number) => {
        const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type, x: 20, y: 20, r: 15, n, name }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
        const host = { players: () => [], playerById: () => undefined, nearby: () => [], after: () => {}, hurt: () => {}, stun: () => 0, pay: () => true, heal: () => {}, reward: () => {} } as unknown as MobHost;
        return [...(new MobSim(map, host) as unknown as { mobs: Map<number, Raw> }).mobs.values()];
    };
    for (let i = 0; i < 20; i++) for (const m of mk('goblin', 'pozo', 100)) { total++; if (m.traits & TRAIT_MUTANT) mut++; if (m.traits & (TRAIT_ANTI_PHYS | TRAIT_ANTI_MAGIC | TRAIT_TOXIC | TRAIT_EXPLOSIVE)) skill++; assert.equal(m.traits & TRAIT_WILD, 0); }
    assert.ok(mut / total > 0.02 && mut / total < 0.04, `mutantes ${(mut / total * 100).toFixed(1)} %`);
    assert.ok(skill / total > 0.08 && skill / total < 0.12, `habilidades ${(skill / total * 100).toFixed(1)} %`);
    assert.ok(mk('goblin', 'Merodeadores de prueba', 50).every((m) => m.traits === TRAIT_WILD), 'los mobs sueltos son salvajes y nada más');
    assert.ok(mk('barbaro', 'jefe', 50).every((m) => m.traits === 0), 'los jefes no llevan rasgos');
});

// ---------- G. rendimiento ----------
test('rendimiento: un mapa con 60 mobs (con rasgos y huidas) mantiene el tick del simulador bajo 10 ms en p95', () => {
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const zones = [{ type: 'goblin' as MobType, x: 20, y: 20, r: 12, n: 30, name: 'pozo A' }, { type: 'skeleton' as MobType, x: 20, y: 20, r: 12, n: 30, name: 'pozo B' }];
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones, buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const combat = statsFromChar({ lvl: 10, cls: 'guerrero', eq: {} });
    const p = { playerId: 7n, posX: 20, posY: 20, disconnected: false, isDead: false, status: { isInvisible: false }, combat, pvp: new PvpLimiter(), send: () => {} } as unknown as Player;
    const host: MobHost = { players: () => [p], playerById: () => p, nearby: () => [p], after: () => {}, hurt: () => {}, stun: () => 0, pay: () => true, heal: () => {}, reward: () => {} };
    const sim = new MobSim(map, host);
    assert.equal(sim.count, 60);
    const times: number[] = [];
    mock.method(Date, 'now', () => clock);
    for (let i = 0; i < 300; i++) { clock += 50; const t0 = process.hrtime.bigint(); sim.update(); times.push(Number(process.hrtime.bigint() - t0) / 1e6); }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    assert.ok(p95 < 10, `p95 del tick: ${p95.toFixed(2)} ms`);
});
