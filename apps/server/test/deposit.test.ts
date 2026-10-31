// Pruebas del depósito por cuenta. Correr: cd apps/server && npx tsx --test test/deposit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BAG_MAX, DEPOT_SLOTS, DEPOT_STACK_MAX, MAT_MAX, POT_MAX, buildSolmar, roleOf } from '@fdn/world';
import type { DepositRequest } from '@fdn/proto';
import { Depot, DEPOT_OPS_KEEP, type Actor } from '../src/deposit.ts';
import { MAX_GOLD, newEcon, type Econ, type EconCtx } from '../src/economy.ts';
import { FileStorage, type AccountRecord, type Storage } from '../src/storage.ts';
import type { Player } from '../src/player.ts';

class MemStorage implements Storage {
    data = new Map<string, AccountRecord>(); flushes = 0; puts: string[] = [];
    get(k: string) { return this.data.get(k); }
    put(k: string, r: AccountRecord) { this.data.set(k, r); this.puts.push(k); }
    flush() { this.flushes++; }
}

function setup() {
    const storage = new MemStorage();
    const mk = (key: string, name: string, gold = 1000): Actor => {
        const econ = newEcon('guerrero', 'solmar'); econ.gold = gold; econ.bag = [];
        storage.put(key, { name, salt: '', hash: '', created: 0, lastLogin: 0, econ });
        return { key, name, econ };
    };
    const dp = new Depot(storage); dp.log = () => {};
    return { storage, dp, mk };
}
const give = (e: Econ, n = 'Espada larga', r = 2): number => { const u = e.nextUid++; e.bag.push({ u, n, r, a: [{ id: 'crit', v: 4 }, { id: 'hp', v: 17 }] }); return u; };
const req = (o: Partial<DepositRequest>): DepositRequest => ({ npcId: '', action: 'open', uid: 0, amount: 0, stack: '', opId: 0, ...o });

test('depositar y retirar un item: sale de un lado, entra en el otro con rareza y atributos intactos', () => {
    const { dp, mk, storage } = setup(); const a = mk('aa', 'Ana');
    const u = give(a.econ, 'Mandoble', 3);
    const r = dp.put(a, u);
    assert.equal(r.ok, true, r.text);
    assert.equal(a.econ.bag.length, 0);
    const v = dp.vault('aa');
    assert.equal(v.items.length, 1);
    assert.deepEqual({ n: v.items[0].n, r: v.items[0].r, a: v.items[0].a }, { n: 'Mandoble', r: 3, a: [{ id: 'crit', v: 4 }, { id: 'hp', v: 17 }] });
    // el depósito vive dentro del registro de la cuenta (una sola escritura con la bolsa)
    assert.equal((storage.get('aa') as AccountRecord & { vault?: unknown }).vault, v);
    assert.ok(storage.flushes >= 1);
    // retirar: uid nuevo del personaje, mismos datos
    const back = dp.take(a, v.items[0].u);
    assert.equal(back.ok, true, back.text);
    assert.equal(v.items.length, 0); assert.equal(a.econ.bag.length, 1);
    assert.deepEqual({ n: a.econ.bag[0].n, r: a.econ.bag[0].r, a: a.econ.bag[0].a }, { n: 'Mandoble', r: 3, a: [{ id: 'crit', v: 4 }, { id: 'hp', v: 17 }] });
    assert.notEqual(a.econ.bag[0].u, u);
});

test('propiedad: no se guarda lo que no está en tu bolsa ni se retira lo que no está en tu depósito', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana'), b = mk('bb', 'Beto');
    const u = give(a.econ);
    assert.equal(dp.put(b, u).code, 'no_item'); // uid de otro
    assert.equal(dp.put(a, 999).code, 'no_item');
    assert.equal(dp.put(a, u).ok, true);
    const du = dp.vault('aa').items[0].u;
    assert.equal(dp.take(b, du).code, 'gone'); // el depósito de Beto está vacío
    assert.equal(dp.vault('aa').items.length, 1); assert.equal(b.econ.bag.length, 0);
});

test('sin lugar: depósito lleno (48) y bolsa llena (18) se rechazan sin mover nada', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana');
    for (let i = 0; i < DEPOT_SLOTS; i++) { assert.equal(dp.put(a, give(a.econ)).ok, true); }
    assert.equal(dp.vault('aa').items.length, DEPOT_SLOTS);
    const u = give(a.econ);
    const r = dp.put(a, u);
    assert.equal(r.code, 'depot_full'); assert.match(r.text, /48/);
    assert.equal(a.econ.bag.length, 1);
    while (a.econ.bag.length < BAG_MAX) give(a.econ);
    const r2 = dp.take(a, dp.vault('aa').items[0].u);
    assert.equal(r2.code, 'bag_full');
    assert.equal(a.econ.bag.length, BAG_MAX); assert.equal(dp.vault('aa').items.length, DEPOT_SLOTS);
});

test('oro: depositar y retirar, montos inválidos, sin oro suficiente y techo técnico', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana', 500);
    assert.equal(dp.goldIn(a, 200).ok, true);
    assert.equal(a.econ.gold, 300); assert.equal(dp.vault('aa').gold, 200);
    for (const bad of [0, -5, 1.5, NaN, Infinity, '10', undefined, MAX_GOLD + 2]) {
        assert.equal(dp.goldIn(a, bad).code, 'bad_amount', String(bad));
        assert.equal(dp.goldOut(a, bad).code, 'bad_amount', String(bad));
    }
    assert.equal(dp.goldIn(a, 301).code, 'gold');
    assert.equal(dp.goldOut(a, 201).code, 'depot_gold');
    assert.equal(a.econ.gold, 300); assert.equal(dp.vault('aa').gold, 200);
    assert.equal(dp.goldOut(a, 200).ok, true);
    assert.equal(a.econ.gold, 500); assert.equal(dp.vault('aa').gold, 0);
    // oro grande (sin tope de juego): exacto
    a.econ.gold = MAX_GOLD; assert.equal(dp.goldIn(a, MAX_GOLD).ok, true);
    assert.equal(dp.vault('aa').gold, MAX_GOLD); assert.equal(a.econ.gold, 0);
    a.econ.gold = 1; assert.equal(dp.goldIn(a, 1).code, 'depot_gold_max'); // no se pierde oro por desborde
    assert.equal(dp.goldOut(a, 5).ok, true); a.econ.gold = MAX_GOLD; assert.equal(dp.goldOut(a, 1).code, 'gold_max');
});

test('pociones, llaves y esquirlas: stacks con topes (POT_MAX encima, DEPOT_STACK_MAX en el depósito)', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana');
    a.econ.pots = { hp: 10, mp: 3 }; a.econ.q.keys.cripta = 2; a.econ.q.shards.foso = 5;
    assert.equal(dp.stackIn(a, 'pot_hp', 7).ok, true);
    assert.equal(a.econ.pots.hp, 3); assert.equal(dp.vault('aa').stacks.pot_hp, 7);
    assert.equal(dp.stackIn(a, 'pot_mp', 4).code, 'no_stack');
    assert.equal(dp.stackIn(a, 'pot_xx', 1).code, 'bad_stack');
    assert.equal(dp.stackIn(a, 'pot_mp', 0).code, 'bad_amount');
    assert.equal(dp.stackIn(a, 'key_cripta', 2).ok, true); assert.equal(a.econ.q.keys.cripta, 0);
    assert.equal(dp.stackIn(a, 'shard_foso', 5).ok, true); assert.equal(a.econ.q.shards.foso, 0);
    // retirar sin pasarse del tope que se puede llevar
    a.econ.pots.hp = POT_MAX - 2;
    const over = dp.stackOut(a, 'pot_hp', 3);
    assert.equal(over.code, 'carry_max'); assert.match(over.text, /podés retirar 2/);
    assert.equal(dp.stackOut(a, 'pot_hp', 2).ok, true); assert.equal(a.econ.pots.hp, POT_MAX); assert.equal(dp.vault('aa').stacks.pot_hp, 5);
    assert.equal(dp.stackOut(a, 'pot_hp', 6).code, 'no_stack');
    a.econ.q.keys.cripta = MAT_MAX; assert.equal(dp.stackOut(a, 'key_cripta', 1).code, 'carry_max');
    a.econ.q.keys.cripta = 0; assert.equal(dp.stackOut(a, 'key_cripta', 2).ok, true); assert.equal(a.econ.q.keys.cripta, 2);
    assert.equal(dp.vault('aa').stacks.key_cripta, undefined); // stack vacío: se borra
    // tope del depósito
    dp.vault('aa').stacks.pot_mp = DEPOT_STACK_MAX - 1; a.econ.pots.mp = 3;
    assert.equal(dp.stackIn(a, 'pot_mp', 2).code, 'stack_full');
    assert.equal(dp.stackIn(a, 'pot_mp', 1).ok, true);
});

test('doble envío: el mismo uid dos veces solo se mueve una vez; el mismo op_id no se repite (ni el oro)', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana', 1000);
    const u = give(a.econ);
    assert.equal(dp.apply(a, req({ action: 'put', uid: u, opId: 7 }))!.ok, true);
    assert.equal(dp.apply(a, req({ action: 'put', uid: u, opId: 8 }))!.code, 'no_item'); // ya no está
    assert.equal(dp.vault('aa').items.length, 1);
    // oro: el mismo pedido reenviado (mismo op_id) no deposita dos veces
    assert.equal(dp.apply(a, req({ action: 'gold_in', amount: 100, opId: 9 }))!.ok, true);
    const dup = dp.apply(a, req({ action: 'gold_in', amount: 100, opId: 9 }))!;
    assert.equal(dup.code, 'dup');
    assert.equal(a.econ.gold, 900); assert.equal(dp.vault('aa').gold, 100);
    // un pedido que falló no "gasta" el número: se puede reintentar
    assert.equal(dp.apply(a, req({ action: 'gold_out', amount: 5000, opId: 10 }))!.code, 'depot_gold');
    assert.equal(dp.apply(a, req({ action: 'gold_out', amount: 50, opId: 10 }))!.ok, true);
    // solo se recuerdan los últimos
    for (let i = 0; i < DEPOT_OPS_KEEP + 5; i++) dp.apply(a, req({ action: 'sort', opId: 1000 + i }));
    assert.equal(dp.vault('aa').ops.length, DEPOT_OPS_KEEP);
});

test('ordenar: por tipo, rareza y nombre', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana');
    for (const [n, r] of [['Anillo opaco', 0], ['Maza', 0], ['Mandoble', 3], ['Yelmo de hierro', 1]] as const) dp.put(a, give(a.econ, n, r));
    assert.equal(dp.sort(a).ok, true);
    assert.deepEqual(dp.vault('aa').items.map((i) => i.n), ['Mandoble', 'Maza', 'Yelmo de hierro', 'Anillo opaco']);
});

test('persistencia tras reinicio (archivos): bolsa y depósito quedan en el mismo archivo de la cuenta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fdn-dep-'));
    const st1 = new FileStorage(dir, 10_000);
    const econ = newEcon('guerrero', 'solmar'); econ.gold = 500; econ.bag = [{ u: 50, n: 'Maza', r: 2, a: [{ id: 'hp', v: 9 }, { id: 'crit', v: 3 }] }]; econ.nextUid = 51; econ.pots = { hp: 9, mp: 0 };
    st1.put('aa', { name: 'A', salt: '', hash: '', created: 0, lastLogin: 0, econ });
    const d1 = new Depot(st1); d1.log = () => {};
    const a: Actor = { key: 'aa', name: 'A', econ };
    assert.equal(d1.apply(a, req({ action: 'put', uid: 50, opId: 1 }))!.ok, true);
    assert.equal(d1.apply(a, req({ action: 'gold_in', amount: 123, opId: 2 }))!.ok, true);
    assert.equal(d1.apply(a, req({ action: 'stack_in', stack: 'pot_hp', amount: 4, opId: 3 }))!.ok, true);
    // un solo archivo por cuenta (no hay registro aparte del depósito)
    assert.deepEqual(readdirSync(join(dir, 'accounts')).filter((f) => f.endsWith('.json')), ['aa.json']);
    const raw = JSON.parse(readFileSync(join(dir, 'accounts', 'aa.json'), 'utf8'));
    assert.equal(raw.vault.items.length, 1); assert.equal(raw.econ.bag.length, 0);
    // "otro proceso": lee de disco (se forzó el flush aunque el debounce era de 10 s)
    const st2 = new FileStorage(dir);
    const d2 = new Depot(st2); d2.log = () => {};
    const v = d2.vault('aa'), e2 = st2.get('aa')!.econ!;
    assert.deepEqual(v.items.map((i) => ({ n: i.n, r: i.r, a: i.a })), [{ n: 'Maza', r: 2, a: [{ id: 'hp', v: 9 }, { id: 'crit', v: 3 }] }]);
    assert.equal(v.gold, 123); assert.equal(v.stacks.pot_hp, 4);
    assert.equal(e2.bag.length, 0); assert.equal(e2.gold, 377); assert.equal(e2.pots.hp, 5);
    // el op_id ya aplicado tampoco se repite después del reinicio
    const a2: Actor = { key: 'aa', name: 'A', econ: e2 };
    assert.equal(d2.apply(a2, req({ action: 'gold_in', amount: 123, opId: 2 }))!.code, 'dup');
    assert.equal(e2.gold, 377);
    // y se puede retirar todo
    assert.equal(d2.take(a2, v.items[0].u).ok, true); assert.equal(d2.goldOut(a2, 123).ok, true);
    const st3 = new FileStorage(dir), e3 = st3.get('aa')!.econ!;
    assert.equal(e3.bag[0].n, 'Maza'); assert.equal(e3.gold, 500);
});

test('el depósito es de la cuenta: un personaje nuevo de la misma cuenta lo ve igual', () => {
    const { dp, mk, storage } = setup(); const a = mk('aa', 'Ana');
    dp.put(a, give(a.econ, 'Varita', 1)); dp.goldIn(a, 10);
    const other: Actor = { key: 'aa', name: 'Ana', econ: newEcon('mago', 'vhar') }; // otro personaje, misma cuenta
    storage.get('aa')!.econ = other.econ;
    other.econ.bag = [];
    assert.equal(dp.take(other, dp.vault('aa').items[0].u).ok, true);
    assert.equal(other.econ.bag[0].n, 'Varita');
    assert.equal(dp.goldOut(other, 10).ok, true);
});

test('red: rol de depositario (no posición), distancia, muerto, cruce de mapa y ritmo', () => {
    const { dp, mk } = setup(); const a = mk('aa', 'Ana');
    const npcs = buildSolmar().npcs, deps = npcs.filter((n) => roleOf(n) === 'depositario');
    assert.equal(deps.length, 2); // Solmar y Vhar en el mapa viejo
    const dep = deps[0];
    const sent: { $case?: string; value?: { ok?: boolean; text?: string; code?: string; items?: unknown[]; gold?: number } }[] = [];
    const p = { econ: a.econ, accountKey: 'aa', characterName: 'Ana', disconnected: false, isDead: false, world: {}, posX: dep.x + 1, posY: dep.y, send: (m: { payload?: unknown }) => sent.push(m.payload as never) } as unknown as Player;
    const ctx = { npcs, restat: () => {}, ground: {} } as unknown as EconCtx;
    const u = give(a.econ);
    dp.handle(p, ctx, req({ npcId: dep.id, action: 'put', uid: u, opId: 1 }));
    assert.equal(sent[0].$case, 'econResult'); assert.equal(sent[0].value!.ok, true);
    assert.ok(sent.some((m) => m.$case === 'inventoryState'));
    const ds = sent.find((m) => m.$case === 'depositState')!; assert.equal(ds.value!.items!.length, 1);
    // un NPC cualquiera con rol depositario y otro id (por ejemplo el de la ciudad nueva) también sirve
    sent.length = 0;
    dp.handle(p, ctx, req({ npcId: dep.id, action: 'open' }));
    assert.equal(sent[0].$case, 'depositState');
    const fake = { ...dep, id: 'depositario_s9', x: 40, y: 40 };
    (p as { posX: number; posY: number }).posX = 40; (p as { posY: number }).posY = 41;
    sent.length = 0; dp.handle(p, { ...ctx, npcs: [...npcs, fake] } as EconCtx, req({ npcId: fake.id, action: 'open' }));
    assert.equal(sent[0].$case, 'depositState');
    // lejos
    sent.length = 0; (p as { posX: number }).posX = dep.x + 10; (p as { posY: number }).posY = dep.y;
    dp.handle(p, ctx, req({ npcId: dep.id, action: 'gold_in', amount: 5 }));
    assert.match(sent[0].value!.text!, /lejos del Depositario/); assert.equal(a.econ.gold, 1000);
    // otro NPC (no depositario) no sirve aunque esté cerca
    const arm = npcs.find((n) => roleOf(n) === 'armero')!;
    (p as { posX: number }).posX = arm.x; (p as { posY: number }).posY = arm.y + 1;
    sent.length = 0; dp.handle(p, ctx, req({ npcId: arm.id, action: 'open' }));
    assert.match(sent[0].value!.text!, /lejos del Depositario/);
    // NPC de otro mapa (no está en el mundo del jugador)
    sent.length = 0; dp.handle(p, { ...ctx, npcs: npcs.filter((n) => n.id !== dep.id) } as EconCtx, req({ npcId: dep.id, action: 'open' }));
    assert.match(sent[0].value!.text!, /lejos/);
    // muerto / cruzando de mapa
    (p as { posX: number }).posX = dep.x + 1; (p as { posY: number }).posY = dep.y;
    (p as { isDead: boolean }).isDead = true; sent.length = 0; dp.handle(p, ctx, req({ npcId: dep.id, action: 'gold_in', amount: 5 }));
    assert.equal(sent[0].value!.code, 'dead');
    (p as { isDead: boolean }).isDead = false; (p as { world: unknown }).world = null;
    sent.length = 0; dp.handle(p, ctx, req({ npcId: dep.id, action: 'gold_in', amount: 5 }));
    assert.equal(sent[0].value!.code, 'transit'); assert.equal(a.econ.gold, 1000);
    // ritmo: una ráfaga larga termina en "más despacio"
    (p as { world: unknown }).world = {}; sent.length = 0;
    for (let i = 0; i < 40; i++) dp.handle(p, ctx, req({ npcId: dep.id, action: 'open' }));
    assert.ok(sent.some((m) => m.value?.code === 'slow'));
});

test('el NPC Depositario del mapa viejo no bloquea portales ni pisa a otro NPC', () => {
    const w = buildSolmar();
    const deps = w.npcs.filter((n) => roleOf(n) === 'depositario');
    for (const d of deps) {
        assert.equal(w.npcs.filter((n) => n.x === d.x && n.y === d.y).length, 1);
        assert.ok(!(w.portals ?? []).some((q) => q.x === d.x && q.y === d.y));
        // tiene al menos una celda vecina caminable para hablarle
        assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !w.blocked[d.y + dy][d.x + dx]));
    }
});
