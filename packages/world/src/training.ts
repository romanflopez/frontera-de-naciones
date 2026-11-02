/**
 * Portal de Frontera: cada ciudad tiene UN portal grande con un menú de zonas de entrenamiento, una por mapa abierto de Flare en el orden
 * de los tiers (docs/TIERS_DE_ZONA.md). Viajar te deja en la entrada del mapa (zona segura); para volver se usa "Volver a la ciudad"
 * (tecla H). Cada zona se abre al llegar al nivel mínimo de su mapa (la cadena vieja de misiones quedó jubilada). Los datos y la regla
 * viven acá para que el cliente (dibuja, avisa y bloquea) y el server (valida el viaje, no confía en el cliente) usen lo mismo.
 */
import type { WorldMap, Portal } from './index';
import { HUBS } from './cities';

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
}

const T = (step: number, map: string, zone: string, lvl: number, col: string): TrainingStep => ({ id: map, step, zone, map, lvl, col, after: null });
/** Una zona por mapa abierto de Flare, de T1 a T6. El nivel es el mínimo del `lvl` del mapa (lo comprueba el test de tiers). */
export const TRAINING: TrainingStep[] = [
    T(0, 'campos_de_sal', 'Campos de Sal', 1, '#8fd05a'),
    T(1, 'bosque_de_piedra', 'Bosque de Piedra', 2, '#a6d24e'),
    T(2, 'canon_goblin', 'Cañón goblin', 3, '#c4d24a'),
    T(3, 'pantano_de_merrimead', 'Pantano de Merrimead', 6, '#d3cf4a'),
    T(4, 'altas_de_nazia', 'Altas de Nazia', 8, '#e0b64a'),
    T(5, 'cementerio_de_lochport', 'Cementerio de Lochport', 11, '#e69a48'),
    T(6, 'risco_del_sur', 'Risco del Sur', 13, '#e5804a'),
    T(7, 'la_brecha', 'La Brecha', 16, '#e5654a'),
    T(8, 'paso_de_stormrock', 'Paso de Stormrock', 18, '#7fc6e8'),
    T(9, 'cenizas_i', 'Cenizas I', 21, '#e04a5a'),
    T(10, 'cenizas_ii', 'Cenizas II', 23, '#cf4a86'),
    T(11, 'cenizas_iii', 'Cenizas III', 26, '#a64ad0'),
];
export const TRAINING_IDS = TRAINING.map((t) => t.id);

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
export const trainingUnlocked = (step: number, _qi: number, lvl: number): boolean => { const t = TRAINING[step]; return !!t && lvl >= t.lvl; };

/** Lo que el server (y el cliente) necesitan saber del personaje para decidir si un portal deja pasar. */
export interface PortalProgress { qi: number; lvl: number; keys: Record<string, number>; unlocked: readonly string[] }

/** Motivo por el que el portal no deja pasar, o null si deja. */
export function portalGate(p: Portal, g: PortalProgress): string | null {
    const t = p.train;
    if (t && !g.unlocked.includes(t.id) && !trainingUnlocked(t.step, g.qi, g.lvl)) return `Portal bloqueado (${t.zone}): se abre al llegar al nivel ${t.lvl}.`; // la cadena vieja de misiones quedó jubilada: solo cuenta el nivel (los ya abiertos siguen abiertos)
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
