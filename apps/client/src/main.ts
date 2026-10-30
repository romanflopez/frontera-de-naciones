/**
 * Frontera de Naciones: el prototipo HD (canvas isométrico 2:1, arte de Flare) conectado al server.
 *
 * Lo que decide el server: dónde está cada jugador (paso a paso, con control de velocidad),
 * quién ve a quién y el chat. Lo que todavía corre solo en este navegador, como en el prototipo:
 * mobs, combate, hechizos, loot y experiencia (pasan al server en la fase 1b).
 */
import { buildSolmar, HUBS, cityAt, MOB_TYPES, mobDef, TRAINING, trainingUnlocked, portalGate, type MobType, type MobDef, type TrainingStep, type Waypoint, WAYPOINT_RANGE } from '@fdn/world';
import { ALL_BASES, ATTR_IDS, ATTR_RANGES, BAG_MAX, BASES, KEYDEFS, KEY_IDS, POTS, QUESTS, SHARDS_PER_KEY, SHOPS, SLOTS, TALK_RANGE, roleOf, sellPrice, type AttrId, type Base, type KeyId, type Quest, type Slot, type Stock } from '@fdn/world';
import { Net, serverUrl, type ServerPayload } from './net.ts';
import type { InvItem as InvItemMsg, InventoryState } from '@fdn/proto';
import { spellIcon } from './icons.ts';
import { Saver, parseSave, type CharSave, type SavedItem } from './persist.ts';
import { itemIcon } from './itemicons.ts';
import { initLoginUI } from './loginui.ts';
const ico = (it: { look?: string; slot: string; rar: { c: string; k: number } }) => `<img class="iico" alt="" src="${itemIcon(it.look, it.slot, it.rar.c, it.rar.k)}">`;

// ---------- utilidades ----------
const TW = 96, TH = 48;
const MAP = buildSolmar();
const N = MAP.size;
const { tiles, blocked, safe, props, decals } = MAP;
const ZONES = MAP.zones;
type Zone = (typeof ZONES)[number];

const R = Math.random;
const rint = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
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
    else { let d = a - e.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); e.ang += d * Math.min(1, dt * 12); }
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
    { n: 'Mágico', c: '#6fa8ff', k: 1, p: 0.22 },
    { n: 'Raro', c: '#ffd24a', k: 2, p: 0.07 },
    { n: 'Épico', c: '#c77dff', k: 3, p: 0.01 },
];
/** Texto de cada atributo; los rangos y las bases viven en @fdn/world (el server valida con las mismas tablas). */
const ATTR_FMT: Record<AttrId, (v: number) => string> = {
    crit: (v) => `+${v}% crítico`, aspd: (v) => `+${v}% velocidad de ataque`, leech: (v) => `${v}% robo de vida`, hp: (v) => `+${v} vida`, mp: (v) => `+${v} maná`,
    mag: (v) => `+${v} daño mágico`, exp: (v) => `+${v}% exp de caza`, poison: (v) => `${v}% chance de veneno`, rpar: (v) => `+${v}% resistencia a parálisis`,
    df: (v) => `+${v} defensa`, rm: (v) => `+${v} resistencia mágica`,
};
const ATTRS = ATTR_IDS.map((id) => ({ id, r: ATTR_RANGES[id], f: ATTR_FMT[id] }));
interface Item extends Base { id: number; rar: Rarity; attrs: { id: AttrId; v: number }[] }
let uid = 1;
const attrText = (a: { id: AttrId; v: number }) => ATTRS.find((x) => x.id === a.id)!.f(a.v);

// ---------- entidades ----------
interface OneShot { anim: string; t: number; until: number }
interface Ent { x: number; y: number; dir: number; ang?: number; moving: boolean; phase?: number; ref?: number; one: OneShot | null; t0?: number; flash: number }
/** Un paso de una celda a otra, animado en `dur` segundos. */
interface Step { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }

interface Mob extends Omit<Ent, 'ref'>, MobDef {
    id: number; sprite: MobType; zone: Zone; hpMax: number;
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
    name: '', cell: { x: MAP.spawn.x, y: MAP.spawn.y }, path: [] as Cell[], step: null as Step | null, stepMs: 270, frozenUntil: 0, foe: null as Other | null, med: false, medHp: 0,
    target: null as Mob | null, engage: false, pickup: null as Drop | null, repath: 0, queued: null as number | null,
    lvl: 1, exp: 0, hp: 100, mp: 60, fury: 0, wcEnd: 0, slowEnd: 0, inv: false, det: false, invEnd: 0, detEnd: 0, immEnd: 0, gold: 0, nextAtk: 0, dead: false, deadT: 0,
    bag: [] as Item[], eq: { arma: null, armadura: null, cabeza: null, anillo: null } as Record<Slot, Item | null>,
    casting: null as Casting | null, ready: null as { i: number; t: number } | null, sentDir: -1,
};

/** Otros jugadores, según lo que manda el server. */
interface Other extends Ent { hp?: number; maxHp?: number; fury?: boolean; inv?: boolean; profile: string; id: bigint; name: string; cell: Cell; queue: Cell[]; step: Step | null; stepMs: number; gone: boolean }
const others = new Map<bigint, Other>();

interface Drop { x: number; y: number; item?: Item; gold?: number; t: number }
interface Proj { x: number; y: number; m: Mob | null; spd: number; dmg: number; col: string; aoe?: number; tx?: number; ty?: number; sx?: number; sy?: number; arc?: number; trail?: { x: number; y: number }[] }
interface Fx { k: 'ring' | 'boom' | 'burst' | 'click' | 'efx' | 'blizz'; d?: number; n?: string; dy?: number; x: number; y: number; t: number; c?: string; r?: number }
const scorch: { x: number; y: number; t: number; r: number }[] = [];
const mobs: Mob[] = [], corpses: { sprite: string; x: number; y: number; dir: number; t: number }[] = [], drops: Drop[] = [], projs: Proj[] = [];
const floats: { x: number; y: number; text: string; col: string; t: number; big?: boolean }[] = [], fx: Fx[] = [], pending: { t: number; fn: () => void }[] = [];
let hitstop = 0, shake = 0;

/** Los mobs los simula el server: acá solo hay un espejo que se actualiza con cada foto (`mobsSnapshot`). */
const mobMap = new Map<number, Mob>();
function dropMob(m: Mob) {
    const i = mobs.indexOf(m); if (i >= 0) mobs.splice(i, 1);
    mobMap.delete(m.id); if (P.target === m) P.target = null;
}
const MOB_DELAY = 0.2;
function syncMobs(list: { id: number; type: number; zone: number; x: number; y: number; hp: number; par: number; imm: number; poison: boolean; moving: boolean }[]) {
    const T = now(), seen = new Set<number>();
    for (const s of list) {
        seen.add(s.id);
        let m = mobMap.get(s.id);
        if (!m) {
            const type = MOB_TYPES[s.type], z = ZONES[s.zone]; if (!type || !z) continue;
            const d = mobDef(type, z);
            m = { ...d, sprite: type, zone: z, x: s.x, y: s.y, sx: s.x, sy: s.y, buf: [], hpMax: d.hp, hp: s.hp, busy: 0, par: 0, parT: 0, imm: 0, poison: 0, dir: rint(0, 7), moving: false, flash: 0, one: null, t0: R() * 5, id: s.id };
            mobs.push(m); mobMap.set(s.id, m);
        }
        m.sx = s.x; m.sy = s.y; m.hp = s.hp;
        m.buf.push({ t: T, x: s.x, y: s.y }); if (m.buf.length > 8) m.buf.shift();
        if (s.par > 0.05) { if (m.par <= T) m.parT = T; m.par = T + s.par; } else m.par = 0;
        m.imm = T + s.imm; m.poison = s.poison ? T + 1 : 0;
    }
    for (const m of mobs.slice()) if (!seen.has(m.id)) dropMob(m);
}

// ---------- stats ----------
function totals() {
    const t = { crit: 0, aspd: 0, leech: 0, hp: 0, mp: 0, mag: 0, exp: 0, poison: 0, rpar: 0, rm: 0, df: 0, def: 0, wdmg: [0, 0] as [number, number] };
    for (const s of SLOTS) {
        const it = P.eq[s]; if (!it) continue;
        if (it.dmg) t.wdmg = it.dmg; if (it.def) t.def += it.def; if (it.rm) t.rm += it.rm; if (it.mag) t.mag += it.mag;
        for (const a of it.attrs) t[a.id] += a.v;
    }
    t.def += t.df; // el atributo 'df' suma a la defensa
    return t;
}
// ---------- clases ----------
interface ClassDef { id: string; name: string; hidden?: boolean; desc: string; head: string; armor?: string; hp: number; hpL: number; mp: number; mpL: number; melee: [number, number]; weapon: string; spells: string[] }
const CLASSES: ClassDef[] = [
    { id: 'guerrero', name: 'Guerrero', desc: 'Resistente, pega cuerpo a cuerpo y frena enemigos.', head: 'head_short', armor: 'Coraza de cuero', hp: 140, hpL: 18, mp: 40, mpL: 4, melee: [5, 9], weapon: 'Espada corta', spells: ['golpe', 'tajo', 'aturdir', 'vendar', 'torbellino', 'sismo', 'furia', 'remover', 'carga', 'giro', 'grito'] },
    { id: 'mago', name: 'Mago', desc: 'Frágil pero con hechizos a distancia, parálisis y cura.', head: 'head_short', armor: 'Túnica de mago', hp: 90, hpL: 10, mp: 90, mpL: 12, melee: [2, 4], weapon: 'Báculo de fresno', spells: ['proyectil', 'paralisis', 'curar', 'bola', 'hoja', 'lanza', 'lluvia', 'ventisca', 'marejada', 'luz', 'curar2', 'furia', 'remover', 'invisibilidad', 'detectar', 'blink'] },
];
let CLS: ClassDef = CLASSES[0];
const maxHp = () => CLS.hp + (P.lvl - 1) * CLS.hpL + totals().hp;
const maxMp = () => CLS.mp + (P.lvl - 1) * CLS.mpL + totals().mp;
const expNeed = () => Math.round(60 * Math.pow(P.lvl, 1.5));

// ---------- log ----------
const logEl = $('log'); const lines: { t: string; cls: string }[] = [];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function log(t: string, hi = false, cls = '') { lines.push({ t, cls: cls || (hi ? 'hi' : '') }); if (lines.length > 7) lines.shift(); logEl.innerHTML = lines.map((l) => `<p class="${l.cls}">${l.t}</p>`).join(''); }
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
    if (d !== P.sentDir && !P.step) { P.sentDir = d; net.send({ $case: 'changePlayerIdleDirectionRequest', value: { direction: d } }); }
}

function addOther(p: { profile?: string; playerId: bigint; x: number; y: number; direction: number; characterName: string; movementSpeedMs: number }) {
    if (p.playerId === myId) return;
    const [dx, dy] = GRID_VEC[p.direction] ?? [0, 1];
    const o: Other = { profile: p.profile ?? '', id: p.playerId, name: p.characterName, x: p.x + 0.5, y: p.y + 0.5, cell: { x: p.x, y: p.y }, queue: [], step: null, stepMs: p.movementSpeedMs || 270, dir: 6, moving: false, one: null, flash: 0, phase: 0, ref: 3.4, t0: R() * 5, gone: false };
    turnTo(o, dx, dy, 0, true);
    others.set(o.id, o);
}

function snapTo(x: number, y: number) {
    P.step = null; P.path = []; P.cell = { x, y }; P.x = x + 0.5; P.y = y + 0.5;
}

function onServer(m: ServerPayload) {
    switch (m.$case) {
        case 'initialState':
            myId = m.value.playerId;
            P.stepMs = m.value.movementSpeedMs || 270;
            break;
        case 'initialGameWorldState': {
            snapTo(m.value.playerX, m.value.playerY);
            const [dx, dy] = GRID_VEC[m.value.playerDirection] ?? [0, 1];
            turnTo(P, dx, dy, 0, true);
            const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y;
            others.clear();
            break;
        }
        case 'playersEnteredRange':
            for (const p of m.value.players) addOther(p);
            break;
        case 'pvpHit': {
            const v = m.value;
            if (v.casterId === myId) { // el server me confirma mi golpe con el daño que calculó
                if (v.dmg > 0) float(v.x, v.y - 0.3, '-' + v.dmg, '#ffd24a'); if (v.secs > 0) float(v.x, v.y - 0.6, 'Paralizado', '#7fd6ff'); break;
            }
            if (v.fx === 'blizz') fx.push({ k: 'blizz', x: v.x, y: v.y, t: 0, r: v.r || 2.7, d: 3.2 }); else if (v.fx) efxLocal(v.fx, v.x, v.y, v.targetId ? 8 : 0);
            if (v.fx === 'resist') { float(v.x, v.y - 0.5, '¡Resistió!', '#9fe8ff'); break; }
            if (v.targetId === myId && v.secs < 0) { P.frozenUntil = 0; P.immEnd = now() + 8; log('¡Removiste la parálisis! Sos inmune 8 s.', true); break; }
            if (v.targetId === myId && !P.dead) {
                {
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
            break;
        }
        case 'mobHitPlayer': onMobHitPlayer(m.value); break;
        case 'mobSpecialEvent': onMobSpecial(m.value); break;
        case 'mobDied': onMobDied(m.value); break;
        case 'inventoryState': applyInventory(m.value); break;
        case 'econResult': if (m.value.ok) log(esc(m.value.text)); else { toast(m.value.text); log(esc(m.value.text)); } break;
        case 'killReward': onKillReward(m.value); break;
        case 'statusUpdate': onStatusUpdate(m.value); break;
        case 'skillEffect': onSkillEffect(m.value); break;
        case 'vitals': onVitals(m.value); break;
        case 'logoutResponse': if (logout) { logout.at = now() + m.value.wait; logout.asked = true; if (m.value.wait <= 0) { logout.at = now(); } } break;
        case 'playerVitals': { const o = others.get(m.value.playerId); if (o) { o.hp = m.value.hp; o.maxHp = m.value.maxHp; } break; }
        case 'pvpKill': { const v = m.value; if (v.playerId !== myId) log(v.killerName ? `<b>${esc(v.killerName)}</b> derrotó a <b>${esc(v.victimName)}</b>.` : `<b>${esc(v.victimName)}</b> cayó.`, true); else if (v.killerName) log(`Te derrotó <b>${esc(v.killerName)}</b>.`, true); break; }
        case 'playerProfileChanged': { const o = others.get(m.value.playerId); if (o) o.profile = m.value.profile; break; }
        case 'playersLeftRange':
            for (const id of m.value.playerIds) others.delete(id);
            break;
        case 'playerMoved': {
            const o = others.get(m.value.playerId); if (!o) break;
            o.stepMs = m.value.movementSpeedMs || o.stepMs;
            if (m.value.teleport) { o.queue = []; o.step = null; o.cell = { x: m.value.destX, y: m.value.destY }; o.x = o.cell.x + 0.5; o.y = o.cell.y + 0.5; break; }
            o.queue.push({ x: m.value.destX, y: m.value.destY });
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
        case 'playerMovementStateChanged':
            if (m.value.playerId === myId) P.stepMs = m.value.movementSpeedMs || P.stepMs;
            else { const o = others.get(m.value.playerId); if (o) o.stepMs = m.value.movementSpeedMs || o.stepMs; }
            break;
        case 'resetPosition':
            snapTo(m.value.x, m.value.y);
            break;
        case 'positionCorrected':
            snapTo(m.value.destX, m.value.destY);
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
            log(esc(m.value.message), false, 'sys');
            break;
        case 'chatMessageReceived':
            log(`<b>${esc(m.value.senderCharacterName)}:</b> ${esc(m.value.message)}`, false, 'chat');
            break;
        case 'pingResponse':
            playersOnline = m.value.playersInMap;
            break;
        default:
            break;
    }
}

// ---------- combate ----------
/** Pide el golpe al server: él valida alcance y tope de daño, lo aplica y avisa a todos (`mobDamaged`). */
function damageMob(m: Mob, dmg: number, crit: boolean, src: 'melee' | 'spell', parSecs = 0) {
    if (!mobs.includes(m) || P.dead) return;
    if (P.fury > now()) dmg = Math.round(dmg * (src === 'melee' ? 1.3 : CLS.id === 'mago' ? 1.2 : 1));
    const t = totals();
    if (src === 'melee' && t.leech) P.hp = Math.min(maxHp(), P.hp + Math.max(1, Math.round((dmg * t.leech) / 100))); syncHp();
    let poisonSecs = 0;
    if (src === 'melee' && t.poison && R() * 100 < t.poison) { poisonSecs = 4; log(`${m.name} quedó envenenado.`); }
    net.send({ $case: 'mobHitRequest', value: { mobId: m.id, dmg, melee: src === 'melee', crit, parSecs, poisonSecs } });
}
/** Lo que se ve cuando el server confirma un golpe (propio o de otro jugador). */
function onMobDamaged(v: { mobId: number; attackerId: bigint; dmg: number; crit: boolean; hp: number }) {
    const m = mobMap.get(v.mobId); if (!m) return;
    const mine = v.attackerId === myId, poisonTick = v.dmg === 3 && !v.crit && m.poison > now();
    m.hp = v.hp; m.flash = 0.12;
    if (!poisonTick && !(m.one && (m.one.anim === 'swing' || m.one.anim === 'special') && now() < m.one.until) && !(m.boss && R() < 0.6)) oneShot(m, 'hit', 0.2);
    float(m.x, m.y, poisonTick ? '3' : (v.crit ? '¡' : '') + v.dmg + (v.crit ? '!' : ''), poisonTick ? '#8fd14f' : v.crit ? '#ffd24a' : '#fff', v.crit);
    if (mine) { hitstop = Math.max(hitstop, v.crit ? 0.09 : 0.045); if (v.crit && !reduce) shake = 0.25; }
}
/** Subí de nivel (lo decide el server): efecto y aviso. */
function onLevelUp() {
    P.hp = maxHp(); P.mp = maxMp(); float(P.x, P.y - 0.5, `¡Nivel ${P.lvl}!`, '#ffd24a', true); log(`Subiste a nivel ${P.lvl}.`, true); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#ffd24a' });
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
        case 'blink': efxLocal('spread', fx0, fy0); fx.push({ k: 'ring', x: fx0, y: fy0, t: 0, c: '#b9a3ff' }); efxLocal('sphere', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#b9a3ff' }); fx.push({ k: 'burst', x: tx, y: ty, t: 0, c: '#b9a3ff' }); break;
        case 'carga': efxLocal('crosswind', fx0, fy0, 6); fx.push({ k: 'burst', x: fx0, y: fy0, t: 0, c: '#ff9a4a' }); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 1.2, c: '#ff9a4a' }); if (!reduce && v.casterId === myId) shake = Math.max(shake, 0.2); break;
        case 'giro': efxLocal('cyclone', tx, ty); fx.push({ k: 'boom', x: tx, y: ty, t: 0, r: 1.9, c: '#ffd0a0' }); break;
        case 'grito': efxLocal('godsbreath', tx, ty); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#c78bff' }); fx.push({ k: 'ring', x: tx, y: ty, t: 0, c: '#ffe27a' }); break;
    }
    if (v.skill === 'blink' && v.casterId === myId) { const pt = iso(P.x, P.y); if (Math.hypot(pt.x - cam.x, pt.y - cam.y) > 500) { cam.x = pt.x; cam.y = pt.y; } }
}
function onStatusUpdate(v: { playerId: bigint; invisible: boolean; detect: boolean; fury: boolean; warcry: boolean; slow: boolean }) {
    if (v.playerId === myId) {
        if (v.warcry !== P.wcEnd > now()) { P.wcEnd = v.warcry ? now() + 10 : 0; if (v.warcry) log('Grito de guerra: +15 de defensa por 10 s.', true); }
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
    corpses.push({ sprite: type, x: v.x, y: v.y, dir: mob?.dir ?? 6, t: now() });
}
/** El server ya aplicó el botín del golpe final (exp, oro, item, pociones, misión): acá solo se muestra. El estado nuevo llega en `inventoryState`. */
function onKillReward(v: { mobId: number; x: number; y: number; exp: number; gold: number; item?: InvItemMsg; bagFull: boolean; potion: string; shard: string; newLvl: number; questReady: boolean; questProg: number }) {
    const mob = mobMap.get(v.mobId), boss = !!mob?.boss;
    float(v.x, v.y - 0.3, `+${v.exp} exp`, '#c9a227');
    if (v.item) {
        const it = itemFromInv(v.item);
        if (boss) { log(`¡${mob?.name ?? 'El boss'} cayó! Soltó un item <span style="color:${it.rar.c}">${it.rar.n.toLowerCase()}</span>.`, true); shake = Math.max(shake, 0.4); }
        if (v.bagFull) log(`La bolsa está llena: se perdió <span style="color:${it.rar.c}">${esc(it.name)}</span>.`, true);
        else if (it.rar.k >= 2 && !boss) log(`¡Cayó un item <span style="color:${it.rar.c}">${it.rar.n.toLowerCase()}</span>!`, true);
        else log(`Agarraste <span style="color:${it.rar.c}">${esc(it.name)}</span>.`);
    }
    if (v.gold) log(`Juntaste ${v.gold} de oro.`);
    if (v.potion === 'hp' || v.potion === 'mp') log(`Encontraste una ${POTS[v.potion].name.toLowerCase()}.`, true);
    if (v.shard === 'cripta' || v.shard === 'foso') { const kd = KEYDEFS[v.shard]; log(`El boss soltó una <b>${kd.shard}</b>. Con ${SHARDS_PER_KEY} esquirlas y ${kd.gold} de oro el Capitán te forja una ${kd.name}.`, true); }
    if (v.questReady) { const q = QUESTS[Q.i]; log(`Misión lista: volvé con el Capitán${q ? ` (${q.name})` : ''}.`, true); }
    else if (v.questProg > 0) { const q = QUESTS[Q.i]; if (q) float(P.x, P.y - 0.9, `${v.questProg}/${q.n}`, '#ffd24a'); }
}
/** Habilidad distintiva del boss (el server decide cuándo y a quién pega): fase 0 = aviso y carga, fase 1 = el golpe en área. */
function onMobSpecial(v: { mobId: number; phase: number; x: number; y: number }) {
    const m = mobMap.get(v.mobId), sp = m?.boss?.special; if (!m || !sp) return;
    if (v.phase === 0) { m.busy = now() + 1.1; oneShot(m, 'special', 1.3); float(m.x, m.y - 0.4, `¡${sp.name}!`, sp.col, true); }
    else { fx.push({ k: 'boom', x: v.x, y: v.y, t: 0, c: sp.col, r: sp.r }); if (!reduce) shake = Math.max(shake, 0.3); }
}
/** El server me pegó un mob (el daño ya viene calculado; acá solo aplico la DF para mostrarlo: los mobs pegan físico). */
function onMobHitPlayer(v: { mobId: number; dmg: number; stun: number }) {
    if (P.dead) return;
    const m = mobMap.get(v.mobId);
    if (v.dmg > 0) hurtPlayer(v.dmg);
    if (v.stun > 0 && !P.dead) {
        P.frozenUntil = now() + v.stun; P.path = []; P.engage = false; cancelCast();
        const sp = m?.boss?.special; log(`${m ? m.name : 'Un enemigo'}${sp ? ': ' + sp.name : ''}. Quedaste inmovilizado ${v.stun} s.`, true);
    }
}
function meleeHit(m: Mob) {
    const t = totals(); let d = rint(CLS.melee[0], CLS.melee[1]) + P.lvl + rint(t.wdmg[0], t.wdmg[1]);
    const crit = R() * 100 < 5 + t.crit; if (crit) d = Math.round(d * 1.8);
    damageMob(m, d, crit, 'melee');
}
function explode(p: Proj) {
    fx.push({ k: 'boom', x: p.tx!, y: p.ty!, t: 0, r: p.aoe }); efx('eruption', p.tx!, p.ty!);
    scorch.push({ x: p.tx!, y: p.ty!, t: now(), r: p.aoe! });
    if (!reduce) shake = 0.3; hitstop = Math.max(hitstop, 0.06);
    let n = 0;
    for (const o of enemiesNear(p.tx!, p.ty!, p.aoe!)) pvpDamage(o, 'bola', '');
    for (const m of mobs.slice()) { if (Math.hypot(m.x - p.tx!, m.y - p.ty!) <= p.aoe!) { n++; damageMob(m, Math.round(p.dmg * (0.85 + R() * 0.3)), false, 'spell'); } }
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
    P.flash = 0.12; float(P.x, P.y, '-' + d, '#ff6b55');
    if (P.casting) P.casting.end = Math.min(P.casting.end + 0.2, P.casting.start + P.casting.len * 1.6);
    if (!(P.one && P.one.anim !== 'hit' && now() < P.one.until)) oneShot(P, 'hit', 0.15);
}
/** El server dice que morí: pierdo un poco de exp y pido revivir en mi ciudad. */
function die() {
    if (P.dead) return;
    P.dead = true; potEpoch++; pots.cd = 0; P.deadT = now(); P.hp = 0; P.path = []; P.casting = null; P.target = null; P.med = false; const lost = Math.round(expNeed() * 0.05); // la pérdida de exp la aplica el server (llega en inventoryState)
    log(`Moriste. Perdiste ${lost} de exp y volvés a tu ciudad.`, true);
    const ask = (n: number) => { if (!P.dead || n > 10) return; net.send({ $case: 'respawnRequest', value: {} }); later(1, () => ask(n + 1)); };
    later(2.2, () => ask(0));
}
/** Mi vida según el server: es la que vale. */
function onVitals(v: { hp: number; maxHp: number; dead: boolean; mp: number; maxMp: number }) {
    if (v.dead) { if (!P.dead) die(); P.hp = 0; return; }
    if (P.dead) { P.dead = false; P.one = null; P.mp = maxMp(); mpLocalAt = 0; log('Revivís en tu ciudad.', true); }
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
interface Spell { id?: string; instant?: boolean; ctrl?: boolean; fury?: boolean; key: string; name: string; mp: number; cd: number; col: string; range: number; target: boolean; aoe?: number; cast: (m: Target | null) => false | void }
const isMob = (t: Target | null): t is Mob => !!t && 'hp' in t;
interface SpellDef extends Omit<Spell, 'key'> { ctrl?: boolean }
/** Mago, Blink: celda de destino hacia el cursor (o hacia donde mira), a lo sumo 4 celdas, caminable y sin nadie encima. Prueba más cerca si la ideal no sirve. */
function blinkDest(): Cell | null {
    const from = P.cell; let dx: number, dy: number;
    if (mouse.x >= 0) { const g = toGrid(mouse.x, mouse.y); dx = Math.floor(g.x) - from.x; dy = Math.floor(g.y) - from.y; }
    else { const a = P.ang ?? 0, sx = Math.cos(a), sy = Math.sin(a) * 2, v = GRID_VEC[gridDir((sx + sy) / 2, (sy - sx) / 2)]; dx = v[0] * 4; dy = v[1] * 4; }
    const len = Math.hypot(dx, dy); if (len < 0.5) return null;
    for (let r = Math.min(4, len); r >= 2; r -= 0.5) {
        const x = from.x + Math.round((dx / len) * r), y = from.y + Math.round((dy / len) * r);
        if (Math.hypot(x - from.x, y - from.y) > 4.25 || !freeForMe(x, y) || mobs.some((m) => Math.hypot(m.x - x - 0.5, m.y - y - 0.5) < 0.75)) continue;
        return { x, y };
    }
    return null;
}
const skillSend = (skill: string, targetId = 0n, mobId = 0) => net.send({ $case: 'skillRequest', value: { skill, targetId, mobId } });
const LIB: Record<string, SpellDef> = {
    proyectil: { name: 'Proyectil arcano', mp: 8, cd: 0.4, col: '#b9a3ff', range: 8, target: true,
        cast(m) { if (!isMob(m)) return false; const t = totals(), dmg = rint(12, 18) + P.lvl * 2 + t.mag; projs.push({ x: P.x, y: P.y, m, spd: 11, dmg, col: '#b9a3ff' }); } },
    paralisis: { name: 'Parálisis', mp: 20, cd: 4, col: '#7fd6ff', range: 6, target: true, ctrl: true,
        cast(m) { return control(m, 3, 'Paralizaste', 'La parálisis'); } },
    aturdir: { name: 'Aturdir', mp: 18, cd: 5, col: '#ffd24a', range: 1.9, target: true, ctrl: true,
        cast(m) { return control(m, 2.5, 'Aturdiste', 'El aturdimiento', 'turbulence'); } },
    curar: { name: 'Curar', mp: 15, cd: 2, col: '#7ee08a', range: 0, target: false,
        cast() { heal(35 + P.lvl * 3); } },
    vendar: { name: 'Vendar', mp: 14, cd: 3, col: '#7ee08a', range: 0, target: false,
        cast() { heal(30 + P.lvl * 4, 'godsbreath'); } },
    bola: { name: 'Bola de fuego', mp: 25, cd: 4, col: '#ff8a3d', range: 7, target: true, aoe: 1.9,
        cast(m) { if (!m) return false; const t = totals(), dmg = rint(18, 26) + P.lvl * 2 + t.mag; projs.push({ x: P.x, y: P.y, tx: m.x, ty: m.y, m: isMob(m) ? m : null, spd: 8, dmg, col: '#ff8a3d', aoe: 1.9, sx: P.x, sy: P.y }); } },
    golpe: { name: 'Golpe brutal', mp: 10, cd: 1, col: '#ffb347', range: 1.9, target: true,
        cast(m) { if (!isMob(m)) return false; efx('crosswind', m.x, m.y, 8); damageMob(m, rint(14, 20) + P.lvl * 2 + rint(totals().wdmg[0], totals().wdmg[1]), true, 'melee'); } },
    tajo: { name: 'Tajo salvaje', mp: 12, cd: 1, col: '#ff6b55', range: 1.9, target: true,
        cast(m) { if (!isMob(m)) return false; efx('crosswind', m.x, m.y, 8); damageMob(m, rint(22, 30) + P.lvl * 3 + rint(totals().wdmg[0], totals().wdmg[1]), true, 'melee'); } },
    torbellino: { name: 'Torbellino', mp: 22, cd: 5, col: '#e0e0e0', range: 0, target: false,
        cast() { fx.push({ k: 'boom', x: P.x, y: P.y, t: 0, r: 2.2 }); efx('cyclone', P.x, P.y); let n = 0; for (const m of mobs.slice()) if (dist(P, m) <= 2.2 && !isSafe(m.x, m.y)) { n++; damageMob(m, rint(12, 18) + P.lvl * 2 + rint(totals().wdmg[0], totals().wdmg[1]), false, 'melee'); } if (!n) log('El torbellino no alcanzó a nadie.'); } },
    hoja: { name: 'Hoja de viento', mp: 14, cd: 1.5, col: '#8dffa0', range: 7, target: true,
        cast(m) { if (!isMob(m)) return false; efx('windblade', m.x, m.y, 10); damageMob(m, rint(13, 19) + P.lvl * 2 + totals().mag, false, 'spell'); } },
    lanza: { name: 'Lanza de piedra', mp: 30, cd: 5, col: '#d9a45a', range: 7, target: true,
        cast(m) { if (!isMob(m)) return false; efx('rocklance', m.x, m.y, 4); if (!reduce) shake = Math.max(shake, 0.2); damageMob(m, rint(30, 42) + P.lvl * 3 + totals().mag, true, 'spell'); } },
    lluvia: { name: 'Lluvia de fuego', mp: 45, cd: 9, col: '#ff7a2f', range: 7, target: true, aoe: 2.4,
        cast(m) { if (!m) return false; zone(m.x, m.y, 2.4, 4, 0.5, () => rint(11, 16) + P.lvl * 2 + totals().mag, 'cataclysm', 0, 'lluvia'); } },
    ventisca: { name: 'Ventisca', mp: 50, cd: 10, col: '#9fdcff', range: 7, target: true, aoe: 2.7,
        cast(m) { if (!m) return false; zone(m.x, m.y, 2.7, 6, 0.4, () => rint(9, 14) + P.lvl * 2 + totals().mag, 'blizz', 1.5, 'ventisca'); } },
    marejada: { name: 'Marejada', mp: 40, cd: 8, col: '#4aa8ff', range: 7, target: true, aoe: 2.2,
        cast(m) { if (!m) return false; zone(m.x, m.y, 2.2, 3, 0.6, () => rint(12, 17) + P.lvl * 2 + totals().mag, 'tidal', 1.2, 'marejada'); } },
    curar2: { name: 'Curación mayor', mp: 35, cd: 6, col: '#7ee08a', range: 0, target: false,
        cast() { heal(70 + P.lvl * 5, 'godsbreath'); } },
    sismo: { name: 'Sismo', mp: 25, cd: 6, col: '#d9a45a', range: 0, target: false, aoe: 2.4,
        cast() { fx.push({ k: 'boom', x: P.x, y: P.y, t: 0, r: 2.4, c: '#d9a45a' }); const w = totals().wdmg; zone(P.x, P.y, 2.4, 1, 0, () => rint(12, 18) + P.lvl * 2 + rint(w[0], w[1]), 'cataclysm', 0, 'sismo'); } },
    remover: { name: 'Remover', mp: 20, cd: 10, col: '#9fe8ff', range: 0, target: false,
        cast() { if (P.frozenUntil <= now()) { toast('No estás paralizado.'); return false; } net.send({ $case: 'removerRequest', value: {} }); } },
    luz: { name: 'Pilar de luz', mp: 35, cd: 7, col: '#bfe6ff', range: 7, target: true, aoe: 1.9,
        cast(m) { if (!m) return false; const x = m.x, y = m.y; zone(x, y, 1.9, 2, 0.7, () => rint(14, 20) + P.lvl * 2 + totals().mag, 'spread', 0, 'luz'); later(0.5, () => { if (!P.dead && Math.hypot(P.x - x, P.y - y) <= 1.9) heal(25 + P.lvl * 3); }); } },
    invisibilidad: { name: 'Invisibilidad', mp: 40, cd: 20, col: '#9fb8ff', range: 0, target: false,
        cast() { efx('splash', P.x, P.y); net.send({ $case: 'invisibilityRequest', value: {} }); } },
    detectar: { name: 'Detectar invisible', mp: 30, cd: 12, col: '#ffe9a0', range: 0, target: false,
        cast() { efx('spread', P.x, P.y); net.send({ $case: 'detectInvisibleRequest', value: {} }); } },
    blink: { name: 'Blink', mp: 35, cd: 12, col: '#b9a3ff', range: 0, target: false, instant: true,
        cast() { const d = blinkDest(); if (!d) { toast('No hay lugar para el Blink hacia ahí.'); return false; } net.send({ $case: 'blinkRequest', value: { x: d.x, y: d.y } }); } },
    carga: { name: 'Embestida', mp: 15, cd: 10, col: '#ff9a4a', range: 6, target: true, instant: true,
        cast(m) { if (!isMob(m)) return false; skillSend('carga', 0n, m.id); } },
    giro: { name: 'Tajo giratorio', mp: 8, cd: 4, col: '#ffd0a0', range: 0, target: false, aoe: 1.9, instant: true,
        cast() { skillSend('giro'); } },
    grito: { name: 'Grito de guerra', mp: 20, cd: 25, col: '#c78bff', range: 0, target: false, instant: true,
        cast() { skillSend('grito'); } },
    furia: { name: 'Furia', mp: 15, cd: 20, col: '#ff3b2f', range: 0, target: false,
        cast() { efxLocal('flamme', P.x, P.y); pvpSend('flamme', P.x, P.y, 0n, 'furia'); P.fury = now() + 10; float(P.x, P.y - 0.4, '¡FURIA!', '#ff3b2f', true); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#ff3b2f' }); log('Furia: +30% de daño físico y +20% de daño en hechizos por 10 s, sin castigo.', true); } },
};
let SPELLS: Spell[] = [];
const SPECIAL_KEY: Record<string, string | undefined> = { remover: 'r', invisibilidad: 'f', detectar: 'g', blink: 'b', carga: 'z', giro: 'x', grito: 'v' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
/** Hechizo de área estilo Blizzard: varios golpes sobre las celdas cercanas al punto elegido. */
function zone(x: number, y: number, r: number, ticks: number, every: number, dmg: () => number, effect: string, slow = 0, sid = '') {
    for (let i = 0; i < ticks; i++) later(i * every, () => {
        if (P.dead) return;
        if (effect === 'blizz') { if (i === 0) { fx.push({ k: 'blizz', x, y, t: 0, r, d: ticks * every + 0.5 }); pvpSend('blizz', x, y, 0n, '', 0, r); } } else if (i === 0 || effect === 'cataclysm') efx(effect, x, y);
        if (!reduce && i === 0) shake = Math.max(shake, 0.15);
        for (const o of enemiesNear(x, y, r)) { if (sid) { pvpSend('', x, y, o.id, sid, slow && i === ticks - 1 ? slow : 0, r); } }
        for (const m of mobs.slice()) if (Math.hypot(m.x - x, m.y - y) <= r && !isSafe(m.x, m.y)) damageMob(m, dmg(), false, 'spell', slow && m.imm <= now() && i === ticks - 1 ? slow : 0);
    });
}
function heal(h: number, eff = 'sphere') { P.hp = Math.min(maxHp(), P.hp + h); syncHp(); float(P.x, P.y - 0.2, '+' + h, '#7ee08a'); efx(eff, P.x, P.y); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#7ee08a' }); }
function control(m: Target | null, secs: number, verb: string, noun: string, eff = 'stop'): false | void {
    if (!isMob(m)) return false;
    if (m.imm > now()) { log(`${m.name} es inmune al control por unos segundos.`); return false; }
    efx(eff, m.x, m.y); net.send({ $case: 'mobHitRequest', value: { mobId: m.id, dmg: 0, melee: false, crit: false, parSecs: secs, poisonSecs: 0 } });
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
const pots = { hp: 3, mp: 3, cd: 0 };
/** Delay global entre pociones (vida o maná), aparte de la recarga de los hechizos. Vida: 20 % al instante y el resto en 4 ticks de 0,5 s. El server valida y cura. */
const POTION_GCD = 1.75, POT_HOT_TICKS = 4, POT_HOT_EVERY = 0.5;
let potEpoch = 0;
function usePotion(k: 'hp' | 'mp') {
    if (P.dead) return;
    if (pots[k] < 1) { toast(`No tenés ${POTS[k].name.toLowerCase()}s. Comprá en el Mercader.`); return; }
    if (pots.cd > now()) return;
    if (k === 'hp' ? P.hp >= maxHp() : P.mp >= maxMp()) { toast(k === 'hp' ? 'Ya tenés la vida llena.' : 'Ya tenés el maná lleno.'); return; }
    pots.cd = now() + POTION_GCD; // el server descuenta la poción (llega en inventoryState)
    const epoch = ++potEpoch, local = !connected; // conectado: la vida y el maná los cura el server (llegan en Vitals); sin server curo yo
    if (connected) net.send({ $case: 'potionRequest', value: { kind: k === 'hp' ? 0 : 1 } });
    if (k === 'hp') {
        const total = Math.max(50, Math.round(maxHp() * 0.4)), first = Math.round(total * 0.2), rest = total - first, tick = Math.floor(rest / POT_HOT_TICKS);
        const heal = (n: number) => { if (local) P.hp = Math.min(maxHp(), P.hp + n); float(P.x, P.y - 0.2, '+' + n, '#7ee08a'); };
        heal(first); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#e0524a' });
        for (let i = 1; i <= POT_HOT_TICKS; i++) later(i * POT_HOT_EVERY, () => { if (!P.dead && epoch === potEpoch) heal(i === POT_HOT_TICKS ? rest - tick * (POT_HOT_TICKS - 1) : tick); }); // muerto o revivido: se corta
    } else { const m = Math.max(40, Math.round(maxMp() * 0.5)); if (local) { P.mp = Math.min(maxMp(), P.mp + m); mpLocalAt = now(); } float(P.x, P.y - 0.2, '+' + m + ' maná', '#7fb7ff'); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#4a8fe0' }); }
    syncHp(); efx('sphere', P.x, P.y); renderPots();
}
/** Overlay del delay global sobre los chips de pociones (Q/E) y sus slots en la bolsa. */
function potCdTick() {
    const left = Math.max(0, pots.cd - now()), t = left > 0 ? left.toFixed(1) : '';
    document.querySelectorAll<HTMLElement>('.cdv[data-gcd]').forEach((el) => {
        if (left > 0) { el.style.display = 'flex'; el.style.background = `conic-gradient(rgba(0,0,0,0) 0 ${(1 - left / POTION_GCD) * 100}%, rgba(5,3,8,.74) 0 100%)`; if (el.textContent !== t) el.textContent = t; }
        else if (el.style.display) { el.style.display = ''; el.textContent = ''; }
    });
}
const POT_ART = { hp: 'curar', mp: 'burbuja-arcana' };
function renderPots() { for (const k of ['hp', 'mp'] as const) { const el = $('pot' + k); el.title = `${POTS[k].name} (${POTS[k].key}): quedan ${pots[k]}`; el.setAttribute('aria-label', `${POTS[k].name}, tecla ${POTS[k].key}, quedan ${pots[k]}`); el.classList.toggle('none', pots[k] <= 0); el.innerHTML = `<span class="sq"><img alt="" src="assets/spells/${POT_ART[k]}.png"></span><kbd>${POTS[k].key}</kbd><em>${pots[k]}</em><i class="cdv" data-gcd></i>`; } potCdTick(); }
// ---------- /meditar: quieto, el maná sube rápido; se corta si te movés, casteás o te pegan ----------
function stopMeditating(msg?: string) { if (!P.med) return; P.med = false; if (msg) log(msg, true); syncHp(); }
function toggleMeditate() {
    if (P.med) { stopMeditating('Dejaste de meditar.'); return; }
    if (P.dead || P.casting || P.step || P.path.length) { log('Tenés que estar quieto para meditar.', true); return; }
    if (P.mp >= maxMp()) { log('Ya tenés el maná lleno.', true); return; }
    P.med = true; P.medHp = P.hp; syncHp(); log('Meditás… el maná sube rápido mientras estés quieto. (/meditar de nuevo para cortar)', true);
}
function nearestEnemy(range: number) { let b: Other | null = null, bd = range; for (const o of others.values()) { if (!isEnemy(o)) continue; const d = dist(P, o); if (d <= bd) { bd = d; b = o; } } return b; }
function pickEnemy(sx: number, sy: number) { for (const o of others.values()) { if (!isEnemy(o)) continue; const p = toScreen(o.x, o.y); if (Math.abs(sx - p.x) < 24 * Z && sy > p.y - 76 * Z && sy < p.y + 12 * Z) return o; } return null; }
const CAST_T = 0.7; // como en HB: todos los hechizos tardan lo mismo en cargar
function cast(i: number) {
    if (P.dead) return; const s = SPELLS[i];
    if (P.ready && P.ready.i === i && s.target) { const m = autoTarget(s.range), e = m ? null : nearestEnemy(s.range); if (m) release(m); else if (e) release({ x: e.x, y: e.y, pvp: e }); else toast('Hacé clic en el objetivo.'); return; }
    if (s.fury && P.fury <= now()) { toast(`${s.name} solo se puede usar con Furia.`); return; }
    if (P.casting && !s.instant) { toast('Ya estás casteando.'); return; }
    if (cds[i] > now()) { toast(`${s.name} se está recargando.`); return; }
    if (P.mp < s.mp) { toast('No te alcanza el maná.'); return; }
    if (s.instant) { instantCast(i); return; }
    P.ready = null; P.engage = false; P.queued = null; P.path = []; holding = false;
    const T = now(); P.casting = { i, start: T, end: T + CAST_T, len: CAST_T };
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
    const c = P.casting!, s = SPELLS[c.i]; P.casting = null;
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
function fire(i: number, m: Target | null) {
    const s = SPELLS[i];
    if (m && 'pvp' in m && !s.aoe) { if (!pvpCast(s.id, (m as { pvp: Other }).pvp)) return; } else if (s.cast(m) === false) return;
    const srvMp = ['furia', 'invisibilidad', 'detectar', 'remover', 'blink', 'carga', 'giro', 'grito'].includes(s.id ?? '') || (m && 'pvp' in m && !s.aoe)
        || (!!s.aoe && enemiesNear(m ? m.x : P.x, m ? m.y : P.y, s.aoe + 0.5).length > 0); // si pega a un jugador, el server cobra
    spendMp(s.mp, srvMp); syncHp(); cds[i] = now() + s.cd;
    P.one = { anim: 'cast', t: now() - 0.3, until: now() + 0.12 };
    fx.push({ k: 'burst', x: P.x, y: P.y, t: 0, c: s.col });
    const b = $('sp' + i); b.classList.remove('fired'); void b.offsetWidth; b.classList.add('fired');
}
function cancelCast(why?: string | null) { if (!P.casting && !P.ready) return; P.casting = null; P.ready = null; if (why) toast(why); }
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 1600); }

// ---------- assets ----------
interface Anim { row: number; n: number; dur: number; type: string }
interface SpriteMeta { sc?: number; cw: number; ch: number; ax: number; ay: number; anims: Record<string, Anim> }
const SPR: Record<string, SpriteMeta> = {};
let WORLD: Record<string, number[]> = {};
const IMG: Record<string, CanvasImageSource> = {};
// Efectos TOMAS (Miradin, CC-BY-SA) horneados a cuadros; se dibujan en aditivo. Si no cargan, el juego sigue con los efectos simples.
let FXM: { cell: number; frames: number; rows: Record<string, { row: number; fps: number; scale: number }> } | null = null;
const efxLocal = (n: string, x: number, y: number, dy = 0) => { if (FXM?.rows[n]) fx.push({ k: 'efx', n, x, y, t: 0, dy }); };
/** Efecto de mis hechizos: lo veo yo y los jugadores cercanos. */
const efx = (n: string, x: number, y: number, dy = 0) => { efxLocal(n, x, y, dy); if (connected) pvpSend(n, x, y); };
// ---------- PvP: bandos enemigos (y todos contra todos en la arena) ----------
const ARENA = { x0: 46, y0: 26, x1: 61, y1: 39 };
const inArena = (x: number, y: number) => x >= ARENA.x0 && x < ARENA.x1 && y >= ARENA.y0 && y < ARENA.y1;
const facOf = (profile: string) => profile.split(';')[0];
const unseen = (o: Other) => !!o.inv && !P.det && facOf(o.profile) !== selectedFaction;
const isEnemy = (o: Other) => !o.gone && !unseen(o) && !isSafe(o.x, o.y) && !isSafe(P.x, P.y) && (facOf(o.profile) !== selectedFaction || (inArena(P.x, P.y) && inArena(o.x, o.y)));
const enemiesNear = (x: number, y: number, r: number) => [...others.values()].filter((o) => isEnemy(o) && Math.hypot(o.x - x, o.y - y) <= r);
/** Avisa al server qué hechizo lancé y sobre quién; el daño lo calcula el server (el campo dmg ya no se usa). */
function pvpSend(fx: string, x: number, y: number, targetId = 0n, spell = '', secs = 0, r = 0) { net.send({ $case: 'pvpHitRequest', value: { fx, x, y, targetId, dmg: 0, secs, r, spell } }); }
/** Le pega a un jugador enemigo: el server calcula el daño y el cliente de él lo aplica. `secs` > 0 pide la parálisis del hechizo. */
function pvpDamage(o: Other, spell: string, fxName: string, secs = 0) {
    if (fxName) efxLocal(fxName, o.x, o.y, 8);
    pvpSend(fxName, o.x, o.y, o.id, spell, secs);
}
/** Hechizos de un solo objetivo contra un jugador. */
function pvpCast(id: string | undefined, o: Other): boolean {
    switch (id) {
        case 'proyectil': later(dist(P, o) / 11, () => { if (isEnemy(o)) pvpDamage(o, 'proyectil', 'splash'); }); return true;
        case 'paralisis': pvpDamage(o, 'paralisis', 'stop', 3); return true;
        case 'aturdir': pvpDamage(o, 'aturdir', 'turbulence', 2.5); return true;
        case 'hoja': pvpDamage(o, 'hoja', 'windblade'); return true;
        case 'lanza': pvpDamage(o, 'lanza', 'rocklance'); return true;
        case 'golpe': pvpDamage(o, 'golpe', 'crosswind'); return true;
        case 'tajo': pvpDamage(o, 'tajo', 'crosswind'); return true;
        case 'carga': skillSend('carga', o.id); return true;
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
function composeLook(names: string[]): HTMLCanvasElement | null {
    const ims = names.map(piece); if (ims.some((i) => !i)) return null;
    const { cw, ch, cols } = PAPER, rows = Object.keys(SPR.hero.anims).length * 8, c = document.createElement('canvas'), g = c.getContext('2d')!;
    c.width = cw * cols; c.height = ch * rows;
    for (let d = 0; d < 8; d++) for (const t of PAPER.order[d]) names.forEach((n, k) => {
        if (PAPER.pieces[n] !== t) return;
        for (let r = 0; r < rows / 8; r++) g.drawImage(ims[k]!, 0, (r * 8 + d) * ch, c.width, ch, 0, (r * 8 + d) * ch, c.width, ch);
    });
    return c;
}
/** Piezas que lleva puesto el personaje, según su equipo. */
function lookOf(): string[] {
    const set = PAPER.sets[P.eq.armadura?.look ?? 'default'] ?? PAPER.sets.default, w = P.eq.arma;
    return [...set, CLS.head, ...(P.eq.cabeza?.look ? [P.eq.cabeza.look] : []), ...(w?.look ? [w.look] : []), ...(w?.off ? [w.off] : [])];
}
// ---------- bando y perfil visible para los demás ----------
const FACTIONS = [{ id: 'solmar', name: 'Solmar', col: '#6fb3ff', desc: 'Reino del sol y el mar' }, { id: 'vhar', name: 'Vhar', col: '#ff7a6b', desc: 'Tierras del hierro y la ceniza' }];
let selectedFaction = 'solmar';
const factionCol = (id: string) => FACTIONS.find((f) => f.id === id)?.col ?? '#e9dfc0';
const profileOf = () => `${selectedFaction};${CLS.id};${lookOf().join(',')}`;
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
    const names = lookOf(), key = names.join('|');
    if (key !== lookKey) { const c = composeLook(names); if (c) { IMG.hero = c; lookKey = key; sendProfile(); } }
    const other = ['leather_boots', 'leather_pants', 'leather_gloves', 'leather_chest', 'head_short', 'shortsword', 'buckler'];
    if (!IMG.hero_other) { const c = composeLook(other); if (c) IMG.hero_other = c; }
    refreshNpcLook();
}
function drawSprite(name: string, anim: string, t: number, dir: number, x: number, y: number, tint?: string | null, alpha?: number) {
    const M = SPR[name], A = M?.anims[anim], im = IMG[name]; if (!A || !im) return;
    const i = frameIndex(A, t), sx = i * M.cw, sy = (A.row + dir) * M.ch, k = SS * (M.sc ?? 1), dw = M.cw * k, dh = M.ch * k, dx = x - M.ax * k, dy = y - M.ay * k;
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
/** Atlas extra (cripta de Kenney y terreno de SBS): id -> imagen y recorte [x, y, w, h, ox, oy]. */
const EXT: Record<number, { im: CanvasImageSource; p: number[] }> = {};
function drawWorld(id: number, x: number, y: number) { const e = EXT[id]; if (e) { const q = e.p; ctx.drawImage(e.im, q[0], q[1], q[2], q[3], Math.round(x - q[4]), Math.round(y - q[5]), q[2], q[3]); return; } const w = WORLD[id]; if (!w) return; ctx.drawImage(IMG.world, w[0], w[1], w[2], w[3], x - w[4], y - w[5], w[2], w[3]); }

// ---------- canvas ----------
const cv = $('cv') as HTMLCanvasElement, ctx = cv.getContext('2d')!;
let W = 0, H = 0, DPR = 1, Z = 1;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR; Z = clamp(Math.min(W, H) / 520, 0.9, 1.45); }
window.addEventListener('resize', resize); resize();
const cam = { x: 0, y: 0, sx: 0, sy: 0 };
const toScreen = (gx: number, gy: number) => { const p = iso(gx, gy); return { x: (p.x - cam.x) * Z + W / 2 + cam.sx, y: (p.y - cam.y) * Z + H / 2 + cam.sy }; };
const toGrid = (sx: number, sy: number) => { const x = (sx - W / 2 - cam.sx) / Z + cam.x, y = (sy - H / 2 - cam.sy) / Z + cam.y; return { x: (x / (TW / 2) + y / (TH / 2)) / 2, y: (y / (TH / 2) - x / (TW / 2)) / 2 }; };

let hover: Mob | null = null, mouse = { x: -1, y: -1 };
function pickMob(sx: number, sy: number) {
    let best: Mob | null = null, bd = 1e9;
    for (const m of mobs) {
        const p = toScreen(m.x, m.y); const top = p.y - (m.head + 8) * Z, bot = p.y + 12 * Z, hw = (m.hitR + 6) * Z;
        if (sx < p.x - hw || sx > p.x + hw || sy < top || sy > bot) continue;
        const d = Math.hypot(sx - p.x, sy - (top + bot) / 2); if (d < bd) { bd = d; best = m; }
    }
    return best;
}
function pickDrop(sx: number, sy: number) { for (const d of drops) { const p = toScreen(d.x, d.y); if (Math.hypot(sx - p.x, sy - p.y) < 18 * Z) return d; } return null; }

/** Celdas que ocupa otro jugador (el server no deja pisarlas). */
const occupiedByOther = (x: number, y: number) => { for (const o of others.values()) if (o.cell.x === x && o.cell.y === y) return true; return false; };
const freeForMe = (x: number, y: number) => walk(x, y) && !occupiedByOther(x, y);

/** Camino de celdas hasta (gx, gy); el paso que está en curso termina igual. */
function moveTo(gx: number, gy: number) {
    const from = P.step ? { x: P.step.tx, y: P.step.ty } : P.cell;
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

let holding = false, holdT = 0;
cv.addEventListener('pointerdown', (e) => {
    cv.focus({ preventScroll: true });
    if (P.dead || !connected) return; const r = cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const m = pickMob(sx, sy), en = !m ? pickEnemy(sx, sy) : null;
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
    const d = pickDrop(sx, sy);
    if (d) { cancelCast(); P.target = null; P.engage = false; P.pickup = d; moveTo(d.x, d.y); return; }
    cancelCast(P.casting || P.ready ? 'Hechizo cancelado.' : null);
    holding = true; holdT = 0.18; mouse = { x: sx, y: sy };
    P.engage = false; P.target = null; P.pickup = null; P.queued = null; const g = toGrid(sx, sy); if (moveTo(g.x, g.y)) fx.push({ k: 'click', x: Math.floor(g.x) + 0.5, y: Math.floor(g.y) + 0.5, t: 0 });
});
cv.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelCast('Hechizo cancelado.'); });
cv.addEventListener('pointerup', () => { holding = false; });
cv.addEventListener('pointercancel', () => { holding = false; });
cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
cv.addEventListener('pointerleave', () => { mouse = { x: -1, y: -1 }; });

const chatIn = $('chatIn') as HTMLInputElement;
window.addEventListener('keydown', (e) => {
    if (!connected) return;
    if (document.activeElement === chatIn) {
        if (e.key === 'Enter') {
            const text = chatIn.value.trim();
            if (/^\/meditar$/i.test(text)) toggleMeditate();
            else if (text.startsWith('/')) log('Comandos: /meditar');
            else if (text) net.send({ $case: 'chatMessageSendRequest', value: { message: text } });
            chatIn.value = ''; chatIn.blur(); cv.focus({ preventScroll: true }); e.preventDefault();
        } else if (e.key === 'Escape') { chatIn.blur(); cv.focus({ preventScroll: true }); }
        return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') { e.preventDefault(); chatIn.focus(); return; }
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'q' || e.key === 'Q')) { usePotion('hp'); return; }
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'e' || e.key === 'E')) { usePotion('mp'); return; }
    const hk = SPELLS.findIndex((x) => SPECIAL_KEY[x.id ?? ''] === e.key.toLowerCase()) >= 0 ? SPELLS.findIndex((x) => SPECIAL_KEY[x.id ?? ''] === e.key.toLowerCase()) : KEYS.indexOf(e.key), dm = /^(?:Digit|Numpad)([0-9])$/.exec(e.code), k = hk >= 0 ? hk : dm ? KEYS.indexOf(dm[1]) : null;
    if (k != null && k < SPELLS.length && !e.repeat) { e.preventDefault(); cast(k); }
    if (e.key === 'i' || e.key === 'I') toggleBag();
    if (e.key === 'c' || e.key === 'C') toggleChar();
    if (e.key === 'Escape') { if (P.casting || P.ready) cancelCast('Hechizo cancelado.'); else P.target = null; }
});

// ---------- update ----------
/** Avanza un paso celda a celda (jugadores): posición interpolada, giro y fase de la animación. */
function advanceStep(e: Ent & { step: Step | null }, T: number, dt: number) {
    const s = e.step!; const k = Math.min(1, (T - s.t0) / s.dur);
    e.x = s.fx + (s.tx - s.fx) * k + 0.5; e.y = s.fy + (s.ty - s.fy) * k + 0.5;
    turnTo(e, s.tx - s.fx, s.ty - s.fy, dt);
    e.phase = (e.phase || 0) + (dt * (Math.hypot(s.tx - s.fx, s.ty - s.fy) / s.dur)) / (e.ref || 3.4);
    e.moving = true;
    if (k >= 1) e.step = null;
}
/** Margen sobre la velocidad del server para que la latencia no haga parecer que vamos rápido de más. */
const STEP_MARGIN = 0.015;
let regenT = 0, pingSeq = 0, pveT = 0, pveSent = { dead: false, lvl: 0 };
/** El ping va por un timer propio (no por el bucle de dibujo, que el navegador frena en pestañas ocultas) para que no te desconecten. */
setInterval(() => { if (connected) net.send({ $case: 'pingRequest', value: { sequence: ++pingSeq } }); }, 1000);
function update(dt: number) {
    const T = now(), tot = totals();
    for (const p of pending.slice()) if (T >= p.t) { pending.splice(pending.indexOf(p), 1); p.fn(); }
    if (holding && !P.dead && !P.target && !P.casting && mouse.x >= 0) { holdT -= dt; if (holdT <= 0) { holdT = 0.18; const g = toGrid(mouse.x, mouse.y); if (Math.hypot(g.x - P.x, g.y - P.y) > 0.7) moveTo(g.x, g.y); } }
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
            else if (!P.step) {
                P.path = []; turnTo(P, m.x - P.x, m.y - P.y, dt);
                if (T >= P.nextAtk && T >= P.frozenUntil) { const iv = 0.85 / (1 + tot.aspd / 100); P.nextAtk = T + iv; sendFacing(); oneShot(P, 'swing', Math.min(0.4, iv)); later(0.18, () => { if (mobs.includes(m) && dist(P, m) < 1.9 && !P.dead) meleeHit(m); }); }
            }
        }
        if (P.foe && !isEnemy(P.foe)) P.foe = null;
        if (P.foe && !P.casting && !P.dead) {
            const f = P.foe, d = dist(P, f);
            if (d > 1.6) { P.repath -= dt; if (P.repath <= 0 || !P.path.length) { moveTo(f.x, f.y); P.repath = 0.35; } }
            else if (!P.step) {
                P.path = []; turnTo(P, f.x - P.x, f.y - P.y, dt);
                if (T >= P.nextAtk && T >= P.frozenUntil) { const iv = 0.85 / (1 + tot.aspd / 100); P.nextAtk = T + iv; sendFacing(); oneShot(P, 'swing', Math.min(0.4, iv)); later(0.18, () => { if (isEnemy(f) && dist(P, f) < 1.9 && !P.dead) { pvpDamage(f, 'ataque', ''); } }); }
            }
        }
        // caminar: un paso por vez; el server valida cada uno
        if (P.step) advanceStep(P, T, dt);
        if (!P.step && P.path.length && !P.casting && T >= P.frozenUntil) {
            const next = P.path[0];
            if (occupiedByOther(next.x, next.y)) { const end = P.path[P.path.length - 1]; P.path = []; if (end !== next) moveTo(end.x + 0.5, end.y + 0.5); }
            else {
                P.path.shift();
                net.send({ $case: 'requestMovement', value: { curX: P.cell.x, curY: P.cell.y, destX: next.x, destY: next.y, gameWorldId: MAP_WORLD_ID, dashAttack: false } });
                P.step = { fx: P.cell.x, fy: P.cell.y, tx: next.x, ty: next.y, t0: T, dur: (P.stepMs / 1000) * (P.slowEnd > T ? 1.7 : 1) + STEP_MARGIN };
                P.cell = { x: next.x, y: next.y };
                advanceStep(P, T, 0);
            }
        }
        if (!P.step && !P.path.length && !P.moving) sendFacing();
        if (P.pickup && dist(P, P.pickup) < 0.9) {
            // el botín ya no cae al suelo: el server lo pone en la bolsa al matar (ver killReward); no hay nada que juntar acá
            P.pickup = null;
        }
        regenT += dt; if (regenT >= 1) { regenT = 0; const inCity = isSafe(P.x, P.y); P.hp = Math.min(maxHp(), P.hp + (inCity ? 8 : 1)); P.mp = Math.min(maxMp(), P.mp + (P.med ? Math.max(6, Math.round(maxMp() * 0.08)) : inCity ? 8 : 2)); if (P.med && P.mp >= maxMp()) stopMeditating('Terminaste de meditar: maná lleno.'); syncHp(); }
        if (P.med && (P.step || P.path.length || P.casting || P.hp < P.medHp || P.dead)) stopMeditating(P.hp < P.medHp ? 'Te sacaron de la meditación.' : 'Dejaste de meditar.');
        if (P.med) P.medHp = P.hp;
    }
    // otros jugadores: siguen los pasos que manda el server
    for (const o of others.values()) {
        o.moving = false;
        if (!o.step && o.queue.length) {
            if (o.queue.length > 3) { const last = o.queue.splice(0, o.queue.length - 1)[0]; o.cell = { ...last }; }
            const next = o.queue.shift()!;
            o.step = { fx: o.cell.x, fy: o.cell.y, tx: next.x, ty: next.y, t0: T, dur: o.stepMs / 1000 };
            o.cell = next;
        }
        if (o.step) advanceStep(o, T, dt);
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
        const d = dist(p, pm); if (d < 0.3) { fx.push({ k: 'ring', x: pm.x, y: pm.y, t: 0, c: '#c9b6ff' }); efx('splash', pm.x, pm.y, 10); damageMob(pm, p.dmg, false, 'spell'); projs.splice(projs.indexOf(p), 1); continue; }
        p.x += ((pm.x - p.x) / d) * p.spd * dt; p.y += ((pm.y - p.y) / d) * p.spd * dt;
    }
    for (const c of corpses.slice()) if (T - c.t > 3) corpses.splice(corpses.indexOf(c), 1);
    for (const f of floats.slice()) { f.t += dt; if (f.t > 1.1) floats.splice(floats.indexOf(f), 1); }
    for (const f of fx.slice()) { f.t += dt; if (f.t > (f.d ?? (f.k === 'efx' ? 0.72 : 0.6))) fx.splice(fx.indexOf(f), 1); }
    for (const d of drops) d.t += dt;
}
function updateHover() {
    hover = mouse.x >= 0 ? pickMob(mouse.x, mouse.y) : null;
    cv.style.cursor = !hover && !P.ready && mouse.x >= 0 && pickNpc(mouse.x, mouse.y) ? 'pointer' : P.ready ? 'cell' : hover ? 'pointer' : mouse.x >= 0 && pickDrop(mouse.x, mouse.y) ? 'grab' : 'crosshair';
}
function updateCam(dt: number) {
    const pt = iso(P.x, P.y); const k = 1 - Math.exp(-dt * 7); cam.x += (pt.x - cam.x) * k; cam.y += (pt.y - cam.y) * k;
    shake = Math.max(0, shake - dt); const s = shake * 14; cam.sx = (R() * 2 - 1) * s; cam.sy = (R() * 2 - 1) * s;
}

// ---------- dibujo ----------
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
    else if (role === 'capitan') { ctx.moveTo(-4, -6.5); ctx.lineTo(-4, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-3.5, -6); ctx.lineTo(5.5, -3.5); ctx.lineTo(-3.5, -0.5); ctx.closePath(); ctx.fill(); }
    else { ctx.moveTo(-5, 3); ctx.lineTo(-5, -1); ctx.quadraticCurveTo(-5, -6.5, 0, -6.5); ctx.quadraticCurveTo(5, -6.5, 5, -1); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(14,18,14,.85)'; ctx.fillRect(-3.5, -1.2, 7, 1.8); ctx.fillRect(-0.8, -1.2, 1.6, 6); }
    ctx.restore();
}
function nameTag(name: string, x: number, y: number, col: string, alpha = 1, size = 11) {
    ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.font = `600 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(name, x, y); ctx.fillStyle = col; ctx.fillText(name, x, y); ctx.globalAlpha = 1;
}
// ---------- Portal de Frontera (waypoint estilo Diablo): pad rúnico, arco de piedra y cartel (todo dibujado acá) ----------
const WAYPOINTS: Waypoint[] = MAP.waypoints ?? [];
const MY_WPS = () => WAYPOINTS.filter((q) => q.kind === 'zone' || q.faction === selectedFaction);
const wpCol = (q: Waypoint) => (q.kind === 'city' ? '#e2b04a' : TRAINING[q.step!].col);
const wpScale = (q: Waypoint) => (q.kind === 'city' ? 2.7 : 0.62);
const ell = (x: number, y: number, rx: number, ry: number) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); };
const ellF = (x: number, y: number, rx: number, ry: number) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
function drawPortalPad(q: Waypoint, T: number) {
    const col = wpCol(q), k = wpScale(q), c0 = iso(q.x + 0.5, q.y + 0.5), pulse = 0.5 + 0.5 * Math.sin(T * 2.2 + q.x * 0.7), lw = 1 / Math.sqrt(k);
    ctx.save(); ctx.translate(c0.x, c0.y); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(14,16,24,.62)'; ellF(0, 0, 36, 18);
    ctx.strokeStyle = col; ctx.lineWidth = 3 * lw; ctx.globalAlpha = 0.9; ell(0, 0, 36, 18); ctx.globalAlpha = 1;
    // runas en el borde: giran
    for (let j = 0; j < 12; j++) {
        const a = (j / 12) * Math.PI * 2 + (reduce ? 0 : T * 0.5), cx = Math.cos(a), cy = Math.sin(a);
        ctx.strokeStyle = col; ctx.lineWidth = 2 * lw; ctx.beginPath(); ctx.moveTo(cx * 29, cy * 14.5); ctx.lineTo(cx * 34, cy * 17); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 36); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.35 + pulse * 0.25; ctx.fillStyle = g; ellF(0, 0, 34, 17);
    ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.lineWidth = 1.5 * lw; ctx.setLineDash([7, 6]); ctx.lineDashOffset = -T * 18; ell(0, 0, 22, 11);
    ctx.setLineDash([]);
    if (q.kind === 'city') { ell(0, 0, 12, 6); ctx.beginPath(); for (let j = 0; j < 6; j++) { const a = (j / 6) * Math.PI * 2 + T * 0.3; ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 8.5); } ctx.closePath(); ctx.stroke(); }
    const bg = ctx.createLinearGradient(0, 0, 0, -78); bg.addColorStop(0, col); bg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.16 + pulse * 0.1; ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-20, -78); ctx.lineTo(20, -78); ctx.lineTo(26, 0); ctx.closePath(); ctx.fill();
    if (!reduce) for (let j = 0; j < 6; j++) { const t = (T * 0.45 + j * 0.17) % 1; ctx.globalAlpha = (1 - t) * 0.9; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(Math.sin(j * 5.1 + T) * 16, -4 - t * 60, 1.6 * lw, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
}
function drawPortalArch(q: Waypoint, T: number) {
    const col = wpCol(q), k = wpScale(q), c0 = iso(q.x + 0.5, q.y + 0.5);
    ctx.save(); ctx.translate(c0.x, c0.y); ctx.scale(k, k);
    for (const sx of [-1, 1]) { // dos pilares de piedra con una gema rúnica arriba
        const px = sx * 31, py = -2;
        ctx.fillStyle = '#5d626b'; ctx.fillRect(px - 5, py - 46, 10, 46); ctx.fillStyle = sx < 0 ? '#7a808a' : '#464b53'; ctx.fillRect(px - (sx < 0 ? 5 : 0), py - 46, 5, 46);
        ctx.fillStyle = '#6f7580'; ctx.fillRect(px - 7, py - 50, 14, 5); ctx.fillRect(px - 7, py - 2, 14, 4);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px, py - 62); ctx.lineTo(px + 5, py - 55); ctx.lineTo(px, py - 49); ctx.lineTo(px - 5, py - 55); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(px, py - 55, 0, px, py - 55, 14); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(T * 3 + sx); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py - 55, 14, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = '#6a707a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, -48, 31, 11, 0, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.ellipse(0, -48, 31, 11, 0, Math.PI, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    if (q.kind === 'city') { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -66); ctx.lineTo(5, -58); ctx.lineTo(0, -51); ctx.lineTo(-5, -58); ctx.closePath(); ctx.fill(); }
    ctx.restore();
}
/** Cartel de cada portal: "Portal de Frontera" en la plaza; los chicos de las zonas dicen "Portal de regreso" cerca. */
function drawPortalLabels() {
    for (const q of WAYPOINTS) {
        const d = Math.hypot(q.x + 0.5 - P.x, q.y + 0.5 - P.y), c = iso(q.x + 0.5, q.y + 0.5);
        if (q.kind === 'city') { if (d > 18) continue; nameTag('Portal de Frontera', c.x, c.y - 185, wpCol(q), 1, 14); if (d < 7) nameTag('Tocá el portal para viajar', c.x, c.y - 168, '#d9d2b8', 1, 10); }
        else if (d < 9) { nameTag('Portal de regreso', c.x, c.y - 52, wpCol(q), 1, 10); if (d < 4) nameTag(q.name, c.x, c.y - 40, '#d9d2b8', 1, 9); }
    }
}
function render() {
    const T = now();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0d100e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR * Z, 0, 0, DPR * Z, DPR * (W / 2 - cam.x * Z + cam.sx), DPR * (H / 2 - cam.y * Z + cam.sy));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const c0 = toGrid(0, 0), c1 = toGrid(W, 0), c2 = toGrid(0, H), c3 = toGrid(W, H);
    const minX = Math.max(0, Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)) - 2), maxX = Math.min(N - 1, Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)) + 2);
    const minY = Math.max(0, Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)) - 2), maxY = Math.min(N - 1, Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)) + 2);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const p = iso(x + 0.5, y + 0.5); drawWorld(tiles[y][x], p.x, p.y); }
    for (const d of decals) { const p = iso(d.x, d.y); drawWorld(d.id, p.x, p.y); }
    for (const q of WAYPOINTS) if (q.x >= minX - 3 && q.x <= maxX + 3 && q.y >= minY - 3 && q.y <= maxY + 3) drawPortalPad(q, T);
    for (const f of fx) if (f.k === 'click') { const p = iso(f.x, f.y); ctx.globalAlpha = 1 - f.t / 0.6; ctx.strokeStyle = '#d6a445'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 + f.t * 30, (10 + f.t * 30) / 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    for (const sc of scorch.slice()) { const age = T - sc.t; if (age > 5) { scorch.splice(scorch.indexOf(sc), 1); continue; } const p = iso(sc.x, sc.y); ctx.globalAlpha = Math.min(1, (5 - age) / 2) * 0.55; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sc.r * TW * 0.45); g.addColorStop(0, '#120a05'); g.addColorStop(0.7, 'rgba(30,15,5,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, sc.r * TW * 0.45, sc.r * TW * 0.225, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    if (P.casting) {
        const c = P.casting, s = SPELLS[c.i], k = clamp((T - c.start) / (c.end - c.start), 0, 1), p = iso(P.x, P.y), r = 20 + k * 8;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = s.col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4 + k * 0.5;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r / 2, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 0.7, r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
        for (let j = 0; j < 6; j++) { const a = (j / 6) * Math.PI * 2 + T * 1.6; ctx.fillStyle = s.col; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * r * 0.85, p.y + Math.sin(a) * r * 0.425, 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }
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
    for (const b of MAP.buildings) objs.push({ d: b.x + b.y + (b.w + b.h) / 2, f: () => drawBuilding(b) });
    for (const n of MAP.npcs) objs.push({ d: n.x + n.y + 1, f: () => drawNpc(n, T) });
    for (const d of drops) objs.push({ d: d.x + d.y - 0.2, f: () => drawDrop(d, T) });
    for (const c of corpses) objs.push({ d: c.x + c.y - 0.3, f: () => { const p = iso(c.x, c.y), age = T - c.t; drawSprite(c.sprite, 'die', age, c.dir, p.x, p.y, null, age > 2 ? 3 - age : 1); } });
    for (const m of mobs) objs.push({ d: m.x + m.y, f: () => drawMob(m, T) });
    for (const o of others.values()) objs.push({ d: o.x + o.y, f: () => { const p = iso(o.x, o.y), [a, t] = animFor(o, T); if (unseen(o)) return; drawSprite(otherSprite(o), a, t, o.dir, p.x, p.y, o.inv ? 'rgba(150,200,255,.25)' : null, o.inv ? 0.35 + 0.1 * Math.sin(T * 5) : o.gone ? 0.45 : 1); if (o.fury) { ctx.save(); ctx.globalAlpha = 0.35 + 0.15 * Math.sin(T * 8); ctx.strokeStyle = '#ff5a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 22, 11, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } } });
    objs.push({ d: P.x + P.y, f: () => { const p = iso(P.x, P.y); if (P.frozenUntil > T && !P.dead) { ctx.strokeStyle = 'rgba(190,235,255,.85)'; ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 8 - i * 14, 16, 6, 0, 0, Math.PI * 2); ctx.stroke(); } } if (P.dead) drawSprite('hero', 'die', T - P.deadT, P.dir, p.x, p.y); else {
            const [a, t] = animFor(P, T), bz = P.fury > T;
            if (P.med) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = 0.5 + 0.5 * Math.sin(T * 3); ctx.strokeStyle = `rgba(110,170,255,${0.35 + k * 0.4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 16 + k * 14, (16 + k * 14) / 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(p.x, p.y - 20 - k * 22, 5, 2.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
            if (bz) { // berserk: aura de brasas bajo los pies y piel enrojecida que late (los últimos 2 s parpadea para avisar que se acaba)
                const k = 0.5 + 0.5 * Math.sin(T * 9), warn = P.fury - T < 2 && Math.floor(T * 5) % 2 === 0;
                ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 34); g.addColorStop(0, `rgba(255,${120 + k * 80 | 0},40,${warn ? 0.2 : 0.55})`); g.addColorStop(1, 'rgba(255,60,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, 34, 17, 0, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = `rgba(255,${150 + k * 90 | 0},60,.6)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 20 + k * 6, (20 + k * 6) / 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            }
            drawSprite('hero', a, t, P.dir, p.x, p.y, P.flash > 0 ? 'rgba(255,70,50,.35)' : P.inv ? 'rgba(150,200,255,.25)' : bz ? `rgba(255,${90 + (0.5 + 0.5 * Math.sin(T * 9)) * 70 | 0},20,.32)` : null, P.inv ? 0.4 + 0.1 * Math.sin(T * 5) : 1);
        } } });
    objs.sort((a, b) => a.d - b.d).forEach((o) => o.f());
    // nombres arriba de todo
    for (const o of others.values()) { if (unseen(o)) continue; const p = iso(o.x, o.y); nameTag(o.name, p.x, p.y - 70, factionCol(o.profile.split(';')[0]), o.gone ? 0.5 : 1); if (o.maxHp && o.hp !== undefined && o.hp < o.maxHp) { const f = Math.max(0, o.hp / o.maxHp); ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - 17, p.y - 66, 34, 5); ctx.fillStyle = isEnemy(o) ? '#d9443a' : '#58b85a'; ctx.fillRect(p.x - 16, p.y - 65, 32 * f, 3); } }
    { const p = iso(P.x, P.y); nameTag(P.name, p.x, p.y - 70, factionCol(selectedFaction)); }
    drawPortalLabels();
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
        const w = 34; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - w / 2 - 1, p.y + 8, w + 2, 5); ctx.fillStyle = s.col; ctx.fillRect(p.x - w / 2, p.y + 9, w * k, 3);
    }
    for (const f of fx) if (f.k === 'boom') {
        const p = iso(f.x, f.y), k = f.t / 0.6, R2 = f.r! * TW * 0.5;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
        const g = ctx.createRadialGradient(p.x, p.y - 10, 0, p.x, p.y - 10, R2 * (0.4 + k)); g.addColorStop(0, '#fff3c0'); g.addColorStop(0.35, f.c ?? '#ff8a3d'); g.addColorStop(1, 'rgba(120,30,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y - 10, R2 * (0.4 + k), R2 * (0.4 + k) * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = f.c ?? '#ffb070'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y, R2 * k * 1.1, R2 * k * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    for (const f of fx) if (f.k === 'burst') { const p = iso(f.x, f.y), k = f.t / 0.6; if (k > 0.5) continue; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k * 2; ctx.fillStyle = f.c!; ctx.beginPath(); ctx.arc(p.x, p.y - 34, 10 + k * 30, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (FXM && IMG.fx) for (const f of fx) if (f.k === 'efx') {
        const r = FXM.rows[f.n!], c = FXM.cell, i = Math.min(FXM.frames - 1, Math.floor(f.t * r.fps)), p = iso(f.x, f.y), w = c * r.scale;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(IMG.fx, i * c, r.row * c, c, c, p.x - w / 2, p.y - w * 0.62 - (f.dy ?? 0), w, w); ctx.restore();
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
    if (inDungeon(P.x, P.y)) { ctx.fillStyle = 'rgba(12,8,24,.28)'; ctx.fillRect(0, 0, W, H); }
    ctx.textAlign = 'center';
    const zn = isSafe(P.x, P.y) ? null : ZONES.find((z) => near(P.x, P.y, z, z.r + 2)), zl = zn ? mobDef(zn.type, zn).lvl : 0;
    const zone = isSafe(P.x, P.y) ? `${cityAt(P.x, P.y)?.name ?? 'Zona segura'} · zona segura` : zn ? `${zn.name} · Nv ${Math.max(1, zl - 1)}–${zl + 1}` : '';
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
        nameTag(m.name, p.x, y - 9, '#ffd24a', 1, 14);
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 8); ctx.fillStyle = '#8c6a1e'; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, m.hp / m.hpMax), 6); ctx.fillStyle = '#e0a82e'; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, m.hp / m.hpMax), 3);
    } else if (m.hp < m.hpMax) { const w = 34; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - w / 2 - 1, p.y - m.head - 5, w + 2, 5); ctx.fillStyle = '#c43e2b'; ctx.fillRect(p.x - w / 2, p.y - m.head - 4, w * Math.max(0, m.hp / m.hpMax), 3); }
}
function drawDrop(d: Drop, T: number) {
    const p = iso(d.x, d.y), y = p.y - 5 - (reduce ? 0 : Math.sin(T * 3 + d.x) * 2);
    const c = d.gold ? '#e8c34a' : d.item!.rar.c;
    if (!d.gold && d.item!.rar.k >= 1) { const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, 22); g.addColorStop(0, c + '77'); g.addColorStop(1, c + '00'); ctx.fillStyle = g; ctx.fillRect(p.x - 22, y - 22, 44, 44); }
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(p.x, y - 6); ctx.lineTo(p.x + 5, y); ctx.lineTo(p.x, y + 6); ctx.lineTo(p.x - 5, y); ctx.fill();
    ctx.font = "600 10px 'Alegreya Sans', system-ui, sans-serif"; ctx.textAlign = 'center';
    const label = d.gold ? `${d.gold} oro` : d.item!.name; const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(p.x - tw / 2 - 3, y - 21, tw + 6, 12);
    ctx.fillStyle = c; ctx.fillText(label, p.x, y - 12);
}

// ---------- HUD ----------
function setClass(id: string) {
    CLS = CLASSES.find((c) => c.id === id) ?? CLASSES[0];
    SPELLS = CLS.spells.map((sid, i) => ({ key: SPECIAL_KEY[sid] ?? KEYS[i], id: sid, ...LIB[sid] }));
    pots.hp = 3; pots.mp = 3; pots.cd = 0; potEpoch++; renderPots();
    cds.fill(0); P.fury = 0; P.ready = null; P.casting = null;
    const mk = (n: string): Item => ({ id: uid++, ...BASES.find((b) => b.name === n)!, rar: RAR[0], attrs: [] });
    P.eq.arma = mk(CLS.weapon); P.eq.armadura = CLS.armor ? mk(CLS.armor) : null; P.eq.cabeza = null; P.bag = [];
    refreshLook();
    P.lvl = 1; P.exp = 0; P.hp = maxHp(); P.mp = maxMp();
    // 10 slots grandes (teclas 1..0) + los que sobran en los chicos (teclas reales: -, =, R, F, G...)
    const slotHtml = (s: Spell, i: number, q: boolean) => `<button class="sw${q ? ' q' : ''}" id="sp${i}" type="button" title="${s.name} (${s.mp} maná)" aria-label="${s.name}, tecla ${s.key}, ${s.mp} de maná"><span class="sq"><img alt="" src="${spellIcon(s.id ?? '', s.col)}"><span class="cdo" id="cd${i}"></span><span class="kb">${s.key}</span><span class="mpc">${s.mp}</span></span></button>`;
    const emptyHtml = (k: string, q: boolean) => `<div class="sw${q ? ' q' : ''} empty" aria-hidden="true"><span class="sq"><span class="kb">${k}</span></span></div>`;
    $('bar').innerHTML = Array.from({ length: 10 }, (_, i) => SPELLS[i] ? slotHtml(SPELLS[i], i, false) : emptyHtml(KEYS[i], false)).join('');
    const rest = SPELLS.slice(10); $('quick').innerHTML = Array.from({ length: Math.max(4, rest.length) }, (_, j) => rest[j] ? slotHtml(rest[j], 10 + j, true) : emptyHtml('F' + (j + 1), true)).join('');
    SPELLS.forEach((_, i) => $('sp' + i).addEventListener('click', () => { cast(i); cv.focus({ preventScroll: true }); }));
    $('helpKeys').textContent = `Click o mantener: caminar · Click en mob: atacar · teclas 1–0 usar habilidad (las de objetivo: esperá que cargue y click en el blanco) · Click derecho: cancelar · ${SPELLS.map((x) => x.key + ' ' + x.name).join(' · ')} · I Bolsa · Enter chat`;
}
/** Cuadraditos de estado con cuenta regresiva (Furia, invisible, detectar, parálisis, inmunidad), como en HB. */
const BUFFS: { k: string; n: string; c: string; end: () => number; on: () => boolean }[] = [
    { k: 'F', n: 'Furia', c: '#ff5a2a', end: () => P.fury, on: () => P.fury > now() },
    { k: 'G', n: 'Grito de guerra (+15 defensa)', c: '#c78bff', end: () => P.wcEnd, on: () => P.wcEnd > now() },
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
    renderBuffs(); tickLogout(); potCdTick();
    const T = now(), mh = maxHp(), mm = maxMp();
    const hf = clamp(P.hp / mh, 0, 1), mf = clamp(P.mp / mm, 0, 1);
    $('liqHp').style.transform = `translateY(${(1 - hf) * 100}%)`; $('liqMp').style.transform = `translateY(${(1 - mf) * 100}%)`;
    $('hpT').textContent = String(Math.ceil(P.hp)); $('hpM').textContent = '/ ' + mh; $('mpT').textContent = String(Math.floor(P.mp)); $('mpM').textContent = '/ ' + mm;
    $('orbHpBox').setAttribute('aria-label', `Vida ${Math.ceil(P.hp)} de ${mh}`); $('orbMpBox').setAttribute('aria-label', `Maná ${Math.floor(P.mp)} de ${mm}`);
    const xp = clamp(P.exp / expNeed(), 0, 1), xpp = Math.floor(xp * 100);
    $('xpI').style.width = xp * 100 + '%'; $('xpT').textContent = `EXP ${xpp}%`; $('xpBox').setAttribute('aria-valuenow', String(xpp));
    SPELLS.forEach((s, i) => {
        const left = Math.max(0, cds[i] - T), el = $('sp' + i), cd = $('cd' + i);
        if (left > 0) { cd.style.display = 'flex'; cd.style.background = `conic-gradient(rgba(0,0,0,0) 0 ${(1 - left / s.cd) * 100}%, rgba(5,3,8,.74) 0 100%)`; const t = left >= 10 ? String(Math.ceil(left)) : left.toFixed(1); if (cd.textContent !== t) cd.textContent = t; }
        else if (cd.style.display) { cd.style.display = ''; cd.textContent = ''; }
        el.hidden = !!s.fury && P.fury <= T; el.classList.toggle('nomp', P.mp < s.mp); el.classList.toggle('ready', !!(P.ready && P.ready.i === i));
    });
    const tt = totals(), wd: [number, number] = tt.wdmg[1] > 0 ? tt.wdmg : CLS.melee;
    const chips: [string, string][] = [['Nv.', String(P.lvl)], ['Exp', `${Math.floor(P.exp).toLocaleString('es-AR')} / ${expNeed().toLocaleString('es-AR')}`], ['Ataque', `${wd[0]}–${wd[1]}`], ['Defensa', `${tt.def} · RM ${tt.rm}`], ['Vel. mov.', Math.round((270 / P.stepMs) * 100) + '%'], ['Crítico', tt.crit + '%']];
    const ch = chips.map(([k, v]) => `<div class="chp"><u>◆</u><span>${k}</span><b>${v}</b></div>`).join('');
    if ($('chips').dataset.h !== ch) { $('chips').dataset.h = ch; $('chips').innerHTML = ch; layoutHud(); }
    const m = P.target && mobs.includes(P.target) ? P.target : null;
    $('target').hidden = !m;
    if (m) {
        $('target').classList.toggle('boss', !!m.boss);
        $('tName').textContent = m.name; $('tLvl').textContent = (m.boss ? 'Boss · ' : '') + 'Nv ' + m.lvl;
        $('tHpI').style.width = Math.max(0, (m.hp / m.hpMax) * 100) + '%'; $('tHpT').textContent = `${Math.max(0, Math.ceil(m.hp))} / ${m.hpMax}`;
        const ch: string[] = [];
        if (m.par > T) ch.push(`<span class="chip par">Paralizado ${(m.par - T).toFixed(1)} s</span>`);
        else if (m.imm > T) ch.push(`<span class="chip imm">Inmune a control ${(m.imm - T).toFixed(0)} s</span>`);
        if (m.poison > T) ch.push(`<span class="chip ven">Envenenado</span>`);
        $('tChips').innerHTML = ch.join('');
    }
    $('gold').textContent = P.gold.toLocaleString('es-AR');
    const netEl = $('net');
    netEl.textContent = connected ? `En línea · ${playersOnline || 1} ${playersOnline === 1 ? 'jugador' : 'jugadores'}` : 'Sin conexión';
    netEl.classList.toggle('off', !connected);
}

/** Escala del HUD según el viewport (diseño de 1162 px de ancho; no tapa de más el mundo). */
function layoutHud() {
    const root = $('hudroot'), sc = clamp(Math.min(innerWidth / 1360, innerHeight / 900), 0.4, 1);
    const st = document.documentElement.style; st.setProperty('--hud-scale', sc.toFixed(3)); st.setProperty('--hud-h', Math.round((root.offsetHeight + 8) * sc) + 'px');
    { const hh = (root.offsetHeight + 8) * sc, ws = clamp(Math.min((innerWidth - 24) / 696, (innerHeight - hh - 96) / 516), 0.45, 1.3); st.setProperty('--win-scale', ws.toFixed(3)); renderTipPos(); }
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
function toggleChar() { $('char').hidden = !charOpen(); renderBag(); }
function closeWins() { $('bag').hidden = true; $('char').hidden = true; $('itip').hidden = true; }
$('openBag').addEventListener('click', toggleBag);
$('openChar').addEventListener('click', toggleChar);
$('bagClose').addEventListener('click', () => { $('bag').hidden = true; renderBag(); });
$('charClose').addEventListener('click', () => { $('char').hidden = true; renderBag(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (bagOpen() || charOpen()) && !(e.target instanceof HTMLInputElement)) closeWins(); });
document.querySelectorAll<HTMLElement>('#invTabs [data-tab]').forEach((b) => b.addEventListener('click', () => { invTab = b.dataset.tab as typeof invTab; renderBag(); }));
$('sortBtn').addEventListener('click', () => net.send({ $case: 'econSortRequest', value: {} }));
$('dropBtn').addEventListener('click', () => {
    if (!sel || sel.from !== 'bag') return;
    net.send({ $case: 'econDropRequest', value: { uid: sel.it.id } });
});
/** Borde de rareza (los comunes en bronce para que no destaquen). */
const rarCol = (it: Item) => (it.rar.k ? it.rar.c : '#6b5a3c');
const GLY: Record<string, string> = { cabeza: 'g-cabeza', armadura: 'g-armadura', arma: 'g-arma', botas: 'g-botas', amuleto: 'g-amuleto', escudo: 'g-escudo', anillo: 'g-anillo', guantes: 'g-guantes' };
const EQ_L: [string, string, Slot | null][] = [['cabeza', 'Casco', 'cabeza'], ['armadura', 'Armadura', 'armadura'], ['arma', 'Arma', 'arma'], ['botas', 'Botas', null]];
const EQ_R: [string, string, Slot | null][] = [['amuleto', 'Amuleto', null], ['escudo', 'Escudo', null], ['anillo', 'Anillo', 'anillo'], ['guantes', 'Guantes', null]];
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
        STAT_ICON('mp', String(maxMp()), 'Maná máx.'), STAT_ICON('crit', tt.crit + '%', 'Crítico'), STAT_ICON('aspd', tt.aspd + '%', 'Vel. ataque'), STAT_ICON('leech', tt.leech + '%', 'Robo de vida'),
        STAT_ICON('fire', `${tt.rm} (${mitigPct(tt.rm)}%)`, 'Res. mágica (RM)'), STAT_ICON('ice', `${mitigPct(tt.def)}% / ${mitigPct(tt.rm)}%`, 'Mitigación F/M'), STAT_ICON('par', tt.rpar + '%', 'Res. parálisis'), STAT_ICON('poi', tt.poison + '%', 'Veneno'),
    ].join('');
    if ($('stats').dataset.h !== st) { $('stats').dataset.h = st; $('stats').innerHTML = st; }
}
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
interface InvEnt { html: string; key: string }
function renderBag() {
    if (!bagOpen() && !charOpen()) { $('itip').hidden = true; return; }
    $('gold').textContent = P.gold.toLocaleString('es-AR');
    $('eqL').innerHTML = EQ_L.map(slotBtn).join(''); $('eqR').innerHTML = EQ_R.map(slotBtn).join('');
    $('eqRings').innerHTML = ['Anillo 2', 'Anillo 3'].map((l) => `<button type="button" class="sl dis" disabled aria-label="${l} (no disponible todavía)" title="${l}: no disponible todavía"><svg class="gl" aria-hidden="true"><use href="#g-anillo"/></svg></button>`).join('');
    renderChar();
    document.querySelectorAll<HTMLElement>('#char [data-eq]').forEach((b) => (b.onclick = () => { const it = P.eq[b.dataset.eq as Slot]; sel = it ? { it, from: 'eq' } : null; selX = null; renderBag(); }));
    // celdas del inventario según la pestaña
    const gear: InvEnt[] = P.bag.map((it, i) => ({ key: 'g' + i, html: `<button type="button" class="cl${sel && sel.it === it ? ' sel' : ''}" data-bag="${i}" data-r="${it.rar.k}" aria-label="${esc(it.name)}, ${it.rar.n}" title="${esc(it.name)}" style="--rc:${rarCol(it)}">${ico(it)}</button>` }));
    const cons: InvEnt[] = (['hp', 'mp'] as const).filter((k) => pots[k] > 0).map((k) => ({ key: 'p' + k, html: `<button type="button" class="cl${selX && selX.id === k ? ' sel' : ''}" data-pot="${k}" aria-label="${POTS[k].name}, ${pots[k]}" title="${POTS[k].name}" style="--rc:${k === 'hp' ? '#8a3a34' : '#345a8a'}"><img class="iimg" alt="" src="assets/spells/${POT_ART[k]}.png"><span class="q">${pots[k]}</span><i class="cdv" data-gcd></i></button>` }));
    const mats: InvEnt[] = [];
    for (const kid of ['cripta', 'foso'] as KeyId[]) {
        const kd = KEYDEFS[kid];
        if (Q.shards[kid] > 0) mats.push({ key: 's' + kid, html: `<button type="button" class="cl${selX && selX.id === 's' + kid ? ' sel' : ''}" data-mat="s${kid}" aria-label="${kd.shard}, ${Q.shards[kid]}" title="${kd.shard}" style="--rc:#6a4aa0"><svg class="iimg" viewBox="0 0 20 20" aria-hidden="true"><use href="#gemS"/></svg><span class="q">${Q.shards[kid]}</span></button>` });
        if (Q.keys[kid] > 0) mats.push({ key: 'k' + kid, html: `<button type="button" class="cl${selX && selX.id === 'k' + kid ? ' sel' : ''}" data-mat="k${kid}" aria-label="${kd.name}, ${Q.keys[kid]}" title="${kd.name}" style="--rc:#c9a227"><img class="iimg" alt="" src="assets/spells/sello-arcano.png"><span class="q">${Q.keys[kid]}</span></button>` });
    }
    const list = invTab === 'gear' ? gear : invTab === 'cons' ? cons : invTab === 'mat' ? mats : [...gear, ...cons, ...mats];
    const total = Math.max(25, Math.ceil(list.length / 5) * 5), cells = list.map((e) => e.html);
    while (cells.length < total) cells.push(`<div class="cl e" aria-hidden="true"></div>`);
    $('inv').innerHTML = cells.join('');
    $('cap').textContent = `Bolsa de equipo ${P.bag.length} / ${BAG_MAX}`;
    document.querySelectorAll<HTMLElement>('#invTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === invTab)));
    ($('dropBtn') as HTMLButtonElement).disabled = !(sel && sel.from === 'bag');
    document.querySelectorAll<HTMLElement>('#inv [data-bag]').forEach((b) => (b.onclick = () => { sel = { it: P.bag[+b.dataset.bag!], from: 'bag' }; selX = null; renderBag(); }));
    document.querySelectorAll<HTMLElement>('#inv [data-pot]').forEach((b) => (b.onclick = () => { selX = { k: 'pot', id: b.dataset.pot as 'hp' | 'mp' }; sel = null; renderBag(); }));
    document.querySelectorAll<HTMLElement>('#inv [data-mat]').forEach((b) => (b.onclick = () => { selX = { k: 'mat', id: b.dataset.mat! }; sel = null; renderBag(); }));
    renderTip();
}
/** Tooltip flotante a la izquierda de las ventanas abiertas. */
function renderTip() {
    const d = $('itip');
    if (sel && !(sel.from === 'eq' ? P.eq[sel.it.slot] === sel.it : P.bag.includes(sel.it))) sel = null;
    if (!sel && !selX) { d.hidden = true; return; }
    const wsc = parseFloat(document.documentElement.style.getPropertyValue('--win-scale')) || 1, n = (bagOpen() ? 1 : 0) + (charOpen() ? 1 : 0);
    d.style.right = `calc(max(12px, env(safe-area-inset-right, 0px)) + ${(n * 356 * wsc).toFixed(1)}px)`; d.hidden = false;
    if (selX) {
        if (selX.k === 'pot') { const k = selX.id; d.innerHTML = `<div><div class="iname" style="color:${POTS[k].col}">${POTS[k].name}</div><div class="sub">Consumible · ×${pots[k]}</div><div>${k === 'hp' ? 'Recupera 40% de la vida máxima: 20% al instante y el resto en 2 s.' : 'Recupera 50% del maná máximo.'}</div><div class="sub">Delay global de 1,75 s entre pociones.</div><div class="row"><button type="button" id="usePot">Usar (${POTS[k].key})</button></div></div>`; $('usePot').onclick = () => { usePotion(k); renderBag(); }; }
        else { const id = selX.id, kid = id.slice(1) as KeyId, kd = KEYDEFS[kid], shard = id[0] === 's'; d.innerHTML = `<div><div class="iname" style="color:${shard ? '#b99cff' : '#ffd24a'}">${shard ? kd.shard : kd.name}</div><div class="sub">Material · ×${shard ? Q.shards[kid] : Q.keys[kid]}</div><div>${shard ? `Con ${SHARDS_PER_KEY} esquirlas y ${kd.gold} de oro el Capitán forja la ${kd.name}.` : 'Abre la escalera sellada del portal correspondiente.'}</div></div>`; }
        return;
    }
    const it = sel!.it, base: string[] = [];
    if (it.dmg) base.push(`Daño ${it.dmg[0]}–${it.dmg[1]}`); if (it.def) base.push(`Defensa ${it.def}`); if (it.rm) base.push(`Res. mágica ${it.rm}`); if (it.mag) base.push(`+${it.mag} daño mágico`);
    d.innerHTML = `<div style="border-color:${rarCol(it)}"><div class="iname" style="color:${it.rar.c}">${esc(it.name)}</div><div class="sub">${it.rar.n} · ${it.slot}</div>
    ${base.length ? `<div>${base.join(' · ')}</div>` : ''}
    ${it.attrs.length ? `<ul>${it.attrs.map((a) => `<li style="color:#8fb6f0">${attrText(a)}</li>`).join('')}</ul>` : `<div class="sub">Sin atributos extra</div>`}
    <div class="row">${sel!.from === 'bag' ? `<button type="button" id="eqBtn">Equipar</button>` : `<button type="button" id="uneqBtn">Sacar</button>`}</div></div>`;
    const eqBtn = document.getElementById('eqBtn'), uneqBtn = document.getElementById('uneqBtn');
    if (eqBtn) eqBtn.onclick = () => net.send({ $case: 'econEquipRequest', value: { uid: it.id } }); // el server valida y manda el estado nuevo
    if (uneqBtn) uneqBtn.onclick = () => net.send({ $case: 'econUnequipRequest', value: { slot: it.slot } });
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
/** El edificio se apoya en la esquina sur de su huella. */
function drawBuilding(b: { id: string; x: number; y: number; w: number; h: number }) {
    const M = BUILD[b.id], im = IMG[b.id]; if (!M || !im) return;
    const p = iso(b.x + b.w, b.y + b.h);
    ctx.drawImage(im, p.x - M.ax, p.y - M.ay, M.w, M.h);
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
};
const lookOfNpc = (n: { id: string }) => NPC_LOOKS[n.id] ?? NPC_LOOKS[n.id.replace(/\d+$/, '')];
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
const portalProgress = () => ({ qi: Q.i, lvl: P.lvl, keys: Q.keys as Record<string, number>, unlocked: [...UNLOCKED] });
function refreshUnlocks(_announce: boolean) { /* los portales abiertos los decide el server (inventoryState.unlocked) */ }
function renderQuest() {
    const q = QUESTS[Q.i], el = $('quest');
    el.hidden = (!q || Q.st === 'new') && !hasKeyStuff();
    if (!q || Q.st === 'new') { el.innerHTML = `<b>Mazmorras</b>${keyLines()}`; return; }
    el.innerHTML = `<b>${q.name}</b><span>${Q.st === 'ready' ? 'Volvé con el Capitán' : `${q.zone}: ${Q.prog}/${q.n}`}</span>${keyLines()}`;
}
function questLevel(q: Quest) { const l = mobDef(q.type, ZONES.find((z) => z.name === q.zone && z.type === q.type)).lvl; return `Nv ${Math.max(1, l - 1)}–${l + 1}`; }
function openQuestDlg(n: Npc) {
    const q = QUESTS[Q.i], d = $('qdlg'); shopNpc = n; talkNpc = null;
    $('qdName').textContent = n.name; d.hidden = false;
    let body = '', btn = '';
    if (!q) body = 'Ya limpiaste todo lo que te pedí. Más encargos cuando abramos nuevos caminos. Para abrir las escaleras selladas forjá las llaves (abajo).';
    else if (Q.st === 'new') { body = `<b>${q.name}</b> <small>${q.zone} · ${questLevel(q)}</small><br>${q.say}<br><small>Recompensa: ${q.xp} exp · ${q.gold} oro${q.shard ? ' · ' + KEYDEFS[q.shard].shard : ''}</small>`; btn = 'Aceptar'; }
    else if (Q.st === 'active') body = `<b>${q.name}</b><br>Todavía te faltan ${q.n - Q.prog} en ${q.zone}.`;
    else { body = `<b>${q.name}</b><br>Buen trabajo. Tomá tu paga.<br><small>${q.xp} exp · ${q.gold} oro${q.shard ? ' · ' + KEYDEFS[q.shard].shard : ''}</small>`; btn = 'Entregar'; }
    if (q && Q.st !== 'ready') body += `<br><small>Portal de entrenamiento: «${q.zone}» (Portal de Frontera de la ciudad${trainOpen(TRAINING[Q.i]) ? '' : ', todavía bloqueado'}).</small>`;
    body += `<br><small>Forja: ${SHARDS_PER_KEY} esquirlas (las sueltan los bosses) + oro = 1 llave.</small>`;
    const fg = $('qdForges'); fg.innerHTML = '';
    for (const k of KEY_IDS) {
        const kd = KEYDEFS[k]; if (k === 'foso' && Q.i < 7 && !Q.shards.foso && !Q.keys.foso) continue;
        const fb = document.createElement('button'); fb.type = 'button'; fb.textContent = `Forjar ${kd.name} (${Q.shards[k]}/${SHARDS_PER_KEY} esq. · ${kd.gold} oro)`; fb.disabled = Q.shards[k] < SHARDS_PER_KEY || P.gold < kd.gold;
        fb.onclick = () => { if (Q.shards[k] < SHARDS_PER_KEY || P.gold < kd.gold) return; net.send({ $case: 'econQuestRequest', value: { npcId: n.id, action: 'forge', key: k } }); };
        fg.appendChild(fb);
    }
    $('qdBody').innerHTML = body; const b = $('qdBtn'); b.hidden = !btn; b.textContent = btn;
    b.onclick = () => {
        if (Q.st === 'new') net.send({ $case: 'econQuestRequest', value: { npcId: n.id, action: 'accept', key: '' } });
        else if (Q.st === 'ready') net.send({ $case: 'econQuestRequest', value: { npcId: n.id, action: 'turnin', key: '' } });
    };
}
/** "!" amarillo sobre el Capitán cuando tiene misión para vos; "?" cuando podés entregar. */
const questMark = () => (!QUESTS[Q.i] ? '' : Q.st === 'new' ? '!' : Q.st === 'ready' ? '?' : '');

// ---------- vendedores y servicios de las ciudades: cada NPC tiene un rol (ver roleOf) ----------
// el stock, los precios y los vendedores viven en @fdn/world (economy.ts): el server valida las compras con la misma tabla
const GUARD_LINES: Record<string, string[]> = {
    s: ['La empalizada aguanta, pero los goblins del sureste no se cansan. Si vas a salir, llevate pociones.', 'Dentro de las murallas no pelea nadie: en la ciudad se descansa y se comercia.', 'El Capitán Aldric tiene encargos para quien sepa pelear. Hablá con él en la plaza.', 'Armero, armadurero, joyero... todo lo que necesitás está a unos pasos de la plaza.'],
    v: ['Vhar no se rinde: las murallas son de hierro y de paciencia. Pasá, pero sin armar lío.', 'Más allá de la puerta sur empieza el páramo. No salgas sin armadura.', 'El Capitán Kharos recluta cazadores. Está en la plaza del noreste.', 'La forja no se apaga nunca. Si necesitás acero, el armero está al oeste.'],
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
function openShop(n: Npc = MAP.npcs[0]) {
    const role = roleOf(n);
    if (role === 'capitan') { openQuestDlg(n); return; }
    if (role === 'guardia') { openTalk(n); return; }
    const def = SHOPS[role]; if (!def) return;
    shopNpc = n; talkNpc = null; $('qdlg').hidden = true; $('shopName').textContent = n.name; $('shopRole').textContent = def.label; $('shop').hidden = false; renderShop();
    log(`${n.name}: «${def.greet}»`);
}
/** Guardias y otros NPC de ambiente: una charla corta, sin tienda. */
function openTalk(n: Npc) {
    const lines = GUARD_LINES[n.id.endsWith('_v') || n.id.includes('_v') ? 'v' : 's'];
    shopNpc = n; talkNpc = null; $('shop').hidden = true;
    $('qdName').textContent = n.name; $('qdlg').hidden = false; $('qdForges').innerHTML = ''; $('qdBtn').hidden = true;
    $('qdBody').innerHTML = `<small>${SHOPS.guardia.label}</small><br>${lines[Math.floor(R() * lines.length)]}`;
}
function closeShop() { shopNpc = null; $('shop').hidden = true; $('qdlg').hidden = true; }
function renderShop() {
    if ($('shop').hidden || !shopNpc) return;
    const def = SHOPS[roleOf(shopNpc)];
    $('shopGold').textContent = P.gold + ' oro';
    const buy = def.stock.map((st, i) => {
        const it = st.base ? stockItem(st) : null, poor = P.gold < st.price;
        const icon = it ? ico(it) : `<span class="pico" style="background:${POTS[st.pot!].col}"></span>`;
        return `<button type="button" class="srow${poor ? ' poor' : ''}" data-buy="${i}" title="${esc(stockInfo(st))}">${icon}<span style="color:${it ? '#e7e2d3' : POTS[st.pot!].col}">${esc(stockLabel(st))}<small>${esc(stockInfo(st))}</small></span><em>${st.price} oro</em></button>`;
    }).join('');
    $('shopList').innerHTML = `<div class="label">Comprar</div>${buy}<div class="label">Tu bolsa · tocá un item para venderlo</div>` + (P.bag.length
        ? P.bag.map((it, i) => `<button type="button" class="srow" data-sell="${i}">${ico(it)}<span style="color:${it.rar.c}">${esc(it.name)}<small>${it.rar.n} · ${it.slot}</small></span><em>${sellPrice(it.name, it.rar.k)} oro</em></button>`).join('')
        : `<div class="label">La bolsa está vacía</div>`);
    document.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => (b.onclick = () => buyStock(def.stock[+b.dataset.buy!])));
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
    if (talkNpc && !P.step && npcDist(talkNpc) <= TALK_RANGE) openShop(talkNpc);
    else if (talkNpc && !P.step && !P.path.length) { talkNpc = null; }
    if (shopNpc && (npcDist(shopNpc) > TALK_RANGE + 1.5 || P.dead)) closeShop();
}
$('shopClose').addEventListener('click', closeShop); $('pothp').addEventListener('click', () => { usePotion('hp'); cv.focus({ preventScroll: true }); }); $('potmp').addEventListener('click', () => { usePotion('mp'); cv.focus({ preventScroll: true }); }); renderPots(); $('qdClose').addEventListener('click', closeShop);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shopNpc) closeShop(); });

// ---------- escaleras entre zonas (el server valida el teletransporte; la celda de destino tiene que estar libre) ----------
let portalLock = 0;
function checkPortals() {
    if (!MAP.portals || !connected || P.dead || P.step || now() < portalLock) return;
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
    for (const t of TRAINING) { const z = ZONES.find((q) => q.name === t.zone); if (!z) continue; const d = Math.hypot(P.x - z.x, P.y - z.y); if (d <= z.r + 8 && d < bd) { bd = d; best = t.step; } }
    return best;
}
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 017 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="7" width="10" height="7" rx="1.4" fill="currentColor"/></svg>';
const lockMsg = (t: TrainingStep) => `Portal bloqueado (${t.zone}): ${t.after ? `entregá «${t.after}» al Capitán` : 'todavía no'} o llegá al nivel ${t.lvl}.`;
function renderWp() {
    if (!wpOpen) return;
    const city = MAP.cities?.find((c) => c.faction === selectedFaction), inCity = !!cityAt(P.cell.x, P.cell.y), cur = inCity ? -1 : currentTrainStep();
    $('wpTitle').textContent = wpOpen.kind === 'city' ? 'Portal de Frontera' : 'Portal de regreso';
    $('wpSub').textContent = wpOpen.kind === 'city' ? `${city?.name ?? 'Tu ciudad'} · zonas de entrenamiento` : `${wpOpen.name} · volvé a tu ciudad o viajá a otra zona`;
    const rows = [`<button type="button" class="wprow home${inCity ? ' cur' : ''}" data-wp="city"${inCity ? ' disabled' : ''}><i class="wpn">&#8962;</i><span class="wpt"><b>${inCity ? 'Estás en ' : 'Volver a '}${esc(city?.name ?? 'la ciudad')}</b><small>${inCity ? 'Zona segura' : 'Zona segura · tu facción'}</small></span>${inCity ? '<em class="wptag">Estás aquí</em>' : ''}</button>`];
    for (const t of TRAINING) {
        const open = trainOpen(t), here = t.step === cur, qq = QUESTS[t.step], lv = qq ? questLevel(qq) : '';
        const sub = open ? `<small>Nivel recomendado ${lv.replace('Nv ', '')}</small>` : `<small class="req">${LOCK_SVG} Misión «${esc(t.after ?? '')}» o nivel ${t.lvl}</small>`;
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
    if (id === 'city') { if (cityAt(P.cell.x, P.cell.y)) return; }
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
    if (talkWpTarget && !P.step && wpDist(talkWpTarget) <= WP_OPEN_DIST) openWp(talkWpTarget);
    else if (talkWpTarget && !P.step && !P.path.length) talkWpTarget = null;
    if (wpOpen && (wpDist(wpOpen) > WP_CLOSE_DIST || P.dead || !connected)) closeWp();
    const on = connected && !P.dead ? MY_WPS().find((q) => q.x === P.cell.x && q.y === P.cell.y) : undefined;
    if (!on) wpInside = '';
    else if (wpInside !== on.id && !P.step && now() >= portalLock) { wpInside = on.id; if (!wpOpen) openWp(on); }
}
$('wpClose').addEventListener('click', closeWp);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wpOpen) closeWp(); });
const inDungeon = (gx: number, gy: number) => [MAP.dungeon, ...(MAP.dungeons ?? [])].some((d) => !!d && gx >= d.x0 && gx < d.x1 + 1 && gy >= d.y0 && gy < d.y1 + 1);

// ---------- loop ----------
const MAP_WORLD_ID = 'solmar';
let last = now(), lastCam = now();
function frame() {
    const T = now(); let dt = Math.min(0.05, T - last); last = T;
    if (hitstop > 0) { hitstop -= dt; dt = 0; }
    update(dt); checkPortals(); wpTick(); npcTick(); updateCam(Math.min(0.05, T - lastCam)); lastCam = T;
    updateHover(); render(); hud(); winTick(T); requestAnimationFrame(frame);
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
let selectedClass = 'guerrero';
try { const c = localStorage.getItem('fdn:class'); if (CLASSES.some((x) => x.id === c && !x.hidden)) selectedClass = c!; } catch { /* sin almacenamiento */ }
// pantallas de login / selección / clase / facción / creación (ver loginui.ts)
const flow = initLoginUI({
    classes: CLASSES.filter((c) => !c.hidden), factions: FACTIONS, spellName: (id) => LIB[id]?.name ?? id,
    cityName: (f) => HUBS[f] ? (cityAt(HUBS[f].x, HUBS[f].y)?.name ?? 'Ciudad de ' + f) : f,
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
    return { id: uid++, ...b, rar: RAR[Math.min(3, Math.max(0, v.r))], attrs: loadAttrs(v.a) };
}
function buildSave(): CharSave {
    return {
        v: 1, faction: selectedFaction, cls: CLS.id, lvl: P.lvl, exp: Math.floor(P.exp), gold: P.gold, hp: Math.max(1, Math.round(P.hp)), mp: Math.round(P.mp),
        bag: P.bag.map(saveItem), eq: Object.fromEntries((['arma', 'armadura', 'cabeza', 'anillo'] as const).map((sl) => [sl, P.eq[sl] ? saveItem(P.eq[sl]!) : null])),
        q: { i: Q.i, st: Q.st, prog: Q.prog, keys: { ...Q.keys }, shards: { ...Q.shards } }, pots: { hp: pots.hp, mp: pots.mp }, u: [...UNLOCKED],
    };
}
function applySave(sv: CharSave) {
    P.lvl = sv.lvl; P.exp = sv.exp; P.gold = sv.gold;
    P.bag = sv.bag.map(loadItem).filter((x): x is Item => !!x).slice(0, 18);
    for (const sl of ['arma', 'armadura', 'cabeza', 'anillo'] as const) { const it = loadItem(sv.eq?.[sl]); if (it && it.slot === sl) P.eq[sl] = it; }
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
    return { ...b, id: v.uid, rar: RAR[Math.min(3, Math.max(0, v.rarity))], attrs: loadAttrs(v.attrs) };
}
let invApplied = false;
/** El server es dueño de oro, bolsa, equipo, nivel, pociones y misiones: lo que llega acá reemplaza lo que muestro. */
function applyInventory(v: InventoryState) {
    const prevSel = sel ? sel.it.id : -1, lvlBefore = P.lvl;
    P.gold = v.gold; P.lvl = v.lvl; P.exp = v.exp;
    P.bag = v.bag.map(itemFromInv);
    for (const sl of SLOTS) P.eq[sl] = null;
    for (const e of v.eq) if (e.item && (SLOTS as string[]).includes(e.slot)) P.eq[e.slot as Slot] = itemFromInv(e.item);
    pots.hp = v.potsHp; pots.mp = v.potsMp;
    Q.i = v.questI; Q.st = v.questState === 'active' || v.questState === 'ready' ? v.questState : 'new'; Q.prog = v.questProg;
    Q.keys.cripta = v.keysCripta; Q.keys.foso = v.keysFoso; Q.shards.cripta = v.shardsCripta; Q.shards.foso = v.shardsFoso;
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
    refreshLook(); renderBag(); renderQuest(); renderPots(); renderShop(); sendProfile();
    if (!$('qdlg').hidden && shopNpc && roleOf(shopNpc) === 'capitan') openQuestDlg(shopNpc);
}
const saver = new Saver(buildSave, (data) => net.send({ $case: 'saveCharacterRequest', value: { data } }));
function showLogin(error = '') {
    connected = false;
    $('login').hidden = false; $('loginErr').textContent = error; flow.show('login');
    const nameIn = $('nameIn') as HTMLInputElement;
    try { nameIn.value ||= localStorage.getItem('fdn:lastName') ?? ''; } catch { /* sin almacenamiento */ }
    nameIn.focus();
}
$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('nameIn') as HTMLInputElement).value.trim(), password = ($('passIn') as HTMLInputElement).value;
    if (!name) return;
    const regErr = flow.checkRegister(); if (regErr) { $('loginErr').textContent = regErr; return; }
    const btn = $('loginBtn') as HTMLButtonElement, auto = autoEnter; autoEnter = false;
    btn.disabled = true; $('loginErr').textContent = 'Conectando…';
    try { localStorage.setItem('fdn:lastName', name); } catch { /* sin almacenamiento */ }
    pendingSave = null; welcomeBack = false;
    net.onMessage = (m) => { if (m.$case === 'characterLoaded') { pendingSave = m.value.exists ? parseSave(m.value.data) : null; if (pendingSave) { selectedClass = pendingSave.cls; selectedFaction = pendingSave.faction; welcomeBack = true; } return; } onServer(m); if (m.$case === 'initialGameWorldState' && !connected && !inFlow) { if (auto) enterWorld(name); else startFlow(name); } };
    let tries = 0;
    net.onClose = (reason) => {
        const was = connected; saver.stop(); others.clear();
        inFlow = false;
        if (backToLogin) { backToLogin = false; showLogin(); btn.disabled = false; return; }
        if (leaving) { leaving = false; connected = false; showLogin('Saliste del juego.'); btn.disabled = false; return; }
        // si se cortó sin querer, reintenta solo unos segundos (el server te guarda el lugar 60 s)
        if (was && tries < 6 && !/ya está conectado|autentic|contraseña|incorrect/i.test(reason)) {
            tries++; connected = false; showLogin(`Se cortó la conexión. Reconectando (${tries}/6)…`);
            setTimeout(() => { if (!connected) autoEnter = true, void ($('loginForm') as HTMLFormElement).requestSubmit(); }, 1500); return;
        }
        showLogin(was ? `Se cortó la conexión: ${reason}` : reason); btn.disabled = false;
    };
    try { await net.connect(serverUrl(), storedId(name), name, password); }
    catch (err) { $('loginErr').textContent = `${(err as Error).message} ¿Está corriendo el server (pnpm dev)?`; btn.disabled = false; }
});
let autoEnter = false, inFlow = false, backToLogin = false;
/** Ya conectado y con el mundo cargado: muestra la selección (cuenta con personaje) o el flujo clase → facción → crear. */
function startFlow(name: string) {
    inFlow = true;
    const here = cityAt(P.cell.x, P.cell.y);
    flow.start({
        name, saved: pendingSave ? { cls: pendingSave.cls, faction: pendingSave.faction, lvl: pendingSave.lvl } : null,
        zone: here?.name ?? ZONES.find((z) => dist(P, z) <= z.r + 2)?.name ?? 'Tierras de la Frontera',
        onPlay: () => { inFlow = false; enterWorld(name); },
        onBack: () => { if (net.open) { backToLogin = true; net.close(); } else { inFlow = false; showLogin(); ($('loginBtn') as HTMLButtonElement).disabled = false; } },
    });
}
function enterWorld(name: string) {
    setClass(selectedClass); if (pendingSave) applySave(pendingSave); refreshUnlocks(false); connected = true; P.name = name; lookKey = ''; refreshLook(); sendProfile();
    $('login').hidden = true; ($('loginBtn') as HTMLButtonElement).disabled = false;
    cv.focus({ preventScroll: true });
    invApplied = false; saver.start(); saver.tick(true); // el primer guardado le dice al server clase y bando si es un personaje nuevo
    if (welcomeBack) log(`Bienvenido de vuelta, ${name}. Nivel ${P.lvl}.`, true);
    // cada facción arranca en su ciudad (también si el guardado te dejó dentro de la del otro bando)
    const hub = HUBS[selectedFaction], here = cityAt(P.cell.x, P.cell.y);
    if (hub && (!welcomeBack || (here && here.faction !== selectedFaction))) net.send({ $case: 'playerTeleportRequested', value: { x: hub.x, y: hub.y } });
    log(selectedFaction === 'vhar' ? 'Bienvenido a la Ciudad de Vhar. La puerta del sur lleva a las tierras de Solmar.' : 'Bienvenido a la Ciudad de Solmar.', true);
    log('En la plaza está el Portal de Frontera: un menú con las zonas de entrenamiento. La primera ya está abierta; las demás se abren al entregar las misiones del Capitán (o subiendo de nivel). En cada zona hay un portal de regreso.', true);
    log('Tocá un mob para atacarlo. Apretá un hechizo (1–4), esperá que cargue y hacé clic en el objetivo. Enter para chatear.');
}

async function boot() {
    try {
        const metaTxt = await (await fetch('assets/meta.json', { cache: 'no-cache' })).text();
        { let h = 5381; for (let i = 0; i < metaTxt.length; i++) h = ((h * 33) ^ metaTxt.charCodeAt(i)) >>> 0; ASSET_V = h.toString(36); }
        const meta = JSON.parse(metaTxt);
        WORLD = meta.world; delete meta.world;
        BUILD = meta.buildings ?? {}; delete meta.buildings;
        for (const k of ['dungeon', 'terrain']) {
            const m = meta[k]; delete meta[k]; if (!m) continue;
            try { const im = await load(`assets/${k}.webp`); for (const [id, p] of Object.entries(m.pos as Record<string, number[]>)) EXT[Number(id)] = { im, p }; } catch { /* sin ese atlas se ve el mapa sin esas piezas */ }
        }
        PAPER = meta.paper; delete meta.paper; SPR.hero = SPR.hero_other = PAPER as unknown as SpriteMeta;
        Object.assign(SPR, meta);
        const names = ['world', 'goblin', 'zombie', 'skeleton', 'barbaro', 'goblin_elite', 'antlion', 'skeleton_mage', 'fire_ant', 'wyvern', 'minotaur', 'arana', 'golem', 'demonio'];
        const imgs = await Promise.all(names.map((n) => load(`assets/${n}.webp`)));
        names.forEach((n, i) => (IMG[n] = imgs[i]));
    } catch { $('loading').textContent = 'No se pudieron cargar los gráficos. Recargá la página.'; return; }
    $('loading').hidden = true;
    try { FXM = await (await fetch('assets/fx.json')).json(); IMG.fx = await load('assets/fx.webp'); } catch { FXM = null; }
    loadBuildingImages();
    refreshLook();
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__fdn = { others, mobs, drops, damageMob, tp: (x: number, y: number) => { P.x = x; P.y = y; P.cell = { x: Math.floor(x), y: Math.floor(y) }; P.path = []; P.step = null; }, P, BASES, RAR, refreshLook, equip: (n: string) => { const b = BASES.find((x) => x.name === n)!; P.eq[b.slot] = { id: uid++, ...b, rar: RAR[0], attrs: [] }; refreshLook(); } };
    if (new URLSearchParams(location.search).has('debug')) Object.assign((window as unknown as { __fdn: Record<string, unknown> }).__fdn, { efx, MAP, openShop, toScreen });
    if (new URLSearchParams(location.search).has('debug')) Object.assign((window as unknown as { __fdn: Record<string, unknown> }).__fdn, { net, drop: () => (net as unknown as { ws: WebSocket }).ws.close(4000, 'prueba'), connected: () => connected, Q, UNLOCKED, WAYPOINTS, openWp, wpGo, trainOpen, refreshUnlocks, saver, warp: (x: number, y: number) => net.send({ $case: 'playerTeleportRequested', value: { x, y } }), go: (x: number, y: number) => moveTo(x + 0.5, y + 0.5) });
    const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y;
    showLogin();
    requestAnimationFrame(frame);
}
boot();
