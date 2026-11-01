import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_BASES, BASE_BY_NAME, BOSS_UNIQUES, FLARE_DATA, FLARE_FIRST, MAPS, MOB_TYPES, UNIQUES_BY_TIER, UNIQUE_BASES, UNIQUE_TIERS_READY, buildMap, mobDef, tierOfLevel, flareTile, mapHash, type MobType } from '@fdn/world';

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

test('ítems únicos: catálogo coherente, tier por nivel y jefes de D1-D3 con sus ítems', () => {
    const names = ALL_BASES.map((b) => b.name); assert.equal(new Set(names).size, names.length, 'nombres repetidos');
    assert.equal(tierOfLevel(1), 1); assert.equal(tierOfLevel(2), 1); assert.equal(tierOfLevel(3), 2); assert.equal(tierOfLevel(12), 6);
    for (let t = 1; t <= UNIQUE_TIERS_READY; t++) assert.equal(UNIQUES_BY_TIER[t].length, 10, `banda ${t}: 10 únicos`);
    for (const b of ['goblin_jefe', 'antlion_reina', 'caballero_cripta'] as const) assert.ok(BOSS_UNIQUES[b]!.length >= 2, b);
    for (const u of UNIQUE_BASES) { assert.equal(u.uniq.attrs.length, 2, u.name); assert.ok(u.uniq.attrs.every(([, v]) => v >= 1), u.name); assert.ok(BASE_BY_NAME.get(u.name) === u); }
    // los jefes superan al único del mismo arquetipo de su banda
    const w = UNIQUE_BASES.find((u) => u.name === 'Espada del Cañón')!, wb = UNIQUE_BASES.find((u) => u.name === 'Cuchilla del Jefe goblin')!;
    assert.ok(wb.dmg![1] > w.dmg![1]);
});

test('uniqueItem: atributos fijos con variación ±10 %, rareza 2 (común de banda) o 3 (jefe)', async () => {
    const { uniqueItem, newEcon } = await import('../src/economy.ts');
    const st = newEcon('guerrero', 'solmar');
    for (const u of UNIQUE_BASES) {
        const it = uniqueItem(st, u);
        assert.equal(it.r, u.uniq.boss ? 3 : 2);
        for (const [id, v] of u.uniq.attrs) { const got = it.a.find((x) => x.id === id)!.v; assert.ok(got >= Math.floor(v * 0.9) && got <= Math.ceil(v * 1.1) + 0, `${u.name} ${id} ${got} vs ${v}`); }
    }
});

test('ítems únicos: usan solo aspectos (look/off) que ya existen en las bases normales y de tienda', () => {
    const uniq = new Set(UNIQUE_BASES.map((u) => u.name)), looks = new Set<string>(), offs = new Set<string>();
    for (const b of ALL_BASES) if (!uniq.has(b.name)) { if (b.look) looks.add(b.look); if (b.off) offs.add(b.off); }
    for (const u of UNIQUE_BASES) { assert.ok(u.look && looks.has(u.look), `${u.name}: look '${u.look}' sin usar en otra base`); if (u.off) assert.ok(offs.has(u.off), `${u.name}: off '${u.off}'`); }
});
