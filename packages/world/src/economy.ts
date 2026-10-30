/**
 * Economía compartida entre cliente y server: bases de items, atributos, tiendas de los NPC, precios, pociones,
 * misiones y llaves. El server valida TODO con estas tablas (precios, stock, rangos de atributos, recompensas);
 * el cliente solo las usa para dibujar. Ver docs/ECONOMIA_SERVER.md.
 */
import type { MobType } from './mobs';

export type Slot = 'arma' | 'armadura' | 'cabeza' | 'anillo';
export const SLOTS: Slot[] = ['arma', 'armadura', 'cabeza', 'anillo'];
/** Capacidad de la bolsa de equipo. */
export const BAG_MAX = 18;
/** Tope de pociones de cada tipo. */
export const POT_MAX = 99;

/** 'df' = defensa física, 'rm' = resistencia mágica (ver docs/COMBATE.md). Los viejos 'fres'/'ires' se convierten en 'rm' al cargar. */
export type AttrId = 'crit' | 'aspd' | 'leech' | 'hp' | 'mp' | 'mag' | 'exp' | 'poison' | 'rpar' | 'df' | 'rm';
/** Rango base de cada atributo (el botín lo escala con el nivel del mob). */
export const ATTR_RANGES: Record<AttrId, [number, number]> = {
    crit: [2, 6], aspd: [4, 12], leech: [2, 6], hp: [8, 25], mp: [6, 20], mag: [2, 6], exp: [3, 10], poison: [6, 16], rpar: [5, 15], df: [3, 9], rm: [4, 12],
};
export const ATTR_IDS = Object.keys(ATTR_RANGES) as AttrId[];
/** Clave del generador de botín del server -> atributo. */
export const SRV_ATTR: Record<string, AttrId> = { critical_chance: 'crit', attack_speed: 'aspd', life_steal: 'leech', defense: 'df', magic_resistance: 'rm', fire_resistance: 'rm', ice_resistance: 'rm', paralysis_resistance: 'rpar', bonus_mana: 'mp', bonus_hp: 'hp' };

/** def = defensa física (DF), rm = resistencia mágica (RM): mitigación = X / (100 + X). */
export interface Base { name: string; slot: Slot; dmg?: [number, number]; def?: number; rm?: number; mag?: number; look?: string; off?: string }
export const BASES: Base[] = [
    { name: 'Espada corta', slot: 'arma', dmg: [4, 8], look: 'shortsword', off: 'buckler' },
    { name: 'Hacha de leñador', slot: 'arma', dmg: [6, 11], look: 'hand_axe', off: 'buckler' },
    { name: 'Báculo de fresno', slot: 'arma', dmg: [2, 4], mag: 5, look: 'staff' },
    { name: 'Espada larga', slot: 'arma', dmg: [7, 12], look: 'longsword', off: 'iron_buckler' },
    { name: 'Hacha de guerra', slot: 'arma', dmg: [9, 15], look: 'battle_axe' },
    { name: 'Maza', slot: 'arma', dmg: [6, 11], look: 'mace', off: 'kite_shield' },
    { name: 'Martillo pesado', slot: 'arma', dmg: [10, 16], look: 'maul' },
    { name: 'Mandoble', slot: 'arma', dmg: [12, 18], look: 'zweihander' },
    { name: 'Varita', slot: 'arma', dmg: [1, 3], mag: 8, look: 'wand' },
    { name: 'Coraza de cuero', slot: 'armadura', def: 12, rm: 4, look: 'leather' },
    { name: 'Cota de malla', slot: 'armadura', def: 22, rm: 8, look: 'chain' },
    { name: 'Armadura de placas', slot: 'armadura', def: 34, rm: 12, look: 'plate' },
    { name: 'Túnica de mago', slot: 'armadura', def: 4, rm: 24, mag: 4, look: 'mage' },
    { name: 'Ropas de tela', slot: 'armadura', def: 4, rm: 6, look: 'cloth' },
    { name: 'Capucha de cuero', slot: 'cabeza', def: 4, rm: 2, look: 'leather_hood' },
    { name: 'Cofia de malla', slot: 'cabeza', def: 8, rm: 3, look: 'chain_coif' },
    { name: 'Yelmo de hierro', slot: 'cabeza', def: 12, rm: 4, look: 'plate_helm' },
    { name: 'Capucha de mago', slot: 'cabeza', def: 2, rm: 10, mag: 3, look: 'mage_hood' },
    { name: 'Anillo opaco', slot: 'anillo', rm: 8 },
];
/** Bases que solo venden los comerciantes (no caen de los mobs: así no se mueve el reparto de BASES que usa el server). El nombre es la clave del guardado. */
export const SHOP_BASES: Base[] = [
    { name: 'Anillo de cobre', slot: 'anillo', look: 'ring_copper' }, { name: 'Anillo de plata', slot: 'anillo', look: 'ring_silver' }, { name: 'Anillo de jade', slot: 'anillo', look: 'ring_jade' },
    { name: 'Anillo del filo', slot: 'anillo', look: 'ring_ruby' }, { name: 'Sello del veloz', slot: 'anillo', look: 'ring_gold' },
    { name: 'Amuleto del cazador', slot: 'anillo', look: 'amulet_bone' },
];
export const ALL_BASES: Base[] = [...BASES, ...SHOP_BASES];
export const BASE_BY_NAME = new Map(ALL_BASES.map((b) => [b.name, b]));

/** Rarezas: índice 0..3 (Común, Mágico, Raro, Épico). */
export const RARITY_NAMES = ['Común', 'Mágico', 'Raro', 'Épico'];

// ---------- pociones ----------
export const POTS = { hp: { name: 'Poción de vida', price: 25, key: 'Q', col: '#e0524a' }, mp: { name: 'Poción de maná', price: 30, key: 'E', col: '#4a8fe0' } };
export type PotKind = 'hp' | 'mp';

// ---------- tiendas de los NPC ----------
/** Una línea del stock fijo de un vendedor: un item común de la base `base` (con atributos fijos si los hay) o pociones sueltas / en pack. */
export interface Stock { base?: string; attrs?: [AttrId, number][]; price: number; lvl: number; pot?: 'hp' | 'mp'; qty?: number }
export interface ShopDef { label: string; col: string; greet: string; stock: Stock[] }
export const SHOPS: Record<string, ShopDef> = {
    mercader: {
        label: 'Mercader de pociones', col: '#e0524a', greet: 'Pociones frescas: una de vida te salva el pellejo, una de maná te da otro hechizo.',
        stock: [{ pot: 'hp', qty: 1, price: POTS.hp.price, lvl: 1 }, { pot: 'mp', qty: 1, price: POTS.mp.price, lvl: 1 }],
    },
    armero: {
        label: 'Armero', col: '#c8d2da', greet: 'Acero bien templado. Si buscás algo para romper cráneos, llegaste al lugar.',
        stock: [
            { base: 'Espada corta', price: 45, lvl: 1 }, { base: 'Hacha de leñador', price: 80, lvl: 1 }, { base: 'Maza', price: 130, lvl: 3 }, { base: 'Espada larga', price: 190, lvl: 4 },
            { base: 'Hacha de guerra', price: 320, lvl: 6 }, { base: 'Martillo pesado', price: 420, lvl: 8 }, { base: 'Mandoble', price: 600, lvl: 10 },
        ],
    },
    armadurero: {
        label: 'Armadurero', col: '#8fb6d8', greet: 'Una buena armadura vale más que un buen brazo. Probate lo que quieras.',
        stock: [
            { base: 'Ropas de tela', price: 20, lvl: 1 }, { base: 'Capucha de cuero', price: 30, lvl: 1 }, { base: 'Coraza de cuero', price: 70, lvl: 2 }, { base: 'Cofia de malla', price: 90, lvl: 4 },
            { base: 'Yelmo de hierro', price: 190, lvl: 6 }, { base: 'Cota de malla', price: 230, lvl: 5 }, { base: 'Armadura de placas', price: 520, lvl: 9 },
        ],
    },
    joyero: {
        label: 'Joyero', col: '#e8c34a', greet: 'Piedras, plata y un poco de magia: nada que no se pueda llevar en un dedo.',
        stock: [
            { base: 'Anillo opaco', price: 15, lvl: 1 },
            { base: 'Anillo de cobre', attrs: [['hp', 12]], price: 85, lvl: 2 }, { base: 'Anillo de plata', attrs: [['mp', 10]], price: 95, lvl: 2 },
            { base: 'Anillo de jade', attrs: [['rm', 8]], price: 120, lvl: 3 }, { base: 'Amuleto del cazador', attrs: [['exp', 5]], price: 150, lvl: 3 },
            { base: 'Anillo del filo', attrs: [['crit', 3]], price: 210, lvl: 5 }, { base: 'Sello del veloz', attrs: [['aspd', 6]], price: 240, lvl: 6 },
        ],
    },
    alquimista: {
        label: 'Alquimista', col: '#7fe0b0', greet: 'Pociones al por mayor y lo necesario para quien vive de la magia.',
        stock: [
            { pot: 'hp', qty: 5, price: 110, lvl: 1 }, { pot: 'mp', qty: 5, price: 135, lvl: 1 },
            { base: 'Capucha de mago', price: 95, lvl: 3 }, { base: 'Báculo de fresno', price: 70, lvl: 1 }, { base: 'Varita', price: 140, lvl: 4 }, { base: 'Túnica de mago', price: 150, lvl: 4 },
        ],
    },
    capitan: { label: 'Capitán', col: '#ffd24a', greet: '', stock: [] },
    guardia: { label: 'Guardia', col: '#9fa8b0', greet: '', stock: [] },
};
/** Rol del NPC (mercader, armero, ...): el id es `rol_s` / `rol_v` (o `rol_s1`...). */
export const roleOf = (n: { id: string }): string => n.id.split('_')[0];
/** Distancia (en celdas) a la que se abre la tienda de un NPC y, con margen por latencia, la que el server acepta para comprar/vender. */
export const TALK_RANGE = 2.6;
export const SHOP_SERVER_RANGE = TALK_RANGE + 2;

/** Valor base de cada item de tienda (precio de lista): el precio de venta es una fracción de esto. */
export const VALUE: Record<string, number> = {};
for (const sh of Object.values(SHOPS)) for (const st of sh.stock) if (st.base && VALUE[st.base] == null) VALUE[st.base] = st.price;
export const SELL_PRICE = [4, 15, 50, 150]; // oro por rareza (Común, Mágico, Raro, Épico), más un cuarto del valor de lista
export const sellPrice = (baseName: string, rarity: number): number => Math.round((SELL_PRICE[rarity] ?? 1) + (VALUE[baseName] ?? 0) * 0.25);

// ---------- misiones y llaves ----------
export interface Quest { name: string; zone: string; type: MobType; n: number; xp: number; gold: number; say: string; shard?: 'cripta' | 'foso' }
export const QUESTS: Quest[] = [
    { name: 'Goblins del campamento', zone: 'Campamento goblin', type: 'goblin', n: 5, xp: 70, gold: 30, say: 'Unos goblins lanceros rondan al sureste y asustan a los mercaderes. Matá a 5 y volvé.' },
    { name: 'La avanzada goblin', zone: 'Avanzada goblin', type: 'goblin_elite', n: 4, xp: 120, gold: 55, say: 'Más al norte armaron una avanzada con goblins de élite. Eliminá a 4.' },
    { name: 'Hoyos traicioneros', zone: 'Hoyos de hormiga león', type: 'antlion', n: 5, xp: 190, gold: 80, say: 'Al oeste las hormigas león cavaron hoyos en el camino. Acabá con 5.' },
    { name: 'El pantano muerto', zone: 'Pantano muerto', type: 'zombie', n: 5, xp: 260, gold: 110, say: 'Del pantano del este salen zombis. Necesito que mates a 5.' },
    { name: 'Huesos inquietos', zone: 'Cementerio viejo', type: 'skeleton', n: 5, xp: 420, gold: 150, say: 'Los esqueletos del cementerio ya no descansan. Derrotá a 5.' },
    { name: 'Magia prohibida', zone: 'Ruinas del nigromante', type: 'skeleton_mage', n: 4, xp: 520, gold: 190, say: 'Hay hechiceros esqueleto en las ruinas del sur. Cuidado con sus hechizos: matá a 4.' },
    { name: 'Fuego en el hormiguero', zone: 'Hormiguero ardiente', type: 'fire_ant', n: 6, xp: 700, gold: 260, shard: 'cripta', say: 'El hormiguero ardiente del noreste es peligroso. Si volvés con 6 cabezas te doy una esquirla de llave: con 3 más de los bosses te forjo la llave de la cripta.' },
    { name: 'Alas de ceniza', zone: 'Nidal de ceniza', type: 'wyvern', n: 4, xp: 950, gold: 320, say: 'Al sur del páramo hay un corredor que baja a las Tierras de ceniza. Los wyverns anidan en el centro: derribá a 4.' },
    { name: 'El osario ardiente', zone: 'Osario ardiente', type: 'skeleton_mage', n: 5, xp: 1150, gold: 400, say: 'Más al este, los hechiceros del osario no se apagan. Acabá con 5.' },
    { name: 'La cantera del minotauro', zone: 'Cantera del minotauro', type: 'minotaur', n: 2, xp: 1700, gold: 650, shard: 'foso', say: 'Los minotauros de la cantera cuidan el camino al foso. Si matás a 2 te doy una esquirla del foso: con 3 y 120 de oro te forjo la llave de la Cámara del foso.' },
];
export const SHARDS_PER_KEY = 3;
/** Llaves de mazmorra: se forjan con esquirlas que sueltan los bosses (la de la cripta, los de afuera; la del foso, el jefe de la cripta). */
export type KeyId = 'cripta' | 'foso';
export const KEYDEFS: Record<KeyId, { name: string; shard: string; gold: number }> = {
    cripta: { name: 'Llave de la cripta', shard: 'Esquirla de llave', gold: 60 },
    foso: { name: 'Llave del foso', shard: 'Esquirla del foso', gold: 120 },
};
export const KEY_IDS = Object.keys(KEYDEFS) as KeyId[];
