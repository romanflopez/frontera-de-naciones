import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLARE_DATA, FLARE_FIRST, MAPS, MOB_TYPES, buildMap, mobDef, flareTile, mapHash, type MobType } from '@fdn/world';

/** Mapas importados de Flare (docs/MAPAS_FLARE.md): datos de tools/src/flare/maps.ts y atlas de tools/src/flare/mapatlas.ts. */
const meta = JSON.parse(readFileSync(new URL('../../client/public/assets/meta.json', import.meta.url), 'utf8')) as Record<string, { pos?: Record<string, number[]> }>;

test('los mapas de Flare están registrados y se arman igual dos veces', () => {
    assert.ok(FLARE_DATA.length >= 3);
    for (const d of FLARE_DATA) {
        assert.ok(MAPS[d.eris], d.eris);
        assert.equal(MAPS[d.eris].size, d.size);
        assert.equal(mapHash(buildMap(d.eris)), mapHash(buildMap(d.eris)), d.eris);
    }
});
test('todas las piezas que usan los mapas están en el atlas del cliente (si falta una, no se dibuja)', () => {
    for (const d of FLARE_DATA) {
        const atlas = meta[`flare_${d.tileset}`]?.pos; assert.ok(atlas, `falta el grupo flare_${d.tileset} en meta.json (pnpm --filter @fdn/tools flare:mapatlas)`);
        const m = buildMap(d.eris), missing = new Set<number>();
        for (const row of m.tiles) for (const id of row) if (id >= 20000 && !atlas[id]) missing.add(id);
        for (const p of m.props) if (p.id >= 20000 && !atlas[p.id]) missing.add(p.id);
        assert.deepEqual([...missing], [], `${d.eris}: piezas sin atlas`);
        // sin partes negras: ninguna celda queda sin piso
        assert.ok(m.tiles.every((row) => row.every((id) => id !== 0)), `${d.eris}: hay celdas sin piso`);
        void flareTile;
    }
});
test('los pits tienen un mob distinto cada uno, existen en MOB_TYPES y caen en celdas caminables', () => {
    for (const d of FLARE_DATA) {
        const m = buildMap(d.eris), kinds = new Map<number, Set<string>>();
        for (const z of d.zones) {
            assert.ok((MOB_TYPES as string[]).includes(z.type), `${d.eris}: tipo de mob desconocido ${z.type}`);
            assert.equal(m.blocked[z.y][z.x], false, `${d.eris}: la zona '${z.name}' (${z.x},${z.y}) está en una celda bloqueada`);
            if (z.kind === 'pit') kinds.set(z.pit!, (kinds.get(z.pit!) ?? new Set()).add(z.type));
        }
        const types = [...kinds.values()].map((s) => [...s][0]);
        assert.equal(kinds.size, 3, `${d.eris}: tiene que haber 3 pits`);
        assert.equal(new Set(types).size, 3, `${d.eris}: los 3 pits tienen que tener mobs distintos (${types.join(', ')})`);
        if (!d.dungeon) assert.ok(m.zones.some((z) => z.name.startsWith('Merodeadores')), `${d.eris}: faltan mobs sueltos`);
        assert.ok(m.zones.every((z) => (z.type as MobType) && z.n > 0));
    }
});
test('las entradas y los vínculos están en zona segura (sin mobs)', () => {
    for (const d of FLARE_DATA) {
        const m = buildMap(d.eris);
        assert.equal(m.safe[d.entry.y][d.entry.x], true, `${d.eris}: la entrada tiene que ser zona segura`);
        for (const l of d.links) assert.equal(m.safe[l.cell.y][l.cell.x], true, `${d.eris}: el vínculo a ${l.to} tiene que ser zona segura`);
    }
});
test('los portales de las ciudades llevan a los Campos de Sal y la vuelta llega a la plaza de Solmar', () => {
    const v = MAPS.solmar_villa.links.find((l) => l.id === 'villa_a_campos'), c = MAPS.vhar_ciudadela.links.find((l) => l.id === 'ciudadela_a_campos');
    assert.ok(v && c);
    assert.equal(v.to.map, FLARE_FIRST.eris); assert.equal(c.to.map, FLARE_FIRST.eris);
    assert.equal(v.kind, 'portal'); assert.equal(c.kind, 'oneway');
    const back = MAPS[FLARE_FIRST.eris].links.find((l) => l.id === 'campos_a_ciudad');
    assert.equal(back?.to.map, 'solmar_villa');
});

test('mazmorra D1: puerta con nivel mínimo, jefe, tier de mazmorra y mapas temporales', () => {
    const sup = MAPS.canon_goblin, cueva = MAPS.cueva_goblin, minas = MAPS.minas_goblin;
    const door = sup.links.find((l) => l.to.map === 'cueva_goblin')!;
    assert.equal(door.kind, 'door');
    assert.equal(door.gate?.lvl, 2);
    for (const m of [cueva, minas]) { assert.ok(m.temporary); const w = buildMap(m.id); assert.ok(w.dungeon); assert.ok(w.zones.every((z) => z.tier === 'dungeon' || z.type === 'goblin_jefe')); }
    assert.ok(buildMap('minas_goblin').zones.some((z) => z.type === 'goblin_jefe'));
    const n = mobDef('goblin', { lvl: 3 }), g = mobDef('goblin', { lvl: 3, tier: 'dungeon' });
    assert.ok(g.hp > n.hp * 2.4 && g.exp > n.exp * 1.9);
});
