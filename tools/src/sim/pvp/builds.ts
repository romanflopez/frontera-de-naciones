/**
 * Personajes "típicos" por clase y nivel para la simulación: equipo común de la tienda y del botín (sin únicos)
 * con mejoras moderadas, y los puntos de atributos repartidos como los repartiría un jugador normal.
 * Es un supuesto: si cambia el equipo de referencia, hay que volver a correr `sim:pvp`.
 */
import { powerLevel, STAT_BASE, STAT_CAP, statPointsTotal, type Stats } from '@fdn/world';
import { statsFromChar, type CombatStats } from '../../../../apps/server/src/systems/pvpCombat.ts';

export type Cls = 'guerrero' | 'mago' | 'healer';
export const CLS_NAME: Record<Cls, string> = { guerrero: 'paladín', mago: 'mago', healer: 'healer' };

type Eq = Record<string, { n: string; up?: number }>;
/** Equipo por tramo: hasta 15 (D1-D3), 16-30, 31-40. */
const GEAR: Record<Cls, [Eq, Eq, Eq]> = {
    // equipo de tienda hasta T1 y únicos de banda desde ahí: la tienda ya no iguala a los únicos (≤ 75 %), así que el equipo representativo de cada tramo es el único de su banda
    guerrero: [
        { arma: { n: 'Espada del Cañón' }, armadura: { n: 'Cota del pantanero' }, cabeza: { n: 'Yelmo de caña' }, anillo: { n: 'Anillo opaco' } },
        { arma: { n: 'Hacha de guerra de Stormrock', up: 3 }, armadura: { n: 'Coraza de la Brecha', up: 3 }, cabeza: { n: 'Yelmo del minero caído', up: 3 }, anillo: { n: 'Anillo opaco', up: 3 } },
        { arma: { n: 'Hachón de las cámaras', up: 6 }, armadura: { n: 'Placas del carcelero', up: 6 }, cabeza: { n: 'Yelmo del carcelero', up: 6 }, anillo: { n: 'Anillo opaco', up: 6 } },
    ],
    mago: [
        { arma: { n: 'Cayado del cenagal' }, armadura: { n: 'Túnica del cenagal' }, cabeza: { n: 'Gorro del brujo del pantano' }, anillo: { n: 'Anillo opaco' } },
        { arma: { n: 'Cayado del investigador', up: 3 }, armadura: { n: 'Túnica de la torre', up: 3 }, cabeza: { n: 'Capucha del aprendiz de la torre', up: 3 }, anillo: { n: 'Anillo opaco', up: 3 } },
        { arma: { n: 'Cetro del puerto de la perdición', up: 6 }, armadura: { n: 'Túnica del abismo', up: 6 }, cabeza: { n: 'Capucha del suplicio', up: 6 }, anillo: { n: 'Anillo opaco', up: 6 } },
    ],
    healer: [
        { arma: { n: 'Cayado del cenagal' }, armadura: { n: 'Túnica del cenagal' }, cabeza: { n: 'Gorro del brujo del pantano' }, anillo: { n: 'Anillo opaco' } },
        { arma: { n: 'Cayado del investigador', up: 3 }, armadura: { n: 'Túnica de la torre', up: 3 }, cabeza: { n: 'Capucha del aprendiz de la torre', up: 3 }, anillo: { n: 'Anillo opaco', up: 3 } },
        { arma: { n: 'Cetro del puerto de la perdición', up: 6 }, armadura: { n: 'Túnica del abismo', up: 6 }, cabeza: { n: 'Capucha del suplicio', up: 6 }, anillo: { n: 'Anillo opaco', up: 6 } },
    ],
};
/** Reparto de los puntos libres: [atributo, fracción]. */
const SPLIT: Record<Cls, [keyof Stats, number][]> = {
    guerrero: [['str', 0.5], ['vit', 0.5]],
    mago: [['mag', 0.65], ['vit', 0.35]],
    healer: [['mag', 0.5], ['vit', 0.5]],
};

export function buildStats(cls: Cls, lvl: number): CombatStats {
    const pts = statPointsTotal(lvl), st: Stats = { str: STAT_BASE, vit: STAT_BASE, dex: STAT_BASE, int: STAT_BASE, mag: STAT_BASE };
    let left = pts;
    SPLIT[cls].forEach(([id, f], i) => { const n = i === SPLIT[cls].length - 1 ? left : Math.round(pts * f); st[id] = Math.min(STAT_CAP, STAT_BASE + n); left -= n; });
    const pl = powerLevel(lvl), eq = GEAR[cls][pl <= 15 ? 0 : pl <= 30 ? 1 : 2];
    return statsFromChar({ lvl, cls, stats: st, eq });
}
