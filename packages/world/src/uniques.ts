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
export const UNIQUE_TIERS_READY = 7;
/** Banda de ítems de un mob de nivel `lvl`: la del tier de su nivel (docs/TIERS_DE_ZONA.md), las 7 bandas tienen catálogo propio. */
export const tierOfLevel = (lvl: number): number => itemBandOfLevel(lvl);
/** Variación de los atributos fijos de un único al caer. */
export const UNIQUE_VARIATION = 0.1;

/**
 * Nivel de ítem (ilvl) de una banda: de él sale el poder base (`stats`) y la escala de los extras. Las 7 bandas son de 5 niveles
 * (T7 cubre el 31-40 pero sus ítems son ilvl 35: el ilvl 40 solo lo sueltan los jefes del tramo final, docs/ITEMS.md).
 */
export const bandIlvl = (tier: number): number => 5 * Math.min(7, Math.max(1, Math.round(tier)));

type Arch = 'arma1' | 'arma2' | 'armaM' | 'armPes' | 'armMed' | 'armMag' | 'cabF' | 'cabM' | 'guanF' | 'guanM' | 'botaF' | 'botaM' | 'amuO' | 'amuD' | 'anilloO' | 'anilloD';
/** Efectos especiales de los ítems de jefe: solo están activos en la calidad Dorado (r = 4). Los aplica el server (mobs.ts). */
export type FxId = 'quemadura' | 'aturdir' | 'vampirismo';
export const FX_INFO: Record<FxId, { name: string; text: string }> = {
    quemadura: { name: 'Quemadura', text: 'Tus golpes básicos tienen 15 % de prender fuego al enemigo.' },
    aturdir: { name: 'Estocada aturdidora', text: 'Tus golpes básicos tienen 10 % de aturdir al enemigo 0,8 s.' },
    vampirismo: { name: 'Vampirismo', text: 'Al matar a un enemigo recuperás 3 % de tu vida máxima.' },
};
interface Def { tier: number; arch: Arch; name: string; look?: string; off?: string; boss?: MobType; mult?: number; ilvl?: number; attrs?: [AttrId, AttrId]; fx?: FxId; set?: string }

/** Punto medio de cada atributo (ver ATTR_RANGES): los fijos de un único son este valor por un factor de la banda. */
const MID: Record<AttrId, number> = { crit: 4, aspd: 8, leech: 4, hp: 16, mp: 13, mag: 4, exp: 6, poison: 11, rpar: 10, df: 6, rm: 8, dmg: 2 };
/**
 * Pares de atributos fijos de cada arquetipo. Cada ítem toma uno según su banda, así que dos armas de una mano de bandas distintas
 * NO traen siempre lo mismo (identidad por ítem): aspd+crit, crit+robo, aspd+veneno, robo+aspd…
 */
const ARCHS: Arch[] = ['arma1', 'arma2', 'armaM', 'armPes', 'armMed', 'armMag', 'cabF', 'cabM', 'guanF', 'guanM', 'botaF', 'botaM', 'amuO', 'amuD', 'anilloO', 'anilloD'];
const ATTR_VARIANTS: Record<Arch, [AttrId, AttrId][]> = {
    arma1: [['aspd', 'crit'], ['crit', 'leech'], ['aspd', 'poison'], ['leech', 'aspd']],
    arma2: [['crit', 'leech'], ['leech', 'hp'], ['crit', 'aspd'], ['poison', 'leech']],
    armaM: [['mag', 'mp'], ['mag', 'crit'], ['mp', 'rm'], ['mag', 'leech']],
    armPes: [['hp', 'df'], ['df', 'rpar'], ['hp', 'rm'], ['df', 'leech']],
    armMed: [['hp', 'aspd'], ['hp', 'crit'], ['aspd', 'df'], ['hp', 'leech']],
    armMag: [['mp', 'rm'], ['mag', 'rm'], ['mp', 'hp'], ['rm', 'rpar']],
    cabF: [['df', 'hp'], ['df', 'rpar'], ['hp', 'rm'], ['df', 'crit']],
    cabM: [['mp', 'mag'], ['mag', 'rm'], ['mp', 'rpar'], ['mag', 'hp']],
    guanF: [['aspd', 'crit'], ['crit', 'leech'], ['aspd', 'leech'], ['crit', 'poison']],
    guanM: [['mag', 'crit'], ['mag', 'mp'], ['mp', 'aspd'], ['mag', 'leech']],
    botaF: [['df', 'hp'], ['hp', 'rpar'], ['df', 'rm'], ['hp', 'aspd']],
    botaM: [['rm', 'mp'], ['mp', 'rpar'], ['rm', 'mag'], ['mp', 'hp']],
    amuO: [['mag', 'crit'], ['crit', 'poison'], ['leech', 'mag'], ['poison', 'aspd']],
    amuD: [['rpar', 'rm'], ['hp', 'rpar'], ['rm', 'df'], ['hp', 'rm']],
    anilloO: [['crit', 'leech'], ['aspd', 'crit'], ['leech', 'poison'], ['mag', 'crit']],
    anilloD: [['hp', 'rm'], ['df', 'hp'], ['rm', 'rpar'], ['hp', 'mp']],
};
const attrsOf = (arch: Arch, tier: number): [AttrId, AttrId] => { const v = ATTR_VARIANTS[arch]; return v[(Math.max(1, tier) - 1 + ARCHS.indexOf(arch)) % v.length]; };
const SLOT: Record<Arch, Slot> = { arma1: 'arma', arma2: 'arma', armaM: 'arma', armPes: 'armadura', armMed: 'armadura', armMag: 'armadura', cabF: 'cabeza', cabM: 'cabeza', guanF: 'guantes', guanM: 'guantes', botaF: 'botas', botaM: 'botas', amuO: 'amuleto', amuD: 'amuleto', anilloO: 'anillo', anilloD: 'anillo' };
const LOOK: Record<Arch, string | undefined> = { arma1: 'longsword', arma2: 'maul', armaM: 'staff', armPes: 'plate', armMed: 'chain', armMag: 'mage', cabF: 'plate_helm', cabM: 'mage_hood', guanF: 'glove_plate', guanM: 'glove_mage', botaF: 'boot_plate', botaM: 'boot_mage', amuO: 'amulet_bone', amuD: 'amulet_bone', anilloO: 'ring_ruby', anilloD: 'ring_jade' };
const OFF: Partial<Record<Arch, string>> = { arma1: 'iron_buckler' };

const R = Math.round;
/**
 * Stats base del arquetipo a nivel de ítem `ilvl` (con `m` = multiplicador, p. ej. 1,15 en ítems de jefe). Lineal en el ilvl:
 * en los techos de banda (5, 10…) da lo mismo que daba la fórmula por banda, así el equipo sigue el nivel del jugador también
 * dentro de las bandas y en la T7.
 */
function stats(arch: Arch, ilvl: number, m: number): Pick<Base, 'dmg' | 'def' | 'rm' | 'mag'> {
    const t = ilvl / 5;
    switch (arch) {
        case 'arma1': return { dmg: [R((4 + t * 1.8) * m), R((8 + t * 2.4) * m)] };
        case 'arma2': return { dmg: [R((4 + t * 1.8) * 1.35 * m), R((8 + t * 2.4) * 1.35 * m)] };
        case 'armaM': return { dmg: [R(1 + t * 0.5), R(3 + t * 0.8)], mag: R((8 + t * 5) * m) };
        case 'armPes': return { def: R((14 + 6 * t) * m), rm: R((14 + 6 * t) * 0.35 * m) };
        case 'armMed': return { def: R((10 + 4.5 * t) * m), rm: R((5 + 2 * t) * m) };
        case 'armMag': return { def: R(3 + t), rm: R((18 + 5 * t) * m), mag: R((3 + t) * m) };
        case 'cabF': return { def: R((5 + 2.6 * t) * m), rm: R((2 + t) * m) };
        case 'cabM': return { def: R(2 + 0.6 * t), rm: R((8 + 2.6 * t) * m), mag: R((2 + 0.6 * t) * m) };
        case 'guanF': case 'botaF': return { def: R((4 + 2.1 * t) * m), rm: R((1.6 + 0.8 * t) * m) };
        case 'guanM': return { def: R(1 + 0.5 * t), rm: R((6 + 2 * t) * m), mag: R((1.5 + 0.5 * t) * m) };
        case 'botaM': return { def: R(1 + 0.5 * t), rm: R((6 + 2 * t) * m), mag: R((1 + 0.4 * t) * m) };
        case 'amuD': return { rm: R((4 + t) * m) };
        case 'amuO': return { mag: R((1 + 0.5 * t) * m) };
        default: return {};
    }
}

const DEFS: Def[] = [
    // T1 (nivel 1-5: Campos de Sal, Bosque de piedra, Cañón goblin)
    { tier: 1, arch: 'arma1', name: 'Hoja de sal' }, { tier: 1, arch: 'arma2', name: 'Mazo del campamento' }, { tier: 1, arch: 'armaM', name: 'Vara de raíz' },
    { tier: 1, arch: 'armPes', name: 'Coraza de bronce viejo' }, { tier: 1, arch: 'armMed', name: 'Malla del explorador' }, { tier: 1, arch: 'armMag', name: 'Manto de lino bordado' },
    { tier: 1, arch: 'cabF', name: 'Casco del vigía' }, { tier: 1, arch: 'cabM', name: 'Capucha de musgo' },
    { tier: 1, arch: 'guanF', name: 'Mitones de cuero salado', look: 'glove_leather' }, { tier: 1, arch: 'guanM', name: 'Guantes de lino' },
    { tier: 1, arch: 'botaF', name: 'Botas del camino', look: 'boot_leather' }, { tier: 1, arch: 'botaM', name: 'Sandalias de musgo' },
    { tier: 1, arch: 'amuO', name: 'Amuleto de sal' }, { tier: 1, arch: 'amuD', name: 'Amuleto de guijarro' },
    { tier: 1, arch: 'anilloO', name: 'Anillo de sal' }, { tier: 1, arch: 'anilloD', name: 'Anillo de piedra del bosque' },
    // T2 (nivel 6-10: Pantano de Merrimead, Altas de Nazia)
    { tier: 2, arch: 'arma1', name: 'Espada del Cañón' }, { tier: 2, arch: 'arma2', name: 'Hachón del pantano', look: 'zweihander' }, { tier: 2, arch: 'armaM', name: 'Cayado del cenagal' },
    { tier: 2, arch: 'armPes', name: 'Peto de escamas de cieno' }, { tier: 2, arch: 'armMed', name: 'Cota del pantanero' }, { tier: 2, arch: 'armMag', name: 'Túnica del cenagal' },
    { tier: 2, arch: 'cabF', name: 'Yelmo de caña' }, { tier: 2, arch: 'cabM', name: 'Gorro del brujo del pantano' },
    { tier: 2, arch: 'guanF', name: 'Guantes de cieno curtido', look: 'glove_leather' }, { tier: 2, arch: 'guanM', name: 'Guantes del brujo del pantano' },
    { tier: 2, arch: 'botaF', name: 'Botas de junco', look: 'boot_leather' }, { tier: 2, arch: 'botaM', name: 'Botas del cenagal' },
    { tier: 2, arch: 'amuO', name: 'Amuleto de ámbar' }, { tier: 2, arch: 'amuD', name: 'Talismán de caña' },
    { tier: 2, arch: 'anilloO', name: 'Anillo de ámbar' }, { tier: 2, arch: 'anilloD', name: 'Sello del cenagal' },
    // T3 (nivel 11-15: Cementerio de Lochport, Risco del Sur)
    { tier: 3, arch: 'arma1', name: 'Colmillo de las altas', look: 'shortsword' }, { tier: 3, arch: 'arma2', name: 'Martillo de Lochport' }, { tier: 3, arch: 'armaM', name: 'Báculo del camposanto' },
    { tier: 3, arch: 'armPes', name: 'Coraza de Nazia' }, { tier: 3, arch: 'armMed', name: 'Malla del sepulturero' }, { tier: 3, arch: 'armMag', name: 'Mortaja bordada' },
    { tier: 3, arch: 'cabF', name: 'Yelmo del risco' }, { tier: 3, arch: 'cabM', name: 'Capuchón de duelo' },
    { tier: 3, arch: 'guanF', name: 'Guanteletes del sepulturero' }, { tier: 3, arch: 'guanM', name: 'Guantes de duelo' },
    { tier: 3, arch: 'botaF', name: 'Botas del risco' }, { tier: 3, arch: 'botaM', name: 'Zapatillas de mortaja' },
    { tier: 3, arch: 'amuO', name: 'Amuleto de hueso' }, { tier: 3, arch: 'amuD', name: 'Talismán del camposanto' },
    { tier: 3, arch: 'anilloO', name: 'Anillo de hueso' }, { tier: 3, arch: 'anilloD', name: 'Sello del risco' },
    // T4 (nivel 16-20: La Brecha, Paso de Stormrock, Torre del hechicero, Cámaras de investigación): aspecto de Solmar en las armaduras de cuerpo a cuerpo
    { tier: 4, arch: 'arma1', name: 'Maza del minero caído', look: 'mace', off: 'kite_shield' }, { tier: 4, arch: 'arma2', name: 'Hacha de guerra de Stormrock', look: 'battle_axe' }, { tier: 4, arch: 'armaM', name: 'Cayado del investigador' },
    { tier: 4, arch: 'armPes', name: 'Coraza de la Brecha', look: 'sol_placas' }, { tier: 4, arch: 'armMed', name: 'Malla alada del paso', look: 'sol_malla' }, { tier: 4, arch: 'armMag', name: 'Túnica de la torre' },
    { tier: 4, arch: 'cabF', name: 'Yelmo del minero caído', look: 'sol_placas_helm' }, { tier: 4, arch: 'cabM', name: 'Capucha del aprendiz de la torre' },
    { tier: 4, arch: 'guanF', name: 'Guanteletes del minero caído' }, { tier: 4, arch: 'guanM', name: 'Guantes del aprendiz de la torre' },
    { tier: 4, arch: 'botaF', name: 'Botas de la Brecha' }, { tier: 4, arch: 'botaM', name: 'Botas del investigador' },
    { tier: 4, arch: 'amuO', name: 'Amuleto de escama de wyvern' }, { tier: 4, arch: 'amuD', name: 'Talismán de Stormrock' },
    { tier: 4, arch: 'anilloO', name: 'Anillo de escama de wyvern', look: 'ring_gold' }, { tier: 4, arch: 'anilloD', name: 'Sello de la Brecha', look: 'ring_silver' },
    // T5 (nivel 21-25: Cenizas I y II, Templo y Salón de Mez): aparece el aspecto de Vhar (ceniza)
    { tier: 5, arch: 'arma1', name: 'Espada de las cenizas' }, { tier: 5, arch: 'arma2', name: 'Mandoble de Mez', look: 'zweihander' }, { tier: 5, arch: 'armaM', name: 'Báculo del hechicero de ceniza' },
    { tier: 5, arch: 'armPes', name: 'Peto de las catacumbas' }, { tier: 5, arch: 'armMed', name: 'Malla del arquero de ceniza', look: 'vhar_malla' }, { tier: 5, arch: 'armMag', name: 'Túnica del templo de Mez' },
    { tier: 5, arch: 'cabF', name: 'Yelmo astado de las cenizas', look: 'vhar_malla_helm' }, { tier: 5, arch: 'cabM', name: 'Capucha de hollín' },
    { tier: 5, arch: 'guanF', name: 'Guanteletes de ceniza' }, { tier: 5, arch: 'guanM', name: 'Guantes de hollín' },
    { tier: 5, arch: 'botaF', name: 'Botas de las catacumbas' }, { tier: 5, arch: 'botaM', name: 'Botas del templo de Mez' },
    { tier: 5, arch: 'amuO', name: 'Amuleto de brasa' }, { tier: 5, arch: 'amuD', name: 'Talismán de Mez' },
    { tier: 5, arch: 'anilloO', name: 'Anillo de brasa' }, { tier: 5, arch: 'anilloD', name: 'Sello de Mez' },
    // T6 (nivel 26-30: Cenizas III, Granja de Roble Negro, Fortaleza infernal)
    { tier: 6, arch: 'arma1', name: 'Hoja de los hornos', off: 'kite_shield' }, { tier: 6, arch: 'arma2', name: 'Hachón de Roble Negro', look: 'battle_axe' }, { tier: 6, arch: 'armaM', name: 'Cetro de la fortaleza infernal' },
    { tier: 6, arch: 'armPes', name: 'Placas de los hornos', look: 'vhar_placas' }, { tier: 6, arch: 'armMed', name: 'Cota de escamas de fuego', look: 'vhar_malla' }, { tier: 6, arch: 'armMag', name: 'Manto de la fortaleza' },
    { tier: 6, arch: 'cabF', name: 'Yelmo de brasa viva', look: 'vhar_placas_helm' }, { tier: 6, arch: 'cabM', name: 'Capucha infernal' },
    { tier: 6, arch: 'guanF', name: 'Guanteletes de los hornos' }, { tier: 6, arch: 'guanM', name: 'Guantes de la fortaleza' },
    { tier: 6, arch: 'botaF', name: 'Botas de los hornos' }, { tier: 6, arch: 'botaM', name: 'Botas infernales' },
    { tier: 6, arch: 'amuO', name: 'Amuleto del horno' }, { tier: 6, arch: 'amuD', name: 'Amuleto de Roble Negro' },
    { tier: 6, arch: 'anilloO', name: 'Anillo del horno', look: 'ring_ruby' }, { tier: 6, arch: 'anilloD', name: 'Anillo de la fortaleza', look: 'ring_jade' },
    // T7 (nivel 31-40: Cámaras de tortura, Puerto de la perdición, Fuerte de Amir): ilvl 35; el 40 es de los jefes del tramo final
    { tier: 7, arch: 'arma1', name: 'Hoja del abismo' }, { tier: 7, arch: 'arma2', name: 'Hachón de las cámaras', look: 'battle_axe' }, { tier: 7, arch: 'armaM', name: 'Cetro del puerto de la perdición' },
    { tier: 7, arch: 'armPes', name: 'Placas del carcelero', look: 'vhar_placas' }, { tier: 7, arch: 'armMed', name: 'Malla del carcelero', look: 'vhar_malla' }, { tier: 7, arch: 'armMag', name: 'Túnica del abismo' },
    { tier: 7, arch: 'cabF', name: 'Yelmo del carcelero', look: 'vhar_placas_helm' }, { tier: 7, arch: 'cabM', name: 'Capucha del suplicio' },
    { tier: 7, arch: 'guanF', name: 'Guanteletes del verdugo' }, { tier: 7, arch: 'guanM', name: 'Guantes del abismo' },
    { tier: 7, arch: 'botaF', name: 'Botas del carcelero' }, { tier: 7, arch: 'botaM', name: 'Botas del suplicio' },
    { tier: 7, arch: 'amuO', name: 'Amuleto del abismo' }, { tier: 7, arch: 'amuD', name: 'Talismán de Amir' },
    { tier: 7, arch: 'anilloO', name: 'Anillo del abismo', look: 'ring_ruby' }, { tier: 7, arch: 'anilloD', name: 'Sello de Amir', look: 'ring_silver' },
    // Jefes de mazmorra (D1-D7): ilvl = el de su banda +5 (tope 40) y un multiplicador chico; cada jefe trae un ítem de cada tipo con efecto
    // especial (activo solo en Dorado) en las armas, y uno de los slots nuevos para que las mazmorras completen el equipo.
    { tier: 2, arch: 'arma1', name: 'Cuchilla del Jefe goblin', look: 'hand_axe', boss: 'goblin_jefe', mult: 1.08, fx: 'vampirismo' }, { tier: 2, arch: 'armPes', name: 'Peto del Jefe goblin', boss: 'goblin_jefe', mult: 1.06 },
    { tier: 2, arch: 'amuO', name: 'Colmillo del Jefe goblin', boss: 'goblin_jefe', mult: 1.08 },
    { tier: 4, arch: 'arma1', name: 'Aguijón de la Reina', look: 'longsword', boss: 'antlion_reina', mult: 1.12, fx: 'vampirismo' }, { tier: 4, arch: 'armPes', name: 'Caparazón de la Reina', boss: 'antlion_reina', mult: 1.12 },
    { tier: 4, arch: 'guanF', name: 'Guanteletes de la Reina', boss: 'antlion_reina', mult: 1.12 },
    { tier: 5, arch: 'arma2', name: 'Mandoble del Caballero de la cripta', look: 'zweihander', boss: 'caballero_cripta', mult: 1.15, fx: 'aturdir' }, { tier: 5, arch: 'cabF', name: 'Yelmo del Caballero de la cripta', boss: 'caballero_cripta', mult: 1.14 },
    { tier: 5, arch: 'botaF', name: 'Grebas del Caballero de la cripta', boss: 'caballero_cripta', mult: 1.14 },
    // D4-D6 (docs/LLAVES.md): en la banda más alta (T6), cada jefe un poco por encima del anterior
    { tier: 6, arch: 'armaM', name: 'Báculo del Mago mayor', boss: 'mago_mayor', mult: 1.15, fx: 'quemadura' }, { tier: 6, arch: 'armMag', name: 'Túnica del Mago mayor', boss: 'mago_mayor', mult: 1.18 },
    { tier: 6, arch: 'guanM', name: 'Guantes del Mago mayor', boss: 'mago_mayor', mult: 1.16 },
    { tier: 6, arch: 'arma1', name: 'Garra del Wyvern del aire', look: 'longsword', boss: 'wyvern_aire', mult: 1.25, fx: 'vampirismo' }, { tier: 6, arch: 'armMed', name: 'Cota de escamas del viento', boss: 'wyvern_aire', mult: 1.25 },
    { tier: 6, arch: 'botaF', name: 'Botas del Wyvern del aire', boss: 'wyvern_aire', mult: 1.25 },
    { tier: 6, arch: 'arma2', name: 'Hoja del Señor del Foso', look: 'zweihander', boss: 'demonio_foso', mult: 1.35, fx: 'quemadura' }, { tier: 6, arch: 'armPes', name: 'Coraza del Foso', boss: 'demonio_foso', mult: 1.34 },
    { tier: 6, arch: 'amuO', name: 'Amuleto del Señor del Foso', boss: 'demonio_foso', mult: 1.35 },
    // D7 (el tope del juego, Nv 40, ilvl 40): lo mejor que se consigue hasta que entren las legendarias con aura
    { tier: 7, ilvl: 40, arch: 'arma2', name: 'Hacha del Gran Verdugo', look: 'zweihander', boss: 'verdugo', mult: 1.39, fx: 'aturdir' }, { tier: 7, ilvl: 40, arch: 'arma1', name: 'Cuchilla de las cámaras', look: 'longsword', boss: 'verdugo', mult: 1.39, fx: 'vampirismo' },
    { tier: 7, ilvl: 40, arch: 'armaM', name: 'Cetro del suplicio', boss: 'verdugo', mult: 1.35, fx: 'quemadura' }, { tier: 7, ilvl: 40, arch: 'cabF', name: 'Capucha del Verdugo', boss: 'verdugo', mult: 1.36 },
    { tier: 7, ilvl: 40, arch: 'guanM', name: 'Guantes del suplicio', boss: 'verdugo', mult: 1.35 }, { tier: 7, ilvl: 40, arch: 'botaF', name: 'Botas del Gran Verdugo', boss: 'verdugo', mult: 1.36 },
    { tier: 7, ilvl: 40, arch: 'amuD', name: 'Amuleto del Gran Verdugo', boss: 'verdugo', mult: 1.36 },
    // Piezas de set (docs/ITEMS.md): 8 por set (arma, armadura, cabeza, guantes, botas, amuleto y dos anillos distintos). Solo caen en mazmorras, nunca en la tienda. Los bonos viven en SETS.
    // Cobre de Solmar (T1, cuero liviano): el primer set, para empezar
    { tier: 1, arch: 'arma1', name: 'Daga de cobre', set: 'cobre' },
    { tier: 1, arch: 'armMed', name: 'Jubón de cobre', set: 'cobre' }, { tier: 1, arch: 'cabF', name: 'Gorro de cobre', set: 'cobre' },
    { tier: 1, arch: 'guanF', name: 'Manoplas de cobre', set: 'cobre' }, { tier: 1, arch: 'botaF', name: 'Botines de cobre', set: 'cobre' },
    { tier: 1, arch: 'amuO', name: 'Amuleto de cobre', set: 'cobre' }, { tier: 1, arch: 'anilloO', name: 'Sello de cobre', set: 'cobre' }, { tier: 1, arch: 'anilloD', name: 'Aro de cobre', set: 'cobre' },
    // Ámbar de Vhar (T2): magia
    { tier: 2, arch: 'armaM', name: 'Vara de ámbar', set: 'ambar' },
    { tier: 2, arch: 'armMed', name: 'Túnica de ámbar', set: 'ambar' }, { tier: 2, arch: 'cabF', name: 'Capucha de ámbar', set: 'ambar' },
    { tier: 2, arch: 'guanM', name: 'Guantes de ámbar', set: 'ambar' }, { tier: 2, arch: 'botaM', name: 'Sandalias de ámbar', set: 'ambar' },
    { tier: 2, arch: 'amuO', name: 'Talismán de ámbar', set: 'ambar' }, { tier: 2, arch: 'anilloO', name: 'Sello de ámbar', set: 'ambar' }, { tier: 2, arch: 'anilloD', name: 'Aro de ámbar', set: 'ambar' },
    // Bruma de Solmar (T3, pesado): aguante
    { tier: 3, arch: 'arma1', name: 'Maza de bruma', set: 'bruma' },
    { tier: 3, arch: 'armPes', name: 'Cota de bruma', set: 'bruma' }, { tier: 3, arch: 'cabF', name: 'Yelmo de bruma', set: 'bruma' },
    { tier: 3, arch: 'guanF', name: 'Guanteletes de bruma', set: 'bruma' }, { tier: 3, arch: 'botaF', name: 'Grebas de bruma', set: 'bruma' },
    { tier: 3, arch: 'amuD', name: 'Amuleto de bruma', set: 'bruma' }, { tier: 3, arch: 'anilloD', name: 'Sello de bruma', set: 'bruma' }, { tier: 3, arch: 'anilloO', name: 'Aro de bruma', set: 'bruma' },
    // Alba de Solmar (T4, malla): ágil
    { tier: 4, arch: 'arma1', name: 'Espada del Alba', look: 'longsword', set: 'alba' },
    { tier: 4, arch: 'armMed', name: 'Malla del Alba', look: 'sol_malla', set: 'alba' }, { tier: 4, arch: 'cabF', name: 'Yelmo del Alba', look: 'sol_malla_helm', set: 'alba' },
    { tier: 4, arch: 'guanF', name: 'Guantes del Alba', set: 'alba' }, { tier: 4, arch: 'botaF', name: 'Botas del Alba', set: 'alba' },
    { tier: 4, arch: 'amuO', name: 'Amuleto del Alba', set: 'alba' }, { tier: 4, arch: 'anilloO', name: 'Sello del Alba', set: 'alba' }, { tier: 4, arch: 'anilloD', name: 'Aro del Alba', set: 'alba' },
    // Cenit de Solmar (T5, placas): tanque
    { tier: 5, arch: 'arma1', name: 'Maza del Cenit', look: 'mace', off: 'kite_shield', set: 'cenit' },
    { tier: 5, arch: 'armPes', name: 'Coraza del Cenit', look: 'sol_placas', set: 'cenit' }, { tier: 5, arch: 'cabF', name: 'Yelmo del Cenit', look: 'sol_placas_helm', set: 'cenit' },
    { tier: 5, arch: 'guanF', name: 'Guanteletes del Cenit', set: 'cenit' }, { tier: 5, arch: 'botaF', name: 'Grebas del Cenit', set: 'cenit' },
    { tier: 5, arch: 'amuD', name: 'Amuleto del Cenit', set: 'cenit' }, { tier: 5, arch: 'anilloD', name: 'Sello del Cenit', set: 'cenit' }, { tier: 5, arch: 'anilloO', name: 'Aro del Cenit', set: 'cenit' },
    // Ceniza de Vhar (T6, malla): lanzador
    { tier: 6, arch: 'armaM', name: 'Cayado de ceniza ardiente', set: 'ceniza' },
    { tier: 6, arch: 'armMed', name: 'Cota de ceniza ardiente', look: 'vhar_malla', set: 'ceniza' }, { tier: 6, arch: 'cabF', name: 'Yelmo de ceniza ardiente', look: 'vhar_malla_helm', set: 'ceniza' },
    { tier: 6, arch: 'guanM', name: 'Guantes de ceniza ardiente', set: 'ceniza' }, { tier: 6, arch: 'botaM', name: 'Botas de ceniza ardiente', set: 'ceniza' },
    { tier: 6, arch: 'amuO', name: 'Amuleto de ceniza ardiente', set: 'ceniza' }, { tier: 6, arch: 'anilloO', name: 'Sello de ceniza ardiente', set: 'ceniza' }, { tier: 6, arch: 'anilloD', name: 'Aro de ceniza ardiente', set: 'ceniza' },
    // Brasa de Vhar (T7, placas): ofensivo pesado
    { tier: 7, arch: 'arma2', name: 'Hacha de brasa eterna', look: 'battle_axe', set: 'brasa' },
    { tier: 7, arch: 'armPes', name: 'Placas de brasa eterna', look: 'vhar_placas', set: 'brasa' }, { tier: 7, arch: 'cabF', name: 'Yelmo de brasa eterna', look: 'vhar_placas_helm', set: 'brasa' },
    { tier: 7, arch: 'guanF', name: 'Guanteletes de brasa eterna', set: 'brasa' }, { tier: 7, arch: 'botaF', name: 'Grebas de brasa eterna', set: 'brasa' },
    { tier: 7, arch: 'amuO', name: 'Amuleto de brasa eterna', set: 'brasa' }, { tier: 7, arch: 'anilloO', name: 'Sello de brasa eterna', set: 'brasa' }, { tier: 7, arch: 'anilloD', name: 'Aro de brasa eterna', set: 'brasa' },
];

// ---------- sets por clase: cada banda tiene uno de paladín, uno de mago y uno de clérigo (los ítems no se comparten entre clases) ----------
type SetClass = 'paladin' | 'mago' | 'clerigo';
const CLASS_SET_PIECES: Record<SetClass, { arch: Arch; n: string }[]> = {
    paladin: [{ arch: 'arma1', n: 'Espada' }, { arch: 'armPes', n: 'Coraza' }, { arch: 'cabF', n: 'Yelmo' }, { arch: 'guanF', n: 'Guanteletes' }, { arch: 'botaF', n: 'Grebas' }, { arch: 'amuD', n: 'Colgante' }, { arch: 'anilloD', n: 'Sello' }, { arch: 'anilloO', n: 'Aro' }],
    mago: [{ arch: 'armaM', n: 'Vara' }, { arch: 'armMag', n: 'Túnica' }, { arch: 'cabM', n: 'Capucha' }, { arch: 'guanM', n: 'Guantes' }, { arch: 'botaM', n: 'Sandalias' }, { arch: 'amuO', n: 'Talismán' }, { arch: 'anilloO', n: 'Sello' }, { arch: 'anilloD', n: 'Aro' }],
    clerigo: [{ arch: 'armaM', n: 'Cayado' }, { arch: 'armMag', n: 'Manto' }, { arch: 'cabM', n: 'Cofia' }, { arch: 'guanM', n: 'Mitones' }, { arch: 'botaM', n: 'Zapatos' }, { arch: 'amuO', n: 'Relicario' }, { arch: 'anilloO', n: 'Sello' }, { arch: 'anilloD', n: 'Aro' }],
};
/** Sets generados (los 7 escritos a mano de arriba cubren: paladin T1, T3, T4, T5, T7 y mago T2, T6). */
export const CLASS_SETS: { id: string; name: string; tier: number; cls: SetClass; suffix: string; faction: 'solmar' | 'vhar'; bonus: AttrId[][] }[] = [];
const BONUS_BY_CLASS: Record<SetClass, AttrId[][]> = {
    paladin: [['hp', 'aspd'], ['crit', 'leech'], ['hp', 'crit'], ['aspd', 'crit', 'leech']],
    mago: [['mp', 'mag'], ['mag', 'crit'], ['mp', 'hp'], ['mag', 'mp', 'leech']],
    clerigo: [['mp', 'hp'], ['rm', 'rpar'], ['mp', 'mag'], ['rpar', 'hp', 'rm']],
};
const EXTRA_CLASS_SETS: [number, SetClass, string, string][] = [
    [1, 'mago', 'savia', 'de savia'], [1, 'clerigo', 'lino', 'de lino'],
    [2, 'paladin', 'hierroviejo', 'de hierro viejo'], [2, 'clerigo', 'musgo', 'de musgo'],
    [3, 'mago', 'escarcha', 'de escarcha'], [3, 'clerigo', 'rocio', 'de rocío'],
    [4, 'mago', 'ocaso', 'del Ocaso'], [4, 'clerigo', 'aurora', 'de la Aurora'],
    [5, 'mago', 'zafiro', 'del Zafiro'], [5, 'clerigo', 'santuario', 'del Santuario'],
    [6, 'paladin', 'hierronegro', 'de Hierro Negro'], [6, 'clerigo', 'vela', 'de la Vela'],
    [7, 'mago', 'ascuaazul', 'de Ascua Azul'], [7, 'clerigo', 'pira', 'de la Pira Santa'],
];
for (const [tier, cls, id, suffix] of EXTRA_CLASS_SETS) {
    CLASS_SETS.push({ id, name: `${CLASS_SET_PIECES[cls][1].n} ${suffix}`.replace(/^\S+ /, '').replace(/^/, cls === 'paladin' ? 'Armadura ' : cls === 'mago' ? 'Atuendo ' : 'Vestimenta '), tier, cls, suffix, faction: tier >= 6 ? 'vhar' : 'solmar', bonus: BONUS_BY_CLASS[cls] });
    for (const pc of CLASS_SET_PIECES[cls]) DEFS.push({ tier, arch: pc.arch === 'arma1' && tier % 2 === 0 ? 'arma2' : pc.arch, name: `${pc.n} ${suffix}`, set: id });
}

export interface UniqueInfo { tier: number; attrs: [AttrId, number][]; boss?: MobType; /** nivel de ítem: de él salen el poder base y la escala de los extras */ ilvl: number; fx?: FxId; set?: string }
export type UniqueBase = Base & { uniq: UniqueInfo };

/** Valor de lista de un único (para el precio de venta/subasta mínima): crece rápido con la banda. */
export const uniqueValue = (tier: number, boss: boolean): number => Math.round(60 * Math.pow(tier, 1.6) * (boss ? 2 : 1));

export const UNIQUE_BASES: UniqueBase[] = DEFS.map((d): UniqueBase => {
    const m = d.mult ?? 1, ilvl = d.ilvl ?? Math.min(40, bandIlvl(d.tier) + (d.boss ? 5 : 0)), [a, b] = d.attrs ?? attrsOf(d.arch, d.tier), f = (0.8 + 0.04 * ilvl) * m;
    return {
        name: d.name, slot: SLOT[d.arch], ...stats(d.arch, ilvl, m), look: d.look ?? LOOK[d.arch], off: d.off ?? OFF[d.arch],
        uniq: { tier: d.tier, boss: d.boss, ilvl, fx: d.fx, set: d.set, attrs: [[a, Math.max(1, R(MID[a] * f))], [b, Math.max(1, R(MID[b] * f))]] },
    };
});
export const UNIQUE_BY_NAME = new Map(UNIQUE_BASES.map((u) => [u.name, u]));
/** Únicos que caen de mobs comunes por banda (todos menos los de jefe y las piezas de set). */
export const UNIQUES_BY_TIER: Record<number, UniqueBase[]> = {};
for (const u of UNIQUE_BASES) if (!u.uniq.boss && !u.uniq.set) (UNIQUES_BY_TIER[u.uniq.tier] ??= []).push(u);
/** Piezas de set por banda: caen solo en mazmorras (mobs del tramo y jefes). */
export const SET_PIECES_BY_TIER: Record<number, UniqueBase[]> = {};
for (const u of UNIQUE_BASES) if (u.uniq.set) (SET_PIECES_BY_TIER[u.uniq.tier] ??= []).push(u);
/** Ítems característicos de cada jefe de mazmorra. */
export const BOSS_UNIQUES: Partial<Record<MobType, UniqueBase[]>> = {};
for (const u of UNIQUE_BASES) if (u.uniq.boss) (BOSS_UNIQUES[u.uniq.boss] ??= []).push(u);

// ---------- calidad (docs/ITEMS.md): se sortea al caer y define extras y tope de mejora ----------
/**
 * La calidad vive en `r` del ítem guardado: 0 Común (tienda/arranque, sin extras), 1 Verde, 2 Azul, 3 Violeta, 4 Dorado (la más alta).
 * Define cuántos stats EXTRA al azar trae el ítem (van al final de `a`, después de los fijos del catálogo: los fijos
 * son `uniq.attrs.length`, así que los extras de un único son `a.slice(uniq.attrs.length)`) y hasta dónde se mejora (+N).
 * Violeta y Dorado rollean los extras en el rango alto; Dorado es solo de jefes y activa el efecto especial de los ítems de jefe.
 */
export const QUALITY_NAMES = ['Común', 'Verde', 'Azul', 'Violeta', 'Dorado'];
/** Cantidad de stats extra por calidad. */
export const EXTRAS_BY_QUALITY = [0, 1, 2, 2, 2] as const;
/** Tope de mejora (+N) por calidad: el +11 queda reservado a los Dorado de jefe. */
export const UP_MAX_BY_QUALITY = [1, 3, 5, 8, 11] as const;
/** Desde esta calidad los extras rollean en el rango alto. */
export const QUALITY_HI_ROLL = 3;

/**
 * Pool de stats extra (sin `exp`: los bonus de farmeo quedan fuera de los ítems) y escala por ilvl.
 * Valor = (a + b·ilvl) × ranura × q — fórmula de afijos estilo Dreadmyst, lineal con el nivel del ítem
 * (los porcentajes crecen poco porque ya tienen tope total en el server: COMBAT_CAP).
 */
export const EXTRA_POOL: AttrId[] = ['crit', 'leech', 'hp', 'mp', 'mag', 'poison', 'rpar', 'df', 'rm', 'dmg'];
/**
 * Pesos de cada extra según el tipo de ranura (E3 del diseño de nivel 120, proporciones de la referencia: en las armaduras mandan
 * vida, defensa y resistencias; en las armas, daño plano, crítico y veneno; los raros —robo de vida, maná— salen poco).
 * `aspd` ya no sale como extra: la velocidad de ataque queda solo en los fijos de algunos únicos y sets.
 */
export const EXTRA_WEIGHTS: Record<'arma' | 'armadura' | 'joya', Partial<Record<AttrId, number>>> = {
    arma: { dmg: 4, crit: 3, poison: 2, mag: 3, leech: 1, hp: 1, mp: 1 },
    armadura: { hp: 4, df: 4, rm: 3, rpar: 3, mp: 2, mag: 1, crit: 1 },
    joya: { hp: 3, df: 2, rm: 2, rpar: 2, mp: 2, crit: 2, mag: 2, leech: 1, poison: 1, dmg: 1 },
};
const weightClass = (slot: Slot): 'arma' | 'armadura' | 'joya' => (slot === 'arma' ? 'arma' : slot === 'amuleto' || slot === 'anillo' || slot === 'anillo2' ? 'joya' : 'armadura');
/** Sortea un extra de `pool` con los pesos de la ranura (los que no tienen peso para esa ranura no salen). */
export function pickExtra(slot: Slot, pool: AttrId[], rnd: () => number = Math.random): AttrId | undefined {
    const w = EXTRA_WEIGHTS[weightClass(slot)], cand = pool.filter((id) => (w[id] ?? 0) > 0);
    const total = cand.reduce((a, id) => a + w[id]!, 0); if (!total) return undefined;
    let r = rnd() * total; for (const id of cand) { r -= w[id]!; if (r < 0) return id; }
    return cand[cand.length - 1];
}
const EXTRA_SCALE: Record<AttrId, [number, number]> = {
    hp: [8, 2.4], mp: [3, 0.9], mag: [1.5, 0.32], df: [1.5, 0.35], rm: [2, 0.45],
    crit: [2, 0.05], aspd: [4, 0.1], leech: [2, 0.05], poison: [6, 0.15], rpar: [5, 0.12], exp: [0, 0], dmg: [0.6, 0.11],
};
/** Multiplicador por ranura (Dreadmyst: pecho/arma 1×, cabeza y futuros guantes/botas 0,65×, anillos/amuleto 0,5×). */
export const SLOT_EXTRA_MULT: Record<Slot, number> = { arma: 1, armadura: 1, cabeza: 0.65, guantes: 0.65, botas: 0.65, amuleto: 0.5, anillo: 0.5, anillo2: 0.5 };
// ---------- sets (docs/ITEMS.md): bonos por cantidad de piezas equipadas ----------
export interface SetBonus { n: number; stats: [AttrId, number][] }
export interface SetDef { id: string; name: string; tier: number; faction: 'solmar' | 'vhar'; pieces: string[]; bonuses: SetBonus[] }
/** Valor de un stat de bono de set: la escala lineal de los extras al ilvl de la banda × `k` (2 piezas 1×, 4 piezas 1,5×, 6 piezas 2×, 8 piezas 2,8×). */
const setStat = (id: AttrId, tier: number, k: number): [AttrId, number] => { const [a, b] = EXTRA_SCALE[id]; return [id, Math.max(1, R((a + b * bandIlvl(tier)) * k))]; };
const SET_STEPS: [number, number][] = [[2, 1], [4, 1.5], [6, 2], [8, 2.8]];
const mkSet = (id: string, name: string, tier: number, faction: 'solmar' | 'vhar', ...stats: AttrId[][]): SetDef => ({
    id, name, tier, faction, pieces: UNIQUE_BASES.filter((u) => u.uniq.set === id).map((u) => u.name),
    bonuses: SET_STEPS.map(([n, k], i) => ({ n, stats: stats[i].map((a) => setStat(a, tier, k)) })),
});
/** Los 7 sets de nación (arte de Solmar y Vhar): uno por banda de la T1 a la T7; 8 piezas (todos los slots) con bonos a 2, 4, 6 y 8 piezas distintas. */
export const SETS: SetDef[] = [
    mkSet('cobre', 'Cobre de Solmar', 1, 'solmar', ['hp', 'aspd'], ['crit', 'hp'], ['hp', 'leech'], ['aspd', 'crit', 'hp']),
    mkSet('ambar', 'Ámbar de Vhar', 2, 'vhar', ['mp', 'mag'], ['mag', 'hp'], ['mp', 'crit'], ['mag', 'mp', 'leech']),
    mkSet('bruma', 'Bruma de Solmar', 3, 'solmar', ['hp', 'df'], ['df', 'rm'], ['hp', 'rpar'], ['df', 'rm', 'hp']),
    mkSet('alba', 'Alba de Solmar', 4, 'solmar', ['hp', 'aspd'], ['crit', 'leech'], ['hp', 'crit'], ['aspd', 'crit', 'leech']),
    mkSet('cenit', 'Cenit de Solmar', 5, 'solmar', ['hp', 'df'], ['df', 'rm'], ['hp', 'rpar'], ['df', 'rm', 'hp']),
    mkSet('ceniza', 'Ceniza de Vhar', 6, 'vhar', ['mp', 'mag'], ['mag', 'crit'], ['mp', 'hp'], ['mag', 'mp', 'leech']),
    mkSet('brasa', 'Brasa de Vhar', 7, 'vhar', ['hp', 'crit'], ['crit', 'aspd'], ['leech', 'hp'], ['crit', 'aspd', 'leech']),
    ...CLASS_SETS.map((c) => mkSet(c.id, c.name, c.tier, c.faction, ...c.bonus)),
];
export const SET_BY_ID = new Map(SETS.map((s) => [s.id, s]));
/** Set al que pertenece una pieza (por nombre de base). */
export const setOfPiece = (name: string): SetDef | undefined => { const id = UNIQUE_BY_NAME.get(name)?.uniq.set; return id ? SET_BY_ID.get(id) : undefined; };
/** Sets con piezas puestas: cuántas (nombres distintos) y los bonos activos acumulados (los de 2, 4 y 6 piezas según cuántas haya). */
export function activeSets(equippedNames: (string | undefined | null)[]): { set: SetDef; count: number; stats: [AttrId, number][] }[] {
    const by = new Map<string, Set<string>>();
    for (const n of equippedNames) { if (!n) continue; const s = setOfPiece(n); if (s) (by.get(s.id) ?? by.set(s.id, new Set()).get(s.id)!).add(n); }
    return [...by].map(([id, names]) => {
        const set = SET_BY_ID.get(id)!, count = names.size, stats: [AttrId, number][] = [];
        for (const b of set.bonuses) if (count >= b.n) for (const st of b.stats) stats.push(st);
        return { set, count, stats };
    });
}

/** Un valor de extra ya tirado. */
export function rollExtra(id: AttrId, ilvl: number, slot: Slot, quality: number, rnd: () => number = Math.random): number {
    const [a, b] = EXTRA_SCALE[id], q = quality >= QUALITY_HI_ROLL ? 1.15 + rnd() * 0.2 : 0.85 + rnd() * 0.3;
    return Math.max(1, Math.round((a + b * ilvl) * (SLOT_EXTRA_MULT[slot] ?? 1) * q));
}
/** Los extras de un ítem que cae: distintos entre sí y distintos de los fijos (`exclude`). */
export function rollExtras(slot: Slot, ilvl: number, quality: number, exclude: AttrId[] = [], rnd: () => number = Math.random): [AttrId, number][] {
    const pool = EXTRA_POOL.filter((id) => !exclude.includes(id)), out: [AttrId, number][] = [];
    for (let i = 0; i < (EXTRAS_BY_QUALITY[quality] ?? 0) && pool.length; i++) {
        const id = pickExtra(slot, pool, rnd); if (!id) break;
        pool.splice(pool.indexOf(id), 1);
        out.push([id, rollExtra(id, ilvl, slot, quality, rnd)]);
    }
    return out;
}
/** ilvl (nivel de ítem) de un único: sale del catálogo (techo de la banda; los de jefe +5, tope 40; el verdugo, 40). */
export const uniqueIlvl = (u: UniqueBase): number => u.uniq.ilvl;

// ---------- mejora (+N) de ítems únicos (docs/ITEMS.md §7) ----------
/** Techo absoluto de la mejora; el tope real de cada ítem lo pone su calidad (UP_MAX_BY_QUALITY). Las probabilidades de fallo viven solo en el server. */
export const UP_MAX = 11;
/** Cada nivel de mejora suma este porcentaje a los stats base del ítem (daño, defensa, RM y daño mágico). */
export const UP_PCT = 0.04;
export const upMult = (up = 0): number => 1 + UP_PCT * Math.max(0, up);
/** Piedras de forja y oro que cuesta pasar de +up a +up+1 un ítem de la banda `tier`. */
export const upStones = (up: number): number => 3 * (up + 1);
export const upGold = (tier: number, up: number): number => Math.round(40 * tier * (up + 1));
