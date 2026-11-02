/**
 * Texto flotante de combate (daño / cura + nombre e ícono del hechizo).
 *
 * El cliente no usa Phaser: dibuja en un canvas 2D propio. Este sistema replica la idea
 * de "Text + Tween" de Phaser: cada texto sube 50 px y se desvanece en 1 s, y después se descarta.
 * Se dibuja en coordenadas de pantalla (después del transform del mundo), así el tamaño
 * de la fuente no depende del zoom.
 */

import { SPELL_COLORS, type SpellType } from '../ui/colors';

/** Forma del evento de red (espejo de `CombatTextEvent` del proto). */
export interface CombatTextEvent {
    targetId: string | bigint | number;
    amount: number;
    isHeal: boolean;
    /** Vacío = sin cartel de hechizo. */
    spellName: string;
    /** Opcional: id del hechizo para buscar su ícono. */
    spellId?: string;
    /** El objetivo soy yo: el daño recibido sale en rojo y algo más chico. */
    self?: boolean;
}

interface Popup {
    /** Posición en grilla del objetivo al momento del golpe (el texto queda anclado ahí). */
    gx: number; gy: number;
    text: string; heal: boolean; t: number;
    /** Color y tamaño (px) del número. */
    color: string; size: number;
    /** De quién es (para apilar los números del mismo objetivo). */
    key: string;
    /** Fila de la pila: los golpes seguidos sobre el mismo objetivo salen uno arriba del otro. */
    slot: number;
    dx: number;
    spell?: { name: string; icon: HTMLImageElement | null };
}

const DUR = 1, RISE = 50, SPELL_DUR = 1.3, ROW = 30, STACK_FRESH = 0.55;
const DMG_FAMILY = "Impact, 'Arial Black', sans-serif";
const SPELL_FONT = "700 16px 'Alegreya Sans', system-ui, sans-serif";
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

export interface CombatTextDeps {
    /** Posición en grilla de una entidad (jugador o mob) por id; null si no está en rango. */
    resolve: (targetId: string | bigint | number) => { x: number; y: number } | null;
    /** Grilla → pantalla (CSS px), usando la cámara actual. */
    toScreen: (gx: number, gy: number) => { x: number; y: number };
    /** URL del ícono de un hechizo (opcional). */
    iconUrl?: (spellId: string) => string | null;
    /** Altura de la cabeza sobre el pie del personaje, en px de pantalla. */
    headOffset: () => number;
}

/** Cartel "estoy casteando X" sobre el personaje: sube 20 px y se desvanece en 2 s. */
interface CastLabel { key: string; name: string; icon: HTMLImageElement | null; t: number; primary: string; glow: string }
const CAST_DUR = 2, CAST_RISE = 20, CAST_LIFT = 50;

export class CombatTextManager {
    private items: Popup[] = [];
    private casts: CastLabel[] = [];
    private icons = new Map<string, HTMLImageElement>();

    constructor(private deps: CombatTextDeps) {}

    /** Llamar cuando llega un CombatTextEvent por red. */
    onEvent(ev: CombatTextEvent): void {
        const pos = this.deps.resolve(ev.targetId);
        if (!pos) return;
        const amt = Math.round(Math.abs(ev.amount));
        const p: Popup = {
            gx: pos.x, gy: pos.y, t: 0, heal: ev.isHeal,
            text: ev.isHeal ? `+${amt}` : `${amt}`,
            color: ev.isHeal ? '#00ff00' : ev.self ? '#ff3b30' : '#ff9900', size: !ev.isHeal && ev.self ? 26 : 32,
            key: String(ev.targetId), slot: 0, dx: 0,
        };
        this.stackOn(p);
        if (ev.spellName) p.spell = { name: ev.spellName, icon: ev.spellId ? this.icon(ev.spellId) : null };
        this.items.push(p);
    }

    /** Texto suelto sobre una posición de grilla (ej. "+120 exp"), con la misma animación. */
    showAt(gx: number, gy: number, text: string, color: string, size = 22, key = 'self'): void {
        const p: Popup = { gx, gy, t: 0, heal: false, text, color, size, key, slot: 0, dx: 0 };
        this.stackOn(p); this.items.push(p);
    }

    /** Nombre (+ ícono) del hechizo que `targetId` empieza a castear. Reemplaza el cartel anterior de ese personaje. */
    showCastingSpell(targetId: string | bigint | number, spellName: string, spellType: SpellType = 'PHYSICAL', spellId?: string): void {
        const key = String(targetId), col = SPELL_COLORS[spellType];
        this.casts = this.casts.filter((c) => c.key !== key);
        this.casts.push({ key, name: spellName, icon: spellId ? this.icon(spellId) : null, t: 0, primary: col.primary, glow: col.glow });
    }

    private stackOn(p: Popup): void {
        // fila libre más baja entre los números todavía "frescos" de este objetivo
        const busy = new Set(this.items.filter((q) => q.key === p.key && q.t < STACK_FRESH).map((q) => q.slot));
        while (busy.has(p.slot)) p.slot++;
        p.dx = p.slot ? (p.slot % 2 ? 14 : -14) : 0;
    }

    update(dt: number): void {
        for (let i = this.items.length - 1; i >= 0; i--) {
            const p = this.items[i]; p.t += dt;
            if (p.t >= Math.max(DUR, p.spell ? SPELL_DUR : 0)) this.items.splice(i, 1);
        }
        for (let i = this.casts.length - 1; i >= 0; i--) if ((this.casts[i].t += dt) >= CAST_DUR) this.casts.splice(i, 1);
    }

    /** Dibujar con el contexto en coordenadas de pantalla (CSS px). */
    draw(ctx: CanvasRenderingContext2D): void {
        if (!this.items.length && !this.casts.length) return;
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
        const head = this.deps.headOffset();
        this.drawCasts(ctx, head);
        for (const p of this.items) {
            const s = this.deps.toScreen(p.gx, p.gy), x = s.x + p.dx, top = s.y - head;
            // número
            if (p.t < DUR) {
                const k = p.t / DUR, pop = p.t < 0.08 ? 0.7 + (p.t / 0.08) * 0.3 : 1;
                const y = top - 10 - p.slot * ROW - easeOut(k) * RISE;
                ctx.globalAlpha = 1 - k;
                ctx.font = `700 ${p.size}px ${DMG_FAMILY}`;
                ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
                ctx.lineWidth = p.size >= 30 ? 6 : 5; ctx.strokeStyle = 'rgba(20,10,0,.9)'; ctx.strokeText(p.text, 0, 0);
                ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
                ctx.restore();
            }
            // cartel del hechizo: ícono + nombre, arriba del personaje
            if (p.spell && p.t < SPELL_DUR) {
                const k = p.t / SPELL_DUR, y = top - 58 - p.slot * ROW - easeOut(k) * 20, ic = 20, gap = 5;
                ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
                ctx.font = SPELL_FONT;
                const tw = ctx.measureText(p.spell.name).width, hasIc = !!p.spell.icon?.complete && p.spell.icon.naturalWidth > 0;
                const w = (hasIc ? ic + gap : 0) + tw, x0 = x - w / 2;
                ctx.fillStyle = 'rgba(10,8,6,.55)'; ctx.beginPath(); ctx.roundRect(x0 - 6, y - ic / 2 - 3, w + 12, ic + 6, 6); ctx.fill();
                if (hasIc) ctx.drawImage(p.spell.icon!, x0, y - ic / 2, ic, ic);
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)';
                const tx = x0 + (hasIc ? ic + gap : 0);
                ctx.strokeText(p.spell.name, tx, y + 1); ctx.fillStyle = '#f3e3b5'; ctx.fillText(p.spell.name, tx, y + 1);
                ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            }
        }
        ctx.restore();
    }

    private drawCasts(ctx: CanvasRenderingContext2D, head: number): void {
        for (const c of this.casts) {
            const pos = this.deps.resolve(c.key); if (!pos) continue; // sigue al personaje mientras se mueve
            const s = this.deps.toScreen(pos.x, pos.y), k = c.t / CAST_DUR, ic = 18, gap = 5;
            const y = s.y - head - CAST_LIFT - k * CAST_RISE;
            ctx.globalAlpha = 1 - k;
            ctx.font = SPELL_FONT;
            const tw = ctx.measureText(c.name).width, w = ic + gap + tw, x0 = s.x - w / 2;
            if (c.icon?.complete && c.icon.naturalWidth > 0) ctx.drawImage(c.icon, x0, y - ic / 2, ic, ic);
            else { ctx.fillStyle = c.primary; ctx.fillRect(x0, y - ic / 2, ic, ic); } // sin asset: cuadrado "teñido" con el color de la escuela
            ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y - ic / 2 + 0.5, ic - 1, ic - 1);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,6,0,.9)';
            const tx = x0 + ic + gap; ctx.strokeText(c.name, tx, y + 1); ctx.shadowColor = c.primary; ctx.shadowBlur = 6; ctx.fillStyle = c.glow; ctx.fillText(c.name, tx, y + 1); ctx.shadowBlur = 0;
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        }
        ctx.globalAlpha = 1;
    }

    private icon(id: string): HTMLImageElement | null {
        const hit = this.icons.get(id); if (hit) return hit;
        const url = this.deps.iconUrl?.(id); if (!url) return null;
        const im = new Image(); im.src = url; this.icons.set(id, im); return im;
    }
}
