/** Estado del Libro de Hechizos y de la barra de macros (Hotbar). main.ts sincroniza level/classId/slots y registra onAssign. */
import { create } from 'zustand';

const PATH_KEY = 'fdn:path';

export interface SpellbookState {
    open: boolean;
    level: number;
    classId: string;
    /** id del hechizo en cada slot de la barra (null = vacío) */
    slots: (string | null)[];
    /** camino elegido por clase */
    paths: Record<string, string>;
    toggle: (open?: boolean) => void;
    choosePath: (pathId: string) => void;
    /** Asigna un hechizo a un slot (si ya estaba en otro, se mueve). Lo implementa el juego. */
    assign: (spellId: string, slot: number) => void;
}

const loadPaths = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(PATH_KEY) ?? '{}'); } catch { return {}; } };

export const useSpellbook = create<SpellbookState>((set, get) => ({
    open: false, level: 1, classId: 'mago', slots: [], paths: loadPaths(),
    toggle: (open) => set({ open: open ?? !get().open }),
    choosePath: (pathId) => {
        const { classId, paths, level } = get();
        if (paths[classId] || level < 10) return;
        const next = { ...paths, [classId]: pathId };
        try { localStorage.setItem(PATH_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
        set({ paths: next });
    },
    assign: () => {},
}));

export const SPELL_DND = 'application/x-fdn-spell';
