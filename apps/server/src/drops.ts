/**
 * Configuración de botín: se lee de `drops.json` en DATA_DIR al arrancar y se puede
 * cambiar en vivo con `/gm drops <clave> <valor>` (lo de en vivo no se guarda: para que quede, va en el archivo).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DropConfig {
    /** `personal`: lo que suelta un mob va directo a la bolsa de quien lo mató (y su party en rango); `suelo`: cae al piso. */
    mode: 'personal' | 'suelo';
    /** Chance por kill de que caiga oro directo (a la bolsa), y el rango por nivel del mob. */
    goldChance: number; goldMin: number; goldMax: number;
    /** Chance por kill de material o basura (en modo `suelo` cae al piso; en `personal` va a la bolsa). */
    floorChance: number;
    /** Chance por kill de una poción (sustain para subir de nivel). */
    potionChance: number;
    /** Multiplicadores sobre la chance de único y de piedra de forja. */
    uniqueMult: number; forgeMult: number;
}
export const DROPS: DropConfig = { mode: 'personal', goldChance: 0.25, goldMin: 5, goldMax: 15, floorChance: 0.2, potionChance: 0.14, uniqueMult: 1, forgeMult: 1 };
export const DROP_DEFAULTS: DropConfig = { ...DROPS };

const RANGES: Record<Exclude<keyof DropConfig, 'mode'>, [number, number]> = {
    goldChance: [0, 1], goldMin: [0, 1000], goldMax: [0, 1000], floorChance: [0, 1], potionChance: [0, 1], uniqueMult: [0, 10], forgeMult: [0, 10],
};

/** Aplica un cambio validado; devuelve el error en texto o null si salió bien. */
export function setDrop(key: string, raw: string | number, cfg: DropConfig = DROPS): string | null {
    if (key === 'mode') {
        const v = String(raw).toLowerCase();
        if (v !== 'personal' && v !== 'suelo') return 'mode: personal o suelo.';
        cfg.mode = v; return null;
    }
    const range = (RANGES as Record<string, [number, number]>)[key];
    if (!range) return `Clave desconocida (${key}). Claves: mode, ${Object.keys(RANGES).join(', ')}.`;
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < range[0] || n > range[1]) return `${key}: un número entre ${range[0]} y ${range[1]}.`;
    (cfg as unknown as Record<string, number>)[key] = n;
    if (cfg.goldMin > cfg.goldMax) cfg.goldMax = cfg.goldMin;
    return null;
}

/** Lee `drops.json` (si existe) y lo aplica; devuelve los errores (una clave mala no frena a las demás). */
export function loadDropsFile(dir: string, cfg: DropConfig = DROPS): string[] {
    const file = join(dir, 'drops.json'); if (!existsSync(file)) return [];
    try {
        const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        return Object.entries(j).flatMap(([k, v]) => { const e = setDrop(k, v as string | number, cfg); return e ? [`drops.json: ${e}`] : []; });
    } catch (e) { return [`drops.json: no se pudo leer (${(e as Error).message})`]; }
}

export const dropLines = (cfg: DropConfig = DROPS): string[] => [
    `Botín: modo ${cfg.mode} · oro ${(cfg.goldChance * 100).toFixed(0)} % (${cfg.goldMin}-${cfg.goldMax} por nivel) · materiales ${(cfg.floorChance * 100).toFixed(0)} % · pociones ${(cfg.potionChance * 100).toFixed(0)} % · únicos ×${cfg.uniqueMult} · forja ×${cfg.forgeMult}`,
];
