/**
 * Personajes "típicos" por clase y nivel para la simulación: equipo común de la tienda y del botín (sin únicos)
 * con mejoras moderadas, y los puntos de atributos repartidos como los repartiría un jugador normal.
 * Es un supuesto: si cambia el equipo de referencia, hay que volver a correr `sim:pvp`.
 */
import { STAT_BASE, STAT_CAP, statPointsTotal, type Stats } from '@fdn/world';
import { statsFromChar, type CombatStats } from '../../../../apps/server/src/systems/pvpCombat.ts';

export type Cls = 'guerrero' | 'mago' | 'healer';
export const CLS_NAME: Record<Cls, string> = { guerrero: 'paladín', mago: 'mago', healer: 'healer' };

type Eq = Record<string, { n: string; up?: number }>;
/** Equipo por tramo: hasta 15 (D1-D3), 16-30, 31-40. */
const GEAR: Record<Cls, [Eq, Eq, Eq]> = {
    guerrero: [
        { arma: { n: 'Espada larga' }, armadura: { n: 'Cota de malla' }, cabeza: { n: 'Cofia de malla' }, anillo: { n: 'Anillo opaco' } },
        { arma: { n: 'Hacha de guerra', up: 3 }, armadura: { n: 'Placas del Sol', up: 3 }, cabeza: { n: 'Yelmo del Sol', up: 3 }, anillo: { n: 'Anillo opaco', up: 3 } },
        { arma: { n: 'Mandoble', up: 6 }, armadura: { n: 'Placas del Sol', up: 6 }, cabeza: { n: 'Yelmo del Sol', up: 6 }, anillo: { n: 'Anillo opaco', up: 6 } },
    ],
    mago: [
        { arma: { n: 'Báculo de fresno' }, armadura: { n: 'Túnica de mago' }, cabeza: { n: 'Capucha de mago' }, anillo: { n: 'Anillo opaco' } },
        { arma: { n: 'Varita', up: 3 }, armadura: { n: 'Túnica de mago', up: 3 }, cabeza: { n: 'Capucha de mago', up: 3 }, anillo: { n: 'Anillo opaco', up: 3 } },
        { arma: { n: 'Varita', up: 6 }, armadura: { n: 'Túnica de mago', up: 6 }, cabeza: { n: 'Capucha de mago', up: 6 }, anillo: { n: 'Anillo opaco', up: 6 } },
    ],
    healer: [
        { arma: { n: 'Báculo de fresno' }, armadura: { n: 'Túnica de mago' }, cabeza: { n: 'Capucha de mago' }, anillo: { n: 'Anillo opaco' } },
        { arma: { n: 'Báculo de fresno', up: 3 }, armadura: { n: 'Túnica de mago', up: 3 }, cabeza: { n: 'Capucha de mago', up: 3 }, anillo: { n: 'Anillo opaco', up: 3 } },
        { arma: { n: 'Báculo de fresno', up: 6 }, armadura: { n: 'Túnica de mago', up: 6 }, cabeza: { n: 'Capucha de mago', up: 6 }, anillo: { n: 'Anillo opaco', up: 6 } },
    ],
};
/** Reparto de los puntos libres: [atributo, fracción]. */
const SPLIT: Record<Cls, [keyof Stats, number][]> = {
    guerrero: [['str', 0.5], ['vit', 0.5]],
    mago: [['mag', 0.65], ['vit', 0.35]],
    healer: [['mag', 0.5], ['vit', 0.5]],
};

export function buildStats(cls: Cls, lvl: number): CombatStats {
    const pts = statPointsTotal(lvl), st: Stats = { str: STAT_BASE, vit: STAT_BASE, dex: STAT_BASE, mag: STAT_BASE };
    let left = pts;
    SPLIT[cls].forEach(([id, f], i) => { const n = i === SPLIT[cls].length - 1 ? left : Math.round(pts * f); st[id] = Math.min(STAT_CAP, STAT_BASE + n); left -= n; });
    const eq = GEAR[cls][lvl <= 15 ? 0 : lvl <= 30 ? 1 : 2];
    return statsFromChar({ lvl, cls, stats: st, eq });
}
