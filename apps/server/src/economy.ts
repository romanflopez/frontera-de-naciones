/**
 * Economía autoritativa. El server es dueño del oro, la bolsa, el equipo, el nivel/exp, las pociones y las misiones
 * de cada personaje; el cliente pide acciones (comprar, vender, equipar, tirar, entregar misión...) y el server las
 * valida contra las tablas compartidas de `@fdn/world` (precios, stock, bases, atributos) y contra su propio estado.
 * Todo es síncrono: cada acción es atómica dentro del event loop, así que dos pedidos "a la vez" sobre el mismo item
 * se resuelven en orden y el segundo falla (no hay forma de duplicar).
 *
 * Persistencia: el estado va en la propia cuenta (`AccountRecord.econ`, JSON versionado) y se guarda por el mismo
 * Storage (archivos o Postgres). Ver docs/ECONOMIA_SERVER.md.
 */
import {
    ATTR_RANGES, BAG_MAX, BASE_BY_NAME, BASES, KEY_IDS, KEYDEFS, POT_MAX, POTS, QUESTS, roleOf, SHARDS_PER_KEY, SHOP_SERVER_RANGE,
    SHOPS, SLOTS, SRV_ATTR, TRAINING, buildSolmar, expToLevel, mobDef, sellPrice, trainingUnlocked,
    type AttrId, type KeyId, type MobDef, type MobType, type Npc, type PotKind, type Slot,
} from '@fdn/world';
import { RARITY_INDEX, rollMobDrop, type GeneratedItem } from './loot/itemGenerator.ts';
import { canPickup, GROUND_MAX_PER_OWNER, PICKUP_RANGE, type GroundApi } from './ground.ts';
import * as M from './messages.ts';
import type { Player } from './player.ts';
import type { AccountRecord, Storage } from './storage.ts';

export const ECON_VERSION = 2;
export const MAX_LVL = 60;
/** Sin límite de oro de juego: el único techo es el técnico (entero exacto en JS / double del protocolo). */
export const MAX_GOLD = Number.MAX_SAFE_INTEGER;
/** Topes de la importación única desde lo que el cliente tenía guardado (cuentas anteriores a la economía del server). El oro NO tiene tope: se importa tal cual (saneado). */
export const IMPORT_CAPS = { lvl: 40, pots: 99, keys: 9, shards: 9 } as const;
/** Cuánto falta para que un item caído al suelo lo pueda recoger cualquiera: botín de mob con la bolsa llena / item tirado por el jugador. */
const lootScale = (() => { const v = Number(process.env.FDN_DEBUG_LOOT_SCALE); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1; })(); // solo pruebas: acorta las esperas
export const LOOT_FREE_MS = 60_000 * lootScale;
export const DROP_FREE_MS = 30_000 * lootScale;

export interface SItem { u: number; n: string; r: number; a: { id: AttrId; v: number }[] }
export interface Econ {
    v: number;
    cls: string; faction: string;
    lvl: number; exp: number; gold: number;
    /** Vida y maná al salir (el server los lleva en vivo en Player; acá solo se guardan). */
    hp: number; mp: number;
    bag: SItem[];
    eq: Record<Slot, SItem | null>;
    pots: { hp: number; mp: number };
    q: { i: number; st: 'new' | 'active' | 'ready'; prog: number; keys: Record<KeyId, number>; shards: Record<KeyId, number> };
    /** Portales de entrenamiento ya abiertos. */
    u: string[];
    nextUid: number;
    /** Si vino de la importación única del guardado del cliente: cuándo y qué se aceptó. */
    imported?: { at: number; gold: number; lvl: number; items: number; clipped: string[] };
}

const CLASS_KIT: Record<string, { weapon: string; armor: string }> = { guerrero: { weapon: 'Espada corta', armor: 'Coraza de cuero' }, mago: { weapon: 'Báculo de fresno', armor: 'Túnica de mago' } };
const FACTIONS = ['solmar', 'vhar'];

const clampInt = (v: unknown, lo: number, hi: number, def = lo): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : def);
const rint = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const emptyEq = (): Record<Slot, SItem | null> => ({ arma: null, armadura: null, cabeza: null, anillo: null });

// ---------- rangos válidos de atributos (los mismos que usa el generador de botín) ----------
let lootLvl = 0;
/** Nivel más alto de mob del juego (los bosses dan botín a nivel+2 en el cálculo viejo del cliente). */
function maxLootLvl(): number {
    if (lootLvl) return lootLvl;
    let l = 1; for (const z of buildSolmar().zones) l = Math.max(l, mobDef(z.type, z).lvl);
    return (lootLvl = l);
}
/** Valor máximo que el generador puede dar a un atributo (cualquiera de las dos fórmulas: la del server y la vieja del cliente). */
export function attrCap(id: AttrId): number {
    const L = maxLootLvl(), client = ATTR_RANGES[id][1] * (1 + (L + 2 - 1) * 0.2);
    const srv = 10 * (1 + L * 0.2) * 1.6, srvScaled = id === 'df' || id === 'rm' ? Math.min(30, srv * 0.6) : srv;
    return Math.ceil(Math.max(client, srvScaled));
}

// ---------- items ----------
function newItem(st: Econ, base: string, r: number, a: SItem['a']): SItem { return { u: st.nextUid++, n: base, r, a }; }

/** Item que sale del generador de botín del server (rareza + atributos + semilla de base). */
export function itemFromRoll(st: Econ, gen: GeneratedItem): SItem {
    const base = BASES[gen.baseSeed % BASES.length], attrs: SItem['a'] = [];
    for (const a of gen.attributes) { // la defensa y la RM del generador vienen en la escala vieja (%): se bajan a la escala DF/RM
        const id = SRV_ATTR[a.key]; if (!id) continue;
        const v = id === 'df' || id === 'rm' ? Math.min(30, Math.max(1, Math.round(a.value * 0.6))) : Math.max(1, Math.round(a.value));
        const dup = attrs.find((x) => x.id === id); if (dup) dup.v += v; else attrs.push({ id, v });
    }
    return newItem(st, base.name, RARITY_INDEX[gen.rarity], attrs);
}

/** Valida un item que dice tener el cliente (solo para la importación única). Devuelve null si la base no existe. */
function cleanImportItem(st: Econ, v: unknown, clipped: string[], trusted = false): SItem | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const base = typeof o.n === 'string' ? BASE_BY_NAME.get(o.n) : undefined; if (!base) return null;
    const r = clampInt(o.r, 0, 3), isShop = !BASES.includes(base);
    const a: SItem['a'] = [];
    if (isShop && !trusted) { // bases de tienda: solo existen con los atributos fijos de su línea de stock
        const line = Object.values(SHOPS).flatMap((s) => s.stock).find((x) => x.base === base.name);
        for (const [id, val] of line?.attrs ?? []) a.push({ id, v: val });
        if (r !== 0) clipped.push(`${base.name}: rareza ${r} -> 0`);
        return newItem(st, base.name, 0, a);
    }
    for (const x of Array.isArray(o.a) ? o.a : []) {
        if (!trusted && a.length >= r) { clipped.push(`${base.name}: atributo de más`); break; }
        const e = (x ?? {}) as Record<string, unknown>;
        const id = (e.id === 'fres' || e.id === 'ires' ? 'rm' : e.id) as AttrId;
        if (typeof id !== 'string' || !(id in ATTR_RANGES)) continue;
        const raw = clampInt(e.v, 1, 1e6), cap = trusted ? 1e6 : attrCap(id), val = Math.min(raw, cap);
        if (raw > cap) clipped.push(`${base.name}: ${id} ${raw} -> ${cap}`);
        const dup = a.find((y) => y.id === id); if (dup) dup.v = Math.min(cap, dup.v + val); else a.push({ id, v: val });
    }
    return newItem(st, base.name, r, a);
}

// ---------- estado ----------
export function newEcon(cls: string, faction: string): Econ {
    const kit = CLASS_KIT[cls] ?? CLASS_KIT.guerrero;
    const st: Econ = {
        v: ECON_VERSION, cls: CLASS_KIT[cls] ? cls : 'guerrero', faction: FACTIONS.includes(faction) ? faction : 'solmar',
        lvl: 1, exp: 0, gold: 0, hp: 1, mp: 0, bag: [], eq: emptyEq(), pots: { hp: 3, mp: 3 },
        q: { i: 0, st: 'new', prog: 0, keys: { cripta: 0, foso: 0 }, shards: { cripta: 0, foso: 0 } }, u: [], nextUid: 1,
    };
    st.eq.arma = newItem(st, kit.weapon, 0, []); st.eq.armadura = newItem(st, kit.armor, 0, []);
    refreshUnlocks(st);
    const dbg = Number(process.env.FDN_DEBUG_GOLD); if (Number.isFinite(dbg) && dbg > 0) st.gold = Math.min(MAX_GOLD, Math.floor(dbg)); // solo pruebas
    return st;
}

/**
 * Importación única: toma lo que el cliente tenía guardado (JSON de CharSave v1, ya pasado por `sanitizeCharacter`)
 * y arma el estado del server con topes. Después de esto el save del cliente deja de valer para oro, items y nivel.
 */
export function importLegacy(json: string, trusted = false): Econ | null {
    let o: Record<string, any>;
    try { o = JSON.parse(json) as Record<string, any>; } catch { return null; }
    if (!o || typeof o !== 'object' || typeof o.cls !== 'string') return null;
    const st = newEcon(o.cls, String(o.faction ?? '')), clipped: string[] = [];
    st.gold = 0; st.bag = []; st.eq = emptyEq(); st.nextUid = 1;
    const lim = (what: string, raw: number, cap: number) => { if (trusted) return raw; if (raw > cap) clipped.push(`${what} ${raw} -> ${cap}`); return Math.min(raw, cap); };
    st.lvl = lim('nivel', clampInt(o.lvl, 1, MAX_LVL, 1), IMPORT_CAPS.lvl);
    st.exp = Math.min(clampInt(o.exp, 0, 1e9), expToLevel(st.lvl) - 1);
    st.gold = clampInt(o.gold, 0, MAX_GOLD); // sin tope de importación: solo entero >= 0 y finito
    for (const x of (Array.isArray(o.bag) ? o.bag : []).slice(0, BAG_MAX)) { const it = cleanImportItem(st, x, clipped, trusted); if (it) st.bag.push(it); }
    for (const s of SLOTS) {
        const it = cleanImportItem(st, o.eq?.[s], clipped, trusted);
        if (it && BASE_BY_NAME.get(it.n)!.slot === s) st.eq[s] = it;
    }
    // sin arma ni armadura (cuenta rota): kit de la clase
    const kit = CLASS_KIT[st.cls];
    if (!trusted && !st.eq.arma && !st.bag.some((i) => BASE_BY_NAME.get(i.n)!.slot === 'arma')) st.eq.arma = newItem(st, kit.weapon, 0, []);
    st.pots = { hp: lim('pociones de vida', clampInt(o.pots?.hp, 0, 1e6), IMPORT_CAPS.pots), mp: lim('pociones de maná', clampInt(o.pots?.mp, 0, 1e6), IMPORT_CAPS.pots) };
    const q = o.q ?? {}, qi = clampInt(q.i, 0, QUESTS.length);
    st.q.i = qi; st.q.st = qi < QUESTS.length && (q.st === 'active' || q.st === 'ready') ? q.st : 'new';
    st.q.prog = st.q.st === 'new' ? 0 : clampInt(q.prog, 0, QUESTS[qi]?.n ?? 0);
    if (st.q.st === 'ready' && st.q.prog < (QUESTS[qi]?.n ?? 0)) st.q.st = 'active'; // "lista" sin haber matado lo pedido: no vale
    for (const k of KEY_IDS) {
        st.q.keys[k] = lim(`llaves ${k}`, clampInt(q.keys?.[k], 0, 1e6), IMPORT_CAPS.keys);
        st.q.shards[k] = lim(`esquirlas ${k}`, clampInt(q.shards?.[k], 0, 1e6), IMPORT_CAPS.shards);
    }
    st.u = []; refreshUnlocks(st);
    st.hp = clampInt(o.hp, 1, 100000, 1); st.mp = clampInt(o.mp, 0, 100000);
    st.imported = { at: Date.now(), gold: st.gold, lvl: st.lvl, items: st.bag.length + SLOTS.filter((s) => st.eq[s]).length, clipped };
    return st;
}

/** Abre los portales de entrenamiento que la misión entregada o el nivel justifican (los abiertos no se cierran). */
function refreshUnlocks(st: Econ): void {
    for (const t of TRAINING) if (!st.u.includes(t.id) && trainingUnlocked(t.step, st.q.i, st.lvl)) st.u.push(t.id);
}

/** Sube de nivel mientras alcance la exp. Devuelve cuántos niveles subió. */
function levelUp(st: Econ): number {
    let n = 0;
    while (st.lvl < MAX_LVL && st.exp >= expToLevel(st.lvl)) { st.exp -= expToLevel(st.lvl); st.lvl++; n++; }
    if (st.lvl >= MAX_LVL) st.exp = Math.min(st.exp, expToLevel(st.lvl) - 1);
    refreshUnlocks(st);
    return n;
}
const addGold = (st: Econ, n: number) => { st.gold = Math.min(MAX_GOLD, Math.max(0, st.gold + n)); };
const bonus = (st: Econ, id: AttrId): number => SLOTS.reduce((s, sl) => s + (st.eq[sl]?.a.find((x) => x.id === id)?.v ?? 0), 0);

// ---------- vistas hacia el cliente ----------
export const toInvItem = (i: SItem) => ({ uid: i.u, base: i.n, rarity: i.r, attrs: i.a.map((a) => ({ id: a.id, v: a.v })) });

/** JSON de CharSave v1 que usa el cliente para la pantalla de selección y para armar su espejo inicial. */
export function toCharSave(st: Econ): string {
    const it = (i: SItem | null) => (i ? { n: i.n, r: i.r, a: i.a } : null);
    return JSON.stringify({
        v: 1, faction: st.faction, cls: st.cls, lvl: st.lvl, exp: st.exp, gold: st.gold, hp: st.hp, mp: st.mp,
        bag: st.bag.map(it), eq: Object.fromEntries(SLOTS.map((s) => [s, it(st.eq[s])])),
        q: { i: st.q.i, st: st.q.st, prog: st.q.prog, keys: st.q.keys, shards: st.q.shards }, pots: st.pots, u: st.u,
    });
}

export interface EconCtx {
    npcs: readonly Npc[];
    /** Recalcula los stats de combate del jugador a partir del estado (equipo/nivel) y avisa vida/maná. */
    restat(p: Player): void;
    /** Botín en el suelo del mundo del jugador. */
    ground: GroundApi;
}
export interface KillInfo { mobId: number; type: MobType; def: MobDef; zoneName: string; x: number; y: number }

const fail = (code: string, text: string) => ({ ok: false as const, code, text });
type Outcome = { ok: true; code: string; text: string; stats?: boolean } | { ok: false; code: string; text: string };
const done = (text: string, stats = false, code = 'ok'): Outcome => ({ ok: true, code, text, stats });

export class Economy {
    private readonly rate = new WeakMap<Player, { t: number; tokens: number }>();
    constructor(private readonly storage: Storage) {}

    private acc(key: string): AccountRecord | undefined { return this.storage.get(key); }

    /** Estado de la cuenta; si es una cuenta vieja (guardado del cliente, sin `econ`), lo importa una sola vez. */
    load(key: string): Econ | undefined {
        const acc = this.acc(key); if (!acc) return undefined;
        if (!acc.econ && acc.character) {
            const st = importLegacy(acc.character);
            if (st) {
                acc.econ = st; this.storage.put(key, acc);
                console.log(`[Economía] ${acc.name}: importación única del guardado del cliente -> nivel ${st.lvl}, oro ${st.gold}, ${st.imported?.items} items${st.imported?.clipped.length ? `; recortado: ${st.imported.clipped.join('; ')}` : ''}.`);
            }
        }
        return acc.econ;
    }

    /** Une al jugador con el estado de su cuenta. */
    attach(p: Player, key: string): Econ | undefined {
        p.accountKey = key; p.econ = this.load(key);
        return p.econ;
    }

    /**
     * SOLO PRUEBAS (FDN_DEBUG_TRUST_SAVE=1): el guardado del cliente define todo el estado, como antes de la economía del server.
     * Sirve para los scripts de combate, que arman personajes de nivel y equipo arbitrarios.
     */
    debugReplace(p: Player, raw: string): Econ | undefined {
        const acc = this.acc(p.accountKey); if (!acc) return undefined;
        const st = importLegacy(raw, true); if (!st) return undefined;
        delete st.imported; acc.econ = st; this.storage.put(p.accountKey, acc); p.econ = st;
        return st;
    }

    /** Cuenta sin personaje: el primer guardado del cliente solo aporta clase y bando; todo lo demás es el kit inicial. */
    createFromSave(p: Player, raw: string): Econ | undefined {
        if (p.econ || !p.accountKey) return p.econ;
        const acc = this.acc(p.accountKey); if (!acc) return undefined;
        let o: any; try { o = JSON.parse(raw); } catch { return undefined; }
        if (!o || typeof o.cls !== 'string' || !CLASS_KIT[o.cls] || !FACTIONS.includes(String(o.faction))) return undefined;
        const st = newEcon(o.cls, o.faction);
        acc.econ = st; this.storage.put(p.accountKey, acc); p.econ = st;
        console.log(`[Economía] ${acc.name}: personaje nuevo (${st.cls}, ${st.faction}) con el kit inicial.`);
        return st;
    }

    private touch(p: Player): void { const acc = this.acc(p.accountKey); if (acc && p.econ) { acc.econ = p.econ; this.storage.put(p.accountKey, acc); } }

    /** Guarda vida y maná del jugador en su estado (al salir y en cada guardado periódico). */
    persistVitals(p: Player): void {
        const st = p.econ; if (!st) return;
        st.hp = Math.max(1, Math.round(p.hp)); st.mp = Math.max(0, Math.round(p.mp)); this.touch(p);
    }

    snapshot(p: Player): void {
        const st = p.econ; if (!st) return;
        p.send(M.inventoryState(st));
    }

    private allow(p: Player): boolean {
        const now = Date.now(), r = this.rate.get(p) ?? { t: now, tokens: 20 };
        r.tokens = Math.min(20, r.tokens + ((now - r.t) / 1000) * 12); r.t = now;
        this.rate.set(p, r);
        if (r.tokens < 1) return false;
        r.tokens -= 1; return true;
    }

    private near(p: Player, ctx: EconCtx, npcId: string): Npc | undefined {
        const n = ctx.npcs.find((x) => x.id === npcId); if (!n) return undefined;
        return Math.hypot(p.posX - n.x, p.posY - n.y) <= SHOP_SERVER_RANGE ? n : undefined;
    }

    /** Corre una acción, avisa el resultado y manda la foto nueva (también si falló, para que el cliente se corrija). */
    private run(p: Player, ctx: EconCtx, fn: (st: Econ) => Outcome): void {
        const st = p.econ;
        if (!st || p.disconnected) return;
        if (!this.allow(p)) return;
        let r: Outcome;
        try { r = fn(st); } catch (err) { console.error('[Economía] error en acción:', err); r = fail('error', 'No se pudo completar.'); }
        if (r.ok) { this.touch(p); if (r.stats) ctx.restat(p); }
        p.send(M.econResult(r.ok, r.code, r.text));
        this.snapshot(p);
    }

    // ---------- tiendas ----------
    buy(p: Player, ctx: EconCtx, npcId: string, index: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const npc = this.near(p, ctx, npcId); if (!npc) return fail('far', 'Estás muy lejos del vendedor.');
            const line = SHOPS[roleOf(npc)]?.stock[index]; if (!line) return fail('no_stock', 'Ese vendedor no vende eso.');
            if (st.gold < line.price) return fail('gold', 'No te alcanza el oro.');
            if (line.pot) {
                if (st.pots[line.pot] >= POT_MAX) return fail('pots_max', 'Ya llevás el máximo de pociones.');
                addGold(st, -line.price); st.pots[line.pot] = Math.min(POT_MAX, st.pots[line.pot] + (line.qty ?? 1));
                return done(`Compraste ${(line.qty ?? 1) > 1 ? line.qty + ' ' : 'una '}${POTS[line.pot].name.toLowerCase()}${(line.qty ?? 1) > 1 ? 's' : ''} por ${line.price} de oro.`);
            }
            if (!line.base || !BASE_BY_NAME.has(line.base)) return fail('no_stock', 'Ese vendedor no vende eso.');
            if (st.bag.length >= BAG_MAX) return fail('bag_full', 'La bolsa está llena.');
            addGold(st, -line.price);
            st.bag.push(newItem(st, line.base, 0, (line.attrs ?? []).map(([id, v]) => ({ id, v }))));
            return done(`Compraste ${line.base} por ${line.price} de oro.`);
        });
    }

    sell(p: Player, ctx: EconCtx, npcId: string, uid: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const npc = this.near(p, ctx, npcId); if (!npc) return fail('far', 'Estás muy lejos del vendedor.');
            if (!SHOPS[roleOf(npc)]?.stock.length) return fail('no_shop', 'Ese NPC no compra.');
            const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item.');
            const it = st.bag[i], g = sellPrice(it.n, it.r);
            st.bag.splice(i, 1); addGold(st, g); // se saca primero y recién ahí se cobra: un segundo pedido por el mismo uid ya no lo encuentra
            return done(`Vendiste ${it.n} por ${g} de oro.`);
        });
    }

    // ---------- equipo ----------
    equip(p: Player, ctx: EconCtx, uid: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item.');
            const it = st.bag[i], slot = BASE_BY_NAME.get(it.n)?.slot; if (!slot) return fail('bad_item', 'Item inválido.');
            st.bag.splice(i, 1);
            const prev = st.eq[slot]; if (prev) st.bag.push(prev);
            st.eq[slot] = it;
            return done(`Equipaste ${it.n}.`, true);
        });
    }

    unequip(p: Player, ctx: EconCtx, slot: string): void {
        this.run(p, ctx, (st) => {
            if (!SLOTS.includes(slot as Slot)) return fail('bad_slot', 'Slot inválido.');
            const it = st.eq[slot as Slot]; if (!it) return fail('empty', 'No hay nada puesto ahí.');
            if (st.bag.length >= BAG_MAX) return fail('bag_full', 'La bolsa está llena.');
            st.eq[slot as Slot] = null; st.bag.push(it);
            return done(`Te sacaste ${it.n}.`, true);
        });
    }

    /** Tirar un item: sale de la bolsa y queda en el suelo, tuyo durante 30 s (para poder arrepentirte) y de cualquiera después. */
    drop(p: Player, ctx: EconCtx, uid: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item.');
            if (ctx.ground.ownedCount(p.accountKey) >= GROUND_MAX_PER_OWNER) return fail('ground_full', 'Hay demasiados objetos tuyos en el suelo.');
            const [it] = st.bag.splice(i, 1);
            ctx.ground.add(it, Math.floor(p.posX) + 0.5, Math.floor(p.posY) + 0.5, [p.accountKey], DROP_FREE_MS);
            return done(`Tiraste ${it.n} al suelo.`);
        });
    }

    /** Recoger un item del suelo. Todo se valida acá y es atómico: el primero que llega se lo lleva, el segundo ya no lo encuentra. */
    pickup(p: Player, ctx: EconCtx, id: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const g = ctx.ground.get(id); if (!g) return fail('gone', 'Ese objeto ya no está.');
            if (Math.hypot(p.posX + 0.5 - g.x, p.posY + 0.5 - g.y) > PICKUP_RANGE) return fail('far', 'Está muy lejos.');
            if (!canPickup(g, p.accountKey, Date.now())) return fail('locked', 'Todavía no podés recoger ese objeto.');
            if (st.bag.length >= BAG_MAX) return fail('bag_full', 'Bolsa llena.');
            if (!ctx.ground.take(id)) return fail('gone', 'Ese objeto ya no está.');
            st.bag.push({ ...g.item, a: g.item.a.map((a) => ({ ...a })), u: st.nextUid++ }); // el uid es por personaje: se renueva
            return done(`Recogiste ${g.item.n}.`);
        });
    }

    sort(p: Player, ctx: EconCtx): void {
        this.run(p, ctx, (st) => {
            const slotIdx = (i: SItem) => SLOTS.indexOf(BASE_BY_NAME.get(i.n)!.slot);
            st.bag.sort((a, b) => slotIdx(a) - slotIdx(b) || b.r - a.r || a.n.localeCompare(b.n, 'es') || a.u - b.u);
            return done('Bolsa ordenada.');
        });
    }

    // ---------- misiones y llaves ----------
    quest(p: Player, ctx: EconCtx, npcId: string, action: string, key: string): void {
        this.run(p, ctx, (st) => {
            const npc = this.near(p, ctx, npcId); if (!npc || roleOf(npc) !== 'capitan') return fail('far', 'Estás muy lejos del Capitán.');
            const q = QUESTS[st.q.i];
            if (action === 'accept') {
                if (!q || st.q.st !== 'new') return fail('quest_state', 'No hay misión para aceptar.');
                st.q.st = 'active'; st.q.prog = 0;
                return done(`Misión aceptada: ${q.name}.`);
            }
            if (action === 'turnin') {
                if (!q || st.q.st !== 'ready' || st.q.prog < q.n) return fail('quest_state', 'Todavía no completaste la misión.');
                st.exp += q.xp; addGold(st, q.gold); if (q.shard) st.q.shards[q.shard] = Math.min(99, st.q.shards[q.shard] + 1);
                st.q.i++; st.q.st = 'new'; st.q.prog = 0;
                const ups = levelUp(st);
                return done(`Entregaste «${q.name}»: +${q.xp} exp, +${q.gold} oro${q.shard ? ' y una ' + KEYDEFS[q.shard].shard : ''}.${ups ? ` ¡Subiste a nivel ${st.lvl}!` : ''}`, ups > 0, ups ? 'level_up' : 'ok');
            }
            if (action === 'forge') {
                const k = key as KeyId, kd = KEYDEFS[k]; if (!kd) return fail('bad_key', 'Llave inválida.');
                if (st.q.shards[k] < SHARDS_PER_KEY) return fail('shards', 'Te faltan esquirlas.');
                if (st.gold < kd.gold) return fail('gold', 'No te alcanza el oro.');
                st.q.shards[k] -= SHARDS_PER_KEY; addGold(st, -kd.gold); st.q.keys[k]++;
                return done(`El Capitán forjó una ${kd.name}.`);
            }
            return fail('bad_action', 'Acción inválida.');
        });
    }

    /** Un portal con llave se cruzó: gasta una (el server ya validó el paso). */
    consumeKey(p: Player, key: string): void {
        const st = p.econ; if (!st || !(key in st.q.keys)) return;
        const k = key as KeyId; st.q.keys[k] = Math.max(0, st.q.keys[k] - 1);
        this.touch(p); this.snapshot(p);
    }

    // ---------- pociones ----------
    /** ¿Tiene al menos una poción de ese tipo? */
    hasPotion(p: Player, kind: PotKind): boolean { return (p.econ?.pots[kind] ?? 0) > 0; }
    /** Gasta una poción (el world ya validó GCD y que haga falta). */
    spendPotion(p: Player, kind: PotKind): void { const st = p.econ; if (!st) return; st.pots[kind] = Math.max(0, st.pots[kind] - 1); this.touch(p); }

    // ---------- muerte y botín ----------
    /** Muerte: se pierde el 5 % de la exp que pide el nivel (nunca baja de nivel). */
    onDeath(p: Player): void {
        const st = p.econ; if (!st) return;
        st.exp = Math.max(0, st.exp - Math.round(expToLevel(st.lvl) * 0.05)); this.touch(p); this.snapshot(p);
    }

    /** El server decide el botín del golpe final: exp, item o oro, poción, esquirla y avance de misión. Se llama una sola vez por mob muerto. */
    reward(p: Player, ctx: EconCtx, k: KillInfo): void {
        const st = p.econ; if (!st) return;
        const def = k.def, boss = def.boss;
        const gain = Math.round(def.exp * (1 + bonus(st, 'exp') / 100));
        st.exp += gain;
        let gold = 0, item: SItem | undefined, bagFull = false, potion = '', shard = '';
        if (boss) {
            item = itemFromRoll(st, rollMobDrop(def.lvl, boss.minRar)); gold = rint(boss.gold[0], boss.gold[1]);
        } else if (Math.random() < 0.62) item = itemFromRoll(st, rollMobDrop(def.lvl, 0));
        else gold = rint(3, 8) * def.lvl;
        if (gold) addGold(st, gold);
        if (item) {
            if (st.bag.length < BAG_MAX) st.bag.push(item);
            else { bagFull = true; ctx.ground.add(item, Math.floor(p.posX) + 0.5, Math.floor(p.posY) + 0.5, [p.accountKey], LOOT_FREE_MS); } // nada se destruye: cae junto al jugador
        }
        if (Math.random() < 0.14) { const kind: PotKind = Math.random() < 0.6 ? 'hp' : 'mp'; if (st.pots[kind] < POT_MAX) { st.pots[kind]++; potion = kind; } }
        if (boss) { const kid: KeyId = k.zoneName === 'Cripta olvidada' ? 'foso' : 'cripta'; st.q.shards[kid] = Math.min(99, st.q.shards[kid] + 1); shard = kid; }
        let questReady = false, questProg = 0;
        const q = QUESTS[st.q.i];
        if (q && st.q.st === 'active' && q.type === k.type) {
            st.q.prog = Math.min(q.n, st.q.prog + 1); questProg = st.q.prog;
            if (st.q.prog >= q.n) { st.q.st = 'ready'; questReady = true; }
        }
        const ups = levelUp(st);
        this.touch(p);
        p.send(M.killReward({ mobId: k.mobId, x: k.x, y: k.y, exp: gain, gold, item: item ? toInvItem(item) : undefined, bagFull, potion, shard, newLvl: ups ? st.lvl : 0, questReady, questProg }));
        if (ups) ctx.restat(p); // subir de nivel cura (restat lo detecta por el nivel nuevo)
        this.snapshot(p);
    }
}
