/**
 * Arma los atlas del cliente a partir del arte de Flare (CC-BY-SA 3.0) bajado en reference/flare-game:
 *   hero_warrior/mage/berserk.webp, goblin.webp, zombie.webp, skeleton.webp  personajes (filas = animación × 8 direcciones)
 *   world.webp                                           tiles y objetos del tileset de pasto
 *   meta.json                                            dónde está cada cosa
 * Todo se escala a la mitad, igual que en el prototipo.
 *
 * Uso: pnpm assets:flare (baja Flare si falta y corre esto). Los atlas ya generados están en el repo,
 * así que solo hace falta correrlo si se cambia qué piezas se usan.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mod = join(process.env.FLARE_DIR ?? join(root, 'reference', 'flare-game'), 'mods', 'fantasycore');
const out = join(root, 'apps', 'client', 'public', 'assets');
const S = 0.5;
const DIRS = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW'];

if (!existsSync(join(mod, 'engine', 'hero_layers.txt'))) {
    console.error('No encontré el arte de Flare en reference/flare-game. Corré pnpm assets:flare.');
    process.exit(1);
}

interface Section { frames: number; duration: number; type: string; f: Map<string, number[]> }

function parse(rel: string): { image: string; perAnim: Map<string, string>; sections: Map<string, Section> } {
    let image = '';
    const perAnim = new Map<string, string>(), sections = new Map<string, Section>();
    let cur: Section | undefined;
    for (const raw of readFileSync(join(mod, rel), 'utf8').split(/\r?\n/)) {
        const l = raw.trim();
        const m = /^\[(\w+)\]$/.exec(l);
        if (m) { cur = { frames: 1, duration: 600, type: 'looped', f: new Map() }; sections.set(m[1], cur); continue; }
        const eq = l.indexOf('=');
        if (eq < 0 || l.startsWith('#')) continue;
        const k = l.slice(0, eq), v = l.slice(eq + 1);
        if (k === 'image') { const [p, a] = v.split(','); if (a) perAnim.set(a, p); else image = p; }
        else if (!cur) continue;
        else if (k === 'frames') cur.frames = Number(v);
        else if (k === 'duration') cur.duration = parseInt(v, 10) * (v.endsWith('ms') ? 1 : 1000);
        else if (k === 'type') cur.type = v;
        else if (k === 'frame') { const n = v.split(',').map(Number); cur.f.set(`${n[0]},${n[1]}`, n.slice(2)); }
    }
    return { image, perAnim, sections };
}

const imageCache = new Map<string, Promise<Image>>();
const img = (rel: string) => { let p = imageCache.get(rel); if (!p) { p = loadImage(readFileSync(join(mod, rel))); imageCache.set(rel, p); } return p; };

const order = new Map<string, string[]>();
for (const l of readFileSync(join(mod, 'engine', 'hero_layers.txt'), 'utf8').split(/\r?\n/)) {
    if (l.startsWith('layer=')) { const [d, ...slots] = l.trim().slice(6).split(','); order.set(d, slots); }
}

interface Layer { type: string; anim: ReturnType<typeof parse> }

interface Bounds { minx: number; miny: number; maxx: number; maxy: number }
function boundsOf(layers: Layer[], anims: string[]): Bounds {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (const { anim } of layers) for (const a of anims) for (const [, , w, h, ox, oy] of anim.sections.get(a)?.f.values() ?? []) {
        minx = Math.min(minx, -ox); miny = Math.min(miny, -oy); maxx = Math.max(maxx, w - ox); maxy = Math.max(maxy, h - oy);
    }
    return { minx: Math.floor(minx / 2) * 2, miny: Math.floor(miny / 2) * 2, maxx: Math.ceil(maxx / 2) * 2, maxy: Math.ceil(maxy / 2) * 2 };
}

/** Con `fixed`, todas las piezas salen con el mismo tamaño de celda y filas, para poder apilarlas en el cliente. */
async function build(name: string, layers: Layer[], anims: string[], fixed?: { b: Bounds; ref: Layer }) {
    const { minx, miny, maxx, maxy } = fixed?.b ?? boundsOf(layers, anims);
    const cw = maxx - minx, ch = maxy - miny;
    const first = (fixed?.ref ?? layers[0]).anim.sections;
    const cols = Math.max(...anims.map((a) => first.get(a)!.frames));
    const full = createCanvas(cw * cols, ch * 8 * anims.length), ctx = full.getContext('2d');
    const meta = { cw: cw / 2, ch: ch / 2, ax: -minx / 2, ay: -miny / 2, cols, anims: {} as Record<string, { row: number; n: number; dur: number; type: string }> };
    for (const [ai, a] of anims.entries()) {
        const sec = first.get(a)!;
        meta.anims[a] = { row: ai * 8, n: sec.frames, dur: sec.duration, type: sec.type };
        for (let d = 0; d < 8; d++) {
            const types = layers.length > 1 ? order.get(DIRS[d])! : [layers[0].type];
            for (let i = 0; i < sec.frames; i++) {
                const cx = i * cw, cy = (ai * 8 + d) * ch;
                for (const t of types) for (const L of layers) {
                    if (L.type !== t) continue;
                    const fr = L.anim.sections.get(a)?.f.get(`${i},${d}`);
                    if (!fr) continue;
                    const [x, y, w, h, ox, oy] = fr;
                    if (w <= 0 || h <= 0) continue;
                    const im = await img(L.anim.perAnim.get(a) ?? L.anim.image);
                    ctx.drawImage(im, x, y, w, h, cx - minx - ox, cy - miny - oy, w, h);
                }
            }
        }
    }
    const half = createCanvas(full.width / 2, full.height / 2), hctx = half.getContext('2d');
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(full, 0, 0, half.width, half.height);
    writeFileSync(join(out, `${name}.webp`), half.toBuffer('image/webp', 84));
    return meta;
}

mkdirSync(out, { recursive: true });
// conserva lo que armaron otros scripts (bosses, etc.) en meta.json
const metaFile = join(out, 'meta.json');
const meta: Record<string, unknown> = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
const EA = ['stance', 'run', 'swing', 'hit', 'die'];
for (const n of ['goblin', 'zombie', 'skeleton']) {
    meta[n] = await build(n, [{ type: 'x', anim: parse(`animations/enemies/${n}.txt`) }], EA);
}
// Enemigos extra de fantasycore (progresión nivel 2 a 9). Si a alguno le falta una animación se arma con otra parecida.
const FALLBACK: Record<string, string[]> = { hit: ['block', 'stance'], swing: ['cast', 'shoot', 'stance'], die: ['critdie'], run: ['stance'] };
for (const n of ['goblin_elite', 'antlion', 'skeleton_mage', 'fire_ant', 'wyvern', 'minotaur']) {
    const anim = parse(`animations/enemies/${n}.txt`);
    for (const a of EA) {
        const ok = (k: string) => anim.sections.has(k) && (anim.perAnim.has(k) || anim.image) && (anim.sections.get(k)!.f.size > 0)
            && existsSync(join(mod, anim.perAnim.get(k) ?? anim.image));
        if (ok(a)) continue;
        const alt = (FALLBACK[a] ?? []).find(ok);
        if (!alt) throw new Error(`${n}: no hay animación ${a} ni reemplazo`);
        console.warn(`${n}: falta ${a}, uso ${alt}`);
        anim.sections.set(a, { ...anim.sections.get(alt)!, duration: a === 'hit' ? 300 : anim.sections.get(alt)!.duration });
        anim.perAnim.set(a, anim.perAnim.get(alt) ?? anim.image);
    }
    const die = anim.sections.get('die'); if (die) die.type = 'play_once'; // el minotauro la trae back_forth
    meta[n] = await build(n, [{ type: 'x', anim }], EA);
}
// Muñeco por capas: cada pieza de equipo es su propio atlas (misma grilla), el cliente las apila según lo que lleva puesto.
const SETS: Record<string, [string, string, string, string]> = { // [feet, legs, hands, chest]
    default: ['default_feet', 'default_legs', 'default_hands', 'default_chest'],
    leather: ['leather_boots', 'leather_pants', 'leather_gloves', 'leather_chest'],
    chain: ['chain_boots', 'chain_greaves', 'chain_gloves', 'chain_cuirass'],
    plate: ['plate_boots', 'plate_greaves', 'plate_gauntlets', 'plate_cuirass'],
    mage: ['mage_boots', 'mage_skirt', 'mage_sleeves', 'mage_vest'],
    cloth: ['cloth_sandals', 'cloth_pants', 'cloth_gloves', 'cloth_shirt'],
};
const HEADS = ['head_short', 'head_bald'];
const HELMS = ['leather_hood', 'chain_coif', 'plate_helm', 'mage_hood'];
const WEAPONS = ['shortsword', 'longsword', 'hand_axe', 'battle_axe', 'mace', 'maul', 'zweihander', 'staff', 'wand'];
const SHIELDS = ['buckler', 'iron_buckler', 'kite_shield'];
const pieces: Record<string, string> = {}; // pieza -> tipo de capa
for (const [, [f, l, h, c]] of Object.entries(SETS)) { pieces[f] = 'feet'; pieces[l] = 'legs'; pieces[h] = 'hands'; pieces[c] = 'chest'; }
for (const n of HEADS) pieces[n] = 'head';
for (const n of HELMS) pieces[n] = 'head';
for (const n of WEAPONS) pieces[n] = 'main';
for (const n of SHIELDS) pieces[n] = 'off';
const ref: Layer = { type: 'chest', anim: parse('animations/avatar/male/default_chest.txt') };
const HA = [...EA, 'cast'];
const loaded = Object.entries(pieces).map(([n, type]) => ({ n, layer: { type, anim: parse(`animations/avatar/male/${n}.txt`) } }));
const fixedB = boundsOf(loaded.map((x) => x.layer), HA);
mkdirSync(join(out, 'paper'), { recursive: true });
let paper: Record<string, unknown> = {};
for (const { n, layer } of loaded) paper = { ...paper, ...(await build(`paper/${n}`, [layer], HA, { b: fixedB, ref })) };
meta.paper = {
    ...(paper as object), // cw, ch, ax, ay, cols, anims (iguales para todas las piezas)
    order: Object.fromEntries(DIRS.map((d, i) => [i, order.get(d)])),
    pieces, sets: SETS, heads: HEADS, helms: HELMS, weapons: WEAPONS, shields: SHIELDS,
};

// mundo: tiles de piso y objetos del tileset de pasto, empaquetados en estantes
const ts = await loadImage(readFileSync(join(mod, 'images', 'tilesets', 'tileset_grassland.png')));
const defs = new Map<number, number[]>();
for (const l of readFileSync(join(mod, 'tilesetdefs', 'tileset_grassland.txt'), 'utf8').split(/\r?\n/)) {
    if (l.startsWith('tile=')) { const v = l.trim().slice(5).split(',').map(Number); defs.set(v[0], v.slice(1)); }
}
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
const ids = [...range(16, 48), 72, 73, 76, 77, 96, 97, 98, 99, 100, 101, 102, 103, 104, 107, ...range(112, 144), ...range(240, 256), 264, 265, 296];
const items = ids.map((id) => { const [x, y, w, h, ox, oy] = defs.get(id)!; return { id, x, y, w, h, sw: Math.max(1, Math.round(w * S)), sh: Math.max(1, Math.round(h * S)), ox: ox * S, oy: oy * S }; })
    .sort((a, b) => b.sh - a.sh);
const W = 2048;
let X = 0, Y = 0, rowH = 0;
const pos: Record<string, number[]> = {};
for (const it of items) {
    if (X + it.sw > W) { X = 0; Y += rowH + 2; rowH = 0; }
    pos[it.id] = [X, Y, it.sw, it.sh, it.ox, it.oy];
    X += it.sw + 2; rowH = Math.max(rowH, it.sh);
}
const world = createCanvas(W, Y + rowH), wctx = world.getContext('2d');
wctx.imageSmoothingQuality = 'high';
for (const it of items) { const [px, py] = pos[it.id]; wctx.drawImage(ts, it.x, it.y, it.w, it.h, px, py, it.sw, it.sh); }
writeFileSync(join(out, 'world.webp'), world.toBuffer('image/webp', 86));
meta.world = pos;
writeFileSync(metaFile, JSON.stringify(meta));
console.log(`Atlas de Flare listos en apps/client/public/assets (${Object.keys(meta).length - 1} personajes + mundo).`);
