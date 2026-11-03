/** Tiers de zona (docs/TIERS_DE_ZONA.md §5, paso 1.5). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MOBS, BOSS_LEVELS, TIERS, TIER_LIST, buildMap, itemBandOfLevel, mobDef, mobHpCurve, pitLevel, tierErrors, tierOfLvl, validateMapGraph, type WorldMap } from '@fdn/world';

test('tiers: la tabla cubre los niveles 1 a 40 sin huecos ni solapes', () => {
    let next = 1;
    for (const t of TIER_LIST) { const [a, b] = TIERS[t]; assert.equal(a, next, `T${t} arranca en ${a}`); assert.ok(b >= a); next = b + 1; }
    assert.equal(next, 41);
    for (let l = 1; l <= 40; l++) { const t = tierOfLvl(l); assert.ok(l >= TIERS[t][0] && l <= TIERS[t][1]); }
    assert.equal(itemBandOfLevel(1), 1); assert.equal(itemBandOfLevel(10), 2); assert.equal(itemBandOfLevel(30), 6); assert.equal(itemBandOfLevel(40), 7);
    assert.deepEqual([pitLevel([6, 8], 0), pitLevel([6, 8], 1), pitLevel([6, 8], 2), pitLevel([6, 8])], [6, 7, 8, 6]);
});

test('tiers: el grafo real cumple las reglas y cada tier 1-6 tiene mapas abiertos y mazmorra', () => {
    assert.deepEqual(validateMapGraph().filter((e) => /tier|T\d|mazmorra|nivel/.test(e)), []);
    const built = new Map<string, WorldMap>(Object.keys(MAPS).map((id) => [id, buildMap(id)]));
    assert.deepEqual(tierErrors(MAPS, built), []);
    for (const t of [1, 2, 3, 4, 5, 6]) {
        const open = Object.values(MAPS).filter((d) => d.tier === t && !d.debugOnly && !built.get(d.id)!.dungeon);
        assert.ok(open.length >= 1, `T${t}: mapas abiertos`);
    }
    // hay contenido de caza hasta el nivel 30
    const top = Math.max(...[...built.values()].flatMap((m) => m.zones.map((z) => mobDef(z.type, z).lvl)));
    assert.ok(top >= 30, `nivel de mob más alto ${top}`);
});

test('tiers: el validador detecta un mapa sin tier, mobs fuera de rango y una mazmorra de otro tier', () => {
    const built = new Map<string, WorldMap>(Object.keys(MAPS).map((id) => [id, buildMap(id)]));
    const sinTier = { ...MAPS, campos_de_sal: { ...MAPS.campos_de_sal, tier: undefined } };
    assert.ok(tierErrors(sinTier, built).some((e) => e.includes('campos_de_sal') && e.includes('sin tier')));
    const corrido = { ...MAPS, campos_de_sal: { ...MAPS.campos_de_sal, tier: 2 as const, lvl: [6, 7] as [number, number] } };
    assert.ok(tierErrors(corrido, built).some((e) => e.includes('fuera de 6-7')));
    const otra = { ...MAPS, cueva_goblin: { ...MAPS.cueva_goblin, tier: 3 as const, lvl: [13, 14] as [number, number] } };
    assert.ok(tierErrors(otra, built).some((e) => e.includes('cueva_goblin') && e.includes('T3')));
});

test('tiers: los jefes de mazmorra quedan en el tope de su tier y conservan ~11 veces la vida de un mob común', () => {
    for (const [t, L] of Object.entries(BOSS_LEVELS)) {
        const b = MOBS[t as keyof typeof MOBS];
        assert.equal(b.lvl, L, t);
        const k = b.hp / mobHpCurve(L); assert.ok(k > 8 && k < 18, `${t}: ${k.toFixed(1)} veces la curva`);
    }
});
