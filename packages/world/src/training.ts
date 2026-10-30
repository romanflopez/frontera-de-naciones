/**
 * Portales de entrenamiento: cada ciudad tiene UN portal grande (menú con las zonas de entrenamiento en el orden
 * de la cadena de misiones del Capitán) y cada zona un waypoint chico en su entrada para volver. La primera zona está
 * abierta de entrada; cada una de las demás se abre al entregar la misión anterior o al llegar a un nivel mínimo. Los datos y la regla viven acá para que el cliente
 * (los dibuja, avisa y bloquea) y el server (valida el teletransporte, no confía en el cliente) usen lo mismo.
 */
import type { WorldMap, Portal } from './index';
import { HUBS } from './cities';

export interface TrainingStep {
    id: string;
    /** Posición en la cadena de misiones (0 = abierto de entrada). */
    step: number;
    /** Nombre de la zona en `WorldMap.zones` (a donde lleva el portal). */
    zone: string;
    /** Nivel con el que se abre aunque no hayas hecho la misión. */
    lvl: number;
    col: string;
    /** Misión que hay que entregar para abrirlo (null = ninguna). */
    after: string | null;
}

const T = (step: number, id: string, zone: string, lvl: number, col: string, after: string | null): TrainingStep => ({ id, step, zone, lvl, col, after });
export const TRAINING: TrainingStep[] = [
    T(0, 'goblins', 'Campamento goblin', 1, '#8fd05a', null),
    T(1, 'avanzada', 'Avanzada goblin', 3, '#a6d24e', 'Goblins del campamento'),
    T(2, 'hoyos', 'Hoyos de hormiga león', 5, '#d3cf4a', 'La avanzada goblin'),
    T(3, 'pantano', 'Pantano muerto', 7, '#e0b64a', 'Hoyos traicioneros'),
    T(4, 'cementerio', 'Cementerio viejo', 9, '#e69a48', 'El pantano muerto'),
    T(5, 'nigromante', 'Ruinas del nigromante', 11, '#e5804a', 'Huesos inquietos'),
    T(6, 'hormiguero', 'Hormiguero ardiente', 13, '#e5654a', 'Magia prohibida'),
    T(7, 'nidal', 'Nidal de ceniza', 15, '#e04a5a', 'Fuego en el hormiguero'),
    T(8, 'osario', 'Osario ardiente', 17, '#cf4a86', 'Alas de ceniza'),
    T(9, 'cantera', 'Cantera del minotauro', 19, '#a64ad0', 'El osario ardiente'),
];
export const TRAINING_IDS = TRAINING.map((t) => t.id);

/** Waypoint (estilo Diablo): el portal grande de la plaza de cada ciudad y uno chico en la entrada de cada zona de entrenamiento. */
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

/** ¿Está abierto el portal del paso `step` para alguien que entregó `qi` misiones y tiene nivel `lvl`? */
export const trainingUnlocked = (step: number, qi: number, lvl: number): boolean => { const t = TRAINING[step]; return !!t && (qi >= step || lvl >= t.lvl); };

/** Lo que el server (y el cliente) necesitan saber del personaje para decidir si un portal deja pasar. */
export interface PortalProgress { qi: number; lvl: number; keys: Record<string, number>; unlocked: readonly string[] }

/** Motivo por el que el portal no deja pasar, o null si deja. */
export function portalGate(p: Portal, g: PortalProgress): string | null {
    const t = p.train;
    if (t && !g.unlocked.includes(t.id) && !trainingUnlocked(t.step, g.qi, g.lvl)) return `Portal bloqueado (${t.zone}): ${t.after ? `entregá «${t.after}» al Capitán` : 'todavía no'} o llegá al nivel ${t.lvl}.`;
    if (p.key && !(g.keys[p.key] >= 1)) return `La escalera está sellada: necesitás la llave (${p.key}).`;
    return null;
}

/** Celda caminable (desde el campamento de Solmar) a la que llega quien cruza un portal a la zona: cerca del borde, no en medio de los mobs. */
function arrivalFor(w: WorldMap, reach: boolean[][], zoneName: string): { x: number; y: number } {
    const z = w.zones.find((q) => q.name === zoneName);
    if (!z) throw new Error(`zona de entrenamiento desconocida: ${zoneName}`);
    let best: { x: number; y: number } | null = null, bestScore = Infinity;
    for (let y = 1; y < w.size - 1; y++) for (let x = 1; x < w.size - 1; x++) {
        if (!reach[y][x] || w.blocked[y][x] || w.safe[y][x]) continue;
        const d = Math.hypot(x + 0.5 - z.x - 0.5, y + 0.5 - z.y - 0.5);
        if (d < z.r + 1 || d > z.r + 5) continue;
        // sin vecinos bloqueados alrededor, para no aparecer encajonado
        let free = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!w.blocked[y + dy]?.[x + dx]) free++;
        if (free < 8) continue;
        const score = Math.abs(d - (z.r + 2)) * 10 + (Math.abs(x - HUBS.solmar.x) + Math.abs(y - HUBS.solmar.y)) * 0.01;
        if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
    if (!best) throw new Error(`sin celda de llegada para ${zoneName}`);
    return best;
}

/** Destino de un waypoint del menú: 'city' = punto de aparición de la facción, o el id de una zona de entrenamiento. Null si no existe. */
export function waypointDest(w: WorldMap, id: string, faction: string): { x: number; y: number; step?: number } | null {
    if (id === 'city') { const h = HUBS[faction]; return h ? { x: h.x, y: h.y } : null; }
    const t = TRAINING.find((q) => q.id === id), a = w.waypointArrivals?.[id];
    return t && a ? { x: a.x, y: a.y, step: t.step } : null;
}

export function extendTraining(w: WorldMap): WorldMap {
    // celdas alcanzables a pie desde el campamento
    const reach: boolean[][] = Array.from({ length: w.size }, () => new Array<boolean>(w.size).fill(false));
    const q: [number, number][] = [[HUBS.solmar.x, HUBS.solmar.y]]; reach[HUBS.solmar.y][HUBS.solmar.x] = true;
    for (let i = 0; i < q.length; i++) {
        const [x, y] = q[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size || reach[ny][nx] || w.blocked[ny][nx]) continue;
            reach[ny][nx] = true; q.push([nx, ny]);
        }
    }
    const arrivals = TRAINING.map((t) => arrivalFor(w, reach, t.zone));
    const wps: Waypoint[] = [], arr: Record<string, { x: number; y: number }> = {};
    // portal grande de cada ciudad: celda HUB+(3,0), con 3x3 despejado alrededor
    for (const [city, h] of Object.entries(HUBS)) {
        const x = h.x + CITY_PORTAL_OFFSET.x, y = h.y + CITY_PORTAL_OFFSET.y;
        // el 3x3 despejado lo reserva el layout de la ciudad (cities.ts); acá solo exigimos que la celda central sea caminable
        if (w.blocked[y][x]) throw new Error(`el portal de ${city} cae en una celda bloqueada (${x}, ${y}); el layout de la ciudad tiene que dejar libre HUB+(3,0)`);
        wps.push({ id: `city:${city}`, x, y, kind: 'city', name: 'Portal de Frontera', faction: city });
    }
    // waypoint chico pegado a la celda de llegada de cada zona (no sobre ella, para que no se abra solo al llegar)
    TRAINING.forEach((t, i) => {
        const a = arrivals[i]; arr[t.id] = a;
        const c = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const).map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy })).find((q) => !w.blocked[q.y][q.x]);
        if (!c) throw new Error(`sin celda para el waypoint de ${t.zone}`);
        wps.push({ id: `zone:${t.id}`, x: c.x, y: c.y, kind: 'zone', name: t.zone, step: t.step });
    });
    w.waypoints = [...(w.waypoints ?? []), ...wps];
    w.waypointArrivals = arr;
    return w;
}
