/**
 * Genera el pack de assets provisorios en apps/client/public/assets.
 * Ningún archivo sale del Helbreath: todo se dibuja o sintetiza acá.
 *
 * Uso: pnpm assets  (desde la raíz del repo)
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBody, buildDirectionalLayer, buildEffect, buildInterface, buildItemIcons, buildMonster, buildNpc } from './sprites.ts';
import { backgroundJpeg, silence, soundEffect } from './media.ts';
import { decodeSprHeader } from './spr.ts';
import type { FigureStyle } from './figure.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const clientSrc = join(root, 'apps', 'client', 'src');
const out = join(root, 'apps', 'client', 'public', 'assets');

// ---------- leer qué nombres usa el cliente ----------
function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
}
const sources = walk(clientSrc).map((f) => readFileSync(f, 'utf8'));
const all = sources.join('\n');
const read = (rel: string) => readFileSync(join(clientSrc, rel), 'utf8');
const uniq = (xs: Iterable<string>) => [...new Set(xs)].sort();

const assetsTs = read('constants/Assets.ts');
const music = uniq([...assetsTs.matchAll(/fileName: '([\w-]+)\.mp3', assetType: AssetType\.MUSIC/g)].map((m) => m[1]));
const sounds = uniq([
    ...[...all.matchAll(/'([\w-]+)\.mp3'/g)].map((m) => m[1]),
    // sonidos que se nombran sin extensión, por ejemplo consumptionSound: 'C19'
    ...[...all.matchAll(/[sS]ound\w*: *'([A-Za-z0-9_-]+)'/g)].map((m) => m[1]),
]).filter((s) => !music.includes(s));
const monsters = uniq([...read('constants/Monsters.ts').matchAll(/spriteName: '([\w-]+)'/g)].map((m) => m[1]));
const npcs = uniq([...read('constants/NPCs.ts').matchAll(/^\s+'([\w-]+)',$/gm)].map((m) => m[1]));
const effects = uniq([...all.matchAll(/sprite: '((?:\w*effect)\w*)'/g), ...all.matchAll(/'((?:cru|ys)?effect\d*)'/g)].map((m) => m[1]));
const placeholderMonster = /MONSTER_PLACEHOLDER_SPRITE = '([\w-]+)'/.exec(read('Config.ts'))?.[1] ?? 'ghk';

// ---------- estilos ----------
const SKIN = { w: '#e8c39e', y: '#c68e5a', b: '#7a4a2a' } as const;
const HAIR = ['#2b1d12', '#6b3e1f', '#c9a15a', '#1a1a1a', '#8c2f1e', '#5a4a3a', '#d9d4c8', '#3b2a4a'];
const UNDER = ['#e8e2d0', '#3a5a8c', '#8c2f2f', '#2f6b3a', '#4a3a2a', '#6b4a8c', '#1f1f1f', '#b08a3a'];
const ROBES = ['#5a3a2a', '#2f4a6b', '#6b2f2f', '#3a5a3a', '#4a4a5a', '#6b5a2f', '#3a2f5a', '#2f5a5a', '#5a2f4a', '#4a3a1f'];
const style = (skin: string, female: boolean, i = 0): FigureStyle => ({
    skin, female, hairColor: HAIR[i % 8], hairStyle: i % 8, underwear: UNDER[i % 8], robe: ROBES[i % ROBES.length],
});

// ---------- escribir ----------
let files = 0, bytes = 0;
function write(rel: string, data: Uint8Array) {
    const p = join(out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    files++; bytes += data.length;
}
const t0 = Date.now();

for (const [prefix, female] of [['m', false], ['w', true]] as const) {
    for (const [skinKey, skin] of Object.entries(SKIN)) {
        // wm, ym, bm = hombre (piel clara, trigueña, oscura); ww, yw, bw = mujer
        write(`sprites/${skinKey}${prefix}.spr`, buildBody(style(skin, female)));
    }
    const layerStyles = Array.from({ length: 8 }, (_, i) => style(SKIN.w, female, i));
    write(`sprites/${prefix}hr.spr`, buildDirectionalLayer('hair', layerStyles));
    write(`sprites/${prefix}pt.spr`, buildDirectionalLayer('underwear', layerStyles));
}
npcs.forEach((n, i) => write(`sprites/${n}.spr`, buildNpc(style(Object.values(SKIN)[i % 3], i % 3 === 1, i))));
const monsterColors = ['#6aa84f', '#a64d79', '#3d85c6', '#e69138', '#999999', '#cc0000', '#674ea7', '#45818e'];
[...monsters, placeholderMonster].forEach((m, i) => write(`sprites/${m}.spr`, buildMonster(monsterColors[i % monsterColors.length], 0.9 + (i % 4) * 0.25)));
effects.forEach((e, i) => write(`sprites/${e}.spr`, buildEffect(i)));
write('sprites/interface.spr', buildInterface());
write('sprites/item-pack.spr', buildItemIcons(24, 192));
write('sprites/item-ground.spr', buildItemIcons(24, 192));
for (const s of sounds) write(`sounds/${s}.mp3`, soundEffect(s));
for (const m of music) write(`music/${m}.mp3`, silence());
write('images/LoadingBg.jpg', backgroundJpeg(1280, 800, 'Cargando el mundo…'));
write('images/LoginScreenBg.jpg', backgroundJpeg(1280, 800, 'Prototipo con arte provisorio'));
write('images/SiteBg.jpg', backgroundJpeg(1280, 800, ''));

// verificación rápida de un archivo
const check = decodeSprHeader(readFileSync(join(out, 'sprites/wm.spr')));
if (check.sheets.length !== 96 || check.sheets[64].frames.length !== 16) throw new Error('wm.spr no tiene la estructura esperada');

console.log(`Assets provisorios: ${files} archivos, ${(bytes / 1048576).toFixed(1)} MB en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  ${monsters.length + 1} mobs, ${npcs.length} NPCs, ${effects.length} efectos, ${sounds.length} sonidos, ${music.length} músicas`);
