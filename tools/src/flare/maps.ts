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
}

/** Un mapa por entrada. Pit A = el más cerca de la entrada (el más fácil), C = el más lejos. Los nombres de zona son únicos entre mapas. */
const SPECS: MapSpec[] = [
    { id: 'salted_field', eris: 'campos_de_sal', name: 'Campos de Sal', region: 'comun', pvp: 'off', lvl: [1, 2], tier: 1, dropLinks: ['perdition_mines'],
        pits: [{ name: 'Puesto goblin', type: 'goblin' }, { name: 'Charco de zombis', type: 'zombie' }, { name: 'Avanzada del campo', type: 'goblin_elite' }],
        loose: [{ type: 'goblin' }] },
    { id: 'stonewood', eris: 'bosque_de_piedra', name: 'Bosque de Piedra', region: 'comun', pvp: 'off', lvl: [2, 3], tier: 1,
        pits: [{ name: 'Claro de los goblins', type: 'goblin' }, { name: 'Madriguera hobgoblin', type: 'hobgoblin' }, { name: 'Fuerte del bosque', type: 'goblin_elite' }],
        loose: [{ type: 'goblin' }, { type: 'zombie' }] },
    { id: 'goblin_camp', eris: 'canon_goblin', name: 'Cañón goblin', region: 'comun', pvp: 'faction', lvl: [3, 5], tier: 1, linkGates: { goblin_cave: 2 },
        pits: [{ name: 'Empalizada del cañón', type: 'goblin_elite' }, { name: 'Puesto de arqueros', type: 'hobgoblin_archer' }, { name: 'Tienda del cabecilla', type: 'hobgoblin' }],
        loose: [{ type: 'goblin' }] },
    // D1 (T1): Cueva y minas goblin (2 pisos de cueva, Nv 3-5, jefe final en las minas). La entrada es la del Cañón goblin (Nv 2).
    { id: 'goblin_cave', eris: 'cueva_goblin', name: 'Cueva goblin', region: 'mazmorra', pvp: 'off', lvl: [3, 4], tier: 1, dungeon: true,
        pits: [{ name: 'Guardia de la cueva', type: 'goblin' }, { name: 'Hobgoblins de la gruta', type: 'hobgoblin' }, { name: 'Arqueros del túnel', type: 'hobgoblin_archer' }],
        loose: [{ type: 'goblin_elite' }], extras: [{ to: 'minas_goblin', where: 'far' }] },
    { id: 'perdition_mines', eris: 'minas_goblin', name: 'Minas goblin', region: 'mazmorra', pvp: 'off', lvl: [4, 5], tier: 1, dungeon: true, respawnMap: 'cueva_goblin', dropLinks: ['salted_field'],
        pits: [{ name: 'Picadores goblin', type: 'goblin_elite' }, { name: 'Capataces hobgoblin', type: 'hobgoblin' }, { name: 'Ballesteros de las minas', type: 'hobgoblin_archer' }],
        loose: [{ type: 'goblin_elite' }], boss: { type: 'goblin_jefe', name: 'Sala del Jefe goblin' }, extras: [{ to: 'cueva_goblin', where: 'near' }] },
    // D2 (T2): Nido de hormiga león (2 pisos, Nv 8-10, jefe: la Reina en las ruinas). La entrada es una puerta de las Altas de Nazia (Nv 4).
    { id: 'antlion_nest', eris: 'nido_hormiga_leon', name: 'Nido de hormiga león', region: 'mazmorra', pvp: 'off', lvl: [8, 9], tier: 2, dungeon: true,
        pits: [{ name: 'Criadero', type: 'antlion_small' }, { name: 'Cámara de las hormigas', type: 'antlion' }, { name: 'Brasas del nido', type: 'fire_ant' }],
        loose: [{ type: 'antlion' }], extras: [{ to: 'ruinas_de_stormrock', where: 'far' }, { to: 'altas_de_nazia', where: 'near' }], dropLinks: ['temple_of_mez_1', 'the_breach'] },
    { id: 'stormrock_ruins', eris: 'ruinas_de_stormrock', name: 'Ruinas de Stormrock', region: 'mazmorra', pvp: 'off', lvl: [9, 10], tier: 2, dungeon: true, respawnMap: 'nido_hormiga_leon',
        pits: [{ name: 'Galerías infestadas', type: 'antlion' }, { name: 'Salón de las brasas', type: 'fire_ant' }, { name: 'Guardia no-muerta', type: 'skeleton_archer' }],
        loose: [{ type: 'zombie_dark' }], boss: { type: 'antlion_reina', name: 'Cámara de la Reina' }, dropLinks: ['stormrock_pass'], open: [[47, 68, 2, 2], [43, 69, 1, 1]], extras: [{ to: 'nido_hormiga_leon', where: 'near' }] },
    // D3 (T3): Cripta olvidada (2 pisos, Nv 13-15, jefe: el Caballero de la cripta). La entrada es una puerta del Cementerio de Lochport (Nv 9).
    { id: 'st_maria_2', eris: 'cripta_olvidada', name: 'Cripta olvidada', region: 'mazmorra', pvp: 'off', lvl: [13, 14], tier: 3, dungeon: true,
        pits: [{ name: 'Nichos de huesos', type: 'skeleton' }, { name: 'Sepultureros', type: 'zombie_dark' }, { name: 'Arqueros de la cripta', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton_mage' }], extras: [{ to: 'cementerio_de_lochport', where: 'near' }], open: [[27, 50, 2, 2], [45, 44, 2, 7]] },
    { id: 'st_maria_3', eris: 'sepulcro_profundo', name: 'Sepulcro profundo', region: 'mazmorra', pvp: 'off', lvl: [14, 15], tier: 3, dungeon: true, respawnMap: 'cripta_olvidada',
        pits: [{ name: 'Hechiceros del sepulcro', type: 'skeleton_mage' }, { name: 'Tumbas malditas', type: 'cursed_grave' }, { name: 'Guardia muerta', type: 'zombie' }],
        loose: [{ type: 'skeleton' }], boss: { type: 'caballero_cripta', name: 'Cámara del Caballero' } },
    // D4 (T4): Torre del hechicero (2 pisos, Nv 18-20, jefe: el Mago mayor). La entrada es una puerta de La Brecha (Nv 14); los interruptores y puertas trabadas de Flare quedan abiertos.
    { id: 'wizards_tower_1', eris: 'torre_del_hechicero', name: 'Torre del hechicero', region: 'mazmorra', pvp: 'off', lvl: [18, 19], tier: 4, dungeon: true,
        pits: [{ name: 'Aprendices caídos', type: 'skeleton_mage' }, { name: 'Siervos de la torre', type: 'zombie_dark' }, { name: 'Vigías arcanos', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'la_brecha', where: 'near' }], open: [[39, 57, 2, 2], [39, 37, 2, 2], [59, 61, 2, 2], [77, 47, 2, 2], [59, 35, 2, 2]] },
    { id: 'wizards_tower_2', eris: 'camaras_de_investigacion', name: 'Cámaras de investigación', region: 'mazmorra', pvp: 'off', lvl: [19, 20], tier: 4, dungeon: true, respawnMap: 'torre_del_hechicero',
        pits: [{ name: 'Salamandras invocadas', type: 'wyvern_fire' }, { name: 'Hechiceros del laboratorio', type: 'skeleton_mage' }, { name: 'Tumbas arcanas', type: 'cursed_grave' }],
        loose: [{ type: 'zombie_dark' }], boss: { type: 'mago_mayor', name: 'Sala del Mago mayor' }, dropLinks: ['underworld'], open: [[35, 23, 2, 2]] },
    // D5 (T5): Templo de Mez (2 pisos, Nv 23-25, jefe: el Wyvern del aire). La entrada es una puerta de Cenizas II (Nv 19); interruptores y puertas trabadas abiertos.
    { id: 'temple_of_mez_1', eris: 'templo_de_mez', name: 'Templo de Mez', region: 'mazmorra', pvp: 'off', lvl: [23, 24], tier: 5, dungeon: true, dropLinks: ['antlion_nest'],
        pits: [{ name: 'Nidos de wyvern', type: 'wyvern' }, { name: 'Cámara helada', type: 'wyvern_ice' }, { name: 'Guardia del sótano', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'cenizas_ii', where: 'far' }], open: [[29, 13, 2, 2], [41, 39, 2, 2]] },
    { id: 'temple_of_mez_2', eris: 'salon_de_mez', name: 'Salón principal de Mez', region: 'mazmorra', pvp: 'off', lvl: [24, 25], tier: 5, dungeon: true, respawnMap: 'templo_de_mez',
        pits: [{ name: 'Corredor del aire', type: 'wyvern' }, { name: 'Forja de Mez', type: 'wyvern_fire' }, { name: 'Hechiceros del templo', type: 'skeleton_mage' }],
        loose: [{ type: 'skeleton' }], boss: { type: 'wyvern_aire', name: 'Trono del Wyvern del aire' }, open: [[45, 39, 2, 2], [66, 29, 2, 2], [45, 81, 2, 2]] },
    // D6 (T6): Fortaleza infernal y Foso del demonio (2 pisos, Nv 28-30, jefe: el Señor del Foso). La entrada es una puerta de Cenizas III (Nv 24); Flare no los une (usa el cuartel), así que van por una puerta propia.
    { id: 'underworld_stronghold_1', eris: 'fortaleza_infernal', name: 'Fortaleza infernal', region: 'mazmorra', pvp: 'off', lvl: [28, 29], tier: 6, dungeon: true,
        pits: [{ name: 'Brasas del cuartel', type: 'wyvern_fire' }, { name: 'Centinelas hechiceros', type: 'skeleton_mage' }, { name: 'Arqueros infernales', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'foso_del_demonio', where: 'far' }, { to: 'cenizas_iii', where: 'near' }], open: [[27, 31, 2, 2], [21, 25, 2, 2]], dropLinks: ['underworld_mines'] },
    { id: 'the_pit', eris: 'foso_del_demonio', name: 'Foso del demonio', region: 'mazmorra', pvp: 'off', lvl: [29, 30], tier: 6, dungeon: true, respawnMap: 'fortaleza_infernal',
        pits: [{ name: 'Fosa de brasas', type: 'fire_ant' }, { name: 'Cuevas de fuego', type: 'wyvern_fire' }, { name: 'Condenados', type: 'zombie_dark' }],
        loose: [{ type: 'skeleton_mage' }], boss: { type: 'demonio_foso', name: 'Trono del Señor del Foso' }, extras: [{ to: 'fortaleza_infernal', where: 'near' }] },
    // Mapas abiertos de T4-T6 (la cadena de abajo de La Brecha): el Paso de Stormrock (nieve; Flare lo une a La Brecha por 4 caminos) y las Cenizas I-III (cuevas, la zona de abajo de Flare).
    { id: 'stormrock_pass', eris: 'paso_de_stormrock', name: 'Paso de Stormrock', region: 'comun', pvp: 'faction', lvl: [18, 20], tier: 4, dropLinks: ['stormrock_ruins'], skipLinks: [['the_breach', 23, 14], ['the_breach', 76, 41]],
        pits: [{ name: 'Riscos de wyvern', type: 'wyvern' }, { name: 'Hormigueros helados', type: 'ice_ant' }, { name: 'Cumbre helada', type: 'wyvern_ice' }],
        loose: [{ type: 'skeleton_archer' }], extras: [{ to: 'cenizas_i', where: 'far' }] },
    { id: 'underworld', eris: 'cenizas_i', name: 'Cenizas I', region: 'comun', pvp: 'faction', lvl: [21, 23], tier: 5, dropLinks: ['torture_chambers'],
        pits: [{ name: 'Brasas de la ceniza', type: 'fire_ant' }, { name: 'Hechiceros de ceniza', type: 'skeleton_mage' }, { name: 'Muertos calcinados', type: 'zombie_dark' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'paso_de_stormrock', where: 'near' }] },
    { id: 'underworld_catacombs', eris: 'cenizas_ii', name: 'Cenizas II', region: 'comun', pvp: 'faction', lvl: [23, 25], tier: 5,
        pits: [{ name: 'Osario', type: 'skeleton' }, { name: 'Tumbas ardientes', type: 'cursed_grave' }, { name: 'Arqueros de las catacumbas', type: 'skeleton_archer' }],
        loose: [{ type: 'zombie_dark' }], extras: [{ to: 'templo_de_mez', where: 'far', kind: 'door', gate: 19 }] },
    { id: 'underworld_mines', eris: 'cenizas_iii', name: 'Cenizas III', region: 'comun', pvp: 'faction', lvl: [26, 28], tier: 6, dropLinks: ['underworld_stronghold_1'],
        pits: [{ name: 'Mineros condenados', type: 'zombie_dark' }, { name: 'Hornos de wyvern', type: 'wyvern_fire' }, { name: 'Galerías de brasas', type: 'fire_ant' }],
        loose: [{ type: 'skeleton_mage' }], extras: [{ to: 'fortaleza_infernal', where: 'far', kind: 'door', gate: 24 }, { to: 'granja_roble_negro', where: 'near' }] },
    // T6, segundo mapa abierto (Nv 28-30): la Granja de Roble Negro, de pasto, para cortar la seguidilla de cuevas. Flare la une al Risco del Sur
    // y a las cloacas (no importados): se llega por un portal desde Cenizas III y sale al Oasis de Ceniza.
    { id: 'black_oak_farm', openMods: true, eris: 'granja_roble_negro', name: 'Granja de Roble Negro', region: 'comun', pvp: 'faction', lvl: [28, 30], tier: 6,
        dropLinks: ['black_oak_city', 'dilapidated_sewers', 'southern_ridge'],
        pits: [{ name: 'Corrales podridos', type: 'zombie_dark' }, { name: 'Silos de las hormigas', type: 'fire_ant' }, { name: 'Molino de los hechiceros', type: 'skeleton_mage' }],
        loose: [{ type: 'zombie' }], extras: [{ to: 'cenizas_iii', where: 'near' }, { to: 'oasis_de_ceniza', where: 'far' }] },
    // T7 (Nv 31-40, docs/TIERS_DE_ZONA.md): cuatro mapas abiertos de la reserva de Flare. Cenizas III -> Oasis (camino de Flare) -> Lago Kuuma
    // -> Laguna de la Gruta (portales de piedra) -> Minas abandonadas (camino de Flare). La mazmorra (D7) entra por el Lago Kuuma.
    { id: 'oasis', eris: 'oasis_de_ceniza', name: 'Oasis de Ceniza', region: 'comun', pvp: 'faction', lvl: [31, 33], tier: 7,
        pits: [{ name: 'Dunas de las hormigas', type: 'antlion' }, { name: 'Pozos de fuego', type: 'fire_ant' }, { name: 'Nidos del oasis', type: 'wyvern_fire' }],
        loose: [{ type: 'antlion_small' }], extras: [{ to: 'lago_kuuma', where: 'far' }, { to: 'granja_roble_negro', where: 'near' }] },
    { id: 'lake_kuuma', eris: 'lago_kuuma', name: 'Lago Kuuma', region: 'comun', pvp: 'faction', lvl: [33, 35], tier: 7, dropLinks: ['blackmire_mines'], linkGates: { fort_amir: 29 },
        pits: [{ name: 'Hormigueros del lago', type: 'ice_ant' }, { name: 'Vigías helados', type: 'skeleton_archer' }, { name: 'Riscos del lago', type: 'wyvern_ice' }],
        loose: [{ type: 'ice_ant' }], extras: [{ to: 'oasis_de_ceniza', where: 'near' }, { to: 'laguna_de_la_gruta', where: 'far' }] },
    { id: 'grot_lagoon', eris: 'laguna_de_la_gruta', name: 'Laguna de la Gruta', region: 'comun', pvp: 'faction', lvl: [35, 37], tier: 7,
        pits: [{ name: 'Orilla helada', type: 'wyvern_ice' }, { name: 'Hechiceros de la gruta', type: 'skeleton_mage' }, { name: 'Cumbre de la laguna', type: 'wyvern' }],
        loose: [{ type: 'skeleton' }], extras: [{ to: 'lago_kuuma', where: 'near' }] },
    // T7, cuarto mapa abierto (Nv 38-40, el tope): las Minas abandonadas. Flare las une a la Laguna (camino propio); las salidas a La Brecha y a
    // Blackmire se descartan.
    { id: 'abandoned_mines', eris: 'minas_abandonadas', name: 'Minas abandonadas', region: 'comun', pvp: 'faction', lvl: [38, 40], tier: 7, dropLinks: ['the_breach', 'blackmire_mines'],
        pits: [{ name: 'Galerías de los muertos', type: 'zombie_dark' }, { name: 'Pozos de las hormigas', type: 'antlion' }, { name: 'Socavón de los hechiceros', type: 'skeleton_mage' }],
        loose: [{ type: 'skeleton_archer' }] },
    // D7 (T7): Fuerte Amir y Cámaras de tortura (2 pisos, Nv 38-40, jefe: el Gran Verdugo). La entrada es la puerta de Flare del Lago Kuuma
    // (Nv 29); Flare no une los dos pisos, así que van por una puerta propia.
    { id: 'fort_amir', openMods: true, eris: 'fuerte_amir', name: 'Fuerte Amir', region: 'mazmorra', pvp: 'off', lvl: [38, 39], tier: 7, dungeon: true,
        pits: [{ name: 'Guardia del fuerte', type: 'skeleton' }, { name: 'Ballesteros de las murallas', type: 'skeleton_archer' }, { name: 'Hechiceros del fuerte', type: 'skeleton_mage' }],
        loose: [{ type: 'zombie_dark' }], extras: [{ to: 'camaras_de_tortura', where: 'far' }] },
    { id: 'torture_chambers', openMods: true, eris: 'camaras_de_tortura', name: 'Cámaras de tortura', region: 'mazmorra', pvp: 'off', lvl: [39, 40], tier: 7, dungeon: true, respawnMap: 'fuerte_amir', dropLinks: ['underworld'],
        pits: [{ name: 'Celdas de los condenados', type: 'zombie_dark' }, { name: 'Potros del verdugo', type: 'cursed_grave' }, { name: 'Carceleros', type: 'skeleton_archer' }],
        loose: [{ type: 'skeleton' }], boss: { type: 'verdugo', name: 'Sala del Gran Verdugo' }, bossClear: 10, extras: [{ to: 'fuerte_amir', where: 'near' }] },
    { id: 'merrimead_swamp', eris: 'pantano_de_merrimead', name: 'Pantano de Merrimead', region: 'comun', pvp: 'faction', lvl: [6, 8], tier: 2,
        pits: [{ name: 'Ciénaga de zombis', type: 'zombie' }, { name: 'Pozo oscuro', type: 'zombie_dark' }, { name: 'Lápidas del pantano', type: 'cursed_grave' }],
        loose: [{ type: 'zombie' }], extras: [{ to: 'altas_de_nazia', where: 'far' }] },
    { id: 'nazia_highlands', eris: 'altas_de_nazia', name: 'Altas de Nazia', region: 'comun', pvp: 'faction', lvl: [8, 10], tier: 2,
        pits: [{ name: 'Nidada de crías', type: 'antlion_small' }, { name: 'Hoyos de las tierras altas', type: 'antlion' }, { name: 'Hormigueros ardientes', type: 'fire_ant' }],
        loose: [{ type: 'antlion_small' }], extras: [{ to: 'pantano_de_merrimead', where: 'near' }, { to: 'nido_hormiga_leon', where: 'far', kind: 'door', gate: 4 }] },
    { id: 'lochport_cemetery', eris: 'cementerio_de_lochport', name: 'Cementerio de Lochport', region: 'comun', pvp: 'faction', lvl: [11, 13], tier: 3,
        pits: [{ name: 'Tumbas viejas', type: 'skeleton' }, { name: 'Arqueros del osario', type: 'skeleton_archer' }, { name: 'Hechiceros del camposanto', type: 'skeleton_mage' }],
        loose: [{ type: 'cursed_grave' }], extras: [{ to: 'risco_del_sur', where: 'far' }, { to: 'cripta_olvidada', where: 'near', kind: 'door', gate: 9 }] },
    { id: 'the_breach', eris: 'la_brecha', name: 'La Brecha', region: 'comun', pvp: 'faction', lvl: [16, 18], tier: 4,
        pits: [{ name: 'Túneles de hormiga león', type: 'antlion' }, { name: 'Hormigueros de la brecha', type: 'fire_ant' }, { name: 'Mineros caídos', type: 'zombie_dark' }],
        loose: [{ type: 'antlion_small' }, { type: 'fire_ant' }], dropLinks: ['antlion_nest', 'abandoned_mines'], extras: [{ to: 'risco_del_sur', where: 'near' }, { to: 'torre_del_hechicero', where: 'far', kind: 'door', gate: 14 }] },
    { id: 'southern_ridge', eris: 'risco_del_sur', name: 'Risco del Sur', region: 'comun', pvp: 'faction', lvl: [13, 15], tier: 3, dropLinks: ['black_oak_farm'],
        pits: [{ name: 'Risco de las hormigas', type: 'antlion' }, { name: 'Atalaya en ruinas', type: 'skeleton_mage' }, { name: 'Grietas de fuego', type: 'fire_ant' }],
        loose: [{ type: 'antlion' }, { type: 'skeleton' }], extras: [{ to: 'cementerio_de_lochport', where: 'near' }, { to: 'la_brecha', where: 'far' }] },
];

/**
 * Relleno del vacío por tileset (el vacío de Flare es negro): piso de la propia hoja y objetos que lo cubren, en porcentajes
 * acumulados. Las celdas rellenadas quedan bloqueadas. Los ids son los de la hoja (se ven en el catálogo de tools/src/flare/mapatlas.ts).
 */
const FILLS: Record<string, { floor: number[]; deco: [number, number[]][] }> = {
    grassland: {
        floor: Array.from({ length: 16 }, (_, i) => 16 + i),
        deco: [[0.17, [248, 249, 250, 251]], [0.24, [252, 253, 254, 255]], [0.29, [240, 241, 242, 243]], [0.33, [128, 129, 130, 131]], [0.45, [112, 113, 124, 125, 126, 127]]],
    },
    // Cueva: el vacío es roca maciza. Piso de tierra oscurecida (900-915, ver FLARE_SHADE) con columnas de roca sueltas, estalagmitas y
    // piedras: las caras de atrás de las paredes son transparentes y dejan ver esa roca oscura (antes era musgo verde y parecía un pantano).
    cave: {
        floor: Array.from({ length: 16 }, (_, i) => 900 + i),
        deco: [[0.10, [64, 65, 68, 69, 72, 76, 80, 84, 96, 97, 98, 99, 100, 101, 102, 103]], [0.17, [144, 145, 146, 147, 148, 149]], [0.23, [150, 151, 152, 153]], [0.25, [132, 133, 134, 135]]],
    },
    // Nieve: el vacío es nieve lisa (16-31) con árboles pelados, rocas nevadas, matas y tocones (sin las piezas del agua ni los marcadores violeta 92-95).
    snowplains: {
        floor: Array.from({ length: 16 }, (_, i) => 16 + i),
        deco: [[0.13, [244, 245, 246, 247]], [0.17, [128, 129, 130, 131]], [0.22, [112, 113, 124, 125, 126, 127]], [0.23, [136]]],
    },
    // Mazmorra de piedra: piso liso (16-19, 21, 23) con muñones de muro (cara negra transparente), huesos y calaveras.
    dungeon: {
        floor: [16, 17, 18, 19, 21, 23],
        deco: [[0.30, [48, 49, 50, 56, 57, 58, 59, 60, 61]], [0.36, [66, 67, 68, 69, 70]], [0.38, [144, 145, 146, 147, 148]]],
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
const OPEN_MAX = 12, LOW_PROP = 90;
/** Parte de los obstáculos sueltos que se conserva y distancia mínima (celdas, Manhattan) entre dos conservados. */
const KEEP_PROPS = 0.25, KEEP_GAP = 6;
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
    if (spec.lvl[0] < t0 || spec.lvl[1] > t1 || spec.lvl[0] > spec.lvl[1]) throw new Error(`${spec.id}: lvl ${spec.lvl} no cae dentro del tier ${spec.tier} (${t0}-${t1})`);
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
            if (!enclosed || isle.length > OPEN_MAX) continue;
            // Se conserva ~1 de cada 4 (bloqueando, como estaba) para que el mapa no pierda su identidad (las lápidas del cementerio, las
            // carpas del cañón), siempre separados entre sí: un obstáculo suelto se rodea fácil; muchos juntos son los que traban.
            const [ix, iy] = isle[0];
            if (hashStr(`${spec.id}:isla:${ix},${iy}`) / 4294967296 < (spec.keepProps ?? KEEP_PROPS) && !kept.some((k) => Math.abs(k[0] - ix) + Math.abs(k[1] - iy) < KEEP_GAP)) { kept.push([ix, iy]); continue; }
            for (const [cx, cy] of isle) {
                reach[cy][cx] = true; opened++;
                const o = object[cy][cx]; if (o && (heights.get(o) ?? 999) > LOW_PROP) { object[cy][cx] = 0; removed++; }
            }
        }
        if (opened) console.log(`${spec.id}: ${opened} celdas de obstáculos sueltos abiertas (${removed} objetos altos sacados, ${kept.length} obstáculos conservados)`);
    }
    const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && reach[y][x];
    let walkable = 0; for (const r of reach) for (const v of r) if (v) walkable++;
    const snap = (x: number, y: number): { x: number; y: number } | undefined => {
        for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        return undefined;
    };

    // 2) Sin partes negras: el vacío de Flare (fuera de la isla, en los pozos y en el relleno a cuadrado) se rellena con el piso de la hoja
    // y objetos que lo cubren. Esas celdas ya están bloqueadas (no se pueden pisar).
    const fill = FILLS[tsName];
    if (fill) {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (background[y][x] !== 0) continue;
            const r = (k: number) => hashStr(`${spec.id}:${x},${y},${k}`) / 4294967296;
            // el piso va siempre (también bajo los acantilados, que tienen la cara de atrás transparente); los objetos, solo en celdas vacías
            background[y][x] = fill.floor[Math.floor(r(0) * fill.floor.length)];
            if (object[y][x] !== 0) continue;
            const roll = r(1), band = fill.deco.find(([t]) => roll < t);
            if (band) object[y][x] = band[1][Math.floor(r(2) * band[1].length)];
        }
    } else console.warn(`${spec.id}: tileset '${tsName}' sin relleno definido: el vacío queda negro`);

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
