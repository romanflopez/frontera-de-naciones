/**
 * Lectura de los sprites de Flare (https://github.com/flareteam/flare-game, arte CC-BY-SA 3.0).
 *
 * Cada sprite es un .txt de animaciones más uno o varios PNG:
 *   image=images/avatar/male/longsword.png          imagen para todas las animaciones
 *   image=images/enemies/minotaur/run.png,run       imagen solo para una animación
 *   [run] frames=8 type=looped
 *   frame=índice,dirección,x,y,ancho,alto,offsetX,offsetY
 * El offset es el punto de apoyo (los pies) dentro del recorte.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';

export interface FlareFrame { x: number; y: number; w: number; h: number; ox: number; oy: number }
export interface FlareAnim { frames: number; type: string; image: Image; f: Map<string, FlareFrame> }
export type FlareSprite = Map<string, FlareAnim>;

/** Direcciones de Flare (0 = oeste, en sentido horario). */
export const FLARE_DIRS = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW'] as const;
/** Dirección del motor (0 = norte, en sentido horario) → dirección de Flare. */
export const toFlareDir = (dir: number) => (dir + 2) % 8;

const images = new Map<string, Promise<Image>>();
function image(path: string): Promise<Image> {
    let p = images.get(path);
    if (!p) { p = loadImage(readFileSync(path)); images.set(path, p); }
    return p;
}

const sprites = new Map<string, Promise<FlareSprite | undefined>>();

/** Carga `animations/<rel>.txt` del mod fantasycore; undefined si no existe. */
export function loadSprite(mod: string, rel: string): Promise<FlareSprite | undefined> {
    const key = `${mod}|${rel}`;
    let p = sprites.get(key);
    if (!p) { p = parse(mod, rel); sprites.set(key, p); }
    return p;
}

async function parse(mod: string, rel: string): Promise<FlareSprite | undefined> {
    const txt = join(mod, 'animations', `${rel}.txt`);
    if (!existsSync(txt)) return undefined;
    let defaultImage = '';
    const perAnim = new Map<string, string>();
    const raw = new Map<string, { frames: number; type: string; f: Map<string, FlareFrame> }>();
    let cur: { frames: number; type: string; f: Map<string, FlareFrame> } | undefined;
    for (const line of readFileSync(txt, 'utf8').split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith('#')) continue;
        const sec = /^\[(\w+)\]$/.exec(l);
        if (sec) { cur = { frames: 1, type: 'looped', f: new Map() }; raw.set(sec[1], cur); continue; }
        const eq = l.indexOf('=');
        if (eq < 0) continue;
        const k = l.slice(0, eq), v = l.slice(eq + 1);
        if (k === 'image') {
            const [path, anim] = v.split(',');
            if (anim) perAnim.set(anim, path); else defaultImage = path;
        } else if (cur && k === 'frames') cur.frames = Number(v);
        else if (cur && k === 'type') cur.type = v;
        else if (cur && k === 'frame') {
            const [i, d, x, y, w, h, ox, oy] = v.split(',').map(Number);
            cur.f.set(`${i},${d}`, { x, y, w, h, ox, oy });
        }
    }
    const out: FlareSprite = new Map();
    for (const [name, a] of raw) {
        const path = perAnim.get(name) ?? defaultImage;
        if (!path || !existsSync(join(mod, path))) continue;
        out.set(name, { ...a, image: await image(join(mod, path)) });
    }
    return out.size ? out : undefined;
}

/** La primera animación que exista entre las candidatas. */
export function pick(s: FlareSprite, names: readonly string[]): FlareAnim | undefined {
    for (const n of names) { const a = s.get(n); if (a) return a; }
    return s.get('stance') ?? s.values().next().value;
}

/** Frame de Flare para el frame `f` de una animación del motor que tiene `n` frames. */
export function sourceFrame(a: FlareAnim, f: number, n: number): number {
    const m = a.frames;
    if (a.type === 'back_forth' && m > 2) {
        const seq = [...Array(m).keys(), ...[...Array(m - 2).keys()].map((k) => m - 2 - k)];
        return seq[Math.floor((f * seq.length) / n) % seq.length];
    }
    return Math.min(m - 1, Math.floor((f * m) / n));
}

/** Dibuja un frame con los pies en (fx, fy). */
export function drawFrame(ctx: SKRSContext2D, a: FlareAnim | undefined, frame: number, flareDir: number, fx: number, fy: number, scale: number): void {
    const fr = a?.f.get(`${frame},${flareDir}`);
    if (!a || !fr || fr.w <= 0 || fr.h <= 0) return;
    ctx.drawImage(a.image, fr.x, fr.y, fr.w, fr.h, fx - fr.ox * scale, fy - fr.oy * scale, fr.w * scale, fr.h * scale);
}

/** Caja que ocupan todas las animaciones pedidas, relativa a los pies y ya escalada. */
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export function emptyBox(): Box { return { minX: 0, minY: 0, maxX: 1, maxY: 1 }; }
export function growBox(b: Box, s: FlareSprite | undefined, scale: number, anims?: readonly string[]): Box {
    if (!s) return b;
    for (const [name, a] of s) {
        if (anims && !anims.includes(name)) continue;
        for (const fr of a.f.values()) {
            b.minX = Math.min(b.minX, -fr.ox * scale); b.minY = Math.min(b.minY, -fr.oy * scale);
            b.maxX = Math.max(b.maxX, (fr.w - fr.ox) * scale); b.maxY = Math.max(b.maxY, (fr.h - fr.oy) * scale);
        }
    }
    return b;
}
/** Celda entera que contiene la caja: ancho, alto y dónde caen los pies. */
export function cellOf(b: Box): { cw: number; ch: number; ax: number; ay: number } {
    const ax = Math.ceil(-b.minX) + 1, ay = Math.ceil(-b.minY) + 1;
    return { cw: ax + Math.ceil(b.maxX) + 1, ch: ay + Math.ceil(b.maxY) + 1, ax, ay };
}
