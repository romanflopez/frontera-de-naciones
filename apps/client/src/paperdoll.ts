/**
 * Muñeco "paper doll" (capas Flare) para las pantallas de entrada: pinta a una clase en un canvas con su equipo inicial,
 * en pose de pausa (stance) con respiración, luz de borde del color de la clase y sombra de contacto.
 * Es independiente de main.ts: carga assets/meta.json y las piezas de assets/paper por su cuenta.
 */
interface PaperMeta { cw: number; ch: number; ax: number; ay: number; cols: number; order: Record<string, string[]>; pieces: Record<string, string>; sets: Record<string, string[]>; anims: Record<string, { row: number; n: number; dur: number; type: string }> }

/** Equipo inicial de cada clase (mismos looks que sus items base de packages/world/src/economy.ts) y dirección que mejor se ve de frente. */
const LOOKS: Record<string, { set: string; head: string; main?: string; off?: string; dir: number }> = {
    guerrero: { set: 'leather', head: 'head_short', main: 'shortsword', off: 'buckler', dir: 5 },
    mago: { set: 'mage', head: 'head_short', main: 'staff', dir: 6 },
};

let metaP: Promise<PaperMeta | null> | null = null;
const loadMeta = () => metaP ??= fetch('assets/meta.json').then((r) => r.json()).then((m) => m.paper as PaperMeta).catch(() => null);
const imgs = new Map<string, Promise<HTMLImageElement>>();
const loadImg = (n: string) => { let p = imgs.get(n); if (!p) { p = new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = `assets/paper/${n}.webp`; }); imgs.set(n, p); } return p; };

interface Doll { cv: HTMLCanvasElement; frames: HTMLCanvasElement[]; meta: PaperMeta; dir: number; col: string; k: number; t0: number }
const dolls = new Set<Doll>();
let running = false;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Compone los cuadros de la pausa (uno por frame) de una dirección con todas las capas en su orden de dibujo. */
async function compose(clsId: string, meta: PaperMeta): Promise<{ frames: HTMLCanvasElement[]; dir: number }> {
    const L = LOOKS[clsId] ?? LOOKS.guerrero;
    const names = [...(meta.sets[L.set] ?? meta.sets.default), L.head, ...(L.main ? [L.main] : []), ...(L.off ? [L.off] : [])];
    const ims = await Promise.all(names.map(loadImg));
    const A = meta.anims.stance, frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < A.n; f++) {
        const c = document.createElement('canvas'); c.width = meta.cw; c.height = meta.ch; const g = c.getContext('2d')!;
        for (const t of meta.order[L.dir]) names.forEach((n, i) => { if (meta.pieces[n] === t) g.drawImage(ims[i], f * meta.cw, (A.row + L.dir) * meta.ch, meta.cw, meta.ch, 0, 0, meta.cw, meta.ch); });
        frames.push(c);
    }
    return { frames, dir: L.dir };
}

function frameAt(meta: PaperMeta, t: number) {
    const A = meta.anims.stance, i = Math.max(0, Math.floor(t / (A.dur / A.n / 1000)));
    const Lp = 2 * A.n - 2, j = i % Lp; return j < A.n ? j : Lp - j;
}

const UP = 2; // ampliación previa con píxeles nítidos; después se reduce con suavizado (borde limpio, sin el borroso del escalado grande)
/** Cuadro ya ampliado y con luz: se levanta el brillo (los sprites son oscuros) y se tiñe un borde de luz del color de la clase. */
function lit(fr: HTMLCanvasElement, col: string): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = fr.width * UP; c.height = fr.height * UP; const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false; g.drawImage(fr, 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-atop';
    const lg = g.createLinearGradient(0, 0, c.width, c.height * 0.4); lg.addColorStop(0, col + '00'); lg.addColorStop(0.45, col + '00'); lg.addColorStop(1, col + '70');
    g.fillStyle = lg; g.fillRect(0, 0, c.width, c.height);
    const tp = g.createLinearGradient(0, 0, 0, c.height); tp.addColorStop(0, 'rgba(255,240,255,.16)'); tp.addColorStop(0.5, 'rgba(255,240,255,0)');
    g.fillStyle = tp; g.fillRect(0, 0, c.width, c.height);
    return c;
}
type FX = { filter: string };
function draw(d: Doll, t: number) {
    const { cv, meta, k } = d, g = cv.getContext('2d')!, W = cv.width, H = cv.height, fy = H - 22 * (H / 400);
    g.clearRect(0, 0, W, H);
    const fr = d.frames[reduce ? 1 : frameAt(meta, t)], breathe = reduce ? 0 : Math.sin(t * 2.1) * 0.012;
    const sy = k * (1 + breathe), ox = W / 2 - meta.ax * k, oy = fy - meta.ay * sy;
    // sombra de contacto
    const sh = g.createRadialGradient(W / 2, fy, 0, W / 2, fy, W * 0.3);
    sh.addColorStop(0, 'rgba(0,0,0,.7)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.translate(0, fy); g.scale(1, 0.18); g.translate(0, -fy); g.fillStyle = sh; g.beginPath(); g.arc(W / 2, fy, W * 0.3, 0, 6.2832); g.fill(); g.restore();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    // halo de borde: copia desenfocada detrás
    g.save(); g.globalAlpha = 0.6; (g as unknown as FX).filter = `blur(${Math.max(2, k * 0.8)}px) brightness(1.5)`; g.globalCompositeOperation = 'lighter';
    g.drawImage(fr, 0, 0, fr.width, fr.height, ox, oy, meta.cw * k, meta.ch * sy); g.restore();
    (g as unknown as FX).filter = 'brightness(1.6) contrast(1.12) saturate(1.2)';
    g.drawImage(fr, 0, 0, fr.width, fr.height, ox, oy, meta.cw * k, meta.ch * sy);
    (g as unknown as FX).filter = 'none';
}

function loop(now: number) {
    for (const d of dolls) {
        if (!d.cv.isConnected) { dolls.delete(d); continue; }
        if (d.cv.offsetParent === null) continue; // pantalla oculta
        draw(d, (now - d.t0) / 1000);
    }
    if (dolls.size) requestAnimationFrame(loop); else running = false;
}

/** Pinta a la clase en el canvas (tamaño de dibujo = tamaño CSS × dpr, el sprite ocupa casi toda la altura). */
export async function mountDoll(cv: HTMLCanvasElement, clsId: string, col: string, heightFrac = 0.82) {
    const meta = await loadMeta(); if (!meta) return;
    const { frames, dir } = await compose(clsId, meta);
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(cv.clientWidth * dpr) || 320; cv.height = Math.round(cv.clientHeight * dpr) || 400;
    // el personaje mide ~64 px de alto en el atlas
    const d: Doll = { cv, frames: frames.map((f) => lit(f, col)), meta, dir, col, k: (cv.height * heightFrac) / 64, t0: performance.now() };
    dolls.add(d); draw(d, 0);
    if (!running) { running = true; requestAnimationFrame(loop); }
}
