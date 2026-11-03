/**
 * Arma el atlas de tiles de los mapas importados de Flare (CC-BY-SA 3.0; docs/MAPAS_FLARE.md): por cada hoja de Flare que usan los
 * mapas de packages/world/src/flare (`grassland`, …) genera apps/client/public/assets/flare_<hoja>.webp con SOLO las piezas que se usan,
 * a media escala (como el resto del arte: tile 192x96 -> 96x48), y suma la clave `flare_<hoja>` a meta.json sin tocar las demás.
 * Ids de ERIS = FLARE_BASE[hoja] + id de Flare (packages/world/src/flare/types.ts). Las piezas animadas (agua) usan su primer cuadro.
 *
 * Uso: FLARE_DIR=<flare-game o zip v1.14> pnpm --filter @fdn/tools flare:mapatlas   (después de flare:maps)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FLARE_BASE, FLARE_SHADE, isFlareCliff, shadeSource } from '../../../packages/world/src/flare/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const flare = process.env.FLARE_DIR ?? join(root, 'reference', 'flare-game');
const dataDir = join(root, 'packages', 'world', 'src', 'flare');
const out = join(root, 'apps', 'client', 'public', 'assets');
const S = 0.5, GAP = 2, W = 2048;
/** Agua de cada hoja: [color profundo, color claro] (ver el teñido más abajo). */
const WATER_TINT: Record<string, [number[], number[]]> = { grassland: [[18, 44, 52], [58, 104, 104]], snowplains: [[30, 56, 74], [96, 140, 156]] };
const MODS = ['fantasycore', 'empyrean_campaign'].map((m) => join(flare, 'mods', m));
const find = (rel: string): string | undefined => MODS.map((m) => join(m, rel)).find((p) => existsSync(p));

interface Def { img: string; x: number; y: number; w: number; h: number; ox: number; oy: number }
function parseDefs(rel: string): Map<number, Def> {
    const file = find(rel); if (!file) throw new Error(`No encontré ${rel} en ${flare}`);
    const defs = new Map<number, Def>(), anim = new Map<number, { img: string; x: number; y: number }>();
    let img = '';
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const l = raw.trim();
        if (l.startsWith('img=')) img = l.slice(4);
        else if (l.startsWith('tile=')) { const a = l.slice(5).split(',').map(Number); defs.set(a[0], { img, x: a[1], y: a[2], w: a[3], h: a[4], ox: a[5], oy: a[6] }); }
        else if (l.startsWith('animation=')) { const parts = l.slice(10).split(';'); const [fx, fy] = parts[1].split(',').map(Number); anim.set(Number(parts[0]), { img, x: fx, y: fy }); }
    }
    for (const [id, a] of anim) { const d = defs.get(id); defs.set(id, d ? { ...d, img: a.img, x: a.x, y: a.y } : { img: a.img, x: a.x, y: a.y, w: 192, h: 96, ox: 96, oy: 48 }); }
    return defs;
}

const files = readdirSync(dataDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'types.ts');
const used = new Map<string, Set<number>>();
for (const f of files) {
    const { DATA } = (await import(pathToFileURL(join(dataDir, f)).href)) as { DATA: { tileset: string; layers: { background: number[][]; object: number[][] } } };
    const set = used.get(DATA.tileset) ?? new Set<number>(); used.set(DATA.tileset, set);
    for (const row of DATA.layers.background) for (const id of row) if (id) set.add(id);
    for (const row of DATA.layers.object) for (const id of row) if (id) set.add(id);
}

// piezas de Flare que usan los mapas armados por código (la arena)
const { ARENA_FLARE_IDS } = (await import(pathToFileURL(join(root, 'packages', 'world', 'src', 'arena.ts')).href)) as { ARENA_FLARE_IDS: Record<string, number[]> };
for (const [ts, ids] of Object.entries(ARENA_FLARE_IDS)) { const set = used.get(ts) ?? new Set<number>(); used.set(ts, set); for (const id of ids) set.add(id); }

const metaPath = join(out, 'meta.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
for (const [tileset, ids] of used) {
    const base = FLARE_BASE[tileset];
    if (base === undefined) throw new Error(`La hoja '${tileset}' no tiene base en FLARE_BASE (packages/world/src/flare/types.ts)`);
    const defs = parseDefs(`tilesetdefs/tileset_${tileset}.txt`);
    const images = new Map<string, Awaited<ReturnType<typeof loadImage>>>();
    const items: { id: number; d: Def; w: number; h: number }[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
        const d = defs.get(shadeSource(tileset, id) ?? id); if (!d) { console.warn(`${tileset}: el id ${id} no está en la definición de la hoja`); continue; }
        if (!images.has(d.img)) { const p = find(d.img); if (!p) throw new Error(`No encontré ${d.img}`); images.set(d.img, await loadImage(readFileSync(p))); }
        items.push({ id, d, w: Math.max(1, Math.round(d.w * S)), h: Math.max(1, Math.round(d.h * S)) });
    }
    items.sort((a, b) => b.h - a.h || a.id - b.id);
    let X = 0, Y = 0, rowH = 0;
    const pos: Record<string, number[]> = {};
    for (const it of items) {
        if (X + it.w > W) { X = 0; Y += rowH + GAP; rowH = 0; }
        pos[base + it.id] = [X, Y, it.w, it.h, Math.round(it.d.ox * S * 10) / 10, Math.round(it.d.oy * S * 10) / 10];
        X += it.w + GAP; rowH = Math.max(rowH, it.h);
    }
    const canvas = createCanvas(W, Y + rowH), g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    for (const it of items) {
        const [px, py] = pos[base + it.id];
        g.drawImage(images.get(it.d.img)!, it.d.x, it.d.y, it.d.w, it.d.h, px, py, it.w, it.h);
        if (it.d.img.endsWith('_water.png')) {
            // El agua de Flare es casi negra (el juego original la ilumina con la luz del mapa). Se tiñe con la paleta del agua de la
            // hoja conservando la textura: solo los píxeles oscuros y grises (agua y sombra del agua); rocas, madera y pasto no se tocan.
            const [deep, light] = WATER_TINT[tileset] ?? WATER_TINT.grassland;
            const img = g.getImageData(px, py, it.w, it.h), a = img.data;
            for (let i = 0; i < a.length; i += 4) {
                if (!a[i + 3]) continue;
                const r = a[i], gg = a[i + 1], b = a[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
                if (mx > 64 || mx - mn > 14 || r > b + 6) continue;
                const t = Math.min(1, mx / 48) ** 0.8;
                for (let k = 0; k < 3; k++) a[i + k] = Math.round(deep[k] + (light[k] - deep[k]) * t);
            }
            g.putImageData(img, px, py);
        }
        if (tileset === 'cave' && it.id >= 192 && it.id <= 219) {
            // El "abismo" de la cueva de Flare es musgo verde oscuro: en ERIS se lee como pantano. Pasa al mismo tono de roca oscura que el
            // relleno del vacío (FLARE_SHADE), conservando la textura; la tierra de las orillas no se toca.
            const img = g.getImageData(px, py, it.w, it.h), a = img.data;
            for (let i = 0; i < a.length; i += 4) {
                if (!a[i + 3] || a[i + 1] <= a[i] + 2) continue;
                const l = (a[i] + a[i + 1] + a[i + 2]) / 3;
                a[i] = Math.round(l * 1.25); a[i + 1] = Math.round(l * 1.0); a[i + 2] = Math.round(l * 0.82);
            }
            g.putImageData(img, px, py);
        }
        if (shadeSource(tileset, it.id) !== undefined) {
            const k = FLARE_SHADE[tileset].k, img = g.getImageData(px, py, it.w, it.h), a = img.data;
            for (let i = 0; i < a.length; i += 4) { a[i] = Math.round(a[i] * k); a[i + 1] = Math.round(a[i + 1] * k); a[i + 2] = Math.round(a[i + 2] * k * 1.05); }
            g.putImageData(img, px, py);
        }
        if (isFlareCliff(tileset, it.id)) {
            // la cara negra de atrás del acantilado pasa a transparente (ver FLARE_CLIFF)
            const img = g.getImageData(px, py, it.w, it.h), a = img.data;
            for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 0 && a[i] < 14 && a[i + 1] < 14 && a[i + 2] < 14) a[i + 3] = 0;
            g.putImageData(img, px, py);
        }
    }
    writeFileSync(join(out, `flare_${tileset}.webp`), canvas.toBuffer('image/webp', 86));
    meta[`flare_${tileset}`] = { pos };
    console.log(`flare_${tileset}.webp: ${items.length} piezas (${W}x${Y + rowH})`);
}
writeFileSync(metaPath, JSON.stringify(meta));
