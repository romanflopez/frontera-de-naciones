/**
 * Reglas puras de la posición guardada de un personaje (ver docs/MUNDO.md 2.5): a qué mapa vuelve y qué zonas no se guardan.
 */
import { canonicalMapId, getMapDef, isTemporaryCell, type WorldMap } from '@fdn/world';
import type { PersistedPlayer } from './player.ts';
import type { Storage } from './storage.ts';

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

/** `acc:<clave>` -> `<clave>` (las sesiones se identifican por la cuenta). */
export const keyOfNetworkId = (networkId: string): string => (networkId.startsWith('acc:') ? networkId.slice(4) : networkId);

/**
 * Dónde quedó el personaje: primero el registro de la cuenta (sobrevive a los redeploys con Postgres);
 * si la cuenta todavía no tiene posición, el guardado viejo en disco (`legacy`, de `chars/`), que pasa a la cuenta en el próximo `savePosition`.
 */
export function loadPosition(storage: Storage, networkId: string, legacy: (networkId: string) => PersistedPlayer | undefined): PersistedPlayer | undefined {
    return storage.get(keyOfNetworkId(networkId))?.pos ?? legacy(networkId);
}

/** Guarda la posición en la cuenta (con el mismo debounce que el resto). Las zonas temporales se reemplazan por su punto de descanso. */
export function savePosition(storage: Storage, networkId: string, state: PersistedPlayer | undefined, mapOf: (id: string) => WorldMap): void {
    const s = restPosition(state, mapOf), key = keyOfNetworkId(networkId), acc = s && storage.get(key);
    if (s && acc) { acc.pos = s; storage.put(key, acc); }
}
