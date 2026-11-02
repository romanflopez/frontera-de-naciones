/**
 * Texto flotante de combate (daño / cura + nombre e ícono del hechizo).
 *
 * El cliente no usa Phaser: dibuja en un canvas 2D propio. Este sistema replica la idea
 * de "Text + Tween" de Phaser: cada texto sube 50 px y se desvanece en 1 s, y después se descarta.
 * Se dibuja en coordenadas de pantalla (después del transform del mundo), así el tamaño
 * de la fuente no depende del zoom.
 */

/** Forma del evento de red (espejo de `CombatTextEvent` del proto). */
export interface CombatTextEvent {
    targetId: string | bigint | number;
    amount: number;
    isHeal: boolean;
    /** Vacío = sin cartel de hechizo. */
    spellName: string;
    /** Opcional: id del hechizo para buscar su ícono. */
    spellId?: string;
}

interface Popup {
    /** Posición en grilla del objetivo al momento del golpe (el texto queda anclado ahí). */
    gx: number; gy: number;
    text: string; heal: boolean; t: number;
    /** Desplazamiento horizontal para que golpes seguidos no se pisen. */
    dx: number;
    spell?: { name: string; icon: HTMLImageElement | null };
}

const DUR = 1, RISE = 50, SPELL_DUR = 1.3;
const DMG_FONT = "700 32px Impact, 'Arial Black', sans-serif";
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

export class CombatTextManager {
    private items: Popup[] = [];
    private icons = new Map<string, HTMLImageElement>();
    private stack = 0;

    constructor(private deps: CombatTextDeps) {}

    /** Llamar cuando llega un CombatTextEvent por red. */
    onEvent(ev: CombatTextEvent): void {
        const pos = this.deps.resolve(ev.targetId);
        if (!pos) return;
        const amt = Math.round(Math.abs(ev.amount));
        const p: Popup = {
            gx: pos.x, gy: pos.y, t: 0, heal: ev.isHeal,
            text: ev.isHeal ? `+${amt}` : `${amt}`,
            dx: ((this.stack++ % 3) - 1) * 18,
        };
        if (ev.spellName) p.spell = { name: ev.spellName, icon: ev.spellId ? this.icon(ev.spellId) : null };
        this.items.push(p);
    }

    update(dt: number): void {
        for (let i = this.items.length - 1; i >= 0; i--) {
            const p = this.items[i]; p.t += dt;
            if (p.t >= Math.max(DUR, p.spell ? SPELL_DUR : 0)) this.items.splice(i, 1);
        }
        if (!this.items.length) this.stack = 0;
    }

    /** Dibujar con el contexto en coordenadas de pantalla (CSS px). */
    draw(ctx: CanvasRenderingContext2D): void {
        if (!this.items.length) return;
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
        const head = this.deps.headOffset();
        for (const p of this.items) {
            const s = this.deps.toScreen(p.gx, p.gy), x = s.x + p.dx, top = s.y - head;
            // número
            if (p.t < DUR) {
                const k = p.t / DUR, pop = p.t < 0.08 ? 0.7 + (p.t / 0.08) * 0.3 : 1;
                const y = top - 10 - easeOut(k) * RISE;
                ctx.globalAlpha = 1 - k;
                ctx.font = DMG_FONT;
                ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
                ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,10,0,.9)'; ctx.strokeText(p.text, 0, 0);
                ctx.fillStyle = p.heal ? '#00ff00' : '#ff9900'; ctx.fillText(p.text, 0, 0);
                ctx.restore();
            }
            // cartel del hechizo: ícono + nombre, arriba del personaje
            if (p.spell && p.t < SPELL_DUR) {
                const k = p.t / SPELL_DUR, y = top - 58 - easeOut(k) * 20, ic = 20, gap = 5;
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

    private icon(id: string): HTMLImageElement | null {
        const hit = this.icons.get(id); if (hit) return hit;
        const url = this.deps.iconUrl?.(id); if (!url) return null;
        const im = new Image(); im.src = url; this.icons.set(id, im); return im;
    }
}
