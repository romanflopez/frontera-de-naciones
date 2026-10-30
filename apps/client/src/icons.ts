// Íconos de hechizos dibujados por código (originales, inspirados en el estilo de íconos de MMO): fondo con degradé del color del hechizo y un símbolo.
const S = 64;
const cache = new Map<string, string>();

function shade(hex: string, k: number): string {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

type Glyph = (c: CanvasRenderingContext2D, col: string) => void;
const poly = (c: CanvasRenderingContext2D, pts: number[][]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
const light = '#fff';

const GLYPHS: Record<string, Glyph> = {
    orb(c, col) { const g = c.createRadialGradient(28, 26, 2, 32, 32, 18); g.addColorStop(0, light); g.addColorStop(0.4, shade(col, 0.4)); g.addColorStop(1, shade(col, -0.2)); c.fillStyle = g; c.beginPath(); c.arc(32, 32, 16, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2; c.beginPath(); c.arc(32, 32, 22, 0.3, 2.4); c.stroke(); },
    ring(c, col) { c.strokeStyle = light; c.lineWidth = 4; c.beginPath(); c.arc(32, 32, 15, 0, 7); c.stroke(); c.strokeStyle = shade(col, 0.5); c.lineWidth = 3; for (const a of [0.8, 3.9]) { c.beginPath(); c.moveTo(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15); c.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24); c.stroke(); } c.fillStyle = light; c.beginPath(); c.arc(32, 32, 5, 0, 7); c.fill(); },
    stars(c) { c.fillStyle = '#fff'; for (const [x, y, r] of [[32, 30, 9], [18, 20, 5], [47, 22, 5], [24, 46, 4], [44, 45, 5]]) { poly(c, Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; return [x + Math.cos(a) * rr, y + Math.sin(a) * rr]; })); c.fill(); } },
    cross(c, col) { c.fillStyle = light; poly(c, [[26, 14], [38, 14], [38, 26], [50, 26], [50, 38], [38, 38], [38, 50], [26, 50], [26, 38], [14, 38], [14, 26], [26, 26]]); c.fill(); c.strokeStyle = shade(col, 0.3); c.lineWidth = 2; c.stroke(); },
    bandage(c, col) { c.save(); c.translate(32, 32); c.rotate(-0.6); c.fillStyle = light; c.fillRect(-22, -9, 44, 18); c.fillStyle = shade(col, -0.1); c.fillRect(-4, -9, 8, 18); c.fillRect(-22, -2, 44, 4); c.restore(); },
    fire(c, col) { const g = c.createLinearGradient(0, 12, 0, 54); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, shade(col, 0.2)); g.addColorStop(1, shade(col, -0.3)); c.fillStyle = g; c.beginPath(); c.moveTo(32, 8); c.bezierCurveTo(46, 22, 52, 34, 46, 46); c.bezierCurveTo(42, 54, 22, 54, 18, 46); c.bezierCurveTo(12, 34, 24, 28, 26, 18); c.bezierCurveTo(30, 22, 30, 14, 32, 8); c.fill(); c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.ellipse(32, 44, 7, 9, 0, 0, 7); c.fill(); },
    fireball(c, col) { c.strokeStyle = shade(col, 0.4); c.lineWidth = 5; c.lineCap = 'round'; for (const [y, l] of [[22, 20], [32, 28], [42, 20]]) { c.globalAlpha = 0.7; c.beginPath(); c.moveTo(6, y); c.lineTo(6 + l, y); c.stroke(); } c.globalAlpha = 1; GLYPHS.orb(c, col); },
    crescent(c, col) { c.fillStyle = '#fff'; c.beginPath(); c.arc(30, 32, 20, -1.2, 1.2); c.arc(40, 32, 17, 1.0, -1.0, true); c.fill(); c.strokeStyle = shade(col, 0.5); c.lineWidth = 3; c.beginPath(); c.moveTo(8, 22); c.lineTo(22, 24); c.moveTo(6, 34); c.lineTo(20, 34); c.stroke(); },
    spike(c, col) { c.fillStyle = shade(col, 0.2); for (const [x, h, w] of [[20, 24, 7], [44, 20, 6], [32, 38, 9]]) { poly(c, [[x - w, 52], [x, 52 - h - 8], [x + w, 52]]); c.fill(); c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 1.5; c.stroke(); } c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(8, 50, 48, 5); },
    drops(c, col) { c.fillStyle = '#fff3b0'; for (const [x, y, s] of [[18, 16, 1], [34, 8, 1.2], [46, 22, 0.9], [26, 34, 1.1], [42, 40, 1], [14, 46, 0.8]]) { c.save(); c.translate(x, y); c.rotate(0.35); c.scale(s, s); c.beginPath(); c.moveTo(0, 14); c.bezierCurveTo(-8, 4, -4, -6, 0, -10); c.bezierCurveTo(4, -6, 8, 4, 0, 14); c.fillStyle = shade(col, 0.45); c.fill(); c.restore(); } },
    flake(c) { c.strokeStyle = '#fff'; c.lineWidth = 3; c.lineCap = 'round'; for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; c.save(); c.translate(32, 32); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -22); c.moveTo(0, -13); c.lineTo(-6, -19); c.moveTo(0, -13); c.lineTo(6, -19); c.stroke(); c.restore(); } },
    wave(c, col) { c.fillStyle = shade(col, 0.5); for (const [y, a] of [[24, 7], [36, 8], [48, 6]]) { c.beginPath(); c.moveTo(6, y); for (let x = 6; x <= 58; x += 2) c.lineTo(x, y + Math.sin((x - 6) / 6) * a * 0.6); c.lineTo(58, y + 9); c.lineTo(6, y + 9); c.closePath(); c.globalAlpha = 0.85; c.fill(); } c.globalAlpha = 1; },
    pillar(c, col) { const g = c.createLinearGradient(0, 4, 0, 56); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, '#fff'); g.addColorStop(1, shade(col, 0.1)); c.fillStyle = g; poly(c, [[22, 4], [42, 4], [50, 52], [14, 52]]); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.ellipse(32, 52, 22, 6, 0, 0, 7); c.fill(); },
    slash(c, col) { c.fillStyle = '#fff'; poly(c, [[10, 50], [18, 52], [54, 12], [48, 8]]); c.fill(); c.fillStyle = shade(col, 0.5); poly(c, [[10, 50], [14, 40], [22, 46]]); c.fill(); c.fillStyle = shade(col, -0.1); poly(c, [[6, 56], [14, 44], [18, 52]]); c.fill(); },
    claws(c, col) { c.strokeStyle = '#fff'; c.lineWidth = 5; c.lineCap = 'round'; for (const x of [16, 30, 44]) { c.beginPath(); c.moveTo(x, 12); c.quadraticCurveTo(x + 8, 32, x + 2, 54); c.stroke(); } c.strokeStyle = shade(col, 0.5); c.lineWidth = 2; for (const x of [16, 30, 44]) { c.beginPath(); c.moveTo(x + 2, 14); c.quadraticCurveTo(x + 10, 32, x + 4, 52); c.stroke(); } },
    spiral(c, col) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); for (let t = 0; t < 14; t += 0.2) { const r = 2 + t * 1.5, a = t; const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r; t ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); c.strokeStyle = shade(col, 0.4); c.lineWidth = 2; c.beginPath(); c.arc(32, 32, 24, 0.4, 2.4); c.stroke(); },
    cracks(c, col) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.lineJoin = 'round'; c.beginPath(); c.moveTo(32, 32); c.lineTo(20, 22); c.lineTo(22, 10); c.moveTo(32, 32); c.lineTo(46, 26); c.lineTo(54, 34); c.moveTo(32, 32); c.lineTo(36, 46); c.lineTo(28, 56); c.moveTo(32, 32); c.lineTo(14, 40); c.stroke(); c.fillStyle = shade(col, 0.3); c.beginPath(); c.arc(32, 32, 6, 0, 7); c.fill(); },
    rage(c, col) { c.fillStyle = '#fff'; poly(c, [[32, 8], [38, 24], [54, 22], [42, 34], [48, 52], [32, 42], [16, 52], [22, 34], [10, 22], [26, 24]]); c.fill(); c.fillStyle = shade(col, -0.05); poly(c, [[32, 20], [36, 30], [46, 30], [38, 37], [41, 46], [32, 40], [23, 46], [26, 37], [18, 30], [28, 30]]); c.fill(); },
};

const ICON_OF: Record<string, string> = {
    proyectil: 'orb', paralisis: 'ring', aturdir: 'stars', curar: 'cross', curar2: 'cross', vendar: 'bandage', bola: 'fireball', golpe: 'slash', tajo: 'claws', torbellino: 'spiral',
    hoja: 'crescent', lanza: 'spike', lluvia: 'drops', ventisca: 'flake', marejada: 'wave', luz: 'pillar', sismo: 'cracks', furia: 'rage', invisibilidad: 'stars', detectar: 'ring',
};

// Íconos pintados (assets/spells/*.png); los hechizos sin uno caen al dibujado por código.
const ART_OF: Record<string, string> = {
    proyectil: 'burbuja-arcana', paralisis: 'sello-arcano', aturdir: 'mente-arcana', curar: 'curar', curar2: 'lluvia-de-curacion', vendar: 'fractura', bola: 'explosion', golpe: 'furia',
    tajo: 'espada-solar', torbellino: 'torbellino-de-escarcha', hoja: 'torbellino-toxico', lanza: 'hacha-venenosa', lluvia: 'flechas-igneas', ventisca: 'remolino-glacial',
    marejada: 'remolino-de-sombra', luz: 'ascension', sismo: 'piel-de-piedra', furia: 'bestia-furiosa', remover: 'anular', invisibilidad: 'encapuchado', detectar: 'modo-cazador', blink: 'paso-sombrio', carga: 'embestida', giro: 'hacha-de-guerra', grito: 'bendicion',
};

/** Ícono del hechizo `id`: el pintado si existe, si no uno dibujado (data URL) del color `col`. */
export function spellIcon(id: string, col: string): string {
    if (ART_OF[id]) return `assets/spells/${ART_OF[id]}.png`;
    const key = id + col, hit = cache.get(key); if (hit) return hit;
    const cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d')!;
    const bg = c.createLinearGradient(0, 0, S, S); bg.addColorStop(0, shade(col, -0.35)); bg.addColorStop(1, shade(col, -0.75));
    c.fillStyle = bg; c.beginPath(); c.roundRect(2, 2, S - 4, S - 4, 9); c.fill();
    const glow = c.createRadialGradient(32, 32, 4, 32, 32, 34); glow.addColorStop(0, shade(col, -0.1)); glow.addColorStop(1, 'rgba(0,0,0,0)'); c.globalAlpha = 0.55; c.fillStyle = glow; c.fillRect(2, 2, S - 4, S - 4); c.globalAlpha = 1;
    c.save(); c.beginPath(); c.roundRect(2, 2, S - 4, S - 4, 9); c.clip();
    (GLYPHS[ICON_OF[id] ?? 'orb'] ?? GLYPHS.orb)(c, col);
    c.restore();
    c.strokeStyle = 'rgba(214,164,69,.75)'; c.lineWidth = 2; c.beginPath(); c.roundRect(2, 2, S - 4, S - 4, 9); c.stroke();
    const url = cv.toDataURL('image/png'); cache.set(key, url); return url;
}
