// Pruebas de Dar e Intercambiar (docs/INTERCAMBIO.md). Correr: cd apps/server && npx tsx --test test/trade.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG_MAX } from '@fdn/world';
import type { ServerMessage, TradeRequest, TradeState } from '@fdn/proto';
import { GIVE_DAILY_GOLD, GIVE_DAILY_ITEMS, GIVE_MIN_LEVEL, GIVE_WINDOW_MS, TRADE_INVITE_MS, TRADE_RANGE, TRADE_SLOTS, TradeService } from '../src/trade.ts';
import { MAX_GOLD, newEcon, type Econ } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import type { Player } from '../src/player.ts';

class MemStorage implements Storage {
    data = new Map<string, AccountRecord>(); flushes = 0;
    get(k: string) { return this.data.get(k); }
    put(k: string, r: AccountRecord) { this.data.set(k, r); }
    flush() { this.flushes++; }
}

let nextId = 1n;
interface Fake { p: Player; sent: ServerMessage[]; econ: Econ; key: string }
function setup() {
    const storage = new MemStorage(), world = {}, clock = { t: 1_000_000 };
    const svc = new TradeService(storage, () => clock.t); const lines: string[] = []; svc.log = (l) => lines.push(l);
    const all = new Map<bigint, Player>();
    const mk = (name: string, o: { faction?: string; lvl?: number; gold?: number; x?: number; world?: object } = {}): Fake => {
        const econ = newEcon('guerrero', o.faction ?? 'solmar'); econ.bag = []; econ.gold = o.gold ?? 1000; econ.lvl = o.lvl ?? 10;
        const key = `acc-${name}`, sent: ServerMessage[] = [];
        storage.put(key, { name, salt: '', hash: '', created: 0, lastLogin: 0, econ });
        const p = { playerId: nextId++, posX: o.x ?? 10, posY: 10, world: o.world ?? world, disconnected: false, hp: 100, get isDead() { return (this as unknown as { hp: number }).hp < 1; },
            accountKey: key, characterName: name, econ, sessionId: key, send: (m: ServerMessage) => { sent.push(m); } } as unknown as Player;
        all.set(p.playerId, p);
        return { p, sent, econ, key };
    };
    const find = (id: bigint) => all.get(id);
    const req = (o: Partial<TradeRequest>): TradeRequest => ({ action: '', targetId: 0n, uid: 0, amount: 0, opId: 0, ...o });
    const send = (f: Fake, o: Partial<TradeRequest>) => svc.handle(f.p, req(o), find);
    return { storage, svc, lines, mk, send, clock, world };
}
const item = (e: Econ, n = 'Espada larga', r = 2): number => { const u = e.nextUid++; e.bag.push({ u, n, r, a: [{ id: 'crit', v: 4 }, { id: 'hp', v: 17 }] }); return u; };
const results = (f: Fake) => f.sent.flatMap((m) => (m.payload?.$case === 'econResult' ? [m.payload.value] : []));
const lastState = (f: Fake): TradeState | undefined => [...f.sent].reverse().map((m) => m.payload).find((x) => x?.$case === 'tradeState')?.value as TradeState | undefined;
const lastInvite = (f: Fake) => [...f.sent].reverse().map((m) => m.payload).find((x) => x?.$case === 'tradeInvite')?.value;
/** Abre una ventana de intercambio entre A y B. */
function openWindow(h: ReturnType<typeof setup>, a: Fake, b: Fake) {
    h.send(a, { action: 'offer', targetId: b.p.playerId }); h.send(b, { action: 'accept' });
    assert.equal(h.svc.hasWindow(a.p), true); assert.equal(h.svc.hasWindow(b.p), true);
}
const bagKeys = (e: Econ) => e.bag.map((i) => `${i.n}|${i.r}|${i.a.map((a) => `${a.id}${a.v}`).join(',')}`).sort();

test('intercambio feliz: items y oro cambian de lado, con uid nuevo y atributos intactos; las dos cuentas se guardan juntas', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto');
    const ua = item(a.econ, 'Mandoble', 3), ub = item(b.econ, 'Espada larga', 1);
    openWindow(h, a, b);
    h.send(a, { action: 'add', uid: ua }); h.send(b, { action: 'add', uid: ub }); h.send(b, { action: 'gold', amount: 250 });
    h.send(a, { action: 'confirm' });
    assert.equal(a.econ.bag.length, 1, 'todavía no pasó nada: falta que confirme Beto');
    const flushes = h.storage.flushes;
    h.send(b, { action: 'confirm' });
    assert.deepEqual(bagKeys(a.econ), ['Espada larga|1|crit4,hp17']);
    assert.deepEqual(bagKeys(b.econ), ['Mandoble|3|crit4,hp17']);
    assert.equal(a.econ.gold, 1250); assert.equal(b.econ.gold, 750);
    assert.notEqual(b.econ.bag[0].u, ua); // uid propio del receptor
    assert.ok(h.storage.flushes > flushes);
    assert.equal((h.storage.get(a.key)!.econ as Econ).gold, 1250); assert.equal((h.storage.get(b.key)!.econ as Econ).gold, 750);
    assert.equal(h.svc.hasWindow(a.p), false); assert.equal(h.svc.hasWindow(b.p), false);
    assert.equal(lastState(a)?.open, false); assert.equal(lastState(b)?.open, false);
    assert.ok(h.lines.some((l) => l.includes('Ana') && l.includes('Mandoble') && l.includes('Beto') && l.includes('250 de oro')), 'queda registrado');
});

test('cualquier cambio quita las confirmaciones de los dos, y lo agregado después se marca como Nuevo para el otro', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ), ub = item(b.econ);
    openWindow(h, a, b);
    h.send(a, { action: 'add', uid: ua }); h.send(b, { action: 'add', uid: ub });
    h.send(a, { action: 'confirm' });
    assert.equal(lastState(b)?.theirConfirmed, true);
    assert.deepEqual(lastState(a)?.theirsNew, [], 'Ana confirmó: ya vio lo de Beto');
    assert.deepEqual(lastState(b)?.theirsNew, [ua], 'Beto todavía no confirmó: lo de Ana es nuevo para él');
    h.send(b, { action: 'gold', amount: 10 }); // cambia Beto: Ana pierde la confirmación
    assert.equal(lastState(a)?.myConfirmed, false); assert.equal(lastState(b)?.theirConfirmed, false);
    const ua2 = item(a.econ, 'Mandoble');
    h.send(a, { action: 'add', uid: ua2 });
    assert.deepEqual(lastState(b)?.theirsNew, [ua, ua2], 'lo agregado después aparece como Nuevo para Beto');
    h.send(b, { action: 'confirm' });
    assert.deepEqual(lastState(b)?.theirsNew, [], 'al confirmar, Beto ya vio lo que hay');
    assert.equal(a.econ.bag.length, 2, 'nada se movió');
});

test('atómico: si a uno no le entra lo que recibe, no pasa nada de nada y la ventana sigue abierta sin confirmaciones', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto');
    const ua = item(a.econ, 'Mandoble'); item(b.econ);
    for (let i = 0; i < BAG_MAX - 1; i++) item(b.econ, 'Espada larga'); // Beto: bolsa llena (18)
    assert.equal(b.econ.bag.length, BAG_MAX);
    openWindow(h, a, b);
    h.send(a, { action: 'add', uid: ua }); h.send(a, { action: 'gold', amount: 100 }); // Beto no ofrece items: el de Ana no le entra
    const antesA = JSON.stringify(a.econ), antesB = JSON.stringify(b.econ);
    h.send(a, { action: 'confirm' }); h.send(b, { action: 'confirm' });
    assert.equal(JSON.stringify(a.econ), antesA); assert.equal(JSON.stringify(b.econ), antesB);
    assert.equal(h.svc.hasWindow(a.p), true);
    assert.equal(lastState(a)?.myConfirmed, false); assert.equal(lastState(b)?.myConfirmed, false);
    assert.ok(results(b).some((r) => r.code === 'bag_full'));
    // si Beto libera lugar y vuelven a confirmar, ahora sí
    b.econ.bag.pop();
    h.send(a, { action: 'confirm' }); h.send(b, { action: 'confirm' });
    assert.equal(a.econ.bag.length, 0); assert.equal(b.econ.bag.length, BAG_MAX);
});

test('un item que dejó de estar en la bolsa (vendido, tirado, equipado) sale de la oferta y hay que confirmar de nuevo', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ, 'Mandoble'); const ub = item(b.econ);
    openWindow(h, a, b);
    h.send(a, { action: 'add', uid: ua }); h.send(b, { action: 'add', uid: ub });
    h.send(a, { action: 'confirm' });
    a.econ.bag = []; // Ana lo vende por otro lado después de confirmar
    h.send(b, { action: 'confirm' });
    assert.equal(b.econ.bag.length, 1); assert.equal(a.econ.bag.length, 0, 'Ana no recibió nada ni Beto perdió su item');
    assert.equal(b.econ.bag[0].u, ub);
    assert.deepEqual(lastState(a)?.mine, []); assert.equal(lastState(b)?.theirConfirmed, false);
    assert.ok(results(b).some((r) => r.code === 'changed'));
});

test('el oro ofrecido que ya no se tiene se saca de la oferta; no se ofrece más del que se tiene', () => {
    const h = setup(); const a = h.mk('Ana', { gold: 100 }), b = h.mk('Beto');
    openWindow(h, a, b);
    h.send(a, { action: 'gold', amount: 101 });
    assert.ok(results(a).some((r) => r.code === 'gold'));
    h.send(a, { action: 'gold', amount: 100 }); h.send(b, { action: 'add', uid: item(b.econ) });
    h.send(a, { action: 'confirm' }); a.econ.gold = 40; h.send(b, { action: 'confirm' });
    assert.equal(a.econ.gold, 40); assert.equal(b.econ.gold, 1000); assert.equal(b.econ.bag.length, 1, 'no pasó nada');
});

test('un item nunca está en dos lugares: en una ventana no se puede ofrecer dos veces ni regalar al mismo tiempo', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'), c = h.mk('Carla'); const ua = item(a.econ, 'Mandoble', 3);
    openWindow(h, a, b);
    h.send(a, { action: 'add', uid: ua }); h.send(a, { action: 'add', uid: ua });
    assert.equal(lastState(a)?.mine.length, 1); assert.ok(results(a).some((r) => r.code === 'dup'));
    h.send(a, { action: 'give', targetId: c.p.playerId, uid: ua });
    assert.ok(results(a).some((r) => r.code === 'busy'), 'Ana está en un intercambio: no puede dar');
    assert.equal(h.svc.pendingFor(c.p), undefined);
    h.send(c, { action: 'offer', targetId: a.p.playerId });
    assert.equal(h.svc.pendingFor(a.p), undefined, 'Ana está ocupada: Carla no le puede mandar otra invitación');
    h.send(a, { action: 'confirm' }); h.send(b, { action: 'confirm' }); // Beto no ofreció nada pero Ana sí: pasa
    assert.equal(a.econ.bag.length, 0); assert.equal(b.econ.bag.length, 1);
    const total = [a, b, c].reduce((s, f) => s + f.econ.bag.length, 0); assert.equal(total, 1);
});

test('cancelar cierra la ventana de los dos y no mueve nada', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ);
    openWindow(h, a, b); h.send(a, { action: 'add', uid: ua }); h.send(b, { action: 'cancel' });
    assert.equal(h.svc.hasWindow(a.p), false); assert.equal(lastState(a)?.open, false);
    assert.equal(a.econ.bag.length, 1); assert.equal(b.econ.bag.length, 0);
    h.send(a, { action: 'confirm' }); assert.ok(results(a).some((r) => r.code === 'no_window'));
});

test('solo con jugadores que se ven: rango, mundo, conexión, vida, nación y misma cuenta', () => {
    const h = setup(); const a = h.mk('Ana');
    const lejos = h.mk('Lejos', { x: 10 + TRADE_RANGE + 1 }), otroMundo = h.mk('Otro', { world: {} }), vhar = h.mk('Vhar', { faction: 'vhar' }), muerto = h.mk('Muerto'), off = h.mk('Off');
    muerto.p.hp = 0; off.p.disconnected = true;
    const mismo = h.mk('Alt'); mismo.p.accountKey = a.p.accountKey;
    for (const t of [lejos, otroMundo, vhar, muerto, off, mismo]) {
        h.send(a, { action: 'offer', targetId: t.p.playerId });
        assert.equal(h.svc.pendingFor(t.p), undefined, `no debería poder con ${t.p.characterName}`);
    }
    h.send(a, { action: 'offer', targetId: 999999n }); // nadie con ese id
    assert.equal(results(a).filter((r) => !r.ok).length, 7);
});

test('si se alejan, se desconectan o cruzan de mapa a mitad, el barrido cierra la ventana sin mover nada', () => {
    for (const romper of [(f: Fake) => { f.p.posX = 100; }, (f: Fake) => { f.p.disconnected = true; }, (f: Fake) => { (f.p as { world: unknown }).world = null; }]) {
        const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ);
        openWindow(h, a, b); h.send(a, { action: 'add', uid: ua }); h.send(a, { action: 'confirm' });
        romper(b); h.svc.sweep();
        assert.equal(h.svc.hasWindow(a.p), false); assert.equal(lastState(a)?.open, false);
        assert.equal(a.econ.bag.length, 1); assert.equal(b.econ.bag.length, 0);
    }
    // y confirmar justo después de alejarse también falla
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ);
    openWindow(h, a, b); h.send(a, { action: 'add', uid: ua }); h.send(a, { action: 'confirm' });
    b.p.posX = 100; h.send(b, { action: 'confirm' });
    assert.equal(a.econ.bag.length, 1); assert.equal(b.econ.bag.length, 0); assert.equal(h.svc.hasWindow(b.p), false);
});

test('Dar un item: el receptor tiene que aceptar; recién ahí se mueve', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ, 'Mandoble', 3);
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua });
    assert.equal(a.econ.bag.length, 1, 'sin aceptar no se mueve nada');
    const inv = lastInvite(b)!; assert.equal(inv.kind, 'give'); assert.equal(inv.fromName, 'Ana'); assert.equal(inv.item?.base, 'Mandoble');
    h.send(b, { action: 'accept' });
    assert.equal(a.econ.bag.length, 0); assert.equal(b.econ.bag.length, 1);
    assert.deepEqual(bagKeys(b.econ), ['Mandoble|3|crit4,hp17']);
    assert.equal(lastInvite(b)?.kind, '', 'la invitación se limpia');
    assert.ok(results(a).some((r) => r.code === 'gave')); assert.ok(results(b).some((r) => r.code === 'got'));
    assert.ok(h.lines.some((l) => l.startsWith('dar:') && l.includes('Mandoble')));
    h.send(b, { action: 'accept' }); assert.ok(results(b).some((r) => r.code === 'gone'), 'no se acepta dos veces');
});

test('Dar oro; rechazar, cancelar y vencer no mueven nada', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ);
    h.send(a, { action: 'give', targetId: b.p.playerId, amount: 300 }); h.send(b, { action: 'accept' });
    assert.equal(a.econ.gold, 700); assert.equal(b.econ.gold, 1300);
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua }); h.send(b, { action: 'decline' });
    assert.equal(a.econ.bag.length, 1); assert.equal(h.svc.pendingFor(b.p), undefined); assert.ok(results(a).some((r) => r.code === 'declined'));
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua }); h.send(a, { action: 'cancel' });
    assert.equal(h.svc.pendingFor(b.p), undefined); h.send(b, { action: 'accept' }); assert.equal(a.econ.bag.length, 1);
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua }); h.clock.t += TRADE_INVITE_MS + 1;
    h.send(b, { action: 'accept' }); assert.equal(a.econ.bag.length, 1); assert.ok(results(b).some((r) => r.code === 'expired'));
});

test('Dar: el item se revalida al aceptar (pasaron hasta 30 s) y la bolsa llena del receptor frena todo', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ);
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua }); a.econ.bag = []; h.send(b, { action: 'accept' });
    assert.equal(b.econ.bag.length, 0); assert.ok(results(a).some((r) => r.code === 'no_item'));
    const ub = item(a.econ); for (let i = 0; i < BAG_MAX; i++) item(b.econ);
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ub });
    assert.equal(h.svc.pendingFor(b.p), undefined); assert.ok(results(a).some((r) => r.code === 'bag_full'));
});

test('Dar: nivel mínimo y topes diarios de items y de oro (Intercambiar no los lleva)', () => {
    const h = setup(); const nuevo = h.mk('Nuevo', { lvl: GIVE_MIN_LEVEL - 1 }), b = h.mk('Beto', { gold: 5 });
    h.send(nuevo, { action: 'give', targetId: b.p.playerId, amount: 1 });
    assert.ok(results(nuevo).some((r) => r.code === 'give_cap')); assert.equal(h.svc.pendingFor(b.p), undefined);
    const un = item(nuevo.econ); openWindow(h, nuevo, b); h.send(nuevo, { action: 'add', uid: un }); h.send(nuevo, { action: 'confirm' }); h.send(b, { action: 'confirm' });
    assert.equal(b.econ.bag.length, 1, 'un nivel bajo sí puede intercambiar');
    // tope de items: GIVE_DAILY_ITEMS regalos y el siguiente se frena; a las 24 h vuelve a andar
    const g = h.mk('Gen', { gold: 5_000_000 }), r = h.mk('Recibe', { gold: 0 });
    for (let i = 0; i < GIVE_DAILY_ITEMS; i++) { h.clock.t += 1000; r.econ.bag = []; h.send(g, { action: 'give', targetId: r.p.playerId, uid: item(g.econ) }); h.send(r, { action: 'accept' }); }
    assert.equal(g.econ.bag.length, 0);
    const extra = item(g.econ); r.econ.bag = [];
    h.send(g, { action: 'give', targetId: r.p.playerId, uid: extra }); assert.equal(h.svc.pendingFor(r.p), undefined);
    assert.ok(results(g).filter((x) => x.code === 'give_cap').length >= 1);
    h.clock.t += GIVE_WINDOW_MS + 1;
    h.send(g, { action: 'give', targetId: r.p.playerId, uid: extra }); h.send(r, { action: 'accept' }); assert.equal(r.econ.bag.length, 1);
    // tope de oro
    h.send(g, { action: 'give', targetId: r.p.playerId, amount: GIVE_DAILY_GOLD }); h.send(r, { action: 'accept' });
    assert.equal(r.econ.gold, GIVE_DAILY_GOLD);
    h.send(g, { action: 'give', targetId: r.p.playerId, amount: 1 }); assert.equal(h.svc.pendingFor(r.p), undefined);
    // también se frena al aceptar si entre la invitación y la aceptación se llenó el cupo (dos invitaciones en paralelo)
});

test('antitrampa: cantidades raras, items ajenos o inexistentes y acciones sin ventana se rechazan sin mover nada', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ); item(b.econ); const ub = item(b.econ); // los uid son por personaje: ub tiene que ser un número que Ana NO tiene
    const antes = JSON.stringify([a.econ, b.econ]);
    const malos: Partial<TradeRequest>[] = [
        { action: 'give', targetId: b.p.playerId, amount: -5 }, { action: 'give', targetId: b.p.playerId, amount: 0.5 }, { action: 'give', targetId: b.p.playerId, amount: NaN },
        { action: 'give', targetId: b.p.playerId, amount: Infinity }, { action: 'give', targetId: b.p.playerId, amount: 1e9 }, { action: 'give', targetId: b.p.playerId },
        { action: 'give', targetId: b.p.playerId, uid: ua, amount: 10 }, { action: 'give', targetId: b.p.playerId, uid: ub }, { action: 'give', targetId: b.p.playerId, uid: -1 },
        { action: 'give', targetId: b.p.playerId, uid: 12345 }, { action: 'give', targetId: a.p.playerId, uid: ua }, { action: 'add', uid: ua }, { action: 'confirm' },
        { action: 'gold', amount: 5 }, { action: 'remove', uid: ua }, { action: 'accept' }, { action: 'decline' }, { action: 'cancel' }, { action: 'nada' }, { action: '' },
    ];
    for (const m of malos) h.send(a, m);
    assert.equal(JSON.stringify([a.econ, b.econ]), antes);
    assert.equal(h.svc.pendingFor(b.p), undefined);
    // dentro de una ventana (pasa el tiempo: el límite de ritmo ya se comió las fichas de tanto pedido)
    h.clock.t += 10_000; openWindow(h, a, b);
    for (const m of [{ action: 'add', uid: ub }, { action: 'add', uid: -3 }, { action: 'add', uid: 0.5 }, { action: 'add', uid: 777 }, { action: 'gold', amount: -1 }, { action: 'gold', amount: 0.1 }, { action: 'gold', amount: NaN },
        { action: 'gold', amount: 99999 }, { action: 'remove', uid: 777 }, { action: 'confirm' }] as Partial<TradeRequest>[]) { h.clock.t += 500; h.send(a, m); }
    assert.deepEqual(lastState(a)?.mine, []); assert.equal(lastState(a)?.myGold, 0); assert.equal(lastState(a)?.myConfirmed, false);
    assert.equal(JSON.stringify([a.econ, b.econ]), antes);
});

test('la ventana tiene tope de items por lado', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); openWindow(h, a, b);
    const uids = Array.from({ length: TRADE_SLOTS + 1 }, () => item(a.econ));
    for (const u of uids) h.send(a, { action: 'add', uid: u });
    assert.equal(lastState(a)?.mine.length, TRADE_SLOTS); assert.ok(results(a).some((r) => r.code === 'slots'));
});

test('op_id repetido no se vuelve a aplicar; rate limit frena el spam', () => {
    const h = setup(); const a = h.mk('Ana'), b = h.mk('Beto'); const ua = item(a.econ);
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua, opId: 7 }); h.send(b, { action: 'decline' });
    h.send(a, { action: 'give', targetId: b.p.playerId, uid: ua, opId: 7 });
    assert.equal(h.svc.pendingFor(b.p), undefined, 'el reenvío del mismo pedido se ignora');
    const c = h.mk('Spam');
    for (let i = 0; i < 40; i++) h.send(c, { action: 'cancel' });
    assert.ok(results(c).some((r) => r.code === 'slow'));
});

test('el oro recibido nunca pasa del máximo seguro y un oro negativo no se acepta', () => {
    const h = setup(); const a = h.mk('Ana', { gold: 100 }), b = h.mk('Beto'); b.econ.gold = MAX_GOLD - 50;
    h.send(a, { action: 'give', targetId: b.p.playerId, amount: 100 });
    assert.equal(h.svc.pendingFor(b.p), undefined); assert.ok(results(a).some((r) => r.code === 'gold_max'));
    assert.equal(a.econ.gold, 100); assert.equal(b.econ.gold, MAX_GOLD - 50);
});
