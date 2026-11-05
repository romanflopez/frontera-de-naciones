/**
 * Importa mapas de Flare (CC-BY-SA 3.0, mods/empyrean_campaign/maps) a datos de ERIS (docs/MAPAS_FLARE.md).
 * Por cada mapa genera packages/world/src/flare/<id>.ts con: tamaño cuadrado, capas de tiles de Flare (el atlas las pasa a ids de
 * ERIS), grilla de colisión sin bolsillos inalcanzables, el vacío de Flare rellenado de bosque (sin partes negras), zonas de caza en
 * 3 pits (cada uno con su mob y nivel), mobs sueltos entre pits y vínculos.
 *
 * Uso: FLARE_DIR=<flare-game o zip v1.14 descomprimido> pnpm --filter @fdn/tools flare:maps [id ...]
 * Determinista: sin Math.random ni hora; el mismo mapa da siempre el mismo archivo.
 */
import { pitLevel, TIERS, type Tier } from '../../../packages/world/src/tiers';
import { shadeId, isFlareWater, isFlareCliff } from '../../../packages/world/src/flare/types';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const flare = process.env.FLARE_DIR ?? join(root, 'reference', 'flare-game');
const mapsDir = join(flare, 'mods', 'empyrean_campaign', 'maps');
const outDir = join(root, 'packages', 'world', 'src', 'flare');

/** Tipos de mob que existen hoy (mobs.ts). Se lee del archivo para no duplicar la lista. */
const knownMobs = new Set([...readFileSync(join(root, 'packages', 'world', 'src', 'mobs.ts'), 'utf8').matchAll(/MOB_TYPES: MobType\[\] = \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])));

/** Los niveles no se escriben a mano: salen del `lvl` del mapa (sub-rango de su tier) con `pitLevel` (packages/world/src/tiers.ts). */
interface PitSpec { name: string; type: string }
interface LooseSpec { type: string }
interface MapSpec {
    /** Id del mapa en Flare. */ id: string;
    /** Id del mapa en ERIS. */ eris: string; name: string; region: string; pvp: 'off' | 'faction'; lvl: [number, number];
    /** Tier de zona (docs/TIERS_DE_ZONA.md): `lvl` tiene que caer dentro de su rango. */ tier: Tier;
    pits: [PitSpec, PitSpec, PitSpec]; loose: LooseSpec[];
    /** Conexiones que Flare no trae (mapas que en Flare no se tocan): `near` = a unos pasos de la entrada, `far` = en el punto más lejano. Hay que declararlas en los dos mapas. */
    extras?: { to: string; where: 'near' | 'far'; kind?: 'portal' | 'door'; gate?: number }[];
    /** Mazmorra de grupo (docs/MAPAS_FLARE.md §5). `respawnMap` = piso 1 (reaparecés ahí si morís en el piso 2). */
    dungeon?: boolean; respawnMap?: string;
    /** Jefe final: una zona de 1 mob en el punto más lejano de las entradas. */
    boss?: { type: string; name: string };
    /** Sala del jefe despejada: se sacan los pits y sueltos a menos de estas celdas del jefe (así no se pelea con un pack encima). */
    bossClear?: number;
    /** Vínculos de Flare a descartar (id de Flare del destino) y nivel mínimo para los que quedan (id de Flare del destino -> nivel). */
    /** Vínculos de Flare que se descartan por destino exacto [mapa, tx, ty] (apuntan a una celda que en ERIS quedó sellada). */
    skipLinks?: [string, number, number][];
    dropLinks?: string[]; linkGates?: Record<string, number>;
    /** Rectángulos [x,y,w,h] que se abren (puertas trabadas de Flare que se abren con un evento): sin colisión ni objeto. */
    open?: [number, number, number, number][];
    /** Abre todas las celdas que algún evento de Flare libera (`mapmod=…collision,x,y,0`): puertas, rejas y palancas quedan abiertas de entrada. */
    openMods?: boolean;
    /** Parte de los obstáculos sueltos que se conserva al abrir el mapa (por defecto KEEP_PROPS). */
    keepProps?: number;
    /** Ensancha los pasillos esta cantidad de celdas a cada lado (La Brecha: laberinto de cañones angostos, pedido de Román 4/11/2026). */
    widen?: number;
}

/** Un mapa por entrada. Pit A = el más cerca de la entrada (el más fácil), C = el más lejos. Los nombres de zona son únicos entre mapas. */
const SPECS: MapSpec[] = [
    { id: 'salted_field', eris: 'campos_de_sal', name: 'Campos de Sal', region: 'comun', pvp: 'off', lvl: [1, 4], tier: 1, dropLinks: ['perdition_mines'],
        pits: [{ name: 'Puesto goblin', type: 'goblin' }, { name: 'Charco de zombis', type: 'zombie' }, { name: 'Avanzada del campo', type: 'goblin_elite' }],
        loose: [{ type: 'goblin' }] },
    { id: 'stonewood', eris: 'bosque_de_piedra', name: 'Bosque de Piedra', region: 'comun', pvp: 'off', lvl: [4, 8], tier: 1,
        pits: [{ name: 'Claro de los goblins', type: 'goblin' }, { name: 'Madriguera hobgoblin', type: 'hobgoblin' }, { name: 'Fuerte del bosque', type: 'goblin_elite' }],
        loose: [{ type: 'goblin' }, { type: 'zombie' }] },
    { id: 'goblin_camp', eris: 'canon_goblin', name: 'Cañón goblin', region: 'comun', pvp: 'faction', lvl: [8, 14], tier: 1, linkGates: { goblin_cave: 4 },
        pits: [{ name: 'Empalizada del cañón', type: 'goblin_elite' }, { name: 'Puesto de arqueros', type: 'hobgoblin_archer' }, { name: 'Tienda del cabecilla', type: 'hobgoblin' }],
        loose: [{ type: 'goblin' }] },
    // D1 (T1): Cueva y minas goblin (2 pisos de cueva, Nv 3-5, jefe final en las minas). La entrada es la del Cañón goblin (Nv 2).
    { id: 'goblin_cave', eris: 'cueva_goblin', name: 'Cueva goblin', region: 'mazmorra', pvp: 'off', lvl: [8, 11], tier: 1, dungeon: true,
        pits: [{ name: 'Guardia de la cueva', type: 'goblin' }, { name: 'Hobgoblins de la gruta', type: 'hobgoblin' }, { name: 'Arqueros del túnel', type: 'hobgoblin_archer' }],
        loose: [{ type: 'goblin_elite' }], extras: [{ to: 'minas_goblin', where: 'far' }] },
    { id: 'perdition_mines', eris: 'minas_goblin', name: 'Minas goblin', region: 'mazmorra', pvp: 'off', lvl: [11, 14], tier: 2, dungeon: true, respawnMap: 'cueva_goblin', dropLinks: ['salted_field'],
        pits: [{ name: 'Picadores goblin', type: 'goblin_elite' }, { name: 'Capataces hobgoblin', type: 'hobgoblin' }, { name: 'Ballesteros de las minas', type: 'hobgoblin_archer' }],
        loose: [{ type: 'goblin_elite' }], boss: { type: 'goblin_jefe', name: 'Sala del Jefe goblin' }, extras: [{ to: 'cueva_goblin', where: 'near' }] },
    // D2 (T2): Nido de hormiga león (2 pisos, Nv 8-10, jefe: la Reina en las ruinas). La entrada es una puerta de las Altas de Nazia (Nv 4).
    { id: 'antlion_nest', eris: 'nido_hormiga_leon', name: 'Nido de hormiga león', region: 'mazmorra', pvp: 'off', lvl: [23, 26], tier: 3, dungeon: true,
        pits: [{ name: 'Criadero', type: 'antlion_small' }, { name: 'Cámara de las hormigas', type: 'antlion' }, { name: 'Brasas del nido', type: 'fire_ant' }],
        loose: [{ type: 'antlion' }], extras: [{ to: 'ruinas_de_stormrock', where: 'far' }, { to: 'altas_de_nazia', where: 'near' }], dropLinks: ['temple_of_mez_1', 'the_breach'] },
    { id: 'stormrock_ruins', eris: 'ruinas_de_stormrock', name: 'Ruinas de Stormrock', region: 'mazmorra', pvp: 'off', lvl: [26, 31], tier: 3, dungeon: true, respawnMap: 'nido_hormiga_leon',
        pits: [{ name: 'Galerías infestadas', type: 'antlion' }, { name: 'Salón de las brasas', type: 'fire_ant' }, { name: 'Guardia no-muerta', type: 'skeleton_archer' }],
        loose: [{ type: 'zombie_dark' }], boss: { type: 'antlion_reina', name: 'Cámara de la Reina' }, dropLinks: ['stormrock_pass'], open: [[47, 68, 2, 2], [43, 69, 1, 1]], extras: [{ to: 'nido_hormiga_leon', where: 'near' }] },
    // D3 (T3): Cripta olvidada (2 pisos, Nv 13-15, jefe: el Caballero de la cripta). La entrada es una puerta del Cementerio de Lochport (Nv 9).
    { id: 'st_maria_2', eris: 'cripta_olvidada', name: 'Cripta olvidada', region: 'mazmorra', pvp: 'off', lvl: [45, 48], tier: 5, dungeon: true,
        pits: [{ name: 'Nichos de huesos', type: 'skeleton' }, { name: 'Sepultureros', type: 'zombie_dark' }, { name: 'Arqueros de la cripta', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton_mage' }], extras: [{ to: 'cementerio_de_lochport', where: 'near' }], open: [[27, 50, 2, 2], [45, 44, 2, 7]] },
    { id: 'st_maria_3', eris: 'sepulcro_profundo', name: 'Sepulcro profundo', region: 'mazmorra', pvp: 'off', lvl: [48, 52], tier: 5, dungeon: true, respawnMap: 'cripta_olvidada',
        pits: [{ name: 'Hechiceros del sepulcro', type: 'skeleton_mage' }, { name: 'Tumbas malditas', type: 'cursed_grave' }, { name: 'Guardia muerta', type: 'zombie' }],
        loose: [{ type: 'skeleton' }], boss: { type: 'caballero_cripta', name: 'Cámara del Caballero' } },
    // D4 (T4): Torre del hechicero (2 pisos, Nv 18-20, jefe: el Mago mayor). La entrada es una puerta de La Brecha (Nv 14); los interruptores y puertas trabadas de Flare quedan abiertos.
    { id: 'wizards_tower_1', eris: 'torre_del_hechicero', name: 'Torre del hechicero', region: 'mazmorra', pvp: 'off', lvl: [61, 63], tier: 7, dungeon: true,
        pits: [{ name: 'Aprendices caídos', type: 'skeleton_mage' }, { name: 'Siervos de la torre', type: 'zombie_dark' }, { name: 'Vigías arcanos', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'la_brecha', where: 'near' }], open: [[39, 57, 2, 2], [39, 37, 2, 2], [59, 61, 2, 2], [77, 47, 2, 2], [59, 35, 2, 2]] },
    { id: 'wizards_tower_2', eris: 'camaras_de_investigacion', name: 'Cámaras de investigación', region: 'mazmorra', pvp: 'off', lvl: [63, 66], tier: 7, dungeon: true, respawnMap: 'torre_del_hechicero',
        pits: [{ name: 'Salamandras invocadas', type: 'wyvern_fire' }, { name: 'Hechiceros del laboratorio', type: 'skeleton_mage' }, { name: 'Tumbas arcanas', type: 'cursed_grave' }],
        loose: [{ type: 'zombie_dark' }], boss: { type: 'mago_mayor', name: 'Sala del Mago mayor' }, dropLinks: ['underworld'], open: [[35, 23, 2, 2]] },
    // D5 (T5): Templo de Mez (2 pisos, Nv 23-25, jefe: el Wyvern del aire). La entrada es una puerta de Cenizas II (Nv 19); interruptores y puertas trabadas abiertos.
    { id: 'temple_of_mez_1', eris: 'templo_de_mez', name: 'Templo de Mez', region: 'mazmorra', pvp: 'off', lvl: [74, 77], tier: 8, dungeon: true, dropLinks: ['antlion_nest'],
        pits: [{ name: 'Nidos de wyvern', type: 'wyvern' }, { name: 'Cámara helada', type: 'wyvern_ice' }, { name: 'Guardia del sótano', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'cenizas_ii', where: 'far' }], open: [[29, 13, 2, 2], [41, 39, 2, 2]] },
    { id: 'temple_of_mez_2', eris: 'salon_de_mez', name: 'Salón principal de Mez', region: 'mazmorra', pvp: 'off', lvl: [77, 83], tier: 8, dungeon: true, respawnMap: 'templo_de_mez',
        pits: [{ name: 'Corredor del aire', type: 'wyvern' }, { name: 'Forja de Mez', type: 'wyvern_fire' }, { name: 'Hechiceros del templo', type: 'skeleton_mage' }],
        loose: [{ type: 'skeleton' }], boss: { type: 'wyvern_aire', name: 'Trono del Wyvern del aire' }, open: [[45, 39, 2, 2], [66, 29, 2, 2], [45, 81, 2, 2]] },
    // D6 (T6): Fortaleza infernal y Foso del demonio (2 pisos, Nv 28-30, jefe: el Señor del Foso). La entrada es una puerta de Cenizas III (Nv 24); Flare no los une (usa el cuartel), así que van por una puerta propia.
    { id: 'underworld_stronghold_1', eris: 'fortaleza_infernal', name: 'Fortaleza infernal', region: 'mazmorra', pvp: 'off', lvl: [96, 98], tier: 10, dungeon: true,
        pits: [{ name: 'Brasas del cuartel', type: 'wyvern_fire' }, { name: 'Centinelas hechiceros', type: 'skeleton_mage' }, { name: 'Arqueros infernales', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'foso_del_demonio', where: 'far' }, { to: 'cenizas_iii', where: 'near' }], open: [[27, 31, 2, 2], [21, 25, 2, 2]], dropLinks: ['underworld_mines'] },
    { id: 'the_pit', eris: 'foso_del_demonio', name: 'Foso del demonio', region: 'mazmorra', pvp: 'off', lvl: [98, 100], tier: 10, dungeon: true, respawnMap: 'fortaleza_infernal',
        pits: [{ name: 'Fosa de brasas', type: 'fire_ant' }, { name: 'Cuevas de fuego', type: 'wyvern_fire' }, { name: 'Condenados', type: 'zombie_dark' }],
        loose: [{ type: 'skeleton_mage' }], boss: { type: 'demonio_foso', name: 'Trono del Señor del Foso' }, extras: [{ to: 'fortaleza_infernal', where: 'near' }] },
    // Mapas abiertos de T4-T6 (la cadena de abajo de La Brecha): el Paso de Stormrock (nieve; Flare lo une a La Brecha por 4 caminos) y las Cenizas I-III (cuevas, la zona de abajo de Flare).
    { id: 'stormrock_pass', eris: 'paso_de_stormrock', name: 'Paso de Stormrock', region: 'comun', pvp: 'faction', lvl: [61, 66], tier: 7, dropLinks: ['stormrock_ruins'], skipLinks: [['the_breach', 23, 14], ['the_breach', 76, 41]],
        pits: [{ name: 'Riscos de wyvern', type: 'wyvern' }, { name: 'Hormigueros helados', type: 'ice_ant' }, { name: 'Cumbre helada', type: 'wyvern_ice' }],
        loose: [{ type: 'skeleton_archer' }], extras: [{ to: 'cenizas_i', where: 'far' }] },
    { id: 'underworld', eris: 'cenizas_i', widen: 4, name: 'Cenizas I', region: 'comun', pvp: 'faction', lvl: [69, 74], tier: 7, dropLinks: ['torture_chambers'],
        pits: [{ name: 'Brasas de la ceniza', type: 'fire_ant' }, { name: 'Hechiceros de ceniza', type: 'skeleton_mage' }, { name: 'Muertos calcinados', type: 'zombie_dark' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'paso_de_stormrock', where: 'near' }] },
    { id: 'underworld_catacombs', eris: 'cenizas_ii', widen: 14, name: 'Cenizas II', region: 'comun', pvp: 'faction', lvl: [74, 83], tier: 8,
        pits: [{ name: 'Osario', type: 'skeleton' }, { name: 'Tumbas ardientes', type: 'cursed_grave' }, { name: 'Arqueros de las catacumbas', type: 'skeleton_archer' }],
        loose: [{ type: 'zombie_dark' }], extras: [{ to: 'templo_de_mez', where: 'far', kind: 'door', gate: 19 }] },
    { id: 'underworld_mines', eris: 'cenizas_iii', widen: 40, name: 'Cenizas III', region: 'comun', pvp: 'faction', lvl: [88, 96], tier: 9, dropLinks: ['underworld_stronghold_1'],
        pits: [{ name: 'Mineros condenados', type: 'zombie_dark' }, { name: 'Hornos de wyvern', type: 'wyvern_fire' }, { name: 'Galerías de brasas', type: 'fire_ant' }],
        loose: [{ type: 'skeleton_mage' }], extras: [{ to: 'fortaleza_infernal', where: 'far', kind: 'door', gate: 24 }, { to: 'granja_roble_negro', where: 'near' }] },
    // T6, segundo mapa abierto (Nv 28-30): la Granja de Roble Negro, de pasto, para cortar la seguidilla de cuevas. Flare la une al Risco del Sur
    // y a las cloacas (no importados): se llega por un portal desde Cenizas III y sale al Oasis de Ceniza.
    { id: 'black_oak_farm', openMods: true, eris: 'granja_roble_negro', name: 'Granja de Roble Negro', region: 'comun', pvp: 'faction', lvl: [96, 100], tier: 10,
        dropLinks: ['black_oak_city', 'dilapidated_sewers', 'southern_ridge'],
        pits: [{ name: 'Corrales podridos', type: 'zombie_dark' }, { name: 'Silos de las hormigas', type: 'fire_ant' }, { name: 'Molino de los hechiceros', type: 'skeleton_mage' }],
        loose: [{ type: 'zombie' }], extras: [{ to: 'cenizas_iii', where: 'near' }, { to: 'oasis_de_ceniza', where: 'far' }] },
    // T7 (Nv 31-40, docs/TIERS_DE_ZONA.md): cuatro mapas abiertos de la reserva de Flare. Cenizas III -> Oasis (camino de Flare) -> Lago Kuuma
    // -> Laguna de la Gruta (portales de piedra) -> Minas abandonadas (camino de Flare). La mazmorra (D7) entra por el Lago Kuuma.
    { id: 'oasis', eris: 'oasis_de_ceniza', name: 'Oasis de Ceniza', region: 'comun', pvp: 'faction', lvl: [102, 106], tier: 11,
        pits: [{ name: 'Dunas de las hormigas', type: 'antlion' }, { name: 'Pozos de fuego', type: 'fire_ant' }, { name: 'Nidos del oasis', type: 'wyvern_fire' }],
        loose: [{ type: 'antlion_small' }], extras: [{ to: 'lago_kuuma', where: 'far' }, { to: 'granja_roble_negro', where: 'near' }] },
    { id: 'lake_kuuma', eris: 'lago_kuuma', name: 'Lago Kuuma', region: 'comun', pvp: 'faction', lvl: [106, 110], tier: 11, dropLinks: ['blackmire_mines'], linkGates: { fort_amir: 98 },
        pits: [{ name: 'Hormigueros del lago', type: 'ice_ant' }, { name: 'Vigías helados', type: 'skeleton_archer' }, { name: 'Riscos del lago', type: 'wyvern_ice' }],
        loose: [{ type: 'ice_ant' }], extras: [{ to: 'oasis_de_ceniza', where: 'near' }, { to: 'laguna_de_la_gruta', where: 'far' }] },
    { id: 'grot_lagoon', eris: 'laguna_de_la_gruta', name: 'Laguna de la Gruta', region: 'comun', pvp: 'faction', lvl: [110, 114], tier: 11,
        pits: [{ name: 'Orilla helada', type: 'wyvern_ice' }, { name: 'Hechiceros de la gruta', type: 'skeleton_mage' }, { name: 'Cumbre de la laguna', type: 'wyvern' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'lago_kuuma', where: 'near' }] },
    // T7, cuarto mapa abierto (Nv 38-40, el tope): las Minas abandonadas. Flare las une a la Laguna (camino propio); las salidas a La Brecha y a
    // Blackmire se descartan.
    { id: 'abandoned_mines', eris: 'minas_abandonadas', widen: 40, name: 'Minas abandonadas', region: 'comun', pvp: 'faction', lvl: [116, 120], tier: 12, dropLinks: ['the_breach', 'blackmire_mines'],
        pits: [{ name: 'Galerías de los muertos', type: 'zombie_dark' }, { name: 'Pozos de las hormigas', type: 'antlion' }, { name: 'Socavón de los hechiceros', type: 'skeleton_mage' }],
        loose: [{ type: 'skeleton_archer' }] },
    // D7 (T7): Fuerte Amir y Cámaras de tortura (2 pisos, Nv 38-40, jefe: el Gran Verdugo). La entrada es la puerta de Flare del Lago Kuuma
    // (Nv 29); Flare no une los dos pisos, así que van por una puerta propia.
    { id: 'fort_amir', openMods: true, eris: 'fuerte_amir', name: 'Fuerte Amir', region: 'mazmorra', pvp: 'off', lvl: [116, 118], tier: 12, dungeon: true,
        pits: [{ name: 'Guardia del fuerte', type: 'skeleton' }, { name: 'Ballesteros de las murallas', type: 'skeleton_archer' }, { name: 'Hechiceros del fuerte', type: 'skeleton_mage' }],
        loose: [{ type: 'zombie_dark' }], extras: [{ to: 'camaras_de_tortura', where: 'far' }] },
    { id: 'torture_chambers', openMods: true, eris: 'camaras_de_tortura', name: 'Cámaras de tortura', region: 'mazmorra', pvp: 'off', lvl: [118, 120], tier: 12, dungeon: true, respawnMap: 'fuerte_amir', dropLinks: ['underworld'],
        pits: [{ name: 'Celdas de los condenados', type: 'zombie_dark' }, { name: 'Potros del verdugo', type: 'cursed_grave' }, { name: 'Carceleros', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], boss: { type: 'verdugo', name: 'Sala del Gran Verdugo' }, bossClear: 10, extras: [{ to: 'fuerte_amir', where: 'near' }] },
    { id: 'merrimead_swamp', eris: 'pantano_de_merrimead', name: 'Pantano de Merrimead', region: 'comun', pvp: 'faction', lvl: [17, 23], tier: 2,
        pits: [{ name: 'Ciénaga de zombis', type: 'zombie' }, { name: 'Pozo oscuro', type: 'zombie_dark' }, { name: 'Lápidas del pantano', type: 'cursed_grave' }],
        loose: [{ type: 'zombie' }], extras: [{ to: 'altas_de_nazia', where: 'far' }] },
    { id: 'nazia_highlands', eris: 'altas_de_nazia', name: 'Altas de Nazia', region: 'comun', pvp: 'faction', lvl: [23, 31], tier: 3,
        pits: [{ name: 'Nidada de crías', type: 'antlion_small' }, { name: 'Hoyos de las tierras altas', type: 'antlion' }, { name: 'Hormigueros ardientes', type: 'fire_ant' }],
        loose: [{ type: 'antlion_small' }], extras: [{ to: 'pantano_de_merrimead', where: 'near' }, { to: 'nido_hormiga_leon', where: 'far', kind: 'door', gate: 4 }] },
    { id: 'lochport_cemetery', eris: 'cementerio_de_lochport', name: 'Cementerio de Lochport', region: 'comun', pvp: 'faction', lvl: [37, 45], tier: 4,
        pits: [{ name: 'Tumbas viejas', type: 'skeleton' }, { name: 'Arqueros del osario', type: 'skeleton_archer' }, { name: 'Hechiceros del camposanto', type: 'skeleton_mage' }],
        loose: [{ type: 'cursed_grave' }], extras: [{ to: 'risco_del_sur', where: 'far' }, { to: 'cripta_olvidada', where: 'near', kind: 'door', gate: 9 }] },
    { id: 'the_breach', eris: 'la_brecha', name: 'La Brecha', region: 'comun', pvp: 'faction', lvl: [55, 61], tier: 6, widen: 2,
        pits: [{ name: 'Túneles de hormiga león', type: 'antlion' }, { name: 'Hormigueros de la brecha', type: 'fire_ant' }, { name: 'Mineros caídos', type: 'zombie_dark' }],
        loose: [{ type: 'antlion_small' }, { type: 'fire_ant' }], dropLinks: ['antlion_nest', 'abandoned_mines'], extras: [{ to: 'risco_del_sur', where: 'near' }, { to: 'torre_del_hechicero', where: 'far', kind: 'door', gate: 14 }] },
    { id: 'southern_ridge', eris: 'risco_del_sur', name: 'Risco del Sur', region: 'comun', pvp: 'faction', lvl: [45, 52], tier: 5, dropLinks: ['black_oak_farm'],
        pits: [{ name: 'Risco de las hormigas', type: 'antlion' }, { name: 'Atalaya en ruinas', type: 'skeleton_mage' }, { name: 'Grietas de fuego', type: 'fire_ant' }],
        loose: [{ type: 'antlion' }, { type: 'skeleton' }], extras: [{ to: 'cementerio_de_lochport', where: 'near' }, { to: 'la_brecha', where: 'far' }] },
];

/**
 * Relleno del vacío por tileset (el vacío de Flare es negro): piso de la propia hoja y objetos que lo cubren, en porcentajes
 * acumulados. Las celdas rellenadas quedan bloqueadas. Los ids son los de la hoja (se ven en el catálogo de tools/src/flare/mapatlas.ts).
 */
const FILLS: Record<string, { floor: number[]; deco: [number, number[]][]; shade?: boolean }> = {
    grassland: {
        floor: Array.from({ length: 16 }, (_, i) => 16 + i),
        deco: [[0.17, [248, 249, 250, 251]], [0.24, [252, 253, 254, 255]], [0.29, [240, 241, 242, 243]], [0.33, [128, 129, 130, 131]], [0.45, [112, 113, 124, 125, 126, 127]]],
    },
    // Cueva: el vacío es oscuridad. Piso de tierra oscurecida en tres bandas (FLARE_SHADE) que se funde a negro lejos del mapa, con
    // estalagmitas y piedras solo en la primera fila (las caras de atrás de las paredes son transparentes y dejan ver esa sombra). Sin
    // trozos de pared sueltos: parecían columnas paradas sobre una losa.
    cave: {
        floor: Array.from({ length: 16 }, (_, i) => 16 + i), shade: true,
        deco: [[0.08, [144, 145, 146, 147, 148, 149]], [0.13, [150, 151, 152, 153]], [0.15, [132, 133, 134, 135]]],
    },
    // Nieve (más despejada el 4/11/2026, como la Granja: pocos árboles, solo en los extremos): el vacío es nieve lisa (16-31) con árboles pelados, rocas nevadas, matas y tocones (sin las piezas del agua ni los marcadores violeta 92-95).
    snowplains: {
        floor: Array.from({ length: 16 }, (_, i) => 16 + i),
        deco: [[0.045, [244, 245, 246, 247]], [0.06, [128, 129, 130, 131]], [0.085, [112, 113, 124, 125, 126, 127]], [0.09, [136]]],
    },
    // Mazmorra de piedra: lo mismo que la cueva, piso liso oscurecido en bandas que se funde a negro y apenas unos huesos en la primera fila
    // (antes eran muñones de muro por todos lados y el mapa se veía como un bosque de columnas grises).
    dungeon: {
        floor: [16, 17, 18, 19, 21, 23], shade: true,
        deco: [[0.04, [144, 145, 146, 147, 148]]],
    },
};

interface Region { x: number; y: number; w: number; h: number; category: string; level: number; min: number; max: number }
interface FlareLinkRaw { x: number; y: number; w: number; h: number; to: string; tx: number; ty: number; tooltip: string }
interface Parsed { w: number; h: number; tileset: string; title: string; hero: { x: number; y: number }; layers: Record<string, number[][]>; regions: Region[]; links: FlareLinkRaw[]; modOpen: [number, number][] }

function parseMap(path: string): Parsed {
    const hdr: Record<string, string> = {}, layers: Record<string, number[][]> = {}, regions: Region[] = [], links: FlareLinkRaw[] = [];
    let sec = '', cur: Record<string, string> = {}, rows: number[][] = [], inData = false;
    const flush = () => {
        if (sec === 'layer' && cur.type) layers[cur.type] = rows;
        else if (sec === 'enemy' && cur.location) {
            const [x, y, w, h] = cur.location.split(',').map(Number);
            const n = (cur.number ?? '1').split(',').map(Number);
            regions.push({ x, y, w, h, category: cur.category ?? cur.type ?? '?', level: Number(cur.level ?? 1), min: n[0], max: n[1] ?? n[0] });
        } else if (sec === 'event' && cur.intermap && cur.location) {
            const [x, y, w, h] = cur.location.split(',').map(Number);
            const [to, tx, ty] = cur.intermap.split(',');
            links.push({ x, y, w, h, to: to.replace(/^maps\//, '').replace(/\.txt$/, ''), tx: Number(tx), ty: Number(ty), tooltip: cur.tooltip ?? '' });
        }
        cur = {}; rows = []; inData = false;
    };
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const l = raw.trim();
        if (!l || l.startsWith('#')) continue;
        const m = /^\[(.+)\]$/.exec(l);
        if (m) { flush(); sec = m[1]; continue; }
        if (sec === 'layer' && inData) { rows.push(l.replace(/,$/, '').split(',').map(Number)); continue; }
        const eq = l.indexOf('=');
        if (eq < 0) continue;
        const k = l.slice(0, eq), v = l.slice(eq + 1);
        if (sec === 'header') hdr[k] = v;
        else if (sec === 'layer' && k === 'data') inData = true;
        else cur[k] = v;
    }
    flush();
    const [hx, hy] = (hdr.hero_pos ?? '0,0').split(',').map(Number);
    const modOpen = [...readFileSync(path, 'utf8').matchAll(/collision,(\d+),(\d+),0\b/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
    return { w: Number(hdr.width), h: Number(hdr.height), tileset: hdr.tileset ?? '', title: hdr.title ?? '', hero: { x: hx, y: hy }, layers, regions, links, modOpen };
}

const hashStr = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const makeRnd = (seed0: number) => () => { let t = (seed0 = (seed0 + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface OutZone { type: string; x: number; y: number; r: number; n: number; name: string; lvl: number; kind: 'pit' | 'loose' | 'boss'; pit?: number }

/** Tamaño máximo (en celdas) de un obstáculo suelto que se abre en los mapas abiertos, y alto máximo (px de Flare) de un objeto que queda de adorno. */
const OPEN_MAX = 12, OPEN_MAX_PVP = 6000, LOW_PROP = 90;
/** Parte de los obstáculos sueltos que se conserva y distancia mínima (celdas, Manhattan) entre dos conservados. */
const KEEP_PROPS = 0.25, KEEP_GAP = 6;
/** Mapas de PvP (pedido de Román, 4/11/2026: "más planos"): se abren grupos más grandes y se conserva menos y más separado. */
const KEEP_PROPS_PVP = 0.1, KEEP_GAP_PVP = 10;
/** Celda bloqueada (fuera de lo alcanzable). Los vecinos alcanzables ya están marcados en `seen` como vistos. */
const hardBlockOrUnreached = (reach: boolean[][], x: number, y: number): boolean => !reach[y][x];
/** Alto en px de cada pieza de la hoja (para decidir si un objeto es bajo). */
function objectHeights(tilesetRel: string): Map<number, number> {
    const out = new Map<number, number>();
    const file = ['fantasycore', 'empyrean_campaign'].map((m) => join(flare, 'mods', m, tilesetRel)).find((f) => existsSync(f));
    if (!file) return out;
    for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) if (l.startsWith('tile=')) { const a = l.slice(5).split(',').map(Number); out.set(a[0], a[4]); }
    return out;
}

function convert(spec: MapSpec): object {
    const [t0, t1] = TIERS[spec.tier];
    if (spec.lvl[0] < t0 || spec.lvl[0] > t1 || spec.lvl[0] > spec.lvl[1]) throw new Error(`${spec.id}: lvl ${spec.lvl} no cae dentro del tier ${spec.tier} (${t0}-${t1})`);
    const p = parseMap(join(mapsDir, spec.id + '.txt'));
    const tsName = /tileset_(\w+)\.txt$/.exec(p.tileset)?.[1] ?? '';
    const N = Math.max(p.w, p.h);
    const grid = (name: string): number[][] => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (y < p.h && x < p.w ? p.layers[name]?.[y]?.[x] ?? 0 : 0)));
    const background = grid('background'), object = grid('object'), collision = grid('collision');
    for (const [ox, oy, ow, oh] of spec.open ?? []) for (let y = oy; y < oy + oh; y++) for (let x = ox; x < ox + ow; x++) { collision[y][x] = 0; object[y][x] = 0; }
    if (spec.openMods) for (const [x, y] of p.modOpen) if (y < N && x < N) { collision[y][x] = 0; object[y][x] = 0; }
    // Marcadores de editor de Flare (triángulos violeta 92-95 de pasto y nieve): en Flare no se ven en el juego; acá se sacan.
    if (/tileset_(snowplains|grassland)\.txt$/.test(p.tileset)) for (const row of object) for (let x = 0; x < row.length; x++) if (row[x] >= 92 && row[x] <= 95) row[x] = 0;

    // 1) Colisión: lo que no es de Flare (relleno a cuadrado) y toda colisión != 0 bloquea. Solo se queda lo alcanzable a pie desde la entrada.
    const hardBlock = collision.map((row, y) => row.map((v, x) => y >= p.h || x >= p.w || v !== 0));
    const near = (x: number, y: number): { x: number; y: number } | undefined => {
        for (let r = 0; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const cx = x + dx, cy = y + dy;
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && cx >= 0 && cy >= 0 && cx < N && cy < N && !hardBlock[cy][cx]) return { x: cx, y: cy };
        }
        return undefined;
    };
    const entry = near(p.hero.x, p.hero.y);
    if (!entry) throw new Error(`${spec.id}: la entrada (${p.hero.x},${p.hero.y}) no tiene celdas libres cerca`);
    const reach: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const queue: [number, number][] = [[entry.x, entry.y]]; reach[entry.y][entry.x] = true;
    const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N;
    const flood = (): void => {
        for (let i = 0; i < queue.length; i++) {
            const [x, y] = queue[i];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = x + dx, ny = y + dy;
                if (inside(nx, ny) && !hardBlock[ny][nx] && !reach[ny][nx]) { reach[ny][nx] = true; queue.push([nx, ny]); }
            }
        }
    };
    flood();
    // Flare se mueve en 8 direcciones y varias zonas se unen solo por una diagonal entre dos paredes; en ERIS se camina en 4 y el
    // validador pide que todo se alcance así. Por cada cruce diagonal se abre UNA de las dos celdas (la de colisión más liviana).
    let carved = 0;
    for (let round = 0; round < 50; round++) {
        const open: [number, number][] = [];
        for (const [x, y] of [...queue]) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!inside(nx, ny) || hardBlock[ny][nx] || reach[ny][nx] || !hardBlock[y][nx] || !hardBlock[ny][x]) continue;
            const ax = nx, ay = y, bx = x, by = ny;
            const [cx, cy] = collision[ay][ax] <= collision[by][bx] ? [ax, ay] : [bx, by];
            if (cx < p.w && cy < p.h) open.push([cx, cy]);
        }
        if (!open.length) break;
        for (const [cx, cy] of open) { hardBlock[cy][cx] = false; reach[cy][cx] = true; queue.push([cx, cy]); carved++; }
        flood();
    }
    if (carved) console.log(`${spec.id}: ${carved} cruces diagonales abiertos`);

    // 1b) Mapas abiertos más amplios para el PvP (pedido de Román, 2/11/2026): los obstáculos sueltos del medio (árboles, rocas, lápidas,
    // carpas, columnas: grupos de hasta OPEN_MAX celdas bloqueadas rodeados de piso) dejan de bloquear. Los objetos bajos quedan de adorno
    // (se pasa por encima); los altos (árboles, columnas) se sacan para que no se vea a alguien atravesándolos. Las mazmorras no se tocan.
    if (!spec.dungeon) {
        const heights = objectHeights(p.tileset);
        const seen = reach.map((r) => r.slice());
        // Piso de relleno para lagunas y acantilados que se aplanan en los mapas de PvP: el piso más común de lo caminable.
        const cnt = new Map<number, number>();
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const t = background[y][x]; if (reach[y][x] && t && !isFlareWater(tsName, t) && !isFlareCliff(tsName, t)) cnt.set(t, (cnt.get(t) ?? 0) + 1); }
        const groundTile = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
        let opened = 0, removed = 0; const kept: [number, number][] = [];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (seen[y][x] || !hardBlockOrUnreached(reach, x, y)) continue;
            const isle: [number, number][] = [[x, y]]; seen[y][x] = true; let enclosed = true;
            for (let i = 0; i < isle.length; i++) {
                const [cx, cy] = isle[i];
                if (cx === 0 || cy === 0 || cx === N - 1 || cy === N - 1 || cx >= p.w || cy >= p.h || background[cy][cx] === 0) enclosed = false;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    const nx = cx + dx, ny = cy + dy;
                    if (inside(nx, ny) && !seen[ny][nx]) { seen[ny][nx] = true; isle.push([nx, ny]); }
                }
            }
            if (!enclosed || isle.length > (spec.pvp === 'faction' ? OPEN_MAX_PVP : OPEN_MAX)) continue;
            // Se conserva ~1 de cada 4 (bloqueando, como estaba) para que el mapa no pierda su identidad (las lápidas del cementerio, las
            // carpas del cañón), siempre separados entre sí: un obstáculo suelto se rodea fácil; muchos juntos son los que traban.
            const [ix, iy] = isle[0];
            if (hashStr(`${spec.id}:isla:${ix},${iy}`) / 4294967296 < (spec.keepProps ?? (spec.pvp === 'faction' ? KEEP_PROPS_PVP : KEEP_PROPS)) && !kept.some((k) => Math.abs(k[0] - ix) + Math.abs(k[1] - iy) < (spec.pvp === 'faction' ? KEEP_GAP_PVP : KEEP_GAP))) { kept.push([ix, iy]); continue; }
            for (const [cx, cy] of isle) {
                reach[cy][cx] = true; opened++;
                if (spec.pvp === 'faction' && groundTile && (isFlareWater(tsName, background[cy][cx]) || isFlareCliff(tsName, background[cy][cx]))) { background[cy][cx] = groundTile; object[cy][cx] = 0; }
                const o = object[cy][cx]; if (o && (heights.get(o) ?? 999) > LOW_PROP) { object[cy][cx] = 0; removed++; }
            }
        }
        // Pedido de Román (4/11/2026): en los mapas de PvP "todo caminable": el agua se aplana a piso (el lago grande no cuenta como obstáculo
        // suelto porque se une al borde por los acantilados). El piso se copia de una celda de piso a múltiplos de 4 (el patrón de las hojas).
        if (spec.pvp === 'faction' && groundTile) {
            // En la nieve el lago usa también los ids 166-207 (hielo y fondo oscuro: están en el rango de acantilados).
            const isWater = (t: number): boolean => isFlareWater(tsName, t) || (tsName === 'snowplains' && t >= 144 && t <= 207);
            const isGround = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.w && y < p.h && !!background[y][x] && !isWater(background[y][x]) && !isFlareCliff(tsName, background[y][x]) && reach[y][x];
            const todo: [number, number][] = [];
            for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (background[y][x] && (isWater(background[y][x]) || isFlareCliff(tsName, background[y][x]))) todo.push([x, y]);
            const nuevo = todo.map(([x, y]) => {
                for (let k = 1; k < 40; k++) for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) if (isGround(x + dx * k, y + dy * k)) return background[y + dy * k][x + dx * k];
                return groundTile;
            });
            todo.forEach(([x, y], i) => { background[y][x] = nuevo[i]; object[y][x] = 0; reach[y][x] = true; });
            if (todo.length) console.log(`${spec.id}: ${todo.length} celdas de agua y acantilado aplanadas`);
        }
        // Murallas finas (lomas, bordes de acantilado, vallas de piedra) abiertas en los mapas de PvP: un obstáculo es "grueso" si tiene un
        // bloque de 5x5 bloqueado; lo grueso (edificios, macizos) queda y todo lo bloqueado a más de 3 celdas de lo grueso se abre y se limpia.
        if (spec.pvp === 'faction') {
            const blk = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.w && y < p.h && background[y][x] !== 0 && !reach[y][x];
            const fat: [number, number][] = [];
            for (let y = 2; y < p.h - 2; y++) for (let x = 2; x < p.w - 2; x++) { let all = true; for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!blk(x + dx, y + dy)) { all = false; break; } if (all) fat.push([x, y]); }
            const keep = new Set<number>(); for (const [x, y] of fat) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) keep.add((y + dy) * N + x + dx);
            let thin = 0;
            for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (blk(x, y) && !keep.has(y * N + x)) { reach[y][x] = true; object[y][x] = 0; thin++; }
            if (thin) console.log(`${spec.id}: ${thin} celdas de murallas finas abiertas`);
        }
        if (opened) console.log(`${spec.id}: ${opened} celdas de obstáculos sueltos abiertas (${removed} objetos altos sacados, ${kept.length} obstáculos conservados)`);
    }
    const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && reach[y][x];
    let walkable = 0; for (const r of reach) for (const v of r) if (v) walkable++;
    const snap = (x: number, y: number): { x: number; y: number } | undefined => {
        for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        return undefined;
    };

    // Ensanchado de pasillos (spec.widen): todo lo que está a menos de `widen` celdas de lo caminable se abre: el piso reemplaza las paredes y el
    // negro de entre medio, y se limpian los objetos (paredes sueltas, rocas). Las paredes del tope del cuadrado quedan.
    if (spec.widen) {
        const W = spec.widen; const cnt2 = new Map<number, number>();
        for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const t = background[y][x]; if (reach[y][x] && t && !isFlareCliff(tsName, t) && !isFlareWater(tsName, t)) cnt2.set(t, (cnt2.get(t) ?? 0) + 1); }
        const gt = [...cnt2.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 0;
        // solo piso liso: se descartan las piezas de borde y rincón (poco frecuentes), que dejan triángulos oscuros
        { const mx = Math.max(0, ...cnt2.values()); for (const [t, n] of [...cnt2]) if (n < mx * 0.25 || t < 16 || t > 31) cnt2.delete(t); }
        const nuevo: [number, number][] = [];
        for (let y = 2; y < p.h - 2; y++) for (let x = 2; x < p.w - 2; x++) {
            if (reach[y][x]) continue;
            let near = false;
            for (let dy = -W; dy <= W && !near; dy++) for (let dx = -W; dx <= W; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < N && ny < N && reach[ny][nx]) { near = true; break; } }
            if (near) nuevo.push([x, y]);
        }
        for (const [x, y] of nuevo) {
            const t = background[y][x];
            if (t === 0 || isFlareCliff(tsName, t) || isFlareWater(tsName, t)) {
                // piso copiado de una celda de piso a múltiplos de 4 (el patrón de la hoja); si no hay, el piso más común
                let f = gt;
                const ok = (cx: number, cy: number): boolean => cx >= 0 && cy >= 0 && cx < p.w && cy < p.h && reach[cy][cx] && !!background[cy][cx] && !isFlareCliff(tsName, background[cy][cx]) && !isFlareWater(tsName, background[cy][cx]) && cnt2.has(background[cy][cx]);
                search: for (let kk = 1; kk < 30; kk++) for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) if (ok(x + dx * kk, y + dy * kk)) { f = background[y + dy * kk][x + dx * kk]; break search; }
                background[y][x] = f;
            }
            object[y][x] = 0;
        }
        for (const [x, y] of nuevo) reach[y][x] = true;
        // Piezas sueltas de borde (la 56 y la 57 de la cueva son medios rombos): dentro de lo caminable no pueden quedar, dejan triángulos negros.
        for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (reach[y][x] && background[y][x] && !cnt2.has(background[y][x]) && background[y][x] < 900 && !object[y][x]) {
            let f = gt;
            search2: for (let kk = 1; kk < 30; kk++) for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) { const cx = x + dx * kk, cy = y + dy * kk; if (cx >= 0 && cy >= 0 && cx < p.w && cy < p.h && reach[cy][cx] && cnt2.has(background[cy][cx])) { f = background[cy][cx]; break search2; } }
            background[y][x] = f;
        }
        console.log(`${spec.id}: ${nuevo.length} celdas ganadas al ensanchar los pasillos (${W} a cada lado)`);
    }
    // 2) Sin partes negras: el vacío de Flare (fuera de la isla, en los pozos y en el relleno a cuadrado) se rellena con el piso de la hoja
    // y objetos que lo cubren. Esas celdas ya están bloqueadas (no se pueden pisar).
    const fill = FILLS[tsName];
    if (fill) {
        // distancia (en celdas, contando diagonales) de cada celda de vacío al mapa de Flare: decide la banda de sombra
        const far: number[][] = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (background[y][x] !== 0 ? 0 : Infinity)));
        const q: [number, number][] = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (far[y][x] === 0) q.push([x, y]);
        for (let i = 0; i < q.length; i++) {
            const [cx, cy] = q[i];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx >= 0 && ny >= 0 && nx < N && ny < N && far[ny][nx] === Infinity) { far[ny][nx] = far[cy][cx] + 1; q.push([nx, ny]); } }
        }
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (background[y][x] !== 0) continue;
            const r = (k: number) => hashStr(`${spec.id}:${x},${y},${k}`) / 4294967296;
            // el piso va siempre (también bajo los acantilados, que tienen la cara de atrás transparente); los objetos, solo en celdas vacías
            const f = fill.floor[Math.floor(r(0) * fill.floor.length)];
            background[y][x] = fill.shade ? shadeId(tsName, f, far[y][x] - 1) : f;
            if (object[y][x] !== 0 || (fill.shade && far[y][x] > 1)) continue;
            // En los mapas de PvP el relleno es caminable (abajo): solo ~40 % de los objetos de siempre, así el mapa no se siente chico.
            const roll = spec.pvp === 'faction' && !fill.shade ? r(1) / 0.4 : r(1), band = fill.deco.find(([t]) => roll < t);
            if (band) object[y][x] = band[1][Math.floor(r(2) * band[1].length)];
        }
        // Pedido de Román (4/11/2026): "como mucho 2 filas" de árboles: en los mapas de PvP los árboles solo quedan en las 2 filas del borde del
        // cuadrado; los de adentro (los del mapa de Flare y los del relleno) se sacan y esas celdas se caminan (el mapa se siente más grande).
        if (spec.pvp === 'faction' && !fill.shade) {
            const TREES = new Set(tsName === 'snowplains' ? [244, 245, 246, 247] : [240, 241, 242, 243, 248, 249, 250, 251, 252, 253, 254, 255]);
            // Algunos árboles sueltos por el medio, muy separados entre sí (no estorban el PvP): ~1 de cada 12 y a 10+ celdas uno de otro.
            let cut = 0; const solos: [number, number][] = [];
            for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (TREES.has(object[y][x]) && Math.min(x, y, N - 1 - x, N - 1 - y) >= 2) {
                if (hashStr(`${spec.id}:solo:${x},${y}`) / 4294967296 < 1 / 12 && !solos.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 10)) { solos.push([x, y]); continue; }
                object[y][x] = 0; if (background[y][x] !== 0) reach[y][x] = true; cut++;
            }
            // 5 árboles más por el medio (pedido de Román): en celdas libres, a 10+ de los otros y lejos de la entrada y del borde.
            const arboles = tsName === 'snowplains' ? [244, 245, 246, 247] : [248, 249, 250, 251, 252, 253, 254, 255];
            const rr = makeRnd(hashStr(`${spec.id}:cinco`)); let puestos = 0;
            for (let t = 0; t < 4000 && puestos < 5; t++) {
                const x = 6 + Math.floor(rr() * (N - 12)), y = 6 + Math.floor(rr() * (N - 12));
                if (!reach[y][x] || object[y][x] !== 0 || dist({ x, y }, entry) < 14 || solos.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 10)) continue;
                object[y][x] = arboles[Math.floor(rr() * arboles.length)]; reach[y][x] = false; solos.push([x, y]); puestos++;
            }
            if (cut) console.log(`${spec.id}: ${cut} árboles de adentro sacados (quedan 2 filas en el borde)`);
        }
        // Los restos de acantilado (piezas rojizas de 48-71 en la capa de objetos: bordes de roca sueltos sobre el pasto) se sacan en los mapas de PvP.
        if (spec.pvp === 'faction' && !fill.shade) {
            let rocas = 0; const TOCONES = new Set(tsName === 'snowplains' ? [112, 113, 124, 125, 126, 127, 128, 129, 130, 131, 136] : [112, 113, 124, 125, 126, 127]); // tocones, troncos y piedritas rojizas del relleno
            for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (object[y][x] && (isFlareCliff(tsName, object[y][x]) || TOCONES.has(object[y][x]))) { object[y][x] = 0; rocas++; }
            if (rocas) console.log(`${spec.id}: ${rocas} restos de acantilado, tocones y piedritas sacados`);
        }
        // Pedido de Román (4/11/2026): "queda muy chico el mapa". En los mapas de PvP el relleno se camina (menos los pocos árboles): el
        // piso jugable llega hasta el borde del cuadrado. Solo lo que se alcanza desde lo ya caminable (sin bolsillos sueltos).
        if (spec.pvp === 'faction' && !fill.shade) {
            const q2: [number, number][] = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (reach[y][x]) q2.push([x, y]);
            let extra = 0;
            for (let i = 0; i < q2.length; i++) {
                const [cx, cy] = q2[i];
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= N || ny >= N || reach[ny][nx] || far[ny][nx] === 0 || object[ny][nx] !== 0) continue;
                    reach[ny][nx] = true; extra++; q2.push([nx, ny]);
                }
            }
            walkable += extra;
            if (extra) console.log(`${spec.id}: ${extra} celdas del relleno ahora se caminan`);
        }
    } else console.warn(`${spec.id}: tileset '${tsName}' sin relleno definido: el vacío queda negro`);

    // Lo que se abrió para el PvP no puede dejar bolsillos sueltos: solo queda caminable lo que se alcanza a pie desde la entrada.
    if (spec.pvp === 'faction' && entry) {
        const ok: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)); const qq: [number, number][] = [[entry.x, entry.y]]; ok[entry.y][entry.x] = true;
        for (let i = 0; i < qq.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = qq[i][0] + dx, ny = qq[i][1] + dy; if (nx >= 0 && ny >= 0 && nx < N && ny < N && reach[ny][nx] && !ok[ny][nx]) { ok[ny][nx] = true; qq.push([nx, ny]); } }
        let lost = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (reach[y][x] && !ok[y][x]) { reach[y][x] = false; lost++; }
        walkable = 0; for (const r of reach) for (const v of r) if (v) walkable++;
        if (lost) console.log(`${spec.id}: ${lost} celdas sueltas (sin camino desde la entrada) vueltas a bloquear`);
    }
    // Variedad en los mapas ensanchados (pedido de Román: "piedras distintas, estructuras, que ocupe todo pero que no jodan al PvP"):
    // hongos, montones de piedra, vagonetas, cajas y barriles bajos sin colisión; estalagmitas y monolitos altos que sí bloquean pero
    // solos y separados (9+ celdas); y círculos de piedra (264/265) chatos en el piso como puntos de encuentro, sin colisión.
    if (spec.widen && spec.pvp === 'faction' && tsName === 'cave') {
        const rv = makeRnd(hashStr(`${spec.id}:variedad`)); const pick = (arr: number[], _k: string): number => arr[Math.floor(rv() * arr.length)];
        const hongos = [132, 133, 134, 135], piedras = [150, 151, 152], cosas = [128, 129, 130, 131, 162, 163, 179, 160, 161], altos = [144, 145, 146, 147, 148, 149, 153];
        const altas: [number, number][] = [], circulos: [number, number][] = [];
        for (let y = 5; y < N - 5; y++) for (let x = 5; x < N - 5; x++) {
            if (!reach[y][x] || object[y][x] !== 0 || dist({ x, y }, entry) < 10) continue;
            const r = rv();
            if (r < 0.0035 && !altas.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 9)) { object[y][x] = pick(altos, `${spec.id}:v2:${x},${y}`); reach[y][x] = false; altas.push([x, y]); }
            else if (r > 0.9 && r < 0.925) object[y][x] = pick(hongos, `${spec.id}:v3:${x},${y}`);
            else if (r > 0.925 && r < 0.955) object[y][x] = pick(piedras, `${spec.id}:v4:${x},${y}`);
            else if (r > 0.955 && r < 0.962) object[y][x] = pick(cosas, `${spec.id}:v5:${x},${y}`);
            else if (r > 0.9985 && circulos.length < 3 && !circulos.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 30) && !altas.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 6)) { object[y][x] = circulos.length % 2 ? 265 : 264; circulos.push([x, y]); }
        }
    }
    // Variedad en los mapas de nieve (pedido de Román): cajas, barriles, leña, tocones, arbustos, cruces y carteles bajos sin colisión
    // (~1,6 % del piso) y unos monolitos de piedra altos que sí bloquean pero solos y separados (14+ celdas).
    if (spec.pvp === 'faction' && !spec.dungeon && tsName === 'snowplains') {
        const rv2 = makeRnd(hashStr(`${spec.id}:variedad-nieve`)); const pk = (a: number[]): number => a[Math.floor(rv2() * a.length)];
        const bajos = [112, 113, 100, 101, 96, 98, 136, 137, 140, 141, 142, 143, 138, 139], monolitos = [133, 134]; const mono: [number, number][] = [];
        for (let y = 5; y < N - 5; y++) for (let x = 5; x < N - 5; x++) {
            if (!reach[y][x] || object[y][x] !== 0 || dist({ x, y }, entry) < 10) continue;
            const r = rv2();
            if (r < 0.0012 && !mono.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 14)) { object[y][x] = pk(monolitos); reach[y][x] = false; mono.push([x, y]); }
            else if (r > 0.97 && r < 0.986) object[y][x] = pk(bajos);
        }
    }
    // Un par de tocones de adorno por el medio (pedido de Román): bajos y sin colisión, no estorban el PvP; separados 12+ celdas.
    if (spec.pvp === 'faction' && !spec.dungeon && FILLS[tsName] && !FILLS[tsName].shade) {
        const rt = makeRnd(hashStr(`${spec.id}:tocones`)); const tocs: [number, number][] = [];
        for (let t = 0; t < 4000 && tocs.length < 4; t++) {
            const x = 6 + Math.floor(rt() * (N - 12)), y = 6 + Math.floor(rt() * (N - 12));
            if (!reach[y][x] || object[y][x] !== 0 || dist({ x, y }, entry) < 12 || tocs.some((k) => Math.max(Math.abs(k[0] - x), Math.abs(k[1] - y)) < 12)) continue;
            object[y][x] = rt() < 0.5 ? 112 : 113; tocs.push([x, y]);
        }
    }
    // 3) Regiones de spawn de Flare -> centros caminables.
    const cells = p.regions.flatMap((r) => { const c = snap(Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)); if (!c) return []; const rad = clamp(Math.round(Math.max(r.w, r.h) / 2), 4, 12); return [{ ...c, r: rad, n: clamp(Math.round((rad * rad) / 10), 3, 10) }]; });

    // 4) 3 pits: k-means determinista con semillas separadas (cerca de la entrada, lejos de la entrada y lo más lejos de ambas).
    const k = Math.min(3, cells.length);
    const byEntry = [...cells].sort((a, b) => dist(a, entry) - dist(b, entry));
    const seeds = [byEntry[0], byEntry[byEntry.length - 1]];
    if (k === 3) seeds.push([...cells].sort((a, b) => Math.min(dist(b, seeds[0]), dist(b, seeds[1])) - Math.min(dist(a, seeds[0]), dist(a, seeds[1])))[0]);
    let centers = seeds.slice(0, k).map((c) => ({ x: c.x, y: c.y }));
    let label = cells.map(() => 0);
    const recenter = () => { centers = centers.map((m, i) => { const mine = cells.filter((_, j) => label[j] === i); return mine.length ? { x: mine.reduce((s, c) => s + c.x, 0) / mine.length, y: mine.reduce((s, c) => s + c.y, 0) / mine.length } : m; }); };
    for (let it = 0; it < 20; it++) { label = cells.map((c) => centers.reduce((best, m, i) => (dist(c, m) < dist(c, centers[best]) ? i : best), 0)); recenter(); }
    // Rebalance: ningún pit queda con menos de ~1/3 de las zonas (mueve la zona más cercana desde el pit más grande).
    const minSize = Math.max(1, Math.floor(cells.length / 3) - 1);
    for (let guard = 0; guard < cells.length; guard++) {
        const sizes = centers.map((_, i) => label.filter((l) => l === i).length);
        const small = sizes.indexOf(Math.min(...sizes)), big = sizes.indexOf(Math.max(...sizes));
        if (sizes[small] >= minSize || small === big) break;
        const cand = cells.map((c, j) => ({ j, d: dist(c, centers[small]) })).filter((o) => label[o.j] === big).sort((a, b) => a.d - b.d)[0];
        label[cand.j] = small; recenter();
    }
    const order = centers.map((_, i) => i).sort((a, b) => dist(centers[a], entry) - dist(centers[b], entry)); // A (cerca) -> C (lejos)
    const zones: OutZone[] = [];
    cells.forEach((c, j) => { const pit = order.indexOf(label[j]), s = spec.pits[pit]; zones.push({ type: s.type, x: c.x, y: c.y, r: c.r, n: c.n, name: s.name, lvl: pitLevel(spec.lvl, pit), kind: 'pit', pit }); });

    // 5) Mobs sueltos: zonas chicas repartidas por todo el mapa entre los pits y lejos de la entrada (1 cada ~250 celdas caminables).
    const rnd = makeRnd(hashStr(spec.id));
    const want = clamp(Math.round(walkable / 250), 3, 18), loose: OutZone[] = [];
    for (let tries = 0; tries < 8000 && loose.length < want; tries++) {
        const c = { x: Math.floor(rnd() * N), y: Math.floor(rnd() * N) };
        if (!free(c.x, c.y) || dist(c, entry) < 12) continue;
        if (zones.some((z) => dist(z, c) < z.r + 6) || loose.some((z) => dist(z, c) < 13)) continue;
        const s = spec.loose[loose.length % spec.loose.length];
        loose.push({ type: s.type, x: c.x, y: c.y, r: 5, n: 2, name: `Merodeadores de ${spec.name}`, lvl: pitLevel(spec.lvl), kind: 'loose' });
    }
    zones.push(...loose);
    // Pedido de Román (4/11/2026): las zonas de caza no pueden quedar metidas en el bosque (no se puede entrar y los mobs no se ven) ni en el
    // borde del mapa. En los mapas de PvP cada zona se muda al lugar más despejado cerca (sin árboles ni paredes en su disco); si no hay,
    // se saca (los pits siempre conservan al menos una zona).
    if (spec.pvp === 'faction' && !spec.dungeon) {
        const clearAt = (cx: number, cy: number, r: number): number => {
            let tot = 0, ok = 0;
            for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { if (Math.hypot(x - cx, y - cy) > r) continue; tot++; if (x > 1 && y > 1 && x < N - 2 && y < N - 2 && reach[y][x] && object[y][x] === 0) ok++; }
            return ok / tot;
        };
        let moved = 0, dropped = 0;
        for (let i = zones.length - 1; i >= 0; i--) {
            const z = zones[i]; if (z.kind === 'boss') continue;
            // sin zonas encimadas: el centro de otra zona no puede caer a menos de ~85 % de la suma de radios
            const crowd = (x: number, y: number): boolean => zones.some((o, j) => j !== i && dist(o, { x, y }) < (o.r + z.r) * 0.85);
            let best = { x: z.x, y: z.y, s: crowd(z.x, z.y) ? -1 : clearAt(z.x, z.y, z.r) };
            if (best.s < 0.8) for (let dy = -16; dy <= 16; dy++) for (let dx = -16; dx <= 16; dx++) {
                const x = z.x + dx, y = z.y + dy; if (!free(x, y) || dist({ x, y }, entry) < 8 || crowd(x, y)) continue;
                const sc = clearAt(x, y, z.r) - Math.hypot(dx, dy) * 0.004;
                if (sc > best.s) best = { x, y, s: sc };
            }
            if (best.s < 0.88) {
                const mates = zones.filter((o, j) => j !== i && o.kind === z.kind && (z.kind === 'loose' || o.pit === z.pit)).length;
                if (mates > 0) { zones.splice(i, 1); dropped++; continue; }
            }
            if (best.x !== z.x || best.y !== z.y) { z.x = best.x; z.y = best.y; moved++; }
        }
        // dos zonas encimadas (el centro de una cae dentro de la otra) no tienen sentido: se saca la más chica si el pit tiene más
        if (moved || dropped) console.log(`${spec.id}: ${moved} zonas movidas a lugar despejado, ${dropped} sacadas`);
    }
    for (const z of zones) if (!knownMobs.has(z.type)) throw new Error(`${spec.id}: tipo de mob desconocido "${z.type}" (agregalo a MOB_TYPES o cambialo en SPECS)`);

    // 6) Vínculos de Flare: la celda disparadora es la libre más cercana al centro de su rectángulo.
    const links = p.links.filter((l) => !spec.dropLinks?.includes(l.to) && !spec.skipLinks?.some(([m, x, y]) => m === l.to && x === l.tx && y === l.ty)).flatMap((l) => { const c = snap(Math.floor(l.x + l.w / 2), Math.floor(l.y + l.h / 2)); return c ? [{ cell: c, to: l.to, tx: l.tx, ty: l.ty, tooltip: l.tooltip, ...(spec.linkGates?.[l.to] ? { gate: spec.linkGates[l.to] } : {}) }] : []; });

    // 7) Conexiones extra: celda caminable con espacio alrededor, lejos de la entrada (far) o a unos pasos de ella (near), separadas de todo lo demás.
    const taken: { x: number; y: number }[] = [entry, ...links.map((l) => l.cell)];
    const roomy = (x: number, y: number): boolean => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (free(x + dx, y + dy)) n++; return n >= 8; };
    const cand: { x: number; y: number }[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (free(x, y) && roomy(x, y)) cand.push({ x, y });
    const extras = (spec.extras ?? []).map((e) => {
        const pool = cand.filter((c) => taken.every((t) => dist(t, c) >= 9) && (e.where === 'far' || (dist(c, entry) >= 5 && dist(c, entry) <= 12)));
        const best = e.where === 'far' ? pool.sort((a, b) => dist(b, entry) - dist(a, entry) || a.y - b.y || a.x - b.x)[0] : pool.sort((a, b) => dist(a, entry) - dist(b, entry) || a.y - b.y || a.x - b.x)[0];
        if (!best) throw new Error(`${spec.id}: no encontré celda para la conexión a ${e.to}`);
        taken.push(best); return { to: e.to, cell: best, kind: e.kind ?? 'portal', ...(e.gate ? { gate: e.gate } : {}) };
    });
    // 8) Jefe final: una zona de 1 mob en el punto caminable con espacio más lejos de la entrada y de todas las conexiones.
    if (spec.boss) {
        const b = cand.filter((c) => taken.every((t) => dist(t, c) >= 15)).sort((a, c) => Math.min(...taken.map((t) => dist(c, t))) - Math.min(...taken.map((t) => dist(a, t))) || a.y - c.y || a.x - c.x)[0];
        if (!b) throw new Error(`${spec.id}: no encontré lugar para el jefe`);
        if (spec.bossClear) for (let i = zones.length - 1; i >= 0; i--) if (dist(zones[i], b) < spec.bossClear) zones.splice(i, 1);
        zones.push({ type: spec.boss.type, x: b.x, y: b.y, r: 6, n: 1, name: spec.boss.name, lvl: spec.lvl[1], kind: 'boss' });
        if (!knownMobs.has(spec.boss.type)) throw new Error(`${spec.id}: tipo de jefe desconocido "${spec.boss.type}"`);
    }

    return {
        id: spec.id, eris: spec.eris, name: spec.name, region: spec.region, pvp: spec.pvp, lvl: spec.lvl, tier: spec.tier, ...(spec.dungeon ? { dungeon: true } : {}), ...(spec.respawnMap ? { respawnMap: spec.respawnMap } : {}), tileset: tsName, size: N, flareSize: [p.w, p.h], entry,
        source: `Flare (flare-game) mods/empyrean_campaign/maps/${spec.id}.txt`, license: 'CC-BY-SA-3.0 (adaptado: ver docs/MAPAS_FLARE.md)',
        walkable, zones, links, extras, layers: { background, object }, blocked: reach.map((r) => r.map((v) => (v ? 0 : 1))),
    };
}

if (!existsSync(mapsDir)) { console.error(`No encontré los mapas de Flare en ${mapsDir}. Apuntá FLARE_DIR a flare-game o al zip v1.14.`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const wanted = process.argv.slice(2);
for (const spec of SPECS.filter((s) => !wanted.length || wanted.includes(s.id))) {
    const out = convert(spec) as { size: number; walkable: number; zones: OutZone[]; links: unknown[]; extras: unknown[] };
    const header = `/**\n * Generado por tools/src/flare/maps.ts a partir del mapa '${spec.id}' de Flare (CC-BY-SA 3.0; autores en CREDITS.txt de Flare).\n * Adaptado para ERIS (relleno del vacío, pits, mobs sueltos). No editar a mano: se regenera con pnpm --filter @fdn/tools flare:maps.\n */\n`;
    writeFileSync(join(outDir, spec.id + '.ts'), `${header}import type { FlareMapData } from './types';\n\nexport const DATA: FlareMapData = ${JSON.stringify(out)};\n`);
    rmSync(join(outDir, spec.id + '.json'), { force: true });
    const pits = [0, 1, 2].map((i) => out.zones.filter((z) => z.pit === i).length), loose = out.zones.filter((z) => z.kind === 'loose').length;
    console.log(`${spec.id} -> ${spec.eris}: ${out.size}x${out.size}, ${out.walkable} celdas caminables, pits A/B/C = ${pits.join('/')} zonas, ${loose} sueltas, ${out.links.length} vínculos + ${out.extras.length} extra`);
}
