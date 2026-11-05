/** Tramo 60–80: mapas compartidos con PvP solo en una parte; la entrada y los pits de leveo son pacíficos. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, buildMap, inMapRect } from '@fdn/world';

for (const id of ['paso_de_stormrock', 'cenizas_i', 'cenizas_ii']) {
    test(`${id}: entrada pacífica y también hay zona con PvP`, () => {
        const d = MAPS[id]; assert.equal(d.pvp, 'faction'); assert.ok(d.peaceRects && d.peaceRects.length > 0);
        assert.ok(d.peaceRects.some((r) => inMapRect(r, d.spawn.x, d.spawn.y)), 'la entrada tiene que ser pacífica');
        const m = buildMap(id); let pvp = 0, peace = 0;
        for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (!m.blocked[y]?.[x]) (d.peaceRects.some((r) => inMapRect(r, x, y)) ? peace++ : pvp++);
        assert.ok(pvp > 0 && peace > 0, `pvp ${pvp} · paz ${peace}`);
    });
}
