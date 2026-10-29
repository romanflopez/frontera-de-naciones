/**
 * Figura humana provisoria dibujada por código, en capas (cuerpo, pelo, ropa interior).
 * Todas las capas comparten la misma geometría, así encajan cuando el cliente las superpone.
 *
 * Celda de 64×80 px con los pies en (32, 72). Direcciones del cliente:
 * 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SO, 6 O, 7 NO.
 */
import type { SKRSContext2D } from '@napi-rs/canvas';

export const CELL_W = 64;
export const CELL_H = 80;
export const FOOT_X = 32;
export const FOOT_Y = 72;

/** Estados del jugador en el orden de hojas del cliente (PlayerAppearanceManager). */
export const PLAYER_STATES = [
    'idlePeace', 'idleCombat', 'walkPeace', 'walkCombat', 'run', 'bowStance',
    'melee', 'bowAttack', 'cast', 'pickUp', 'damage', 'die',
] as const;
export type PlayerStateName = (typeof PLAYER_STATES)[number];

/** Frames por estado, igual que PLAYER_ANIMATION_FRAME_COUNT en el cliente. */
export const PLAYER_FRAMES: Record<PlayerStateName, number> = {
    idlePeace: 8, idleCombat: 8, walkPeace: 8, walkCombat: 8, run: 8, bowStance: 8,
    melee: 8, bowAttack: 8, cast: 16, pickUp: 4, damage: 4, die: 8,
};

const DIR_VEC: [number, number][] = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7]];

export type Layer = 'body' | 'hair' | 'underwear' | 'robe';

export interface FigureStyle {
    skin: string;
    female: boolean;
    hairColor: string;
    hairStyle: number;
    underwear: string;
    robe: string;
}

interface Pose {
    lean: number;      // rotación del cuerpo entero (rad), para morir y recibir golpe
    drop: number;      // cuánto baja el cuerpo (agacharse)
    legSwing: number;  // -1..1
    armL: number;      // ángulo del brazo izquierdo respecto de colgar (rad)
    armR: number;
    glow: number;      // brillo en las manos (casteo), 0..1
    flash: boolean;
}

function pose(state: PlayerStateName, frame: number, frames: number): Pose {
    const t = frame / frames;
    const wave = Math.sin(t * Math.PI * 2);
    const p: Pose = { lean: 0, drop: 0, legSwing: 0, armL: 0.15, armR: -0.15, glow: 0, flash: false };
    switch (state) {
        case 'idlePeace':
        case 'idleCombat':
            p.drop = wave > 0 ? 1 : 0;
            if (state === 'idleCombat') { p.armL = 0.7; p.armR = -0.5; }
            break;
        case 'walkPeace':
        case 'walkCombat':
            p.legSwing = wave * 0.6; p.armL = 0.15 - wave * 0.5; p.armR = -0.15 + wave * 0.5;
            break;
        case 'run':
            p.legSwing = wave; p.armL = 0.3 - wave * 0.9; p.armR = -0.3 + wave * 0.9; p.drop = Math.abs(wave) * 2;
            break;
        case 'bowStance':
        case 'bowAttack':
            p.armL = 1.5; p.armR = -1.3 + (state === 'bowAttack' ? t * 0.6 : 0);
            break;
        case 'melee':
            p.armR = -2.6 + t * 3.2; p.armL = 0.4; p.legSwing = 0.3;
            break;
        case 'cast':
            p.armL = 2.4 - Math.min(t, 0.5); p.armR = -2.4 + Math.min(t, 0.5); p.glow = Math.min(1, t * 1.6);
            break;
        case 'pickUp':
            p.drop = Math.sin(t * Math.PI) * 14; p.armR = -0.6 - Math.sin(t * Math.PI) * 0.6;
            break;
        case 'damage':
            p.lean = -0.18 * Math.sin(t * Math.PI); p.flash = frame < 2;
            break;
        case 'die':
            p.lean = -Math.min(1, t * 1.4) * (Math.PI / 2); p.armL = 1.2; p.armR = -1.2;
            break;
    }
    return p;
}

/** Dibuja una capa de la figura en la celda cuyo origen es (ox, oy). */
export function drawFigure(
    ctx: SKRSContext2D, ox: number, oy: number,
    layer: Layer, style: FigureStyle, state: PlayerStateName, dir: number, frame: number,
): void {
    const frames = PLAYER_FRAMES[state];
    const p = pose(state, frame, frames);
    const [dx, dy] = DIR_VEC[dir];
    const side = Math.abs(dx) > 0.5 && Math.abs(dy) < 0.5;
    const facingCamera = dy > 0.1;
    const torsoW = side ? 10 : style.female ? 13 : 15;

    ctx.save();
    ctx.translate(ox + FOOT_X, oy + FOOT_Y);
    ctx.rotate(p.lean * (dx >= 0 ? 1 : -1));
    ctx.translate(0, p.drop);
    ctx.lineCap = 'round';

    const hipY = -24, shoulderY = -42, headY = -52;
    const legOff = side ? 2 : 4;
    const stride = p.legSwing * 7;
    const legA: [number, number] = [-legOff + stride * (side ? dx : 0.4), -Math.max(0, p.legSwing) * 3];
    const legB: [number, number] = [legOff - stride * (side ? dx : 0.4), -Math.max(0, -p.legSwing) * 3];
    const arm = (sx: number, ang: number, len = 15): [number, number] => [sx + Math.sin(ang) * len, shoulderY + Math.cos(ang) * len];
    const handL = arm(-torsoW / 2 - 1, p.armL), handR = arm(torsoW / 2 + 1, p.armR);

    if (layer === 'body' || layer === 'robe') {
        const limb = layer === 'robe' ? style.robe : style.skin;
        // piernas
        ctx.strokeStyle = shade(style.skin, -0.15); ctx.lineWidth = 5;
        line(ctx, -legOff, hipY, legA[0], legA[1]); line(ctx, legOff, hipY, legB[0], legB[1]);
        // brazo de atrás, torso, brazo de adelante
        ctx.strokeStyle = shade(limb, -0.1); ctx.lineWidth = 4;
        line(ctx, -torsoW / 2 - 1, shoulderY + 2, handL[0], handL[1]);
        ctx.fillStyle = layer === 'robe' ? style.robe : style.skin;
        roundRect(ctx, -torsoW / 2, shoulderY - 2, torsoW, hipY - shoulderY + 6, 4);
        if (layer === 'robe') { ctx.beginPath(); ctx.moveTo(-torsoW / 2, hipY); ctx.lineTo(torsoW / 2, hipY); ctx.lineTo(torsoW / 2 + 4, -2); ctx.lineTo(-torsoW / 2 - 4, -2); ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle = limb; ctx.lineWidth = 4;
        line(ctx, torsoW / 2 + 1, shoulderY + 2, handR[0], handR[1]);
        // cabeza
        ctx.fillStyle = style.skin; circle(ctx, dx * 1.5, headY, 7.5);
        if (facingCamera || side) {
            ctx.fillStyle = '#1b1410';
            const ex = dx * 3.5;
            if (!side) { circle(ctx, ex - 2.6, headY - 0.5, 1.1); circle(ctx, ex + 2.6, headY - 0.5, 1.1); }
            else circle(ctx, ex + dx * 1.5, headY - 0.5, 1.1);
        }
        if (p.glow > 0) {
            for (const h of [handL, handR]) {
                const g = ctx.createRadialGradient(h[0], h[1], 0, h[0], h[1], 4 + p.glow * 6);
                g.addColorStop(0, `rgba(255,255,255,${0.9 * p.glow})`); g.addColorStop(0.4, `rgba(140,170,255,${0.7 * p.glow})`); g.addColorStop(1, 'rgba(140,170,255,0)');
                ctx.fillStyle = g; circle(ctx, h[0], h[1], 4 + p.glow * 6);
            }
        }
        if (p.flash) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(255,60,40,0.45)'; ctx.fillRect(-30, -80, 60, 90); }
    } else if (layer === 'underwear') {
        ctx.fillStyle = style.underwear;
        roundRect(ctx, -torsoW / 2 - 0.5, hipY - 5, torsoW + 1, 9, 3);
        if (style.female) roundRect(ctx, -torsoW / 2, shoulderY + 1, torsoW, 6, 2);
    } else if (layer === 'hair') {
        drawHair(ctx, style, dx * 1.5, headY, dx, dy);
    }
    ctx.restore();
}

function drawHair(ctx: SKRSContext2D, style: FigureStyle, hx: number, hy: number, dx: number, dy: number): void {
    const s = style.hairStyle;
    ctx.fillStyle = style.hairColor;
    const back = dy < -0.1;
    // casquete
    ctx.beginPath(); ctx.arc(hx, hy - 1, 8, Math.PI, 0); ctx.closePath(); ctx.fill();
    if (back) circle(ctx, hx, hy, 7.8);
    if (s === 1 || s === 4 || s === 7) { // largo
        roundRect(ctx, hx - 8 - dx * 2, hy - 2, 16, 14, 4);
    } else if (s === 3 || s === 6) { // cola de caballo
        ctx.strokeStyle = style.hairColor; ctx.lineWidth = 4;
        line(ctx, hx - dx * 7, hy - 2, hx - dx * 11, hy + 9);
    } else if (s === 5) { // rapado: solo una línea
        ctx.clearRect(hx - 9, hy - 10, 18, 7);
        ctx.fillRect(hx - 7, hy - 7, 14, 2);
    }
}

export function line(ctx: SKRSContext2D, x1: number, y1: number, x2: number, y2: number): void {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
export function circle(ctx: SKRSContext2D, x: number, y: number, r: number): void {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}
export function shade(hex: string, amt: number): string {
    const n = parseInt(hex.slice(1), 16);
    const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
