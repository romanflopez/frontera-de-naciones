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
    ATTR_RANGES, traitExpMult, traitDropMult, BAG_MAX, BASE_BY_NAME, BASES, KEY_IDS, KEYDEFS, POT_MAX, POTS, QUESTS, roleOf, SHARDS_PER_KEY, SHOP_SERVER_RANGE,
    SHOPS, SLOTS, slotsFor, fitsSlot, TRAINING, cleanStats, defaultStats, expToLevel, legacyExpToLevel, STAT_CAP, STAT_IDS, STAT_NAMES, statPointsFree, statResetCost, type StatId, type Stats, levelExpMult, levelGapMult, MAX_LEVEL, sellPrice, trainingUnlocked,
    BOSS_UNIQUES, UNIQUES_BY_TIER, UNIQUE_BASES, UP_MAX, UP_MAX_BY_QUALITY, QUALITY_NAMES, EXTRAS_BY_QUALITY, rollExtra, rollExtras, uniqueIlvl, EXTRA_POOL, upGold, upStones, UNIQUE_BY_NAME, UNIQUE_TIERS_READY, UNIQUE_VARIATION, tierOfLevel, tierOfLvl, type UniqueBase,
    type AttrId, type KeyId, type MobDef, type MobType, type Npc, type PotKind, type Slot,
    DAILY_BY_ID, DAILY_EXP_PCT, DAILY_LIMIT, DUNGEON_BOSS, DUNGEON_IDS, DUNGEON_MAP, MAIN_QUESTS, QUEST_MATS, BOSS_KEY_DROPS, KEY_RECIPES, keyMatName, junkValue, MAT_REFORJA, reforgeGold, reforgeStones, keyMissing, REPEAT_MATS, RESERVED_MATS, TRAIT_MUTANT, applyQuestEvent, cleanQuestBook, dailyGold,
    mainComplete, newQuestBook, repeatGold, rewardUniques, rollDailies, type QuestBook, type QuestEvent, type QuestHave, type QuestReward,
} from '@fdn/world';
import { DAILY_INDEX_BASE, dailyOffers, dayKey } from './dailyShop.ts';
import { canPickup, GROUND_MAX_PER_OWNER, PICKUP_RANGE, type GroundApi } from './ground.ts';
import * as M from './messages.ts';
import type { Player } from './player.ts';
import type { AccountRecord, Storage } from './storage.ts';

/** v3: nivel máximo 40 y curva de exp nueva (migra la exp guardada conservando la fracción del nivel). v4: puntos de stats. */
export const ECON_VERSION = 6;
export const MAX_LVL = MAX_LEVEL;
/** Sin límite de oro de juego: el único techo es el técnico (entero exacto en JS / double del protocolo). */
export const MAX_GOLD = Number.MAX_SAFE_INTEGER;
/** Topes de la importación única desde lo que el cliente tenía guardado (cuentas anteriores a la economía del server). El oro NO tiene tope: se importa tal cual (saneado). */
export const IMPORT_CAPS = { lvl: 40, pots: 99, keys: 9, shards: 9 } as const;
/** Cuánto falta para que un item caído al suelo lo pueda recoger cualquiera: botín de mob con la bolsa llena / item tirado por el jugador. */
const lootScale = (() => { const v = Number(process.env.FDN_DEBUG_LOOT_SCALE); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1; })(); // solo pruebas: acorta las esperas
export const LOOT_FREE_MS = 60_000 * lootScale;
export const DROP_FREE_MS = 30_000 * lootScale;

export interface SItem { u: number; n: string; r: number; a: { id: AttrId; v: number }[]; /** nivel de mejora (+N), solo ítems únicos */ up?: number; /** reforjas ya hechas (el costo de la próxima se duplica con cada una) */ rf?: number }
export interface Econ {
    v: number;
    cls: string; faction: string;
    lvl: number; exp: number; gold: number;
    /** Puntos de stats repartidos (arrancan en 10; los puntos libres salen del nivel, ver @fdn/world stats.ts). */
    stats: Stats;
    /** Vida y maná al salir (el server los lleva en vivo en Player; acá solo se guardan). */
    hp: number; mp: number;
    bag: SItem[];
    eq: Record<Slot, SItem | null>;
    /** Piedras de forja (material de mejora). Las cuentas viejas no lo tienen: se toma como 0. */
    forge?: number;
    /** Materiales apilables levantados del suelo (systems/loot.ts), por id. Las cuentas viejas no lo tienen. */
    mats?: Record<string, number>;
    pots: { hp: number; mp: number };
    q: { i: number; st: 'new' | 'active' | 'ready'; prog: number; keys: Record<KeyId, number>; shards: Record<KeyId, number> };
    /** Misiones del corte del MVP: cadena de 5, encargos del día (@fdn/world quests.ts). Las cuentas viejas no lo tienen: se crea al cargar. */
    qb?: QuestBook;
    /** Portales de entrenamiento ya abiertos. */
    u: string[];
    nextUid: number;
    /** Si vino de la importación única del guardado del cliente: cuándo y qué se aceptó. */
    imported?: { at: number; gold: number; lvl: number; items: number; clipped: string[] };
}

const CLASS_KIT: Record<string, { weapon: string; armor: string }> = { guerrero: { weapon: 'Espada corta', armor: 'Coraza de cuero' }, mago: { weapon: 'Báculo de fresno', armor: 'Túnica de mago' },
    healer: { weapon: 'Báculo de fresno', armor: 'Túnica de mago' } }; // healer con bastón (K5); sus ítems propios de T1-T2 van aparte
const FACTIONS = ['solmar', 'vhar'];

const clampInt = (v: unknown, lo: number, hi: number, def = lo): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : def);
const rint = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const emptyEq = (): Record<Slot, SItem | null> => ({ arma: null, armadura: null, cabeza: null, guantes: null, botas: null, amuleto: null, anillo: null, anillo2: null });

// ---------- items ----------
function newItem(st: Econ, base: string, r: number, a: SItem['a']): SItem { return { u: st.nextUid++, n: base, r, a }; }

/** Probabilidades de botín de los mobs de bandas con ítems únicos (docs/ITEMS.md §5). El resto del tiempo cae oro. */
export const UNIQUE_CHANCE = { loose: 0.005, pit: 0.015, dungeon: 0.04 };
/** Piedras de forja: chance por muerte según el origen del mob, y cantidad que suelta un jefe. */
export const FORGE_CHANCE = { loose: 0.05, pit: 0.08, dungeon: 0.18 };
export const FORGE_BOSS: [number, number] = [3, 5];
/**
 * Probabilidad de éxito de cada mejora (+1 .. +11): arranca en 33 % para que la gente pueda "limar". Solo vive en el server.
 * Hasta +5, al fallar no pasa nada (se pierden piedras y oro); de +6 en adelante es la zona de riesgo: al fallar el ítem BAJA un nivel.
 */
export const UP_RATE = [0.33, 0.33, 0.33, 0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05];
/** Desde esta mejora, el fallo baja el ítem un nivel. */
export const UP_RISK_FROM = 5;
export const GOLD_CHANCE = 0.45;
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// ---------- calidad del botín (docs/ITEMS.md: la calidad define extras y tope de mejora) ----------
/** Calidad de un único de banda al caer de un mob común: casi siempre Verde; Azul con suerte (más en mazmorra). */
export function rollQuality(origin: 'loose' | 'pit' | 'dungeon'): number {
    const r = Math.random();
    return r < (origin === 'dungeon' ? 0.4 : origin === 'pit' ? 0.15 : 0.1) ? 2 : 1;
}
/** Escalera de los jefes: cada uno garantiza su escalón y tira la chance del siguiente (D1-D2 Azul+25 % Dorado; D3-D5 Dorado+15 % Violeta; D6-D7 Violeta). */
export function bossQuality(tier: number): number {
    const r = Math.random();
    return tier >= 6 ? 4 : tier >= 3 ? (r < 0.15 ? 4 : 3) : r < 0.25 ? 3 : 2;
}
/** Un ítem único: sus fijos del catálogo (±10 %), la calidad en `r` y los extras que la calidad indica, al final de `a`. */
export function uniqueItem(st: Econ, u: UniqueBase, quality?: number): SItem {
    const q = quality ?? (u.uniq.boss ? bossQuality(u.uniq.tier) : 2);
    const a = u.uniq.attrs.map(([id, v]) => ({ id, v: Math.max(1, Math.round(v * (1 + (Math.random() * 2 - 1) * UNIQUE_VARIATION))) }));
    for (const [id, v] of rollExtras(u.slot, uniqueIlvl(u), q, u.uniq.attrs.map(([id]) => id))) a.push({ id, v });
    return newItem(st, u.name, q, a);
}

/** Valida un item que dice tener el cliente (solo para la importación única). Devuelve null si la base no existe. */
function cleanImportItem(st: Econ, v: unknown, clipped: string[], trusted = false): SItem | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const base = typeof o.n === 'string' ? BASE_BY_NAME.get(o.n) : undefined; if (!base) return null;
    const r = clampInt(o.r, 0, 3), uniq = UNIQUE_BY_NAME.get(base.name), isShop = !BASES.includes(base) && !uniq;
    const a: SItem['a'] = [];
    if (uniq && !trusted) { // únicos: solo con sus atributos fijos (se aceptan los del cliente si caen en la variación permitida)
        const lim = UNIQUE_VARIATION + 0.05, given = new Map<string, number>(); for (const x of Array.isArray(o.a) ? o.a : []) { const e = (x ?? {}) as Record<string, unknown>; if (typeof e.id === 'string') given.set(e.id, clampInt(e.v, 1, 1e6)); }
        for (const [id, v] of uniq.uniq.attrs) { const g = given.get(id); a.push({ id, v: g !== undefined && g >= Math.floor(v * (1 - lim)) && g <= Math.ceil(v * (1 + lim)) ? g : v }); }
        const ni = newItem(st, base.name, uniq.uniq.boss ? 4 : 2, a); const upv = clampInt(o.up, 0, UP_MAX); if (upv) ni.up = upv; const rfv = clampInt(o.rf, 0, 99); if (rfv) ni.rf = rfv; return ni;
    }
    if (isShop && !trusted) { // bases de tienda: solo existen con los atributos fijos de su línea de stock
        const line = Object.values(SHOPS).flatMap((s) => s.stock).find((x) => x.base === base.name);
        for (const [id, val] of line?.attrs ?? []) a.push({ id, v: val });
        if (r !== 0) clipped.push(`${base.name}: rareza ${r} -> 0`);
        return newItem(st, base.name, 0, a);
    }
    if (!trusted) { // bases comunes: el botín viejo con rareza y atributos al azar se eliminó → entran como ítem normal pelado
        if (r !== 0 || (Array.isArray(o.a) && o.a.length)) clipped.push(`${base.name}: botín viejo -> normal sin atributos`);
        return newItem(st, base.name, 0, []);
    }
    for (const x of Array.isArray(o.a) ? o.a : []) { // GM: se acepta lo que diga
        const e = (x ?? {}) as Record<string, unknown>;
        const id = (e.id === 'fres' || e.id === 'ires' ? 'rm' : e.id) as AttrId;
        if (typeof id !== 'string' || !(id in ATTR_RANGES)) continue;
        const val = clampInt(e.v, 1, 1e6);
        const dup = a.find((y) => y.id === id); if (dup) dup.v += val; else a.push({ id, v: val });
    }
    return newItem(st, base.name, r, a);
}

// ---------- estado ----------
export function newEcon(cls: string, faction: string): Econ {
    const kit = CLASS_KIT[cls] ?? CLASS_KIT.guerrero;
    const st: Econ = {
        v: ECON_VERSION, cls: CLASS_KIT[cls] ? cls : 'guerrero', faction: FACTIONS.includes(faction) ? faction : 'solmar',
        lvl: 1, exp: 0, gold: 0, stats: defaultStats(), hp: 1, mp: 0, bag: [], eq: emptyEq(), pots: { hp: 3, mp: 3 },
        q: { i: 0, st: 'new', prog: 0, keys: { cripta: 0, foso: 0 }, shards: { cripta: 0, foso: 0 } }, qb: newQuestBook(), u: [], nextUid: 1,
    };
    st.eq.arma = newItem(st, kit.weapon, 0, []); st.eq.armadura = newItem(st, kit.armor, 0, []);
    refreshUnlocks(st);
    const dfg = Number(process.env.FDN_DEBUG_FORGE); if (Number.isFinite(dfg) && dfg > 0) { st.forge = Math.floor(dfg); const u = UNIQUE_BASES.find((x) => !x.uniq.boss)!; st.bag.push(uniqueItem(st, u)); } // solo pruebas: piedras y un único
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
        if (it && fitsSlot(BASE_BY_NAME.get(it.n)!.slot, s)) st.eq[s] = it;
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

/**
 * Migra un estado guardado a la versión actual. Devuelve true si cambió algo.
 * v2 -> v3: tope de nivel 40 y curva de exp nueva: se conserva la fracción de progreso del nivel (no se regalan ni se quitan niveles),
 * y un nivel por encima del tope se recorta a 40 con la exp en cero.
 */
export function migrateEcon(st: Econ): boolean {
    if (st.v >= ECON_VERSION) return false;
    if (st.v < 3) {
        const frac = st.lvl > MAX_LVL ? 0 : Math.min(0.999, Math.max(0, st.exp / Math.max(1, legacyExpToLevel(st.lvl))));
        st.lvl = clampInt(st.lvl, 1, MAX_LVL, 1);
        st.exp = Math.min(expToLevel(st.lvl) - 1, Math.floor(frac * expToLevel(st.lvl)));
    }
    // v4: puntos de stats. Las cuentas viejas arrancan sin repartir y reciben los puntos libres que les corresponden por nivel.
    st.stats = cleanStats(st.stats);
    // v5: la rareza pasa a ser calidad (docs/ITEMS.md). Únicos de banda → Azul (2), de jefe → Violeta (4), el resto de los
    // ítems del botín viejo → Común sin atributos. Los únicos viejos quedan sin extras (mala suerte: se re-farmean o reforjan).
    if (st.v < 5) {
        const fix = (i: SItem | null): void => {
            if (!i) return;
            const u = UNIQUE_BY_NAME.get(i.n);
            if (u) i.r = u.uniq.boss ? 4 : 2;
            else if (i.r !== 0 || i.a.length > (Object.values(SHOPS).flatMap((s) => s.stock).find((x) => x.base === i.n)?.attrs?.length ?? 0)) {
                const line = Object.values(SHOPS).flatMap((s) => s.stock).find((x) => x.base === i.n);
                i.r = 0; i.a = (line?.attrs ?? []).map(([id, v]) => ({ id, v }));
            }
        };
        for (const i of st.bag) fix(i);
        for (const sl of SLOTS) fix(st.eq[sl]);
    }
    // v6: 8 slots. Las cuentas viejas no tienen las claves nuevas; el Amuleto del cazador pasó de 'anillo' a 'amuleto' (si estaba
    // puesto en el anillo, se mueve a su lugar o vuelve a la bolsa); y `exp` salió de los ítems (el bonus de exp de caza ya no existe).
    if (st.v < 6) {
        const full = emptyEq(); for (const sl of SLOTS) st.eq[sl] ??= full[sl];
        for (const sl of SLOTS) {
            const it = st.eq[sl]; if (!it) continue;
            const bs = BASE_BY_NAME.get(it.n)?.slot;
            if (bs && !fitsSlot(bs, sl)) { st.eq[sl] = null; if (!st.eq[bs]) st.eq[bs] = it; else st.bag.push(it); }
        }
        for (const i of [...st.bag, ...SLOTS.map((sl) => st.eq[sl])]) if (i) i.a = i.a.filter((x) => (x.id as string) !== 'exp');
    }
    st.v = ECON_VERSION;
    refreshUnlocks(st);
    return true;
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
/** Lo que tiene el personaje para los objetivos de "tener" de las misiones: materiales y la mejora más alta entre sus únicos. */
const questHave = (st: Econ): QuestHave => ({ mats: st.mats ?? {}, maxUp: Math.max(0, ...st.bag.map((i) => i.up ?? 0), ...SLOTS.map((sl) => st.eq[sl]?.up ?? 0)) });
const bonus = (st: Econ, id: AttrId): number => SLOTS.reduce((s, sl) => s + (st.eq[sl]?.a.find((x) => x.id === id)?.v ?? 0), 0);

// ---------- vistas hacia el cliente ----------
export const toInvItem = (i: SItem) => ({ uid: i.u, base: i.n, rarity: i.r, attrs: i.a.map((a) => ({ id: a.id, v: a.v })), up: i.up ?? 0 });

/** JSON de CharSave v1 que usa el cliente para la pantalla de selección y para armar su espejo inicial. */
export function toCharSave(st: Econ): string {
    const it = (i: SItem | null) => (i ? { n: i.n, r: i.r, a: i.a, up: i.up ?? 0, rf: i.rf ?? 0 } : null);
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
export interface KillInfo { /** rasgos del mob (mobTraits.ts): multiplican la exp (mutante ×3, habilidades ×1,3-1,5, salvaje ×1,25) y el botín del mutante (×2) */ traits?: number; mobId: number; type: MobType; def: MobDef; zoneName: string; /** de dónde sale el mob: suelto, de un pit o de una mazmorra (docs/ITEMS.md) */ origin?: 'loose' | 'pit' | 'dungeon'; x: number; y: number; /** esquirla que suelta el boss de la zona (Zone.drops); si falta, se decide por el nombre */ shard?: KeyId; /** id del mapa donde murió (objetivos de misión por mapa) */ map?: string }

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
        if (acc.econ && migrateEcon(acc.econ)) this.storage.put(key, acc);
        if (acc.econ) acc.econ.qb = cleanQuestBook(acc.econ.qb); // el libro de misiones se sanea siempre (cuentas viejas, datos rotos)
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

    /** SOLO GM: fija el nivel (exp a 0) y/o suma oro. */
    gmSet(p: Player, o: { lvl?: number; gold?: number; keys?: number }): boolean {
        const st = p.econ; if (!st) return false;
        if (o.lvl !== undefined) { st.lvl = clampInt(o.lvl, 1, MAX_LVL); st.exp = 0; refreshUnlocks(st); }
        if (o.gold !== undefined) addGold(st, o.gold);
        if (o.keys !== undefined) for (const k of Object.keys(st.q.keys) as KeyId[]) st.q.keys[k] = clampInt(o.keys, 0, 99);
        this.touch(p);
        return true;
    }

    /**
     * SOLO GM (/gm bis): equipa el mejor set que existe hoy para la clase, con las tiradas al máximo y +5. Lo que llevaba puesto vuelve a la bolsa.
     * Mago: Báculo del camposanto, Mortaja bordada, Capuchón de duelo y un anillo armado con lo mejor para hechizos (Magia, maná y vida).
     */
    gmBis(p: Player, cls: string): string[] | null {
        const st = p.econ; if (!st || (cls !== 'mago' && cls !== 'healer')) return null; // el healer usa el mismo set de Magia
        const top = (name: string, extra: SItem['a'] = []): SItem => {
            const u = UNIQUE_BY_NAME.get(name); if (!u) throw new Error(`BiS: no existe ${name}`);
            const it = newItem(st, name, 4, [...u.uniq.attrs.map(([id, v]) => ({ id, v: Math.round(v * (1 + UNIQUE_VARIATION)) })), ...extra]);
            it.up = UP_MAX; return it;
        };
        const ring = newItem(st, 'Anillo opaco', 4, [{ id: 'mag', v: ATTR_RANGES.mag[1] }, { id: 'mp', v: ATTR_RANGES.mp[1] }, { id: 'hp', v: ATTR_RANGES.hp[1] }]);
        ring.up = UP_MAX;
        const set: Partial<Record<Slot, SItem>> = { arma: top('Báculo del camposanto'), armadura: top('Mortaja bordada'), cabeza: top('Capuchón de duelo'), anillo: ring };
        for (const slot of Object.keys(set) as Slot[]) { const prev = st.eq[slot]; if (prev && st.bag.length < BAG_MAX) st.bag.push(prev); st.eq[slot] = set[slot]!; }
        this.touch(p);
        return (Object.keys(set) as Slot[]).map((sl) => set[sl]!.n);
    }

    /** Solo GM: equipa una Espada larga con `crit` % de crítico (sirve para probar el sonido y la animación de crítico). */
    gmSword(p: Player, crit: number): string | null {
        const st = p.econ; if (!st) return null;
        const it = newItem(st, 'Espada larga', 3, [{ id: 'crit', v: crit }]);
        const prev = st.eq.arma; if (prev && st.bag.length < BAG_MAX) st.bag.push(prev);
        st.eq.arma = it; this.touch(p);
        return it.n;
    }

    /** Guarda vida y maná del jugador en su estado (al salir y en cada guardado periódico). */
    persistVitals(p: Player): void {
        const st = p.econ; if (!st) return;
        st.hp = Math.max(1, Math.round(p.hp)); st.mp = Math.max(0, Math.round(p.mp)); this.touch(p);
    }

    snapshot(p: Player): void {
        const st = p.econ; if (!st) return;
        if (st.qb && rollDailies(st.qb, st.lvl, Date.now())) this.touch(p); // al entrar o al pasar el reinicio: encargos nuevos
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
    /** Día UTC en el que ya se vendió la estrella de la oferta (stock 1 global; en memoria: pre-beta alcanza). */
    private starSoldDay = -1;
    starSoldToday(): boolean { return this.starSoldDay === dayKey(); }

    buy(p: Player, ctx: EconCtx, npcId: string, index: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const npc = this.near(p, ctx, npcId); if (!npc) return fail('far', 'Estás muy lejos del vendedor.');
            if (index >= DAILY_INDEX_BASE) { // oferta del día (docs/ITEMS.md §3.9): solo en el mercader, igual para todos
                if (roleOf(npc) !== 'mercader') return fail('no_stock', 'La oferta del día está en el mercader.');
                const o = dailyOffers()[index - DAILY_INDEX_BASE]; if (!o) return fail('no_stock', 'Esa oferta ya no está (cambió el día).');
                if (o.star && this.starSoldToday()) return fail('sold', 'La oferta estrella de hoy ya se vendió. Mañana rota.');
                if (st.gold < o.price) return fail('gold', `Necesitás ${o.price} de oro.`);
                if (st.bag.length >= BAG_MAX) return fail('bag_full', 'La bolsa está llena.');
                addGold(st, -o.price);
                st.bag.push(newItem(st, o.base, o.quality, o.attrs.map((a) => ({ ...a }))));
                if (o.star) this.starSoldDay = dayKey(); // el primero se la lleva; el resto ve 'sold'
                return done(`Compraste ${o.base} por ${o.price} de oro.${o.star ? ' ¡Era la oferta estrella de hoy!' : ''}`);
            }
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
            if (uid === 0) { // "vender basura": toda la basura de mobs (JUNK_MATS y trofeos) de una, a su valor de lista
                let g = 0, n = 0;
                for (const [id, q] of Object.entries(st.mats ?? {})) {
                    const v = junkValue(id); if (!(v > 0) || !(q > 0)) continue;
                    g += v * q; n += q; delete st.mats![id];
                }
                if (!n) return fail('no_junk', 'No tenés basura para vender.');
                addGold(st, g);
                return done(`Vendiste ${n} material${n > 1 ? 'es' : ''} por ${g} de oro.`);
            }
            const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item.');
            const it = st.bag[i], g = sellPrice(it.n, it.r);
            st.bag.splice(i, 1); addGold(st, g); // se saca primero y recién ahí se cobra: un segundo pedido por el mismo uid ya no lo encuentra
            return done(`Vendiste ${it.n} por ${g} de oro.`);
        });
    }

    // ---------- mejora de ítems únicos (docs/ITEMS.md §7) ----------
    /** Mejora un ítem único (en la bolsa o equipado) en un herrero: gasta piedras de forja y oro; puede fallar (probabilidades solo acá). */
    upgrade(p: Player, ctx: EconCtx, npcId: string, uid: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const npc = this.near(p, ctx, npcId); if (!npc) return fail('far', 'Estás muy lejos del herrero.');
            if (!['armero', 'armadurero'].includes(roleOf(npc))) return fail('no_smith', 'Ese NPC no mejora equipo.');
            const it = st.bag.find((x) => x.u === uid) ?? Object.values(st.eq).find((x) => x?.u === uid) ?? undefined; if (!it) return fail('no_item', 'No tenés ese item.');
            const u = UNIQUE_BY_NAME.get(it.n); if (!u) return fail('not_unique', 'Solo se pueden mejorar los ítems únicos.');
            const up = it.up ?? 0, cap = UP_MAX_BY_QUALITY[Math.min(4, Math.max(0, it.r))] ?? UP_MAX;
            if (up >= cap) return fail('max', `Un ítem ${QUALITY_NAMES[it.r]?.toLowerCase() ?? ''} se mejora hasta +${cap}; ya está ahí.`);
            const stones = upStones(up), gold = upGold(u.uniq.tier, up);
            if ((st.forge ?? 0) < stones) return fail('stones', `Necesitás ${stones} piedra${stones > 1 ? 's' : ''} de forja.`);
            if (st.gold < gold) return fail('gold', `Necesitás ${gold} de oro.`);
            st.forge = (st.forge ?? 0) - stones; addGold(st, -gold);
            if (Math.random() < (UP_RATE[up] ?? 0)) { it.up = up + 1; this.questEvent(p, st, null); return done(`¡${it.n} subió a +${it.up}!`, true); }
            // la mejora a +6 o más es la zona de riesgo: el fallo baja un nivel
            if (up >= UP_RISK_FROM) { it.up = up - 1; return done(`La mejora falló y ${it.n} BAJÓ a +${it.up}. Se perdieron ${stones} piedra${stones > 1 ? 's' : ''} y ${gold} de oro.`, true); }
            return done(`La mejora falló: se perdieron ${stones} piedra${stones > 1 ? 's' : ''} y ${gold} de oro. ${it.n} sigue en +${up}.`);
        });
    }

    /**
     * Reforja (docs/ITEMS.md): re-tira UN stat extra elegido del ítem (los fijos y la calidad no se tocan). Cuesta piedras
     * de reforja (solo de jefes de mazmorra) + oro, y el costo se duplica con cada reforja del MISMO ítem (sin tope duro:
     * el tope es el precio). El extra nuevo sale del pool, sin pisar los fijos ni el otro extra; puede repetir el id actual
     * (re-tira el valor). Así la reforja acorta el re-farmeo del roll perfecto sin subir el techo de poder.
     */
    reforge(p: Player, ctx: EconCtx, npcId: string, uid: number, extra: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const npc = this.near(p, ctx, npcId); if (!npc) return fail('far', 'Estás muy lejos del herrero.');
            if (!['armero', 'armadurero'].includes(roleOf(npc))) return fail('no_smith', 'Ese NPC no reforja equipo.');
            const it = st.bag.find((x) => x.u === uid) ?? Object.values(st.eq).find((x) => x?.u === uid) ?? undefined; if (!it) return fail('no_item', 'No tenés ese item.');
            const u = UNIQUE_BY_NAME.get(it.n); if (!u) return fail('not_unique', 'Solo se reforjan los ítems únicos.');
            const nBase = u.uniq.attrs.length, nExtra = Math.min(EXTRAS_BY_QUALITY[Math.min(4, Math.max(0, it.r))] ?? 0, Math.max(0, it.a.length - nBase));
            if (nExtra <= 0) return fail('no_extras', 'Ese ítem no tiene stats extra para reforjar.');
            const i = clampInt(extra, 0, nExtra - 1); const idx = nBase + i;
            const rf = it.rf ?? 0, stones = reforgeStones(rf), gold = reforgeGold(u.uniq.tier, rf);
            const have = st.mats?.[MAT_REFORJA] ?? 0;
            if (have < stones) return fail('stones', `Necesitás ${stones} piedra${stones > 1 ? 's' : ''} de reforja (tenés ${have}).`);
            if (st.gold < gold) return fail('gold', `Necesitás ${gold} de oro.`);
            st.mats![MAT_REFORJA] = have - stones; addGold(st, -gold);
            const fixed = u.uniq.attrs.map(([id]) => id), other = it.a.filter((_, j) => j >= nBase && j !== idx).map((x) => x.id);
            const pool = EXTRA_POOL.filter((id) => !fixed.includes(id) && !other.includes(id));
            const id = pool[Math.floor(Math.random() * pool.length)];
            const v = rollExtra(id, uniqueIlvl(u), u.slot, it.r);
            const prev = it.a[idx]; it.a[idx] = { id, v }; it.rf = rf + 1;
            return done(`Reforjado: ${prev.id} ${prev.v} → ${id} ${v}. La próxima reforja de ${it.n} cuesta ${reforgeStones(rf + 1)} piedra${reforgeStones(rf + 1) > 1 ? 's' : ''}.`, true);
        });
    }

    // ---------- puntos de stats (paso 1.2) ----------
    /**
     * Reparte o devuelve los puntos de stats. Todo lo decide el server: el cliente solo pide.
     * "add": suma `points` a un stat (hay que tener puntos libres y no pasar el tope); "reset": los devuelve todos (gratis hasta el nivel 10, después cuesta oro).
     */
    statAlloc(p: Player, ctx: EconCtx, action: string, stat: string, points: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            st.stats = cleanStats(st.stats);
            if (action === 'add') {
                if (!(STAT_IDS as readonly string[]).includes(stat)) return fail('bad_stat', 'Stat inválido.');
                const id = stat as StatId;
                if (typeof points !== 'number' || !Number.isInteger(points) || points < 1) return fail('bad_points', 'Cantidad inválida.');
                const free = statPointsFree(st.lvl, st.stats);
                if (free < 1) return fail('no_points', 'No tenés puntos libres.');
                if (points > free) return fail('no_points', `Solo tenés ${free} punto${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}.`);
                if (st.stats[id] + points > STAT_CAP) return fail('cap', `El tope de cada stat es ${STAT_CAP}.`);
                st.stats[id] += points;
                return done(`+${points} ${STAT_NAMES[id]}.`, true);
            }
            if (action === 'reset') {
                const cost = statResetCost(st.lvl);
                if (st.gold < cost) return fail('gold', `Reasignar cuesta ${cost} de oro.`);
                addGold(st, -cost); st.stats = defaultStats();
                return done(cost > 0 ? `Reasignaste tus puntos por ${cost} de oro.` : 'Reasignaste tus puntos (gratis hasta el nivel 10).', true);
            }
            return fail('bad_action', 'Acción inválida.');
        });
    }

    // ---------- equipo ----------
    equip(p: Player, ctx: EconCtx, uid: number): void {
        this.run(p, ctx, (st) => {
            if (p.isDead) return fail('dead', 'Estás muerto.');
            const i = st.bag.findIndex((x) => x.u === uid); if (i < 0) return fail('no_item', 'No tenés ese item.');
            const it = st.bag[i], baseSlot = BASE_BY_NAME.get(it.n)?.slot; if (!baseSlot) return fail('bad_item', 'Item inválido.');
            // los anillos entran en el primer lugar libre (anillo, anillo2); con los dos llenos reemplazan al primero
            const cands = slotsFor(baseSlot), slot = cands.find((sl) => !st.eq[sl]) ?? cands[0];
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
        if (action === 'talk') { // abrir la charla con cualquier NPC: cuenta para los objetivos de "hablar con"
            const st = p.econ, npc = this.near(p, ctx, npcId); if (!st || !npc || !this.allow(p)) return;
            if (this.questEvent(p, st, { k: 'talk', role: roleOf(npc) })) { this.touch(p); this.snapshot(p); }
            return;
        }
        if (action === 'combine') return this.combineKey(p, ctx, key); // las llaves de las mazmorras se arman en cualquier lado
        this.run(p, ctx, (st) => {
            const npc = this.near(p, ctx, npcId); if (!npc || roleOf(npc) !== 'capitan') return fail('far', 'Estás muy lejos del Capitán.');
            if (action.startsWith('m_') || action.startsWith('d_') || action === 'r_turnin') return this.questBook(p, st, action, key);
            // la cadena vieja de 10 quedó jubilada (la reemplaza el Camino del aventurero); el Capitán solo sigue forjando las llaves viejas
            if (action === 'accept' || action === 'turnin') return fail('quest_retired', 'Esas misiones ya no están: seguí el Camino del aventurero.');
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

    /**
     * Avanza el libro de misiones con un evento (matar, levantar, mejorar, hablar, dungeon, PvP) y avisa lo que quedó listo.
     * Devuelve true si cambió algo que el cliente tenga que ver. No guarda: lo hace quien llama (todas las rutas ya guardan).
     */
    questEvent(p: Player, st: Econ, e: QuestEvent | null): boolean {
        const b = (st.qb ??= newQuestBook()), before = JSON.stringify(b);
        rollDailies(b, st.lvl, Date.now());
        const r = applyQuestEvent(b, e, questHave(st));
        for (const t of r.msgs) p.send(M.econResult(true, 'quest_ready', t));
        for (const id of r.paid) this.payDaily(p, st, id); // los encargos del día se cobran solos, sin ir al Capitán
        return JSON.stringify(b) !== before || r.paid.length > 0;
    }

    /** Premio de un encargo del día recién completado (ya quedó marcado como cobrado). El primero del día da además una esencia. */
    private payDaily(p: Player, st: Econ, id: string): void {
        const b = st.qb!, dq = DAILY_BY_ID.get(id); if (!dq) return;
        const r = this.payReward(st, { expPct: DAILY_EXP_PCT, gold: dailyGold(st.lvl) }, ''); if (!r.ok) return;
        let ess = '';
        if (!b.d.ess) { b.d.ess = true; const mats = (st.mats ??= {}); mats.esencia = Math.min(9999, (mats.esencia ?? 0) + 1); ess = ' Y por ser el primero del día, una Esencia.'; }
        const left = DAILY_LIMIT - b.d.done.length;
        p.send(M.econResult(true, r.ups ? 'level_up' : 'daily_done', `Encargo cumplido: «${dq.name}»: ${r.text}${ess}${left > 0 ? ` (te quedan ${left} hoy)` : ' Ya cobraste los 3 de hoy.'}`));

    }

    /** Ganó una pelea contra otra nación en un mapa de facción (lo decide world.ts). A cada rival se le cuenta una vez por día. */
    questPvp(p: Player, victimKey: string): void {
        const st = p.econ; if (!st) return;
        const b = (st.qb ??= newQuestBook()); rollDailies(b, st.lvl, Date.now());
        if (b.d.pvp.includes(victimKey)) return;
        b.d.pvp.push(victimKey);
        this.questEvent(p, st, { k: 'pvp' }); this.touch(p); this.snapshot(p);
    }

    /** Premio de una misión: exp en % del nivel, oro, piedras e ítem único. Verifica antes de tocar nada; devuelve el texto o un error. */
    private payReward(st: Econ, r: QuestReward, choice: string): { ok: true; text: string; ups: number } | { ok: false; code: string; text: string } {
        let item: SItem | undefined;
        if (r.unique) {
            const opts = rewardUniques(r.unique, st.cls); if (!opts.length) return fail('no_reward', 'No hay premio para tu clase.');
            if (st.bag.length >= BAG_MAX) return fail('bag_full', 'Hacé lugar en la bolsa para el premio.');
            const u = r.unique.endsWith('_choice') ? opts.find((o) => o.name === choice) : pick(opts);
            if (!u) return fail('choose', `Elegí tu premio: ${opts.map((o) => o.name).join(', ')}.`);
            item = uniqueItem(st, u);
        }
        const exp = Math.max(1, Math.round(expToLevel(st.lvl) * r.expPct / 100));
        st.exp += exp; addGold(st, r.gold); if (r.forge) st.forge = (st.forge ?? 0) + r.forge;
        if (item) st.bag.push(item);
        const ups = levelUp(st);
        return { ok: true, ups, text: `+${exp} exp, +${r.gold} oro${r.forge ? `, +${r.forge} piedras de forja` : ''}${item ? ` y ${item.n}` : ''}.${ups ? ` ¡Subiste a nivel ${st.lvl}!` : ''}` };
    }

    /** Acciones del libro de misiones con el Capitán: m_accept / m_turnin (cadena), d_turnin / d_reroll (encargos), r_turnin (repetible). */
    private questBook(p: Player, st: Econ, action: string, key: string): Outcome {
        const b = (st.qb ??= newQuestBook()), mats = (st.mats ??= {}), now = Date.now(), have = questHave(st);
        rollDailies(b, st.lvl, now);
        const q = MAIN_QUESTS[b.m.i];
        if (action === 'm_accept') {
            if (!q || b.m.st !== 'new') return fail('quest_state', 'No hay misión para aceptar.');
            if (st.lvl < q.minLvl) return fail('quest_lvl', `Para «${q.name}» necesitás nivel ${q.minLvl}.`);
            b.m.st = 'active'; b.m.prog = q.goals.map(() => 0);
            if (mainComplete(b, have)) b.m.st = 'ready'; // los de "tener" pueden estar cumplidos de entrada (colmillos, un ítem ya en +1)
            return done(`Misión aceptada: ${q.name}.`);
        }
        if (action === 'm_turnin') {
            if (!q || b.m.st === 'new' || !mainComplete(b, have)) return fail('quest_state', 'Todavía no completaste la misión.');
            const r = this.payReward(st, q.reward, key); if (!r.ok) return r;
            b.m.i++; b.m.st = 'new'; b.m.prog = [];
            return done(`Entregaste «${q.name}»: ${r.text}`, r.ups > 0, r.ups ? 'level_up' : 'ok');
        }
        if (action === 'r_turnin') { // key = "material|gold" o "material|forge"
            const [mat, what] = key.split('|');
            if (!mat || RESERVED_MATS.has(mat)) return fail('bad_mat', 'Ese material no se entrega: es para las llaves.');
            if (what !== 'gold' && what !== 'forge') return fail('bad_action', 'Elegí oro o piedra de forja.');
            if ((mats[mat] ?? 0) < REPEAT_MATS) return fail('mats', `Necesitás ${REPEAT_MATS} del mismo material.`);
            mats[mat] -= REPEAT_MATS; this.questEvent(p, st, null);
            if (what === 'gold') { const g = repeatGold(st.lvl); addGold(st, g); return done(`Entregaste ${REPEAT_MATS} materiales: +${g} oro.`); }
            st.forge = (st.forge ?? 0) + 1; return done(`Entregaste ${REPEAT_MATS} materiales: +1 piedra de forja.`);
        }
        return fail('bad_action', 'Acción inválida.');
    }

    /**
     * Armar una llave de mazmorra (docs/LLAVES.md): gasta los materiales y el oro de la receta y suma la llave a los materiales.
     * Se hace en cualquier lado (clic derecho en la bolsa), no hace falta un NPC.
     */
    combineKey(p: Player, ctx: EconCtx, key: string): void {
        this.run(p, ctx, (st) => {
            const r = KEY_RECIPES[key]; if (!r) return fail('bad_key', 'Esa llave no se arma.');
            const mats = (st.mats ??= {});
            const why = keyMissing(key, mats, st.gold); if (why) return fail('missing', why);
            for (const [id, n] of Object.entries(r.mats)) mats[id] = (mats[id] ?? 0) - n;
            addGold(st, -r.gold); mats[key] = Math.min(99, (mats[key] ?? 0) + 1);
            return done(`Armaste una ${r.name}: abre ${r.dungeon}.`, true); // restat: la llave cuenta para las puertas
        });
    }

    /** Un portal con llave se cruzó: gasta una (el server ya validó el paso). */
    consumeKey(p: Player, key: string): void {
        const st = p.econ; if (!st) return;
        if (KEY_RECIPES[key]) { const mats = (st.mats ??= {}); mats[key] = Math.max(0, (mats[key] ?? 0) - 1); this.touch(p); this.snapshot(p); return; }
        if (!(key in st.q.keys)) return;
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
    /** Suma un botín levantado del suelo (systems/loot.ts): oro o material apilable. */
    addLoot(p: Player, itemId: string, amount: number): boolean {
        const st = p.econ; if (!st || !(amount > 0)) return false;
        const n = Math.floor(amount);
        if (itemId === 'gold') addGold(st, n);
        else { const mats = (st.mats ??= {}); mats[itemId] = Math.min(9999, (mats[itemId] ?? 0) + n); this.questEvent(p, st, { k: 'gather', n }); }
        this.touch(p); this.snapshot(p);
        return true;
    }

    reward(p: Player, ctx: EconCtx, k: KillInfo, expMult = 1): void {
        const st = p.econ; if (!st) return;
        const def = k.def, boss = def.boss, lvl0 = st.lvl; // un encargo del día cobrado en este kill también puede subir de nivel
        // la exp baja con tu nivel (levelExpMult) y con la diferencia de nivel contra el mob (levelGapMult: 0 si es muy inferior)
        const lm = levelExpMult(st.lvl) * levelGapMult(st.lvl, def.lvl);
        const gain = lm > 0 ? Math.max(1, Math.round(def.exp * (1 + bonus(st, 'exp') / 100) * expMult * traitExpMult(k.traits ?? 0) * lm)) : 0;
        st.exp += gain;
        let gold = 0, item: SItem | undefined, bagFull = false, potion = '', shard = '';
        const bossU = boss ? BOSS_UNIQUES[k.type] : undefined, tier = tierOfLevel(def.lvl), dm = traitDropMult(k.traits ?? 0); // mutante (la Suerte se eliminó)
        if (boss) {
            // los jefes de mazmorra con ítems propios sueltan uno de ellos (siempre); los jefes de mundo, un único de su banda
            // (si la banda todavía no tiene únicos, el doble de oro hasta que exista el catálogo T4+)
            item = bossU ? uniqueItem(st, pick(bossU)) : UNIQUES_BY_TIER[tier] ? uniqueItem(st, pick(UNIQUES_BY_TIER[tier]), Math.random() < 0.25 ? 3 : 2) : undefined;
            gold = rint(boss.gold[0], boss.gold[1]) * (!item ? 2 : 1);
        } else {
            // El ítem solo cae como único de la banda, con poca chance (más en pits y mazmorras); el resto del tiempo, oro.
            // El botín viejo con rareza al azar se eliminó (docs/ITEMS.md): los "comunes" son la basura vendible del suelo (systems/loot.ts).
            const r = Math.random(), uc = tier <= UNIQUE_TIERS_READY ? UNIQUE_CHANCE[k.origin ?? 'pit'] * dm : 0, gc = GOLD_CHANCE * dm;
            if (r < uc) item = uniqueItem(st, pick(UNIQUES_BY_TIER[tier]), rollQuality(k.origin ?? 'pit'));
            else if (r < uc + gc) gold = rint(3, 8) * def.lvl;
        }
        if (gold) addGold(st, gold);
        if (item) {
            if (st.bag.length < BAG_MAX) st.bag.push(item);
            else { bagFull = true; ctx.ground.add(item, Math.floor(p.posX) + 0.5, Math.floor(p.posY) + 0.5, [p.accountKey], LOOT_FREE_MS); } // nada se destruye: cae junto al jugador
        }
        let forge = 0;
        if (boss ? bossU : Math.random() < FORGE_CHANCE[k.origin ?? 'pit']) { forge = boss ? rint(FORGE_BOSS[0], FORGE_BOSS[1]) : 1; st.forge = (st.forge ?? 0) + forge; }
        if (boss && bossU) { // piedras de reforja: solo de jefes de mazmorra, 1-2 por corrida para cada uno (docs/ITEMS.md)
            const n = rint(1, 2), mats = (st.mats ??= {}); mats[MAT_REFORJA] = Math.min(999, (mats[MAT_REFORJA] ?? 0) + n);
            p.send(M.econResult(true, 'quest_mat', `Conseguiste ${n} piedra${n > 1 ? 's' : ''} de reforja.`));
        }
        if (Math.random() < 0.14) { const kind: PotKind = Math.random() < 0.6 ? 'hp' : 'mp'; if (st.pots[kind] < POT_MAX) { st.pots[kind]++; potion = kind; } }
        if (boss && !bossU) { const kid: KeyId = k.shard ?? (k.zoneName === 'Cripta olvidada' ? 'foso' : 'cripta'); st.q.shards[kid] = Math.min(99, st.q.shards[kid] + 1); shard = kid; }
        // materiales de las llaves: cada uno en los pits de su tier de zona (T1-T7, sin el tope 6 de la banda de ítems; ×2 en mutantes, como el resto del botín)
        const qmats: string[] = [];
        if (!boss && k.origin === 'pit') for (const [id, mt] of Object.entries(QUEST_MATS)) {
            if (mt.tier === tierOfLvl(def.lvl) && Math.random() < mt.chance * traitDropMult(k.traits ?? 0)) { const mats = (st.mats ??= {}); mats[id] = Math.min(9999, (mats[id] ?? 0) + 1); qmats.push(mt.name); }
        }
        for (const name of qmats) p.send(M.econResult(true, 'quest_mat', `Conseguiste un ${name}.`));
        // llave que suelta el jefe (la gastada de D1): una para cada uno, solo si muere en su piso de la mazmorra
        const keyDrop = boss ? BOSS_KEY_DROPS[k.type] : undefined;
        if (keyDrop && DUNGEON_IDS.some((d) => DUNGEON_BOSS[d] === k.type && k.map === DUNGEON_MAP[d])) {
            const mats = (st.mats ??= {}); mats[keyDrop] = Math.min(99, (mats[keyDrop] ?? 0) + 1);
            p.send(M.econResult(true, 'quest_mat', `Conseguiste una ${keyMatName(keyDrop)}.`));
        }
        this.questEvent(p, st, { k: 'kill', type: k.type, map: k.map ?? '', pit: k.origin === 'pit', tier, myTier: tierOfLevel(st.lvl), mutant: ((k.traits ?? 0) & TRAIT_MUTANT) !== 0 });
        // el dungeon cuenta solo si el jefe muere en su piso (la instancia de la party), no si aparece en otro mapa
        if (boss) for (const d of DUNGEON_IDS) if (DUNGEON_BOSS[d] === k.type && k.map === DUNGEON_MAP[d]) this.questEvent(p, st, { k: 'dungeon', d });
        const questReady = false, questProg = 0; // la cadena vieja de 10 quedó jubilada: los avisos de misión van por questEvent
        levelUp(st); const ups = st.lvl - lvl0;
        this.touch(p);
        p.send(M.killReward({ mobId: k.mobId, x: k.x, y: k.y, exp: gain, gold, item: item ? toInvItem(item) : undefined, bagFull, potion, shard, forge, newLvl: ups ? st.lvl : 0, questReady, questProg }));
        if (ups) ctx.restat(p); // subir de nivel cura (restat lo detecta por el nivel nuevo)
        this.snapshot(p);
    }
}
