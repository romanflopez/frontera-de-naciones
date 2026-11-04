import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import { PartyService, setParties } from '../src/party.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { LOOT_OWNED_MS, LOOT_TTL_MS, LootManager, rollLoot, splitLoot } from '../src/systems/loot.ts';

class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}

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

// ---------- [DM] botín sin "ninjas" ----------
test('splitLoot: el oro en partes iguales (lo que sobra, de a 1 al azar) y el material entero a uno', () => {
    assert.deepEqual(splitLoot('gold', 9, 1), [{ i: 0, amount: 9 }]);
    const g = splitLoot('gold', 10, 3, () => 0.99);
    assert.equal(g.reduce((a, x) => a + x.amount, 0), 10, 'no se pierde ni se crea oro');
    assert.ok(g.every((x) => x.amount === 3 || x.amount === 4)); assert.equal(g.filter((x) => x.amount === 4).length, 1);
    assert.deepEqual(splitLoot('gold', 2, 4, () => 0).map((x) => x.amount), [1, 1], 'poco oro: a algunos les toca 1 y a otros nada');
    for (const r of [0, 0.3, 0.6, 0.99]) { const m = splitLoot('old_bone', 1, 3, () => r); assert.equal(m.length, 1); assert.equal(m[0].amount, 1); assert.ok(m[0].i >= 0 && m[0].i < 3); }
});

test('el botín del kill es de la party que mató durante 30 s; después, de cualquiera', () => {
    let t = 0; const lm = new LootManager('t', () => t);
    const e = lm.spawn(10, 20, { itemId: 'gold', itemName: 'Oro', amount: 10 }, ['a', 'b']);
    assert.deepEqual(lm.pickup(e.lootId, 10, 20, 'x'), { ok: false, reason: 'locked' });
    t = LOOT_OWNED_MS + 1; assert.equal(lm.pickup(e.lootId, 10, 20, 'x').ok, true, 'pasado el tiempo es libre');
    const f = lm.spawn(10, 20, { itemId: 'gold', itemName: 'Oro', amount: 10 }, ['a', 'b']);
    assert.equal(lm.pickup(f.lootId, 10, 20, 'b').ok, true, 'el compañero puede');
    const s = lm.spawn(10, 20, { itemId: 'gold', itemName: 'Oro', amount: 10 }); assert.equal(lm.pickup(s.lootId, 10, 20, 'x').ok, true, 'sin dueños, de cualquiera');
});

test('en el mundo: lo levanta uno y se reparte solo entre la party cerca; el de afuera no puede', () => {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings: loadSettings(), economy: eco });
    const w = reg.ensure('campos_de_sal');
    const mk = (name: string) => {
        const sid = `s-${name}`, sp = MAPS.campos_de_sal.spawn;
        w.playerConnected(sid, name, () => {}, () => {}, { mapId: w.mapId, worldId: w.mapId, x: sp.x, y: sp.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true });
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 }); w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
        const p = w.playerOf(sid)!; p.econ!.gold = 0; p.econ!.mats = {}; return p;
    };
    const [A, B, C, X] = ['ana', 'beto', 'caro', 'xavi'].map(mk);
    const svc = new PartyService({ sessionByName: (n) => [A, B, C].find((p) => p.characterName === n)?.sessionId, send: () => {}, info: (sid) => ({ name: [A, B, C].find((p) => p.sessionId === sid)!.characterName, faction: 'solmar', level: 5, hp: 100, maxHp: 100, mp: 0, maxMp: 0, map: 'campos_de_sal', online: true }) });
    setParties(svc);
    try {
        for (const p of [B, C]) { svc.handle(A.sessionId, 'invite', p.characterName); svc.handle(p.sessionId, 'accept', ''); }
        B.setPosition(A.posX + 2, A.posY); C.setPosition(A.posX + 40, A.posY); X.setPosition(A.posX, A.posY);
        const W = w as unknown as { floorLoot: LootManager; pickupLoot(p: unknown, id: string): void; partyInRange(p: unknown): { sessionId: string }[] };
        const drop = (itemId: string, amount: number) => W.floorLoot.spawn(A.posX, A.posY, { itemId, itemName: itemId, amount }, W.partyInRange(A).map((m) => m.sessionId));
        const g = drop('gold', 21);
        W.pickupLoot(X, g.lootId); assert.equal(X.econ!.gold, 0, 'el de afuera no se lo lleva');
        W.pickupLoot(A, g.lootId);
        assert.equal(A.econ!.gold + B.econ!.gold, 21, 'todo el oro entre los dos cercanos');
        assert.ok(Math.abs(A.econ!.gold - B.econ!.gold) <= 1, 'en partes iguales');
        assert.equal(C.econ!.gold, 0, 'el que está lejos no cobra');
        const bone = drop('old_bone', 1); W.pickupLoot(A, bone.lootId);
        assert.equal((A.econ!.mats!.old_bone ?? 0) + (B.econ!.mats!.old_bone ?? 0), 1, 'el material le toca a uno de los dos');
        B.hp = 0; const g2 = drop('gold', 10); W.pickupLoot(A, g2.lootId);
        assert.equal(A.econ!.gold + B.econ!.gold, 31); assert.ok(A.econ!.gold >= 20, 'el muerto no entra en el reparto');
    } finally { setParties(undefined); }
});
