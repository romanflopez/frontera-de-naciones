/**
 * Constructores de sprites provisorios con el orden de hojas que espera el cliente.
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { encodeSpr, type SprFrame, type SprSheet } from './spr.ts';
import {
    CELL_H, CELL_W, FOOT_X, FOOT_Y, PLAYER_FRAMES, PLAYER_STATES,
    circle, drawFigure, line, roundRect, shade, type FigureStyle, type Layer,
} from './figure.ts';

type Draw = (ctx: SKRSContext2D, ox: number, oy: number, index: number) => void;

/** Una hoja con `count` celdas en una grilla de `cols` columnas. */
function sheet(count: number, cols: number, cw: number, ch: number, pivotX: number, pivotY: number, draw: Draw): SprSheet {
    const rows = Math.ceil(count / cols);
    const canvas = createCanvas(cw * Math.min(cols, count), ch * rows);
    const ctx = canvas.getContext('2d');
    const frames: SprFrame[] = [];
    for (let i = 0; i < count; i++) {
        const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
        ctx.save(); draw(ctx, x, y, i); ctx.restore();
        frames.push({ x, y, width: cw, height: ch, pivotX, pivotY });
    }
    return { png: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height, frames };
}

/** Hoja donde todos los frames apuntan a pocas imágenes repetidas (para índices altos). */
function repeatedSheet(count: number, variants: number, cw: number, ch: number, pivotX: number, pivotY: number, draw: Draw): SprSheet {
    const base = sheet(variants, variants, cw, ch, pivotX, pivotY, draw);
    const frames = Array.from({ length: count }, (_, i) => base.frames[i % variants]);
    return { ...base, frames };
}

const PIVOT_X = -FOOT_X, PIVOT_Y = -FOOT_Y;

/** Cuerpo del personaje: 12 estados × 8 direcciones = 96 hojas; hoja = estado*8 + dirección. */
export function buildBody(style: FigureStyle): Uint8Array {
    const sheets: SprSheet[] = [];
    for (const state of PLAYER_STATES) {
        for (let dir = 0; dir < 8; dir++) {
            const n = PLAYER_FRAMES[state];
            sheets.push(sheet(n, n, CELL_W, CELL_H, PIVOT_X, PIVOT_Y, (ctx, x, y, f) => drawFigure(ctx, x, y, 'body', style, state, dir, f)));
        }
    }
    return encodeSpr(sheets);
}

/**
 * Capa por variante (pelo, ropa interior): 8 variantes × 12 estados; hoja = variante*12 + estado,
 * y dentro de la hoja las 8 direcciones una tras otra (frame = dirección*frames + f).
 */
export function buildDirectionalLayer(layer: Layer, styles: FigureStyle[]): Uint8Array {
    const sheets: SprSheet[] = [];
    for (const style of styles) {
        for (const state of PLAYER_STATES) {
            const n = PLAYER_FRAMES[state];
            sheets.push(sheet(n * 8, n, CELL_W, CELL_H, PIVOT_X, PIVOT_Y, (ctx, x, y, i) => drawFigure(ctx, x, y, layer, style, state, Math.floor(i / n), i % n)));
        }
    }
    return encodeSpr(sheets);
}

/** NPC: 8 hojas (una por dirección) con 8 frames de reposo. */
export function buildNpc(style: FigureStyle): Uint8Array {
    const sheets: SprSheet[] = [];
    for (let dir = 0; dir < 8; dir++) {
        sheets.push(sheet(8, 8, CELL_W, CELL_H, PIVOT_X, PIVOT_Y, (ctx, x, y, f) => {
            drawFigure(ctx, x, y, 'body', style, 'idlePeace', dir, f);
            drawFigure(ctx, x, y, 'robe', style, 'idlePeace', dir, f);
            drawFigure(ctx, x, y, 'hair', style, 'idlePeace', dir, f);
        }));
    }
    return encodeSpr(sheets);
}

/** Mob genérico (una babosa): 5 estados × 8 direcciones = 40 hojas de 8 frames. */
export function buildMonster(color: string, scale = 1): Uint8Array {
    const cw = Math.round(56 * scale), ch = Math.round(52 * scale);
    const footX = cw / 2, footY = ch - 6 * scale;
    const sheets: SprSheet[] = [];
    for (let state = 0; state < 5; state++) {
        for (let dir = 0; dir < 8; dir++) {
            sheets.push(sheet(8, 8, cw, ch, -Math.round(footX), -Math.round(footY), (ctx, x, y, f) => {
                const t = f / 8, w = Math.sin(t * Math.PI * 2);
                let sx = 1, sy = 1, lunge = 0, alpha = 1;
                if (state === 0) { sy = 1 + w * 0.05; sx = 1 - w * 0.04; }
                if (state === 1) { sy = 1 + w * 0.15; sx = 1 - w * 0.12; }
                if (state === 2) lunge = Math.sin(t * Math.PI) * 6 * scale;
                if (state === 3) { sx = 1.1; sy = 0.9; }
                if (state === 4) { sy = Math.max(0.2, 1 - t); sx = 1 + t * 0.6; alpha = 1 - t * 0.4; }
                const dv = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7]][dir];
                ctx.translate(x + footX + dv[0] * lunge, y + footY + dv[1] * lunge * 0.5);
                ctx.globalAlpha = alpha;
                ctx.scale(sx * scale, sy * scale);
                const g = ctx.createRadialGradient(-6, -26, 2, 0, -16, 26);
                g.addColorStop(0, shade(color, 0.45)); g.addColorStop(1, shade(color, -0.35));
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.ellipse(0, -16, 22, 18, 0, Math.PI, 0); ctx.lineTo(22, 0); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
                if (dv[1] > -0.1) {
                    ctx.fillStyle = '#fff'; circle(ctx, dv[0] * 8 - 6, -20, 4); circle(ctx, dv[0] * 8 + 6, -20, 4);
                    ctx.fillStyle = '#111'; circle(ctx, dv[0] * 9 - 6, -19, 2); circle(ctx, dv[0] * 9 + 6, -19, 2);
                }
                if (state === 3) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(-30, -40, 60, 44); }
            }));
        }
    }
    return encodeSpr(sheets);
}

/** Efectos: `sheets` hojas de 8 frames, un anillo que se expande con un color por hoja. */
export function buildEffect(seed: number, sheets = 32): Uint8Array {
    const out: SprSheet[] = [];
    for (let s = 0; s < sheets; s++) {
        const hue = (seed * 53 + s * 37) % 360;
        out.push(sheet(8, 8, 64, 64, -32, -48, (ctx, x, y, f) => {
            const t = (f + 1) / 8;
            ctx.translate(x + 32, y + 40);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 6 + t * 22);
            g.addColorStop(0, `hsla(${hue},90%,85%,${1 - t * 0.7})`);
            g.addColorStop(0.6, `hsla(${hue},90%,55%,${0.8 - t * 0.6})`);
            g.addColorStop(1, `hsla(${hue},90%,40%,0)`);
            ctx.fillStyle = g; circle(ctx, 0, 0, 6 + t * 22);
        }));
    }
    return encodeSpr(out);
}

/** Interfaz: hoja 0 con los 6 cursores (puntero, agarrar ×2, atacar, casteando, listo). */
export function buildInterface(): Uint8Array {
    const cursors = sheet(6, 6, 32, 32, 0, 0, (ctx, x, y, i) => {
        ctx.translate(x, y);
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#1a1208';
        if (i === 0) { // flecha
            ctx.fillStyle = '#e8d3a0';
            ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(1, 22); ctx.lineTo(7, 16); ctx.lineTo(12, 26); ctx.lineTo(16, 24); ctx.lineTo(11, 15); ctx.lineTo(19, 15); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (i === 1 || i === 2) { // mano
            ctx.fillStyle = '#e8c39e'; roundRect(ctx, 6, 8 + (i === 2 ? 3 : 0), 16, 14, 5); ctx.stroke();
            for (let k = 0; k < 4; k++) roundRect(ctx, 6 + k * 4, 3 + (i === 2 ? 6 : 0), 3.5, 9, 1.5);
        } else if (i === 3) { // espada
            ctx.strokeStyle = '#d9dde3'; ctx.lineWidth = 3; line(ctx, 2, 2, 20, 20);
            ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3; line(ctx, 16, 24, 24, 16); line(ctx, 20, 20, 26, 26);
        } else { // casteando / listo
            const ready = i === 5;
            const g = ctx.createRadialGradient(12, 12, 1, 12, 12, 11);
            g.addColorStop(0, '#fff'); g.addColorStop(0.5, ready ? '#7fd6ff' : '#b9a3ff'); g.addColorStop(1, 'rgba(120,120,255,0)');
            ctx.fillStyle = g; circle(ctx, 12, 12, 11);
            ctx.strokeStyle = ready ? '#7fd6ff' : '#b9a3ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(12, 12, 9, 0, Math.PI * 2); ctx.stroke();
        }
    });
    const generic = Array.from({ length: 15 }, () => repeatedSheet(16, 1, 16, 16, 0, 0, (ctx, x, y) => { ctx.fillStyle = 'rgba(214,164,69,0.6)'; ctx.fillRect(x + 2, y + 2, 12, 12); }));
    return encodeSpr([cursors, ...generic]);
}

const ICONS: Draw = (ctx, x, y, i) => {
    ctx.translate(x + 16, y + 16);
    const c = ['#c9ced6', '#a0703f', '#d64545', '#5aa0e6', '#e8c34a', '#7ac46a', '#9b6bd6', '#8a8a8a'][i % 8];
    ctx.fillStyle = c; ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 1.5;
    switch (i % 8) {
        case 0: ctx.strokeStyle = c; ctx.lineWidth = 3; line(ctx, -9, 9, 9, -9); ctx.strokeStyle = '#8a5a2b'; line(ctx, -9, 3, -3, 9); break; // espada
        case 1: ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(10, -6); ctx.lineTo(8, 6); ctx.lineTo(0, 12); ctx.lineTo(-8, 6); ctx.lineTo(-10, -6); ctx.closePath(); ctx.fill(); ctx.stroke(); break; // escudo
        case 2: case 3: roundRect(ctx, -6, -4, 12, 14, 4); ctx.fillStyle = '#ddd'; ctx.fillRect(-3, -10, 6, 6); break; // poción
        case 4: ctx.lineWidth = 3; ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(0, 2, 7, 0, Math.PI * 2); ctx.stroke(); break; // anillo
        case 5: roundRect(ctx, -9, -9, 18, 18, 4); ctx.stroke(); break; // armadura
        case 6: ctx.beginPath(); ctx.arc(0, 2, 10, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); break; // casco
        default: roundRect(ctx, -9, -6, 18, 16, 5); ctx.stroke(); // bolsa
    }
};

/** Íconos de items: hojas × frames, todos mapeados a 8 dibujos que se repiten. */
export function buildItemIcons(sheets: number, framesPerSheet: number): Uint8Array {
    return encodeSpr(Array.from({ length: sheets }, () => repeatedSheet(framesPerSheet, 8, 32, 32, -16, -16, ICONS)));
}
