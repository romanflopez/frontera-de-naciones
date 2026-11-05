/**
 * Metas de PvE (etapa 6b del roadmap). Salen de lo ya decidido para ERIS (curva de exp: ~1 h hasta el 10 y ~60 h hasta el 40
 * a un mob por vez) y de las proporciones de Dreadmyst (`dreadmyst-referencia-balance.md`): élite = 3× la vida de un común,
 * un común te saca una parte chica pero real de la vida, y casi todo el tiempo se pelea, no se espera.
 */
import type { Cls } from '../pvp/builds.ts';

/** Segundos de caminar entre un mob y el siguiente en un pit. */
export const TRAVEL_S = 2.5;
export interface Measured { ttk: number; took: number; eliteWin: number; rest: number; deaths: number }
/** Tiempo para matar un común de tu nivel (s): rápido al principio (el 1-10 no se tiene que hacer lento) y ~20 s al 40. */
export const ttkRange = (lvl: number): [number, number] => [0.8 + 0.2 * lvl, 6 + 0.5 * lvl];
/** Vida que saca un común de tu nivel (% de la máxima): hasta el 10 sube de a poco (fácil al principio), después una banda fija. */
export function tookRange(cls: Cls, lvl: number): [number, number] {
    const lo = lvl <= 10 ? 1 + 0.4 * lvl : 5, hi = lvl <= 10 ? 8 + 0.7 * lvl : 15;
    return cls === 'pala' ? [lo, hi] : cls === 'mago' ? [lo * 0.5, hi * 1.6] : [lo * 0.5, hi * 2.2]; // mago y clérigo no kitean en la sim; el clérigo se cura lo que recibe
}
export const PVE_TARGETS = {
    eliteWin: 0.8, maxRest: 0.25, maxDeathsPerHour: 0.5,
    check(cls: Cls, lvl: number, m: Measured): { ok: boolean; why: string[] } {
        const why: string[] = [], [lo, hi] = ttkRange(lvl), k = cls === 'clerigo' ? 1.6 : 1, [tl, th] = tookRange(cls, lvl);
        if (m.ttk < lo) why.push('mata muy rápido'); if (m.ttk > hi * k) why.push('mata muy lento');
        if (m.took < tl) why.push('casi no recibe daño'); if (m.took > th) why.push('recibe demasiado');
        if (m.eliteWin < this.eliteWin) why.push('pierde con el élite');
        if (m.rest > this.maxRest) why.push('para demasiado');
        if (m.deaths > this.maxDeathsPerHour) why.push('muere farmeando');
        return { ok: why.length === 0, why };
    },
};
