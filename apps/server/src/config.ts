/**
 * Carga de configuración y catálogos desde apps/server/data.
 * Equivale a Config.cs del server original, recortado a lo que usa este corte.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export interface Settings {
    port: number;
    initialMap: string;
    logoutTime: number;
    courseCorrection: boolean;
    spawnInMiddle: boolean;
    spawnToRandomMap: boolean;
    chatMessageMaxLength: number;
    maxCellsJumpDistance: number;
    tickInterval: number;
    radius: { viewRadiusX: number; viewRadiusY: number; cameraRadiusX: number; cameraRadiusY: number };
    timings: {
        disconnectTime: number;
        arrowSpeed: number;
        playerPickupAnimationTime: number;
        playerBowAnimationTime: number;
        spawnProtectionTime: number;
        antiHackTimingLagFactor: number;
    };
    ping: { timeout: number; interval: number; allowedVariance: number; varianceSampleSize: number };
    movementSpeedViolationsChecker: {
        verbose: boolean;
        limit: number;
        window: number;
        segmentsPerWindow: number;
        paralysisDuration: number;
        maxPingVariance: number;
    };
}

export interface WorldLocationConfig { x: number; y: number }

export interface GameWorldConfig {
    id: string;
    name: string;
    map: string;
    music?: string;
    /** Dónde aparece un personaje nuevo (si no, el centro del mapa o un lugar al azar). */
    spawn?: WorldLocationConfig;
    teleportLocs?: { locs: WorldLocationConfig[]; target: { worldId: string; loc: WorldLocationConfig } }[];
}

export interface ItemEffectConfig { effect: number; effectColor?: number }

export interface ItemConfig {
    id: number;
    name: string;
    itemType: string;
    blockedItemSlots?: string[];
    stackable?: boolean;
    consumable?: boolean;
    effects?: ItemEffectConfig[];
    weaponType?: number;
    gender?: number;
}

export interface SpellTemporaryEffectConfig {
    type: number;
    duration: number;
    group?: number;
    movementSpeedModifier?: number;
    attackSpeedModifier?: number;
    castSpeedModifier?: number;
}

export interface SpellConfig {
    id: number;
    name: string;
    damageType?: number;
    aoeRadius?: number;
    projectileSpeed?: number;
    emissionSteps?: number;
    startRadius?: number;
    endRadius?: number;
    startShards?: number;
    endShards?: number;
    duration?: number;
    projectileDistance?: number;
    aimAssist?: boolean;
    temporaryEffects?: SpellTemporaryEffectConfig[];
}

export interface MonsterConfig { id: number; name: string; sprite: string }
export interface NpcConfig { id: number; name: string }

function readJson<T>(...parts: string[]): T {
    return JSON.parse(readFileSync(join(DATA_DIR, ...parts), 'utf8')) as T;
}

export interface Catalogs {
    items: ItemConfig[];
    spells: SpellConfig[];
    monsters: MonsterConfig[];
    npcs: NpcConfig[];
}

export function loadSettings(): Settings {
    const s = readJson<Settings>('settings.json');
    // Para pruebas automáticas con navegador sin GPU (el render por software traba la pestaña):
    // FDN_PING_ALLOWED_VARIANCE=10000 afloja el corte por ping inestable sin tocar settings.json.
    const v = Number(process.env.FDN_PING_ALLOWED_VARIANCE);
    if (Number.isFinite(v) && v > 0) s.ping.allowedVariance = v;
    return s;
}

export function loadWorlds(): GameWorldConfig[] {
    return readJson<GameWorldConfig[]>('worlds.json');
}

export function loadCatalogs(): Catalogs {
    const byId = <T extends { id: number }>(xs: T[]) => [...xs].sort((a, b) => a.id - b.id);
    return {
        items: byId(readJson<ItemConfig[]>('catalog', 'Items.json')),
        spells: byId(readJson<SpellConfig[]>('catalog', 'Spells.json')),
        monsters: byId(readJson<MonsterConfig[]>('catalog', 'Monsters.json')),
        npcs: byId(readJson<NpcConfig[]>('catalog', 'NPCs.json')),
    };
}
