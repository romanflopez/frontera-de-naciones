/**
 * Depósito (baúl/banco) por cuenta, server-autoritativo. Ver docs/DEPOSITO.md.
 *
 * - Guarda hasta 48 items de equipo (con su rareza y atributos intactos), oro sin tope de juego (techo técnico
 *   Number.MAX_SAFE_INTEGER, igual que el oro de la bolsa) y stacks de pociones, llaves y esquirlas.
 * - Es de la CUENTA (`AccountRecord.vault`), no del personaje: si un día hay varios personajes por cuenta, lo comparten.
 * - Se usa hablando con cualquier NPC de rol `depositario` (se reconoce por el rol, no por la posición) del mismo
 *   mundo/mapa en el que está el jugador.
 *
 * Atomicidad: cada acción valida todo y recién después aplica, síncrona dentro del event loop. El item sale de un
 * lado antes de existir en el otro y un segundo pedido por el mismo uid ya no lo encuentra. Bolsa y depósito viven en
 * el MISMO registro de la cuenta, así que el guardado inmediato (`flush`) los escribe juntos en una sola escritura
 * (archivo con tmp + rename, o un único upsert jsonb en Postgres): no hay estado intermedio en disco.
 * Reenvíos: el cliente numera cada pedido (`op_id`); los últimos números aplicados se guardan con el depósito y un
 * pedido repetido (por ejemplo, reenviado tras un corte) no se vuelve a aplicar, ni siquiera después de un reinicio.
 */
import {
    BAG_MAX, BASE_BY_NAME, DEPOT_ROLE, DEPOT_SLOTS, DEPOT_STACK_BY_ID, DEPOT_STACK_MAX, DEPOT_STACKS, roleOf, SHOP_SERVER_RANGE, SLOTS,
    type AttrId, type DepotStackDef, type DepotStackId, type Npc,
} from '@fdn/world';
import { ServerMessage, type DeepPartial, type DepositRequest, type DepositState } from '@fdn/proto';
import { MAX_GOLD, toInvItem, type Econ, type EconCtx, type SItem } from './economy.ts';
import * as M from './messages.ts';
import type { Player } from './player.ts';
import type { AccountRecord, Storage } from './storage.ts';

export interface Vault {
    v: 1;
    items: SItem[];
    gold: number;
    stacks: Partial<Record<DepotStackId, number>>;
    /** uid propio del depósito (los uid de la bolsa son por personaje: se renuevan al entrar y al salir). */
    nextUid: number;
    /** Últimos `op_id` aplicados (anti reenvío). */
    ops: number[];
}
type VaultRecord = AccountRecord & { vault?: Vault };

/** Cuántos `op_id` recientes se recuerdan por cuenta. */
export const DEPOT_OPS_KEEP = 32;

/** Quién hace la acción: la cuenta y el estado económico de su personaje (el del server). */
export interface Actor { key: string; name: string; econ: Econ }
export type DepotOutcome = { ok: boolean; code: string; text: string };
const fail = (code: string, text: string): DepotOutcome => ({ ok: false, code, text });
const ok = (text: string, code = 'ok'): DepotOutcome => ({ ok: true, code, text });
const fmt = (n: number) => Math.floor(n).toLocaleString('es-AR');
const copyItem = (i: SItem, u: number): SItem => ({ u, n: i.n, r: i.r, a: i.a.map((a) => ({ id: a.id as AttrId, v: a.v })), ...(i.up ? { up: i.up } : {}) });
const slotIdx = (i: SItem) => SLOTS.indexOf(BASE_BY_NAME.get(i.n)?.slot ?? 'anillo');

/** Monto entero positivo y exacto (el cliente puede mandar cualquier cosa). */
function amountOf(raw: unknown): number | null {
    const n = typeof raw === 'number' ? raw : NaN;
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n <= MAX_GOLD ? n : null;
}

/** Cuánto hay de un stack encima del personaje. */
function carried(st: Econ, d: DepotStackDef): number {
    if (d.kind === 'pot') return st.pots[d.ref as 'hp' | 'mp'] ?? 0;
    return (d.kind === 'key' ? st.q.keys : st.q.shards)[d.ref as 'cripta' | 'foso'] ?? 0;
}
function setCarried(st: Econ, d: DepotStackDef, n: number): void {
    if (d.kind === 'pot') st.pots[d.ref as 'hp' | 'mp'] = n;
    else (d.kind === 'key' ? st.q.keys : st.q.shards)[d.ref as 'cripta' | 'foso'] = n;
}

export class Depot {
    private readonly rate = new Map<string, { t: number; tokens: number }>();
    /** Registro de transacciones (consola por defecto). */
    log: (line: string) => void = (line) => console.log(`[Depósito] ${line}`);

    constructor(private readonly storage: Storage, private readonly now: () => number = Date.now) {}

    /** Depósito de la cuenta (vacío si nunca lo usó; se guarda recién con la primera operación). */
    vault(key: string): Vault {
        const acc = this.storage.get(key) as VaultRecord | undefined;
        const v = acc?.vault;
        if (v && v.v === 1) { v.ops ??= []; v.stacks ??= {}; return v; }
        const fresh: Vault = { v: 1, items: [], gold: 0, stacks: {}, nextUid: 1, ops: [] };
        if (acc) acc.vault = fresh; // queda colgado de la cuenta en memoria; se escribe con la primera operación
        return fresh;
    }

    /** `op_id` del pedido en curso: se anota en el depósito dentro de la MISMA escritura que el cambio. */
    private pendingOp = 0;

    /** Escribe bolsa y depósito juntos: es un solo registro (la cuenta), así que es una sola escritura. */
    private save(a: Actor, v: Vault): void {
        const acc = this.storage.get(a.key) as VaultRecord | undefined; if (!acc) return;
        if (this.pendingOp) {
            v.ops.push(this.pendingOp); this.pendingOp = 0;
            if (v.ops.length > DEPOT_OPS_KEEP) v.ops.splice(0, v.ops.length - DEPOT_OPS_KEEP);
        }
        acc.econ = a.econ; acc.vault = v;
        this.storage.put(a.key, acc);
        this.storage.flush();
    }

    // ---------- acciones (núcleo, sin red: se prueban en test/deposit.test.ts) ----------
    put(a: Actor, uid: number): DepotOutcome {
        const st = a.econ, v = this.vault(a.key);
        const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item en la bolsa.');
        if (!BASE_BY_NAME.has(st.bag[i].n)) return fail('bad_item', 'Ese item no se puede guardar.');
        if (v.items.length >= DEPOT_SLOTS) return fail('depot_full', `El depósito está lleno (${DEPOT_SLOTS} / ${DEPOT_SLOTS}).`);
        const [it] = st.bag.splice(i, 1); // sale de la bolsa antes de existir en el depósito
        v.items.push(copyItem(it, v.nextUid++));
        this.save(a, v);
        this.log(`${a.name} guarda ${it.n} (r${it.r}${it.a.length ? `, ${it.a.map((x) => `${x.id}+${x.v}`).join(' ')}` : ''}); depósito ${v.items.length}/${DEPOT_SLOTS}.`);
        return ok(`Guardaste ${it.n}.`, 'put');
    }

    take(a: Actor, uid: number): DepotOutcome {
        const st = a.econ, v = this.vault(a.key);
        const i = v.items.findIndex((x) => x.u === uid); if (i < 0) return fail('gone', 'Ese item ya no está en el depósito.');
        if (st.bag.length >= BAG_MAX) return fail('bag_full', `La bolsa está llena (${BAG_MAX} / ${BAG_MAX}): hacé lugar antes de retirar.`);
        const [it] = v.items.splice(i, 1);
        st.bag.push(copyItem(it, st.nextUid++));
        this.save(a, v);
        this.log(`${a.name} retira ${it.n} (r${it.r}); depósito ${v.items.length}/${DEPOT_SLOTS}.`);
        return ok(`Retiraste ${it.n}.`, 'take');
    }

    goldIn(a: Actor, raw: unknown): DepotOutcome {
        const st = a.econ, v = this.vault(a.key), n = amountOf(raw);
        if (n === null) return fail('bad_amount', 'El monto tiene que ser un número entero de oro mayor que 0.');
        if (st.gold < n) return fail('gold', `No tenés tanto oro: llevás ${fmt(st.gold)}.`);
        if (v.gold + n > MAX_GOLD) return fail('depot_gold_max', 'El depósito no puede guardar tanto oro.');
        st.gold -= n; v.gold += n;
        this.save(a, v);
        this.log(`${a.name} deposita ${n} de oro; en depósito ${v.gold}, encima ${st.gold}.`);
        return ok(`Depositaste ${fmt(n)} de oro.`, 'gold_in');
    }

    goldOut(a: Actor, raw: unknown): DepotOutcome {
        const st = a.econ, v = this.vault(a.key), n = amountOf(raw);
        if (n === null) return fail('bad_amount', 'El monto tiene que ser un número entero de oro mayor que 0.');
        if (v.gold < n) return fail('depot_gold', `No hay tanto oro en el depósito: hay ${fmt(v.gold)}.`);
        if (st.gold + n > MAX_GOLD) return fail('gold_max', 'No podés llevar tanto oro encima.');
        v.gold -= n; st.gold += n;
        this.save(a, v);
        this.log(`${a.name} retira ${n} de oro; en depósito ${v.gold}, encima ${st.gold}.`);
        return ok(`Retiraste ${fmt(n)} de oro.`, 'gold_out');
    }

    stackIn(a: Actor, id: string, raw: unknown): DepotOutcome {
        const st = a.econ, v = this.vault(a.key), d = DEPOT_STACK_BY_ID.get(id as DepotStackId), n = amountOf(raw);
        if (!d) return fail('bad_stack', 'Eso no se puede guardar.');
        if (n === null) return fail('bad_amount', 'La cantidad tiene que ser un número entero mayor que 0.');
        const have = carried(st, d), stored = v.stacks[d.id] ?? 0;
        if (have < n) return fail('no_stack', have ? `Solo tenés ${have} de ${d.name}.` : `No tenés ${d.name}.`);
        if (stored + n > DEPOT_STACK_MAX) return fail('stack_full', `En el depósito entran hasta ${fmt(DEPOT_STACK_MAX)} de ${d.name}${stored < DEPOT_STACK_MAX ? ` (podés guardar ${fmt(DEPOT_STACK_MAX - stored)} más)` : ''}.`);
        setCarried(st, d, have - n); v.stacks[d.id] = stored + n;
        this.save(a, v);
        this.log(`${a.name} guarda ${n} × ${d.name}; en depósito ${stored + n}, encima ${have - n}.`);
        return ok(`Guardaste ${n} × ${d.name}.`, 'stack_in');
    }

    stackOut(a: Actor, id: string, raw: unknown): DepotOutcome {
        const st = a.econ, v = this.vault(a.key), d = DEPOT_STACK_BY_ID.get(id as DepotStackId), n = amountOf(raw);
        if (!d) return fail('bad_stack', 'Eso no está en el depósito.');
        if (n === null) return fail('bad_amount', 'La cantidad tiene que ser un número entero mayor que 0.');
        const have = carried(st, d), stored = v.stacks[d.id] ?? 0;
        if (stored < n) return fail('no_stack', stored ? `Solo hay ${stored} de ${d.name} en el depósito.` : `No hay ${d.name} en el depósito.`);
        if (have + n > d.carryMax) return fail('carry_max', `Solo podés llevar ${d.carryMax} de ${d.name}${have < d.carryMax ? ` (podés retirar ${d.carryMax - have})` : ''}.`);
        setCarried(st, d, have + n);
        if (stored - n > 0) v.stacks[d.id] = stored - n; else delete v.stacks[d.id];
        this.save(a, v);
        this.log(`${a.name} retira ${n} × ${d.name}; en depósito ${stored - n}, encima ${have + n}.`);
        return ok(`Retiraste ${n} × ${d.name}.`, 'stack_out');
    }

    sort(a: Actor): DepotOutcome {
        const v = this.vault(a.key);
        v.items.sort((x, y) => slotIdx(x) - slotIdx(y) || y.r - x.r || x.n.localeCompare(y.n, 'es') || x.u - y.u);
        this.save(a, v);
        return ok('Depósito ordenado.', 'sort');
    }

    /**
     * Corre una acción con anti reenvío: si `opId` (≠ 0) ya se aplicó, no hace nada. El número se guarda en el depósito
     * en la misma escritura que el cambio, así que tampoco se repite después de un reinicio.
     */
    apply(a: Actor, req: Pick<DepositRequest, 'action' | 'uid' | 'amount' | 'stack' | 'opId'>): DepotOutcome | null {
        const v = this.vault(a.key), op = req.opId >>> 0;
        if (op && v.ops.includes(op)) return ok('', 'dup');
        this.pendingOp = op; // solo se anota si la acción llega a guardar (si falla, no se guarda nada)
        try {
            switch (req.action) {
                case 'open': return null;
                case 'put': return this.put(a, req.uid);
                case 'take': return this.take(a, req.uid);
                case 'gold_in': return this.goldIn(a, req.amount);
                case 'gold_out': return this.goldOut(a, req.amount);
                case 'stack_in': return this.stackIn(a, req.stack, req.amount);
                case 'stack_out': return this.stackOut(a, req.stack, req.amount);
                case 'sort': return this.sort(a);
                default: return fail('bad_action', 'Acción inválida.');
            }
        } finally { this.pendingOp = 0; }
    }

    // ---------- red ----------
    private allow(key: string): boolean {
        const t = this.now(), r = this.rate.get(key) ?? { t, tokens: 12 };
        r.tokens = Math.min(12, r.tokens + ((t - r.t) / 1000) * 6); r.t = t; this.rate.set(key, r);
        if (r.tokens < 1) return false;
        r.tokens -= 1; return true;
    }

    /** El NPC pedido existe en el mapa del jugador, tiene rol de depositario y está cerca. */
    private nearDepositario(p: Player, ctx: EconCtx, npcId: string): Npc | undefined {
        const n = ctx.npcs.find((x) => x.id === npcId);
        if (!n || roleOf(n) !== DEPOT_ROLE) return undefined;
        return Math.hypot(p.posX - n.x, p.posY - n.y) <= SHOP_SERVER_RANGE ? n : undefined;
    }

    stateMessage(key: string): ServerMessage {
        const v = this.vault(key);
        return depositStateMsg({
            items: v.items.map(toInvItem), gold: v.gold, capacity: DEPOT_SLOTS, stackMax: DEPOT_STACK_MAX,
            stacks: DEPOT_STACKS.filter((d) => (v.stacks[d.id] ?? 0) > 0).map((d) => ({ id: d.id, qty: v.stacks[d.id] ?? 0 })),
        });
    }

    /** Pedido del cliente: valida sesión, ritmo, vida, cruce de mapa y distancia al Depositario; corre la acción y manda resultado + estado. */
    handle(p: Player, ctx: EconCtx, req: DepositRequest): void {
        const st = p.econ;
        if (!st || p.disconnected || !p.accountKey) return;
        const say = (r: DepotOutcome) => p.send(M.econResult(r.ok, r.code, r.text));
        if (!this.allow(p.accountKey)) { say(fail('slow', 'Más despacio con el Depositario.')); return; }
        if (p.isDead) { say(fail('dead', 'Estás muerto.')); return; }
        if (!p.world) { say(fail('transit', 'No podés usar el depósito mientras cruzás de mapa.')); return; }
        if (!this.nearDepositario(p, ctx, req.npcId)) { say(fail('far', 'Estás muy lejos del Depositario.')); return; }
        const a: Actor = { key: p.accountKey, name: p.characterName || 'Alguien', econ: st };
        let r: DepotOutcome | null;
        try { r = this.apply(a, req); } catch (err) { console.error('[Depósito] error en acción:', err); r = fail('error', 'No se pudo completar.'); }
        if (r && r.code !== 'dup') say(r);
        if (r?.ok || r?.code === 'dup') p.send(M.inventoryState(st));
        p.send(this.stateMessage(a.key));
    }
}

const depositStateMsg = (value: DeepPartial<DepositState>): ServerMessage => ServerMessage.fromPartial({ payload: { $case: 'depositState', value } });

// Un solo depósito para todo el server (todos los mundos): lo crea index.ts y lo usan los mundos.
let depot: Depot | null = null;
export const setDepot = (d: Depot | null): void => { depot = d; };
export const depotService = (): Depot | null => depot;
