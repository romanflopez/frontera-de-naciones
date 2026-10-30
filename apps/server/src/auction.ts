/**
 * Casa de subastas server-autoritativa (compartida entre facciones). Ver docs/SUBASTAS.md.
 *
 * - Publicar: el item sale de la bolsa del vendedor y queda en custodia acá; se cobra la tasa (no reembolsable).
 * - Comprar: el comprador paga, el item entra a su bolsa (si no hay lugar se rechaza ANTES de cobrar) y el oro neto
 *   (precio - comisión) va al buzón del vendedor, esté conectado o no.
 * - Cancelar / vencer (48 h): el item va al buzón del vendedor (nunca directo a la bolsa: puede estar llena).
 * - Buzón: se retira hablando con el Subastador.
 *
 * Todo corre síncrono dentro del event loop: cada acción valida y aplica de una vez, así que dos compras "a la vez"
 * de la misma publicación se resuelven en orden y la segunda ya no la encuentra. Nunca se confía en el cliente.
 *
 * Persistencia: las publicaciones y los buzones van en un registro propio (`_subastas`) del mismo Storage que las
 * cuentas (archivo JSON o fila jsonb en Postgres). Después de cada transacción se fuerza el guardado de la cuenta
 * tocada y de la casa juntos (`flush`), para que un reinicio no duplique ni pierda items.
 */
import { BAG_MAX, BASE_BY_NAME, AH_DURATION_MS, AH_MAIL_SOFT_MAX, AH_MAX_LISTINGS, AH_PAGE_SIZE, AH_PRICE_MAX, AH_PRICE_MIN, AH_SORTS,
    ahCommission, ahListingFee, ahNorm, ahSellerNet, itemLevel, roleOf, SHOP_SERVER_RANGE, SLOTS, type AhSort, type AttrId, type Npc, type Slot } from '@fdn/world';
import { ServerMessage, type AuctionMyState, type AuctionQuery, type AuctionRequest, type AuctionSearchResult, type DeepPartial } from '@fdn/proto';
import { MAX_GOLD, toInvItem, type Econ, type EconCtx, type SItem } from './economy.ts';
import * as M from './messages.ts';
import type { Player } from './player.ts';
import type { AccountRecord, Storage } from './storage.ts';

/** Clave reservada en el Storage (las claves de cuenta son hexadecimales: no puede chocar). */
export const AH_STORAGE_KEY = '_subastas';
export const AH_SWEEP_MS = 60_000;

export interface Listing {
    id: number;
    /** Clave de la cuenta del vendedor y nombre para mostrar. */
    seller: string; sellerName: string;
    /** Item en custodia (el uid se renueva al entregarlo: los uid son por personaje). */
    item: SItem;
    price: number; fee: number;
    created: number; expires: number;
}
export interface MailEntry { id: number; item?: SItem; gold?: number; text: string; at: number }
export interface AuctionBook { v: 1; nextId: number; nextMail: number; listings: Listing[]; mail: Record<string, MailEntry[]> }
type BookRecord = AccountRecord & { auction?: AuctionBook };

/** Quién hace la acción: la cuenta y su estado económico (el del server). */
export interface Actor { key: string; name: string; econ: Econ }
export type AhOutcome = { ok: boolean; code: string; text: string };
const fail = (code: string, text: string): AhOutcome => ({ ok: false, code, text });
const ok = (text: string, code = 'ok'): AhOutcome => ({ ok: true, code, text });
const fmt = (n: number) => Math.floor(n).toLocaleString('es-AR');
const cloneItem = (i: SItem): SItem => ({ u: 0, n: i.n, r: i.r, a: i.a.map((a) => ({ id: a.id as AttrId, v: a.v })) });

export interface SearchQuery { slot?: string; rarity?: number; text?: string; lvlMin?: number; lvlMax?: number; maxPrice?: number; sort?: string; page?: number }
export interface SearchPage { listings: Listing[]; page: number; pages: number; total: number }

export class AuctionHouse {
    private book: AuctionBook;
    private timer: NodeJS.Timeout | null = null;
    private readonly rate = new Map<string, { t: number; tokens: number }>();
    /** Aviso a un jugador conectado (por clave de cuenta), si el server lo enchufa: "se vendió tu X". */
    notify: (accountKey: string, ...msgs: ServerMessage[]) => void = () => {};
    /** Registro de transacciones (consola por defecto). */
    log: (line: string) => void = (line) => console.log(`[Subastas] ${line}`);

    constructor(private readonly storage: Storage, private readonly now: () => number = Date.now) {
        const rec = storage.get(AH_STORAGE_KEY) as BookRecord | undefined;
        this.book = rec?.auction ?? { v: 1, nextId: 1, nextMail: 1, listings: [], mail: {} };
        if (rec?.auction) console.log(`[Subastas] ${this.book.listings.length} publicaciones y ${Object.values(this.book.mail).reduce((s, m) => s + m.length, 0)} reclamos cargados.`);
    }

    /** Barrido periódico de vencimientos. */
    start(everyMs = AH_SWEEP_MS): void { if (!this.timer) { this.sweep(); this.timer = setInterval(() => this.sweep(), everyMs); this.timer.unref(); } }
    stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

    // ---------- persistencia ----------
    private save(...touched: Actor[]): void {
        for (const a of touched) { const acc = this.storage.get(a.key); if (acc) { acc.econ = a.econ; this.storage.put(a.key, acc); } }
        const rec: BookRecord = (this.storage.get(AH_STORAGE_KEY) as BookRecord | undefined) ?? { name: '(casa de subastas)', salt: '', hash: '', created: this.now(), lastLogin: 0 };
        rec.auction = this.book;
        this.storage.put(AH_STORAGE_KEY, rec);
        this.storage.flush(); // cuenta(s) y casa se escriben juntas
    }

    private mailTo(key: string, e: Omit<MailEntry, 'id' | 'at'>): void {
        (this.book.mail[key] ??= []).push({ ...e, id: this.book.nextMail++, at: this.now() });
    }

    // ---------- consultas ----------
    get listings(): readonly Listing[] { return this.book.listings; }
    mine(key: string): Listing[] { return this.book.listings.filter((l) => l.seller === key).sort((a, b) => a.expires - b.expires); }
    mailbox(key: string): MailEntry[] { return this.book.mail[key] ?? []; }

    search(q: SearchQuery): SearchPage {
        const t = this.now();
        const slot = SLOTS.includes(q.slot as Slot) ? q.slot : '', rar = Math.floor(q.rarity ?? 0) - 1, text = ahNorm(String(q.text ?? '').slice(0, 40));
        const lmin = Math.max(0, Math.floor(q.lvlMin ?? 0)), lmax = Math.max(0, Math.floor(q.lvlMax ?? 0)), maxP = Math.max(0, Number(q.maxPrice) || 0);
        const sort: AhSort = AH_SORTS.includes(q.sort as AhSort) ? (q.sort as AhSort) : 'price_asc';
        const rows = this.book.listings.filter((l) => {
            if (l.expires <= t) return false;
            const b = BASE_BY_NAME.get(l.item.n); if (!b) return false;
            if (slot && b.slot !== slot) return false;
            if (rar >= 0 && l.item.r !== rar) return false;
            if (text && !ahNorm(l.item.n).includes(text)) return false;
            const lv = itemLevel(l.item.n);
            if (lmin && lv < lmin) return false;
            if (lmax && lv > lmax) return false;
            if (maxP && l.price > maxP) return false;
            return true;
        });
        const cmp: Record<AhSort, (a: Listing, b: Listing) => number> = {
            price_asc: (a, b) => a.price - b.price || a.expires - b.expires, price_desc: (a, b) => b.price - a.price || a.expires - b.expires,
            time_asc: (a, b) => a.expires - b.expires || a.price - b.price, time_desc: (a, b) => b.expires - a.expires || a.price - b.price,
        };
        rows.sort((a, b) => cmp[sort](a, b) || a.id - b.id);
        const pages = Math.max(1, Math.ceil(rows.length / AH_PAGE_SIZE)), page = Math.min(pages - 1, Math.max(0, Math.floor(q.page ?? 0)));
        return { listings: rows.slice(page * AH_PAGE_SIZE, (page + 1) * AH_PAGE_SIZE), page, pages, total: rows.length };
    }

    // ---------- acciones (núcleo, sin red: se prueban en test/auction.test.ts) ----------
    post(a: Actor, uid: number, rawPrice: number): AhOutcome {
        const st = a.econ;
        if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || !Number.isInteger(rawPrice)) return fail('bad_price', 'El precio tiene que ser un número entero de oro.');
        if (rawPrice < AH_PRICE_MIN) return fail('bad_price', `El precio mínimo es ${AH_PRICE_MIN} de oro.`);
        if (rawPrice > AH_PRICE_MAX) return fail('bad_price', `El precio máximo es ${fmt(AH_PRICE_MAX)} de oro.`);
        const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item en la bolsa.');
        if (!BASE_BY_NAME.has(st.bag[i].n)) return fail('bad_item', 'Ese item no se puede publicar.');
        if (this.mine(a.key).length >= AH_MAX_LISTINGS) return fail('max_listings', `Ya tenés ${AH_MAX_LISTINGS} publicaciones activas: retirá o esperá que se venda alguna.`);
        if (this.mailbox(a.key).length >= AH_MAIL_SOFT_MAX) return fail('mail_full', 'Tu buzón está lleno: retirá lo que tenés ahí antes de publicar.');
        const fee = ahListingFee(rawPrice);
        if (st.gold < fee) return fail('gold', `No te alcanza el oro para la tasa de publicación (${fmt(fee)} de oro).`);
        const [it] = st.bag.splice(i, 1); // sale de la bolsa antes de existir en la casa: no hay dos copias
        st.gold = Math.max(0, st.gold - fee);
        const t = this.now(), l: Listing = { id: this.book.nextId++, seller: a.key, sellerName: a.name, item: cloneItem(it), price: rawPrice, fee, created: t, expires: t + AH_DURATION_MS };
        this.book.listings.push(l);
        this.save(a);
        this.log(`publicación #${l.id}: ${a.name} publica ${it.n} (r${it.r}) a ${rawPrice} de oro; tasa ${fee}.`);
        return ok(`Publicaste ${it.n} por ${fmt(rawPrice)} de oro (tasa: ${fmt(fee)} de oro). Vence en 48 h.`, 'posted');
    }

    cancel(a: Actor, id: number): AhOutcome {
        const i = this.book.listings.findIndex((l) => l.id === id);
        if (i < 0) return fail('gone', 'Esa publicación ya no está (se vendió, venció o la retiraste).');
        const l = this.book.listings[i];
        if (l.seller !== a.key) return fail('not_owner', 'Esa publicación no es tuya.');
        this.book.listings.splice(i, 1);
        this.mailTo(l.seller, { item: l.item, text: `Retiraste ${l.item.n} de la subasta.` });
        this.save(a);
        this.log(`cancelada #${l.id}: ${a.name} retira ${l.item.n}; el item va a su buzón.`);
        return ok(`Retiraste ${l.item.n}: lo tenés en el buzón del Subastador.`, 'cancelled');
    }

    buy(a: Actor, id: number): AhOutcome {
        const st = a.econ, i = this.book.listings.findIndex((l) => l.id === id);
        if (i < 0) return fail('gone', 'Esa publicación ya no está (se vendió, venció o la retiraron).');
        const l = this.book.listings[i];
        if (l.expires <= this.now()) { this.sweep(); return fail('gone', 'Esa publicación ya venció.'); }
        if (l.seller === a.key) return fail('own', 'No podés comprar tu propia publicación.');
        if (st.gold < l.price) return fail('gold', `No te alcanza el oro: cuesta ${fmt(l.price)}.`);
        if (st.bag.length >= BAG_MAX) return fail('bag_full', 'La bolsa está llena: hacé lugar antes de comprar.');
        // todo validado: se aplica de una vez (la publicación sale primero; un segundo pedido ya no la encuentra)
        this.book.listings.splice(i, 1);
        st.gold = Math.max(0, st.gold - l.price);
        st.bag.push({ ...cloneItem(l.item), u: st.nextUid++ });
        const fee = ahCommission(l.price), net = ahSellerNet(l.price);
        this.mailTo(l.seller, { gold: net, text: `Vendiste ${l.item.n} a ${a.name} por ${fmt(l.price)} de oro (comisión ${fmt(fee)}).` });
        this.save(a);
        this.log(`venta #${l.id}: ${a.name} compra ${l.item.n} a ${l.sellerName} por ${l.price}; comisión ${fee}, neto al buzón ${net}.`);
        this.notify(l.seller, M.econResult(true, 'ah_sold', `Se vendió tu ${l.item.n} por ${fmt(l.price)} de oro: retirá ${fmt(net)} en el Subastador.`), this.myState(l.seller));
        return ok(`Compraste ${l.item.n} por ${fmt(l.price)} de oro.`, 'bought');
    }

    /** Retira del buzón una entrada (o todas con id 0). Los items necesitan lugar en la bolsa; el oro siempre entra. */
    claim(a: Actor, mailId: number): AhOutcome {
        const st = a.econ, box = this.book.mail[a.key] ?? [];
        const pick = mailId ? box.filter((e) => e.id === mailId) : [...box];
        if (!pick.length) return fail(mailId ? 'gone' : 'empty', mailId ? 'Ese reclamo ya no está.' : 'El buzón está vacío.');
        let gold = 0, items = 0, left = 0;
        for (const e of pick) {
            if (e.item) {
                if (st.bag.length >= BAG_MAX) { left++; continue; }
                st.bag.push({ ...cloneItem(e.item), u: st.nextUid++ }); items++;
            } else gold += e.gold ?? 0;
            box.splice(box.indexOf(e), 1);
        }
        if (gold) st.gold = Math.min(MAX_GOLD, st.gold + gold);
        if (!box.length) delete this.book.mail[a.key];
        if (!gold && !items) return fail('bag_full', 'La bolsa está llena: hacé lugar para retirar el item.');
        this.save(a);
        this.log(`buzón: ${a.name} retira ${gold} de oro y ${items} item(s)${left ? `; quedan ${left} por bolsa llena` : ''}.`);
        const parts = [gold ? `${fmt(gold)} de oro` : '', items ? `${items} item${items > 1 ? 's' : ''}` : ''].filter(Boolean).join(' y ');
        return ok(`Retiraste ${parts}.${left ? ` Quedan ${left} en el buzón: la bolsa está llena.` : ''}`, 'claimed');
    }

    /** Vence las publicaciones de más de 48 h: el item vuelve al buzón del vendedor. Devuelve cuántas venció. */
    sweep(): number {
        const t = this.now(), out = this.book.listings.filter((l) => l.expires <= t);
        if (!out.length) return 0;
        this.book.listings = this.book.listings.filter((l) => l.expires > t);
        for (const l of out) {
            this.mailTo(l.seller, { item: l.item, text: `Venció tu publicación de ${l.item.n}.` });
            this.log(`vencida #${l.id}: ${l.item.n} de ${l.sellerName} vuelve a su buzón.`);
            this.notify(l.seller, M.econResult(true, 'ah_expired', `Venció tu publicación de ${l.item.n}: está en el buzón del Subastador.`), this.myState(l.seller));
        }
        this.save();
        return out.length;
    }

    // ---------- red ----------
    private allow(key: string): boolean {
        const t = this.now(), r = this.rate.get(key) ?? { t, tokens: 10 };
        r.tokens = Math.min(10, r.tokens + ((t - r.t) / 1000) * 5); r.t = t; this.rate.set(key, r);
        if (r.tokens < 1) return false;
        r.tokens -= 1; return true;
    }

    private nearAuctioneer(p: Player, ctx: EconCtx, npcId: string): Npc | undefined {
        const n = ctx.npcs.find((x) => x.id === npcId);
        if (!n || roleOf(n) !== 'subastador') return undefined;
        return Math.hypot(p.posX - n.x, p.posY - n.y) <= SHOP_SERVER_RANGE ? n : undefined;
    }

    private toListing(l: Listing, viewer: string) {
        return { id: l.id, item: toInvItem(l.item), price: l.price, seller: l.sellerName, expiresInMs: Math.max(0, l.expires - this.now()), mine: l.seller === viewer, lvl: itemLevel(l.item.n) };
    }

    myState(key: string): ServerMessage {
        const t = this.now();
        return auctionMyStateMsg({
            listings: this.mine(key).map((l) => this.toListing(l, key)),
            mail: this.mailbox(key).map((e) => ({ id: e.id, item: e.item ? toInvItem(e.item) : undefined, gold: e.gold ?? 0, text: e.text, ageMs: Math.max(0, t - e.at) })),
            maxListings: AH_MAX_LISTINGS,
        });
    }

    searchMessage(key: string, q: AuctionQuery | SearchQuery | undefined): ServerMessage {
        const r = this.search(q ?? {});
        return auctionSearchMsg({ listings: r.listings.map((l) => this.toListing(l, key)), page: r.page, pages: r.pages, total: r.total });
    }

    /** Pedido del cliente: valida sesión, ritmo, vida y distancia al Subastador; corre la acción y manda resultado + estado. */
    handle(p: Player, ctx: EconCtx, req: AuctionRequest): void {
        const st = p.econ;
        if (!st || p.disconnected || !p.accountKey) return;
        if (!this.allow(p.accountKey)) { p.send(M.econResult(false, 'slow', 'Más despacio con el Subastador.')); return; }
        const say = (r: AhOutcome) => p.send(M.econResult(r.ok, r.code, r.text));
        if (p.isDead) { say(fail('dead', 'Estás muerto.')); return; }
        if (!this.nearAuctioneer(p, ctx, req.npcId)) { say(fail('far', 'Estás muy lejos del Subastador.')); return; }
        const a: Actor = { key: p.accountKey, name: p.characterName || 'Alguien', econ: st };
        let r: AhOutcome | null = null;
        try {
            switch (req.action) {
                case 'open': this.sweep(); break;
                case 'search': p.send(this.searchMessage(a.key, req.query)); return;
                case 'post': r = this.post(a, req.uid, req.price); break;
                case 'cancel': r = this.cancel(a, req.listingId); break;
                case 'buy': r = this.buy(a, req.listingId); break;
                case 'claim': r = this.claim(a, req.mailId); break;
                default: r = fail('bad_action', 'Acción inválida.');
            }
        } catch (err) { console.error('[Subastas] error en acción:', err); r = fail('error', 'No se pudo completar.'); }
        if (r) say(r);
        if (r?.ok) p.send(M.inventoryState(st));
        p.send(this.myState(a.key));
        if (req.action === 'open' || req.action === 'buy' || req.action === 'cancel' || req.action === 'post') p.send(this.searchMessage(a.key, req.query));
    }
}

const auctionMyStateMsg = (value: DeepPartial<AuctionMyState>): ServerMessage => ServerMessage.fromPartial({ payload: { $case: 'auctionMyState', value } });
const auctionSearchMsg = (value: DeepPartial<AuctionSearchResult>): ServerMessage => ServerMessage.fromPartial({ payload: { $case: 'auctionSearchResult', value } });

// Una sola casa para todo el server (todos los mundos): la crea index.ts y la usan los mundos.
let house: AuctionHouse | null = null;
export const setAuctionHouse = (h: AuctionHouse | null): void => { house = h; };
export const auctionHouse = (): AuctionHouse | null => house;
