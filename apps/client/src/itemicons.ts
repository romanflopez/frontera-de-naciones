// Íconos de items pintados por código (arte original, estilo ilustrado suave como los íconos de hechizos):
// siluetas limpias con degradados de volumen, luz de borde, sombras suaves y marco por rareza con glow.
const L = 128; // espacio lógico de dibujo
const OUT = 96; // tamaño final del PNG
const INK = '#140a24';
const cache = new Map<string, string>();
type Ctx = CanvasRenderingContext2D;
type Ramp = [string, string, string, string, string]; // brillo, claro, medio, oscuro, profundo
type P = [number, number];

const RAMP: Record<string, Ramp> = {
    steel: ['#f6fbff', '#cddbe9', '#93a8bc', '#576b80', '#27323f'],
    iron: ['#e6eaee', '#acb6c0', '#727e8a', '#454f5b', '#232a32'],
    plate: ['#ffffff', '#dfeaf5', '#a6bacd', '#6a8097', '#31445a'],
    chain: ['#eef4fa', '#bccad8', '#8196aa', '#4e6073', '#252f3b'],
    wood: ['#ecc088', '#bd8a52', '#8c5c32', '#5b3a1f', '#33200f'],
    leather: ['#e6ae72', '#bc7c46', '#8d5731', '#5d3920', '#33200f'],
    mage: ['#e6d9ff', '#ab8cf4', '#7557d2', '#4c3699', '#261a58'],
    cloth: ['#fff4d8', '#e5d2a6', '#b9a16e', '#84703f', '#4a3d24'],
    gold: ['#fffbe2', '#ffe58c', '#f1ba3c', '#b27b1c', '#5e3d0a'],
    copper: ['#ffe4c6', '#f2a76c', '#c76c32', '#8c401a', '#4a1e0a'],
    silver: ['#ffffff', '#e8eff5', '#b8c4ce', '#7b8894', '#3e4852'],
    bone: ['#fffdf3', '#f0e7ca', '#cdbf97', '#907f5a', '#52482e'],
    dull: ['#cfd2d6', '#9a9ea6', '#686c76', '#42454e', '#22242b'],
};
const LOOK_RAMP: Record<string, string> = {
    shortsword: 'steel', longsword: 'steel', zweihander: 'steel', hand_axe: 'iron', battle_axe: 'steel', mace: 'iron', maul: 'iron', staff: 'wood', wand: 'mage',
    leather: 'leather', chain: 'chain', plate: 'plate', mage: 'mage', cloth: 'cloth', leather_hood: 'leather', chain_coif: 'chain', plate_helm: 'plate', mage_hood: 'mage',
    buckler: 'wood', iron_buckler: 'iron', kite_shield: 'steel',
};

// ---------- utilidades ----------
const mkCanvas = (w: number) => { const cv = document.createElement('canvas'); cv.width = cv.height = w; return cv; };
const rgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`; };
const alpha = (h: string, a: number) => { const x = rgb(h); return `rgba(${x[0]},${x[1]},${x[2]},${a})`; };
const lin = (c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [o, col] of stops) g.addColorStop(o, col); return g; };
const rad = (c: Ctx, x: number, y: number, r0: number, r1: number, stops: [number, string][], x1 = x, y1 = y) => { const g = c.createRadialGradient(x, y, r0, x1, y1, r1); for (const [o, col] of stops) g.addColorStop(o, col); return g; };
/** Degradado "cilindro pulido" a través de un eje. */
const metal = (c: Ctx, r: Ramp, x0: number, y0: number, x1: number, y1: number) => lin(c, x0, y0, x1, y1, [[0, r[3]], [0.16, r[1]], [0.38, r[0]], [0.62, r[2]], [1, r[4]]]);
const soft = (c: Ctx, r: Ramp, x0: number, y0: number, x1: number, y1: number) => lin(c, x0, y0, x1, y1, [[0, r[1]], [0.5, r[2]], [1, r[4]]]);
const path = (c: Ctx, pts: P[]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
/** Contorno suavizado: curvas cuadráticas por los puntos medios. */
const smooth = (c: Ctx, pts: P[]) => {
    const n = pts.length; c.beginPath(); c.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    c.closePath();
};
const mirror = (half: P[]): P[] => [...half, ...half.slice().reverse().map(([x, y]) => [L - x, y] as P)];
const ink = (c: Ctx, w = 3.4) => { c.strokeStyle = INK; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); };
const line = (c: Ctx, col: string, w: number, ...pts: P[]) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
const dot = (c: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
const star = (c: Ctx, x: number, y: number, r: number, col: string) => {
    c.fillStyle = col; c.beginPath(); c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r); c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
};
const glow = (c: Ctx, x: number, y: number, r: number, col: string, a = 0.8) => { c.fillStyle = rad(c, x, y, 0, r, [[0, alpha(col, a)], [1, alpha(col, 0)]]); c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
/** Aplica `fn` con el contorno `draw` como máscara. */
const clipped = (c: Ctx, draw: () => void, fn: () => void) => { c.save(); draw(); c.clip(); fn(); c.restore(); };
/** Sombreado de borde interior + luz arriba-izquierda sobre la forma ya trazada. */
const volume = (c: Ctx, draw: () => void, strength = 0.4) => {
    clipped(c, draw, () => {
        draw(); c.strokeStyle = `rgba(10,4,30,${strength})`; c.lineWidth = 12; c.lineJoin = 'round'; c.stroke();
        c.fillStyle = lin(c, 0, 0, L, L, [[0, 'rgba(255,255,255,.28)'], [0.45, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,30,.22)']]); c.fillRect(0, 0, L, L);
    });
};

// ---------- armas (en eje local: la punta apunta a -y; se rota 45°) ----------
let WS = 1;
function begin(c: Ctx, dy: number, s = WS) { c.save(); c.translate(64, 64 + dy * s); c.scale(s, s); c.rotate(Math.PI / 4); }
function grip(c: Ctx, y0: number, y1: number, w: number) {
    c.beginPath(); c.roundRect(-w, y0, w * 2, y1 - y0, 2.5); c.fillStyle = lin(c, -w, 0, w, 0, [[0, RAMP.leather[1]], [0.5, RAMP.leather[2]], [1, RAMP.leather[4]]]); c.fill(); ink(c, 3);
    c.save(); c.beginPath(); c.roundRect(-w, y0, w * 2, y1 - y0, 2.5); c.clip();
    for (let y = y0 + 2; y < y1; y += 5) line(c, 'rgba(30,12,4,.55)', 1.6, [-w - 1, y + 3], [w + 1, y]);
    c.restore();
}
function pommel(c: Ctx, y: number, r: number, m: Ramp = RAMP.gold) { dot(c, 0, y, r, rad(c, -r * 0.35, y - r * 0.35, 1, r * 1.3, [[0, m[0]], [0.4, m[2]], [1, m[4]]])); c.beginPath(); c.arc(0, y, r, 0, 7); ink(c, 3); dot(c, -r * 0.35, y - r * 0.35, r * 0.22, 'rgba(255,255,255,.8)'); }
function crossguard(c: Ctx, hw: number, thick: number, y: number, curve = 5) {
    const m = RAMP.gold;
    c.beginPath(); c.moveTo(-hw, y - curve); c.quadraticCurveTo(-hw * 0.6, y + thick * 0.2, 0, y); c.quadraticCurveTo(hw * 0.6, y + thick * 0.2, hw, y - curve);
    c.lineTo(hw, y - curve + thick); c.quadraticCurveTo(hw * 0.6, y + thick * 1.2, 0, y + thick); c.quadraticCurveTo(-hw * 0.6, y + thick * 1.2, -hw, y - curve + thick); c.closePath();
    c.fillStyle = lin(c, 0, y - curve, 0, y + thick + 2, [[0, m[0]], [0.35, m[2]], [1, m[4]]]); c.fill(); ink(c, 3);
    dot(c, -hw, y - curve + thick / 2, thick * 0.55, rad(c, -hw - 1, y - curve, 0, thick, [[0, m[0]], [1, m[3]]])); c.beginPath(); c.arc(-hw, y - curve + thick / 2, thick * 0.55, 0, 7); ink(c, 2.4);
    dot(c, hw, y - curve + thick / 2, thick * 0.55, rad(c, hw - 1, y - curve, 0, thick, [[0, m[0]], [1, m[3]]])); c.beginPath(); c.arc(hw, y - curve + thick / 2, thick * 0.55, 0, 7); ink(c, 2.4);
}
function blade(c: Ctx, m: Ramp, tip: number, w: number, base: number, fuller = true, wide = 0) {
    const draw = () => { c.beginPath(); c.moveTo(-w, base); c.lineTo(-w - wide, base - 6); c.lineTo(-w, tip + w * 3.4); c.quadraticCurveTo(-w * 0.5, tip + w * 0.9, 0, tip); c.quadraticCurveTo(w * 0.5, tip + w * 0.9, w, tip + w * 2.6); c.lineTo(w + wide, base - 6); c.lineTo(w, base); c.closePath(); };
    draw(); c.fillStyle = m[2]; c.fill();
    clipped(c, draw, () => {
        c.fillStyle = lin(c, -w, 0, 0, 0, [[0, m[1]], [1, m[0]]]); c.fillRect(-w - wide - 2, tip - 2, w + wide + 2, base - tip + 4);
        c.fillStyle = lin(c, 0, 0, w, 0, [[0, m[2]], [0.6, m[3]], [1, m[4]]]); c.fillRect(0, tip - 2, w + wide + 2, base - tip + 4);
        if (fuller) { line(c, alpha(m[4], 0.55), 2.2, [0, tip + w * 3.4], [0, base - 6]); line(c, 'rgba(255,255,255,.7)', 1.2, [-1.8, tip + w * 3.6], [-1.8, base - 8]); }
        line(c, 'rgba(255,255,255,.85)', 1.4, [-w + 1.6, base - 2], [-w + 1.6, tip + w * 2.7], [-0.5, tip + 3]);
    });
    draw(); ink(c, 3.4);
    star(c, -w * 0.3, tip + w * 3.2, 4, 'rgba(255,255,255,.95)');
}
function sword(c: Ctx, m: Ramp, k: 'short' | 'long' | 'two') {
    if (k === 'short') { begin(c, 14, 1.2); blade(c, m, -56, 6, 0); crossguard(c, 14, 7, 1, 3); grip(c, 6, 20, 3.4); pommel(c, 23, 5); }
    else if (k === 'long') { begin(c, 16, 1.05); blade(c, m, -66, 6.5, 0); crossguard(c, 19, 8, 1, 6); grip(c, 7, 24, 3.6); pommel(c, 28, 6); }
    else { begin(c, 15, 0.92); blade(c, m, -74, 9, 0, true, 3); crossguard(c, 25, 8, 1, 9); dot(c, 0, 4, 7, rad(c, -2, 2, 1, 9, [[0, RAMP.gold[0]], [0.5, RAMP.gold[2]], [1, RAMP.gold[4]]])); c.beginPath(); c.arc(0, 4, 7, 0, 7); ink(c, 3); grip(c, 10, 34, 4); pommel(c, 38, 6.5); }
    c.restore();
}
function haft(c: Ctx, y0: number, y1: number, w = 3.8) {
    c.beginPath(); c.roundRect(-w, y0, w * 2, y1 - y0, 3); c.fillStyle = lin(c, -w, 0, w, 0, [[0, RAMP.wood[1]], [0.35, RAMP.wood[0]], [0.65, RAMP.wood[2]], [1, RAMP.wood[4]]]); c.fill(); ink(c, 3);
    c.save(); c.beginPath(); c.roundRect(-w, y0, w * 2, y1 - y0, 3); c.clip();
    for (let y = y0 + 6; y < y1; y += 13) line(c, 'rgba(40,20,6,.35)', 1, [-w, y], [w, y + 2]);
    c.restore();
}
function axeHead(c: Ctx, m: Ramp, y0: number, y1: number, reach: number, side: 1 | -1) {
    c.save(); c.scale(side, 1);
    const mid = (y0 + y1) / 2, draw = () => { c.beginPath(); c.moveTo(3, y0 + 3); c.quadraticCurveTo(reach * 0.55, y0 - 8, reach, y0 - 7); c.quadraticCurveTo(reach * 0.82, mid, reach, y1 + 7); c.quadraticCurveTo(reach * 0.55, y1 + 8, 3, y1 - 3); c.quadraticCurveTo(10, mid, 3, y0 + 3); c.closePath(); };
    draw(); c.fillStyle = lin(c, 3, 0, reach, 0, [[0, m[3]], [0.35, m[2]], [0.8, m[1]], [1, m[0]]]); c.fill();
    clipped(c, draw, () => {
        c.fillStyle = lin(c, 0, y0, 0, y1, [[0, 'rgba(255,255,255,.4)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, y0 - 12, reach + 4, y1 - y0 + 24);
        line(c, alpha(m[4], 0.5), 2, [9, mid - 10], [14, mid], [9, mid + 10]);
    });
    draw(); ink(c, 3.4);
    c.beginPath(); c.moveTo(reach * 0.55 + 2, y0 - 4); c.quadraticCurveTo(reach * 0.9, y0 - 4, reach - 2, y0 - 4 + 2); c.quadraticCurveTo(reach * 0.78, mid, reach - 2, y1 + 4); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.8; c.stroke();
    c.restore();
}
function axe(c: Ctx, m: Ramp, big: boolean) {
    begin(c, big ? 4 : 2, big ? 0.82 : 0.9); const t = big ? -54 : -44;
    haft(c, t + 6, big ? 56 : 46); pommel(c, big ? 59 : 49, 3.5, RAMP.iron);
    if (big) {
        axeHead(c, m, -50, -6, 30, 1); axeHead(c, m, -50, -6, 30, -1);
        path(c, [[0, -66], [5, -50], [0, -46], [-5, -50]]); c.fillStyle = metal(c, m, -5, 0, 5, 0); c.fill(); ink(c, 3);
    } else { axeHead(c, m, -44, -10, 30, -1); path(c, [[-3, -54], [3, -54], [4, -44], [-4, -44]]); c.fillStyle = metal(c, m, -4, 0, 4, 0); c.fill(); ink(c, 3); }
    line(c, RAMP.leather[2], 3, [-4, big ? -8 : -12], [4, big ? -4 : -8]);
    c.restore();
}
function mace(c: Ctx, m: Ramp, maul: boolean) {
    begin(c, maul ? -1 : 0, maul ? 0.84 : 1.05);
    if (maul) {
        haft(c, -26, 58, 4.2); pommel(c, 61, 3.8, RAMP.iron);
        const draw = () => { c.beginPath(); c.roundRect(-26, -62, 52, 36, 5); };
        draw(); c.fillStyle = lin(c, 0, -62, 0, -26, [[0, m[0]], [0.3, m[1]], [0.7, m[3]], [1, m[4]]]); c.fill();
        clipped(c, draw, () => { c.fillStyle = lin(c, -26, 0, 26, 0, [[0, 'rgba(255,255,255,.3)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,20,.4)']]); c.fillRect(-26, -62, 52, 36); for (const x of [-17, 17]) { c.fillStyle = m[4]; c.fillRect(x - 3, -62, 6, 36); line(c, 'rgba(255,255,255,.35)', 1.2, [x - 3, -60], [x - 3, -28]); } });
        draw(); ink(c, 3.6);
        for (const [x, y] of [[-17, -57], [17, -57], [-17, -31], [17, -31]]) { dot(c, x, y, 2.2, m[0]); }
        line(c, 'rgba(255,255,255,.7)', 1.6, [-23, -59], [23, -59]);
    } else {
        haft(c, -20, 52, 3.8); pommel(c, 55, 3.6, RAMP.iron);
        const cy = -34, spikes = 8;
        for (let i = 0; i < spikes; i++) { const a = (i * Math.PI * 2) / spikes + 0.2; const px = Math.cos(a), py = Math.sin(a); path(c, [[px * 13 - py * 5, cy + py * 13 + px * 5], [px * 24, cy + py * 24], [px * 13 + py * 5, cy + py * 13 - px * 5]]); c.fillStyle = m[i % 2 ? 1 : 2]; c.fill(); ink(c, 2.8); }
        dot(c, 0, cy, 16, rad(c, -6, cy - 7, 1, 20, [[0, m[0]], [0.35, m[1]], [0.75, m[3]], [1, m[4]]])); c.beginPath(); c.arc(0, cy, 16, 0, 7); ink(c, 3.4);
        dot(c, -6, cy - 7, 3.2, 'rgba(255,255,255,.85)'); line(c, m[4], 2, [-15, cy + 3], [15, cy + 3]);
    }
    c.restore();
}
function staff(c: Ctx, wand: boolean) {
    const m = RAMP.mage;
    begin(c, wand ? 8 : 6, wand ? 1.1 : 0.9);
    if (wand) {
        haft(c, -32, 52, 2.8); pommel(c, 54, 3.2, RAMP.gold);
        c.beginPath(); c.roundRect(-4.5, -34, 9, 8, 2); c.fillStyle = metal(c, RAMP.gold, -4, 0, 4, 0); c.fill(); ink(c, 2.6);
        glow(c, 0, -50, 26, '#b58cff', 0.75);
        path(c, [[0, -68], [8, -52], [0, -36], [-8, -52]]); c.fillStyle = lin(c, -8, -68, 8, -36, [[0, '#f2e8ff'], [0.4, '#b88cff'], [1, '#5a2ec0']]); c.fill(); ink(c, 3);
        line(c, 'rgba(255,255,255,.85)', 1.6, [0, -66], [-5, -52], [0, -40]); line(c, 'rgba(80,30,160,.6)', 1.4, [0, -66], [4, -52], [0, -40]);
        c.restore(); star(c, 90, 30, 6, 'rgba(255,255,255,.9)'); star(c, 34, 62, 4, 'rgba(210,180,255,.9)'); return;
    }
    haft(c, -36, 62, 4.2);
    for (const y of [-6, 26]) { c.beginPath(); c.roundRect(-5.6, y, 11.2, 5, 2); c.fillStyle = metal(c, RAMP.gold, -5, 0, 5, 0); c.fill(); ink(c, 2.4); }
    glow(c, 0, -50, 34, '#8aa8ff', 0.8);
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 3, -34); c.bezierCurveTo(s * 22, -34, s * 24, -66, s * 8, -72); c.strokeStyle = INK; c.lineWidth = 7; c.lineCap = 'round'; c.stroke(); c.strokeStyle = lin(c, -20, 0, 20, 0, [[0, RAMP.wood[0]], [1, RAMP.wood[3]]]); c.lineWidth = 3.6; c.stroke(); }
    dot(c, 0, -52, 13, rad(c, -4, -57, 1, 17, [[0, '#ffffff'], [0.3, '#a9c4ff'], [0.7, '#4a6ee0'], [1, '#1c2a78']])); c.beginPath(); c.arc(0, -52, 13, 0, 7); ink(c, 3.2);
    dot(c, -4, -57, 3.6, 'rgba(255,255,255,.95)'); line(c, 'rgba(255,255,255,.4)', 1.4, [-9, -48], [-3, -41]);
    c.restore(); star(c, 92, 26, 6, 'rgba(255,255,255,.95)'); star(c, 106, 54, 4, 'rgba(160,190,255,.9)'); void m;
}

// ---------- armaduras ----------
function mail(c: Ctx, x0: number, y0: number, x1: number, y1: number, step = 7) {
    for (let y = y0, r = 0; y < y1; y += step * 0.8, r++) for (let x = x0 + (r % 2) * step * 0.5; x < x1; x += step) { c.strokeStyle = 'rgba(8,14,26,.4)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, step * 0.42, 0.1, Math.PI - 0.1); c.stroke(); c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1; c.beginPath(); c.arc(x, y - 1.4, step * 0.42, Math.PI + 0.3, Math.PI * 2 - 0.3); c.stroke(); }
}
function neckHole(c: Ctx, w = 12) { c.beginPath(); c.ellipse(64, 24, w, 7, 0, 0, Math.PI); c.closePath(); c.fillStyle = '#0c0618'; c.fill(); ink(c, 2.6); }
function belt(c: Ctx, y: number, x0: number, x1: number, col: Ramp = RAMP.leather) {
    c.fillStyle = lin(c, 0, y, 0, y + 9, [[0, col[1]], [0.5, col[2]], [1, col[4]]]); c.fillRect(x0, y, x1 - x0, 9); c.strokeStyle = INK; c.lineWidth = 2.4; c.strokeRect(x0, y, x1 - x0, 9);
    c.beginPath(); c.roundRect(57, y - 2, 14, 13, 2); c.fillStyle = metal(c, RAMP.gold, 57, 0, 71, 0); c.fill(); ink(c, 2.4); c.fillStyle = INK; c.fillRect(61, y + 2, 6, 5);
}
function armor(c: Ctx, look: string) {
    const m = RAMP[LOOK_RAMP[look] ?? 'iron'];
    const robe = look === 'mage', cloth = look === 'cloth', plate = look === 'plate', chain = look === 'chain';
    let half: P[];
    if (robe) half = [[70, 20], [90, 24], [108, 40], [118, 84], [104, 90], [100, 62], [96, 76], [100, 108], [64, 110]];
    else if (cloth) half = [[70, 20], [92, 24], [106, 38], [112, 66], [100, 68], [94, 58], [92, 96], [64, 98]];
    else if (plate) half = [[70, 20], [92, 26], [100, 42], [92, 54], [94, 78], [98, 104], [80, 108], [64, 104]];
    else if (chain) half = [[70, 20], [92, 24], [108, 38], [114, 70], [102, 74], [95, 60], [94, 98], [88, 106], [80, 100], [72, 108], [64, 102]];
    else half = [[70, 20], [92, 24], [106, 38], [110, 62], [99, 64], [94, 56], [92, 96], [64, 100]];
    const draw = () => smooth(c, mirror(half));
    draw(); c.fillStyle = plate ? metal(c, m, 18, 0, 110, 0) : lin(c, 18, 0, 110, 0, [[0, m[1]], [0.3, m[0]], [0.55, m[2]], [1, m[4]]]); c.fill();
    clipped(c, draw, () => {
        if (chain) mail(c, 12, 26, 120, 112);
        if (cloth) for (let y = 30; y < 104; y += 5) line(c, 'rgba(60,40,10,.14)', 1, [10, y], [118, y]);
        if (plate) {
            line(c, 'rgba(255,255,255,.7)', 2, [64, 28], [64, 100]); line(c, 'rgba(10,20,40,.4)', 2, [66, 28], [66, 100]);
            for (const y of [56, 70, 84]) { line(c, 'rgba(20,32,54,.5)', 2.6, [34, y], [64, y + 5], [94, y]); line(c, 'rgba(255,255,255,.55)', 1.2, [34, y - 2], [64, y + 3], [94, y - 2]); }
        }
        if (robe) { for (const x of [34, 48, 80, 94]) line(c, 'rgba(20,10,60,.3)', 3, [x, 70], [x + (x < 64 ? -3 : 3), 110]); c.fillStyle = lin(c, 0, 60, 0, 112, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(20,10,60,.35)']]); c.fillRect(0, 60, L, 52); }
        if (!robe && !cloth && !plate && !chain) { for (const x of [42, 86]) { c.setLineDash([4, 4]); line(c, 'rgba(30,12,4,.6)', 1.6, [x, 46], [x, 96]); c.setLineDash([]); } }
        c.fillStyle = lin(c, 0, 0, L, L, [[0, 'rgba(255,255,255,.22)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,30,.28)']]); c.fillRect(0, 0, L, L);
        draw(); c.strokeStyle = 'rgba(10,4,30,.4)'; c.lineWidth = 12; c.lineJoin = 'round'; c.stroke();
    });
    draw(); ink(c, 3.6);
    neckHole(c, robe ? 14 : 12);
    if (plate) {
        for (const s of [-1, 1]) { const x = 64 + s * 40; c.beginPath(); c.ellipse(x, 40, 17, 14, s * 0.35, 0, 7); c.fillStyle = rad(c, x - s * 4, 34, 1, 22, [[0, m[0]], [0.5, m[2]], [1, m[4]]]); c.fill(); ink(c, 3.4); dot(c, x - s * 3, 36, 2, 'rgba(255,255,255,.8)'); line(c, RAMP.gold[2], 2.4, [x - 12, 46], [x + 12, 44]); }
        path(c, [[54, 30], [74, 30], [70, 42], [58, 42]]); c.fillStyle = metal(c, RAMP.gold, 54, 0, 74, 0); c.fill(); ink(c, 2.4);
        for (const x of [40, 88]) for (const y of [60, 74]) dot(c, x, y, 2, RAMP.gold[1]);
        belt(c, 90, 34, 94, RAMP.iron);
    } else if (robe) {
        line(c, RAMP.gold[2], 3, [30, 108], [98, 108]); for (const s of [-1, 1]) line(c, RAMP.gold[1], 2.6, [64 + s * 8, 28], [64 + s * 10, 112]);
        belt(c, 68, 34, 94, RAMP.gold); glow(c, 64, 54, 14, '#9af', 0.6); path(c, [[64, 44], [71, 54], [64, 66], [57, 54]]); c.fillStyle = lin(c, 57, 44, 71, 66, [[0, '#e6f4ff'], [0.5, '#4aa8ff'], [1, '#1c3c98']]); c.fill(); ink(c, 2.4);
    } else if (cloth) { belt(c, 72, 34, 96, RAMP.leather); for (const y of [30, 38, 46]) line(c, RAMP.leather[1], 1.8, [58, y], [70, y + 4], [58, y + 8]); }
    else if (chain) { belt(c, 76, 36, 94, RAMP.leather); line(c, 'rgba(255,255,255,.9)', 1.6, [28, 38], [44, 32]); }
    else { belt(c, 74, 36, 94, RAMP.leather); for (const s of [-1, 1]) { path(c, [[64 + s * 28, 28], [64 + s * 42, 34], [64 + s * 44, 48], [64 + s * 30, 44]]); c.fillStyle = soft(c, m, 20, 0, 108, 0); c.fill(); ink(c, 3); } line(c, RAMP.leather[0], 1.6, [66, 28], [74, 40], [66, 52]); }
}

// ---------- cascos y capuchas ----------
function helm(c: Ctx, look: string) {
    const m = RAMP[LOOK_RAMP[look] ?? 'iron'];
    if (look === 'plate_helm') {
        const draw = () => { c.beginPath(); c.moveTo(24, 108); c.lineTo(24, 62); c.bezierCurveTo(22, 20, 50, 14, 64, 14); c.bezierCurveTo(78, 14, 106, 20, 104, 62); c.lineTo(104, 108); c.lineTo(88, 98); c.lineTo(88, 88); c.lineTo(40, 88); c.lineTo(40, 98); c.closePath(); };
        draw(); c.fillStyle = metal(c, m, 22, 0, 106, 0); c.fill(); volume(c, draw, 0.35); draw(); ink(c, 3.6);
        c.beginPath(); c.roundRect(34, 56, 60, 12, 3); c.fillStyle = '#0a0414'; c.fill(); ink(c, 2.6);
        c.beginPath(); c.roundRect(58, 40, 12, 48, 2); c.fillStyle = metal(c, m, 58, 0, 70, 0); c.fill(); ink(c, 2.6);
        for (let i = 0; i < 3; i++) for (const x of [44, 84]) dot(c, x, 74 + i * 5, 1.5, '#0a0414');
        line(c, RAMP.gold[2], 4, [28, 48], [64, 36], [100, 48]); line(c, RAMP.gold[0], 1.4, [29, 46], [64, 34]);
        path(c, [[58, 18], [64, 2], [70, 18]]); c.fillStyle = metal(c, RAMP.gold, 58, 0, 70, 0); c.fill(); ink(c, 2.8);
        line(c, 'rgba(255,255,255,.7)', 2, [34, 40], [40, 28]);
        return;
    }
    const mage = look === 'mage_hood', chn = look === 'chain_coif';
    const draw = () => {
        c.beginPath();
        if (mage) { c.moveTo(24, 110); c.bezierCurveTo(16, 62, 36, 36, 56, 24); c.bezierCurveTo(70, 16, 88, 14, 108, 4); c.bezierCurveTo(98, 18, 100, 30, 102, 40); c.bezierCurveTo(112, 64, 108, 90, 104, 110); c.quadraticCurveTo(64, 96, 24, 110); }
        else if (chn) { c.moveTo(20, 112); c.bezierCurveTo(14, 60, 22, 18, 64, 14); c.bezierCurveTo(106, 18, 114, 60, 108, 112); c.lineTo(98, 104); c.lineTo(90, 112); c.lineTo(78, 104); c.lineTo(64, 112); c.lineTo(50, 104); c.lineTo(38, 112); c.lineTo(30, 104); c.closePath(); }
        else { c.moveTo(22, 108); c.bezierCurveTo(14, 56, 28, 26, 58, 16); c.quadraticCurveTo(70, 8, 78, 4); c.quadraticCurveTo(76, 14, 84, 20); c.bezierCurveTo(112, 36, 114, 70, 106, 108); c.quadraticCurveTo(64, 96, 22, 108); }
    };
    draw(); c.fillStyle = lin(c, 16, 0, 112, 0, [[0, m[1]], [0.3, m[0]], [0.6, m[2]], [1, m[4]]]); c.fill();
    clipped(c, draw, () => {
        if (chn) mail(c, 10, 18, 120, 116, 7);
        if (mage) for (let i = 0; i < 4; i++) line(c, 'rgba(20,10,70,.28)', 3, [40 + i * 14, 100], [34 + i * 14, 40]);
        if (!mage && !chn) { for (let y = 20; y < 100; y += 5) line(c, 'rgba(30,12,4,.12)', 1, [10, y], [118, y + 1]); }
    });
    volume(c, draw, 0.38); draw(); ink(c, 3.6);
    const face = () => { c.beginPath(); c.ellipse(64, 66, mage ? 22 : 20, 28, 0, 0, 7); };
    face(); c.fillStyle = rad(c, 64, 60, 4, 34, [[0, '#1a0f2e'], [1, '#07030f']]); c.fill(); ink(c, 3);
    if (mage) { face(); c.strokeStyle = RAMP.gold[2]; c.lineWidth = 3.2; c.stroke(); line(c, RAMP.gold[1], 3, [30, 106], [100, 106]); for (const x of [56, 72]) { glow(c, x, 62, 8, '#7cf', 0.9); dot(c, x, 62, 2.4, '#e8fbff'); } }
    else if (chn) { face(); c.strokeStyle = m[1]; c.lineWidth = 3; c.stroke(); for (const x of [56, 72]) dot(c, x, 62, 2, 'rgba(255,255,255,.18)'); }
    else { face(); c.strokeStyle = RAMP.leather[0]; c.lineWidth = 2.6; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]); for (const x of [56, 72]) dot(c, x, 62, 2, 'rgba(255,255,255,.12)'); line(c, RAMP.leather[4], 2, [64, 18], [64, 36]); c.beginPath(); c.roundRect(60, 96, 8, 10, 2); c.fillStyle = metal(c, RAMP.gold, 60, 0, 68, 0); c.fill(); ink(c, 2.2); }
    line(c, 'rgba(255,255,255,.55)', 2.2, [30, 76], [32, 46], [44, 28]);
}

// ---------- joyas ----------
function gem(c: Ctx, x: number, y: number, r: number, g: [string, string, string], oval = false) {
    const p: P[] = oval ? [[x, y - r * 1.15], [x + r * 0.8, y], [x, y + r * 1.15], [x - r * 0.8, y]] : [[x - r * 0.55, y - r], [x + r * 0.55, y - r], [x + r, y - r * 0.2], [x, y + r * 1.1], [x - r, y - r * 0.2]];
    glow(c, x, y, r * 2.4, g[1], 0.5);
    path(c, p); c.fillStyle = lin(c, x - r, y - r, x + r, y + r, [[0, g[0]], [0.45, g[1]], [1, g[2]]]); c.fill(); ink(c, 2.6);
    path(c, [p[0], p[1], [x + r * 0.35, y - r * 0.1], [x - r * 0.35, y - r * 0.1]]); c.fillStyle = 'rgba(255,255,255,.35)'; c.fill();
    star(c, x - r * 0.3, y - r * 0.4, r * 0.55, 'rgba(255,255,255,.95)');
}
const JEWEL: Record<string, { band: Ramp; gem: [string, string, string] | null; plate?: boolean }> = {
    ring_copper: { band: RAMP.copper, gem: ['#fff0d0', '#ffa040', '#a8480c'] },
    ring_silver: { band: RAMP.silver, gem: ['#e6f2ff', '#5aa0ff', '#1c3c98'] },
    ring_jade: { band: RAMP.gold, gem: ['#e0ffec', '#40d890', '#146a3c'] },
    ring_ruby: { band: RAMP.silver, gem: ['#ffe0e0', '#ff3c4c', '#8a0a1c'] },
    ring_gold: { band: RAMP.gold, gem: null, plate: true },
};
function ring(c: Ctx, look?: string) {
    const j = JEWEL[look ?? ''] ?? { band: RAMP.dull, gem: ['#9a9ea8', '#5c606c', '#2a2c34'] as [string, string, string] };
    const dull = !JEWEL[look ?? ''], cx = 64, cy = 76;
    c.beginPath(); c.ellipse(cx, cy, 28, 34, 0, 0, 7); c.strokeStyle = INK; c.lineWidth = 17; c.stroke();
    c.strokeStyle = lin(c, 30, 0, 98, 0, [[0, j.band[3]], [0.2, j.band[1]], [0.4, j.band[0]], [0.7, j.band[2]], [1, j.band[4]]]); c.lineWidth = 11; c.stroke();
    c.beginPath(); c.ellipse(cx, cy, 28, 34, 0, Math.PI * 0.62, Math.PI * 0.95); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 2.4; c.stroke();
    if (j.plate) { c.beginPath(); c.roundRect(46, 26, 36, 26, 5); c.fillStyle = metal(c, j.band, 46, 26, 82, 52); c.fill(); ink(c, 3.2); c.beginPath(); c.roundRect(51, 31, 26, 16, 3); c.strokeStyle = j.band[3]; c.lineWidth = 1.8; c.stroke(); line(c, j.band[4], 2.4, [56, 44], [64, 34], [72, 44]); line(c, 'rgba(255,255,255,.8)', 1.4, [48, 29], [76, 29]); }
    else if (j.gem) {
        path(c, [[50, 40], [78, 40], [74, 52], [54, 52]]); c.fillStyle = metal(c, j.band, 50, 0, 78, 0); c.fill(); ink(c, 2.8);
        if (dull) { dot(c, 64, 30, 11, rad(c, 60, 26, 1, 14, [[0, j.gem[0]], [0.6, j.gem[1]], [1, j.gem[2]]])); c.beginPath(); c.arc(64, 30, 11, 0, 7); ink(c, 3); }
        else gem(c, 64, 31, 13, j.gem, look === 'ring_jade');
    }
}
function amulet(c: Ctx) {
    c.beginPath(); c.moveTo(18, 10); c.bezierCurveTo(22, 58, 46, 54, 64, 50); c.bezierCurveTo(82, 54, 106, 58, 110, 10); c.strokeStyle = INK; c.lineWidth = 7; c.lineCap = 'round'; c.stroke(); c.strokeStyle = lin(c, 0, 0, 0, 60, [[0, RAMP.leather[1]], [1, RAMP.leather[3]]]); c.lineWidth = 3.6; c.stroke();
    for (const x of [42, 86]) { const y = x < 64 ? 50 : 50; dot(c, x, y - 2, 6, rad(c, x - 2, y - 5, 1, 8, [[0, RAMP.bone[0]], [0.6, RAMP.bone[2]], [1, RAMP.bone[4]]])); c.beginPath(); c.arc(x, y - 2, 6, 0, 7); ink(c, 2.4); }
    c.save(); c.translate(64, 52); c.rotate(0.12);
    const fang = () => { c.beginPath(); c.moveTo(-14, 0); c.bezierCurveTo(-18, 24, -8, 44, 8, 60); c.bezierCurveTo(10, 40, 18, 22, 14, 0); c.quadraticCurveTo(0, -8, -14, 0); c.closePath(); };
    fang(); c.fillStyle = lin(c, -16, 0, 16, 0, [[0, RAMP.bone[1]], [0.35, RAMP.bone[0]], [0.7, RAMP.bone[2]], [1, RAMP.bone[4]]]); c.fill(); volume(c, fang, 0.3); fang(); ink(c, 3.2);
    c.beginPath(); c.ellipse(0, 4, 15, 7, 0, 0, 7); c.fillStyle = metal(c, RAMP.leather, -15, 0, 15, 0); c.fill(); ink(c, 2.6); for (const x of [-8, 0, 8]) line(c, 'rgba(30,12,4,.5)', 1.4, [x, -2], [x - 1, 10]);
    line(c, 'rgba(255,255,255,.7)', 2, [-7, 18], [-5, 36]);
    c.restore();
}

// ---------- escudos ----------
function shield(c: Ctx, look: string) {
    const m = RAMP[LOOK_RAMP[look] ?? 'iron'];
    if (look === 'kite_shield') {
        const draw = () => { c.beginPath(); c.moveTo(64, 10); c.bezierCurveTo(84, 18, 100, 18, 112, 22); c.bezierCurveTo(112, 70, 94, 98, 64, 120); c.bezierCurveTo(34, 98, 16, 70, 16, 22); c.bezierCurveTo(28, 18, 44, 18, 64, 10); c.closePath(); };
        draw(); c.fillStyle = lin(c, 16, 0, 112, 0, [[0, m[2]], [0.35, m[0]], [0.55, m[1]], [1, m[4]]]); c.fill();
        clipped(c, draw, () => { c.fillStyle = 'rgba(40,70,160,.32)'; c.fillRect(64, 0, 70, 128); c.fillStyle = 'rgba(60,90,200,.18)'; c.fillRect(0, 0, 64, 128); line(c, RAMP.gold[1], 11, [64, 14], [64, 112]); line(c, RAMP.gold[1], 11, [20, 44], [108, 44]); line(c, RAMP.gold[0], 2, [62, 14], [62, 112]); line(c, RAMP.gold[0], 2, [20, 42], [108, 42]); });
        volume(c, draw, 0.35); draw(); ink(c, 3.6);
        draw(); c.save(); c.clip(); draw(); c.strokeStyle = RAMP.gold[2]; c.lineWidth = 8; c.stroke(); draw(); c.strokeStyle = RAMP.gold[0]; c.lineWidth = 1.6; c.translate(-1, -1); c.stroke(); c.restore(); draw(); ink(c, 3.4);
        dot(c, 64, 44, 8, rad(c, 61, 41, 1, 10, [[0, '#fff'], [0.4, RAMP.gold[1]], [1, RAMP.gold[4]]])); c.beginPath(); c.arc(64, 44, 8, 0, 7); ink(c, 2.6);
        return;
    }
    const wood = look === 'buckler', cx = 64, cy = 64, R = 46;
    c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fillStyle = wood ? soft(c, RAMP.wood, 20, 20, 108, 108) : metal(c, m, 18, 0, 110, 0); c.fill();
    clipped(c, () => { c.beginPath(); c.arc(cx, cy, R, 0, 7); }, () => {
        if (wood) { for (let x = 24; x < 110; x += 11) line(c, 'rgba(40,20,6,.5)', 1.8, [x, 16], [x, 112]); for (let x = 29; x < 110; x += 11) line(c, 'rgba(255,230,180,.16)', 1.4, [x, 16], [x, 112]); }
        c.fillStyle = lin(c, 0, 0, L, L, [[0, 'rgba(255,255,255,.3)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,30,.35)']]); c.fillRect(0, 0, L, L);
    });
    c.beginPath(); c.arc(cx, cy, R, 0, 7); ink(c, 3.6);
    c.beginPath(); c.arc(cx, cy, R - 4, 0, 7); c.strokeStyle = wood ? lin(c, 20, 20, 108, 108, [[0, RAMP.iron[0]], [0.5, RAMP.iron[2]], [1, RAMP.iron[4]]]) : lin(c, 20, 20, 108, 108, [[0, m[0]], [0.5, m[2]], [1, m[4]]]); c.lineWidth = 8; c.stroke();
    c.beginPath(); c.arc(cx, cy, R - 8, 0, 7); ink(c, 2.2); c.beginPath(); c.arc(cx, cy, R, 0, 7); ink(c, 2.4);
    c.beginPath(); c.arc(cx, cy, R - 4, Math.PI * 1.05, Math.PI * 1.55); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.stroke();
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + 0.39; dot(c, cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4), 2.3, RAMP.iron[0]); }
    dot(c, cx, cy, 15, rad(c, cx - 5, cy - 6, 1, 19, [[0, '#fff'], [0.3, RAMP.steel[1]], [0.7, RAMP.steel[3]], [1, RAMP.steel[4]]])); c.beginPath(); c.arc(cx, cy, 15, 0, 7); ink(c, 3.2);
    dot(c, cx - 5, cy - 6, 3, 'rgba(255,255,255,.9)');
}

// ---------- consumibles y misceláneos ----------
function potion(c: Ctx, kind: 'hp' | 'mp') {
    const hp = kind === 'hp', L0 = hp ? '#ffb4b0' : '#b4dcff', L1 = hp ? '#ff4a4a' : '#3d8dff', L2 = hp ? '#a0121c' : '#1228a8', GL = hp ? '#ff5050' : '#4aa0ff';
    glow(c, 64, 84, 52, GL, 0.35);
    const body = () => { c.beginPath(); c.moveTo(54, 30); c.lineTo(54, 50); c.bezierCurveTo(30, 58, 22, 80, 28, 96); c.bezierCurveTo(34, 114, 94, 114, 100, 96); c.bezierCurveTo(106, 80, 98, 58, 74, 50); c.lineTo(74, 30); c.closePath(); };
    body(); c.fillStyle = 'rgba(120,150,200,.35)'; c.fill();
    clipped(c, body, () => {
        c.fillStyle = lin(c, 0, 64, 0, 112, [[0, L0], [0.35, L1], [1, L2]]); c.beginPath(); c.moveTo(0, 74); c.quadraticCurveTo(32, 66, 64, 74); c.quadraticCurveTo(96, 82, 128, 72); c.lineTo(128, 128); c.lineTo(0, 128); c.fill();
        c.fillStyle = rad(c, 50, 84, 2, 44, [[0, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]); c.fillRect(0, 40, L, 80);
        c.fillStyle = lin(c, 0, 0, L, 0, [[0, 'rgba(0,0,0,0)'], [0.7, 'rgba(0,0,30,0)'], [1, 'rgba(0,0,30,.35)']]); c.fillRect(0, 0, L, L);
    });
    body(); ink(c, 3.6);
    c.beginPath(); c.roundRect(48, 24, 32, 9, 3); c.fillStyle = lin(c, 48, 0, 80, 0, [[0, '#d8e2f0'], [0.5, '#8ea4c0'], [1, '#4a5c78']]); c.fill(); ink(c, 2.6);
    c.beginPath(); c.moveTo(54, 24); c.lineTo(56, 8); c.quadraticCurveTo(64, 4, 72, 8); c.lineTo(74, 24); c.closePath(); c.fillStyle = lin(c, 54, 0, 74, 0, [[0, RAMP.wood[0]], [0.5, RAMP.wood[2]], [1, RAMP.wood[4]]]); c.fill(); ink(c, 2.8);
    line(c, 'rgba(255,255,255,.8)', 3.4, [36, 72], [38, 88]); dot(c, 42, 66, 2.6, 'rgba(255,255,255,.85)');
    dot(c, 72, 92, 3.2, 'rgba(255,255,255,.35)'); dot(c, 80, 84, 2, 'rgba(255,255,255,.4)'); dot(c, 60, 100, 2, 'rgba(255,255,255,.3)');
    if (!hp) { star(c, 78, 76, 5, 'rgba(255,255,255,.9)'); }
}
function keyShape(c: Ctx, kind: 'cripta' | 'foso', broken: boolean) {
    const m = kind === 'cripta' ? RAMP.gold : RAMP.silver, acc = kind === 'cripta' ? ['#ffe0ff', '#c050ff', '#5a1a98'] : ['#e0fff0', '#40e0a8', '#0a6a58'];
    begin(c, 0, 1.12);
    const bow = () => { if (kind === 'cripta') { for (const [x, y] of [[0, 28], [-12, 44], [12, 44]]) { c.beginPath(); c.arc(x, y, 11, 0, 7); c.fillStyle = metal(c, m, x - 11, 0, x + 11, 0); c.fill(); ink(c, 3); } c.beginPath(); c.arc(0, 40, 9, 0, 7); c.fillStyle = '#0c0618'; c.fill(); ink(c, 2.4); dot(c, 0, 40, 5, rad(c, -1, 38, 1, 7, [[0, acc[0]], [0.5, acc[1]], [1, acc[2]]])); } else { path(c, [[0, 18], [16, 40], [0, 62], [-16, 40]]); c.fillStyle = metal(c, m, -16, 0, 16, 0); c.fill(); ink(c, 3.2); path(c, [[0, 28], [8, 40], [0, 52], [-8, 40]]); c.fillStyle = '#0c0618'; c.fill(); ink(c, 2.2); dot(c, 0, 40, 4.5, rad(c, -1, 38, 1, 6, [[0, acc[0]], [0.5, acc[1]], [1, acc[2]]])); } };
    const shaftEnd = broken ? -6 : -54;
    c.beginPath(); c.roundRect(-4.5, shaftEnd, 9, 52 - shaftEnd, 2); c.fillStyle = metal(c, m, -4.5, 0, 4.5, 0); c.fill(); ink(c, 3);
    if (broken) { path(c, [[-4.5, -6], [-1, -12], [1, -5], [4.5, -11], [4.5, -2], [-4.5, 0]]); c.fillStyle = m[3]; c.fill(); ink(c, 2.2); }
    else { for (const [y, h] of [[-54, 8], [-42, 6]] as P[]) { c.beginPath(); c.rect(4, y, 14, h); c.fillStyle = metal(c, m, 4, 0, 18, 0); c.fill(); ink(c, 2.8); } }
    bow();
    c.beginPath(); c.roundRect(-7, 6, 14, 5, 2); c.fillStyle = metal(c, m, -7, 0, 7, 0); c.fill(); ink(c, 2.4);
    line(c, 'rgba(255,255,255,.75)', 1.6, [-2.5, shaftEnd + 4], [-2.5, 24]);
    c.restore();
    if (broken) {
        c.save(); c.translate(94, 34); c.rotate(0.9); c.beginPath(); c.roundRect(-4, -14, 8, 26, 2); c.fillStyle = metal(c, m, -4, 0, 4, 0); c.fill(); ink(c, 2.6); c.beginPath(); c.rect(4, -12, 9, 6); c.fillStyle = metal(c, m, 4, 0, 13, 0); c.fill(); ink(c, 2.4); c.restore();
        glow(c, 64, 64, 40, acc[1], 0.2);
    }
    star(c, 98, 100, 5, 'rgba(255,255,255,.9)');
}
function coin(c: Ctx) {
    const m = RAMP.gold;
    const stack = (cx: number, cy: number, n: number, rx: number, ry: number) => {
        for (let i = 0; i < n; i++) { const y = cy - i * 9;
            c.beginPath(); c.ellipse(cx, y + 8, rx, ry, 0, 0, Math.PI); c.lineTo(cx - rx, y); c.ellipse(cx, y, rx, ry, 0, Math.PI, 0, true); c.closePath();
            c.fillStyle = lin(c, cx - rx, 0, cx + rx, 0, [[0, m[3]], [0.3, m[1]], [0.5, m[0]], [0.8, m[3]], [1, m[4]]]); c.fill(); ink(c, 3);
            for (let k = -rx + 4; k < rx; k += 5) line(c, 'rgba(90,50,0,.35)', 1, [cx + k, y + 2], [cx + k, y + 8]);
        }
        const y = cy - (n - 1) * 9;
        c.beginPath(); c.ellipse(cx, y, rx, ry, 0, 0, 7); c.fillStyle = rad(c, cx - rx * 0.3, y - ry * 0.3, 1, rx * 1.1, [[0, m[0]], [0.5, m[1]], [1, m[3]]]); c.fill(); ink(c, 3);
        c.beginPath(); c.ellipse(cx, y, rx * 0.72, ry * 0.7, 0, 0, 7); c.strokeStyle = m[3]; c.lineWidth = 1.8; c.stroke(); star(c, cx, y, ry * 0.6, m[4]);
    };
    glow(c, 64, 70, 54, '#ffcc40', 0.3);
    stack(40, 100, 2, 22, 8); stack(88, 94, 3, 20, 7); stack(62, 84, 4, 26, 10);
    star(c, 98, 28, 8, 'rgba(255,250,210,.95)'); star(c, 26, 52, 5, 'rgba(255,240,180,.9)');
}

// ---------- marco y composición ----------
const frameBg = (c: Ctx, rarCol: string, k: number) => {
    c.beginPath(); c.roundRect(2, 2, L - 4, L - 4, 14); c.fillStyle = rad(c, 64, 50, 4, 100, [[0, '#33265c'], [0.55, '#1a1238'], [1, '#0b0718']]); c.fill();
    c.save(); c.clip();
    c.fillStyle = lin(c, 0, 0, 0, L, [[0, 'rgba(255,255,255,.06)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.25)']]); c.fillRect(0, 0, L, L);
    if (k > 0) { glow(c, 64, 64, 80, rarCol, k > 1 ? 0.42 : 0.24); if (k > 1) { c.strokeStyle = alpha(rarCol, 0.5); c.lineWidth = 16; c.beginPath(); c.roundRect(2, 2, L - 4, L - 4, 14); c.stroke(); } }
    c.restore();
};
const frameFg = (c: Ctx, rarCol: string, k: number) => {
    c.save(); if (k > 1) { c.shadowColor = rarCol; c.shadowBlur = 10; }
    c.beginPath(); c.roundRect(4, 4, L - 8, L - 8, 12); c.strokeStyle = k ? rarCol : '#4b4272'; c.lineWidth = k ? 6 : 4; c.stroke(); c.restore();
    c.beginPath(); c.roundRect(7, 7, L - 14, L - 14, 10); c.strokeStyle = k ? mix(rarCol, '#ffffff', 0.45) : '#6a5f94'; c.lineWidth = 1.6; c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
    c.beginPath(); c.roundRect(1, 1, L - 2, L - 2, 15); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
    if (k > 1) { const w = mix(rarCol, '#ffffff', 0.7); star(c, 20, 22, 7, w); star(c, 108, 106, 6, w); if (k > 2) { star(c, 108, 20, 6, w); star(c, 20, 108, 5, w); star(c, 112, 62, 3, w); } }
};
function render(key: string, rarCol: string, rarK: number, art: (c: Ctx) => void): string {
    const hit = cache.get(key); if (hit) return hit;
    const cv = mkCanvas(OUT), c = cv.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.scale(OUT / L, OUT / L);
    frameBg(c, rarCol, rarK);
    const A = mkCanvas(OUT * 2), a = A.getContext('2d')!; a.scale((OUT * 2) / L, (OUT * 2) / L); art(a);
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 7; c.shadowOffsetY = 3; c.drawImage(A, 0, 0, L, L); c.restore();
    frameFg(c, rarCol, rarK);
    const url = cv.toDataURL('image/png'); cache.set(key, url); return url;
}

/** Íconos pintados de los sets (assets/icons/<look>.png). Si todavía no cargaron se usa el dibujado por código, y el ícono con arte se arma recién cuando están listos. */
const ART = new Map<string, HTMLImageElement>();
if (typeof Image !== 'undefined') for (const l of ['sol_malla', 'sol_placas', 'vhar_malla', 'vhar_placas']) for (const sfx of ['', '_helm']) { const im = new Image(); im.src = `assets/icons/${l}${sfx}.png`; ART.set(l + sfx, im); }

/** Ícono (data URL) del item. `look` es la pieza del paperdoll (shortsword, plate, mage_hood…); `slot` decide el símbolo. */
export function itemIcon(look: string | undefined, slot: string, rarCol: string, rarK: number): string {
    const artIm = look ? ART.get(look) : undefined, useArt = !!artIm && artIm.complete && artIm.naturalWidth > 0 && (slot === 'armadura' || slot === 'cabeza');
    return render(`${look}|${slot}|${rarCol}${useArt ? '|art' : ''}`, rarCol, rarK, (c) => {
        if (useArt) { c.drawImage(artIm!, 10, 10, 108, 108); return; }
        const l = look ?? '', m = RAMP[LOOK_RAMP[l] ?? 'iron'];
        if (slot === 'arma') {
            if (l === 'shortsword') sword(c, m, 'short'); else if (l === 'zweihander') sword(c, m, 'two'); else if (/sword/.test(l)) sword(c, m, 'long');
            else if (/axe/.test(l)) axe(c, m, l === 'battle_axe'); else if (l === 'mace' || l === 'maul') mace(c, m, l === 'maul');
            else if (l === 'staff' || l === 'wand') staff(c, l === 'wand'); else sword(c, m, 'long');
        } else if (slot === 'armadura') armor(c, l);
        else if (slot === 'cabeza') helm(c, l);
        else if (slot === 'anillo') { if (l.startsWith('amulet')) amulet(c); else ring(c, l); }
        else shield(c, l || 'buckler');
    });
}
/** Poción de vida o de maná. */
export function potionIcon(kind: 'hp' | 'mp'): string { return render('pot|' + kind, kind === 'hp' ? '#e0524a' : '#4a8fe0', 1, (c) => potion(c, kind)); }
/** Llave terminada ('cripta' | 'foso'). */
export function keyIcon(id: string): string { const k = id === 'foso' ? 'foso' : 'cripta'; return render('key|' + k, k === 'foso' ? '#6fd9c0' : '#ffd24a', 2, (c) => keyShape(c, k, false)); }
/** Esquirla de llave (llave rota). */
export function shardIcon(id: string): string { const k = id === 'foso' ? 'foso' : 'cripta'; return render('shard|' + k, '#b99cff', 1, (c) => keyShape(c, k, true)); }
/** Moneda de oro. */
export function coinIcon(): string { return render('coin', '#ffd24a', 1, coin); }
