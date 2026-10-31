/**
 * Remate del Camino de Ceniza en el mapa viejo: un pequeño puesto de paso de adoquín negro junto a la puerta de la ciudad vieja de
 * Vhar (34, 14), con zona segura, dos pilares, braseros y un estandarte. Ahí llega quien sale de la Ciudadela de Vhar, y ahí está el
 * vínculo `legacy_a_ciudadela`. Corre al final de buildSolmar (igual en cliente y server, sin azar).
 */
import type { WorldMap } from '../index';
import { TOWN_PROPS, vharTiles } from '../town';

/** Vínculo de vuelta (pisar la celda) y celda de llegada de quien viene de la ciudadela. */
export const LEGACY_VHAR_LINK = { x: 37, y: 17 }, LEGACY_FROM_VHAR = { x: 35, y: 17 };

export function extendVharGate(w: WorldMap): WorldMap {
    const COBBLE = vharTiles('adoquin');
    for (let y = 15; y <= 19; y++) for (let x = 33; x <= 39; x++) {
        w.safe[y][x] = true;
        if (x >= 34 && x <= 38 && y >= 16 && y <= 18) w.tiles[y][x] = COBBLE[(x * 3 + y) % COBBLE.length];
    }
    // pilares de piedra (los de la puerta de la ciudad vieja) flanqueando el vínculo, braseros y un estandarte; todo fuera del paso
    const prop = (id: number, x: number, y: number) => { w.props = w.props.filter((p) => !(Math.floor(p.x) === x && Math.floor(p.y) === y)); w.props.push({ id, x: x + 0.5, y: y + 0.5 }); w.blocked[y][x] = true; };
    prop(138, 37, 16); prop(138, 37, 18);
    prop(TOWN_PROPS.brasero, 34, 15); prop(TOWN_PROPS.brasero, 38, 19);
    prop(TOWN_PROPS.estandarte, 33, 17);
    return w;
}
