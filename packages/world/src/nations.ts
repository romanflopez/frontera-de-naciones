/**
 * Mapas de leveo propios de cada nación (decisión de Román, 5/11): del 1 al 60 cada nación tiene su copia de los mapas de caza y de las
 * mazmorras de esos tramos, sin PvP, y la otra nación no entra. Solmar usa los ids de siempre; la copia de Vhar lleva el sufijo `_vhar`.
 * Acá está la lista de los mapas que ya tienen su copia (se va ampliando de a un tramo).
 */
export const NATION_SPLIT_MAPS: readonly string[] = [
    'canon_goblin', 'cueva_goblin', 'minas_goblin', 'pantano_de_merrimead', 'altas_de_nazia', 'nido_hormiga_leon', 'ruinas_de_stormrock',
    'cementerio_de_lochport', 'cripta_olvidada', 'sepulcro_profundo', 'risco_del_sur', 'la_brecha', 'torre_del_hechicero', 'camaras_de_investigacion',
];
export const VHAR_SUFFIX = '_vhar';
/** Id del mapa que le toca a una nación: el de Vhar es la copia, el de Solmar es el de siempre. */
export const mapForNation = (id: string, faction: string): string => (faction === 'vhar' && NATION_SPLIT_MAPS.includes(id) ? id + VHAR_SUFFIX : id);
/** Id del mapa "de siempre" (el de Solmar) de un mapa que puede ser la copia de Vhar. */
export const baseMapId = (id: string): string => (id.endsWith(VHAR_SUFFIX) ? id.slice(0, -VHAR_SUFFIX.length) : id);
/** Nación dueña del mapa, o undefined si es compartido. */
export const nationOfMap = (id: string): 'solmar' | 'vhar' | undefined => (NATION_SPLIT_MAPS.includes(baseMapId(id)) ? (id.endsWith(VHAR_SUFFIX) ? 'vhar' : 'solmar') : undefined);
