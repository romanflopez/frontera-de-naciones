// Pruebas de la casa de subastas (núcleo sin red). Correr: cd apps/server && npx tsx --test test/auction.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AH_DURATION_MS, AH_MAX_LISTINGS, AH_PAGE_SIZE, AH_PRICE_MAX, BAG_MAX, buildSolmar, roleOf } from '@fdn/world';
import { AH_STORAGE_KEY, AuctionHouse, type Actor } from '../src/auction.ts';
import { newEcon, type Econ, type EconCtx } from '../src/economy.ts';
import { FileStorage, type AccountRecord, type Storage } from '../src/storage.ts';
import type { Player } from '../src/player.ts';

class MemStorage implements Storage {
    data = new Map<string, AccountRecord>(); flushes = 0;
    get(k: string) { return this.data.get(k); }
    put(k: string, r: AccountRecord) { this.data.set(k, r); }
    flush() { this.flushes++; }
}

function setup(now = { t: 1_000_000 }) {
    const storage = new MemStorage();
    const mk = (key: string, name: string, gold = 1000): Actor => {
        const econ = newEcon('guerrero', 'solmar'); econ.gold = gold; econ.bag = [];
        storage.put(key, { name, salt: '', hash: '', created: 0, lastLogin: 0, econ });
        return { key, name, econ };
    };
    const ah = new AuctionHouse(storage, () => now.t); ah.log = () => {};
    return { storage, ah, mk, now };
}
const give = (e: Econ, n = 'Espada larga', r = 2): number => { const u = e.nextUid++; e.bag.push({ u, n, r, a: [{ id: 'crit', v: 4 }] }); return u; };
const mailGold = (ah: AuctionHouse, key: string) => ah.mailbox(key).reduce((s, m) => s + (m.gold ?? 0), 0);

test('publicar: el item sale de la bolsa, se cobra la tasa (2 %, mínimo 1) y queda en custodia', () => {
    const { ah, mk, storage } = setup(); const s = mk('aa', 'Vendedor');
    const u = give(s.econ);
    const r = ah.post(s, u, 1000);
    assert.equal(r.ok, true, r.text);
    assert.equal(s.econ.bag.length, 0);
    assert.equal(s.econ.gold, 1000 - 20);
    assert.equal(ah.listings.length, 1);
    assert.equal(ah.listings[0].item.n, 'Espada larga');
    assert.equal(ah.listings[0].expires - ah.listings[0].created, AH_DURATION_MS);
    // tasa mínima de 1 en precios chicos
    const u2 = give(s.econ); assert.equal(ah.post(s, u2, 10).ok, true); assert.equal(s.econ.gold, 1000 - 20 - 1);
    // se guardó junto con la cuenta
    assert.ok(storage.get(AH_STORAGE_KEY));
    assert.ok(storage.flushes >= 2);
});

test('publicar: validaciones (precio, propiedad, oro para la tasa, límite de publicaciones)', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor', 5), o = mk('bb', 'Otro');
    const u = give(s.econ);
    for (const bad of [0, -5, 1.5, NaN, Infinity, AH_PRICE_MAX + 1]) assert.equal(ah.post(s, u, bad).code, 'bad_price', String(bad));
    assert.equal(ah.post(s, 999, 100).code, 'no_item');
    assert.equal(ah.post(o, u, 100).code, 'no_item'); // el uid de otro: no está en su bolsa
    assert.equal(ah.post(s, u, 1000).code, 'gold'); // tasa 20 > 5 de oro
    assert.equal(s.econ.bag.length, 1); assert.equal(s.econ.gold, 5); // nada cambió
    s.econ.gold = 100000;
    for (let i = 0; i < AH_MAX_LISTINGS; i++) assert.equal(ah.post(s, give(s.econ), 100).ok, true);
    assert.equal(ah.post(s, u, 100).code, 'max_listings');
    assert.equal(ah.post(s, u, AH_PRICE_MAX - 1 + 1).code, 'max_listings');
});

test('cancelar: solo el dueño; el item va al buzón (no a la bolsa) y la tasa no se devuelve', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor'), o = mk('bb', 'Otro');
    ah.post(s, give(s.econ), 500); const id = ah.listings[0].id, goldAfter = s.econ.gold;
    assert.equal(ah.cancel(o, id).code, 'not_owner');
    assert.equal(ah.cancel(s, id).ok, true);
    assert.equal(ah.listings.length, 0);
    assert.equal(s.econ.bag.length, 0);
    assert.equal(s.econ.gold, goldAfter);
    assert.equal(ah.mailbox('aa').length, 1);
    assert.equal(ah.cancel(s, id).code, 'gone');
    // retirar del buzón: vuelve con uid nuevo y los mismos atributos
    assert.equal(ah.claim(s, 0).ok, true);
    assert.equal(s.econ.bag.length, 1); assert.deepEqual(s.econ.bag[0].a, [{ id: 'crit', v: 4 }]);
    assert.equal(ah.mailbox('aa').length, 0);
});

test('vencer: el barrido devuelve el item al buzón a las 48 h y ya no se puede comprar', () => {
    const { ah, mk, now } = setup(); const s = mk('aa', 'Vendedor'), b = mk('bb', 'Comprador');
    ah.post(s, give(s.econ), 300); const id = ah.listings[0].id;
    now.t += AH_DURATION_MS - 1; assert.equal(ah.sweep(), 0); assert.equal(ah.search({}).total, 1);
    now.t += 1;
    assert.equal(ah.search({}).total, 0); // vencida no aparece aunque el barrido no haya pasado
    assert.equal(ah.buy(b, id).code, 'gone'); // y no se puede comprar (el intento la vence)
    assert.equal(b.econ.gold, 1000);
    assert.equal(ah.listings.length, 0);
    assert.equal(ah.mailbox('aa').filter((m) => m.item).length, 1);
    assert.equal(ah.sweep(), 0);
});

test('comprar: paga el precio, el item va a la bolsa y el neto (95 %) al buzón del vendedor aunque esté desconectado', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor'), b = mk('bb', 'Comprador');
    ah.post(s, give(s.econ, 'Mandoble', 3), 1000); const id = ah.listings[0].id;
    const sellerGold = s.econ.gold;
    const r = ah.buy(b, id);
    assert.equal(r.ok, true, r.text);
    assert.equal(b.econ.gold, 0);
    assert.equal(b.econ.bag.length, 1); assert.equal(b.econ.bag[0].n, 'Mandoble'); assert.equal(b.econ.bag[0].r, 3);
    assert.equal(s.econ.gold, sellerGold); // el oro no va directo: va al buzón
    assert.equal(mailGold(ah, 'aa'), 950);
    assert.equal(ah.claim(s, 0).ok, true); assert.equal(s.econ.gold, sellerGold + 950);
    assert.equal(ah.listings.length, 0);
});

test('comisión y tasas en precios chicos y grandes', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'V', 1_000_000), b = mk('bb', 'C', 2_000_000);
    ah.post(s, give(s.econ), 1); assert.equal(s.econ.gold, 1_000_000 - 1);
    ah.buy(b, ah.listings[0].id); assert.equal(mailGold(ah, 'aa'), 1); // 5 % de 1 = 0
    ah.claim(s, 0);
    ah.post(s, give(s.econ), AH_PRICE_MAX); assert.equal(s.econ.gold, 1_000_000 - 1 + 1 - 20000);
    ah.buy(b, ah.listings[0].id); assert.equal(mailGold(ah, 'aa'), AH_PRICE_MAX - 50000);
    assert.equal(b.econ.gold, 2_000_000 - 1 - AH_PRICE_MAX);
});

test('comprar sin lugar en la bolsa: se rechaza antes de cobrar', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor'), b = mk('bb', 'Comprador');
    ah.post(s, give(s.econ), 100); const id = ah.listings[0].id;
    for (let i = 0; i < BAG_MAX; i++) give(b.econ, 'Maza', 0);
    assert.equal(ah.buy(b, id).code, 'bag_full');
    assert.equal(b.econ.gold, 1000); assert.equal(b.econ.bag.length, BAG_MAX);
    assert.equal(ah.listings.length, 1); assert.equal(ah.mailbox('aa').length, 0);
});

test('comprar sin oro suficiente / tu propia publicación / una que no existe', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor'), b = mk('bb', 'Comprador', 99);
    ah.post(s, give(s.econ), 100); const id = ah.listings[0].id;
    assert.equal(ah.buy(b, id).code, 'gold'); assert.equal(b.econ.gold, 99); assert.equal(b.econ.bag.length, 0);
    assert.equal(ah.buy(s, id).code, 'own');
    assert.equal(ah.buy(b, 12345).code, 'gone');
    assert.equal(ah.listings.length, 1);
});

test('doble compra concurrente: uno solo gana, el otro no paga nada', async () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor'), b1 = mk('b1', 'Uno'), b2 = mk('b2', 'Dos');
    ah.post(s, give(s.econ), 400); const id = ah.listings[0].id;
    const res = await Promise.all([b1, b2].map((b) => Promise.resolve().then(() => ah.buy(b, id))));
    assert.deepEqual(res.map((r) => r.ok).sort(), [false, true]);
    assert.equal(res.find((r) => !r.ok)!.code, 'gone');
    assert.equal(b1.econ.bag.length + b2.econ.bag.length, 1);
    assert.equal(b1.econ.gold + b2.econ.gold, 2000 - 400);
    assert.equal(mailGold(ah, 'aa'), 380);
    // y el vendedor no puede cancelar algo ya vendido
    assert.equal(ah.cancel(s, id).code, 'gone');
});

test('buzón: retirar uno, retirar todo con la bolsa casi llena, el oro siempre entra', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor', 10000), b = mk('bb', 'Comprador', 10000);
    ah.post(s, give(s.econ), 100); ah.post(s, give(s.econ), 200); ah.post(s, give(s.econ), 300);
    const [l1, l2, l3] = ah.listings;
    ah.buy(b, l1.id); ah.cancel(s, l2.id); ah.cancel(s, l3.id);
    assert.equal(ah.mailbox('aa').length, 3);
    for (let i = s.econ.bag.length; i < BAG_MAX - 1; i++) give(s.econ, 'Maza', 0); // queda 1 lugar
    const g0 = s.econ.gold;
    const r = ah.claim(s, 0);
    assert.equal(r.ok, true); assert.match(r.text, /Quedan 1/);
    assert.equal(s.econ.gold, g0 + 95); assert.equal(s.econ.bag.length, BAG_MAX);
    assert.equal(ah.mailbox('aa').length, 1);
    assert.equal(ah.claim(s, 0).code, 'bag_full');
    s.econ.bag.pop();
    const last = ah.mailbox('aa')[0].id;
    assert.equal(ah.claim(b, last).code, 'gone'); // el buzón es de cada uno
    assert.equal(ah.claim(s, last).ok, true);
    assert.equal(ah.claim(s, 0).code, 'empty');
});

test('búsqueda: filtros por slot, rareza, texto, nivel, precio, orden y páginas de 20', () => {
    const { ah, mk, now } = setup(); const s = mk('aa', 'V', 1e6), t = mk('cc', 'W', 1e6);
    const put = (a: Actor, n: string, r: number, price: number) => { now.t += 1000; assert.equal(ah.post(a, give(a.econ, n, r), price).ok, true); };
    put(s, 'Espada corta', 0, 50); put(s, 'Mandoble', 3, 5000); put(s, 'Yelmo de hierro', 1, 300); put(s, 'Anillo opaco', 2, 80); put(s, 'Túnica de mago', 0, 120);
    assert.deepEqual(ah.search({ slot: 'arma' }).listings.map((l) => l.item.n), ['Espada corta', 'Mandoble']);
    assert.deepEqual(ah.search({ rarity: 4 }).listings.map((l) => l.item.n), ['Mandoble']); // 4 = Épico (0 = todas)
    assert.deepEqual(ah.search({ rarity: 1 }).listings.map((l) => l.item.n), ['Espada corta', 'Túnica de mago']);
    assert.deepEqual(ah.search({ text: 'TUNICA' }).listings.map((l) => l.item.n), ['Túnica de mago']); // sin tildes ni mayúsculas
    assert.deepEqual(ah.search({ lvlMin: 6 }).listings.map((l) => l.item.n), ['Yelmo de hierro', 'Mandoble']); // Yelmo Nv 6, Mandoble Nv 10
    assert.deepEqual(ah.search({ lvlMax: 1 }).listings.map((l) => l.item.n), ['Espada corta', 'Anillo opaco']);
    assert.deepEqual(ah.search({ maxPrice: 100 }).listings.map((l) => l.price), [50, 80]);
    assert.deepEqual(ah.search({ sort: 'price_desc' }).listings.map((l) => l.price), [5000, 300, 120, 80, 50]);
    assert.deepEqual(ah.search({ sort: 'time_asc' }).listings.map((l) => l.item.n)[0], 'Espada corta');
    assert.deepEqual(ah.search({ sort: 'time_desc' }).listings.map((l) => l.item.n)[0], 'Túnica de mago');
    assert.equal(ah.search({ slot: 'nada', sort: 'raro' }).total, 5); // filtros inválidos: se ignoran
    // paginado del lado del server
    for (let i = 0; i < 5; i++) put(s, 'Maza', 0, 1000 + i);
    for (let i = 0; i < 10; i++) put(t, 'Maza', 0, 2000 + i);
    for (let i = 0; i < 10; i++) { t.econ.gold = 1e6; }
    const all = ah.search({}); assert.equal(all.total, 20); assert.equal(all.pages, 1);
    const u = mk('dd', 'X', 1e6); for (let i = 0; i < 3; i++) put(u, 'Maza', 0, 3000 + i);
    const p0 = ah.search({ page: 0 }), p1 = ah.search({ page: 1 }), p9 = ah.search({ page: 9 });
    assert.equal(p0.listings.length, AH_PAGE_SIZE); assert.equal(p1.listings.length, 3); assert.equal(p0.pages, 2);
    assert.equal(p9.page, 1); // página fuera de rango: la última
    assert.ok(p0.listings.every((l, i, a) => !i || a[i - 1].price <= l.price));
});

test('persistencia: al reiniciar (archivos) no se pierde nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fdn-ah-'));
    const st1 = new FileStorage(dir, 10_000);
    const econ = newEcon('guerrero', 'solmar'); econ.gold = 500; econ.bag = [{ u: 99, n: 'Maza', r: 1, a: [{ id: 'hp', v: 9 }] }]; econ.nextUid = 100;
    st1.put('aa', { name: 'V', salt: '', hash: '', created: 0, lastLogin: 0, econ });
    const ah1 = new AuctionHouse(st1); ah1.log = () => {};
    const ah1b = new AuctionHouse(st1); void ah1b;
    assert.equal(ah1.post({ key: 'aa', name: 'V', econ }, 99, 250).ok, true);
    ah1.post({ key: 'aa', name: 'V', econ }, 99, 250); // ya no está
    // otro proceso: lee de disco (se forzó el flush, aunque el debounce era de 10 s)
    const st2 = new FileStorage(dir);
    const ah2 = new AuctionHouse(st2); ah2.log = () => {};
    assert.equal(ah2.listings.length, 1); assert.equal(ah2.listings[0].item.n, 'Maza');
    assert.equal(st2.get('aa')!.econ!.bag.length, 0); assert.equal(st2.get('aa')!.econ!.gold, 495);
});

test('red: valida distancia al Subastador y manda resultado + estado', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor');
    const npcs = buildSolmar().npcs, sub = npcs.find((n) => roleOf(n) === 'subastador')!;
    assert.ok(npcs.filter((n) => roleOf(n) === 'subastador').length === 2);
    const sent: { $case?: string; value?: { ok?: boolean; text?: string } }[] = [];
    const p = { econ: s.econ, accountKey: 'aa', characterName: 'Vendedor', disconnected: false, isDead: false, posX: sub.x + 1, posY: sub.y, send: (m: { payload?: unknown }) => sent.push(m.payload as never) } as unknown as Player;
    const ctx = { npcs, restat: () => {}, ground: {} } as unknown as EconCtx;
    const u = give(s.econ);
    const req = (o: object) => ({ npcId: sub.id, action: 'post', query: undefined, uid: 0, price: 0, listingId: 0, mailId: 0, ...o });
    ah.handle(p, ctx, req({ uid: u, price: 100 }));
    assert.equal(sent[0].$case, 'econResult'); assert.equal(sent[0].value!.ok, true);
    assert.ok(sent.some((m) => m.$case === 'inventoryState')); assert.ok(sent.some((m) => m.$case === 'auctionMyState'));
    sent.length = 0;
    (p as { posX: number }).posX = sub.x + 10;
    ah.handle(p, ctx, req({ action: 'open' }));
    assert.equal(sent[0].$case, 'econResult'); assert.match(sent[0].value!.text!, /lejos/);
    sent.length = 0;
    (p as { posX: number }).posX = sub.x;
    ah.handle(p, ctx, req({ npcId: npcs.find((n) => roleOf(n) === 'armero')!.id, action: 'open' }));
    assert.match(sent[0].value!.text!, /lejos del Subastador/); // otro NPC no sirve
});

// ---------- historial ----------
const kinds = (ah: AuctionHouse, key: string) => ah.history(key).map((h) => h.kind);

test('historial: registra publicar, comprar, vender, retirar, vencer y retirar del buzón con sus montos', () => {
    const { ah, mk, now } = setup(); const s = mk('aa', 'Vendedor'), b = mk('bb', 'Comprador', 5000);
    ah.post(s, give(s.econ, 'Espada larga'), 1000);            // post: -20
    ah.post(s, give(s.econ, 'Maza'), 300);                     // post: -6
    ah.post(s, give(s.econ, 'Espada corta'), 50);                      // post: -1
    const [l1, l2, l3] = ah.listings.map((l) => l.id);
    assert.equal(ah.buy(b, l1).ok, true);                      // buy -1000 (comprador) / sell +950 (vendedor)
    assert.equal(ah.cancel(s, l2).ok, true);                   // cancel 0
    now.t += AH_DURATION_MS + 1; assert.equal(ah.sweep(), 1); void l3; // expire 0
    assert.equal(ah.claim(s, 0).ok, true);                     // claim: oro 950 + 2 items
    const hs = ah.history('aa');
    assert.deepEqual(hs.map((h) => h.kind), ['claim', 'claim', 'claim', 'expire', 'cancel', 'sell', 'post', 'post', 'post']);
    const sell = hs.find((h) => h.kind === 'sell')!;
    assert.equal(sell.amount, 950); assert.equal(sell.price, 1000); assert.equal(sell.fee, 50); assert.equal(sell.other, 'Comprador'); assert.equal(sell.item!.n, 'Espada larga');
    assert.deepEqual(hs.filter((h) => h.kind === 'post').map((h) => h.amount), [-1, -6, -20]);
    assert.equal(hs.find((h) => h.kind === 'cancel')!.item!.n, 'Maza');
    assert.equal(hs.find((h) => h.kind === 'expire')!.item!.n, 'Espada corta');
    const claims = hs.filter((h) => h.kind === 'claim');
    assert.equal(claims.reduce((t, h) => t + h.amount, 0), 950);
    assert.deepEqual(claims.filter((h) => h.item).map((h) => h.item!.n).sort(), ['Espada corta', 'Maza']);
    // el comprador solo tiene su compra
    assert.deepEqual(kinds(ah, 'bb'), ['buy']);
    const buy = ah.history('bb')[0]; assert.equal(buy.amount, -1000); assert.equal(buy.other, 'Vendedor');
    // del más nuevo al más viejo
    assert.ok(hs.every((h, i) => !i || hs[i - 1].id > h.id));
});

test('historial: las acciones rechazadas no dejan entradas', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor', 0), b = mk('bb', 'Comprador', 0);
    assert.equal(ah.post(s, give(s.econ), 1000).ok, false); // sin oro para la tasa
    s.econ.gold = 100; ah.post(s, give(s.econ), 1000);
    assert.equal(ah.buy(b, ah.listings[0].id).ok, false);    // sin oro
    assert.equal(ah.cancel(b, ah.listings[0].id).ok, false); // no es suya
    assert.equal(ah.claim(b, 0).ok, false);                  // buzón vacío
    assert.deepEqual(kinds(ah, 'aa'), ['post']);
    assert.deepEqual(kinds(ah, 'bb'), []);
});

test('historial: tope de entradas por cuenta (se descartan las más viejas)', async () => {
    const { AH_HISTORY_MAX } = await import('@fdn/world');
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor', 1_000_000);
    for (let i = 0; i < 70; i++) { // 3 entradas por vuelta: 210
        assert.equal(ah.post(s, s.econ.bag[0]?.u ?? give(s.econ), 100 + i).ok, true);
        assert.equal(ah.cancel(s, ah.listings[0].id).ok, true);
        assert.equal(ah.claim(s, 0).ok, true);
    }
    const hs = ah.history('aa');
    assert.equal(hs.length, AH_HISTORY_MAX);
    assert.equal(hs[0].kind, 'claim'); assert.equal(hs[hs.length - 1].kind, 'cancel'); // se fueron las 10 primeras (post, cancel, claim...)
    assert.equal(hs.filter((h) => h.kind === 'post').at(-1)!.price, 100 + 4); // la publicación más vieja que quedó es la 5.ª
});

test('historial: persiste con la casa y una casa vieja sin historial carga igual', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fdn-ahh-'));
    const st1 = new FileStorage(dir, 10_000);
    const mkAcc = (key: string, gold: number) => { const econ = newEcon('guerrero', 'solmar'); econ.gold = gold; econ.bag = []; st1.put(key, { name: key, salt: '', hash: '', created: 0, lastLogin: 0, econ }); return { key, name: key.toUpperCase(), econ }; };
    const s = mkAcc('aa', 500), b = mkAcc('bb', 500);
    const ah1 = new AuctionHouse(st1); ah1.log = () => {};
    assert.equal(ah1.post(s, give(s.econ), 200).ok, true);
    assert.equal(ah1.buy(b, ah1.listings[0].id).ok, true);
    const ah2 = new AuctionHouse(new FileStorage(dir)); ah2.log = () => {};
    assert.deepEqual(kinds(ah2, 'aa'), ['sell', 'post']);
    assert.deepEqual(kinds(ah2, 'bb'), ['buy']);
    assert.equal(ah2.history('bb')[0].item!.n, 'Espada larga');
    // los ids siguen sin repetirse después de recargar
    const s2 = { ...s, econ: new FileStorage(dir).get('aa')!.econ! };
    assert.equal(ah2.post(s2, give(s2.econ), 10).ok, true);
    const ids = ah2.history('aa').map((h) => h.id); assert.equal(new Set(ids).size, ids.length);
    // casa guardada antes del historial (sin `history`)
    const st3 = new MemStorage(); st3.put(AH_STORAGE_KEY, { name: '(casa)', salt: '', hash: '', created: 0, lastLogin: 0, auction: { v: 1, nextId: 5, nextMail: 1, listings: [], mail: {} } } as AccountRecord);
    const ah3 = new AuctionHouse(st3); ah3.log = () => {};
    assert.deepEqual(ah3.history('aa'), []);
    const x = { key: 'aa', name: 'X', econ: newEcon('guerrero', 'solmar') }; x.econ.gold = 100; x.econ.bag = [];
    assert.equal(ah3.post(x, give(x.econ), 10).ok, true); assert.deepEqual(kinds(ah3, 'aa'), ['post']);
});

test('red: el historial se manda al abrir, al pedirlo y después de cada transacción', () => {
    const { ah, mk } = setup(); const s = mk('aa', 'Vendedor');
    const npcs = buildSolmar().npcs, sub = npcs.find((n) => roleOf(n) === 'subastador')!;
    const sent: { $case?: string; value?: { entries?: { kind: string; amount: number }[] } }[] = [];
    const p = { econ: s.econ, accountKey: 'aa', characterName: 'Vendedor', disconnected: false, isDead: false, posX: sub.x, posY: sub.y, send: (m: { payload?: unknown }) => sent.push(m.payload as never) } as unknown as Player;
    const ctx = { npcs, restat: () => {}, ground: {} } as unknown as EconCtx;
    const req = (o: object) => ({ npcId: sub.id, action: 'open', query: undefined, uid: 0, price: 0, listingId: 0, mailId: 0, ...o });
    const hist = () => sent.filter((m) => m.$case === 'auctionHistory').at(-1)?.value?.entries;
    ah.handle(p, ctx, req({})); assert.deepEqual(hist(), []);
    sent.length = 0; ah.handle(p, ctx, req({ action: 'post', uid: give(s.econ), price: 500 }));
    assert.deepEqual(hist()!.map((e) => [e.kind, e.amount]), [['post', -10]]);
    sent.length = 0; ah.handle(p, ctx, req({ action: 'history' }));
    assert.deepEqual(sent.map((m) => m.$case), ['auctionHistory']);
    sent.length = 0; ah.handle(p, ctx, req({ action: 'buy', listingId: 999 })); // falla: no manda historial
    assert.equal(hist(), undefined);
});
