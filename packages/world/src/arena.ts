/**
 * Arenas 2v2 y 3v3 (docs/PARTY_Y_ARENAS.md §2): tres claros chicos con distinta cobertura, para que la pelea sea de manejar la distancia y
 * no de esconderse detrás de una pared. Usan las piezas de pasto de Flare (CC-BY-SA 3.0) que ya están en el atlas `flare_grassland`. Son
 * deterministas (semilla fija): cliente y server arman lo mismo.
 *
 * No tienen portal: se entra por la cola (`/arena 2v2` o `/arena 3v3`, apps/server/src/arena.ts), que arma una instancia por partida.
 * Un GM puede ir a mirarlas con `/gm ir arena_ruinas`; sin partida son todos contra todos.
 */
import type { Prop, WorldMap } from './index';
import { flareTile } from './flare/types';

/** Lado del mapa, ancho del borde de bosque y lugares fijos. Los dos equipos arrancan enfrentados a 18 celdas, sobre el eje largo. */
export const ARENA = {
    id: 'arena', size: 34, border: 4,
    /** Dónde arranca cada equipo (en 2v2 y 3v3 los compañeros van arriba y abajo, ver `arenaStarts`). */
    teamA: { x: 8, y: 17 }, teamB: { x: 26, y: 17 },
    center: { x: 17, y: 17 },
} as const;

export type ArenaLayout = 'claro' | 'ruinas' | 'muros';
export type ArenaMode = '2v2' | '3v3';
export const ARENA_MODES: readonly ArenaMode[] = ['2v2', '3v3'];
export const arenaTeamSize = (mode: ArenaMode): number => (mode === '3v3' ? 3 : 2);

/**
 * Las arenas que abre la cola, en rotación. Las tres tienen el mismo tamaño y los mismos puestos de salida; cambia la cobertura:
 * - Claro: cuatro piedras bajas, casi todo abierto (la arena original).
 * - Ruinas: seis columnas en dos anillos, para cortar líneas de tiro y kitear alrededor.
 * - Muros: dos muros cortos que parten el centro en tres pasillos, con el ruedo libre.
 */
export const ARENA_MAPS: readonly { id: string; name: string; layout: ArenaLayout }[] = [
    { id: 'arena', name: 'Arena del Claro', layout: 'claro' },
    { id: 'arena_ruinas', name: 'Arena de las Ruinas', layout: 'ruinas' },
    { id: 'arena_muros', name: 'Arena de los Muros', layout: 'muros' },
];
export const isArenaMap = (id: string | undefined): boolean => !!id && ARENA_MAPS.some((a) => a.id === id);

/** Celdas bloqueadas por cobertura en cada arena (simétricas respecto del centro y lejos de los puestos de salida). */
const COVER: Record<ArenaLayout, readonly (readonly [number, number])[]> = {
    claro: [[13, 11], [21, 11], [13, 23], [21, 23]],
    ruinas: [[12, 12], [22, 12], [12, 22], [22, 22], [17, 9], [17, 25]],
    muros: [[15, 11], [16, 11], [17, 11], [18, 11], [19, 11], [15, 23], [16, 23], [17, 23], [18, 23], [19, 23]],
};

/**
 * Puestos de salida de un equipo (0 = oeste, 1 = este): el primero en el centro del puesto y los compañeros a 2 celdas arriba y abajo.
 * Son las celdas de la "jaula" de la preparación (ver `ARENA_RULES.cageR`).
 */
export function arenaStarts(team: 0 | 1, n: number): { x: number; y: number }[] {
    const c = team === 0 ? ARENA.teamA : ARENA.teamB;
    return [{ x: c.x, y: c.y }, { x: c.x, y: c.y - 2 }, { x: c.x, y: c.y + 2 }].slice(0, Math.max(1, Math.min(3, n)));
}

/** Reglas de la partida y de la cola (docs/PARTY_Y_ARENAS.md §2). */
export const ARENA_RULES = {
    /** Para aceptar la partida encontrada. */
    acceptMs: 30_000,
    /** Preparación en las jaulas (no hay daño y no se sale del puesto). */
    prepMs: 60_000,
    /** Pelea: si nadie gana antes, empate. */
    fightMs: 15 * 60_000,
    /** Festejo antes de volver al punto de entrada. */
    endMs: 5_000,
    /** Curación y regeneración de vida: −20 % cada 3 minutos de pelea, hasta quedar en 20 %. */
    healDecayEveryMs: 3 * 60_000, healDecayStep: 0.2, healFloor: 0.2,
    /** Usos de invisibilidad por jugador y por partida. */
    invisUses: 3,
    /** Radio de la jaula alrededor del puesto de salida durante la preparación. */
    cageR: 1.5,
    /** Penalización por salir de la cola, rechazar o dejar vencer la invitación, o abandonar la partida [DM]. */
    penaltyMs: 10 * 60_000,
    /** Para entrar a la cola: tantos segundos sin pelear con otro jugador. */
    pvpQuietMs: 15_000,
    /** Partidas jugadas para aparecer en el ranking de la temporada. */
    rankedMin: 10,
    /** Partidas a la vez (una instancia por partida). */
    maxMatches: 6,
} as const;

/** Multiplicador de toda curación y regeneración de vida a los `elapsedMs` de pelea: 1 → 0,8 a los 3 min → … → 0,2 desde los 12 min. */
export function arenaHealMult(elapsedMs: number): number {
    const steps = Math.floor(Math.max(0, elapsedMs) / ARENA_RULES.healDecayEveryMs);
    return Math.max(ARENA_RULES.healFloor, Math.round((1 - steps * ARENA_RULES.healDecayStep) * 100) / 100);
}

const GRASS = Array.from({ length: 16 }, (_, i) => 16 + i);
const COBBLE = Array.from({ length: 12 }, (_, i) => 32 + i);
const COBBLE_EDGE = [44, 45, 46, 47];
const TREES = [248, 249, 250, 251, 252, 253, 254, 255];
const BUSHES = [240, 241, 242, 243];
const TUFTS = [125, 127, 122, 123];
const ROCKS = [128, 129, 130, 131];
/** Piezas de Flare que usan las arenas: el atlas las incluye aunque ningún mapa importado las use (tools/src/flare/mapatlas.ts). */
export const ARENA_FLARE_IDS: Record<string, number[]> = { grassland: [...GRASS, ...COBBLE, ...COBBLE_EDGE, ...TREES, ...BUSHES, ...TUFTS, ...ROCKS] };

const makeRnd = (seed0: number) => {
    let seed = seed0;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { rnd, pick: <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] };
};

/** La arena del Claro con la semilla original (el hash del mapa 'arena' no cambia); las otras usan su propia semilla y cobertura. */
export function buildArena(layout: ArenaLayout = 'claro'): WorldMap {
    const { size: N, border: B, teamA, teamB, center } = ARENA;
    const { rnd, pick } = makeRnd(layout === 'claro' ? 1122 : layout === 'ruinas' ? 2233 : 3344);
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
    // cobertura: piedras (claro y ruinas) o matas tupidas en fila (muros); bloquean el paso y cortan una línea de tiro
    for (const [x, y] of COVER[layout]) { props.push({ id: g(pick(layout === 'muros' ? BUSHES : ROCKS)), x, y }); blocked[y][x] = true; }
    // matas de pasto sueltas (no bloquean), lejos de los puestos de salida
    for (let y = B; y < N - B; y++) for (let x = B; x < N - B; x++) {
        if (blocked[y][x] || near(x, y, center, 5.5) || near(x, y, teamA, 3) || near(x, y, teamB, 3)) continue;
        if (rnd() < 0.05) props.push({ id: g(pick(TUFTS)), x, y });
    }
    return { size: N, tiles, blocked, safe, props, decals: [], zones: [], buildings: [], npcs: [], spawn: { ...teamA }, fire: { x: -50, y: -50 } };
}
