/**
 * Registro de mapas del mundo (Fase 0 de docs/MUNDO.md): cada mapa es un `MapDef` (datos + constructor determinista)
 * y se conectan por `Link`s con id estable. Todo es puro y se comparte entre cliente y server: el cliente arma el mapa
 * por id sin pedirlo por red y el server decide con los mismos datos. El validador (`validateMapGraph`) corre en los
 * tests y sirve de red de seguridad al sumar mapas.
 */
import { buildSolmar, type WorldMap } from './index';
import { HUBS } from './cities';
import { buildPruebaCaza, buildPruebaGrande, buildPruebaMazmorra, buildPruebaPelea, PRUEBA_CAZA, PRUEBA_GRANDE, PRUEBA_MAZMORRA, PRUEBA_PELEA } from './testmaps';
import { ARENA as ARENA_MAP, ARENA_MAPS, buildArena } from './arena';
import { TRAINING, trainingMapFor, type PortalProgress } from './training';
import { KEY_RECIPES, keyMatName } from './quests';
import { buildSolmarVilla, VILLA, VILLA_BUILDINGS, VILLA_ID, VILLA_N, villaDoor, type VillaBuilding } from './solmar/villa';
import { buildInterior, INTERIORS, roomOf, TEMPLE_RESPAWN } from './solmar/interiors';
import { buildVharCiudadela, VHAR, VHAR_CITADEL_ID, VHAR_N, vharDoor, type VharBuilding } from './vhar/citadel';
import { LEGACY_FROM_VHAR, LEGACY_VHAR_LINK } from './vhar/legacy';
import { buildVharInterior, VHAR_INTERIORS, VHAR_RESPAWN } from './vhar/interiors';
import { FLARE_ARRIVAL, FLARE_FIELD, flareMaps } from './flare';
import { tiledMaps } from './tiledmaps';
import { TIERS, TIER_LIST, TIERS_WITH_CONTENT, tierGateLevel, type Tier } from './tiers';
import { mobDef } from './mobs';

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
export interface LinkGate { lvl?: number; quest?: number; key?: string; /** Id de una zona de TRAINING que el personaje ya tiene que haber abierto (llegando a pie). */ unlocked?: string; /** Solo pasa gente de esta nación (el campo y el portal de vuelta de cada ciudad). */ faction?: string }
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
    /**
     * Tier de zona (docs/TIERS_DE_ZONA.md): todo mapa de caza o mazmorra lo lleva (las ciudades no). `lvl` es el sub-rango del tier que
     * cubre el mapa; los niveles de sus mobs caen ahí. `legacy` = mapa viejo (Tierras de Solmar) que mezcla todo y queda fuera de la regla.
     */
    tier?: Tier;
    legacy?: boolean;
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
    /**
     * Mapa de pruebas sin entrada desde el mundo (los de la Fase 1): no hace falta alcanzarlo desde el mapa inicial; los tests
     * llegan con `WorldRegistry.beginTransfer`. Sus vínculos se validan igual que los demás.
     */
    debugOnly?: boolean;
    links: Link[];
    /** Constructor determinista: cliente y server tienen que armar exactamente lo mismo (sin Math.random ni hora). */
    build(): WorldMap;
}

/** Mapa al que van los personajes nuevos y los que tienen una posición guardada que no existe. */
export const DEFAULT_MAP = VILLA_ID;
/** Ids viejos que figuran en personajes guardados antes del registro de mapas. */
export const MAP_ALIASES: Record<string, string> = {};
export const canonicalMapId = (id: string | undefined): string | undefined => (id === undefined ? undefined : MAP_ALIASES[id] ?? id);

const ARENA: MapRect = { x0: 46, y0: 26, x1: 60, y1: 38 };

/**
 * Camino entre los Llanos del Alba y el mapa viejo (Tierras de Solmar): sale por el camino norte de los Llanos y llega a la puerta
 * sur de la ciudad vieja. Hasta la Fase 3 este camino unía la villa con el mapa viejo; ahora el portón este de la villa va a los Llanos.
 */
export const LEGACY_VILLA_LINK = { x: 8, y: 26 }, LEGACY_FROM_VILLA = { x: 8, y: 24 };
/** En el páramo viejo, junto a la salida de la Cripta: portal de vuelta al Páramo Reseco (Fase 3). Llegada a la Cripta desde el páramo nuevo. */
export const LEGACY_PARAMO_LINK = { x: 44, y: 50 }, LEGACY_CRYPT_ARRIVAL = { x: 46, y: 18 };

/**
 * Portal a los mapas de Flare (docs/MAPAS_FLARE.md): al este del punto de aparición de cada ciudad, en la plaza. Lleva a los Campos de Sal;
 * la vuelta aterriza en la plaza de Solmar (el portal de la Ciudadela es de ida: Vhar vuelve por el Portal de Frontera o con H).
 */
export const VILLA_FLARE = { x: VILLA.spawn.x + 5, y: VILLA.spawn.y }, VILLA_FLARE_BACK = { x: VILLA.spawn.x + 5, y: VILLA.spawn.y + 2 };
export const VHAR_FLARE = { x: VHAR.spawn.x + 5, y: VHAR.spawn.y }, VHAR_FLARE_BACK = { x: VHAR.spawn.x + 5, y: VHAR.spawn.y + 2 };
/** El portal de la plaza a Campos de Sal sirve de atajo: solo se abre después de haber llegado a pie una vez (docs/CIUDADES.md §8). */
const SHORTCUT_GATE = { unlocked: 'campos_de_sal' } as const;

/** Camino entre la Ciudadela de Vhar y el mapa viejo: sale por el portón sur y llega junto a la puerta de la ciudad vieja de Vhar. */
export { LEGACY_VHAR_LINK, LEGACY_FROM_VHAR };

/** Mapas de la Ciudadela de Vhar (Fase 2): la ciudadela exterior y un interior por edificio, unidos por puertas `enter`. */
function vharMaps(): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    const links: Link[] = [
        // el portón sur de la ciudadela también sale a los Campos de Sal (antes iba al mapa viejo, que quedó solo para pruebas)
        { id: 'ciudadela_a_legacy', map: VHAR_CITADEL_ID, ...VHAR.toLegacy, to: { map: FLARE_FIELD.vhar.eris, ...FLARE_ARRIVAL }, kind: 'oneway', msg: 'Tomás el Camino de Ceniza hacia los Campos de Sal.' },
        { id: 'ciudadela_a_campos', map: VHAR_CITADEL_ID, ...VHAR_FLARE, to: { map: FLARE_FIELD.vhar.eris, ...FLARE_ARRIVAL }, kind: 'oneway', gate: SHORTCUT_GATE, msg: 'Cruzás el portal hacia los Campos de Sal.' },
    ];
    for (const it of VHAR_INTERIORS) {
        const d = vharDoor(it.building as VharBuilding), r = roomOf(it);
        links.push({ id: `ciudadela_a_${it.building}`, map: VHAR_CITADEL_ID, ...d.door, to: { map: it.id, ...r.arrive }, kind: 'enter', msg: `Entrás: ${it.name}.` });
        out[it.id] = {
            id: it.id, name: it.name, region: 'vhar', size: r.N, lvl: null, pvp: 'off', safe: true,
            spawn: { ...r.arrive }, respawn: 'faction_home',
            links: [{ id: `${it.building}_a_ciudadela`, map: it.id, ...r.exit, to: { map: VHAR_CITADEL_ID, ...d.out }, kind: 'enter', msg: 'Salís a la Ciudadela de Vhar.' }],
            build: () => buildVharInterior(it),
        };
    }
    out[VHAR_CITADEL_ID] = {
        id: VHAR_CITADEL_ID, name: 'Ciudadela de Vhar', region: 'vhar', size: VHAR_N, lvl: null, pvp: 'off', safe: true,
        spawn: { ...VHAR.spawn }, respawn: 'faction_home', links, build: buildVharCiudadela,
    };
    return out;
}

/** Mapas de la Villa de Solmar (Fase 2): la villa exterior y un interior por edificio, unidos por puertas `enter`. */
function solmarMaps(): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    const villaLinks: Link[] = [
        // el portón este de la villa también sale a los Campos de Sal (antes iba a los Llanos del Alba, que se sacaron)
        { id: 'villa_a_llanos', map: VILLA_ID, ...VILLA.toLegacy, to: { map: FLARE_FIELD.solmar.eris, ...FLARE_ARRIVAL }, kind: 'oneway', msg: 'Tomás el Camino de la Marea hacia los Campos de Sal.' },
        { id: 'villa_a_campos', map: VILLA_ID, ...VILLA_FLARE, to: { map: FLARE_FIELD.solmar.eris, ...FLARE_ARRIVAL }, kind: 'portal', gate: SHORTCUT_GATE, msg: 'Cruzás el portal hacia los Campos de Sal.' },
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
    // Mapa viejo (Tierras de Solmar): ya no tiene entrada desde el mundo (decisión del 2/11/2026: quedan solo los mapas de Flare). Se
    // conserva como mapa de pruebas porque muchos tests del server lo usan de mundo genérico; se puede borrar migrando esos tests.
    solmar_legacy: {
        id: 'solmar_legacy', name: 'Tierras de Solmar', region: 'solmar', size: 96, lvl: [1, 12], legacy: true, debugOnly: true, pvp: 'faction', safe: false,
        spawn: { x: HUBS.solmar.x, y: HUBS.solmar.y }, respawn: 'faction_home', tempRects: [ARENA], ffaRect: ARENA,
        links: [
            { id: 'legacy_a_ciudadela', map: 'solmar_legacy', ...LEGACY_VHAR_LINK, to: { map: VHAR_CITADEL_ID, ...VHAR.fromLegacy }, kind: 'oneway', msg: 'Tomás el Camino de Ceniza hacia la Ciudadela de Vhar.' },
        ],
        build: () => buildSolmar(),
    },
    [PRUEBA_CAZA.id]: {
        id: PRUEBA_CAZA.id, name: 'Claro de prueba', region: 'prueba', size: PRUEBA_CAZA.size, lvl: [1, 5], pvp: 'faction', safe: false, debugOnly: true,
        spawn: { ...PRUEBA_CAZA.fromLegacy }, respawn: { ...PRUEBA_CAZA.respawn },
        links: [
            // el mapa viejo ya no tiene portal hacia acá (un solo portal por ciudad): la salida del claro es de una sola vía
            { id: 'caza_a_solmar', map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.toLegacy, to: { map: 'solmar_legacy', x: 11, y: 12 }, kind: 'oneway', msg: 'Volvés a Solmar.' },
            { id: 'caza_a_mazmorra', map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.door, to: { map: PRUEBA_MAZMORRA.id, ...PRUEBA_MAZMORRA.fromCaza }, kind: 'door', gate: { lvl: 2 }, msg: 'Bajás a la Mazmorra de prueba.' },
            { id: 'caza_a_pelea', map: PRUEBA_CAZA.id, x: 10, y: 56, to: { map: PRUEBA_PELEA.id, ...PRUEBA_PELEA.fromCaza }, kind: 'portal', msg: 'Cruzás al Campo de pelea.' },
        ],
        build: buildPruebaCaza,
    },
    [PRUEBA_PELEA.id]: {
        id: PRUEBA_PELEA.id, name: 'Campo de pelea', region: 'prueba', size: PRUEBA_PELEA.size, lvl: [1, 5], pvp: 'faction', safe: false, debugOnly: true,
        spawn: { ...PRUEBA_PELEA.fromCaza }, respawn: { ...PRUEBA_PELEA.respawn },
        links: [
            { id: 'pelea_a_caza', map: PRUEBA_PELEA.id, ...PRUEBA_PELEA.toCaza, to: { map: PRUEBA_CAZA.id, x: 11, y: 57 }, kind: 'portal', msg: 'Volvés al Claro de prueba.' },
            { id: 'pelea_a_grande', map: PRUEBA_PELEA.id, x: 8, y: 40, to: { map: PRUEBA_GRANDE.id, ...PRUEBA_GRANDE.fromPelea }, kind: 'portal', msg: 'Cruzás al Gran claro (250x250).' },
        ],
        build: buildPruebaPelea,
    },
    [PRUEBA_GRANDE.id]: {
        id: PRUEBA_GRANDE.id, name: 'Gran claro de prueba', region: 'prueba', size: PRUEBA_GRANDE.size, lvl: [1, 5], pvp: 'faction', safe: false, debugOnly: true,
        spawn: { ...PRUEBA_GRANDE.fromPelea }, respawn: { ...PRUEBA_GRANDE.respawn },
        links: [
            { id: 'grande_a_pelea', map: PRUEBA_GRANDE.id, ...PRUEBA_GRANDE.toPelea, to: { map: PRUEBA_PELEA.id, x: 7, y: 41 }, kind: 'portal', msg: 'Volvés al Campo de pelea.' },
        ],
        build: buildPruebaGrande,
    },
    [PRUEBA_MAZMORRA.id]: {
        id: PRUEBA_MAZMORRA.id, name: 'Mazmorra de prueba', region: 'prueba', size: PRUEBA_MAZMORRA.size, lvl: [3, 5], pvp: 'off', safe: false, debugOnly: true,
        spawn: { ...PRUEBA_MAZMORRA.fromCaza }, respawn: { ...PRUEBA_MAZMORRA.respawn },
        // temporal: si te desconectás adentro, al volver aparecés en la puerta del claro
        temporary: true, rest: { map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.fromMazmorra },
        links: [
            { id: 'mazmorra_a_caza', map: PRUEBA_MAZMORRA.id, ...PRUEBA_MAZMORRA.exit, to: { map: PRUEBA_CAZA.id, ...PRUEBA_CAZA.fromMazmorra }, kind: 'portal', msg: 'Subís la escalera de vuelta al claro.' },
            { id: 'mazmorra_atajo', map: PRUEBA_MAZMORRA.id, ...PRUEBA_MAZMORRA.shortcut, to: { map: 'solmar_legacy', x: 11, y: 12 }, kind: 'oneway', msg: 'Un atajo secreto te devuelve a Solmar.' },
        ],
        build: buildPruebaMazmorra,
    },
    // Arenas 2v2 / 3v3 (docs/PARTY_Y_ARENAS.md §2): sin portal, se entra por la cola (`/arena`), una instancia por partida. Temporales (si te
    // desconectás y no volvés a tiempo, aparecés en la villa) y todos contra todos si alguien entra sin partida (GM); con partida, los equipos
    // los decide el mundo (GameWorld.arena).
    ...Object.fromEntries(ARENA_MAPS.map((a): [string, MapDef] => [a.id, {
        id: a.id, name: a.name, region: 'arena', size: ARENA_MAP.size, lvl: null, pvp: 'ffa', safe: false, debugOnly: true,
        spawn: { ...ARENA_MAP.teamA }, respawn: { ...ARENA_MAP.teamA }, temporary: true, rest: { map: VILLA_ID, ...VILLA.spawn },
        links: [], build: () => buildArena(a.layout),
    }])),
    ...solmarMaps(),
    ...vharMaps(),
    // mapas importados de Flare: Campos de Sal -> Bosque de Piedra -> Cañón goblin (docs/MAPAS_FLARE.md)
    ...flareMaps({ [FLARE_FIELD.solmar.eris]: { map: VILLA_ID, to: VILLA_FLARE_BACK }, [FLARE_FIELD.vhar.eris]: { map: VHAR_CITADEL_ID, to: VHAR_FLARE_BACK } }),
};
// mapas importados de Tiled (pnpm maps:tiled): van después porque sus conexiones llegan al spawn de mapas ya definidos
Object.assign(MAPS, tiledMaps(MAPS));

export const getMapDef = (id: string | undefined): MapDef | undefined => { const c = canonicalMapId(id); return c ? MAPS[c] : undefined; };
/** Arma el mapa `id` desde cero (cada llamada devuelve un `WorldMap` propio). */
export function buildMap(id: string): WorldMap {
    const d = getMapDef(id); if (!d) throw new Error(`mapa desconocido: ${id}`);
    return d.build();
}
export const mapLinks = (id: string): Link[] => getMapDef(id)?.links ?? [];
export const findLink = (id: string, portalId: string): Link | undefined => mapLinks(id).find((l) => l.id === portalId);

/**
 * Hogar de cada facción: dónde aparece un personaje nuevo, a dónde lleva "volver a la ciudad" del Portal de Frontera y el recall (H).
 * Solmar vive en la Villa de Solmar y Vhar en la Ciudadela de Vhar (Fase 2).
 */
export function factionHome(faction: string): { map: string; x: number; y: number } | null {
    if (faction === 'solmar') return { map: VILLA_ID, ...VILLA.spawn };
    if (faction === 'vhar') return { map: VHAR_CITADEL_ID, ...VHAR.spawn };
    const h = HUBS[faction]; return h ? { map: DEFAULT_MAP, x: h.x, y: h.y } : null;
}
/** Punto de reaparición de cada facción al morir en un mapa con respawn 'faction_home': Solmar reaparece en el Templo de la villa y Vhar en el Santuario de Ceniza. */
export function factionRespawn(faction: string): { map: string; x: number; y: number } | null {
    if (faction === 'solmar') return { map: 'solmar_templo', ...TEMPLE_RESPAWN };
    if (faction === 'vhar') return { map: 'vhar_santuario', ...VHAR_RESPAWN };
    return factionHome(faction);
}
/** Dónde reaparece quien muere en `def`. */
export function respawnTarget(def: MapDef, faction: string): { map: string; x: number; y: number } {
    const r = def.respawn;
    if (r === 'faction_home') return factionRespawn(faction) ?? { map: def.id, ...def.spawn };
    return { map: r.map ?? def.id, x: r.x, y: r.y };
}
/** Volver a la ciudad (recall, tecla H): canal de 8 s que corta moverse, recibir daño, atacar o lanzar; 60 s de enfriamiento. Lo valida el server. */
export const RECALL = { channelMs: 8000, cooldownMs: 60000 } as const;
/** Motivo por el que no se puede empezar el recall en `def` en (x, y), o null. El Coliseo (todos contra todos) y los mapas `ffa` no lo permiten. */
export function recallBlockedReason(def: MapDef | undefined, x: number, y: number): string | null {
    if (def?.pvp === 'ffa' || (def?.ffaRect && inMapRect(def.ffaRect, x, y))) return 'No podés volver a la ciudad desde la arena.';
    return null;
}
/**
 * Destino de un pedido del menú del Portal de Frontera: 'city' = hogar de la facción, o el id de una zona de entrenamiento (la entrada
 * de su mapa de Flare, que es zona segura).
 */
export function waypointTarget(id: string, faction: string): { map: string; x: number; y: number; step?: number } | null {
    if (id === 'city') return factionHome(faction);
    const t = TRAINING.find((q) => q.id === id); const d = t && MAPS[trainingMapFor(t, faction)]; if (!t || !d) return null;
    return { map: d.id, ...d.spawn, step: t.step };
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
    if (gt.faction && g.faction !== gt.faction) return 'Ese camino es de la otra nación: no podés pasar.';
    if (gt.unlocked && !g.unlocked.includes(gt.unlocked)) return 'Todavía no conocés el camino: llegá a pie una vez por el portón de la ciudad y este portal se abre.';
    if (gt.quest !== undefined && g.qi < gt.quest) { const n = questName?.(gt.quest - 1); return n ? `Todavía no: entregá «${n}» al Capitán.` : 'Todavía no cumpliste la misión que pide este paso.'; }
    if (gt.key && !(g.keys[gt.key] >= 1)) return KEY_RECIPES[gt.key] ? `Está sellado: necesitás una ${keyMatName(gt.key)} (cada uno gasta la suya).` : `Está sellado: necesitás la llave (${gt.key}).`;
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

/** Celdas alcanzables a pie (4 vecinos) desde (sx, sy). Con `viaPortals`, también cruzando las escaleras del mismo mapa (`WorldMap.portals`). */
export function reachableFrom(m: WorldMap, sx: number, sy: number, viaPortals = false): boolean[][] {
    const seen: boolean[][] = Array.from({ length: m.size }, () => new Array<boolean>(m.size).fill(false));
    if (!walkable(m, sx, sy)) return seen;
    const q: [number, number][] = [[sx, sy]]; seen[sy][sx] = true;
    for (let i = 0; i < q.length; i++) {
        const [x, y] = q[i];
        if (viaPortals) for (const p of m.portals ?? []) if (p.x === x && p.y === y && walkable(m, p.tx, p.ty) && !seen[p.ty][p.tx]) { seen[p.ty][p.tx] = true; q.push([p.tx, p.ty]); }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy; if (walkable(m, nx, ny) && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); } }
    }
    return seen;
}

/**
 * Reglas de los tiers de zona (docs/TIERS_DE_ZONA.md §5): todo mapa de caza o mazmorra (salvo los de prueba y el viejo) tiene tier, su `lvl`
 * cae dentro del tier y el nivel de cada mob también (los jefes, en el tope del mapa); cada puerta a una mazmorra sale de un mapa del mismo
 * tier y pide al menos el mínimo del tier menos 2; cada tier con contenido (hoy del 1 al 4, `TIERS_WITH_CONTENT`) tiene al menos un mapa abierto y una mazmorra.
 */
export function tierErrors(defs: Record<string, MapDef>, built: Map<string, WorldMap>): string[] {
    const errs: string[] = [], open = new Map<Tier, number>(), dung = new Map<Tier, number>();
    for (const [id, d] of Object.entries(defs)) {
        if (d.safe || d.debugOnly || d.legacy) continue;
        if (!d.tier) { errs.push(`${id}: mapa de caza o mazmorra sin tier`); continue; }
        const [t0, t1] = TIERS[d.tier];
        if (!d.lvl || d.lvl[0] < t0 || d.lvl[1] > t1) errs.push(`${id}: lvl ${JSON.stringify(d.lvl)} fuera del tier ${d.tier} (${t0}-${t1})`);
        const m = built.get(id);
        for (const z of m?.zones ?? []) {
            const l = mobDef(z.type, z).lvl;
            if (d.lvl && (l < d.lvl[0] || l > d.lvl[1])) errs.push(`${id}: zona '${z.name}' con mobs de nivel ${l}, fuera de ${d.lvl[0]}-${d.lvl[1]}`);
        }
        const isDungeon = !!m?.dungeon;
        (isDungeon ? dung : open).set(d.tier, ((isDungeon ? dung : open).get(d.tier) ?? 0) + 1);
        for (const l of d.links) {
            const to = defs[l.to.map]; if (!to?.tier || !built.get(l.to.map)?.dungeon || isDungeon) continue;
            if (to.tier !== d.tier) errs.push(`vínculo '${l.id}': la mazmorra '${l.to.map}' es T${to.tier} y la entrada está en un mapa T${d.tier}`);
            const need = to.tier === 1 ? 2 : tierGateLevel(to.tier);
            if ((l.gate?.lvl ?? 0) < need) errs.push(`vínculo '${l.id}': la puerta de la mazmorra pide nivel ${l.gate?.lvl ?? 0}; mínimo ${need}`);
        }
    }
    for (const t of TIER_LIST) if (t <= TIERS_WITH_CONTENT && ((open.get(t) ?? 0) < 1 || (dung.get(t) ?? 0) < 1)) errs.push(`tier ${t}: tiene ${open.get(t) ?? 0} mapas abiertos y ${dung.get(t) ?? 0} mazmorras (mínimo 1 y 1)`);
    return errs;
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
        // todo lo que importa se alcanza a pie desde el spawn (o cruzando escaleras del mismo mapa, como la Cripta del mapa viejo)
        const reach = reachableFrom(m, d.spawn.x, d.spawn.y, true);
        const must = (what: string, c: Cell) => { if (walkable(m, c.x, c.y) && !reach[c.y][c.x]) errs.push(`${id}: ${what} (${c.x}, ${c.y}) no se alcanza a pie desde el spawn`); };
        for (const l of d.links) must(`vínculo '${l.id}'`, l);
        for (const o of ids) for (const l of defs[o].links) if (l.to.map === id) must(`llegada de '${l.id}'`, l.to);
        if (rt.map === id) must('respawn', rt);
    }
    errs.push(...tierErrors(defs, built));
    // nombres de zona únicos entre mapas (dentro de un mapa se repiten: varios campamentos de la misma zona). Excepción transitoria:
    // las zonas que se mudaron del mapa viejo a un mapa de caza (Fase 3) conservan su nombre hasta que la Fase 8 borre el mapa viejo.
    const zoneMap = new Map<string, string>();
    for (const [id, m] of built) for (const z of m.zones) { const o = zoneMap.get(z.name); if (o && o !== id && o !== DEFAULT_MAP && id !== DEFAULT_MAP) errs.push(`zona '${z.name}' repetida en '${o}' y '${id}'`); else zoneMap.set(z.name, id); }
    // todos los mapas se alcanzan desde el inicial (los de prueba, desde cualquiera de ellos: no tienen entrada desde el mundo)
    if (defs[start]) {
        const roots = [start, ...ids.filter((id) => defs[id].debugOnly)];
        const seen = new Set(roots), q = [...roots];
        for (let i = 0; i < q.length; i++) for (const l of defs[q[i]]?.links ?? []) if (defs[l.to.map] && !seen.has(l.to.map)) { seen.add(l.to.map); q.push(l.to.map); }
        for (const id of ids) if (!seen.has(id)) errs.push(`'${id}' no se alcanza desde '${start}'`);
    }
    return errs;
}
