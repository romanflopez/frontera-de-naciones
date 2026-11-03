/**
 * Misiones del corte del MVP (docs del proyecto: `mvp-dungeons-llaves-quests.md` §4).
 *
 * Tres cosas, todas con el Capitán de la ciudad:
 * - **Camino del aventurero** (con el Capitán): cadena que te lleva por todos los mapas abiertos y los 7 dungeons, de Campos de
 *   Sal (nivel 1) al Gran Verdugo (nivel 38-40).
 * - **Encargos del día** (sin NPC): se van abriendo por nivel, avanzan solos y se cobran solos al completarse. Tope de 3
 *   cobrados por día; se reinician a las 06:00 de Argentina (09:00 UTC). El primero del día paga además una esencia.
 * - **Repetible:** entregar 10 materiales iguales a cambio de oro o de una piedra de forja (sumidero de lo que sobra del farmeo).
 *
 * Reemplaza a la cadena vieja de 10 (`QUESTS` en economy.ts), que quedó jubilada: los portales de entrenamiento se abren por
 * nivel y las llaves viejas se siguen forjando con las esquirlas de los jefes.
 * Esta lógica es pura (sin red ni azar): el server la usa para avanzar el progreso y el cliente para mostrarlo.
 */
import type { MobType } from './mobs';
import { BOSS_UNIQUES, UNIQUES_BY_TIER, type UniqueBase } from './uniques';

// ---------- materiales nuevos (los sueltan los mobs; la receta de las llaves va en el paso de llaves) ----------
/** Colmillo: 8 % en los pits T1 (nivel 1-5). Con 8 + oro se arma la llave de la cueva (D1). */
export const MAT_COLMILLO = 'colmillo';
/** Esencia: 3 % en los pits T2 (nivel 6-10) o 1 por día con el primer encargo entregado. Va en la llave del nido (D2). */
export const MAT_ESENCIA = 'esencia';
/** Materiales de las llaves de D3 a D6: 6 % en los pits de su tramo (8 ≈ 130 kills, más o menos lo que dura la corrida). */
export const MAT_HUESO = 'hueso_antiguo', MAT_TINTA = 'tinta_arcana', MAT_PLUMA = 'pluma_tormenta', MAT_BRASA = 'brasa_infernal';
/** Material de la llave de D7: 6 % en los pits del T7 (nivel 31-40). */
export const MAT_ESLABON = 'eslabon_maldito';
export const QUEST_MATS: Record<string, { name: string; tier: number; chance: number }> = {
    [MAT_COLMILLO]: { name: 'Colmillo', tier: 1, chance: 0.08 },
    [MAT_ESENCIA]: { name: 'Esencia', tier: 2, chance: 0.03 },
    [MAT_HUESO]: { name: 'Hueso antiguo', tier: 3, chance: 0.06 },
    [MAT_TINTA]: { name: 'Tinta arcana', tier: 4, chance: 0.06 },
    [MAT_PLUMA]: { name: 'Pluma de tormenta', tier: 5, chance: 0.06 },
    [MAT_BRASA]: { name: 'Brasa infernal', tier: 6, chance: 0.06 },
    [MAT_ESLABON]: { name: 'Eslabón maldito', tier: 7, chance: 0.06 },
};
// ---------- llaves de las mazmorras (docs/LLAVES.md) ----------
/** Llave de la cueva (D1), llave gastada (la suelta el jefe de D1, una por jugador) y llave del nido (D2). Viven en los materiales del personaje. */
export const MAT_LLAVE_CUEVA = 'llave_cueva', MAT_LLAVE_GASTADA = 'llave_gastada', MAT_LLAVE_NIDO = 'llave_nido';
export const MAT_LLAVE_CRIPTA = 'llave_cripta_olvidada', MAT_LLAVE_TORRE = 'llave_torre', MAT_LLAVE_TEMPLO = 'llave_templo', MAT_LLAVE_FORTALEZA = 'llave_fortaleza', MAT_LLAVE_AMIR = 'llave_amir';
/** Receta de cada llave: materiales + oro. Se arma en cualquier lado (clic derecho sobre la llave o el material en la bolsa). */
export const KEY_RECIPES: Record<string, { name: string; dungeon: string; mats: Record<string, number>; gold: number }> = {
    [MAT_LLAVE_CUEVA]: { name: 'Llave de la cueva', dungeon: 'la Cueva goblin', mats: { [MAT_COLMILLO]: 8 }, gold: 60 },
    [MAT_LLAVE_NIDO]: { name: 'Llave del nido', dungeon: 'el Nido de hormiga león', mats: { [MAT_LLAVE_GASTADA]: 1, [MAT_ESENCIA]: 1 }, gold: 120 },
    // de D3 en adelante, sin cadena: el material cae en los pits del mismo tramo, así un alto nunca vuelve a contenido bajo por una llave
    [MAT_LLAVE_CRIPTA]: { name: 'Llave de la cripta olvidada', dungeon: 'la Cripta olvidada', mats: { [MAT_HUESO]: 8 }, gold: 200 },
    [MAT_LLAVE_TORRE]: { name: 'Llave de la torre', dungeon: 'la Torre del hechicero', mats: { [MAT_TINTA]: 8 }, gold: 300 },
    [MAT_LLAVE_TEMPLO]: { name: 'Llave del templo', dungeon: 'el Templo de Mez', mats: { [MAT_PLUMA]: 8 }, gold: 450 },
    [MAT_LLAVE_FORTALEZA]: { name: 'Llave de la fortaleza', dungeon: 'el Foso del demonio', mats: { [MAT_BRASA]: 8 }, gold: 650 },
    [MAT_LLAVE_AMIR]: { name: 'Llave del Fuerte Amir', dungeon: 'las Cámaras de tortura', mats: { [MAT_ESLABON]: 8 }, gold: 900 },
};
export const KEY_MAT_NAMES: Record<string, string> = { [MAT_LLAVE_GASTADA]: 'Llave gastada', ...Object.fromEntries(Object.entries(KEY_RECIPES).map(([id, r]) => [id, r.name])) };
/** Qué jefe suelta qué llave (al 100 %, una para cada jugador que lo mata o está cerca en la party). */
export const BOSS_KEY_DROPS: Partial<Record<MobType, string>> = { goblin_jefe: MAT_LLAVE_GASTADA };
/** Puerta de entrada (desde la superficie) de cada mazmorra con llave: el mapa del primer piso → la llave que pide. */
export const DUNGEON_ENTRY_KEYS: Record<string, string> = {
    cueva_goblin: MAT_LLAVE_CUEVA, nido_hormiga_leon: MAT_LLAVE_NIDO,
    cripta_olvidada: MAT_LLAVE_CRIPTA, torre_del_hechicero: MAT_LLAVE_TORRE, templo_de_mez: MAT_LLAVE_TEMPLO, fortaleza_infernal: MAT_LLAVE_FORTALEZA, fuerte_amir: MAT_LLAVE_AMIR,
};
/** Lo que falta para armar `key` con `mats` y `gold`, o null si alcanza. */
export function keyMissing(key: string, mats: Record<string, number>, gold: number): string | null {
    const r = KEY_RECIPES[key]; if (!r) return 'Esa llave no se arma.';
    const falta: string[] = [];
    for (const [id, n] of Object.entries(r.mats)) { const have = mats[id] ?? 0; if (have < n) falta.push(`${n - have} ${(QUEST_MATS[id]?.name ?? KEY_MAT_NAMES[id] ?? id).toLowerCase()}${n - have > 1 ? 's' : ''}`); }
    if (gold < r.gold) falta.push(`${r.gold - gold} de oro`);
    return falta.length ? `Te falta: ${falta.join(', ')}.` : null;
}
/**
 * Basura vendible por tipo de mob (el botín del suelo de systems/loot.ts, estilo junkloot de Dreadmyst): se vende
 * al NPC con `uid: 0` en EconSellRequest ("vender basura"). Reemplaza a los ítems "comunes" del botín viejo (docs/ITEMS.md).
 * La clave es el id del material; `value` es el oro que paga el vendedor por unidad.
 */
export const JUNK_MATS: Record<string, { name: string; value: number }> = {
    goblin_ear: { name: 'Oreja de goblin', value: 4 },
    rotten_flesh: { name: 'Carne podrida', value: 4 },
    old_bone: { name: 'Hueso viejo', value: 5 },
    chitin: { name: 'Quitina', value: 6 },
    spider_silk: { name: 'Seda de araña', value: 8 },
    viper_skin: { name: 'Piel de wyvern', value: 10 },
    stone_core: { name: 'Núcleo de piedra', value: 10 },
    minotaur_horn: { name: 'Cuerno de minotauro', value: 10 },
    demon_ash: { name: 'Ceniza demoníaca', value: 12 },
};
/** Valor de venta de un material de basura (los trofeos genéricos `trophy_*` valen 3). */
export const junkValue = (id: string): number => JUNK_MATS[id]?.value ?? (id.startsWith('trophy_') ? 3 : 0);

/** Nombre de una llave, material de llave o basura (para los avisos y la bolsa). */
export const keyMatName = (id: string): string => KEY_MAT_NAMES[id] ?? QUEST_MATS[id]?.name ?? JUNK_MATS[id]?.name ?? id;

/** Materiales que no se aceptan en la repetible: son de las llaves. */
export const RESERVED_MATS = new Set([...Object.keys(QUEST_MATS), ...Object.keys(KEY_RECIPES), MAT_LLAVE_GASTADA]);

/** Jefe que cierra cada dungeon del corte: matarlo (vos o tu party cerca) cuenta como completarlo. */
export type DungeonId = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7';
export const DUNGEON_IDS: DungeonId[] = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
export const DUNGEON_BOSS: Record<DungeonId, MobType> = { d1: 'goblin_jefe', d2: 'antlion_reina', d3: 'caballero_cripta', d4: 'mago_mayor', d5: 'wyvern_aire', d6: 'demonio_foso', d7: 'verdugo' };
export const DUNGEON_NAME: Record<DungeonId, string> = { d1: 'la Cueva goblin', d2: 'el Nido de hormiga león', d3: 'la Cripta olvidada', d4: 'la Torre del hechicero', d5: 'el Templo de Mez', d6: 'el Foso del demonio', d7: 'las Cámaras de tortura' };
/** Piso del jefe: el dungeon solo cuenta si el jefe muere ahí (en la instancia), no si aparece en otro lado (GM, mapas de prueba). */
export const DUNGEON_MAP: Record<DungeonId, string> = { d1: 'minas_goblin', d2: 'ruinas_de_stormrock', d3: 'sepulcro_profundo', d4: 'camaras_de_investigacion', d5: 'salon_de_mez', d6: 'foso_del_demonio', d7: 'camaras_de_tortura' };

// ---------- objetivos ----------
export type QuestGoal =
    | { k: 'kill'; mobs: MobType[]; map?: string; n: number; what: string }
    /** matar mobs de un pit de tu banda de nivel o más alta */
    | { k: 'pit'; n: number; what: string }
    /** tener N de un material (se cuenta lo que tenés; no se gasta al entregar) */
    | { k: 'collect'; mat: string; n: number; what: string }
    /** levantar N materiales del suelo */
    | { k: 'gather'; n: number; what: string }
    | { k: 'dungeon'; d: DungeonId; n: number; what: string }
    /** tener un ítem único en +N o más (equipado o en la bolsa): cuenta aunque la mejora la hayas hecho antes de aceptar */
    | { k: 'upgraded'; n: number; what: string }
    /** hablar con un NPC de ese rol */
    | { k: 'talk'; role: string; n: number; what: string }
    | { k: 'mutant'; n: number; what: string }
    /** ganar una pelea contra otra nación en un mapa de facción */
    | { k: 'pvp'; n: number; what: string };

export interface QuestReward {
    /** exp como % de lo que pide tu nivel actual (paso 1.1) */
    expPct: number;
    gold: number;
    forge?: number;
    /** ítem único: uno T1 de tu clase al azar, uno T1 de tu clase a elección o uno de la Reina a elección */
    /** `boss_dN_choice`: uno de los ítems del jefe de ese dungeon, a elección (los seis jefes tienen sus ítems) */
    unique?: 'class_t1_random' | 'class_t1_choice' | `boss_${DungeonId}_choice`;
}

export interface MainQuest { id: string; name: string; minLvl: number; say: string; done: string; goals: QuestGoal[]; reward: QuestReward }

const kill = (m: string, mobs: MobType[], n: number, what: string): QuestGoal => ({ k: 'kill', mobs, map: m, n, what });
/** Camino del aventurero: un paso por mapa, en el orden en que se conectan (textos provisorios: se reescriben más adelante). */
export const MAIN_QUESTS: MainQuest[] = [
    {
        id: 'primeros_pasos', name: 'Primeros pasos', minLvl: 1,
        say: 'Los goblins de los Campos de Sal se volvieron osados. Cada grupo vive en su pit: limpiá uno y vas a ver cómo vuelven a salir. Matá a 10 y volvé.',
        done: 'Bien hecho. Tomá esta pieza y unas piedras de forja: el herrero te va a explicar qué hacer con ellas.',
        goals: [kill('campos_de_sal', ['goblin', 'goblin_elite'], 10, 'Goblins en Campos de Sal')],
        reward: { expPct: 20, gold: 120, forge: 3, unique: 'class_t1_random' },
    },
    {
        id: 'bosque_de_piedra', name: 'El Bosque de Piedra', minLvl: 2,
        say: 'Al lado de los Campos está el Bosque de Piedra. Los hobgoblins cavaron una madriguera y salen de noche. Matá a 6.',
        done: 'El bosque respira un poco más tranquilo.',
        goals: [kill('bosque_de_piedra', ['hobgoblin'], 6, 'Hobgoblins en el Bosque de Piedra')],
        reward: { expPct: 20, gold: 80 },
    },
    {
        id: 'el_herrero', name: 'El herrero', minLvl: 2,
        say: 'Un ítem único vale más mejorado. Andá a la herrería y pedile al herrero que suba tu pieza a +1. A veces falla: así es la forja.',
        done: 'Ya sabés limar. Las piedras caen de los mobs: cuanto más difícil el lugar, más seguido.',
        goals: [{ k: 'upgraded', n: 1, what: 'Tener un ítem en +1' }],
        reward: { expPct: 20, gold: 80 },
    },
    {
        id: 'colmillos', name: 'Colmillos', minLvl: 2,
        say: 'La Cueva goblin no se abre con palabras. Los bichos de los pits de nivel 1 a 5 a veces sueltan colmillos: juntá 8, con eso y 60 de oro armás la llave (clic derecho sobre los colmillos en la bolsa).',
        done: 'Ocho colmillos. Armá la llave de la cueva desde la bolsa: cada uno de tu grupo necesita la suya.',
        goals: [{ k: 'collect', mat: MAT_COLMILLO, n: 8, what: 'Colmillos' }],
        reward: { expPct: 25, gold: 60 },
    },
    {
        id: 'canon_goblin', name: 'El Cañón goblin', minLvl: 3,
        say: 'Del bosque sale el camino al Cañón goblin, donde está la entrada a la cueva. Ojo: ahí la otra nación también caza y te puede atacar. Bajá a 6 de sus arqueros.',
        done: 'Ya conocés el cañón. La entrada a la cueva está ahí mismo.',
        goals: [kill('canon_goblin', ['hobgoblin_archer'], 6, 'Arqueros hobgoblin en el Cañón goblin')],
        reward: { expPct: 25, gold: 120 },
    },
    {
        id: 'cueva_goblin', name: 'La cueva goblin', minLvl: 4,
        say: 'El Jefe goblin se esconde al fondo de las minas, debajo de la cueva. Bajá solo o con un compañero y no te quedes quieto cuando golpee el piso.',
        done: 'Volviste entero. Elegí una pieza de la armería, te la ganaste. Y guardá la llave gastada que soltó el jefe: con una esencia y 120 de oro abre el Nido.',
        goals: [{ k: 'dungeon', d: 'd1', n: 1, what: 'Completar la Cueva goblin' }],
        reward: { expPct: 40, gold: 200, unique: 'class_t1_choice' },
    },
    {
        id: 'pantano', name: 'El Pantano de Merrimead', minLvl: 6,
        say: 'Saliendo del cañón está el Pantano de Merrimead. En el pozo oscuro los muertos no se quedan quietos: matá a 8 zombis oscuros.',
        done: 'Olés a ciénaga, pero volviste.',
        goals: [kill('pantano_de_merrimead', ['zombie_dark'], 8, 'Zombis oscuros en el Pantano')],
        reward: { expPct: 25, gold: 160 },
    },
    {
        id: 'altas_de_nazia', name: 'Las Altas de Nazia', minLvl: 8,
        say: 'Del pantano se sube a las Altas de Nazia. Los hormigueros ardientes queman a los viajeros: acabá con 6 hormigas de fuego.',
        done: 'Esas hormigas vienen de algún lado: hay un nido entero, y abajo manda una reina.',
        goals: [kill('altas_de_nazia', ['fire_ant'], 6, 'Hormigas de fuego en las Altas de Nazia')],
        reward: { expPct: 25, gold: 200 },
    },
    {
        id: 'llave_gastada', name: 'La llave gastada', minLvl: 8,
        say: 'La Reina hormiga león manda en las ruinas debajo del nido. Para entrar, cada uno arma su llave del nido (la llave gastada, una esencia y 120 de oro). Sola no se va a dejar matar: juntá un grupo, y cuando empiece a llover ácido, cortala.',
        done: 'La Reina cayó. Elegí uno de sus trofeos: pocos lo pueden contar.',
        goals: [{ k: 'dungeon', d: 'd2', n: 1, what: 'Completar el Nido de hormiga león' }],
        reward: { expPct: 50, gold: 400, unique: 'boss_d2_choice' },
    },
    {
        id: 'lochport', name: 'El Cementerio de Lochport', minLvl: 11,
        say: 'Con la Reina muerta, el camino sigue hacia el Cementerio de Lochport. Los hechiceros del camposanto levantan a los muertos: matá a 8.',
        done: 'Uno menos que levanta muertos. Quedan muchos.',
        goals: [kill('cementerio_de_lochport', ['skeleton_mage'], 8, 'Hechiceros esqueleto en Lochport')],
        reward: { expPct: 25, gold: 240 },
    },
    {
        id: 'risco_del_sur', name: 'El Risco del Sur', minLvl: 13,
        say: 'Al sur del cementerio está el Risco. Las hormigas león bajan del risco y cortan el camino: matá a 8.',
        done: 'El camino quedó abierto. Debajo de Lochport hay algo que no duerme.',
        goals: [kill('risco_del_sur', ['antlion'], 8, 'Hormigas león en el Risco del Sur')],
        reward: { expPct: 25, gold: 280 },
    },
    {
        id: 'cripta', name: 'La Cripta olvidada', minLvl: 14,
        say: 'Debajo de Lochport hay una cripta que no se quedó dormida. En el sepulcro del fondo vela un caballero que no sabe que está muerto. Para entrar, cada uno arma su llave de la cripta olvidada: 8 huesos antiguos (caen en los pits de nivel 11 a 15, como los del cementerio) y 200 de oro. Bajá con gente.',
        done: 'El caballero descansa. Elegí una de sus piezas.',
        goals: [{ k: 'dungeon', d: 'd3', n: 1, what: 'Completar la Cripta olvidada' }],
        reward: { expPct: 40, gold: 500, unique: 'boss_d3_choice' },
    },
    {
        id: 'la_brecha', name: 'La Brecha', minLvl: 16,
        say: 'La Brecha es el cruce de todo: de ahí salen el paso de Stormrock, la torre y el templo. Los mineros caídos cuidan la bajada: matá a 8.',
        done: 'Ya conocés la Brecha. Desde acá todo es más duro.',
        goals: [kill('la_brecha', ['zombie_dark'], 8, 'Mineros caídos en La Brecha')],
        reward: { expPct: 25, gold: 400 },
    },
    {
        id: 'paso_de_stormrock', name: 'El Paso de Stormrock', minLvl: 18,
        say: 'El paso de Stormrock lleva a las Cenizas. Los wyverns de los riscos cazan a los que cruzan: derribá a 6.',
        done: 'El paso está abierto. Más allá, el mundo se quema.',
        goals: [kill('paso_de_stormrock', ['wyvern'], 6, 'Wyverns en el Paso de Stormrock')],
        reward: { expPct: 25, gold: 450, forge: 3 },
    },
    {
        id: 'torre', name: 'La Torre del hechicero', minLvl: 19,
        say: 'En la torre de la Brecha, un mago mayor sigue con sus experimentos en las cámaras de abajo. Cortalo antes de que termine el hechizo. La puerta pide la llave de la torre: 8 tintas arcanas (pits de nivel 16 a 20, como los de la Brecha) y 300 de oro.',
        done: 'Las cámaras quedaron en silencio.',
        goals: [{ k: 'dungeon', d: 'd4', n: 1, what: 'Completar la Torre del hechicero' }],
        reward: { expPct: 40, gold: 700, forge: 5, unique: 'boss_d4_choice' },
    },
    {
        id: 'cenizas_i', name: 'Las Cenizas', minLvl: 21,
        say: 'Del paso se baja a las Cenizas. Los hechiceros de ceniza levantan a los calcinados: matá a 8.',
        done: 'Ceniza en la boca y en la armadura, pero volviste.',
        goals: [kill('cenizas_i', ['skeleton_mage'], 8, 'Hechiceros de ceniza en Cenizas I')],
        reward: { expPct: 25, gold: 550 },
    },
    {
        id: 'cenizas_ii', name: 'Las catacumbas de ceniza', minLvl: 23,
        say: 'Más adentro, en Cenizas II, los arqueros de las catacumbas no dejan pasar a nadie: bajá a 8.',
        done: 'La entrada al templo de Mez queda cerca de acá.',
        goals: [kill('cenizas_ii', ['skeleton_archer'], 8, 'Arqueros de las catacumbas en Cenizas II')],
        reward: { expPct: 25, gold: 600, forge: 3 },
    },
    {
        id: 'templo_de_mez', name: 'El Templo de Mez', minLvl: 24,
        say: 'En el salón principal de Mez reina el Wyvern del aire. Llevá un grupo que sepa moverse, y cada uno su llave del templo: 8 plumas de tormenta (pits de nivel 21 a 25, como los de las Cenizas II) y 450 de oro.',
        done: 'El trono del aire quedó vacío.',
        goals: [{ k: 'dungeon', d: 'd5', n: 1, what: 'Completar el Templo de Mez' }],
        reward: { expPct: 40, gold: 900, forge: 5, unique: 'boss_d5_choice' },
    },
    {
        id: 'cenizas_iii', name: 'Los hornos de wyvern', minLvl: 26,
        say: 'Cenizas III es el borde del mundo conocido. Los wyverns de fuego anidan en los hornos: matá a 10.',
        done: 'Ya viste la entrada a la Fortaleza infernal. Lo que queda es el Foso.',
        goals: [kill('cenizas_iii', ['wyvern_fire'], 10, 'Wyverns de fuego en Cenizas III')],
        reward: { expPct: 25, gold: 750, forge: 3 },
    },
    {
        id: 'granja', name: 'La granja muerta', minLvl: 28,
        say: 'Saliendo de las Cenizas hay una granja que nadie trabaja hace años, pero los corrales no están vacíos. Bajá a 10 zombis oscuros en la Granja de Roble Negro.',
        done: 'Del otro lado de la granja empieza el desierto.',
        goals: [kill('granja_roble_negro', ['zombie_dark'], 10, 'Zombis oscuros en la Granja de Roble Negro')],
        reward: { expPct: 25, gold: 900, forge: 3 },
    },
    {
        id: 'foso', name: 'El Señor del Foso', minLvl: 29,
        say: 'Debajo de la fortaleza infernal está el Foso, y en el foso, su señor. Es lo más hondo que se conoce. Si volvés, sos leyenda. La fortaleza se abre con su llave: 8 brasas infernales (pits de nivel 26 a 30, como los de las Cenizas III) y 650 de oro.',
        done: 'El Señor del Foso cayó. Pero hay algo más allá de las cenizas.',
        goals: [{ k: 'dungeon', d: 'd6', n: 1, what: 'Completar el Foso del demonio' }],
        reward: { expPct: 50, gold: 1500, forge: 10, unique: 'boss_d6_choice' },
    },
    {
        id: 'oasis', name: 'El oasis de ceniza', minLvl: 31,
        say: 'Más allá del Foso empieza una tierra que no está en los mapas. En el Oasis de Ceniza anidan wyverns de fuego: matá a 10.',
        done: 'El agua del oasis sabe a ceniza, pero sirve.',
        goals: [kill('oasis_de_ceniza', ['wyvern_fire'], 10, 'Wyverns de fuego en el Oasis de Ceniza')],
        reward: { expPct: 25, gold: 1000, forge: 3 },
    },
    {
        id: 'kuuma', name: 'El lago helado', minLvl: 33,
        say: 'Al norte del oasis el agua se congela. En el Lago Kuuma las hormigas de hielo cavan bajo la nieve: bajá a 12.',
        done: 'Viste el fuerte del otro lado del lago. Todavía no: primero la gruta.',
        goals: [kill('lago_kuuma', ['ice_ant'], 12, 'Hormigas de hielo en el Lago Kuuma')],
        reward: { expPct: 25, gold: 1100, forge: 4 },
    },
    {
        id: 'laguna', name: 'La laguna de la gruta', minLvl: 35,
        say: 'Los hechiceros de la Laguna de la Gruta juntan eslabones malditos para algo que vive debajo del fuerte. Matá a 10.',
        done: 'Los eslabones abren la puerta del Fuerte Amir. Guardalos.',
        goals: [kill('laguna_de_la_gruta', ['skeleton_mage'], 10, 'Hechiceros en la Laguna de la Gruta')],
        reward: { expPct: 25, gold: 1200, forge: 4 },
    },
    {
        id: 'minas', name: 'Las minas abandonadas', minLvl: 38,
        say: 'El último tramo: las Minas abandonadas. Lo que cavaron ahí no quiso quedarse abajo. Bajá a 12 zombis oscuros de las galerías.',
        done: 'Ya conocés todo lo que hay arriba. Lo que falta está debajo del fuerte.',
        goals: [kill('minas_abandonadas', ['zombie_dark'], 12, 'Zombis oscuros en las Minas abandonadas')],
        reward: { expPct: 25, gold: 1400, forge: 5 },
    },
    {
        id: 'verdugo', name: 'El Gran Verdugo', minLvl: 38,
        say: 'Más allá del Lago Kuuma está el Fuerte Amir, y debajo, las Cámaras de tortura del Gran Verdugo. Nadie que bajó contó cómo es. La puerta pide la llave del fuerte: 8 eslabones malditos (pits de nivel 31 a 40) y 900 de oro. Llevá a los mejores.',
        done: 'El Gran Verdugo cayó. Completaste el camino del aventurero: sos leyenda.',
        goals: [{ k: 'dungeon', d: 'd7', n: 1, what: 'Completar las Cámaras de tortura' }],
        reward: { expPct: 50, gold: 3000, forge: 15, unique: 'boss_d7_choice' },
    },
];

export interface DailyQuest { id: string; name: string; minLvl: number; maxLvl?: number; goal: QuestGoal }
export const DAILY_QUESTS: DailyQuest[] = [
    { id: 'pits', name: 'Limpieza de pits', minLvl: 1, goal: { k: 'pit', n: 25, what: 'Mobs de un pit de tu nivel' } },
    { id: 'recolector', name: 'Recolector', minLvl: 1, goal: { k: 'gather', n: 10, what: 'Materiales levantados' } },
    { id: 'dia_d1', name: 'Bajada a la cueva', minLvl: 4, maxLvl: 10, goal: { k: 'dungeon', d: 'd1', n: 1, what: 'Completar la Cueva goblin' } },
    { id: 'dia_d2', name: 'Contra la Reina', minLvl: 8, maxLvl: 15, goal: { k: 'dungeon', d: 'd2', n: 1, what: 'Completar el Nido de hormiga león' } },
    { id: 'dia_d3', name: 'Bajada a la cripta', minLvl: 14, maxLvl: 20, goal: { k: 'dungeon', d: 'd3', n: 1, what: 'Completar la Cripta olvidada' } },
    { id: 'dia_d4', name: 'Las cámaras de la torre', minLvl: 19, maxLvl: 25, goal: { k: 'dungeon', d: 'd4', n: 1, what: 'Completar la Torre del hechicero' } },
    { id: 'dia_d5', name: 'El trono del aire', minLvl: 24, maxLvl: 30, goal: { k: 'dungeon', d: 'd5', n: 1, what: 'Completar el Templo de Mez' } },
    { id: 'dia_d6', name: 'El Foso', minLvl: 29, maxLvl: 35, goal: { k: 'dungeon', d: 'd6', n: 1, what: 'Completar el Foso del demonio' } },
    { id: 'dia_d7', name: 'Las cámaras del Verdugo', minLvl: 38, goal: { k: 'dungeon', d: 'd7', n: 1, what: 'Completar las Cámaras de tortura' } },
    { id: 'mutante', name: 'Cazador de mutantes', minLvl: 1, goal: { k: 'mutant', n: 1, what: 'Matar un mutante' } },
    { id: 'frontera', name: 'Defensa de la frontera', minLvl: 3, goal: { k: 'pvp', n: 1, what: 'Ganar una pelea en mapa de facción' } },
];
export const DAILY_BY_ID = new Map(DAILY_QUESTS.map((q) => [q.id, q]));
export const DAILY_EXP_PCT = 10;
/** Encargos cobrados por día: el resto deja de avanzar hasta el reinicio. */
export const DAILY_LIMIT = 3;
export const dailyGold = (lvl: number): number => 50 + 20 * lvl;
/** El reinicio diario: 06:00 de Buenos Aires = 09:00 UTC. Todos a la misma hora (mejor que un temporizador de 20 h por personaje). */
export const DAILY_RESET_UTC_HOUR = 9;
const DAY_MS = 86_400_000;
export const questDay = (now: number): number => Math.floor((now - DAILY_RESET_UTC_HOUR * 3_600_000) / DAY_MS);
export const msToReset = (now: number): number => (questDay(now) + 1) * DAY_MS + DAILY_RESET_UTC_HOUR * 3_600_000 - now;

/** Repetible: N materiales iguales por oro o por una piedra de forja. */
export const REPEAT_MATS = 10;
export const repeatGold = (lvl: number): number => 20 + 6 * lvl;

// ---------- estado ----------
export interface QuestBook {
    /** Camino del aventurero: índice, estado y progreso de cada objetivo. */
    m: { i: number; st: 'new' | 'active' | 'ready'; prog: number[] };
    /** Encargos del día: día del reinicio, los de hoy, progreso, entregados, si ya se cobró la esencia y a quién ya le ganaste hoy en PvP. */
    d: { day: number; ids: string[]; prog: Record<string, number>; done: string[]; ess: boolean; pvp: string[] };
}
export const newQuestBook = (): QuestBook => ({ m: { i: 0, st: 'new', prog: [] }, d: { day: -1, ids: [], prog: {}, done: [], ess: false, pvp: [] } });

const int = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
/** Sanea lo guardado (cuentas sin libro, datos rotos o de una versión vieja). */
export function cleanQuestBook(raw: unknown): QuestBook {
    const b = newQuestBook(), o = (raw ?? {}) as Partial<QuestBook>;
    const m = (o.m ?? {}) as Partial<QuestBook['m']>, d = (o.d ?? {}) as Partial<QuestBook['d']>;
    b.m.i = int(m.i, 0, MAIN_QUESTS.length);
    const q = MAIN_QUESTS[b.m.i];
    b.m.st = q && (m.st === 'active' || m.st === 'ready') ? m.st : 'new';
    b.m.prog = b.m.st === 'new' || !q ? [] : q.goals.map((g, j) => int(m.prog?.[j], 0, g.n));
    b.d.day = typeof d.day === 'number' ? Math.floor(d.day) : -1;
    b.d.ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).filter((id): id is string => typeof id === 'string' && DAILY_BY_ID.has(id)))];
    for (const id of b.d.ids) b.d.prog[id] = int(d.prog?.[id], 0, DAILY_BY_ID.get(id)!.goal.n);
    b.d.done = (Array.isArray(d.done) ? d.done : []).filter((id): id is string => b.d.ids.includes(id as string));
    b.d.ess = !!d.ess; b.d.pvp = (Array.isArray(d.pvp) ? d.pvp : []).filter((x): x is string => typeof x === 'string').slice(0, 200);
    return b;
}

/** Encargos que puede tomar alguien de este nivel. */
export const dailyEligible = (lvl: number): DailyQuest[] => DAILY_QUESTS.filter((q) => lvl >= q.minLvl && (q.maxLvl === undefined || lvl <= q.maxLvl));

/**
 * Encargos fijos: al cambiar el día se renuevan todos (los no entregados se pierden); si subiste de nivel en el día,
 * se suman los que se abren con el nivel nuevo. Devuelve true si cambió algo.
 */
export function rollDailies(b: QuestBook, lvl: number, now: number): boolean {
    const day = questDay(now), ids = dailyEligible(lvl).map((q) => q.id);
    if (b.d.day !== day) { b.d = { day, ids, prog: Object.fromEntries(ids.map((id) => [id, 0])), done: [], ess: false, pvp: [] }; return true; }
    const add = ids.filter((id) => !b.d.ids.includes(id)); if (!add.length) return false;
    for (const id of add) { b.d.ids.push(id); b.d.prog[id] = 0; }
    return true;
}

// ---------- eventos ----------
export type QuestEvent =
    | { k: 'kill'; type: MobType; map: string; pit: boolean; /** tier del mob y del jugador (tierOfLevel) */ tier: number; myTier: number; mutant: boolean }
    | { k: 'gather'; n: number }
    | { k: 'dungeon'; d: DungeonId }
    | { k: 'talk'; role: string }
    | { k: 'pvp' };

/** Lo que el jugador tiene ahora (para los objetivos de "tener"): materiales y la mejora más alta entre sus ítems únicos. */
export interface QuestHave { mats: Record<string, number>; maxUp: number }

/** Cuánto suma un evento a un objetivo (0 si no le corresponde). Los de "tener" (collect) no avanzan por eventos. */
export function goalStep(g: QuestGoal, e: QuestEvent): number {
    switch (g.k) {
        case 'kill': return e.k === 'kill' && g.mobs.includes(e.type) && (!g.map || g.map === e.map) ? 1 : 0;
        case 'pit': return e.k === 'kill' && e.pit && e.tier >= e.myTier ? 1 : 0;
        case 'mutant': return e.k === 'kill' && e.mutant ? 1 : 0;
        case 'gather': return e.k === 'gather' ? e.n : 0;
        case 'dungeon': return e.k === 'dungeon' && e.d === g.d ? 1 : 0;
        case 'talk': return e.k === 'talk' && e.role === g.role ? 1 : 0;
        case 'pvp': return e.k === 'pvp' ? 1 : 0;
        default: return 0;
    }
}

/** Progreso de un objetivo: los de "tener" se miran en lo que tenés; el resto, en lo guardado. */
export const goalProgress = (g: QuestGoal, saved: number, have: QuestHave): number =>
    g.k === 'collect' ? Math.min(g.n, have.mats[g.mat] ?? 0) : g.k === 'upgraded' ? (have.maxUp >= g.n ? g.n : 0) : Math.min(g.n, saved);
export const mainComplete = (b: QuestBook, have: QuestHave): boolean => {
    const q = MAIN_QUESTS[b.m.i]; return !!q && q.goals.every((g, j) => goalProgress(g, b.m.prog[j] ?? 0, have) >= g.n);
};

/**
 * Aplica un evento al libro. Devuelve los avisos para el jugador (misión lista) y los encargos que se acaban de completar
 * (`paid`: ya quedan como cobrados; el server paga el premio). Con el tope del día alcanzado, los encargos no avanzan.
 * `have` es lo que tiene ahora (para los objetivos de "tener"). Llamar `rollDailies` antes si puede haber cambiado el día.
 * Sin evento (`null`) solo recalcula los de "tener" (después de mejorar, gastar materiales, etc.).
 */
export function applyQuestEvent(b: QuestBook, e: QuestEvent | null, have: QuestHave): { msgs: string[]; paid: string[] } {
    const out: string[] = [], paid: string[] = [];
    const q = MAIN_QUESTS[b.m.i];
    if (q && b.m.st === 'active' && e) q.goals.forEach((g, j) => { const s = goalStep(g, e); if (s) b.m.prog[j] = Math.min(g.n, (b.m.prog[j] ?? 0) + s); });
    if (q && b.m.st !== 'new') {
        const was = b.m.st;
        b.m.st = mainComplete(b, have) ? 'ready' : 'active';
        if (was !== 'ready' && b.m.st === 'ready') out.push(`Misión lista: «${q.name}». Volvé con el Capitán.`);
    }
    for (const id of b.d.ids) {
        if (b.d.done.includes(id) || b.d.done.length >= DAILY_LIMIT) continue;
        const dq = DAILY_BY_ID.get(id)!, before = b.d.prog[id] ?? 0, s = e ? goalStep(dq.goal, e) : 0;
        if (!s) continue;
        b.d.prog[id] = Math.min(dq.goal.n, before + s);
        if (b.d.prog[id] >= dq.goal.n) { b.d.done.push(id); paid.push(id); }
    }
    return { msgs: out, paid };
}

/** Ítems que se pueden elegir (o sortear) como premio, según la clase. El mago y el healer usan lo que da Magia; el guerrero, lo que no. */
export function rewardUniques(kind: NonNullable<QuestReward['unique']>, cls: string): UniqueBase[] {
    const boss = /^boss_(d\d)_choice$/.exec(kind)?.[1] as DungeonId | undefined;
    if (boss) return BOSS_UNIQUES[DUNGEON_BOSS[boss]] ?? [];
    const caster = cls === 'mago' || cls === 'healer';
    return (UNIQUES_BY_TIER[1] ?? []).filter((u) => u.slot === 'anillo' || (caster ? (u.mag ?? 0) > 0 : !(u.mag ?? 0)));
}

// ---------- vista para el cliente (va como JSON en InventoryState.quest_book) ----------
export interface QuestBookView {
    m: { i: number; st: QuestBook['m']['st']; prog: number[] };
    d: { ids: string[]; prog: Record<string, number>; done: string[]; ess: boolean; resetMs: number };
    mats: Record<string, number>;
}
export function questBookView(b: QuestBook, have: QuestHave, now: number): QuestBookView {
    const q = MAIN_QUESTS[b.m.i];
    return {
        m: { i: b.m.i, st: b.m.st, prog: q && b.m.st !== 'new' ? q.goals.map((g, j) => goalProgress(g, b.m.prog[j] ?? 0, have)) : [] },
        d: { ids: b.d.ids, prog: b.d.prog, done: b.d.done, ess: b.d.ess, resetMs: msToReset(now) },
        mats: Object.fromEntries(Object.entries(have.mats).filter(([, n]) => n > 0)),
    };
}
