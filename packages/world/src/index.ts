/**
 * El mundo de Solmar: el mismo mapa del prototipo, armado con una semilla fija para que
 * cliente y server generen exactamente lo mismo (el cliente lo dibuja, el server decide
 * qué celdas se pueden pisar).
 *
 * Coordenadas de grilla: x crece hacia el sudeste de la pantalla y y hacia el sudoeste
 * (vista isométrica 2:1). Los ids de tiles y objetos son los del tileset de pasto de Flare.
 */

import { extendSolmar } from './frontier';
import { extendAshlands } from './ashlands';

export const MAP_SIZE = 40;

export interface Prop { id: number; x: number; y: number; /** profundidad al ordenar (por defecto x + y) */ d?: number }
/** Edificio decorativo: ocupa w x h celdas desde (x, y) (esquina norte) y bloquea el paso. */
export interface Building { id: string; x: number; y: number; w: number; h: number }
/** Personaje no jugador quieto; ocupa su celda. dir: 0 = oeste, en sentido horario (6 = sur). */
export interface Npc { id: string; name: string; x: number; y: number; dir: number }
export interface Zone { type: 'goblin' | 'zombie' | 'skeleton' | 'barbaro' | 'goblin_elite' | 'antlion' | 'skeleton_mage' | 'fire_ant' | 'wyvern' | 'minotaur' | 'arana' | 'golem' | 'demonio'; x: number; y: number; r: number; n: number; name: string }

export interface WorldMap {
    size: number;
    /** Id del tile de piso de cada celda, [y][x]. */
    tiles: number[][];
    blocked: boolean[][];
    /** Zona segura (el campamento): los mobs no entran y se regenera más rápido. */
    safe: boolean[][];
    props: Prop[];
    decals: Prop[];
    zones: Zone[];
    buildings: Building[];
    npcs: Npc[];
    /** Dónde aparece un personaje nuevo. */
    spawn: { x: number; y: number };
    /** Celda de la fogata, para la luz. */
    fire: { x: number; y: number };
    /** Escaleras entre zonas del mismo mapa: al terminar de pisar (x, y) se pasa a (tx, ty). */
    portals?: { x: number; y: number; tx: number; ty: number; msg: string; /** id de la llave que pide para pasar (la escalera está sellada sin ella) */ key?: string }[];
    /** Rectángulo de la cripta (el cliente la oscurece). */
    dungeon?: { x0: number; y0: number; x1: number; y1: number };
    /** Otras mazmorras (Cámara del foso): el cliente las oscurece igual. */
    dungeons?: { x0: number; y0: number; x1: number; y1: number }[];
}

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const PATH = [44, 45, 46, 47];

export function buildSolmar(): WorldMap {
    const N = MAP_SIZE;
    let seed = 7331;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];

    const tiles: number[][] = [], blocked: boolean[][] = [], safe: boolean[][] = [];
    const props: Prop[] = [], decals: Prop[] = [];
    for (let y = 0; y < N; y++) {
        tiles.push([]); blocked.push([]); safe.push([]);
        for (let x = 0; x < N; x++) {
            const city = x >= 2 && x <= 10 && y >= 2 && y <= 10;
            tiles[y].push(city ? pick(STONE) : pick(GRASS));
            blocked[y].push(x === 0 || y === 0 || x === N - 1 || y === N - 1);
            safe[y].push(city);
        }
    }
    const isPath: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const carve = (x0: number, y0: number, x1: number, y1: number) => {
        let x = x0, y = y0;
        while (x !== x1 || y !== y1) {
            if (!safe[y][x]) { tiles[y][x] = pick(PATH); isPath[y][x] = true; }
            if (x !== x1 && (rnd() < 0.6 || y === y1)) x += Math.sign(x1 - x); else y += Math.sign(y1 - y);
        }
    };
    carve(11, 6, 17, 17); carve(11, 4, 28, 11); carve(17, 17, 29, 29);
    const prop = (id: number, x: number, y: number, block: boolean) => { props.push({ id, x: x + 0.5, y: y + 0.5 }); if (block) blocked[y][x] = true; };

    // cerco del campamento con portones
    for (let i = 1; i <= 11; i++) {
        if (!(i === 4 || i === 6)) prop(104, 11, i, true);
        if (i !== 6) prop(107, i, 11, true);
        prop(104, 1, i, true); prop(107, i, 1, true);
    }
    decals.push({ id: 264, x: 5.5, y: 5.5 });
    prop(102, 8, 8, true); prop(76, 3, 3, true); prop(77, 3, 8, true); prop(101, 4, 3, true); prop(103, 8, 3, true);
    prop(96, 9, 3, true); prop(98, 9, 4, true); prop(100, 2, 6, true); prop(138, 12, 5, false);

    // zonas temáticas
    const zones: Zone[] = [
        { type: 'goblin', x: 16, y: 18, r: 5, n: 3, name: 'Campamento goblin' },
        { type: 'zombie', x: 28, y: 11, r: 5, n: 3, name: 'Pantano muerto' },
        { type: 'skeleton', x: 29, y: 29, r: 5, n: 2, name: 'Cementerio viejo' },
        { type: 'barbaro', x: 34, y: 20, r: 2, n: 1, name: 'Guarida del bárbaro' },
        { type: 'goblin_elite', x: 22, y: 5, r: 3, n: 3, name: 'Avanzada goblin' },
        { type: 'antlion', x: 6, y: 20, r: 4, n: 3, name: 'Hoyos de hormiga león' },
        { type: 'skeleton_mage', x: 8, y: 33, r: 4, n: 2, name: 'Ruinas del nigromante' },
        { type: 'fire_ant', x: 34, y: 6, r: 3, n: 3, name: 'Hormiguero ardiente' },
        { type: 'wyvern', x: 20, y: 35, r: 3, n: 2, name: 'Nido de wyverns' },
        { type: 'minotaur', x: 36, y: 34, r: 2, n: 1, name: 'Laberinto del minotauro' },
        // más lejos del campamento = boss más duro (van al final para no mover los índices de arriba)
        { type: 'arana', x: 10, y: 28, r: 2, n: 1, name: 'Nido de la araña' },
        { type: 'golem', x: 20, y: 36, r: 2, n: 1, name: 'Cueva del gólem de hielo' },
        { type: 'demonio', x: 35, y: 35, r: 2, n: 1, name: 'Foso del demonio' },
    ];
    const near = (x: number, y: number, z: Zone, r: number) => Math.hypot(x - z.x, y - z.y) < r;
    prop(102, 15, 15, true); prop(100, 19, 20, true); prop(99, 14, 16, true); prop(97, 18, 15, true); prop(101, 13, 19, true);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (blocked[y][x] || safe[y][x] || isPath[y][x]) continue;
        if (x < 13 && y < 13) continue;
        const r = rnd(), swamp = near(x, y, zones[1], 7), grave = near(x, y, zones[2], 6);
        if (grave && r < 0.1) { prop(pick([140, 141, 142, 143]), x, y, true); continue; }
        if (r < (swamp ? 0.07 : 0.05)) prop(swamp || grave ? pick([244, 245, 246, 247]) : pick([248, 249, 250, 251, 252, 253, 254, 255, 240, 241]), x, y, true);
        else if (r < 0.075) prop(pick([128, 129, 130, 131]), x, y, true);
        else if (r < 0.085) prop(pick([136, 137]), x, y, true);
        else if (r < 0.16) prop(pick([112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127]), x, y, false);
    }

    // casa del campamento (Fantasy House, 3x3) y el mercader, que también ocupa su celda
    const buildings: Building[] = [{ id: 'fantasy_house', x: 5, y: 2, w: 3, h: 3 }];
    for (const b of buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) blocked[y][x] = true;
    const npcs: Npc[] = [{ id: 'mercader', name: 'Mercader', x: 9, y: 7, dir: 6 }, { id: 'capitan', name: 'Capitán Aldric', x: 6, y: 10, dir: 2 }];
    for (const n of npcs) blocked[n.y][n.x] = true;
    return extendAshlands(extendSolmar({ size: N, tiles, blocked, safe, props, decals, zones, buildings, npcs, spawn: { x: 6, y: 7 }, fire: { x: 8, y: 8 } }));
}

/** Mapas por nombre (el que figura en worlds.json del server). */
export const MAPS: Record<string, () => WorldMap> = { solmar: buildSolmar };
