/**
 * Frontera de Naciones: el prototipo HD (canvas isométrico 2:1, arte de Flare) conectado al server.
 *
 * Lo que decide el server: dónde está cada jugador (paso a paso, con control de velocidad),
 * quién ve a quién y el chat. Lo que todavía corre solo en este navegador, como en el prototipo:
 * mobs, combate, hechizos, loot y experiencia (pasan al server en la fase 1b).
 */
import { buildSolmar } from '@fdn/world';
import { Net, serverUrl, type ServerPayload } from './net.ts';

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
type AttrId = 'crit' | 'aspd' | 'leech' | 'hp' | 'mp' | 'mag' | 'exp' | 'poison' | 'rpar';
const ATTRS: { id: AttrId; r: [number, number]; f: (v: number) => string }[] = [
    { id: 'crit', r: [2, 6], f: (v) => `+${v}% crítico` },
    { id: 'aspd', r: [4, 12], f: (v) => `+${v}% velocidad de ataque` },
    { id: 'leech', r: [2, 6], f: (v) => `${v}% robo de vida` },
    { id: 'hp', r: [8, 25], f: (v) => `+${v} vida` },
    { id: 'mp', r: [6, 20], f: (v) => `+${v} maná` },
    { id: 'mag', r: [2, 6], f: (v) => `+${v} daño mágico` },
    { id: 'exp', r: [3, 10], f: (v) => `+${v}% exp de caza` },
    { id: 'poison', r: [6, 16], f: (v) => `${v}% chance de veneno` },
    { id: 'rpar', r: [5, 15], f: (v) => `+${v}% resistencia a parálisis` },
];
type Slot = 'arma' | 'armadura' | 'cabeza' | 'anillo';
interface Base { name: string; slot: Slot; dmg?: [number, number]; def?: number; mag?: number; look?: string; off?: string }
const BASES: Base[] = [
    { name: 'Espada corta', slot: 'arma', dmg: [4, 8], look: 'shortsword', off: 'buckler' },
    { name: 'Hacha de leñador', slot: 'arma', dmg: [6, 11], look: 'hand_axe', off: 'buckler' },
    { name: 'Báculo de fresno', slot: 'arma', dmg: [2, 4], mag: 5, look: 'staff' },
    { name: 'Espada larga', slot: 'arma', dmg: [7, 12], look: 'longsword', off: 'iron_buckler' },
    { name: 'Hacha de guerra', slot: 'arma', dmg: [9, 15], look: 'battle_axe' },
    { name: 'Maza', slot: 'arma', dmg: [6, 11], look: 'mace', off: 'kite_shield' },
    { name: 'Martillo pesado', slot: 'arma', dmg: [10, 16], look: 'maul' },
    { name: 'Mandoble', slot: 'arma', dmg: [12, 18], look: 'zweihander' },
    { name: 'Varita', slot: 'arma', dmg: [1, 3], mag: 8, look: 'wand' },
    { name: 'Coraza de cuero', slot: 'armadura', def: 3, look: 'leather' },
    { name: 'Cota de malla', slot: 'armadura', def: 6, look: 'chain' },
    { name: 'Armadura de placas', slot: 'armadura', def: 9, look: 'plate' },
    { name: 'Túnica de mago', slot: 'armadura', def: 1, mag: 4, look: 'mage' },
    { name: 'Ropas de tela', slot: 'armadura', def: 1, look: 'cloth' },
    { name: 'Capucha de cuero', slot: 'cabeza', def: 1, look: 'leather_hood' },
    { name: 'Cofia de malla', slot: 'cabeza', def: 2, look: 'chain_coif' },
    { name: 'Yelmo de hierro', slot: 'cabeza', def: 3, look: 'plate_helm' },
    { name: 'Capucha de mago', slot: 'cabeza', def: 0, mag: 3, look: 'mage_hood' },
    { name: 'Anillo opaco', slot: 'anillo' },
];
const SLOTS: Slot[] = ['arma', 'armadura', 'cabeza', 'anillo'];
interface Item extends Base { id: number; rar: Rarity; attrs: { id: AttrId; v: number }[] }
let uid = 1;
function rollItem(lvl: number, minRar = 0): Item {
    const base = BASES[rint(0, BASES.length - 1)];
    let r = R(), rar = RAR[0]; for (const x of RAR) { if (r < x.p) { rar = x; break; } r -= x.p; }
    if (rar.k < minRar) rar = RAR[minRar]; // bosses: drop garantizado de rareza alta
    const pool = ATTRS.slice(), attrs: Item['attrs'] = [];
    for (let i = 0; i < rar.k; i++) {
        const a = pool.splice(rint(0, pool.length - 1), 1)[0];
        attrs.push({ id: a.id, v: Math.round((a.r[0] + R() * (a.r[1] - a.r[0])) * (1 + (lvl - 1) * 0.2)) });
    }
    return { id: uid++, ...base, rar, attrs };
}
const attrText = (a: { id: AttrId; v: number }) => ATTRS.find((x) => x.id === a.id)!.f(a.v);

// ---------- entidades ----------
interface OneShot { anim: string; t: number; until: number }
interface Ent { x: number; y: number; dir: number; ang?: number; moving: boolean; phase?: number; ref?: number; one: OneShot | null; t0?: number; flash: number }
/** Un paso de una celda a otra, animado en `dur` segundos. */
interface Step { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }

type MobType = Zone['type'];
/** Habilidad de boss: cada `every` s, si el jugador está a menos de `range`, carga un golpe y lo lanza a los 0,8 s. Alcanza a quien esté a menos de `r`. */
interface BossSpecial { name: string; every: number; range: number; r: number; dmg?: [number, number]; stun?: number; col: string }
interface BossDef { respawn: number; minRar: number; gold: [number, number]; special: BossSpecial }
interface MobDef { name: string; lvl: number; hp: number; dmg: [number, number]; spd: number; ref: number; exp: number; hitR: number; head: number; atk: number; boss?: BossDef }
const MOBS: Record<MobType, MobDef> = {
    goblin: { name: 'Goblin lancero', lvl: 1, hp: 42, dmg: [4, 7], spd: 1.8, ref: 2.6, exp: 14, hitR: 20, head: 42, atk: 1.3 },
    zombie: { name: 'Zombi del pantano', lvl: 3, hp: 85, dmg: [7, 11], spd: 1.0, ref: 1.5, exp: 30, hitR: 22, head: 50, atk: 1.6 },
    barbaro: { name: 'Bárbaro sangriento', lvl: 8, hp: 900, dmg: [18, 28], spd: 1.3, ref: 2.4, exp: 420, hitR: 40, head: 90, atk: 1.8, boss: { respawn: 120, minRar: 2, gold: [60, 110], special: { name: 'Rugido', every: 11, range: 3.2, r: 3, stun: 1.2, dmg: [8, 12], col: '#ff8a4a' } } },
    arana: { name: 'Reina araña', lvl: 7, hp: 720, dmg: [14, 22], spd: 1.7, ref: 2.8, exp: 520, hitR: 52, head: 88, atk: 1.4, boss: { respawn: 150, minRar: 2, gold: [70, 120], special: { name: 'Telaraña', every: 9, range: 4, r: 3.5, stun: 1.8, col: '#9fe8ff' } } },
    golem: { name: 'Gólem de hielo', lvl: 10, hp: 1300, dmg: [24, 34], spd: 1.0, ref: 1.8, exp: 900, hitR: 50, head: 112, atk: 2.0, boss: { respawn: 180, minRar: 2, gold: [110, 170], special: { name: 'Grito helado', every: 10, range: 3, r: 3, dmg: [30, 42], stun: 0.8, col: '#7fd6ff' } } },
    demonio: { name: 'Demonio del foso', lvl: 12, hp: 1900, dmg: [30, 44], spd: 1.4, ref: 2.4, exp: 1500, hitR: 44, head: 120, atk: 1.7, boss: { respawn: 240, minRar: 3, gold: [180, 260], special: { name: 'Salto sísmico', every: 12, range: 4.5, r: 3.2, dmg: [45, 60], stun: 1, col: '#ff5a3c' } } },
    skeleton: { name: 'Esqueleto guerrero', lvl: 5, hp: 150, dmg: [11, 17], spd: 1.5, ref: 2.1, exp: 62, hitR: 23, head: 53, atk: 1.4 },
    goblin_elite: { name: 'Goblin de élite', lvl: 2, hp: 62, dmg: [5, 9], spd: 1.9, ref: 2.6, exp: 22, hitR: 21, head: 46, atk: 1.2 },
    antlion: { name: 'Hormiga león', lvl: 4, hp: 115, dmg: [9, 14], spd: 1.5, ref: 2.0, exp: 45, hitR: 24, head: 40, atk: 1.5 },
    skeleton_mage: { name: 'Esqueleto hechicero', lvl: 5, hp: 130, dmg: [12, 18], spd: 1.3, ref: 2.1, exp: 58, hitR: 22, head: 55, atk: 1.6 },
    fire_ant: { name: 'Hormiga de fuego', lvl: 6, hp: 190, dmg: [13, 20], spd: 1.7, ref: 2.0, exp: 80, hitR: 24, head: 42, atk: 1.3 },
    wyvern: { name: 'Wyvern', lvl: 7, hp: 300, dmg: [16, 24], spd: 1.6, ref: 2.3, exp: 130, hitR: 32, head: 90, atk: 1.7 },
    minotaur: { name: 'Minotauro (mini-boss)', lvl: 9, hp: 1200, dmg: [22, 34], spd: 1.4, ref: 2.4, exp: 560, hitR: 40, head: 130, atk: 1.9 },
};
interface Mob extends Omit<Ent, 'ref'>, MobDef {
    id: number; sprite: MobType; zone: Zone; hpMax: number; state: 'idle' | 'chase' | 'return';
    wx: number; wy: number; wait: number; nextAtk: number; nextSp: number; busy: number; par: number; parT: number; imm: number; poison: number; poisonTick: number;
}
interface Casting { i: number; start: number; end: number; len: number }
const P = {
    x: MAP.spawn.x + 0.5, y: MAP.spawn.y + 0.5, dir: 6, ang: undefined as number | undefined, moving: false, phase: 0, ref: 3.4, one: null as OneShot | null, t0: 0, flash: 0,
    name: '', cell: { x: MAP.spawn.x, y: MAP.spawn.y }, path: [] as Cell[], step: null as Step | null, stepMs: 380, frozenUntil: 0,
    target: null as Mob | null, engage: false, pickup: null as Drop | null, repath: 0, queued: null as number | null,
    lvl: 1, exp: 0, hp: 100, mp: 60, fury: 0, gold: 0, nextAtk: 0, dead: false, deadT: 0,
    bag: [] as Item[], eq: { arma: null, armadura: null, cabeza: null, anillo: null } as Record<Slot, Item | null>,
    casting: null as Casting | null, ready: null as { i: number; t: number } | null, sentDir: -1,
};

/** Otros jugadores, según lo que manda el server. */
interface Other extends Ent { profile: string; id: bigint; name: string; cell: Cell; queue: Cell[]; step: Step | null; stepMs: number; gone: boolean }
const others = new Map<bigint, Other>();

interface Drop { x: number; y: number; item?: Item; gold?: number; t: number }
interface Proj { x: number; y: number; m: Mob | null; spd: number; dmg: number; col: string; aoe?: number; tx?: number; ty?: number; sx?: number; sy?: number; arc?: number; trail?: { x: number; y: number }[] }
interface Fx { k: 'ring' | 'boom' | 'burst' | 'click' | 'efx'; n?: string; dy?: number; x: number; y: number; t: number; c?: string; r?: number }
const scorch: { x: number; y: number; t: number; r: number }[] = [];
const mobs: Mob[] = [], corpses: { sprite: string; x: number; y: number; dir: number; t: number }[] = [], drops: Drop[] = [], projs: Proj[] = [];
const floats: { x: number; y: number; text: string; col: string; t: number; big?: boolean }[] = [], fx: Fx[] = [], pending: { t: number; fn: () => void }[] = [];
let hitstop = 0, shake = 0;

function spawnMob(z: Zone) {
    for (let i = 0; i < 40; i++) {
        const x = Math.floor(z.x + (R() * 2 - 1) * z.r), y = Math.floor(z.y + (R() * 2 - 1) * z.r);
        if (!walk(x, y) || safe[y]?.[x]) continue;
        const d = MOBS[z.type];
        mobs.push({ ...d, sprite: z.type, zone: z, x: x + 0.5, y: y + 0.5, hpMax: d.hp, hp: d.hp, state: 'idle', wx: x + 0.5, wy: y + 0.5, wait: R() * 2, nextAtk: 0, nextSp: now() + 4, busy: 0, par: 0, parT: 0, imm: 0, poison: 0, poisonTick: 0, dir: rint(0, 7), moving: false, flash: 0, one: null, t0: R() * 5, id: uid++ });
        return;
    }
}
ZONES.forEach((z) => { for (let i = 0; i < z.n; i++) spawnMob(z); });

// ---------- stats ----------
function totals() {
    const t = { crit: 0, aspd: 0, leech: 0, hp: 0, mp: 0, mag: 0, exp: 0, poison: 0, rpar: 0, def: 0, wdmg: [0, 0] as [number, number] };
    for (const s of SLOTS) {
        const it = P.eq[s]; if (!it) continue;
        if (it.dmg) t.wdmg = it.dmg; if (it.def) t.def += it.def; if (it.mag) t.mag += it.mag;
        for (const a of it.attrs) t[a.id] += a.v;
    }
    if (P.fury > now()) t.aspd += 25;
    return t;
}
// ---------- clases ----------
interface ClassDef { id: string; name: string; hidden?: boolean; desc: string; head: string; armor?: string; hp: number; hpL: number; mp: number; mpL: number; melee: [number, number]; weapon: string; spells: string[] }
const CLASSES: ClassDef[] = [
    { id: 'guerrero', name: 'Guerrero', desc: 'Resistente, pega cuerpo a cuerpo y frena enemigos.', head: 'head_short', armor: 'Coraza de cuero', hp: 140, hpL: 18, mp: 40, mpL: 4, melee: [5, 9], weapon: 'Espada corta', spells: ['golpe', 'aturdir', 'vendar', 'torbellino'] },
    { id: 'mago', name: 'Mago', desc: 'Frágil pero con hechizos a distancia, parálisis y cura.', head: 'head_short', armor: 'Túnica de mago', hp: 90, hpL: 10, mp: 90, mpL: 12, melee: [2, 4], weapon: 'Báculo de fresno', spells: ['proyectil', 'paralisis', 'curar', 'bola', 'hoja', 'lanza'] },
    { id: 'berserk', hidden: true, name: 'Berserk', desc: 'Mucho daño físico. Furia sube daño y velocidad de ataque y le abre dos habilidades extra.', head: 'head_bald', hp: 120, hpL: 14, mp: 30, mpL: 3, melee: [8, 13], weapon: 'Hacha de leñador', spells: ['tajo', 'aturdir', 'furia', 'torbellino', 'rugido', 'ejecutar'] },
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
    const o: Other = { profile: p.profile ?? '', id: p.playerId, name: p.characterName, x: p.x + 0.5, y: p.y + 0.5, cell: { x: p.x, y: p.y }, queue: [], step: null, stepMs: p.movementSpeedMs || 380, dir: 6, moving: false, one: null, flash: 0, phase: 0, ref: 3.4, t0: R() * 5, gone: false };
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
            P.stepMs = m.value.movementSpeedMs || 380;
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
function damageMob(m: Mob, dmg: number, crit: boolean, src: 'melee' | 'spell') {
    if (m.hp <= 0 || !mobs.includes(m)) return;
    if (src === 'melee' && P.fury > now()) dmg = Math.round(dmg * 1.3);
    m.hp -= dmg; m.flash = 0.12;
    if (!(m.one && (m.one.anim === 'swing' || m.one.anim === 'special') && now() < m.one.until) && !(m.boss && R() < 0.6)) oneShot(m, 'hit', 0.2);
    float(m.x, m.y, (crit ? '¡' : '') + dmg + (crit ? '!' : ''), crit ? '#ffd24a' : '#fff', crit);
    hitstop = Math.max(hitstop, crit ? 0.09 : 0.045); if (crit && !reduce) shake = 0.25;
    if (m.par > now() && dmg >= m.hpMax * 0.45) { m.par = 0; log(`La parálisis de ${m.name} se rompió por el golpe.`); }
    if (m.state === 'idle') aggro(m);
    const t = totals();
    if (src === 'melee' && t.leech) P.hp = Math.min(maxHp(), P.hp + Math.max(1, Math.round((dmg * t.leech) / 100)));
    if (src === 'melee' && t.poison && R() * 100 < t.poison) { m.poison = now() + 4; log(`${m.name} quedó envenenado.`); }
    if (m.hp <= 0) killMob(m);
}
function aggro(m: Mob) {
    if (m.state === 'chase') return; m.state = 'chase';
    for (const o of mobs) if (o !== m && o.state === 'idle' && o.zone === m.zone && dist(o, m) < 3.2) { o.state = 'chase'; o.nextAtk = now() + 0.4 + R() * 0.6; }
}
function killMob(m: Mob) {
    const t = totals(), gain = Math.round(m.exp * (1 + t.exp / 100));
    P.exp += gain; float(m.x, m.y - 0.3, `+${gain} exp`, '#c9a227');
    if (m.boss) {
        // boss: item garantizado de rareza alta (+1 al nivel de botín) y un buen puñado de oro al lado
        const it = rollItem(m.lvl + 2, m.boss.minRar);
        drops.push({ x: m.x, y: m.y, item: it, t: 0 }); drops.push({ x: m.x + 0.6, y: m.y + 0.4, gold: rint(m.boss.gold[0], m.boss.gold[1]), t: 0 });
        log(`¡${m.name} cayó! Soltó un item <span style="color:${it.rar.c}">${it.rar.n.toLowerCase()}</span>.`, true); shake = Math.max(shake, 0.4);
    } else if (R() < 0.62) { const it = rollItem(m.lvl); drops.push({ x: m.x, y: m.y, item: it, t: 0 }); if (it.rar.k >= 2) log(`¡Cayó un item <span style="color:${it.rar.c}">${it.rar.n.toLowerCase()}</span>!`, true); }
    else drops.push({ x: m.x, y: m.y, gold: rint(3, 8) * m.lvl, t: 0 });
    mobs.splice(mobs.indexOf(m), 1);
    corpses.push({ sprite: m.sprite, x: m.x, y: m.y, dir: m.dir, t: now() });
    if (P.target === m) P.target = null;
    later(m.boss?.respawn ?? (m.sprite === 'minotaur' ? 120 : 22), () => spawnMob(m.zone));
    while (P.exp >= expNeed()) { P.exp -= expNeed(); P.lvl++; P.hp = maxHp(); P.mp = maxMp(); float(P.x, P.y - 0.5, `¡Nivel ${P.lvl}!`, '#ffd24a', true); log(`Subiste a nivel ${P.lvl}.`, true); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#ffd24a' }); }
}
/** Habilidad distintiva del boss: aviso (anillo + nombre), 0,8 s de carga y recién ahí pega; se puede esquivar alejándose. */
function bossSpecial(m: Mob, sp: BossSpecial, T: number) {
    m.nextSp = T + sp.every; m.busy = T + 1.1; m.nextAtk = Math.max(m.nextAtk, T + 1.4);
    oneShot(m, 'special', 1.3); float(m.x, m.y - 0.4, `¡${sp.name}!`, sp.col, true);
    later(0.8, () => {
        if (!mobs.includes(m) || m.par > now() || P.dead) return;
        fx.push({ k: 'boom', x: m.x, y: m.y, t: 0, c: sp.col, r: sp.r }); if (!reduce) shake = Math.max(shake, 0.3);
        if (dist(m, P) > sp.r) return;
        if (sp.dmg) hurtPlayer(rint(sp.dmg[0], sp.dmg[1]));
        if (sp.stun && !P.dead) { P.frozenUntil = now() + sp.stun; P.path = []; P.engage = false; cancelCast(); log(`${m.name}: ${sp.name}. Quedaste inmovilizado ${sp.stun} s.`, true); }
    });
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
    for (const m of mobs.slice()) { if (Math.hypot(m.x - p.tx!, m.y - p.ty!) <= p.aoe!) { n++; damageMob(m, Math.round(p.dmg * (0.85 + R() * 0.3)), false, 'spell'); } }
    if (n > 1) log(`Bola de fuego: ${n} enemigos alcanzados.`, true);
}
function hurtPlayer(d: number) {
    if (P.dead) return;
    const dmg = Math.max(1, d - totals().def); P.hp -= dmg; P.flash = 0.12; float(P.x, P.y, '-' + dmg, '#ff6b55');
    if (P.casting) P.casting.end = Math.min(P.casting.end + 0.2, P.casting.start + P.casting.len * 1.6);
    if (!(P.one && P.one.anim !== 'hit' && now() < P.one.until)) oneShot(P, 'hit', 0.15);
    if (P.hp <= 0) {
        P.dead = true; P.deadT = now(); P.hp = 0; P.path = []; P.casting = null; P.target = null; const lost = Math.round(expNeed() * 0.05); P.exp = Math.max(0, P.exp - lost);
        log(`Moriste. Perdiste ${lost} de exp y volvés al campamento.`, true);
        later(2.2, () => {
            // volver al campamento: el server confirma con playerTeleported
            net.send({ $case: 'playerTeleportRequested', value: { x: MAP.spawn.x, y: MAP.spawn.y } });
            P.dead = false; P.one = null; P.hp = maxHp(); P.mp = maxMp(); mobs.forEach((m) => { m.state = 'return'; });
        });
    }
}

// ---------- hechizos ----------
type Target = Mob | { x: number; y: number; ground: true };
interface Spell { ctrl?: boolean; fury?: boolean; key: string; name: string; mp: number; cd: number; col: string; range: number; target: boolean; aoe?: number; cast: (m: Target | null) => false | void }
const isMob = (t: Target | null): t is Mob => !!t && 'hp' in t;
interface SpellDef extends Omit<Spell, 'key'> { ctrl?: boolean }
const LIB: Record<string, SpellDef> = {
    proyectil: { name: 'Proyectil arcano', mp: 8, cd: 0.4, col: '#b9a3ff', range: 8, target: true,
        cast(m) { if (!isMob(m)) return false; const t = totals(), dmg = rint(12, 18) + P.lvl * 2 + t.mag; projs.push({ x: P.x, y: P.y, m, spd: 11, dmg, col: '#b9a3ff' }); } },
    paralisis: { name: 'Parálisis', mp: 20, cd: 4, col: '#7fd6ff', range: 6, target: true, ctrl: true,
        cast(m) { return control(m, 3, 'Paralizaste', 'La parálisis'); } },
    aturdir: { name: 'Aturdir', mp: 18, cd: 5, col: '#ffd24a', range: 1.9, target: true, ctrl: true,
        cast(m) { return control(m, 2.5, 'Aturdiste', 'El aturdimiento'); } },
    curar: { name: 'Curar', mp: 15, cd: 2, col: '#7ee08a', range: 0, target: false,
        cast() { heal(35 + P.lvl * 3); } },
    vendar: { name: 'Vendar', mp: 14, cd: 3, col: '#7ee08a', range: 0, target: false,
        cast() { heal(30 + P.lvl * 4); } },
    bola: { name: 'Bola de fuego', mp: 25, cd: 4, col: '#ff8a3d', range: 7, target: true, aoe: 1.9,
        cast(m) { if (!m) return false; const t = totals(), dmg = rint(18, 26) + P.lvl * 2 + t.mag; projs.push({ x: P.x, y: P.y, tx: m.x, ty: m.y, m: isMob(m) ? m : null, spd: 8, dmg, col: '#ff8a3d', aoe: 1.9, sx: P.x, sy: P.y }); } },
    golpe: { name: 'Golpe brutal', mp: 10, cd: 1, col: '#ffb347', range: 1.9, target: true,
        cast(m) { if (!isMob(m)) return false; damageMob(m, rint(14, 20) + P.lvl * 2 + rint(totals().wdmg[0], totals().wdmg[1]), true, 'melee'); } },
    tajo: { name: 'Tajo salvaje', mp: 12, cd: 1, col: '#ff6b55', range: 1.9, target: true,
        cast(m) { if (!isMob(m)) return false; damageMob(m, rint(22, 30) + P.lvl * 3 + rint(totals().wdmg[0], totals().wdmg[1]), true, 'melee'); } },
    torbellino: { name: 'Torbellino', mp: 22, cd: 5, col: '#e0e0e0', range: 0, target: false,
        cast() { fx.push({ k: 'boom', x: P.x, y: P.y, t: 0, r: 2.2 }); efx('cyclone', P.x, P.y); let n = 0; for (const m of mobs.slice()) if (dist(P, m) <= 2.2 && !isSafe(m.x, m.y)) { n++; damageMob(m, rint(12, 18) + P.lvl * 2 + rint(totals().wdmg[0], totals().wdmg[1]), false, 'melee'); } if (!n) log('El torbellino no alcanzó a nadie.'); } },
    rugido: { name: 'Rugido', mp: 10, cd: 6, col: '#ff3b2f', range: 0, target: false, fury: true,
        cast() { fx.push({ k: 'boom', x: P.x, y: P.y, t: 0, r: 3.5 }); let n = 0; for (const m of mobs) if (dist(P, m) <= 3.5 && m.imm <= now()) { n++; m.par = now() + 2; m.parT = now(); m.imm = now() + 8; m.moving = false; if (m.state === 'idle') m.state = 'chase'; } log(n ? `Tu rugido aturdió a ${n} enemigo(s).` : 'Tu rugido no alcanzó a nadie.', true); } },
    ejecutar: { name: 'Ejecutar', mp: 12, cd: 4, col: '#ff3b2f', range: 1.9, target: true, fury: true,
        cast(m) { if (!isMob(m)) return false; const low = m.hp < m.hpMax * 0.35; damageMob(m, (rint(26, 36) + P.lvl * 3 + rint(totals().wdmg[0], totals().wdmg[1])) * (low ? 2 : 1), true, 'melee'); } },
    hoja: { name: 'Hoja de viento', mp: 14, cd: 1.5, col: '#8dffa0', range: 7, target: true,
        cast(m) { if (!isMob(m)) return false; efx('windblade', m.x, m.y, 10); damageMob(m, rint(13, 19) + P.lvl * 2 + totals().mag, false, 'spell'); } },
    lanza: { name: 'Lanza de piedra', mp: 30, cd: 5, col: '#d9a45a', range: 7, target: true,
        cast(m) { if (!isMob(m)) return false; efx('rocklance', m.x, m.y, 4); if (!reduce) shake = Math.max(shake, 0.2); damageMob(m, rint(30, 42) + P.lvl * 3 + totals().mag, true, 'spell'); } },
    furia: { name: 'Furia', mp: 15, cd: 20, col: '#ff3b2f', range: 0, target: false,
        cast() { P.fury = now() + 10; float(P.x, P.y - 0.4, '¡FURIA!', '#ff3b2f', true); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#ff3b2f' }); log('Furia: +30% de daño físico y +25% de velocidad de ataque por 10 s, sin castigo. Se abren Rugido y Ejecutar.', true); } },
};
let SPELLS: Spell[] = [];
function heal(h: number) { P.hp = Math.min(maxHp(), P.hp + h); float(P.x, P.y - 0.2, '+' + h, '#7ee08a'); efx('sphere', P.x, P.y); fx.push({ k: 'ring', x: P.x, y: P.y, t: 0, c: '#7ee08a' }); }
function control(m: Target | null, secs: number, verb: string, noun: string): false | void {
    if (!isMob(m)) return false;
    if (m.imm > now()) { log(`${m.name} es inmune al control por unos segundos.`); return false; }
    efx('stop', m.x, m.y); m.par = now() + secs; m.parT = now(); m.imm = now() + secs + 8; m.moving = false; if (m.state === 'idle') m.state = 'chase';
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
const CAST_T = 0.7; // como en HB: todos los hechizos tardan lo mismo en cargar
function cast(i: number) {
    if (P.dead) return; const s = SPELLS[i];
    if (P.ready && P.ready.i === i && s.target) { const m = autoTarget(s.range); if (m) release(m); else toast('Hacé clic en el objetivo.'); return; }
    if (s.fury && P.fury <= now()) { toast(`${s.name} solo se puede usar con Furia.`); return; }
    if (P.casting) { toast('Ya estás casteando.'); return; }
    if (cds[i] > now()) { toast(`${s.name} se está recargando.`); return; }
    if (P.mp < s.mp) { toast('No te alcanza el maná.'); return; }
    P.ready = null; P.engage = false; P.queued = null; P.path = []; holding = false;
    const T = now(); P.casting = { i, start: T, end: T + CAST_T, len: CAST_T };
}
function finishCast() {
    const c = P.casting!, s = SPELLS[c.i]; P.casting = null;
    if (!s.target) { fire(c.i, null); return; }
    P.ready = { i: c.i, t: now() };
}
function release(target: Mob | { x: number; y: number }) {
    const r = P.ready!, s = SPELLS[r.i];
    const m = 'hp' in target ? (target as Mob) : null;
    if (Math.hypot(target.x - P.x, target.y - P.y) > s.range) { toast('Está muy lejos. Acercate más.'); return false; }
    if (m && s.ctrl && m.imm > now()) { toast(`${m.name} es inmune al control por unos segundos.`); return false; }
    if (P.mp < s.mp) { toast('No te alcanza el maná.'); P.ready = null; return false; }
    P.ready = null; if (m) P.target = m;
    turnTo(P, target.x - P.x, target.y - P.y, 0, true); sendFacing();
    fire(r.i, m || { x: target.x, y: target.y, ground: true });
    return true;
}
function fire(i: number, m: Target | null) {
    const s = SPELLS[i];
    if (s.cast(m) === false) return;
    P.mp -= s.mp; cds[i] = now() + s.cd;
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
const efx = (n: string, x: number, y: number, dy = 0) => { if (FXM?.rows[n]) fx.push({ k: 'efx', n, x, y, t: 0, dy }); };
const load = (src: string) => new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
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
    const m = pickMob(sx, sy);
    talkNpc = null;
    const npc = !m && !P.ready ? pickNpc(sx, sy) : null;
    if (npc) { talkTo(npc); return; }
    if (P.ready) {
        const s = SPELLS[P.ready.i];
        if (m) { release(m); return; }
        if (s.aoe) { const g = toGrid(sx, sy); release({ x: g.x, y: g.y }); return; }
    }
    if (P.casting && m) { P.target = m; return; }
    if (m) { cancelCast(); P.target = m; P.engage = true; P.pickup = null; P.repath = 0; return; }
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
            if (text) net.send({ $case: 'chatMessageSendRequest', value: { message: text } });
            chatIn.value = ''; chatIn.blur(); cv.focus({ preventScroll: true }); e.preventDefault();
        } else if (e.key === 'Escape') { chatIn.blur(); cv.focus({ preventScroll: true }); }
        return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') { e.preventDefault(); chatIn.focus(); return; }
    const dm = /^(?:Digit|Numpad)([1-6])$/.exec(e.code) ?? /^([1-6])$/.exec(e.key), k = dm ? Number(dm[1]) - 1 : null;
    if (k != null && k < SPELLS.length && !e.repeat) { e.preventDefault(); cast(k); }
    if (e.key === 'i' || e.key === 'I') toggleBag();
    if (e.key === 'Escape') { if (P.casting || P.ready) cancelCast('Hechizo cancelado.'); else P.target = null; }
});

// ---------- update ----------
function stepEntity(e: Ent, tx: number, ty: number, spd: number, dt: number, mob: boolean) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy); if (d < 0.02) return true;
    const s = Math.min(d, spd * dt), nx = e.x + (dx / d) * s, ny = e.y + (dy / d) * s;
    const ok = (x: number, y: number) => walk(Math.floor(x), Math.floor(y)) && !(mob && isSafe(x, y));
    if (ok(nx, ny)) { e.x = nx; e.y = ny; } else if (ok(nx, e.y)) e.x = nx; else if (ok(e.x, ny)) e.y = ny;
    turnTo(e, dx, dy, dt);
    e.phase = (e.phase || 0) + (dt * spd) / (e.ref || 3.4);
    e.moving = true; return false;
}
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
let regenT = 0, pingT = 0, pingSeq = 0;
function update(dt: number) {
    const T = now(), tot = totals();
    for (const p of pending.slice()) if (T >= p.t) { pending.splice(pending.indexOf(p), 1); p.fn(); }
    pingT -= dt; if (pingT <= 0 && connected) { pingT = 1; net.send({ $case: 'pingRequest', value: { sequence: ++pingSeq } }); }
    if (holding && !P.dead && !P.target && !P.casting && mouse.x >= 0) { holdT -= dt; if (holdT <= 0) { holdT = 0.18; const g = toGrid(mouse.x, mouse.y); if (Math.hypot(g.x - P.x, g.y - P.y) > 0.7) moveTo(g.x, g.y); } }
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
        // caminar: un paso por vez; el server valida cada uno
        if (P.step) advanceStep(P, T, dt);
        if (!P.step && P.path.length && !P.casting && T >= P.frozenUntil) {
            const next = P.path[0];
            if (occupiedByOther(next.x, next.y)) { const end = P.path[P.path.length - 1]; P.path = []; if (end !== next) moveTo(end.x + 0.5, end.y + 0.5); }
            else {
                P.path.shift();
                net.send({ $case: 'requestMovement', value: { curX: P.cell.x, curY: P.cell.y, destX: next.x, destY: next.y, gameWorldId: MAP_WORLD_ID, dashAttack: false } });
                P.step = { fx: P.cell.x, fy: P.cell.y, tx: next.x, ty: next.y, t0: T, dur: P.stepMs / 1000 + STEP_MARGIN };
                P.cell = { x: next.x, y: next.y };
                advanceStep(P, T, 0);
            }
        }
        if (!P.step && !P.path.length && !P.moving) sendFacing();
        if (P.pickup && dist(P, P.pickup) < 0.9) {
            const d = P.pickup; P.pickup = null;
            if (d.gold) { P.gold += d.gold; log(`Juntaste ${d.gold} de oro.`); drops.splice(drops.indexOf(d), 1); }
            else if (d.item && P.bag.length < 18) { P.bag.push(d.item); drops.splice(drops.indexOf(d), 1); log(`Agarraste <span style="color:${d.item.rar.c}">${d.item.name}</span>.`); renderBag(); }
            else log('La bolsa está llena.');
        }
        regenT += dt; if (regenT >= 1) { regenT = 0; const inCity = isSafe(P.x, P.y); P.hp = Math.min(maxHp(), P.hp + (inCity ? 8 : 1)); P.mp = Math.min(maxMp(), P.mp + (inCity ? 8 : 2)); }
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
        if (m.poison > T && T >= m.poisonTick) { m.poisonTick = T + 1; m.hp -= 3; float(m.x, m.y, '3', '#8fd14f'); if (m.hp <= 0) { killMob(m); continue; } }
        if (m.par > T) continue;
        const home = { x: m.zone.x + 0.5, y: m.zone.y + 0.5 };
        const dp = dist(m, P), playerOk = !P.dead && !isSafe(P.x, P.y);
        if (m.state === 'idle') {
            if (playerOk && dp < 4.5) aggro(m);
            else { m.wait -= dt; if (m.wait <= 0) { if (stepEntity(m, m.wx, m.wy, m.spd * 0.45, dt, true)) { m.wait = 1.5 + R() * 3; m.wx = clamp(m.zone.x + (R() * 2 - 1) * m.zone.r, 1, N - 2); m.wy = clamp(m.zone.y + (R() * 2 - 1) * m.zone.r, 1, N - 2); } else m.wait = 0; } }
        } else if (m.state === 'chase') {
            if (!playerOk || dist(m, home) > 17) { m.state = 'return'; continue; }
            if (T < m.busy) { turnTo(m, P.x - m.x, P.y - m.y, dt); continue; } // cargando la habilidad: se queda quieto
            const sp = m.boss?.special;
            if (sp && T >= m.nextSp && dp <= sp.range) bossSpecial(m, sp, T);
            if (T < m.busy) continue;
            if (dp > 1.1) stepEntity(m, P.x, P.y, m.spd, dt, true);
            for (const o of mobs) { if (o === m || o.state !== 'chase') continue; const sx = m.x - o.x, sy = m.y - o.y, sd = Math.hypot(sx, sy); if (sd > 0.01 && sd < 0.85) { const k = (0.85 - sd) * dt * 3, nx = m.x + (sx / sd) * k, ny = m.y + (sy / sd) * k; if (walk(Math.floor(nx), Math.floor(ny))) { m.x = nx; m.y = ny; } } }
            if (dp <= 1.5) {
                turnTo(m, P.x - m.x, P.y - m.y, dt);
                if (T >= m.nextAtk) { m.nextAtk = T + m.atk; oneShot(m, 'swing', 0.4); const dmg = rint(m.dmg[0], m.dmg[1]); later(0.2, () => { if (mobs.includes(m) && m.par <= now() && dist(m, P) < 1.8) hurtPlayer(dmg); }); }
            }
        } else if (m.state === 'return') {
            if (stepEntity(m, home.x, home.y, m.spd * 1.3, dt, true) || dist(m, home) < 0.5) { m.state = 'idle'; m.hp = m.hpMax; }
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
        const d = dist(p, pm); if (d < 0.3) { fx.push({ k: 'ring', x: pm.x, y: pm.y, t: 0, c: '#c9b6ff' }); damageMob(pm, p.dmg, false, 'spell'); projs.splice(projs.indexOf(p), 1); continue; }
        p.x += ((pm.x - p.x) / d) * p.spd * dt; p.y += ((pm.y - p.y) / d) * p.spd * dt;
    }
    for (const c of corpses.slice()) if (T - c.t > 3) corpses.splice(corpses.indexOf(c), 1);
    for (const f of floats.slice()) { f.t += dt; if (f.t > 1.1) floats.splice(floats.indexOf(f), 1); }
    for (const f of fx.slice()) { f.t += dt; if (f.t > (f.k === 'efx' ? 0.72 : 0.6)) fx.splice(fx.indexOf(f), 1); }
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
function nameTag(name: string, x: number, y: number, col: string, alpha = 1, size = 11) {
    ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.font = `600 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(name, x, y); ctx.fillStyle = col; ctx.fillText(name, x, y); ctx.globalAlpha = 1;
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
    for (const b of MAP.buildings) objs.push({ d: b.x + b.y + (b.w + b.h) / 2, f: () => drawBuilding(b) });
    for (const n of MAP.npcs) objs.push({ d: n.x + n.y + 1, f: () => drawNpc(n, T) });
    for (const d of drops) objs.push({ d: d.x + d.y - 0.2, f: () => drawDrop(d, T) });
    for (const c of corpses) objs.push({ d: c.x + c.y - 0.3, f: () => { const p = iso(c.x, c.y), age = T - c.t; drawSprite(c.sprite, 'die', age, c.dir, p.x, p.y, null, age > 2 ? 3 - age : 1); } });
    for (const m of mobs) objs.push({ d: m.x + m.y, f: () => drawMob(m, T) });
    for (const o of others.values()) objs.push({ d: o.x + o.y, f: () => { const p = iso(o.x, o.y), [a, t] = animFor(o, T); drawSprite(otherSprite(o), a, t, o.dir, p.x, p.y, null, o.gone ? 0.45 : 1); } });
    objs.push({ d: P.x + P.y, f: () => { const p = iso(P.x, P.y); if (P.frozenUntil > T && !P.dead) { ctx.strokeStyle = 'rgba(190,235,255,.85)'; ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 8 - i * 14, 16, 6, 0, 0, Math.PI * 2); ctx.stroke(); } } if (P.dead) drawSprite('hero', 'die', T - P.deadT, P.dir, p.x, p.y); else { const [a, t] = animFor(P, T); drawSprite('hero', a, t, P.dir, p.x, p.y, P.flash > 0 ? 'rgba(255,70,50,.35)' : null); } } });
    objs.sort((a, b) => a.d - b.d).forEach((o) => o.f());
    // nombres arriba de todo
    for (const o of others.values()) { const p = iso(o.x, o.y); nameTag(o.name, p.x, p.y - 70, factionCol(o.profile.split(';')[0]), o.gone ? 0.5 : 1); }
    { const p = iso(P.x, P.y); nameTag(P.name, p.x, p.y - 70, factionCol(selectedFaction)); }
    for (const n of MAP.npcs) { const p = iso(n.x + 0.5, n.y + 0.5); nameTag(n.name, p.x, p.y - 70, '#9fd36b'); }
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
    const zone = isSafe(P.x, P.y) ? 'Campamento de Solmar · zona segura' : ZONES.find((z) => near(P.x, P.y, z, z.r + 2))?.name || '';
    if (zone) { ctx.font = "600 13px 'Alegreya SC', Georgia, serif"; ctx.fillStyle = 'rgba(214,164,69,.9)'; ctx.fillText(zone, W / 2, H - 98); }
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
    SPELLS = CLS.spells.map((sid, i) => ({ key: String(i + 1), ...LIB[sid] }));
    cds.fill(0); P.fury = 0; P.ready = null; P.casting = null;
    const mk = (n: string): Item => ({ id: uid++, ...BASES.find((b) => b.name === n)!, rar: RAR[0], attrs: [] });
    P.eq.arma = mk(CLS.weapon); P.eq.armadura = CLS.armor ? mk(CLS.armor) : null; P.eq.cabeza = null; P.bag = [];
    refreshLook();
    P.lvl = 1; P.exp = 0; P.hp = maxHp(); P.mp = maxMp();
    $('bar').innerHTML = SPELLS.map((s, i) => `<button class="slot box" id="sp${i}" type="button" title="${s.name} (${s.mp} maná)"><kbd>${s.key}</kbd><b>${s.name.replace(/ (?=\S+$)/, '<br>')}</b><em>${s.mp}</em><div class="cd" id="cd${i}"></div></button>`).join('');
    SPELLS.forEach((_, i) => $('sp' + i).addEventListener('click', () => { cast(i); cv.focus({ preventScroll: true }); }));
    $('helpKeys').textContent = `Click o mantener: caminar · Click en mob: atacar · 1–6 usar habilidad (las de objetivo: esperá que cargue y click en el blanco) · Click derecho: cancelar · ${SPELLS.map((x) => x.key + ' ' + x.name).join(' · ')} · I Bolsa · Enter chat`;
}
function hud() {
    const T = now(), mh = maxHp(), mm = maxMp();
    $('meLvl').textContent = 'Nv ' + P.lvl;
    $('hpI').style.width = (P.hp / mh) * 100 + '%'; $('hpT').textContent = `${Math.ceil(P.hp)} / ${mh}`;
    $('mpI').style.width = (P.mp / mm) * 100 + '%'; $('mpT').textContent = `${Math.floor(P.mp)} / ${mm}`;
    $('xpI').style.width = (P.exp / expNeed()) * 100 + '%';
    SPELLS.forEach((s, i) => { const left = Math.max(0, cds[i] - T); $('cd' + i).style.height = (left / s.cd) * 100 + '%'; $('sp' + i).hidden = !!s.fury && P.fury <= T; $('sp' + i).classList.toggle('nomp', P.mp < s.mp); $('sp' + i).classList.toggle('ready', !!(P.ready && P.ready.i === i)); });
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
    $('gold').textContent = P.gold + ' oro';
    const netEl = $('net');
    netEl.textContent = connected ? `En línea · ${playersOnline || 1} ${playersOnline === 1 ? 'jugador' : 'jugadores'}` : 'Sin conexión';
    netEl.classList.toggle('off', !connected);
}

// ---------- bolsa ----------
let sel: { it: Item; from: 'bag' | 'eq' } | null = null;
function toggleBag() { $('bag').hidden = !$('bag').hidden; renderBag(); }
$('openBag').addEventListener('click', toggleBag);
function renderBag() {
    if ($('bag').hidden) return;
    $('equip').innerHTML = SLOTS.map((s) => { const it = P.eq[s]; return `<button type="button" class="cell${sel && it && sel.it === it ? ' sel' : ''}" data-eq="${s}" style="${it ? `color:${it.rar.c}` : ''}"><span>${s}</span>${it ? it.name.split(' ')[0] : '—'}</button>`; }).join('');
    const cells: string[] = []; for (let i = 0; i < 18; i++) { const it = P.bag[i]; cells.push(it ? `<button type="button" class="cell${sel && sel.it === it ? ' sel' : ''}" data-bag="${i}" style="color:${it.rar.c};border-color:${it.rar.k ? it.rar.c + '66' : '#2b312c'}">${it.name.split(' ')[0]}</button>` : `<div class="cell empty">·</div>`); }
    $('inv').innerHTML = cells.join('');
    document.querySelectorAll<HTMLElement>('[data-bag]').forEach((b) => (b.onclick = () => { sel = { it: P.bag[+b.dataset.bag!], from: 'bag' }; renderBag(); }));
    document.querySelectorAll<HTMLElement>('[data-eq]').forEach((b) => (b.onclick = () => { const it = P.eq[b.dataset.eq as Slot]; sel = it ? { it, from: 'eq' } : null; renderBag(); }));
    const d = $('detail');
    if (!sel || !sel.it) { d.innerHTML = `<span class="label">Tocá un item para ver sus atributos</span>`; return; }
    const it = sel.it, base: string[] = [];
    if (it.dmg) base.push(`Daño ${it.dmg[0]}–${it.dmg[1]}`); if (it.def) base.push(`Defensa ${it.def}`); if (it.mag) base.push(`+${it.mag} daño mágico`);
    d.innerHTML = `<div class="iname" style="color:${it.rar.c}">${it.name}</div><div class="label">${it.rar.n} · ${it.slot}</div>
    ${base.length ? `<div>${base.join(' · ')}</div>` : ''}
    ${it.attrs.length ? `<ul>${it.attrs.map((a) => `<li style="color:#8fb6f0">${attrText(a)}</li>`).join('')}</ul>` : `<div class="label">Sin atributos extra</div>`}
    <div class="row">${sel.from === 'bag' ? `<button type="button" id="eqBtn">Equipar</button><button type="button" id="dropBtn">Tirar</button>` : `<button type="button" id="uneqBtn">Sacar</button>`}</div>`;
    const eqBtn = document.getElementById('eqBtn'), dropBtn = document.getElementById('dropBtn'), uneqBtn = document.getElementById('uneqBtn');
    if (eqBtn) eqBtn.onclick = () => { P.bag.splice(P.bag.indexOf(it), 1); const prev = P.eq[it.slot]; if (prev) P.bag.push(prev); P.eq[it.slot] = it; refreshLook(); sel = { it, from: 'eq' }; P.hp = Math.min(P.hp, maxHp()); P.mp = Math.min(P.mp, maxMp()); renderBag(); };
    if (dropBtn) dropBtn.onclick = () => { P.bag.splice(P.bag.indexOf(it), 1); sel = null; renderBag(); };
    if (uneqBtn) uneqBtn.onclick = () => { if (P.bag.length >= 18) { log('La bolsa está llena.'); return; } P.eq[it.slot] = null; refreshLook(); P.bag.push(it); sel = { it, from: 'bag' }; P.hp = Math.min(P.hp, maxHp()); P.mp = Math.min(P.mp, maxMp()); renderBag(); };
}

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
    mercader: ['leather_boots', 'cloth_pants', 'cloth_gloves', 'cloth_shirt', 'head_short', 'leather_hood'],
};
function refreshNpcLook() {
    if (!PAPER) return;
    for (const n of MAP.npcs) {
        const names = NPC_LOOKS[n.id], key = 'npc_' + n.id;
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

// ---------- mercader: vender items de la bolsa ----------
const SELL_PRICE = [4, 15, 50, 150]; // oro por rareza (Común, Mágico, Raro, Épico)
const sellPrice = (it: Item) => SELL_PRICE[it.rar.k] ?? 1;
const TALK_RANGE = 2.6;
let talkNpc: Npc | null = null, shopNpc: Npc | null = null;
const npcDist = (n: Npc) => Math.hypot(n.x + 0.5 - P.x, n.y + 0.5 - P.y);
function talkTo(n: Npc) {
    cancelCast(); P.target = null; P.engage = false; P.pickup = null; P.queued = null;
    if (npcDist(n) <= TALK_RANGE) { openShop(n); return; }
    if (moveTo(n.x + 0.5, n.y + 0.5)) talkNpc = n; else toast('No llegás hasta ahí.');
}
function openShop(n: Npc = MAP.npcs[0]) {
    shopNpc = n; talkNpc = null; $('shopName').textContent = n.name; $('shop').hidden = false; renderShop();
    log(`${n.name}: «Traeme lo que no uses y te lo pago en oro.»`);
}
function closeShop() { shopNpc = null; $('shop').hidden = true; }
function renderShop() {
    if ($('shop').hidden) return;
    $('shopGold').textContent = P.gold + ' oro';
    $('shopList').innerHTML = P.bag.length
        ? P.bag.map((it, i) => `<button type="button" class="srow" data-sell="${i}"><span style="color:${it.rar.c}">${esc(it.name)}<small>${it.rar.n} · ${it.slot}</small></span><em>${sellPrice(it)} oro</em></button>`).join('')
        : `<div class="label">La bolsa está vacía</div>`;
    document.querySelectorAll<HTMLElement>('[data-sell]').forEach((b) => (b.onclick = () => sellItem(+b.dataset.sell!)));
}
function sellItem(i: number) {
    const it = P.bag[i]; if (!it) return;
    const g = sellPrice(it);
    P.bag.splice(i, 1); P.gold += g; if (sel && sel.it === it) sel = null;
    log(`Vendiste <span style="color:${it.rar.c}">${esc(it.name)}</span> por ${g} de oro.`);
    renderBag(); renderShop();
}
/** Abre la tienda al llegar y la cierra si te alejás. */
function npcTick() {
    if (talkNpc && !P.step && npcDist(talkNpc) <= TALK_RANGE) openShop(talkNpc);
    else if (talkNpc && !P.step && !P.path.length) { talkNpc = null; }
    if (shopNpc && (npcDist(shopNpc) > TALK_RANGE + 1.5 || P.dead)) closeShop();
}
$('shopClose').addEventListener('click', closeShop);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shopNpc) closeShop(); });

// ---------- escaleras entre zonas (el server valida el teletransporte; la celda de destino tiene que estar libre) ----------
let portalLock = 0;
function checkPortals() {
    if (!MAP.portals || !connected || P.dead || P.step || now() < portalLock) return;
    const p = MAP.portals.find((q) => q.x === P.cell.x && q.y === P.cell.y); if (!p) return;
    portalLock = now() + 1.5; P.path = []; P.target = null; P.engage = false; P.pickup = null;
    net.send({ $case: 'playerTeleportRequested', value: { x: p.tx, y: p.ty } });
    log(p.msg, true);
}
const inDungeon = (gx: number, gy: number) => { const d = MAP.dungeon; return !!d && gx >= d.x0 && gx < d.x1 + 1 && gy >= d.y0 && gy < d.y1 + 1; };

// ---------- loop ----------
const MAP_WORLD_ID = 'solmar';
let last = now(), lastCam = now();
function frame() {
    const T = now(); let dt = Math.min(0.05, T - last); last = T;
    if (hitstop > 0) { hitstop -= dt; dt = 0; }
    update(dt); checkPortals(); npcTick(); updateCam(Math.min(0.05, T - lastCam)); lastCam = T;
    updateHover(); render(); hud(); requestAnimationFrame(frame);
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
$('factions').innerHTML = FACTIONS.map((f) => `<button type="button" class="fac" data-id="${f.id}" style="--c:${f.col}"><b>${f.name}</b><small>${f.desc}</small></button>`).join('');
function markFaction() { $('factions').querySelectorAll<HTMLElement>('.fac').forEach((b) => b.classList.toggle('on', b.dataset.id === selectedFaction)); }
$('factions').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.fac'); if (!b) return; selectedFaction = b.dataset.id!; try { localStorage.setItem('fdn:faction', selectedFaction); } catch { /* sin almacenamiento */ } markFaction(); });
markFaction();
let selectedClass = 'guerrero';
try { const c = localStorage.getItem('fdn:class'); if (CLASSES.some((x) => x.id === c && !x.hidden)) selectedClass = c!; } catch { /* sin almacenamiento */ }
$('classes').innerHTML = CLASSES.filter((c) => !c.hidden).map((c) => `<button type="button" class="cls" data-id="${c.id}"><b>${c.name}</b><small>${c.desc}</small></button>`).join('');
function markClass() { $('classes').querySelectorAll<HTMLElement>('.cls').forEach((b) => b.classList.toggle('on', b.dataset.id === selectedClass)); }
$('classes').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.cls'); if (!b) return; selectedClass = b.dataset.id!; try { localStorage.setItem('fdn:class', selectedClass); } catch { /* sin almacenamiento */ } markClass(); });
markClass();
function showLogin(error = '') {
    connected = false;
    $('login').hidden = false; $('loginErr').textContent = error;
    const nameIn = $('nameIn') as HTMLInputElement;
    try { nameIn.value ||= localStorage.getItem('fdn:lastName') ?? ''; } catch { /* sin almacenamiento */ }
    nameIn.focus();
}
$('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($('nameIn') as HTMLInputElement).value.trim();
    if (!name) return;
    const btn = $('loginForm').querySelector('button')!;
    btn.disabled = true; $('loginErr').textContent = 'Conectando…';
    try { localStorage.setItem('fdn:lastName', name); } catch { /* sin almacenamiento */ }
    net.onMessage = (m) => { onServer(m); if (m.$case === 'initialGameWorldState' && !connected) enterWorld(name); };
    net.onClose = (reason) => { const was = connected; others.clear(); showLogin(was ? `Se cortó la conexión: ${reason}` : reason); btn.disabled = false; };
    try { await net.connect(serverUrl(), storedId(name), name); }
    catch (err) { $('loginErr').textContent = `${(err as Error).message} ¿Está corriendo el server (pnpm dev)?`; btn.disabled = false; }
});
function enterWorld(name: string) {
    setClass(selectedClass); connected = true; P.name = name; lookKey = ''; refreshLook(); sendProfile(); $('meName').textContent = name;
    $('login').hidden = true; ($('loginForm').querySelector('button') as HTMLButtonElement).disabled = false;
    cv.focus({ preventScroll: true });
    log('Bienvenido al campamento de Solmar. Goblins al sureste, zombis en el pantano del este, esqueletos en el cementerio.', true);
    log('Tocá un mob para atacarlo. Apretá un hechizo (1–4), esperá que cargue y hacé clic en el objetivo. Enter para chatear.');
}

async function boot() {
    try {
        const meta = await (await fetch('assets/meta.json')).json();
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
    if (new URLSearchParams(location.search).has('debug')) Object.assign((window as unknown as { __fdn: Record<string, unknown> }).__fdn, { efx, MAP, openShop, toScreen, give: (n: number) => { for (let i = 0; i < n; i++) P.bag.push(rollItem(1 + i)); renderBag(); } });
    if (new URLSearchParams(location.search).has('debug')) Object.assign((window as unknown as { __fdn: Record<string, unknown> }).__fdn, { warp: (x: number, y: number) => net.send({ $case: 'playerTeleportRequested', value: { x, y } }), go: (x: number, y: number) => moveTo(x + 0.5, y + 0.5) });
    const pt = iso(P.x, P.y); cam.x = pt.x; cam.y = pt.y;
    showLogin();
    requestAnimationFrame(frame);
}
boot();
