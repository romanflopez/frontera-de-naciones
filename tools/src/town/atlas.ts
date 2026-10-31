/**
 * Arma el kit de ciudad a partir de los packs CC0 de Screaming Brain Studios (Overworld Pack Large, Wall Pack Large y Object Pack):
 *   town.webp            pisos del Overworld (agua, tierra, arena, pasto, bosque), paredes de dos pisos y bajas, pilares, muretes,
 *                        escaleras, cajas, espuma de la orilla y algunos objetos dibujados acá (farol, bote, bandera, bolardo).
 *   sm_*.webp            fachadas de los edificios de Solmar (packages/world/src/town.ts: TOWN_BUILDINGS), compuestas con las
 *                        paredes planas del Wall Pack, terraza con pretil (Copings), puerta, cartel y toldo dibujados por código.
 *   vh_*.webp            fachadas de la Ciudadela de Vhar (piedra y ladrillo oscuros, puertas de hierro).
 *   Pisos de Vhar (3090..3107): ceniza y roca con filtros sobre el Overworld Pack, y adoquín negro, placas de hierro y lava dibujados por código.
 *   meta.json            suma las claves "town" (posiciones) y los edificios en "buildings" sin tocar lo demás.
 * Las fuentes van a escala "Large" (rombo de 256x128) y se reescalan a la grilla del juego (96x48: factor 0,375); los objetos del
 * Object Pack están a escala "Small" (rombo de 128x64) y van a 0,75. El magenta (#ff00ff) y el negro puro de las hojas son transparencia.
 * Los ids salen de packages/world/src/town.ts (única fuente de verdad).
 *
 * Uso: pnpm assets:town <carpeta con los packs de SBS descomprimidos>   (o SBS_DIR=<carpeta> pnpm assets:town)
 *      Con PREVIEW=<archivo.png> además deja una lámina de control con todas las piezas.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
    COPINGS, CRATE_BASE, FURNITURE_SCALE, KENNEY_FURNITURE, townFurniture, FOAM_BASE, STAIR_MATS, TOWN_BUILDINGS, TOWN_PROPS, TOWN_SHEETS, WALL_STYLES,
    townCoping, townPillar, townStairs, townTile, townWall, townWallLow, vharTile, wallShade, type TownBuilding, type TownUpper, type WallStyle, type WallVariant,
} from '../../../packages/world/src/town.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'apps', 'client', 'public', 'assets');
const src = resolve(process.argv[2] ?? process.env.SBS_DIR ?? '');
if (!src || !existsSync(src)) { console.error('Uso: pnpm assets:town <carpeta con los packs SBS> (o SBS_DIR=...)'); process.exit(1); }

/** Busca un archivo por nombre en toda la carpeta de origen (los packs tienen carpetas anidadas con nombres largos). */
const index = new Map<string, string>();
(function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else index.set(e.name, p); } })(src);
const file = (name: string) => { const p = index.get(name); if (!p) { console.error(`Falta ${name} en ${src}`); process.exit(1); } return p; };

const S = 0.375; // Large (256x128) -> 96x48
const SO = 0.75; // Small (128x64) -> 96x48
type Key = 'magenta' | 'black';
const sheetCache = new Map<string, Canvas>();
/** Hoja con la clave de color pasada a alfa. */
async function sheet(name: string, key: Key): Promise<Canvas> {
    const k = `${name}|${key}`; const hit = sheetCache.get(k); if (hit) return hit;
    const im = await loadImage(readFileSync(file(name)));
    const c = createCanvas(im.width, im.height), g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
        const mag = a[i] > 230 && a[i + 1] < 40 && a[i + 2] > 230, blk = a[i] + a[i + 1] + a[i + 2] <= 3;
        if (key === 'magenta' ? mag : blk || mag) a[i + 3] = 0;
    }
    g.putImageData(d, 0, 0);
    sheetCache.set(k, c); return c;
}
/** Recorte de una celda en un canvas nuevo (napi-rs/canvas no copia al dibujar un canvas sobre otro: siempre uno nuevo). */
function cell(sh: Canvas, x: number, y: number, w: number, h: number): Canvas {
    const c = createCanvas(w, h); c.getContext('2d').drawImage(sh, x, y, w, h, 0, 0, w, h); return c;
}
function shade(c: Canvas, k: number): Canvas {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) { a[i] = Math.min(255, a[i] * k); a[i + 1] = Math.min(255, a[i + 1] * k); a[i + 2] = Math.min(255, a[i + 2] * k); }
    g.putImageData(d, 0, 0); return c;
}
function alphaBox(c: Canvas): { x0: number; y0: number; x1: number; y1: number } | null {
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (a[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// ---------- piezas: imagen a escala final + ancla (centro de la celda en el juego) ----------
interface Piece { id: number; im: Canvas; ox: number; oy: number }
const pieces: Piece[] = [];
/** Recorta `c` a su contenido, la escala por `k` y registra la pieza con el ancla (ax, ay) dada en coordenadas de `c`. */
function addPiece(id: number, c: Canvas, ax: number, ay: number, k: number) {
    const b = alphaBox(c); if (!b) throw new Error(`pieza ${id} vacía`);
    const sw = b.x1 - b.x0 + 1, sh = b.y1 - b.y0 + 1, w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const o = createCanvas(w, h), g = o.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(c, b.x0, b.y0, sw, sh, 0, 0, w, h);
    pieces.push({ id, im: o, ox: Math.round((ax - b.x0) * k * 10) / 10, oy: Math.round((ay - b.y0) * k * 10) / 10 });
}

// 1) pisos del Overworld: rombos de 256x128 en grillas de 3x6, recortados al rombo (las hojas tienen fondo negro o magenta)
const SHEET_FILES: Record<(typeof TOWN_SHEETS)[number], string> = {
    water: 'Overworld - Water - Flat 256x128.png', terrain1: 'Overworld - Terrain 1 - Flat 256x128.png', terrain2: 'Overworld - Terrain 2 - Flat 256x128.png',
    terrain3: 'Overworld - Terrain 3 - Flat 256x128.png', forest: 'Overworld - Forest - Flat 256x128.png',
};
const FLOOR_W = 100, FLOOR_H = 50; // igual que terrain.webp: un poco más grande que la celda para que no queden costuras
const floorTiles = new Map<number, Canvas>(); // a escala Large, para las terrazas de los edificios
function diamondMask(c: Canvas) {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), a = d.data, w = c.width, h = c.height;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = Math.abs(x + 0.5 - w / 2) / (w / 2) + Math.abs(y + 0.5 - h / 2) / (h / 2);
        const i = (y * w + x) * 4; if (t > 1) a[i + 3] = 0; else if (t > 1 - 1.5 / (h / 2)) a[i + 3] = Math.min(a[i + 3], Math.round(255 * (1 - t) / (1.5 / (h / 2))));
    }
    g.putImageData(d, 0, 0);
}
for (const s of TOWN_SHEETS) {
    const sh = await sheet(SHEET_FILES[s], 'magenta');
    for (let c = 0; c < 18; c++) {
        const t = cell(sh, (c % 3) * 256, Math.floor(c / 3) * 128, 256, 128);
        diamondMask(t); floorTiles.set(townTile(s, c), t);
        const o = createCanvas(FLOOR_W, FLOOR_H), g = o.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(t, 0, 0, 256, 128, 0, 0, FLOOR_W, FLOOR_H);
        pieces.push({ id: townTile(s, c), im: o, ox: FLOOR_W / 2, oy: FLOOR_H / 2 });
    }
}

// 1b) pisos de la Ciudadela de Vhar: ceniza y roca (filtros sobre el Overworld Pack) y adoquín, placas, runa, lava y ladrillo dibujados por código
const mulberry = (seed0: number) => () => { seed0 |= 0; seed0 = (seed0 + 0x6d2b79f5) | 0; let t = Math.imul(seed0 ^ (seed0 >>> 15), 1 | seed0); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** Ruido de valores periódico (el tile entero es un período: los vecinos del mismo tipo empalman) con `cells` celdas por lado. */
function pnoise(seed: number, cells: number) {
    const r = mulberry(seed), lat = Array.from({ length: cells * cells }, () => r());
    const at = (i: number, j: number) => lat[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    return (u: number, v: number) => { // u, v en [0, 1)
        const x = u * cells, y = v * cells, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
    };
}
const UV = 160;
/** Textura cuadrada (UV x UV) -> rombo de 256x128 del piso del Overworld. */
function uvToDiamond(uv: Canvas): Canvas {
    const c = createCanvas(256, 128), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const k = 128 / UV; g.setTransform(k, k / 2, -k, k / 2, 128, 0); g.drawImage(uv, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    diamondMask(c); return c;
}
function tintCanvas(src: Canvas, k: number, rgb: [number, number, number], flip = false): Canvas {
    const c = createCanvas(src.width, src.height), g = c.getContext('2d');
    if (flip) { g.translate(src.width, 0); g.scale(-1, 1); }
    g.drawImage(src, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) { a[i] = Math.min(255, a[i] * k * rgb[0]); a[i + 1] = Math.min(255, a[i + 1] * k * rgb[1]); a[i + 2] = Math.min(255, a[i + 2] * k * rgb[2]); }
    g.putImageData(d, 0, 0); return c;
}
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function pixelUV(fn: (u: number, v: number) => number[]): Canvas {
    const c = createCanvas(UV, UV), g = c.getContext('2d'), d = g.getImageData(0, 0, UV, UV), a = d.data;
    for (let y = 0; y < UV; y++) for (let x = 0; x < UV; x++) { const col = fn(x / UV, y / UV), i = (y * UV + x) * 4; a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = 255; }
    g.putImageData(d, 0, 0); return c;
}
function lavaTile(seed: number, hot: number): Canvas {
    const n1 = pnoise(seed, 4), n2 = pnoise(seed + 1, 8), n3 = pnoise(seed + 2, 16), nm = pnoise(seed + 3, 5);
    return pixelUV((u, v) => {
        const f = n1(u, v) * 0.55 + n2(u, v) * 0.3 + n3(u, v) * 0.15, crust = sstep(hot - 0.06, hot + 0.06, f), edge = Math.exp(-(((f - hot) / 0.045) ** 2));
        const lava = mix([226, 88, 22], [255, 196, 70], sstep(0.35, 0.8, nm(u, v) * 0.6 + n3(u, v) * 0.5));
        const dark = mix([34, 20, 20], [66, 38, 30], n3(u, v));
        const base = mix(lava, dark, crust);
        return mix(base, [255, 214, 110], edge * 0.8 * (1 - crust * 0.3));
    });
}
function cobbleTile(seed: number): Canvas {
    const r = mulberry(seed), c = createCanvas(UV, UV), g = c.getContext('2d'), nz = pnoise(seed + 9, 12);
    g.fillStyle = '#121114'; g.fillRect(0, 0, UV, UV);
    let y = 0;
    while (y < UV) {
        const h = 22 + Math.floor(r() * 12); let x = -Math.floor(r() * 30);
        while (x < UV) {
            const w = 30 + Math.floor(r() * 24), t = r(), base = 52 + Math.floor(t * 22), warm = r() < 0.12 ? 8 : 0;
            const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, `rgb(${base + 8 + warm},${base + 6},${base + 12})`); gr.addColorStop(1, `rgb(${base - 12 + warm},${base - 14},${base - 6})`);
            g.fillStyle = gr; g.beginPath(); g.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 4); g.fill();
            g.strokeStyle = 'rgba(150,146,158,.30)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + 3, y + h - 3); g.lineTo(x + 3, y + 3); g.lineTo(x + w - 3, y + 3); g.stroke();
            x += w;
        }
        y += h;
    }
    const d = g.getImageData(0, 0, UV, UV), a = d.data;
    for (let j = 0; j < UV; j++) for (let i = 0; i < UV; i++) { const q = 0.82 + nz(i / UV, j / UV) * 0.36, k = (j * UV + i) * 4; a[k] *= q; a[k + 1] *= q; a[k + 2] *= q; }
    g.putImageData(d, 0, 0); return c;
}
function plateTile(seed: number, rust: boolean): Canvas {
    const r = mulberry(seed), c = createCanvas(UV, UV), g = c.getContext('2d'), nz = pnoise(seed + 5, 10), nr = pnoise(seed + 6, 6);
    const P = 80;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const x = i * P, y = j * P, gr = g.createLinearGradient(x, y, x + P, y + P); gr.addColorStop(0, '#4a4c54'); gr.addColorStop(1, '#34363d');
        g.fillStyle = gr; g.fillRect(x + 2, y + 2, P - 4, P - 4);
        g.strokeStyle = 'rgba(160,164,176,.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 3, y + P - 3); g.lineTo(x + 3, y + 3); g.lineTo(x + P - 3, y + 3); g.stroke();
        for (const [rx, ry] of [[9, 9], [P - 9, 9], [9, P - 9], [P - 9, P - 9]]) { g.fillStyle = 'rgba(10,10,12,.55)'; g.beginPath(); g.arc(x + rx + 1, y + ry + 1.5, 3.2, 0, 6.3); g.fill(); g.fillStyle = '#7c808b'; g.beginPath(); g.arc(x + rx, y + ry, 2.8, 0, 6.3); g.fill(); }
    }
    g.fillStyle = '#16171a'; g.fillRect(P - 2, 0, 4, UV); g.fillRect(0, P - 2, UV, 4); g.fillRect(0, 0, 2, UV); g.fillRect(0, 0, UV, 2);
    const d = g.getImageData(0, 0, UV, UV), a = d.data;
    for (let j = 0; j < UV; j++) for (let i = 0; i < UV; i++) {
        const k = (j * UV + i) * 4, q = 0.86 + nz(i / UV, j / UV) * 0.28 + (r() - 0.5) * 0.06, rs = rust ? sstep(0.55, 0.75, nr(i / UV, j / UV)) : 0;
        a[k] = (a[k] * (1 - rs) + 120 * rs) * q; a[k + 1] = (a[k + 1] * (1 - rs) + 66 * rs) * q; a[k + 2] = (a[k + 2] * (1 - rs) + 40 * rs) * q;
    }
    g.putImageData(d, 0, 0); return c;
}
function runeTile(seed: number): Canvas {
    const c = plateTile(seed, false), g = c.getContext('2d'), mid = UV / 2;
    g.fillStyle = 'rgba(14,10,10,.55)'; g.beginPath(); g.arc(mid, mid, 58, 0, 6.3); g.fill();
    g.save(); g.shadowColor = '#ff7a1a'; g.shadowBlur = 14; g.strokeStyle = '#ff9a3a'; g.lineWidth = 4;
    g.beginPath(); g.arc(mid, mid, 52, 0, 6.3); g.stroke(); g.lineWidth = 2.5; g.beginPath(); g.arc(mid, mid, 34, 0, 6.3); g.stroke();
    g.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.moveTo(mid + Math.cos(a) * 34, mid + Math.sin(a) * 34); g.lineTo(mid + Math.cos(a) * 52, mid + Math.sin(a) * 52); } g.stroke();
    g.beginPath(); g.moveTo(mid, mid - 22); g.lineTo(mid + 19, mid + 11); g.lineTo(mid - 19, mid + 11); g.closePath(); g.stroke(); g.restore();
    return c;
}
function brickTile(seed: number): Canvas {
    const r = mulberry(seed), c = createCanvas(UV, UV), g = c.getContext('2d'), nz = pnoise(seed + 4, 14);
    g.fillStyle = '#1e1214'; g.fillRect(0, 0, UV, UV);
    for (let j = 0; j < 8; j++) for (let i = -1; i < 4; i++) {
        const x = i * 40 + (j % 2 ? 20 : 0), y = j * 20, t = r();
        g.fillStyle = `rgb(${86 + Math.floor(t * 34)},${40 + Math.floor(t * 14)},${34 + Math.floor(t * 10)})`; g.fillRect(x + 1.5, y + 1.5, 37, 17);
        g.fillStyle = 'rgba(200,120,90,.18)'; g.fillRect(x + 1.5, y + 1.5, 37, 2);
    }
    const d = g.getImageData(0, 0, UV, UV), a = d.data;
    for (let j = 0; j < UV; j++) for (let i = 0; i < UV; i++) { const q = 0.8 + nz(i / UV, j / UV) * 0.4, k = (j * UV + i) * 4; a[k] *= q; a[k + 1] *= q; a[k + 2] *= q; }
    g.putImageData(d, 0, 0); return c;
}
function speckle(c: Canvas, seed: number, embers: number): Canvas {
    const r = mulberry(seed), g = c.getContext('2d');
    for (let i = 0; i < 90; i++) { g.fillStyle = r() < 0.5 ? 'rgba(12,12,14,.35)' : 'rgba(170,166,170,.22)'; g.fillRect(Math.floor(r() * 256), Math.floor(r() * 128), 1 + Math.floor(r() * 3), 1); }
    for (let i = 0; i < embers; i++) { const x = 40 + r() * 176, y = 20 + r() * 88; g.fillStyle = `rgba(255,${120 + Math.floor(r() * 70)},40,${(0.5 + r() * 0.4).toFixed(2)})`; g.fillRect(Math.round(x), Math.round(y), 2, 1); }
    return c;
}
{
    const t3 = await sheet(SHEET_FILES.terrain3, 'magenta'), t1 = await sheet(SHEET_FILES.terrain1, 'magenta');
    const src = (sh: Canvas, c: number) => cell(sh, (c % 3) * 256, Math.floor(c / 3) * 128, 256, 128);
    const cells: Canvas[] = [
        // 0-2 ceniza
        speckle(tintCanvas(src(t3, 16), 0.78, [1.04, 1, 1]), 11, 0), speckle(tintCanvas(src(t3, 16), 0.7, [1.06, 1, 0.98], true), 12, 3), speckle(tintCanvas(src(t3, 16), 0.62, [1.1, 1, 0.96]), 13, 6),
        // 3-5 roca volcánica
        tintCanvas(src(t1, 14), 0.52, [1.02, 0.96, 1]), tintCanvas(src(t3, 11), 0.5, [1.1, 0.98, 0.94]), tintCanvas(src(t1, 17), 0.42, [1.16, 0.92, 0.88]),
        // 6-8 adoquín negro, 9-10 placas, 11 runa
        uvToDiamond(cobbleTile(21)), uvToDiamond(cobbleTile(22)), uvToDiamond(cobbleTile(23)),
        uvToDiamond(plateTile(31, false)), uvToDiamond(plateTile(32, true)), uvToDiamond(runeTile(33)),
        // 12-14 lava, 15-16 costra
        uvToDiamond(lavaTile(41, 0.62)), uvToDiamond(lavaTile(41, 0.58)), uvToDiamond(lavaTile(41, 0.66)),
        uvToDiamond(lavaTile(51, 0.4)), uvToDiamond(lavaTile(52, 0.34)),
        // 17 ladrillo oscuro
        uvToDiamond(brickTile(61)),
    ];
    cells.forEach((t, i) => {
        if (i < 6) diamondMask(t);
        const id = vharTile(i); floorTiles.set(id, t);
        const o = createCanvas(FLOOR_W, FLOOR_H), g = o.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(t, 0, 0, 256, 128, 0, 0, FLOOR_W, FLOOR_H);
        pieces.push({ id, im: o, ox: FLOOR_W / 2, oy: FLOOR_H / 2 });
    });
}

// 2) paredes: abajo la pieza plana (128x192, cara de 128 de alto) y arriba la gruesa (144x200, con remate)
const VARIANT_SUFFIX: Record<WallVariant, string> = { liso: '', ventana: '_WindowA', ventana2: '_WindowB' };
/** Oscurece la pieza si el estilo lo pide (los de Vhar). */
const styled = (c: Canvas, id: WallStyle) => { const k = wallShade(id); return k === 1 ? c : shade(c, k); };
const flatPiece = async (st: { id: WallStyle; mat: string; color: number }, v: WallVariant, ori: '/' | '\\') =>
    styled(cell(await sheet(`Flat_${st.mat}_01${VARIANT_SUFFIX[v]}-SE-128x192.png`, 'magenta'), (2 * (st.color % 3) + (ori === '/' ? 0 : 1)) * 128, Math.floor(st.color / 3) * 192, 128, 192), st.id);
const thickPiece = async (st: { id: WallStyle; mat: string; color: number }, v: WallVariant, ori: '/' | '\\') =>
    styled(cell(await sheet(`Thick_${st.mat}_01${VARIANT_SUFFIX[v]}-SE-144x200.png`, 'magenta'), (2 * (st.color % 3) + (ori === '/' ? 0 : 1)) * 144, Math.floor(st.color / 3) * 200, 144, 200), st.id);
const pillarPiece = async (st: { id: WallStyle; mat: string; color: number }) => styled(cell(await sheet(`Corner_${st.mat}_01-SE-160x200.png`, 'magenta'), (st.color % 6) * 160, Math.floor(st.color / 6) * 200, 160, 200), st.id);
for (const st of WALL_STYLES) {
    for (const v of ['liso', 'ventana', 'ventana2'] as WallVariant[]) for (const ori of ['/', '\\'] as const) {
        // lienzo de trabajo: la plana en (16, 160); la gruesa encima, con su cara alineada a la de la plana
        const c = createCanvas(176, 360), g = c.getContext('2d');
        const up = await thickPiece(st, 'liso', ori), low = await flatPiece(st, v, ori);
        if (ori === '/') g.drawImage(up, 16 - 16, 160 - 136); else g.drawImage(up, 16, 160 - 136);
        g.drawImage(low, 16, 160);
        // ancla: esquina norte de la celda = extremo de arriba del lado; el centro de la celda está 64 px (Large) más abajo
        const ax = ori === '/' ? 16 + 128 : 16, ay = 160 + 128 + 64;
        addPiece(townWall(st.id, v, ori), c, ax, ay, S);
    }
    for (const ori of ['/', '\\'] as const) {
        const t = await thickPiece(st, 'liso', ori);
        addPiece(townWallLow(st.id, ori), t, ori === '/' ? 144 : 0, 136 + 64, S);
    }
    { // pilar de dos pisos centrado en la esquina norte de la celda
        const p = await pillarPiece(st), c = createCanvas(160, 340), g = c.getContext('2d');
        g.drawImage(p, 0, 12); g.drawImage(p, 0, 140);
        addPiece(townPillar(st.id), c, 80, 140 + 160 + 64, S);
    }
}

// 3) muretes y barandas (Copings, escala Large: cada pieza cubre un lado de 128 px)
const COPING_CELLS: Record<(typeof COPINGS)[number], [number, number]> = { cornisa: [0, 0], muro: [2, 0], murete: [0, 2], baranda: [4, 2], balaustrada: [0, 4] };
{
    const sh = await sheet('Copings - Stone 1 128x128.png', 'black');
    for (const cp of COPINGS) for (const ori of ['/', '\\'] as const) {
        const [cx, cy] = COPING_CELLS[cp], col = cx + (ori === '/' ? 0 : 1);
        const c = cell(sh, col * 128, cy * 128, 128, 128);
        addPiece(townCoping(cp, ori), c, ori === '/' ? 128 : 0, 64 + 64, S);
    }
}

// 4) escaleras y cajas (Object Pack, escala Small: el rombo de piso de la celda tiene el centro en (64, 96))
for (const [mi, m] of STAIR_MATS.entries()) {
    const name = ['Stone A - Stairs 128x128.png', 'Brick A - Stairs 128x128.png', 'Wood A - Stairs 128x128.png'][mi];
    const sh = await sheet(name, 'black');
    for (const ori of ['/', '\\'] as const) addPiece(townStairs(m, ori), cell(sh, (ori === '/' ? 0 : 1) * 128, 0, 128, 128), 64, 96, SO);
}
{
    const wood = await sheet('Crates - Wood 128x128.png', 'black'), metal = await sheet('Crates - Metal 128x128.png', 'black');
    const CK = 0.55; // las cajas a 0,75 quedaban del tamaño de un ropero
    for (let i = 0; i < 12; i++) addPiece(CRATE_BASE + i, cell(wood, (i % 3) * 2 * 128, Math.floor(i / 3) * 128, 128, 128), 64, 96, CK);
    for (let i = 0; i < 6; i++) addPiece(CRATE_BASE + 12 + i, cell(metal, (i % 3) * 2 * 128, Math.floor(i / 3) * 128, 128, 128), 64, 96, CK);
}

// 5) espuma de la orilla: un decal por lado del rombo (a la escala final)
{
    const sides: [number, number, number, number][] = [[50, 0, 100, 25], [100, 25, 50, 50], [50, 50, 0, 25], [0, 25, 50, 0]]; // ne, se, sw, nw
    sides.forEach(([x0, y0, x1, y1], i) => {
        const c = createCanvas(FLOOR_W, FLOOR_H), g = c.getContext('2d');
        g.beginPath(); g.moveTo(50, 0); g.lineTo(100, 25); g.lineTo(50, 50); g.lineTo(0, 25); g.closePath(); g.clip();
        // hacia adentro del rombo: el centro
        const nx = 50 - (x0 + x1) / 2, ny = 25 - (y0 + y1) / 2, nl = Math.hypot(nx, ny), ux = nx / nl, uy = ny / nl;
        for (let k = 0; k < 7; k++) {
            const off = k * 1.6, a = 0.55 * (1 - k / 7);
            g.strokeStyle = `rgba(235,248,255,${a.toFixed(3)})`; g.lineWidth = 2.2;
            g.beginPath();
            for (let s = 0; s <= 20; s++) {
                const t = s / 20, wob = Math.sin(t * Math.PI * 3 + i * 1.7 + k) * 1.1;
                const px = x0 + (x1 - x0) * t + ux * (off + wob), py = y0 + (y1 - y0) * t + uy * (off + wob);
                if (s) g.lineTo(px, py); else g.moveTo(px, py);
            }
            g.stroke();
        }
        pieces.push({ id: FOAM_BASE + i, im: c, ox: 50, oy: 25 });
    });
}

// 6) objetos dibujados acá (sin arte de terceros), ya a escala final; ancla = centro de la celda
function drawn(id: number, w: number, h: number, ax: number, ay: number, fn: (g: SKRSContext2D) => void) {
    const c = createCanvas(w, h), g = c.getContext('2d'); fn(g); pieces.push({ id, im: c, ox: ax, oy: ay });
}
drawn(TOWN_PROPS.farol, 40, 120, 20, 112, (g) => { // farol de hierro con vidrio encendido
    const glow = g.createRadialGradient(20, 26, 2, 20, 26, 20); glow.addColorStop(0, 'rgba(255,214,120,.75)'); glow.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = glow; g.fillRect(0, 4, 40, 44);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(20, 112, 9, 4.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2a2c'; g.fillRect(14, 104, 12, 8); g.fillRect(16, 100, 8, 5);
    const pole = g.createLinearGradient(17, 0, 23, 0); pole.addColorStop(0, '#1c1b1e'); pole.addColorStop(0.5, '#56545a'); pole.addColorStop(1, '#1c1b1e');
    g.fillStyle = pole; g.fillRect(18, 34, 4, 68);
    g.fillStyle = '#2b2a2c'; g.beginPath(); g.moveTo(11, 18); g.lineTo(29, 18); g.lineTo(26, 12); g.lineTo(14, 12); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(20, 4); g.lineTo(26, 12); g.lineTo(14, 12); g.closePath(); g.fill();
    const glass = g.createLinearGradient(0, 18, 0, 34); glass.addColorStop(0, '#fff2c0'); glass.addColorStop(1, '#ffb347');
    g.fillStyle = glass; g.fillRect(13, 18, 14, 15);
    g.strokeStyle = '#2b2a2c'; g.lineWidth = 1.5; g.strokeRect(13, 18, 14, 15); g.beginPath(); g.moveTo(20, 18); g.lineTo(20, 33); g.stroke();
    g.fillStyle = '#2b2a2c'; g.fillRect(12, 33, 16, 3);
});
function boat(g: SKRSContext2D, hull: string, w = 1) { // bote de remos visto en isométrico (eje a lo largo de x de la grilla: hacia abajo a la derecha)
    g.save(); g.translate(60, 40); g.scale(w, w);
    g.fillStyle = 'rgba(10,30,45,.35)'; g.beginPath(); g.ellipse(0, 8, 52, 20, 0.46, 0, Math.PI * 2); g.fill();
    g.fillStyle = hull; g.beginPath(); g.moveTo(-48, -22); g.quadraticCurveTo(-20, -30, 44, 10); g.quadraticCurveTo(52, 20, 40, 24); g.quadraticCurveTo(-30, 0, -50, -14); g.closePath(); g.fill();
    g.fillStyle = '#6b4a2b'; g.beginPath(); g.moveTo(-44, -20); g.quadraticCurveTo(-18, -26, 40, 10); g.quadraticCurveTo(-24, -4, -44, -14); g.closePath(); g.fill();
    g.strokeStyle = '#3a2614'; g.lineWidth = 2; g.beginPath(); g.moveTo(-48, -22); g.quadraticCurveTo(-20, -30, 44, 10); g.stroke();
    g.fillStyle = '#9a7246'; for (const t of [-20, 6]) { g.beginPath(); g.moveTo(t - 6, -16 + t * 0.48); g.lineTo(t + 10, -22 + t * 0.48 + 10); g.lineTo(t + 14, -18 + t * 0.48 + 10); g.lineTo(t - 2, -12 + t * 0.48); g.closePath(); g.fill(); }
    g.restore();
}
drawn(TOWN_PROPS.bote, 120, 80, 60, 42, (g) => boat(g, '#b5462f'));
drawn(TOWN_PROPS.bote2, 120, 80, 60, 42, (g) => boat(g, '#2f6fa0'));
drawn(TOWN_PROPS.bandera, 60, 140, 20, 132, (g) => { // mástil con la bandera de Solmar (sol dorado sobre azul)
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(20, 132, 8, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#bfb6a4'; g.fillRect(18, 6, 4, 126); g.fillStyle = '#e2c25a'; g.beginPath(); g.arc(20, 6, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2d5f9a'; g.beginPath(); g.moveTo(22, 12); g.quadraticCurveTo(40, 8, 56, 14); g.lineTo(56, 44); g.quadraticCurveTo(40, 38, 22, 42); g.closePath(); g.fill();
    g.fillStyle = '#f0c64a'; g.beginPath(); g.arc(38, 27, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f0c64a'; g.lineWidth = 1.6; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(38 + Math.cos(a) * 8, 27 + Math.sin(a) * 8); g.lineTo(38 + Math.cos(a) * 11, 27 + Math.sin(a) * 11); g.stroke(); }
});
drawn(TOWN_PROPS.poste, 24, 34, 12, 28, (g) => { // bolardo de amarre
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(12, 28, 8, 4, 0, 0, Math.PI * 2); g.fill();
    const b = g.createLinearGradient(5, 0, 19, 0); b.addColorStop(0, '#2a2622'); b.addColorStop(0.5, '#5b544c'); b.addColorStop(1, '#2a2622');
    g.fillStyle = b; g.fillRect(6, 10, 12, 18); g.beginPath(); g.ellipse(12, 10, 6, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a342e'; g.beginPath(); g.ellipse(12, 8, 8, 4, 0, 0, Math.PI * 2); g.fill();
});
drawn(TOWN_PROPS.alfombra, 100, 50, 50, 25, (g) => { // alfombra roja con borde dorado
    g.beginPath(); g.moveTo(50, 3); g.lineTo(96, 25); g.lineTo(50, 47); g.lineTo(4, 25); g.closePath(); g.fillStyle = '#8a2430'; g.fill();
    g.strokeStyle = '#d9b354'; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.moveTo(50, 9); g.lineTo(84, 25); g.lineTo(50, 41); g.lineTo(16, 25); g.closePath(); g.strokeStyle = 'rgba(217,179,84,.7)'; g.lineWidth = 1; g.stroke();
});


// 6b) objetos de la Ciudadela de Vhar (dibujados acá): braseros, estandartes, forja, yunque, rocas volcánicas, obsidiana, lingotes, monolito, pinchos
/** Caja isométrica: huella de semiancho `a` (rombo 2a x a) centrada en (cx, cy) a nivel del piso, de alto h. */
function isoBox(g: SKRSContext2D, cx: number, cy: number, a: number, h: number, top: string, left: string, right: string) {
    const b = a / 2;
    g.fillStyle = left; g.beginPath(); g.moveTo(cx - a, cy); g.lineTo(cx, cy + b); g.lineTo(cx, cy + b - h); g.lineTo(cx - a, cy - h); g.closePath(); g.fill();
    g.fillStyle = right; g.beginPath(); g.moveTo(cx, cy + b); g.lineTo(cx + a, cy); g.lineTo(cx + a, cy - h); g.lineTo(cx, cy + b - h); g.closePath(); g.fill();
    g.fillStyle = top; g.beginPath(); g.moveTo(cx, cy - b - h); g.lineTo(cx + a, cy - h); g.lineTo(cx, cy + b - h); g.lineTo(cx - a, cy - h); g.closePath(); g.fill();
}
function flame(g: SKRSContext2D, x: number, y: number, s: number) {
    const glow = g.createRadialGradient(x, y - 14 * s, 2, x, y - 14 * s, 30 * s); glow.addColorStop(0, 'rgba(255,170,60,.55)'); glow.addColorStop(1, 'rgba(255,110,20,0)');
    g.fillStyle = glow; g.fillRect(x - 32 * s, y - 46 * s, 64 * s, 64 * s);
    const tongue = (w: number, h: number, c0: string, c1: string, dx = 0) => {
        const gr = g.createLinearGradient(0, y, 0, y - h); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr;
        g.beginPath(); g.moveTo(x + dx - w, y); g.quadraticCurveTo(x + dx - w * 1.1, y - h * 0.5, x + dx - w * 0.1, y - h); g.quadraticCurveTo(x + dx + w * 0.9, y - h * 0.45, x + dx + w, y); g.closePath(); g.fill();
    };
    tongue(9 * s, 30 * s, '#d9420f', '#ff8a1c', -4 * s); tongue(8 * s, 36 * s, '#e8601a', '#ffb02e', 4 * s); tongue(5 * s, 22 * s, '#ffb02e', '#fff0a0');
}
drawn(TOWN_PROPS.brasero, 64, 100, 32, 92, (g) => { // brasero de hierro sobre trípode, con llamas
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(32, 92, 18, 8, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b1a1d'; g.lineWidth = 4; g.lineCap = 'round';
    for (const dx of [-14, 0, 14]) { g.beginPath(); g.moveTo(32 + dx * 0.4, 60); g.lineTo(32 + dx, 90 - Math.abs(dx) * 0.1); g.stroke(); }
    g.strokeStyle = '#3c3a40'; g.lineWidth = 1.2; for (const dx of [-14, 14]) { g.beginPath(); g.moveTo(32 + dx * 0.4 - 1, 61); g.lineTo(32 + dx - 1, 89); g.stroke(); }
    const bowl = g.createLinearGradient(14, 0, 50, 0); bowl.addColorStop(0, '#2a292d'); bowl.addColorStop(0.5, '#58565d'); bowl.addColorStop(1, '#222124');
    g.fillStyle = bowl; g.beginPath(); g.moveTo(12, 52); g.quadraticCurveTo(32, 74, 52, 52); g.lineTo(52, 50); g.lineTo(12, 50); g.closePath(); g.fill();
    g.fillStyle = '#3f3d44'; g.beginPath(); g.ellipse(32, 50, 20, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff7a1c'; g.beginPath(); g.ellipse(32, 50, 16, 4.5, 0, 0, Math.PI * 2); g.fill();
    flame(g, 32, 50, 1.05);
});
drawn(TOWN_PROPS.estandarte, 64, 160, 32, 152, (g) => { // estandarte de Vhar: paño negro con yunque y brasa sobre travesaño de hierro
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(32, 152, 10, 4.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#26252a'; g.fillRect(29, 10, 6, 142); g.fillStyle = '#4a484f'; g.fillRect(29, 10, 2, 142);
    g.fillStyle = '#1c1b1f'; g.fillRect(8, 12, 48, 5); g.fillStyle = '#c86a2a'; g.beginPath(); g.arc(8, 14, 4, 0, 6.3); g.arc(56, 14, 4, 0, 6.3); g.fill();
    g.fillStyle = '#c86a2a'; g.beginPath(); g.arc(32, 8, 5, 0, 6.3); g.fill();
    const cloth = g.createLinearGradient(14, 0, 50, 0); cloth.addColorStop(0, '#16141a'); cloth.addColorStop(0.5, '#25222b'); cloth.addColorStop(1, '#131217');
    g.fillStyle = cloth; g.beginPath(); g.moveTo(14, 17); g.lineTo(50, 17); g.lineTo(50, 92); g.lineTo(32, 80); g.lineTo(14, 92); g.closePath(); g.fill();
    g.strokeStyle = '#9a2a1c'; g.lineWidth = 3; g.beginPath(); g.moveTo(17, 20); g.lineTo(47, 20); g.lineTo(47, 86); g.lineTo(32, 76); g.lineTo(17, 86); g.closePath(); g.stroke();
    // yunque dorado con una llama encima
    g.fillStyle = '#e0a63a'; g.beginPath(); g.moveTo(21, 56); g.lineTo(43, 56); g.lineTo(39, 62); g.lineTo(36, 62); g.lineTo(37, 66); g.lineTo(42, 70); g.lineTo(22, 70); g.lineTo(27, 66); g.lineTo(28, 62); g.lineTo(25, 62); g.closePath(); g.fill();
    g.fillStyle = '#c4452a'; g.beginPath(); g.moveTo(32, 30); g.quadraticCurveTo(40, 40, 36, 50); g.quadraticCurveTo(32, 46, 28, 50); g.quadraticCurveTo(25, 40, 32, 30); g.closePath(); g.fill();
    g.fillStyle = '#ffb02e'; g.beginPath(); g.moveTo(32, 38); g.quadraticCurveTo(36, 44, 34, 50); g.quadraticCurveTo(30, 47, 29, 50); g.quadraticCurveTo(28, 44, 32, 38); g.closePath(); g.fill();
});
drawn(TOWN_PROPS.forja, 100, 130, 50, 96, (g) => { // horno de piedra con boca encendida y chimenea
    g.fillStyle = 'rgba(0,0,0,.26)'; g.beginPath(); g.ellipse(50, 98, 44, 18, 0, 0, Math.PI * 2); g.fill();
    isoBox(g, 50, 92, 40, 46, '#3a3438', '#2a2427', '#3a3236');
    isoBox(g, 62, 56, 9, 38, '#35302f', '#25201f', '#322b29'); // chimenea
    const sm = g.createRadialGradient(62, 4, 2, 62, 8, 14); sm.addColorStop(0, 'rgba(90,86,90,.5)'); sm.addColorStop(1, 'rgba(90,86,90,0)'); g.fillStyle = sm; g.fillRect(44, 0, 36, 24);
    // boca en la cara derecha (sudeste): arco encendido
    g.save(); g.setTransform(1, -0.5, 0, 1, 52, 92 + 20);
    const mouth = g.createLinearGradient(0, -34, 0, 0); mouth.addColorStop(0, '#ffcf5a'); mouth.addColorStop(1, '#e0501a');
    g.fillStyle = '#15110f'; g.beginPath(); g.moveTo(5, 0); g.lineTo(5, -26); g.arc(20, -26, 15, Math.PI, 0); g.lineTo(35, 0); g.closePath(); g.fill();
    g.fillStyle = mouth; g.beginPath(); g.moveTo(9, -2); g.lineTo(9, -25); g.arc(20, -25, 11, Math.PI, 0); g.lineTo(31, -2); g.closePath(); g.fill();
    g.fillStyle = '#ffe9a0'; g.fillRect(13, -9, 14, 5);
    g.restore();
    const glow = g.createRadialGradient(72, 92, 2, 72, 92, 30); glow.addColorStop(0, 'rgba(255,140,40,.35)'); glow.addColorStop(1, 'rgba(255,100,20,0)'); g.fillStyle = glow; g.fillRect(40, 70, 60, 50);
});
drawn(TOWN_PROPS.yunque, 64, 64, 32, 56, (g) => { // yunque sobre un tocón
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(32, 56, 20, 8, 0, 0, Math.PI * 2); g.fill();
    const wd = g.createLinearGradient(16, 0, 48, 0); wd.addColorStop(0, '#4a2f1b'); wd.addColorStop(0.5, '#7a5230'); wd.addColorStop(1, '#3b2415');
    g.fillStyle = wd; g.beginPath(); g.moveTo(17, 36); g.lineTo(17, 52); g.quadraticCurveTo(32, 62, 47, 52); g.lineTo(47, 36); g.closePath(); g.fill();
    g.fillStyle = '#8a6038'; g.beginPath(); g.ellipse(32, 36, 15, 6, 0, 0, 6.3); g.fill();
    g.fillStyle = '#26252a'; g.beginPath(); g.moveTo(10, 16); g.lineTo(54, 16); g.quadraticCurveTo(58, 21, 46, 24); g.lineTo(40, 26); g.lineTo(42, 32); g.lineTo(47, 35); g.lineTo(17, 35); g.lineTo(22, 32); g.lineTo(24, 26); g.lineTo(18, 24); g.quadraticCurveTo(10, 22, 10, 16); g.closePath(); g.fill();
    g.fillStyle = '#5a585f'; g.fillRect(12, 16, 40, 3); g.fillStyle = '#3d3b42'; g.fillRect(18, 24, 6, 8);
    g.fillStyle = 'rgba(255,120,40,.7)'; g.fillRect(36, 15, 8, 2);
});
function rock(g: SKRSContext2D, w: number, h: number, seed: number) { // roca volcánica: lascas oscuras con grietas brillantes
    const r = mulberry(seed); g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(w / 2, h - 8, w * 0.42, 9, 0, 0, 6.3); g.fill();
    const lump = (cx: number, base: number, rw: number, rh: number, k: number) => {
        const pts: [number, number][] = [[cx - rw, base], [cx - rw * 0.8, base - rh * 0.55], [cx - rw * 0.25, base - rh], [cx + rw * 0.3, base - rh * 0.9], [cx + rw * 0.85, base - rh * 0.45], [cx + rw, base]];
        const gr = g.createLinearGradient(cx - rw, 0, cx + rw, 0); gr.addColorStop(0, `rgb(${30 * k},${28 * k},${34 * k})`); gr.addColorStop(0.55, `rgb(${68 * k},${64 * k},${72 * k})`); gr.addColorStop(1, `rgb(${26 * k},${24 * k},${30 * k})`);
        g.fillStyle = gr; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
        g.strokeStyle = '#ff8a2a'; g.shadowColor = '#ff6a10'; g.shadowBlur = 6; g.lineWidth = 1.6; g.beginPath();
        let x = cx - rw * 0.3 + r() * rw * 0.5, y = base - rh * 0.9; g.moveTo(x, y); for (let i = 0; i < 4; i++) { x += (r() - 0.5) * rw * 0.5; y += rh * 0.2; g.lineTo(x, y); } g.stroke(); g.shadowBlur = 0;
    };
    lump(w * 0.36, h - 10, w * 0.28, h * 0.62, 1); lump(w * 0.68, h - 8, w * 0.22, h * 0.45, 0.85); lump(w * 0.52, h - 6, w * 0.2, h * 0.3, 1.15);
}
drawn(TOWN_PROPS.roca, 84, 70, 42, 60, (g) => rock(g, 84, 70, 71));
drawn(TOWN_PROPS.roca2, 70, 58, 35, 48, (g) => rock(g, 70, 58, 72));
drawn(TOWN_PROPS.obsidiana, 54, 110, 27, 100, (g) => { // cristal de obsidiana
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(27, 100, 17, 7, 0, 0, 6.3); g.fill();
    const shard = (x0: number, x1: number, tip: number, base: number, c0: string, c1: string) => { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.beginPath(); g.moveTo(x0, base); g.lineTo((x0 + x1) / 2 - 3, tip); g.lineTo(x1, base); g.closePath(); g.fill(); };
    shard(8, 30, 14, 98, '#0c0b12', '#3a2f56'); shard(22, 46, 36, 98, '#14121c', '#54407a'); shard(15, 36, 54, 98, '#1c1828', '#7a60a8');
    g.strokeStyle = 'rgba(190,160,255,.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(17, 40); g.lineTo(20, 80); g.stroke();
    g.fillStyle = 'rgba(255,120,40,.5)'; g.beginPath(); g.ellipse(27, 98, 14, 4, 0, 0, 6.3); g.fill();
});
drawn(TOWN_PROPS.lingotes, 60, 48, 30, 38, (g) => { // pila de lingotes de hierro
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(30, 38, 24, 9, 0, 0, 6.3); g.fill();
    const bar = (x: number, y: number) => { isoBox(g, x, y, 11, 7, '#8a8c96', '#4a4c55', '#3a3c44'); };
    for (const [x, y] of [[18, 34], [34, 34], [26, 28], [42, 30]]) bar(x, y);
    for (const [x, y] of [[26, 22], [38, 24]]) bar(x, y); bar(32, 17);
});
drawn(TOWN_PROPS.alfombraV, 100, 50, 50, 25, (g) => { // alfombra negra con borde rojo y filete de hierro
    g.beginPath(); g.moveTo(50, 3); g.lineTo(96, 25); g.lineTo(50, 47); g.lineTo(4, 25); g.closePath(); g.fillStyle = '#4a1218'; g.fill();
    g.strokeStyle = '#8a8d96'; g.lineWidth = 2; g.stroke();
    g.beginPath(); g.moveTo(50, 9); g.lineTo(84, 25); g.lineTo(50, 41); g.lineTo(16, 25); g.closePath(); g.strokeStyle = 'rgba(214,100,40,.8)'; g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.moveTo(50, 15); g.lineTo(72, 25); g.lineTo(50, 35); g.lineTo(28, 25); g.closePath(); g.fillStyle = 'rgba(20,10,12,.55)'; g.fill();
});
drawn(TOWN_PROPS.monolito, 60, 150, 30, 140, (g) => { // estela de basalto con runas encendidas
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(30, 140, 24, 10, 0, 0, 6.3); g.fill();
    isoBox(g, 30, 134, 22, 12, '#35333a', '#26252a', '#2e2c33'); // pedestal
    isoBox(g, 30, 124, 14, 92, '#2c2a30', '#1b1a1f', '#26242a');
    g.save(); g.shadowColor = '#ff7a1a'; g.shadowBlur = 8; g.strokeStyle = '#ff9a3a'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const y = 60 + i * 16; g.beginPath(); g.moveTo(32, y + 5); g.lineTo(42, y); g.lineTo(42, y + 9); g.stroke(); g.beginPath(); g.moveTo(34, y + 10); g.lineTo(40, y + 7); g.stroke(); }
    g.restore();
});
drawn(TOWN_PROPS.pinchos, 60, 56, 30, 48, (g) => { // erizo de hierro (cruces de picas)
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(30, 48, 24, 8, 0, 0, 6.3); g.fill();
    g.lineCap = 'round';
    for (const [x, a, h] of [[16, -0.35, 40], [30, 0.1, 44], [44, 0.4, 38], [24, 0.3, 34], [38, -0.25, 36]] as const) {
        g.strokeStyle = '#1b1a1e'; g.lineWidth = 4.5; g.beginPath(); g.moveTo(x, 46); g.lineTo(x + Math.sin(a) * h, 46 - Math.cos(a) * h); g.stroke();
        g.strokeStyle = '#6d6b74'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - 1, 46); g.lineTo(x - 1 + Math.sin(a) * h, 46 - Math.cos(a) * h); g.stroke();
        g.fillStyle = '#9a98a2'; g.beginPath(); const tx = x + Math.sin(a) * h, ty = 46 - Math.cos(a) * h; g.moveTo(tx, ty - 6); g.lineTo(tx - 3, ty + 2); g.lineTo(tx + 3, ty + 2); g.closePath(); g.fill();
    }
});
drawn(TOWN_PROPS.perchero, 64, 88, 32, 78, (g) => { // rack de armas: marco de madera con espadas y hachas
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(32, 78, 24, 8, 0, 0, 6.3); g.fill();
    g.fillStyle = '#4a3020'; g.fillRect(8, 30, 5, 48); g.fillRect(51, 30, 5, 48); g.fillRect(6, 28, 52, 6); g.fillRect(6, 54, 52, 5);
    for (const [x, c, h] of [[18, '#b9bcc6', 46], [28, '#9da1ad', 40], [38, '#b9bcc6', 44], [47, '#9da1ad', 38]] as const) {
        g.fillStyle = c; g.fillRect(x - 1.5, 54 - h * 0.7, 3, h); g.fillStyle = '#5a3a22'; g.fillRect(x - 3, 52, 6, 3);
    }
    g.fillStyle = '#7d808c'; g.beginPath(); g.moveTo(29, 18); g.lineTo(37, 18); g.lineTo(37, 28); g.lineTo(29, 28); g.closePath(); g.fill();
});

// 7) muebles de Kenney agrandados (desde dungeon.webp, que ya está en el repo)
{
    const { KENNEY_NAMES } = await import('../../../packages/world/src/frontier.ts');
    const meta0 = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')), dun = await loadImage(readFileSync(join(out, 'dungeon.webp')));
    for (const name of KENNEY_FURNITURE) for (const [oi, o] of (['N', 'E', 'S', 'W'] as const).entries()) {
        const p = meta0.dungeon.pos[2000 + KENNEY_NAMES.indexOf(name) * 4 + oi]; if (!p) continue;
        const [x, y, w0, h0, ox, oy] = p as number[], w = Math.round(w0 * FURNITURE_SCALE), h = Math.round(h0 * FURNITURE_SCALE);
        const c = createCanvas(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(dun, x, y, w0, h0, 0, 0, w, h);
        pieces.push({ id: townFurniture(name, o), im: c, ox: Math.round(ox * FURNITURE_SCALE * 10) / 10, oy: Math.round(oy * FURNITURE_SCALE * 10) / 10 });
    }
}

// ---------- empaquetado de town.webp ----------
pieces.sort((a, b) => b.im.height - a.im.height || a.id - b.id);
const AW = 2048;
let X = 0, Y = 0, rowH = 0;
const pos: Record<string, number[]> = {};
for (const p of pieces) {
    if (X + p.im.width > AW) { X = 0; Y += rowH + 2; rowH = 0; }
    pos[p.id] = [X, Y, p.im.width, p.im.height, p.ox, p.oy];
    X += p.im.width + 2; rowH = Math.max(rowH, p.im.height);
}
const atlas = createCanvas(AW, Y + rowH), ag = atlas.getContext('2d');
for (const p of pieces) { const [x, y] = pos[p.id]; ag.drawImage(p.im, x, y); }
writeFileSync(join(out, 'town.webp'), atlas.toBuffer('image/webp', 88));

// ---------- fachadas ----------
// Un piso del edificio son DOS piezas planas apiladas (96 px en el juego): con una sola pieza (48 px) las casas quedaban a la
// altura de la cintura de un personaje (~85 px). Abajo va la pieza con ventana y arriba la lisa.
const isoL = (gx: number, gy: number) => ({ x: (gx - gy) * 128, y: (gx + gy) * 64 });
const PIECE = 128, STORY = 2 * PIECE;
/** Dibuja en coordenadas de la cara: s a lo largo del lado (0..128 por celda), t hacia abajo (0 = pie de la pared). */
function onFace(g: SKRSContext2D, ax: number, ay: number, slope: number, fn: () => void) {
    g.save(); g.setTransform(1, slope, 0, 1, ax, ay); fn(); g.restore();
}
function drawDoor(g: SKRSContext2D, big: boolean) {
    // marco de piedra con arco, hoja de madera de tablas con herrajes y escalón (alto ~180 px Large = ~68 px en el juego)
    const x0 = big ? 18 : 28, x1 = big ? 110 : 100, cx = (x0 + x1) / 2, r = (x1 - x0) / 2, top = -186 + r;
    g.fillStyle = '#4a4440'; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, top); g.arc(cx, top, r, Math.PI, 0); g.lineTo(x1, 0); g.closePath(); g.fill();
    const wd = g.createLinearGradient(x0, 0, x1, 0); wd.addColorStop(0, '#4a2c16'); wd.addColorStop(0.5, '#7a4e2a'); wd.addColorStop(1, '#4a2c16');
    g.fillStyle = wd; g.beginPath(); g.moveTo(x0 + 7, 0); g.lineTo(x0 + 7, top); g.arc(cx, top, r - 7, Math.PI, 0); g.lineTo(x1 - 7, 0); g.closePath(); g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(30,16,6,.7)'; g.lineWidth = 2.5; for (let s = x0 + 18; s < x1 - 7; s += 12) { g.beginPath(); g.moveTo(s, -2); g.lineTo(s, -200); g.stroke(); }
    if (big) { g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, -200); g.lineWidth = 4; g.stroke(); }
    g.restore();
    g.fillStyle = '#2a2622'; g.fillRect(x0 + 8, -40, x1 - x0 - 16, 7); g.fillRect(x0 + 8, -120, x1 - x0 - 16, 7);
    g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(big ? cx + 10 : x1 - 20, -78, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8d857a'; g.fillRect(x0 - 8, -4, x1 - x0 + 16, 8);
}
function drawSign(g: SKRSContext2D, text: string) {
    g.font = 'bold 34px serif';
    const tw = g.measureText(text).width, w = tw + 34, x = 64 - w / 2, top = -246, h = 48;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 4, top + 4, w, h);
    const wd = g.createLinearGradient(0, top, 0, top + h); wd.addColorStop(0, '#8a5a32'); wd.addColorStop(1, '#5a3618');
    g.fillStyle = wd; g.fillRect(x, top, w, h);
    g.strokeStyle = '#c9a24a'; g.lineWidth = 3; g.strokeRect(x + 3, top + 3, w - 6, h - 6);
    g.fillStyle = '#f3dfa6'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, top + h / 2 + 1);
}
/** Puerta de hierro de Vhar: hoja de placas remachadas con una raja de brasas en el arco. */
function drawIronDoor(g: SKRSContext2D, big: boolean) {
    const x0 = big ? 18 : 28, x1 = big ? 110 : 100, cx = (x0 + x1) / 2, r = (x1 - x0) / 2, top = -186 + r;
    g.fillStyle = '#17161a'; g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, top); g.arc(cx, top, r, Math.PI, 0); g.lineTo(x1, 0); g.closePath(); g.fill();
    const lf = g.createLinearGradient(x0, 0, x1, 0); lf.addColorStop(0, '#2a2b30'); lf.addColorStop(0.5, '#4a4c54'); lf.addColorStop(1, '#25262b');
    g.fillStyle = lf; g.beginPath(); g.moveTo(x0 + 7, 0); g.lineTo(x0 + 7, top); g.arc(cx, top, r - 7, Math.PI, 0); g.lineTo(x1 - 7, 0); g.closePath(); g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(8,8,10,.8)'; g.lineWidth = 3; for (let s = x0 + 22; s < x1 - 7; s += 22) { g.beginPath(); g.moveTo(s, -2); g.lineTo(s, -200); g.stroke(); }
    if (big) { g.lineWidth = 5; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, -200); g.stroke(); }
    g.fillStyle = '#121214'; for (const y of [-34, -92, -150]) g.fillRect(x0, y, x1 - x0, 12);
    g.fillStyle = '#8b8e99'; for (const y of [-28, -86, -144]) for (let s = x0 + 12; s < x1 - 6; s += 18) { g.beginPath(); g.arc(s, y, 2.8, 0, 6.3); g.fill(); }
    g.restore();
    g.save(); g.shadowColor = '#ff7a1a'; g.shadowBlur = 10; g.strokeStyle = '#ff8a2a'; g.lineWidth = 3.5; g.beginPath(); g.arc(cx, top, r - 14, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); g.restore();
    g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(big ? cx + 12 : x1 - 20, -80, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a5860'; g.fillRect(x0 - 8, -4, x1 - x0 + 16, 8);
}
function drawIronSign(g: SKRSContext2D, text: string) {
    g.font = 'bold 32px serif';
    const tw = g.measureText(text).width, w = tw + 36, x = 64 - w / 2, top = -246, h = 48;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + 4, top + 4, w, h);
    const pl = g.createLinearGradient(0, top, 0, top + h); pl.addColorStop(0, '#34333a'); pl.addColorStop(1, '#17161a');
    g.fillStyle = pl; g.fillRect(x, top, w, h);
    g.strokeStyle = '#9a3a1a'; g.lineWidth = 3; g.strokeRect(x + 3, top + 3, w - 6, h - 6);
    g.fillStyle = '#8b8e99'; for (const [rx, ry] of [[x + 8, top + 8], [x + w - 8, top + 8], [x + 8, top + h - 8], [x + w - 8, top + h - 8]]) { g.beginPath(); g.arc(rx, ry, 2.2, 0, 6.3); g.fill(); }
    g.save(); g.shadowColor = '#ff6a10'; g.shadowBlur = 8; g.fillStyle = '#ffb25a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, top + h / 2 + 1); g.restore();
}
/** Rombo de terraza sin borde suave (los bordes suaves dejaban una cuadrícula clara entre baldosas). */
function hardDiamond(src: Canvas): Canvas {
    const c = createCanvas(256, 128), g = c.getContext('2d');
    g.beginPath(); g.moveTo(128, -1); g.lineTo(258, 64); g.lineTo(128, 129); g.lineTo(-2, 64); g.closePath(); g.clip();
    // se dibuja un poco agrandado para tapar las juntas
    g.drawImage(src, -3, -2, 262, 132); return c;
}
const roofCache = new Map<number, Canvas>();
const roofTile = (id: number) => { let r = roofCache.get(id); if (!r) { r = hardDiamond(floorTiles.get(id)!); roofCache.set(id, r); } return r; };
const buildingsMeta: Record<string, { w: number; h: number; ax: number; ay: number; fw: number; fh: number }> = {};
for (const b of TOWN_BUILDINGS) {
    const st = WALL_STYLES.find((s) => s.id === b.style)!, H = b.floors * STORY, uppers: TownUpper[] = b.upper ? (Array.isArray(b.upper) ? b.upper : [b.upper]) : [], Hup = Math.max(0, ...uppers.map((u) => u.floors)) * STORY;
    // lienzo a escala Large con margen; origen = esquina norte del edificio a nivel del piso
    const left = -b.h * 128 - 60, right = b.w * 128 + 60, top = -H - Hup - 160, bottom = (b.w + b.h) * 64 + 40;
    const c = createCanvas(right - left, bottom - top), g = c.getContext('2d');
    const at = (p: { x: number; y: number }) => ({ x: p.x - left, y: p.y - top });
    const cop = await sheet('Copings - Stone 1 128x128.png', 'black');
    const [pcx, pcy] = COPING_CELLS[b.parapet ?? 'cornisa'];
    const copPiece = (ori: '/' | '\\') => cell(cop, (pcx + (ori === '/' ? 0 : 1)) * 128, pcy * 128, 128, 128);
    const roofId = b.roof === 'ceniza' ? vharTile(0) : b.roof === 'losa' ? vharTile(7) : b.roof === 'placa' ? vharTile(9) : townTile(b.roof === 17 ? 'terrain2' : 'terrain1', b.roof ?? 15);
    /** Caja (x0, y0, w, h) en celdas, que arranca a la altura z0 (px Large) y tiene `floors` pisos; con terraza y pretil. */
    const box = async (x0: number, y0: number, w: number, h: number, z0: number, floors: number, main: boolean) => {
        const top = z0 + floors * STORY;
        const variant = (k: number, i: number): WallVariant => (k % 2 ? 'liso' : ((i + (k >> 1)) % 3 === 1 ? 'ventana2' : (i + (k >> 1)) % 3 === 2 && w > 3 ? 'liso' : 'ventana'));
        // cara sur: '\' con la esquina de arriba en isoL(x0 + i, y0 + h); cada piso son dos piezas
        for (let k = 0; k < floors * 2; k++) for (let i = 0; i < w; i++) {
            const door = main && k < 2 && b.door?.side === 'S' && b.door.i === i;
            const pc = shade(await flatPiece(st, door ? 'liso' : variant(k, i), '\\'), 0.84);
            const p = at(isoL(x0 + i, y0 + h)); g.drawImage(pc, p.x, p.y - PIECE - z0 - k * PIECE);
        }
        // cara este: '/' con la esquina de arriba en isoL(x0 + w, y0 + j)
        for (let k = 0; k < floors * 2; k++) for (let j = 0; j < h; j++) {
            const door = main && k < 2 && b.door?.side === 'E' && b.door.i === j;
            const pc = await flatPiece(st, door ? 'liso' : variant(k, j + 1), '/');
            const p = at(isoL(x0 + w, y0 + j)); g.drawImage(pc, p.x - PIECE, p.y - PIECE - z0 - k * PIECE);
        }
        // zócalo oscuro al pie y arista de la esquina sur
        if (z0 === 0) {
            const a = at(isoL(x0, y0 + h)), s = at(isoL(x0 + w, y0 + h)), e = at(isoL(x0 + w, y0));
            g.fillStyle = 'rgba(40,30,20,.28)'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(s.x, s.y); g.lineTo(e.x, e.y); g.lineTo(e.x, e.y - 14); g.lineTo(s.x, s.y - 14); g.lineTo(a.x, a.y - 14); g.closePath(); g.fill();
        }
        { const p = at(isoL(x0 + w, y0 + h)); g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(p.x - 1.5, p.y - top, 3, top - z0); }
        // terraza
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const p = at(isoL(x0 + i, y0 + j)); g.drawImage(roofTile(roofId), p.x - 128, p.y - top); }
        // pretil: lados de atrás y después los de adelante
        for (let i = 0; i < w; i++) { const p = at(isoL(x0 + i, y0)); g.drawImage(copPiece('\\'), p.x, p.y - top - 64); }
        for (let j = 0; j < h; j++) { const p = at(isoL(x0, y0 + j)); g.drawImage(copPiece('/'), p.x - 128, p.y - top - 64); }
        for (let i = 0; i < w; i++) { const p = at(isoL(x0 + i, y0 + h)); g.drawImage(copPiece('\\'), p.x, p.y - top - 64); }
        for (let j = 0; j < h; j++) { const p = at(isoL(x0 + w, y0 + j)); g.drawImage(copPiece('/'), p.x - 128, p.y - top - 64); }
    };
    await box(0, 0, b.w, b.h, 0, b.floors, true);
    for (const u of uppers) await box(u.x, u.y, u.w, u.h, H, u.floors, false);
    // puerta, cartel y toldo
    if (b.door) {
        const S_ = b.door.side === 'S';
        const a = at(S_ ? isoL(b.door.i, b.h) : isoL(b.w, b.door.i + 1)), slope = S_ ? 0.5 : -0.5;
        onFace(g, a.x, a.y, slope, () => { if (b.iron) drawIronDoor(g, b.w >= 8); else drawDoor(g, b.w >= 8); if (b.sign) (b.iron ? drawIronSign : drawSign)(g, b.sign); });
        if (b.awning) {
            const out = S_ ? { x: -56, y: 28 } : { x: 56, y: 28 }, s0 = 4, s1 = 124, t = -196;
            const P = (s: number, tt: number) => ({ x: a.x + s, y: a.y + s * slope + tt });
            const n = 8;
            for (let q = 0; q < n; q++) {
                const sa = s0 + ((s1 - s0) * q) / n, sb = s0 + ((s1 - s0) * (q + 1)) / n;
                const p1 = P(sa, t), p2 = P(sb, t), p3 = { x: p2.x + out.x, y: p2.y + out.y + 30 }, p4 = { x: p1.x + out.x, y: p1.y + out.y + 30 };
                g.fillStyle = q % 2 ? '#efe6d2' : b.awning; g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p3.x, p3.y); g.lineTo(p4.x, p4.y); g.closePath(); g.fill();
                g.beginPath(); g.moveTo(p4.x, p4.y); g.lineTo(p3.x, p3.y); g.lineTo(p3.x, p3.y + 10); g.quadraticCurveTo((p3.x + p4.x) / 2, (p3.y + p4.y) / 2 + 18, p4.x, p4.y + 10); g.closePath(); g.fill();
            }
            g.fillStyle = 'rgba(0,0,0,.18)'; const p1 = P(s0, t), p2 = P(s1, t); g.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y) - 2, Math.abs(p2.x - p1.x), 4);
        }
    }
    // escala final y meta (ancla = esquina sur de la huella, igual que fantasy_house)
    const bb = alphaBox(c)!, sw = bb.x1 - bb.x0 + 1, sh = bb.y1 - bb.y0 + 1, w = Math.round(sw * S), h = Math.round(sh * S);
    const o = createCanvas(w, h), og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, bb.x0, bb.y0, sw, sh, 0, 0, w, h);
    writeFileSync(join(out, `${b.id}.webp`), o.toBuffer('image/webp', 88));
    const foot = at(isoL(b.w, b.h));
    buildingsMeta[b.id] = { w, h, ax: Math.round((foot.x - bb.x0) * S), ay: Math.round((foot.y - bb.y0) * S), fw: b.w, fh: b.h };
}

// ---------- meta ----------
const metaPath = join(out, 'meta.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
meta.town = { pos };
meta.buildings = { ...(meta.buildings ?? {}), ...buildingsMeta };
writeFileSync(metaPath, JSON.stringify(meta));
console.log(`town.webp: ${pieces.length} piezas (${AW}x${Y + rowH}); ${TOWN_BUILDINGS.length} fachadas`);

// ---------- lámina de control opcional ----------
if (process.env.PREVIEW) {
    const cols = 12, cw = 130, ch = 150, rows = Math.ceil(pieces.length / cols);
    const pv = createCanvas(cols * cw, rows * ch), pg = pv.getContext('2d');
    pg.fillStyle = '#2a2e2a'; pg.fillRect(0, 0, pv.width, pv.height);
    [...pieces].sort((a, b) => a.id - b.id).forEach((p, i) => {
        const x = (i % cols) * cw + 65, y = Math.floor(i / cols) * ch + 110;
        pg.strokeStyle = 'rgba(255,255,255,.25)'; pg.beginPath(); pg.moveTo(x, y - 24); pg.lineTo(x + 48, y); pg.lineTo(x, y + 24); pg.lineTo(x - 48, y); pg.closePath(); pg.stroke();
        pg.drawImage(p.im, x - p.ox, y - p.oy);
        pg.fillStyle = '#ff0'; pg.font = '11px sans-serif'; pg.fillText(String(p.id), x - 60, y - 96);
    });
    writeFileSync(process.env.PREVIEW, pv.toBuffer('image/png'));
}
