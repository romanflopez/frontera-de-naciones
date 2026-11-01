/**
 * Importa mapas de Flare (CC-BY-SA 3.0, mods/empyrean_campaign/maps) a datos de ERIS (docs/MAPAS_FLARE.md).
 * Por cada mapa genera packages/world/src/flare/<id>.ts con: tamaño cuadrado, capas de tiles de Flare (el atlas las pasa a ids de
 * ERIS), grilla de colisión sin bolsillos inalcanzables, el vacío de Flare rellenado de bosque (sin partes negras), zonas de caza en
 * 3 pits (cada uno con su mob y nivel), mobs sueltos entre pits y vínculos.
 *
 * Uso: FLARE_DIR=<flare-game o zip v1.14 descomprimido> pnpm --filter @fdn/tools flare:maps [id ...]
 * Determinista: sin Math.random ni hora; el mismo mapa da siempre el mismo archivo.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
interface MapSpec {
    /** Id del mapa en Flare. */ id: string;
    /** Id del mapa en ERIS. */ eris: string; name: string; region: string; pvp: 'off' | 'faction'; lvl: [number, number];
    pits: [PitSpec, PitSpec, PitSpec]; loose: LooseSpec[];
    /** Conexiones que Flare no trae (mapas que en Flare no se tocan): `near` = a unos pasos de la entrada, `far` = en el punto más lejano. Hay que declararlas en los dos mapas. */
    extras?: { to: string; where: 'near' | 'far' }[];
}

/** Un mapa por entrada. Pit A = el más cerca de la entrada (el más fácil), C = el más lejos. Los nombres de zona son únicos entre mapas. */
const SPECS: MapSpec[] = [
    { id: 'salted_field', eris: 'campos_de_sal', name: 'Campos de Sal', region: 'comun', pvp: 'off', lvl: [1, 2],
        pits: [{ name: 'Puesto goblin', type: 'goblin', lvl: 1 }, { name: 'Charco de zombis', type: 'zombie', lvl: 1 }, { name: 'Avanzada del campo', type: 'goblin_elite', lvl: 2 }],
        loose: [{ type: 'goblin', lvl: 1 }] },
    { id: 'stonewood', eris: 'bosque_de_piedra', name: 'Bosque de Piedra', region: 'comun', pvp: 'off', lvl: [1, 2],
        pits: [{ name: 'Claro de los goblins', type: 'goblin', lvl: 1 }, { name: 'Madriguera hobgoblin', type: 'hobgoblin', lvl: 2 }, { name: 'Fuerte del bosque', type: 'goblin_elite', lvl: 2 }],
        loose: [{ type: 'goblin', lvl: 1 }, { type: 'zombie', lvl: 2 }] },
    { id: 'goblin_camp', eris: 'canon_goblin', name: 'Cañón goblin', region: 'comun', pvp: 'faction', lvl: [2, 3],
        pits: [{ name: 'Empalizada del cañón', type: 'goblin_elite', lvl: 2 }, { name: 'Puesto de arqueros', type: 'hobgoblin_archer', lvl: 3 }, { name: 'Tienda del cabecilla', type: 'hobgoblin', lvl: 3 }],
        loose: [{ type: 'goblin', lvl: 2 }] },
    { id: 'merrimead_swamp', eris: 'pantano_de_merrimead', name: 'Pantano de Merrimead', region: 'comun', pvp: 'faction', lvl: [3, 4],
        pits: [{ name: 'Ciénaga de zombis', type: 'zombie', lvl: 3 }, { name: 'Pozo oscuro', type: 'zombie_dark', lvl: 4 }, { name: 'Lápidas del pantano', type: 'cursed_grave', lvl: 4 }],
        loose: [{ type: 'zombie', lvl: 3 }], extras: [{ to: 'altas_de_nazia', where: 'far' }] },
    { id: 'nazia_highlands', eris: 'altas_de_nazia', name: 'Altas de Nazia', region: 'comun', pvp: 'faction', lvl: [4, 5],
        pits: [{ name: 'Nidada de crías', type: 'antlion_small', lvl: 4 }, { name: 'Hoyos de las tierras altas', type: 'antlion', lvl: 4 }, { name: 'Hormigueros ardientes', type: 'fire_ant', lvl: 5 }],
        loose: [{ type: 'antlion_small', lvl: 4 }], extras: [{ to: 'pantano_de_merrimead', where: 'near' }] },
    { id: 'lochport_cemetery', eris: 'cementerio_de_lochport', name: 'Cementerio de Lochport', region: 'comun', pvp: 'faction', lvl: [5, 5],
        pits: [{ name: 'Tumbas viejas', type: 'skeleton', lvl: 5 }, { name: 'Arqueros del osario', type: 'skeleton_archer', lvl: 5 }, { name: 'Hechiceros del camposanto', type: 'skeleton_mage', lvl: 5 }],
        loose: [{ type: 'cursed_grave', lvl: 5 }], extras: [{ to: 'risco_del_sur', where: 'far' }] },
    { id: 'the_breach', eris: 'la_brecha', name: 'La Brecha', region: 'comun', pvp: 'faction', lvl: [6, 7],
        pits: [{ name: 'Túneles de hormiga león', type: 'antlion', lvl: 6 }, { name: 'Hormigueros de la brecha', type: 'fire_ant', lvl: 6 }, { name: 'Mineros caídos', type: 'zombie_dark', lvl: 7 }],
        loose: [{ type: 'antlion_small', lvl: 6 }, { type: 'fire_ant', lvl: 6 }], extras: [{ to: 'risco_del_sur', where: 'near' }] },
    { id: 'southern_ridge', eris: 'risco_del_sur', name: 'Risco del Sur', region: 'comun', pvp: 'faction', lvl: [5, 6],
        pits: [{ name: 'Risco de las hormigas', type: 'antlion', lvl: 5 }, { name: 'Atalaya en ruinas', type: 'skeleton_mage', lvl: 6 }, { name: 'Grietas de fuego', type: 'fire_ant', lvl: 6 }],
        loose: [{ type: 'antlion', lvl: 5 }, { type: 'skeleton', lvl: 5 }], extras: [{ to: 'cementerio_de_lochport', where: 'near' }, { to: 'la_brecha', where: 'far' }] },
];

/**
 * Relleno del vacío por tileset (el vacío de Flare es negro): piso de la propia hoja y objetos que lo cubren, en porcentajes
 * acumulados. Las celdas rellenadas quedan bloqueadas. Los ids son los de la hoja (se ven en el catálogo de tools/src/flare/mapatlas.ts).
 */
const FILLS: Record<string, { floor: number[]; deco: [number, number[]][] }> = {
    grassland: {
        floor: Array.from({ length: 16 }, (_, i) => 16 + i),
        deco: [[0.17, [248, 249, 250, 251]], [0.24, [252, 253, 254, 255]], [0.29, [240, 241, 242, 243]], [0.33, [128, 129, 130, 131]], [0.45, [112, 113, 124, 125, 126, 127]]],
    },
    // Cueva: el vacío es roca maciza. Piso verde oscuro (216-219) cubierto de columnas de roca (64-121, con la cara de atrás transparente), estalagmitas y piedras.
    cave: {
        floor: [216, 217, 218, 219],
        deco: [[0.40, [64, 65, 68, 69, 72, 76, 77, 80, 84, 86, 96, 97, 98, 99, 100, 101, 102, 112, 113, 114, 115]], [0.46, [144, 145, 146, 147, 148, 149]], [0.50, [150, 151, 152, 153]]],
    },
};

interface Region { x: number; y: number; w: number; h: number; category: string; level: number; min: number; max: number }
interface FlareLinkRaw { x: number; y: number; w: number; h: number; to: string; tx: number; ty: number; tooltip: string }
interface Parsed { w: number; h: number; tileset: string; title: string; hero: { x: number; y: number }; layers: Record<string, number[][]>; regions: Region[]; links: FlareLinkRaw[] }

function parseMap(path: string): Parsed {
    const hdr: Record<string, string> = {}, layers: Record<string, number[][]> = {}, regions: Region[] = [], links: FlareLinkRaw[] = [];
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
    const tsName = /tileset_(\w+)\.txt$/.exec(p.tileset)?.[1] ?? '';
    const N = Math.max(p.w, p.h);
    const grid = (name: string): number[][] => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (y < p.h && x < p.w ? p.layers[name]?.[y]?.[x] ?? 0 : 0)));
    const background = grid('background'), object = grid('object'), collision = grid('collision');

    // 1) Colisión: lo que no es de Flare (relleno a cuadrado) y toda colisión != 0 bloquea. Solo se queda lo alcanzable a pie desde la entrada.
    const hardBlock = collision.map((row, y) => row.map((v, x) => y >= p.h || x >= p.w || v !== 0));
    const near = (x: number, y: number): { x: number; y: number } | undefined => {
        for (let r = 0; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const cx = x + dx, cy = y + dy;
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && cx >= 0 && cy >= 0 && cx < N && cy < N && !hardBlock[cy][cx]) return { x: cx, y: cy };
        }
        return undefined;
    };
    const entry = near(p.hero.x, p.hero.y);
    if (!entry) throw new Error(`${spec.id}: la entrada (${p.hero.x},${p.hero.y}) no tiene celdas libres cerca`);
    const reach: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const queue: [number, number][] = [[entry.x, entry.y]]; reach[entry.y][entry.x] = true;
    const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N;
    const flood = (): void => {
        for (let i = 0; i < queue.length; i++) {
            const [x, y] = queue[i];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = x + dx, ny = y + dy;
                if (inside(nx, ny) && !hardBlock[ny][nx] && !reach[ny][nx]) { reach[ny][nx] = true; queue.push([nx, ny]); }
            }
        }
    };
    flood();
    // Flare se mueve en 8 direcciones y varias zonas se unen solo por una diagonal entre dos paredes; en ERIS se camina en 4 y el
    // validador pide que todo se alcance así. Por cada cruce diagonal se abre UNA de las dos celdas (la de colisión más liviana).
    let carved = 0;
    for (let round = 0; round < 50; round++) {
        const open: [number, number][] = [];
        for (const [x, y] of [...queue]) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!inside(nx, ny) || hardBlock[ny][nx] || reach[ny][nx] || !hardBlock[y][nx] || !hardBlock[ny][x]) continue;
            const ax = nx, ay = y, bx = x, by = ny;
            const [cx, cy] = collision[ay][ax] <= collision[by][bx] ? [ax, ay] : [bx, by];
            if (cx < p.w && cy < p.h) open.push([cx, cy]);
        }
        if (!open.length) break;
        for (const [cx, cy] of open) { hardBlock[cy][cx] = false; reach[cy][cx] = true; queue.push([cx, cy]); carved++; }
        flood();
    }
    if (carved) console.log(`${spec.id}: ${carved} cruces diagonales abiertos`);
    const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && reach[y][x];
    let walkable = 0; for (const r of reach) for (const v of r) if (v) walkable++;
    const snap = (x: number, y: number): { x: number; y: number } | undefined => {
        for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        return undefined;
    };

    // 2) Sin partes negras: el vacío de Flare (fuera de la isla, en los pozos y en el relleno a cuadrado) se rellena con el piso de la hoja
    // y objetos que lo cubren. Esas celdas ya están bloqueadas (no se pueden pisar).
    const fill = FILLS[tsName];
    if (fill) {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (background[y][x] !== 0) continue;
            const r = (k: number) => hashStr(`${spec.id}:${x},${y},${k}`) / 4294967296;
            // el piso va siempre (también bajo los acantilados, que tienen la cara de atrás transparente); los objetos, solo en celdas vacías
            background[y][x] = fill.floor[Math.floor(r(0) * fill.floor.length)];
            if (object[y][x] !== 0) continue;
            const roll = r(1), band = fill.deco.find(([t]) => roll < t);
            if (band) object[y][x] = band[1][Math.floor(r(2) * band[1].length)];
        }
    } else console.warn(`${spec.id}: tileset '${tsName}' sin relleno definido: el vacío queda negro`);

    // 3) Regiones de spawn de Flare -> centros caminables.
    const cells = p.regions.flatMap((r) => { const c = snap(Math.floor(r.x + r.w / 2), Math.floor(r.y + r.h / 2)); if (!c) return []; const rad = clamp(Math.round(Math.max(r.w, r.h) / 2), 4, 12); return [{ ...c, r: rad, n: clamp(Math.round((rad * rad) / 10), 3, 10) }]; });

    // 4) 3 pits: k-means determinista con semillas separadas (cerca de la entrada, lejos de la entrada y lo más lejos de ambas).
    const k = Math.min(3, cells.length);
    const byEntry = [...cells].sort((a, b) => dist(a, entry) - dist(b, entry));
    const seeds = [byEntry[0], byEntry[byEntry.length - 1]];
    if (k === 3) seeds.push([...cells].sort((a, b) => Math.min(dist(b, seeds[0]), dist(b, seeds[1])) - Math.min(dist(a, seeds[0]), dist(a, seeds[1])))[0]);
    let centers = seeds.slice(0, k).map((c) => ({ x: c.x, y: c.y }));
    let label = cells.map(() => 0);
    const recenter = () => { centers = centers.map((m, i) => { const mine = cells.filter((_, j) => label[j] === i); return mine.length ? { x: mine.reduce((s, c) => s + c.x, 0) / mine.length, y: mine.reduce((s, c) => s + c.y, 0) / mine.length } : m; }); };
    for (let it = 0; it < 20; it++) { label = cells.map((c) => centers.reduce((best, m, i) => (dist(c, m) < dist(c, centers[best]) ? i : best), 0)); recenter(); }
    // Rebalance: ningún pit queda con menos de ~1/3 de las zonas (mueve la zona más cercana desde el pit más grande).
    const minSize = Math.max(1, Math.floor(cells.length / 3) - 1);
    for (let guard = 0; guard < cells.length; guard++) {
        const sizes = centers.map((_, i) => label.filter((l) => l === i).length);
        const small = sizes.indexOf(Math.min(...sizes)), big = sizes.indexOf(Math.max(...sizes));
        if (sizes[small] >= minSize || small === big) break;
        const cand = cells.map((c, j) => ({ j, d: dist(c, centers[small]) })).filter((o) => label[o.j] === big).sort((a, b) => a.d - b.d)[0];
        label[cand.j] = small; recenter();
    }
    const order = centers.map((_, i) => i).sort((a, b) => dist(centers[a], entry) - dist(centers[b], entry)); // A (cerca) -> C (lejos)
    const zones: OutZone[] = [];
    cells.forEach((c, j) => { const pit = order.indexOf(label[j]), s = spec.pits[pit]; zones.push({ type: s.type, x: c.x, y: c.y, r: c.r, n: c.n, name: s.name, lvl: s.lvl, kind: 'pit', pit }); });

    // 5) Mobs sueltos: zonas chicas repartidas por todo el mapa entre los pits y lejos de la entrada (1 cada ~250 celdas caminables).
    const rnd = makeRnd(hashStr(spec.id));
    const want = clamp(Math.round(walkable / 250), 3, 18), loose: OutZone[] = [];
    for (let tries = 0; tries < 8000 && loose.length < want; tries++) {
        const c = { x: Math.floor(rnd() * N), y: Math.floor(rnd() * N) };
        if (!free(c.x, c.y) || dist(c, entry) < 12) continue;
        if (zones.some((z) => dist(z, c) < z.r + 6) || loose.some((z) => dist(z, c) < 13)) continue;
        const s = spec.loose[loose.length % spec.loose.length];
        loose.push({ type: s.type, x: c.x, y: c.y, r: 5, n: 2, name: `Merodeadores de ${spec.name}`, lvl: s.lvl, kind: 'loose' });
    }
    zones.push(...loose);
    for (const z of zones) if (!knownMobs.has(z.type)) throw new Error(`${spec.id}: tipo de mob desconocido "${z.type}" (agregalo a MOB_TYPES o cambialo en SPECS)`);

    // 6) Vínculos de Flare: la celda disparadora es la libre más cercana al centro de su rectángulo.
    const links = p.links.flatMap((l) => { const c = snap(Math.floor(l.x + l.w / 2), Math.floor(l.y + l.h / 2)); return c ? [{ cell: c, to: l.to, tx: l.tx, ty: l.ty, tooltip: l.tooltip }] : []; });

    // 7) Conexiones extra: celda caminable con espacio alrededor, lejos de la entrada (far) o a unos pasos de ella (near), separadas de todo lo demás.
    const taken: { x: number; y: number }[] = [entry, ...links.map((l) => l.cell)];
    const roomy = (x: number, y: number): boolean => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (free(x + dx, y + dy)) n++; return n >= 8; };
    const cand: { x: number; y: number }[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (free(x, y) && roomy(x, y)) cand.push({ x, y });
    const extras = (spec.extras ?? []).map((e) => {
        const pool = cand.filter((c) => taken.every((t) => dist(t, c) >= 9) && (e.where === 'far' || (dist(c, entry) >= 5 && dist(c, entry) <= 12)));
        const best = e.where === 'far' ? pool.sort((a, b) => dist(b, entry) - dist(a, entry) || a.y - b.y || a.x - b.x)[0] : pool.sort((a, b) => dist(a, entry) - dist(b, entry) || a.y - b.y || a.x - b.x)[0];
        if (!best) throw new Error(`${spec.id}: no encontré celda para la conexión a ${e.to}`);
        taken.push(best); return { to: e.to, cell: best };
    });

    return {
        id: spec.id, eris: spec.eris, name: spec.name, region: spec.region, pvp: spec.pvp, lvl: spec.lvl, tileset: tsName, size: N, flareSize: [p.w, p.h], entry,
        source: `Flare (flare-game) mods/empyrean_campaign/maps/${spec.id}.txt`, license: 'CC-BY-SA-3.0 (adaptado: ver docs/MAPAS_FLARE.md)',
        walkable, zones, links, extras, layers: { background, object }, blocked: reach.map((r) => r.map((v) => (v ? 0 : 1))),
    };
}

if (!existsSync(mapsDir)) { console.error(`No encontré los mapas de Flare en ${mapsDir}. Apuntá FLARE_DIR a flare-game o al zip v1.14.`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const wanted = process.argv.slice(2);
for (const spec of SPECS.filter((s) => !wanted.length || wanted.includes(s.id))) {
    const out = convert(spec) as { size: number; walkable: number; zones: OutZone[]; links: unknown[]; extras: unknown[] };
    const header = `/**\n * Generado por tools/src/flare/maps.ts a partir del mapa '${spec.id}' de Flare (CC-BY-SA 3.0; autores en CREDITS.txt de Flare).\n * Adaptado para ERIS (relleno del vacío, pits, mobs sueltos). No editar a mano: se regenera con pnpm --filter @fdn/tools flare:maps.\n */\n`;
    writeFileSync(join(outDir, spec.id + '.ts'), `${header}import type { FlareMapData } from './types';\n\nexport const DATA: FlareMapData = ${JSON.stringify(out)};\n`);
    rmSync(join(outDir, spec.id + '.json'), { force: true });
    const pits = [0, 1, 2].map((i) => out.zones.filter((z) => z.pit === i).length), loose = out.zones.filter((z) => z.kind === 'loose').length;
    console.log(`${spec.id} -> ${spec.eris}: ${out.size}x${out.size}, ${out.walkable} celdas caminables, pits A/B/C = ${pits.join('/')} zonas, ${loose} sueltas, ${out.links.length} vínculos + ${out.extras.length} extra`);
}
