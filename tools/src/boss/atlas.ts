/**
 * Arma el atlas de un boss a partir de un pack de spritesheets 3D (carpetas Anim/Anim_Body_<ángulo>.png,
 * cada hoja = grilla de cuadros de 256 px, 16 ángulos). Se queda con los 8 ángulos de la grilla del juego
 * y algunos cuadros por animación para que el atlas pese poco.
 *
 * Uso: pnpm assets:boss <carpeta del pack> <nombre>      ej: pnpm assets:boss assets-in/bosses/barbaro/x256p_Spritesheets barbaro
 * Sale en apps/client/public/assets/<nombre>.webp y se suma a meta.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'apps', 'client', 'public', 'assets');
const [src, name] = [resolve(process.argv[2] ?? ''), process.argv[3] ?? 'boss'];
if (!process.argv[2] || !existsSync(src)) { console.error('Uso: pnpm assets:boss <carpeta del pack> <nombre>'); process.exit(1); }

const CELL = 256;
// dirección del juego (0=O,1=NO,2=N,3=NE,4=E,5=SE,6=S,7=SO) -> ángulo del pack (0 = mira hacia la cámara, crece en sentido horario)
const ANG = ['090', '135', '180', '225', '270', '315', '000', '045'];
// animación del juego -> carpeta del pack, cuadros que se usan, duración y tipo
const ANIMS: [string, string, number, number, string][] = [
    ['stance', 'Idle_Armed', 8, 1600, 'looped'],
    ['run', 'Run_Armed', 12, 800, 'looped'],
    ['swing', 'Attack_01', 12, 700, 'play_once'],
    ['hit', 'Hit_Armed', 8, 300, 'play_once'],
    ['die', 'Death_Armed', 12, 1400, 'play_once'],
];
const SCALE = Number(process.env.BOSS_SCALE ?? 0.8);

async function frames(dir: string, ang: string, take: number) {
    const im = await loadImage(readFileSync(join(src, dir, `${dir}_Body_${ang}.png`)));
    const cols = Math.round(im.width / CELL), total = cols * Math.round(im.height / CELL);
    return Array.from({ length: take }, (_, k) => {
        const f = Math.min(total - 1, Math.floor((k * total) / take));
        return { im, sx: (f % cols) * CELL, sy: Math.floor(f / cols) * CELL };
    });
}

// 1) caja común: unión de lo dibujado en todos los cuadros
let bx0 = CELL, by0 = CELL, bx1 = 0, by1 = 0;
const plan: { a: number; d: number; fr: Awaited<ReturnType<typeof frames>> }[] = [];
const probe = createCanvas(CELL, CELL), pg = probe.getContext('2d', { willReadFrequently: true });
for (const [a, [, dir, take]] of ANIMS.entries()) for (let d = 0; d < 8; d++) {
    const fr = await frames(dir, ANG[d], take); plan.push({ a, d, fr });
    for (const f of fr) {
        pg.clearRect(0, 0, CELL, CELL); pg.drawImage(f.im, f.sx, f.sy, CELL, CELL, 0, 0, CELL, CELL);
        const px = pg.getImageData(0, 0, CELL, CELL).data;
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (px[(y * CELL + x) * 4 + 3] > 12) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    }
}
const pad = 2, w = bx1 - bx0 + 1 + pad * 2, h = by1 - by0 + 1 + pad * 2;
const cw = Math.round(w * SCALE), ch = Math.round(h * SCALE), cols = Math.max(...ANIMS.map((x) => x[2]));
console.log(`caja ${w}x${h} -> celda ${cw}x${ch}, ${cols} columnas`);

// 2) atlas
const sheet = createCanvas(cw * cols, ch * 8 * ANIMS.length), g = sheet.getContext('2d');
g.imageSmoothingQuality = 'high';
for (const { a, d, fr } of plan) fr.forEach((f, i) => g.drawImage(f.im, f.sx + bx0 - pad, f.sy + by0 - pad, w, h, i * cw, (a * 8 + d) * ch, cw, ch));
writeFileSync(join(out, `${name}.webp`), sheet.toBuffer('image/webp', 82));

// 3) meta: el ancla (pies) queda cerca de la base de la caja
const feet = by1 + pad - (by0 - pad) - 6;
const anims: Record<string, { row: number; n: number; dur: number; type: string }> = {};
ANIMS.forEach(([an, , n, dur, type], i) => (anims[an] = { row: i * 8, n, dur, type }));
const metaPath = join(out, 'meta.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
meta[name] = { cw, ch, ax: Math.round(((w - 1) / 2) * SCALE), ay: Math.round(feet * SCALE), cols, anims, sc: Number(process.env.BOSS_SC ?? 1.7) };
writeFileSync(metaPath, JSON.stringify(meta));
console.log(`Listo: ${name}.webp (${Math.round(sheet.toBuffer('image/webp', 82).length / 1024)} KB)`);
