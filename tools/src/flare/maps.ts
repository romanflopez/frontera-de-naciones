/**
 * Importa mapas de Flare (CC-BY-SA 3.0, mods/empyrean_campaign/maps) a datos de ERIS (docs/MAPAS_FLARE.md).
 * Por cada mapa genera packages/world/src/flare/<id>.json con: tamaño cuadrado, capas de tiles de Flare (todavía sin pasar
 * al atlas de ERIS), grilla de colisión, zonas de caza en 3 pits (cada uno con su mob y nivel), mobs sueltos entre pits y vínculos.
 *
 * Uso: FLARE_DIR=<flare-game o zip v1.14 descomprimido> pnpm --filter @fdn/tools flare:maps [id ...]
 * Determinista: sin Math.random ni hora; el mismo mapa da siempre el mismo JSON.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const flare = process.env.FLARE_DIR ?? join(root, 'reference', 'flare-game');
const mapsDir = join(flare, 'mods', 'empyrean_campaign', 'maps');
const outDir = join(root, 'packages', 'world', 'src', 'flare');

/** Tipos de mob que existen hoy (mobs.ts). Se lee del archivo para no duplicar la lista. */
const knownMobs = new Set([...readFileSync(join(root, 'packages', 'world', 'src', 'mobs.ts'), 'utf8').matchAll(/MOB_TYPES: MobType\[\] = \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])));

interface PitSpec { name: string; type: string; lvl: number }
interface LooseSpec { type: string; lvl: number }
interface MapSpec { id: string; name: string; lvl: [number, number]; pits: [PitSpec, PitSpec, PitSpec]; loose: LooseSpec[] }

/** Un mapa por entrada. Pit A = el más cerca de la entrada (el más fácil), C = el más lejos. Los nombres de zona son únicos entre mapas. */
const SPECS: MapSpec[] = [
    { id: 'salted_field', name: 'Campos de Sal', lvl: [1, 2],
        pits: [{ name: 'Puesto goblin', type: 'goblin', lvl: 1 }, { name: 'Charco de zombis', type: 'zombie', lvl: 1 }, { name: 'Avanzada del campo', type: 'goblin_elite', lvl: 2 }],
        loose: [{ type: 'goblin', lvl: 1 }] },
    { id: 'stonewood', name: 'Bosque de Piedra', lvl: [1, 2],
        pits: [{ name: 'Claro de los goblins', type: 'goblin', lvl: 1 }, { name: 'Hoyos del bosque', type: 'antlion', lvl: 2 }, { name: 'Fuerte del bosque', type: 'goblin_elite', lvl: 2 }],
        loose: [{ type: 'goblin', lvl: 1 }, { type: 'zombie', lvl: 2 }] },
    { id: 'goblin_camp', name: 'Campamento goblin', lvl: [2, 3],
        pits: [{ name: 'Empalizada', type: 'goblin_elite', lvl: 2 }, { name: 'Fosa de huesos', type: 'skeleton', lvl: 3 }, { name: 'Tienda del cabecilla', type: 'goblin', lvl: 3 }],
        loose: [{ type: 'goblin', lvl: 2 }] },
];

interface Region { x: number; y: number; w: number; h: number; category: string; level: number; min: number; max: number }
interface Link { x: number; y: number; w: number; h: number; to: string; tx: number; ty: number; tooltip: string }
interface Parsed { w: number; h: number; tileset: string; title: string; hero: { x: number; y: number }; layers: Record<string, number[][]>; regions: Region[]; links: Link[] }

function parseMap(path: string): Parsed {
    const hdr: Record<string, string> = {}, layers: Record<string, number[][]> = {}, regions: Region[] = [], links: Link[] = [];
    let sec = '', cur: Record<string, string> = {}, rows: number[][] = [], inData = false;
    const flush = () => {
        if (sec === 'layer' && cur.type) layers[cur.type] = rows;
        else if (sec === 'enemy' && cur.location) {
            const [x, y, w, h] = cur.location.split(',').map(Number);
            const n = (cur.number ?? '1').split(',').map(Number);
            regions.push({ x, y, w, h, category: cur.category ?? cur.type ?? '?', level: Number(cur.level ?? 1), min: n[0], max: n[1] ?? n[0] });
        } else if (sec === 'event' && cur.intermap && cur.location) {
            const [x, y, w, h] = cur.location.split(',').map(Number);
            const [to, tx, ty] = cur.intermap.split(',');
            links.push({ x, y, w, h, to: to.replace(/^maps\//, '').replace(/\.txt$/, ''), tx: Number(tx), ty: Number(ty), tooltip: cur.tooltip ?? '' });
        }
        cur = {}; rows = []; inData = false;
    };
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const l = raw.trim();
        if (!l || l.startsWith('#')) continue;
        const m = /^\[(.+)\]$/.exec(l);
        if (m) { flush(); sec = m[1]; continue; }
        if (sec === 'layer' && inData) { rows.push(l.replace(/,$/, '').split(',').map(Number)); continue; }
        const eq = l.indexOf('=');
        if (eq < 0) continue;
        const k = l.slice(0, eq), v = l.slice(eq + 1);
        if (sec === 'header') hdr[k] = v;
        else if (sec === 'layer' && k === 'data') inData = true;
        else cur[k] = v;
    }
    flush();
    const [hx, hy] = (hdr.hero_pos ?? '0,0').split(',').map(Number);
    return { w: Number(hdr.width), h: Number(hdr.height), tileset: hdr.tileset ?? '', title: hdr.title ?? '', hero: { x: hx, y: hy }, layers, regions, links };
}

const hashStr = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const makeRnd = (seed0: number) => () => { let t = (seed0 = (seed0 + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface OutZone { type: string; x: number; y: number; r: number; n: number; name: string; lvl: number; kind: 'pit' | 'loose'; pit?: number }

function convert(spec: MapSpec): object {
    const p = parseMap(join(mapsDir, spec.id + '.txt'));
    const N = Math.max(p.w, p.h);
    const grid = (name: string): number[][] => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (y < p.h && x < p.w ? p.layers[name]?.[y]?.[x] ?? 0 : 0)));
    const background = grid('background'), object = grid('object'), collision = grid('collision');
    // Sin celdas de relleno libres: lo que no es de Flare queda bloqueado (cuadrado), y toda colisión != 0 bloquea.
    const blocked = collision.map((row, y) => row.map((v, x) => y >= p.h || x >= p.w || v !== 0));
    const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && !blocked[y][x];
    let walkable = 0; for (const r of blocked) for (const b of r) if (!b) walkable++;

    const snap = (x: number, y: number): { x: number; y: number } | undefined => {
        for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        return undefined;
    };
    // Regiones de Flare -> centros caminables.
    const cells = p.regions.flatMap((r) => { const c = snap(Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)); return c ? [{ ...c, r: clamp(Math.round(Math.max(r.w, r.h) / 2), 4, 12), n: Math.max(1, r.max) }] : []; });

    // 3 pits: k-means determinista con semillas separadas (cerca de la entrada, lejos de la entrada y lo más lejos de ambas).
    const k = Math.min(3, cells.length);
    const byEntry = [...cells].sort((a, b) => dist(a, p.hero) - dist(b, p.hero));
    const seeds = [byEntry[0], byEntry[byEntry.length - 1]];
    if (k === 3) seeds.push([...cells].sort((a, b) => Math.min(dist(b, seeds[0]), dist(b, seeds[1])) - Math.min(dist(a, seeds[0]), dist(a, seeds[1])))[0]);
    let centers = seeds.slice(0, k).map((c) => ({ x: c.x, y: c.y }));
    let label = cells.map(() => 0);
    for (let it = 0; it < 20; it++) {
        label = cells.map((c) => centers.reduce((best, m, i) => (dist(c, m) < dist(c, centers[best]) ? i : best), 0));
        centers = centers.map((m, i) => { const mine = cells.filter((_, j) => label[j] === i); return mine.length ? { x: mine.reduce((s, c) => s + c.x, 0) / mine.length, y: mine.reduce((s, c) => s + c.y, 0) / mine.length } : m; });
    }
    // Rebalance: ningún pit queda con menos de ~1/3 de las zonas (mueve la zona más cercana desde el pit más grande).
    const minSize = Math.max(1, Math.floor(cells.length / 3) - 1);
    for (let guard = 0; guard < cells.length; guard++) {
        const sizes = centers.map((_, i) => label.filter((l) => l === i).length);
        const small = sizes.indexOf(Math.min(...sizes)), big = sizes.indexOf(Math.max(...sizes));
        if (sizes[small] >= minSize || small === big) break;
        const cand = cells.map((c, j) => ({ j, d: dist(c, centers[small]) })).filter((o) => label[o.j] === big).sort((a, b) => a.d - b.d)[0];
        label[cand.j] = small;
        centers = centers.map((m, i) => { const mine = cells.filter((_, j) => label[j] === i); return mine.length ? { x: mine.reduce((t, c) => t + c.x, 0) / mine.length, y: mine.reduce((t, c) => t + c.y, 0) / mine.length } : m; });
    }
    const order = centers.map((c, i) => i).sort((a, b) => dist(centers[a], p.hero) - dist(centers[b], p.hero)); // A (cerca) -> C (lejos)
    const zones: OutZone[] = [];
    cells.forEach((c, j) => {
        const pit = order.indexOf(label[j]), s = spec.pits[pit];
        zones.push({ type: s.type, x: c.x, y: c.y, r: c.r, n: c.n, name: s.name, lvl: s.lvl, kind: 'pit', pit });
    });

    // Mobs sueltos: zonas chicas repartidas por todo el mapa entre los pits y lejos de la entrada (1 cada ~250 celdas caminables).
    const rnd = makeRnd(hashStr(spec.id));
    const want = clamp(Math.round(walkable / 250), 3, 18), loose: OutZone[] = [];
    for (let tries = 0; tries < 8000 && loose.length < want; tries++) {
        const c = { x: Math.floor(rnd() * N), y: Math.floor(rnd() * N) };
        if (!free(c.x, c.y) || dist(c, p.hero) < 12) continue;
        if (zones.some((z) => dist(z, c) < z.r + 6) || loose.some((z) => dist(z, c) < 13)) continue;
        const s = spec.loose[loose.length % spec.loose.length];
        loose.push({ type: s.type, x: c.x, y: c.y, r: 5, n: 2, name: `Merodeadores de ${spec.name}`, lvl: s.lvl, kind: 'loose' });
    }
    zones.push(...loose);
    for (const z of zones) if (!knownMobs.has(z.type)) throw new Error(`${spec.id}: tipo de mob desconocido "${z.type}" (agregalo a MOB_TYPES o cambialo en SPECS)`);

    return {
        id: spec.id, name: spec.name, lvl: spec.lvl, size: N, flareSize: [p.w, p.h], tileset: p.tileset, entry: p.hero,
        source: `Flare (flare-game) mods/empyrean_campaign/maps/${spec.id}.txt`, license: 'CC-BY-SA-3.0 (adaptado: ver docs/MAPAS_FLARE.md)',
        walkable, zones, links: p.links, layers: { background, object }, blocked: blocked.map((r) => r.map((b) => (b ? 1 : 0))),
    };
}

if (!existsSync(mapsDir)) { console.error(`No encontré los mapas de Flare en ${mapsDir}. Apuntá FLARE_DIR a flare-game o al zip v1.14.`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const wanted = process.argv.slice(2);
for (const spec of SPECS.filter((s) => !wanted.length || wanted.includes(s.id))) {
    const out = convert(spec) as { size: number; walkable: number; zones: OutZone[] };
    writeFileSync(join(outDir, spec.id + '.json'), JSON.stringify(out) + '\n');
    const pits = [0, 1, 2].map((i) => out.zones.filter((z) => z.pit === i).length), loose = out.zones.filter((z) => z.kind === 'loose').length;
    console.log(`${spec.id}: ${out.size}x${out.size}, ${out.walkable} celdas caminables, pits A/B/C = ${pits.join('/')} zonas, ${loose} sueltas`);
}
