/** Puntos de stats (docs/PLAN_DE_TRABAJO.md paso 1.2): fórmulas, repartir y reasignar con validación del server, efectos en el combate y migración. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { STAT_CAP, cleanStats, defaultStats, mobDef, statBonus, statPointsFree, statPointsTotal, statResetCost } from '@fdn/world';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, migrateEcon, newEcon, type EconCtx, type KillInfo } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { rollSpellDamage, statsFromChar } from '../src/systems/pvpCombat.ts';

const settings = loadSettings(), catalogs = loadCatalogs();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const join = (world: GameWorld, name: string, cls = 'guerrero') => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: 11, y: 11, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls, faction: 'solmar' }));
        return { session, log, p: world.playerOf(session.sessionId)! };
    };
    return { mem, eco, reg, join };
}
const ctx = (): EconCtx => ({ npcs: [], restat: () => {}, ground: { add: () => {} } as never });
const lastResult = (log: ServerMessage[]) => { const r = log.filter((m) => m.payload?.$case === 'econResult').at(-1)?.payload as { value: { ok: boolean; code: string; text: string } } | undefined; return r?.value; };

// ---------- A. fórmulas ----------
test('stats: sin repartir no cambian nada, y cada punto da lo que dice el diseño', () => {
    const b0 = statBonus(defaultStats());
    assert.deepEqual(b0, { hp: 0, mp: 0, def: 0, meleeMult: 1, magicMult: 1, dropMult: 1 });
    assert.equal(statBonus(undefined).hp, 0, 'cuenta sin stats = sin bonus');
    const s = defaultStats(); s.vit += 10; s.str += 30; s.mag += 20; s.dex += 20; s.luk += 50;
    const b = statBonus(s);
    assert.equal(b.hp, 25 + 20, '10 de Vitalidad = 25 y 30 de Fuerza = 20 de vida');
    assert.equal(b.mp, 40); assert.equal(b.def, 10);
    assert.ok(Math.abs(b.meleeMult - 1.06) < 1e-9 && Math.abs(b.magicMult - 1.06) < 1e-9 && Math.abs(b.dropMult - 1.05) < 1e-9);
});

test('stats: los puntos salen del nivel (10 al crear + 3 por nivel) y los libres son lo que falta repartir', () => {
    assert.equal(statPointsTotal(1), 10); assert.equal(statPointsTotal(2), 13); assert.equal(statPointsTotal(40), 127);
    const s = defaultStats(); s.str += 4; s.luk += 6;
    assert.equal(statPointsFree(1, s), 0); assert.equal(statPointsFree(5, s), 12);
    assert.equal(statResetCost(10), 0); assert.equal(statResetCost(11), 2200); assert.equal(statResetCost(40), 8000);
});

test('stats: cleanStats recorta lo inválido a enteros entre 10 y el tope', () => {
    const c = cleanStats({ str: 500, vit: -3, dex: 12.9, mag: 'x', luk: NaN });
    assert.deepEqual(c, { str: STAT_CAP, vit: 10, dex: 12, mag: 10, luk: 10 });
    assert.deepEqual(cleanStats(null), defaultStats());
});

test('stats: la vida, el maná, la defensa y el daño del combate salen de los puntos', () => {
    const base = newEcon('guerrero', 'solmar'), con = newEcon('guerrero', 'solmar');
    con.stats = { ...defaultStats(), vit: 30, mag: 25, dex: 20, str: 40 };
    const a = statsFromChar(base), b = statsFromChar(con);
    assert.equal(b.maxHp - a.maxHp, 50 + 20, '20 de Vitalidad (50) + 30 de Fuerza (20)');
    assert.equal(b.maxMp - a.maxMp, 30); assert.equal(b.def - a.def, 5);
    assert.ok(b.meleeMult > 1.05 && b.magicMult > 1.04 && a.meleeMult === 1);
    const rnd = Math.random; Math.random = () => 0.5;
    try {
        const d1 = rollSpellDamage('tajo', { ...a }, false), d2 = rollSpellDamage('tajo', { ...a, meleeMult: 1.5 }, false);
        assert.ok(d2 > d1 && Math.abs(d2 / d1 - 1.5) < 0.05, `físico ${d1} -> ${d2}`);
        const m1 = rollSpellDamage('lanza', { ...a }, false), m2 = rollSpellDamage('lanza', { ...a, magicMult: 1.3 }, false), m3 = rollSpellDamage('lanza', { ...a, meleeMult: 2 }, false);
        assert.ok(m2 > m1 && m3 === m1, 'la Magia sube los hechizos y la Fuerza no los toca');
    } finally { Math.random = rnd; }
});

// ---------- B. repartir y reasignar (todo lo decide el server) ----------
test('repartir: suma puntos, rechaza lo inválido y nunca gasta más de lo que hay', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'ana'), st = J.p.econ!;
    st.lvl = 5; // 10 + 3·4 = 22 puntos
    const add = (stat: string, points: number, action = 'add') => { J.log.length = 0; eco.statAlloc(J.p, ctx(), action, stat, points); return lastResult(J.log)!; };
    assert.equal(statPointsFree(st.lvl, st.stats), 22);
    assert.equal(add('str', 5).ok, true); assert.equal(st.stats.str, 15);
    for (const [stat, pts, code] of [['str', 0, 'bad_points'], ['str', -2, 'bad_points'], ['str', 1.5, 'bad_points'], ['xyz', 1, 'bad_stat'], ['', 1, 'bad_stat'], ['str', 18, 'no_points']] as const) {
        const r = add(stat, pts); assert.equal(r.ok, false, `${stat} ${pts}`); assert.equal(r.code, code, `${stat} ${pts}`);
    }
    assert.equal(add('str', 1, 'otra').code, 'bad_action');
    assert.equal(st.stats.str, 15, 'ningún pedido inválido tocó los stats');
    assert.equal(add('vit', 17).ok, true);
    assert.equal(statPointsFree(st.lvl, st.stats), 0);
    assert.equal(add('mag', 1).code, 'no_points', 'sin puntos libres no se puede sumar');
});

test('repartir: dos pedidos seguidos no pueden gastar el mismo punto dos veces', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'beto'), st = J.p.econ!;
    st.lvl = 5; // 22 libres
    eco.statAlloc(J.p, ctx(), 'add', 'str', 20); eco.statAlloc(J.p, ctx(), 'add', 'vit', 20);
    assert.equal(st.stats.str, 30); assert.equal(st.stats.vit, 10, 'el segundo pedido de 20 no entra: quedaban 2');
    assert.equal(statPointsFree(st.lvl, st.stats), 2);
});

test('repartir: el tope por stat y los muertos', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'carla'), st = J.p.econ!;
    st.lvl = 40; st.stats.luk = STAT_CAP - 2;
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'add', 'luk', 3);
    assert.equal(lastResult(J.log)!.code, 'cap'); assert.equal(st.stats.luk, STAT_CAP - 2);
    eco.statAlloc(J.p, ctx(), 'add', 'luk', 2); assert.equal(st.stats.luk, STAT_CAP);
    J.p.hp = 0; J.log.length = 0; eco.statAlloc(J.p, ctx(), 'add', 'str', 1);
    assert.equal(lastResult(J.log)!.code, 'dead'); assert.equal(st.stats.str, 10);
});

test('repartir por el protocolo: llega el pedido, sube la vida máxima del server y el estado trae los stats', () => {
    const { reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'dani'), st = J.p.econ!;
    st.lvl = 3; const hp0 = statsFromChar(st).maxHp; // vida del nivel 3 sin repartir
    J.log.length = 0;
    w.handleClientPacket(J.session.sessionId, { payload: { $case: 'statAllocRequest', value: { action: 'add', stat: 'vit', points: 4 } } } as never);
    assert.equal(st.stats.vit, 14); assert.equal(J.p.combat.maxHp - hp0, 10, '4 puntos de Vitalidad = 10 de vida');
    const inv = J.log.filter((m) => m.payload?.$case === 'inventoryState').at(-1)!.payload as { value: { statVit: number; statStr: number; statFree: number } };
    assert.equal(inv.value.statVit, 14); assert.equal(inv.value.statStr, 10); assert.equal(inv.value.statFree, statPointsFree(3, st.stats));
});

test('reasignar: gratis hasta el nivel 10; después cuesta oro y sin oro no se hace', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'eli'), st = J.p.econ!;
    st.lvl = 8; st.stats = { ...defaultStats(), str: 20, luk: 15 };
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'reset', '', 0);
    assert.equal(lastResult(J.log)!.ok, true); assert.deepEqual(st.stats, defaultStats());
    st.lvl = 20; st.stats = { ...defaultStats(), str: 30 }; st.gold = 100;
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'reset', '', 0);
    assert.equal(lastResult(J.log)!.code, 'gold'); assert.equal(st.stats.str, 30, 'sin oro no se reasigna');
    st.gold = 5000; eco.statAlloc(J.p, ctx(), 'reset', '', 0);
    assert.deepEqual(st.stats, defaultStats()); assert.equal(st.gold, 5000 - statResetCost(20));
});

test('suerte: más puntos de Suerte, más chance de botín (oro por kill, ±)', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'fede'), st = J.p.econ!;
    const kill: KillInfo = { mobId: 1, type: 'goblin', def: mobDef('goblin', { lvl: 1 }), zoneName: 'prueba', origin: 'pit', x: 0, y: 0 };
    const rate = (luk: number) => {
        st.stats = { ...defaultStats(), luk }; st.lvl = 1; st.exp = 0;
        let hits = 0; const N = 30_000;
        for (let i = 0; i < N; i++) { const g = st.gold; eco.reward(J.p, ctx(), kill); if (st.gold > g) hits++; st.exp = 0; st.bag = []; }
        return hits / N;
    };
    const base = rate(10), alta = rate(STAT_CAP);
    assert.ok(Math.abs(base - 0.45) < 0.02, `base ${base}`);
    assert.ok(alta > base + 0.025, `suerte 100: ${alta} vs ${base}`);
});

// ---------- H. antitrampa ----------
test('antitrampa: el guardado del cliente no puede fijar stats, ni al crear ni después', () => {
    const { mem, reg } = setup(), w = reg.ensure('solmar_legacy');
    const log: ServerMessage[] = [], session = { sessionId: 's-gus', worldId: w.id };
    w.playerConnected(session.sessionId, 'gus', (m) => log.push(m), () => {}, { mapId: w.mapId, worldId: w.mapId, x: 11, y: 11, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true });
    mem.put('acc-gus', { name: 'gus', salt: '', hash: '', created: 0, lastLogin: 0 });
    w.bindAccount(session.sessionId, 'acc-gus');
    w.onClientSave(session.sessionId, JSON.stringify({ cls: 'mago', faction: 'solmar', stats: { str: 100, vit: 100, dex: 100, mag: 100, luk: 100 }, lvl: 40 }));
    const st = w.playerOf(session.sessionId)!.econ!;
    assert.deepEqual(st.stats, defaultStats()); assert.equal(st.lvl, 1);
    w.onClientSave(session.sessionId, JSON.stringify({ cls: 'mago', faction: 'solmar', stats: { str: 100 } }));
    assert.deepEqual(w.playerOf(session.sessionId)!.econ!.stats, defaultStats());
});

// ---------- F. migración ----------
test('migración v3 -> v4: la cuenta sin stats recibe los de arranque y sus puntos libres por nivel', () => {
    const st = newEcon('guerrero', 'solmar'); st.v = 3; st.lvl = 12; delete (st as { stats?: unknown }).stats;
    assert.equal(migrateEcon(st), true);
    assert.deepEqual(st.stats, defaultStats()); assert.equal(st.v, ECON_VERSION);
    assert.equal(statPointsFree(st.lvl, st.stats), 10 + 3 * 11);
    assert.equal(migrateEcon(st), false);
});

test('migración v2 -> v4 en un solo paso: arregla la exp y agrega los stats', () => {
    const st = newEcon('mago', 'vhar'); st.v = 2; st.lvl = 6; st.exp = 100; delete (st as { stats?: unknown }).stats;
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION); assert.deepEqual(st.stats, defaultStats()); assert.equal(st.lvl, 6);
});
