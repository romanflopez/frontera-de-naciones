/**
 * Ítems únicos (docs/ITEMS.md): equipo con nombre y atributos fijos, por banda de nivel (tier = ceil(nivel / 2), 1..6) y slot.
 * Cada único es una `Base` más: entra en ALL_BASES, así que subasta, depósito, tiendas y el cliente lo reconocen sin cambios.
 * Sus atributos fijos salen de `uniq.attrs` (el server los tira con una variación de ±10 %). De momento hay T1 a T3 y los
 * ítems de los jefes de las mazmorras D1-D3; los mobs de bandas más altas siguen con el botín viejo hasta que existan sus ítems.
 */
import type { AttrId, Base, Slot } from './economy';
import type { MobType } from './mobs';

/** Bandas con ítems únicos ya hechos. */
export const UNIQUE_TIERS_READY = 3;
/** Tier de ítem de un mob según su nivel. */
export const tierOfLevel = (lvl: number): number => Math.max(1, Math.min(6, Math.ceil(lvl / 2)));
/** Variación de los atributos fijos de un único al caer. */
export const UNIQUE_VARIATION = 0.1;

type Arch = 'arma1' | 'arma2' | 'armaM' | 'armPes' | 'armMed' | 'armMag' | 'cabF' | 'cabM' | 'anilloO' | 'anilloD';
interface Def { tier: number; arch: Arch; name: string; look?: string; off?: string; boss?: MobType; mult?: number }

/** Punto medio de cada atributo (ver ATTR_RANGES): los fijos de un único son este valor por un factor de la banda. */
const MID: Record<AttrId, number> = { crit: 4, aspd: 8, leech: 4, hp: 16, mp: 13, mag: 4, exp: 6, poison: 11, rpar: 10, df: 6, rm: 8 };
/** Atributos de cada arquetipo (dos por ítem). */
const ATTRS: Record<Arch, [AttrId, AttrId]> = {
    arma1: ['aspd', 'crit'], arma2: ['crit', 'leech'], armaM: ['mag', 'mp'],
    armPes: ['hp', 'df'], armMed: ['hp', 'aspd'], armMag: ['mp', 'rm'],
    cabF: ['df', 'hp'], cabM: ['mp', 'mag'], anilloO: ['crit', 'leech'], anilloD: ['hp', 'rm'],
};
const SLOT: Record<Arch, Slot> = { arma1: 'arma', arma2: 'arma', armaM: 'arma', armPes: 'armadura', armMed: 'armadura', armMag: 'armadura', cabF: 'cabeza', cabM: 'cabeza', anilloO: 'anillo', anilloD: 'anillo' };
const LOOK: Record<Arch, string | undefined> = { arma1: 'longsword', arma2: 'maul', armaM: 'staff', armPes: 'plate', armMed: 'chain', armMag: 'mage', cabF: 'plate_helm', cabM: 'mage_hood', anilloO: 'ring_ruby', anilloD: 'ring_jade' };
const OFF: Partial<Record<Arch, string>> = { arma1: 'iron_buckler' };

const R = Math.round;
/** Stats base del arquetipo a la banda `t` (con `m` = multiplicador, p. ej. 1,25 en ítems de jefe). */
function stats(arch: Arch, t: number, m: number): Pick<Base, 'dmg' | 'def' | 'rm' | 'mag'> {
    switch (arch) {
        case 'arma1': return { dmg: [R((4 + t * 1.8) * m), R((8 + t * 2.4) * m)] };
        case 'arma2': return { dmg: [R((4 + t * 1.8) * 1.35 * m), R((8 + t * 2.4) * 1.35 * m)] };
        case 'armaM': return { dmg: [R(1 + t * 0.5), R(3 + t * 0.8)], mag: R((8 + t * 5) * m) };
        case 'armPes': return { def: R((14 + 6 * t) * m), rm: R((14 + 6 * t) * 0.35 * m) };
        case 'armMed': return { def: R((10 + 4.5 * t) * m), rm: R((5 + 2 * t) * m) };
        case 'armMag': return { def: R(3 + t), rm: R((18 + 5 * t) * m), mag: R((3 + t) * m) };
        case 'cabF': return { def: R((5 + 2.6 * t) * m), rm: R((2 + t) * m) };
        case 'cabM': return { def: R(2 + 0.6 * t), rm: R((8 + 2.6 * t) * m), mag: R((2 + 0.6 * t) * m) };
        default: return {};
    }
}

const DEFS: Def[] = [
    // T1 (nivel 1-2: Campos de Sal, Bosque de piedra)
    { tier: 1, arch: 'arma1', name: 'Hoja de sal' }, { tier: 1, arch: 'arma2', name: 'Mazo del campamento' }, { tier: 1, arch: 'armaM', name: 'Vara de raíz' },
    { tier: 1, arch: 'armPes', name: 'Coraza de bronce viejo' }, { tier: 1, arch: 'armMed', name: 'Malla del explorador' }, { tier: 1, arch: 'armMag', name: 'Manto de lino bordado' },
    { tier: 1, arch: 'cabF', name: 'Casco del vigía' }, { tier: 1, arch: 'cabM', name: 'Capucha de musgo' },
    { tier: 1, arch: 'anilloO', name: 'Anillo de sal' }, { tier: 1, arch: 'anilloD', name: 'Anillo de piedra del bosque' },
    // T2 (nivel 3-4: Cañón goblin, Pantano de Merrimead)
    { tier: 2, arch: 'arma1', name: 'Espada del Cañón' }, { tier: 2, arch: 'arma2', name: 'Hachón del pantano', look: 'zweihander' }, { tier: 2, arch: 'armaM', name: 'Cayado del cenagal' },
    { tier: 2, arch: 'armPes', name: 'Peto de escamas de cieno' }, { tier: 2, arch: 'armMed', name: 'Cota del pantanero' }, { tier: 2, arch: 'armMag', name: 'Túnica del cenagal' },
    { tier: 2, arch: 'cabF', name: 'Yelmo de caña' }, { tier: 2, arch: 'cabM', name: 'Gorro del brujo del pantano' },
    { tier: 2, arch: 'anilloO', name: 'Anillo de ámbar' }, { tier: 2, arch: 'anilloD', name: 'Sello del cenagal' },
    // T3 (nivel 5-6: Altas de Nazia, Cementerio de Lochport, Risco del Sur)
    { tier: 3, arch: 'arma1', name: 'Colmillo de las altas', look: 'shortsword' }, { tier: 3, arch: 'arma2', name: 'Martillo de Lochport' }, { tier: 3, arch: 'armaM', name: 'Báculo del camposanto' },
    { tier: 3, arch: 'armPes', name: 'Coraza de Nazia' }, { tier: 3, arch: 'armMed', name: 'Malla del sepulturero' }, { tier: 3, arch: 'armMag', name: 'Mortaja bordada' },
    { tier: 3, arch: 'cabF', name: 'Yelmo del risco' }, { tier: 3, arch: 'cabM', name: 'Capuchón de duelo' },
    { tier: 3, arch: 'anilloO', name: 'Anillo de hueso' }, { tier: 3, arch: 'anilloD', name: 'Sello del risco' },
    // Jefes de mazmorra (D1-D3): mejores que los de su banda y con el aspecto del tier siguiente
    { tier: 2, arch: 'arma1', name: 'Cuchilla del Jefe goblin', look: 'hand_axe', boss: 'goblin_jefe', mult: 1.3 }, { tier: 2, arch: 'armPes', name: 'Peto del Jefe goblin', boss: 'goblin_jefe', mult: 1.3 },
    { tier: 4, arch: 'arma1', name: 'Aguijón de la Reina', look: 'longsword', boss: 'antlion_reina', mult: 1.3 }, { tier: 4, arch: 'armPes', name: 'Caparazón de la Reina', boss: 'antlion_reina', mult: 1.3 },
    { tier: 5, arch: 'arma2', name: 'Mandoble del Caballero de la cripta', look: 'zweihander', boss: 'caballero_cripta', mult: 1.3 }, { tier: 5, arch: 'cabF', name: 'Yelmo del Caballero de la cripta', boss: 'caballero_cripta', mult: 1.3 },
];

export interface UniqueInfo { tier: number; attrs: [AttrId, number][]; boss?: MobType }
export type UniqueBase = Base & { uniq: UniqueInfo };

/** Valor de lista de un único (para el precio de venta/subasta mínima): crece rápido con la banda. */
export const uniqueValue = (tier: number, boss: boolean): number => Math.round(60 * Math.pow(tier, 1.6) * (boss ? 2 : 1));

export const UNIQUE_BASES: UniqueBase[] = DEFS.map((d): UniqueBase => {
    const m = d.mult ?? 1, [a, b] = ATTRS[d.arch], f = (0.8 + 0.2 * d.tier) * m;
    return {
        name: d.name, slot: SLOT[d.arch], ...stats(d.arch, d.tier, m), look: d.look ?? LOOK[d.arch], off: d.off ?? OFF[d.arch],
        uniq: { tier: d.tier, boss: d.boss, attrs: [[a, Math.max(1, R(MID[a] * f))], [b, Math.max(1, R(MID[b] * f))]] },
    };
});
export const UNIQUE_BY_NAME = new Map(UNIQUE_BASES.map((u) => [u.name, u]));
/** Únicos que caen de mobs comunes por banda (todos menos los de jefe). */
export const UNIQUES_BY_TIER: Record<number, UniqueBase[]> = {};
for (const u of UNIQUE_BASES) if (!u.uniq.boss) (UNIQUES_BY_TIER[u.uniq.tier] ??= []).push(u);
/** Ítems característicos de cada jefe de mazmorra. */
export const BOSS_UNIQUES: Partial<Record<MobType, UniqueBase[]>> = {};
for (const u of UNIQUE_BASES) if (u.uniq.boss) (BOSS_UNIQUES[u.uniq.boss] ??= []).push(u);

// ---------- mejora (+N) de ítems únicos (docs/ITEMS.md §7) ----------
/** Tope de mejora del MVP (el diseño llega a +11; las probabilidades de fallo viven solo en el server). */
export const UP_MAX = 5;
/** Cada nivel de mejora suma este porcentaje a los stats base del ítem (daño, defensa, RM y daño mágico). */
export const UP_PCT = 0.04;
export const upMult = (up = 0): number => 1 + UP_PCT * Math.max(0, up);
/** Piedras de forja y oro que cuesta pasar de +up a +up+1 un ítem de la banda `tier`. */
export const upStones = (up: number): number => up + 1;
export const upGold = (tier: number, up: number): number => Math.round(40 * tier * (up + 1));
