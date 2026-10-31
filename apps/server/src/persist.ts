/**
 * Reglas puras de la posición guardada de un personaje (ver docs/MUNDO.md 2.5): a qué mapa vuelve y qué zonas no se guardan.
 */
import { canonicalMapId, getMapDef, isTemporaryCell, type WorldMap } from '@fdn/world';
import type { PersistedPlayer } from './player.ts';

/**
 * Qué guardado usar al entrar. Un guardado sin `mapId` (anterior al registro de mapas) usa su `worldId`, donde 'solmar' vale como el mapa
 * original; uno sin ningún mapa, o con un mapa que ya no existe, se descarta y el personaje aparece en el mapa por defecto sin crashear.
 */
export function resolveSaved(saved: PersistedPlayer | undefined, defaultMap: string): { persisted?: PersistedPlayer; mapId: string } {
    const m = canonicalMapId(saved?.mapId ?? saved?.worldId);
    if (saved && m && getMapDef(m)) return { persisted: { ...saved, mapId: m, worldId: m }, mapId: m };
    return { mapId: defaultMap };
}

/** Las zonas temporales (arena, mazmorras) no se guardan como posición: se vuelve al `rest` del mapa o a su spawn. */
export function restPosition(state: PersistedPlayer | undefined, mapOf: (id: string) => WorldMap): PersistedPlayer | undefined {
    if (!state) return state;
    const def = getMapDef(state.mapId ?? state.worldId);
    if (!def) return state;
    if (!isTemporaryCell(def, mapOf(def.id), state.x, state.y)) return { ...state, mapId: def.id, worldId: def.id };
    const to = def.rest ?? { map: def.id, x: def.spawn.x, y: def.spawn.y };
    return { ...state, mapId: to.map, worldId: to.map, x: to.x, y: to.y };
}
