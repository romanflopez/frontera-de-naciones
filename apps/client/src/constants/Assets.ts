/**
 * Central asset manifest (`ASSETS`) and helpers for Phaser loading.
 *
 * Minimap per map: generated at runtime, pre-baked image, or none.
 */
export enum Minimap {
    ON_DEMAND_GENERATED = 'on-demand-generated',
    PRE_GENERATED = 'pre-generated',
    NONE = 'none',
}

/** Row kind in `ASSETS` (map, tile sheet, sprite, music, sound). */
export enum AssetType {
    MAP = 'map',
    TILE_SPRITE = 'tile-sprite',
    SPRITE = 'sprite',
    MUSIC = 'music',
    SOUND = 'sound',
}

import { SpriteType } from '../game/assets/HBSprite';
import {
    LOAD_MONSTER_ASSETS_ON_DEMAND,
    LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND,
    MONSTER_PLACEHOLDER_SPRITE,
} from '../Config';
import { getMonsterData, MONSTERS, type MonsterData, type MonsterStateConfig } from './Monsters';
import { NPC_SPRITE_NAMES } from './NPCs';
import { EFFECTS } from './Effects';
import { ITEMS } from './Items';

/** One row in `ASSETS`: registry key, load path, `AssetType`, and type-specific fields. */
export interface AssetData {
    key: string;
    fileName: string;
    assetType: AssetType;
    /** Map rows: display name in UI. */
    mapName?: string;
    /** Map rows: minimap source (generated vs pre-baked). */
    minimap?: Minimap;
    /** Sprite/tile rows: HBSprite category. */
    spriteType?: SpriteType;
    exportFramesAsDataUrls?: boolean;
    tileStartIndex?: number;
}

type GetAssetsOptions = {
    /** Forces all monster-derived sprites/sounds into the manifest, used by ZIP eager loading. */
    eagerMonsterAssets?: boolean;
};

/** All registerable assets; LoadingScreen walks this for preload. */
export const ASSETS: AssetData[] = [
    // Mapas propios (generados por tools/src/placeholders/map.ts)
    { key: 'map-campamento', fileName: 'campamento.amd', assetType: AssetType.MAP, mapName: 'Campamento', minimap: Minimap.ON_DEMAND_GENERATED },

    // Packs de tiles propios; tileStartIndex = primer índice global de cada pack
    { key: 'tile-fdn-ground', fileName: 'fdn-ground.spr', assetType: AssetType.TILE_SPRITE, spriteType: SpriteType.Tiles, tileStartIndex: 0 },
    { key: 'tile-fdn-objects', fileName: 'fdn-objects.spr', assetType: AssetType.TILE_SPRITE, spriteType: SpriteType.Tiles, tileStartIndex: 50 },
    { key: 'tile-fdn-trees', fileName: 'fdn-trees.spr', assetType: AssetType.TILE_SPRITE, spriteType: SpriteType.Tiles, tileStartIndex: 100 },
    { key: 'tile-fdn-treeshadows', fileName: 'fdn-treeshadows.spr', assetType: AssetType.TILE_SPRITE, spriteType: SpriteType.Tiles, tileStartIndex: 150 },

    // Other sprites (non-monster sprites)
    { key: 'sprite-wm', fileName: 'wm.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Human },
    { key: 'sprite-ym', fileName: 'ym.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Human },
    { key: 'sprite-bm', fileName: 'bm.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Human },
    { key: 'sprite-ww', fileName: 'ww.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Human },
    { key: 'sprite-yw', fileName: 'yw.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Human },
    { key: 'sprite-bw', fileName: 'bw.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Human },
    { key: 'sprite-mpt', fileName: 'mpt.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-wpt', fileName: 'wpt.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mhr', fileName: 'mhr.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-whr', fileName: 'whr.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mmantle04', fileName: 'mmantle04.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mhhauberk2', fileName: 'mhhauberk2.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mhhelm2', fileName: 'mhhelm2.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mhleggings2', fileName: 'mhleggings2.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mhpmail2', fileName: 'mhpmail2.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.EquipmentPack },
    { key: 'sprite-mbabhammer', fileName: 'mbabhammer.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Weapons },
    { key: 'sprite-interface', fileName: 'interface.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.Interface, exportFramesAsDataUrls: true },
    // Item sprite sheets (pack = inventory/bag, ground = on map)
    { key: 'sprite-item-pack', fileName: 'item-pack.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.ItemPack, exportFramesAsDataUrls: true },
    { key: 'sprite-item-ground', fileName: 'item-ground.spr', assetType: AssetType.SPRITE, spriteType: SpriteType.ItemGround, exportFramesAsDataUrls: true },
    
    // Music files
    { key: 'abaddon', fileName: 'abaddon.mp3', assetType: AssetType.MUSIC },
    { key: 'apocalypse', fileName: 'apocalypse.mp3', assetType: AssetType.MUSIC },
    { key: 'aresden', fileName: 'aresden.mp3', assetType: AssetType.MUSIC },
    { key: 'default', fileName: 'default.mp3', assetType: AssetType.MUSIC },
    { key: 'dungeon', fileName: 'dungeon.mp3', assetType: AssetType.MUSIC },
    { key: 'elvine', fileName: 'elvine.mp3', assetType: AssetType.MUSIC },
    { key: 'middleland', fileName: 'middleland.mp3', assetType: AssetType.MUSIC },
    
    // Sound files (non-monster sounds only, monster sounds are added dynamically)
    { key: 'C5', fileName: 'C5.mp3', assetType: AssetType.SOUND },
    { key: 'C6', fileName: 'C6.mp3', assetType: AssetType.SOUND },
    { key: 'C8', fileName: 'C8.mp3', assetType: AssetType.SOUND },
    { key: 'C10', fileName: 'C10.mp3', assetType: AssetType.SOUND },
    { key: 'C12', fileName: 'C12.mp3', assetType: AssetType.SOUND },
    { key: 'C13', fileName: 'C13.mp3', assetType: AssetType.SOUND },
    { key: 'C14', fileName: 'C14.mp3', assetType: AssetType.SOUND },
    { key: 'C15', fileName: 'C15.mp3', assetType: AssetType.SOUND },
    { key: 'C16', fileName: 'C16.mp3', assetType: AssetType.SOUND },
    { key: 'C17', fileName: 'C17.mp3', assetType: AssetType.SOUND },
    { key: 'C18', fileName: 'C18.mp3', assetType: AssetType.SOUND },
    { key: 'C23', fileName: 'C23.mp3', assetType: AssetType.SOUND },
    { key: 'C24', fileName: 'C24.mp3', assetType: AssetType.SOUND },
    { key: 'E1', fileName: 'E1.mp3', assetType: AssetType.SOUND },
    { key: 'E12', fileName: 'E12.mp3', assetType: AssetType.SOUND },
    { key: 'E20', fileName: 'E20.mp3', assetType: AssetType.SOUND },
    { key: 'E28', fileName: 'E28.mp3', assetType: AssetType.SOUND },
    { key: 'E29', fileName: 'E29.mp3', assetType: AssetType.SOUND },
    { key: 'E38', fileName: 'E38.mp3', assetType: AssetType.SOUND },
    { key: 'E40', fileName: 'E40.mp3', assetType: AssetType.SOUND },
    { key: 'E45', fileName: 'E45.mp3', assetType: AssetType.SOUND },
];

/** Adds sound/override sprite references from a single monster state into the provided sets. */
function collectMonsterStateAssets(state: MonsterStateConfig | undefined, spriteNames: Set<string>, sounds: Set<string>): void {
    if (state?.sound) {
        sounds.add(state.sound);
    }
    if (state?.animation?.spriteName) {
        spriteNames.add(state.animation.spriteName);
    }
}

/** Collects sprite and sound basenames required by a monster template. */
export function collectMonsterAssetNames(monster: MonsterData): { spriteNames: Set<string>; sounds: Set<string> } {
    const spriteNames = new Set<string>([monster.spriteName]);
    const sounds = new Set<string>();
    collectMonsterStateAssets(monster.states?.idle, spriteNames, sounds);
    collectMonsterStateAssets(monster.states?.move, spriteNames, sounds);
    collectMonsterStateAssets(monster.states?.attack, spriteNames, sounds);
    collectMonsterStateAssets(monster.states?.takeDamage, spriteNames, sounds);
    collectMonsterStateAssets(monster.states?.death, spriteNames, sounds);
    return { spriteNames, sounds };
}

/** Returns loadable asset rows for one monster sprite and its state override assets. */
export function getMonsterAssets(spriteName: string): AssetData[] {
    const monster = getMonsterData(spriteName);
    if (!monster) {
        return [];
    }

    const { spriteNames, sounds } = collectMonsterAssetNames(monster);
    const assets: AssetData[] = [];
    spriteNames.forEach((name) => {
        assets.push({
            key: `sprite-${name}`,
            fileName: `${name}.spr`,
            assetType: AssetType.SPRITE,
            spriteType: SpriteType.Monster
        });
    });
    sounds.forEach((soundFile) => {
        assets.push({
            key: soundFile.replace('.mp3', ''),
            fileName: soundFile,
            assetType: AssetType.SOUND
        });
    });
    return assets;
}

/**
 * All equipped appearance sprite basenames referenced by the item catalog (male and female).
 * Used for lazy-load eligibility and ZIP filtering; runtime loads only gender-resolved names per player.
 */
export function getItemEquippedAppearanceSpriteNames(): ReadonlySet<string> {
    const equippedSpriteNames = new Set<string>();
    ITEMS.forEach((item) => {
        if (item.equippedSpriteMale) {
            equippedSpriteNames.add(item.equippedSpriteMale);
        }
        if (item.equippedSpriteFemale) {
            equippedSpriteNames.add(item.equippedSpriteFemale);
        }
    });
    return equippedSpriteNames;
}

/**
 * Resolve load metadata for one equipped appearance `.spr` (static {@link ASSETS} row or synthesized Weapons row).
 */
export function getPlayerItemAppearanceAssetData(spriteName: string): AssetData {
    const key = `sprite-${spriteName}`;
    const row = ASSETS.find((a) => a.key === key && a.assetType === AssetType.SPRITE);
    if (row) {
        return row;
    }
    return {
        key,
        fileName: `${spriteName}.spr`,
        assetType: AssetType.SPRITE,
        spriteType: SpriteType.Weapons,
    };
}

/**
 * Get complete list of assets including dynamically generated monster assets.
 * This function combines the static ASSETS array with assets inferred from the MONSTERS array.
 *
 * @returns Complete array of all assets to load
 */
export function getAssets(options?: GetAssetsOptions): AssetData[] {
    // Start with base assets (maps, tile sprites, non-monster sprites, music, non-monster sounds)
    const assets = [...ASSETS];

    const eagerMonsterAssets = options?.eagerMonsterAssets ?? !LOAD_MONSTER_ASSETS_ON_DEMAND;
    // Track unique monster sprites and sounds to avoid duplicates
    const monsterSpriteNames = new Set<string>();
    const monsterSounds = new Set<string>();

    // Extract monster sprites and sounds from MONSTERS array
    MONSTERS.forEach(monster => {
        if (!eagerMonsterAssets) {
            if (monster.spriteName === MONSTER_PLACEHOLDER_SPRITE) {
                const monsterAssetNames = collectMonsterAssetNames(monster);
                monsterAssetNames.spriteNames.forEach((spriteName) => monsterSpriteNames.add(spriteName));
                monsterAssetNames.sounds.forEach((soundFile) => monsterSounds.add(soundFile));
            }
            return;
        }

        const monsterAssetNames = collectMonsterAssetNames(monster);
        monsterAssetNames.spriteNames.forEach((spriteName) => monsterSpriteNames.add(spriteName));
        monsterAssetNames.sounds.forEach((soundFile) => monsterSounds.add(soundFile));
    });
    
    // Add monster sprite assets
    monsterSpriteNames.forEach(spriteName => {
        assets.push({
            key: `sprite-${spriteName}`,
            fileName: `${spriteName}.spr`,
            assetType: AssetType.SPRITE,
            spriteType: SpriteType.Monster
        });
    });

    // Add NPC sprite assets (NPCs use Monster sprite type - same format)
    NPC_SPRITE_NAMES.forEach((sprite) => {
        if (!assets.some((asset) => asset.key === `sprite-${sprite}`) && !monsterSpriteNames.has(sprite)) {
            assets.push({
                key: `sprite-${sprite}`,
                fileName: `${sprite}.spr`,
                assetType: AssetType.SPRITE,
                spriteType: SpriteType.Monster
            });
        }
    });
    
    // Add monster sound assets
    monsterSounds.forEach(soundFile => {
        // Extract key from filename (e.g., 'M91.mp3' -> 'M91')
        const key = soundFile.replace('.mp3', '');
        assets.push({
            key,
            fileName: soundFile,
            assetType: AssetType.SOUND
        });
    });

    // Extract effect sprites and sounds from EFFECTS array
    const effectSpriteNames = new Set<string>();
    const effectSounds = new Set<string>();

    EFFECTS.forEach((effect) => {
        effectSpriteNames.add(effect.sprite);
        if (effect.sound) {
            effectSounds.add(effect.sound);
        }
    });

    // Add effect sprite assets
    effectSpriteNames.forEach((spriteName) => {
        assets.push({
            key: `sprite-${spriteName}`,
            fileName: `${spriteName}.spr`,
            assetType: AssetType.SPRITE,
            spriteType: SpriteType.Effect
        });
    });

    // Add effect sound assets
    effectSounds.forEach((soundFile) => {
        const key = soundFile.replace('.mp3', '');
        assets.push({
            key,
            fileName: soundFile,
            assetType: AssetType.SOUND
        });
    });

    // Add equipped sprites and consumption sounds from ITEMS
    const equippedSpriteNames = new Set<string>();
    const consumptionSounds = new Set<string>();
    ITEMS.forEach((item) => {
        if (item.equippedSpriteMale) {
            equippedSpriteNames.add(item.equippedSpriteMale);
        }
        if (item.equippedSpriteFemale) {
            equippedSpriteNames.add(item.equippedSpriteFemale);
        }
        if (item.consumptionSound) {
            consumptionSounds.add(item.consumptionSound);
        }
    });
    if (!LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND) {
        equippedSpriteNames.forEach((spriteName) => {
            // Skip if already in base ASSETS (e.g. mbabhammer)
            if (!assets.some((a) => a.key === `sprite-${spriteName}`)) {
                assets.push({
                    key: `sprite-${spriteName}`,
                    fileName: `${spriteName}.spr`,
                    assetType: AssetType.SPRITE,
                    spriteType: SpriteType.Weapons
                });
            }
        });
    }

    // Add consumption sounds from consumable ITEMS
    consumptionSounds.forEach((soundKey) => {
        if (!assets.some((a) => a.key === soundKey && a.assetType === AssetType.SOUND)) {
            assets.push({
                key: soundKey,
                fileName: `${soundKey}.mp3`,
                assetType: AssetType.SOUND
            });
        }
    });

    if (LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND) {
        const lazyNames = equippedSpriteNames;
        return assets.filter((a) => {
            if (a.assetType !== AssetType.SPRITE) {
                return true;
            }
            const prefix = 'sprite-';
            if (!a.key.startsWith(prefix)) {
                return true;
            }
            const basename = a.key.slice(prefix.length);
            return !lazyNames.has(basename);
        });
    }

    return assets;
}

/**
 * Get assets filtered by type
 */
export function getAssetsByType(type: AssetType): AssetData[] {
    return getAssets().filter(asset => asset.assetType === type);
}

/**
 * Get asset by key
 */
export function getAssetByKey(key: string): AssetData | undefined {
    return getAssets().find(asset => asset.key === key);
}

/**
 * Get all map assets (for backward compatibility with Maps.ts)
 */
export function getMapAssets(): AssetData[] {
    return getAssetsByType(AssetType.MAP);
}

/**
 * Calculate the total number of activities for the create phase
 * This includes tile sprites, other sprites, and maps that are processed in create()
 */
export function getCreatePhaseTotalActivities(assets: AssetData[] = getAssets()): number {
    const allAssets = assets;
    const tileSprites = allAssets.filter(a => a.assetType === AssetType.TILE_SPRITE).length;
    const sprites = allAssets.filter(a => a.assetType === AssetType.SPRITE).length;
    const maps = allAssets.filter(a => a.assetType === AssetType.MAP).length;
    return tileSprites + sprites + maps;
}
