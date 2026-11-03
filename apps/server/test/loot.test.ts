import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOT_TTL_MS, LootManager, rollLoot } from '../src/systems/loot.ts';

test('rollLoot: sin suerte no cae nada; con suerte cae material u oro', () => {
    assert.equal(rollLoot('wyvern', 'Wyvern', 10, () => 0.99), null);
    const seq = [0, 0.9]; let i = 0;
    assert.deepEqual(rollLoot('wyvern', 'Wyvern', 10, () => seq[i++]), { itemId: 'viper_skin', itemName: 'Piel de wyvern', amount: 1 });
    i = 0; const g = rollLoot('goblin', 'Goblin', 5, () => [0, 0, 0.5][i++])!;
    assert.equal(g.itemId, 'gold'); assert.ok(g.amount > 0);
});

test('pickup: valida 1,5 celdas y se levanta una sola vez', () => {
    const lm = new LootManager('t');
    const e = lm.spawn(10.7, 20.2, { itemId: 'viper_skin', itemName: 'Piel de wyvern', amount: 1 });
    assert.equal(e.x, 10); assert.equal(e.y, 20);
    assert.deepEqual(lm.pickup(e.lootId, 12, 20), { ok: false, reason: 'far' });
    assert.equal(lm.pickup(e.lootId, 11, 21).ok, true); // diagonal ≈ 1,41
    assert.deepEqual(lm.pickup(e.lootId, 10, 20), { ok: false, reason: 'gone' });
});

test('visibilidad y vencimiento', () => {
    let t = 0; const lm = new LootManager('t', () => t);
    const e = lm.spawn(5, 5, { itemId: 'gold', itemName: 'Oro', amount: 3 });
    assert.equal(lm.unseenNear('a', 50, 50, 10, 10).length, 0);
    assert.equal(lm.unseenNear('a', 6, 6, 10, 10).length, 1);
    assert.equal(lm.unseenNear('a', 6, 6, 10, 10).length, 0); // no se repite
    t = LOOT_TTL_MS + 1;
    assert.deepEqual(lm.expire().map((x) => [x.loot.lootId, x.viewers]), [[e.lootId, ['a']]]);
    assert.equal(lm.items.size, 0);
});
