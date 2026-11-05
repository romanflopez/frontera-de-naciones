/**
 * Portal de Frontera: cada ciudad tiene UN portal grande con un menú de zonas de entrenamiento, una por mapa abierto de Flare en el orden
 * de los tiers (docs/TIERS_DE_ZONA.md). Viajar te deja en la entrada del mapa (zona segura); para volver se usa "Volver a la ciudad"
 * (tecla H). Cada zona se abre al llegar al nivel mínimo de su mapa (la cadena vieja de misiones quedó jubilada). Los datos y la regla
 * viven acá para que el cliente (dibuja, avisa y bloquea) y el server (valida el viaje, no confía en el cliente) usen lo mismo.
 */
import type { WorldMap, Portal } from './index';
import { HUBS } from './cities';
import { baseMapId, mapForNation } from './nations';

export interface TrainingStep {
    id: string;
    /** Posición en el menú (0 = la primera zona). */
    step: number;
    /** Nombre que se muestra (el del mapa). */
    zone: string;
    /** Mapa al que lleva: se llega a su entrada. */
    map: string;
    /** Nivel con el que se abre (el mínimo del mapa). */
    lvl: number;
    col: string;
    /** Siempre null: la cadena vieja de misiones ya no abre portales (se conserva por compatibilidad con el menú). */
    after: string | null;
    /** El portal no se abre por nivel: hay que llegar a pie a esa zona una vez (la abre el server al entrar al mapa). */
    onFoot?: true;
}

const T = (step: number, map: string, zone: string, lvl: number, col: string, onFoot = false): TrainingStep => ({ id: map, step, zone, map, lvl, col, after: null, ...(onFoot ? { onFoot: true as const } : {}) });
/** Una zona por mapa abierto de Flare, de T1 a T7. El nivel es el mínimo del `lvl` del mapa (lo comprueba el test de tiers). */
export const TRAINING: TrainingStep[] = [
    // el primer campo es uno por nación (FIELD_MAP): el portal a ese campo se abre al llegar a pie una vez (docs/CIUDADES.md §8)
    T(0, 'campos_de_sal', 'Campos de Sal', 1, '#8fd05a', true),
    T(1, 'bosque_de_piedra', 'Bosque de Piedra', 4, '#a6d24e'),
    T(2, 'canon_goblin', 'Cañón goblin', 8, '#c4d24a'),
    T(3, 'pantano_de_merrimead', 'Pantano de Merrimead', 17, '#d3cf4a'),
    T(4, 'altas_de_nazia', 'Altas de Nazia', 23, '#e0b64a'),
    T(5, 'cementerio_de_lochport', 'Cementerio de Lochport', 37, '#e69a48'),
    T(6, 'risco_del_sur', 'Risco del Sur', 45, '#e5804a'),
    T(7, 'la_brecha', 'La Brecha', 55, '#e5654a'),
    T(8, 'paso_de_stormrock', 'Paso de Stormrock', 61, '#7fc6e8'),
    T(9, 'cenizas_i', 'Cenizas I', 69, '#e04a5a'),
    T(10, 'cenizas_ii', 'Cenizas II', 74, '#cf4a86'),
    T(11, 'cenizas_iii', 'Cenizas III', 88, '#a64ad0'),
    T(12, 'granja_roble_negro', 'Granja de Roble Negro', 96, '#b8d06a'),
    T(13, 'oasis_de_ceniza', 'Oasis de Ceniza', 102, '#e8c27a'),
    T(14, 'lago_kuuma', 'Lago Kuuma', 106, '#9fd6f0'),
    T(15, 'laguna_de_la_gruta', 'Laguna de la Gruta', 110, '#c2a8f0'),
    T(16, 'minas_abandonadas', 'Minas abandonadas', 116, '#c98a5a'),
];
export const TRAINING_IDS = TRAINING.map((t) => t.id);

/** Campo de entrada (nivel 1-2) de cada facción: el paso 0 del menú lleva al de la propia nación. */
export const FIELD_MAP: Record<string, string> = { solmar: 'campos_de_sal', vhar: 'campos_de_sal_vhar' };
/** Mapa al que lleva el paso `t` para alguien de la facción `faction`. */
export const trainingMapFor = (t: TrainingStep, faction: string): string => (t.step === 0 ? FIELD_MAP[faction] ?? t.map : mapForNation(t.map, faction));
/** Paso del menú al que pertenece un mapa (los dos campos de entrada cuentan como el paso 0), o undefined. */
export const trainingOfMap = (mapId: string): TrainingStep | undefined => TRAINING.find((t) => t.map === baseMapId(mapId) || (t.step === 0 && Object.values(FIELD_MAP).includes(mapId)));
/** Aviso cuando el portal del paso `t` todavía está cerrado. */
export const trainingLockedMsg = (t: TrainingStep): string =>
    t.onFoot ? `Portal bloqueado (${t.zone}): todavía no conocés el camino. Llegá a pie una vez y se abre.` : `Portal bloqueado (${t.zone}): se abre al llegar al nivel ${t.lvl}.`;

/** Waypoint (estilo Diablo): el Portal de Frontera de la plaza de cada ciudad. `kind: 'zone'` lo usa solo el cliente para dibujar vínculos entre mapas. */
export interface Waypoint {
    id: string;
    /** Celda del waypoint (pararse o hacer click abre el menú). */
    x: number; y: number;
    kind: 'city' | 'zone';
    name: string;
    /** Ciudad (facción) o paso de TRAINING a la que pertenece. */
    faction?: string;
    step?: number;
}
/** Distancia máxima (en celdas) a un waypoint para abrir el menú y para que el server acepte el teletransporte. */
export const WAYPOINT_RANGE = 3;
/** Celda del portal grande de cada ciudad respecto del punto de aparición (HUBS). */
export const CITY_PORTAL_OFFSET = { x: 3, y: 0 };
/** Ciudades del mapa viejo que conservan su Portal de Frontera: ninguna (Solmar y Vhar tienen el suyo en la Villa y en la Ciudadela). */
export const LEGACY_CITY_PORTALS: readonly string[] = [];

/** ¿Está abierto el portal del paso `step` para alguien de nivel `lvl`? (`qi`, el índice de la cadena vieja de misiones, ya no cuenta.) */
export const trainingUnlocked = (step: number, _qi: number, lvl: number): boolean => { const t = TRAINING[step]; return !!t && !t.onFoot && lvl >= t.lvl; };

/** Lo que el server (y el cliente) necesitan saber del personaje para decidir si un portal deja pasar. */
export interface PortalProgress { qi: number; lvl: number; keys: Record<string, number>; unlocked: readonly string[]; /** Nación del personaje (para los enlaces de una sola nación). */ faction?: string }

/** Motivo por el que el portal no deja pasar, o null si deja. */
export function portalGate(p: Portal, g: PortalProgress): string | null {
    const t = p.train;
    if (t && !g.unlocked.includes(t.id) && !trainingUnlocked(t.step, g.qi, g.lvl)) return trainingLockedMsg(t); // la cadena vieja de misiones quedó jubilada: solo cuenta el nivel (los ya abiertos siguen abiertos)
    if (p.key && !(g.keys[p.key] >= 1)) return `La escalera está sellada: necesitás la llave (${p.key}).`;
    return null;
}

export function extendTraining(w: WorldMap): WorldMap {
    const wps: Waypoint[] = [];
    // Portal de Frontera de cada ciudad del mapa viejo: celda HUB+(3,0). Solmar ya no tiene portal acá: su hogar es la Villa de Solmar
    // (el portal está en la plaza de la villa, ver solmar/villa.ts); queda solo el de Vhar.
    for (const [city, h] of Object.entries(HUBS)) {
        if (!LEGACY_CITY_PORTALS.includes(city)) continue;
        const x = h.x + CITY_PORTAL_OFFSET.x, y = h.y + CITY_PORTAL_OFFSET.y;
        // el 3x3 despejado lo reserva el layout de la ciudad (cities.ts); acá solo exigimos que la celda central sea caminable
        if (w.blocked[y][x]) throw new Error(`el portal de ${city} cae en una celda bloqueada (${x}, ${y}); el layout de la ciudad tiene que dejar libre HUB+(3,0)`);
        wps.push({ id: `city:${city}`, x, y, kind: 'city', name: 'Portal de Frontera', faction: city });
    }
    w.waypoints = [...(w.waypoints ?? []), ...wps];
    return w;
}
