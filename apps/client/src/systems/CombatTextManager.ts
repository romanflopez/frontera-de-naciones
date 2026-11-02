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

/** Cartel "estoy casteando X": anclado donde estaba el personaje (grilla), sube 30 px y se desvanece en 1,5 s. */
export interface FloatingSpellText {
    /** posición en grilla al momento del spawn */
    x: number; y: number;
    text: string;
    primaryColor: string; glowColor: string;
    /** performance.now() */
    startTime: number;
    duration: number;
    alpha: number;
    /** desplazamiento vertical actual (px, negativo = arriba) */
    currentY: number;
}
const CAST_DUR_MS = 1500, CAST_RISE = 30, CAST_LIFT = 50;

export class CombatTextManager {
    private items: Popup[] = [];
    readonly activeSpellTexts: FloatingSpellText[] = [];
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

    /** Spawnea el nombre del hechizo sobre la posición de grilla (x, y), con los colores de su escuela. */
    showCastingSpell(x: number, y: number, spellName: string, spellType: SpellType = 'PHYSICAL'): void {
        const c = SPELL_COLORS[spellType];
        this.activeSpellTexts.push({ x, y, text: spellName, primaryColor: c.primary, glowColor: c.glow, startTime: performance.now(), duration: CAST_DUR_MS, alpha: 1, currentY: 0 });
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
    }

    /** Dibujar con el contexto en coordenadas de pantalla (CSS px). */
    draw(ctx: CanvasRenderingContext2D): void {
        if (!this.items.length && !this.activeSpellTexts.length) return;
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
        const T = performance.now();
        for (let i = this.activeSpellTexts.length - 1; i >= 0; i--) {
            const t = this.activeSpellTexts[i], progress = Math.min((T - t.startTime) / t.duration, 1);
            if (progress >= 1) { this.activeSpellTexts.splice(i, 1); continue; } // limpieza
            t.currentY = -progress * CAST_RISE; t.alpha = 1 - progress;
            const s = this.deps.toScreen(t.x, t.y), x = s.x, y = s.y - head - CAST_LIFT + t.currentY;
            ctx.save();
            ctx.globalAlpha = t.alpha;
            ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            const tw = ctx.measureText(t.text).width;
            ctx.fillStyle = t.primaryColor; ctx.fillRect(x + 10 - tw / 2 - 22, y - 13, 16, 16); // "ícono" a la izquierda del texto
            ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeText(t.text, x + 10, y);
            ctx.shadowColor = t.glowColor; ctx.shadowBlur = 6; ctx.fillStyle = t.primaryColor; ctx.fillText(t.text, x + 10, y);
            ctx.restore();
        }
    }

    private icon(id: string): HTMLImageElement | null {
        const hit = this.icons.get(id); if (hit) return hit;
        const url = this.deps.iconUrl?.(id); if (!url) return null;
        const im = new Image(); im.src = url; this.icons.set(id, im); return im;
    }
}
