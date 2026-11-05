import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relevel, ALL_BASES, BASE_BY_NAME, BOSS_UNIQUES, FLARE_DATA, FLARE_FIELD, MAPS, MOB_TYPES, UNIQUES_BY_TIER, UNIQUE_BASES, UNIQUE_TIERS_READY, buildMap, mobDef, tierOfLevel, flareTile, mapHash, type MobType } from '@fdn/world';

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
        assert.ok(kinds.size >= 3, `${d.eris}: tiene que haber al menos 3 pits`);
        assert.equal(new Set(types).size, kinds.size, `${d.eris}: los pits tienen que tener mobs distintos (${types.join(', ')})`);
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
test('los portales de las ciudades llevan al campo de su nación y la vuelta llega a su propia plaza', () => {
    const v = MAPS.solmar_villa.links.find((l) => l.id === 'villa_a_campos'), c = MAPS.vhar_ciudadela.links.find((l) => l.id === 'ciudadela_a_campos');
    assert.ok(v && c);
    assert.equal(v.to.map, FLARE_FIELD.solmar.eris); assert.equal(c.to.map, FLARE_FIELD.vhar.eris);
    assert.equal(v.kind, 'portal'); assert.equal(c.kind, 'oneway');
    assert.equal(MAPS[FLARE_FIELD.solmar.eris].links.find((l) => l.id === 'campos_a_ciudad')?.to.map, 'solmar_villa');
    assert.equal(MAPS[FLARE_FIELD.vhar.eris].links.find((l) => l.id === 'campos_de_sal_vhar_a_ciudad')?.to.map, 'vhar_ciudadela');
});

test('mazmorra D1: puerta con nivel mínimo, jefe, tier de mazmorra y mapas temporales', () => {
    const sup = MAPS.canon_goblin, cueva = MAPS.cueva_goblin, minas = MAPS.minas_goblin;
    const door = sup.links.find((l) => l.to.map === 'cueva_goblin')!;
    assert.equal(door.kind, 'door');
    assert.equal(door.gate?.lvl, relevel(2));
    for (const m of [cueva, minas]) { assert.ok(m.temporary); const w = buildMap(m.id); assert.ok(w.dungeon); assert.ok(w.zones.every((z) => z.tier === 'dungeon' || z.type === 'goblin_jefe')); }
    assert.ok(buildMap('minas_goblin').zones.some((z) => z.type === 'goblin_jefe'));
    const n = mobDef('goblin', { lvl: 3 }), g = mobDef('goblin', { lvl: 3, tier: 'dungeon' });
    assert.ok(g.hp > n.hp * 2.4 && g.exp > n.exp * 1.9);
});

test('ítems únicos: catálogo coherente, tier por nivel y jefes de D1-D3 con sus ítems', () => {
    const names = ALL_BASES.map((b) => b.name); assert.equal(new Set(names).size, names.length, 'nombres repetidos');
    assert.equal(tierOfLevel(1), 1); assert.equal(tierOfLevel(17), 1); assert.equal(tierOfLevel(18), 2); assert.equal(tierOfLevel(100), 6); assert.equal(tierOfLevel(120), 7);
    for (let t = 1; t <= UNIQUE_TIERS_READY; t++) assert.equal(UNIQUES_BY_TIER[t].length, 16, `banda ${t}: 16 únicos (8 slots)`);
    for (const b of ['goblin_jefe', 'antlion_reina', 'caballero_cripta'] as const) assert.ok(BOSS_UNIQUES[b]!.length >= 2, b);
    for (const u of UNIQUE_BASES) { assert.equal(u.uniq.attrs.length, 2, u.name); assert.ok(u.uniq.attrs.every(([, v]) => v >= 1), u.name); assert.ok(BASE_BY_NAME.get(u.name) === u); }
    // los jefes superan al único del mismo arquetipo de su banda
    const w = UNIQUE_BASES.find((u) => u.name === 'Espada del Cañón')!, wb = UNIQUE_BASES.find((u) => u.name === 'Cuchilla del Jefe goblin')!;
    assert.ok(wb.dmg![1] > w.dmg![1]);
});

test('ítems únicos T4-T7 y jefes D4-D7: cada banda supera a la anterior y la T7 tiene catálogo propio', () => {
    assert.equal(UNIQUE_TIERS_READY, 7);
    for (const b of ['mago_mayor', 'wyvern_aire', 'demonio_foso', 'verdugo'] as const) assert.ok(BOSS_UNIQUES[b]!.length >= 2, b);
    const arch = (t: number, slot: string, pred: (u: (typeof UNIQUE_BASES)[number]) => boolean) => UNIQUES_BY_TIER[t].filter((u) => u.slot === slot && pred(u));
    for (let t = 2; t <= 7; t++) {
        // arma de una mano (la de menor daño sin magia), armadura pesada (la de más defensa) y arma mágica: crecen banda a banda
        const w = (x: number) => Math.min(...arch(x, 'arma', (u) => !u.mag).map((u) => u.dmg![1]));
        const a = (x: number) => Math.max(...arch(x, 'armadura', () => true).map((u) => u.def ?? 0));
        const m = (x: number) => Math.max(...arch(x, 'arma', (u) => !!u.mag).map((u) => u.mag!));
        assert.ok(w(t) > w(t - 1) && a(t) > a(t - 1) && m(t) > m(t - 1), `banda ${t}`);
        for (const u of UNIQUES_BY_TIER[t]) assert.ok(u.look, `${u.name} sin aspecto`);
    }
    // el ítem de cada jefe de D4-D7 supera al único común de su banda del mismo slot
    for (const b of ['mago_mayor', 'wyvern_aire', 'demonio_foso', 'verdugo'] as const) for (const bu of BOSS_UNIQUES[b]!) {
        const peers = UNIQUES_BY_TIER[bu.uniq.tier].filter((u) => u.slot === bu.slot);
        const score = (u: (typeof UNIQUE_BASES)[number]) => (u.dmg?.[1] ?? 0) + (u.def ?? 0) + (u.rm ?? 0) + (u.mag ?? 0);
        assert.ok(score(bu) > Math.min(...peers.map(score)), bu.name);
    }
    assert.equal(tierOfLevel(110), 7); assert.ok(UNIQUES_BY_TIER[tierOfLevel(120)].length === 16);
});

test('uniqueItem: fijos con variación ±10 %, calidad sorteada y extras según la calidad al final de `a`', async () => {
    const { uniqueItem, newEcon } = await import('../src/economy.ts');
    const { EXTRAS_BY_QUALITY } = await import('@fdn/world');
    const st = newEcon('paladin', 'solmar');
    for (const u of UNIQUE_BASES) {
        const it = uniqueItem(st, u);
        // banda sin calidad pedida → Azul (2); jefe → su escalera (D1-D2 Azul o Violeta; D3-D7 Violeta o Dorado)
        if (!u.uniq.boss) assert.equal(it.r, 2);
        else { const lo = ['goblin_jefe', 'antlion_reina'].includes(u.uniq.boss) ? 2 : 3; assert.ok(it.r >= lo && it.r <= lo + 1, `${u.name} calidad ${it.r}`); }
        // los fijos primero, con su variación; después los extras que indica la calidad
        assert.equal(it.a.length, u.uniq.attrs.length + EXTRAS_BY_QUALITY[it.r]);
        u.uniq.attrs.forEach(([id, v], i) => { const got = it.a[i]; assert.equal(got.id, id); assert.ok(got.v >= Math.floor(v * 0.9) && got.v <= Math.ceil(v * 1.1), `${u.name} ${id} ${got.v} vs ${v}`); });
        for (const x of it.a.slice(u.uniq.attrs.length)) assert.ok(x.v >= 1 && !u.uniq.attrs.some(([id]) => id === x.id), `${u.name} extra ${x.id}`);
    }
    // con la calidad pedida explícita, se respeta
    assert.equal(uniqueItem(st, UNIQUE_BASES[0], 1).r, 1);
    assert.equal(uniqueItem(st, UNIQUE_BASES[0], 1).a.length, UNIQUE_BASES[0].uniq.attrs.length + 1);
});

test('ítems únicos: usan solo aspectos (look/off) que ya existen en las bases normales y de tienda', () => {
    const uniq = new Set(UNIQUE_BASES.map((u) => u.name)), looks = new Set<string>(), offs = new Set<string>();
    for (const b of ALL_BASES) if (!uniq.has(b.name)) { if (b.look) looks.add(b.look); if (b.off) offs.add(b.off); }
    for (const u of UNIQUE_BASES) { assert.ok(u.look && looks.has(u.look), `${u.name}: look '${u.look}' sin usar en otra base`); if (u.off) assert.ok(offs.has(u.off), `${u.name}: off '${u.off}'`); }
});
