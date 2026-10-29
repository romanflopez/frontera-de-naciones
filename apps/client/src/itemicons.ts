// Íconos de items dibujados por código (originales): un símbolo por tipo de item, color de material por `look` y borde/brillo según la rareza.
const S = 64;
const cache = new Map<string, string>();
type Ctx = CanvasRenderingContext2D;
const poly = (c: Ctx, pts: number[][]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };

/** Colores de material: [claro, medio, oscuro]. */
const MAT: Record<string, [string, string, string]> = {
    steel: ['#e8eef2', '#aab6c0', '#5b6770'], iron: ['#c4cbd0', '#808a92', '#3f474d'], wood: ['#c99a5f', '#8a5f35', '#4d3319'], leather: ['#c58a55', '#8d5a33', '#4f301a'],
    chain: ['#d6dde2', '#98a3ac', '#4d575f'], plate: ['#f0f4f7', '#b4c0ca', '#5f6c76'], mage: ['#b9a3ff', '#7a5fd0', '#3c2a78'], cloth: ['#e9dfc0', '#b8a77a', '#6d6040'], gold: ['#ffe9a0', '#d6a445', '#7a5a14'],
};
const MAT_OF: Record<string, string> = {
    shortsword: 'steel', longsword: 'steel', zweihander: 'steel', hand_axe: 'iron', battle_axe: 'steel', mace: 'iron', maul: 'iron', staff: 'wood', wand: 'mage',
    leather: 'leather', chain: 'chain', plate: 'plate', mage: 'mage', cloth: 'cloth', leather_hood: 'leather', chain_coif: 'chain', plate_helm: 'plate', mage_hood: 'mage',
};
const mat = (look: string | undefined): [string, string, string] => MAT[MAT_OF[look ?? ''] ?? 'iron'];
const grad = (c: Ctx, m: [string, string, string], x0: number, y0: number, x1: number, y1: number) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, m[0]); g.addColorStop(0.5, m[1]); g.addColorStop(1, m[2]); return g; };
const outline = (c: Ctx, w = 1.6) => { c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = w; c.lineJoin = 'round'; c.stroke(); };

function sword(c: Ctx, m: [string, string, string], big: boolean, short: boolean) {
    c.save(); c.translate(32, 32); c.rotate(Math.PI / 4);
    const L = short ? 22 : big ? 34 : 29, w = big ? 6 : short ? 4.5 : 5;
    c.fillStyle = grad(c, m, -w, 0, w, 0); poly(c, [[-w, 6], [-w, -L + 6], [0, -L], [w, -L + 6], [w, 6]]); c.fill(); outline(c);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -L + 4); c.lineTo(0, 4); c.stroke();
    const g = MAT.gold; c.fillStyle = grad(c, g, -12, 0, 12, 0); c.fillRect(big ? -12 : -9, 6, big ? 24 : 18, 4); outline(c, 1);
    c.fillStyle = grad(c, MAT.wood, -3, 0, 3, 0); c.fillRect(-2.5, 10, 5, big ? 13 : 9); c.fillStyle = g[1]; c.beginPath(); c.arc(0, big ? 25 : 21, 3.2, 0, 7); c.fill();
    c.restore();
}
function axe(c: Ctx, m: [string, string, string], big: boolean) {
    c.save(); c.translate(32, 32); c.rotate(Math.PI / 4);
    c.fillStyle = grad(c, MAT.wood, -3, 0, 3, 0); c.fillRect(-2.5, -26, 5, 52); outline(c, 1);
    c.fillStyle = grad(c, m, -16, -20, 4, 0);
    if (big) { poly(c, [[2, -26], [20, -30], [24, -12], [20, 4], [2, 0]]); c.fill(); outline(c); poly(c, [[-2, -26], [-20, -30], [-24, -12], [-20, 4], [-2, 0]]); c.fill(); outline(c); }
    else { poly(c, [[2, -24], [18, -28], [22, -12], [18, 0], [2, -4]]); c.fill(); outline(c); }
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(18, -26); c.lineTo(20, -12); c.lineTo(17, -1); c.stroke();
    c.restore();
}
function mace(c: Ctx, m: [string, string, string], big: boolean) {
    c.save(); c.translate(32, 32); c.rotate(Math.PI / 4);
    c.fillStyle = grad(c, MAT.wood, -3, 0, 3, 0); c.fillRect(-2.5, -8, 5, 36); outline(c, 1);
    if (big) { c.fillStyle = grad(c, m, -12, -26, 12, -4); c.beginPath(); c.roundRect(-12, -26, 24, 18, 3); c.fill(); outline(c); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(-9, -23, 18, 3); }
    else {
        c.fillStyle = grad(c, m, -10, -24, 10, -6); c.beginPath(); c.arc(0, -17, 10, 0, 7); c.fill(); outline(c); c.fillStyle = m[2];
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; poly(c, [[Math.cos(a - 0.2) * 9, -17 + Math.sin(a - 0.2) * 9], [Math.cos(a) * 15, -17 + Math.sin(a) * 15], [Math.cos(a + 0.2) * 9, -17 + Math.sin(a + 0.2) * 9]]); c.fill(); }
    }
    c.restore();
}
function staff(c: Ctx, m: [string, string, string], wand: boolean) {
    c.save(); c.translate(32, 32); c.rotate(Math.PI / 4);
    const L = wand ? 22 : 30; c.fillStyle = grad(c, MAT.wood, -3, 0, 3, 0); c.fillRect(wand ? -2 : -2.5, -L + 6, wand ? 4 : 5, L * 2 - 6); outline(c, 1);
    const gl = c.createRadialGradient(0, -L, 1, 0, -L, 11); gl.addColorStop(0, '#fff'); gl.addColorStop(0.45, m[0]); gl.addColorStop(1, 'rgba(120,90,255,0)');
    c.fillStyle = gl; c.beginPath(); c.arc(0, -L, 11, 0, 7); c.fill(); c.fillStyle = grad(c, m, -6, -L - 6, 6, -L + 6); c.beginPath(); c.arc(0, -L, wand ? 4.5 : 6, 0, 7); c.fill(); outline(c, 1);
    c.restore();
}
function armor(c: Ctx, m: [string, string, string], kind: string) {
    const robe = kind === 'mage' || kind === 'cloth';
    c.fillStyle = grad(c, m, 10, 8, 54, 56);
    if (robe) poly(c, [[22, 10], [32, 14], [42, 10], [54, 22], [48, 34], [44, 30], [46, 56], [18, 56], [20, 30], [16, 34], [10, 22]]);
    else poly(c, [[20, 10], [32, 15], [44, 10], [56, 20], [50, 36], [44, 32], [44, 54], [20, 54], [20, 32], [14, 36], [8, 20]]);
    c.fill(); outline(c);
    c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(32, 15); c.lineTo(32, robe ? 56 : 54); c.stroke();
    if (kind === 'plate') { c.strokeStyle = 'rgba(0,0,0,.4)'; for (const y of [26, 34, 42]) { c.beginPath(); c.moveTo(22, y); c.lineTo(42, y); c.stroke(); } }
    else if (kind === 'chain') { c.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 22; y < 52; y += 6) for (let x = 24 + ((y / 6) % 2) * 3; x < 42; x += 6) { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); } }
    else if (kind === 'leather') { c.strokeStyle = 'rgba(0,0,0,.4)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(24, 22); c.lineTo(24, 52); c.moveTo(40, 22); c.lineTo(40, 52); c.stroke(); c.setLineDash([]); }
    else if (kind === 'mage') { c.fillStyle = MAT.gold[1]; c.fillRect(20, 36, 24, 4); c.beginPath(); c.arc(32, 25, 3.5, 0, 7); c.fill(); }
    else { c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(20, 36, 24, 3); }
}
function helm(c: Ctx, m: [string, string, string], kind: string) {
    c.fillStyle = grad(c, m, 14, 10, 50, 54);
    if (kind === 'plate_helm') { c.beginPath(); c.moveTo(16, 50); c.lineTo(16, 28); c.quadraticCurveTo(16, 10, 32, 10); c.quadraticCurveTo(48, 10, 48, 28); c.lineTo(48, 50); c.lineTo(38, 50); c.lineTo(38, 40); c.lineTo(26, 40); c.lineTo(26, 50); c.closePath(); c.fill(); outline(c); c.fillStyle = '#10130f'; c.fillRect(22, 28, 20, 4); c.fillStyle = MAT.gold[1]; poly(c, [[30, 10], [34, 10], [36, 2], [28, 2]]); c.fill(); }
    else if (kind === 'chain_coif') {
        c.beginPath(); c.moveTo(14, 54); c.lineTo(14, 28); c.quadraticCurveTo(14, 8, 32, 8); c.quadraticCurveTo(50, 8, 50, 28); c.lineTo(50, 54); c.lineTo(42, 46); c.lineTo(42, 30); c.lineTo(22, 30); c.lineTo(22, 46); c.closePath(); c.fill(); outline(c);
        c.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 14; y < 52; y += 6) for (let x = 18 + ((y / 6) % 2) * 3; x < 48; x += 6) { c.beginPath(); c.arc(x, y, 1.5, 0, 7); c.fill(); }
    }
    else if (kind === 'mage_hood') { c.beginPath(); c.moveTo(14, 54); c.quadraticCurveTo(10, 24, 30, 4); c.quadraticCurveTo(36, 12, 40, 20); c.quadraticCurveTo(54, 30, 50, 54); c.lineTo(42, 46); c.lineTo(42, 32); c.lineTo(22, 32); c.lineTo(22, 46); c.closePath(); c.fill(); outline(c); c.fillStyle = MAT.gold[1]; c.fillRect(22, 30, 20, 2.5); }
    else { c.beginPath(); c.moveTo(14, 54); c.lineTo(14, 30); c.quadraticCurveTo(14, 10, 32, 10); c.quadraticCurveTo(50, 10, 50, 30); c.lineTo(50, 54); c.lineTo(42, 46); c.lineTo(42, 32); c.lineTo(22, 32); c.lineTo(22, 46); c.closePath(); c.fill(); outline(c); c.strokeStyle = 'rgba(0,0,0,.4)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(32, 12); c.lineTo(32, 30); c.stroke(); c.setLineDash([]); }
}
function ring(c: Ctx) {
    c.strokeStyle = MAT.gold[1]; c.lineWidth = 7; c.beginPath(); c.arc(32, 36, 14, 0, 7); c.stroke(); c.strokeStyle = MAT.gold[0]; c.lineWidth = 2; c.beginPath(); c.arc(32, 36, 14, 3.6, 5.2); c.stroke();
    const g = c.createRadialGradient(31, 18, 1, 32, 20, 8); g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#8fb6f0'); g.addColorStop(1, '#3f5fa8'); c.fillStyle = g; poly(c, [[32, 8], [40, 16], [32, 26], [24, 16]]); c.fill(); outline(c, 1.2);
}
function shield(c: Ctx, m: [string, string, string]) {
    c.fillStyle = grad(c, m, 12, 8, 52, 56); poly(c, [[32, 8], [52, 14], [50, 38], [32, 56], [14, 38], [12, 14]]); c.fill(); outline(c);
    c.fillStyle = MAT.gold[1]; c.beginPath(); c.arc(32, 30, 6, 0, 7); c.fill();
}

/** Ícono (data URL 64×64) del item. `look` es la pieza del paperdoll (shortsword, plate, mage_hood…); `slot` decide el símbolo. */
export function itemIcon(look: string | undefined, slot: string, rarCol: string, rarK: number): string {
    const key = `${look}|${slot}|${rarCol}`, hit = cache.get(key); if (hit) return hit;
    const cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d')!;
    const bg = c.createLinearGradient(0, 0, S, S); bg.addColorStop(0, '#23291f'); bg.addColorStop(1, '#101410');
    c.fillStyle = bg; c.beginPath(); c.roundRect(2, 2, S - 4, S - 4, 8); c.fill();
    if (rarK > 0) { const g = c.createRadialGradient(32, 32, 4, 32, 32, 34); g.addColorStop(0, rarCol + (rarK > 1 ? '66' : '3a')); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(2, 2, S - 4, S - 4); }
    c.save(); c.beginPath(); c.roundRect(2, 2, S - 4, S - 4, 8); c.clip();
    const m = mat(look), l = look ?? '';
    if (slot === 'arma') {
        if (/sword|zweihander/.test(l)) sword(c, m, l === 'zweihander', l === 'shortsword');
        else if (/axe/.test(l)) axe(c, m, l === 'battle_axe');
        else if (/mace|maul/.test(l)) mace(c, m, l === 'maul');
        else if (l === 'staff' || l === 'wand') staff(c, m, l === 'wand');
        else sword(c, m, false, false);
    } else if (slot === 'armadura') armor(c, m, l);
    else if (slot === 'cabeza') helm(c, m, l);
    else if (slot === 'anillo') ring(c);
    else shield(c, m);
    c.restore();
    c.strokeStyle = rarK ? rarCol : '#3a423a'; c.lineWidth = rarK ? 2.5 : 1.5; c.beginPath(); c.roundRect(2, 2, S - 4, S - 4, 8); c.stroke();
    const url = cv.toDataURL('image/png'); cache.set(key, url); return url;
}
