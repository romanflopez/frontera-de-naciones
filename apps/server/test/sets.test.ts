// Los sets de armadura (Solmar y Vhar) están completos: ítems, tienda, hojas de piezas y meta.json coinciden.
// Correr: cd apps/server && npx tsx --test test/sets.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_BASES, BASE_BY_NAME, SETS, SET_PIECES_BY_TIER, SHOPS, UNIQUE_BY_NAME, activeSets, setOfPiece, slotsFor } from '@fdn/world';
import { statsFromChar } from '../src/systems/pvpCombat.ts';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'public', 'assets');
const meta = JSON.parse(readFileSync(join(ASSETS, 'meta.json'), 'utf8')).paper as { cw: number; ch: number; cols: number; anims: Record<string, unknown>; sets: Record<string, string[]>; pieces: Record<string, string>; helms: string[] };
const LOOKS = ['sol_malla', 'sol_placas', 'vhar_malla', 'vhar_placas'];
/** Tamaño de un .webp sin pérdida (VP8L): 14 bits de ancho y 14 de alto. */
function webpSize(file: string): [number, number] {
    const b = readFileSync(file); assert.equal(b.toString('ascii', 12, 16), 'VP8L', file);
    const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

test('cada set tiene 4 piezas de cuerpo + cabeza, del tamaño de la hoja base y registradas en meta.json', () => {
    const rows = Object.keys(meta.anims).length * 8;
    for (const look of LOOKS) {
        const parts = meta.sets[look]; assert.equal(parts?.length, 4, `${look} en meta.sets`);
        const all = [...parts, `${look}_helm`];
        assert.deepEqual(all.map((n) => meta.pieces[n]), ['feet', 'legs', 'hands', 'chest', 'head']);
        assert.ok(meta.helms.includes(`${look}_helm`));
        for (const n of all) {
            const f = join(ASSETS, 'paper', `${n}.webp`); assert.ok(existsSync(f), `falta ${n}.webp`);
            assert.deepEqual(webpSize(f), [meta.cw * meta.cols, meta.ch * rows], `${n}: tamaño de hoja`);
        }
    }
});

test('cada set de nación tiene 8 piezas (todos los slots, con aspecto e ícono), que se farmean (nunca en la tienda), y sus bonos suman por cantidad', () => {
    const stock = new Set(Object.values(SHOPS).flatMap((sh) => sh.stock.map((x) => x.base)));
    assert.equal(SETS.length, 21);
    for (const set of SETS) {
        assert.equal(set.pieces.length, 8, `${set.id}: 8 piezas`);
        const slots = set.pieces.map((n) => ALL_BASES.find((b) => b.name === n)!.slot).sort();
        assert.deepEqual(slots, ['amuleto', 'anillo', 'anillo', 'arma', 'armadura', 'botas', 'cabeza', 'guantes'], `${set.id}: un ítem por slot (dos anillos distintos)`);
        for (const n of set.pieces) { assert.ok(!stock.has(n), `${n} no se vende`); assert.ok(setOfPiece(n) === set); }
        assert.deepEqual(set.bonuses.map((b) => b.n), [2, 4, 6, 8]);
        assert.ok(SET_PIECES_BY_TIER[set.tier]?.filter((u) => u.uniq.set === set.id).length === 8, `${set.id}: cae en su banda`);
    }
    // el arte de las armaduras de set sigue ahí, pero ya no se compran: se consiguen en mazmorras
    for (const look of LOOKS) {
        const arm = ALL_BASES.find((b) => b.look === look), helm = ALL_BASES.find((b) => b.look === `${look}_helm`);
        assert.ok(arm && arm.slot === 'armadura' && helm && helm.slot === 'cabeza', `${look}: ítems`);
        for (const f of [`${look}.png`, `${look}_helm.png`]) assert.ok(existsSync(join(ASSETS, 'icons', f)), `falta el ícono ${f}`);
    }
    for (const b of ALL_BASES) if (b.look && LOOKS.some((l) => b.look === l || b.look === `${l}_helm`) && !UNIQUE_BY_NAME.has(b.name)) assert.ok(!stock.has(b.name), `${b.name}: el set de nación no está en la tienda`);
});

test('bonos de set: 2, 4, 6 y 8 piezas distintas (un anillo repetido cuenta una vez) y entran en los stats de combate', () => {
    const alba = SETS.find((s) => s.id === 'alba')!;
    /** Pone cada pieza en el primer lugar de equipo libre de su slot (los dos anillos van a anillo y anillo2). */
    const eqOf = (names: string[]) => { const eq: Record<string, { n: string; a: never[] }> = {}; for (const n of names) { const sl = slotsFor(BASE_BY_NAME.get(n)!.slot).find((x) => !eq[x])!; eq[sl] = { n, a: [] }; } return eq; };
    assert.deepEqual(activeSets(alba.pieces.slice(0, 1)).map((a) => a.stats.length), [0]);
    assert.equal(activeSets(alba.pieces.slice(0, 2))[0].stats.length, 2);
    assert.equal(activeSets(alba.pieces.slice(0, 4))[0].stats.length, 4);
    assert.equal(activeSets(alba.pieces.slice(0, 6))[0].stats.length, 6);
    assert.equal(activeSets(alba.pieces)[0].stats.length, 9, '2 + 2 + 2 + 3 stats acumulados con las 8');
    const sello = alba.pieces.find((n) => n.startsWith('Sello'))!;
    assert.equal(activeSets([sello, sello, alba.pieces[0]])[0].count, 2, 'dos anillos iguales cuentan una vez');
    // cada escalón es más fuerte que el anterior (mismo stat, mayor valor) y todos crecen con la banda
    for (const set of SETS) for (let i = 1; i < set.bonuses.length; i++) assert.ok(set.bonuses[i].stats.every(([, v]) => v >= 1), `${set.id} ${set.bonuses[i].n}`);
    // en el combate: con 2 piezas puestas sube la vida y la velocidad de ataque respecto de las mismas piezas sin set
    const statsOf = (n: string[]) => statsFromChar({ lvl: 20, cls: 'pala', eq: eqOf(n) } as never);
    const sin = statsOf([alba.pieces[0]]), con = statsOf(alba.pieces.slice(0, 2));
    const two = alba.bonuses[0].stats;
    assert.ok(con.maxHp - sin.maxHp >= two.find(([id]) => id === 'hp')![1], 'el bono de vida entra');
    assert.ok(con.aspd - sin.aspd >= two.find(([id]) => id === 'aspd')![1], 'el bono de velocidad entra');
    // las 8 piezas (con los dos anillos distintos) activan el bono más alto
    assert.equal(activeSets(alba.pieces)[0].count, 8);
});

test('los nombres de los ítems son únicos (son la clave del guardado)', () => {
    const names = ALL_BASES.map((b) => b.name); assert.equal(new Set(names).size, names.length);
});

// ---------- drops de piezas de set ----------
test('piezas de set: caen solo en mazmorras del tramo (mobs y jefe de su dungeon), nunca en pits', async () => {
    const { Economy, newEcon } = await import('../src/economy.ts');
    const { mobDef, MOBS, DUNGEON_MAP, SET_PIECES_BY_TIER } = await import('@fdn/world');
    const { DUNGEON_BOSS } = await import('@fdn/world');
    const eco = new Economy({ get: () => undefined, put: () => {}, flush: () => {} } as never);
    const sent: { code?: string; text?: string }[] = [];
    const p = { econ: newEcon('pala', 'solmar'), accountKey: 'a', posX: 5, posY: 5, send: (m: { payload?: { $case?: string; value?: { code?: string; text?: string } } }) => { if (m.payload?.$case === 'econResult') sent.push(m.payload.value ?? {}); }, isDead: false, touch: () => {} } as never;
    const ctx = { npcs: [], restat: () => {}, ground: { add: () => {} } } as never;
    const st = (p as { econ: ReturnType<typeof newEcon> }).econ; st.lvl = 18;
    const isSet = (n: string) => !!UNIQUE_BY_NAME.get(n)?.uniq.set;
    const run = (kill: Parameters<typeof eco.reward>[2], n: number): { sets: number; uniques: number } => {
        let sets = 0, uniques = 0;
        for (let i = 0; i < n; i++) {
            st.bag = []; eco.reward(p, ctx, kill);
            for (const it of st.bag) if (UNIQUE_BY_NAME.has(it.n)) { uniques++; if (isSet(it.n)) sets++; }
        }
        return { sets, uniques };
    };
    // mobs de mazmorra de la banda 4: una buena parte de los únicos son piezas del set de esa banda
    const dun = run({ mobId: 1, type: 'goblin', def: mobDef('goblin', { lvl: 18 }), zoneName: 'm', origin: 'dungeon', x: 0, y: 0, traits: 0 }, 6000);
    assert.ok(dun.uniques > 100 && dun.sets / dun.uniques > 0.35 && dun.sets / dun.uniques < 0.65, `sets ${dun.sets}/${dun.uniques}`);
    // en pits y sueltos nunca
    const pit = run({ mobId: 1, type: 'goblin', def: mobDef('goblin', { lvl: 18 }), zoneName: 'p', origin: 'pit', x: 0, y: 0, traits: 0 }, 6000);
    assert.ok(pit.uniques > 20 && pit.sets === 0, `pit: ${pit.sets} piezas de set`);
    // el jefe de D4 suelta además (50 %) una pieza del set de su mazmorra (banda 4), y avisa
    sent.length = 0;
    let extra = 0;
    for (let i = 0; i < 300; i++) {
        st.bag = []; eco.reward(p, ctx, { mobId: 1, type: DUNGEON_BOSS.d4, def: MOBS[DUNGEON_BOSS.d4], zoneName: 'Torre', origin: 'dungeon', x: 0, y: 0, traits: 0, map: DUNGEON_MAP.d4 });
        const piece = st.bag.find((it) => isSet(it.n)); if (piece) { extra++; assert.ok(SET_PIECES_BY_TIER[4].some((u) => u.name === piece.n), `${piece.n} es de la banda 4`); }
    }
    assert.ok(extra > 100 && extra < 200, `piezas extra del jefe: ${extra}/300 (esperado ~50 %)`);
    assert.ok(sent.some((m) => m.code === 'set_piece'), 'avisa que cayó una pieza de set');
});

test('pickSetPiece: prefiere las piezas que todavía no tenés, así el set de 8 se completa con 8 piezas', async () => {
    const { newEcon, pickSetPiece } = await import('../src/economy.ts');
    for (const set of SETS) {
        const st = newEcon('pala', 'solmar'), pool = SET_PIECES_BY_TIER[set.tier].filter((u) => u.uniq.set === set.id), got = new Set<string>();
        for (let i = 0; i < 8; i++) { const u = pickSetPiece(st, pool); assert.ok(!got.has(u.name), `${set.id}: repetida ${u.name} antes de completar`); got.add(u.name); st.bag.push({ u: st.nextUid++, n: u.name, r: 1, a: [] }); }
        assert.equal(got.size, 8);
        const again = pickSetPiece(st, pool); assert.ok(pool.includes(again), 'con el set completo cae cualquiera de sus piezas');
    }
});
