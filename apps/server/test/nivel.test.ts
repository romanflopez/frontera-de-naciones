/** Nivel máximo 40 y curva de exp (docs/PLAN_DE_TRABAJO.md paso 1.1): curvas, multiplicadores, subida de nivel y migración de cuentas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { relevel, MAX_LEVEL, QUESTS, expToLevel, expToLevelV8, expToLevelV13, killsToLevel, legacyExpToLevel, levelExpMult, levelGapMult, mobDef, mobExpCurve, mobHpCurve } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, MAX_LVL, migrateEcon, newEcon, type EconCtx, type KillInfo } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const join = (world: GameWorld, name: string, at: { x: number; y: number }) => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'paladin', faction: 'solmar' }));
        return { session, log, p: world.playerOf(session.sessionId)!, mem };
    };
    return { mem, eco, reg, join };
}
/** Contexto mínimo para llamar a `reward` sin un mundo entero (el botín va al suelo y a la bolsa; acá solo miramos la exp). */
const ctx = (): EconCtx => ({ npcs: [], restat: () => {}, ground: { add: () => {} } as never });
const kill = (type: Parameters<typeof mobDef>[0], lvl: number): KillInfo => ({ mobId: 1, type, def: mobDef(type, { lvl }), zoneName: 'prueba', origin: 'pit', x: 0, y: 0 });

// ---------- A. curvas ----------
test('curva (D.21): killsToLevel con forma de potencia (como la referencia), 3 kills en el nivel 1 y ~6.300 en total hasta el 120 (~30 h al tope, ver sim:pve --horas)', () => {
    assert.equal(killsToLevel(1), 3, 'como en el juego de referencia: el primer nivel sale con un puñado de kills');
    assert.ok(killsToLevel(10) <= 20, 'los primeros niveles son rápidos');
    let total = 0, prev = 0;
    for (let l = 1; l < MAX_LEVEL; l++) { const k = killsToLevel(l); assert.ok(k >= prev, `nivel ${l}`); prev = k; total += k; }
    assert.ok(total > 5_000 && total < 7_500, `kills totales hasta el ${MAX_LEVEL}: ${total}`);
});

test('curva (D.21): la exp por mob crece ~como la vida (exp ∝ vida^1,0-1,15, la proporción del juego de referencia): cazar arriba paga', () => {
    // De p10 a p40 (niveles 28 y 120): en Evolution la exp crece un poco más rápido que la vida (Orc → Dragón: exp ∝ vida^1,07).
    const [l1, l2] = [relevel(10), 120];
    const eHp = Math.log(mobExpCurve(l2) / mobExpCurve(l1)) / Math.log(mobHpCurve(l2) / mobHpCurve(l1));
    assert.ok(eHp > 1.0 && eHp < 1.3, `exp ∝ vida^${eHp.toFixed(2)}`);
});

test('curva: el multiplicador de exp baja en línea recta de 100 % a ~35 % y nunca sube', () => {
    assert.equal(levelExpMult(1), 1);
    assert.equal(levelExpMult(0), 1, 'nivel inválido se trata como 1');
    let prev = 1;
    for (let l = 1; l <= MAX_LEVEL; l++) { const m = levelExpMult(l); assert.ok(m <= prev + 1e-12 && m >= 0.35 && m <= 1, `nivel ${l}`); prev = m; }
    assert.ok(Math.abs(levelExpMult(MAX_LEVEL) - 0.35) < 0.01);
});

test('curva: la exp que pide cada nivel es entera, finita y estrictamente creciente de 1 a 40', () => {
    let prev = 0;
    for (let l = 1; l <= MAX_LEVEL; l++) {
        const e = expToLevel(l);
        assert.ok(Number.isInteger(e) && Number.isFinite(e) && e > prev, `nivel ${l}: ${e} <= ${prev}`);
        prev = e;
    }
    assert.ok(expToLevel(1) < legacyExpToLevel(1), 'los primeros niveles son más fáciles que antes');
});

test('regla de diferencia de nivel: igual o hasta +5 paga entero; más arriba baja; muy por debajo no paga', () => {
    assert.equal(levelGapMult(10, 10), 1);
    assert.equal(levelGapMult(10, 15), 1, 'hasta 5 niveles arriba paga entero');
    const R = relevel; // la regla mide la diferencia en nivel de poder (escala vieja), así que con los niveles nuevos vale lo mismo que antes
    assert.equal(levelGapMult(R(10), R(10)), 1);
    assert.equal(levelGapMult(R(10), R(14)), 1, 'hasta 5 niveles arriba paga entero');
    assert.ok(Math.abs(levelGapMult(R(10), R(16)) - 0.9) < 0.06);
    assert.ok(Math.abs(levelGapMult(1, R(12)) - 0.4) < 0.06, 'gap 11');
    assert.equal(levelGapMult(1, 120), 0.1, 'mínimo 10 %');
    assert.equal(levelGapMult(R(30), R(11)), 1, '19 niveles abajo todavía paga');
    assert.equal(levelGapMult(R(30), R(9) - 3), 0, 'más de 20 niveles abajo no paga');
    assert.equal(levelGapMult(120, 1), 0);
});

// ---------- B. exp, subida de nivel y tope ----------
test('matar mobs del propio nivel: la cantidad de kills para subir coincide con la curva (±10 %)', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'ana', { x: 11, y: 11 }), st = J.p.econ!;
    for (const [lvl, type] of [[1, 'goblin'], [relevel(3), 'zombie'], [relevel(5), 'skeleton'], [relevel(7), 'wyvern']] as const) {
        st.lvl = lvl; st.exp = 0;
        let kills = 0; while (st.lvl === lvl && kills < 5000) { eco.reward(J.p, ctx(), kill(type, lvl)); kills++; }
        const want = killsToLevel(lvl);
        assert.ok(Math.abs(kills - want) / want <= 0.1, `nivel ${lvl}: ${kills} kills, esperado ~${want}`);
    }
});

test('un golpe grande cruza varios niveles de una vez y nunca pasa del 40', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'beto', { x: 11, y: 11 }), st = J.p.econ!;
    st.lvl = 1; st.exp = expToLevel(1) + expToLevel(2) + expToLevel(3) + 5;
    (eco as any).touch(J.p);
    eco.reward(J.p, ctx(), kill('goblin', 1));
    assert.ok(st.lvl >= 4, `subió a ${st.lvl}`);
    st.lvl = MAX_LVL; st.exp = 0;
    for (let i = 0; i < 20; i++) eco.reward(J.p, ctx(), kill('goblin', MAX_LVL));
    assert.equal(st.lvl, MAX_LVL);
    st.exp = 10 ** 9; eco.reward(J.p, ctx(), kill('goblin', MAX_LVL));
    assert.equal(st.lvl, MAX_LVL, 'el tope se respeta aunque sobre exp');
    assert.ok(st.exp < expToLevel(MAX_LVL), 'la exp sobrante en el tope no queda guardada sin límite');
});

test('mobs muy por debajo del jugador dan 0 de exp y los muy por encima dan menos', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'carla', { x: 11, y: 11 }), st = J.p.econ!;
    st.lvl = MAX_LEVEL; st.exp = 0;
    eco.reward(J.p, ctx(), kill('goblin', 1));
    assert.equal(st.exp, 0, 'nivel 120 matando un mob de nivel 1');
    st.lvl = relevel(3); st.exp = 0;
    const base = mobDef('antlion', { lvl: relevel(4) }).exp * levelExpMult(relevel(3));
    eco.reward(J.p, ctx(), kill('antlion', relevel(4)));
    assert.ok(Math.abs(st.exp - Math.max(1, Math.round(base))) <= 1, 'un mob apenas por encima paga entero');
    st.exp = 0;
    eco.reward(J.p, ctx(), kill('antlion', relevel(20)));
    const llevado = st.exp, entero = Math.round(mobDef('antlion', { lvl: relevel(20) }).exp * levelExpMult(relevel(3)));
    assert.ok(llevado < entero * 0.5, `un nivel 3 en una zona de nivel 20 cobra ${llevado} de ${entero}`);
});

test('la exp de las misiones pesa lo mismo que antes sobre la curva (±1 %)', () => {
    const lv: Record<string, number> = { 'Campamento goblin': 1, 'Avanzada goblin': 2, 'Hoyos de hormiga león': 4, 'Pantano muerto': 3, 'Cementerio viejo': 5, 'Ruinas del nigromante': 5, 'Hormiguero ardiente': 6, 'Nidal de ceniza': 7, 'Osario ardiente': 8, 'Cantera del minotauro': 9 };
    const antes = [70, 120, 190, 260, 420, 520, 700, 950, 1150, 1700];
    QUESTS.forEach((q, i) => {
        const l = lv[q.zone], pctAntes = antes[i] / legacyExpToLevel(l), pctAhora = q.xp / expToLevel(relevel(l));
        assert.ok(Math.abs(pctAhora - pctAntes) <= 0.01, `${q.name}: ${(pctAntes * 100).toFixed(1)} % antes, ${(pctAhora * 100).toFixed(1)} % ahora`);
    });
});

// ---------- F. migración ----------
test('migración v2 -> v3: conserva la fracción de progreso del nivel y no regala niveles', () => {
    const st = newEcon('paladin', 'solmar');
    st.v = 2; st.lvl = 5; st.exp = Math.round(legacyExpToLevel(5) * 0.5);
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION); assert.equal(st.lvl, 5);
    assert.ok(Math.abs(st.exp / expToLevel(5) - 0.5) < 0.01, `fracción ${(st.exp / expToLevel(5)).toFixed(3)}`);
    assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
});

test('F: migración v8 -> v9 (D.1): la curva de 30 h conserva la fracción de progreso del nivel', () => {
    for (const [lvl, frac] of [[10, 0.5], [60, 0.8], [119, 0.1]] as const) {
        const st = newEcon('paladin', 'solmar');
        st.v = 8; st.lvl = lvl; st.exp = Math.round(expToLevelV8(lvl) * frac); st.gold = 321;
        assert.equal(migrateEcon(st), true);
        assert.equal(st.v, ECON_VERSION); assert.equal(st.lvl, lvl); assert.equal(st.gold, 321);
        assert.ok(Math.abs(st.exp / expToLevel(lvl) - frac) < 0.01, `nivel ${lvl}: fracción ${(st.exp / expToLevel(lvl)).toFixed(3)}`);
        assert.ok(st.exp < expToLevel(lvl), 'no sube de nivel sola');
        assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
    }
    assert.ok(expToLevelV8(60) > expToLevelV13(60) * 3, 'la curva de 30 h pedía bastante menos que la de 60 h');
});

test('F: migración v13 -> v14 (D.21): la curva nueva conserva la fracción de progreso del nivel', () => {
    for (const [lvl, frac] of [[1, 0.5], [10, 0.5], [60, 0.8], [119, 0.1]] as const) {
        const st = newEcon('paladin', 'solmar');
        st.v = 13; st.lvl = lvl; st.exp = Math.round(expToLevelV13(lvl) * frac); st.gold = 321;
        assert.equal(migrateEcon(st), true);
        assert.equal(st.v, ECON_VERSION); assert.equal(st.lvl, lvl); assert.equal(st.gold, 321);
        assert.ok(Math.abs(st.exp / expToLevel(lvl) - frac) < 0.02, `nivel ${lvl}: fracción ${(st.exp / expToLevel(lvl)).toFixed(3)}`);
        assert.ok(st.exp < expToLevel(lvl), 'no sube de nivel sola');
        assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
    }
});

test('migración: un nivel por encima del tope se recorta al tope (120) con exp 0, y la exp casi llena no sube de nivel sola', () => {
    const a = newEcon('mago', 'vhar'); a.v = 2; a.lvl = 150; a.exp = 123456;
    assert.equal(migrateEcon(a), true); assert.equal(a.lvl, MAX_LVL); assert.equal(a.exp, 0);
    const b = newEcon('mago', 'vhar'); b.v = 2; b.lvl = 8; b.exp = legacyExpToLevel(8) - 1;
    migrateEcon(b); assert.equal(b.lvl, 8); assert.ok(b.exp < expToLevel(8));
});

test('migración al cargar la cuenta: una cuenta guardada en v2 se migra y se vuelve a guardar', () => {
    const { mem, eco } = setup();
    const old = newEcon('paladin', 'solmar'); old.v = 2; old.lvl = 7; old.exp = Math.round(legacyExpToLevel(7) * 0.25);
    mem.put('acc-vieja', { name: 'vieja', salt: '', hash: '', created: 0, lastLogin: 0, econ: old });
    const st = eco.load('acc-vieja')!;
    assert.equal(st.v, ECON_VERSION); assert.ok(Math.abs(st.exp / expToLevel(7) - 0.25) < 0.01);
    assert.equal(mem.get('acc-vieja')!.econ!.v, ECON_VERSION, 'quedó guardada ya migrada');
});
