/**
 * Ciudadela de Vhar, rediseñada (docs/CIUDADES.md): la misma planta que la Villa de Solmar (ver ../solmar/city.ts) en clima de nieve:
 * muralla de basalto con torres, techos nevados, adoquín oscuro, plaza de placas de hierro con el Portal de Frontera y árboles pelados.
 * El portón está en la muralla sur y sale a los Campos de Sal.
 *
 * Los edificios con interior (Casa de Concejo, Santuario, Forja, Bazar, Orfebrería, Cámara Fuerte, Torre de las Brasas y Cuartel)
 * tienen la puerta en la cara sur o este (las que se ven) y un vínculo `enter`.
 *
 * Arte: edificios propios pre-renderizados en Blender (`vh2_*`, tools/src/iso3d/city_edificios.py); pisos de placa y adoquín del kit de
 * Screaming Brain Studios (CC0, town.webp) y nieve, árboles pelados y piedras de Flare (CC-BY-SA, flare_snowplains.webp).
 */
import type { WorldMap } from '../index';
import { flareTile } from '../flare/types';
import { TOWN_PROPS, townBuilding, vharTiles } from '../town';
import { buildCity, CITY_BUILDINGS, CITY_N, CITY_PORTAL, CITY_SPAWN, GATE_SOUTH, type CityBuilding } from '../solmar/city';
import type { Cell } from '../solmar/kit';

export const VHAR_CITADEL_ID = 'vhar_ciudadela';
export const VHAR_N = CITY_N;
/** Edificios con interior: id del mapa interior, fachada y esquina norte en la ciudadela. */
export const VHAR_BUILDINGS = {
    ayuntamiento: { map: 'vhar_concejo', facade: 'vh2_ayuntamiento', ...CITY_BUILDINGS.ayuntamiento },
    templo: { map: 'vhar_santuario', facade: 'vh2_templo', ...CITY_BUILDINGS.templo },
    joyeria: { map: 'vhar_orfebreria', facade: 'vh2_joyeria', ...CITY_BUILDINGS.joyeria },
    tienda: { map: 'vhar_bazar', facade: 'vh2_tienda', ...CITY_BUILDINGS.tienda },
    herreria: { map: 'vhar_forja', facade: 'vh2_herreria', ...CITY_BUILDINGS.herreria },
    deposito: { map: 'vhar_camara', facade: 'vh2_deposito', ...CITY_BUILDINGS.deposito },
    cuartel: { map: 'vhar_cuartel', facade: 'vh2_cuartel', ...CITY_BUILDINGS.cuartel },
    torre: { map: 'vhar_torre', facade: 'vh2_torre', ...CITY_BUILDINGS.torre },
} as const satisfies Record<CityBuilding, unknown>;
export type VharBuilding = keyof typeof VHAR_BUILDINGS;

export const VHAR = {
    /** Aparición de personajes nuevos y destino del Portal de Frontera ("volver a la ciudad"): al sur del portal de la plaza. */
    spawn: { ...CITY_SPAWN },
    portal: { ...CITY_PORTAL },
    /** Camino a los Campos de Sal (afuera del portón sur) y llegada desde allá. */
    toLegacy: { ...GATE_SOUTH.toLegacy }, fromLegacy: { ...GATE_SOUTH.fromLegacy },
};

const snow = (ids: number[]) => ids.map((i) => flareTile('snowplains', i));
const SNOW = snow(Array.from({ length: 16 }, (_, i) => 16 + i));
const DEAD = snow([244, 245, 246, 247]);
const BUSHES = snow([112, 113, 124, 125, 126, 127]);
const ROCKS = snow([128, 129, 130, 131]);

/** Puerta de un edificio con interior: la celda de la puerta (disparadora) y la de llegada al salir (un paso hacia la calle). */
export function vharDoor(k: VharBuilding): { door: Cell; out: Cell } {
    const v = VHAR_BUILDINGS[k], b = townBuilding(v.facade), d = b.door!;
    const door = d.side === 'S' ? { x: v.x + d.i, y: v.y + b.h } : { x: v.x + b.w, y: v.y + d.i };
    return { door, out: d.side === 'S' ? { x: door.x, y: door.y + 1 } : { x: door.x + 1, y: door.y } };
}

export function buildVharCiudadela(): WorldMap {
    return buildCity({
        id: VHAR_CITADEL_ID, seed: 20251031, prefix: 'vh2_', faction: 'vhar', name: 'Ciudadela de Vhar', gate: 'S',
        ground: SNOW, cobble: vharTiles('adoquin'), plaza: vharTiles('placa'), ring: vharTiles('runa'),
        outsideTile: (_x, _y, pick) => pick(SNOW),
        trees: DEAD, outsideTrees: DEAD, flowers: BUSHES, rocks: ROCKS,
        lamp: TOWN_PROPS.brasero, flag: TOWN_PROPS.estandarte, treeDensity: { out: 0.045, in: 0.012 },
        guards: [
            ['guardia_v1', 'Guardia del Portón', 28, 46, 6], ['guardia_v2', 'Guardia del Portón', 31, 46, 2],
            ['guardia_v3', 'Guardia de la Plaza', 33, 30, 6], ['guardia_v4', 'Guardia de la Fragua', 43, 28, 2], ['guardia_v5', 'Centinela de la Muralla', 12, 29, 4],
        ],
    });
}
