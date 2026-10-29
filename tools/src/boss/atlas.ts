/**
 * Arma el atlas de un boss a partir de un pack de spritesheets 3D (carpetas Anim/Anim_Body_<ángulo>.png,
 * cada hoja = grilla de cuadros de 256 px, 16 ángulos). Se queda con los 8 ángulos de la grilla del juego
 * y algunos cuadros por animación para que el atlas pese poco.
 *
 * Genérico: acepta ángulos cada 22,5/30/45 grados y celdas de 256 o 320 px; los parámetros de cada boss están en PRESETS.
 * Uso: pnpm assets:boss <carpeta del pack> <nombre>      ej: pnpm assets:boss assets-in/bosses/barbaro/x256p_Spritesheets barbaro
 * Sale en apps/client/public/assets/<nombre>.webp y se suma a meta.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'apps', 'client', 'public', 'assets');
const [src, name] = [resolve(process.argv[2] ?? ''), process.argv[3] ?? 'boss'];
if (!process.argv[2] || !existsSync(src)) { console.error('Uso: pnpm assets:boss <carpeta del pack> <nombre>'); process.exit(1); }

// dirección del juego (0=O,1=NO,2=N,3=NE,4=E,5=SE,6=S,7=SO) -> ángulo del pack en grados (0 = mira hacia la cámara, crece en sentido horario).
// Los packs traen 16 ángulos (a veces cada 22,5 y a veces cada 30/45): se usa el disponible más cercano.
const ANG_DEG = [90, 135, 180, 225, 270, 315, 0, 45];
type Anim = [name: string, dir: string, take: number, ms: number, type: string];
const ARMED: Anim[] = [
    ['stance', 'Idle_Armed', 8, 1600, 'looped'],
    ['run', 'Run_Armed', 12, 800, 'looped'],
    ['swing', 'Attack_01', 12, 700, 'play_once'],
    ['hit', 'Hit_Armed', 8, 300, 'play_once'],
    ['die', 'Death_Armed', 12, 1400, 'play_once'],
    ['special', 'Roar', 14, 1300, 'play_once'],
];
/** Por nombre de boss: animaciones (carpeta del pack -> animación del juego), escala del atlas y del sprite en pantalla, y cuánto sube el ancla de los pies desde la base de la caja. */
const PRESETS: Record<string, { anims: Anim[]; scale: number; sc: number; feet: number }> = {
    barbaro: { anims: ARMED, scale: 0.8, sc: 1.8, feet: 3 },
    // araña gigante (x256): la telaraña inmoviliza
    arana: { anims: [['stance', 'Idle_Nervous', 10, 1600, 'looped'], ['run', 'Run', 12, 700, 'looped'], ['swing', 'Attack1', 10, 600, 'play_once'], ['hit', 'Hit', 6, 300, 'play_once'], ['die', 'Die1', 12, 1400, 'play_once'], ['special', 'Attack_Capture (Heavy)', 14, 1500, 'play_once']], scale: 1, sc: 1.7, feet: 20 },
    // gólem de hielo (x320p con sombra): el grito helado hace daño en área
    golem: { anims: [['stance', 'Idle', 10, 1800, 'looped'], ['run', 'Run', 12, 800, 'looped'], ['swing', 'Attack_01', 12, 800, 'play_once'], ['hit', 'Hit', 8, 300, 'play_once'], ['die', 'Death', 12, 1500, 'play_once'], ['special', 'Battlecry', 14, 1500, 'play_once']], scale: 0.55, sc: 2.0, feet: 30 },
    // demonio rojo (x320p con sombra): el salto sísmico hace daño en área
    demonio: { anims: [['stance', 'Idle', 10, 1800, 'looped'], ['run', 'Run', 12, 800, 'looped'], ['swing', 'Attack_Swipe', 12, 800, 'play_once'], ['hit', 'Hit', 8, 300, 'play_once'], ['die', 'Death', 12, 1500, 'play_once'], ['special', 'Attack_Jump', 14, 1300, 'play_once']], scale: 0.55, sc: 1.9, feet: 22 },
};
const preset = PRESETS[name] ?? PRESETS.barbaro;
const ANIMS = preset.anims;
const SCALE = Number(process.env.BOSS_SCALE ?? preset.scale);
// tamaño de celda: sale del nombre de la carpeta (x256p_Spritesheets, x320p_..., x256_...)
const CELL = Number(process.env.BOSS_CELL ?? /x(\d+)p?_/i.exec(basename(src))?.[1] ?? 256);

const dirFiles = new Map<string, { prefix: string; byAng: Map<number, string> }>();
function listDir(dir: string) {
    let e = dirFiles.get(dir);
    if (!e) {
        const byAng = new Map<number, string>(); let prefix = '';
        for (const f of readdirSync(join(src, dir))) { const m = /^(.*)_Body_(\d+)\.png$/.exec(f); if (m) { prefix = m[1]; byAng.set(Number(m[2]), f); } }
        if (!byAng.size) throw new Error(`Sin hojas *_Body_<ángulo>.png en ${dir}`);
        dirFiles.set(dir, e = { prefix, byAng });
    }
    return e;
}
function pickAngle(dir: string, deg: number) {
    const { byAng } = listDir(dir); let best = -1, bd = 1e9;
    for (const a of byAng.keys()) { const d = Math.min(Math.abs(a - deg), 360 - Math.abs(a - deg)); if (d < bd) { bd = d; best = a; } }
    return byAng.get(best)!;
}
const probe = createCanvas(CELL, CELL), pg = probe.getContext('2d', { willReadFrequently: true });
const used = new Map<string, number>();
/** Cuadros realmente dibujados de la hoja (las hojas pueden traer celdas vacías al final). */
function usedFrames(im: Image, total: number, key: string) {
    if (!used.has(key)) {
        const cols = Math.round(im.width / CELL); let last = 0;
        for (let f = total - 1; f >= 0; f--) {
            pg.clearRect(0, 0, CELL, CELL); pg.drawImage(im, (f % cols) * CELL, Math.floor(f / cols) * CELL, CELL, CELL, 0, 0, CELL, CELL);
            const px = pg.getImageData(0, 0, CELL, CELL).data; let any = false;
            for (let i = 3; i < px.length; i += 4) if (px[i] > 12) { any = true; break; }
            if (any) { last = f + 1; break; }
        }
        used.set(key, last || total);
    }
    return used.get(key)!;
}
async function frames(dir: string, deg: number, take: number) {
    const file = pickAngle(dir, deg);
    const im = await loadImage(readFileSync(join(src, dir, file)));
    const cols = Math.round(im.width / CELL), grid = cols * Math.round(im.height / CELL), total = usedFrames(im, grid, dir);
    return Array.from({ length: take }, (_, k) => {
        const f = Math.min(total - 1, Math.floor((k * total) / take));
        return { im, sx: (f % cols) * CELL, sy: Math.floor(f / cols) * CELL };
    });
}

// 1) caja común: unión de lo dibujado en todos los cuadros
let bx0 = CELL, by0 = CELL, bx1 = 0, by1 = 0;
const stT: number[] = [], stB: number[] = [], stW: number[] = []; // pose quieta por dirección: tope, base y ancho (para el ancla, head y hitR)
const plan: { a: number; d: number; fr: Awaited<ReturnType<typeof frames>> }[] = [];
for (const [a, [, dir, take]] of ANIMS.entries()) for (let d = 0; d < 8; d++) {
    const fr = await frames(dir, ANG_DEG[d], take); plan.push({ a, d, fr });
    let t0 = CELL, b0 = 0, l0 = CELL, r0 = 0;
    for (const f of fr) {
        pg.clearRect(0, 0, CELL, CELL); pg.drawImage(f.im, f.sx, f.sy, CELL, CELL, 0, 0, CELL, CELL);
        const px = pg.getImageData(0, 0, CELL, CELL).data;
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (px[(y * CELL + x) * 4 + 3] > 12) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); if (a === 0) { t0 = Math.min(t0, y); b0 = Math.max(b0, y); l0 = Math.min(l0, x); r0 = Math.max(r0, x); } }
    }
    if (a === 0) { stT.push(t0); stB.push(b0); stW.push(r0 - l0); }
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
const med = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1];
// ancla: base de la pose quieta (mediana de las 8 direcciones; no la de la caja, que incluye poses de muerte/salto) menos `feet`
const feet = med(stB) - (by0 - pad) - preset.feet;
const k = 0.8 * Number(process.env.BOSS_SC ?? preset.sc) * SCALE; // 0.8 = SS del cliente
console.log(`calibrar en main.ts (pose quieta): head ~ ${Math.round((feet - (med(stT) - by0 + pad)) * k)}, hitR ~ ${Math.round((med(stW) / 2) * k * 0.9)}`);
const anims: Record<string, { row: number; n: number; dur: number; type: string }> = {};
ANIMS.forEach(([an, , n, dur, type], i) => (anims[an] = { row: i * 8, n, dur, type }));
const metaPath = join(out, 'meta.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
meta[name] = { cw, ch, ax: Math.round(((w - 1) / 2) * SCALE), ay: Math.round(feet * SCALE), cols, anims, sc: Number(process.env.BOSS_SC ?? preset.sc) };
writeFileSync(metaPath, JSON.stringify(meta));
console.log(`Listo: ${name}.webp (${Math.round(sheet.toBuffer('image/webp', 82).length / 1024)} KB)`);
