/**
 * Arma dos atlas a partir de packs CC0:
 *   dungeon.webp  Kenney "Isometric Dungeon" (256x512 por pieza, 4 orientaciones) escalado a 0.375 para que el
 *                 piso encaje en la grilla de 96x48 de Flare. ids = 2000 + índice del nombre * 4 + orientación (N,E,S,W).
 *   terrain.webp  SBS "Isometric Floor Tiles" (hojas de 3x6 tiles de 256x128, fondo magenta = transparente) a 100x50.
 *                 ids = 1000 + índice de la hoja * 18 + celda.
 * Las listas de nombres de acá tienen que coincidir con las de packages/world/src/frontier.ts.
 * Suma las claves "dungeon" y "terrain" a meta.json sin tocar las demás.
 *
 * Uso: pnpm assets:dungeon <carpeta Isometric de Kenney> <carpeta "Large 256x128" de SBS>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'apps', 'client', 'public', 'assets');
const [kdir, sdir] = [resolve(process.argv[2] ?? ''), resolve(process.argv[3] ?? '')];
if (!process.argv[3] || !existsSync(kdir) || !existsSync(sdir)) { console.error('Uso: pnpm assets:dungeon <Isometric de Kenney> <Large 256x128 de SBS>'); process.exit(1); }

const KENNEY_NAMES = ['barrel', 'barrels', 'barrelsStacked', 'bridge', 'bridgeBroken', 'chair', 'chestClosed', 'chestOpen', 'dirt', 'dirtTiles', 'planks', 'planksBroken', 'planksHole', 'stairs', 'stairsAged', 'stairsCorner', 'stairsSpiral', 'stone', 'stoneColumn', 'stoneColumnWood', 'stoneCorner', 'stoneInset', 'stoneLeft', 'stoneMissingTiles', 'stoneRight', 'stoneSide', 'stoneSideUneven', 'stoneStep', 'stoneSteps', 'stoneTile', 'stoneUneven', 'stoneWall', 'stoneWallAged', 'stoneWallAgedLeft', 'stoneWallAgedRight', 'stoneWallArchway', 'stoneWallBroken', 'stoneWallBrokenLeft', 'stoneWallBrokenRight', 'stoneWallColumn', 'stoneWallColumnIn', 'stoneWallCorner', 'stoneWallDoor', 'stoneWallDoorBars', 'stoneWallDoorClosed', 'stoneWallDoorOpen', 'stoneWallGate', 'stoneWallGateBars', 'stoneWallGateClosed', 'stoneWallGateOpen', 'stoneWallHalf', 'stoneWallHole', 'stoneWallRound', 'stoneWallRoundBroken', 'stoneWallRoundWindow', 'stoneWallStructure', 'stoneWallTop', 'stoneWallWindow', 'stoneWallWindowBars', 'tableChairsBroken', 'tableRound', 'tableRoundChairs', 'tableRoundItemsChairs', 'tableShort', 'tableShortChairs', 'woodenCrate', 'woodenCrates', 'woodenPile', 'woodenSupportBeams', 'woodenSupports', 'woodenSupportsBeam', 'woodenSupportsBlock'];
const ORI = ['N', 'E', 'S', 'W'];
// [carpeta, nombre] -> Exterior|Interior/<Carpeta>/Floor_<Carpeta>_0<n>-256x128.png
const SBS_GROUPS: [string, string][] = [['Exterior', 'Dry'], ['Exterior', 'Elements'], ['Exterior', 'Flora'], ['Exterior', 'Grass'], ['Exterior', 'Ice'], ['Exterior', 'Rocky'], ['Exterior', 'Stones'], ['Interior', 'Brick'], ['Interior', 'Stone'], ['Interior', 'Tile'], ['Interior', 'Pattern']];

const files = readdirSync(kdir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/_[NESW]\.png$/, ''));
const found = [...new Set(files)].sort();
if (found.join() !== [...KENNEY_NAMES].sort().join()) { console.error('La lista de piezas de Kenney no coincide con la del script.'); process.exit(1); }

// ---------- Kenney ----------
const KS = 0.375, ANCHOR_X = 128, ANCHOR_Y = 428; // centro del rombo de piso dentro del PNG de 256x512
const items: { id: number; im: Awaited<ReturnType<typeof loadImage>>; sx: number; sy: number; sw: number; sh: number; w: number; h: number; ox: number; oy: number }[] = [];
const probe = createCanvas(256, 512), pg = probe.getContext('2d');
for (const [ni, name] of KENNEY_NAMES.entries()) for (const [oi, o] of ORI.entries()) {
    const im = await loadImage(readFileSync(join(kdir, `${name}_${o}.png`)));
    pg.clearRect(0, 0, 256, 512); pg.drawImage(im, 0, 0);
    const px = pg.getImageData(0, 0, 256, 512).data;
    let x0 = 256, y0 = 512, x1 = -1, y1 = -1;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 256; x++) if (px[(y * 256 + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) continue;
    const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
    items.push({ id: 2000 + ni * 4 + oi, im, sx: x0, sy: y0, sw, sh, w: Math.ceil(sw * KS), h: Math.ceil(sh * KS), ox: (ANCHOR_X - x0) * KS, oy: (ANCHOR_Y - y0) * KS });
}
items.sort((a, b) => b.h - a.h);
const KW = 2048;
let X = 0, Y = 0, rowH = 0;
const kpos: Record<string, number[]> = {};
for (const it of items) {
    if (X + it.w > KW) { X = 0; Y += rowH + 2; rowH = 0; }
    kpos[it.id] = [X, Y, it.w, it.h, Math.round(it.ox * 10) / 10, Math.round(it.oy * 10) / 10];
    X += it.w + 2; rowH = Math.max(rowH, it.h);
}
const kc = createCanvas(KW, Y + rowH), kg = kc.getContext('2d');
kg.imageSmoothingQuality = 'high';
for (const it of items) { const [px, py] = kpos[it.id]; kg.drawImage(it.im, it.sx, it.sy, it.sw, it.sh, px, py, it.w, it.h); }
writeFileSync(join(out, 'dungeon.webp'), kc.toBuffer('image/webp', 88));

// ---------- SBS ----------
const TWD = 100, THD = 50, GAP = 2, CW = TWD + GAP, CH = THD + GAP, PER_ROW = 6;
const sheets: string[] = [];
for (const [kind, g] of SBS_GROUPS) for (const n of [1, 2]) sheets.push(`${kind}/${g}/Floor_${g}_0${n}-256x128.png`);
const rows = Math.ceil(sheets.length / PER_ROW);
const tc = createCanvas(PER_ROW * 3 * CW, rows * 6 * CH), tg = tc.getContext('2d');
tg.imageSmoothingQuality = 'high';
const tpos: Record<string, number[]> = {};
for (const [si, rel] of sheets.entries()) {
    const sheet = await loadImage(readFileSync(join(sdir, rel)));
    const bx = (si % PER_ROW) * 3 * CW, by = Math.floor(si / PER_ROW) * 6 * CH;
    for (let c = 0; c < 18; c++) {
        // la clave de transparencia es magenta puro: se pasa a alfa antes de achicar
        // un canvas nuevo por tile: napi-rs/canvas no hace copia al dibujar un canvas sobre otro y reusarlo pisa lo ya dibujado
        const full = createCanvas(256, 128), fg = full.getContext('2d');
        fg.drawImage(sheet, (c % 3) * 256, Math.floor(c / 3) * 128, 256, 128, 0, 0, 256, 128);
        const d = fg.getImageData(0, 0, 256, 128), a = d.data;
        for (let i = 0; i < a.length; i += 4) if (a[i] > 230 && a[i + 1] < 40 && a[i + 2] > 230) a[i + 3] = 0;
        fg.putImageData(d, 0, 0);
        const x = bx + (c % 3) * CW, y = by + Math.floor(c / 3) * CH;
        tg.drawImage(full, 0, 0, 256, 128, x, y, TWD, THD);        tpos[1000 + si * 18 + c] = [x, y, TWD, THD, TWD / 2, THD / 2];
    }
}
writeFileSync(join(out, 'terrain.webp'), tc.toBuffer('image/webp', 86));

// ---------- meta ----------
const metaPath = join(out, 'meta.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
meta.dungeon = { pos: kpos }; meta.terrain = { pos: tpos };
writeFileSync(metaPath, JSON.stringify(meta));
console.log(`dungeon.webp: ${items.length} piezas (${KW}x${Y + rowH}); terrain.webp: ${sheets.length} hojas x 18 tiles (${tc.width}x${tc.height})`);
