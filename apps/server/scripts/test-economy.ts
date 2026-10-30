/**
 * Prueba antitrampa de la economía del server (ver docs/ECONOMIA_SERVER.md). Contra un server en marcha:
 *   DATA_DIR=<carpeta vacía> PORT=8113 FDN_DEBUG_WARP=1 pnpm --filter @fdn/server start
 *   DATA_DIR=<la misma carpeta> npx tsx scripts/test-economy.ts [ws://localhost:8113/ws]
 * (FDN_DEBUG_WARP deja teletransportarse a cualquier celda: solo para pruebas; el script prepara en disco una cuenta
 *  "vieja" con un guardado del cliente inflado para probar la migración, por eso necesita el mismo DATA_DIR).
 *
 * Verifica: (m) la migración recorta lo imposible; (a) un save inflado no cambia nada; (b) comprar sin oro; (c) comprar lejos del NPC;
 * (d) vender lo que no tenés; (e) equipar algo ajeno/inexistente; (f) dos ventas "a la vez" del mismo item cobran una sola;
 * (g) desconectarse en medio no duplica; (h) un kill da exp/oro/item una sola vez; (s) los stats salen del equipo del server.
 */
import { WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { ClientMessage, ServerMessage } from '@fdn/proto';
import { buildSolmar, sellPrice, SHOPS } from '@fdn/world';

const URL = process.argv[2] ?? 'ws://localhost:8113/ws';
const DATA_DIR = process.env.DATA_DIR ?? '';
const RUN = Math.random().toString(36).slice(2, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0, checks = 0;
const check = (ok: boolean, msg: string) => { checks++; if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); };

type Payload = NonNullable<ClientMessage['payload']>;
type Srv = NonNullable<ServerMessage['payload']>;
type Inv = Extract<Srv, { $case: 'inventoryState' }>['value'];
type Res = { ok: boolean; code: string; text: string };

const map = buildSolmar();
const npc = (id: string) => map.npcs.find((n) => n.id === id)!;
/** Una celda libre pegada al NPC. */
function cellsBeside(id: string): [number, number][] {
    const n = npc(id), out: [number, number][] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
        const x = n.x + dx, y = n.y + dy; if (!map.blocked[y][x]) out.push([x, y]);
    }
    return out;
}

class Bot {
    ws!: WebSocket;
    id = 0n; x = 0; y = 0;
    loaded: { exists: boolean; data: string } | null = null;
    inv: Inv | null = null;
    invCount = 0;
    results: Res[] = [];
    rewards: Extract<Srv, { $case: 'killReward' }>['value'][] = [];
    deaths: bigint[] = [];
    mobs: { id: number; x: number; y: number; hp: number; type: number }[] = [];
    vitals = { hp: 0, maxHp: 0 };
    teleports = 0;
    constructor(readonly name: string) {}

    async connect() {
        this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
        let ready!: () => void; const got = new Promise<void>((r) => (ready = r));
        this.ws.on('message', (d: Buffer) => {
            const p = ServerMessage.decode(new Uint8Array(d)).payload as Srv | undefined; if (!p) return;
            switch (p.$case) {
                case 'characterLoaded': this.loaded = { exists: p.value.exists, data: p.value.data }; break;
                case 'initialState': this.id = p.value.playerId; break;
                case 'initialGameWorldState': this.x = p.value.playerX; this.y = p.value.playerY; ready(); break;
                case 'inventoryState': this.inv = p.value; this.invCount++; break;
                case 'econResult': this.results.push(p.value); break;
                case 'killReward': this.rewards.push(p.value); break;
                case 'mobDied': this.deaths.push(BigInt(p.value.mobId)); break;
                case 'mobsSnapshot': this.mobs = p.value.mobs.map((m) => ({ id: m.id, x: m.x, y: m.y, hp: m.hp, type: m.type })); break;
                case 'vitals': this.vitals = { hp: p.value.hp, maxHp: p.value.maxHp }; break;
                case 'playerTeleported': this.x = p.value.x; this.y = p.value.y; this.teleports++; break;
            }
        });
        await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
        this.send({ $case: 'authenticateRequest', value: { id: '', characterName: this.name, password: 'test1234' } });
        await Promise.race([got, sleep(6000).then(() => { throw new Error(`${this.name}: no entró al mundo`); })]);
        await sleep(300);
    }
    send(p: Payload) { this.ws.send(ClientMessage.encode({ payload: p } as ClientMessage).finish()); }
    close() { this.ws.close(); }
    /** Se teletransporta junto al NPC (prueba celdas hasta que una esté libre). */
    async goNear(id: string) { for (const [x, y] of cellsBeside(id)) { const n = this.teleports; await this.warp(x, y); if (this.teleports > n) return; } throw new Error('no pude acercarme a ' + id); }
    async warp(x: number, y: number) { const n = this.teleports; this.send({ $case: 'playerTeleportRequested', value: { x, y } }); for (let i = 0; i < 40 && this.teleports === n; i++) await sleep(50); }
    /** Manda una acción y espera su resultado. */
    async act(p: Payload, n = 1): Promise<Res[]> {
        const from = this.results.length;
        this.send(p);
        for (let i = 0; i < 60 && this.results.length < from + n; i++) await sleep(50);
        await sleep(80);
        return this.results.slice(from);
    }
    /** Pide una foto fresca (ordenar la bolsa siempre la manda). */
    async refresh(): Promise<Inv> { await this.act({ $case: 'econSortRequest', value: {} }); return this.inv!; }
    async saveClaim(cls: string, extra: Record<string, unknown> = {}) {
        const json = JSON.stringify({ v: 1, faction: 'solmar', cls, lvl: 60, exp: 5, gold: 999999999, hp: 99999, mp: 99999,
            bag: [{ n: 'Mandoble', r: 3, a: [{ id: 'hp', v: 9999 }] }], eq: { arma: { n: 'Mandoble', r: 3, a: [{ id: 'df', v: 9999 }] }, armadura: null, cabeza: null, anillo: null },
            q: { i: 9, st: 'new', prog: 0, keys: { cripta: 99, foso: 99 }, shards: { cripta: 99, foso: 99 } }, pots: { hp: 99, mp: 99 }, u: [], ...extra });
        this.send({ $case: 'saveCharacterRequest', value: { data: json } });
        await sleep(1000);
    }
}

/** Escribe en disco una cuenta "vieja" (con el guardado del cliente de antes de la economía del server). */
function seedLegacyAccount(name: string, character: unknown) {
    const dir = join(DATA_DIR, 'accounts'); mkdirSync(dir, { recursive: true });
    const salt = randomBytes(16), key = Buffer.from(name.normalize('NFC').toLowerCase(), 'utf8').toString('hex');
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ name, salt: salt.toString('hex'), hash: scryptSync('test1234', salt, 32).toString('hex'), created: Date.now(), lastLogin: Date.now(), character: JSON.stringify(character) }));
}

async function main() {
    if (!DATA_DIR) throw new Error('Falta DATA_DIR (el mismo del server) para preparar la cuenta vieja.');

    // ---------- (m) migración de una cuenta vieja con un guardado inflado ----------
    const migName = `mig${RUN}`;
    const bag = [
        { n: 'Espada larga', r: 3, a: [{ id: 'hp', v: 9999 }, { id: 'crit', v: 500 }, { id: 'df', v: 7 }, { id: 'mp', v: 5 }, { id: 'mag', v: 3 }] }, // 3 atributos máximo y valores topeados
        { n: 'Espada de dios', r: 3, a: [{ id: 'hp', v: 5 }] }, // base inexistente
        { n: 'Anillo de cobre', r: 3, a: [{ id: 'hp', v: 999 }] }, // base de tienda: solo con su atributo fijo y rareza común
        { n: 'Maza', r: 0, a: [{ id: 'crit', v: 4 }] }, // común con atributo de más
        ...Array.from({ length: 20 }, () => ({ n: 'Espada corta', r: 0, a: [] })),
    ];
    seedLegacyAccount(migName, { v: 1, faction: 'solmar', cls: 'guerrero', lvl: 60, exp: 100, gold: 999999999, hp: 500, mp: 50, bag, eq: { arma: { n: 'Mandoble', r: 3, a: [{ id: 'df', v: 9999 }] }, armadura: null, cabeza: null, anillo: null }, q: { i: 3, st: 'new', prog: 0, keys: { cripta: 99, foso: 0 }, shards: { cripta: 0, foso: 0 } }, pots: { hp: 99, mp: 400 }, u: [] });
    const rich = new Bot(migName); await rich.connect();
    const inv0 = rich.inv!;
    check(rich.loaded?.exists === true, '(m) la cuenta vieja se reconoce como personaje existente');
    check(inv0.gold === 25000, `(m) oro importado topeado a 25000 (vino ${inv0.gold})`);
    check(inv0.lvl === 40, `(m) nivel topeado a 40 (vino ${inv0.lvl})`);
    check(inv0.bag.length <= 18 && inv0.bag.every((i) => i.base !== 'Espada de dios'), `(m) bolsa <= 18 y sin bases inventadas (${inv0.bag.length} items)`);
    const sword = inv0.bag.find((i) => i.base === 'Espada larga');
    check(!!sword && sword.attrs.length === 3 && sword.attrs.every((a) => a.v <= 120) && !sword.attrs.some((a) => a.v === 9999 || a.v === 500), `(m) atributos de la espada recortados a 3 y dentro de rango (${JSON.stringify(sword?.attrs)})`);
    const ring = inv0.bag.find((i) => i.base === 'Anillo de cobre');
    check(!!ring && ring.rarity === 0 && ring.attrs.length === 1 && ring.attrs[0].v === 12, '(m) el anillo de tienda vuelve a rareza común con su atributo fijo (hp +12)');
    const maza = inv0.bag.find((i) => i.base === 'Maza');
    check(!!maza && maza.attrs.length === 0, '(m) un común no puede traer atributos de más');
    check(inv0.potsHp === 99 && inv0.potsMp === 99, '(m) pociones topeadas a 99');
    check(inv0.keysCripta === 9, '(m) llaves topeadas a 9');
    check(new Set(inv0.bag.map((i) => i.uid)).size === inv0.bag.length, '(m) cada item tiene uid único');

    // ---------- (a) un save inflado no cambia nada ----------
    await rich.saveClaim('mago');
    const inv1 = await rich.refresh();
    check(inv1.gold === inv0.gold && inv1.lvl === inv0.lvl && inv1.bag.length === inv0.bag.length && inv1.cls === 'guerrero', '(a) un save con oro/nivel/items/clase inflados no cambia el estado del server');
    rich.close(); await sleep(500);
    const rich2 = new Bot(migName); await rich2.connect();
    check(rich2.inv!.gold === 25000 && rich2.inv!.lvl === 40, '(a) tras reconectar sigue igual (lo importado se guardó una sola vez)');

    // ---------- personaje nuevo ----------
    const fresh = new Bot(`new${RUN}`); await fresh.connect();
    check(fresh.loaded?.exists === false && fresh.inv === null, '(n) cuenta nueva: sin personaje hasta el primer save');
    await fresh.saveClaim('guerrero');
    check(!!fresh.inv && fresh.inv.gold === 0 && fresh.inv.lvl === 1 && fresh.inv.bag.length === 0 && fresh.inv.potsHp === 3, '(a) personaje nuevo: kit inicial, sin oro, aunque el save dijera otra cosa');
    check(fresh.inv?.eq.some((e) => e.slot === 'arma' && e.item?.base === 'Espada corta') === true, '(n) kit de guerrero: Espada corta equipada');

    // ---------- (b) sin oro ----------
    await fresh.goNear('armero_s');
    const [rb] = await fresh.act({ $case: 'econBuyRequest', value: { npcId: 'armero_s', stockIndex: 0 } });
    check(rb && !rb.ok && rb.code === 'gold', `(b) comprar sin oro suficiente rechazado (${rb?.code})`);
    check(fresh.inv!.bag.length === 0 && fresh.inv!.gold === 0, '(b) y no cambió nada');

    // ---------- (c) lejos del NPC ----------
    await rich2.warp(10, 10); // dentro de Solmar, lejos del armero
    const g0 = rich2.inv!.gold;
    const [rc] = await rich2.act({ $case: 'econBuyRequest', value: { npcId: 'armero_s', stockIndex: 0 } });
    check(rc && !rc.ok && rc.code === 'far', `(c) comprar lejos del NPC rechazado (${rc?.code})`);
    const [rc2] = await rich2.act({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: rich2.inv!.bag[0].uid } });
    check(rc2 && !rc2.ok && rc2.code === 'far' && rich2.inv!.gold === g0, '(c) vender lejos del NPC también rechazado');
    const [rc3] = await rich2.act({ $case: 'econBuyRequest', value: { npcId: 'no_existe', stockIndex: 0 } });
    check(rc3 && !rc3.ok, '(c) comprar a un NPC que no existe rechazado');

    // ---------- compra válida ----------
    await rich2.goNear('armero_s');
    const line = SHOPS.armero.stock[0], bagN = rich2.inv!.bag.length;
    const [rok] = await rich2.act({ $case: 'econBuyRequest', value: { npcId: 'armero_s', stockIndex: 0 } });
    check(rok?.ok === true && rich2.inv!.gold === g0 - line.price && rich2.inv!.bag.length === bagN + 1, `(+) compra válida: -${line.price} de oro y +1 item`);
    const [rbad] = await rich2.act({ $case: 'econBuyRequest', value: { npcId: 'armero_s', stockIndex: 99 } });
    check(rbad && !rbad.ok, '(+) línea de stock inexistente rechazada');
    // la bolsa llena rechaza
    while (rich2.inv!.bag.length < 18) await rich2.act({ $case: 'econBuyRequest', value: { npcId: 'armero_s', stockIndex: 0 } });
    const [rfull] = await rich2.act({ $case: 'econBuyRequest', value: { npcId: 'armero_s', stockIndex: 0 } });
    check(rfull && !rfull.ok && rfull.code === 'bag_full', '(+) bolsa llena (18): compra rechazada');

    // ---------- (d) vender lo que no tenés ----------
    const gd = rich2.inv!.gold;
    const [rd] = await rich2.act({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: 987654 } });
    check(rd && !rd.ok && rd.code === 'no_item' && rich2.inv!.gold === gd, '(d) vender un item que no tenés rechazado');
    const equippedUid = rich2.inv!.eq.find((e) => e.slot === 'arma')!.item!.uid;
    const [rd2] = await rich2.act({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: equippedUid } });
    check(rd2 && !rd2.ok && rich2.inv!.gold === gd, '(d) vender un item equipado (no está en la bolsa) rechazado');

    // ---------- (e) equipar ajeno / inexistente ----------
    const eqBefore = JSON.stringify(rich2.inv!.eq);
    const [re1] = await rich2.act({ $case: 'econEquipRequest', value: { uid: 555555 } });
    check(re1 && !re1.ok && re1.code === 'no_item' && JSON.stringify(rich2.inv!.eq) === eqBefore, '(e) equipar un uid inexistente/ajeno rechazado');
    const [re2] = await rich2.act({ $case: 'econEquipRequest', value: { uid: equippedUid } });
    check(re2 && !re2.ok, '(e) "equipar" lo que ya está puesto (no está en la bolsa) rechazado');
    const [re3] = await rich2.act({ $case: 'econUnequipRequest', value: { slot: 'botas' } });
    check(re3 && !re3.ok, '(e) desequipar un slot inválido rechazado');

    // ---------- (f) dos ventas concurrentes del mismo item ----------
    const victim = rich2.inv!.bag.find((i) => i.base === 'Espada corta')!;
    const gf = rich2.inv!.gold, price = sellPrice(victim.base, victim.rarity), nBag = rich2.inv!.bag.length;
    const rf = await rich2.act({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: victim.uid } }, 1);
    rich2.send({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: victim.uid } }); // (el segundo pedido llega apenas después)
    await sleep(300);
    void rf;
    const okSells = rich2.results.filter((r) => r.text.startsWith('Vendiste')).length;
    check(okSells === 1 && rich2.inv!.gold === gf + price && rich2.inv!.bag.length === nBag - 1, `(f) venta duplicada: cobró una sola vez (+${rich2.inv!.gold - gf}, esperado +${price})`);
    // ráfaga en el mismo tick: 5 ventas del mismo uid mandadas pegadas
    const v2 = rich2.inv!.bag.find((i) => i.base === 'Espada corta')!, g2 = rich2.inv!.gold, p2 = sellPrice(v2.base, v2.rarity), from = rich2.results.length;
    for (let i = 0; i < 5; i++) rich2.send({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: v2.uid } });
    await sleep(700);
    const burst = rich2.results.slice(from);
    check(burst.filter((r) => r.ok).length === 1 && rich2.inv!.gold === g2 + p2, `(f) ráfaga de 5 ventas pegadas del mismo item: una sola cobrada (${burst.filter((r) => r.ok).length} ok)`);

    // ---------- (g) desconexión en medio ----------
    const v3 = rich2.inv!.bag.find((i) => i.base === 'Espada corta')!, g3 = rich2.inv!.gold, p3 = sellPrice(v3.base, v3.rarity), n3 = rich2.inv!.bag.length;
    rich2.send({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: v3.uid } });
    rich2.send({ $case: 'econSellRequest', value: { npcId: 'armero_s', uid: v3.uid } });
    rich2.close(); // se corta justo después de mandar
    await sleep(800);
    const back = new Bot(migName); await back.connect();
    check(back.inv!.gold === g3 + p3 && back.inv!.bag.length === n3 - 1, `(g) cortar la conexión en medio de una venta doble no duplica (oro ${back.inv!.gold}, esperado ${g3 + p3})`);
    check(!back.inv!.bag.some((i) => i.uid === v3.uid), '(g) el item vendido no vuelve');

    // ---------- (s) stats desde el equipo del server + equipar / desequipar ----------
    await back.goNear('joyero_s');
    // hay que liberar espacio: tirar items hasta tener lugar
    while (back.inv!.bag.length > 14) await back.act({ $case: 'econDropRequest', value: { uid: back.inv!.bag[back.inv!.bag.length - 1].uid } });
    const jl = SHOPS.joyero.stock.findIndex((s) => s.base === 'Anillo de cobre');
    await back.act({ $case: 'econBuyRequest', value: { npcId: 'joyero_s', stockIndex: jl } });
    await sleep(150);
    const hpMaxBefore = back.vitals.maxHp;
    const ringItem = back.inv!.bag.filter((i) => i.base === 'Anillo de cobre').pop()!;
    const [req] = await back.act({ $case: 'econEquipRequest', value: { uid: ringItem.uid } });
    await sleep(200);
    check(req?.ok === true && back.inv!.eq.some((e) => e.slot === 'anillo' && e.item?.uid === ringItem.uid), '(+) equipar mueve el item de la bolsa al slot');
    check(back.vitals.maxHp === hpMaxBefore + 12, `(s) la vida máxima sube +12 por el anillo equipado (${hpMaxBefore} -> ${back.vitals.maxHp})`);
    await back.act({ $case: 'econUnequipRequest', value: { slot: 'anillo' } });
    await sleep(200);
    check(back.vitals.maxHp === hpMaxBefore && back.inv!.bag.some((i) => i.uid === ringItem.uid), '(s) desequipar devuelve el item a la bolsa y baja la vida máxima');
    // tirar
    const [rdrop] = await back.act({ $case: 'econDropRequest', value: { uid: ringItem.uid } });
    check(rdrop?.ok === true && !back.inv!.bag.some((i) => i.uid === ringItem.uid), '(+) tirar destruye el item');
    const [rdrop2] = await back.act({ $case: 'econDropRequest', value: { uid: ringItem.uid } });
    check(rdrop2 && !rdrop2.ok, '(+) tirar de nuevo el mismo uid rechazado');
    back.close();

    // ---------- (h) un kill da exp/oro/item una sola vez ----------
    const killer = fresh; // nivel 1, sin oro
    const zone = map.zones.find((z) => z.name === 'Campamento goblin')!;
    let cell: [number, number] | null = null;
    for (let r = 0; r < 6 && !cell; r++) for (let dy = -r; dy <= r && !cell; dy++) for (let dx = -r; dx <= r && !cell; dx++) {
        const x = zone.x + dx, y = zone.y + dy; if (!map.blocked[y][x] && !map.safe[y][x]) cell = [x, y];
    }
    await killer.warp(cell![0], cell![1]);
    let target: { id: number; x: number; y: number } | undefined;
    for (let i = 0; i < 60 && !target; i++) { await sleep(100); target = killer.mobs.filter((m) => Math.hypot(m.x - killer.x, m.y - killer.y) < 9).sort((a, b) => a.hp - b.hp)[0]; }
    check(!!target, '(h) hay un mob cerca para la prueba');
    if (target) {
        killer.rewards.length = 0;
        const before = { ...killer.inv! }, bagBefore = killer.inv!.bag.length;
        // 4 golpes mortales pegados: el mob muere con el primero y los demás no pueden volver a cobrar
        for (let i = 0; i < 4; i++) killer.send({ $case: 'mobHitRequest', value: { mobId: target.id, dmg: 140, melee: false, crit: false, parSecs: 0, poisonSecs: 0 } });
        await sleep(900);
        const rw = killer.rewards;
        check(rw.length === 1, `(h) exactamente un killReward por el mob (${rw.length})`);
        if (rw[0]) {
            const after = killer.inv!;
            const gotItem = rw[0].item && !rw[0].bagFull ? 1 : 0;
            check(after.exp - before.exp === rw[0].exp || after.lvl > before.lvl, `(h) exp aplicada una sola vez (+${after.exp - before.exp}, reward ${rw[0].exp})`);
            check(after.gold - before.gold === rw[0].gold, `(h) oro aplicado una sola vez (+${after.gold - before.gold}, reward ${rw[0].gold})`);
            check(after.bag.length - bagBefore === gotItem, `(h) ítem aplicado una sola vez (+${after.bag.length - bagBefore} en la bolsa, reward ${gotItem})`);
        }
        // un mob que ya murió no se puede volver a matar
        killer.rewards.length = 0;
        killer.send({ $case: 'mobHitRequest', value: { mobId: target.id, dmg: 140, melee: false, crit: false, parSecs: 0, poisonSecs: 0 } });
        await sleep(300);
        check(killer.rewards.length === 0, '(h) pegarle de nuevo al mob muerto no da botín');
    }
    // alguien a quien no le dio el golpe final no cobra: el que no pegó no recibe nada
    const bystander = new Bot(`by${RUN}`); await bystander.connect(); await bystander.saveClaim('mago');
    check(bystander.rewards.length === 0, '(h) quien no mató al mob no recibe botín');
    bystander.close(); killer.close();

    console.log(`\n${checks - failures}/${checks} verificaciones OK${failures ? `, ${failures} FALLARON` : ''}`);
    process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
