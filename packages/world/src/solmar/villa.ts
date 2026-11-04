/**
 * Villa de Solmar, rediseñada (docs/CIUDADES.md): ciudad de 58x58 con muralla de arenisca, cuatro torres, plaza central con el Portal de
 * Frontera, ocho edificios con interior y portón al este (camino a los Campos de Sal). La planta y el constructor son los mismos que
 * los de la Ciudadela de Vhar (ver ./city.ts); acá se eligen los materiales: pasto adentro, bosque afuera, adoquín claro.
 *
 * Arte: edificios propios pre-renderizados en Blender (`sm2_*`, tools/src/iso3d/city_edificios.py); pisos y objetos del kit de Screaming
 * Brain Studios (CC0, town.webp) y árboles, flores y piedras de Flare (CC-BY-SA, world.webp).
 */
import type { WorldMap } from '../index';
import { TOWN_PROPS, townBuilding, townTile } from '../town';
import { buildCity, CITY_BUILDINGS, CITY_N, CITY_PORTAL, CITY_SPAWN, GATE_EAST, type CityBuilding } from './city';
import { noise2, type Cell } from './kit';

export const VILLA_ID = 'solmar_villa';
/** 6 celdas más que la ciudad base: el mar ocupa el sur. */
export const VILLA_N = CITY_N + 6;
/** Edificios con interior: id del mapa interior, fachada y esquina norte en la villa. */
export const VILLA_BUILDINGS = {
    ayuntamiento: { map: 'solmar_ayuntamiento', facade: 'sm2_ayuntamiento', ...CITY_BUILDINGS.ayuntamiento },
    templo: { map: 'solmar_templo', facade: 'sm2_templo', ...CITY_BUILDINGS.templo },
    joyeria: { map: 'solmar_joyeria', facade: 'sm2_joyeria', ...CITY_BUILDINGS.joyeria },
    tienda: { map: 'solmar_tienda', facade: 'sm2_tienda', ...CITY_BUILDINGS.tienda },
    herreria: { map: 'solmar_herreria', facade: 'sm2_herreria', ...CITY_BUILDINGS.herreria },
    deposito: { map: 'solmar_deposito', facade: 'sm2_deposito', ...CITY_BUILDINGS.deposito },
    cuartel: { map: 'solmar_cuartel', facade: 'sm2_cuartel', ...CITY_BUILDINGS.cuartel },
    torre: { map: 'solmar_torre', facade: 'sm2_torre', ...CITY_BUILDINGS.torre },
} as const satisfies Record<CityBuilding, unknown>;
export type VillaBuilding = keyof typeof VILLA_BUILDINGS;

export const VILLA = {
    /** Aparición de personajes nuevos y destino del Portal de Frontera ("volver a la ciudad"): al sur del portal de la plaza. */
    spawn: { ...CITY_SPAWN },
    portal: { ...CITY_PORTAL },
    /** Camino a los Campos de Sal (afuera del portón este) y llegada desde allá. */
    toLegacy: { ...GATE_EAST.toLegacy }, fromLegacy: { ...GATE_EAST.fromLegacy },
};

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const FLOWERS = [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127];
const LEAFY = [240, 241, 242, 243, 252, 253, 254, 255];
const PINES = [248, 249, 250, 251];
const ROCKS = [128, 129, 130, 131];
const COBBLE = [1218, 1237, 1238, 1218];
const PLAZA = [1266, 1265, 1266];
const PLAZA_RING = [1258];
const FOREST = Array.from({ length: 18 }, (_, i) => townTile('forest', i)).filter((_, i) => i !== 5 && i !== 15 && i !== 16);

/** Puerta de un edificio con interior: la celda de la puerta (disparadora) y la de llegada al salir (un paso hacia la calle). */
export function villaDoor(k: VillaBuilding): { door: Cell; out: Cell } {
    const v = VILLA_BUILDINGS[k], b = townBuilding(v.facade), d = b.door!;
    const door = d.side === 'S' ? { x: v.x + d.i, y: v.y + b.h } : { x: v.x + b.w, y: v.y + d.i };
    return { door, out: d.side === 'S' ? { x: door.x, y: door.y + 1 } : { x: door.x + 1, y: door.y } };
}

export function buildSolmarVilla(): WorldMap {
    return buildCity({
        id: VILLA_ID, seed: 20251030, prefix: 'sm2_', faction: 'solmar', name: 'Villa de Solmar', gate: 'E', size: VILLA_N, harbor: true,
        ground: GRASS, cobble: COBBLE, plaza: PLAZA, ring: PLAZA_RING,
        outsideTile: (x, y, pick) => (noise2(x, y, 3, 6) > 0.45 ? pick(FOREST) : pick(GRASS)),
        trees: LEAFY, outsideTrees: [...PINES, ...LEAFY], flowers: FLOWERS, rocks: ROCKS,
        lamp: TOWN_PROPS.farol, flag: TOWN_PROPS.bandera,
        guards: [
            ['guardia_s1', 'Guardia del Portón', 46, 28, 4], ['guardia_s2', 'Guardia del Portón', 46, 31, 4],
            ['guardia_s3', 'Guardia de la Plaza', 33, 30, 6], ['guardia_s4', 'Guardia de la Muralla', 12, 29, 2], ['guardia_s5', 'Vigía de la Torre', 46, 22, 2],
        ],
    });
}
