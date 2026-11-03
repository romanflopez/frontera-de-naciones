/**
 * Calidad de ítems (docs/ITEMS.md y claude/modelo-de-items-y-stats.md): la calidad se sortea al caer y define
 * cuántos extras trae el ítem y hasta dónde se mejora; topes de DF/RM por atributos; migración v5; venta de basura.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { BASE_BY_NAME, COMBAT_CAP, EXTRAS_BY_QUALITY, JUNK_MATS, QUALITY_NAMES, UNIQUE_BASES, UP_MAX_BY_QUALITY, rollExtras, type AttrId } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { BOSS_LADDER, ECON_VERSION, Economy, bossQuality, migrateEcon, newEcon, rollQuality, uniqueItem, type EconCtx } from '../src/economy.ts';
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
test('rollQuality y bossQuality: siempre dentro de la escalera (Común < Verde < Azul < Violeta < Dorado)', () => {
    assert.deepEqual(QUALITY_NAMES, ['Común', 'Verde', 'Azul', 'Violeta', 'Dorado']);
    const ladder: [Parameters<typeof bossQuality>[0], number, number][] = [['goblin_jefe', 2, 3], ['antlion_reina', 2, 3], ['caballero_cripta', 3, 4], ['mago_mayor', 3, 4], ['wyvern_aire', 3, 4], ['demonio_foso', 3, 4], ['verdugo', 3, 4]];
    for (let i = 0; i < 500; i++) {
        for (const o of ['pit', 'loose', 'dungeon'] as const) assert.ok([1, 2].includes(rollQuality(o)), 'los mobs comunes solo dan Verde o Azul');
        for (const [b, lo, hi] of ladder) { const q = bossQuality(b); assert.ok(q >= lo && q <= hi, `${b}: ${q}`); }
    }
    // la chance del escalón de arriba crece de mazmorra en mazmorra
    const chances = ladder.map(([b]) => BOSS_LADDER[b]![1]);
    const d3to7 = chances.slice(2); assert.deepEqual([...d3to7].sort((a, b) => a - b), d3to7, 'D3-D7 crecen');
    // el Dorado (calidad máxima) es de jefes de D3 en adelante y D7 es el que más lo da
    assert.ok(BOSS_LADDER.verdugo![1] > BOSS_LADDER.demonio_foso![1]);
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
    const arm = BASE_BY_NAME.get('Armadura de placas')!, ring = BASE_BY_NAME.get('Anillo opaco')!;
    assert.equal(s.def, arm.def! + COMBAT_CAP.df);
    assert.equal(s.rm, arm.rm! + ring.rm! + COMBAT_CAP.rm);
});

// ---------- mejora: tope por calidad y zona de riesgo ----------
test('mejora: un Verde solo llega a +3; un fallo nunca baja el nivel', () => {
    const { eco, reg, join } = setup();
    const world = reg.ensure('solmar_legacy');
    const { p, log } = join(world, 'Mejorador');
    const st = p.econ!, cx = ctx([{ id: 'armero_s', x: 11, y: 11 }]);
    const verde = uniqueItem(st, UNIQUE_BASES.find((u) => !u.uniq.boss)!, 1);
    verde.up = UP_MAX_BY_QUALITY[1]; st.bag.push(verde);
    st.forge = 999; st.gold = 999_999;
    eco.upgrade(p, cx, 'armero_s', verde.u);
    assert.equal(lastResult(log)?.code, 'max');
    // Dorado en +6: con el dado en contra se queda en +6; con el dado a favor, sube a +7
    const vio = uniqueItem(st, UNIQUE_BASES.find((u) => u.uniq.boss)!, 4);
    vio.up = 6; st.bag.push(vio);
    const rnd = Math.random;
    try {
        Math.random = () => 0.999; eco.upgrade(p, cx, 'armero_s', vio.u);
        assert.equal(vio.up, 6, 'el fallo no baja el nivel');
        vio.up = 6;
        Math.random = () => 0; eco.upgrade(p, cx, 'armero_s', vio.u);
        assert.equal(vio.up, 7, 'el éxito sube normal');
    } finally { Math.random = rnd; }
});

// ---------- migración v5 ----------
test('migración v5: únicos de banda → Azul, de jefe → la calidad más alta, botín viejo → Común sin atributos', () => {
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

// ---------- reforja ----------
test('reforja: re-tira un extra elegido, cobra piedras + oro y duplica el costo por ítem; los fijos no se tocan', async () => {
    const { MAT_REFORJA, reforgeStones } = await import('@fdn/world');
    const { eco, reg, join } = setup();
    const world = reg.ensure('solmar_legacy');
    const { p, log } = join(world, 'Reforjador');
    const st = p.econ!, cx = ctx([{ id: 'armero_s', x: 11, y: 11 }]);
    const u = UNIQUE_BASES.find((x) => !x.uniq.boss)!;
    const it = uniqueItem(st, u, 2); st.bag.push(it); // Azul: 2 extras
    const nBase = u.uniq.attrs.length;
    st.gold = 1_000_000; st.mats = { [MAT_REFORJA]: 1 };
    const before = it.a.map((a) => ({ ...a }));
    eco.reforge(p, cx, 'armero_s', it.u, 0);
    assert.equal(lastResult(log)?.ok, true);
    assert.deepEqual(it.a.slice(0, nBase).map((a) => a.id), before.slice(0, nBase).map((a) => a.id), 'los fijos quedan');
    assert.ok(!u.uniq.attrs.some(([id]) => id === it.a[nBase].id), 'el extra nuevo no pisa un fijo');
    assert.notEqual(it.a[nBase].id, it.a[nBase + 1].id, 'los dos extras no se repiten');
    assert.equal(st.mats[MAT_REFORJA], 0); assert.equal(it.rf, 1);
    // la segunda reforja del mismo ítem cuesta el doble
    assert.equal(reforgeStones(it.rf!), 2);
    st.mats[MAT_REFORJA] = 1;
    eco.reforge(p, cx, 'armero_s', it.u, 0);
    assert.equal(lastResult(log)?.code, 'stones', 'con 1 piedra no alcanza para la segunda');
    // un Verde con 1 extra solo puede reforjar el 0; un Común no reforja
    const verde = uniqueItem(st, u, 1); st.bag.push(verde); st.mats[MAT_REFORJA] = 9;
    eco.reforge(p, cx, 'armero_s', verde.u, 5); // índice fuera de rango: se recorta al 0
    assert.equal(lastResult(log)?.ok, true);
    const comun = uniqueItem(st, u, 0); st.bag.push(comun);
    eco.reforge(p, cx, 'armero_s', comun.u, 0);
    assert.equal(lastResult(log)?.code, 'no_extras');
});

// ---------- oferta del día ----------
test('oferta del día: determinística por día UTC, estrella con roll visible y stock 1 global', async () => {
    const { dailyOffers, dailyStar, dayKey, STAR_CHANCE, DAILY_INDEX_BASE } = await import('../src/dailyShop.ts');
    const d0 = Date.UTC(2026, 10, 3, 12), rnd = Math.random;
    try {
        Math.random = () => { throw new Error('la oferta no puede depender de Math.random'); };
        assert.deepEqual(dailyOffers(d0), dailyOffers(d0), 'mismo día, misma oferta');
        assert.notEqual(dayKey(d0), dayKey(d0 + 86_400_000));
    } finally { Math.random = rnd; }
    // la estrella aparece más o menos STAR_CHANCE de los días, nunca es de jefe y su precio es caro
    let stars = 0;
    for (let d = 0; d < 400; d++) {
        const s = dailyStar(d0 + d * 86_400_000);
        if (!s) continue;
        stars++;
        assert.ok(!s.u.uniq.boss, 'los de jefe no se venden');
        assert.ok([2, 3].includes(s.offer.quality), 'la estrella es Azul o Violeta');
        assert.ok(s.offer.price >= 1000, `precio ${s.offer.price}`);
        assert.ok(s.offer.attrs.length === s.u.uniq.attrs.length + (s.offer.quality >= 2 ? 2 : 1), 'roll visible completo');
    }
    assert.ok(Math.abs(stars / 400 - STAR_CHANCE) < 0.08, `estrellas ${stars}/400`);
    // compra: el primero se la lleva, el segundo ve 'sold'; comprar en otro NPC falla
    const { eco, reg, join } = setup();
    const world = reg.ensure('solmar_legacy');
    const A = join(world, 'Uno'), B = join(world, 'Dos');
    const cx = ctx([{ id: 'mercader_s', x: 11, y: 11 }, { id: 'armero_s', x: 11, y: 11 }]);
    // busco un día con estrella para que el índice exista siempre
    let now = Date.now();
    while (!(await import('../src/dailyShop.ts')).dailyStar(now)) now += 86_400_000;
    const realNow = Date.now; Date.now = () => now;
    try {
        const offers = dailyOffers(now), starIdx = offers.findIndex((o) => o.star);
        A.p.econ!.gold = 10 ** 9; B.p.econ!.gold = 10 ** 9;
        eco.buy(A.p, cx, 'armero_s', DAILY_INDEX_BASE + starIdx);
        assert.equal(lastResult(A.log)?.code, 'no_stock', 'solo el mercader');
        eco.buy(A.p, cx, 'mercader_s', DAILY_INDEX_BASE + starIdx);
        assert.equal(lastResult(A.log)?.ok, true);
        const bought = A.p.econ!.bag.at(-1)!;
        assert.deepEqual(bought.a, offers[starIdx].attrs, 'el roll comprado es el publicado');
        assert.equal(bought.r, offers[starIdx].quality);
        eco.buy(B.p, cx, 'mercader_s', DAILY_INDEX_BASE + starIdx);
        assert.equal(lastResult(B.log)?.code, 'sold', 'stock 1 de todo el server');
        // las líneas comunes no se agotan
        eco.buy(B.p, cx, 'mercader_s', DAILY_INDEX_BASE);
        assert.equal(lastResult(B.log)?.ok, true);
    } finally { Date.now = realNow; }
});

test('oferta del día: la compra de la estrella se anuncia a todo el server (una sola vez)', async () => {
    const { dailyOffers, dailyStar, DAILY_INDEX_BASE } = await import('../src/dailyShop.ts');
    const { eco, reg, join } = setup();
    const world = reg.ensure('solmar_legacy');
    const A = join(world, 'Comprador'), B = join(world, 'Tarde');
    const cx = ctx([{ id: 'mercader_s', x: 11, y: 11 }]);
    const said: string[] = []; eco.announce = (t) => said.push(t);
    let now = Date.now(); while (!dailyStar(now)) now += 86_400_000;
    const realNow = Date.now; Date.now = () => now;
    try {
        const idx = dailyOffers(now).findIndex((o) => o.star);
        A.p.econ!.gold = 10 ** 9; B.p.econ!.gold = 10 ** 9;
        eco.buy(A.p, cx, 'mercader_s', DAILY_INDEX_BASE + idx);
        eco.buy(B.p, cx, 'mercader_s', DAILY_INDEX_BASE + idx);
        assert.equal(said.length, 1, 'solo el que se la lleva dispara el aviso');
        assert.match(said[0], /oferta estrella/);
    } finally { Date.now = realNow; }
});

// ---------- balance de drops por banda ----------
test('drops: caen ~14 únicos por banda subiendo de nivel y ~2 por corrida de mazmorra (la chance baja con las muertes que pide la banda)', async () => {
    const { UNIQUE_PIT_CHANCE, uniqueChance } = await import('../src/economy.ts');
    const { TIERS, TIER_LIST, expToLevel, mobExpCurve, levelExpMult, DUNGEON_IDS, buildMap } = await import('@fdn/world');
    const kills = (L: number) => expToLevel(L) / (mobExpCurve(L) * levelExpMult(L));
    let prev = Infinity;
    for (const t of TIER_LIST) {
        const [a, b] = TIERS[t]; let k = 0; for (let L = a; L <= Math.min(b, 39); L++) k += kills(L);
        const per = k * uniqueChance(t, 'pit');
        assert.ok(per >= 7 && per <= 20, `T${t}: ${per.toFixed(1)} únicos en la banda (${Math.round(k)} muertes)`);
        assert.ok(UNIQUE_PIT_CHANCE[t - 1] < prev, `T${t}: la chance baja con la banda`); prev = UNIQUE_PIT_CHANCE[t - 1];
        assert.equal(uniqueChance(t, 'loose'), uniqueChance(t, 'pit') / 3);
    }
    // una corrida son los dos pisos de la mazmorra (entrada + piso del jefe); mobs por corrida = suma de sus zonas
    const FLOORS = [['cueva_goblin', 'minas_goblin'], ['nido_hormiga_leon', 'ruinas_de_stormrock'], ['cripta_olvidada', 'sepulcro_profundo'], ['torre_del_hechicero', 'camaras_de_investigacion'], ['templo_de_mez', 'salon_de_mez'], ['fortaleza_infernal', 'foso_del_demonio'], ['fuerte_amir', 'camaras_de_tortura']];
    DUNGEON_IDS.forEach((d, i) => {
        const mobs = FLOORS[i].reduce((a, id) => a + buildMap(id).zones.reduce((n, z) => n + z.n, 0), 0), perRun = mobs * uniqueChance(i + 1, 'dungeon');
        assert.ok(perRun >= 1.6 && perRun <= 2.4, `${d}: ${perRun.toFixed(2)} únicos por corrida (${mobs} mobs)`);
    });
});
