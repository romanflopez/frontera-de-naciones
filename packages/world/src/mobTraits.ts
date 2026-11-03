/**
 * Rasgos de los mobs (docs/PLAN_DE_TRABAJO.md paso 1.4): habilidades que cambian cómo se los pelea y pagan más exp, mutantes, salvajes y huida.
 * Los rasgos son una máscara de bits: el server los sortea al nacer cada mob y los manda en la foto de mobs; el cliente solo los muestra.
 */
import type { MobType } from './mobs.ts';

export const TRAIT_MUTANT = 1, TRAIT_ANTI_PHYS = 2, TRAIT_ANTI_MAGIC = 4, TRAIT_TOXIC = 8, TRAIT_EXPLOSIVE = 16, TRAIT_WILD = 32;
/**
 * Élite (docs/MAZMORRAS.md): uno por cada dos packs de una mazmorra. Pega más, aguanta más, ve de más lejos y paga más.
 * No se sortea: lo pone el server en lugares fijos de la mazmorra, y nunca es mutante a la vez.
 */
export const TRAIT_ELITE = 64;
export const SKILL_TRAITS = [TRAIT_ANTI_PHYS, TRAIT_ANTI_MAGIC, TRAIT_TOXIC, TRAIT_EXPLOSIVE] as const;

/** Multiplicador de exp de cada rasgo. Un mob tiene como mucho una habilidad; mutante y salvaje se suman por encima. */
export const TRAIT_EXP_MULT: Record<number, number> = { [TRAIT_MUTANT]: 3, [TRAIT_ANTI_PHYS]: 1.5, [TRAIT_ANTI_MAGIC]: 1.5, [TRAIT_TOXIC]: 1.3, [TRAIT_EXPLOSIVE]: 1.5, [TRAIT_WILD]: 1.25, [TRAIT_ELITE]: 3 };
export const MUTANT_DROP_MULT = 2, MUTANT_HP_MULT = 1.5, MUTANT_DMG_MULT = 1.25;
/** Élite: vida ×3, daño ×1,4, botín ×2 y +2 celdas de radio de aggro. */
export const ELITE_HP_MULT = 3, ELITE_DMG_MULT = 1.4, ELITE_DROP_MULT = 2, ELITE_AGGRO_BONUS = 2;
/** Chance (por pozo, al nacer cada mob) de ser mutante y de traer una habilidad. */
export const MUTANT_CHANCE = 0.03, SKILL_CHANCE = 0.1;
/** Un mob con anti-físico (anti-mágico) recibe esta fracción del daño físico (mágico). */
export const ANTI_DAMAGE_MULT = 0.5;
/** Tóxico: su golpe deja un sangrado de 3 ticks (1 s) de este porcentaje del golpe cada uno. Explosivo: al morir pega a los que estén a menos de EXPLOSION_RADIUS con este múltiplo de su daño medio. */
export const TOXIC_TICKS = 3, TOXIC_FRACTION = 0.15, EXPLOSION_RADIUS = 2.5, EXPLOSION_MULT = 1.5;

export const traitExpMult = (traits: number): number => Object.entries(TRAIT_EXP_MULT).reduce((m, [bit, k]) => (traits & Number(bit) ? m * k : m), 1);
export const traitDropMult = (traits: number): number => (traits & TRAIT_MUTANT ? MUTANT_DROP_MULT : 1) * (traits & TRAIT_ELITE ? ELITE_DROP_MULT : 1);
export const traitHpMult = (traits: number): number => (traits & TRAIT_MUTANT ? MUTANT_HP_MULT : 1) * (traits & TRAIT_ELITE ? ELITE_HP_MULT : 1);
export const traitDmgMult = (traits: number): number => (traits & TRAIT_MUTANT ? MUTANT_DMG_MULT : 1) * (traits & TRAIT_ELITE ? ELITE_DMG_MULT : 1);
/** Prefijo del nombre que ve el jugador ("Mutante Goblin lancero", "Explosivo Zombi..."). */
export function traitLabel(traits: number): string {
    const out: string[] = [];
    if (traits & TRAIT_ELITE) out.push('Élite');
    if (traits & TRAIT_MUTANT) out.push('Mutante');
    if (traits & TRAIT_ANTI_PHYS) out.push('Anti-físico');
    if (traits & TRAIT_ANTI_MAGIC) out.push('Anti-mágico');
    if (traits & TRAIT_TOXIC) out.push('Tóxico');
    if (traits & TRAIT_EXPLOSIVE) out.push('Explosivo');
    if (traits & TRAIT_WILD) out.push('Salvaje');
    return out.join(' ');
}

/** Huida: por debajo de esta fracción de vida, un mob "cobarde" corre; la probabilidad (su valentía al revés) depende del tipo. Los jefes nunca huyen. */
export const FLEE_HP_FRAC = 0.07, FLEE_SECS = 5, FLEE_SPEED_MULT = 1.2;
const FLEE: Partial<Record<MobType, number>> = {
    goblin: 0.6, goblin_elite: 0.4, hobgoblin: 0.4, hobgoblin_archer: 0.7, skeleton_archer: 0.3, antlion: 0.5, antlion_small: 0.7, fire_ant: 0.5, ice_ant: 0.5,
    wyvern: 0.3, wyvern_fire: 0.3, wyvern_ice: 0.3, skeleton_mage: 0.3,
};
export const fleeChance = (type: MobType): number => FLEE[type] ?? 0;

// ---------- mazmorras (docs/MAZMORRAS.md) ----------
/**
 * Escalado por party de las mazmorras: los números de los mobs y jefes de mazmorra están pensados para 3 jugadores (×1). La instancia toma
 * la cantidad de jugadores que entraron juntos al crearse y reescala a todos sus mobs: vida 0,5 + 0,25 por jugador de más (solo ×0,5,
 * dúo ×0,75, trío ×1, cuatro ×1,25, cinco ×1,5) y daño 0,85 + 0,075 por jugador de más. La exp y el botín de cada mob no cambian (la exp
 * ya se reparte en la party). Se calibra jugando.
 */
export const DUNGEON_PARTY_MAX = 5;
export function dungeonPartyScale(n: number): { hp: number; dmg: number } {
    const k = Math.min(DUNGEON_PARTY_MAX, Math.max(1, Math.floor(n) || 1)) - 1;
    return { hp: 0.5 + 0.25 * k, dmg: 0.85 + 0.075 * k };
}
/** ¿Es élite el mob número `i` (desde 0) de la zona `zi` de una mazmorra? El primero de cada zona par (un élite cada dos packs), si la zona tiene 2 o más. */
export const isEliteSlot = (zi: number, i: number, n: number): boolean => n >= 2 && zi % 2 === 0 && i === 0;
