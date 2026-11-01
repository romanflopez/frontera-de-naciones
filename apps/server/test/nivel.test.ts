/** Nivel máximo 40 y curva de exp (docs/PLAN_DE_TRABAJO.md paso 1.1): curvas, multiplicadores, subida de nivel y migración de cuentas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { MAX_LEVEL, QUESTS, expToLevel, killsToLevel, legacyExpToLevel, levelExpMult, levelGapMult, mobDef } from '@fdn/world';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, MAX_LVL, migrateEcon, newEcon, type EconCtx, type KillInfo } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';

const settings = loadSettings(), catalogs = loadCatalogs();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const join = (world: GameWorld, name: string, at: { x: number; y: number }) => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
        return { session, log, p: world.playerOf(session.sessionId)!, mem };
    };
    return { mem, eco, reg, join };
}
/** Contexto mínimo para llamar a `reward` sin un mundo entero (el botín va al suelo y a la bolsa; acá solo miramos la exp). */
const ctx = (): EconCtx => ({ npcs: [], restat: () => {}, ground: { add: () => {} } as never });
const kill = (type: Parameters<typeof mobDef>[0], lvl: number): KillInfo => ({ mobId: 1, type, def: mobDef(type, { lvl }), zoneName: 'prueba', origin: 'pit', x: 0, y: 0 });

// ---------- A. curvas ----------
test('curva: killsToLevel crece, 11 kills en el nivel 1 y ~10.600 en total hasta el 40', () => {
    assert.equal(killsToLevel(1), 11);
    assert.equal(killsToLevel(10), 120);
    assert.ok(Math.abs(killsToLevel(30) - 420) <= 5 && Math.abs(killsToLevel(39) - 581) <= 5);
    let total = 0, prev = 0;
    for (let l = 1; l < MAX_LEVEL; l++) { const k = killsToLevel(l); assert.ok(k > prev, `nivel ${l}`); prev = k; total += k; }
    assert.ok(total > 10_000 && total < 11_500, `kills totales ${total}`);
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
    assert.ok(Math.abs(levelGapMult(10, 16) - 0.9) < 1e-9);
    assert.ok(Math.abs(levelGapMult(1, 12) - 0.4) < 1e-9, 'gap 11');
    assert.equal(levelGapMult(1, 100), 0.1, 'mínimo 10 %');
    assert.equal(levelGapMult(30, 10), 1, '20 niveles abajo todavía paga');
    assert.equal(levelGapMult(30, 9), 0, '21 niveles abajo no paga');
    assert.equal(levelGapMult(40, 1), 0);
});

// ---------- B. exp, subida de nivel y tope ----------
test('matar mobs del propio nivel: la cantidad de kills para subir coincide con la curva (±10 %)', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'ana', { x: 11, y: 11 }), st = J.p.econ!;
    for (const [lvl, type] of [[1, 'goblin'], [3, 'zombie'], [5, 'skeleton'], [7, 'wyvern']] as const) {
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
    st.lvl = 40; st.exp = 0;
    eco.reward(J.p, ctx(), kill('goblin', 1));
    assert.equal(st.exp, 0, 'nivel 40 matando un mob de nivel 1');
    st.lvl = 3; st.exp = 0;
    const base = mobDef('antlion', { lvl: 4 }).exp * levelExpMult(3);
    eco.reward(J.p, ctx(), kill('antlion', 4));
    assert.ok(Math.abs(st.exp - Math.max(1, Math.round(base))) <= 1, 'un mob apenas por encima paga entero');
    st.exp = 0;
    eco.reward(J.p, ctx(), kill('antlion', 20));
    const llevado = st.exp, entero = Math.round(mobDef('antlion', { lvl: 20 }).exp * levelExpMult(3));
    assert.ok(llevado < entero * 0.5, `un nivel 3 en una zona de nivel 20 cobra ${llevado} de ${entero}`);
});

test('la exp de las misiones pesa lo mismo que antes sobre la curva (±1 %)', () => {
    const lv: Record<string, number> = { 'Campamento goblin': 1, 'Avanzada goblin': 2, 'Hoyos de hormiga león': 4, 'Pantano muerto': 3, 'Cementerio viejo': 5, 'Ruinas del nigromante': 5, 'Hormiguero ardiente': 6, 'Nidal de ceniza': 7, 'Osario ardiente': 8, 'Cantera del minotauro': 9 };
    const antes = [70, 120, 190, 260, 420, 520, 700, 950, 1150, 1700];
    QUESTS.forEach((q, i) => {
        const l = lv[q.zone], pctAntes = antes[i] / legacyExpToLevel(l), pctAhora = q.xp / expToLevel(l);
        assert.ok(Math.abs(pctAhora - pctAntes) <= 0.01, `${q.name}: ${(pctAntes * 100).toFixed(1)} % antes, ${(pctAhora * 100).toFixed(1)} % ahora`);
    });
});

// ---------- F. migración ----------
test('migración v2 -> v3: conserva la fracción de progreso del nivel y no regala niveles', () => {
    const st = newEcon('guerrero', 'solmar');
    st.v = 2; st.lvl = 5; st.exp = Math.round(legacyExpToLevel(5) * 0.5);
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION); assert.equal(st.lvl, 5);
    assert.ok(Math.abs(st.exp / expToLevel(5) - 0.5) < 0.01, `fracción ${(st.exp / expToLevel(5)).toFixed(3)}`);
    assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
});

test('migración: un nivel por encima del tope se recorta a 40 con exp 0, y la exp casi llena no sube de nivel sola', () => {
    const a = newEcon('mago', 'vhar'); a.v = 2; a.lvl = 55; a.exp = 123456;
    assert.equal(migrateEcon(a), true); assert.equal(a.lvl, MAX_LVL); assert.equal(a.exp, 0);
    const b = newEcon('mago', 'vhar'); b.v = 2; b.lvl = 8; b.exp = legacyExpToLevel(8) - 1;
    migrateEcon(b); assert.equal(b.lvl, 8); assert.ok(b.exp < expToLevel(8));
});

test('migración al cargar la cuenta: una cuenta guardada en v2 se migra y se vuelve a guardar', () => {
    const { mem, eco } = setup();
    const old = newEcon('guerrero', 'solmar'); old.v = 2; old.lvl = 7; old.exp = Math.round(legacyExpToLevel(7) * 0.25);
    mem.put('acc-vieja', { name: 'vieja', salt: '', hash: '', created: 0, lastLogin: 0, econ: old });
    const st = eco.load('acc-vieja')!;
    assert.equal(st.v, ECON_VERSION); assert.ok(Math.abs(st.exp / expToLevel(7) - 0.25) < 0.01);
    assert.equal(mem.get('acc-vieja')!.econ!.v, ECON_VERSION, 'quedó guardada ya migrada');
});
