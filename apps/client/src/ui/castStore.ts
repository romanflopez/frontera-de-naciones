/** Estado de la barra de casteo (Zustand). El juego llama startCast/cancelCast; el progreso avanza solo con requestAnimationFrame. */
import { create } from 'zustand';
import { SPELL_COLORS, type SpellType } from './colors';

export interface CastState {
    isCasting: boolean;
    spellName: string;
    /** data URL del ícono (opcional) */
    icon: string;
    spellType: SpellType;
    /** relleno y brillo de la barra (de SPELL_COLORS) */
    color: string;
    glow: string;
    progress: number; // 0 a 100
    startedAt: number;
    durationMs: number;
    startCast: (name: string, durationMs: number, spellType?: SpellType, icon?: string) => void;
    updateProgress: (progress: number) => void;
    /** Cambia la duración total sin reiniciar (p. ej. al recibir un golpe que demora el cast). */
    setDuration: (durationMs: number) => void;
    cancelCast: () => void;
}

let raf = 0;

export const useCastStore = create<CastState>((set, get) => {
    const tick = () => {
        const s = get();
        if (!s.isCasting) { raf = 0; return; }
        const p = Math.min(100, ((performance.now() - s.startedAt) / Math.max(1, s.durationMs)) * 100);
        if (Math.round(p) !== Math.round(s.progress)) set({ progress: p });
        raf = p < 100 ? requestAnimationFrame(tick) : 0;
    };
    return {
        isCasting: false, spellName: '', icon: '', spellType: 'PHYSICAL', color: SPELL_COLORS.PHYSICAL.primary, glow: SPELL_COLORS.PHYSICAL.glow, progress: 0, startedAt: 0, durationMs: 0,
        startCast: (name, durationMs, spellType = 'PHYSICAL', icon = '') => {
            cancelAnimationFrame(raf);
            const c = SPELL_COLORS[spellType];
            set({ isCasting: true, spellName: name, icon, spellType, color: c.primary, glow: c.glow, progress: 0, startedAt: performance.now(), durationMs });
            raf = requestAnimationFrame(tick);
        },
        updateProgress: (progress) => set({ progress: Math.max(0, Math.min(100, progress)) }),
        setDuration: (durationMs) => { set({ durationMs }); if (!raf && get().isCasting) raf = requestAnimationFrame(tick); },
        cancelCast: () => { cancelAnimationFrame(raf); raf = 0; set({ isCasting: false, progress: 0 }); },
    };
});
