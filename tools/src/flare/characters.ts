/**
 * Personajes, equipo, NPCs y mobs con arte de Flare, en el orden de hojas que espera el cliente
 * (el mismo que usan los provisorios de tools/src/placeholders/sprites.ts).
 *
 * Diferencia de modelo: en Flare cada pieza (pies, piernas, manos, torso, cabeza, arma, escudo)
 * se dibuja en un orden que cambia según la dirección; el cliente dibuja siempre
 * cuerpo → pelo → ropa → arma encima. Para que no se vea un arma "por delante" cuando
 * en Flare va por detrás, a cada pieza se le recorta la silueta del cuerpo base que
 * Flare dibujaría encima de ella.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { encodeSpr, type SprSheet } from '../placeholders/spr.ts';
import { sheet } from '../placeholders/sprites.ts';
import { PLAYER_FRAMES, PLAYER_STATES, type PlayerStateName } from '../placeholders/figure.ts';
import { FLARE_DIRS, cellOf, drawFrame, emptyBox, growBox, loadSprite, pick, sourceFrame, toFlareDir, type FlareSprite } from './anim.ts';

/** Escala de los personajes: el prototipo usaba la mitad y se veía del tamaño justo. */
export const CHAR_SCALE = 0.5;

export type Gender = 'male' | 'female' | 'female_dark';
type Slot = 'feet' | 'legs' | 'hands' | 'chest' | 'head' | 'main' | 'off';
const BODY_SLOTS: Slot[] = ['feet', 'legs', 'hands', 'chest'];

/** Animación de Flare para cada estado del jugador. */
const PLAYER_ANIM: Record<PlayerStateName, string[]> = {
    idlePeace: ['stance'], idleCombat: ['stance'], bowStance: ['stance'],
    walkPeace: ['run'], walkCombat: ['run'], run: ['run'],
    melee: ['swing'], bowAttack: ['shoot', 'swing'], cast: ['cast'], pickUp: ['block', 'cast'],
    damage: ['hit'], die: ['die'],
};
const ARMAMENT_STATES = ['idlePeace', 'idleCombat', 'walkPeace', 'walkCombat', 'melee', 'damage', 'run'] as const;
const ALL_PLAYER_ANIMS = [...new Set(Object.values(PLAYER_ANIM).flat())];

export class FlareCharacters {
    private order = new Map<number, Slot[]>();

    constructor(private readonly mod: string) {
        for (const l of readFileSync(join(mod, 'engine', 'hero_layers.txt'), 'utf8').split(/\r?\n/)) {
            if (!l.startsWith('layer=')) continue;
            const [dir, ...slots] = l.slice(6).trim().split(',');
            this.order.set(FLARE_DIRS.indexOf(dir as (typeof FLARE_DIRS)[number]), slots as Slot[]);
        }
    }

    piece(gender: Gender, item: string): Promise<FlareSprite | undefined> {
        return loadSprite(this.mod, `avatar/${gender}/${item}`).then((s) => s ?? (gender === 'female_dark' ? loadSprite(this.mod, `avatar/female/${item}`) : undefined));
    }

    private async defaults(gender: Gender): Promise<Map<Slot, FlareSprite>> {
        const m = new Map<Slot, FlareSprite>();
        // ropa base con la que arranca todo personaje: camisa, pantalón y sandalias de tela
        const base: Record<string, string> = { feet: 'cloth_sandals', legs: 'cloth_pants', hands: 'default_hands', chest: 'cloth_shirt' };
        for (const slot of BODY_SLOTS) {
            const s = (await this.piece(gender, base[slot])) ?? (await this.piece(gender, `default_${slot}`));
            if (s) m.set(slot, s);
        }
        const head = await this.piece(gender, gender === 'male' ? 'head_short' : 'head_long');
        if (head) m.set('head', head);
        return m;
    }

    /** Piezas base que Flare dibuja después de `slot` en esa dirección (sirven de máscara). */
    private masksAfter(slot: Slot, flareDir: number, defaults: Map<Slot, FlareSprite>): FlareSprite[] {
        const order = this.order.get(flareDir) ?? [];
        const i = order.indexOf(slot);
        if (i < 0) return [];
        return order.slice(i + 1).map((s) => defaults.get(s)).filter((s): s is FlareSprite => !!s);
    }

    /** Dibuja una pieza en la celda y le borra lo que taparían las piezas de las máscaras. */
    private drawPiece(ctx: SKRSContext2D, cell: { x: number; y: number; w: number; h: number }, fx: number, fy: number,
        piece: FlareSprite, masks: FlareSprite[], anims: string[], dir: number, f: number, n: number): void {
        const fd = toFlareDir(dir);
        const a = pick(piece, anims);
        if (!a) return;
        ctx.save();
        ctx.beginPath(); ctx.rect(cell.x, cell.y, cell.w, cell.h); ctx.clip();
        drawFrame(ctx, a, sourceFrame(a, f, n), fd, fx, fy, CHAR_SCALE);
        if (masks.length) {
            ctx.globalCompositeOperation = 'destination-out';
            for (const m of masks) { const ma = pick(m, anims); if (ma) drawFrame(ctx, ma, sourceFrame(ma, f, n), fd, fx, fy, CHAR_SCALE); }
        }
        ctx.restore();
    }

    private cell(pieces: (FlareSprite | undefined)[]) {
        const b = emptyBox();
        for (const p of pieces) growBox(b, p, CHAR_SCALE, ALL_PLAYER_ANIMS);
        return cellOf(b);
    }

    // ---------- cuerpo ----------
    /** Cuerpo (wm, ww, ...): 96 hojas, hoja = estado*8 + dirección. Lleva la ropa base de Flare, sin cabeza. */
    async body(gender: Gender): Promise<Uint8Array> {
        const d = await this.defaults(gender);
        const parts = BODY_SLOTS.map((s) => d.get(s));
        const { cw, ch, ax, ay } = this.cell(parts);
        const sheets: SprSheet[] = [];
        for (const state of PLAYER_STATES) {
            const n = PLAYER_FRAMES[state], anims = PLAYER_ANIM[state];
            for (let dir = 0; dir < 8; dir++) {
                const order = this.order.get(toFlareDir(dir)) ?? BODY_SLOTS;
                sheets.push(sheet(n, n, cw, ch, -ax, -ay, (ctx, x, y, f) => {
                    for (const slot of order) {
                        const p = d.get(slot);
                        if (p && slot !== 'head') this.drawPiece(ctx, { x, y, w: cw, h: ch }, x + ax, y + ay, p, [], anims, dir, f, n);
                    }
                }));
            }
        }
        return encodeSpr(sheets);
    }

    /** Pelo (mhr, whr): 8 variantes × 12 estados; adentro, frame = dirección*n + f. En Flare la cabeza trae el pelo. */
    async hair(gender: Gender): Promise<Uint8Array> {
        const heads = gender === 'male' ? ['head_short', 'head_bald'] : ['head_long'];
        const variants = await Promise.all(heads.map((h) => this.piece(gender, h)));
        const { cw, ch, ax, ay } = this.cell(variants);
        const sheets: SprSheet[] = [];
        const cache = new Map<string, SprSheet>();
        for (let v = 0; v < 8; v++) {
            const head = variants[v % variants.length];
            for (const state of PLAYER_STATES) {
                const key = `${v % variants.length}|${state}`;
                let s = cache.get(key);
                if (!s) {
                    const n = PLAYER_FRAMES[state];
                    s = sheet(n * 8, n, cw, ch, -ax, -ay, (ctx, x, y, i) => {
                        if (head) this.drawPiece(ctx, { x, y, w: cw, h: ch }, x + ax, y + ay, head, [], PLAYER_ANIM[state], Math.floor(i / n), i % n, n);
                    });
                    cache.set(key, s);
                }
                sheets.push(s);
            }
        }
        return encodeSpr(sheets);
    }

    // ---------- equipo ----------
    /** Ropa (armor, hauberk, leggings, boots, helmet): 12 hojas de 64 frames (dirección*8 + k). */
    async wearable(gender: Gender, slot: Slot, item: string): Promise<Uint8Array | undefined> {
        const piece = await this.piece(gender, item);
        if (!piece) return undefined;
        const d = await this.defaults(gender);
        const { cw, ch, ax, ay } = this.cell([piece]);
        const sheets = PLAYER_STATES.map((state) => {
            const n = PLAYER_FRAMES[state];
            return sheet(64, 8, cw, ch, -ax, -ay, (ctx, x, y, i) => {
                const dir = Math.floor(i / 8), f = Math.floor(((i % 8) * n) / 8);
                this.drawPiece(ctx, { x, y, w: cw, h: ch }, x + ax, y + ay, piece, this.masksAfter(slot, toFlareDir(dir), d), PLAYER_ANIM[state], dir, f, n);
            });
        });
        return encodeSpr(sheets);
    }

    /** Armas: bloques de 56 hojas (7 estados × 8 direcciones); cada bloque puede ser un arma distinta. */
    async weapon(gender: Gender, itemsPerBlock: (string | undefined)[]): Promise<Uint8Array> {
        const pieces = await Promise.all(itemsPerBlock.map((it) => (it ? this.piece(gender, it) : undefined)));
        const fallback = pieces.find((p) => p);
        const d = await this.defaults(gender);
        const { cw, ch, ax, ay } = this.cell(pieces);
        const cache = new Map<string, SprSheet>();
        const sheets: SprSheet[] = [];
        for (let s = 0; s < itemsPerBlock.length * 56; s++) {
            const b = Math.floor(s / 56), state = ARMAMENT_STATES[Math.floor((s % 56) / 8)], dir = s % 8, n = PLAYER_FRAMES[state];
            const piece = pieces[b] ?? fallback;
            const key = `${itemsPerBlock[b] ?? 'x'}|${s % 56}`;
            let sh = cache.get(key);
            if (!sh) {
                sh = sheet(n, n, cw, ch, -ax, -ay, (ctx, x, y, f) => {
                    if (piece) this.drawPiece(ctx, { x, y, w: cw, h: ch }, x + ax, y + ay, piece, this.masksAfter('main', toFlareDir(dir), d), PLAYER_ANIM[state], dir, f, n);
                });
                cache.set(key, sh);
            }
            sheets.push(sh);
        }
        return encodeSpr(sheets);
    }

    /** Escudos: bloques de 7 hojas (una por estado) con 64 frames (dirección*8 + k). */
    async shield(gender: Gender, itemsPerBlock: (string | undefined)[]): Promise<Uint8Array> {
        const pieces = await Promise.all(itemsPerBlock.map((it) => (it ? this.piece(gender, it) : undefined)));
        const fallback = pieces.find((p) => p);
        const d = await this.defaults(gender);
        const { cw, ch, ax, ay } = this.cell(pieces);
        const cache = new Map<string, SprSheet>();
        const sheets: SprSheet[] = [];
        for (let s = 0; s < itemsPerBlock.length * 7; s++) {
            const b = Math.floor(s / 7), state = ARMAMENT_STATES[s % 7], n = PLAYER_FRAMES[state];
            const piece = pieces[b] ?? fallback;
            const key = `${itemsPerBlock[b] ?? 'x'}|${s % 7}`;
            let sh = cache.get(key);
            if (!sh) {
                sh = sheet(64, 8, cw, ch, -ax, -ay, (ctx, x, y, i) => {
                    const dir = Math.floor(i / 8), f = Math.floor(((i % 8) * n) / 8);
                    if (piece) this.drawPiece(ctx, { x, y, w: cw, h: ch }, x + ax, y + ay, piece, this.masksAfter('off', toFlareDir(dir), d), PLAYER_ANIM[state], dir, f, n);
                });
                cache.set(key, sh);
            }
            sheets.push(sh);
        }
        return encodeSpr(sheets);
    }

    // ---------- NPCs ----------
    /** NPC: 8 hojas (una por dirección) de 8 frames quieto, con un equipo armado de piezas de Flare. */
    async npc(gender: Gender, outfit: Partial<Record<Slot, string>>): Promise<Uint8Array> {
        const d = await this.defaults(gender);
        const parts = new Map(d);
        for (const [slot, item] of Object.entries(outfit) as [Slot, string][]) { const p = await this.piece(gender, item); if (p) parts.set(slot, p); }
        const { cw, ch, ax, ay } = this.cell([...parts.values()]);
        const sheets: SprSheet[] = [];
        for (let dir = 0; dir < 8; dir++) {
            const order = this.order.get(toFlareDir(dir)) ?? [];
            sheets.push(sheet(8, 8, cw, ch, -ax, -ay, (ctx, x, y, f) => {
                for (const slot of order) { const p = parts.get(slot); if (p) this.drawPiece(ctx, { x, y, w: cw, h: ch }, x + ax, y + ay, p, [], ['stance'], dir, f, 8); }
            }));
        }
        return encodeSpr(sheets);
    }

    // ---------- mobs ----------
    /** Mob: 5 estados × 8 direcciones = 40 hojas; 16 frames por hoja (los 8 de la animación, repetidos). */
    async monster(enemy: string, scale = CHAR_SCALE): Promise<Uint8Array | undefined> {
        const s = await loadSprite(this.mod, `enemies/${enemy}`);
        if (!s) return undefined;
        const states = [['stance'], ['run', 'stance'], ['swing', 'shoot', 'cast'], ['hit', 'block', 'stance'], ['die', 'critdie']];
        const { cw, ch, ax, ay } = cellOf(growBox(emptyBox(), s, scale));
        const sheets: SprSheet[] = [];
        for (const anims of states) {
            for (let dir = 0; dir < 8; dir++) {
                const base = sheet(8, 8, cw, ch, -ax, -ay, (ctx, x, y, f) => {
                    const a = pick(s, anims);
                    if (!a) return;
                    ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
                    drawFrame(ctx, a, sourceFrame(a, f, 8), toFlareDir(dir), x + ax, y + ay, scale);
                    ctx.restore();
                });
                sheets.push({ ...base, frames: [...base.frames, ...base.frames] });
            }
        }
        return encodeSpr(sheets);
    }
}

// ---------- capas vacías (Flare no tiene capas ni ropa interior) ----------
const blankPng = createCanvas(1, 1).toBuffer('image/png');
function blankSheet(count: number): SprSheet {
    return { png: blankPng, width: 1, height: 1, frames: Array.from({ length: count }, () => ({ x: 0, y: 0, width: 1, height: 1, pivotX: 0, pivotY: 0 })) };
}
/** Ropa interior: 8 variantes × 12 estados, vacía. */
export function blankUnderwear(): Uint8Array {
    const sheets: SprSheet[] = [];
    for (let v = 0; v < 8; v++) for (const state of PLAYER_STATES) sheets.push(blankSheet(PLAYER_FRAMES[state] * 8));
    return encodeSpr(sheets);
}
/** Capa: 12 hojas de 64 frames, vacía. */
export function blankWearable(): Uint8Array { return encodeSpr(PLAYER_STATES.map(() => blankSheet(64))); }
/** Alas: 48 hojas, vacías. */
export function blankWings(): Uint8Array {
    const frames = [8, 8, 4, 8, 16, 4];
    const sheets: SprSheet[] = [];
    for (let a = 0; a < 6; a++) for (let d = 0; d < 8; d++) sheets.push(blankSheet(frames[a]));
    return encodeSpr(sheets);
}
