/**
 * Tiles del Campamento con arte de Flare, con la misma estructura de packs que los provisorios
 * (ver tools/src/placeholders/map.ts), así el mapa .amd no cambia.
 *
 * El piso de Flare son rombos de 192×96 (isométrico 2:1). El motor usa una grilla cuadrada,
 * así que cada rombo se remuestrea a un cuadrado de 32×32: como la grilla isométrica es una
 * grilla cuadrada rotada, los tiles siguen empalmando sin costuras.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { encodeSpr, type SprFrame, type SprSheet } from '../placeholders/spr.ts';
import { fence, TILE } from '../placeholders/map.ts';

interface TileDef { x: number; y: number; w: number; h: number; ox: number; oy: number }
interface Tileset { img: Image; data: Uint8ClampedArray; width: number; defs: Map<number, TileDef> }

async function tileset(mod: string, name: string): Promise<Tileset> {
    const img = await loadImage(readFileSync(join(mod, 'images', 'tilesets', `${name}.png`)));
    const c = createCanvas(img.width, img.height), ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const defs = new Map<number, TileDef>();
    for (const l of readFileSync(join(mod, 'tilesetdefs', `${name}.txt`), 'utf8').split(/\r?\n/)) {
        if (!l.startsWith('tile=')) continue;
        const [id, x, y, w, h, ox, oy] = l.slice(5).split(',').map(Number);
        defs.set(id, { x, y, w, h, ox, oy });
    }
    return { img, data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, defs };
}

/** Rombo de Flare → cuadrado de 32×32 (con 3×3 muestras por pixel para suavizar). */
function squareFromDiamond(ts: Tileset, id: number, out: Uint8ClampedArray, ox: number, stride: number): void {
    const d = ts.defs.get(id)!;
    const ss = 3;
    for (let v = 0; v < TILE; v++) for (let u = 0; u < TILE; u++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
            const s = (u + (sx + 0.5) / ss) / TILE, t = (v + (sy + 0.5) / ss) / TILE;
            // s avanza hacia el sudeste del rombo y t hacia el sudoeste
            const px = Math.min(d.w - 1, Math.max(0, Math.floor(d.w / 2 + (s - t) * (d.w / 2))));
            const py = Math.min(d.h - 1, Math.max(0, Math.floor((s + t) * (d.h / 2))));
            const i = ((d.y + py) * ts.width + d.x + px) * 4;
            if (ts.data[i + 3] < 8) continue;
            r += ts.data[i]; g += ts.data[i + 1]; b += ts.data[i + 2]; n++;
        }
        const o = (v * stride + ox + u) * 4;
        if (n) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255; }
    }
}

function groundSheet(ts: Tileset, ids: number[]): SprSheet {
    const w = TILE * ids.length;
    const c = createCanvas(w, TILE), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, TILE);
    ids.forEach((id, k) => squareFromDiamond(ts, id, img.data, k * TILE, w));
    ctx.putImageData(img, 0, 0);
    const frames: SprFrame[] = ids.map((_, k) => ({ x: k * TILE, y: 0, width: TILE, height: TILE, pivotX: 0, pivotY: 0 }));
    return { png: c.toBuffer('image/png'), width: w, height: TILE, frames };
}

/** Objetos tal cual vienen (escalados); el punto de apoyo de Flare cae cerca del centro-abajo de la celda. */
function objectSheet(ts: Tileset, ids: number[], scale: number): SprSheet {
    const parts = ids.map((id) => ts.defs.get(id)!);
    const sizes = parts.map((d) => [Math.ceil(d.w * scale), Math.ceil(d.h * scale)]);
    const w = sizes.reduce((a, [sw]) => a + sw + 2, 0), h = Math.max(...sizes.map(([, sh]) => sh));
    const c = createCanvas(w, h), ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const frames: SprFrame[] = [];
    let x = 0;
    parts.forEach((d, k) => {
        const [sw, sh] = sizes[k];
        ctx.drawImage(ts.img, d.x, d.y, d.w, d.h, x, 0, sw, sh);
        frames.push({ x, y: 0, width: sw, height: sh, pivotX: Math.round(TILE / 2 - d.ox * scale), pivotY: Math.round(TILE - 8 - d.oy * scale) });
        x += sw + 2;
    });
    return { png: c.toBuffer('image/png'), width: w, height: h, frames };
}

const blank: SprSheet = (() => {
    const png = createCanvas(1, 1).toBuffer('image/png');
    return { png, width: 1, height: 1, frames: Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 1, height: 1, pivotX: 0, pivotY: 0 })) };
})();

export async function buildFlareTilePacks(mod: string): Promise<Record<string, Uint8Array>> {
    const grass = await tileset(mod, 'tileset_grassland');
    const cave = await tileset(mod, 'tileset_cave');
    const range = (a: number, n: number) => Array.from({ length: n }, (_, i) => a + i);
    return {
        // hoja 0 pasto, 1 tierra, 2 piedra, 3 pasto oscuro (8 variantes cada una)
        'fdn-ground.spr': encodeSpr([
            groundSheet(grass, range(16, 8)),
            groundSheet(cave, range(16, 8)),
            groundSheet(grass, range(32, 8)),
            groundSheet(grass, range(24, 8)),
        ]),
        // hoja 0 rocas, 1 cerco (el dibujado: el de Flare va en diagonal), 2 fogata, 3 cajones
        'fdn-objects.spr': encodeSpr([
            objectSheet(grass, [128, 129, 130, 131], 0.32),
            fence(),
            objectSheet(grass, [102], 0.35),
            objectSheet(grass, [96, 98], 0.32),
        ]),
        // roble, pino, abedul, roble; las sombras ya vienen en el dibujo de Flare
        'fdn-trees.spr': encodeSpr([objectSheet(grass, [252, 248, 240, 254], 0.5)]),
        'fdn-treeshadows.spr': encodeSpr([blank]),
    };
}
