/**
 * Dar e Intercambiar entre jugadores, server-autoritativo. Ver docs/INTERCAMBIO.md.
 *
 * - Dar: regalo de un solo lado (un item de la bolsa o una cantidad de oro). El receptor ve la invitación y tiene que aceptar.
 * - Intercambiar: invitación + ventana con las dos ofertas (hasta TRADE_SLOTS items y oro por lado). Cada cambio quita las
 *   confirmaciones de los dos; cuando confirman los dos, se hace el cambio.
 * - Los dos usan la misma transferencia atómica (`swap`): valida todo (items en la bolsa, oro, lugar de los dos lados, tope
 *   de oro) y recién después aplica, síncrona dentro del event loop. Los items de las ofertas se quedan en la bolsa mientras se
 *   negocia (no existen en dos lugares); al confirmar se revalida y, si algo cambió (se vendió, se tiró, se equipó), se
 *   quitan de la oferta y se piden de nuevo las confirmaciones.
 * - Solo entre jugadores que se ven: mismo mundo, conectados, vivos, a TRADE_RANGE celdas o menos y de la misma nación. Un barrido
 *   de 1 s cierra lo que deja de cumplirse (se alejó, se desconectó, cruzó de mapa).
 * - Dar es la ruta natural de las mulas del RMT, así que tiene nivel mínimo y topes por cuenta cada 24 h (ítems y oro).
 *
 * Persistencia: después de cada transferencia se guardan las dos cuentas juntas (`flush`), como la subasta y el depósito.
 * Ojo: los topes diarios viven en memoria del server; un reinicio los reinicia (ver docs/INTERCAMBIO.md, pendientes).
 */
import { BAG_MAX, BASE_BY_NAME, type AttrId } from '@fdn/world';
import { ServerMessage, type DeepPartial, type TradeInvite, type TradeRequest, type TradeState } from '@fdn/proto';
import { MAX_GOLD, toInvItem, type Econ, type SItem } from './economy.ts';
import * as M from './messages.ts';
import type { Player } from './player.ts';
import type { Storage } from './storage.ts';

/** Items por lado en la ventana de intercambio. */
export const TRADE_SLOTS = 8;
/** Distancia máxima (celdas) entre los dos para dar o intercambiar. */
export const TRADE_RANGE = 12;
/** Cuánto vive una invitación sin respuesta. */
export const TRADE_INVITE_MS = 30_000;
/** Nivel mínimo para DAR (regalar). Intercambiar no lo pide: es de dos lados y no sirve para pasar cosas a una mula. */
export const GIVE_MIN_LEVEL = 5;
/** Topes de lo que una cuenta puede DAR por ventana de 24 h. */
export const GIVE_DAILY_ITEMS = 20;
export const GIVE_DAILY_GOLD = 1_000_000;
export const GIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TRADE_SWEEP_MS = 1000;
const OPS_KEEP = 32;

export type TradeOutcome = { ok: boolean; code: string; text: string };
const fail = (code: string, text: string): TradeOutcome => ({ ok: false, code, text });
const ok = (text: string, code = 'ok'): TradeOutcome => ({ ok: true, code, text });
const fmt = (n: number) => Math.floor(n).toLocaleString('es-AR');
const key = (p: Player): string => p.playerId.toString();
const cloneItem = (i: SItem, u: number): SItem => ({ u, n: i.n, r: i.r, a: i.a.map((a) => ({ id: a.id as AttrId, v: a.v })), ...(i.up ? { up: i.up } : {}), ...(i.rf ? { rf: i.rf } : {}) });
/** Hoy se puede tradear cualquier item de equipo del catálogo. Acá van después los ligados y los frágiles (docs/INTERCAMBIO.md). */
export const tradable = (i: SItem): boolean => BASE_BY_NAME.has(i.n);
/** Monto entero positivo y exacto (el cliente puede mandar cualquier cosa). */
function goldOf(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw) && raw > 0 && raw <= MAX_GOLD ? raw : null;
}
const uidOf = (raw: unknown): number | null => (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null);

interface Invite { kind: 'give' | 'exchange'; from: Player; to: Player; uid: number; gold: number; expires: number }
interface Side { p: Player; items: number[]; gold: number; confirmed: boolean; /** items de este lado agregados desde la última confirmación del otro */ fresh: Set<number> }
interface Window { id: number; a: Side; b: Side }

export class TradeService {
    private readonly invites = new Map<string, Invite>(); // por jugador que RECIBE la invitación
    private readonly windows = new Map<string, Window>(); // por cada uno de los dos jugadores
    private readonly rate = new Map<string, { t: number; tokens: number }>();
    private readonly ops = new Map<string, number[]>();
    private readonly given = new Map<string, { at: number; items: number; gold: number }[]>();
    private timer: NodeJS.Timeout | null = null;
    private nextId = 1;
    /** Registro de transferencias (consola por defecto). */
    log: (line: string) => void = (line) => console.log(`[Intercambio] ${line}`);

    constructor(private readonly storage: Storage, private readonly now: () => number = Date.now) {}

    start(everyMs = TRADE_SWEEP_MS): void { if (!this.timer) { this.timer = setInterval(() => this.sweep(), everyMs); this.timer.unref(); } }
    stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

    // ---------- consultas (tests) ----------
    hasWindow(p: Player): boolean { return this.windows.has(key(p)); }
    pendingFor(p: Player): Invite | undefined { return this.invites.get(key(p)); }
    private outgoing(p: Player): Invite | undefined { for (const i of this.invites.values()) if (i.from === p) return i; return undefined; }
    private busy(p: Player): boolean { return this.windows.has(key(p)) || this.invites.has(key(p)) || !!this.outgoing(p); }

    // ---------- reglas de pareja ----------
    /** Por qué `a` y `b` no pueden tradear ahora (o null si pueden). */
    private pairProblem(a: Player, b: Player): string | null {
        if (!a.econ || !b.econ || !a.accountKey || !b.accountKey) return 'No se puede en este momento.';
        if (a.disconnected || b.disconnected) return `${b.characterName || 'El jugador'} no está conectado.`;
        if (!a.world || a.world !== b.world) return `No ves a ${b.characterName || 'ese jugador'}.`;
        if (a.isDead || b.isDead) return 'Alguno de los dos está muerto.';
        if (a.accountKey === b.accountKey) return 'No podés tradear con tu propia cuenta.';
        if (a.econ.faction !== b.econ.faction) return 'Solo se puede tradear con jugadores de tu nación.';
        if (Math.hypot(a.posX - b.posX, a.posY - b.posY) > TRADE_RANGE) return `${b.characterName || 'El jugador'} está muy lejos.`;
        return null;
    }

    // ---------- Dar: topes ----------
    private givenIn24h(acc: string): { items: number; gold: number } {
        const t = this.now(), list = (this.given.get(acc) ?? []).filter((e) => t - e.at < GIVE_WINDOW_MS);
        this.given.set(acc, list);
        return { items: list.reduce((s, e) => s + e.items, 0), gold: list.reduce((s, e) => s + e.gold, 0) };
    }
    private giveCapProblem(giver: Player, items: number, gold: number): string | null {
        if (giver.econ!.lvl < GIVE_MIN_LEVEL) return `Para dar necesitás nivel ${GIVE_MIN_LEVEL}. Intercambiar sí podés.`;
        const g = this.givenIn24h(giver.accountKey);
        if (g.items + items > GIVE_DAILY_ITEMS) return `Llegaste al tope de items para dar hoy (${GIVE_DAILY_ITEMS} cada 24 h). Probá con Intercambiar.`;
        if (g.gold + gold > GIVE_DAILY_GOLD) return `Llegaste al tope de oro para dar hoy (${fmt(GIVE_DAILY_GOLD)} cada 24 h). Probá con Intercambiar.`;
        return null;
    }

    // ---------- núcleo: transferencia atómica ----------
    /**
     * Mueve `aItems`/`aGold` de A a B y `bItems`/`bGold` de B a A, o no hace nada. Valida todo antes de tocar nada.
     * Los items entran a la otra bolsa con uid nuevo (los uid son por personaje).
     */
    swap(a: Player, aItems: number[], aGold: number, b: Player, bItems: number[], bGold: number, kind: 'give' | 'exchange'): TradeOutcome {
        const ea = a.econ, eb = b.econ;
        if (!ea || !eb) return fail('no_econ', 'No se puede en este momento.');
        if (new Set(aItems).size !== aItems.length || new Set(bItems).size !== bItems.length) return fail('dup', 'Hay un item repetido.');
        const pick = (e: Econ, uids: number[]): SItem[] | string => {
            const out: SItem[] = [];
            for (const u of uids) {
                const it = e.bag.find((x) => x.u === u);
                if (!it) return 'Un item de la oferta ya no está en la bolsa.';
                if (!tradable(it)) return `${it.n} no se puede tradear.`;
                out.push(it);
            }
            return out;
        };
        const outA = pick(ea, aItems), outB = pick(eb, bItems);
        if (typeof outA === 'string') return fail('no_item', outA);
        if (typeof outB === 'string') return fail('no_item', outB);
        if (!Number.isInteger(aGold) || aGold < 0 || !Number.isInteger(bGold) || bGold < 0) return fail('bad_gold', 'Monto de oro inválido.');
        if (aGold > ea.gold) return fail('gold', `${a.characterName} no tiene el oro ofrecido.`);
        if (bGold > eb.gold) return fail('gold', `${b.characterName} no tiene el oro ofrecido.`);
        if (!outA.length && !outB.length && !aGold && !bGold) return fail('empty', 'No hay nada para pasar.');
        if (ea.bag.length - outA.length + outB.length > BAG_MAX) return fail('bag_full', `${a.characterName} no tiene lugar en la bolsa.`);
        if (eb.bag.length - outB.length + outA.length > BAG_MAX) return fail('bag_full', `${b.characterName} no tiene lugar en la bolsa.`);
        if (ea.gold - aGold + bGold > MAX_GOLD || eb.gold - bGold + aGold > MAX_GOLD) return fail('gold_max', 'El oro no entra.');
        // todo validado: se aplica de una vez (primero salen de las dos bolsas, después entran: no hay dos copias)
        const gone = new Set(outA), goneB = new Set(outB);
        ea.bag = ea.bag.filter((x) => !gone.has(x)); eb.bag = eb.bag.filter((x) => !goneB.has(x));
        for (const it of outA) eb.bag.push(cloneItem(it, eb.nextUid++));
        for (const it of outB) ea.bag.push(cloneItem(it, ea.nextUid++));
        ea.gold = ea.gold - aGold + bGold; eb.gold = eb.gold - bGold + aGold;
        this.save(a, b);
        const desc = (items: SItem[], gold: number) => [...items.map((i) => `${i.n} (r${i.r}${i.up ? ` +${i.up}` : ''})`), gold ? `${gold} de oro` : ''].filter(Boolean).join(', ') || 'nada';
        this.log(`${kind === 'give' ? 'dar' : 'intercambio'}: ${a.characterName} [${a.accountKey.slice(0, 8)}] entrega ${desc(outA, aGold)}; ${b.characterName} [${b.accountKey.slice(0, 8)}] entrega ${desc(outB, bGold)}.`);
        const text = (mine: SItem[], g: number, theirs: SItem[], tg: number, other: string) =>
            kind === 'give'
                ? (mine.length || g ? `Le diste ${[...mine.map((i) => i.n), g ? `${fmt(g)} de oro` : ''].filter(Boolean).join(' y ')} a ${other}.` : `Recibiste ${[...theirs.map((i) => i.n), tg ? `${fmt(tg)} de oro` : ''].filter(Boolean).join(' y ')} de ${other}.`)
                : `Intercambio con ${other} completo: diste ${desc(mine, g)} y recibiste ${desc(theirs, tg)}.`;
        a.send(M.econResult(true, kind === 'give' ? 'gave' : 'traded', text(outA, aGold, outB, bGold, b.characterName))); a.send(M.inventoryState(ea));
        b.send(M.econResult(true, kind === 'give' ? 'got' : 'traded', text(outB, bGold, outA, aGold, a.characterName))); b.send(M.inventoryState(eb));
        return ok('Listo.', kind === 'give' ? 'gave' : 'traded');
    }

    private save(...ps: Player[]): void {
        for (const p of ps) { const acc = this.storage.get(p.accountKey); if (acc && p.econ) { acc.econ = p.econ; this.storage.put(p.accountKey, acc); } }
        this.storage.flush(); // las dos cuentas se escriben juntas
    }

    // ---------- red ----------
    private allow(k: string): boolean {
        const t = this.now(), r = this.rate.get(k) ?? { t, tokens: 10 };
        r.tokens = Math.min(10, r.tokens + ((t - r.t) / 1000) * 5); r.t = t; this.rate.set(k, r);
        if (r.tokens < 1) return false;
        r.tokens -= 1; return true;
    }
    private seenOp(p: Player, op: number): boolean {
        const l = this.ops.get(key(p)) ?? [];
        if (l.includes(op)) return true;
        l.push(op); if (l.length > OPS_KEEP) l.shift();
        this.ops.set(key(p), l);
        return false;
    }

    /** Pedido del cliente. `find` busca a un jugador por id entre los que `p` ve (lo da el mundo). */
    handle(p: Player, req: TradeRequest, find: (id: bigint) => Player | undefined): void {
        if (!p.econ || !p.accountKey || p.disconnected) return;
        if (!this.allow(p.accountKey)) { p.send(M.econResult(false, 'slow', 'Más despacio.')); return; }
        if (req.opId && this.seenOp(p, req.opId)) return;
        let r: TradeOutcome | null;
        try {
            switch (req.action) {
                case 'give': r = this.inviteGive(p, find(req.targetId), req); break;
                case 'offer': r = this.inviteExchange(p, find(req.targetId)); break;
                case 'accept': r = this.accept(p); break;
                case 'decline': r = this.decline(p); break;
                case 'cancel': r = this.cancel(p); break;
                case 'add': r = this.add(p, req.uid); break;
                case 'remove': r = this.remove(p, req.uid); break;
                case 'gold': r = this.setGold(p, req.amount); break;
                case 'confirm': r = this.confirm(p); break;
                default: r = fail('bad_action', 'Acción inválida.');
            }
        } catch (err) { console.error('[Intercambio] error en acción:', err); r = fail('error', 'No se pudo completar.'); }
        if (r && !r.ok) p.send(M.econResult(false, r.code, r.text));
    }

    // ---------- invitaciones ----------
    private startInvite(p: Player, o: Player | undefined, kind: 'give' | 'exchange', uid: number, gold: number): TradeOutcome | Invite {
        if (!o || o === p) return fail('no_target', 'No ves a ese jugador.');
        const why = this.pairProblem(p, o); if (why) return fail('pair', why);
        if (this.busy(p)) return fail('busy', 'Ya tenés un intercambio o una invitación en curso.');
        if (this.busy(o)) return fail('busy', `${o.characterName} está ocupado con otro intercambio.`);
        const inv: Invite = { kind, from: p, to: o, uid, gold, expires: this.now() + TRADE_INVITE_MS };
        this.invites.set(key(o), inv);
        return inv;
    }

    private inviteGive(p: Player, o: Player | undefined, req: TradeRequest): TradeOutcome {
        const uid = req.uid ? uidOf(req.uid) : 0, gold = req.amount ? goldOf(req.amount) : 0;
        if (uid === null || gold === null || (!uid && !gold) || (uid && gold)) return fail('bad_give', 'Elegí un item o una cantidad de oro (una cosa por vez).');
        const st = p.econ!;
        let item: SItem | undefined;
        if (uid) { item = st.bag.find((x) => x.u === uid); if (!item) return fail('no_item', 'No tenés ese item en la bolsa.'); if (!tradable(item)) return fail('no_trade', `${item.n} no se puede tradear.`); }
        if (gold && gold > st.gold) return fail('gold', 'No tenés tanto oro.');
        const cap = this.giveCapProblem(p, uid ? 1 : 0, gold); if (cap) return fail('give_cap', cap);
        if (o && uid && o.econ && o.econ.bag.length >= BAG_MAX) return fail('bag_full', `${o.characterName} no tiene lugar en la bolsa.`);
        if (o && gold && o.econ && o.econ.gold + gold > MAX_GOLD) return fail('gold_max', 'El oro no entra.');
        const inv = this.startInvite(p, o, 'give', uid, gold); if ('ok' in inv) return inv;
        inv.to.send(this.inviteMsg(inv, item));
        p.send(M.econResult(true, 'invited', `Le ofreciste ${item ? item.n : `${fmt(gold)} de oro`} a ${inv.to.characterName}. Esperando que acepte.`));
        return ok('Invitación enviada.', 'invited');
    }

    private inviteExchange(p: Player, o: Player | undefined): TradeOutcome {
        const inv = this.startInvite(p, o, 'exchange', 0, 0); if ('ok' in inv) return inv;
        inv.to.send(this.inviteMsg(inv));
        p.send(M.econResult(true, 'invited', `Le propusiste un intercambio a ${inv.to.characterName}. Esperando que acepte.`));
        return ok('Invitación enviada.', 'invited');
    }

    private accept(p: Player): TradeOutcome {
        const inv = this.invites.get(key(p)); if (!inv) return fail('gone', 'No tenés ninguna invitación pendiente.');
        this.invites.delete(key(p));
        const giver = inv.from;
        const clear = () => p.send(this.inviteCleared());
        if (inv.expires <= this.now()) { clear(); giver.send(M.econResult(false, 'expired', `${p.characterName} no respondió a tiempo.`)); return fail('expired', 'La invitación venció.'); }
        const why = this.pairProblem(giver, p);
        if (why) { clear(); giver.send(M.econResult(false, 'pair', why)); return fail('pair', why); }
        if (inv.kind === 'exchange') {
            clear();
            const w: Window = { id: this.nextId++, a: { p: giver, items: [], gold: 0, confirmed: false, fresh: new Set() }, b: { p, items: [], gold: 0, confirmed: false, fresh: new Set() } };
            this.windows.set(key(giver), w); this.windows.set(key(p), w);
            this.push(w);
            return ok('Ventana abierta.', 'opened');
        }
        // regalo: se revalida todo ahora (pasaron hasta 30 s)
        const cap = this.giveCapProblem(giver, inv.uid ? 1 : 0, inv.gold);
        if (cap) { clear(); giver.send(M.econResult(false, 'give_cap', cap)); return fail('give_cap', cap); }
        const r = this.swap(giver, inv.uid ? [inv.uid] : [], inv.gold, p, [], 0, 'give');
        clear();
        if (!r.ok) { giver.send(M.econResult(false, r.code, r.text)); return r; }
        const list = this.given.get(giver.accountKey) ?? [];
        list.push({ at: this.now(), items: inv.uid ? 1 : 0, gold: inv.gold }); this.given.set(giver.accountKey, list);
        return r;
    }

    private decline(p: Player): TradeOutcome {
        const inv = this.invites.get(key(p)); if (!inv) return fail('gone', 'No tenés ninguna invitación pendiente.');
        this.invites.delete(key(p));
        p.send(this.inviteCleared());
        inv.from.send(M.econResult(false, 'declined', `${p.characterName} rechazó tu ${inv.kind === 'give' ? 'regalo' : 'propuesta de intercambio'}.`));
        return ok('Rechazaste la invitación.', 'declined');
    }

    private cancel(p: Player): TradeOutcome {
        const w = this.windows.get(key(p));
        if (w) { this.close(w, `${p.characterName} canceló el intercambio.`); return ok('Cancelado.', 'cancelled'); }
        const out = this.outgoing(p);
        if (out) { this.invites.delete(key(out.to)); out.to.send(this.inviteCleared()); return ok('Cancelaste la invitación.', 'cancelled'); }
        // sin ventana ni invitación propia: si tiene una invitación recibida, cancelar la rechaza
        if (this.invites.has(key(p))) return this.decline(p);
        return fail('gone', 'No tenés nada para cancelar.');
    }

    // ---------- ventana ----------
    private sides(p: Player): { w: Window; me: Side; other: Side } | null {
        const w = this.windows.get(key(p)); if (!w) return null;
        return w.a.p === p ? { w, me: w.a, other: w.b } : { w, me: w.b, other: w.a };
    }

    /** Saca de las ofertas lo que ya no está en la bolsa (se vendió, se tiró, se equipó). true si cambió algo. */
    private prune(w: Window): boolean {
        let changed = false;
        for (const s of [w.a, w.b]) {
            const keep = s.items.filter((u) => s.p.econ?.bag.some((x) => x.u === u && tradable(x)));
            if (keep.length !== s.items.length) { changed = true; s.items = keep; for (const u of [...s.fresh]) if (!keep.includes(u)) s.fresh.delete(u); }
            if (s.gold > (s.p.econ?.gold ?? 0)) { changed = true; s.gold = 0; }
        }
        if (changed) this.unconfirm(w);
        return changed;
    }
    private unconfirm(w: Window): void { w.a.confirmed = false; w.b.confirmed = false; }

    private add(p: Player, rawUid: number): TradeOutcome {
        const s = this.sides(p); if (!s) return fail('no_window', 'No hay un intercambio abierto.');
        const uid = uidOf(rawUid); if (uid === null) return fail('bad_uid', 'Item inválido.');
        this.prune(s.w);
        const it = p.econ!.bag.find((x) => x.u === uid);
        if (!it) return fail('no_item', 'No tenés ese item en la bolsa.');
        if (!tradable(it)) return fail('no_trade', `${it.n} no se puede tradear.`);
        if (s.me.items.includes(uid)) return fail('dup', 'Ese item ya está en tu oferta.');
        if (s.me.items.length >= TRADE_SLOTS) return fail('slots', `Solo entran ${TRADE_SLOTS} items por lado.`);
        s.me.items.push(uid); s.me.fresh.add(uid);
        this.unconfirm(s.w); this.push(s.w);
        return ok('Agregado.', 'added');
    }

    private remove(p: Player, rawUid: number): TradeOutcome {
        const s = this.sides(p); if (!s) return fail('no_window', 'No hay un intercambio abierto.');
        const uid = uidOf(rawUid); const i = uid === null ? -1 : s.me.items.indexOf(uid);
        if (i < 0) return fail('no_item', 'Ese item no está en tu oferta.');
        s.me.items.splice(i, 1); s.me.fresh.delete(uid!);
        this.prune(s.w); this.unconfirm(s.w); this.push(s.w);
        return ok('Sacado.', 'removed');
    }

    private setGold(p: Player, raw: number): TradeOutcome {
        const s = this.sides(p); if (!s) return fail('no_window', 'No hay un intercambio abierto.');
        const g = raw === 0 ? 0 : goldOf(raw);
        if (g === null) return fail('bad_gold', 'El oro tiene que ser un número entero.');
        if (g > p.econ!.gold) return fail('gold', 'No tenés tanto oro.');
        if (s.other.p.econ && s.other.p.econ.gold + g > MAX_GOLD) return fail('gold_max', 'El oro no entra.');
        s.me.gold = g;
        this.prune(s.w); this.unconfirm(s.w); this.push(s.w);
        return ok('Oro fijado.', 'gold');
    }

    private confirm(p: Player): TradeOutcome {
        const s = this.sides(p); if (!s) return fail('no_window', 'No hay un intercambio abierto.');
        const why = this.pairProblem(p, s.other.p);
        if (why) { this.close(s.w, why); return fail('pair', why); }
        if (this.prune(s.w)) { this.push(s.w); return fail('changed', 'La oferta cambió (un item ya no estaba): revisala y confirmá de nuevo.'); }
        if (!s.w.a.items.length && !s.w.b.items.length && !s.w.a.gold && !s.w.b.gold) return fail('empty', 'No hay nada para intercambiar todavía.');
        s.me.confirmed = true; s.other.fresh.clear(); // ya vio lo que hay ahora
        if (!s.other.confirmed) { this.push(s.w); return ok('Confirmaste. Esperando al otro.', 'confirmed'); }
        // confirmaron los dos: se hace el cambio
        const r = this.swap(s.w.a.p, s.w.a.items, s.w.a.gold, s.w.b.p, s.w.b.items, s.w.b.gold, 'exchange');
        if (!r.ok) {
            this.unconfirm(s.w); this.push(s.w);
            for (const q of [s.w.a.p, s.w.b.p]) q.send(M.econResult(false, r.code, `No se pudo completar: ${r.text}`));
            return ok('Falló el cambio.', 'failed');
        }
        this.close(s.w, '', true);
        return r;
    }

    private close(w: Window, reason: string, done = false): void {
        this.windows.delete(key(w.a.p)); this.windows.delete(key(w.b.p));
        const m = tradeStateMsg({ open: false, reason: done ? '' : reason });
        for (const q of [w.a.p, w.b.p]) if (!q.disconnected) q.send(m);
        if (!done && reason) for (const q of [w.a.p, w.b.p]) if (!q.disconnected) q.send(M.sendMessage(reason));
    }

    private push(w: Window): void {
        for (const [me, other] of [[w.a, w.b], [w.b, w.a]] as const) {
            if (me.p.disconnected) continue;
            const view = (s: Side) => s.items.map((u) => s.p.econ?.bag.find((x) => x.u === u)).filter((x): x is SItem => !!x).map(toInvItem);
            me.p.send(tradeStateMsg({ open: true, partner: other.p.characterName, mine: view(me), myGold: me.gold, myConfirmed: me.confirmed, theirs: view(other), theirGold: other.gold, theirConfirmed: other.confirmed, theirsNew: [...other.fresh] }));
        }
    }

    private inviteMsg(inv: Invite, item?: SItem): ServerMessage {
        return tradeInviteMsg({ kind: inv.kind, fromName: inv.from.characterName, fromId: inv.from.playerId, item: item ? toInvItem(item) : undefined, gold: inv.gold, expiresMs: BigInt(inv.expires) });
    }
    private inviteCleared(): ServerMessage { return tradeInviteMsg({ kind: '' }); }

    /** Cierra lo que deja de cumplirse (se alejó, se desconectó, cruzó de mapa) y vence las invitaciones. Cada 1 s. */
    sweep(): void {
        const t = this.now();
        for (const [k, inv] of [...this.invites]) {
            const why = inv.expires <= t ? `${inv.to.characterName} no respondió a tiempo.` : this.pairProblem(inv.from, inv.to);
            if (!why) continue;
            this.invites.delete(k);
            inv.to.send(this.inviteCleared()); inv.from.send(M.econResult(false, 'expired', why));
        }
        const seen = new Set<Window>();
        for (const w of this.windows.values()) {
            if (seen.has(w)) continue; seen.add(w);
            const why = this.pairProblem(w.a.p, w.b.p);
            if (why) this.close(w, `Se canceló el intercambio: ${why}`);
        }
    }
}

const tradeStateMsg = (value: DeepPartial<TradeState>): ServerMessage => ServerMessage.fromPartial({ payload: { $case: 'tradeState', value } });
const tradeInviteMsg = (value: DeepPartial<TradeInvite>): ServerMessage => ServerMessage.fromPartial({ payload: { $case: 'tradeInvite', value } });

// Un solo servicio para todo el server (todos los mundos): lo crea index.ts y lo usan los mundos.
let service: TradeService | null = null;
export const setTradeService = (s: TradeService | null): void => { service = s; };
export const tradeService = (): TradeService | null => service;
