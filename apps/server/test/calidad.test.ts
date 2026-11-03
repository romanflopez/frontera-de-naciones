/**
 * Calidad de ítems (docs/ITEMS.md y claude/modelo-de-items-y-stats.md): la calidad se sortea al caer y define
 * cuántos extras trae el ítem y hasta dónde se mejora; topes de DF/RM por atributos; migración v5; venta de basura.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { COMBAT_CAP, EXTRAS_BY_QUALITY, JUNK_MATS, UNIQUE_BASES, UP_MAX_BY_QUALITY, rollExtras, type AttrId } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, bossQuality, migrateEcon, newEcon, rollQuality, uniqueItem, type EconCtx } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { statsFromChar } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
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
const ctx = (npcs: { id: string; x: number; y: number }[] = []): EconCtx => ({ npcs, restat: () => {}, ground: { add: () => {} } as never } as unknown as EconCtx);
const lastResult = (log: ServerMessage[]) => { const r = log.filter((m) => m.payload?.$case === 'econResult').at(-1)?.payload as { value: { ok: boolean; code: string; text: string } } | undefined; return r?.value; };

// ---------- sorteo de calidad ----------
test('rollQuality y bossQuality: siempre dentro de la escalera', () => {
    for (let i = 0; i < 500; i++) {
        assert.ok([1, 2].includes(rollQuality('pit')));
        assert.ok([1, 2].includes(rollQuality('loose')));
        assert.ok([1, 2].includes(rollQuality('dungeon')));
        assert.ok([2, 3].includes(bossQuality(1))); assert.ok([2, 3].includes(bossQuality(2)));
        assert.ok([3, 4].includes(bossQuality(3))); assert.ok([3, 4].includes(bossQuality(5)));
        assert.equal(bossQuality(6), 4);
    }
});

test('rollExtras: cantidad por calidad, sin repetidos y sin pisar los fijos; nunca exp', () => {
    for (let q = 0; q <= 4; q++) {
        for (let i = 0; i < 200; i++) {
            const ex = rollExtras('arma', 20, q, ['crit', 'aspd']);
            assert.equal(ex.length, EXTRAS_BY_QUALITY[q]);
            const ids = ex.map(([id]) => id);
            assert.equal(new Set(ids).size, ids.length);
            for (const id of ids) assert.ok(!['crit', 'aspd', 'exp'].includes(id), `extra ${id}`);
            for (const [, v] of ex) assert.ok(v >= 1);
        }
    }
});

test('los extras escalan con el ilvl y con la ranura', () => {
    // mismo stat, mismo roll esperado en promedio: ilvl 40 > ilvl 5, arma (1×) > anillo (0,5×)
    const avg = (slot: 'arma' | 'anillo', ilvl: number): number => {
        let s = 0, n = 0;
        for (let i = 0; i < 400; i++) for (const [id, v] of rollExtras(slot, ilvl, 2)) if (id === 'hp') { s += v; n++; }
        return s / Math.max(1, n);
    };
    assert.ok(avg('arma', 40) > avg('arma', 5) * 2.5, 'ilvl escala');
    assert.ok(avg('arma', 40) > avg('anillo', 40) * 1.5, 'ranura escala');
});

// ---------- topes de DF y RM por atributos ----------
test('la DF y la RM que vienen de atributos se topean; la base de la armadura no', () => {
    const eq = {
        armadura: { n: 'Armadura de placas', a: [{ id: 'df', v: 300 }] }, // base def 34, rm 12
        anillo: { n: 'Anillo opaco', a: [{ id: 'rm', v: 300 }] }, // base rm 8
    };
    const s = statsFromChar({ lvl: 40, cls: 'guerrero', eq } as never);
    assert.equal(s.def, 34 + COMBAT_CAP.df);
    assert.equal(s.rm, 12 + 8 + COMBAT_CAP.rm);
});

// ---------- mejora: tope por calidad y zona de riesgo ----------
test('mejora: un Verde solo llega a +3; a +6 o más el fallo baja un nivel', () => {
    const { eco, reg, join } = setup();
    const world = reg.ensure('solmar_legacy');
    const { p, log } = join(world, 'Mejorador');
    const st = p.econ!, cx = ctx([{ id: 'armero_s', x: 11, y: 11 }]);
    const verde = uniqueItem(st, UNIQUE_BASES.find((u) => !u.uniq.boss)!, 1);
    verde.up = UP_MAX_BY_QUALITY[1]; st.bag.push(verde);
    st.forge = 999; st.gold = 999_999;
    eco.upgrade(p, cx, 'armero_s', verde.u);
    assert.equal(lastResult(log)?.code, 'max');
    // Violeta en +6: con el dado en contra, baja a +5; con el dado a favor, sube a +7
    const vio = uniqueItem(st, UNIQUE_BASES.find((u) => u.uniq.boss)!, 4);
    vio.up = 6; st.bag.push(vio);
    const rnd = Math.random;
    try {
        Math.random = () => 0.999; eco.upgrade(p, cx, 'armero_s', vio.u);
        assert.equal(vio.up, 5, 'el fallo en la zona de riesgo baja un nivel');
        vio.up = 6;
        Math.random = () => 0; eco.upgrade(p, cx, 'armero_s', vio.u);
        assert.equal(vio.up, 7, 'el éxito sube normal');
    } finally { Math.random = rnd; }
});

// ---------- migración v5 ----------
test('migración v5: únicos de banda → Azul, de jefe → Violeta, botín viejo → Común sin atributos', () => {
    const st = newEcon('guerrero', 'solmar');
    const band = uniqueItem(st, UNIQUE_BASES.find((u) => !u.uniq.boss)!, 2), boss = uniqueItem(st, UNIQUE_BASES.find((u) => u.uniq.boss)!, 4);
    band.r = 2; band.a = band.a.slice(0, 2); boss.r = 3; boss.a = boss.a.slice(0, 2); // como se guardaban antes (sin extras)
    const viejo = { u: st.nextUid++, n: 'Espada corta', r: 3, a: [{ id: 'crit' as AttrId, v: 90 }] };
    st.bag.push(band, boss, viejo); st.v = 4;
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION);
    assert.equal(band.r, 2); assert.equal(boss.r, 4);
    assert.equal(viejo.r, 0); assert.equal(viejo.a.length, 0);
});

// ---------- vender basura ----------
test('vender basura (uid 0): paga el valor de JUNK_MATS y no toca los materiales de llaves', () => {
    const { eco, reg, join } = setup();
    const world = reg.ensure('solmar_legacy');
    const { p, log } = join(world, 'Vendedor');
    const st = p.econ!, cx = ctx([{ id: 'mercader_s', x: 11, y: 11 }]);
    st.mats = { goblin_ear: 5, colmillo: 3, trophy_goblin: 2 };
    const gold0 = st.gold;
    eco.sell(p, cx, 'mercader_s', 0);
    assert.equal(lastResult(log)?.ok, true);
    assert.equal(st.gold, gold0 + 5 * JUNK_MATS.goblin_ear.value + 2 * 3);
    assert.equal(st.mats.goblin_ear, undefined); assert.equal(st.mats.trophy_goblin, undefined);
    assert.equal(st.mats.colmillo, 3, 'los materiales de misiones/llaves quedan');
    eco.sell(p, cx, 'mercader_s', 0);
    assert.equal(lastResult(log)?.code, 'no_junk');
});
