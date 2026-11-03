/**
 * Reglas de PvP que calibra la simulación (K7). Los valores por defecto salen del server (pvpCombat.ts), así que
 * `sim:pvp` sin parámetros mide exactamente lo que está en el juego. Para barrer valores se pasan otros `Rules`.
 *
 * Las fórmulas de acá replican `pvpScale`, `pvpCap`, `pvpVsCtrl`, `potionHp`, `potionMp` y `potionLockMs` con los
 * números como parámetro; `apps/server/test/sim-pvp.test.ts` verifica que con los valores por defecto den lo mismo.
 */
import { COMBAT_MP_REGEN_PCT, POTION_LOCK_PVP_MS, PVP_MP_REGEN_MIN, POTION_PVP_MULT, PVP_DMG_MULT, PVP_HIT_CAP, PVP_VS_CTRL_MAX } from '../../../../apps/server/src/systems/pvpCombat.ts';

export interface Rules {
    /** Multiplicador global del daño contra jugadores (PVP_DMG_MULT). */
    dmgMult: number;
    /** Ningún golpe saca más que esta fracción de la vida máxima (PVP_HIT_CAP). */
    hitCap: number;
    /** Tope de los multiplicadores "sobre controlado" (PVP_VS_CTRL_MAX). */
    vsCtrlMax: number;
    /** Bloqueo compartido de pociones en PvP, ms (POTION_LOCK_PVP_MS). */
    potLockMs: number;
    /** Tamaño de la poción en PvP respecto de la de PvE (POTION_PVP_MULT). */
    potMult: number;
    /** Regeneración de maná en combate, fracción del máximo por segundo (COMBAT_MP_REGEN_PCT). */
    mpRegenPct: number;
    /** Piso de esa regeneración en combate PvP, maná por segundo (PVP_MP_REGEN_MIN). */
    mpRegenMin: number;
    /** PROPUESTA (no está en el server): golpes que envenenan a un jugador (−30 % de curación, 4 s). Ids de hechizo; 'quemadura' = cada pulso. */
    poisonOn: string[];
    /** PROPUESTA (no está en el server): recarga de Curación contra/entre jugadores, s (hoy 5). */
    healCd: number;
    /** PROPUESTA (no está en el server): multiplicador de Castigo contra jugadores (hoy 1). */
    castigoMult: number;
    /** PROPUESTA: Renovar cura `frac` repartido en los 6 pulsos (6,25 % en total, como dice kits-de-clase.md) en vez de por pulso (37,5 % hoy). */
    renewTotal: boolean;
}

export const SERVER_RULES: Rules = {
    dmgMult: PVP_DMG_MULT, hitCap: PVP_HIT_CAP, vsCtrlMax: PVP_VS_CTRL_MAX, potLockMs: POTION_LOCK_PVP_MS, potMult: POTION_PVP_MULT, mpRegenPct: COMBAT_MP_REGEN_PCT, mpRegenMin: PVP_MP_REGEN_MIN, poisonOn: [], healCd: 5, castigoMult: 1, renewTotal: false,
};

export const scale = (r: Rules, raw: number): number => Math.max(1, Math.round(raw * r.dmgMult));
export const cap = (r: Rules, dmg: number, maxHp: number): number => Math.min(dmg, Math.max(1, Math.floor(maxHp * r.hitCap)));
export const vsCtrl = (r: Rules, k: number): number => Math.min(k, r.vsCtrlMax);
/** Poción de vida en PvP (en la sim todas las pociones se toman en combate PvP). */
export const potHp = (r: Rules, maxHp: number): number => Math.max(25, Math.round(maxHp * 0.4 * r.potMult));
export const potMp = (r: Rules, maxMp: number): number => Math.max(20, Math.round(maxMp * 0.5 * r.potMult));
