/**
 * Reemplaza los assets provisorios por arte de Flare (CC-BY-SA 3.0) cuando hay una copia de
 * flare-game en reference/flare-game (la baja `pnpm assets:flare`). Nada de esto se sube al repo.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FlareCharacters, blankUnderwear, blankWearable, blankWings, type Gender } from './characters.ts';
import { buildFlareTilePacks } from './tiles.ts';

export interface GearUse { type: string; maxStart: number; blocks: Map<number, string> }

export function flareModDir(root: string): string | undefined {
    const dir = process.env.FLARE_DIR ?? join(root, 'reference', 'flare-game');
    const mod = join(dir, 'mods', 'fantasycore');
    return existsSync(join(mod, 'engine', 'hero_layers.txt')) ? mod : undefined;
}

const has = (name: string, ...words: string[]) => words.some((w) => name.includes(w));

/** Arma de Flare según el nombre del ítem. */
function weaponFor(name: string): string {
    const n = name.toLowerCase();
    if (has(n, 'bow')) return has(n, 'short', 'small') ? 'shortbow' : has(n, 'great', 'long') ? 'longbow' : 'shortbow';
    if (has(n, 'dagger', 'knife', 'dirk')) return 'dagger';
    if (has(n, 'axe')) return has(n, 'battle', 'great', 'double') ? 'battle_axe' : has(n, 'light', 'hand') ? 'hand_axe' : 'infantry_axe';
    if (has(n, 'hammer')) return 'war_hammer';
    if (has(n, 'maul')) return 'maul';
    if (has(n, 'mace', 'flail', 'morning')) return 'mace';
    if (has(n, 'club')) return 'club';
    if (has(n, 'wand')) return 'wand';
    if (has(n, 'staff', 'rod')) return has(n, 'great', 'magic') ? 'greatstaff' : 'staff';
    if (has(n, 'short')) return 'shortsword';
    if (has(n, 'great', 'giant', 'claymore', 'flamberge', 'zweih', 'two-hand', 'two hand', 'storm', 'colossal')) return 'greatsword';
    return 'longsword';
}
function shieldFor(name: string): string {
    const n = name.toLowerCase();
    if (has(n, 'tower', 'large', 'great')) return 'kite_shield';
    if (has(n, 'knight', 'iron', 'blonde')) return 'shield';
    if (has(n, 'wood', 'buckler', 'target', 'lagi')) return 'buckler';
    return 'iron_buckler';
}
/** Material de Flare para una prenda según su nombre. */
function material(name: string, fallbackIndex: number): 'plate' | 'chain' | 'leather' | 'mage' | 'cloth' {
    const n = name.toLowerCase();
    if (has(n, 'plate', 'knight', 'full')) return 'plate';
    if (has(n, 'chain', 'scale', 'mail', 'hauberk')) return 'chain';
    if (has(n, 'leather')) return 'leather';
    if (has(n, 'robe', 'wizard', 'mage', 'magic', 'hood')) return 'mage';
    if (has(n, 'shirt', 'cloth', 'tunic')) return 'cloth';
    return (['leather', 'chain', 'plate', 'mage'] as const)[fallbackIndex % 4];
}
const WEARABLE: Record<string, { slot: 'feet' | 'legs' | 'hands' | 'chest' | 'head'; items: Record<string, string> }> = {
    armor: { slot: 'chest', items: { plate: 'plate_cuirass', chain: 'chain_cuirass', leather: 'leather_chest', mage: 'mage_vest', cloth: 'cloth_shirt' } },
    hauberk: { slot: 'hands', items: { plate: 'plate_gauntlets', chain: 'chain_gloves', leather: 'leather_gloves', mage: 'mage_sleeves', cloth: 'cloth_gloves' } },
    leggings: { slot: 'legs', items: { plate: 'plate_greaves', chain: 'chain_greaves', leather: 'leather_pants', mage: 'mage_skirt', cloth: 'cloth_pants' } },
    boots: { slot: 'feet', items: { plate: 'plate_boots', chain: 'chain_boots', leather: 'leather_boots', mage: 'mage_boots', cloth: 'cloth_sandals' } },
    helmet: { slot: 'head', items: { plate: 'plate_helm', chain: 'chain_coif', leather: 'leather_hood', mage: 'mage_hood', cloth: 'leather_hood' } },
};

/** Mob de Flare para cada sprite del cliente: por palabra clave y, si no, rotando. */
function enemyFor(sprite: string, i: number): string {
    const n = sprite.toLowerCase();
    const rules: [string[], string][] = [
        [['liche', 'mage', 'sorceress'], 'skeleton_mage'],
        [['ske'], 'skeleton'],
        [['zom', 'ghk', 'demon', 'barlog', 'hellclaw'], 'zombie'],
        [['firewyvern'], 'wyvern_fire'],
        [['uglywyvern'], 'wyvern_water'],
        [['wyvern'], 'wyvern'],
        [['minotaur', 'troll', 'ettin', 'cyc', 'orge', 'mtgiant', 'gol', 'magmabull', 'centaurus'], 'minotaur'],
        [['ant'], 'fire_ant'],
        [['frost', 'icegolem'], 'ice_ant'],
        [['crayfish', 'turtle', 'tigerworm', 'lizard', 'cla', 'tentocle'], 'antlion'],
        [['orc', 'darkelf', 'elfmaster', 'stalker'], 'goblin_elite'],
        [['guard', 'knight', 'tk', 'werewolf'], 'hobgoblin'],
        [['dummy', 'scarecrow', 'detector', 'gt-', 'catapult', 'canplant', 'giantplant'], 'cursed_grave'],
    ];
    for (const [words, enemy] of rules) if (has(n, ...words)) return enemy;
    return ['goblin', 'hobgoblin', 'skeleton_weak', 'antlion_small', 'goblin', 'zombie', 'skeleton_archer', 'fire_ant'][i % 8];
}

const NPC_OUTFITS: [Gender, Partial<Record<'feet' | 'legs' | 'hands' | 'chest' | 'head' | 'main' | 'off', string>>][] = [
    ['male', { chest: 'leather_chest', legs: 'leather_pants', feet: 'leather_boots' }],
    ['female', { chest: 'mage_vest', legs: 'mage_skirt', feet: 'mage_boots', head: 'mage_hood' }],
    ['male', { chest: 'plate_cuirass', legs: 'plate_greaves', feet: 'plate_boots', head: 'plate_helm', main: 'longsword', off: 'shield' }],
    ['female_dark', { chest: 'cloth_shirt', legs: 'cloth_pants', feet: 'cloth_sandals' }],
    ['male', { chest: 'chain_cuirass', legs: 'chain_greaves', feet: 'chain_boots', head: 'chain_coif', main: 'mace' }],
];

export async function applyFlare(mod: string, opts: {
    write: (rel: string, data: Uint8Array) => void;
    gear: Map<string, GearUse>;
    monsters: string[];
    npcs: string[];
    log: (msg: string) => void;
}): Promise<void> {
    const { write, gear } = opts;
    const fc = new FlareCharacters(mod);

    // cuerpos: hombre (wm/ym/bm), mujer (ww/yw) y mujer de piel oscura (bw)
    for (const [file, g] of [['wm', 'male'], ['ym', 'male'], ['bm', 'male'], ['ww', 'female'], ['yw', 'female'], ['bw', 'female_dark']] as const) {
        write(`sprites/${file}.spr`, await fc.body(g));
    }
    write('sprites/mhr.spr', await fc.hair('male'));
    write('sprites/whr.spr', await fc.hair('female'));
    write('sprites/mpt.spr', blankUnderwear());
    write('sprites/wpt.spr', blankUnderwear());

    let i = 0;
    for (const [name, use] of [...gear].sort(([a], [b]) => a.localeCompare(b))) {
        const g: Gender = name.startsWith('w') ? 'female' : 'male';
        const firstItem = use.blocks.get(0) ?? [...use.blocks.values()][0] ?? name;
        if (use.type === 'weapon') {
            const blocks = Array.from({ length: Math.floor(use.maxStart / 56) + 1 }, (_, b) => use.blocks.get(b * 56));
            write(`sprites/${name}.spr`, await fc.weapon(g, blocks.map((it) => weaponFor(it ?? firstItem))));
        } else if (use.type === 'shield') {
            const blocks = Array.from({ length: Math.floor(use.maxStart / 7) + 1 }, (_, b) => use.blocks.get(b * 7));
            write(`sprites/${name}.spr`, await fc.shield(g, blocks.map((it) => shieldFor(it ?? firstItem))));
        } else if (use.type === 'accessory') {
            write(`sprites/${name}.spr`, blankWings());
        } else if (WEARABLE[use.type]) {
            const w = WEARABLE[use.type];
            const data = await fc.wearable(g, w.slot, w.items[material(firstItem, i)]);
            write(`sprites/${name}.spr`, data ?? blankWearable());
        } else {
            write(`sprites/${name}.spr`, blankWearable()); // capas: Flare no tiene
        }
        i++;
    }
    opts.log(`  Flare: ${gear.size} sprites de equipo`);

    for (const [k, n] of opts.npcs.entries()) {
        const [g, outfit] = NPC_OUTFITS[k % NPC_OUTFITS.length];
        write(`sprites/${n}.spr`, await fc.npc(g, outfit));
    }
    let converted = 0;
    for (const [k, m] of opts.monsters.entries()) {
        if (m.startsWith('ys')) continue; // proyectiles y efectos, no criaturas
        const data = await fc.monster(enemyFor(m, k));
        if (data) { write(`sprites/${m}.spr`, data); converted++; }
    }
    opts.log(`  Flare: ${converted} mobs, ${opts.npcs.length} NPCs`);

    for (const [file, data] of Object.entries(await buildFlareTilePacks(mod))) write(`sprites/${file}`, data);
}
