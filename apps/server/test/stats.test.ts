/** Puntos de stats (docs/PLAN_DE_TRABAJO.md paso 1.2): fórmulas, repartir y reasignar con validación del server, efectos en el combate y migración. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { STAT_CAP, STAT_IDS, classBaseHp, cleanStats, defaultStats, mobDef, statBonus, statTip, statPointsFree, statPointsTotal, statResetCost } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { DROPS } from '../src/drops.ts';
import { ECON_VERSION, Economy, migrateEcon, newEcon, type EconCtx, type KillInfo } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { rollSpellDamage, statsFromChar } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const join = (world: GameWorld, name: string, cls = 'paladin') => {
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
    const b0 = statBonus(defaultStats(), 1250);
    assert.deepEqual(b0, { hp: 0, mp: 0, def: 0, meleeMult: 1, magicMult: 1 });
    assert.equal(statBonus(undefined).hp, 0, 'cuenta sin stats = sin bonus');
    const s = defaultStats(); s.vit += 10; s.str += 30; s.mag += 20; s.dex += 20;
    const b = statBonus(s, 1250); // la Vitalidad vale +0,2 % de la vida base de la clase por punto
    assert.equal(b.hp, 25 + 20, '10 de Vitalidad sobre 1250 de base = 25, y 30 de Fuerza = 20 de vida');
    assert.equal(b.mp, 40); assert.equal(b.def, 10);
    assert.ok(Math.abs(b.meleeMult - 1.06) < 1e-9 && Math.abs(b.magicMult - 1.06) < 1e-9);
});

test('stats: los puntos salen del nivel (10 al crear + 3 por nivel) y los libres son lo que falta repartir', () => {
    assert.equal(statPointsTotal(1), 10); assert.equal(statPointsTotal(2), 13); assert.equal(statPointsTotal(40), 127);
    const s = defaultStats(); s.str += 4; s.mag += 6;
    assert.equal(statPointsFree(1, s), 0); assert.equal(statPointsFree(5, s), 12);
    assert.equal(statResetCost(10), 0); assert.equal(statResetCost(11), 2200); assert.equal(statResetCost(40), 8000);
});

test('stats: cleanStats recorta lo inválido a enteros entre 10 y el tope', () => {
    const c = cleanStats({ str: 500, vit: -3, dex: 12.9, mag: 'x', luk: 90, int: 80 }); // luk e int ya no existen: se descartan y los puntos vuelven solos
    assert.deepEqual(c, { str: STAT_CAP, vit: 10, dex: 12, mag: 10 });
    assert.deepEqual(cleanStats(null), defaultStats());
});

test('stats: la vida, el maná, la defensa y el daño del combate salen de los puntos', () => {
    const base = newEcon('paladin', 'solmar'), con = newEcon('paladin', 'solmar');
    con.stats = { ...defaultStats(), vit: 30, mag: 25, dex: 20, str: 40 };
    const a = statsFromChar(base), b = statsFromChar(con);
    const vitHp = Math.round(0.002 * 593 * 20); // nivel 1: vida base 593
    assert.equal(b.maxHp - a.maxHp, vitHp + 20, `20 de Vitalidad (${vitHp}) + 30 de Fuerza (20)`);
    assert.equal(b.maxMp - a.maxMp, 30); assert.equal(b.def - a.def, 5);
    assert.ok(b.meleeMult > 1.05 && b.magicMult > 1.04 && a.meleeMult === 1);
    const rnd = Math.random; Math.random = () => 0.5;
    try {
        const d1 = rollSpellDamage('golpe', { ...a }, false), d2 = rollSpellDamage('golpe', { ...a, meleeMult: 1.5 }, false);
        assert.ok(d2 > d1 && Math.abs(d2 / d1 - 1.5) < 0.05, `físico ${d1} -> ${d2}`);
        const m1 = rollSpellDamage('bola', { ...a }, false), m2 = rollSpellDamage('bola', { ...a, magicMult: 1.3 }, false), m3 = rollSpellDamage('bola', { ...a, meleeMult: 2 }, false);
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
    st.lvl = 120; st.stats.dex = STAT_CAP - 2; // con tope 200 hace falta nivel alto para tener los puntos
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'add', 'dex', 3);
    assert.equal(lastResult(J.log)!.code, 'cap'); assert.equal(st.stats.dex, STAT_CAP - 2);
    eco.statAlloc(J.p, ctx(), 'add', 'dex', 2); assert.equal(st.stats.dex, STAT_CAP);
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'add', 'luk', 2);
    assert.equal(lastResult(J.log)!.ok, false, 'la Suerte ya no existe');
    J.p.hp = 0; J.log.length = 0; eco.statAlloc(J.p, ctx(), 'add', 'str', 1);
    assert.equal(lastResult(J.log)!.code, 'dead'); assert.equal(st.stats.str, 10);
});

test('repartir por el protocolo: llega el pedido, sube la vida máxima del server y el estado trae los stats', () => {
    const { reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'dani'), st = J.p.econ!;
    st.lvl = 3; const hp0 = statsFromChar(st).maxHp; // vida del nivel 3 sin repartir
    J.log.length = 0;
    w.handleClientPacket(J.session.sessionId, { payload: { $case: 'statAllocRequest', value: { action: 'add', stat: 'vit', points: 4 } } } as never);
    const baseHp3 = classBaseHp('paladin', 3); // vida base del paladín a nivel 3
    assert.equal(st.stats.vit, 14); assert.equal(J.p.combat.maxHp - hp0, Math.round(0.002 * baseHp3 * 4), '4 puntos de Vitalidad = +0,8 % de la vida base');
    const inv = J.log.filter((m) => m.payload?.$case === 'inventoryState').at(-1)!.payload as { value: { statVit: number; statStr: number; statFree: number } };
    assert.equal(inv.value.statVit, 14); assert.equal(inv.value.statStr, 10); assert.equal(inv.value.statFree, statPointsFree(3, st.stats));
});

test('reasignar: gratis hasta el nivel 10; después cuesta oro y sin oro no se hace', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'eli'), st = J.p.econ!;
    st.lvl = 8; st.stats = { ...defaultStats(), str: 20, dex: 15 };
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'reset', '', 0);
    assert.equal(lastResult(J.log)!.ok, true); assert.deepEqual(st.stats, defaultStats());
    st.lvl = 20; st.stats = { ...defaultStats(), str: 30 }; st.gold = 100;
    J.log.length = 0; eco.statAlloc(J.p, ctx(), 'reset', '', 0);
    assert.equal(lastResult(J.log)!.code, 'gold'); assert.equal(st.stats.str, 30, 'sin oro no se reasigna');
    st.gold = 5000; eco.statAlloc(J.p, ctx(), 'reset', '', 0);
    assert.deepEqual(st.stats, defaultStats()); assert.equal(st.gold, 5000 - statResetCost(20));
});

test('botín: la chance de oro por kill es la de diseño y no depende de los stats', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'fede'), st = J.p.econ!;
    const kill: KillInfo = { mobId: 1, type: 'goblin', def: mobDef('goblin', { lvl: 1 }), zoneName: 'prueba', origin: 'pit', x: 0, y: 0 };
    st.stats = { ...defaultStats(), str: STAT_CAP }; st.lvl = 1;
    let hits = 0; const N = 30_000;
    for (let i = 0; i < N; i++) { const g = st.gold; eco.reward(J.p, ctx(), kill); if (st.gold > g) hits++; st.exp = 0; st.bag = []; }
    const rate = hits / N;
    assert.ok(Math.abs(rate - DROPS.goldChance) < 0.02, `oro por kill ${rate} (diseño: ${DROPS.goldChance * 100} %)`);
});

// ---------- H. antitrampa ----------
test('antitrampa: el guardado del cliente no puede fijar stats, ni al crear ni después', () => {
    const { mem, reg } = setup(), w = reg.ensure('solmar_legacy');
    const log: ServerMessage[] = [], session = { sessionId: 's-gus', worldId: w.id };
    w.playerConnected(session.sessionId, 'gus', (m) => log.push(m), () => {}, { mapId: w.mapId, worldId: w.mapId, x: 11, y: 11, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true });
    mem.put('acc-gus', { name: 'gus', salt: '', hash: '', created: 0, lastLogin: 0 });
    w.bindAccount(session.sessionId, 'acc-gus');
    w.onClientSave(session.sessionId, JSON.stringify({ cls: 'mago', faction: 'solmar', stats: { str: 100, vit: 100, dex: 100, mag: 100 }, lvl: 40 }));
    const st = w.playerOf(session.sessionId)!.econ!;
    assert.deepEqual(st.stats, defaultStats()); assert.equal(st.lvl, 1);
    w.onClientSave(session.sessionId, JSON.stringify({ cls: 'mago', faction: 'solmar', stats: { str: 100 } }));
    assert.deepEqual(w.playerOf(session.sessionId)!.econ!.stats, defaultStats());
});

// ---------- F. migración ----------
test('migración v3 -> v4: la cuenta sin stats recibe los de arranque y sus puntos libres por nivel', () => {
    const st = newEcon('paladin', 'solmar'); st.v = 3; st.lvl = 12; delete (st as { stats?: unknown }).stats;
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

// ---------- tooltip de stats por clase ----------
test('stats: el tooltip usa los números de la clase y del nivel, y avisa qué stat no le sirve', () => {
    const base = defaultStats();
    const vit = statTip('vit', 'paladin', 11, base), hp11 = classBaseHp('paladin', 11); // vida base del paladín a nivel 11 (escala de nivel de poder)
    assert.match(vit.perPoint, new RegExp(`\\+${(hp11 * 0.002).toFixed(1).replace('.', ',')} de vida`)); assert.match(vit.perPoint, new RegExp(String(hp11))); assert.equal(vit.now, '', 'sin puntos no hay "con tus puntos"');
    const s = { ...base, str: 30, dex: 30, mag: 20 };
    assert.equal(statTip('str', 'paladin', 5, s).fit, 'clave'); assert.equal(statTip('str', 'mago', 5, s).fit, 'bajo'); assert.equal(statTip('str', 'clerigo', 5, s).fit, 'bajo');
    assert.equal(statTip('mag', 'mago', 5, s).fit, 'clave'); assert.equal(statTip('mag', 'clerigo', 5, s).fit, 'clave'); assert.equal(statTip('mag', 'paladin', 5, s).fit, 'bajo');
    // los números del tooltip son los de statBonus (los que aplica el server)
    const b = statBonus(s, classBaseHp('paladin', 5));
    assert.equal(statTip('str', 'paladin', 5, s).now, `+${(b.meleeMult - 1) * 100 | 0} % de daño, +${b.hp} de vida`);
    assert.match(statTip('dex', 'paladin', 5, s).now, new RegExp(`\\+${b.def} de defensa`));
    assert.match(statTip('mag', 'mago', 5, s).now, new RegExp(`\\+${b.mp} de maná`));
    assert.equal(statTip('vit', 'clase_rara', 1, base).fit, 'clave', 'clase desconocida cae al paladín, como classBaseHp');
});

test('D.3: son 4 stats (sin Inteligencia) y el crítico mágico no existe', () => {
    assert.deepEqual([...STAT_IDS], ['str', 'vit', 'dex', 'mag']);
    assert.equal('int' in defaultStats(), false);
    assert.equal('critMag' in statBonus(defaultStats(), 1000), false);
    for (const id of STAT_IDS) for (const cls of ['paladin', 'mago', 'clerigo']) assert.ok(statTip(id, cls, 20, defaultStats()).perPoint.length > 0);
    // un hechizo de daño ya no tiene tirada de crítico: mismo rango siempre
    const base = statsFromChar({ lvl: 20, cls: 'mago', eq: {} }), tope = Math.max(...Array.from({ length: 300 }, () => rollSpellDamage('bola', base, false)));
    assert.ok(tope < Math.min(...Array.from({ length: 300 }, () => rollSpellDamage('bola', base, false))) * 1.5, 'sin crítico mágico, los golpes no se disparan');
});

test('F: una cuenta v7 con puntos en Inteligencia los recupera como libres y no pierde nada más', () => {
    const st = newEcon('mago', 'solmar');
    st.v = 7; st.lvl = 20; st.gold = 555;
    st.stats = { str: 10, vit: 25, dex: 10, mag: 40, int: 50 } as never;
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION);
    assert.equal('int' in st.stats, false, 'la clave vieja se descarta');
    assert.deepEqual(st.stats, { str: 10, vit: 25, dex: 10, mag: 40 });
    assert.equal(statPointsFree(st.lvl, st.stats), statPointsTotal(20) - 45, 'los 40 puntos de Inteligencia vuelven a libres');
    assert.equal(st.gold, 555);
    assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
});
