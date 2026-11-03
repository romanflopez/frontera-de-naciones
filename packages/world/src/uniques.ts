/**
 * Ítems únicos (docs/ITEMS.md): equipo con nombre y atributos fijos, por banda de nivel (la del tier de zona: niveles 1-5 = 1, 6-10 = 2 … 26-40 = 6) y slot.
 * Cada único es una `Base` más: entra en ALL_BASES, así que subasta, depósito, tiendas y el cliente lo reconocen sin cambios.
 * Sus atributos fijos salen de `uniq.attrs` (el server los tira con una variación de ±10 %). Hay únicos de mobs comunes de T1 a T6
 * (los mobs de T7 sueltan los de T6: la banda de ítems topea en 6) y los ítems de los jefes de las mazmorras D1-D7.
 */
import { itemBandOfLevel } from './tiers';
import type { AttrId, Base, Slot } from './economy';
import type { MobType } from './mobs';

/** Bandas con ítems únicos ya hechos. */
export const UNIQUE_TIERS_READY = 6;
/** Tier de ítem de un mob según su nivel. */
/** Banda de ítems de un mob de nivel `lvl`: la del tier de su nivel (docs/TIERS_DE_ZONA.md), con tope 6. */
export const tierOfLevel = (lvl: number): number => itemBandOfLevel(lvl);
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
    // T1 (nivel 1-5: Campos de Sal, Bosque de piedra, Cañón goblin)
    { tier: 1, arch: 'arma1', name: 'Hoja de sal' }, { tier: 1, arch: 'arma2', name: 'Mazo del campamento' }, { tier: 1, arch: 'armaM', name: 'Vara de raíz' },
    { tier: 1, arch: 'armPes', name: 'Coraza de bronce viejo' }, { tier: 1, arch: 'armMed', name: 'Malla del explorador' }, { tier: 1, arch: 'armMag', name: 'Manto de lino bordado' },
    { tier: 1, arch: 'cabF', name: 'Casco del vigía' }, { tier: 1, arch: 'cabM', name: 'Capucha de musgo' },
    { tier: 1, arch: 'anilloO', name: 'Anillo de sal' }, { tier: 1, arch: 'anilloD', name: 'Anillo de piedra del bosque' },
    // T2 (nivel 6-10: Pantano de Merrimead, Altas de Nazia)
    { tier: 2, arch: 'arma1', name: 'Espada del Cañón' }, { tier: 2, arch: 'arma2', name: 'Hachón del pantano', look: 'zweihander' }, { tier: 2, arch: 'armaM', name: 'Cayado del cenagal' },
    { tier: 2, arch: 'armPes', name: 'Peto de escamas de cieno' }, { tier: 2, arch: 'armMed', name: 'Cota del pantanero' }, { tier: 2, arch: 'armMag', name: 'Túnica del cenagal' },
    { tier: 2, arch: 'cabF', name: 'Yelmo de caña' }, { tier: 2, arch: 'cabM', name: 'Gorro del brujo del pantano' },
    { tier: 2, arch: 'anilloO', name: 'Anillo de ámbar' }, { tier: 2, arch: 'anilloD', name: 'Sello del cenagal' },
    // T3 (nivel 11-15: Cementerio de Lochport, Risco del Sur)
    { tier: 3, arch: 'arma1', name: 'Colmillo de las altas', look: 'shortsword' }, { tier: 3, arch: 'arma2', name: 'Martillo de Lochport' }, { tier: 3, arch: 'armaM', name: 'Báculo del camposanto' },
    { tier: 3, arch: 'armPes', name: 'Coraza de Nazia' }, { tier: 3, arch: 'armMed', name: 'Malla del sepulturero' }, { tier: 3, arch: 'armMag', name: 'Mortaja bordada' },
    { tier: 3, arch: 'cabF', name: 'Yelmo del risco' }, { tier: 3, arch: 'cabM', name: 'Capuchón de duelo' },
    { tier: 3, arch: 'anilloO', name: 'Anillo de hueso' }, { tier: 3, arch: 'anilloD', name: 'Sello del risco' },
    // T4 (nivel 16-20: La Brecha, Paso de Stormrock, Torre del hechicero, Cámaras de investigación): aspecto de Solmar en las armaduras de cuerpo a cuerpo
    { tier: 4, arch: 'arma1', name: 'Maza del minero caído', look: 'mace', off: 'kite_shield' }, { tier: 4, arch: 'arma2', name: 'Hacha de guerra de Stormrock', look: 'battle_axe' }, { tier: 4, arch: 'armaM', name: 'Cayado del investigador' },
    { tier: 4, arch: 'armPes', name: 'Coraza de la Brecha', look: 'sol_placas' }, { tier: 4, arch: 'armMed', name: 'Malla alada del paso', look: 'sol_malla' }, { tier: 4, arch: 'armMag', name: 'Túnica de la torre' },
    { tier: 4, arch: 'cabF', name: 'Yelmo del minero caído', look: 'sol_placas_helm' }, { tier: 4, arch: 'cabM', name: 'Capucha del aprendiz de la torre' },
    { tier: 4, arch: 'anilloO', name: 'Anillo de escama de wyvern', look: 'ring_gold' }, { tier: 4, arch: 'anilloD', name: 'Sello de la Brecha', look: 'ring_silver' },
    // T5 (nivel 21-25: Cenizas I y II, Templo y Salón de Mez): aparece el aspecto de Vhar (ceniza)
    { tier: 5, arch: 'arma1', name: 'Espada de las cenizas' }, { tier: 5, arch: 'arma2', name: 'Mandoble de Mez', look: 'zweihander' }, { tier: 5, arch: 'armaM', name: 'Báculo del hechicero de ceniza' },
    { tier: 5, arch: 'armPes', name: 'Peto de las catacumbas' }, { tier: 5, arch: 'armMed', name: 'Malla del arquero de ceniza', look: 'vhar_malla' }, { tier: 5, arch: 'armMag', name: 'Túnica del templo de Mez' },
    { tier: 5, arch: 'cabF', name: 'Yelmo astado de las cenizas', look: 'vhar_malla_helm' }, { tier: 5, arch: 'cabM', name: 'Capucha de hollín' },
    { tier: 5, arch: 'anilloO', name: 'Anillo de brasa' }, { tier: 5, arch: 'anilloD', name: 'Sello de Mez' },
    // T6 (nivel 26-30: Cenizas III, Granja de Roble Negro, Fortaleza infernal; también lo común de T7 hasta que haya ítems de nivel 31+)
    { tier: 6, arch: 'arma1', name: 'Hoja de los hornos', off: 'kite_shield' }, { tier: 6, arch: 'arma2', name: 'Hachón de Roble Negro', look: 'battle_axe' }, { tier: 6, arch: 'armaM', name: 'Cetro de la fortaleza infernal' },
    { tier: 6, arch: 'armPes', name: 'Placas de los hornos', look: 'vhar_placas' }, { tier: 6, arch: 'armMed', name: 'Cota de escamas de fuego', look: 'vhar_malla' }, { tier: 6, arch: 'armMag', name: 'Manto de la fortaleza' },
    { tier: 6, arch: 'cabF', name: 'Yelmo de brasa viva', look: 'vhar_placas_helm' }, { tier: 6, arch: 'cabM', name: 'Capucha infernal' },
    { tier: 6, arch: 'anilloO', name: 'Anillo del horno', look: 'ring_ruby' }, { tier: 6, arch: 'anilloD', name: 'Amuleto de Roble Negro', look: 'amulet_bone' },
    // Jefes de mazmorra (D1-D6): mejores que los de su banda y con el aspecto del tier siguiente
    { tier: 2, arch: 'arma1', name: 'Cuchilla del Jefe goblin', look: 'hand_axe', boss: 'goblin_jefe', mult: 1.3 }, { tier: 2, arch: 'armPes', name: 'Peto del Jefe goblin', boss: 'goblin_jefe', mult: 1.3 },
    { tier: 4, arch: 'arma1', name: 'Aguijón de la Reina', look: 'longsword', boss: 'antlion_reina', mult: 1.3 }, { tier: 4, arch: 'armPes', name: 'Caparazón de la Reina', boss: 'antlion_reina', mult: 1.3 },
    { tier: 5, arch: 'arma2', name: 'Mandoble del Caballero de la cripta', look: 'zweihander', boss: 'caballero_cripta', mult: 1.3 }, { tier: 5, arch: 'cabF', name: 'Yelmo del Caballero de la cripta', boss: 'caballero_cripta', mult: 1.3 },
    // D4-D6 (docs/LLAVES.md): en la banda más alta (T6), cada jefe un poco por encima del anterior
    { tier: 6, arch: 'armaM', name: 'Báculo del Mago mayor', boss: 'mago_mayor', mult: 1.3 }, { tier: 6, arch: 'armMag', name: 'Túnica del Mago mayor', boss: 'mago_mayor', mult: 1.3 },
    { tier: 6, arch: 'arma1', name: 'Garra del Wyvern del aire', look: 'longsword', boss: 'wyvern_aire', mult: 1.4 }, { tier: 6, arch: 'armMed', name: 'Cota de escamas del viento', boss: 'wyvern_aire', mult: 1.4 },
    { tier: 6, arch: 'arma2', name: 'Hoja del Señor del Foso', look: 'zweihander', boss: 'demonio_foso', mult: 1.5 }, { tier: 6, arch: 'armPes', name: 'Coraza del Foso', boss: 'demonio_foso', mult: 1.5 },
    // D7 (el tope del juego, Nv 40): un arma por arquetipo, lo mejor que se consigue hasta que entren las legendarias con aura
    { tier: 6, arch: 'arma2', name: 'Hacha del Gran Verdugo', look: 'zweihander', boss: 'verdugo', mult: 1.7 }, { tier: 6, arch: 'arma1', name: 'Cuchilla de las cámaras', look: 'longsword', boss: 'verdugo', mult: 1.7 },
    { tier: 6, arch: 'armaM', name: 'Cetro del suplicio', boss: 'verdugo', mult: 1.7 }, { tier: 6, arch: 'cabF', name: 'Capucha del Verdugo', boss: 'verdugo', mult: 1.7 },
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

// ---------- calidad (docs/ITEMS.md): se sortea al caer y define extras y tope de mejora ----------
/**
 * La calidad vive en `r` del ítem guardado: 0 Común (tienda/arranque, sin extras), 1 Verde, 2 Azul, 3 Dorado, 4 Violeta.
 * Define cuántos stats EXTRA al azar trae el ítem (van al final de `a`, después de los fijos del catálogo: los fijos
 * son `uniq.attrs.length`, así que los extras de un único son `a.slice(uniq.attrs.length)`) y hasta dónde se mejora (+N).
 * Dorado y Violeta rollean los extras en el rango alto; Violeta es solo de jefes y trae el efecto especial (cuando exista).
 */
export const QUALITY_NAMES = ['Común', 'Verde', 'Azul', 'Dorado', 'Violeta'];
/** Cantidad de stats extra por calidad. */
export const EXTRAS_BY_QUALITY = [0, 1, 2, 2, 2] as const;
/** Tope de mejora (+N) por calidad: el +11 queda reservado a los Violeta de jefe. */
export const UP_MAX_BY_QUALITY = [1, 3, 5, 8, 11] as const;
/** Desde esta calidad los extras rollean en el rango alto. */
export const QUALITY_HI_ROLL = 3;

/**
 * Pool de stats extra (sin `exp`: los bonus de farmeo quedan fuera de los ítems) y escala por ilvl.
 * Valor = (a + b·ilvl) × ranura × q — fórmula de afijos estilo Dreadmyst, lineal con el nivel del ítem
 * (los porcentajes crecen poco porque ya tienen tope total en el server: COMBAT_CAP).
 */
export const EXTRA_POOL: AttrId[] = ['crit', 'aspd', 'leech', 'hp', 'mp', 'mag', 'poison', 'rpar', 'df', 'rm'];
const EXTRA_SCALE: Record<AttrId, [number, number]> = {
    hp: [8, 2.4], mp: [3, 0.9], mag: [1.5, 0.32], df: [1.5, 0.35], rm: [2, 0.45],
    crit: [2, 0.05], aspd: [4, 0.1], leech: [2, 0.05], poison: [6, 0.15], rpar: [5, 0.12], exp: [0, 0],
};
/** Multiplicador por ranura (Dreadmyst: pecho/arma 1×, cabeza y futuros guantes/botas 0,65×, anillos/amuleto 0,5×). */
export const SLOT_EXTRA_MULT: Record<Slot, number> = { arma: 1, armadura: 1, cabeza: 0.65, anillo: 0.5 };
/** Un valor de extra ya tirado. */
export function rollExtra(id: AttrId, ilvl: number, slot: Slot, quality: number, rnd: () => number = Math.random): number {
    const [a, b] = EXTRA_SCALE[id], q = quality >= QUALITY_HI_ROLL ? 1.15 + rnd() * 0.2 : 0.85 + rnd() * 0.3;
    return Math.max(1, Math.round((a + b * ilvl) * (SLOT_EXTRA_MULT[slot] ?? 1) * q));
}
/** Los extras de un ítem que cae: distintos entre sí y distintos de los fijos (`exclude`). */
export function rollExtras(slot: Slot, ilvl: number, quality: number, exclude: AttrId[] = [], rnd: () => number = Math.random): [AttrId, number][] {
    const pool = EXTRA_POOL.filter((id) => !exclude.includes(id)), out: [AttrId, number][] = [];
    for (let i = 0; i < (EXTRAS_BY_QUALITY[quality] ?? 0) && pool.length; i++) {
        const j = Math.floor(rnd() * pool.length), id = pool.splice(j, 1)[0];
        out.push([id, rollExtra(id, ilvl, slot, quality, rnd)]);
    }
    return out;
}
/** ilvl (nivel de ítem) de un único: el techo de su banda; los de jefe, 5 arriba (tope 40). De él sale la escala de los extras. */
export const bandIlvl = (tier: number): number => [5, 10, 15, 20, 25, 30][Math.min(6, Math.max(1, Math.round(tier))) - 1];
export const uniqueIlvl = (u: UniqueBase): number => Math.min(40, bandIlvl(u.uniq.tier) + (u.uniq.boss ? 5 : 0));

// ---------- mejora (+N) de ítems únicos (docs/ITEMS.md §7) ----------
/** Techo absoluto de la mejora; el tope real de cada ítem lo pone su calidad (UP_MAX_BY_QUALITY). Las probabilidades de fallo viven solo en el server. */
export const UP_MAX = 11;
/** Cada nivel de mejora suma este porcentaje a los stats base del ítem (daño, defensa, RM y daño mágico). */
export const UP_PCT = 0.04;
export const upMult = (up = 0): number => 1 + UP_PCT * Math.max(0, up);
/** Piedras de forja y oro que cuesta pasar de +up a +up+1 un ítem de la banda `tier`. */
export const upStones = (up: number): number => up + 1;
export const upGold = (tier: number, up: number): number => Math.round(40 * tier * (up + 1));
