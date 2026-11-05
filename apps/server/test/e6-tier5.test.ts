/** E6: primer tramo del tier 5 (niveles 41-50): dos mapas de caza generados, encadenados a las Minas abandonadas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, buildMap, mobDef, tierOfLvl, validateMapGraph, reachableFrom, TIERS } from '@fdn/world';

test('tier 5: dos mapas de caza de facción, con mobs entre 41 y 50, alcanzables desde las Minas abandonadas', () => {
    const ids = ['llanura_del_umbral', 'paramo_de_brasas'];
    assert.deepEqual(validateMapGraph(), []);
    assert.ok(MAPS.minas_abandonadas.links.some((l) => l.to.map === 'llanura_del_umbral'));
    for (const id of ids) {
        const d = MAPS[id], m = buildMap(id);
        assert.equal(d.tier, 5); assert.equal(d.pvp, 'faction');
        assert.ok(d.lvl![0] >= TIERS[5][0] && d.lvl![1] <= TIERS[5][1]);
        const mobs = m.zones.reduce((n, z) => n + z.n, 0);
        assert.ok(mobs >= 150 && mobs <= 250, `${id}: ${mobs} mobs`);
        for (const z of m.zones) { const l = mobDef(z.type, z).lvl; assert.ok(l >= d.lvl![0] && l <= d.lvl![1], `${id}/${z.name}: nivel ${l}`); assert.equal(tierOfLvl(l), 5); }
        const reach = reachableFrom(m, d.spawn.x, d.spawn.y, true);
        for (const z of m.zones) assert.ok(reach[Math.round(z.y)][Math.round(z.x)], `${id}/${z.name} no se alcanza`);
    }
    assert.deepEqual(buildMap('llanura_del_umbral').props, buildMap('llanura_del_umbral').props, 'determinista');
});
