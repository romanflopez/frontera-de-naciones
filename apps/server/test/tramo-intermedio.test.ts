/** Tramo 60–80 (D.5): mapas compartidos donde solo una parte es zona roja (PvP); la entrada y los pits de leveo son zona abierta. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, buildMap, inMapRect, pvpRegionAt } from '@fdn/world';

for (const id of ['paso_de_stormrock', 'cenizas_i', 'cenizas_ii']) {
    test(`${id}: la entrada es zona abierta y también hay zona roja`, () => {
        const d = MAPS[id]; assert.equal(d.pvp, 'faction'); assert.ok(d.redRects && d.redRects.length > 0);
        assert.ok(!d.redRects.some((r) => inMapRect(r, d.spawn.x, d.spawn.y)), 'la entrada no puede ser zona roja'); assert.equal(pvpRegionAt(d, false, d.spawn.x, d.spawn.y), 'abierta');
        const m = buildMap(id); let pvp = 0, peace = 0;
        for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (!m.blocked[y]?.[x]) (d.redRects.some((r) => inMapRect(r, x, y)) ? pvp++ : peace++);
        assert.ok(pvp > 0 && peace > 0, `pvp ${pvp} · paz ${peace}`);
    });
}
