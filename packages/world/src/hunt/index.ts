/**
 * Núcleo de caza (Fase 3 de docs/MUNDO.md): los cuatro mapas grandes con pits de mobs y sus vínculos.
 *   Villa de Solmar -> Llanos del Alba (Nv 1-2) -> La Frontera (Nv 3-4) -> Camposanto Viejo (Nv 5) -> Páramo Reseco (Nv 5)
 *   Llanos del Alba <-> Tierras de Solmar (el mapa viejo, camino hacia Vhar); Páramo -> escalera sellada de la Cripta (mapa viejo).
 * Cada mapa tiene su campamento seguro con fogata (respawn propio) junto a la entrada.
 */
import type { MapDef } from '../maps';
import { buildLlanos, LLANOS } from './llanos';
import { buildFrontera, FRONTERA } from './frontera';
import { buildCamposanto, CAMPOSANTO } from './camposanto';
import { buildParamo, PARAMO } from './paramo';

export { LLANOS, FRONTERA, CAMPOSANTO, PARAMO, buildLlanos, buildFrontera, buildCamposanto, buildParamo };
export { HuntMap } from './kit';

/** Celdas del mapa viejo y de la villa que tocan los vínculos del núcleo de caza (las define maps.ts y se pasan acá). */
export interface HuntAnchors {
    villa: { id: string; toLlanos: { x: number; y: number }; fromLlanos: { x: number; y: number } };
    legacy: { id: string; toLlanos: { x: number; y: number }; fromLlanos: { x: number; y: number }; toParamo: { x: number; y: number }; crypt: { x: number; y: number } };
}

/** Llegada del menú del Portal de Frontera a cada zona de entrenamiento que vive en un mapa de caza (id de TRAINING -> mapa y celda). */
export const HUNT_ARRIVALS: Record<string, { map: string; x: number; y: number }> = {
    goblins: { map: LLANOS.id, ...LLANOS.arrivals.goblins },
    avanzada: { map: LLANOS.id, ...LLANOS.arrivals.avanzada },
    hoyos: { map: FRONTERA.id, ...FRONTERA.arrivals.hoyos },
    pantano: { map: FRONTERA.id, ...FRONTERA.arrivals.pantano },
    cementerio: { map: CAMPOSANTO.id, ...CAMPOSANTO.arrivals.cementerio },
    nigromante: { map: CAMPOSANTO.id, ...CAMPOSANTO.arrivals.nigromante },
};

export function huntMaps(a: HuntAnchors): Record<string, MapDef> {
    const L = LLANOS, F = FRONTERA, C = CAMPOSANTO, P = PARAMO;
    return {
        [L.id]: {
            id: L.id, name: 'Llanos del Alba', region: 'inicio', size: L.size, lvl: [1, 2], pvp: 'off', safe: false,
            spawn: { ...L.fromVilla }, respawn: { ...L.respawn },
            links: [
                { id: 'llanos_a_villa', map: L.id, ...L.toVilla, to: { map: a.villa.id, ...a.villa.fromLlanos }, kind: 'walk', msg: 'Tomás el Camino de la Marea hacia la Villa de Solmar.' },
                { id: 'llanos_a_legacy', map: L.id, ...L.toLegacy, to: { map: a.legacy.id, ...a.legacy.fromLlanos }, kind: 'walk', msg: 'Seguís el camino del norte hacia las Tierras de Solmar.' },
                { id: 'llanos_a_frontera', map: L.id, ...L.toFrontera, to: { map: F.id, ...F.fromLlanos }, kind: 'walk', msg: 'Cruzás el Paso de la Frontera.' },
            ],
            build: buildLlanos,
        },
        [F.id]: {
            id: F.id, name: 'La Frontera', region: 'comun', size: F.size, lvl: [3, 4], pvp: 'faction', safe: false,
            spawn: { ...F.fromLlanos }, respawn: { ...F.respawn },
            links: [
                { id: 'frontera_a_llanos', map: F.id, ...F.toLlanos, to: { map: L.id, ...L.fromFrontera }, kind: 'walk', msg: 'Volvés por el Paso de la Frontera a los Llanos del Alba.' },
                { id: 'frontera_a_camposanto', map: F.id, ...F.toCamposanto, to: { map: C.id, ...C.fromFrontera }, kind: 'walk', msg: 'Bajás por el camino del sur hacia el Camposanto Viejo.' },
            ],
            build: buildFrontera,
        },
        [C.id]: {
            id: C.id, name: 'Camposanto Viejo', region: 'comun', size: C.size, lvl: [5, 5], pvp: 'faction', safe: false,
            spawn: { ...C.fromFrontera }, respawn: { ...C.respawn },
            links: [
                { id: 'camposanto_a_frontera', map: C.id, ...C.toFrontera, to: { map: F.id, ...F.fromCamposanto }, kind: 'walk', msg: 'Subís por el camino del norte a La Frontera.' },
                { id: 'camposanto_a_paramo', map: C.id, ...C.toParamo, to: { map: P.id, ...P.fromCamposanto }, kind: 'walk', msg: 'Salís por el portón sur hacia el Páramo Reseco.' },
            ],
            build: buildCamposanto,
        },
        [P.id]: {
            id: P.id, name: 'Páramo Reseco', region: 'comun', size: P.size, lvl: [5, 5], pvp: 'faction', safe: false,
            spawn: { ...P.fromCamposanto }, respawn: { ...P.respawn },
            links: [
                { id: 'paramo_a_camposanto', map: P.id, ...P.toCamposanto, to: { map: C.id, ...C.fromParamo }, kind: 'walk', msg: 'Volvés al Camposanto Viejo por el portón sur.' },
                // la Cripta sigue en el mapa viejo (Fase 5 la mueve a sus propios mapas): la escalera sellada lleva a su sala de entrada
                { id: 'paramo_a_cripta', map: P.id, ...P.crypt, to: { map: a.legacy.id, ...a.legacy.crypt }, kind: 'door', gate: { key: 'cripta' }, msg: 'Bajás por la escalera de caracol a la Cripta olvidada.' },
            ],
            build: buildParamo,
        },
    };
}
