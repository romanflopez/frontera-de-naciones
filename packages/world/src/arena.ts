/**
 * Mapa de las arenas 1v1 y 2v2 (docs/PARTY_Y_ARENAS.md §2): un claro chico, plano y casi sin obstáculos, para que la pelea sea de manejar
 * la distancia y no de esconderse detrás de una pared. Usa las piezas de pasto de Flare (CC-BY-SA 3.0) que ya están en el
 * atlas `flare_grassland`. Es determinista (semilla fija): cliente y server arman lo mismo.
 *
 * Todavía no tiene entrada: la cola, el emparejador y la partida (arena.ts del server) son trabajo aparte. Mientras tanto queda como mapa
 * de pruebas (`debugOnly`) y un GM puede ir a probar el espacio.
 */
import type { Prop, WorldMap } from './index';
import { flareTile } from './flare/types';

/** Lado del mapa, ancho del borde de bosque y lugares fijos. Los dos equipos arrancan enfrentados a 18 celdas, sobre el eje largo. */
export const ARENA = {
    id: 'arena', size: 34, border: 4,
    /** Dónde arranca cada equipo (en 2v2, el compañero va a la celda de al lado). */
    teamA: { x: 8, y: 17 }, teamB: { x: 26, y: 17 },
    center: { x: 17, y: 17 },
} as const;

const GRASS = Array.from({ length: 16 }, (_, i) => 16 + i);
const COBBLE = Array.from({ length: 12 }, (_, i) => 32 + i);
const COBBLE_EDGE = [44, 45, 46, 47];
const TREES = [248, 249, 250, 251, 252, 253, 254, 255];
const BUSHES = [240, 241, 242, 243];
const TUFTS = [125, 127, 122, 123];
const ROCKS = [128, 129, 130, 131];
/** Piezas de Flare que usa la arena: el atlas las incluye aunque ningún mapa importado las use (tools/src/flare/mapatlas.ts). */
export const ARENA_FLARE_IDS: Record<string, number[]> = { grassland: [...GRASS, ...COBBLE, ...COBBLE_EDGE, ...TREES, ...BUSHES, ...TUFTS, ...ROCKS] };

const makeRnd = (seed0: number) => {
    let seed = seed0;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { rnd, pick: <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] };
};

export function buildArena(): WorldMap {
    const { size: N, border: B, teamA, teamB, center } = ARENA;
    const { rnd, pick } = makeRnd(1122);
    const g = (id: number) => flareTile('grassland', id);
    const tiles: number[][] = [], blocked: boolean[][] = [], safe: boolean[][] = [];
    const props: Prop[] = [];
    const inside = (x: number, y: number) => x >= B && y >= B && x < N - B && y < N - B;
    const near = (x: number, y: number, c: { x: number; y: number }, r: number) => Math.hypot(x - c.x, y - c.y) <= r;
    for (let y = 0; y < N; y++) {
        tiles.push([]); blocked.push([]); safe.push([]);
        for (let x = 0; x < N; x++) {
            // el ruedo del centro y los dos puestos de salida van empedrados; el borde del empedrado se deshace en pasto
            const d = Math.min(Math.hypot(x - center.x, y - center.y) - 4.5, Math.hypot(x - teamA.x, y - teamA.y) - 1.8, Math.hypot(x - teamB.x, y - teamB.y) - 1.8);
            tiles[y].push(g(d <= 0 ? pick(COBBLE) : d <= 0.9 ? pick(COBBLE_EDGE) : pick(GRASS)));
            blocked[y].push(!inside(x, y));
            safe[y].push(false);
        }
    }
    // borde de bosque tupido (no se cruza): árboles y matas sobre el pasto
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (inside(x, y)) continue;
        const r = rnd();
        if (r < 0.5) props.push({ id: g(pick(TREES)), x, y });
        else if (r < 0.75) props.push({ id: g(pick(BUSHES)), x, y });
    }
    // cuatro piedras bajas, simétricas y lejos del centro: cortan una línea de tiro pero no sirven de pasillo para esconderse
    for (const [x, y] of [[13, 11], [21, 11], [13, 23], [21, 23]] as const) { props.push({ id: g(pick(ROCKS)), x, y }); blocked[y][x] = true; }
    // matas de pasto sueltas (no bloquean), lejos de los puestos de salida
    for (let y = B; y < N - B; y++) for (let x = B; x < N - B; x++) {
        if (blocked[y][x] || near(x, y, center, 5.5) || near(x, y, teamA, 3) || near(x, y, teamB, 3)) continue;
        if (rnd() < 0.05) props.push({ id: g(pick(TUFTS)), x, y });
    }
    return { size: N, tiles, blocked, safe, props, decals: [], zones: [], buildings: [], npcs: [], spawn: { ...teamA }, fire: { x: -50, y: -50 } };
}
