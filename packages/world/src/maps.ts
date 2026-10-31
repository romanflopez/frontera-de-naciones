/**
 * Registro de mapas del mundo (Fase 0 de docs/MUNDO.md): cada mapa es un `MapDef` (datos + constructor determinista)
 * y se conectan por `Link`s con id estable. Todo es puro y se comparte entre cliente y server: el cliente arma el mapa
 * por id sin pedirlo por red y el server decide con los mismos datos. El validador (`validateMapGraph`) corre en los
 * tests y sirve de red de seguridad al sumar mapas.
 */
import { buildSolmar, type WorldMap } from './index';
import { HUBS } from './cities';
import { buildPruebaCaza, buildPruebaMazmorra, PRUEBA_CAZA, PRUEBA_MAZMORRA } from './testmaps';
import { TRAINING, type PortalProgress } from './training';
import { buildSolmarVilla, VILLA, VILLA_BUILDINGS, VILLA_ID, VILLA_N, villaDoor, type VillaBuilding } from './solmar/villa';
import { buildInterior, INTERIORS, roomOf, TEMPLE_RESPAWN } from './solmar/interiors';

/** Rectángulo de celdas con los dos extremos incluidos (igual que `WorldMap.dungeon`). */
export interface MapRect { x0: number; y0: number; x1: number; y1: number }
export interface Cell { x: number; y: number }
export const inMapRect = (r: MapRect, x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/**
 * Tipo de vínculo (cambia el dibujo y el requisito, no el mecanismo):
 * `walk` camino (franja al borde del mapa), `portal` portal de piedra (ida y vuelta), `oneway` solo de ida,
 * `door` puerta con requisito (`gate`), `npc` teletransporte de un NPC, `enter` puerta de un edificio (entrar/salir de un interior,
 * sin requisito y sin portal dibujado).
 */
export type LinkKind = 'walk' | 'portal' | 'oneway' | 'door' | 'npc' | 'enter';
/** Requisitos para cruzar: nivel mínimo, misiones entregadas (índice en QUESTS: `qi >= quest`) y/o una llave que se consume al cruzar. */
export interface LinkGate { lvl?: number; quest?: number; key?: string }
/** Vínculo entre mapas: pisar (x, y) en `map` lleva a `to`. El cliente lo pide por `id`, nunca por coordenadas. */
export interface Link {
    id: string;
    map: string; x: number; y: number;
    to: { map: string; x: number; y: number };
    kind: LinkKind;
    gate?: LinkGate;
    msg: string;
}
/** A dónde vuelve un jugador al morir: el hogar de su facción, o una celda (de este mapa si no dice `map`). */
export type RespawnSpec = 'faction_home' | { map?: string; x: number; y: number };

export interface MapDef {
    id: string;
    name: string;
    region: string;
    /** Los mapas son cuadrados: coincide con `WorldMap.size`. */
    size: number;
    /** Rango de nivel recomendado (informativo: HUD y pantalla de carga). */
    lvl: [number, number] | null;
    /** `off` sin PvP, `faction` entre facciones distintas fuera de zona segura, `ffa` todos contra todos. */
    pvp: 'off' | 'faction' | 'ffa';
    /** Mapa seguro entero (ciudad): sin mobs y sin PvP. */
    safe: boolean;
    /** Punto de aparición por defecto en este mapa (personaje nuevo, posición guardada inválida). */
    spawn: Cell;
    respawn: RespawnSpec;
    /** Mapa temporal: la posición no se guarda; al reconectar se usa `rest`. Las `tempRects` lo son solo en esas zonas del mapa. */
    temporary?: boolean;
    rest?: { map: string; x: number; y: number };
    tempRects?: MapRect[];
    /** Zona de todos contra todos dentro de un mapa `faction` (el Coliseo del mapa original). */
    ffaRect?: MapRect;
    music?: string;
    links: Link[];
    /** Constructor determinista: cliente y server tienen que armar exactamente lo mismo (sin Math.random ni hora). */
    build(): WorldMap;
}

/** Mapa al que van los personajes nuevos y los que tienen una posición guardada que no existe. */
export const DEFAULT_MAP = 'solmar_legacy';
/** Ids viejos que figuran en personajes guardados antes del registro de mapas. */
export const MAP_ALIASES: Record<string, string> = { solmar: 'solmar_legacy' };
export const canonicalMapId = (id: string | undefined): string | undefined => (id === undefined ? undefined : MAP_ALIASES[id] ?? id);

const ARENA: MapRect = { x0: 46, y0: 26, x1: 60, y1: 38 };

/** Camino entre la Villa de Solmar y el mapa viejo: sale por el portón este de la villa y llega a la puerta sur de la ciudad vieja. */
export const LEGACY_VILLA_LINK = { x: 8, y: 26 }, LEGACY_FROM_VILLA = { x: 8, y: 24 };

/** Mapas de la Villa de Solmar (Fase 2): la villa exterior y un interior por edificio, unidos por puertas `enter`. */
function solmarMaps(): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    const villaLinks: Link[] = [
        { id: 'villa_a_legacy', map: VILLA_ID, ...VILLA.toLegacy, to: { map: 'solmar_legacy', ...LEGACY_FROM_VILLA }, kind: 'walk', msg: 'Tomás el Camino de la Marea hacia las tierras de caza.' },
    ];
    for (const it of INTERIORS) {
        const d = villaDoor(it.building as VillaBuilding), r = roomOf(it);
        villaLinks.push({ id: `villa_a_${it.building}`, map: VILLA_ID, ...d.door, to: { map: it.id, ...r.arrive }, kind: 'enter', msg: `Entrás: ${it.name}.` });
        out[it.id] = {
            id: it.id, name: it.name, region: 'solmar', size: r.N, lvl: null, pvp: 'off', safe: true,
            spawn: { ...r.arrive }, respawn: 'faction_home',
            links: [{ id: `${it.building}_a_villa`, map: it.id, ...r.exit, to: { map: VILLA_ID, ...d.out }, kind: 'enter', msg: 'Salís a la Villa de Solmar.' }],
            build: () => buildInterior(it),
        };
    }
    out[VILLA_ID] = {
        id: VILLA_ID, name: 'Villa de Solmar', region: 'solmar', size: VILLA_N, lvl: null, pvp: 'off', safe: true,
        spawn: { ...VILLA.spawn }, respawn: 'faction_home', links: villaLinks, build: buildSolmarVilla,
    };
    return out;
}
void VILLA_BUILDINGS;

export const MAPS: Record<string, MapDef> = {
    solmar_legacy: {
        id: 'solmar_legacy', name: 'Tierras de Solmar', region: 'solmar', size: 96, lvl: [1, 12], pvp: 'faction', safe: false,
        spawn: { x: HUBS.solmar.x, y: HUBS.solmar.y }, respawn: 'faction_home', tempRects: [ARENA], ffaRect: ARENA,
        links: [
            // Portal de prueba junto a la plaza de Solmar: lleva al claro de caza (Fase 1 de docs/MUNDO.md)
            { id: 'solmar_a_caza', map: 'solmar_legacy', x: 11, y: 11, to: { map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.fromLegacy }, kind: 'portal', msg: 'Cruzás el portal hacia el Claro de prueba.' },
            // camino a la Villa de Solmar (Fase 2): por la puerta sur de la ciudad vieja
            { id: 'legacy_a_villa', map: 'solmar_legacy', ...LEGACY_VILLA_LINK, to: { map: VILLA_ID, ...VILLA.fromLegacy }, kind: 'walk', msg: 'Tomás el Camino de la Marea hacia la Villa de Solmar.' },
        ],
        build: () => buildSolmar(),
    },
    [PRUEBA_CAZA.id]: {
        id: PRUEBA_CAZA.id, name: 'Claro de prueba', region: 'prueba', size: PRUEBA_CAZA.size, lvl: [1, 5], pvp: 'faction', safe: false,
        spawn: { ...PRUEBA_CAZA.fromLegacy }, respawn: { ...PRUEBA_CAZA.respawn },
        links: [
            { id: 'caza_a_solmar', map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.toLegacy, to: { map: 'solmar_legacy', x: 11, y: 12 }, kind: 'portal', msg: 'Volvés a Solmar.' },
            { id: 'caza_a_mazmorra', map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.door, to: { map: PRUEBA_MAZMORRA.id, ...PRUEBA_MAZMORRA.fromCaza }, kind: 'door', gate: { lvl: 2 }, msg: 'Bajás a la Mazmorra de prueba.' },
        ],
        build: buildPruebaCaza,
    },
    [PRUEBA_MAZMORRA.id]: {
        id: PRUEBA_MAZMORRA.id, name: 'Mazmorra de prueba', region: 'prueba', size: PRUEBA_MAZMORRA.size, lvl: [3, 5], pvp: 'off', safe: false,
        spawn: { ...PRUEBA_MAZMORRA.fromCaza }, respawn: { ...PRUEBA_MAZMORRA.respawn },
        // temporal: si te desconectás adentro, al volver aparecés en la puerta del claro
        temporary: true, rest: { map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.fromMazmorra },
        links: [
            { id: 'mazmorra_a_caza', map: PRUEBA_MAZMORRA.id, ...PRUEBA_MAZMORRA.exit, to: { map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.fromMazmorra }, kind: 'portal', msg: 'Subís la escalera de vuelta al claro.' },
            { id: 'mazmorra_atajo', map: PRUEBA_MAZMORRA.id, ...PRUEBA_MAZMORRA.shortcut, to: { map: 'solmar_legacy', x: 11, y: 12 }, kind: 'oneway', msg: 'Un atajo secreto te devuelve a Solmar.' },
        ],
        build: buildPruebaMazmorra,
    },
    ...solmarMaps(),
};

export const getMapDef = (id: string | undefined): MapDef | undefined => { const c = canonicalMapId(id); return c ? MAPS[c] : undefined; };
/** Arma el mapa `id` desde cero (cada llamada devuelve un `WorldMap` propio). */
export function buildMap(id: string): WorldMap {
    const d = getMapDef(id); if (!d) throw new Error(`mapa desconocido: ${id}`);
    return d.build();
}
export const mapLinks = (id: string): Link[] => getMapDef(id)?.links ?? [];
export const findLink = (id: string, portalId: string): Link | undefined => mapLinks(id).find((l) => l.id === portalId);

/**
 * Hogar de cada facción: dónde aparece un personaje nuevo y a dónde lleva "volver a la ciudad" del Portal de Frontera.
 * Solmar vive en la Villa de Solmar (Fase 2); Vhar sigue en su ciudad del mapa original.
 */
export function factionHome(faction: string): { map: string; x: number; y: number } | null {
    if (faction === 'solmar') return { map: VILLA_ID, ...VILLA.spawn };
    const h = HUBS[faction]; return h ? { map: DEFAULT_MAP, x: h.x, y: h.y } : null;
}
/** Punto de reaparición de cada facción al morir en un mapa con respawn 'faction_home': Solmar reaparece en el Templo de la villa. */
export function factionRespawn(faction: string): { map: string; x: number; y: number } | null {
    if (faction === 'solmar') return { map: 'solmar_templo', ...TEMPLE_RESPAWN };
    return factionHome(faction);
}
/** Dónde reaparece quien muere en `def`. */
export function respawnTarget(def: MapDef, faction: string): { map: string; x: number; y: number } {
    const r = def.respawn;
    if (r === 'faction_home') return factionRespawn(faction) ?? { map: def.id, ...def.spawn };
    return { map: r.map ?? def.id, x: r.x, y: r.y };
}
let legacyArrivals: Record<string, { x: number; y: number }> | null = null;
/**
 * Destino de un pedido del menú del Portal de Frontera, en cualquier mapa: 'city' = hogar de la facción, o el id de una zona de
 * entrenamiento (todas siguen en el mapa original; las celdas de llegada las calcula training.ts al armarlo).
 */
export function waypointTarget(id: string, faction: string): { map: string; x: number; y: number; step?: number } | null {
    if (id === 'city') return factionHome(faction);
    const t = TRAINING.find((q) => q.id === id); if (!t) return null;
    legacyArrivals ??= buildMap(DEFAULT_MAP).waypointArrivals ?? {};
    const a = legacyArrivals[id];
    return a ? { map: DEFAULT_MAP, x: a.x, y: a.y, step: t.step } : null;
}
/** ¿La posición (x, y) de `def` es temporal (no se guarda; al reconectar se usa `rest` o el spawn)? */
export function isTemporaryCell(def: MapDef, map: WorldMap | undefined, x: number, y: number): boolean {
    if (def.temporary) return true;
    if (def.tempRects?.some((r) => inMapRect(r, x, y))) return true;
    return !!map && [map.dungeon, ...(map.dungeons ?? [])].some((d) => !!d && inMapRect(d, x, y));
}

/** Motivo por el que el vínculo no deja pasar, o null. Las llaves se descuentan al cruzar (lo hace el server). */
export function linkGateReason(l: Link, g: PortalProgress, questName?: (qi: number) => string | undefined): string | null {
    const gt = l.gate; if (!gt) return null;
    if (gt.lvl !== undefined && g.lvl < gt.lvl) return `Necesitás nivel ${gt.lvl} para pasar.`;
    if (gt.quest !== undefined && g.qi < gt.quest) { const n = questName?.(gt.quest - 1); return n ? `Todavía no: entregá «${n}» al Capitán.` : 'Todavía no cumpliste la misión que pide este paso.'; }
    if (gt.key && !(g.keys[gt.key] >= 1)) return `Está sellado: necesitás la llave (${gt.key}).`;
    return null;
}

/** Hash FNV-1a del mapa (tamaño, celdas bloqueadas y zonas): el cliente comprueba que armó lo mismo que el server. */
export function mapHash(m: WorldMap): string {
    let h = 0x811c9dc5;
    const feed = (n: number) => { h ^= n & 0xff; h = Math.imul(h, 0x01000193); };
    const feedStr = (s: string) => { for (let i = 0; i < s.length; i++) { feed(s.charCodeAt(i)); feed(s.charCodeAt(i) >>> 8); } feed(0); };
    feed(m.size); feed(m.size >>> 8);
    for (let y = 0; y < m.size; y++) { let bits = 0, n = 0; for (let x = 0; x < m.size; x++) { bits = (bits << 1) | (m.blocked[y][x] ? 1 : 0); if (++n === 8) { feed(bits); bits = 0; n = 0; } } if (n) feed(bits); }
    feed(m.zones.length);
    for (const z of m.zones) { feedStr(z.type); feed(z.x); feed(z.y); feed(z.r); feed(z.n); }
    return (h >>> 0).toString(16).padStart(8, '0');
}

const walkable = (m: WorldMap, x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < m.size && y < m.size && !m.blocked[y][x];

/** Celdas alcanzables a pie (4 vecinos) desde (sx, sy). */
export function reachableFrom(m: WorldMap, sx: number, sy: number): boolean[][] {
    const seen: boolean[][] = Array.from({ length: m.size }, () => new Array<boolean>(m.size).fill(false));
    if (!walkable(m, sx, sy)) return seen;
    const q: [number, number][] = [[sx, sy]]; seen[sy][sx] = true;
    for (let i = 0; i < q.length; i++) {
        const [x, y] = q[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy; if (walkable(m, nx, ny) && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); } }
    }
    return seen;
}

/**
 * Valida el grafo de mapas y devuelve la lista de errores (vacía = bien):
 * ids únicos y coherentes, tamaño, vínculos con destino existente y caminable, que el destino no sea una celda disparadora
 * (rebotaría), reciprocidad salvo `oneway`, puertas con requisito, respawn/rest/spawn caminables, todo alcanzable a pie
 * desde el spawn de cada mapa, nombres de zona únicos entre mapas, mapas seguros sin mobs, construcción determinista y
 * todos los mapas alcanzables desde `start`.
 */
export function validateMapGraph(defs: Record<string, MapDef> = MAPS, start: string = DEFAULT_MAP): string[] {
    const errs: string[] = [];
    const built = new Map<string, WorldMap>();
    const ids = Object.keys(defs);
    if (!defs[start]) errs.push(`el mapa inicial '${start}' no existe`);
    for (const id of ids) {
        const d = defs[id];
        if (d.id !== id) { errs.push(`${id}: el id del MapDef es '${d.id}'`); continue; }
        let m: WorldMap;
        try { m = d.build(); } catch (e) { errs.push(`${id}: build() falló (${(e as Error).message})`); continue; }
        built.set(id, m);
        if (m.size !== d.size) errs.push(`${id}: size ${d.size} no coincide con el mapa armado (${m.size})`);
        if (mapHash(d.build()) !== mapHash(m)) errs.push(`${id}: build() no es determinista (dos construcciones dan hash distinto)`);
        if (d.lvl && d.lvl[0] > d.lvl[1]) errs.push(`${id}: rango de nivel invertido`);
        if (d.safe && (m.zones.length || d.pvp !== 'off')) errs.push(`${id}: un mapa seguro no puede tener mobs ni PvP`);
        if (d.temporary && !d.rest) errs.push(`${id}: temporary pide rest`);
    }
    const cellOk = (what: string, map: string, c: Cell) => { const m = built.get(map); if (!m) errs.push(`${what}: el mapa '${map}' no existe`); else if (!walkable(m, c.x, c.y)) errs.push(`${what}: (${c.x}, ${c.y}) no es caminable en '${map}'`); return !!m && walkable(m, c.x, c.y); };
    const linkIds = new Map<string, string>();
    const trig = new Map<string, Set<string>>(); // mapa -> celdas disparadoras
    for (const id of ids) { trig.set(id, new Set()); }
    for (const id of ids) for (const l of defs[id].links) {
        if (linkIds.has(l.id)) errs.push(`vínculo '${l.id}' repetido (en '${linkIds.get(l.id)}' y '${id}')`); else linkIds.set(l.id, id);
        if (l.map !== id) errs.push(`vínculo '${l.id}': declara el mapa '${l.map}' pero está en '${id}'`);
        const k = `${l.x},${l.y}`;
        if (trig.get(id)!.has(k)) errs.push(`vínculo '${l.id}': otra celda disparadora ya ocupa (${l.x}, ${l.y}) en '${id}'`);
        trig.get(id)!.add(k);
    }
    for (const id of ids) {
        const d = defs[id], m = built.get(id); if (!m) continue;
        for (const l of d.links) {
            cellOk(`vínculo '${l.id}' (origen)`, id, l);
            const dm = defs[l.to.map];
            if (!dm) { errs.push(`vínculo '${l.id}': destino '${l.to.map}' no existe`); continue; }
            if (cellOk(`vínculo '${l.id}' (destino)`, l.to.map, l.to) && trig.get(l.to.map)?.has(`${l.to.x},${l.to.y}`)) errs.push(`vínculo '${l.id}': el destino (${l.to.x}, ${l.to.y}) es una celda disparadora de '${l.to.map}' (rebotaría)`);
            if (l.kind === 'door' && !(l.gate && (l.gate.lvl !== undefined || l.gate.quest !== undefined || l.gate.key))) errs.push(`vínculo '${l.id}': una puerta pide requisito (gate)`);
            if (l.kind !== 'oneway' && l.to.map !== id && !dm.links.some((b) => b.to.map === id)) errs.push(`vínculo '${l.id}': '${l.to.map}' no tiene vínculo de vuelta a '${id}' (si es de una vía, marcalo 'oneway')`);
            if (l.to.map === id && l.kind !== 'oneway') { /* teletransporte dentro del mismo mapa: permitido */ }
        }
        cellOk(`${id}: spawn`, id, d.spawn);
        const rt = respawnTarget(d, 'solmar'); cellOk(`${id}: respawn`, rt.map, rt);
        for (const f of ['vhar']) { const r2 = respawnTarget(d, f); cellOk(`${id}: respawn (${f})`, r2.map, r2); }
        if (d.rest) cellOk(`${id}: rest`, d.rest.map, d.rest);
        // todo lo que importa se alcanza a pie desde el spawn
        const reach = reachableFrom(m, d.spawn.x, d.spawn.y);
        const must = (what: string, c: Cell) => { if (walkable(m, c.x, c.y) && !reach[c.y][c.x]) errs.push(`${id}: ${what} (${c.x}, ${c.y}) no se alcanza a pie desde el spawn`); };
        for (const l of d.links) must(`vínculo '${l.id}'`, l);
        for (const o of ids) for (const l of defs[o].links) if (l.to.map === id) must(`llegada de '${l.id}'`, l.to);
        if (rt.map === id) must('respawn', rt);
    }
    // nombres de zona únicos entre mapas (dentro de un mapa se repiten: varios campamentos de la misma zona)
    const zoneMap = new Map<string, string>();
    for (const [id, m] of built) for (const z of m.zones) { const o = zoneMap.get(z.name); if (o && o !== id) errs.push(`zona '${z.name}' repetida en '${o}' y '${id}'`); else zoneMap.set(z.name, id); }
    // todos los mapas se alcanzan desde el inicial
    if (defs[start]) {
        const seen = new Set([start]), q = [start];
        for (let i = 0; i < q.length; i++) for (const l of defs[q[i]]?.links ?? []) if (defs[l.to.map] && !seen.has(l.to.map)) { seen.add(l.to.map); q.push(l.to.map); }
        for (const id of ids) if (!seen.has(id)) errs.push(`'${id}' no se alcanza desde '${start}'`);
    }
    return errs;
}
