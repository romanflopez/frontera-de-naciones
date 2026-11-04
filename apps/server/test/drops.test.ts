import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DROP_DEFAULTS, dropLines, loadDropsFile, setDrop, type DropConfig } from '../src/drops.ts';
import { rollLoot } from '../src/systems/loot.ts';
import { DROPS } from '../src/drops.ts';

const fresh = (): DropConfig => ({ ...DROP_DEFAULTS });

test('setDrop: valida el rango y la clave, y goldMax nunca queda debajo de goldMin', () => {
    const c = fresh();
    assert.equal(setDrop('potionChance', '0,3', c), null); assert.equal(c.potionChance, 0.3);
    assert.match(setDrop('potionChance', 2, c)!, /entre 0 y 1/); assert.equal(c.potionChance, 0.3, 'un valor malo no cambia nada');
    assert.match(setDrop('inventada', 1, c)!, /desconocida/);
    assert.match(setDrop('mode', 'otro', c)!, /personal o suelo/);
    assert.equal(setDrop('mode', 'SUELO', c), null); assert.equal(c.mode, 'suelo');
    setDrop('goldMin', 50, c); assert.ok(c.goldMax >= 50);
});

test('drops.json: aplica lo válido, avisa lo inválido y no se cae si falta o está roto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drops-'));
    assert.deepEqual(loadDropsFile(dir, fresh()), []);
    writeFileSync(join(dir, 'drops.json'), JSON.stringify({ mode: 'suelo', potionChance: 0.5, goldChance: 7 }));
    const c = fresh(), errs = loadDropsFile(dir, c);
    assert.equal(c.mode, 'suelo'); assert.equal(c.potionChance, 0.5); assert.equal(c.goldChance, DROP_DEFAULTS.goldChance);
    assert.equal(errs.length, 1); assert.match(errs[0], /goldChance/);
    writeFileSync(join(dir, 'drops.json'), '{roto');
    assert.match(loadDropsFile(dir, fresh())[0], /no se pudo leer/);
});

test('el botín al piso respeta floorChance (0 = nunca, 1 = siempre) y dropLines resume la config', () => {
    const old = DROPS.floorChance;
    try {
        DROPS.floorChance = 0; assert.equal(rollLoot('goblin', 'Goblin', 5, () => 0), null);
        DROPS.floorChance = 1; assert.ok(rollLoot('goblin', 'Goblin', 5, () => 0.5));
    } finally { DROPS.floorChance = old; }
    assert.match(dropLines(fresh())[0], /modo personal/);
});
