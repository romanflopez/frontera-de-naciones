/**
 * Recorta y escala la casa "Fantasy House" para el campamento de Solmar:
 *   apps/client/public/assets/fantasy_house.webp
 *   meta.json -> buildings.fantasy_house { w, h, ax, ay, fw, fh }  (no pisa otras claves)
 *
 * Entrada: PNG con alfa de la capa "house" (ver export-psd.py), en HOUSE_SRC o como primer argumento.
 * Uso: HOUSE_SRC=/ruta/house.png pnpm --filter @fdn/tools house
 *
 * La casa ocupa FW x FH celdas de 96x48. (ax, ay) es el pixel del webp que cae en la esquina
 * sur (la más cercana a cámara) de esa huella: el cliente lo apoya en iso(x + FW, y + FH).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'apps', 'client', 'public', 'assets');
const src = process.argv[2] ?? process.env.HOUSE_SRC;
if (!src || !existsSync(src)) { console.error('Falta el PNG de la casa (HOUSE_SRC o primer argumento). Ver export-psd.py.'); process.exit(1); }

// huella en celdas y escala: 3x3 celdas = 288 px de ancho, la casa mide ~880 px de pared a pared
const FW = 3, FH = 3, S = 0.34;
// esquina sur de la huella dentro del PNG original (donde la pared frontal toca el piso)
const FOOT = { x: 440, y: 940 };

const img = await loadImage(src);
const full = createCanvas(img.width, img.height), fg = full.getContext('2d');
fg.drawImage(img, 0, 0);
const { data } = fg.getImageData(0, 0, img.width, img.height);
let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (data[(y * img.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
const cw = x1 - x0 + 1, ch = y1 - y0 + 1, w = Math.round(cw * S), h = Math.round(ch * S);

const c = createCanvas(w, h), g = c.getContext('2d');
g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
g.drawImage(full, x0, y0, cw, ch, 0, 0, w, h);
writeFileSync(join(out, 'fantasy_house.webp'), c.toBuffer('image/webp', 88));

// meta.json: se suma la clave `buildings`, el resto queda como está
const metaFile = join(out, 'meta.json');
const meta: Record<string, unknown> = JSON.parse(readFileSync(metaFile, 'utf8'));
const buildings = (meta.buildings ?? {}) as Record<string, unknown>;
buildings.fantasy_house = { w, h, ax: Math.round((FOOT.x - x0) * S), ay: Math.round((FOOT.y - y0) * S), fw: FW, fh: FH };
meta.buildings = buildings;
writeFileSync(metaFile, JSON.stringify(meta));
console.log(`fantasy_house.webp ${w}x${h}, ancla`, buildings.fantasy_house);
