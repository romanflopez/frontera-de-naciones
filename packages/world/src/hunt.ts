/**
 * Mapas de caza generados (etapa E6 del diseño de nivel 120): abiertos, limpios para PvP (casi nada bloqueado, pocos props) y con la
 * densidad de un mapa de caza de la referencia (~180 mobs en 150x150). Son deterministas (misma semilla en cliente y server) y usan el
 * arte genérico de los mapas de prueba hasta que llegue el frente de arte. Cada mapa lleva un portal de entrada y uno de salida con su
 * zona segura; los mobs se reparten en pits de tres niveles (A bajo, B medio, C alto) como en los demás mapas de caza.
 */
import type { Prop, WorldMap, Zone } from './index';
import type { Link, MapDef } from './maps';
import type { MobType } from './mobs';
import { ROCKS } from './frontier';
import { makeRnd } from './testmaps';
import { pitLevel, TIERS, type Tier } from './tiers';

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const TREES = [248, 249, 250, 251, 252, 253, 254, 255, 240, 241];
const FLOWERS = [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127];
const SAFE_R = 4;

interface Cell { x: number; y: number }
export interface HuntSpec {
    id: string; name: string; size: number; seed: number; tier: Tier; lvl: [number, number];
    /** Portal por donde se entra (y vuelve) y celda de llegada, y portal de salida hacia el mapa siguiente con su llegada. */
    back: Cell; arrive: Cell; next?: Cell; nextArrive?: Cell;
    /** Terreno: porcentaje de celdas de piedra en vez de pasto (0-1). */
    stone: number;
    mobs: MobType[];
}

/** Ocho zonas de 22 mobs repartidas en tres pits de nivel. */
function huntZones(s: HuntSpec): Zone[] {
    const N = s.size, zones: Zone[] = [], spots: [number, number][] = [[0.3, 0.2], [0.65, 0.18], [0.85, 0.4], [0.5, 0.5], [0.2, 0.55], [0.4, 0.8], [0.72, 0.72], [0.88, 0.88]];
    spots.forEach(([fx, fy], i) => {
        const pit = i % 3, type = s.mobs[i % s.mobs.length];
        zones.push({ type, x: Math.round(fx * N), y: Math.round(fy * N), r: 9, n: 22, name: `${s.name}: ${'ABC'[pit]}${Math.floor(i / 3) + 1}`, lvl: pitLevel(s.lvl, pit), respawn: 10, aggro: 4 });
    });
    return zones;
}

export function buildHuntMap(s: HuntSpec): WorldMap {
    const N = s.size, { rnd, pick } = makeRnd(s.seed);
    const tiles: number[][] = [], blocked: boolean[][] = [], safe: boolean[][] = [];
    const props: Prop[] = [];
    const portals: Cell[] = [s.back, ...(s.next ? [s.next] : [])];
    const isSafe = (x: number, y: number) => portals.some((c) => Math.hypot(x - c.x, y - c.y) <= SAFE_R + 0.5);
    for (let y = 0; y < N; y++) {
        tiles.push([]); blocked.push([]); safe.push([]);
        for (let x = 0; x < N; x++) {
            tiles[y].push(isSafe(x, y) ? pick(STONE) : rnd() < s.stone ? pick(STONE) : pick(GRASS));
            blocked[y].push(x === 0 || y === 0 || x === N - 1 || y === N - 1);
            safe[y].push(isSafe(x, y));
        }
    }
    const keep = [...portals, s.arrive, ...(s.nextArrive ? [s.nextArrive] : [])];
    const keepNear = (x: number, y: number) => keep.some((k) => Math.abs(x - k.x) <= 2 && Math.abs(y - k.y) <= 2);
    // decoración rala: pocos obstáculos (menos de 3 % bloqueado) para que se vea y se esquive al rival
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (blocked[y][x] || safe[y][x] || keepNear(x, y)) continue;
        const r = rnd();
        if (r < 0.012) { props.push({ id: pick(TREES), x: x + 0.5, y: y + 0.5 }); blocked[y][x] = true; }
        else if (r < 0.02) { props.push({ id: pick(ROCKS), x: x + 0.5, y: y + 0.5 }); blocked[y][x] = true; }
        else if (r < 0.06) props.push({ id: pick(FLOWERS), x: x + 0.5, y: y + 0.5 });
    }
    return { size: N, tiles, blocked, safe, props, decals: [], zones: huntZones(s), buildings: [], npcs: [], spawn: { ...s.arrive }, fire: { x: -50, y: -50 } };
}

/** Definición de un mapa de caza generado: el portal de vuelta al mapa anterior y, si hay, el portal al siguiente. */
export function huntDef(s: HuntSpec, prev: { map: string; portal: Cell; arrive: Cell }, nextMap?: { map: string }): MapDef {
    const links: Link[] = [
        { id: `${s.id}_a_${prev.map}`, map: s.id, ...s.back, to: { map: prev.map, ...prev.arrive }, kind: 'portal', msg: `Volvés a ${prev.map.replace(/_/g, ' ')}.` },
    ];
    if (s.next && s.nextArrive && nextMap) links.push({ id: `${s.id}_a_${nextMap.map}`, map: s.id, ...s.next, to: { map: nextMap.map, ...s.nextArrive }, kind: 'portal', gate: { lvl: TIERS[s.tier][0] - 3 }, msg: 'Seguís hacia el este.' });
    return { id: s.id, name: s.name, region: 'comun', size: s.size, lvl: s.lvl, tier: s.tier, pvp: 'faction', safe: false, spawn: { ...s.arrive }, respawn: { ...s.arrive }, links, build: () => buildHuntMap(s) };
}

/** Primer tramo del tier 5 (niveles 41-50): dos mapas de caza encadenados a partir de las Minas abandonadas. */
export const LLANURA: HuntSpec = {
    id: 'llanura_del_umbral', name: 'Llanura del Umbral', size: 150, seed: 4101, tier: 5, lvl: [41, 45], stone: 0.12,
    back: { x: 4, y: 75 }, arrive: { x: 8, y: 75 }, next: { x: 145, y: 75 }, nextArrive: { x: 8, y: 75 },
    mobs: ['wyvern_ice', 'minotaur', 'ice_ant', 'skeleton_mage', 'cursed_grave'],
};
export const PARAMO: HuntSpec = {
    id: 'paramo_de_brasas', name: 'Páramo de Brasas', size: 150, seed: 4102, tier: 5, lvl: [46, 50], stone: 0.35,
    back: { x: 4, y: 75 }, arrive: { x: 8, y: 75 },
    mobs: ['wyvern_fire', 'fire_ant', 'zombie_dark', 'skeleton_archer', 'minotaur'],
};
/** Portal en las Minas abandonadas hacia la Llanura y celda de llegada de la vuelta (celdas libres y alcanzables medidas en el mapa). */
export const MINAS_TO_LLANURA = { portal: { x: 43, y: 17 }, arrive: { x: 43, y: 20 } };

export function huntMaps(): Record<string, MapDef> {
    const llanura = huntDef(LLANURA, { map: 'minas_abandonadas', portal: MINAS_TO_LLANURA.portal, arrive: MINAS_TO_LLANURA.arrive }, { map: PARAMO.id });
    // la llegada desde la Llanura al Páramo es su celda `arrive`; la del Páramo de vuelta cae junto al portal este de la Llanura
    const paramo = huntDef(PARAMO, { map: LLANURA.id, portal: LLANURA.next!, arrive: { x: 140, y: 75 } });
    return { [LLANURA.id]: llanura, [PARAMO.id]: paramo };
}
