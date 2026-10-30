/**
 * Portal de piedra gris (plataforma circular en perspectiva isométrica) con aros entrelazados; el cristal está gris apagado y se enciende violeta-cian al pisarlo.
 * Todo se dibuja por código. El sprite base se pre-renderiza UNA vez en canvas offscreen (en capas) y por frame solo se
 * componen esas capas con alpha (brillo del cristal y de los aros) más un haz de luz y partículas livianas.
 */
const R = 200, SW = 480, SH = 290, CX = 240, CY = 150, FLAT = 0.5;
/** Paleta violeta/neón: cristal de cian a violeta; encendido pasa a magenta-blanco. */
const CYAN = '#4de8ff', VIOLET = '#9a5cff', HOT = '#ff7bf0';

interface Layers { under: HTMLCanvasElement; crystal: HTMLCanvasElement; over: HTMLCanvasElement; glow: HTMLCanvasElement }
let layers: Layers | null = null;

const mk = () => { const c = document.createElement('canvas'); c.width = SW; c.height = SH; return c; };
/** Punto del suelo (radio unitario) proyectado a altura h. */
const px = (r: number, t: number) => CX + Math.cos(t) * r * R;
const py = (r: number, t: number, h: number) => CY - h + Math.sin(t) * r * R * FLAT;

function ellipse(g: CanvasRenderingContext2D, r: number, h: number) { g.beginPath(); g.ellipse(CX, CY - h, r * R, r * R * FLAT, 0, 0, Math.PI * 2); }
function circle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, h: number) {
    g.beginPath();
    for (let i = 0; i <= 48; i++) { const t = (i / 48) * Math.PI * 2, x = CX + (cx + Math.cos(t) * r) * R, y = CY - h + (cy + Math.sin(t) * r) * R * FLAT; i ? g.lineTo(x, y) : g.moveTo(x, y); }
}
/** Escalón cilíndrico: pared lateral + cara superior. */
function tier(g: CanvasRenderingContext2D, r: number, h0: number, h1: number, top: [string, string], side: [string, string]) {
    const rx = r * R, sg = g.createLinearGradient(CX - rx, 0, CX + rx, 0);
    sg.addColorStop(0, side[0]); sg.addColorStop(0.45, side[1]); sg.addColorStop(1, side[0]);
    g.fillStyle = sg; ellipse(g, r, h0); g.fill(); g.fillRect(CX - rx, CY - h1, rx * 2, h1 - h0); 
    const tg = g.createLinearGradient(CX - rx, CY - h1 - rx * FLAT, CX + rx * 0.6, CY - h1 + rx * FLAT);
    tg.addColorStop(0, top[0]); tg.addColorStop(1, top[1]); g.fillStyle = tg; ellipse(g, r, h1); g.fill();
    g.strokeStyle = 'rgba(40,42,54,.5)'; g.lineWidth = 1.5; g.stroke();
}
function crystalFill(g: CanvasRenderingContext2D, h: number, a: number, c1: string, c2: string) {
    const gr = g.createLinearGradient(CX - R * 0.7, CY - h, CX + R * 0.7, CY - h);
    gr.addColorStop(0, c1); gr.addColorStop(0.5, c2); gr.addColorStop(1, c1);
    g.globalAlpha = a; g.fillStyle = gr; ellipse(g, 0.7, h); g.fill();
    const rg = g.createRadialGradient(CX, CY - h, R * 0.1, CX, CY - h, R * 0.72); rg.addColorStop(0, 'rgba(255,255,255,.16)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; ellipse(g, 0.7, h); g.fill(); g.globalAlpha = 1;
}

function build(): Layers {
    const under = mk(), crystal = mk(), over = mk(), glow = mk();
    const u = under.getContext('2d')!, c = crystal.getContext('2d')!, o = over.getContext('2d')!, w = glow.getContext('2d')!;
    const BED = 12, TOP3 = 24;
    // sombra de contacto
    u.fillStyle = 'rgba(8,4,20,.5)'; u.filter = 'blur(6px)'; u.beginPath(); u.ellipse(CX + 6, CY + 8, R * 1.08, R * 0.58, 0, 0, Math.PI * 2); u.fill(); u.filter = 'none';
    // escalones de piedra
    tier(u, 1.0, 0, 10, ['#b4b7c0', '#969aa5'], ['#575a65', '#a0a3ad']);
    tier(u, 0.9, 10, 18, ['#c0c3cb', '#9fa3ae'], ['#626571', '#adb0b9']);
    tier(u, 0.8, 18, TOP3, ['#c9ccd3', '#a8acb6'], ['#6d707b', '#b6b9c2']);
    // grabado: marcas en el escalón exterior
    u.strokeStyle = 'rgba(70,72,86,.45)'; u.lineWidth = 1.5;
    for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; u.beginPath(); u.moveTo(px(0.93, t), py(0.93, t, 10)); u.lineTo(px(0.98, t), py(0.98, t, 10)); u.stroke(); }
    u.lineWidth = 1; u.strokeStyle = 'rgba(70,72,86,.4)'; ellipse(u, 0.95, 10); u.stroke(); ellipse(u, 0.85, 18); u.stroke();
    // hueco del cristal: pared interior + lecho
    u.fillStyle = '#4a4d58'; ellipse(u, 0.7, TOP3); u.fill();
    u.save(); ellipse(u, 0.7, TOP3); u.clip();
    crystalFill(u, BED, 0.9, '#3a404e', '#474c5c'); // apagado: cristal gris
    u.fillStyle = 'rgba(10,12,24,.35)'; ellipse(u, 0.7, BED); u.fill();
    crystalFill(u, BED, 0.35, '#566070', '#626879');
    u.restore();
    // cristal encendido (se compone con alpha variable)
    c.save(); ellipse(c, 0.7, TOP3); c.clip(); crystalFill(c, BED, 1, CYAN, VIOLET);
    const hot = c.createRadialGradient(CX, CY - BED, 0, CX, CY - BED, R * 0.7); hot.addColorStop(0.35, 'rgba(255,255,255,0)'); hot.addColorStop(1, 'rgba(255,120,240,.3)'); c.fillStyle = hot; ellipse(c, 0.7, BED); c.fill(); c.restore();

    // aros entrelazados (sobre el cristal): 8 círculos sobre un anillo + anillo medio, cruces alternos arriba/abajo
    const loops: [number, number][] = [];
    for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2 + Math.PI / 8; loops.push([Math.cos(t) * 0.5, Math.sin(t) * 0.5]); }
    o.save(); ellipse(o, 0.7, TOP3); o.clip();
    const aro = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number, lw: number, col: string) => { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; circle(g, cx, cy, r, BED + 8); g.stroke(); };
    const order = [0, 2, 4, 6, 1, 3, 5, 7];
    for (const i of order) {
        const [lx, ly] = loops[i];
        aro(o, lx, ly, 0.27, 13, 'rgba(36,38,50,.85)'); aro(o, lx, ly, 0.27, 9, '#bfc2cb'); aro(o, lx, ly, 0.27, 3, '#e4e6ec');
        aro(w, lx, ly, 0.27, 4, CYAN);
    }
    aro(o, 0, 0, 0.52, 13, 'rgba(36,38,50,.85)'); aro(o, 0, 0, 0.52, 9, '#c6c9d1'); aro(o, 0, 0, 0.52, 3, '#eceef3');
    o.restore();
    // rombos en los huecos y ornamentos de filigrana en los 4 puntos cardinales internos
    for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2, ox = px(0.66, t), oy = py(0.66, t, BED + 8);
        o.fillStyle = '#d2d5dc'; o.strokeStyle = 'rgba(40,42,54,.7)'; o.lineWidth = 1.5;
        o.beginPath(); o.moveTo(ox, oy - 11); o.lineTo(ox + 18, oy); o.lineTo(ox, oy + 11); o.lineTo(ox - 18, oy); o.closePath(); o.fill(); o.stroke();
        o.fillStyle = '#8a90a0'; o.beginPath(); o.arc(ox, oy, 3.5, 0, Math.PI * 2); o.fill();
        w.fillStyle = CYAN; w.beginPath(); w.arc(ox, oy, 4, 0, Math.PI * 2); w.fill();
    }
    // travesaños diagonales
    for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2 + Math.PI / 4, ca = Math.cos(t), sa = Math.sin(t);
        const ax = px(0.78, t), ay = py(0.78, t, TOP3), bx = px(1.0, t), by = py(1.0, t, 8);
        const nx = -sa * 9, ny = ca * 9 * FLAT;
        o.fillStyle = '#c9ccd4'; o.strokeStyle = 'rgba(40,42,54,.6)'; o.lineWidth = 1.2;
        o.beginPath(); o.moveTo(ax - nx, ay - ny); o.lineTo(bx - nx, by - ny); o.lineTo(bx + nx, by + ny); o.lineTo(ax + nx, ay + ny); o.closePath(); o.fill(); o.stroke();
        w.fillStyle = HOT; w.beginPath(); w.arc(bx, by, 3.5, 0, Math.PI * 2); w.fill();
    }
    // disco central liso, levemente elevado, con grabado fino
    tier(o, 0.4, BED + 2, BED + 12, ['#d0d3da', '#b4b8c2'], ['#868994', '#d2d5dc']);
    o.strokeStyle = 'rgba(70,72,86,.5)'; o.lineWidth = 1.2; ellipse(o, 0.33, BED + 12); o.stroke(); ellipse(o, 0.2, BED + 12); o.stroke();
    for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; o.beginPath(); o.moveTo(px(0.2, t), py(0.2, t, BED + 12)); o.lineTo(px(0.33, t), py(0.33, t, BED + 12)); o.stroke(); }
    w.strokeStyle = VIOLET; w.lineWidth = 2; ellipse(w, 0.33, BED + 12); w.stroke(); ellipse(w, 0.2, BED + 12); w.stroke();
    // ornamentos en los cuatro bordes: remates de piedra con gema
    for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2 + Math.PI / 2 * 0, ex = px(1.02, t), ey = py(1.02, t, 6);
        const dx = Math.cos(t), dy = Math.sin(t) * FLAT, nx = -dy, ny = dx * 0.6;
        const L = 62, Wd = 28;
        o.fillStyle = '#c3c6ce'; o.strokeStyle = 'rgba(40,42,54,.7)'; o.lineWidth = 1.5;
        o.beginPath();
        o.moveTo(ex - dx * 8, ey - dy * 8 - 3);
        o.quadraticCurveTo(ex + nx * Wd, ey + ny * Wd - 2, ex + dx * L, ey + dy * L - 4);
        o.quadraticCurveTo(ex - nx * Wd, ey - ny * Wd - 2, ex - dx * 8, ey - dy * 8 - 3);
        o.closePath(); o.fill(); o.stroke();
        o.fillStyle = '#8b92a3'; o.beginPath(); o.ellipse(ex + dx * 24, ey + dy * 24 - 3, 10, 6, 0, 0, Math.PI * 2); o.fill();
        w.fillStyle = CYAN; w.beginPath(); w.ellipse(ex + dx * 24, ey + dy * 24 - 3, 11, 7, 0, 0, Math.PI * 2); w.fill();
    }
    return { under, crystal, over, glow };
}

export interface PortalStyle { rx: number; beam: number }
export const PORTAL_CITY: PortalStyle = { rx: 78, beam: 150 };
export const PORTAL_ZONE: PortalStyle = { rx: 46, beam: 95 };

/** Plataforma en el suelo: sprite base + brillo del cristal y de los aros según `act` (0 apagado .. 1 encendido). */
export function drawPortalFloor(ctx: CanvasRenderingContext2D, x: number, y: number, st: PortalStyle, act: number, T: number, reduce: boolean, seed: number) {
    layers ||= build();
    const k = st.rx / R, pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(T * 1.3 + seed);
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-CX, -CY);
    ctx.drawImage(layers.under, 0, 0);
    ctx.globalAlpha = Math.min(1, 0.03 + pulse * 0.04 + act * 0.95); ctx.drawImage(layers.crystal, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(layers.over, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, act * (0.75 + pulse * 0.25)); ctx.drawImage(layers.glow, 0, 0);
    ctx.restore();
}

/** Haz de luz y partículas (encima del suelo): suaves en reposo, intensos al activarse. */
export function drawPortalFx(ctx: CanvasRenderingContext2D, x: number, y: number, st: PortalStyle, act: number, T: number, reduce: boolean, seed: number) {
    const k = st.rx / R, bx = x, by = y - 12 * k, rb = 0.5 * R * k, H = st.beam;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // halo en el suelo
    const hg = ctx.createRadialGradient(bx, by, 0, bx, by, rb * 1.5); hg.addColorStop(0, `rgba(120,200,255,${0.04 + act * 0.12})`); hg.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(bx, by, rb * 1.5, rb * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    if (act > 0.01) {
        const flick = reduce ? 1 : 0.85 + 0.15 * Math.sin(T * 5 + seed);
        const g = ctx.createLinearGradient(0, by, 0, by - H);
        g.addColorStop(0, `rgba(110,200,255,${0.06 * act})`); g.addColorStop(0.2, `rgba(110,200,255,${0.3 * act * flick})`); g.addColorStop(0.5, `rgba(150,110,255,${0.22 * act})`); g.addColorStop(1, 'rgba(140,80,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(bx, by, rb, rb * FLAT, 0, 0, Math.PI); ctx.lineTo(bx + rb * 0.55, by - H); ctx.ellipse(bx, by - H, rb * 0.55, rb * 0.55 * FLAT, 0, 0, Math.PI, true); ctx.closePath(); ctx.fill();
        // núcleo brillante
        const cg = ctx.createLinearGradient(0, by, 0, by - H * 0.9); cg.addColorStop(0, 'rgba(235,245,255,0)'); cg.addColorStop(0.2, `rgba(235,245,255,${0.3 * act})`); cg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = cg; ctx.fillRect(bx - rb * 0.12, by - H * 0.9, rb * 0.24, H * 0.9);
        // aro de luz que sube por el haz
        if (!reduce) for (let j = 0; j < 2; j++) { const t = (T * 0.5 + j * 0.5 + seed) % 1; ctx.globalAlpha = Math.sin(t * Math.PI) * 0.6 * act; ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(bx, by - t * H, rb * (0.95 - t * 0.4), rb * (0.95 - t * 0.4) * FLAT, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
    }
    // partículas: pocas y lentas en reposo, más y rápidas al encender
    if (!reduce) {
        const n = 7 + Math.round(act * 15), sp = 0.16 + act * 0.4;
        for (let j = 0; j < n; j++) {
            const t = (T * sp + j * 0.6180339 + seed) % 1, a = j * 2.399 + seed, r = rb * (0.15 + 0.7 * ((j * 0.37) % 1)) * (1 - act * 0.5 * t);
            const rise = t * H * (0.35 + act * 0.65);
            ctx.globalAlpha = Math.sin(t * Math.PI) * (0.35 + act * 0.6);
            ctx.fillStyle = j % 3 ? CYAN : '#d9b8ff';
            ctx.beginPath(); ctx.arc(bx + Math.cos(a + T * 0.4) * r, by + Math.sin(a + T * 0.4) * r * FLAT - rise, (1 + (j % 3) * 0.5) * Math.max(0.8, k * 1.6), 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.restore();
}
