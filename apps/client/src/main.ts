/**
 * Frontera de Naciones: el prototipo HD (canvas isométrico 2:1, arte de Flare) conectado al server.
 *
 * Lo que decide el server: dónde está cada jugador (paso a paso, con control de velocidad),
 * quién ve a quién y el chat. Lo que todavía corre solo en este navegador, como en el prototipo:
 * mobs, combate, hechizos, loot y experiencia (pasan al server en la fase 1b).
 */
import { CombatTextManager, type CombatTextEvent } from './systems/CombatTextManager';
import './ui/craftpix.css';
import './ui/loading-craftpix.css';
import './ui/hud-craftpix.css';
import './ui/char-craftpix.css';
import './ui/quests-craftpix.css';
import './ui/book-craftpix.css';
import './ui/bag-craftpix.css';
import { levelCard, notify } from './ui/notices';
import { mountChat } from './ui/mountChat';
import { mountCastBar } from './ui/CastBar';
import { useCastStore } from './ui/castStore';
import { spellTypeOf, type SpellType } from './ui/colors';
import { chatBus, logToChat, type ChatChannel } from './ui/chatStore';
import { drawPortalFloor, drawPortalFx, setPortalSheet, PORTAL_CITY, PORTAL_ZONE } from './portal';
import { stepFree, leadAim, projectileFlightMs, pvpRegionAt } from '@fdn/world';
import { checkSkill, skillDeniedText, canUseSkill, skillLevel } from '@fdn/world';
import { DEFAULT_MAP, RECALL, STAT_CAP, classBaseHp, classBaseMp, itemDfTotal, itemRmTotal, STAT_DESC, STAT_IDS, STAT_BASE, STAT_RESET_FREE_LVL, statTip, STAT_NAMES, defaultStats, expToLevel, statBonus, critTotal, aspdTotal, traitLabel, traitHpMult, leechTotal, meleeIntervalSecs, statResetCost, type StatId, type Stats, factionHome, HUBS, MAPS, getMapDef, inMapRect, linkGateReason, mapHash, MOB_TYPES, mobDef, TRAINING, trainingUnlocked, portalGate, type MobType, type MobDef, type TrainingStep, type Waypoint, type Link, type MapDef, type WorldMap, WAYPOINT_RANGE } from '@fdn/world';
import { UNIQUE_BY_NAME, UP_MAX, UP_MAX_BY_QUALITY, EXTRAS_BY_QUALITY, FX_INFO, JUNK_MATS, MAT_REFORJA, junkValue, reforgeGold, reforgeStones, activeSets, setOfPiece, slotsFor, upGold, upMult, upStones, ALL_BASES, ATTR_IDS, ATTR_RANGES, BAG_MAX, BASES, KEYDEFS, KEY_IDS, POTS, QUESTS, SHARDS_PER_KEY, SHOPS, SLOTS, fitsSlot, TALK_RANGE, roleOf, trainingLockedMsg, trainingOfMap, sellPrice, type AttrId, type Base, type KeyId, type Slot, type Stock } from '@fdn/world';
import { hpRegenPerSec, HP_REGEN, MEDITATE, PVE_MP_REGEN } from '@fdn/world';
import { Net, serverUrl, type ServerPayload } from './net.ts';
import type { ArenaInfo, InvItem as InvItemMsg, InventoryState } from '@fdn/proto';
import { DAILY_BY_ID, DAILY_EXP_PCT, DAILY_LIMIT, MAIN_QUESTS, type MainQuest, QUEST_MATS, REPEAT_MATS, RESERVED_MATS, dailyGold, rewardUniques, type QuestBookView, type QuestGoal, KEY_RECIPES, KEY_MAT_NAMES, keyMissing, TRAIT_ELITE } from '@fdn/world';
import { spellIcon } from './icons.ts';
import { bookListHtml, bookTreeHtml, bookTipHtml } from './spellbook.ts';
import { Saver, parseSave, type CharSave, type SavedItem } from './persist.ts';
import { coinIcon, itemIcon, keyIcon, miscIconUrl, potionIcon, setPieceOf, shardIcon } from './itemicons.ts';
import { initLoginUI } from './loginui.ts';
import { createMinimap, type Minimap } from './minimap.ts';
import { createAuctionUI } from './auction.ts';
import { createDepositUI } from './deposit.ts';
import { createGuildUI } from './guild.ts';
import { createTradeUI } from './trade.ts';
import { createCursor } from './cursor.ts';
import { installErrorReporting, watchForNewVersion } from './ops.ts';
import { checkVersionNow, desktopBridge, isBlocked, watchClientVersion } from './version.ts';
installErrorReporting();
// En el navegador, el aviso por bundle (F5). En la app de escritorio no hay F5: la versión se compara con la mínima del server y Electron baja las actualizaciones.
if (!desktopBridge()) watchForNewVersion(() => log('Hay una versión nueva del juego. Cuando termines lo que estás haciendo, recargá la página (F5) para jugar con los últimos cambios.', true));
watchClientVersion(() => log(desktopBridge() ? 'Hay una actualización del juego lista: se instala sola cuando cierres el juego.' : 'Hay una versión nueva del juego. Cuando termines, recargá la página (F5).', true));
const ico = (it: { name: string; look?: string; slot: string; rar: { c: string; k: number } }) => `<img class="iico" alt="" src="${itemIcon(it.look, it.slot, it.rar.c, it.rar.k, UNIQUE_BY_NAME.get(it.name)?.uniq.set, setPieceOf(it.slot, it.name))}">`;

// ---------- utilidades ----------
/** Escala del arte del mundo: la celda mide 60x30 (antes 96x48) para que el personaje ocupe ~1,9 celdas de alto como en el cliente de referencia (cuerpo de 61 px sobre tiles de 32). Los sprites de personajes y mobs no se tocan; solo el piso, los props y los edificios se dibujan a esta escala. */
const GS = 0.625;
const TW = 96 * GS, TH = 48 * GS;
// El mapa cargado es estado mutable: loadMap() lo reemplaza al cruzar un portal entre mapas (ver más abajo).
let MAP_DEF: MapDef = MAPS[DEFAULT_MAP];
let MAP: WorldMap = MAP_DEF.build();
let N = MAP.size;
let { tiles, blocked, safe, props, decals } = MAP;
let ZONES = MAP.zones;
type Zone = (typeof MAP.zones)[number];
/** Ciudad (rectángulo con nombre) que contiene la celda, en el mapa cargado. */
const cityAt = (x: number, y: number) => MAP.cities?.find((c) => x >= c.x0 && x < c.x1 + 1 && y >= c.y0 && y < c.y1 + 1);

const R = Math.random;
const rint = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Números grandes con puntos de miles (el oro no tiene tope). */
const fmtNum = (n: number): string => Math.floor(n).toLocaleString('es-AR');
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const iso = (gx: number, gy: number) => ({ x: ((gx - gy) * TW) / 2, y: ((gx + gy) * TH) / 2 });
const now = () => performance.now() / 1000;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id: string) => document.getElementById(id)!;

// dirección de sprite (0=O,1=NO,2=N,3=NE,4=E,5=SE,6=S,7=SO) a partir de un delta en la grilla
function faceAngle(dx: number, dy: number) { return Math.atan2((dx + dy) * 0.5, dx - dy); }
function angToDir(a: number) { return (((4 + Math.round((a * 180) / Math.PI / 45)) % 8) + 8) % 8; }
function turnTo(e: Ent, dx: number, dy: number, dt: number, instant = false) {
    if (Math.abs(dx) + Math.abs(dy) < 1e-4) return;
    const a = faceAngle(dx, dy);
    if (e.ang == null || instant) e.ang = a;
    else { let d = a - e.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); e.ang += d * Math.min(1, dt * (e === (P as Ent) ? 30 : 12)); } // el propio personaje gira casi al instante; los demás suavizados
    e.dir = angToDir(e.ang);
}
/** Dirección del server (0 = norte de la grilla, en sentido horario) a partir de un delta. */
const gridDir = (dx: number, dy: number) => (((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 2) % 8) + 8) % 8;
const GRID_VEC = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

// ---------- mapa ----------
const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && !blocked[y][x];
const isSafe = (gx: number, gy: number) => { const x = Math.floor(gx), y = Math.floor(gy); return x >= 0 && y >= 0 && x < N && y < N && safe[y][x]; };
const near = (x: number, y: number, z: Zone, r: number) => Math.hypot(x - z.x, y - z.y) < r;

// ---------- A* ----------
interface Cell { x: number; y: number }
function findPath(sx: number, sy: number, tx: number, ty: number, free: (x: number, y: number) => boolean): Cell[] | null {
    if (!free(tx, ty)) return null;
    const key = (x: number, y: number) => y * N + x;
    const open = [{ x: sx, y: sy, g: 0, f: 0 }], came = new Map<number, number>(), g = new Map([[key(sx, sy), 0]]), closed = new Set<number>();
    let it = 0;
    while (open.length && it++ < 4000) {
        let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
        const c = open.splice(bi, 1)[0], ck = key(c.x, c.y);
        if (c.x === tx && c.y === ty) { const p: Cell[] = []; let k = ck; while (k !== key(sx, sy)) { p.push({ x: k % N, y: Math.floor(k / N) }); k = came.get(k)!; } return p.reverse(); }
        if (closed.has(ck)) continue; closed.add(ck);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = c.x + dx, ny = c.y + dy;
            if (!free(nx, ny) || (dx && dy && (!walk(c.x + dx, c.y) || !walk(c.x, c.y + dy)))) continue;
            const nk = key(nx, ny), ng = c.g + (dx && dy ? 1.414 : 1);
            if (ng < (g.get(nk) ?? 1e9)) { g.set(nk, ng); came.set(nk, ck); open.push({ x: nx, y: ny, g: ng, f: ng + Math.hypot(tx - nx, ty - ny) }); }
        }
    }
    return null;
}

// ---------- items ----------
interface Rarity { n: string; c: string; k: number; p: number }
const RAR: Rarity[] = [
    { n: 'Común', c: '#e7e2d3', k: 0, p: 0.7 },
    { n: 'Verde', c: '#7fd98a', k: 1, p: 0.2 },
    { n: 'Azul', c: '#6fa8ff', k: 2, p: 0.07 },
    { n: 'Violeta', c: '#c77dff', k: 3, p: 0.02 },
    { n: 'Dorado', c: '#ffd24a', k: 4, p: 0.01 },
];
/** Texto de cada atributo; los rangos y las bases viven en @fdn/world (el server valida con las mismas tablas). */
const ATTR_FMT: Record<AttrId, (v: number) => string> = {
    crit: (v) => `+${v}% crítico`, aspd: (v) => `+${v}% velocidad de ataque`, leech: (v) => `${v}% robo de vida`, hp: (v) => `+${v} vida`, mp: (v) => `+${v} maná`,
    mag: (v) => `+${v} daño mágico`, exp: (v) => `+${v}% exp de caza`, poison: (v) => `${v}% chance de veneno`, rpar: (v) => `+${v}% resistencia a parálisis`,
    df: (v) => `+${v} defensa`, rm: (v) => `+${v} resistencia mágica`, dmg: (v) => `+${v} daño del arma`,
};
const ATTRS = ATTR_IDS.map((id) => ({ id, r: ATTR_RANGES[id], f: ATTR_FMT[id] }));
interface Item extends Base { id: number; rar: Rarity; attrs: { id: AttrId; v: number }[]; /** nivel de mejora (+N) */ up?: number; /** reforjas hechas */ rf?: number }
const itName = (it: { name: string; up?: number }) => (it.up ? `+${it.up} ` : '') + it.name;
let zemBag = 0; // zem de la bolsa (D.9; antes piedras de forja). La forja usa solo el del depósito.
/** Puntos de stats repartidos y libres (los manda el server en InventoryState; el server decide, esto solo se muestra y se refleja en los números). */
let stats: Stats = defaultStats(), statFree = 0;
/** Topes de DF y RM de atributos de ítems de esta semana del server y cuándo suben (ms; 0 = ya están en el máximo). Los manda el server en `inventoryState` (D.6). */
let capDf = 60, capRm = 75, capNextAt = 0;
const FORGE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 3 27 12 22 28H10L5 12Z" fill="#c9833a" stroke="#6b3f16" stroke-width="2"/><path d="M16 3 22 28 27 12ZM16 3 10 28 5 12Z" fill="#e5a65a" opacity=".45"/></svg>');
let uid = 1;
const attrText = (a: { id: AttrId; v: number }) => ATTRS.find((x) => x.id === a.id)!.f(a.v);

// ---------- entidades ----------
interface OneShot { anim: string; t: number; until: number }
interface Ent { x: number; y: number; dir: number; ang?: number; moving: boolean; phase?: number; ref?: number; one: OneShot | null; t0?: number; flash: number }
/** Un paso de una celda a otra, animado en `dur` segundos. */
interface Step { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }

interface Mob extends Omit<Ent, 'ref'>, MobDef {
    id: number; sprite: MobType; zone: Zone; hpMax: number;
    /** Élite de mazmorra (rasgo TRAIT_ELITE): marca dorada sobre la cabeza. */
    elite?: boolean;
    /** Última posición que mandó el server: el mob dibujado la persigue suavemente. */
    sx: number; sy: number;
    /** Fotos recientes del server (hora local de llegada + posición): se dibuja con un pequeño retraso interpolando entre ellas. */
    buf: { t: number; x: number; y: number }[];
    /** Instante (reloj local) hasta el que sigue en ese estado; `busy` es la carga de la habilidad de boss. */
    busy: number; par: number; parT: number; imm: number; poison: number;
}
interface Casting { i: number; start: number; end: number; len: number }
const P = {
    x: MAP.spawn.x + 0.5, y: MAP.spawn.y + 0.5, dir: 6, ang: undefined as number | undefined, moving: false, phase: 0, ref: 3.4, one: null as OneShot | null, t0: 0, flash: 0,
    name: '', cell: { x: MAP.spawn.x, y: MAP.spawn.y }, path: [] as Cell[], mv: false, stepMs: 270, sendT: 0, sentX: 0, sentY: 0, hx: 0, hy: 0, hurtAt: -1e9, pvpAt: -1e9, frozenUntil: 0, foe: null as Other | null, ally: null as Other | null, med: false, medHp: 0,
    target: null as Mob | null, engage: false, pickup: null as Drop | null, repath: 0, queued: null as number | null,
    lvl: 1, exp: 0, hp: 100, mp: 60, fury: 0, shield: 0, shieldEnd: 0, slowEnd: 0, blessEnd: 0, poisonEnd: 0, inv: false, det: false, invEnd: 0, detEnd: 0, immEnd: 0, gold: 0, nextAtk: 0, dead: false, deadT: 0,
    bag: [] as Item[], eq: { arma: null, armadura: null, cabeza: null, guantes: null, botas: null, amuleto: null, anillo: null, anillo2: null } as Record<Slot, Item | null>,
    running: true, casting: null as Casting | null, ready: null as { i: number; t: number } | null, sentDir: -1,
};

/** Otros jugadores, según lo que manda el server. */
interface Other extends Ent { hp?: number; maxHp?: number; shield?: number; fury?: boolean; inv?: boolean; profile: string; id: bigint; name: string; cell: Cell; queue: Cell[]; step: Step | null; stepMs: number; gone: boolean; buf: { t: number; x: number; y: number }[] }
const others = new Map<bigint, Other>();

/** Botín en el suelo (lo manda el server con `groundItemSpawned`). `lockedUntil`: hasta cuándo (reloj local) no lo puedo recoger; 0 = es mío o ya está libre. */
interface Drop { x: number; y: number; item?: Item; gold?: number; t: number; gid?: number; lockedUntil?: number; loot?: FloorLoot }
/** Botín de materiales / oro del server (LootSpawnEvent). `mock`: lo armó la tecla L de ?debug, no existe en el server. */
interface FloorLoot { id: string; itemId: string; name: string; amount: number; mock?: boolean }
interface Proj { x: number; y: number; m: Mob | null; spd: number; dmg: number; col: string; sid?: string; aoe?: number; tx?: number; ty?: number; sx?: number; sy?: number; arc?: number; trail?: { x: number; y: number }[] }
interface Fx { k: 'ring' | 'boom' | 'burst' | 'click' | 'efx' | 'blizz'; d?: number; n?: string; dy?: number; x: number; y: number; t: number; c?: string; r?: number }
const scorch: { x: number; y: number; t: number; r: number }[] = [];
const mobs: Mob[] = [], corpses: { sprite: string; x: number; y: number; dir: number; t: number }[] = [], drops: Drop[] = [], projs: Proj[] = [];
/** Proyectiles de los mobs a distancia (solo visuales: el daño lo decide el server al llegar; ver docs/MOBS_A_DISTANCIA.md). */
interface Arrow { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; kind: number }
const arrows: Arrow[] = [];
const floats: { x: number; y: number; text: string; col: string; t: number; big?: boolean }[] = [], fx: Fx[] = [], pending: { t: number; fn: () => void }[] = [];
let hitstop = 0, shake = 0;

/** Los mobs los simula el server: acá solo hay un espejo que se actualiza con cada foto (`mobsSnapshot`). */
const mobMap = new Map<number, Mob>();
function dropMob(m: Mob) {
    const i = mobs.indexOf(m); if (i >= 0) mobs.splice(i, 1);
    mobMap.delete(m.id); if (P.target === m) P.target = null;
}
const MOB_DELAY = 0.2;
function syncMobs(list: { id: number; type: number; zone: number; x: number; y: number; hp: number; par: number; imm: number; poison: boolean; moving: boolean; traits: number; hpMax?: number }[]) {
    const T = now(), seen = new Set<number>();
    for (const s of list) {
        seen.add(s.id);
        let m = mobMap.get(s.id);
        if (!m) {
            const type = MOB_TYPES[s.type], z = ZONES[s.zone]; if (!type || !z) continue;
            const d = mobDef(type, z);
            const tl = traitLabel(s.traits);
            m = { ...d, name: tl ? `${tl} ${d.name}` : d.name, sprite: d.sprite ?? type, zone: z, x: s.x, y: s.y, sx: s.x, sy: s.y, buf: [], hpMax: Math.round(d.hp * traitHpMult(s.traits)), hp: s.hp, busy: 0, par: 0, parT: 0, imm: 0, poison: 0, dir: rint(0, 7), moving: false, flash: 0, one: null, t0: R() * 5, id: s.id, elite: !!(s.traits & TRAIT_ELITE) };
            mobs.push(m); mobMap.set(s.id, m);
        }
        m.sx = s.x; m.sy = s.y; m.hp = s.hp;
        if (s.hpMax) m.hpMax = s.hpMax; // el server manda la vida máxima real (élites, escalado por party de las mazmorras)
        m.buf.push({ t: T, x: s.x, y: s.y }); if (m.buf.length > 8) m.buf.shift();
        if (s.par > 0.05) { if (m.par <= T) m.parT = T; m.par = T + s.par; } else m.par = 0;
        m.imm = T + s.imm; m.poison = s.poison ? T + 1 : 0;
    }
    for (const m of mobs.slice()) if (!seen.has(m.id)) dropMob(m);
}

// ---------- stats ----------
function totals() {
    const t = { crit: 0, aspd: 0, leech: 0, hp: 0, mp: 0, mag: 0, exp: 0, poison: 0, rpar: 0, rm: 0, df: 0, dmg: 0, def: 0, wdmg: [0, 0] as [number, number] };
    let rmAttr = 0; const worn: string[] = [];
    const add = (a: { id: AttrId; v: number }) => { if (a.id === 'rm') rmAttr += a.v; else t[a.id] += a.v; };
    for (const s of SLOTS) {
        const it = P.eq[s]; if (!it) continue;
        worn.push(it.name);
        const k = upMult(it.up);
        if (it.dmg) t.wdmg = k === 1 ? it.dmg : [Math.round(it.dmg[0] * k), Math.round(it.dmg[1] * k)]; if (it.def) t.def += Math.round(it.def * k); if (it.rm) t.rm += Math.round(it.rm * k); if (it.mag) t.mag += Math.round(it.mag * k);
        for (const a of it.attrs) add(a);
    }
    for (const b of activeSets(worn)) for (const [id, v] of b.stats) add({ id, v }); // bonos de set (mismos números que el server)
    const sb = statBonus(stats, classBaseHp(CLS.id, P.lvl)); t.hp += sb.hp; t.mp += sb.mp; // los puntos de Vitalidad, Fuerza, Magia y Destreza (mismos números que el server)
    t.df = itemDfTotal(t.df, capDf) + sb.def; t.rm += itemRmTotal(rmAttr, capRm); // DF y RM de ATRIBUTOS con el tope de la semana que manda el server; la base de las armaduras no
    t.def += t.df; // el atributo 'df' suma a la defensa
    if (t.dmg > 0 && t.wdmg[1] > 0) t.wdmg = [t.wdmg[0] + t.dmg, t.wdmg[1] + t.dmg]; // daño plano de los afijos (mismo cálculo que el server)
    return t;
}
// ---------- clases ----------
interface ClassDef { id: string; name: string; hidden?: boolean; desc: string; head: string; armor?: string; hp: number; hpL: number; mp: number; mpL: number; melee: [number, number]; weapon: string; spells: string[] }
const CLASSES: ClassDef[] = [
    { id: 'paladin', name: 'Paladín', desc: 'Tanque: aguanta, aturde y pega cuerpo a cuerpo.', head: 'head_short', armor: 'Coraza de cuero', hp: 140, hpL: 18, mp: 40, mpL: 4, melee: [5, 9], weapon: 'Espada corta', spells: ['golpe', 'juicio', 'escudo', 'mandato', 'aturdir', 'aura', 'represalia', 'escudodivino', 'amparo', 'furia', 'giro', 'carga', 'grito', 'remover', 'aliento'] },
    { id: 'mago', name: 'Mago', desc: 'Frágil: frío para frenar, fuego para rematar.', head: 'head_short', armor: 'Túnica de mago', hp: 90, hpL: 10, mp: 200, mpL: 12, melee: [2, 4], weapon: 'Báculo de fresno', spells: ['proyectil', 'esquirla', 'paralisis', 'nova', 'ignicion', 'bola', 'lluvia', 'escudomana', 'clarividencia', 'intelecto', 'furia', 'remover', 'invisibilidad', 'detectar', 'blink', 'aliento'] },
    { id: 'clerigo', name: 'Clérigo', desc: 'Apoyo: cura, bendice y corta casteos.', head: 'head_short', armor: 'Túnica de mago', hp: 110, hpL: 14, mp: 110, mpL: 13, melee: [3, 6], weapon: 'Báculo de fresno', spells: ['castigo', 'curacion', 'renovar', 'bendicion', 'novasagrada', 'reprender', 'orbe', 'guardian', 'esfera', 'grupo', 'furia', 'remover', 'pasoluz', 'despertar', 'detectar', 'aliento'] },
    { id: 'arquero', name: 'Arquero', hidden: true, desc: 'Sin kit todavía.', head: 'head_short', armor: 'Coraza de cuero', hp: 140, hpL: 18, mp: 40, mpL: 4, melee: [5, 9], weapon: 'Espada corta', spells: [] }, // esqueleto (D.0): no se puede crear hasta que tenga kit
];
let CLS: ClassDef = CLASSES[0];
/** Vida y maná máximos que manda el server (Vitals): mandan sobre la cuenta local, que usa números viejos de cada clase. */
const srvMax = { hp: 0, mp: 0 };
const maxHp = () => (connected && srvMax.hp) || classBaseHp(CLS.id, P.lvl) + totals().hp;
const maxMp = () => (connected && srvMax.mp) || classBaseMp(CLS.id, P.lvl) + totals().mp;
const expNeed = () => expToLevel(P.lvl);

// ---------- log ----------
mountChat($('chatRoot'));
{ const h = document.createElement('div'); h.id = 'castBarRoot'; document.body.appendChild(h); mountCastBar(h); }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Línea del sistema en el chat. `t` es HTML ya escapado (puede traer colores de rareza). */
function log(t: string, hi = false, _cls = '') { logToChat('system', 'System', t, hi ? '#e9dfc0' : undefined, true); }
function float(x: number, y: number, text: string, col: string, big = false) { floats.push({ x, y, text, col, t: 0, big }); }
const later = (dt: number, fn: () => void) => pending.push({ t: now() + dt, fn });
const oneShot = (e: Ent, anim: string, len: number) => { e.one = { anim, t: now(), until: now() + len }; };

// ---------- red ----------
const net = new Net();
let myId = -1n, connected = false, playersOnline = 0;

function sendFacing() {
    const a = P.ang ?? 0;
    // de vuelta de ángulo de pantalla a delta de grilla: dx-dy = cos, (dx+dy)/2 = sin
    const sx = Math.cos(a), sy = Math.sin(a) * 2;
    const d = gridDir((sx + sy) / 2, (sy - sx) / 2);
    if (d !== P.sentDir && !P.mv) { P.sentDir = d; net.send({ $case: 'changePlayerIdleDirectionRequest', value: { direction: d } }); }
}

function addOther(p: { profile?: string; playerId: bigint; x: number; y: number; direction: number; characterName: string; movementSpeedMs: number }) {
    if (p.playerId === myId) return;
    const [dx, dy] = GRID_VEC[p.direction] ?? [0, 1];
    const o: Other = { profile: p.profile ?? '', id: p.playerId, name: p.characterName, x: p.x + 0.5, y: p.y + 0.5, cell: { x: p.x, y: p.y }, queue: [], step: null, buf: [], stepMs: p.movementSpeedMs || 270, dir: 6, moving: false, one: null, flash: 0, phase: 0, ref: 3.4, t0: R() * 5, gone: false };
    turnTo(o, dx, dy, 0, true);
    others.set(o.id, o);
}

function snapTo(x: number, y: number) {
    P.mv = false; P.path = []; P.cell = { x, y }; P.x = x + 0.5; P.y = y + 0.5; P.sentX = P.x; P.sentY = P.y; P.sendT = 0;
}

function onServer(m: ServerPayload) {
    switch (m.$case) {
        case 'initialState':
            myId = m.value.playerId;
            P.stepMs = m.value.movementSpeedMs || 270;
            break;
        case 'mapTransfer': onMapTransfer(m.value); break;
        case 'initialGameWorldState': {
            // al conectar puedo estar en un mapa distinto del que armé al arrancar (el guardado me deja donde salí): armarlo antes de ubicarme
            if (m.value.mapName && m.value.mapName !== MAP_DEF.id && getMapDef(m.value.mapName)) loadMap(getMapDef(m.value.mapName)!);
            MAP_WORLD_ID = m.value.gameWorldId;
            snapTo(m.value.playerX, m.value.playerY);
            const [dx, dy] = GRID_VEC[m.value.playerDirection] ?? [0, 1];
            turnTo(P, dx, dy, 0, true);
            const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y;
            others.clear(); drops.length = 0; P.pickup = null; // el server vuelve a mandar el suelo cercano
            { const n = getMapDef(m.value.mapName)?.name; if (n) $('mlName').textContent = n; }
            revealPending = true; // el telón se levanta recién después de dibujar este mapa (ver frame)
            break;
        }
        case 'playersEnteredRange':
            for (const p of m.value.players) addOther(p);
            break;
        case 'pvpHit': {
            const v = m.value;
            // control sobre alguien inmune (jefe, Bendición, Purga o rendimiento decreciente): lo avisa el server, venga de quien venga
            if (v.fx === 'resist') { float(v.x, v.y - 0.5, 'Inmune', '#9fe8ff'); break; }
            if (v.fx === 'miss') { float(v.x, v.y - 0.5, 'Falló', '#c9c9c9'); break; }
            if (v.targetId === myId && v.secs < 0) { P.frozenUntil = 0; P.slowEnd = 0; P.immEnd = now() - v.secs; log(`¡Te purgaron! No te paralizan por ${-v.secs} s.`, true); break; } // el server manda la inmunidad como secs negativo (D.4)
            if (v.casterId === myId) { // el server me confirma mi golpe con el daño que calculó
                P.pvpAt = now(); // en combate PvP: no regenera vida (HP_REGEN)
                if (v.secs > 0) float(v.x, v.y - 0.6, 'Paralizado', '#7fd6ff'); break;
            }
            if (v.fx === 'blizz') fx.push({ k: 'blizz', x: v.x, y: v.y, t: 0, r: v.r || 2.7, d: 3.2 }); else if (v.fx) efxLocal(v.fx, v.x, v.y, v.targetId ? 8 : 0);
            if (v.targetId === myId && !P.dead) {
                {
                    P.pvpAt = now();
                    if (v.dmg > 0) hurtPlayer(v.dmg, 'phys', true);
                    if (v.secs > 0) { P.frozenUntil = now() + v.secs; P.path = []; P.engage = false; P.foe = null; cancelCast(); toast('¡Te paralizaron!'); }
                }
            }
            break;
        }
        case 'mobsSnapshot': syncMobs(m.value.mobs); break;
        case 'mobDamaged': onMobDamaged(m.value); break;
        case 'mobAttack': {
            const mob = mobMap.get(m.value.mobId); if (!mob) break;
            turnTo(mob, m.value.tx - mob.x, m.value.ty - mob.y, 0, true); oneShot(mob, 'swing', 0.4);
            if (/arana|spider/.test(mob.sprite ?? '') && dist(mob, P) < 10) sfx('spider-attack', 0.6); // ataque de araña (solo si está cerca mío)
            break;
        }
        case 'playerProjectile': {
            const v = m.value;
            if (v.playerId !== myId && arrows.length < 80) arrows.push({ x0: v.fromX, y0: v.fromY, x1: v.toX, y1: v.toY, t0: now(), dur: Math.max(0.08, v.travelMs / 1000), kind: v.spell === 'bola' ? 3 : 2 });
            break;
        }
        case 'mobProjectile': {
            const v = m.value;
            if (arrows.length < 80) arrows.push({ x0: v.fromX, y0: v.fromY, x1: v.toX, y1: v.toY, t0: now(), dur: Math.max(0.08, v.travelMs / 1000), kind: v.kind });
            break;
        }
        case 'mobHitPlayer': onMobHitPlayer(m.value); break;
        case 'mobSpecialEvent': onMobSpecial(m.value); break;
        case 'bossCast': case 'bossCastEnd': case 'bossTelegraph': case 'bossZone': case 'bossPhase': onBoss(m); break;
        case 'mobDied': onMobDied(m.value); break;
        case 'inventoryState': applyInventory(m.value); break;
        case 'dailyShopState': daily = m.value.offers.map((o) => ({ base: o.base, quality: Math.min(4, Math.max(0, o.quality)), attrs: loadAttrs(o.attrs), price: o.price, star: o.star, sold: o.sold })); renderShop(); break;
        case 'groundItemSpawned': {
            const v = m.value; if (!v.item) break;
            const nd: Drop = { gid: v.id, x: v.x, y: v.y, item: itemFromInv(v.item), t: 0, lockedUntil: v.locked ? now() + v.freeInMs / 1000 : 0 };
            const old = drops.find((d) => d.gid === v.id);
            if (old) Object.assign(old, nd, { t: old.t }); else drops.push(nd);
            break;
        }
        case 'lootSpawnEvent': onLootSpawn(m.value); break;
        case 'serverItemPickedUp': onLootPicked(m.value); break;
        case 'groundItemRemoved': { const i = drops.findIndex((d) => d.gid === m.value.id); if (i >= 0) { if (P.pickup === drops[i]) P.pickup = null; drops.splice(i, 1); } break; }
        case 'auctionSearchResult': case 'auctionMyState': case 'auctionHistory': auction.onMessage(m); break;
        case 'depositState': deposit.onMessage(m); break;
        case 'tradeState': case 'tradeInvite': trade.onMessage(m); break; // Dar e Intercambiar (docs/INTERCAMBIO.md)
        case 'recallState': onRecallState(m.value); break;
        case 'abilityState': onAbilityState(m.value); break;
        case 'partyState': renderParty(m.value.members); break;
        case 'combatTextEvent': onCombatText(m.value); break;
        case 'partyStatsUpdate': updatePartyStats(m.value.name, m.value.hp, m.value.mp); break;
        case 'partyInvited': showPartyInvite(m.value.fromName, Number(m.value.expiresMs)); break;
        case 'guildState': guild.onState(m.value); deposit.refresh(); break; // docs/GUILDS.md
        case 'guildInvited': guild.onInvited(m.value.fromName, m.value.guildName, m.value.tag, Number(m.value.expiresMs)); break;
        case 'arenaInvited': showArenaInvite(m.value.mode, Number(m.value.expiresMs)); break;
        case 'arenaInfo': renderArena(m.value); break;
        case 'econResult': deposit.onResult(m.value.ok, m.value.text); if (m.value.ok) { log(esc(m.value.text), ['daily_done', 'quest_ready'].includes(m.value.code)); if (m.value.code === 'daily_done') notify('Encargo cumplido', m.value.text); else if (m.value.code === 'quest_ready') notify('Misión', m.value.text); } else { toast(m.value.text); log(esc(m.value.text)); } break;
        case 'killReward': onKillReward(m.value); break;
        case 'statusUpdate': onStatusUpdate(m.value); break;
        case 'skillEffect': onSkillEffect(m.value); break;
        case 'vitals': onVitals(m.value); break;
        case 'logoutResponse': if (logout) { logout.at = now() + m.value.wait; logout.asked = true; if (m.value.wait <= 0) { logout.at = now(); } } break;
        case 'playerVitals': { const o = others.get(m.value.playerId); if (o) { o.hp = m.value.hp; o.maxHp = m.value.maxHp; o.shield = m.value.shield; } break; }
        case 'pvpKill': { const v = m.value; if (v.playerId !== myId) log(v.killerName ? `<b>${esc(v.killerName)}</b> derrotó a <b>${esc(v.victimName)}</b>.` : `<b>${esc(v.victimName)}</b> cayó.`, true); else if (v.killerName) log(`Te derrotó <b>${esc(v.killerName)}</b>.`, true); break; }
        case 'playerProfileChanged': { const o = others.get(m.value.playerId); if (o) o.profile = m.value.profile; break; }
        case 'playersLeftRange':
            for (const id of m.value.playerIds) others.delete(id);
            break;
        case 'playerMoved': {
            const o = others.get(m.value.playerId); if (!o) break;
            o.stepMs = m.value.movementSpeedMs || o.stepMs;
            // el movimiento normal llega por playerPositionUpdate (posición decimal); acá solo los saltos
            if (m.value.teleport) { o.queue = []; o.step = null; o.buf = []; o.cell = { x: m.value.destX, y: m.value.destY }; o.x = o.cell.x + 0.5; o.y = o.cell.y + 0.5; }
            break;
        }
        case 'playerPositionUpdate': {
            const o = others.get(m.value.playerId); if (!o) break;
            o.buf.push({ t: now(), x: m.value.x, y: m.value.y });
            if (o.buf.length > 24) o.buf.splice(0, o.buf.length - 24);
            o.cell = { x: Math.floor(m.value.x), y: Math.floor(m.value.y) };
            break;
        }
        case 'playerIdleDirectionChanged': {
            const o = others.get(m.value.playerId); if (!o) break;
            const [dx, dy] = GRID_VEC[m.value.direction] ?? [0, 1];
            turnTo(o, dx, dy, 0, true);
            break;
        }
        case 'playerDisconnected': { const o = others.get(m.value.playerId); if (o) o.gone = true; break; }
        case 'playerReconnected': { const o = others.get(m.value.playerId); if (o) o.gone = false; break; }
        case 'spellCastFailed': cancelCast('No podés castear ahora.'); break;
        case 'playerMovementStateChanged':
            if (m.value.playerId === myId) { P.stepMs = m.value.movementSpeedMs || P.stepMs; P.running = m.value.runningMode; }
            else { const o = others.get(m.value.playerId); if (o) o.stepMs = m.value.movementSpeedMs || o.stepMs; }
            break;
        case 'resetPosition':
            diag.snaps.push(now()); snapTo(m.value.x, m.value.y);
            break;
        case 'positionCorrected':
            diag.snaps.push(now()); snapTo(m.value.destX, m.value.destY);
            break;
        case 'playerTeleported': {
            snapTo(m.value.x, m.value.y);
            const pt = iso(P.x, P.y); if (Math.hypot(pt.x - cam.x, pt.y - cam.y) > 500) { cam.x = pt.x; cam.y = pt.y; }
            break;
        }
        case 'playerParalyzed':
            P.frozenUntil = now() + m.value.durationSeconds; P.path = [];
            toast(`El server te frenó ${m.value.durationSeconds} s.`);
            break;
        case 'sendMessage':
            if (m.value.message.startsWith(GM_TAG)) { try { renderGm(JSON.parse(m.value.message.slice(GM_TAG.length))); } catch { /* menú GM mal formado: se ignora */ } break; }
            log(esc(m.value.message), false, 'sys');
            break;
        case 'chatMessageReceived': logToChat(chatChannel(m.value.channel), m.value.senderCharacterName, m.value.message); break;
        case 'serverChatMessage': logToChat(chatChannel(m.value.channel), m.value.senderName, m.value.text); break;
            break;
        case 'pingResponse':
            diag.pong(m.value.sequence);
            playersOnline = m.value.playersInMap;
            break;
        default:
            break;
    }
}

// ---------- combate ----------
/** Pide el golpe al server: él valida alcance y tope de daño, lo aplica y avisa a todos (`mobDamaged`). */
/** Los mobs ordenados del más cercano al más lejano al centro de un área: el server pega a los primeros (tope de objetivos). */
const byDistance = (list: Mob[], x: number, y: number): Mob[] => list.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
let lastMeleeReq = -9; // cuándo pedí mi último golpe básico: el sonido de la espada suena cuando el server lo confirma
function damageMob(m: Mob, spell: string, parSecs = 0) {
    if (!mobs.includes(m) || P.dead) return;
    if (spell === 'ataque') lastMeleeReq = now();
    // Desde el paso 1.3 el server calcula todo (daño, crítico, veneno, robo de vida, recarga y maná): acá solo se pide el golpe.
    net.send({ $case: 'mobHitRequest', value: { mobId: m.id, dmg: 0, melee: spell === 'ataque', crit: false, parSecs, poisonSecs: 0, spell } });
}
/** Lo que se ve cuando el server confirma un golpe (propio o de otro jugador). */
function onMobDamaged(v: { mobId: number; attackerId: bigint; dmg: number; crit: boolean; hp: number }) {
    const m = mobMap.get(v.mobId); if (!m) return;
    const mine = v.attackerId === myId, poisonTick = v.dmg === 3 && !v.crit && m.poison > now();
    m.hp = v.hp; m.flash = 0.12;
    if (mine && !poisonTick && /goblin/.test(m.sprite ?? '')) sfx('goblin-hit', 0.6); // quejido del goblin (y de sus variantes) al recibir un golpe mío
    if (mine && !poisonTick && CLS.id === 'paladin' && now() - lastMeleeReq < 0.6) {
        sfx(v.crit ? 'sword-crit' : 'sword-attack', v.crit ? 0.85 : 0.5);
        efxLocal(v.crit ? 'critico' : 'impacto', m.x, m.y); // chispazo del golpe (solo lo veo yo)
        // crítico con el skin del caballero: golpe desde arriba (arranca con la espada ya levantada para que caiga junto con el número)
        if (v.crit && heroKey() === 'hero_knight') P.one = { anim: 'crit', t: now() - 0.15, until: now() + 0.65 };
    }
    if (!poisonTick && !(m.one && (m.one.anim === 'swing' || m.one.anim === 'special') && now() < m.one.until) && !(m.boss && R() < 0.6)) oneShot(m, 'hit', 0.2);
    // el número lo dibuja CombatTextManager (CombatTextEvent)
    if (mine) { hitstop = Math.max(hitstop, v.crit ? 0.09 : 0.045); if (v.crit && !reduce) shake = 0.25; }
}
/** Subí de nivel (lo decide el server): efecto y aviso. */
/** Efectos de sonido (assets/sfx/<nombre>.ogg). Se crean la primera vez que se piden; si el navegador bloquea el audio o falta el archivo, no pasa nada. */
const SFX: Record<string, HTMLAudioElement> = {};
function sfx(name: string, vol = 0.6) {
    try { const a = (SFX[name] ??= new Audio(`assets/sfx/${name}.ogg`)); a.volume = vol; a.currentTime = 0; void a.play().catch(() => { /* sin interacción previa o sin archivo */ }); } catch { /* sin audio */ }
}
function onLevelUp() {
    sfx('level-up'); P.hp = maxHp(); P.mp = maxMp(); float(P.x, P.y - 0.5, `¡Nivel ${P.lvl}!`, '#ffd24a', true); log(`Subiste a nivel ${P.lvl}.`, true); levelCard(P.lvl); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#ffd24a' });
}
/** El server avisó que un mob murió: lo saca del espejo, deja el cadáver y, si el golpe final fue mío, cobro el botín. */
/** El server avisa quién está invisible y si yo veo invisibles. */
/** Lo que se ve de una habilidad de clase (el server confirma): origen y destino del Blink, la embestida, el giro y el grito. Si la rechazó, devuelvo recarga y maná. */
function onSkillEffect(v: { casterId: bigint; skill: string; fromX: number; fromY: number; toX: number; toY: number; ok: boolean }) {
    if (!v.ok) {
        if (v.casterId !== myId) return;
        const i = SPELLS.findIndex((x) => x.id === v.skill); if (i >= 0) { cds[i] = 0; P.mp = Math.min(maxMp(), P.mp + SPELLS[i].mp); }
        return;
    }
    const fx0 = v.fromX + 0.5, fy0 = v.fromY + 0.5, tx = v.toX + 0.5, ty = v.toY + 0.5;
    switch (v.skill) {
        case 'pasoluz': efxLocal('spread', fx0, fy0); fx.push({ k: 'ring', x: fx0, y: fy0, t: 0, c: '#fff2a8' }); efxLocal('sphere', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#fff2a8' }); break;
        case 'blink': efxLocal('spread', fx0, fy0); fx.push({ k: 'ring', x: fx0, y: fy0, t: 0, c: '#b9a3ff' }); efxLocal('fugaz', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#b9a3ff' }); fx.push({ k: 'burst', x: tx, y: ty, t: 0, c: '#b9a3ff' }); break;
        case 'carga': efxLocal('polvareda', fx0, fy0); efxLocal('rafaga', tx, ty); fx.push({ k: 'burst', x: fx0, y: fy0, t: 0, c: '#ff9a4a' }); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 1.2, c: '#ff9a4a' }); if (!reduce && v.casterId === myId) shake = Math.max(shake, 0.2); break;
        case 'giro': efxLocal('cyclone', tx, ty); efxLocal('polvo', tx, ty); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 1.9, c: '#ffd0a0' }); break;
        case 'nova': efxLocal('picos', tx, ty); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 3, c: '#bfe8ff' }); break;
        case 'aliento': fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#7fe0a0' }); efxLocal('mana', tx, ty); break;
        case 'mandato': efxLocal('provocar', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#ff7a5a' }); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 6, c: '#ff7a5a' }); break;
        case 'aura': efxLocal('bendicion', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#ffe9a0' }); break;
        case 'curacion': case 'renovar': efxLocal('curar', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#8af0a8' }); break;
        case 'orbe': efxLocal('curar', tx, ty); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 4, c: '#a8ffd0' }); break;
        case 'bendicion': efxLocal('inmune', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#ffe9a0' }); break;
        case 'novasagrada': efxLocal('solargrande', tx, ty); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 4.5, c: '#fff0b0' }); break;
        case 'reprender': efxLocal('solar', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#fff0b0' }); break;
        case 'grito': case 'amparo': case 'intelecto': case 'grupo': { // bendiciones de grupo (14 celdas)
            const c = LIB[v.skill]?.col ?? '#ffe27a'; efxLocal(v.skill === 'amparo' ? 'inmune' : v.skill === 'intelecto' ? 'mana' : 'poder', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c }); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 3, c }); break; }
        case 'escudomana': case 'escudodivino': case 'guardian': efxLocal(v.skill === 'escudomana' ? 'cupula' : 'anillo', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: LIB[v.skill]?.col ?? '#bfe8ff' }); break;
        case 'represalia': efxLocal('represalia', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#ff9a6a' }); break;
        case 'clarividencia': efxLocal('estrella', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#d0a8ff' }); break;
        case 'esfera': efxLocal('curar', tx, ty); fx.push({ k: 'burst', x: tx, y: ty, t: 0, c: '#fff2a8' }); break;
        case 'despertar': efxLocal('revivir', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#ffffff' }); break;
    }
    if ((v.skill === 'blink' || v.skill === 'pasoluz') && v.casterId === myId) { const pt = iso(P.x, P.y); if (Math.hypot(pt.x - cam.x, pt.y - cam.y) > 500) { cam.x = pt.x; cam.y = pt.y; } }
}
/**
 * Bendiciones y auras de K8: duración (s) y aviso al entrar. La duración exacta la lleva el server; acá es para la cuenta regresiva.
 * `l` = duración fuera de la arena (las bendiciones de grupo duran 15 min afuera); `s` = la de adentro de la arena.
 */
const BUFF_INFO: Record<string, { s: number; l?: number; k: string; c: string; n: string }> = {
    poder: { s: 60, l: 900, k: 'P', c: '#ffcf5a', n: 'Bendición de poder: +16 de Daño' },
    amparo: { s: 60, l: 900, k: 'A', c: '#a8d8ff', n: 'Bendición de amparo: −6 % de daño recibido' },
    intelecto: { s: 90, l: 900, k: 'M', c: '#b9a3ff', n: 'Intelecto arcano: +8 de Magia' },
    fortaleza: { s: 90, l: 900, k: 'T', c: '#ffb07a', n: 'Fortaleza: +6 % de vida máxima' },
    espiritu: { s: 90, l: 900, k: 'E', c: '#a8ffe0', n: 'Espíritu divino: +50 % de regeneración de maná' },
    represalia: { s: 10, k: 'X', c: '#ff9a6a', n: 'Aura de represalia: −20 % de daño y devuelve ⅓ a los monstruos' },
    clarividencia: { s: 10, k: 'C', c: '#d0a8ff', n: 'Clarividencia: +25 % de crítico de hechizos' },
};
/** Cuánto dura ahora (s): adentro de la arena la corta, afuera la larga. */
const buffSecs = (id: string): number => { const b = BUFF_INFO[id]; return b.l && !(MAP_DEF.pvp === 'ffa' || inArena(P.x, P.y)) ? b.l : b.s; };
const fmtSecs = (n: number): string => (n >= 120 ? `${Math.round(n / 60)} min` : `${n} s`);
const myBuffs: Record<string, number> = {};
function onStatusUpdate(v: { playerId: bigint; invisible: boolean; detect: boolean; fury: boolean; warcry: boolean; slow: boolean; blessed: boolean; poisoned: boolean; buffs?: string[] }) {
    if (v.playerId === myId) {
        const on = new Set(v.buffs ?? []);
        for (const id of Object.keys(BUFF_INFO)) {
            const had = (myBuffs[id] ?? 0) > now();
            if (on.has(id) && !had) { const secs = buffSecs(id); myBuffs[id] = now() + secs; log(`${BUFF_INFO[id].n} por ${fmtSecs(secs)}.`, true); }
            else if (!on.has(id) && had) myBuffs[id] = 0;
        }
        if (v.poisoned !== P.poisonEnd > now()) { P.poisonEnd = v.poisoned ? now() + 4 : 0; if (v.poisoned) toast('¡Te envenenaron! Recibís 30 % menos de curación.'); }
        if (v.blessed !== P.blessEnd > now()) { P.blessEnd = v.blessed ? now() + 10 : 0; if (v.blessed) { P.frozenUntil = 0; log('Bendición sagrada: −20 % de daño, +30 % de curación e inmune a congelado y aturdido por 10 s.', true); } }
        if (v.slow !== P.slowEnd > now()) { P.slowEnd = v.slow ? now() + 1.5 : 0; if (v.slow) toast('¡Te ralentizaron!'); }
        if (P.inv !== v.invisible) log(v.invisible ? 'Te volviste invisible (15 s o hasta que ataques).' : 'Ya no sos invisible.', true);
        if (P.det !== v.detect) log(v.detect ? 'Ves a los invisibles por 10 s.' : 'Se acabó Detectar invisible.', true);
        if (v.invisible && !P.inv) P.invEnd = now() + 15; if (v.detect && !P.det) P.detEnd = now() + 10; P.inv = v.invisible; P.det = v.detect; return;
    }
    const o = others.get(v.playerId); if (o) { o.inv = v.invisible; o.fury = v.fury; }
}
function onMobDied(v: { mobId: number; killerId: bigint; x: number; y: number; type: number; zone: number }) {
    const type = MOB_TYPES[v.type], z = ZONES[v.zone]; if (!type || !z) return;
    const mob = mobMap.get(v.mobId); if (mob) dropMob(mob);
    corpses.push({ sprite: mobDef(type, z).sprite ?? type, x: v.x, y: v.y, dir: mob?.dir ?? 6, t: now() });
}
/** El server ya aplicó el botín del golpe final (exp, oro, item, pociones, misión): acá solo se muestra. El estado nuevo llega en `inventoryState`. */
// ---------- botín de suelo (LootSpawnEvent / ClientPickupItem / ServerItemPickedUp; server: systems/loot.ts) ----------
const LOOT_PURPLE = '#b26bff';
function onLootSpawn(v: { lootId: string; x: number; y: number; itemId: string; itemName: string; amount: number }, mock = false) {
    if (drops.some((d) => d.loot?.id === v.lootId)) return;
    drops.push({ x: v.x + 0.5, y: v.y + 0.5, t: 0, loot: { id: v.lootId, itemId: v.itemId, name: v.itemName, amount: v.amount, mock } });
}
function onLootPicked(v: { lootId: string; playerId: string; itemName: string; amount: number; playerName: string }) {
    const i = drops.findIndex((d) => d.loot?.id === v.lootId), li = i >= 0 ? drops[i].loot?.itemId : undefined;
    if (i >= 0) { if (P.pickup === drops[i]) P.pickup = null; if (hoverDrop === drops[i]) hoverDrop = null; drops.splice(i, 1); }
    if (!v.playerId) return; // venció
    const item = `<span style="color:${LOOT_PURPLE}">[${esc(v.itemName)}]</span>`;
    if (v.playerId === myId.toString()) {
        if (li && li !== 'gold') MAT_NAMES[li] = v.itemName;
        logToChat('combat', 'System', `¡Has obtenido ${item} x${v.amount}!`, undefined, true); // canal combat: sale en All y en System
    } else if (v.playerName && partyRows.has(v.playerName)) logToChat('party', '', `[${esc(v.playerName)}] obtuvo ${item}`, undefined, true);
}
function onKillReward(v: { mobId: number; x: number; y: number; exp: number; gold: number; goldD: number; item?: InvItemMsg; bagFull: boolean; potion: string; shard: string; zem?: number; newLvl: number; questReady: boolean; questProg: number }) {
    const mob = mobMap.get(v.mobId), boss = !!mob?.boss;
    combatText.showAt(P.x, P.y, `+${v.exp} exp`, '#f0c84a', 22, myId.toString()); // sobre mi personaje, no sobre el mob (ahí va el daño)
    if (v.item) {
        const it = itemFromInv(v.item);
        if (boss) { log(`¡${mob?.name ?? 'El boss'} cayó! Soltó un item <span style="color:${it.rar.c}">${it.rar.n.toLowerCase()}</span>.`, true); shake = Math.max(shake, 0.4); }
        if (v.bagFull) { log(`Bolsa llena: <span style="color:${it.rar.c}">${esc(it.name)}</span> cayó al suelo, a tus pies. Es tuyo durante 60 s; recogelo con Espacio o clic.`, true); toast('Bolsa llena: el item cayó al suelo'); }
        else if (it.rar.k >= 2 && !boss) log(`¡Cayó un item <span style="color:${it.rar.c}">${it.rar.n.toLowerCase()}</span>!`, true);
        else logToChat('combat', 'Loot', `¡Has obtenido [${it.name}] x1!`, it.rar.c);
    }
    if (v.gold || v.goldD) log(`Juntaste ${fmtNum(v.goldD || v.gold)} de oro.`);
    if (v.zem) log(`Encontraste ${v.zem} zem.`, true);
    if (v.potion === 'hp' || v.potion === 'mp') log(`Encontraste una ${POTS[v.potion].name.toLowerCase()}.`, true);
    if (v.shard === 'cripta' || v.shard === 'foso') { const kd = KEYDEFS[v.shard]; log(`El boss soltó una <b>${kd.shard}</b>. Con ${SHARDS_PER_KEY} esquirlas y ${kd.gold} de oro el Capitán te forja una ${kd.name}.`, true); }
    // los avisos de misión llegan como econResult (quest_ready); la cadena vieja de 10 quedó jubilada
}
/** Habilidad distintiva del boss (el server decide cuándo y a quién pega): fase 0 = aviso y carga, fase 1 = el golpe en área. */
// ---------- motor de jefes (docs/JEFES.md): el server avisa, acá solo se dibuja ----------
const SCHOOL_COL: Record<string, string> = { fis: '#e8e0d0', fuego: '#ff7a3a', acido: '#9be04a', sombra: '#b48cff' };
const bossCasts = new Map<number, { name: string; col: string; t0: number; dur: number; win: number; lock: boolean }>();
const bossMarks: { x: number; y: number; r: number; t0: number; dur: number }[] = [];
const bossZones = new Map<number, { x: number; y: number; r: number; until: number }>();
const bossRage = new Set<number>();
function onBoss(msg: { $case: string; value: unknown }) {
    const T = now(), v = msg.value as Record<string, never>;
    const m = mobMap.get(v.mobId as number);
    switch (msg.$case) {
        case 'bossCast': {
            const c = v as unknown as { mobId: number; name: string; school: string; durationMs: number; windowFromMs: number; interruptible: boolean };
            bossCasts.set(c.mobId, { name: c.name, col: SCHOOL_COL[c.school] ?? '#e8e0d0', t0: T, dur: c.durationMs / 1000, win: c.windowFromMs / 1000, lock: !c.interruptible });
            if (m) float(m.x, m.y - 0.4, `${c.name}${c.interruptible ? '' : ' 🔒'}`, SCHOOL_COL[c.school] ?? '#fff', true);
            break;
        }
        case 'bossCastEnd': {
            const c = v as unknown as { mobId: number; result: number; by: string };
            bossCasts.delete(c.mobId);
            if (c.result === 1 && m) { float(m.x, m.y - 0.6, '¡Interrumpido!', '#ffd24a', true); log(`${c.by || 'Alguien'} cortó el casteo de ${m.name}.`); }
            break;
        }
        case 'bossTelegraph': {
            const t = v as unknown as { x: number; y: number; r: number; warnMs: number; name: string };
            bossMarks.push({ x: t.x - 0.5, y: t.y - 0.5, r: t.r, t0: T, dur: t.warnMs / 1000 });
            later(t.warnMs / 1000, () => efxLocal('explosion', t.x - 0.5, t.y - 0.5)); // el golpe cae donde avisó
            if (m) float(m.x, m.y - 0.4, `¡${t.name}!`, '#ff6a4a', true);
            break;
        }
        case 'bossZone': { const z = v as unknown as { id: number; x: number; y: number; r: number; durationMs: number }; bossZones.set(z.id, { x: z.x - 0.5, y: z.y - 0.5, r: z.r, until: T + z.durationMs / 1000 }); efxLocal('charco', z.x - 0.5, z.y - 0.5); break; }
        case 'bossPhase': {
            const ph = v as unknown as { mobId: number; event: string; text: string; enraged: boolean };
            if (ph.enraged) bossRage.add(ph.mobId); else bossRage.delete(ph.mobId);
            if (m && ph.event === 'adds') efxLocal('invocar', m.x, m.y);
            if (m && ph.event === 'furia') efxLocal('represalia', m.x, m.y);
            if (ph.event === 'reinicio') bossCasts.delete(ph.mobId);
            if (ph.text) { log(ph.text, true); if (m) float(m.x, m.y - 0.8, ph.text, ph.enraged ? '#ff4a3a' : '#ffd24a', true); }
            break;
        }
    }
}
/** Círculos de aviso y charcos de los jefes, en el piso. */
function drawBossGround(T: number) {
    const ell = (x: number, y: number, r: number, fill: string, a: number, stroke?: string) => { const p = iso(x, y), rx = r * TW * 0.707; ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill(); if (stroke) { ctx.globalAlpha = 0.85; ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); } ctx.restore(); };
    for (const [id, z] of bossZones) { if (z.until <= T) { bossZones.delete(id); continue; } ell(z.x, z.y, z.r, '#7bc43a', 0.32, '#9be04a'); }
    for (const k of bossMarks.slice()) {
        const f = (T - k.t0) / k.dur; if (f > 1.15) { bossMarks.splice(bossMarks.indexOf(k), 1); continue; }
        ell(k.x, k.y, k.r, '#ff3a2a', 0.12, '#ff6a4a'); ell(k.x, k.y, k.r * Math.min(1, f), '#ff3a2a', 0.28);
    }
}
/** Barra de casteo con nombre bajo la barra de vida: el tramo dorado es la ventana del corte blando; con candado no se corta. */
function drawBossCast(m: Mob, x: number, y: number, T: number) {
    const c = bossCasts.get(m.id); if (!c) return;
    const f = Math.min(1, (T - c.t0) / c.dur), w = 90, h = 7;
    if (f >= 1.2) { bossCasts.delete(m.id); return; }
    ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    if (!c.lock) { ctx.fillStyle = 'rgba(255,210,74,.35)'; ctx.fillRect(x - w / 2 + (w * c.win) / c.dur, y, w - (w * c.win) / c.dur, h); }
    ctx.fillStyle = c.lock ? '#8a8a8a' : c.col; ctx.fillRect(x - w / 2, y, w * f, h);
    nameTag(`${c.lock ? '🔒 ' : ''}${c.name}`, x, y + h + 11, c.lock ? '#cfcfcf' : c.col, 1, 11);
}
function onMobSpecial(v: { mobId: number; phase: number; x: number; y: number }) {
    const m = mobMap.get(v.mobId), sp = m?.boss?.special; if (!m || !sp) return;
    if (v.phase === 0) { m.busy = now() + 1.1; oneShot(m, 'special', 1.3); float(m.x, m.y - 0.4, `¡${sp.name}!`, sp.col, true); }
    else { fx.push({ k: 'boom', x: v.x, y: v.y, t: 0, c: sp.col, r: sp.r }); if (!reduce) shake = Math.max(shake, 0.3); }
}
/** El server me pegó un mob (el daño ya viene calculado; acá solo aplico la DF para mostrarlo: los mobs pegan físico). */
function onMobHitPlayer(v: { mobId: number; dmg: number; stun: number }) {
    if (P.dead) return;
    const m = mobMap.get(v.mobId);
    if (v.dmg > 0) { hurtPlayer(v.dmg); sfx('hurt', 0.7); } // quejido cuando un mob me pega
    if (v.stun > 0 && !P.dead) {
        P.frozenUntil = now() + v.stun; P.path = []; P.engage = false; cancelCast();
        const sp = m?.boss?.special; log(`${m ? m.name : 'Un enemigo'}${sp ? ': ' + sp.name : ''}. Quedaste inmovilizado ${v.stun} s.`, true);
    }
}
function meleeHit(m: Mob) {
        damageMob(m, 'ataque');
}
function explode(p: Proj) {
    fx.push({ k: 'boom', x: p.tx!, y: p.ty!, t: 0, r: p.aoe }); efx('eruption', p.tx!, p.ty!);
    scorch.push({ x: p.tx!, y: p.ty!, t: now(), r: p.aoe! });
    if (!reduce) shake = 0.3; hitstop = Math.max(hitstop, 0.06);
    let n = 0;
    for (const o of enemiesNear(p.tx!, p.ty!, p.aoe!)) pvpDamage(o, 'bola', '');
    for (const m of byDistance(mobs, p.tx!, p.ty!)) { if (Math.hypot(m.x - p.tx!, m.y - p.ty!) <= p.aoe!) { n++; damageMob(m, 'bola'); } }
    if (n > 1) log(`Bola de fuego: ${n} enemigos alcanzados.`, true);
}
/** Mitigación con rendimiento decreciente: daño × 100/(100+X), X = DF (físico) o RM (mágico). Igual que el server. */
const mitigate = (d: number, x: number) => Math.max(1, Math.round((d * 100) / (100 + Math.max(0, x))));
const mitigPct = (x: number) => Math.round((Math.max(0, x) / (100 + Math.max(0, x))) * 100);
/** Muestra el golpe que recibí. La vida la lleva el server: acá solo el efecto (`applied` = el daño ya viene con la defensa descontada). */
function hurtPlayer(d: number, kind: 'phys' | 'magic' = 'phys', applied = false) {
    if (P.dead) return;
    if (!applied) {
        const tt = totals(); d = mitigate(d, kind === 'magic' ? tt.rm : tt.def);
    }
    P.flash = 0.12; P.hurtAt = now(); // corta la regeneración de vida hasta la calma (HP_REGEN.calmMs)
    if (P.casting) P.casting.end = Math.min(P.casting.end + 0.2, P.casting.start + P.casting.len * 1.6);
    if (!(P.one && P.one.anim !== 'hit' && now() < P.one.until)) oneShot(P, 'hit', 0.15);
}
/** El server dice que morí: pierdo un poco de exp y pido revivir en mi ciudad. */
/** Muerto esperando que un clérigo aliado lo despierte (K8). */
let reviveWait = false;
function die() {
    if (P.dead) return;
    P.dead = true; potEpoch++; pots.cd = 0; P.deadT = now(); P.hp = 0; P.path = []; P.casting = null; P.target = null; P.med = false; const lost = Math.round(expNeed() * 0.05); // la pérdida de exp la aplica el server (llega en inventoryState)
    log(`Moriste. Perdiste ${lost} de exp y ${MAP_DEF.id === DEFAULT_MAP ? 'volvés a tu ciudad' : 'reaparecés en el punto de reaparición de este mapa'}.`, true);
    const ask = (n: number) => { if (!P.dead || n > 10) return; net.send({ $case: 'respawnRequest', value: {} }); later(1, () => ask(n + 1)); };
    // K8: con un clérigo aliado cerca, se espera 10 s antes de reaparecer para que te pueda Despertar
    reviveWait = [...others.values()].some((o) => !o.gone && facOf(o.profile) === selectedFaction && !isEnemy(o) && o.profile.split(';')[1] === 'clerigo' && (o.hp ?? 1) > 0 && dist(P, o) <= 15);
    if (reviveWait) toast('Hay un clérigo aliado cerca: te puede despertar. Si no, reaparecés en 10 s.');
    later(reviveWait ? 10 : 2.2, () => ask(0));
}
/** Mi vida según el server: es la que vale. */
function onVitals(v: { hp: number; maxHp: number; dead: boolean; mp: number; maxMp: number; shield?: number }) {
    if (v.maxHp > 0) srvMax.hp = v.maxHp; if (v.maxMp > 0) srvMax.mp = v.maxMp;
    const sh = v.shield ?? 0; if (sh > 0 && P.shield <= 0) P.shieldEnd = now() + 10; P.shield = sh; // escudos de K8: duran 10 s
    if (v.dead) { if (!P.dead) die(); P.hp = 0; return; }
    if (P.dead) { const woke = reviveWait && now() - P.deadT < 9.9; reviveWait = false; /* lo despertó un clérigo: el aviso llega del server */ P.dead = false; P.one = null; P.mp = maxMp(); mpLocalAt = 0; if (!woke) log(MAP_DEF.id === DEFAULT_MAP ? 'Revivís en tu ciudad.' : 'Revivís en el punto de reaparición.', true); }
    P.hp = Math.min(maxHp(), v.hp);
    // el maná también es del server; si recién gasté/tomé algo local (el aviso todavía viaja), no me pisa para arriba
    const smp = Math.min(maxMp(), v.mp);
    P.mp = now() - mpLocalAt < 0.5 ? Math.min(P.mp, smp) : smp;
}
let lastReportKey = '', mpSpent = 0, mpLocalAt = 0;
/** Maná gastado en un hechizo: lo declaro al server solo si él no lo cobra por su cuenta (curas, hechizos a mobs). */
function spendMp(cost: number, serverCharges: boolean) { P.mp -= cost; mpLocalAt = now(); if (!serverCharges) mpSpent += cost; }
/** Le cuento al server mi vida y maná (curas, pociones, regeneración, meditar): él solo acepta subas razonables. */
function syncHp() {
    const h = Math.round(P.hp); if (P.dead || !connected) return;
    const mp = Math.max(0, Math.round(P.mp)), med = P.med, key = `${h}|${mp}|${med}|${mpSpent}`;
    if (key === lastReportKey) return; lastReportKey = key;
    const spent = Math.round(mpSpent); mpSpent -= spent;
    net.send({ $case: 'hpReport', value: { hp: h, mpSpent: spent, mp, meditating: med } });
}

// ---------- hechizos ----------
type Target = Mob | { x: number; y: number; ground: true } | { x: number; y: number; pvp: Other };
/** Alcance máximo de los hechizos (celdas): la esquina más lejana de la pantalla; igual que VIEW_RANGE del server. */
const VIEW_RANGE = 20;
interface Spell { id?: string; instant?: boolean; /** cast propio (s); sin esto, CAST_T */ castT?: number; ctrl?: boolean; fury?: boolean; key: string; name: string; mp: number; cd: number; col: string; range: number; target: boolean; aoe?: number; cast: (m: Target | null) => false | void }
const isMob = (t: Target | null): t is Mob => !!t && 'hp' in t;
interface SpellDef extends Omit<Spell, 'key'> { ctrl?: boolean }
/** Blink (7 tiles) o Paso de luz (6): celda de destino hacia el cursor (o hacia donde mira), caminable y sin nadie encima. Prueba más cerca si la ideal no sirve. */
function blinkDest(max = 7): Cell | null {
    const from = P.cell; let dx: number, dy: number;
    if (mouse.x >= 0) { const g = toGrid(mouse.x, mouse.y); dx = Math.floor(g.x) - from.x; dy = Math.floor(g.y) - from.y; }
    else { const a = P.ang ?? 0, sx = Math.cos(a), sy = Math.sin(a) * 2, v = GRID_VEC[gridDir((sx + sy) / 2, (sy - sx) / 2)]; dx = v[0] * max; dy = v[1] * max; }
    const len = Math.hypot(dx, dy); if (len < 0.5) return null;
    for (let r = Math.min(max, len); r >= 2; r -= 0.5) {
        const x = from.x + Math.round((dx / len) * r), y = from.y + Math.round((dy / len) * r);
        if (Math.hypot(x - from.x, y - from.y) > max + 0.25 || !freeForMe(x, y) || mobs.some((m) => Math.hypot(m.x - x - 0.5, m.y - y - 0.5) < 0.75)) continue;
        return { x, y };
    }
    return null;
}
const skillSend = (skill: string, targetId = 0n, mobId = 0) => net.send({ $case: 'skillRequest', value: { skill, targetId, mobId } });
/** Aliado elegido para las curas (click en alguien de tu nación): sigue valiendo mientras esté a la vista y no sea enemigo acá. */
const isAlly = (o: Other) => !o.gone && others.has(o.id) && sameSide(o) && !isEnemy(o);
function allyTarget(): Other | null { if (P.ally && !isAlly(P.ally)) P.ally = null; return P.ally; }
/** Cura o bendición: al aliado elegido si está a tiro; si no hay aliado, a vos. */
function healCast(skill: string, range: number): false | void {
    const a = allyTarget();
    if (a && dist(P, a) > range) { toast(`${a.name} está muy lejos.`); return false; }
    skillSend(skill, a ? a.id : 0n);
}
/** Renovar: con el cursor sobre un mob o un enemigo, lo quema; si no, cura en el tiempo al aliado elegido (o a vos). */
function renewCast(): false | void {
    const en = mouse.x >= 0 && !hover ? pickEnemy(mouse.x, mouse.y) : null, foe = hover ?? en;
    if (foe) {
        if (dist(P, foe) > VIEW_RANGE) { toast('Está muy lejos. Acercate más.'); return false; }
        efx('flamme', foe.x, foe.y, 8);
        if (hover) skillSend('renovar', 0n, hover.id); else skillSend('renovar', en!.id);
        return;
    }
    return healCast('renovar', VIEW_RANGE);
}
/** Despertar: al aliado elegido si está caído; si no, al aliado caído más cercano a 10 celdas. */
function reviveCast(): false | void {
    const dead = (o: Other) => !o.gone && facOf(o.profile) === selectedFaction && !isEnemy(o) && o.hp !== undefined && o.hp <= 0;
    let t = P.ally && dead(P.ally) ? P.ally : null;
    if (!t) { let bd = VIEW_RANGE; for (const o of others.values()) if (dead(o) && dist(P, o) <= bd) { bd = dist(P, o); t = o; } }
    if (!t) { toast('No hay ningún aliado caído cerca.'); return false; }
    if (dist(P, t) > VIEW_RANGE) { toast(`${t.name} está muy lejos.`); return false; }
    skillSend('despertar', t.id);
}
const LIB: Record<string, SpellDef> = {
    proyectil: { name: 'Saeta ígnea', mp: 14, cd: 1.5, col: '#ff9a4a', range: VIEW_RANGE, target: true, // Firebolt (Valdrys)
        cast(m) { if (!isMob(m)) return false; const t = totals(), dmg = rint(12, 18) + P.lvl * 2 + t.mag; projs.push({ x: P.x, y: P.y, m, spd: 11, dmg, col: '#b9a3ff' }); } },
    esquirla: { name: 'Esquirla de hielo', mp: 24, cd: 0.8, col: '#9fdcff', range: VIEW_RANGE, target: true, // Ice Shard (Valdrys): frena 3 s, 2× sobre congelado
        cast(m) { if (!isMob(m)) return false; projs.push({ x: P.x, y: P.y, m, spd: 12, dmg: 0, col: '#9fdcff', sid: 'esquirla' }); } },
    ignicion: { name: 'Ignición', mp: 30, cd: 5, col: '#ff6a2a', range: VIEW_RANGE, target: true, instant: true, // Ignite (Valdrys): instantánea + quemadura 3 s
        cast(m) { if (!isMob(m)) return false; efx('aroigneo', m.x, m.y); damageMob(m, 'ignicion'); } },
    nova: { name: 'Nova de escarcha', mp: 60, cd: 8, col: '#bfe8ff', range: 0, target: false, aoe: 3, instant: true, // Ice Blast (Valdrys): congela 2 s alrededor
        cast() { skillSend('nova'); } },
    juicio: { name: 'Juicio', mp: 15, cd: 1.5, col: '#ffe27a', range: 4, target: true, // Smite (Valdrys): se cura la mitad del daño
        cast(m) { if (!isMob(m)) return false; efx('tajo', m.x, m.y, 8); damageMob(m, 'juicio'); } },
    escudo: { name: 'Escudo vengador', mp: 36, cd: 9, col: '#ffd24a', range: 10, target: true, ctrl: true, instant: true, // Avenger's Shield (Valdrys): aturde 3 s
        cast(m) { return control(m, 'escudo', 3, 'Aturdiste', 'El aturdimiento', 'aturde'); } },
    mandato: { name: 'Mandato', mp: 42, cd: 6, col: '#ff7a5a', range: 0, target: false, instant: true, // Righteous Mandate (Valdrys): provoca 7 s
        cast() { skillSend('mandato'); } },
    aura: { name: 'Aura sagrada', mp: 48, cd: 15, col: '#ffe9a0', range: 0, target: false, instant: true, // Sacred Aura (Valdrys): 10 s de pulsos
        cast() { skillSend('aura'); } },
    paralisis: { name: 'Cadenas de hielo', mp: 36, cd: 6, col: '#7fd6ff', range: VIEW_RANGE, target: true, ctrl: true, // Chains of Ice (Valdrys)
        cast(m) { return control(m, 'paralisis', 5, 'Paralizaste', 'La parálisis', 'cadenas'); } },
    aturdir: { name: 'Martillo de justicia', mp: 30, cd: 11, col: '#ffd24a', range: 8, target: true, ctrl: true, instant: true, // Hammer of Justice (Valdrys)
        cast(m) { return control(m, 'aturdir', 3, 'Aturdiste', 'El aturdimiento', 'aturde'); } },
    bola: { name: 'Bola de fuego', mp: 72, cd: 10, col: '#ff8a3d', range: VIEW_RANGE, target: true, // Fireball (Valdrys): un objetivo, 3×
        cast(m) { if (!isMob(m)) return false; const t = totals(), dmg = (rint(14, 21) + P.lvl * 2 + t.mag) * 3; projs.push({ x: P.x, y: P.y, m, spd: 9, dmg, col: '#ff8a3d', sid: 'bola' }); } },
    golpe: { name: 'Golpe brutal', mp: 10, cd: 1, col: '#ffb347', range: 2, target: true, instant: true, // Strike
        cast(m) { if (!isMob(m)) return false; efx('tajobrutal', m.x, m.y); damageMob(m, 'golpe'); } },
    lluvia: { name: 'Infierno', mp: 90, cd: 18, col: '#ff7a2f', range: VIEW_RANGE, target: true, aoe: 4.5, // Inferno (Valdrys)
        cast(m) { if (!m) return false; zone(m.x, m.y, 4.5, 1, 0, () => Math.round((rint(14, 21) + P.lvl * 2 + totals().mag) * 1.2), 'meteoro', 0, 'lluvia'); } },
    remover: { name: 'Purga', mp: 30, cd: 24, col: '#9fe8ff', range: 0, target: false, instant: true, // Remover (D.4): se castea 1,5 s en vos o 1 s en un aliado (castRemoverSpell); saca congelado, aturdido y frenado
        cast() { if (P.frozenUntil <= now() && P.slowEnd <= now()) { toast('No tenés nada que purgar.'); return false; } net.send({ $case: 'removerRequest', value: {} }); } },
    invisibilidad: { name: 'Invisibilidad', mp: 40, cd: 20, col: '#9fb8ff', range: 0, target: false,
        cast() { efx('humo', P.x, P.y); net.send({ $case: 'invisibilityRequest', value: {} }); } },
    detectar: { name: 'Detectar invisible', mp: 30, cd: 12, col: '#ffe9a0', range: 0, target: false,
        cast() { efx('spread', P.x, P.y); net.send({ $case: 'detectInvisibleRequest', value: {} }); } },
    blink: { name: 'Parpadeo', mp: 0, cd: 12, col: '#b9a3ff', range: 0, target: false, instant: true,
        cast() { const d = blinkDest(); if (!d) { toast('No hay lugar para el Blink hacia ahí.'); return false; } net.send({ $case: 'blinkRequest', value: { x: d.x, y: d.y, skill: 'blink' } }); } },
    carga: { name: 'Carga sagrada', mp: 60, cd: 18, col: '#ff9a4a', range: VIEW_RANGE, target: true, instant: true,
        cast(m) { if (!isMob(m)) return false; skillSend('carga', 0n, m.id); } },
    giro: { name: 'Barrido', mp: 36, cd: 8, col: '#ffd0a0', range: 0, target: false, aoe: 2, instant: true,
        cast() { skillSend('giro'); } },
    // K8 (nivel 15 a 26): escudos, auras y bendiciones. El server aplica todo; acá solo se pide.
    grito: { name: 'Bendición de poder', mp: 48, cd: 10, col: '#ffcf5a', range: 0, target: false, aoe: 14, // Blessing of Might (Valdrys): +16 de Daño a la party y a los aliados cerca: 15 min afuera, 60 s en la arena
        cast() { skillSend('grito'); } },
    amparo: { name: 'Bendición de amparo', mp: 48, cd: 10, col: '#a8d8ff', range: 0, target: false, aoe: 14, // Blessing of Sanctuary: −6 % de daño: 15 min afuera, 60 s en la arena
        cast() { skillSend('amparo'); } },
    represalia: { name: 'Aura de represalia', mp: 48, cd: 30, col: '#ff9a6a', range: 0, target: false, instant: true, // Retribution Aura: −20 % de daño y devuelve ⅓ a los monstruos, 10 s
        cast() { skillSend('represalia'); } },
    escudodivino: { name: 'Escudo divino', mp: 45, cd: 20, col: '#ffe9a0', range: 0, target: false, instant: true, // Divine Shield: escudo del 60 % de la vida, 10 s
        cast() { skillSend('escudodivino'); } },
    escudomana: { name: 'Escudo de maná', mp: 45, cd: 10, col: '#9fb8ff', range: 0, target: false, instant: true, // Mana Shield: escudo del 33 % de la vida, 10 s
        cast() { skillSend('escudomana'); } },
    clarividencia: { name: 'Clarividencia', mp: 60, cd: 30, col: '#d0a8ff', range: 0, target: false, instant: true, // Vim of Wisdom: +25 % de crítico de hechizos 10 s (contra monstruos)
        cast() { skillSend('clarividencia'); } },
    intelecto: { name: 'Intelecto arcano', mp: 60, cd: 10, col: '#b9a3ff', range: 0, target: false, aoe: 14, // Arcane Intellect: +8 de Magia a la party y a los aliados cerca: 15 min afuera, 90 s en la arena
        cast() { skillSend('intelecto'); } },
    guardian: { name: 'Escudo guardián', mp: 28, cd: 12, col: '#bfe8ff', range: VIEW_RANGE, target: false, instant: true, // Guardian Shield: escudo del 40 % de la vida del aliado
        cast() { return healCast('guardian', VIEW_RANGE); } },
    esfera: { name: 'Esfera celestial', mp: 34, cd: 8, col: '#fff2a8', range: VIEW_RANGE, target: false, instant: true, // Celestial Sphere: 13 % que salta 8 veces entre aliados
        cast() { return healCast('esfera', VIEW_RANGE); } },
    despertar: { name: 'Despertar', mp: 54, cd: 20, col: '#ffffff', range: 10, target: false, // Reawaken: revive con 50 % (en mazmorra o arena, dentro de los 10 s)
        cast() { return reviveCast(); } },
    grupo: { name: 'Bendición de grupo', mp: 28, cd: 10, col: '#ffb07a', range: 0, target: false, aoe: 14, // Fortitude + Divine Spirit: +6 % de vida y +50 % de regen de maná: 15 min afuera, 90 s en la arena (a toda la party)
        cast() { skillSend('grupo'); } },
    pasoluz: { name: 'Paso de luz', mp: 0, cd: 15, col: '#fff2a8', range: 0, target: false, instant: true, // escape del clérigo (nivel 20): hasta 6 celdas y se saca el frenado
        cast() { const d = blinkDest(6); if (!d) { toast('No hay lugar para el Paso de luz hacia ahí.'); return false; } net.send({ $case: 'blinkRequest', value: { x: d.x, y: d.y, skill: 'pasoluz' } }); } },
    aliento: { name: 'Segundo aliento', mp: 0, cd: 210, col: '#7fe0a0', range: 0, target: false, instant: true, // Second Wind (Valdrys): 3 s quieto, la mitad de vida y maná
        cast() { if (P.hp >= maxHp() && P.mp >= maxMp()) { toast('Ya tenés la vida y el maná llenos.'); return false; } P.path = []; P.target = null; P.engage = false; P.pickup = null; P.queued = null; cancelCast(); skillSend('aliento'); } },
    // Clérigo (K5): el server cura, cobra y valida. Las curas van al aliado elegido (click en alguien de tu nación) o a vos.
    castigo: { name: 'Castigo', mp: 18, cd: 1, col: '#ffe680', range: VIEW_RANGE, target: true, // Smite (Valdrys): devuelve 9 de maná y te cura el 35 % del daño
        cast(m) { if (!isMob(m)) return false; efx('solar', m.x, m.y, 8); damageMob(m, 'castigo'); } },
    reprender: { name: 'Reprender', mp: 30, cd: 15, col: '#fff2a8', range: VIEW_RANGE, target: true, ctrl: true, instant: true, // Chastise (Valdrys): aturde 3 s
        cast(m) { return control(m, 'reprender', 3, 'Aturdiste', 'El aturdimiento', 'solar'); } },
    curacion: { name: 'Curación', mp: 48, cd: 5, col: '#8af0a8', range: VIEW_RANGE, target: false, // Generous Heal (Valdrys): 40 % de la vida
        cast() { return healCast('curacion', VIEW_RANGE); } },
    renovar: { name: 'Renovar', mp: 26, cd: 3, col: '#b8f5a0', range: VIEW_RANGE, target: false, instant: true, // Renew (Valdrys): cura en 6 s; con el cursor sobre un enemigo, lo quema
        cast() { return renewCast(); } },
    bendicion: { name: 'Bendición sagrada', mp: 30, cd: 20, col: '#ffe9a0', range: VIEW_RANGE, target: false, instant: true, // Holy Blessing (Valdrys): 10 s
        cast() { return healCast('bendicion', VIEW_RANGE); } },
    novasagrada: { name: 'Nova sagrada', mp: 36, cd: 6, col: '#fff0b0', range: 0, target: false, aoe: 4.5, instant: true, // Holy Nova (Valdrys)
        cast() { skillSend('novasagrada'); } },
    orbe: { name: 'Orbe sagrado', mp: 56, cd: 10, col: '#a8ffd0', range: VIEW_RANGE, target: false, // Holy Orb (Valdrys): 20 % al objetivo y a los de al lado
        cast() { return healCast('orbe', VIEW_RANGE); } },
    furia: { name: 'Furia', mp: 15, cd: 90, col: '#ffd23f', range: 0, target: false,
        cast() { sfx('berserk', 0.7); efxLocal('pilar', P.x, P.y); pvpSend('pilar', P.x, P.y, 0n, 'furia'); P.fury = now() + 60; float(P.x, P.y - 0.4, '¡FURIA!', '#ffd23f', true); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#ffd23f' }); log(`Furia: +${selectedClass === 'mago' ? 35 : selectedClass === 'clerigo' ? 20 : 15}% de daño por 60 s.`, true); } },
};
let SPELLS: Spell[] = [];
const SPECIAL_KEY: Record<string, string | undefined> = { remover: 'r', invisibilidad: 'f', detectar: 'g', blink: 'b', carga: 'z', giro: 'x', grito: 'v', aliento: 'y', despertar: 'u', pasoluz: 'b' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
/** Hechizo de área estilo Blizzard: varios golpes sobre las celdas cercanas al punto elegido. */
function zone(x: number, y: number, r: number, ticks: number, every: number, dmg: () => number, effect: string, slow = 0, sid = '') {
    for (let i = 0; i < ticks; i++) later(i * every, () => {
        if (P.dead) return;
        if (effect === 'blizz') { if (i === 0) { fx.push({ k: 'blizz', x, y, t: 0, r, d: ticks * every + 0.5 }); pvpSend('blizz', x, y, 0n, '', 0, r); } } else if (i === 0 || effect === 'cataclysm') efx(effect, x, y);
        if (!reduce && i === 0) shake = Math.max(shake, 0.15);
        for (const o of enemiesNear(x, y, r)) { if (sid) { pvpSend('', x, y, o.id, sid, slow && i === ticks - 1 ? slow : 0, r); } }
        for (const m of byDistance(mobs, x, y)) if (Math.hypot(m.x - x, m.y - y) <= r && !isSafe(m.x, m.y)) damageMob(m, sid, slow && m.imm <= now() && i === ticks - 1 ? slow : 0);
    });
}
function control(m: Target | null, spell: string, secs: number, verb: string, noun: string, eff = 'stop'): false | void {
    if (!isMob(m)) return false;
    if (m.imm > now()) { log(`${m.name} es inmune al control por unos segundos.`); return false; }
    efx(eff, m.x, m.y); net.send({ $case: 'mobHitRequest', value: { mobId: m.id, dmg: 0, melee: false, crit: false, parSecs: secs, poisonSecs: 0, spell } });
    fx.push({ k: 'ring', x: m.x, y: m.y, t: 0, c: '#7fd6ff' }); log(`${verb} a ${m.name} por ${secs} s. ${noun} se rompe si lo golpean fuerte.`, true);
}
const cds = [0, 0, 0, 0, 0, 0];
const alive = (m: Mob | null): m is Mob => !!m && m.hp > 0 && mobs.includes(m);
function autoTarget(range: number) {
    if (alive(P.target)) return P.target;
    if (alive(hover)) return hover;
    let best: Mob | null = null, bd = range;
    for (const m of mobs) { if (isSafe(m.x, m.y)) continue; const d = dist(P, m); if (d <= bd) { bd = d; best = m; } }
    return best;
}
// ---------- pociones de vida y maná ----------
const pots = { hp: 3, mp: 3, cd: 0, total: 1 };
/**
 * Bloqueo compartido entre pociones (vida o maná), aparte de la recarga de los hechizos: 1 min en PvE y 10 s peleando contra jugadores (K6).
 * Lo decide el server y llega en AbilityState('pocion'); acá solo se frena el doble toque hasta que responda. Vida: 20 % al instante y el resto en 4 ticks de 0,5 s.
 */
const POTION_TAP_GUARD = 0.5, POT_HOT_TICKS = 4, POT_HOT_EVERY = 0.5;
let potEpoch = 0;
function usePotion(k: 'hp' | 'mp') {
    if (P.dead) return;
    if (pots[k] < 1) { toast(`No tenés ${POTS[k].name.toLowerCase()}s. Comprá en el Mercader.`); return; }
    if (pots.cd > now()) { if (pots.cd - now() > POTION_TAP_GUARD) toast(`Pociones: faltan ${Math.ceil(pots.cd - now())} s.`); return; }
    if (k === 'hp' ? P.hp >= maxHp() : P.mp >= maxMp()) { toast(k === 'hp' ? 'Ya tenés la vida llena.' : 'Ya tenés el maná lleno.'); return; }
    if (connected) { pots.cd = now() + POTION_TAP_GUARD; pots.total = POTION_TAP_GUARD; } else { pots.cd = now() + 60; pots.total = 60; } // conectado, el bloqueo real llega del server
    const epoch = ++potEpoch, local = !connected; // conectado: la vida y el maná los cura el server (llegan en Vitals); sin server curo yo
    if (connected) net.send({ $case: 'potionRequest', value: { kind: k === 'hp' ? 0 : 1 } });
    if (k === 'hp') {
        const total = Math.max(50, Math.round(maxHp() * 0.4)), first = Math.round(total * 0.2), rest = total - first, tick = Math.floor(rest / POT_HOT_TICKS);
        const heal = (n: number) => { if (local) P.hp = Math.min(maxHp(), P.hp + n); };
        heal(first); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#e0524a' });
        for (let i = 1; i <= POT_HOT_TICKS; i++) later(i * POT_HOT_EVERY, () => { if (!P.dead && epoch === potEpoch) heal(i === POT_HOT_TICKS ? rest - tick * (POT_HOT_TICKS - 1) : tick); }); // muerto o revivido: se corta
    } else { const m = Math.max(40, Math.round(maxMp() * 0.5)); if (local) { P.mp = Math.min(maxMp(), P.mp + m); mpLocalAt = now(); } float(P.x, P.y - 0.2, '+' + m + ' maná', '#7fb7ff'); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#4a8fe0' }); }
    syncHp(); efx('sphere', P.x, P.y); renderPots();
}
/** Segundo aliento: canal en curso según el server (en segundos de `now()`). */
let wind: { start: number; end: number } | null = null;
/** AbilityState del server (K6): bloqueo de pociones y Segundo aliento (canal, recarga y por qué se cortó). */
function onAbilityState(v: { id: string; channeling: boolean; channelMs: number; remainingMs: number; cooldownMs: number; cooldownTotalMs: number; reason: string }) {
    const T = now();
    if (v.id === 'pocion') { pots.cd = T + v.cooldownMs / 1000; pots.total = Math.max(0.1, v.cooldownTotalMs / 1000); potCdTick(); return; }
    if (v.id !== 'aliento') return;
    const i = SPELLS.findIndex((x) => x.id === 'aliento');
    if (v.channeling) { const len = v.channelMs / 1000; wind = { start: T - (len - v.remainingMs / 1000), end: T + v.remainingMs / 1000 }; if (i >= 0) cds[i] = 0; return; }
    const was = !!wind; wind = null;
    if (i >= 0) cds[i] = T + v.cooldownMs / 1000;
    if (v.reason) { toast(v.reason); log(esc(v.reason), true); }
    else if (was && v.cooldownMs > 0) log('Segundo aliento: recuperaste vida y maná.', true);
}
/** Barra verde sobre el personaje mientras canaliza el Segundo aliento. */
function drawWind(T: number) {
    if (!wind) return;
    const k = clamp((T - wind.start) / Math.max(0.01, wind.end - wind.start), 0, 1), p = iso(P.x, P.y), w = 76, y = p.y - 92;
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - w / 2 - 2, y - 2, w + 4, 9);
    ctx.fillStyle = '#14402a'; ctx.fillRect(p.x - w / 2, y, w, 5);
    ctx.fillStyle = '#7fe0a0'; ctx.fillRect(p.x - w / 2, y, w * k, 5);
    nameTag(`Segundo aliento ${Math.max(0, wind.end - T).toFixed(1)} s`, p.x, y - 5, '#c8f5d8', 1, 10);
}
/** Overlay del delay global sobre los chips de pociones (Q/E) y sus slots en la bolsa. */
function potCdTick() {
    const left = Math.max(0, pots.cd - now()), t = left <= 0 ? '' : left >= 10 ? String(Math.ceil(left)) : left.toFixed(1);
    document.querySelectorAll<HTMLElement>('.cdv[data-gcd]').forEach((el) => {
        if (left > 0) { el.style.display = 'flex'; el.style.background = `conic-gradient(rgba(0,0,0,0) 0 ${(1 - left / Math.max(0.1, pots.total)) * 100}%, rgba(5,3,8,.74) 0 100%)`; if (el.textContent !== t) el.textContent = t; }
        else if (el.style.display) { el.style.display = ''; el.textContent = ''; }
    });
}
($('goldIco') as HTMLImageElement).src = coinIcon();
function renderPots() { for (const k of ['hp', 'mp'] as const) { const el = $('pot' + k); el.title = `${POTS[k].name} (${POTS[k].key}): quedan ${pots[k]}`; el.setAttribute('aria-label', `${POTS[k].name}, tecla ${POTS[k].key}, quedan ${pots[k]}`); el.classList.toggle('none', pots[k] <= 0); el.innerHTML = `<span class="sq"><img alt="" src="${potionIcon(k)}"></span><kbd>${POTS[k].key}</kbd><em>${pots[k]}</em><i class="cdv" data-gcd></i>`; } potCdTick(); }
// ---------- Volver a la ciudad (recall, tecla H): el server lleva el canal de 8 s, lo corta y hace el viaje; acá solo se pide y se muestra ----------
const RECALL_COL = '#4aa8ff';
/** Canal en curso según el server (en segundos de `now()`), y fin del enfriamiento. */
let recall: { start: number; end: number } | null = null, recallCdEnd = 0;
function toggleRecall() {
    if (!connected || mapLoading) return;
    if (recall) { net.send({ $case: 'recallRequest', value: { cancel: true } }); return; }
    if (P.dead) { toast('No podés volver a la ciudad muerto.'); return; }
    const cd = recallCdEnd - now();
    if (cd > 0) { toast(`Volver a la ciudad: faltan ${Math.ceil(cd)} s.`); return; }
    // quieto: el server corta el canal apenas recibe un paso, un ataque o un hechizo
    P.path = []; P.target = null; P.engage = false; P.pickup = null; P.queued = null; cancelCast(); closeWp();
    net.send({ $case: 'recallRequest', value: { cancel: false } });
}
function onRecallState(v: { state: number; channelMs: number; remainingMs: number; cooldownMs: number; reason: string }) {
    const T = now();
    if (v.state === 1) { const len = (v.channelMs || RECALL.channelMs) / 1000; recall = { start: T - (len - v.remainingMs / 1000), end: T + v.remainingMs / 1000 }; log('Volviendo a la ciudad… (no te muevas: se corta si te pegan, atacás o lanzás algo)', true); }
    else {
        const was = !!recall; recall = null;
        recallCdEnd = T + v.cooldownMs / 1000;
        if (v.reason) { toast(v.reason); log(esc(v.reason), true); }
        else if (was && v.cooldownMs > 0) log('Volvés a la ciudad.', true);
    }
    renderRecall();
}
function renderRecall() {
    const el = $('recallBtn');
    el.innerHTML = `<span class="sq"><img alt="" src="${spellIcon('recall', RECALL_COL)}"></span><kbd>H</kbd><i class="cdv" id="recallCd"></i>`;
    recallTick();
}
function recallTick() {
    const el = $('recallBtn'), cdEl = document.getElementById('recallCd'); if (!cdEl) return;
    el.classList.toggle('on', !!recall);
    const left = Math.max(0, recallCdEnd - now()), t = left > 0 ? String(Math.ceil(left)) : '';
    if (left > 0 && !recall) { cdEl.style.display = 'flex'; cdEl.style.background = `conic-gradient(rgba(0,0,0,0) 0 ${(1 - left / (RECALL.cooldownMs / 1000)) * 100}%, rgba(5,3,8,.74) 0 100%)`; if (cdEl.textContent !== t) cdEl.textContent = t; }
    else if (cdEl.style.display) { cdEl.style.display = ''; cdEl.textContent = ''; }
    const tip = recall ? 'Volviendo a la ciudad… (H para cancelar)' : left > 0 ? `Volver a la ciudad (H): faltan ${Math.ceil(left)} s` : 'Volver a la ciudad (H)';
    if (el.title !== tip) el.title = tip;
}
const recallK = (T: number) => (recall ? clamp((T - recall.start) / (recall.end - recall.start), 0, 1) : 0);
/** Barra sobre el personaje y remolino azul en el piso mientras canaliza. */
function drawRecall(T: number) {
    if (!recall) return;
    const k = recallK(T), p = iso(P.x, P.y);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) { const a = T * 3 + (i * Math.PI * 2) / 3; ctx.strokeStyle = `rgba(90,170,255,${0.45 - i * 0.1})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(p.x, p.y, 26 + i * 6, 13 + i * 3, 0, a, a + 2.2); ctx.stroke(); }
    const g = ctx.createRadialGradient(p.x, p.y - 30, 0, p.x, p.y - 30, 30 + k * 16); g.addColorStop(0, `rgba(200,230,255,${0.25 + k * 0.35})`); g.addColorStop(1, 'rgba(40,120,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 30, 30 + k * 16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const w = 76, y = p.y - 92;
    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - w / 2 - 2, y - 2, w + 4, 9);
    ctx.fillStyle = '#123a66'; ctx.fillRect(p.x - w / 2, y, w, 5);
    ctx.fillStyle = RECALL_COL; ctx.fillRect(p.x - w / 2, y, w * k, 5);
    nameTag(`Volviendo a la ciudad ${Math.max(0, recall.end - T).toFixed(1)} s`, p.x, y - 5, '#bfe0ff', 1, 10);
}
$('recallBtn').addEventListener('click', () => { toggleRecall(); cv.focus({ preventScroll: true }); });
renderRecall();
// ---------- /meditar: quieto, el maná sube rápido; se corta si te movés, casteás o te pegan ----------
function stopMeditating(msg?: string) { if (!P.med) return; P.med = false; if (msg) log(msg, true); syncHp(); }
function toggleMeditate() {
    if (P.med) { stopMeditating('Dejaste de meditar.'); return; }
    if (P.dead || P.casting || P.mv || P.path.length) { log('Tenés que estar quieto para meditar.', true); return; }
    if (P.mp >= maxMp()) { log('Ya tenés el maná lleno.', true); return; }
    P.med = true; P.medHp = P.hp; syncHp(); log('Meditás… el maná sube rápido mientras estés quieto. (/meditar de nuevo para cortar)', true);
}
function nearestEnemy(range: number) { let b: Other | null = null, bd = range; for (const o of others.values()) { if (!isEnemy(o)) continue; const d = dist(P, o); if (d <= bd) { bd = d; b = o; } } return b; }
/** Alguien de tu nación bajo el cursor (para elegirlo como objetivo de curas). */
// ---------- objetivo de foco: una segunda marca que no se pierde al cambiar de objetivo ----------
// Shift+clic sobre un mob, un aliado o un jugador enemigo lo fija (de nuevo sobre el mismo, lo suelta); Tab pasa a él.
type Focus = { k: 'mob'; m: Mob } | { k: 'player'; o: Other };
let focus: Focus | null = null;
/** El foco que sigue existiendo (mob vivo en el mapa, o jugador que sigue visible); si no, se suelta solo. */
function focusNow(): Focus | null {
    if (focus?.k === 'mob' && !alive(focus.m)) focus = null;
    else if (focus?.k === 'player' && (!others.has(focus.o.id) || focus.o.gone)) focus = null;
    return focus;
}
function toggleFocus(m: Mob | null, o: Other | null) {
    const cur = focusNow();
    if (m ? cur?.k === 'mob' && cur.m === m : o ? cur?.k === 'player' && cur.o === o : false) { focus = null; toast('Foco suelto.'); return; }
    if (m) focus = { k: 'mob', m }; else if (o) focus = { k: 'player', o }; else return;
    toast(`Foco: ${m ? m.name : o!.name}. Tab para pasar a él.`);
}
/** Tab: el foco pasa a ser el objetivo (mob), el blanco de las curas (aliado) o el enemigo al que apuntan los hechizos (jugador enemigo). */
function focusToTarget() {
    const f = focusNow(); if (!f) { toast('No tenés ningún foco: Shift+clic sobre un mob o un jugador.'); return; }
    if (f.k === 'mob') { cancelCast(); P.target = f.m; P.engage = false; P.pickup = null; P.foe = null; }
    else if (isAlly(f.o)) { P.ally = f.o; toast(`Curás a ${f.o.name}.`); }
    else if (isEnemy(f.o)) { P.target = null; P.engage = false; P.foe = f.o; }
}
function pickAlly(sx: number, sy: number) { for (const o of others.values()) { if (!isAlly(o)) continue; const p = toScreen(o.x, o.y); if (Math.abs(sx - p.x) < 24 * Z && sy > p.y - 76 * Z && sy < p.y + 12 * Z) return o; } return null; }
function pickEnemy(sx: number, sy: number) { for (const o of others.values()) { if (!isEnemy(o)) continue; const p = toScreen(o.x, o.y); if (Math.abs(sx - p.x) < 24 * Z && sy > p.y - 76 * Z && sy < p.y + 12 * Z) return o; } return null; }
const CAST_T = 1.408; // casteo único para todos los hechizos (16 cuadros × 88 ms, como el cliente de referencia); el server valida el mismo valor (castMsOf)
function cast(i: number) {
    if (P.dead) return; const s = SPELLS[i];
    const kit = checkSkill(CLS.id, P.lvl, s.id ?? ''); // kit de clase (paso K1): el server rechaza igual, acá solo se avisa
    if (!kit.ok) { toast(skillDeniedText(kit)); return; }
    if (P.ready && P.ready.i === i && s.target) { const m = autoTarget(s.range), e = m ? null : nearestEnemy(s.range); if (m) release(m); else if (e) release({ x: e.x, y: e.y, pvp: e }); else toast('Hacé clic en el objetivo.'); return; }
    if (s.fury && P.fury <= now()) { toast(`${s.name} solo se puede usar con Furia.`); return; }
    if (P.casting && !s.instant) { toast('Ya estás casteando.'); return; }
    if (cds[i] > now()) { toast(`${s.name} se está recargando.`); return; }
    if (P.mp < s.mp) { toast('No te alcanza el maná.'); return; }
    if (s.id === 'remover') { castRemoverSpell(i); return; }
    if (s.instant) { instantCast(i); return; }
    P.ready = null; P.engage = false; P.queued = null; P.path = []; holding = false;
    const T = now(), len = s.castT ?? CAST_T; P.casting = { i, start: T, end: T + len, len };
    const ty = spellTypeOf(s.id);
    useCastStore.getState().startCast(s.name, len * 1000, ty, spellIcon(s.id ?? '', s.col)); castBarOf = P.casting; // antes de avisar al server
    combatText.showCastingSpell(P.x, P.y, s.name, ty); // predicción local, antes de avisar al server
    net.send({ $case: 'spellCastStartRequest', value: { spellId: 0, spell: s.id ?? '' } }); // el server cuenta el cast time desde acá
}
/** Remover (D.4): se castea 1,5 s sobre uno mismo (también paralizado) o 1 s sobre el aliado elegido. Los tiempos son solo para dibujar la barra: el server los cuenta y aplica el efecto. */
const REMOVER_SELF_S = 1.5, REMOVER_OTHER_S = 1.0, REMOVER_RANGE = 6;
function castRemoverSpell(i: number) {
    const s = SPELLS[i], al = allyTarget(), mine = P.frozenUntil > now() || P.slowEnd > now();
    const other = !mine && al && dist(P, al) <= REMOVER_RANGE ? al : null;
    if (!mine && !other) { toast(al ? 'Está muy lejos.' : 'No tenés nada que purgar.'); return; }
    P.ready = null; P.engage = false; P.queued = null; P.path = []; holding = false;
    const T = now(), len = other ? REMOVER_OTHER_S : REMOVER_SELF_S;
    P.casting = { i, start: T, end: T + len, len };
    useCastStore.getState().startCast(s.name, len * 1000, spellTypeOf(s.id), spellIcon(s.id ?? '', s.col)); castBarOf = P.casting;
    net.send({ $case: 'removerRequest', value: { targetId: other ? other.id : 0n } });
}
/** Habilidades de clase sin casteo: salen al instante (las de objetivo toman el seleccionado, el del cursor o el enemigo más cercano). */
function instantCast(i: number) {
    const s = SPELLS[i];
    if (P.frozenUntil > now()) { toast('Estás paralizado.'); return; }
    cancelCast(); P.queued = null;
    if (!s.target) { fire(i, null); return; }
    const m = autoTarget(s.range), e = m ? null : P.foe && isEnemy(P.foe) ? P.foe : nearestEnemy(s.range), t = m ?? e;
    if (!t) { toast('Elegí un objetivo: click en un mob o enemigo cerca.'); return; }
    if (dist(P, t) > s.range) { toast('Está muy lejos. Acercate más.'); return; }
    turnTo(P, t.x - P.x, t.y - P.y, 0, true); sendFacing();
    fire(i, m ?? { x: e!.x, y: e!.y, pvp: e! });
}
function finishCast() {
    const c = P.casting!, s = SPELLS[c.i]; P.casting = null; useCastStore.getState().cancelCast(); castBarOf = null;
    if (s.id === 'remover') { cds[c.i] = now() + s.cd; return; } // el efecto lo aplica el server
    if (!s.target) { fire(c.i, null); return; }
    P.ready = { i: c.i, t: now() };
}
function release(target: Mob | { x: number; y: number; pvp?: Other }) {
    const r = P.ready!, s = SPELLS[r.i];
    const m = 'hp' in target ? (target as Mob) : null;
    if (Math.hypot(target.x - P.x, target.y - P.y) > s.range) { toast('Está muy lejos. Acercate más.'); return false; }
    if (m && s.ctrl && m.imm > now()) { toast(`${m.name} es inmune al control por unos segundos.`); return false; }
    if (P.mp < s.mp) { toast('No te alcanza el maná.'); P.ready = null; return false; }
    P.ready = null; if (m) P.target = m;
    turnTo(P, target.x - P.x, target.y - P.y, 0, true); sendFacing();
    const pv = (target as { pvp?: Other }).pvp;
    fire(r.i, m || (pv ? { x: target.x, y: target.y, pvp: pv } : { x: target.x, y: target.y, ground: true }));
    return true;
}
/** Hechizos de daño o control que el server cobra al pegar (a mobs o a jugadores): el cliente no reporta su maná gastado. */
const SERVER_MP_SPELLS = new Set(['proyectil', 'esquirla', 'paralisis', 'ignicion', 'aturdir', 'golpe', 'juicio', 'escudo', 'bola', 'lluvia', 'castigo', 'reprender', 'curacion', 'renovar', 'bendicion', 'novasagrada', 'orbe']);
function fire(i: number, m: Target | null) {
    const s = SPELLS[i];
    if (m && 'pvp' in m && !s.aoe) { if (!pvpCast(s.id, (m as { pvp: Other }).pvp)) return; } else if (s.cast(m) === false) return;
    const srvMp = SERVER_MP_SPELLS.has(s.id ?? '') || ['furia', 'invisibilidad', 'detectar', 'remover', 'blink', 'carga', 'giro', 'grito', 'nova', 'mandato', 'aura', 'aliento', 'amparo', 'represalia', 'escudodivino', 'escudomana', 'clarividencia', 'intelecto', 'guardian', 'esfera', 'despertar', 'grupo', 'pasoluz'].includes(s.id ?? '') || (m && 'pvp' in m && !s.aoe)
        || (!!s.aoe && enemiesNear(m ? m.x : P.x, m ? m.y : P.y, s.aoe + 0.5).length > 0); // si pega a un jugador, el server cobra
    spendMp(s.mp, srvMp); syncHp(); cds[i] = now() + s.cd;
    P.one = { anim: 'cast', t: now() - 0.3, until: now() + 0.12 };
    fx.push({ k: 'burst', x: P.x, y: P.y, t: 0, c: s.col }); fx.push({ k: 'boom', x: P.x, y: P.y, t: 0, r: 1.1, c: s.col });
    const b = $('sp' + i); b.classList.remove('fired'); void b.offsetWidth; b.classList.add('fired');
}
function cancelCast(why?: string | null) { if (!P.casting && !P.ready) return; P.casting = null; useCastStore.getState().cancelCast(); castBarOf = null; P.ready = null; net.send({ $case: 'spellCastCancelRequest', value: {} }); if (why) toast(why); }
/** Walk (castea, 333 ms/celda) o run (no castea, 200 ms/celda). La velocidad la manda el server en playerMovementStateChanged. */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 1600); }

// ---------- assets ----------
interface Anim { row: number; n: number; dur: number; type: string }
/** `s` (solo en las hojas a tamaño nativo) = píxeles de atlas por píxel de geometría; se divide al dibujar, así el sprite ocupa lo mismo en pantalla con el doble de detalle. */
interface SpriteMeta { sc?: number; hum?: boolean; s?: number; cw: number; ch: number; ax: number; ay: number; anims: Record<string, Anim> }
const SPR: Record<string, SpriteMeta> = {};
let WORLD: Record<string, number[]> = {};
const IMG: Record<string, CanvasImageSource> = {};
// Efectos TOMAS (Miradin, CC-BY-SA) horneados a cuadros; se dibujan en aditivo. Si no cargan, el juego sigue con los efectos simples.
let FXM: { cell: number; frames: number; rows: Record<string, { row: number; fps: number; scale: number; img?: string; /** cuadros del efecto (atlas privado): dura n/fps */ n?: number }> } | null = null;
/** Efectos del atlas privado (fx_priv, fuera de git por licencia) y con qué se reemplazan si no está. */
const FX_FALLBACK: Record<string, string> = {
    pilar: 'flamme', tajo: 'crosswind', bendicion: 'sphere',
    // packs "Pixel Art VFX" de Frostwindz (tools/src/fx/private_packs.py)
    chispa: 'splash', estallido: 'eruption', meteoro: 'cataclysm', aroigneo: 'flamme', explosion: 'eruption', escarcha: 'splash', picos: 'spread',
    cadenas: 'stop', estrella: 'spread', fugaz: 'sphere', cupula: 'sphere', humo: 'splash', polvo: 'cyclone', polvareda: 'crosswind', aturde: 'turbulence',
    rafaga: 'crosswind', tajobrutal: 'crosswind', provocar: 'godsbreath', represalia: 'flamme',
    // packs "Magic Buff Effects" y "10 Magic Sprite Sheet Effects" de Craftpix (mismo script)
    curar: 'sphere', mana: 'sphere', revivir: 'godsbreath', inmune: 'spread', poder: 'godsbreath', maldicion: 'spread', solar: 'crosswind', solargrande: 'spread', anillo: 'sphere', bolafuego: 'splash',
};
/** Efectos que no tienen reemplazo: sin el atlas privado no se dibuja nada (golpes cuerpo a cuerpo, jefes). */
const efxLocal = (n: string, x: number, y: number, dy = 0) => { const k = FXM?.rows[n] ? n : FX_FALLBACK[n]; const r = k ? FXM?.rows[k] : undefined; if (k && r) fx.push({ k: 'efx', n: k, x, y, t: 0, dy, d: r.n ? r.n / r.fps : undefined }); };
/** Efecto de mis hechizos: lo veo yo y los jugadores cercanos. */
const efx = (n: string, x: number, y: number, dy = 0) => { efxLocal(n, x, y, dy); if (connected) pvpSend(n, x, y); };
// ---------- PvP: bandos enemigos (y todos contra todos en la arena) ----------
const inArena = (x: number, y: number) => !!MAP_DEF.ffaRect && inMapRect(MAP_DEF.ffaRect, Math.floor(x), Math.floor(y));
/** Región de PvP donde estoy (D.5): solo se dibuja y se apunta con esto; el server decide con la posición que tiene de cada uno. */
const regionAt = (x: number, y: number) => pvpRegionAt(MAP_DEF, isSafe(x, y), x, y);
const inRed = (x: number, y: number) => regionAt(x, y) === 'roja';
/** Cartel al entrar o salir de la zona roja de un mapa de naciones. `null` = recién entré al mapa (no avisa). */
let lastRed: boolean | null = null;
function trackRedZone() {
    if (MAP_DEF.pvp !== 'faction' || !MAP_DEF.redRects) { lastRed = null; return; }
    const red = inRed(P.x, P.y);
    if (lastRed !== null && red !== lastRed) toast(red ? '⚔ Entrás a la zona roja: acá hay PvP con la otra nación.' : 'Salís de la zona roja: acá no hay PvP.');
    lastRed = red;
}
const facOf = (profile: string) => profile.split(';')[0];
/** Arenas 2v2 / 3v3 (`/arena`): el equipo es la party; el resto es rival aunque sea de tu nación. El server decide igual (y no deja pegar en la preparación). */
const onArenaMap = () => MAP_DEF.region === 'arena';
const teammate = (o: Other) => partyRows.has(o.name);
const sameSide = (o: Other) => (onArenaMap() ? teammate(o) : facOf(o.profile) === selectedFaction);
const unseen = (o: Other) => !!o.inv && !P.det && !sameSide(o);
const isEnemy = (o: Other) => MAP_DEF.pvp !== 'off' && !o.gone && !unseen(o) && inRed(o.x, o.y) && inRed(P.x, P.y) && (onArenaMap() ? !teammate(o) : MAP_DEF.pvp === 'ffa' || facOf(o.profile) !== selectedFaction || (inArena(P.x, P.y) && inArena(o.x, o.y)));
const enemiesNear = (x: number, y: number, r: number) => [...others.values()].filter((o) => isEnemy(o) && Math.hypot(o.x - x, o.y - y) <= r);
/** Avisa al server qué hechizo lancé y sobre quién; el daño lo calcula el server (el campo dmg ya no se usa). */
function pvpSend(fx: string, x: number, y: number, targetId = 0n, spell = '', secs = 0, r = 0) { net.send({ $case: 'pvpHitRequest', value: { fx, x, y, targetId, dmg: 0, secs, r, spell } }); }
/** Le pega a un jugador enemigo: el server calcula el daño y el cliente de él lo aplica. `secs` > 0 pide la parálisis del hechizo. */
function pvpDamage(o: Other, spell: string, fxName: string, secs = 0) {
    if (fxName) efxLocal(fxName, o.x, o.y, 8);
    pvpSend(fxName, o.x, o.y, o.id, spell, secs);
}
/** Velocidad conocida del blanco: la última foto que mandó el server (si es reciente) y la anterior. */
function enemyVelocity(o: Other, T: number): { x: number; y: number; vx: number; vy: number } {
    const b = o.buf, n = b.length;
    if (n < 2 || T - b[n - 1].t > 0.25) return { x: n ? b[n - 1].x : o.x, y: n ? b[n - 1].y : o.y, vx: 0, vy: 0 };
    const a = b[n - 2], c = b[n - 1], dt = Math.max(0.03, c.t - a.t);
    return { x: c.x, y: c.y, vx: (c.x - a.x) / dt, vy: (c.y - a.y) / dt };
}
/**
 * Proyectil esquivable: se apunta adelantado a donde va a estar el blanco (anticipación lineal), vuela a velocidad fija y el server
 * decide el impacto al llegar. Si el blanco cambia de rumbo, erra: de eso se trata caderear.
 */
function launchProjectile(spell: string, o: Other, fxName: string): boolean {
    const T = now(), e = enemyVelocity(o, T), lag = 0.05; // lag: lo que tarda en llegar al server lo que veo
    const a = leadAim(spell, P.x, P.y, e.x + e.vx * lag, e.y + e.vy * lag, e.vx, e.vy);
    const ms = projectileFlightMs(spell, P.x, P.y, a.x, a.y);
    net.send({ $case: 'projectileLaunchRequest', value: { spell, targetId: o.id, aimX: a.x, aimY: a.y } });
    if (arrows.length < 80) arrows.push({ x0: P.x, y0: P.y, x1: a.x, y1: a.y, t0: T, dur: ms / 1000, kind: spell === 'bola' ? 3 : 2 });
    later(ms / 1000, () => efxLocal(fxName, a.x, a.y, 8)); // el impacto se ve donde se apuntó (errar = cae al piso)
    return true;
}
/** Hechizos de un solo objetivo contra un jugador. */
function pvpCast(id: string | undefined, o: Other): boolean {
    switch (id) {
        case 'proyectil': return launchProjectile('proyectil', o, 'splash');
        case 'paralisis': pvpDamage(o, 'paralisis', 'stop', 3); return true;
        case 'aturdir': pvpDamage(o, 'aturdir', 'turbulence', 3); return true;
        case 'esquirla': later(dist(P, o) / 12, () => { if (isEnemy(o)) pvpDamage(o, 'esquirla', 'blizz'); }); return true;
        case 'ignicion': pvpDamage(o, 'ignicion', 'flamme'); return true;
        case 'juicio': pvpDamage(o, 'juicio', 'tajo'); return true;
        case 'escudo': pvpDamage(o, 'escudo', 'turbulence', 3); return true;
        case 'bola': return launchProjectile('bola', o, 'eruption');
        case 'golpe': pvpDamage(o, 'golpe', 'crosswind'); return true;
        case 'carga': skillSend('carga', o.id); return true;
        case 'castigo': pvpDamage(o, 'castigo', 'crosswind'); return true;
        case 'reprender': pvpDamage(o, 'reprender', 'turbulence', 3); return true;
        default: return false;
    }
}
/** Versión de los atlas (hash de meta.json): evita que el navegador mezcle un meta nuevo con un .webp viejo en caché, que dejaba huecos en el piso. */
let ASSET_V = '';
const load = (src: string) => new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = ASSET_V && src.startsWith('assets/') ? `${src}?v=${ASSET_V}` : src; });
const off = document.createElement('canvas'), octx = off.getContext('2d')!;
function frameIndex(A: Anim, t: number) {
    const fd = A.dur / A.n / 1000, k = Math.max(0, Math.floor(t / fd));
    if (A.type === 'looped') return k % A.n;
    if (A.type === 'back_forth') { const L = 2 * A.n - 2; const j = k % L; return j < A.n ? j : L - j; }
    return Math.min(A.n - 1, k);
}
const SS = 0.8; // escala de personajes y mobs respecto del mundo
/**
 * Cuánto más grandes se ven los humanoides "nuestros" (jugadores y NPCs del Character Creator, los marcados con `hum`) que los
 * bichos de Flare. Es solo visual: colisión, alcance y hitbox se calculan en celdas, así que tocarlo no cambia nada de juego.
 * Para calibrar, mirar al personaje al lado de un goblin y de un esqueleto; arriba de ~1,25 se empieza a desbordar la celda.
 */
const HS = 1.18;
// ---------- muñeco por capas ----------
interface Paper { cw: number; ch: number; cols: number; order: Record<string, string[]>; pieces: Record<string, string>; sets: Record<string, string[]> }
let PAPER: Paper;
const PIECES = new Map<string, HTMLImageElement>();
/** Devuelve la pieza si ya cargó; si no, la pide y vuelve a componer cuando llegue. */
function piece(n: string): HTMLImageElement | null {
    let im = PIECES.get(n);
    if (!im) { im = new Image(); im.onload = () => refreshLook(); im.src = `assets/paper/${n}.webp`; PIECES.set(n, im); }
    return im.complete && im.naturalWidth ? im : null;
}
/**
 * Aura del arma mejorada. No se puede hornear en el sprite (el +N cambia en el juego), así que se pinta al componer el muñeco:
 * una pasada de la hoja del arma con sombra difusa al fondo, y encima las capas normales. Arranca recién en +UP_GLOW_DESDE para
 * que el brillo signifique algo; el color es el de la rareza, así el aura dice calidad y nivel de mejora a la vez.
 *
 * Decisión de Román (4/11): arranca en +10. Con el tope en +11 quedan solo dos escalones, así que el primero ya entra visible
 * en vez de empezar en un brillo mínimo: un arma +10 es rarísima y tiene que notarse apenas aparece en pantalla.
 */
const UP_GLOW_DESDE = 10;
const AURA_MIN = 7, AURA_MAX = 13;
const auraDe = (it?: Item | null): { color: string; size: number } | undefined => {
    const up = it?.up ?? 0;
    if (up < UP_GLOW_DESDE) return undefined;
    const pasos = Math.max(1, UP_MAX - UP_GLOW_DESDE);
    return { color: it!.rar.c, size: AURA_MIN + (up - UP_GLOW_DESDE) * ((AURA_MAX - AURA_MIN) / pasos) };
};

function composeLook(names: string[], aura?: { color: string; size: number }): HTMLCanvasElement | null {
    const ims = names.map(piece); if (ims.some((i) => !i)) return null;
    const { cw, ch, cols } = PAPER, rows = Object.keys(SPR.hero.anims).length * 8, c = document.createElement('canvas'), g = c.getContext('2d')!;
    c.width = cw * cols; c.height = ch * rows;
    // El halo va primero, sobre la hoja entera del arma: queda detrás del personaje y no tapa el filo.
    const iArma = names.findIndex((n) => PAPER.pieces[n] === 'main');
    if (aura && iArma >= 0) {
        g.save();
        g.shadowColor = aura.color; g.shadowBlur = aura.size;
        for (let i = 0; i < 3; i++) g.drawImage(ims[iArma]!, 0, 0); // varias pasadas: el halo se acumula y se nota
        g.restore();
    }
    for (let d = 0; d < 8; d++) for (const t of PAPER.order[d]) names.forEach((n, k) => {
        if (PAPER.pieces[n] !== t) return;
        for (let r = 0; r < rows / 8; r++) g.drawImage(ims[k]!, 0, (r * 8 + d) * ch, c.width, ch, 0, (r * 8 + d) * ch, c.width, ch);
    });
    return c;
}
/** Modo de pruebas (?debug): habilita /look. */
const DEBUG = new URLSearchParams(location.search).has('debug');
/** Set de armadura que se está probando con /look (solo se ve en esta pantalla: no se manda a los demás). */
let debugLook: string | null = null;
const HELM_OF_BASE: Record<string, string> = { leather: 'leather_hood', chain: 'chain_coif', plate: 'plate_helm', mage: 'mage_hood' };
/** Piezas que lleva puesto el personaje, según su equipo. `real` ignora el set de prueba (lo que ven los demás). */
function lookOf(real = false): string[] {
    const dbg = !real && debugLook ? debugLook : null;
    const set = PAPER.sets[dbg ?? P.eq.armadura?.look ?? 'default'] ?? PAPER.sets.default, w = P.eq.arma;
    const helm = dbg ? (PAPER.pieces[`${dbg}_helm`] ? `${dbg}_helm` : HELM_OF_BASE[dbg]) : P.eq.cabeza?.look;
    return [...set, CLS.head, ...(helm ? [helm] : []), ...(w?.look ? [w.look] : []), ...(w?.off ? [w.off] : [])];
}
/** /look <set> | /look off | /look: prueba un set de armadura puesto sin comprarlo (solo con ?debug). */
function lookCommand(text: string) {
    const arg = text.split(/\s+/)[1]?.toLowerCase(), sets = Object.keys(PAPER.sets).filter((n) => n !== 'default');
    if (!arg) { log(`/look <set> prueba un set puesto, /look off vuelve. Sets: ${sets.join(', ')}`); return; }
    if (arg === 'off') { debugLook = null; log('Aspecto normal.'); refreshLook(); return; }
    if (!PAPER.sets[arg]) { log(`No existe el set "${arg}". Sets: ${sets.join(', ')}`); return; }
    debugLook = arg; log(`Probando el set ${arg} (solo lo ves vos). /look off para volver.`); refreshLook();
}
// ---------- bando y perfil visible para los demás ----------
const FACTIONS = [{ id: 'solmar', name: 'Solmar', col: '#6fb3ff', desc: 'Reino del sol y el mar' }, { id: 'vhar', name: 'Vhar', col: '#ff7a6b', desc: 'Tierras del hierro y la ceniza' }];
let selectedFaction = 'solmar';
const factionCol = (id: string) => FACTIONS.find((f) => f.id === id)?.col ?? '#e9dfc0';
const profileOf = () => `${selectedFaction};${CLS.id};${lookOf(true).join(',')}`;
function sendProfile() { if (connected) net.send({ $case: 'changePlayerProfileRequest', value: { profile: profileOf() } }); }
const otherLooks = new Map<string, HTMLCanvasElement>();
/** Sprite del muñeco de otro jugador según el equipo que anunció (o uno por defecto mientras cargan las piezas). */
function otherSprite(o: Other): string {
    const parts = o.profile.split(';'), names = (parts[2] ?? '').split(',').filter((n) => PAPER.pieces[n]);
    if (!names.length) return 'hero_other';
    const key = names.join('|'), id = 'p:' + key;
    if (!otherLooks.has(key)) { const c = composeLook(names); if (c) { otherLooks.set(key, c); IMG[id] = c; SPR[id] = SPR.hero; } }
    return otherLooks.has(key) ? id : 'hero_other';
}
let lookKey = '';
function refreshLook() {
    if (!PAPER) return;
    const names = lookOf(), aura = auraDe(P.eq.arma);
    // el +N entra en la clave: si mejorás el arma hay que recomponer para que cambie el aura
    const key = names.join('|') + (aura ? `|aura${P.eq.arma?.up}${aura.color}` : '');
    if (key !== lookKey) { const c = composeLook(names, aura); if (c) { IMG.hero = c; lookKey = key; sendProfile(); } }
    const other = ['leather_boots', 'leather_pants', 'leather_gloves', 'leather_chest', 'head_short', 'shortsword', 'buckler'];
    if (!IMG.hero_other) { const c = composeLook(other); if (c) IMG.hero_other = c; }
    refreshNpcLook();
}
function drawSprite(name: string, anim: string, t: number, dir: number, x: number, y: number, tint?: string | null, alpha?: number) {
    const M = SPR[name], A = M?.anims[anim], im = IMG[name]; if (!A || !im) return;
    const i = frameIndex(A, t), sx = i * M.cw, sy = (A.row + dir) * M.ch, k = SS * (M.sc ?? 1) * (M.hum ? HS : 1) / (M.s ?? 1), dw = M.cw * k, dh = M.ch * k, dx = x - M.ax * k, dy = y - M.ay * k;
    ctx.globalAlpha = alpha ?? 1;
    ctx.drawImage(im, sx, sy, M.cw, M.ch, dx, dy, dw, dh);
    if (tint) {
        if (off.width !== M.cw || off.height !== M.ch) { off.width = M.cw; off.height = M.ch; }
        octx.globalCompositeOperation = 'source-over'; octx.clearRect(0, 0, M.cw, M.ch); octx.drawImage(im, sx, sy, M.cw, M.ch, 0, 0, M.cw, M.ch);
        octx.globalCompositeOperation = 'source-atop'; octx.fillStyle = tint; octx.fillRect(0, 0, M.cw, M.ch); octx.globalCompositeOperation = 'source-over';
        ctx.drawImage(off, 0, 0, M.cw, M.ch, dx, dy, dw, dh);
    }
    ctx.globalAlpha = 1;
}
// ---------- skin de prueba: caballero (solo cuenta GM o ?skin=caballero) ----------
// Hojas de 15 cuadros x 8 direcciones de 128x128. Los PNG son locales y NO van al repo (assets/skins/caballero/, ver docs/SKIN_CABALLERO.md); si faltan, no pasa nada.
const KNIGHT_SHEETS: [string, string][] = [['stance', 'Idle'], ['run', 'Run'], ['swing', 'Melee'], ['hit', 'TakeDamage'], ['die', 'Die'], ['cast', 'CastSpell']];
let knightReady = false, knightTried = false;
const skinOn = () => /^rowena$/i.test(P.name) || new URLSearchParams(location.search).get('skin') === 'caballero';
const heroKey = () => (knightReady && skinOn() ? 'hero_knight' : 'hero');
async function initKnight() {
    if (knightTried || !skinOn()) return; knightTried = true; console.info('[skin] cargando caballero…');
    try {
        const ims = await Promise.all(KNIGHT_SHEETS.map(([, f]) => load(`assets/skins/caballero/${f}.png`)));
        ims.push(await load('assets/skins/caballero/Special1.png').catch(() => { console.warn('[skin] falta assets/skins/caballero/Special1.png: el crítico usa el golpe normal'); return ims[2]; })); // golpe crítico (Special1: espada arriba y salto); sin Special1.png se reusa el golpe normal
        const c = document.createElement('canvas'), g = c.getContext('2d')!; c.width = 15 * 128; c.height = (KNIGHT_SHEETS.length + 1) * 8 * 128;
        // las hojas rotan en sentido horario desde el este; el juego usa 0=O,1=NO,2=N,... => la dirección d toma la fila (d+4)%8
        ims.forEach((im, i) => { for (let d = 0; d < 8; d++) g.drawImage(im, 0, ((d + 4) % 8) * 128, 15 * 128, 128, 0, (i * 8 + d) * 128, 15 * 128, 128); });
        const A = (row: number, dur: number, type: string): Anim => ({ row, n: 15, dur, type });
        IMG.hero_knight = c;
        SPR.hero_knight = { cw: 128, ch: 128, ax: 64, ay: 108, sc: 1.3, hum: true, anims: { stance: A(0, 1500, 'looped'), run: A(8, 640, 'looped'), swing: A(16, 400, 'play_once'), hit: A(24, 250, 'play_once'), die: A(32, 1000, 'play_once'), cast: A(40, 290, 'play_once'), crit: A(48, 800, 'play_once') } };
        knightReady = true; console.info('[skin] caballero activo');
    } catch (e) { console.warn('[skin] caballero no cargó (se ve el muñeco normal). Revisá assets/skins/caballero/*.png:', e); }
}
/** Atlas extra (cripta de Kenney y terreno de SBS): id -> imagen y recorte [x, y, w, h, ox, oy]. */
/**
 * Tiles de los atlas externos. `p` = [sx, sy, sw, sh, ox, oy, dw, dh]: los cuatro primeros son el recorte en el atlas y los cuatro
 * últimos, el destino en geometría del mundo. Los dos juegos difieren cuando el atlas viene a escala nativa (meta `s` = 2, ver
 * tools/src/flare/mapatlas.ts): ahí el tile ocupa 192x96 en el atlas pero se dibuja en los 96x48 de siempre, o sea reduciendo en vez
 * de ampliar. La celda del mundo (TW x TH) no cambia nunca: la resolución del arte y la geometría son cosas separadas.
 */
const EXT: Record<number, { im: CanvasImageSource; p: number[] }> = {};
function drawWorld(id: number, x: number, y: number) { const e = EXT[id]; if (e) { const q = e.p; ctx.drawImage(e.im, q[0], q[1], q[2], q[3], Math.round(x - q[4] * GS), Math.round(y - q[5] * GS), q[6] * GS, q[7] * GS); return; } const w = WORLD[id]; if (!w) return; ctx.drawImage(IMG.world, w[0], w[1], w[2], w[3], x - w[4] * GS, y - w[5] * GS, w[2] * GS, w[3] * GS); }

// ---------- canvas ----------
const cv = $('cv') as HTMLCanvasElement, ctx = cv.getContext('2d')!;
const gameCursor = createCursor(cv, reduce);
let W = 0, H = 0, DPR = 1, Z = 1;
/** Campo de visión fijo, como en el cliente de referencia: todos ven la misma porción de mapa sin importar el monitor (el zoom se ajusta al tamaño de la ventana; ninguna dimensión muestra más que la referencia). */
const VIEW_ZOOM = 1.2, VIEW_REF_W = 1366, VIEW_REF_H = 768;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR; Z = Math.max(0.7, VIEW_ZOOM * Math.max(W / VIEW_REF_W, H / VIEW_REF_H)); }
window.addEventListener('resize', resize); resize();
const cam = { x: 0, y: 0, sx: 0, sy: 0 };
const toScreen = (gx: number, gy: number) => { const p = iso(gx, gy); return { x: (p.x - cam.x) * Z + W / 2 + cam.sx, y: (p.y - cam.y) * Z + H / 2 + cam.sy }; };
/** Textos flotantes de combate (CombatTextEvent). IDs: jugador = player_id decimal, mob = "m" + id. */
const combatText = new CombatTextManager({
    resolve: (id) => {
        const s = String(id);
        if (s.startsWith('m')) { const m = mobs.find((x) => x.id === Number(s.slice(1))); return m ? { x: m.x, y: m.y } : null; }
        let b: bigint; try { b = BigInt(s); } catch { return null; }
        if (b === myId) return { x: P.x, y: P.y };
        const o = others.get(b); return o ? { x: o.x, y: o.y } : null;
    },
    toScreen: (gx, gy) => toScreen(gx, gy),
    iconUrl: (id) => { const sp = SPELLS.find((x) => x.id === id); return spellIcon(id, sp?.col ?? '#c9a24a'); },
    headOffset: () => 62 * Z,
});
const spellLabel = (id: string) => SPELLS.find((x) => x.id === id)?.name ?? id;
function onCombatText(v: { targetId: string; sourceId?: string; amount: number; isHeal: boolean; spellName: string; spellIcon: string }) {
    const ev: CombatTextEvent = { targetId: v.targetId, amount: v.amount, isHeal: v.isHeal, spellName: v.spellName ? spellLabel(v.spellName) : '', spellId: v.spellIcon || undefined, self: v.targetId === myId.toString() };
    combatText.onEvent(ev);
    const me = myId.toString(), spell = ev.spellName ? ` de ${ev.spellName}` : '';
    if (v.targetId === me) logToChat('combat', 'System', v.isHeal ? `Te curaste ${v.amount}${spell}.` : `Recibiste ${v.amount} de daño${spell}.`);
    else if (v.sourceId === me && !v.isHeal) logToChat('combat', 'System', `Hiciste ${v.amount} de daño${spell}.`);
}
const toGrid = (sx: number, sy: number) => { const x = (sx - W / 2 - cam.sx) / Z + cam.x, y = (sy - H / 2 - cam.sy) / Z + cam.y; return { x: (x / (TW / 2) + y / (TH / 2)) / 2, y: (y / (TH / 2) - x / (TW / 2)) / 2 }; };

let hover: Mob | null = null, hoverDrop: Drop | null = null, mouse = { x: -1, y: -1 };
function pickMob(sx: number, sy: number) {
    let best: Mob | null = null, bd = 1e9;
    for (const m of mobs) {
        const p = toScreen(m.x, m.y); const top = p.y - (m.head + 8) * Z, bot = p.y + 12 * Z, hw = (m.hitR + 6) * Z;
        if (sx < p.x - hw || sx > p.x + hw || sy < top || sy > bot) continue;
        const d = Math.hypot(sx - p.x, sy - (top + bot) / 2); if (d < bd) { bd = d; best = m; }
    }
    return best;
}
/** Pide al server recoger un item del suelo (él valida distancia, permiso y lugar en la bolsa). */
let lastPickupAt = 0;
function requestPickup(d: Drop) {
    if (d.loot && !P.dead) {
        const T = now(); if (T - lastPickupAt < 0.15) return; lastPickupAt = T;
        if (d.loot.mock) onLootPicked({ lootId: d.loot.id, playerId: myId.toString(), itemName: d.loot.name, amount: d.loot.amount, playerName: '' }); // ?debug L: el server no lo conoce
        else net.send({ $case: 'clientPickupItem', value: { lootId: d.loot.id } });
        return;
    }
    if (d.gid == null || P.dead) return;
    const T = now();
    if (d.lockedUntil && d.lockedUntil > T) { toast(`Todavía no es tuyo (${Math.ceil(d.lockedUntil - T)} s).`); return; }
    if (T - lastPickupAt < 0.15) return; lastPickupAt = T;
    net.send({ $case: 'pickupRequest', value: { id: d.gid } });
}
/** Espacio: recoge el item más cercano (a 2 celdas o menos); si no hay, camina hasta el más cercano a la vista que sea recogible. */
function pickupNearest() {
    let best: Drop | null = null, bd = 1e9;
    const T = now();
    for (const d of drops) { if (d.lockedUntil && d.lockedUntil > T) continue; const k = dist(P, d); if (k < bd) { bd = k; best = d; } }
    if (!best) { if (drops.length) toast('Todavía no podés recoger lo que hay cerca.'); return; }
    cancelCast(); P.target = null; P.engage = false;
    if (bd <= 1.4) { requestPickup(best); return; }
    P.pickup = best; moveTo(best.x, best.y);
}
function pickDrop(sx: number, sy: number) { for (const d of drops) { const p = toScreen(d.x, d.y); if (Math.hypot(sx - p.x, sy - p.y) < 18 * Z) return d; } return null; }

/** Celdas que ocupa otro jugador (el server no deja pisarlas). */
const occupiedByOther = (x: number, y: number) => { for (const o of others.values()) if (o.cell.x === x && o.cell.y === y) return true; return false; };
const freeForMe = (x: number, y: number) => walk(x, y) && !occupiedByOther(x, y);

/** Camino de celdas hasta (gx, gy); el paso que está en curso termina igual. */
function moveTo(gx: number, gy: number) {
    const from = P.cell;
    let tx = Math.floor(gx), ty = Math.floor(gy);
    if (!freeForMe(tx, ty)) {
        // si el destino está ocupado, la celda libre más cercana alrededor
        let best: Cell | null = null, bd = 1e9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = tx + dx, y = ty + dy; if (!freeForMe(x, y)) continue; const d = Math.hypot(x - from.x, y - from.y); if (d < bd) { bd = d; best = { x, y }; } }
        if (!best) return false; tx = best.x; ty = best.y;
    }
    if (tx === from.x && ty === from.y) { P.path = []; return true; }
    const p = findPath(from.x, from.y, tx, ty, freeForMe);
    if (!p) return false;
    P.path = p; return true;
}

let holding = false;
/** Teclas de movimiento (WASD y flechas): vector de pantalla, se pasa a grilla en steerDir(). */
const moveKeys = new Set<string>();
const MOVE_KEY: Record<string, [number, number]> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] };
window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase(); if (!(k in MOVE_KEY)) return;
    e.preventDefault(); if (moveKeys.has(k)) return; moveKeys.add(k);
    // moverse con el teclado corta lo que estaba haciendo el personaje, igual que un clic en el suelo
    holding = false; P.engage = false; P.target = null; P.foe = null; P.pickup = null; P.queued = null; P.path = [];
});
window.addEventListener('keyup', (e) => { moveKeys.delete(e.key.toLowerCase()); });
window.addEventListener('blur', () => { moveKeys.clear(); holding = false; });
/** Vector de intención en grilla (longitud 0..1): teclado, o clic mantenido hacia el cursor. null = quieto. */
function inputVec(): { dx: number; dy: number } | null {
    if (moveKeys.size) {
        let u = 0, v = 0; for (const k of moveKeys) { const m = MOVE_KEY[k]; u += m[0]; v += m[1]; }
        // de pantalla a grilla (inversa de faceAngle): dx-dy = u, (dx+dy)/2 = v
        const gx = (u + 2 * v) / 2, gy = (2 * v - u) / 2, l = Math.hypot(gx, gy);
        return l < 1e-6 ? null : { dx: gx / l, dy: gy / l };
    }
    if (holding && mouse.x >= 0) {
        // Sin celdas ni esperas: la dirección es "del cuerpo al cursor" en este mismo frame, así que mover el mouse un poco ya cambia el rumbo (caderear).
        const g = toGrid(mouse.x, mouse.y), vx = g.x - P.x, vy = g.y - P.y, l = Math.hypot(vx, vy);
        // Siempre a velocidad completa (antes frenaba con el cursor cerca del cuerpo y se sentía lento); se detiene al llegar, en una zona muy chica.
        if (l < 0.12) return null;
        return { dx: vx / l, dy: vy / l };
    }
    return null;
}
/** Celdas libres para el cuerpo: paredes y otros jugadores. */
const freeBody = (cx: number, cy: number) => freeForMe(cx, cy);
/** Mueve a P continuo hacia (dx,dy) este frame y avisa al server unas 20 veces por segundo como mucho. */
/** Arranque y giro (D.12): el cliente nunca va más rápido que la velocidad del server, solo arranca de a poco y afloja al girar fuerte. Se afinan jugando. */
const ACCEL_START = 0.6, ACCEL_S = 0.14, TURN_DOT = 0.3, TURN_KEEP = 0.7;
let accel = 1, lastDx = 0, lastDy = 0;
function moveFree(dx: number, dy: number, dt: number, T: number) {
    const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    if (!P.mv) accel = ACCEL_START; // venía parado: arranca de a poco
    else if (ux * lastDx + uy * lastDy < TURN_DOT) accel = Math.min(accel, TURN_KEEP); // giro de más de ~70°: pierde ritmo
    accel = Math.min(1, accel + (1 - ACCEL_START) * dt / ACCEL_S); lastDx = ux; lastDy = uy;
    const sp = (1000 / P.stepMs) * accel / (P.slowEnd > T ? 1.7 : 1);
    const r = stepFree({ x: P.x, y: P.y, dx, dy, speed: sp, dt, free: freeBody });
    if (r.moved > 0) {
        turnTo(P, r.x - P.x, r.y - P.y, dt);
        P.phase = (P.phase || 0) + r.moved / (P.ref || 3.4);
        P.x = r.x; P.y = r.y; P.cell = { x: Math.floor(r.x), y: Math.floor(r.y) }; P.moving = true; P.mv = true;
    } else if (Math.hypot(dx, dy) > 0.01) turnTo(P, dx, dy, dt);
}
/** Correr es el default; se camina solo mientras se castea o hay un hechizo listo. El cliente pide el modo y la velocidad real la manda el server (`P.stepMs`). */
let runReqAt = 0;
function syncRunMode(T: number) {
    if (!connected) return;
    const want = !(P.casting || P.ready);
    if (want === P.running || T - runReqAt < 0.2) return;
    runReqAt = T; net.send({ $case: 'playerMovementStateChangeRequest', value: { runningMode: want } });
}
/** Cada cuánto se manda la posición al server mientras te movés (20 por segundo; los demás te ven con PLAYER_DELAY de atraso). */
const POS_SEND_S = 0.05;
function sendPosition(T: number, force = false) {
    if (!connected) return;
    if (!force && (T - P.sendT < POS_SEND_S || (Math.abs(P.x - P.sentX) < 1e-4 && Math.abs(P.y - P.sentY) < 1e-4))) return;
    P.sendT = T; P.sentX = P.x; P.sentY = P.y; diag.posSent.push(T);
    net.send({ $case: 'playerPositionRequest', value: { x: P.x, y: P.y } });
}
cv.addEventListener('pointerdown', (e) => {
    cv.focus({ preventScroll: true });
    if (P.dead || !connected) return; const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const m = pickMob(sx, sy), en = !m ? pickEnemy(sx, sy) : null;
    if (e.shiftKey && !P.ready) { // Shift+clic: fijar o soltar el foco sin tocar el objetivo
        const other = !m ? pickAlly(sx, sy) ?? en : null;
        if (m || other) { toggleFocus(m, other); return; }
    }
    talkNpc = null; P.foe = null;
    const npc = !m && !P.ready ? pickNpc(sx, sy) : null;
    if (npc) { talkTo(npc); return; }
    if (!m && !P.ready) { const wp = pickWaypoint(sx, sy); if (wp) { talkWp(wp); return; } }
    if (P.ready) {
        const s = SPELLS[P.ready.i];
        if (m) { release(m); return; }
        if (en) { release({ x: en.x, y: en.y, pvp: en }); return; }
        if (s.aoe) { const g = toGrid(sx, sy); release({ x: g.x, y: g.y }); return; }
    }
    if (P.casting && m) { P.target = m; return; }
    if (m) { cancelCast(); P.target = m; P.engage = true; P.pickup = null; P.repath = 0; return; }
    if (en) { cancelCast(); P.target = null; P.engage = false; P.foe = en; P.pickup = null; P.repath = 0; return; }
    const al = !m && !en ? pickAlly(sx, sy) : null;
    if (al) { P.ally = P.ally === al ? null : al; toast(P.ally ? `Curás a ${al.name}.` : 'Las curas vuelven a ser para vos.'); return; }
    const d = pickDrop(sx, sy);
    if (d) { cancelCast(); P.target = null; P.engage = false; P.pickup = d; moveTo(d.x, d.y); return; }
    cancelCast(P.casting || P.ready ? 'Hechizo cancelado.' : null);
    holding = true; mouse = { x: sx, y: sy };
    P.engage = false; P.target = null; P.pickup = null; P.queued = null; const g = toGrid(sx, sy); if (moveTo(g.x, g.y)) fx.push({ k: 'click', x: Math.floor(g.x) + 0.5, y: Math.floor(g.y) + 0.5, t: 0 });
});
cv.addEventListener('contextmenu', (e) => {
    e.preventDefault(); cancelCast('Hechizo cancelado.');
    if (!connected || P.dead) return; // clic derecho sobre un aliado: menú Dar / Intercambiar
    const r = cv.getBoundingClientRect(), al = pickAlly(e.clientX - r.left, e.clientY - r.top);
    if (al) trade.menuFor({ id: al.id, name: al.name }, e.clientX, e.clientY);
});
cv.addEventListener('pointerup', () => { if (holding && mouse.x >= 0 && !P.dead) { const g = toGrid(mouse.x, mouse.y); moveTo(g.x, g.y); } holding = false; }); // al soltar, termina el camino hasta donde quedó el cursor (el toque suelto va a la celda)
cv.addEventListener('pointercancel', () => { holding = false; });
cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
cv.addEventListener('pointerleave', () => { mouse = { x: -1, y: -1 }; });

// ---------- chat por canales: Global, Nación (tu facción), Party y Guild ----------
const CHAT_NET = new Set<ChatChannel>(['global', 'comercio', 'area', 'party', 'guild', 'nacion']);
function chatChannel(c: string): ChatChannel { const k = (c || 'global') as ChatChannel; return CHAT_NET.has(k) ? k : 'global'; }
const CHAT_HELP = () => `Comandos: /meditar, /diag (fps, ping y correcciones de movimiento), /fps (tope de cuadros: libre, 144, 60)${DEBUG ? ', /look' : ''}; chat: /g global, /c comercio, /a área, /n nación, /p party, /gu guild; party: /invitar /aceptar /rechazar /salir /expulsar /lider; guild: /guild (crear <nombre> <ETIQUETA>, invitar, aceptar, rechazar, salir, expulsar, ascender, bajar, lider, lema, disolver; O abre la ventana); arena: /arena (2v2, 3v3, salir, aceptar, rechazar, ranking, rating)`;
/** Lo que se escribe en el ChatBox: comandos locales, o mensaje al server por el canal de la pestaña (o el del prefijo). */
chatBus.on('chat:send', ({ text, channel }) => {
    cv.focus({ preventScroll: true });
    if (!connected) return;
    if (/^\/meditar$/i.test(text)) { toggleMeditate(); return; }
    if (/^\/diag$/i.test(text)) { diag.toggle(); return; }
    { const m = /^\/fps(?:\s+(\S+))?$/i.exec(text); if (m) {
        const a = (m[1] ?? '').toLowerCase();
        if (a === 'libre' || a === '0' || a === 'off') fpsCap = 0; else if (/^\d+$/.test(a) && Number(a) >= 20 && Number(a) <= 1000) fpsCap = Number(a); else { log(`Tope de fps: ${fpsCap || 'libre (sigue al monitor)'}. Uso: /fps libre | /fps 144 | /fps 60`); return; }
        try { localStorage.setItem('fdn.fpscap', String(fpsCap)); } catch { /* sin almacenamiento */ }
        log(`Tope de fps: ${fpsCap || 'libre (sigue al monitor)'}.`); return;
    } }
    if (DEBUG && /^\/look(\s|$)/i.test(text)) { lookCommand(text); return; }
    if (partyCommand(text)) return;
    if (guildCommand(text)) return;
    if (/^\/gm(\s|$)/i.test(text)) { net.send({ $case: 'chatMessageSendRequest', value: { message: text } }); return; } // comandos de GM: los resuelve el server (FDN_GM)
    if (/^\/arena(\s|$)/i.test(text)) { net.send({ $case: 'chatMessageSendRequest', value: { message: text } }); return; } // arenas 2v2 / 3v3: los resuelve el server
    const pre = /^\/(gu|g|n|p|a|c)\s+/i.exec(text);
    if (pre) { const ch = ({ gu: 'guild', g: 'global', n: 'nacion', p: 'party', a: 'area', c: 'comercio' } as Record<string, string>)[pre[1].toLowerCase()]; net.send({ $case: 'clientChatMessage', value: { channel: ch, text: text.slice(pre[0].length) } }); return; }
    if (text.startsWith('/')) { log(CHAT_HELP()); return; }
    if (channel === 'private') { log('Los mensajes privados llegan próximamente.'); return; }
    net.send({ $case: 'clientChatMessage', value: { channel: channel === 'all' || channel === 'system' ? 'global' : channel, text } });
});
// ---------- party (docs/PARTY_Y_ARENAS.md): comandos de chat y panel de compañeros ----------
const PARTY_CMDS: Record<string, string> = { invitar: 'invite', inv: 'invite', aceptar: 'accept', rechazar: 'decline', salir: 'leave', expulsar: 'kick', lider: 'leader' };
function partyCommand(text: string): boolean {
    const m = /^\/(\w+)(?:\s+(.+))?$/.exec(text); const action = m && PARTY_CMDS[m[1].toLowerCase()]; if (!m || !action) return false;
    if ((action === 'invite' || action === 'kick' || action === 'leader') && !m[2]) { log(`Falta el nombre: /${m[1]} nombre`); return true; }
    net.send({ $case: 'partyRequest', value: { action, name: (m[2] ?? '').trim() } }); return true;
}
// ---------- guild (docs/GUILDS.md): /guild <acción> [nombre] [resto] ----------
const GUILD_CMDS: Record<string, string> = { crear: 'create', invitar: 'invite', inv: 'invite', aceptar: 'accept', rechazar: 'decline', salir: 'leave', expulsar: 'kick', ascender: 'promote', bajar: 'demote', lider: 'leader', lema: 'motd', disolver: 'disband', info: 'info' };
function guildCommand(text: string): boolean {
    const m = /^\/guild(?:\s+(\w+))?(?:\s+(.+))?$/i.exec(text); if (!m) return false;
    if (!m[1]) { guild.toggle(); return true; }
    const action = GUILD_CMDS[m[1].toLowerCase()]; if (!action) { log('Guild: /guild crear <nombre> <ETIQUETA> · invitar <nombre> · aceptar · rechazar · salir · expulsar <nombre> · ascender <nombre> · bajar <nombre> · lider <nombre> · lema <texto> · disolver. Sin nada abre la ventana (también con O).'); return true; }
    const rest = (m[2] ?? '').trim();
    if (action === 'create') { const c = /^(.+?)\s+([A-Za-z0-9]{2,4})$/.exec(rest); if (!c) { log('Usá /guild crear <nombre> <ETIQUETA de 2 a 4 letras>, por ejemplo: /guild crear Los Cuervos CRV'); return true; } net.send({ $case: 'guildRequest', value: { action, name: c[1], arg: c[2] } }); return true; }
    if (action === 'motd') { net.send({ $case: 'guildRequest', value: { action, name: '', arg: rest } }); return true; }
    if (['invite', 'kick', 'promote', 'demote', 'leader'].includes(action) && !rest) { log(`Falta el nombre: /guild ${m[1]} nombre`); return true; }
    net.send({ $case: 'guildRequest', value: { action, name: rest, arg: '' } }); return true;
}
/** Etiqueta de guild de otro jugador: la 4.ª parte del perfil, que pone el server. */
const guildTagOf = (profile: string) => profile.split(';')[3] ?? '';
const taggedName = (name: string, tag: string) => (tag ? `[${tag}] ${name}` : name);

type PartyRow = { name: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number; map: string; leader: boolean; online: boolean };
/** Filas del panel por nombre: los cambios de hp/mp tocan solo el ancho de las barras (con transición CSS), sin reescribir el panel. */
const partyRows = new Map<string, { m: PartyRow; el: HTMLElement }>();
const pctOf = (v: number, max: number) => Math.max(0, Math.min(100, Math.round((v / Math.max(1, max)) * 100)));
function paintPartyBars(r: { m: PartyRow; el: HTMLElement }): void {
    const hp = pctOf(r.m.hp, r.m.maxHp), mp = pctOf(r.m.mp, r.m.maxMp);
    (r.el.querySelector('.ph i') as HTMLElement).style.width = hp + '%'; (r.el.querySelector('.ph em') as HTMLElement).textContent = hp + '%';
    (r.el.querySelector('.pp i') as HTMLElement).style.width = mp + '%'; (r.el.querySelector('.pp em') as HTMLElement).textContent = mp + '%';
}
function renderParty(members: PartyRow[]): void {
    const el = $('party'); if (!members.length) { el.hidden = true; el.innerHTML = ''; partyRows.clear(); return; }
    el.hidden = false;
    let list = el.querySelector('.pls') as HTMLElement | null;
    if (!list) { el.innerHTML = '<div class="pt">Party · <span class="pc"></span></div><div class="pls"></div>'; list = el.querySelector('.pls') as HTMLElement; }
    (el.querySelector('.pc') as HTMLElement).textContent = String(members.length);
    const keep = new Set(members.map((m) => m.name));
    for (const [n, r] of partyRows) if (!keep.has(n)) { r.el.remove(); partyRows.delete(n); }
    for (const m of members) {
        let r = partyRows.get(m.name);
        if (!r) {
            const row = document.createElement('div'); row.className = 'pm';
            row.addEventListener('click', (e) => { // clic en un compañero: menú Dar / Intercambiar (solo si lo ves)
                const name = r?.m.name; if (!name || name === P.name) return;
                const o = [...others.values()].find((x) => x.name === name && !x.gone);
                if (!o || !isAlly(o)) { toast(`No ves a ${name}: tiene que estar cerca.`); return; }
                trade.menuFor({ id: o.id, name: o.name }, e.clientX, e.clientY);
            });
            row.innerHTML = `<span class="pav">${esc(m.name.replace(/^\[[^\]]*\]\s*/, '').charAt(0).toUpperCase())}</span><div class="pbody"><div class="phd"><span class="pn"></span><span class="pl"></span></div><div class="pb ph"><i></i><em></em></div><div class="pb pp"><i></i><em></em></div></div>`;
            r = { m, el: row }; partyRows.set(m.name, r);
        }
        r.m = m; list.appendChild(r.el); // appendChild reordena según el server sin recrear la fila
        r.el.classList.toggle('far', !m.online || m.map !== MAP_DEF.id);
        r.el.title = !m.online ? 'Desconectado' : m.map !== MAP_DEF.id ? `En otro mapa (${m.map})` : '';
        (r.el.querySelector('.pn') as HTMLElement).innerHTML = (m.leader ? '<b class="pcr">♛</b> ' : '') + esc(m.name);
        (r.el.querySelector('.pl') as HTMLElement).textContent = String(m.level);
        paintPartyBars(r);
    }
}
function updatePartyStats(name: string, hp: number, mp: number): void {
    const r = partyRows.get(name); if (!r) return; r.m.hp = hp; r.m.mp = mp; paintPartyBars(r);
}

// Cartel de invitación: Aceptar / Rechazar, se cierra solo a los 15 s (o antes si vence en el server). Una nueva reemplaza a la anterior.
const INVITE_SHOW_MS = 15_000;
let inviteTimer = 0;
function hidePartyInvite(): void { clearTimeout(inviteTimer); $('partyInvite').hidden = true; }
function showPartyInvite(from: string, expiresMs: number, mock = false): void {
    const el = $('partyInvite'), ms = Math.max(1000, Math.min(INVITE_SHOW_MS, expiresMs ? expiresMs - Date.now() : INVITE_SHOW_MS));
    el.innerHTML = `<p>¡<b>${esc(from)}</b> te invitó a su party!</p><div class="pib"><button type="button" class="ok">Aceptar</button><button type="button" class="no">Rechazar</button></div><div class="pit"><i></i></div>`;
    const bar = el.querySelector('.pit i') as HTMLElement; bar.style.transitionDuration = ms + 'ms';
    const answer = (action: 'accept' | 'decline') => {
        const req = { $case: 'partyRequest' as const, value: { action, name: from } };
        if (mock) console.info('[party] (simulado, no se envía)', req); else { if (DEBUG) console.info('[party] enviando', req); net.send(req); }
        hidePartyInvite();
    };
    (el.querySelector('.ok') as HTMLElement).onclick = () => answer('accept');
    (el.querySelector('.no') as HTMLElement).onclick = () => answer('decline');
    el.hidden = false; void bar.offsetWidth; bar.style.width = '0%';
    clearTimeout(inviteTimer); inviteTimer = window.setTimeout(hidePartyInvite, ms);
}

/** Partida de arena encontrada: mismo cartel que la invitación de party, más el aviso grande al centro. Aceptar/Rechazar mandan el comando /arena. */
function showArenaInvite(mode: string, expiresMs: number, mock = false): void {
    const el = $('partyInvite'), ms = Math.max(1000, Math.min(INVITE_SHOW_MS, expiresMs ? expiresMs - Date.now() : INVITE_SHOW_MS));
    el.innerHTML = `<p>¡Partida de <b>arena ${esc(mode)}</b> encontrada!</p><p class="sub">Rechazar o no contestar penaliza 10 min.</p><div class="pib"><button type="button" class="ok">Aceptar</button><button type="button" class="no">Rechazar</button></div><div class="pit"><i></i></div>`;
    const bar = el.querySelector('.pit i') as HTMLElement; bar.style.transitionDuration = ms + 'ms';
    const answer = (action: 'aceptar' | 'rechazar') => {
        const req = { $case: 'chatMessageSendRequest' as const, value: { message: `/arena ${action}` } };
        if (mock) console.info('[arena] (simulado, no se envía)', req); else net.send(req);
        hidePartyInvite();
    };
    (el.querySelector('.ok') as HTMLElement).onclick = () => answer('aceptar');
    (el.querySelector('.no') as HTMLElement).onclick = () => answer('rechazar');
    el.hidden = false; void bar.offsetWidth; bar.style.width = '0%';
    clearTimeout(inviteTimer); inviteTimer = window.setTimeout(hidePartyInvite, ms);
    notify(`Arena ${mode}`, '¡Partida encontrada! Aceptá en el cartel de la derecha.');
}

window.addEventListener('keydown', (e) => {
    if (!connected || !worldReady) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') { e.preventDefault(); ($('chatIn') as HTMLInputElement).focus(); return; }
    if (e.key === 'F9') { e.preventDefault(); toggleGm(); return; }
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'q' || e.key === 'Q')) { usePotion('hp'); return; }
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'e' || e.key === 'E')) { usePotion('mp'); return; }
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'h' || e.key === 'H')) { toggleRecall(); return; }
    if (e.key === 'Tab' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (document.activeElement === cv || document.activeElement === document.body)) { // en un botón o ventana, Tab sigue navegando
         e.preventDefault(); focusToTarget(); return; }
    const hk = SPELLS.findIndex((x) => SPECIAL_KEY[x.id ?? ''] === e.key.toLowerCase()) >= 0 ? SPELLS.findIndex((x) => SPECIAL_KEY[x.id ?? ''] === e.key.toLowerCase()) : KEYS.indexOf(e.key), dm = /^(?:Digit|Numpad)([0-9])$/.exec(e.code), k = hk >= 0 ? hk : dm ? KEYS.indexOf(dm[1]) : null;
    // ?debug: Shift+1/2/3 simula un cast de Fuego/Hielo/Sagrado (solo visual: barra + cartel, no va al server).
    if (DEBUG && e.shiftKey && !e.repeat && /^Digit[123]$/.test(e.code)) {
        const [ty, name]: [SpellType, string] = ([['FIRE', 'Firebolt'], ['ICE', 'Chains of Ice'], ['HOLY', 'Heal']] as [SpellType, string][])[+e.code.slice(5) - 1];
        e.preventDefault(); useCastStore.getState().startCast(name, 1500, ty); combatText.showCastingSpell(P.x, P.y, name, ty);
        setTimeout(() => { if (!P.casting) useCastStore.getState().cancelCast(); }, 1600);
        return;
    }
    if (k != null && k < SPELLS.length && !e.repeat) { e.preventDefault(); cast(k); }
    if (e.code === 'Space' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); pickupNearest(); return; }
    // ?debug: Shift+I simula una invitación de KingLuthor (la I sola sigue abriendo la bolsa).
    if (DEBUG && e.shiftKey && e.code === 'KeyI' && !e.repeat) { showPartyInvite('KingLuthor', Date.now() + 30_000, true); return; }
    if (DEBUG && e.shiftKey && e.code === 'KeyA' && !e.repeat) { showArenaInvite('2v2', Date.now() + 30_000, true); return; }
    // ?debug: K simula un golpe de 326 y una cura de +92 sobre mi personaje.
    if (DEBUG && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        const me = myId.toString(), sp = SPELLS.find((x) => x.id && x.id !== 'ataque');
        onCombatText({ targetId: me, amount: 326, isHeal: false, spellName: sp?.id ?? 'proyectil', spellIcon: sp?.id ?? 'proyectil' });
        setTimeout(() => onCombatText({ targetId: me, amount: 92, isHeal: true, spellName: '', spellIcon: '' }), 250);
        return;
    }
    // ?debug: L simula un LootSpawnEvent a mis pies (un item falso que solo existe en el cliente).
    if (DEBUG && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        onLootSpawn({ lootId: `mock-${Date.now()}`, x: P.cell.x, y: P.cell.y, itemId: 'viper_skin', itemName: 'Viper Skin', amount: 1 }, true);
        return;
    }
    if (e.key === 'i' || e.key === 'I') toggleBag();
    if (e.key === 'c' || e.key === 'C') toggleChar();
    if (e.key === 'o' || e.key === 'O') guild.toggle();
    if (e.key === 'l' || e.key === 'L') toggleQuestLog();
    if (e.key === 'p' || e.key === 'P') toggleSpellBook();
    if (e.key === 'Escape') { if (P.casting || P.ready) cancelCast('Hechizo cancelado.'); else P.target = null; }
});

// ---------- update ----------
/** Atraso con que se dibuja a los demás jugadores: ~2,4 intervalos de envío (20 Hz), así un paquete tardío no los frena. */
const PLAYER_DELAY = 0.12;
let regenT = 0, pingSeq = 0, pveT = 0, pveSent = { dead: false, lvl: 0 };
/** El ping va por un timer propio (no por el bucle de dibujo, que el navegador frena en pestañas ocultas) para que no te desconecten. */
setInterval(() => { if (connected) { diag.ping(pingSeq + 1); net.send({ $case: 'pingRequest', value: { sequence: ++pingSeq } }); } }, 1000);
function update(dt: number) {
    const T = now(), tot = totals();
    for (const p of pending.slice()) if (T >= p.t) { pending.splice(pending.indexOf(p), 1); p.fn(); }
    // el server necesita saber si estoy muerto (los mobs me ignoran) y mi nivel (tope de daño por golpe)
    pveT -= dt;
    if (connected && (pveT <= 0 || pveSent.dead !== P.dead || pveSent.lvl !== P.lvl)) { pveT = 5; pveSent = { dead: P.dead, lvl: P.lvl }; net.send({ $case: 'pveStatusRequest', value: { dead: P.dead, lvl: P.lvl } }); }
    P.moving = false; P.flash = Math.max(0, P.flash - dt);
    if (!P.dead) {
        const m = P.target;
        if (P.casting) { P.path = []; if (T >= P.casting.end) finishCast(); }
        if (!P.casting && P.queued != null) { if (!alive(m)) P.queued = null; else if (dist(P, m) <= SPELLS[P.queued].range) { P.path = []; cast(P.queued); } }
        if (P.ready && T - P.ready.t > 10) { P.ready = null; toast('Se te escapó el hechizo.'); }
        if (!P.casting && P.engage && alive(m)) {
            const d = dist(P, m);
            if (d > 1.6) { P.repath -= dt; if (P.repath <= 0 || !P.path.length) { moveTo(m.x, m.y); P.repath = 0.35; } }
            else if (!P.mv) {
                P.path = []; turnTo(P, m.x - P.x, m.y - P.y, dt);
                if (T >= P.nextAtk && T >= P.frozenUntil) { const iv = meleeIntervalSecs(tot.aspd); P.nextAtk = T + iv; sendFacing(); oneShot(P, 'swing', Math.min(0.4, iv)); later(0.18, () => { if (mobs.includes(m) && dist(P, m) < 1.9 && !P.dead) meleeHit(m); }); }
            }
        }
        if (P.foe && !isEnemy(P.foe)) P.foe = null;
        if (P.foe && !P.casting && !P.dead) {
            const f = P.foe, d = dist(P, f);
            if (d > 1.6) { P.repath -= dt; if (P.repath <= 0 || !P.path.length) { moveTo(f.x, f.y); P.repath = 0.35; } }
            else if (!P.mv) {
                P.path = []; turnTo(P, f.x - P.x, f.y - P.y, dt);
                if (T >= P.nextAtk && T >= P.frozenUntil) { const iv = meleeIntervalSecs(tot.aspd); P.nextAtk = T + iv; sendFacing(); oneShot(P, 'swing', Math.min(0.4, iv)); later(0.18, () => { if (isEnemy(f) && dist(P, f) < 1.9 && !P.dead) { pvpDamage(f, 'ataque', ''); } }); }
            }
        }
        syncRunMode(T); trackRedZone();
        // movimiento continuo: cada frame se mueve hacia donde apuntás ahora (teclado, clic mantenido o camino), el server valida la velocidad
        P.mv = false;
        if (!P.casting && T >= P.frozenUntil) {
            let v = (!P.target && !P.foe) || moveKeys.size ? inputVec() : null;
            if (v) P.path = [];
            else if (P.path.length) {
                // seguir un camino de celdas: apuntar al centro de la siguiente; se da por llegada al acercarse (sin frenar entre celdas)
                let n = P.path[0];
                if (occupiedByOther(n.x, n.y)) { const end = P.path[P.path.length - 1]; P.path = []; if (end !== n) moveTo(end.x + 0.5, end.y + 0.5); n = P.path[0]; }
                while (n && P.path.length > 1 && Math.hypot(n.x + 0.5 - P.x, n.y + 0.5 - P.y) < 0.35) { P.path.shift(); n = P.path[0]; }
                if (n) {
                    const vx = n.x + 0.5 - P.x, vy = n.y + 0.5 - P.y, l = Math.hypot(vx, vy);
                    if (l < 0.08) P.path.shift(); else v = { dx: vx / l, dy: vy / l };
                }
            }
            if (v) moveFree(v.dx, v.dy, dt, T);
        }
        if (P.mv) sendPosition(T); else if (P.sentX !== P.x || P.sentY !== P.y) sendPosition(T, true);
        if (!P.mv && !P.path.length) sendFacing();
        if (P.pickup) { if (!drops.includes(P.pickup)) P.pickup = null; else if (dist(P, P.pickup) < 1.4) { requestPickup(P.pickup); P.pickup = null; } }
        regenT += dt; if (regenT >= 1) { regenT = 0; const inCity = isSafe(P.x, P.y); const calm = now() - P.hurtAt >= HP_REGEN.calmMs / 1000 && now() - P.pvpAt >= 10; /* fuera de combate (y 10 s sin PvP, como PVP_COMBAT_MS) */ P.hp = Math.min(maxHp(), P.hp + (inCity ? Math.max(8, Math.round(hpRegenPerSec(maxHp(), true))) : calm ? Math.round(hpRegenPerSec(maxHp(), P.med || !(P.mv || P.path.length))) : 0)); P.mp = Math.min(maxMp(), P.mp + (P.med ? Math.max(MEDITATE.min, Math.round(maxMp() * MEDITATE.pct)) : inCity ? 8 : now() - P.pvpAt < 10 ? Math.max(5, Math.round(maxMp() * 0.01)) : Math.max(PVE_MP_REGEN.min, Math.round(maxMp() * PVE_MP_REGEN.pct)))); if (P.med && P.mp >= maxMp()) stopMeditating('Terminaste de meditar: maná lleno.'); syncHp(); }
        if (P.med && (P.mv || P.path.length || P.casting || P.hp < P.medHp || P.dead)) stopMeditating(P.hp < P.medHp ? 'Te sacaron de la meditación.' : 'Dejaste de meditar.');
        if (P.med) P.medHp = P.hp;
    }
    // otros jugadores: se dibujan 0,15 s atrás, interpolando entre las posiciones que manda el server (sin saltos aunque la red tiemble)
    for (const o of others.values()) {
        o.moving = false;
        const rt = T - PLAYER_DELAY, b = o.buf;
        if (!b.length) continue;
        let k = b.length - 1; while (k > 0 && b[k - 1].t >= rt) k--;
        let tx: number, ty: number;
        if (k + 1 < b.length && b[k].t < rt) { const a = b[k], c = b[k + 1], u = Math.min(1, (rt - a.t) / Math.max(0.001, c.t - a.t)); tx = a.x + (c.x - a.x) * u; ty = a.y + (c.y - a.y) * u; }
        else { tx = b[k].x; ty = b[k].y; }
        if (k > 1) b.splice(0, k - 1);
        const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
        if (d > 4) { o.x = tx; o.y = ty; continue; }
        o.x = tx; o.y = ty;
        if (d > 0.002 && dt > 0 && d / dt > 0.3) { o.moving = true; turnTo(o, dx, dy, dt); o.phase = (o.phase || 0) + d / (o.ref || 3.4); }
    }
    for (const m of mobs.slice()) {
        m.flash = Math.max(0, m.flash - dt); m.moving = false;
        // el server manda la posición unas 10 veces por segundo: se dibuja 0.2 s atrás, interpolando entre fotos (sin saltitos aunque la red tiemble)
        const rt = T - MOB_DELAY, b = m.buf; let tx = m.sx, ty = m.sy, vx = 0, vy = 0;
        if (b.length) {
            let k = b.length - 1; while (k > 0 && b[k - 1].t >= rt) k--;
            if (b[k].t <= rt || k === 0) { tx = b[k].x; ty = b[k].y; if (k + 1 < b.length && b[k].t < rt) { const a = b[k], c = b[k + 1], u = Math.min(1, (rt - a.t) / Math.max(0.001, c.t - a.t)); tx = a.x + (c.x - a.x) * u; ty = a.y + (c.y - a.y) * u; vx = c.x - a.x; vy = c.y - a.y; } }
            else { const a = b[k - 1], c = b[k], u = Math.min(1, Math.max(0, (rt - a.t) / Math.max(0.001, c.t - a.t))); tx = a.x + (c.x - a.x) * u; ty = a.y + (c.y - a.y) * u; vx = c.x - a.x; vy = c.y - a.y; }
        }
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
        if (d > 4) { m.x = tx; m.y = ty; }
        else {
            m.x = tx; m.y = ty;
            if (d > 0.004) { m.moving = d / dt > 0.35 * (m.spd || 1); if (m.moving) { turnTo(m, vx || dx, vy || dy, dt); m.phase = (m.phase || 0) + d / (m.ref || 3.4); } }
        }
    }
    for (const p of projs.slice()) {
        if (p.aoe) {
            if (alive(p.m)) { p.tx = p.m.x; p.ty = p.m.y; }
            const d = Math.hypot(p.tx! - p.x, p.ty! - p.y);
            if (d < 0.2) { explode(p); projs.splice(projs.indexOf(p), 1); continue; }
            const st = Math.min(d, p.spd * dt); p.x += ((p.tx! - p.x) / d) * st; p.y += ((p.ty! - p.y) / d) * st;
            const tot2 = Math.hypot(p.tx! - p.sx!, p.ty! - p.sy!) || 1; p.arc = Math.sin(clamp(1 - d / tot2, 0, 1) * Math.PI) * 26;
            continue;
        }
        const pm = p.m!;
        if (pm.hp <= 0 || !mobs.includes(pm)) { projs.splice(projs.indexOf(p), 1); continue; }
        const d = dist(p, pm); if (d < 0.3) { fx.push({ k: 'ring', x: pm.x, y: pm.y, t: 0, c: '#c9b6ff' }); efx(p.sid === 'bola' ? 'estallido' : p.sid === 'esquirla' ? 'escarcha' : 'chispa', pm.x, pm.y); damageMob(pm, p.sid ?? 'proyectil'); projs.splice(projs.indexOf(p), 1); continue; }
        p.x += ((pm.x - p.x) / d) * p.spd * dt; p.y += ((pm.y - p.y) / d) * p.spd * dt;
    }
    for (const c of corpses.slice()) if (T - c.t > 3) corpses.splice(corpses.indexOf(c), 1);
    combatText.update(dt);
    for (const f of floats.slice()) { f.t += dt; if (f.t > 1.1) floats.splice(floats.indexOf(f), 1); }
    for (const f of fx.slice()) { f.t += dt; if (f.t > (f.d ?? (f.k === 'efx' ? 0.72 : 0.6))) fx.splice(fx.indexOf(f), 1); }
    for (const d of drops) d.t += dt;
}
function updateHover() {
    hover = mouse.x >= 0 ? pickMob(mouse.x, mouse.y) : null;
    hoverDrop = mouse.x >= 0 && !hover ? pickDrop(mouse.x, mouse.y) : null;
    cursorTick();
}
/** Barra de casteo (React): sigue a P.casting, que se corta desde muchos lados (muerte, cancelar, cambio de clase…). */
let castBarOf: Casting | null = null;
function castBarTick() {
    const c = P.casting, st = useCastStore.getState();
    if (c !== castBarOf) {
        castBarOf = c;
        if (c) { const s = SPELLS[c.i]; st.startCast(s.name, (c.end - c.start) * 1000, spellTypeOf(s.id), spellIcon(s.id ?? '', s.col)); } else if (st.isCasting) st.cancelCast();
    } else if (c && Math.abs(st.durationMs - (c.end - c.start) * 1000) > 1) st.setDuration((c.end - c.start) * 1000); // golpe que demora el cast
}
/** Cursor propio (cursor.ts): qué hay bajo el mouse (mismo orden que el clic) y el estado del hechizo. Solo visual. */
function cursorTick() {
    castBarTick();
    const on = mouse.x >= 0, mx = mouse.x, my = mouse.y, en = on && !hover ? pickEnemy(mx, my) : null, g = on ? toGrid(mx, my) : null;
    const portal = !!g && (!!pickWaypoint(mx, my) || LINK_WPS.some((q) => Math.hypot(q.x + 0.5 - g.x, q.y + 0.5 - g.y) <= 1.1) || !!MAP.portals?.some((q) => Math.floor(g.x) === q.x && Math.floor(g.y) === q.y));
    const sp = (i: number) => ({ icon: spellIcon(SPELLS[i].id ?? '', SPELLS[i].col), slot: document.getElementById('sp' + i) });
    let ready = null;
    if (P.ready && !P.dead) { // muerto no se puede lanzar (el clic se ignora). Mismo criterio que pointerdown/release: mob, jugador enemigo o suelo (área); en rango y sin inmunidad al control
        const s = SPELLS[P.ready.i], tgt: { x: number; y: number } | null = hover ?? en ?? (s.aoe && g ? g : null);
        ready = { ...sp(P.ready.i), ok: !!tgt && Math.hypot(tgt.x - P.x, tgt.y - P.y) <= s.range && !(hover && s.ctrl && hover.imm > now()) };
    }
    gameCursor.update({
        hover: !on ? 'ground' : hover ? 'mob' : pickNpc(mx, my) ? 'npc' : portal ? 'portal' : en ? 'enemy' : hoverDrop ? 'drop' : 'ground',
        cast: P.casting ? { ...sp(P.casting.i), k: clamp((now() - P.casting.start) / (P.casting.end - P.casting.start), 0, 1) } : recall ? { icon: spellIcon('recall', RECALL_COL), k: recallK(now()), slot: document.getElementById('recallBtn') } : null,
        ready,
    });
}
function updateCam(dt: number) {
    const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y; // cámara clavada al jugador (como el cliente clásico): el mundo se mueve, el personaje queda en el centro
    shake = Math.max(0, shake - dt); const s = shake * 14; cam.sx = (R() * 2 - 1) * s; cam.sy = (R() * 2 - 1) * s;
}

// ---------- dibujo ----------
/** Casteo propio: círculo rúnico en el piso que se carga con el progreso, runas girando y chispas que suben a las manos; listo (esperando blanco) queda pulsando. */
function drawCastCharge(T: number) {
    if (P.dead || !(P.casting || P.ready)) return;
    const c = P.casting, i = c ? c.i : P.ready!.i, s = SPELLS[i], col = s.col;
    const k = c ? clamp((T - c.start) / (c.end - c.start), 0, 1) : 1, pul = c ? 1 : 0.8 + 0.2 * Math.sin(T * 8);
    const p = iso(P.x, P.y), rx = TW * 0.42 * (0.55 + 0.45 * k), ry = rx * 0.5, TAU = Math.PI * 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.globalAlpha = (0.2 + 0.4 * k) * pul; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * 0.62, ry * 0.62, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.85 * pul; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    for (let n = 0; n < 10; n++) { const a = T * 2.2 + n * TAU / 10; ctx.globalAlpha = (0.3 + 0.6 * k) * pul; ctx.fillRect(p.x + Math.cos(a) * rx * 0.8 - 1.5, p.y + Math.sin(a) * ry * 0.8 - 1.5, 3, 3); }
    for (let n = 0; n < 8; n++) {
        const t = (T * 1.4 + n / 8) % 1, a = n * TAU / 8 + T * 0.6, r = 1 - t;
        ctx.globalAlpha = Math.sin(Math.PI * t) * (0.4 + 0.6 * k); ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * rx * 0.8 * r, p.y + Math.sin(a) * ry * 0.8 * r - 34 * t, 2 + 1.5 * k, 0, TAU); ctx.fill();
    }
    const gr = 8 + 16 * k, g = ctx.createRadialGradient(p.x, p.y - 34, 0, p.x, p.y - 34, gr);
    g.addColorStop(0, '#fff'); g.addColorStop(0.4, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (0.25 + 0.55 * k) * pul; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 34, gr, 0, TAU); ctx.fill();
    ctx.restore();
}
function animFor(e: Ent, T: number): [string, number] {
    if (e === (P as Ent) && P.casting) { const c = P.casting, k = clamp((T - c.start) / (c.end - c.start), 0, 1); return ['cast', k * 0.29]; }
    if (e === (P as Ent) && P.ready) return ['cast', 0.29];
    if (e.one && T < e.one.until) return [e.one.anim, T - e.one.t];
    return e.moving ? ['run', (e.phase || 0) + (e.t0 || 0)] : ['stance', T + (e.t0 || 0)];
}
/** Marca de rol sobre la cabeza del NPC: una insignia redonda con un símbolo simple (frasco, espada, escudo, gema, estrella, bandera, yelmo). */
function drawRoleMark(role: string, x: number, y: number) {
    const col = SHOPS[role]?.col ?? '#e9dfc0';
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(14,18,14,.88)'; ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    if (role === 'mercader') { ctx.moveTo(-1.8, -6); ctx.lineTo(1.8, -6); ctx.lineTo(1.8, -2.5); ctx.lineTo(5, 3); ctx.quadraticCurveTo(5.5, 6, 2.5, 6); ctx.lineTo(-2.5, 6); ctx.quadraticCurveTo(-5.5, 6, -5, 3); ctx.lineTo(-1.8, -2.5); ctx.closePath(); ctx.fill(); }
    else if (role === 'armero') { ctx.moveTo(-5, 5); ctx.lineTo(4, -4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-1, 3); ctx.lineTo(3, 0); ctx.moveTo(-6, 6); ctx.lineTo(-4, 4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(2.5, -6.5); ctx.lineTo(6.5, -6.5); ctx.lineTo(6.5, -2.5); ctx.closePath(); ctx.fill(); }
    else if (role === 'armadurero') { ctx.moveTo(0, -6.5); ctx.lineTo(5.5, -4.5); ctx.lineTo(5, 1); ctx.quadraticCurveTo(4, 5, 0, 7); ctx.quadraticCurveTo(-4, 5, -5, 1); ctx.lineTo(-5.5, -4.5); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(14,18,14,.85)'; ctx.fillRect(-0.9, -4, 1.8, 8); }
    else if (role === 'joyero') { ctx.moveTo(0, -6.5); ctx.lineTo(5.5, -1); ctx.lineTo(0, 6.5); ctx.lineTo(-5.5, -1); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(14,18,14,.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5.5, -1); ctx.lineTo(5.5, -1); ctx.moveTo(-2, -1); ctx.lineTo(0, 6.5); ctx.moveTo(2, -1); ctx.lineTo(0, 6.5); ctx.stroke(); }
    else if (role === 'alquimista') { for (let i = 0; i < 8; i++) { const r = i % 2 ? 2.2 : 6.5, a = (i * Math.PI) / 4 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); }
    else if (role === 'depositario') { ctx.fillRect(-6, -2, 12, 7.5); ctx.beginPath(); ctx.moveTo(-6, -2.6); ctx.quadraticCurveTo(0, -8, 6, -2.6); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(14,18,14,.85)'; ctx.fillRect(-6, -2.2, 12, 1.4); ctx.fillRect(-1.2, -1.2, 2.4, 3); } // baúl
    else if (role === 'capitan') { ctx.moveTo(-4, -6.5); ctx.lineTo(-4, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-3.5, -6); ctx.lineTo(5.5, -3.5); ctx.lineTo(-3.5, -0.5); ctx.closePath(); ctx.fill(); }
    else { ctx.moveTo(-5, 3); ctx.lineTo(-5, -1); ctx.quadraticCurveTo(-5, -6.5, 0, -6.5); ctx.quadraticCurveTo(5, -6.5, 5, -1); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(14,18,14,.85)'; ctx.fillRect(-3.5, -1.2, 7, 1.8); ctx.fillRect(-0.8, -1.2, 1.6, 6); }
    ctx.restore();
}
function nameTag(name: string, x: number, y: number, col: string, alpha = 1, size = 11) {
    ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.font = `600 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(name, x, y); ctx.fillStyle = col; ctx.fillText(name, x, y); ctx.globalAlpha = 1;
}
// ---------- Portal de Frontera (waypoint estilo Diablo): pad rúnico, arco de piedra y cartel (todo dibujado acá) ----------
let WAYPOINTS: Waypoint[] = MAP.waypoints ?? [];
const MY_WPS = () => WAYPOINTS.filter((q) => q.kind === 'city' && q.faction === selectedFaction);
const wpCol = (q: Waypoint) => (q.kind === 'city' ? '#e2b04a' : TRAINING[q.step!].col);
const portalAct = new Map<string, { a: number; t: number }>();
/** Activación suave (0..1, ~0.3 s): el portal se enciende cuando el jugador está dentro de su radio. */
function portalActivation(q: Waypoint, T: number) {
    let s = portalAct.get(q.id); if (!s) portalAct.set(q.id, s = { a: 0, t: T });
    const dt = Math.min(0.1, Math.max(0, T - s.t)); s.t = T;
    const on = !P.dead && Math.hypot(q.x + 0.5 - P.x, q.y + 0.5 - P.y) <= (q.kind === 'city' ? 1.7 : 1.1);
    s.a = clamp(s.a + (on ? 1 : -1) * dt / 0.3, 0, 1);
    return s.a * s.a * (3 - 2 * s.a);
}
const portalStyle = (q: Waypoint) => (q.kind === 'city' ? PORTAL_CITY : PORTAL_ZONE);
function drawPortalPad(q: Waypoint, T: number) { const c0 = iso(q.x + 0.5, q.y + 0.5); drawPortalFloor(ctx, c0.x, c0.y, portalStyle(q), portalActivation(q, T), T, reduce, q.x * 0.7 + q.y); }
function drawPortalArch(q: Waypoint, T: number) { const c0 = iso(q.x + 0.5, q.y + 0.5); drawPortalFx(ctx, c0.x, c0.y, portalStyle(q), portalActivation(q, T), T, reduce, q.x * 0.7 + q.y); }
/** Cartel del Portal de Frontera de cada plaza (las zonas no tienen portal: se vuelve con H). */
function drawPortalLabels() {
    for (const q of WAYPOINTS) {
        if (q.kind !== 'city') continue;
        const d = Math.hypot(q.x + 0.5 - P.x, q.y + 0.5 - P.y), c = iso(q.x + 0.5, q.y + 0.5); if (d > 18) continue;
        const mine = q.faction === selectedFaction;
        nameTag('Portal de Frontera', c.x, c.y - 185, wpCol(q), 1, 14);
        if (d < 7) nameTag(mine ? 'Tocá el portal para viajar' : 'Portal de otra facción', c.x, c.y - 168, '#d9d2b8', 1, 10);
    }
}
/** Cartel de los portales entre mapas: a dónde llevan y, si no cumplís el requisito, qué falta. */
function drawLinkLabels() {
    for (const l of LINKS) {
        const d = Math.hypot(l.x + 0.5 - P.x, l.y + 0.5 - P.y); if (d > (l.kind === 'enter' || l.kind === 'walk' ? 12 : 9)) continue;
        const c = iso(l.x + 0.5, l.y + 0.5), dest = getMapDef(l.to.map)?.name ?? l.to.map, why = linkGateReason(l, portalProgress(), (i) => QUESTS[i]?.name);
        // puertas de edificios: el nombre arriba de la puerta y una flecha en el piso; caminos: hacia dónde llevan
        if (l.kind === 'enter' || l.kind === 'walk') {
            const k = clamp(1.4 - d / 10, 0.35, 1), up = l.kind === 'enter' ? 30 : 40;
            ctx.save(); ctx.globalAlpha = 0.55 * k; ctx.fillStyle = LINK_COL[l.kind]; ctx.beginPath(); ctx.ellipse(c.x, c.y, 22, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            nameTag(l.kind === 'walk' ? `→ ${dest}` : dest, c.x, c.y - up, LINK_COL[l.kind], k, 12);
            continue;
        }
        nameTag(l.kind === 'oneway' ? `${dest} (solo ida)` : dest, c.x, c.y - 52, why ? '#ff9a8a' : LINK_COL[l.kind], 1, 11);
        if (d < 4 && why) nameTag(why, c.x, c.y - 40, '#d9d2b8', 1, 9);
        else if (d < 8 && !why && getMapDef(l.to.map)?.temporary && !MAP_DEF.temporary) { const r = runDoorLine(); nameTag(r.t, c.x, c.y - 40, r.c, 1, 10); }
    }
}
/** Cupo de la party en la puerta de una mazmorra: el primero que entra crea la instancia y solo la party puede sumarse a ella. */
function runDoorLine(): { t: string; c: string } {
    const ms = [...partyRows.values()].map((r) => r.m);
    if (ms.length < 2) return { t: 'Instancia propia: solo entrás vos', c: '#d9d2b8' };
    const inside = ms.filter((m) => m.online && getMapDef(m.map)?.temporary).length;
    return inside > 0
        ? { t: `Tu party ya está adentro (${inside}/${ms.length}): entrás a su instancia`, c: '#8af0a8' }
        : { t: `Party 0/${ms.length} adentro: el primero que entre crea la instancia, solo la party puede pasar`, c: '#ffd24a' };
}
function render() {
    const T = now();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0d100e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR * Z, 0, 0, DPR * Z, DPR * (W / 2 - cam.x * Z + cam.sx), DPR * (H / 2 - cam.y * Z + cam.sy));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const c0 = toGrid(0, 0), c1 = toGrid(W, 0), c2 = toGrid(0, H), c3 = toGrid(W, H);
    const rawMinX = Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)) - 2, rawMaxX = Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)) + 2;
    const rawMinY = Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)) - 2, rawMaxY = Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)) + 2;
    const minX = Math.max(0, rawMinX), maxX = Math.min(N - 1, rawMaxX), minY = Math.max(0, rawMinY), maxY = Math.min(N - 1, rawMaxY);
    // Fuera del mapa (cámara pegada al borde) se repite el piso del borde, oscurecido, en vez de dejar el fondo negro (solo mapas de caza y mazmorras).
    if (!MAP_DEF.safe && (rawMinX < 0 || rawMinY < 0 || rawMaxX > N - 1 || rawMaxY > N - 1)) {
        ctx.globalAlpha = 0.45;
        for (let y = rawMinY; y <= rawMaxY; y++) for (let x = rawMinX; x <= rawMaxX; x++) {
            if (x >= 0 && y >= 0 && x < N && y < N) continue;
            const p = iso(x + 0.5, y + 0.5); drawWorld(tiles[clamp(y, 0, N - 1)][clamp(x, 0, N - 1)], p.x, p.y);
        }
        ctx.globalAlpha = 1;
    }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const p = iso(x + 0.5, y + 0.5); drawWorld(tiles[y][x], p.x, p.y); }
    for (const d of decals) { const p = iso(d.x, d.y); drawWorld(d.id, p.x, p.y); }
    for (const q of WAYPOINTS) if (q.x >= minX - 3 && q.x <= maxX + 3 && q.y >= minY - 3 && q.y <= maxY + 3) drawPortalPad(q, T);
    for (const q of LINK_WPS) if (q.x >= minX - 3 && q.x <= maxX + 3 && q.y >= minY - 3 && q.y <= maxY + 3) drawPortalPad(q, T);
    for (const f of fx) if (f.k === 'click') { const p = iso(f.x, f.y); ctx.globalAlpha = 1 - f.t / 0.6; ctx.strokeStyle = '#d6a445'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 + f.t * 30, (10 + f.t * 30) / 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    drawBossGround(T);
    for (const sc of scorch.slice()) { const age = T - sc.t; if (age > 5) { scorch.splice(scorch.indexOf(sc), 1); continue; } const p = iso(sc.x, sc.y); ctx.globalAlpha = Math.min(1, (5 - age) / 2) * 0.55; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sc.r * TW * 0.45); g.addColorStop(0, '#120a05'); g.addColorStop(0.7, 'rgba(30,15,5,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, sc.r * TW * 0.45, sc.r * TW * 0.225, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    if (P.ready && mouse.x >= 0) {
        const s = SPELLS[P.ready.i], g = toGrid(mouse.x, mouse.y), tgt = s.aoe ? hover || g : hover;
        if (tgt) {
            const q = iso(tgt.x, tgt.y), inR = Math.hypot(tgt.x - P.x, tgt.y - P.y) <= s.range, rr = s.aoe || 0.45;
            ctx.strokeStyle = inR ? s.col : 'rgba(200,60,50,.8)'; ctx.setLineDash(s.aoe ? [6, 5] : []); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.ellipse(q.x, q.y, rr * TW * 0.5, rr * TH * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
    }
    // selección bajo los pies
    for (const m of [P.target, hover]) if (m && mobs.includes(m)) { const p = iso(m.x, m.y); ctx.strokeStyle = m === P.target ? 'rgba(226,85,63,.9)' : 'rgba(255,255,255,.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 17, 8.5, 0, 0, Math.PI * 2); ctx.stroke(); }
    // objetos por profundidad
    const objs: { d: number; f: () => void }[] = [];
    for (const o of props) if (o.x > minX - 3 && o.x < maxX + 3 && o.y > minY - 3 && o.y < maxY + 3) objs.push({ d: o.d ?? o.x + o.y, f: () => { const p = iso(o.x, o.y); drawWorld(o.id, p.x, p.y); } });
    for (const q of WAYPOINTS) if (q.x >= minX - 3 && q.x <= maxX + 3 && q.y >= minY - 3 && q.y <= maxY + 3) objs.push({ d: q.x + q.y + 0.5, f: () => drawPortalArch(q, T) });
    for (const q of LINK_WPS) if (q.x >= minX - 3 && q.x <= maxX + 3 && q.y >= minY - 3 && q.y <= maxY + 3) objs.push({ d: q.x + q.y + 0.5, f: () => drawPortalArch(q, T) });
    for (const b of MAP.buildings) pushBuilding(objs, b, minX, maxX, minY, maxY);
    for (const n of MAP.npcs) objs.push({ d: n.x + n.y + 1, f: () => drawNpc(n, T) });
    for (const d of drops) objs.push({ d: d.x + d.y - 0.2, f: () => drawDrop(d, T) });
    for (const c of corpses) objs.push({ d: c.x + c.y - 0.3, f: () => { const p = iso(c.x, c.y), age = T - c.t; drawSprite(c.sprite, 'die', age, c.dir, p.x, p.y, null, age > 2 ? 3 - age : 1); } });
    for (const m of mobs) objs.push({ d: m.x + m.y, f: () => drawMob(m, T) });
    const fc = focusNow();
    if (fc) { const e = fc.k === 'mob' ? fc.m : fc.o; objs.push({ d: e.x + e.y + 0.05, f: () => { const p = iso(e.x, e.y); ctx.save(); ctx.globalAlpha = 0.65 + 0.2 * Math.sin(T * 4); ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.ellipse(p.x, p.y, 24, 12, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } }); }
    for (const o of others.values()) objs.push({ d: o.x + o.y, f: () => { const p = iso(o.x, o.y), [a, t] = animFor(o, T); if (unseen(o)) return; if (o === P.ally) { ctx.save(); ctx.globalAlpha = 0.6 + 0.2 * Math.sin(T * 4); ctx.strokeStyle = '#8af0a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 20, 10, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } drawSprite(otherSprite(o), a, t, o.dir, p.x, p.y, o.inv ? 'rgba(150,200,255,.25)' : null, o.inv ? 0.35 + 0.1 * Math.sin(T * 5) : o.gone ? 0.45 : 1); if (o.fury) { ctx.save(); ctx.globalAlpha = 0.35 + 0.15 * Math.sin(T * 8); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 22, 11, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } } });
    objs.push({ d: P.x + P.y, f: () => { const p = iso(P.x, P.y); if (P.frozenUntil > T && !P.dead) { ctx.strokeStyle = 'rgba(190,235,255,.85)'; ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 8 - i * 14, 16, 6, 0, 0, Math.PI * 2); ctx.stroke(); } } if (P.dead) drawSprite(heroKey(), 'die', T - P.deadT, P.dir, p.x, p.y); else {
            const [a, t] = animFor(P, T), bz = P.fury > T;
            if (P.med) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = 0.5 + 0.5 * Math.sin(T * 3); ctx.strokeStyle = `rgba(110,170,255,${0.35 + k * 0.4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 16 + k * 14, (16 + k * 14) / 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(p.x, p.y - 20 - k * 22, 5, 2.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
            drawSprite(heroKey(), a, t, P.dir, p.x, p.y, P.flash > 0 ? 'rgba(255,70,50,.35)' : P.inv ? 'rgba(150,200,255,.25)' : bz ? `rgba(255,${190 + (0.5 + 0.5 * Math.sin(T * 9)) * 50 | 0},60,.32)` : null, P.inv ? 0.4 + 0.1 * Math.sin(T * 5) : 1);
        } } });
    objs.sort((a, b) => a.d - b.d).forEach((o) => o.f());
    // nombres arriba de todo
    for (const o of others.values()) { if (unseen(o)) continue; const p = iso(o.x, o.y); nameTag(taggedName(o.name, guildTagOf(o.profile)), p.x, p.y - 70, factionCol(o.profile.split(';')[0]), o.gone ? 0.5 : 1); if (o.maxHp && o.hp !== undefined && (o.hp < o.maxHp || (o.shield ?? 0) > 0)) { const f = Math.max(0, o.hp / o.maxHp); ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - 17, p.y - 66, 34, 5); ctx.fillStyle = isEnemy(o) ? '#d9443a' : '#58b85a'; ctx.fillRect(p.x - 16, p.y - 65, 32 * f, 3); if ((o.shield ?? 0) > 0) { ctx.fillStyle = '#9fd8ff'; ctx.fillRect(p.x - 16, p.y - 65, 32 * Math.min(1, o.shield! / o.maxHp), 1.5); } } }
    { const p = iso(P.x, P.y); nameTag(taggedName(P.name, guild.state?.tag ?? ''), p.x, p.y - 70, factionCol(selectedFaction)); }
    drawPortalLabels(); drawLinkLabels();
    for (const n of MAP.npcs) {
        const p = iso(n.x + 0.5, n.y + 0.5);
        nameTag(n.name, p.x, p.y - 70, '#9fd36b'); drawRoleMark(roleOf(n), p.x, p.y - 95);
        if (roleOf(n) === 'capitan' && questMark()) { ctx.font = "700 22px 'Alegreya SC', Georgia, serif"; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#2a1a00'; ctx.lineWidth = 3; ctx.strokeText(questMark(), p.x, p.y - 118 + Math.sin(now() * 4) * 2); ctx.fillText(questMark(), p.x, p.y - 118 + Math.sin(now() * 4) * 2); }
    }
    for (const p of projs) {
        const s = iso(p.x, p.y); s.y -= p.arc || 0;
        (p.trail ||= []).push({ x: s.x, y: s.y - 24 }); if (p.trail.length > 8) p.trail.shift();
        p.trail.forEach((q, k) => { ctx.globalAlpha = ((k + 1) / p.trail!.length) * 0.5; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(q.x, q.y, 3 + k * 0.7, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(s.x, s.y - 24, 0, s.x, s.y - 24, 18); g.addColorStop(0, '#fff'); g.addColorStop(0.35, p.col); g.addColorStop(1, 'rgba(185,163,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y - 24, 18, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    }
    if (P.ready) {
        const s = SPELLS[P.ready.i], p = iso(P.x, P.y), pu = 1 + Math.sin(T * 8) * 0.12;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(p.x, p.y - 34, 0, p.x, p.y - 34, 18 * pu); g.addColorStop(0, '#fff'); g.addColorStop(0.3, s.col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 34, 18 * pu, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (P.casting) {
        const c = P.casting, s = SPELLS[c.i], p = iso(P.x, P.y), k = clamp((T - c.start) / (c.end - c.start), 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(p.x, p.y - 34, 0, p.x, p.y - 34, 8 + k * 10); g.addColorStop(0, '#fff'); g.addColorStop(0.3, s.col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 34, 8 + k * 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    drawRecall(T); drawWind(T);
    // proyectiles de mobs a distancia: una flecha (o virote) con estela que vuela en arco corto hasta el punto apuntado
    for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i], k = (now() - a.t0) / a.dur;
        if (k >= 1) { arrows.splice(i, 1); continue; }
        if (a.kind >= 2) { // proyectil de hechizo: orbe ardiente con estela, vuela recto a media altura
            const A2 = iso(a.x0, a.y0), B2 = iso(a.x1, a.y1), big = a.kind === 3, rr = big ? 11 : 7;
            const at = (u: number) => ({ x: A2.x + (B2.x - A2.x) * u, y: A2.y + (B2.y - A2.y) * u - 26 });
            const h2 = at(k), t2 = at(Math.max(0, k - 0.18));
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
            ctx.strokeStyle = big ? 'rgba(255,110,40,0.55)' : 'rgba(255,170,70,0.55)'; ctx.lineWidth = rr * 0.9; ctx.beginPath(); ctx.moveTo(t2.x, t2.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();
            const g2 = ctx.createRadialGradient(h2.x, h2.y, 0, h2.x, h2.y, rr * 1.6); g2.addColorStop(0, '#fff'); g2.addColorStop(0.35, big ? '#ff7a2a' : '#ffb347'); g2.addColorStop(1, 'rgba(255,80,0,0)');
            ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(h2.x, h2.y, rr * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            continue;
        }
        const A = iso(a.x0, a.y0), B = iso(a.x1, a.y1), lift = Math.sin(Math.PI * k) * 12 + 22;
        const hx = A.x + (B.x - A.x) * k, hy = A.y + (B.y - A.y) * k - lift, k2 = Math.max(0, k - 0.12);
        const tx = A.x + (B.x - A.x) * k2, ty = A.y + (B.y - A.y) * k2 - (Math.sin(Math.PI * k2) * 12 + 22);
        const bolt = a.kind === 1, col = bolt ? '#9fd0ff' : '#e8d3a2';
        ctx.save(); ctx.lineCap = 'round';
        ctx.globalAlpha = 0.35; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(A.x + (B.x - A.x) * Math.max(0, k - 0.3), A.y + (B.y - A.y) * Math.max(0, k - 0.3) - (Math.sin(Math.PI * Math.max(0, k - 0.3)) * 12 + 22)); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.globalAlpha = 1; ctx.strokeStyle = '#3a2a16'; ctx.lineWidth = bolt ? 4 : 3; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = bolt ? 2.5 : 1.6; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        const ang = Math.atan2(hy - ty, hx - tx); ctx.fillStyle = bolt ? '#cfe8ff' : '#f4efe0'; ctx.beginPath(); ctx.moveTo(hx + Math.cos(ang) * 5, hy + Math.sin(ang) * 5); ctx.lineTo(hx + Math.cos(ang + 2.5) * 5, hy + Math.sin(ang + 2.5) * 5); ctx.lineTo(hx + Math.cos(ang - 2.5) * 5, hy + Math.sin(ang - 2.5) * 5); ctx.closePath(); ctx.fill();
        ctx.restore();
    }
    for (const f of fx) if (f.k === 'boom') {
        const p = iso(f.x, f.y), k = f.t / 0.6, R2 = f.r! * TW * 0.5;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
        const g = ctx.createRadialGradient(p.x, p.y - 10, 0, p.x, p.y - 10, R2 * (0.4 + k)); g.addColorStop(0, '#fff3c0'); g.addColorStop(0.35, f.c ?? '#ff8a3d'); g.addColorStop(1, 'rgba(120,30,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y - 10, R2 * (0.4 + k), R2 * (0.4 + k) * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = f.c ?? '#ffb070'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y, R2 * k * 1.1, R2 * k * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    drawCastCharge(T);
    for (const f of fx) if (f.k === 'burst') { const p = iso(f.x, f.y), k = f.t / 0.6; if (k > 0.5) continue; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k * 2; ctx.fillStyle = f.c!; ctx.beginPath(); ctx.arc(p.x, p.y - 34, 10 + k * 30, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (FXM && IMG.fx) for (const f of fx) if (f.k === 'efx') {
        const r = FXM.rows[f.n!], c = FXM.cell, i = Math.min(FXM.frames - 1, Math.floor(f.t * r.fps)), p = iso(f.x, f.y), w = c * r.scale, im = IMG[r.img ?? 'fx'];
        if (!im) continue;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(im, i * c, r.row * c, c, c, p.x - w / 2, p.y - w * 0.62 - (f.dy ?? 0), w, w); ctx.restore();
    }
    for (const f of fx) if (f.k === 'blizz') {
        // Ventisca procedural: escarcha en el piso y astillas de hielo que caen sin parar sobre el área
        const p = iso(f.x, f.y), R = f.r! * TW * 0.5, fade = Math.min(1, f.t / 0.25, (f.d! - f.t) / 0.5), rnd = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R); g.addColorStop(0, `rgba(190,235,255,${0.38 * fade})`); g.addColorStop(0.7, `rgba(90,170,255,${0.2 * fade})`); g.addColorStop(1, 'rgba(60,120,255,0)');
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, 0.5); ctx.translate(-p.x, -p.y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.lineCap = 'round';
        for (let i = 0; i < 90; i++) {
            const a = rnd(i) * Math.PI * 2, rr = Math.sqrt(rnd(i + 200)) * R, gx = p.x + Math.cos(a) * rr, gy = p.y + Math.sin(a) * rr * 0.5, per = 0.4 + rnd(i + 400) * 0.35, ph = (f.t / per + rnd(i + 600)) % 1, hgt = 150 * (1 - ph), y = gy - hgt;
            if (ph < 0.9) { ctx.strokeStyle = `rgba(${200 + rnd(i) * 55 | 0},240,255,${fade * (0.45 + 0.4 * rnd(i + 800))})`; ctx.lineWidth = 1.2 + rnd(i + 900) * 1.8; ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx - 3, y - 13 - rnd(i + 50) * 8); ctx.stroke(); }
            else { const k2 = (ph - 0.9) * 10; ctx.strokeStyle = `rgba(200,240,255,${fade * (1 - k2) * 0.7})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(gx, gy, 3 + k2 * 9, (3 + k2 * 9) * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
        }
        ctx.restore();
    }
    for (const f of fx) if (f.k === 'ring') { const p = iso(f.x, f.y), k = f.t / 0.6; ctx.strokeStyle = f.c!; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 + k * 34, (10 + k * 34) * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    // luz cálida de la fogata del campamento
    const fp = iso(MAP.fire.x + 0.5, MAP.fire.y + 0.5), fl = reduce ? 1 : 0.9 + Math.sin(T * 9) * 0.05 + Math.sin(T * 23) * 0.04;
    ctx.globalCompositeOperation = 'lighter'; const fg = ctx.createRadialGradient(fp.x, fp.y - 10, 0, fp.x, fp.y - 10, 170 * fl); fg.addColorStop(0, 'rgba(255,150,60,.35)'); fg.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = fg; ctx.fillRect(fp.x - 200, fp.y - 210, 400, 400); ctx.globalCompositeOperation = 'source-over';
    // textos flotantes (en mundo)
    ctx.textAlign = 'center';
    for (const f of floats) { const p = iso(f.x, f.y); ctx.globalAlpha = 1 - Math.max(0, f.t - 0.6) / 0.5; ctx.font = `700 ${f.big ? 15 : 12}px 'Alegreya Sans', system-ui, sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; const y = p.y - 54 - f.t * 26; ctx.strokeText(f.text, p.x, y); ctx.fillStyle = f.col; ctx.fillText(f.text, p.x, y); ctx.globalAlpha = 1; }
    // oscuridad alrededor del personaje
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const pp = toScreen(P.x, P.y); const g = ctx.createRadialGradient(pp.x, pp.y - 25 * Z, 110 * Z, pp.x, pp.y - 25 * Z, Math.max(W, H) * 0.6);
    g.addColorStop(0, 'rgba(6,8,12,0)'); g.addColorStop(1, 'rgba(6,8,12,.82)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    combatText.draw(ctx); // números de combate, en pantalla y por encima de la oscuridad
    if (MAP.fog) drawFog(MAP.fog, T);
    if (inDungeon(P.x, P.y)) { ctx.fillStyle = 'rgba(12,8,24,.28)'; ctx.fillRect(0, 0, W, H); }
    ctx.textAlign = 'center';
    const zn = isSafe(P.x, P.y) ? null : ZONES.find((z) => near(P.x, P.y, z, z.r + 2)), zl = zn ? mobDef(zn.type, zn).lvl : 0;
    const zone = isSafe(P.x, P.y) ? `${cityAt(P.x, P.y)?.name ?? 'Zona segura'} · zona segura` : zn ? `${zn.name} · Nv ${Math.max(1, zl - 1)}–${zl + 1}${MAP_DEF.redRects ? (inRed(P.x, P.y) ? ' · ¡zona roja!' : ' · sin PvP') : ''}` : '';
    const danger = zl - P.lvl; // verde: tranquila · dorado: a tu nivel · rojo: te pasa por mucho
    if (zone) { ctx.font = "600 13px 'Alegreya SC', Georgia, serif"; ctx.fillStyle = !zn ? 'rgba(214,164,69,.9)' : danger >= 4 ? '#ff6b5a' : danger >= 1 ? '#ffb347' : danger >= -3 ? 'rgba(214,164,69,.9)' : '#8fd18b'; ctx.fillText(zone + (zn && danger >= 4 ? ' · ¡peligrosa!' : ''), W / 2, H - 98); }
}
function drawMob(m: Mob, T: number) {
    const p = iso(m.x, m.y), par = m.par > T;
    const [a, t] = par ? animFor(m, m.parT) : animFor(m, T);
    drawSprite(m.sprite, a, t, m.dir, p.x, p.y, m.flash > 0 ? 'rgba(255,255,255,.6)' : par ? 'rgba(110,200,255,.45)' : m.poison > T ? 'rgba(120,220,80,.25)' : null);
    if (par) { ctx.strokeStyle = 'rgba(127,214,255,.85)'; ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 8 - i * 16, 18, 6, 0, 0, Math.PI * 2); ctx.stroke(); } }
    if (m.boss) {
        const sp = m.boss.special;
        if (m.busy > T) { // aviso de la habilidad: zona que va a pegar
            const rx = sp.r * TW * 0.707, k = 1 - (m.busy - T) / 1.1; ctx.save(); ctx.globalAlpha = 0.18 + 0.25 * k; ctx.fillStyle = sp.col; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.8; ctx.strokeStyle = sp.col; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        }
        const w = 70, y = p.y - m.head - 6; // boss: nombre dorado y barra grande siempre visibles
        nameTag(m.name, p.x, y - 9, bossRage.has(m.id) ? '#ff4a3a' : '#ffd24a', 1, 14);
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 8); ctx.fillStyle = '#8c6a1e'; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, m.hp / m.hpMax), 6); ctx.fillStyle = '#e0a82e'; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, m.hp / m.hpMax), 3);
        drawBossCast(m, p.x, y + 10, T);
    } else if (m.elite) { // élite de mazmorra: rombo dorado y nombre siempre visibles, y su barra
        const y = p.y - m.head - 6, w = 44;
        ctx.save(); ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#5a3c08'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, y - 22); ctx.lineTo(p.x + 5, y - 17); ctx.lineTo(p.x, y - 12); ctx.lineTo(p.x - 5, y - 17); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
        nameTag(m.name, p.x, y - 2, '#ffd24a', 0.9, 11);
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - w / 2 - 1, y + 3, w + 2, 6); ctx.fillStyle = '#c9a227'; ctx.fillRect(p.x - w / 2, y + 4, w * Math.max(0, m.hp / m.hpMax), 4);
        drawBossCast(m, p.x, y + 12, T);
    } else if (m.hp < m.hpMax || bossCasts.has(m.id)) { drawBossCast(m, p.x, p.y - m.head + 4, T); const w = 34; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - w / 2 - 1, p.y - m.head - 5, w + 2, 5); ctx.fillStyle = '#c43e2b'; ctx.fillRect(p.x - w / 2, p.y - m.head - 4, w * Math.max(0, m.hp / m.hpMax), 3); }
}
function drawDrop(d: Drop, T: number) {
    const fl = d.loot, isGold = !!d.gold || fl?.itemId === 'gold';
    const p = iso(d.x, d.y), bob = reduce ? 0 : Math.sin(T * 3 + d.x) * (fl ? 3 : 1.5), y = p.y - 4 - bob - (fl ? 3 : 0); // el botín de materiales flota más alto
    const c = isGold ? '#e8c34a' : fl ? LOOT_PURPLE : d.item!.rar.c, k = fl ? 1 : d.gold ? 0 : d.item!.rar.k;
    const locked = !!d.lockedUntil && d.lockedUntil > now();
    ctx.save();
    if (locked) ctx.globalAlpha = 0.6;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill(); // sombra
    if (k >= 1) { const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, 12 + k * 6); g.addColorStop(0, c + '88'); g.addColorStop(1, c + '00'); ctx.fillStyle = g; ctx.fillRect(p.x - 26, y - 26, 52, 52); }
    if (k >= 2) { const g = ctx.createLinearGradient(0, y - 38, 0, y); g.addColorStop(0, c + '00'); g.addColorStop(1, c + '66'); ctx.fillStyle = g; ctx.fillRect(p.x - 3, y - 38, 6, 38); } // haz de luz para raros y épicos
    // bolsita: cuerpo, cuello y atadura, con el color de la rareza
    ctx.fillStyle = '#3a2a18'; ctx.strokeStyle = c; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(p.x - 3, y - 5); ctx.quadraticCurveTo(p.x - 9, y + 1, p.x - 6, y + 5); ctx.lineTo(p.x + 6, y + 5); ctx.quadraticCurveTo(p.x + 9, y + 1, p.x + 3, y - 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - 4, y - 7); ctx.lineTo(p.x, y - 4); ctx.lineTo(p.x + 4, y - 7); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, y + 0.5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (locked) { ctx.strokeStyle = c + 'aa'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.ellipse(p.x, p.y, 11, 5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (hoverDrop === d || P.pickup === d) { // el nombre aparece al pasar el mouse
        ctx.font = "600 11px 'Alegreya Sans', system-ui, sans-serif"; ctx.textAlign = 'center';
        const label = (fl ? (fl.itemId === 'gold' ? `${fmtNum(fl.amount)} oro` : `${fl.name} x${fl.amount}`) : d.gold ? `${fmtNum(d.gold)} oro` : d.item!.name) + (locked ? ` · libre en ${Math.ceil(d.lockedUntil! - now())} s` : ''); const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - tw / 2 - 4, y - 28, tw + 8, 15);
        ctx.fillStyle = c; ctx.fillText(label, p.x, y - 17);
    }
}

// ---------- HUD ----------
function setClass(id: string) {
    CLS = CLASSES.find((c) => c.id === id) ?? CLASSES[0];
    srvMax.hp = 0; srvMax.mp = 0; // hasta que el server mande los Vitals del personaje nuevo
    SPELLS = CLS.spells.map((sid, i) => ({ key: SPECIAL_KEY[sid] ?? KEYS[i], id: sid, ...LIB[sid] }));
    pots.hp = 3; pots.mp = 3; pots.cd = 0; potEpoch++; renderPots();
    cds.fill(0); P.fury = 0; P.ready = null; P.casting = null;
    const mk = (n: string): Item => ({ id: uid++, ...BASES.find((b) => b.name === n)!, rar: RAR[0], attrs: [] });
    for (const sl of SLOTS) P.eq[sl] = null; P.eq.arma = mk(CLS.weapon); P.eq.armadura = CLS.armor ? mk(CLS.armor) : null; P.bag = [];
    refreshLook();
    P.lvl = 1; P.exp = 0; P.hp = maxHp(); P.mp = maxMp();
    // 10 slots grandes (teclas 1..0) + los que sobran en los chicos (teclas reales: -, =, R, F, G...)
    const slotHtml = (s: Spell, i: number, q: boolean) => `<button class="sw${q ? ' q' : ''}" id="sp${i}" type="button" title="${s.name} (${s.mp} maná)" aria-label="${s.name}, tecla ${s.key}, ${s.mp} de maná"><span class="sq"><img alt="" src="${spellIcon(s.id ?? '', s.col)}"><span class="cdo" id="cd${i}"></span><span class="kb">${s.key}</span><span class="mpc">${s.mp}</span></span></button>`;
    const emptyHtml = (k: string, q: boolean) => `<div class="sw${q ? ' q' : ''} empty" aria-hidden="true"><span class="sq"><span class="kb">${k}</span></span></div>`;
    $('bar').innerHTML = Array.from({ length: 10 }, (_, i) => SPELLS[i] ? slotHtml(SPELLS[i], i, false) : emptyHtml(KEYS[i], false)).join('');
    const rest = SPELLS.slice(10); $('quick').innerHTML = Array.from({ length: Math.max(4, rest.length) }, (_, j) => rest[j] ? slotHtml(rest[j], 10 + j, true) : emptyHtml('F' + (j + 1), true)).join('');
    SPELLS.forEach((_, i) => $('sp' + i).addEventListener('click', () => { cast(i); cv.focus({ preventScroll: true }); }));
    $('helpKeys').textContent = `Click o mantener: caminar · Click en mob: atacar · teclas 1–0 usar habilidad (las de objetivo: esperá que cargue y click en el blanco) · Click derecho: cancelar · ${SPELLS.map((x) => x.key + ' ' + x.name).join(' · ')} · Shift+clic fijar foco · Tab pasar al foco · I Bolsa · H Volver a la ciudad (tarda 8 s y se corta si te pegan) · Enter chat`;
}
/** Cuadraditos de estado con cuenta regresiva (Furia, invisible, detectar, parálisis, inmunidad), como en HB. */
const BUFFS: { k: string; n: string; c: string; end: () => number; on: () => boolean }[] = [
    { k: 'F', n: 'Furia', c: '#ffc83a', end: () => P.fury, on: () => P.fury > now() },
    { k: 'S', n: 'Escudo (absorbe daño antes que la vida)', c: '#9fd8ff', end: () => P.shieldEnd, on: () => P.shield > 0 && P.shieldEnd > now() },
    ...Object.entries(BUFF_INFO).map(([id, b]) => ({ k: b.k, n: b.n, c: b.c, end: () => myBuffs[id] ?? 0, on: () => (myBuffs[id] ?? 0) > now() })),
    { k: 'B', n: 'Bendición sagrada (−20 % daño, +30 % curación, inmune a control)', c: '#ffe9a0', end: () => P.blessEnd, on: () => P.blessEnd > now() },
    { k: 'V', n: 'Envenenado (−30 % de curación)', c: '#7fd05a', end: () => P.poisonEnd, on: () => P.poisonEnd > now() },
    { k: 'L', n: 'Ralentizado', c: '#8fb4d9', end: () => P.slowEnd, on: () => P.slowEnd > now() },
    { k: 'I', n: 'Invisible', c: '#7fb8ff', end: () => P.invEnd, on: () => P.inv },
    { k: 'D', n: 'Detectar invisible', c: '#9be07a', end: () => P.detEnd, on: () => P.det },
    { k: 'P', n: 'Paralizado', c: '#d9c24a', end: () => P.frozenUntil, on: () => P.frozenUntil > now() },
    { k: 'R', n: 'Inmune a parálisis', c: '#e8e8ff', end: () => P.immEnd, on: () => P.immEnd > now() },
];
function renderBuffs() {
    const el = $('buffs'), T = now(); let h = '';
    for (const b of BUFFS) { if (!b.on()) continue; const left = Math.max(0, b.end() - T); h += `<div class="buff${left < 2 ? ' warn' : ''}" style="--c:${b.c}" title="${b.n}"><i>${b.k}</i><b>${Math.ceil(left)}</b></div>`; }
    if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; }
}
function hud() {
    renderBuffs(); tickLogout(); potCdTick(); recallTick(); renderSpellBook(); tickBubble();
    const T = now(), mh = maxHp(), mm = maxMp();
    const hf = clamp(P.hp / mh, 0, 1), mf = clamp(P.mp / mm, 0, 1);
    $('liqHp').style.transform = `translateY(${(1 - hf) * 100}%)`; $('liqMp').style.transform = `translateY(${(1 - mf) * 100}%)`;
    $('hpT').textContent = String(Math.ceil(P.hp)); $('hpM').textContent = '/ ' + mh + (P.shield > 0 ? ` +${P.shield}` : ''); $('mpT').textContent = String(Math.floor(P.mp)); $('mpM').textContent = '/ ' + mm;
    $('orbHpBox').setAttribute('aria-label', `Vida ${Math.ceil(P.hp)} de ${mh}`); $('orbMpBox').setAttribute('aria-label', `Maná ${Math.floor(P.mp)} de ${mm}`);
    const xp = clamp(P.exp / expNeed(), 0, 1), xpp = Math.floor(xp * 100);
    $('xpI').style.width = xp * 100 + '%'; $('xpT').textContent = `EXP ${xpp}%`; $('xpBox').setAttribute('aria-valuenow', String(xpp));
    SPELLS.forEach((s, i) => {
        const left = Math.max(0, cds[i] - T), el = $('sp' + i), cd = $('cd' + i);
        if (left > 0) { cd.style.display = 'flex'; cd.style.background = `conic-gradient(rgba(0,0,0,0) 0 ${(1 - left / s.cd) * 100}%, rgba(5,3,8,.74) 0 100%)`; const t = left >= 10 ? String(Math.ceil(left)) : left.toFixed(1); if (cd.textContent !== t) cd.textContent = t; }
        else if (cd.style.display) { cd.style.display = ''; cd.textContent = ''; }
        el.hidden = !!s.fury && P.fury <= T; el.classList.toggle('nomp', P.mp < s.mp); el.classList.toggle('ready', !!(P.ready && P.ready.i === i));
        const locked = !canUseSkill(CLS.id, P.lvl, s.id ?? ''); el.classList.toggle('locked', locked); if (locked) el.dataset.lvl = `Nv ${skillLevel(CLS.id, s.id ?? '') ?? '-'}`;
    });
    const tt = totals(), wd: [number, number] = tt.wdmg[1] > 0 ? tt.wdmg : CLS.melee;
    const chips: [string, string][] = [['Nv.', String(P.lvl)], ['Exp', `${Math.floor(P.exp).toLocaleString('es-AR')} / ${expNeed().toLocaleString('es-AR')}`], ['Ataque', `${wd[0]}–${wd[1]}`], ['Defensa', `${tt.def} · RM ${tt.rm}`], ['Vel. mov.', Math.round((270 / P.stepMs) * 100) + '%'], ['Crítico', critTotal(tt.crit) + '%'], ['Tope DF / RM', `${capDf} / ${capRm}${capNextAt > 0 ? ' · sube el lunes' : ''}`]];
    const ch = chips.map(([k, v]) => `<div class="chp"><u>◆</u><span>${k}</span><b>${v}</b></div>`).join('');
    if ($('chips').dataset.h !== ch) { $('chips').dataset.h = ch; $('chips').innerHTML = ch; layoutHud(); }
    const m = P.target && mobs.includes(P.target) ? P.target : null;
    $('target').hidden = !m;
    if (m) {
        $('target').classList.toggle('boss', !!m.boss); $('tNp').classList.toggle('boss', !!m.boss); $('tNp').classList.toggle('elite', !!m.elite && !m.boss);
        $('tName').textContent = m.name; $('tLvl').textContent = String(m.lvl); $('tLvl').title = (m.boss ? 'Jefe · ' : m.elite ? 'Élite · ' : '') + 'Nivel ' + m.lvl;
        $('tHpI').style.width = Math.max(0, (m.hp / m.hpMax) * 100) + '%'; $('tHpT').textContent = `${Math.max(0, Math.ceil(m.hp))} / ${m.hpMax}`;
        const ch: string[] = [];
        if (m.par > T) ch.push(`<span class="chip par">Paralizado ${(m.par - T).toFixed(1)} s</span>`);
        else if (m.imm > T) ch.push(`<span class="chip imm">Inmune a control ${(m.imm - T).toFixed(0)} s</span>`);
        if (m.poison > T) ch.push(`<span class="chip ven">Envenenado</span>`);
        $('tChips').innerHTML = ch.join('');
    }
    const fcs = focusNow();
    $('focus').hidden = !fcs;
    if (fcs) {
        const hp = fcs.k === 'mob' ? fcs.m.hp : fcs.o.hp ?? 0, mx = fcs.k === 'mob' ? fcs.m.hpMax : fcs.o.maxHp ?? 0;
        $('fName').textContent = fcs.k === 'mob' ? fcs.m.name : fcs.o.name; $('fLvl').textContent = fcs.k === 'mob' ? String(fcs.m.lvl) : (fcs.o as { lvl?: number }).lvl ? String((fcs.o as { lvl?: number }).lvl) : '';
        $('fNp').classList.toggle('boss', fcs.k === 'mob' && !!fcs.m.boss); $('fNp').classList.toggle('elite', fcs.k === 'mob' && !!fcs.m.elite && !fcs.m.boss);
        $('fHpI').style.width = mx > 0 ? Math.max(0, Math.min(100, (hp / mx) * 100)) + '%' : '0%'; $('fHpT').textContent = mx > 0 ? `${Math.max(0, Math.ceil(hp))} / ${mx}` : '';
    }
    $('gold').textContent = fmtNum(P.gold);
    const netEl = $('net');
    netEl.textContent = connected ? `En línea · ${playersOnline || 1} ${playersOnline === 1 ? 'jugador' : 'jugadores'}` : 'Sin conexión';
    netEl.classList.toggle('off', !connected);
}

/** Escala del HUD según el viewport (diseño de 1162 px de ancho; no tapa de más el mundo). */
function layoutHud() {
    const root = $('hudroot'), sc = clamp(Math.min(innerWidth / 1360, innerHeight / 900), 0.4, 1);
    const st = document.documentElement.style; st.setProperty('--hud-scale', sc.toFixed(3)); st.setProperty('--hud-h', Math.round((root.offsetHeight + 8) * sc) + 'px');
    { const hh = (root.offsetHeight + 8) * sc, ws = clamp(Math.min((innerWidth - 24) / 696, (innerHeight - hh - 96) / 640), 0.45, 1.3); st.setProperty('--win-scale', ws.toFixed(3)); renderTipPos(); }
}
addEventListener('resize', layoutHud); layoutHud();
function renderTipPos() { if (typeof renderTip === 'function' && !$('itip').hidden) renderTip(); }

// ---------- bolsa ----------
let sel: { it: Item; from: 'bag' | 'eq' } | null = null;
/** Selección de algo que no es equipo (poción o material): se muestra en el tooltip. */
let selX: { k: 'pot'; id: 'hp' | 'mp' } | { k: 'mat'; id: string } | null = null;
let invTab: 'all' | 'gear' | 'cons' | 'mat' = 'all';
const bagOpen = () => !$('bag').hidden, charOpen = () => !$('char').hidden;
/** I: abre Personaje + Inventario juntos (o cierra ambos). */
function toggleBag() { const open = bagOpen(); $('bag').hidden = open; $('char').hidden = open; renderBag(); }
/** C: solo la ventana de Personaje. */
function toggleChar() { $('char').hidden = charOpen(); renderBag(); }
function closeWins() { $('bag').hidden = true; $('char').hidden = true; $('itip').hidden = true; $('qlog').hidden = true; $('book').hidden = true; $('btip').hidden = true; }
$('openBag').addEventListener('click', toggleBag);
$('openChar').addEventListener('click', toggleChar);
$('bagClose').addEventListener('click', () => { $('bag').hidden = true; renderBag(); });
$('charClose').addEventListener('click', () => { $('char').hidden = true; renderBag(); });
$('charBagBtn').addEventListener('click', () => { $('bag').hidden = bagOpen(); renderBag(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (bagOpen() || charOpen() || qlOpen() || spellBookOpen()) && !(e.target instanceof HTMLInputElement)) closeWins(); });
document.querySelectorAll<HTMLElement>('#invTabs [data-tab]').forEach((b) => b.addEventListener('click', () => { invTab = b.dataset.tab as typeof invTab; renderBag(); }));
$('focus').addEventListener('click', () => { if (focus) { focus = null; toast('Foco suelto.'); } });
$('sortBtn').addEventListener('click', () => net.send({ $case: 'econSortRequest', value: {} }));
$('dropBtn').addEventListener('click', () => {
    if (!sel || sel.from !== 'bag') return;
    net.send({ $case: 'econDropRequest', value: { uid: sel.it.id } });
});
/** Borde de rareza (los comunes en bronce para que no destaquen). */
const rarCol = (it: Item) => (it.rar.k ? it.rar.c : '#6b5a3c');
const GLY: Record<string, string> = { cabeza: 'g-cabeza', armadura: 'g-armadura', arma: 'g-arma', botas: 'g-botas', amuleto: 'g-amuleto', escudo: 'g-escudo', anillo: 'g-anillo', guantes: 'g-guantes' };
// los 8 slots alrededor del muñeco (diseño del pack): 4 a la izquierda, 3 a la derecha y el arma abajo
const EQ_L: [string, string, Slot | null][] = [['cabeza', 'Casco', 'cabeza'], ['armadura', 'Armadura', 'armadura'], ['guantes', 'Guantes', 'guantes'], ['botas', 'Botas', 'botas']];
const EQ_R: [string, string, Slot | null][] = [['amuleto', 'Amuleto', 'amuleto'], ['anillo', 'Anillo', 'anillo'], ['anillo', 'Anillo 2', 'anillo2']];
const EQ_B: [string, string, Slot | null][] = [['arma', 'Arma', 'arma']];
function slotBtn([g, label, slot]: [string, string, Slot | null]) {
    const gl = `<svg class="gl" aria-hidden="true"><use href="#${GLY[g]}"/></svg>`;
    if (!slot) return `<button type="button" class="sl dis" disabled aria-label="${label} (no disponible todavía)" title="${label}: no disponible todavía">${gl}</button>`;
    const it = P.eq[slot];
    return `<button type="button" class="sl${sel && it && sel.it === it ? ' sel' : ''}" data-eq="${slot}" aria-label="${label}: ${it ? esc(it.name) : 'vacío'}" style="${it ? `border-color:${rarCol(it)}` : ''}">${it ? ico(it) : gl}</button>`;
}
const STAT_ICON = (id: string, v: string, label: string) => `<div class="stat"><svg aria-hidden="true"><use href="#s-${id}"/></svg><span>${label}</span><b>${v}</b></div>`;
function renderChar() {
    const tt = totals(), wd: [number, number] = tt.wdmg[1] > 0 ? tt.wdmg : CLS.melee, need = expNeed();
    $('lvN').textContent = `Lv. ${P.lvl}`; ($('lvI') as HTMLElement).style.width = clamp(P.exp / need, 0, 1) * 100 + '%';
    $('lvT').textContent = `${Math.floor(P.exp).toLocaleString('es-AR')} / ${need.toLocaleString('es-AR')}`;
    $('lvBar').setAttribute('aria-valuenow', String(Math.floor(clamp(P.exp / need, 0, 1) * 100))); $('lvBar').setAttribute('aria-valuemin', '0'); $('lvBar').setAttribute('aria-valuemax', '100');
    const st = [
        STAT_ICON('atk', `${wd[0]}–${wd[1]}`, 'Ataque'), STAT_ICON('def', `${tt.def} (${mitigPct(tt.def)}%)`, 'Defensa (DF)'), STAT_ICON('mag', String(tt.mag), 'Daño mágico'), STAT_ICON('hp', String(maxHp()), 'Vida máx.'),
        STAT_ICON('mp', String(maxMp()), 'Maná máx.'), STAT_ICON('crit', critTotal(tt.crit) + '%', 'Crítico (tope 35 %)'), STAT_ICON('aspd', aspdTotal(tt.aspd) + '%', 'Vel. ataque (tope 40 %)'), STAT_ICON('leech', leechTotal(tt.leech) + '%', 'Robo de vida (tope 15 %)'),
        STAT_ICON('fire', `${tt.rm} (${mitigPct(tt.rm)}%)`, 'Res. mágica (RM)'), STAT_ICON('ice', `${mitigPct(tt.def)}% / ${mitigPct(tt.rm)}%`, 'Mitigación F/M'), STAT_ICON('par', tt.rpar + '%', 'Res. parálisis'), STAT_ICON('poi', tt.poison + '%', 'Veneno'),
    ].join('');
    if ($('stats').dataset.h !== st) { $('stats').dataset.h = st; $('stats').innerHTML = st; }
    renderAttrs();
}
let tipStat: StatId | null = null, tipEl: HTMLElement | null = null;
/** Puntos de stats: una fila por stat con su botón "+" (el server valida; acá solo se pide). */
function renderAttrs() {
    const rows = STAT_IDS.map((id) => {
        const can = statFree > 0 && stats[id] < STAT_CAP && !P.dead;
        return `<div class="atr" tabindex="0" data-tip="${id}" aria-label="${esc(STAT_NAMES[id] + ': ' + STAT_DESC[id])}"><span>${STAT_NAMES[id]}</span><b>${stats[id]}</b><button type="button" class="atrb" data-stat="${id}" ${can ? '' : 'disabled'} aria-label="Sumar un punto a ${STAT_NAMES[id]}">+</button></div>`;
    }).join('');
    const cost = statResetCost(P.lvl);
    const h = `<div class="atrh"><span>Puntos libres: <b>${statFree}</b></span><button type="button" class="atrr" id="statReset" title="${cost ? `Cuesta ${cost} de oro` : 'Gratis hasta el nivel 10'}">Reasignar${cost ? ` (${cost} oro)` : ''}</button></div><div class="atrg">${rows}</div>`;
    if ($('attrs').dataset.h !== h) { $('attrs').dataset.h = h; $('attrs').innerHTML = h; if (tipStat) { tipEl = $('attrs').querySelector<HTMLElement>(`[data-tip="${tipStat}"]`); renderStatTip(); } }
}
/** Tooltip de cada stat: lo que da un punto con los números de tu clase y nivel, y si te sirve (para no gastar puntos a ciegas). */
const FIT_LABEL = { clave: 'Recomendado para tu clase', util: 'Útil, pero no es lo central', bajo: 'Casi no le sirve a tu clase' } as const;
function renderStatTip() {
    const d = $('atip');
    if (!tipStat || !tipEl?.isConnected) { d.hidden = true; return; }
    const t = statTip(tipStat, CLS.id, P.lvl, stats), free = P.lvl <= STAT_RESET_FREE_LVL;
    d.innerHTML = `<div class="atfit ${t.fit}"><b>${STAT_NAMES[tipStat]}</b><span>${FIT_LABEL[t.fit]}</span></div><p>${esc(t.perPoint)}</p>${t.now ? `<p class="now">Con tus ${stats[tipStat] - STAT_BASE} puntos: ${esc(t.now)}.</p>` : ''}<p class="adv">${esc(t.advice)}</p><p class="rst">${free ? 'Reasignar es gratis hasta el nivel 10: probá sin miedo.' : `Reasignar cuesta ${statResetCost(P.lvl)} de oro.`}</p>`;
    d.hidden = false;
    const r = tipEl.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
    d.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    d.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
}
const showStatTip = (e: Event) => { const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]'); if (!el) return; tipStat = el.dataset.tip as StatId; tipEl = el; renderStatTip(); };
const hideStatTip = () => { tipStat = null; tipEl = null; $('atip').hidden = true; };
$('attrs').addEventListener('mouseover', showStatTip); $('attrs').addEventListener('focusin', showStatTip);
$('attrs').addEventListener('mouseleave', hideStatTip); $('attrs').addEventListener('focusout', hideStatTip);
$('attrs').addEventListener('click', (e) => {
    const t = e.target as HTMLElement, b = t.closest('button[data-stat]') as HTMLButtonElement | null;
    if (b && !b.disabled) { net.send({ $case: 'statAllocRequest', value: { action: 'add', stat: b.dataset.stat as StatId, points: e.shiftKey ? Math.min(5, statFree) : 1 } }); return; }
    if (t.closest('#statReset')) net.send({ $case: 'statAllocRequest', value: { action: 'reset', stat: '', points: 0 } });
});
/** Muñeco real del personaje (idle) en el retrato. */
function drawPortrait(T: number) {
    const c = $('heroCv') as HTMLCanvasElement, g = c.getContext('2d')!, M = SPR.hero, A = M?.anims.stance, im = IMG.hero;
    g.clearRect(0, 0, c.width, c.height); if (!A || !im) return;
    const i = frameIndex(A, T), k = 2; g.imageSmoothingEnabled = false;
    g.drawImage(im, i * M.cw, (A.row + 5) * M.ch, M.cw, M.ch, c.width / 2 - M.ax * k, c.height - 40 - M.ay * k, M.cw * k, M.ch * k);
}
let winT = 0;
function winTick(T: number) {
    if (charOpen()) { drawPortrait(T); if (T - winT > 0.4) { winT = T; renderChar(); } }
}
/** Stats comparables de un ítem (base con la mejora + atributos); la DF/RM/magia de atributos suman a las de la base, como en el server. */
const CMP_LABEL: Record<string, string> = { dmg: 'daño', def: 'defensa', rm: 'res. mágica', mag: 'daño mágico', hp: 'vida', mp: 'maná', crit: '% crítico', aspd: '% vel. ataque', leech: '% robo de vida', poison: '% veneno', rpar: '% res. parálisis' };
function itemStats(it: Item): Record<string, number> {
    const k = upMult(it.up), o: Record<string, number> = { dmg: it.dmg ? ((Math.round(it.dmg[0] * k) + Math.round(it.dmg[1] * k)) / 2) : 0, def: it.def ? Math.round(it.def * k) : 0, rm: it.rm ? Math.round(it.rm * k) : 0, mag: it.mag ? Math.round(it.mag * k) : 0 };
    for (const a of it.attrs) { const key = a.id === 'df' ? 'def' : a.id; if (key in CMP_LABEL) o[key] = (o[key] ?? 0) + a.v; }
    return o;
}
interface InvEnt { html: string; key: string }
function renderBag() {
    if (!bagOpen() && !charOpen()) { $('itip').hidden = true; return; }
    $('gold').textContent = fmtNum(P.gold);
    $('eqL').innerHTML = EQ_L.map(slotBtn).join(''); $('eqR').innerHTML = EQ_R.map(slotBtn).join('');
    $('eqB').innerHTML = EQ_B.map(slotBtn).join('');
    $('chName').textContent = P.name || ''; $('chTitle').textContent = `${CLS.name} de ${FACTIONS.find((f) => f.id === selectedFaction)?.name ?? ''}`;
    renderChar();
    document.querySelectorAll<HTMLElement>('#char [data-eq]').forEach((b) => (b.onclick = () => { const it = P.eq[b.dataset.eq as Slot]; sel = it ? { it, from: 'eq' } : null; selX = null; renderBag(); }));
    // celdas del inventario según la pestaña
    const gear: InvEnt[] = P.bag.map((it, i) => ({ key: 'g' + i, html: `<button type="button" class="cl${sel && sel.it === it ? ' sel' : ''}" data-bag="${i}" data-r="${it.rar.k}" aria-label="${esc(it.name)}, ${it.rar.n}" title="${esc(it.name)}" style="--rc:${rarCol(it)}">${ico(it)}</button>` }));
    const cons: InvEnt[] = (['hp', 'mp'] as const).filter((k) => pots[k] > 0).map((k) => ({ key: 'p' + k, html: `<button type="button" class="cl${selX && selX.id === k ? ' sel' : ''}" data-pot="${k}" aria-label="${POTS[k].name}, ${pots[k]}" title="${POTS[k].name}" style="--rc:${k === 'hp' ? '#8a3a34' : '#345a8a'}"><img class="iico" alt="" src="${potionIcon(k)}"><span class="q">${pots[k]}</span><i class="cdv" data-gcd></i></button>` }));
    const mats: InvEnt[] = [];
    if (zemBag > 0) mats.push({ key: 'forge', html: `<button type="button" class="cl${selX && selX.id === 'forge' ? ' sel' : ''}" data-mat="forge" aria-label="Zem, ${zemBag}" title="Zem" style="--rc:#c9833a"><img class="iico" alt="" src="${FORGE_ICON}"><span class="q">${zemBag}</span></button>` });
    for (const kid of ['cripta', 'foso'] as KeyId[]) {
        const kd = KEYDEFS[kid];
        if (Q.shards[kid] > 0) mats.push({ key: 's' + kid, html: `<button type="button" class="cl${selX && selX.id === 's' + kid ? ' sel' : ''}" data-mat="s${kid}" aria-label="${kd.shard}, ${Q.shards[kid]}" title="${kd.shard}" style="--rc:#6a4aa0"><img class="iico" alt="" src="${shardIcon(kid)}"><span class="q">${Q.shards[kid]}</span></button>` });
        if (Q.keys[kid] > 0) mats.push({ key: 'k' + kid, html: `<button type="button" class="cl${selX && selX.id === 'k' + kid ? ' sel' : ''}" data-mat="k${kid}" aria-label="${kd.name}, ${Q.keys[kid]}" title="${kd.name}" style="--rc:#c9a227"><img class="iico" alt="" src="${keyIcon(kid)}"><span class="q">${Q.keys[kid]}</span></button>` });
    }
    // llaves de las mazmorras y sus materiales (docs/LLAVES.md): clic para ver la receta, clic derecho para armar
    for (const id of KEY_CHAIN_MATS) {
        const n = QB?.mats[id] ?? 0; if (n <= 0) continue;
        const isKey = !!KEY_RECIPES[id] || id === 'llave_gastada';
        mats.push({ key: 'q' + id, html: `<button type="button" class="cl${selX && selX.id === 'q' + id ? ' sel' : ''}" data-mat="q${id}" aria-label="${matName(id)}, ${n}" title="${matName(id)}${keyFor(id) ? ' (clic derecho: armar llave)' : ''}" style="--rc:${isKey ? '#c9a227' : '#6a4aa0'}"><img class="iico" alt="" src="${isKey ? keyIcon('cripta') : shardIcon('cripta')}"><span class="q">${n}</span></button>` });
    }
    // piedras de reforja y basura vendible (botín del suelo): se ven en materiales; la basura se vende toda junta en un mercader
    const rfN = QB?.mats[MAT_REFORJA] ?? 0;
    if (rfN > 0) mats.push({ key: 'xrf', html: `<button type="button" class="cl${selX && selX.id === 'x' + MAT_REFORJA ? ' sel' : ''}" data-mat="x${MAT_REFORJA}" aria-label="Piedra de reforja, ${rfN}" title="Piedra de reforja" style="--rc:#c77dff"><img class="iico" alt="" src="${shardIcon('foso')}"><span class="q">${rfN}</span></button>` });
    for (const [id, n] of Object.entries(QB?.mats ?? {})) {
        if (!(n > 0) || !(id in JUNK_MATS || id.startsWith('trophy_'))) continue;
        mats.push({ key: 'j' + id, html: `<button type="button" class="cl${selX && selX.id === 'j' + id ? ' sel' : ''}" data-mat="j${id}" aria-label="${matName(id)}, ${n}" title="${matName(id)}" style="--rc:#7a7468"><img class="iico" alt="" src="${shardIcon('cripta')}"><span class="q">${n}</span></button>` });
    }
    const list = invTab === 'gear' ? gear : invTab === 'cons' ? cons : invTab === 'mat' ? mats : [...gear, ...cons, ...mats];
    const total = Math.max(30, Math.ceil(list.length / 6) * 6), cells = list.map((e) => e.html);
    while (cells.length < total) cells.push(`<div class="cl e" aria-hidden="true"></div>`);
    $('inv').innerHTML = cells.join('');
    $('cap').textContent = `Bolsa de equipo ${P.bag.length} / ${BAG_MAX}`;
    document.querySelectorAll<HTMLElement>('#invTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === invTab)));
    ($('dropBtn') as HTMLButtonElement).disabled = !(sel && sel.from === 'bag');
    document.querySelectorAll<HTMLElement>('#inv [data-bag]').forEach((b) => (b.onclick = () => { sel = { it: P.bag[+b.dataset.bag!], from: 'bag' }; selX = null; renderBag(); }));
    document.querySelectorAll<HTMLElement>('#inv [data-pot]').forEach((b) => (b.onclick = () => { selX = { k: 'pot', id: b.dataset.pot as 'hp' | 'mp' }; sel = null; renderBag(); }));
    document.querySelectorAll<HTMLElement>('#inv [data-mat]').forEach((b) => {
        b.onclick = () => { selX = { k: 'mat', id: b.dataset.mat! }; sel = null; renderBag(); };
        const k = b.dataset.mat![0] === 'q' ? keyFor(b.dataset.mat!.slice(1)) : undefined;
        if (k) b.oncontextmenu = (e) => { e.preventDefault(); combineKey(k); };
    });
    renderTip();
}
/** Tooltip flotante a la izquierda de las ventanas abiertas. */
function renderTip() {
    const d = $('itip');
    if (sel && !(sel.from === 'eq' ? SLOTS.some((sl) => P.eq[sl] === sel!.it) : P.bag.includes(sel.it))) sel = null;
    if (!sel && !selX) { d.hidden = true; return; }
    const wsc = parseFloat(document.documentElement.style.getPropertyValue('--win-scale')) || 1, n = (bagOpen() ? 1 : 0) + (charOpen() ? 1 : 0);
    d.style.right = `calc(max(12px, env(safe-area-inset-right, 0px)) + ${(n * 356 * wsc).toFixed(1)}px)`; d.hidden = false;
    if (selX) {
        if (selX.k === 'pot') { const k = selX.id; d.innerHTML = `<div><div class="iname" style="color:${POTS[k].col}">${POTS[k].name}</div><div class="sub">Consumible · ×${pots[k]}</div><div>${k === 'hp' ? 'Recupera 40% de la vida máxima: 20% al instante y el resto en 2 s.' : 'Recupera 50% del maná máximo.'}</div><div class="sub">Delay global de 1,75 s entre pociones.</div><div class="row"><button type="button" id="usePot">Usar (${POTS[k].key})</button></div></div>`; $('usePot').onclick = () => { usePotion(k); renderBag(); }; }
        else if (selX.id[0] === 'x') d.innerHTML = `<div><div class="iname" style="color:#c77dff">Piedra de reforja</div><div class="sub">Material · ×${QB?.mats[MAT_REFORJA] ?? 0}</div><div>Sirve para reforjar UN stat extra de un ítem único en un herrero (la calidad y los atributos fijos no cambian). La sueltan solo los jefes de mazmorra. El costo se duplica con cada reforja del mismo ítem.</div></div>`;
        else if (selX.id[0] === 'j') { const id = selX.id.slice(1), n = QB?.mats[id] ?? 0; d.innerHTML = `<div><div class="iname" style="color:#b8b2cc">${esc(matName(id))}</div><div class="sub">Basura · ×${n}</div><div>Se vende a ${junkValue(id)} de oro cada una: usá «Vender basura» en cualquier mercader o vendedor.</div></div>`; }
        else if (selX.id[0] === 'q') { d.innerHTML = keyMatTip(selX.id.slice(1)); d.querySelector<HTMLElement>('[data-combine]')?.addEventListener('click', (e) => combineKey((e.currentTarget as HTMLElement).dataset.combine!)); }
        else if (selX.id === 'forge') d.innerHTML = `<div><div class="iname" style="color:#e5a65a">Zem</div><div class="sub">Material · ×${zemBag}</div><div>Sirve para mejorar ítems únicos (+1 a +${UP_MAX}) en un herrero, pero la forja solo usa el zem del <b>depósito</b>. Lo sueltan los mobs. <b>Si morís contra un jugador en zona roja, se cae todo el que llevás encima:</b> depositalo.</div></div>`;
        else { const id = selX.id, kid = id.slice(1) as KeyId, kd = KEYDEFS[kid], shard = id[0] === 's'; d.innerHTML = `<div><div class="iname" style="color:${shard ? '#b99cff' : '#ffd24a'}">${shard ? kd.shard : kd.name}</div><div class="sub">Material · ×${shard ? Q.shards[kid] : Q.keys[kid]}</div><div>${shard ? `Con ${SHARDS_PER_KEY} esquirlas y ${kd.gold} de oro el Capitán forja la ${kd.name}.` : 'Abre la escalera sellada del portal correspondiente.'}</div></div>`; }
        return;
    }
    const it = sel!.it, base: string[] = [];
    const km = upMult(it.up), ru = (n: number) => Math.round(n * km);
    const trow = (k: string, v: string) => `<div class="trow"><span>${k}</span><b>${v}</b></div>`;
    if (it.dmg) base.push(trow('Daño', `${ru(it.dmg[0])}–${ru(it.dmg[1])}`)); if (it.def) base.push(trow('Defensa', String(ru(it.def)))); if (it.rm) base.push(trow('Res. mágica', String(ru(it.rm)))); if (it.mag) base.push(trow('Daño mágico', `+${ru(it.mag)}`));
    const un = UNIQUE_BY_NAME.get(it.name), q = Math.min(4, Math.max(0, it.rar.k)), cap = UP_MAX_BY_QUALITY[q] ?? UP_MAX;
    const upLine = un ? ((it.up ?? 0) < cap ? `<div class="sub">Mejorar a +${(it.up ?? 0) + 1}: ${upStones(it.up ?? 0)} piedra${upStones(it.up ?? 0) > 1 ? 's' : ''} de forja y ${upGold(un.uniq.tier, it.up ?? 0)} de oro${(it.up ?? 0) >= 7 ? ' y una copia de repuesto de esta pieza' : ''} (en un herrero)</div>` : `<div class="sub">Mejora máxima de un ítem ${it.rar.n.toLowerCase()} (+${cap})</div>`) : '';
    // los atributos fijos del catálogo van primero y los extras al azar después (se distinguen: los extras son los que se reforjan)
    const nFixed = un ? un.uniq.attrs.length : it.attrs.length, nExtra = un ? Math.min(EXTRAS_BY_QUALITY[q] ?? 0, Math.max(0, it.attrs.length - nFixed)) : 0;
    const attrList = it.attrs.length
        ? `<ul>${it.attrs.map((a, k) => (k < nFixed ? `<li style="color:#8fb6f0">${attrText(a)}</li>` : `<li style="color:#ffd27f">${attrText(a)} <small>(extra)</small></li>`)).join('')}</ul>`
        : `<div class="sub">Sin atributos extra</div>`;
    const fxLine = un?.uniq.fx ? `<div class="sub" style="color:${q >= 4 ? '#ffd24a' : '#6f6a80'}">${q >= 4 ? '✦' : '✧ (solo en Dorado)'} ${esc(FX_INFO[un.uniq.fx].name)}: ${esc(FX_INFO[un.uniq.fx].text)}</div>` : '';
    // set: cuántas piezas llevás y los bonos (verde los activos, gris los que faltan)
    const set = setOfPiece(it.name);
    let setBlock = '';
    if (set) {
        const worn = SLOTS.map((sl) => P.eq[sl]?.name), have = activeSets(worn).find((a) => a.set.id === set.id)?.count ?? 0;
        setBlock = `<div class="sub" style="color:#ffd27f;margin-top:4px">${esc(set.name)} (${have}/${set.pieces.length})</div>` + set.bonuses.map((b) => `<div class="sub" style="color:${have >= b.n ? '#7fd98a' : '#6f6a80'}">(${b.n}) ${b.stats.map(([id, v]) => attrText({ id, v })).join(', ')}</div>`).join('');
    }
    // comparación con lo que reemplazaría: verde lo que ganás, rojo lo que perdés
    let cmp = '';
    if (sel!.from === 'bag') {
        const cands = slotsFor(it.slot), target = cands.find((sl) => !P.eq[sl]) ?? cands[0], cur = P.eq[target] ?? null;
        const a = itemStats(it), b = cur ? itemStats(cur) : {} as Record<string, number>, rows: string[] = [];
        for (const key of Object.keys(CMP_LABEL)) {
            const d = Math.round(((a[key] ?? 0) - (b[key] ?? 0)) * 10) / 10; if (!d) continue;
            rows.push(`<div class="sub" style="color:${d > 0 ? '#7fd98a' : '#e07a6f'}">${d > 0 ? '+' : '−'}${Math.abs(d)} ${CMP_LABEL[key]}</div>`);
        }
        cmp = `<div class="sub" style="margin-top:4px;color:#b8b2cc">${cur ? `Contra ${esc(itName(cur))}` : 'Slot vacío'}:</div>${rows.join('') || '<div class="sub">Sin cambios.</div>'}`;
    }
    const ilvlTxt = un ? ` · ilvl ${un.uniq.ilvl}` : '';
    const reforgeLine = un && nExtra > 0 ? `<div class="sub">Reforjar un extra: ${reforgeStones(it.rf ?? 0)} piedra${reforgeStones(it.rf ?? 0) > 1 ? 's' : ''} de reforja (tenés ${QB?.mats[MAT_REFORJA] ?? 0}) y ${reforgeGold(un.uniq.tier, it.rf ?? 0)} de oro · se duplica en cada reforja</div>` : '';
    d.innerHTML = `<div style="border-color:${rarCol(it)}"><div class="iname" style="color:${it.rar.c}">${esc(itName(it))}</div><div class="sub trow"><span>${it.slot}${ilvlTxt}</span><b>${it.rar.n}</b></div>
    ${base.length ? `<div class="tbase">${base.join('')}</div>` : ''}
    ${attrList}${fxLine}${setBlock}
    ${upLine}${reforgeLine}${cmp}
    <div class="row">${sel!.from === 'bag' ? `<button type="button" id="eqBtn">Equipar</button>` : `<button type="button" id="uneqBtn">Sacar</button>`}${un && (it.up ?? 0) < cap ? `<button type="button" id="upBtn">Mejorar</button>` : ''}${Array.from({ length: nExtra }, (_, k) => `<button type="button" class="rfBtn" data-rf="${k}">Reforjar ${k + 1}</button>`).join('')}</div></div>`;
    d.querySelectorAll<HTMLElement>('.rfBtn').forEach((btn) => (btn.onclick = () => {
        const smith = MAP.npcs.find((n) => ['armero', 'armadurero'].includes(roleOf(n)) && Math.hypot(n.x - P.x, n.y - P.y) <= TALK_RANGE);
        if (!smith) { log('Acercate a un herrero (armero o armadurero) para reforjar el equipo.'); return; }
        net.send({ $case: 'econReforgeRequest', value: { npcId: smith.id, uid: it.id, extra: +btn.dataset.rf! } });
    }));
    const eqBtn = document.getElementById('eqBtn'), uneqBtn = document.getElementById('uneqBtn');
    if (eqBtn) eqBtn.onclick = () => net.send({ $case: 'econEquipRequest', value: { uid: it.id } }); // el server valida y manda el estado nuevo
    const upBtn = document.getElementById('upBtn');
    if (upBtn) upBtn.onclick = () => {
        const smith = MAP.npcs.find((n) => ['armero', 'armadurero'].includes(roleOf(n)) && Math.hypot(n.x - P.x, n.y - P.y) <= TALK_RANGE);
        if (!smith) { log('Acercate a un herrero (armero o armadurero) para mejorar el equipo.'); return; }
        net.send({ $case: 'econUpgradeRequest', value: { npcId: smith.id, uid: it.id } });
    };
    if (uneqBtn) uneqBtn.onclick = () => net.send({ $case: 'econUnequipRequest', value: { slot: SLOTS.find((sl) => P.eq[sl] === it) ?? it.slot } });
}
/** Salir: en zona segura es inmediato; en zona insegura hay que aguantar quieto unos segundos (se cancela si te movés o te pegan). */
let logout: { at: number; cell: Cell; hp: number; asked: boolean } | null = null;
function cancelLogout(why: string) { if (!logout) return; logout = null; net.send({ $case: 'logoutCancelledRequest', value: {} }); toast(why); }
function tickLogout() {
    if (!logout) return;
    if (!logout.asked) return;
    if (P.cell.x !== logout.cell.x || P.cell.y !== logout.cell.y || P.path.length || P.casting) { cancelLogout('Salida cancelada: te moviste.'); return; }
    if (P.hp < logout.hp - 0.5 || P.dead) { cancelLogout('Salida cancelada: te atacaron.'); return; }
    logout.hp = Math.max(logout.hp, P.hp);
    const left = logout.at - now();
    if (left <= 0) { logout = null; leaving = true; saver.tick(true); setTimeout(() => net.close(), 400); return; }
    toast(`Saliendo en ${Math.ceil(left)} s… (no te muevas)`);
}
let leaving = false;
$('exitBtn').addEventListener('click', () => { if (!connected || logout) return; logout = { at: 0, cell: { ...P.cell }, hp: P.hp, asked: false }; net.send({ $case: 'logoutRequest', value: {} }); });
// ---------- edificios y NPCs ----------
interface BuildMeta { w: number; h: number; ax: number; ay: number; fw: number; fh: number }
let BUILD: Record<string, BuildMeta> = {};
/** Los PNG de edificios los arma tools/src/house/atlas.ts; si faltan, simplemente no se dibujan. */
function loadBuildingImages() {
    for (const id of Object.keys(BUILD)) load(`assets/${id}.webp`).then((im) => { IMG[id] = im; }).catch(() => { /* sin imagen */ });
}
/**
 * El edificio se apoya en la esquina sur de su huella y se dibuja en tiras verticales de media celda: cada tira lleva la profundidad
 * de la celda de la huella más cercana a la cámara en esa columna. Así un personaje parado delante de la fachada (al sur o al este)
 * se dibuja encima y uno que pasa por detrás queda tapado. Si el edificio tapa al jugador, se dibuja translúcido.
 */
type Bld = { id: string; x: number; y: number; w: number; h: number };
function pushBuilding(objs: { d: number; f: () => void }[], b: Bld, minX: number, maxX: number, minY: number, maxY: number) {
    const M = BUILD[b.id], im = IMG[b.id]; if (!M || !im) return;
    if (b.x > maxX + 4 || b.y > maxY + 4 || b.x + b.w < minX - 8 || b.y + b.h < minY - 8) return;
    const p = iso(b.x + b.w, b.y + b.h), left = iso(b.x, b.y + b.h).x, x0 = p.x - M.ax, y0 = p.y - M.ay, n = b.w + b.h;
    const depthAt = (k: number) => (k < b.w ? b.x + k + b.y + b.h - 1 : b.x + b.w - 1 + b.y + b.h - 1 - (k - b.w));
    // ¿tapa al jugador? en su columna de pantalla hay fachada más cerca de la cámara que él, y sus pies quedan detrás de esa fachada
    const pp = iso(P.x, P.y), kp = Math.floor((pp.x - left) / 48);
    let hides = false;
    if (kp >= 0 && kp < n && P.x + P.y < depthAt(kp) + 0.25) {
        const foot = kp < b.w ? iso(b.x + kp + 0.5, b.y + b.h).y : iso(b.x + b.w, b.y + b.h - (kp - b.w) - 0.5).y;
        hides = pp.y < foot && pp.y > y0 + 10;
    }
    for (let k = 0; k < n; k++) {
        const D = depthAt(k);
        let s0 = Math.round(left + k * 48 - x0), s1 = Math.round(left + (k + 1) * 48 - x0) + 1; // +1: sin costuras entre tiras
        if (k === 0) s0 = 0; if (k === n - 1) s1 = M.w;
        s0 = Math.max(0, s0); s1 = Math.min(M.w, s1); if (s1 <= s0) continue;
        objs.push({ d: D + 0.25, f: () => { if (hides) ctx.globalAlpha = 0.45; ctx.drawImage(im, s0, 0, s1 - s0, M.h, x0 + s0, y0, s1 - s0, M.h); ctx.globalAlpha = 1; } });
    }
}

type Npc = (typeof MAP.npcs)[number];
/** Piezas de avatar (las mismas del muñeco por capas) de cada NPC. */
const NPC_LOOKS: Record<string, string[]> = {
    mercader_s: ['leather_boots', 'cloth_pants', 'cloth_gloves', 'cloth_shirt', 'head_short', 'leather_hood'],
    mercader_v: ['cloth_sandals', 'leather_pants', 'leather_gloves', 'cloth_shirt', 'head_bald'],
    armero_s: ['leather_boots', 'leather_pants', 'leather_gloves', 'leather_chest', 'head_bald', 'maul'],
    armero_v: ['chain_boots', 'leather_pants', 'chain_gloves', 'leather_chest', 'head_short', 'mace'],
    armadurero_s: ['chain_boots', 'chain_greaves', 'chain_gloves', 'chain_cuirass', 'head_bald', 'chain_coif'],
    armadurero_v: ['leather_boots', 'chain_greaves', 'plate_gauntlets', 'plate_cuirass', 'head_bald'],
    joyero_s: ['cloth_sandals', 'mage_skirt', 'cloth_gloves', 'mage_vest', 'head_short'],
    joyero_v: ['leather_boots', 'cloth_pants', 'cloth_gloves', 'leather_chest', 'head_short', 'leather_hood'],
    alquimista_s: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest', 'head_short', 'mage_hood', 'staff'],
    alquimista_v: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest', 'head_bald', 'wand'],
    capitan_s: ['leather_boots', 'cloth_pants', 'cloth_gloves', 'cloth_shirt', 'head_short', 'plate_helm'],
    capitan_v: ['plate_boots', 'plate_greaves', 'plate_gauntlets', 'plate_cuirass', 'head_short', 'plate_helm', 'longsword'],
    guardia_s: ['chain_boots', 'chain_greaves', 'chain_gloves', 'chain_cuirass', 'head_short', 'plate_helm', 'longsword', 'kite_shield'],
    guardia_v: ['plate_boots', 'chain_greaves', 'plate_gauntlets', 'chain_cuirass', 'head_bald', 'chain_coif', 'battle_axe'],
    subastador_s: ['mage_boots', 'cloth_pants', 'cloth_gloves', 'mage_vest', 'head_short'],
    subastador_v: ['leather_boots', 'leather_pants', 'cloth_gloves', 'mage_vest', 'head_bald', 'mage_hood'],
    depositario_s: ['leather_boots', 'cloth_pants', 'leather_gloves', 'leather_chest', 'head_short'],
    depositario_v: ['chain_boots', 'leather_pants', 'leather_gloves', 'cloth_shirt', 'head_bald', 'leather_hood'],
    sanador_v: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest', 'head_bald', 'mage_hood'],
    mago_v: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest', 'head_bald', 'mage_hood', 'wand'],
    arenero_s: ['chain_boots', 'leather_pants', 'leather_gloves', 'leather_chest', 'head_short', 'longsword'],
    arenero_v: ['chain_boots', 'leather_pants', 'leather_gloves', 'leather_chest', 'head_bald', 'longsword'],
    sanador_s: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest', 'head_short', 'mage_hood'],
    mago_s: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest', 'head_short', 'mage_hood', 'staff'],
};
const lookOfNpc = (n: { id: string }) => NPC_LOOKS[n.id] ?? NPC_LOOKS[n.id.replace(/\d+$/, '')] ?? NPC_LOOKS[roleOf(n) + '_s'];
function refreshNpcLook() {
    if (!PAPER) return;
    for (const n of MAP.npcs) {
        const names = lookOfNpc(n), key = 'npc_' + n.id;
        if (!names || IMG[key]) continue;
        const c = composeLook(names); if (c) { IMG[key] = c; SPR[key] = SPR.hero; }
    }
}
function drawNpc(n: Npc, T: number) {
    const p = iso(n.x + 0.5, n.y + 0.5);
    drawSprite('npc_' + n.id, 'stance', T + n.x * 0.37, n.dir, p.x, p.y);
}
function pickNpc(sx: number, sy: number): Npc | null {
    for (const n of MAP.npcs) {
        const p = toScreen(n.x + 0.5, n.y + 0.5);
        if (Math.abs(sx - p.x) < 22 * Z && sy > p.y - 76 * Z && sy < p.y + 12 * Z) return n;
    }
    return null;
}

// ---------- misiones y progreso por zonas (lógica tipo Dreadmyst) ----------
// Un solo pueblo seguro; cada zona tiene un rango de nivel y el Capitán te empuja de una a la siguiente. La cripta se abre con llave.
const Q = { i: 0, st: 'new' as 'new' | 'active' | 'ready', prog: 0, keys: { cripta: 0, foso: 0 } as Record<KeyId, number>, shards: { cripta: 0, foso: 0 } as Record<KeyId, number> };
const keyLines = () => KEY_IDS.map((k) => (Q.keys[k] ? `<em>${KEYDEFS[k].name}: ${Q.keys[k]}</em>` : '') + (Q.shards[k] ? `<em>${KEYDEFS[k].shard}: ${Q.shards[k]}/${SHARDS_PER_KEY}</em>` : '')).join('');
const hasKeyStuff = () => KEY_IDS.some((k) => Q.keys[k] || Q.shards[k]);
// ---------- portales de entrenamiento: se abren con la cadena de misiones (o con el nivel) y el estado se guarda en el personaje ----------
const UNLOCKED = new Set<string>();
const trainOpen = (t: TrainingStep) => UNLOCKED.has(t.id) || trainingUnlocked(t.step, Q.i, P.lvl);
const portalProgress = () => ({ qi: Q.i, lvl: P.lvl, keys: Q.keys as Record<string, number>, unlocked: [...UNLOCKED], faction: selectedFaction });
function refreshUnlocks(_announce: boolean) { /* los portales abiertos los decide el server (inventoryState.unlocked) */ }
/** Seguimiento en el HUD: el Camino del aventurero, los encargos del día y las llaves viejas (la cadena vieja de 10 quedó jubilada). */
function renderQuest() {
    const el = $('quest'), book = bookLines();
    el.hidden = !hasKeyStuff() && !book;
    el.innerHTML = `${book}${hasKeyStuff() ? `<b>Mazmorras</b>${keyLines()}` : ''}`;
    renderQuestLog();
}
// ---------- libro de misiones del corte (cadena de 5, encargos del día, repetible): el server decide todo, acá solo se muestra ----------
let QB: QuestBookView | null = null;
/** Nombres de los materiales (los del suelo los aprende al levantarlos; los de las llaves vienen de @fdn/world). */
const MAT_NAMES: Record<string, string> = { ...Object.fromEntries(Object.entries(QUEST_MATS).map(([id, m]) => [id, m.name])), ...Object.fromEntries(Object.entries(JUNK_MATS).map(([id, m]) => [id, m.name])), ...KEY_MAT_NAMES, [MAT_REFORJA]: 'Piedra de reforja' };
const matName = (id: string) => MAT_NAMES[id] ?? id.replace(/^trophy_/, 'trofeo ').replace(/_/g, ' ');
// ---------- llaves de las mazmorras (docs/LLAVES.md) ----------
const KEY_CHAIN_MATS = [...Object.keys(QUEST_MATS), 'llave_gastada', ...Object.keys(KEY_RECIPES)];
/** La llave que se arma con este material (o la propia llave, si es una). */
const keyFor = (id: string): string | undefined => (KEY_RECIPES[id] ? id : Object.keys(KEY_RECIPES).find((k) => id in KEY_RECIPES[k].mats));
function combineKey(k: string) {
    const why = keyMissing(k, QB?.mats ?? {}, P.gold);
    if (why) { toast(why); return; }
    net.send({ $case: 'econQuestRequest', value: { npcId: '', action: 'combine', key: k } });
}
function keyMatTip(id: string): string {
    const n = QB?.mats[id] ?? 0, k = keyFor(id), r = k ? KEY_RECIPES[k] : undefined;
    const what = KEY_RECIPES[id] ? `Abre ${KEY_RECIPES[id].dungeon}. Cada jugador gasta la suya al entrar.` : id === 'llave_gastada' ? 'La suelta el jefe de la Cueva goblin, una para cada uno.' : `Material de llave: cae en los pits del tramo T${QUEST_MATS[id]?.tier ?? '?'} (niveles ${(QUEST_MATS[id]?.tier ?? 1) * 5 - 4}-${(QUEST_MATS[id]?.tier ?? 1) * 5}).`;
    let recipe = '';
    if (r && k) {
        const parts = Object.entries(r.mats).map(([m, c]) => `${c} ${matName(m).toLowerCase()} (${QB?.mats[m] ?? 0}/${c})`).concat(`${r.gold} de oro`);
        const why = keyMissing(k, QB?.mats ?? {}, P.gold);
        recipe = `<div class="sub">${r.name}: ${parts.join(' + ')}</div>${why ? `<div class="sub">${esc(why)}</div>` : `<div class="row"><button type="button" data-combine="${k}">Armar ${r.name}</button></div>`}`;
    }
    return `<div><div class="iname" style="color:${KEY_RECIPES[id] || id === 'llave_gastada' ? '#ffd24a' : '#b99cff'}">${matName(id)}</div><div class="sub">Material · ×${n}</div><div>${what}</div>${recipe}</div>`;
}
const goalLine = (g: QuestGoal, n: number) => `${g.what}: ${Math.min(n, g.n)}/${g.n}`;
const fmtReset = (ms: number) => { const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000); return h ? `${h} h ${m} min` : `${m} min`; };
function bookLines(): string {
    if (!QB) return '';
    const q = MAIN_QUESTS[QB.m.i]; let out = '';
    if (q && QB.m.st !== 'new' && !qlHidden.has('main')) out += `<b>${q.name}</b>` + (QB.m.st === 'ready' ? '<span>Volvé con el Capitán</span>' : q.goals.map((g, j) => `<span>${goalLine(g, QB!.m.prog[j] ?? 0)}</span>`).join(''));
    // encargos del día: avanzan y se cobran solos (sin NPC), hasta DAILY_LIMIT por día
    const done = QB.d.done.length, full = done >= DAILY_LIMIT, open = full ? [] : QB.d.ids.filter((id) => !QB!.d.done.includes(id));
    if (QB.d.ids.length) out += `<b>Encargos del día ${done}/${DAILY_LIMIT}</b>` + (full ? `<span>Listo por hoy · se renuevan en ${fmtReset(QB.d.resetMs)}</span>` : open.filter((id) => !qlHidden.has('d:' + id)).map((id) => `<span>${goalLine(DAILY_BY_ID.get(id)!.goal, QB!.d.prog[id] ?? 0)}</span>`).join(''));
    return out;
}
const bookSend = (n: Npc, action: string, key = '') => net.send({ $case: 'econQuestRequest', value: { npcId: n.id, action, key } });
/** Sección del libro en el diálogo del Capitán. */
function renderBook(n: Npc) {
    const el = $('qdBook'); el.innerHTML = ''; if (!QB) return;
    const add = (html: string, btns: [string, () => void, boolean?][] = [], row = false) => {
        const div = document.createElement('div'); div.className = row ? 'qw-row' : 'qw-note'; div.innerHTML = row ? `<span>${html}</span>` : html;
        for (const [label, fn, off] of btns) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = !!off; b.onclick = fn; div.appendChild(b); }
        el.appendChild(div);
    };
    // cadena: tarjeta con el diseño del pack (título, texto, objetivos, recompensas) y el botón grande abajo
    const q = MAIN_QUESTS[QB.m.i], main = $('qdMain'), btn = $('qdBtn') as HTMLButtonElement;
    btn.hidden = true; btn.disabled = false; btn.onclick = null;
    if (!q) main.innerHTML = `<h3 class="qw-title done">Camino del aventurero</h3><p class="qw-text">Completaste el camino. Seguí con los encargos del día.</p>`;
    else {
        const rw = q.reward, st = QB.m.st, head = `<h3 class="qw-title${st === 'ready' ? ' done' : ''}">${esc(q.name)}</h3><p class="qw-text"><small>Camino del aventurero ${QB.m.i + 1}/${MAIN_QUESTS.length}</small></p>`;
        const goals = questGoalsHtml(q.goals, st === 'new' ? [] : QB.m.prog);
        if (st === 'ready' && rw.unique?.endsWith('_choice')) {
            // premio a elección: se elige tocando el ícono
            main.innerHTML = `${head}<p class="qw-text">${esc(q.done)}</p>${goals}<div class="qw-rwh">RECOMPENSAS</div><p class="qw-text" style="text-align:center;margin-top:10px">Elegí tu premio:</p><div class="qw-rws">${rewardUniques(rw.unique, CLS.id).map((u) => `<button type="button" class="qw-rw pick" data-pick="${esc(u.name)}" style="--rc:#d8a53c"><span class="ic">${ico({ name: u.name, look: u.look, slot: u.slot, rar: { c: '#d8a53c', k: 3 } })}</span><small>${esc(u.name)}</small></button>`).join('')}</div>`;
            main.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => (b.onclick = () => bookSend(n, 'm_turnin', b.dataset.pick)));
        } else {
            main.innerHTML = `${head}<p class="qw-text">${esc(st === 'ready' ? q.done : q.say)}</p>${goals}<div class="qw-rwh">RECOMPENSAS</div><div class="qw-rws">${mainRewardsHtml(rw)}</div>${st === 'new' && P.lvl < q.minLvl ? `<p class="qw-text" style="text-align:center">Pide nivel ${q.minLvl}.</p>` : ''}`;
            if (st === 'new') { btn.hidden = false; btn.textContent = 'Aceptar'; btn.disabled = P.lvl < q.minLvl; btn.onclick = () => bookSend(n, 'm_accept'); }
            else if (st === 'ready') { btn.hidden = false; btn.textContent = 'Entregar'; btn.onclick = () => bookSend(n, 'm_turnin'); }
        }
    }
    // los encargos del día no pasan por el Capitán: se ven en el HUD y se cobran solos
    const ess = QB.d.ess ? '' : ' El primero del día paga además una Esencia.';
    add(`<b>Encargos del día</b>: se cobran solos al cumplirlos, hasta ${DAILY_LIMIT} por día (${dailyGold(P.lvl)} oro y 10 % de tu nivel cada uno; los de dungeon dan además una llave de ese dungeon para volver a entrar).${ess}`);
    // repetible
    const extra = Object.entries(QB.mats).filter(([id, c]) => c >= REPEAT_MATS && !RESERVED_MATS.has(id));
    add(`<b>Sobrantes</b>: ${REPEAT_MATS} materiales iguales por oro o una piedra de forja.${extra.length ? '' : ' Todavía no juntaste suficientes.'}`);
    for (const [id, c] of extra) add(`${matName(id)} <small>×${c}</small>`, [['Oro', () => bookSend(n, 'r_turnin', `${id}|gold`)], ['Zem', () => bookSend(n, 'r_turnin', `${id}|forge`)]], true);
    const keyMats = Object.keys(QUEST_MATS).filter((id) => QB!.mats[id]).map((id) => `${matName(id)}: ${QB!.mats[id]}`);
    if (keyMats.length) add(`<b>Para las llaves</b>: ${keyMats.join(' · ')}`);
}
/** Objetivos "0 / 20  Qué" del diseño. */
function questGoalsHtml(goals: QuestGoal[], prog: number[]): string {
    return `<div class="qw-goals">${goals.map((g, j) => { const n = Math.min(prog[j] ?? 0, g.n); return `<i class="${n >= g.n ? 'ok' : ''}"><b>${n}</b> / ${g.n}</i><span class="${n >= g.n ? 'ok' : ''}">${esc(g.what)}</span>`; }).join('')}</div>`;
}
const rewardTile = (src: string, n: string, label: string, col = '#7a6a3e') => `<div class="qw-rw" style="--rc:${col}"><span class="ic"><img alt="" src="${src}">${n ? `<em>${n}</em>` : ''}</span><small>${label}</small></div>`;
/** Recompensas de la cadena: exp, oro, piedras de forja y el único (si hay). */
function mainRewardsHtml(rw: MainQuest['reward']): string {
    let h = rewardTile(miscIconUrl('pergamino_quest'), `${rw.expPct}%`, 'Exp. de tu nivel', '#8fd4ff') + rewardTile(miscIconUrl('oro'), String(rw.gold), 'Oro', '#d8a53c');
    if (rw.forge) h += rewardTile(miscIconUrl('piedra_reforja'), String(rw.forge), 'Zem', '#b99cff');
    if (rw.unique) h += rewardTile(miscIconUrl('cofre'), '', rw.unique === 'class_t1_random' ? 'Un único de tu clase' : 'Un único a elección', '#d8a53c');
    return h;
}
// ---------- Libro de hechizos (P): pestaña Habilidades (lista) y Progresión (árbol de desbloqueo por nivel; Talentos llega con el rebirth) ----------
let bookTab: 'list' | 'tree' = 'list', bookLvl = -1;
const spellBookOpen = () => !$('book').hidden;
function toggleSpellBook() { $('book').hidden = spellBookOpen(); $('btip').hidden = true; bookLvl = -1; renderSpellBook(); }
function renderSpellBook() {
    if (!spellBookOpen() || (bookLvl === P.lvl && $('bookPane').dataset.tab === bookTab)) return;
    bookLvl = P.lvl; const pane = $('bookPane'); pane.dataset.tab = bookTab;
    const list = SPELLS.filter((s) => s.id).map((s) => ({ id: s.id!, name: s.name, mp: s.mp, cd: s.cd, col: s.col, key: s.key, range: s.range, castT: s.instant ? undefined : (s.castT ?? CAST_T), instant: s.instant }));
    pane.innerHTML = bookTab === 'list' ? bookListHtml(CLS.id, P.lvl, list) : bookTreeHtml(CLS.id, P.lvl, list);
    for (const b of $('book').querySelectorAll<HTMLButtonElement>('.bk-tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === bookTab));
}
$('book').querySelector('.bk-tabs')!.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]'); if (!b) return; bookTab = b.dataset.tab as 'list' | 'tree'; renderSpellBook(); });
$('bookClose').addEventListener('click', toggleSpellBook);
$('openBook').addEventListener('click', toggleSpellBook);
// tooltip de los nodos del árbol (y de las filas, por si la descripción no entra)
$('bookPane').addEventListener('mouseover', (e) => {
    const n = (e.target as HTMLElement).closest<HTMLElement>('.bk-node'); if (!n) { $('btip').hidden = true; return; }
    const s = SPELLS.find((x) => x.id === n.dataset.spell); if (!s) return;
    const tip = $('btip'); tip.innerHTML = bookTipHtml(CLS.id, { id: s.id!, name: s.name, mp: s.mp, cd: s.cd, col: s.col, key: s.key, range: s.range, castT: s.instant ? undefined : (s.castT ?? CAST_T), instant: s.instant }); tip.hidden = false;
    const r = n.getBoundingClientRect(), w = $('book').getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 270, w.right + 8) + 'px'; tip.style.top = Math.max(8, Math.min(window.innerHeight - 160, r.top - 10)) + 'px';
});
$('bookPane').addEventListener('mouseleave', () => { $('btip').hidden = true; });

// ---------- ventana de Misiones (L): lista a la izquierda, detalle a la derecha ----------
let qlSel = '';
const qlOpen = () => !$('qlog').hidden;
/** Misiones que no se muestran en el seguimiento del HUD (botón Seguir); se guarda en el navegador. */
const qlHidden = new Set<string>(JSON.parse(localStorage.getItem('fdn.qhide') ?? '[]') as string[]);
function toggleQuestLog() { $('qlog').hidden = qlOpen(); renderQuestLog(); }
function renderQuestLog() {
    if (!qlOpen()) return;
    const list = $('qlList'), det = $('qlDetail');
    if (!QB) { list.innerHTML = ''; det.innerHTML = '<div class="ql-empty">Todavía no tenés misiones.</div>'; return; }
    const q = MAIN_QUESTS[QB.m.i], items: { id: string; name: string; done?: boolean }[] = [];
    if (q && QB.m.st !== 'new') items.push({ id: 'main', name: q.name, done: QB.m.st === 'ready' });
    const dailies = QB.d.ids.map((id) => ({ id: 'd:' + id, name: DAILY_BY_ID.get(id)?.name ?? id, done: QB!.d.done.includes(id) }));
    if (!items.some((i) => i.id === qlSel) && !dailies.some((i) => i.id === qlSel)) qlSel = (items[0] ?? dailies[0])?.id ?? '';
    const li = (i: { id: string; name: string; done?: boolean }) => `<button type="button" role="option" class="ql-it${i.done ? ' done' : ''}" data-id="${i.id}" aria-selected="${i.id === qlSel}">${esc(i.name)}</button>`;
    list.innerHTML = `${items.length ? '<div class="ql-sep">Camino del aventurero</div>' + items.map(li).join('') : ''}${dailies.length ? `<div class="ql-sep">Encargos del día ${QB.d.done.length}/${DAILY_LIMIT}</div>` + dailies.map(li).join('') : ''}`;
    list.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => (b.onclick = () => { qlSel = b.dataset.id!; renderQuestLog(); }));
    if (!qlSel) { det.innerHTML = '<div class="ql-empty">Todavía no tenés misiones. Hablá con el Capitán.</div>'; return; }
    let h = '';
    if (qlSel === 'main' && q) {
        const ready = QB.m.st === 'ready';
        h = `<h3 class="qw-title${ready ? ' done' : ''}">${esc(q.name)}</h3><p class="qw-text">${esc(ready ? q.done : q.say)}</p>${ready ? '<p class="qw-text">Volvé con el Capitán para entregarla.</p>' : ''}${questGoalsHtml(q.goals, QB.m.prog)}<div class="qw-rwh">RECOMPENSAS</div><div class="qw-rws">${mainRewardsHtml(q.reward)}</div>`;
    } else {
        const id = qlSel.slice(2), d = DAILY_BY_ID.get(id); if (!d) { det.innerHTML = ''; return; }
        const done = QB.d.done.includes(id), full = QB.d.done.length >= DAILY_LIMIT;
        h = `<h3 class="qw-title${done ? ' done' : ''}">${esc(d.name)}</h3><p class="qw-text">Encargo del día. Se cobra solo al cumplirlo, sin volver a ningún NPC.${done ? ' Ya lo cobraste hoy.' : full ? ` Hoy ya cobraste ${DAILY_LIMIT}: se renueva en ${fmtReset(QB.d.resetMs)}.` : ''}</p>${questGoalsHtml([d.goal], [done ? d.goal.n : QB.d.prog[id] ?? 0])}<div class="qw-rwh">RECOMPENSAS</div><div class="qw-rws">${rewardTile(miscIconUrl('pergamino_diaria'), `${DAILY_EXP_PCT}%`, 'Exp. de tu nivel', '#8fd4ff')}${rewardTile(miscIconUrl('oro'), String(dailyGold(P.lvl)), 'Oro', '#d8a53c')}${QB.d.ess ? '' : rewardTile(miscIconUrl('esencia'), '1', 'Esencia (el 1.º del día)', '#b99cff')}</div>`;
    }
    const hid = qlHidden.has(qlSel);
    det.innerHTML = h + `<div class="ql-foot"><button type="button" class="qw-btn" id="qlTrack">${hid ? 'Seguir' : 'Dejar de seguir'}</button><button type="button" class="qw-btn r" disabled title="Próximamente">Abandonar</button></div>`;
    $('qlTrack').onclick = () => { if (hid) qlHidden.delete(qlSel); else qlHidden.add(qlSel); localStorage.setItem('fdn.qhide', JSON.stringify([...qlHidden])); renderQuest(); renderQuestLog(); };
}
$('qlClose').addEventListener('click', toggleQuestLog);
$('openQuests').addEventListener('click', toggleQuestLog);
/** Al abrir la charla con un NPC: si la misión actual pide hablar con ese rol, se avisa al server. */
function bookTalk(n: Npc) {
    const q = QB && QB.m.st === 'active' ? MAIN_QUESTS[QB.m.i] : undefined;
    if (q?.goals.some((g, j) => g.k === 'talk' && g.role === roleOf(n) && (QB!.m.prog[j] ?? 0) < g.n)) bookSend(n, 'talk');
}
function openQuestDlg(n: Npc) {
    const d = $('qdlg'); shopNpc = n; talkNpc = null;
    $('qdName').textContent = n.name; setDlgAvatar(n); d.hidden = false;
    // la cadena vieja de 10 quedó jubilada: el Capitán da el Camino del aventurero y los encargos del día (renderBook), y sigue forjando las llaves viejas
    $('qdBody').innerHTML = `<b>Forja</b>: ${SHARDS_PER_KEY} esquirlas (las sueltan los jefes) + oro = 1 llave.`;
    $('qdBtn').hidden = true;
    const fg = $('qdForges'); fg.innerHTML = '';
    for (const k of KEY_IDS) {
        const kd = KEYDEFS[k]; if (!Q.shards[k] && !Q.keys[k]) continue;
        const fb = document.createElement('button'); fb.type = 'button'; fb.textContent = `Forjar ${kd.name} (${Q.shards[k]}/${SHARDS_PER_KEY} esq. · ${kd.gold} oro)`; fb.disabled = Q.shards[k] < SHARDS_PER_KEY || P.gold < kd.gold;
        fb.onclick = () => { if (Q.shards[k] < SHARDS_PER_KEY || P.gold < kd.gold) return; net.send({ $case: 'econQuestRequest', value: { npcId: n.id, action: 'forge', key: k } }); };
        fg.appendChild(fb);
    }
    $('qdBody').hidden = !KEY_IDS.some((k) => Q.shards[k] || Q.keys[k]);
    renderBook(n);
}
/** Rango de nivel de una zona de entrenamiento (sale de la tabla vieja de misiones, que se sigue usando solo como dato de zonas). */
/** "!" amarillo sobre el Capitán cuando tiene misión para vos; "?" cuando podés entregar. */
const questMark = () => {
    const bm = QB ? MAIN_QUESTS[QB.m.i] : undefined;
    if (bm && QB!.m.st === 'ready') return '?';
    if (bm && QB!.m.st === 'new' && P.lvl >= bm.minLvl) return '!';
    return '';
};

// ---------- vendedores y servicios de las ciudades: cada NPC tiene un rol (ver roleOf) ----------
// el stock, los precios y los vendedores viven en @fdn/world (economy.ts): el server valida las compras con la misma tabla
const GUARD_LINES: Record<string, string[]> = {
    s: ['El portón del este lleva a las tierras de caza. Si vas a salir, llevate pociones.', 'Dentro de las murallas no pelea nadie: en la villa se descansa y se comercia.', 'El Capitán Aldric tiene encargos para quien sepa pelear. Está en el Ayuntamiento, al norte de la plaza.', 'Herrería, Tienda, Joyería... todo está a unos pasos de la plaza. La subasta es en el Ayuntamiento.'],
    v: ['Vhar no se rinde: las murallas son de hierro y de paciencia. Pasá, pero sin armar lío.', 'Más allá del portón sur, pasando el foso, empieza el páramo. No salgas sin armadura.', 'El Capitán Kharos recluta cazadores. Está en la Casa de Concejo, al norte de la plaza.', 'La fragua no se apaga nunca. Forja, Bazar, Orfebrería... todo está a unos pasos de la plaza. La subasta es en el Concejo.'],
};
/** NPC de servicio sin tienda todavía (charla corta). */
const ROLE_LINES: Record<string, string[]> = {
    sanador: ['Que la marea te devuelva las fuerzas. Si caés en la Frontera, despertarás acá, en el templo.', 'Dentro de la villa las heridas sanan solas. Descansá antes de volver a salir.'],
    mago: ['Próximamente: la Torre abrirá sus puertas a los aprendices de magia.', 'Las runas del piso todavía no están listas. Volvé más adelante.'],
    sanador_v: ['Que el hierro te sostenga. Si caés en la Frontera, despertarás acá, entre las brasas del santuario.', 'Dentro de la ciudadela las heridas cierran solas. Descansá antes de volver a salir.'],
    mago_v: ['Próximamente: la Torre de las Brasas abrirá sus puertas a los aprendices de magia.', 'Las runas del piso todavía no están encendidas. Volvé más adelante.'],
};
let talkNpc: Npc | null = null, shopNpc: Npc | null = null;
const npcDist = (n: Npc) => Math.hypot(n.x + 0.5 - P.x, n.y + 0.5 - P.y);
function talkTo(n: Npc) {
    cancelCast(); P.target = null; P.engage = false; P.pickup = null; P.queued = null;
    if (npcDist(n) <= TALK_RANGE) { openShop(n); return; }
    if (moveTo(n.x + 0.5, n.y + 0.5)) talkNpc = n; else toast('No llegás hasta ahí.');
}
function stockItem(st: Stock): Item {
    const b = ALL_BASES.find((x) => x.name === st.base)!;
    return { id: uid++, ...b, rar: RAR[0], attrs: (st.attrs ?? []).map(([id, v]) => ({ id, v })) };
}
const stockLabel = (st: Stock) => {
    if (st.pot) return `${POTS[st.pot].name}${st.qty! > 1 ? ` ×${st.qty}` : ''}`;
    return st.base!;
};
function stockInfo(st: Stock): string {
    if (st.pot) return st.qty! > 1 ? `Pack · tenés ${pots[st.pot]}` : `Tenés ${pots[st.pot]}`;
    const b = ALL_BASES.find((x) => x.name === st.base)!, bits: string[] = [];
    if (b.dmg) bits.push(`daño ${b.dmg[0]}–${b.dmg[1]}`); if (b.def) bits.push(`def ${b.def}`); if (b.mag) bits.push(`mag +${b.mag}`);
    for (const a of st.attrs ?? []) bits.push(attrText({ id: a[0], v: a[1] }));
    return `${bits.join(' · ') || b.slot} · Nv ${st.lvl}`;
}
/** Casa de subastas (ventana propia en auction.ts; el server valida todo). */
const auction = createAuctionUI({ send: (p) => net.send(p), bag: () => P.bag, gold: () => P.gold, fromInv: itemFromInv, icon: ico, attrText, esc, fmt: fmtNum, toast });
/** Depósito por cuenta (ventana propia en deposit.ts; el server valida todo, ver docs/DEPOSITO.md). */
/** Dar e Intercambiar entre jugadores (ventana propia en trade.ts; el server valida todo, ver docs/INTERCAMBIO.md). */
const trade = createTradeUI({ send: (p) => net.send(p), bag: () => P.bag, gold: () => P.gold, fromInv: itemFromInv, icon: ico, attrText, esc, fmt: fmtNum, toast });
/** Guild (ventana propia en guild.ts; el server valida todo, ver docs/GUILDS.md). El cofre compartido es una pestaña del depósito. */
const guild = createGuildUI({ send: (p) => net.send(p), esc, me: () => P.name, mapName: (id) => getMapDef(id)?.name ?? id, toast });
const deposit = createDepositUI({ send: (p) => net.send(p), bag: () => P.bag, gold: () => P.gold, pots: () => pots, keys: () => Q.keys, shards: () => Q.shards, zem: () => zemBag, fromInv: itemFromInv, icon: ico, attrText, esc, fmt: fmtNum, requestClose: () => closeShop(), guild: () => (guild.state ? { name: guild.state.name, tag: guild.state.tag } : null) });
$('openGuild').addEventListener('click', () => guild.toggle());
/** Burbuja de saludo del NPC (textura NPC Bubble del pack), sobre su cabeza durante unos segundos; sigue a la cámara. */
let bubble: { n: Npc; until: number } | null = null;
function showBubble(n: Npc, title: string, text: string, secs = 5) {
    const el = $('npcBubble'); el.innerHTML = `<b>${title}</b>${text}`; el.hidden = false; bubble = { n, until: now() + secs }; tickBubble();
}
function tickBubble() {
    const el = $('npcBubble'); if (!bubble) { if (!el.hidden) el.hidden = true; return; }
    if (now() > bubble.until || P.dead) { bubble = null; el.hidden = true; return; }
    const p = toScreen(bubble.n.x + 0.5, bubble.n.y + 0.5); el.style.left = p.x + 'px'; el.style.top = p.y - 72 * Z + 'px';
}
/** Retrato del diálogo: inicial del NPC sobre el color de su oficio (hasta tener retratos). */
function setDlgAvatar(n: Npc) { const def = SHOPS[roleOf(n)] ?? SHOPS.guardia; const av = $('qdAv'); av.style.setProperty('--c', def.col); av.querySelector('i')!.textContent = n.name.trim().charAt(0).toUpperCase(); }
function openShop(n: Npc = MAP.npcs[0]) {
    const role = roleOf(n); bookTalk(n);
    if (role === 'subastador') { closeShop(); shopNpc = n; talkNpc = null; auction.open(n); return; }
    if (role === 'depositario') { if (shopNpc !== n) closeShop(); shopNpc = n; talkNpc = null; deposit.open(n); return; }
    if (role === 'capitan') { openQuestDlg(n); return; }
    if (role === 'arenero') { if (shopNpc !== n) closeShop(); openArena(n); return; }
    if (role === 'guardia' || ROLE_LINES[role]) { openTalk(n); return; }
    const def = SHOPS[role]; if (!def) return;
    shopNpc = n; talkNpc = null; $('qdlg').hidden = true; $('shopName').textContent = n.name; $('shopRole').textContent = def.label; $('shop').hidden = false; renderShop();
    showBubble(n, def.label, def.greet); log(`${n.name}: «${def.greet}»`);
}
/** Guardias y otros NPC de ambiente: una charla corta, sin tienda. */
function openTalk(n: Npc) {
    const role = roleOf(n), lines = (n.id.includes('_v') ? ROLE_LINES[role + '_v'] : undefined) ?? ROLE_LINES[role] ?? GUARD_LINES[n.id.endsWith('_v') || n.id.includes('_v') ? 'v' : 's'];
    shopNpc = n; talkNpc = null; $('shop').hidden = true;
    $('qdName').textContent = n.name; setDlgAvatar(n); $('qdlg').hidden = false; $('qdForges').innerHTML = ''; $('qdBtn').hidden = true;
    $('qdBody').innerHTML = `<small>${(SHOPS[role] ?? SHOPS.guardia).label}</small><br>${lines[Math.floor(R() * lines.length)]}`;
}
function closeShop() { shopNpc = null; bubble = null; $('npcBubble').hidden = true; $('shop').hidden = true; $('qdlg').hidden = true; closeArena(); auction.close(); deposit.close(); }
// ---------- ventana de arena (NPC maestro de arena): estado, anotarse, rating y ranking; los datos llegan con `/arena info` ----------
let arenaTimer = 0, arenaTab: '2v2' | '3v3' = '2v2', arenaInfo: ArenaInfo | null = null;
const arenaOpen = () => !$('arena').hidden;
const arenaCmd = (c: string) => { net.send({ $case: 'chatMessageSendRequest', value: { message: `/arena ${c}` } }); setTimeout(() => arenaCmdInfo(), 150); };
const arenaCmdInfo = () => { if (arenaOpen() && connected) net.send({ $case: 'chatMessageSendRequest', value: { message: '/arena info' } }); };
function openArena(n: Npc) {
    shopNpc = n; talkNpc = null; $('shop').hidden = true; $('qdlg').hidden = true;
    $('arena').hidden = false; renderArena(arenaInfo); arenaCmdInfo();
    clearInterval(arenaTimer); arenaTimer = window.setInterval(arenaCmdInfo, 4000); // el estado de la cola cambia solo
}
function closeArena() { clearInterval(arenaTimer); $('arena').hidden = true; }
function renderArena(v: ArenaInfo | null) {
    arenaInfo = v; if (!arenaOpen()) return;
    const fm = (ms: number) => { const m = Math.ceil(ms / 60_000); return m >= 1 ? `${m} min` : `${Math.ceil(ms / 1000)} s`; };
    $('arSeason').textContent = v ? `Temporada ${v.season}` : 'Cargando…';
    const st = $('arState'); st.classList.toggle('pen', !!v && Number(v.penaltyMs) > 0);
    if (!v) st.innerHTML = 'Pidiendo el estado al server…';
    else if (Number(v.penaltyMs) > 0) st.innerHTML = `<b>Penalizado</b>: faltan ${fm(Number(v.penaltyMs))} para poder anotarte.`;
    else if (v.state === 'cola') st.innerHTML = `<b>En cola de ${esc(v.queuedMode)}</b> hace ${fm(Number(v.queuedMs))} · ${v.queuedParties} ${v.queuedParties === 1 ? 'party esperando' : 'parties esperando'}.`;
    else if (v.state === 'invitacion') st.innerHTML = `<b>¡Partida encontrada!</b> Aceptá en el cartel de la derecha.`;
    else if (v.state === 'partida') st.innerHTML = `<b>En partida</b> (${v.matchPhase === 'prep' ? 'preparación' : v.matchPhase === 'fight' ? 'pelea' : 'terminada'}).`;
    else st.innerHTML = v.partySize ? `Tu party tiene <b>${v.partySize}</b>${v.leader ? '' : ' · solo el líder la anota'}.` : 'Sin party: armala con <b>/invitar nombre</b> para anotarte.';
    const can = !!v && !v.state && Number(v.penaltyMs) <= 0 && v.leader;
    $('arModes').innerHTML = v?.state === 'cola' || v?.state === 'invitacion'
        ? `<button type="button" class="qw-btn leave" data-ar="salir">Salir de la cola</button>`
        : `<button type="button" class="qw-btn" data-ar="2v2" ${can && (v!.partySize === 2 || !v!.partySize) ? '' : 'disabled'}>Anotar 2v2</button><button type="button" class="qw-btn" data-ar="3v3" ${can && v!.partySize === 3 ? '' : 'disabled'}>Anotar 3v3</button>`;
    $('arModes').querySelectorAll<HTMLElement>('[data-ar]').forEach((b) => (b.onclick = () => arenaCmd(b.dataset.ar!)));
    $('arRatings').innerHTML = (v?.ratings ?? []).map((r) => `<div class="ar-rt"><b>${esc(r.mode)}</b><em>${r.rating}</em><span>${r.wins}G ${r.losses}P ${r.draws}E</span><small>${r.gamesLeft ? `${r.gamesLeft} más para el ranking` : 'en el ranking'}</small></div>`).join('');
    document.querySelectorAll<HTMLElement>('#arTabs [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === arenaTab)));
    const top = (v?.top ?? []).filter((r) => r.mode === arenaTab);
    $('arTop').innerHTML = top.length ? top.map((r) => `<div class="ar-row"><i>${r.pos}.</i><span>${esc(r.name)}</span><em>${r.rating}</em><small>${r.wins}G ${r.losses}P ${r.draws}E</small></div>`).join('') : `<div class="ar-empty">Todavía nadie tiene ${v?.rankedMin ?? 10} partidas de ${arenaTab} esta temporada.</div>`;
}
$('arClose').addEventListener('click', closeShop);
document.querySelectorAll<HTMLElement>('#arTabs [data-mode]').forEach((b) => (b.onclick = () => { arenaTab = b.dataset.mode as '2v2' | '3v3'; renderArena(arenaInfo); }));
/** Oferta del día (global, la manda el server): líneas comunes con descuento y, cada tanto, la estrella con el roll ya tirado (stock 1 de todo el server). */
let daily: { base: string; quality: number; attrs: Item['attrs']; price: number; star: boolean; sold: boolean }[] = [];
const dailyItem = (o: (typeof daily)[number]): Item => ({ ...(ALL_BASES.find((x) => x.name === o.base) ?? ALL_BASES[0]), id: -1, rar: RAR[o.quality], attrs: o.attrs });
function dailyRows(): string {
    return daily.map((o, i) => {
        const it = dailyItem(o), poor = P.gold < o.price, info = o.attrs.length ? o.attrs.map(attrText).join(' · ') : 'Sin atributos extra';
        const tag = o.star ? (o.sold ? ' — VENDIDA' : ' ★ ESTRELLA') : '';
        return `<button type="button" class="srow${poor || o.sold ? ' poor' : ''}" data-daily="${i}" ${o.sold ? 'disabled' : ''} title="${esc(info)}">${ico(it)}<span style="color:${it.rar.c}">${esc(it.name)}${tag}<small>${it.rar.n} · ${it.slot} · ${esc(info)}</small></span><em>${o.price}</em></button>`;
    }).join('');
}
const junkTotal = (): { n: number; gold: number } => { let n = 0, gold = 0; for (const [id, q] of Object.entries(QB?.mats ?? {})) { const v = junkValue(id); if (v > 0 && q > 0) { n += q; gold += v * q; } } return { n, gold }; };
function renderShop() {
    if ($('shop').hidden || !shopNpc) return;
    const def = SHOPS[roleOf(shopNpc)];
    $('shopGold').textContent = fmtNum(P.gold);
    const buy = def.stock.map((st, i) => {
        const it = st.base ? stockItem(st) : null, poor = P.gold < st.price;
        const icon = it ? ico(it) : `<img class="iico" alt="" src="${potionIcon(st.pot!)}">`;
        return `<button type="button" class="srow${poor ? ' poor' : ''}" data-buy="${i}" title="${esc(stockInfo(st))}">${icon}<span style="color:${it ? '#e7e2d3' : POTS[st.pot!].col}">${esc(stockLabel(st))}<small>${esc(stockInfo(st))}</small></span><em>${st.price}</em></button>`;
    }).join('');
    const junk = junkTotal(), dailyBlock = roleOf(shopNpc) === 'mercader' && daily.length ? `<div class="label">Oferta del día (cambia a diario, igual para todos)</div>${dailyRows()}` : '';
    // la basura se vende toda junta desde el pie de la ventana (el "REPAIR ME" del diseño)
    $('shopJunk').innerHTML = junk.n ? `<button type="button" class="qw-btn" id="sellJunk" title="${junk.n} material${junk.n > 1 ? 'es' : ''} del botín">Vender basura · ${junk.gold} oro</button>` : '';
    $('shopList').innerHTML = `${dailyBlock}<div class="label">Comprar</div>${buy}<div class="label">Tu bolsa · tocá un item para venderlo</div>` + (P.bag.length
        ? P.bag.map((it, i) => `<button type="button" class="srow" data-sell="${i}">${ico(it)}<span style="color:${it.rar.c}">${esc(it.name)}<small>${it.rar.n} · ${it.slot}</small></span><em>${sellPrice(it.name, it.rar.k)}</em></button>`).join('')
        : `<div class="label">La bolsa está vacía</div>`);
    document.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => (b.onclick = () => buyStock(def.stock[+b.dataset.buy!])));
    document.querySelectorAll<HTMLElement>('[data-daily]').forEach((b) => (b.onclick = () => {
        const i = +b.dataset.daily!, o = daily[i]; if (!o || !shopNpc) return;
        if (P.gold < o.price) { toast('No te alcanza el oro.'); return; } // aviso rápido; la decisión es del server
        net.send({ $case: 'econBuyRequest', value: { npcId: shopNpc.id, stockIndex: 1000 + i } });
    }));
    document.getElementById('sellJunk')?.addEventListener('click', () => { if (shopNpc) net.send({ $case: 'econSellRequest', value: { npcId: shopNpc.id, uid: 0 } }); });
    document.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => (b.onclick = () => sellItem(+b.dataset.sell!)));
}
function buyStock(st: Stock) {
    if (!shopNpc) return;
    const index = SHOPS[roleOf(shopNpc)].stock.indexOf(st);
    if (P.gold < st.price) { toast('No te alcanza el oro.'); return; } // aviso rápido; la decisión es del server
    net.send({ $case: 'econBuyRequest', value: { npcId: shopNpc.id, stockIndex: index } });
}
function sellItem(i: number) {
    const it = P.bag[i]; if (!it || !shopNpc) return;
    net.send({ $case: 'econSellRequest', value: { npcId: shopNpc.id, uid: it.id } });
}
/** Abre la tienda al llegar y la cierra si te alejás. */
function npcTick() {
    if (talkNpc && !P.mv && npcDist(talkNpc) <= TALK_RANGE) openShop(talkNpc);
    else if (talkNpc && !P.mv && !P.path.length) { talkNpc = null; }
    if (shopNpc && (npcDist(shopNpc) > TALK_RANGE + 1.5 || P.dead)) closeShop();
}
$('shopClose').addEventListener('click', closeShop); $('pothp').addEventListener('click', () => { usePotion('hp'); cv.focus({ preventScroll: true }); }); $('potmp').addEventListener('click', () => { usePotion('mp'); cv.focus({ preventScroll: true }); }); renderPots(); $('qdClose').addEventListener('click', closeShop);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shopNpc) closeShop(); });

// ---------- cambio de mapa: el mapa cargado se reemplaza entero (docs/MUNDO.md 2.3 y 2.4) ----------
let LINKS: Link[] = MAP_DEF.links;
/** Los vínculos entre mapas se dibujan con el portal de piedra de portal.ts (como un waypoint chico). */
let LINK_WPS: Waypoint[] = [];
const LINK_COL: Record<Link['kind'], string> = { walk: '#9fd18b', portal: '#c78bff', oneway: '#9fd0ff', door: '#e2b04a', npc: '#d9d2b8', enter: '#f3dfa6' };
const linkWps = (links: Link[]): Waypoint[] => links.filter((l) => l.kind !== 'enter' && l.kind !== 'walk').map((l) => ({ id: `link:${l.id}`, x: l.x, y: l.y, kind: 'zone' as const, name: getMapDef(l.to.map)?.name ?? l.to.map, step: 0 }));
LINK_WPS = linkWps(LINKS);
let mapLoading = false;
/**
 * Arma el mapa `def` y todo lo que depende de él: grillas, props, zonas, edificios, NPCs, portales, luces. Cliente y server arman el
 * mismo mapa con el mismo código; la comparación de `mapHash` lo verifica. Devuelve el hash del mapa armado.
 */
/** Mediciones (Fase 3): ms de armar el último mapa (`def.build()` + estado) y de pintar su minimapa; cuadros por segundo. */
/** Diagnóstico de fluidez (`/diag`): cuadros, ping y correcciones del server, de los últimos segundos. Siempre junta datos (barato); solo se dibuja si se prende. */
const diag = {
    on: false, el: null as HTMLElement | null, timer: 0,
    frames: [] as { t: number; ms: number }[], snaps: [] as number[], posSent: [] as number[], rtts: [] as { t: number; ms: number }[], sent: new Map<number, number>(),
    frame(tf: number, t: number, dt: number) { this.frames.push({ t, ms: dt * 1000 }); void tf; },
    renders: [] as { t: number; ms: number }[],
    render(ms: number) { this.renders.push({ t: now(), ms }); },
    ping(seq: number) { this.sent.set(seq, performance.now()); if (this.sent.size > 20) this.sent.delete(this.sent.keys().next().value as number); },
    pong(seq: number) { const t0 = this.sent.get(seq); if (t0 === undefined) return; this.sent.delete(seq); this.rtts.push({ t: now(), ms: performance.now() - t0 }); },
    text(): string {
        const t = now(), cut = (a: { t: number }[], s: number) => { while (a.length && t - a[0].t > s) a.shift(); };
        cut(this.frames, 5); cut(this.rtts, 30); cut(this.renders, 5);
        while (this.snaps.length && t - this.snaps[0] > 60) this.snaps.shift();
        while (this.posSent.length && t - this.posSent[0] > 2) this.posSent.shift();
        const f = this.frames.map((x) => x.ms), avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), max = Math.max(0, ...f), long = f.filter((x) => x > 25).length;
        const r = this.rtts.map((x) => x.ms), ra = r.reduce((a, b) => a + b, 0) / Math.max(1, r.length), rm = Math.max(0, ...r);
        return `cuadros: ${(1000 / Math.max(1, avg)).toFixed(0)} fps · peor cuadro ${max.toFixed(0)} ms · tirones >25 ms: ${long} (5 s) · dibujo ${(this.renders.reduce((a, b) => a + b.ms, 0) / Math.max(1, this.renders.length)).toFixed(1)} ms (máx ${Math.max(0, ...this.renders.map((x) => x.ms)).toFixed(1)}) · tope ${fpsCap || 'libre'}\nping: ${r.length ? ra.toFixed(0) : '?'} ms (máx ${rm.toFixed(0)}) · posiciones enviadas: ${(this.posSent.length / 2).toFixed(0)}/s\ncorrecciones del server: ${this.snaps.length} (último minuto)`;
    },
    toggle() {
        this.on = !this.on;
        if (!this.on) { this.el?.remove(); this.el = null; clearInterval(this.timer); log('Diagnóstico apagado.'); return; }
        const el = document.createElement('pre'); this.el = el;
        el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;margin:0;padding:6px 8px;background:#000a;color:#9fe8a8;font:12px/1.4 monospace;border-radius:4px;pointer-events:none;white-space:pre';
        document.body.appendChild(el);
        const tick = () => { if (this.el) this.el.textContent = this.text(); }; tick(); this.timer = window.setInterval(tick, 500);
        log('Diagnóstico prendido (arriba a la izquierda). /diag lo apaga. Si algo se siente mal, sacá una captura con los números.');
    },
};
const perf = { build: 0, minimap: 0, fps: 0, frames: 0, since: 0 };
function loadMap(def: MapDef): string {
    const t0 = performance.now();
    if (MAP_DEF?.id !== def.id && def.name) logToChat('system', 'System', `Entraste a ${def.name}.`);
    MAP_DEF = def; MAP = def.build(); N = MAP.size; lastRed = null;
    ({ tiles, blocked, safe, props, decals } = MAP);
    ZONES = MAP.zones; WAYPOINTS = MAP.waypoints ?? []; LINKS = def.links; LINK_WPS = linkWps(LINKS);
    // lo que era del mapa anterior: mobs, otros jugadores, suelo, efectos, estado de portales y diálogos
    P.target = null; P.engage = false; P.pickup = null; P.queued = null; // checklist de instancia: al cambiar de mapa no queda nada apuntando al mapa viejo
    mobs.length = 0; mobMap.clear(); others.clear(); drops.length = 0; corpses.length = 0; projs.length = 0; scorch.length = 0; floats.length = 0; fx.length = 0; bossCasts.clear(); bossMarks.length = 0; bossZones.clear(); bossRage.clear();
    portalAct.clear(); wpInside = ''; closeWp(); closeShop(); talkNpc = null; talkWpTarget = null;
    P.target = null; P.engage = false; P.pickup = null; P.queued = null; P.foe = null; P.path = []; P.mv = false; hover = null; hoverDrop = null;
    cancelCast(); pveT = 0; // el server de este mapa todavía no sabe si estoy muerto ni mi nivel
    portalLock = now() + 2.5; // llegás al lado del portal de vuelta: que no te rebote
    refreshNpcLook(); // los NPC del mapa nuevo (por ejemplo los de un interior) arman su muñeco acá
    const h = mapHash(MAP);
    perf.build = performance.now() - t0;
    if (perf.build > 150) console.log(`[mapa] ${def.id} armado en ${perf.build.toFixed(0)} ms`);
    return h;
}
const loadEl = () => $('maploading');
/** Barra de la pantalla de viaje: 0.1 al mostrarla, 0.7 con el mapa armado (esperando al server), 1 al entrar. */
const setMapLoading = (k: number) => { ($('mlFill') as HTMLElement).style.width = `${Math.round(k * 100)}%`; };
/**
 * Único estado del que dependen HUD, chat y minimapa (`body.world-ready`, ver ui/loading-craftpix.css). Va a true recién con el estado
 * inicial recibido y el mapa dibujado; al login, al elegir personaje y al cambiar de mapa vuelve a false.
 */
let worldReady = false;
const setWorldReady = (v: boolean) => { worldReady = v; document.body.classList.toggle('world-ready', v); };
/** Llegó el estado inicial y falta dibujar el mapa; el telón se levanta al final del próximo cuadro. */
let revealPending = false;
/** Hasta cuándo (segundos de `now()`) esperar el viaje a la ciudad propia antes de destapar, por si el server no lo hace. */
let homeWaitUntil = 0;
const HOME_WAIT_S = 3;
let curtainTimer = 0;
function showMapLoading(name: string, lvl: [number, number] | null, tier?: number) {
    clearTimeout(curtainTimer); revealPending = false; homeWaitUntil = 0; mapLoading = true; setWorldReady(false);
    const el = loadEl(); el.classList.remove('err', 'out'); el.dataset.since = String(performance.now());
    $('mlName').textContent = name; $('mlLvl').textContent = lvl ? `${tier ? `Zona T${tier} · ` : ''}Nivel recomendado ${lvl[0]}–${lvl[1]}` : ''; $('mlMsg').textContent = 'Loading...';
    setMapLoading(0.1);
    el.hidden = false; // sin fundido de entrada: tapa en el acto, para que no se vea el mapa viejo ni el nuevo a medio armar
}
/** Levanta el telón: destapa el mundo y funde la pantalla de viaje (se queda al menos 600 ms para que no parpadee). */
function hideMapLoading() {
    revealPending = false; homeWaitUntil = 0; clearTimeout(curtainTimer);
    const el = loadEl(); setMapLoading(1);
    const wait = Math.max(0, 600 - (performance.now() - Number(el.dataset.since ?? 0)));
    curtainTimer = window.setTimeout(() => {
        mapLoading = false; setWorldReady(true); el.classList.add('out');
        curtainTimer = window.setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 350);
    }, wait);
}
/** Saca el telón sin entrar al mundo: se cortó la conexión o el server rechazó el personaje elegido. */
function dropMapLoading() {
    clearTimeout(curtainTimer); revealPending = false; homeWaitUntil = 0; mapLoading = false; setWorldReady(false);
    const el = loadEl(); el.hidden = true; el.classList.remove('err', 'out');
}
function failMapLoading(msg: string) {
    clearTimeout(curtainTimer); revealPending = false; homeWaitUntil = 0; mapLoading = true; setWorldReady(false);
    const el = loadEl(); el.classList.remove('out'); el.classList.add('err'); el.hidden = false; $('mlMsg').textContent = msg; setMapLoading(1);
    net.close();
}
/** El server me sacó del mundo anterior: pantalla de carga, armo el mapa, verifico el hash y aviso MapReady (recién ahí me mete en el nuevo). */
function onMapTransfer(v: { mapId: string; name: string; x: number; y: number; direction: number; mapHash: string; gameWorldId: string; lvlMin: number; lvlMax: number }) {
    P.path = []; P.mv = false; P.target = null; P.engage = false;
    showMapLoading(v.name || v.mapId, v.lvlMax ? [v.lvlMin, v.lvlMax] : null, getMapDef(v.mapId)?.tier);
    // dejar que el navegador pinte la pantalla de carga antes de armar el mapa
    requestAnimationFrame(() => setTimeout(() => {
        const def = getMapDef(v.mapId);
        if (!def) { failMapLoading(`Este juego no conoce el mapa «${v.mapId}». Recargá la página.`); return; }
        const h = loadMap(def);
        if (h !== v.mapHash) { failMapLoading('Tu juego está desactualizado y armó un mapa distinto al del server. Recargá la página.'); return; }
        MAP_WORLD_ID = v.gameWorldId;
        snapTo(v.x, v.y);
        const [dx, dy] = GRID_VEC[v.direction] ?? [0, 1]; turnTo(P, dx, dy, 0, true);
        const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y;
        net.send({ $case: 'mapReady', value: { mapId: def.id, mapHash: h } });
        $('mlMsg').textContent = 'Entrando...'; setMapLoading(0.7);
    }, 30));
}
/** Cruce de un vínculo entre mapas: el cliente solo pide por id; el server valida distancia, requisitos y estado. */
function checkLinks() {
    if (!connected || P.dead || P.mv || now() < portalLock) return;
    const l = LINKS.find((q) => q.x === P.cell.x && q.y === P.cell.y); if (!l) return;
    const why = linkGateReason(l, portalProgress(), (i) => QUESTS[i]?.name);
    if (why) { portalLock = now() + 2; toast(why); log(why, true); return; }
    portalLock = now() + 3; P.path = []; P.target = null; P.engage = false; P.pickup = null;
    net.send({ $case: 'portalRequest', value: { portalId: l.id } });
    log(l.msg, true);
}
// ---------- escaleras entre zonas (el server valida el teletransporte; la celda de destino tiene que estar libre) ----------
let portalLock = 0;
function checkPortals() {
    if (!MAP.portals || !connected || P.dead || P.mv || now() < portalLock) return;
    const p = MAP.portals.find((q) => q.x === P.cell.x && q.y === P.cell.y); if (!p) return;
    if (p.train) {
        const why = portalGate(p, portalProgress());
        if (why) { portalLock = now() + 2; toast(`Portal bloqueado: ${p.train.zone}`); log(why, true); return; }
    }
    if (p.key) {
        const kid = p.key as KeyId, kd = KEYDEFS[kid];
        if (Q.keys[kid] < 1) { portalLock = now() + 2; toast(`La escalera está sellada: necesitás una ${kd.name}.`); log(`La escalera está sellada. Forjá una ${kd.name} con el Capitán: ${SHARDS_PER_KEY} esquirlas (las sueltan los bosses) y ${kd.gold} de oro.`, true); return; }
        log(`Usaste una ${kd.name}.`, true); // el server descuenta la llave al cruzar
    }
    portalLock = now() + 1.5; P.path = []; P.target = null; P.engage = false; P.pickup = null;
    net.send({ $case: 'playerTeleportRequested', value: { x: p.tx, y: p.ty } });
    log(p.msg, true);
}
// ---------- menú del Portal de Frontera: zonas de entrenamiento en orden de progresión; el server valida el viaje ----------
let wpOpen: Waypoint | null = null, talkWpTarget: Waypoint | null = null, wpInside = '';
const WP_OPEN_DIST = 2.2, WP_CLOSE_DIST = WAYPOINT_RANGE - 0.3;
const wpDist = (q: Waypoint) => Math.hypot(q.x + 0.5 - P.x, q.y + 0.5 - P.y);
function pickWaypoint(sx: number, sy: number): Waypoint | null {
    const g = toGrid(sx, sy); let best: Waypoint | null = null, bd = Infinity;
    for (const q of MY_WPS()) { const d = Math.hypot(q.x + 0.5 - g.x, q.y + 0.5 - g.y); if (d <= (q.kind === 'city' ? 2 : 1.1) && d < bd) { bd = d; best = q; } }
    return best;
}
function talkWp(q: Waypoint) {
    cancelCast(); P.target = null; P.engage = false; P.pickup = null; P.queued = null;
    if (wpDist(q) <= WP_OPEN_DIST) { openWp(q); return; }
    if (moveTo(q.x + 0.5, q.y + 0.5)) talkWpTarget = q; else toast('No llegás hasta ahí.');
}
/** Paso de la zona de entrenamiento donde estás parado (o cerca), para resaltarla en el menú; -1 si ninguna. */
function currentTrainStep(): number {
    let best = -1, bd = Infinity;
    void bd; best = trainingOfMap(MAP_DEF.id)?.step ?? best;
    return best;
}
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 017 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="7" width="10" height="7" rx="1.4" fill="currentColor"/></svg>';
const inHomeCity = () => factionHome(selectedFaction)?.map === MAP_DEF.id;
const lockMsg = (t: TrainingStep) => trainingLockedMsg(t);
function renderWp() {
    if (!wpOpen) return;
    const city = selectedFaction === 'solmar' ? { name: 'Villa de Solmar' } : selectedFaction === 'vhar' ? { name: 'Ciudadela de Vhar' } : MAP.cities?.find((c) => c.faction === selectedFaction), inCity = inHomeCity(), cur = inCity ? -1 : currentTrainStep();
    $('wpTitle').textContent = 'Portal de Frontera';
    $('wpSub').textContent = `${city?.name ?? 'Tu ciudad'} · zonas de entrenamiento · para volver apretá H`;
    const rows = [`<button type="button" class="wprow home${inCity ? ' cur' : ''}" data-wp="city"${inCity ? ' disabled' : ''}><i class="wpn">&#8962;</i><span class="wpt"><b>${inCity ? 'Estás en ' : 'Volver a '}${esc(city?.name ?? 'la ciudad')}</b><small>${inCity ? 'Zona segura' : 'Zona segura · tu facción'}</small></span>${inCity ? '<em class="wptag">Estás aquí</em>' : ''}</button>`];
    for (const t of TRAINING) {
        const open = trainOpen(t), here = t.step === cur, ml = getMapDef(t.map)?.lvl, lv = ml ? `Nv ${ml[0]}–${ml[1]}` : '';
        const sub = open ? `<small>Nivel recomendado ${lv.replace('Nv ', '')}</small>` : `<small class="req">${LOCK_SVG} ${t.onFoot ? 'Llegá a pie una vez' : `Nivel ${t.lvl}`}</small>`;
        rows.push(`<button type="button" class="wprow${open ? '' : ' locked'}${here ? ' cur' : ''}" data-wp="${t.id}" style="--zc:${t.col}"><i class="wpn">${t.step + 1}</i><span class="wpt"><b>${esc(t.zone)}</b>${sub}</span>${here ? '<em class="wptag">Estás aquí</em>' : `<em class="wplv">${lv}</em>`}</button>`);
    }
    $('wpList').innerHTML = rows.join('');
    document.querySelectorAll<HTMLElement>('[data-wp]').forEach((b) => (b.onclick = () => wpGo(b.dataset.wp!)));
}
function openWp(q: Waypoint) { talkWpTarget = null; closeShop(); wpOpen = q; $('wpmenu').hidden = false; renderWp(); }
function closeWp() { wpOpen = null; talkWpTarget = null; $('wpmenu').hidden = true; }
function wpGo(id: string) {
    if (!wpOpen || !connected || P.dead) return;
    let dest = 'la ciudad';
    if (id === 'city') { if (inHomeCity()) return; }
    else {
        const t = TRAINING.find((q) => q.id === id); if (!t) return;
        if (!trainOpen(t)) { toast(`Portal bloqueado: ${t.zone}`); log(lockMsg(t), true); return; }
        dest = t.zone;
    }
    portalLock = now() + 1.5; P.path = []; P.target = null; P.engage = false; P.pickup = null;
    net.send({ $case: 'waypointRequest', value: { id } });
    log(`Cruzás el portal: ${dest}.`, true);
    closeWp();
}
/** Abre el menú al llegar (click) o al pisar el waypoint, y lo cierra si te alejás. */
function wpTick() {
    if (talkWpTarget && !P.mv && wpDist(talkWpTarget) <= WP_OPEN_DIST) openWp(talkWpTarget);
    else if (talkWpTarget && !P.mv && !P.path.length) talkWpTarget = null;
    if (wpOpen && (wpDist(wpOpen) > WP_CLOSE_DIST || P.dead || !connected)) closeWp();
    const on = connected && !P.dead ? MY_WPS().find((q) => q.x === P.cell.x && q.y === P.cell.y) : undefined;
    if (!on) wpInside = '';
    else if (wpInside !== on.id && !P.mv && now() >= portalLock) { wpInside = on.id; if (!wpOpen) openWp(on); }
}
$('wpClose').addEventListener('click', closeWp);

// ---------- menú GM (F9 o /gm menu): solo abre si el server te reconoce como GM (FDN_GM); todo se resuelve con comandos /gm ----------
const GM_TAG = '\u0001GMMENU';
interface GmData { maps: { id: string; name: string; lvl: string; tier?: number; kind?: 'ciudad' | 'caza' | 'mazmorra' | 'sin_entrada'; dungeon: boolean }[]; players: { name: string; map: string }[]; here: string; mobs: string[] }
let gmLast: GmData | null = null;
const gmSend = (cmd: string) => net.send({ $case: 'chatMessageSendRequest', value: { message: '/gm ' + cmd } });
function toggleGm() { const el = $('gmmenu'); if (!el.hidden) { el.hidden = true; return; } gmSend('menu'); }
function renderGm(d: GmData) {
    gmLast = d;
    const el = $('gmmenu'); el.hidden = false;
    const btn = (cmd: string, label: string) => `<button type="button" data-gm="${esc(cmd)}">${label}</button>`;
    const mapRow = (x: GmData['maps'][number]) => `<button type="button" class="gmmap${x.id === d.here ? ' cur' : ''}" data-gm="ir ${esc(x.id)}"><span>${esc(x.name)}</span><small>${x.tier ? 'T' + x.tier + ' · ' : ''}${x.lvl ? 'Nv ' + esc(x.lvl) : ''}</small></button>`;
    const kind = (x: GmData['maps'][number]) => x.kind ?? (x.dungeon ? 'mazmorra' : 'caza');
    const section = (title: string, k: string, empty = '') => { const rows = d.maps.filter((x) => kind(x) === k); return rows.length ? `<h3>${title}</h3>${rows.map(mapRow).join('')}` : empty; };
    el.innerHTML = `<h2><span>Menú GM</span><button type="button" id="gmClose" aria-label="Cerrar">×</button></h2>
      <h3>Rápido</h3><div class="gmrow">${btn('curar', 'Curar')}${btn('dios', 'Modo dios')}${btn('llaves 20', 'Llaves ×20')}${btn('oro 10000', '+10.000 oro')}${btn('vel 200', 'Vel 200')}${btn('vel 250', 'Vel 250')}${btn('vel 336', 'Vel 336 (HB)')}${btn('vel 420', 'Vel 420')}${btn('nivel 12', 'Nv 12')}${btn('nivel 30', 'Nv 30')}${btn('nivel 40', 'Nv 40')}${btn('bis', 'Set BiS mago')}${btn('limpiar', 'Limpiar mobs')}</div>
      <h3>Jugadores conectados</h3>${d.players.length ? d.players.map((p) => `<div class="gmrow"><span>${esc(p.name)} <small>${esc(p.map)}</small></span>${btn('traer ' + p.name, 'Traer acá')}${btn('ira ' + p.name, 'Ir con él')}</div>`).join('') : '<small>No hay nadie más conectado.</small>'}
      <div class="gmrow">${btn('menu', 'Actualizar')}</div>
      <h3>Invocar mob</h3><div class="gmrow"><select id="gmMob">${d.mobs.map((t) => `<option>${esc(t)}</option>`).join('')}</select><input id="gmLvl" type="number" min="1" max="60" placeholder="Nv"><input id="gmN" type="number" min="1" max="20" value="1"><button type="button" id="gmSummon">Invocar</button></div>
      ${section('Ciudades', 'ciudad')}${section('Mapas de caza', 'caza')}${section('Mazmorras', 'mazmorra', '<h3>Mazmorras</h3><small>Todavía no hay.</small>')}${section('Sin entrada todavía', 'sin_entrada')}`;
}
$('gmmenu').addEventListener('click', (e) => {
    const t = e.target as HTMLElement, b = t.closest('button'); if (!b) return;
    if (b.id === 'gmClose') { $('gmmenu').hidden = true; return; }
    if (b.id === 'gmSummon') {
        const type = ($('gmMob') as HTMLSelectElement).value, lvl = ($('gmLvl') as HTMLInputElement).value.trim(), n = ($('gmN') as HTMLInputElement).value.trim() || '1';
        gmSend(`mob ${type} ${lvl || '0'} ${n}`); return;
    }
    const cmd = b.dataset.gm; if (!cmd) return;
    gmSend(cmd);
    if (cmd.startsWith('ir ')) $('gmmenu').hidden = true;                            // viajar: el menú se cierra
    else if (/^(traer|ira) /.test(cmd) && gmLast) setTimeout(() => gmSend('menu'), 700); // y se refresca la lista de jugadores
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wpOpen) closeWp(); });
/** Niebla del mapa (`WorldMap.fog`, Camposanto Viejo): velo gris y bancos de niebla que se desplazan despacio con parallax. En pantalla. */
function drawFog(k: number, T: number) {
    ctx.save();
    ctx.fillStyle = `rgba(150,160,176,${0.1 * k})`; ctx.fillRect(0, 0, W, H);
    const t = reduce ? 0 : T, WW = W + 700, HH = H + 500;
    for (let i = 0; i < 8; i++) {
        const sx = (((i * 397 + t * 9 * (1 + (i % 3)) - cam.x * 0.5) % WW) + WW) % WW - 350, sy = (((i * 211 + Math.sin(t * 0.13 + i) * 30 - cam.y * 0.5) % HH) + HH) % HH - 250, r = 200 + (i % 3) * 90;
        ctx.save(); ctx.translate(sx, sy); ctx.scale(1.9, 0.55);
        const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, r); fg.addColorStop(0, `rgba(196,204,214,${0.2 * k})`); fg.addColorStop(1, 'rgba(196,204,214,0)');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
}
const inDungeon = (gx: number, gy: number) => [MAP.dungeon, ...(MAP.dungeons ?? [])].some((d) => !!d && gx >= d.x0 && gx < d.x1 + 1 && gy >= d.y0 && gy < d.y1 + 1);

// ---------- loop ----------
/** Clave del mundo donde estoy (mapa o mapa#instancia): la manda el server y va en cada requestMovement. */
let MAP_WORLD_ID = '';
let last = now(), lastCam = now();
// ---------- minimapa (minimap.ts): se crea al entrar al mundo, se re-arma cuando loadMap() cambia MAP y los marcadores van a ~10 fps ----------
let minimap: Minimap | null = null, minimapOf: WorldMap | null = null;
function minimapTick() {
    if (!connected) return;
    minimap ??= createMinimap($('game'), { active: () => connected && !mapLoading });
    if (minimapOf !== MAP) { minimapOf = MAP; const t0 = performance.now(); minimap.setMap(MAP, { id: MAP_DEF.id, name: MAP_DEF.name }); perf.minimap = performance.now() - t0; }
    minimap.tick(() => ({
        player: { x: P.x, y: P.y, dir: P.dir },
        party: [], // todavía no hay grupos en el cliente
        others: [...others.values()].filter((o) => !o.gone && !unseen(o)).map((o) => ({ x: o.x, y: o.y, faction: facOf(o.profile) })),
        mobs, npcs: MAP.npcs.map((n) => ({ x: n.x, y: n.y, role: roleOf(n) })),
    }));
}
/** Tope de cuadros por segundo (0 = libre: sigue al monitor, 144/240 Hz). Se cambia con /fps y se recuerda. */
let fpsCap = (() => { try { const v = Number(localStorage.getItem('fdn.fpscap')); return v >= 20 && v <= 1000 ? v : 0; } catch { return 0; } })();
let lastDrawTs = 0;
function frame(ts: number = performance.now()) {
    if (fpsCap > 0 && lastDrawTs && ts - lastDrawTs < 1000 / fpsCap - 1.5) { requestAnimationFrame(frame); return; }
    lastDrawTs = ts;
    // El paso de simulación sale del reloj del propio cuadro (rAF), que es parejo; performance.now() dentro del callback varía con la carga y mete temblor al moverse.
    const T = now(); const tf = ts / 1000; let dt = Math.min(0.1, Math.max(0, tf - last)); diag.frame(tf, T, dt); last = tf;
    if (hitstop > 0) { hitstop -= dt; dt = 0; }
    if (!mapLoading) { update(dt); checkPortals(); checkLinks(); wpTick(); npcTick(); }
    updateCam(Math.min(0.05, T - lastCam)); lastCam = T;
    updateHover(); { const r0 = performance.now(); render(); diag.render(performance.now() - r0); } hud(); winTick(T); minimapTick();
    if (revealPending && T >= homeWaitUntil) hideMapLoading(); // el mapa ya se dibujó en este cuadro
    requestAnimationFrame(frame);
    perf.frames++; { const t = performance.now(); if (t - perf.since >= 1000) { perf.fps = (perf.frames * 1000) / (t - perf.since); perf.frames = 0; perf.since = t; } }
}

// ---------- entrada ----------
function storedId(name: string): string {
    const key = `fdn:id:${name.toLowerCase()}`;
    try { const v = localStorage.getItem(key); if (v) return v; } catch { /* sin almacenamiento */ }
    const id = crypto.randomUUID();
    try { localStorage.setItem(key, id); } catch { /* sin almacenamiento */ }
    return id;
}
try { const f = localStorage.getItem('fdn:faction'); if (FACTIONS.some((x) => x.id === f)) selectedFaction = f!; } catch { /* sin almacenamiento */ }
let selectedClass = 'paladin';
try { const c = localStorage.getItem('fdn:class'); if (CLASSES.some((x) => x.id === c && !x.hidden)) selectedClass = c!; } catch { /* sin almacenamiento */ }
// pantallas de login / selección / clase / facción / creación (ver loginui.ts)
const flow = initLoginUI({
    classes: CLASSES.filter((c) => !c.hidden), factions: FACTIONS, spellName: (id) => LIB[id]?.name ?? id,
    cityName: (f) => f === 'solmar' ? 'Villa de Solmar' : f === 'vhar' ? 'Ciudadela de Vhar' : HUBS[f] ? (cityAt(HUBS[f].x, HUBS[f].y)?.name ?? 'Ciudad de ' + f) : f,
    get: () => ({ cls: selectedClass, faction: selectedFaction }),
    set: (p) => {
        if (p.cls) { selectedClass = p.cls; try { localStorage.setItem('fdn:class', selectedClass); } catch { /* sin almacenamiento */ } }
        if (p.faction) { selectedFaction = p.faction; try { localStorage.setItem('fdn:faction', selectedFaction); } catch { /* sin almacenamiento */ } }
    },
});
// ---------- guardado en la cuenta (ver persist.ts) ----------
let pendingSave: CharSave | null = null, welcomeBack = false;
const saveItem = (it: Item): SavedItem => ({ n: it.name, r: it.rar.k, a: it.attrs.map((a) => ({ id: a.id, v: a.v })) });
/** Atributos guardados -> actuales: 'fres'/'ires' (viejos) pasan a 'rm' 1:1 y se juntan con el 'rm' si hay más de uno. */
function loadAttrs(a: { id: string; v: number }[]): Item['attrs'] {
    const out: Item['attrs'] = [];
    for (const x of a) {
        const id = (x.id === 'fres' || x.id === 'ires' ? 'rm' : x.id) as AttrId; if (!ATTRS.some((t) => t.id === id)) continue;
        const dup = out.find((o) => o.id === id); if (dup && id === 'rm') dup.v += x.v; else out.push({ id, v: x.v });
    }
    return out;
}
function loadItem(v: SavedItem | null | undefined): Item | null {
    const b = v && ALL_BASES.find((x) => x.name === v.n); if (!v || !b) return null;
    return { id: uid++, ...b, rar: RAR[Math.min(4, Math.max(0, v.r))], attrs: loadAttrs(v.a) };
}
function buildSave(): CharSave {
    return {
        v: 1, faction: selectedFaction, cls: CLS.id, lvl: P.lvl, exp: Math.floor(P.exp), gold: P.gold, hp: Math.max(1, Math.round(P.hp)), mp: Math.round(P.mp),
        bag: P.bag.map(saveItem), eq: Object.fromEntries(SLOTS.map((sl) => [sl, P.eq[sl] ? saveItem(P.eq[sl]!) : null])),
        q: { i: Q.i, st: Q.st, prog: Q.prog, keys: { ...Q.keys }, shards: { ...Q.shards } }, pots: { hp: pots.hp, mp: pots.mp }, u: [...UNLOCKED],
    };
}
function applySave(sv: CharSave) {
    P.lvl = sv.lvl; P.exp = sv.exp; P.gold = sv.gold;
    P.bag = sv.bag.map(loadItem).filter((x): x is Item => !!x).slice(0, 18);
    for (const sl of SLOTS) { const it = loadItem(sv.eq?.[sl]); if (it && fitsSlot(it.slot, sl)) P.eq[sl] = it; }
    Q.i = sv.q.i; Q.st = sv.q.st; Q.prog = sv.q.prog;
    for (const k of KEY_IDS) { Q.keys[k] = sv.q.keys?.[k] ?? 0; Q.shards[k] = sv.q.shards?.[k] ?? 0; }
    pots.hp = sv.pots.hp; pots.mp = sv.pots.mp;
    UNLOCKED.clear(); for (const id of sv.u ?? []) if (TRAINING.some((t) => t.id === id)) UNLOCKED.add(id);
    refreshLook(); P.hp = Math.min(maxHp(), sv.hp); P.mp = Math.min(maxMp(), sv.mp);
    renderBag(); renderQuest(); renderPots();
}
/** Item del server -> item del cliente (la base y la rareza salen de las tablas compartidas). */
function itemFromInv(v: InvItemMsg): Item {
    const b = ALL_BASES.find((x) => x.name === v.base) ?? ALL_BASES[0];
    return { ...b, id: v.uid, rar: RAR[Math.min(4, Math.max(0, v.rarity))], attrs: loadAttrs(v.attrs), up: v.up || undefined, rf: v.rf || undefined };
}
let invApplied = false;
/** Última foto del server: el save local del login pisa la bolsa con uids locales, así que se vuelve a aplicar al entrar al mundo. */
let lastInv: InventoryState | null = null;
/** El server es dueño de oro, bolsa, equipo, nivel, pociones y misiones: lo que llega acá reemplaza lo que muestro. */
function applyInventory(v: InventoryState) {
    lastInv = v;
    const prevSel = sel ? sel.it.id : -1, lvlBefore = P.lvl;
    P.gold = v.goldD || v.gold; P.lvl = v.lvl; P.exp = v.exp;
    P.bag = v.bag.map(itemFromInv);
    for (const sl of SLOTS) P.eq[sl] = null;
    for (const e of v.eq) if (e.item && (SLOTS as string[]).includes(e.slot)) P.eq[e.slot as Slot] = itemFromInv(e.item);
    pots.hp = v.potsHp; pots.mp = v.potsMp; zemBag = v.zem;
    stats = { str: v.statStr || 10, vit: v.statVit || 10, dex: v.statDex || 10, mag: v.statMag || 10 }; statFree = v.statFree; capDf = v.capDf || 60; capRm = v.capRm || 75; capNextAt = Number(v.capNextAt);
    Q.i = v.questI; Q.st = v.questState === 'active' || v.questState === 'ready' ? v.questState : 'new'; Q.prog = v.questProg;
    Q.keys.cripta = v.keysCripta; Q.keys.foso = v.keysFoso; Q.shards.cripta = v.shardsCripta; Q.shards.foso = v.shardsFoso;
    try { QB = v.questBook ? JSON.parse(v.questBook) as QuestBookView : null; } catch { QB = null; }
    for (const id of v.unlocked) if (!UNLOCKED.has(id)) {
        const t = TRAINING.find((x) => x.id === id); if (!t) continue;
        UNLOCKED.add(id);
        if (invApplied) { log(`Portal desbloqueado: <b>${t.zone}</b>. Ya podés viajar ahí desde el Portal de Frontera de tu ciudad.`, true); toast(`Portal desbloqueado: ${t.zone}`); }
    }
    // la selección sigue al item (por uid) aunque haya cambiado de lugar (bolsa <-> equipo)
    sel = null;
    if (prevSel >= 0) { const inBag = P.bag.find((x) => x.id === prevSel); const inEq = SLOTS.map((sl) => P.eq[sl]).find((x) => x && x.id === prevSel); sel = inBag ? { it: inBag, from: 'bag' } : inEq ? { it: inEq!, from: 'eq' } : null; }
    if (invApplied && v.lvl > lvlBefore) onLevelUp(); else { P.hp = Math.min(P.hp, maxHp()); P.mp = Math.min(P.mp, maxMp()); }
    invApplied = true;
    refreshLook(); renderBag(); renderQuest(); renderPots(); renderShop(); auction.refresh(); deposit.refresh(); trade.refresh(); sendProfile();
    if (!$('qdlg').hidden && shopNpc && roleOf(shopNpc) === 'capitan') openQuestDlg(shopNpc);
}
const saver = new Saver(buildSave, (data) => net.send({ $case: 'saveCharacterRequest', value: { data } }));
function showLogin(error = '') {
    connected = false;
    $('login').hidden = false; $('loginErr').textContent = error; flow.show('login');
    const nameIn = $('nameIn') as HTMLInputElement;
    try { nameIn.value ||= localStorage.getItem('fdn:lastName') ?? ''; } catch { /* sin almacenamiento */ }
    try { ($('rememberIn') as HTMLInputElement).checked = localStorage.getItem('fdn:remember') !== '0'; } catch { /* sin almacenamiento */ }
    nameIn.focus();
}
$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('nameIn') as HTMLInputElement).value.trim(), password = ($('passIn') as HTMLInputElement).value;
    if (!name) return;
    const regErr = flow.checkRegister(); if (regErr) { $('loginErr').textContent = regErr; return; }
    const btn = $('loginBtn') as HTMLButtonElement, auto = autoEnter; autoEnter = false;
    btn.disabled = true; $('loginErr').textContent = 'Conectando…';
    try {
        const remember = ($('rememberIn') as HTMLInputElement).checked;
        localStorage.setItem('fdn:remember', remember ? '1' : '0');
        if (remember) localStorage.setItem('fdn:lastName', name); else localStorage.removeItem('fdn:lastName');
    } catch { /* sin almacenamiento */ }
    pendingSave = null; welcomeBack = false;
    flowActive = false; inFlow = false;
    net.onMessage = (m) => {
        if (m.$case === 'characterList') {
            const chars = m.value.characters.map((c) => ({ name: c.name, cls: c.cls, faction: c.faction, lvl: c.level, zone: c.zone }));
            lastChars = chars; dropMapLoading(); // si venía de elegir personaje, el server lo rechazó: vuelve a la selección
            if (flowActive) { inFlow = true; flow.update(chars, m.value.error); return; }
            // reconexión automática tras un corte: vuelve a entrar con el mismo personaje sin pasar por la selección
            const again = auto && playName ? chars.find((c) => c.name === playName) : undefined;
            if (again) { playChar(again.name, false); return; }
            startFlow(name, chars, m.value.max || 3);
            if (m.value.error) flow.update(chars, m.value.error);
            return;
        }
        if (m.$case === 'characterLoaded') { welcomeBack = false; pendingSave = m.value.exists && !creatingNew ? parseSave(m.value.data) : null; if (pendingSave) { selectedClass = pendingSave.cls; selectedFaction = pendingSave.faction; welcomeBack = true; } return; }
        onServer(m);
        if (m.$case === 'initialGameWorldState' && !connected && !inFlow && playName) enterWorld(playName);
    };
    let tries = 0;
    net.onClose = (reason) => {
        const was = connected; saver.stop(); others.clear(); drops.length = 0; lastInv = null; dropMapLoading();
        inFlow = false; flowActive = false;
        if (backToLogin) { backToLogin = false; showLogin(); btn.disabled = false; return; }
        if (leaving) { leaving = false; connected = false; showLogin('Saliste del juego.'); btn.disabled = false; return; }
        // si se cortó sin querer, reintenta solo unos segundos (el server te guarda el lugar 60 s)
        if (was && tries < 6 && !/ya está conectado|autentic|contraseña|incorrect/i.test(reason)) {
            tries++; connected = false; showLogin(`Se cortó la conexión. Reconectando (${tries}/6)…`);
            setTimeout(() => { if (!connected) autoEnter = true, void ($('loginForm') as HTMLFormElement).requestSubmit(); }, 1500); return;
        }
        showLogin(was ? `Se cortó la conexión: ${reason}` : reason); btn.disabled = false;
    };
    if (isBlocked() || await checkVersionNow()) { btn.disabled = false; return; } // versión vieja: la pantalla de actualización ya está arriba
    try { await net.connect(serverUrl(), storedId(name), name, password); }
    catch (err) { $('loginErr').textContent = `${(err as Error).message} ¿Está corriendo el server (pnpm dev)?`; btn.disabled = false; }
});
let autoEnter = false, inFlow = false, backToLogin = false;
/** Pantallas de personajes abiertas en esta conexión / personaje con el que se juega / recién creado (arranca en su ciudad). */
let flowActive = false, playName = '', creatingNew = false;
let lastChars: { name: string; faction: string; zone: string }[] = [];
const lastCharKey = (account: string) => `fdn:char:${account.toLowerCase()}`;
/** Pide entrar al mundo con ese personaje; el mundo llega después (initialGameWorldState) y ahí se llama a enterWorld. */
function playChar(name: string, isNew: boolean) {
    inFlow = false; creatingNew = isNew; playName = name;
    // el telón sube antes de pedir el personaje; un personaje nuevo todavía no tiene zona guardada: va a la ciudad de su nación
    const ch = lastChars.find((c) => c.name === name), homeMap = ch && factionHome(ch.faction)?.map;
    showMapLoading(ch?.zone || (homeMap && getMapDef(homeMap)?.name) || '', null);
    try { localStorage.setItem(lastCharKey(($('nameIn') as HTMLInputElement).value.trim()), name); } catch { /* sin almacenamiento */ }
    net.send({ $case: 'selectCharacterRequest', value: { name } });
}
/** Ya autenticado: muestra la selección (con personajes) o el flujo clase → facción → nombre (sin ninguno). */
function startFlow(account: string, chars: { name: string; cls: string; faction: string; lvl: number; zone: string }[], max: number) {
    flowActive = true; inFlow = true;
    let preselect = playName; try { preselect ||= localStorage.getItem(lastCharKey(account)) ?? ''; } catch { /* sin almacenamiento */ }
    flow.start({
        account, chars, max, preselect,
        onPlay: playChar,
        onCreate: (p) => net.send({ $case: 'createCharacterRequest', value: p }),
        onDelete: (n) => net.send({ $case: 'deleteCharacterRequest', value: { name: n } }),
        onBack: () => { if (net.open) { backToLogin = true; net.close(); } else { inFlow = false; flowActive = false; showLogin(); ($('loginBtn') as HTMLButtonElement).disabled = false; } },
    });
}
function enterWorld(name: string) {
    setClass(selectedClass); if (pendingSave) applySave(pendingSave); refreshUnlocks(false); connected = true; P.name = name; lookKey = ''; refreshLook(); sendProfile(); void initKnight();
    $('login').hidden = true; ($('loginBtn') as HTMLButtonElement).disabled = false;
    cv.focus({ preventScroll: true });
    invApplied = false; if (lastInv) applyInventory(lastInv); invApplied = false; saver.start(); saver.tick(true); // el primer guardado le dice al server clase y bando si es un personaje nuevo
    if (welcomeBack) log(`Bienvenido de vuelta, ${name}. Nivel ${P.lvl}.`, true);
    // cada facción arranca en su ciudad (también si el guardado te dejó dentro de la del otro bando)
    // en una ciudad del otro bando (o un interior suyo): a la propia
    const home = factionHome(selectedFaction), inOther = MAP_DEF.safe && (MAP_DEF.region === 'solmar' || MAP_DEF.region === 'vhar') && MAP_DEF.region !== selectedFaction;
    if (home && (!welcomeBack || inOther)) {
        net.send({ $case: 'playerTeleportRequested', value: { x: home.x, y: home.y } });
        if (home.map !== MAP_DEF.id) homeWaitUntil = now() + HOME_WAIT_S; // viene un mapTransfer: no destapar el mapa de paso
    }
    log(selectedFaction === 'vhar' ? 'Bienvenido a la Ciudadela de Vhar. El portón del sur lleva a los Campos de Sal; los edificios tienen interior.' : 'Bienvenido a la Villa de Solmar. Los edificios tienen interior: entrá por las puertas.', true);
    log('En la plaza está el Portal de Frontera: un menú con las zonas de entrenamiento. La primera ya está abierta; las demás se abren al subir de nivel. Para volver a la ciudad apretá H (tarda 8 s y se corta si te pegan).', true);
    log('Tocá un mob para atacarlo. Apretá un hechizo (1–4), esperá que cargue y hacé clic en el objetivo. Enter para chatear.');
}

/** Pantalla de carga del arranque (ui/loading-craftpix.css): `k` = progreso 0..1; con `err` muestra el mensaje y frena la barra. */
function setLoading(k: number, err?: string) {
    const el = $('loading'); ($('ldFill') as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, k)) * 100)}%`;
    if (err) { el.classList.add('err'); $('ldText').textContent = err; }
}
async function boot() {
    // progreso real: meta.json + cada atlas de tiles + cada hoja de sprites + el atlas de efectos
    let ldDone = 0, ldTotal = 2; const ldTick = () => setLoading(++ldDone / ldTotal);
    const loadT = (src: string) => load(src).then((im) => { ldTick(); return im; }, (e) => { ldTick(); throw e; });
    try {
        const metaTxt = await (await fetch('assets/meta.json', { cache: 'no-cache' })).text(); ldTick();
        { let h = 5381; for (let i = 0; i < metaTxt.length; i++) h = ((h * 33) ^ metaTxt.charCodeAt(i)) >>> 0; ASSET_V = h.toString(36); }
        const meta = JSON.parse(metaTxt);
        WORLD = meta.world; delete meta.world;
        BUILD = meta.buildings ?? {}; delete meta.buildings;
        // atlas de tiles: los de siempre y los de los mapas importados de Flare (flare_<hoja>, tools/src/flare/mapatlas.ts)
        const atlases = ['dungeon', 'terrain', 'town', ...Object.keys(meta).filter((g) => g.startsWith('flare_'))];
        ldTotal = 2 + atlases.length + 23 + 1; // 23 = hojas de sprites de abajo; +1 el atlas de efectos
        for (const k of atlases) {
            const m = meta[k]; delete meta[k]; if (!m) { ldTick(); continue; }
            // `s` (solo en los atlas a escala nativa) = píxeles de atlas por píxel de geometría. El tamaño de destino y los offsets se
            // dividen por él una vez acá, para que el dibujo por tile no tenga que hacer cuentas.
            const s = (m.s as number) || 1;
            try { const im = await loadT(`assets/${k}.webp`); for (const [id, p] of Object.entries(m.pos as Record<string, number[]>)) EXT[Number(id)] = { im, p: s === 1 ? [...p, p[2], p[3]] : [p[0], p[1], p[2], p[3], p[4] / s, p[5] / s, p[2] / s, p[3] / s] }; } catch { /* sin ese atlas se ve el mapa sin esas piezas */ }
        }
        PAPER = meta.paper; delete meta.paper; SPR.hero = SPR.hero_other = PAPER as unknown as SpriteMeta;
        SPR.hero.hum = true; // el muñeco por capas del jugador también entra en la escala de humanoides (ver HS)
        Object.assign(SPR, meta);
        // Sin barbaro, arana, golem ni demonio: eran atlas de origen no registrado y se sacaron del repo (docs/LICENCIAS_AUDITORIA.md).
        // Los mobs que los usaban apuntan por ahora a sprites de Flare (ver `sprite` en packages/world/src/mobs.ts).
        const names = ['world', 'goblin', 'zombie', 'skeleton', 'goblin_elite', 'antlion', 'skeleton_mage', 'fire_ant', 'wyvern', 'minotaur', 'hobgoblin', 'hobgoblin_archer', 'skeleton_archer', 'zombie_dark', 'cursed_grave', 'ice_ant', 'antlion_small', 'wyvern_fire', 'wyvern_ice'];
        ldTotal = 2 + atlases.length + names.length + 1;
        const imgs = await Promise.all(names.map((n) => loadT(`assets/${n}.webp`)));
        names.forEach((n, i) => (IMG[n] = imgs[i]));
    } catch { setLoading(1, 'No se pudieron cargar los gráficos. Recargá la página.'); return; }
    try { FXM = await (await fetch('assets/fx.json')).json(); IMG.fx = await load('assets/fx.webp'); } catch { FXM = null; }
    setLoading(1);
    await new Promise((r) => setTimeout(r, 250)); // que se vea la barra llena antes de pasar al login
    $('loading').hidden = true;
    // Atlas privado (opcional, mismo tamaño de celda): si no está, efxLocal usa FX_FALLBACK
    if (FXM) try { const pm = await (await fetch('assets/fx_priv.json')).json() as NonNullable<typeof FXM>; IMG.fxp = await load('assets/fx_priv.webp'); for (const [n, r] of Object.entries(pm.rows)) FXM.rows[n] = { ...r, img: 'fxp' }; } catch { /* sin atlas privado */ }
    // Vórtice de los portales (Frostwindz, misma situación de licencia que fx_priv): si falta, queda el haz dibujado por código
    try { setPortalSheet(await load('assets/portal_priv.png')); } catch { /* sin tira del portal */ }
    loadBuildingImages();
    refreshLook(); void initKnight();
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__fdn = { others, mobs, drops, toScreen, damageMob, tp: (x: number, y: number) => { P.x = x; P.y = y; P.cell = { x: Math.floor(x), y: Math.floor(y) }; P.path = []; P.mv = false; }, P, BASES, RAR, refreshLook, equip: (n: string) => { const b = BASES.find((x) => x.name === n)!; P.eq[b.slot] = { id: uid++, ...b, rar: RAR[0], attrs: [] }; refreshLook(); } };
    if (new URLSearchParams(location.search).has('debug')) Object.assign((window as unknown as { __fdn: Record<string, unknown> }).__fdn, { efx, MAP, map: () => MAP, openShop, toScreen, mapId: () => MAP_DEF.id, worldId: () => MAP_WORLD_ID, links: () => LINKS, loading: () => mapLoading, worldReady: () => worldReady, perf: () => ({ ...perf }), setQb: (v: QuestBookView | null) => { QB = v; renderQuest(); }, questDlg: (name: string) => openQuestDlg({ id: 'capitan_s', name, x: P.cell.x, y: P.cell.y, dir: 0 } as unknown as Npc), questLog: toggleQuestLog, arenaInvite: (mode = '2v2') => showArenaInvite(mode, Date.now() + 30_000, true), arenaDbg: (v: ArenaInfo | null) => { $('arena').hidden = false; renderArena(v); }, shopDbg: (role = 'mercader') => openShop({ id: role + '_s', name: 'Mercader', x: P.cell.x, y: P.cell.y, dir: 0 } as unknown as Npc), uid: () => uid++, RARS: RAR, mobCount: () => mobs.length, arrows: () => arrows.length });
    if (new URLSearchParams(location.search).has('debug')) Object.assign((window as unknown as { __fdn: Record<string, unknown> }).__fdn, { net, drop: () => (net as unknown as { ws: WebSocket }).ws.close(4000, 'prueba'), connected: () => connected, Q, UNLOCKED, WAYPOINTS, openWp, wpGo, trainOpen, refreshUnlocks, saver, warp: (x: number, y: number) => net.send({ $case: 'playerTeleportRequested', value: { x, y } }), go: (x: number, y: number) => moveTo(x + 0.5, y + 0.5), recall: () => ({ on: !!recall, k: recallK(now()), cd: Math.max(0, recallCdEnd - now()) }) });
    const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y;
    showLogin();
    requestAnimationFrame(frame);
}
boot();
