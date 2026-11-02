/**
 * Convierte un mapa de Tiled ("JSON map", .tmj/.json) a datos de ERIS con el MISMO shape que genera flare:maps (`FlareMapData`).
 * Escribe packages/world/src/tiled/<id>.ts y regenera packages/world/src/tiled/index.ts (registro), que maps.ts suma a MAPS.
 *
 * Uso: pnpm maps:tiled <input.json> [--id <id>]
 *
 * Qué lee del .json:
 *  - Capas de tiles: `ground` (o `background`) = piso, `decor` (o `object`) = objetos, `collisions` (o `collision`) = != 0 bloquea.
 *  - Una sola hoja de tiles, que se tiene que llamar como una de FLARE_BASE (grassland, cave, dungeon, snowplains). El id que se
 *    guarda es el de Flare: gid - firstgid + 1 (los mapas de Flare se hacen en Tiled con firstgid = 1, así que coincide).
 *  - Capa de objetos `spawns`: un objeto de tipo/clase `entry` (entrada del mapa; si no hay, la primera celda libre) y zonas de mobs
 *    con propiedades `mob` (MobType), `lvl`, y opcionales `n`, `r`, `kind` (pit|loose|boss), `pit` (0-2). El nombre del objeto es
 *    el nombre de la zona.
 *  - Capa de objetos `triggers`: conexiones a otros mapas con propiedades `to` (id de ERIS), opcionales `kind` (portal|door), `gate`.
 *  - Propiedades del mapa (opcionales): `id`, `name`, `region`, `pvp` (off|faction), `lvlMin`, `lvlMax`, `dungeon` (bool).
 *
 * Determinista: el mismo .json da siempre el mismo archivo. Incluye `HASH` = mapHash() del mapa armado (lo que valida MapReady).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLARE_BASE, type FlareMapData, type FlareZone } from '../../../packages/world/src/flare/types.ts';
import { buildFlareMap } from '../../../packages/world/src/flare/index.ts';
import { mapHash } from '../../../packages/world/src/maps.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outDir = join(root, 'packages', 'world', 'src', 'tiled');

const knownMobs = new Set([...readFileSync(join(root, 'packages', 'world', 'src', 'mobs.ts'), 'utf8').matchAll(/MOB_TYPES: MobType\[\] = \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])));

type Prop = { name: string; type?: string; value: unknown };
interface TiledObject { id: number; name?: string; type?: string; class?: string; x: number; y: number; width?: number; height?: number; point?: boolean; properties?: Prop[] }
interface TiledLayer { name: string; type: 'tilelayer' | 'objectgroup' | 'group' | 'imagelayer'; width?: number; height?: number; data?: number[] | string; encoding?: string; compression?: string; objects?: TiledObject[]; layers?: TiledLayer[] }
interface TiledTileset { firstgid: number; name?: string; source?: string; tilecount?: number }
interface TiledMap { width: number; height: number; tilewidth: number; tileheight: number; orientation: string; infinite?: boolean; layers: TiledLayer[]; tilesets: TiledTileset[]; properties?: Prop[] }

const fail = (msg: string): never => { console.error(`maps:tiled: ${msg}`); process.exit(1); };
const prop = (ps: Prop[] | undefined, k: string): unknown => ps?.find((p) => p.name === k)?.value;
const GID_MASK = 0x1fffffff; // sin los bits de espejado/rotación de Tiled

// --- argumentos -------------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const idFlag = args.indexOf('--id');
const forcedId = idFlag >= 0 ? args.splice(idFlag, 2)[1] : undefined;
if (args.length !== 1) fail('uso: pnpm maps:tiled <input.json> [--id <id>]');
const input = resolve(process.env.INIT_CWD ?? process.cwd(), args[0]);
if (!existsSync(input)) fail(`no existe ${input}`);
const tm = JSON.parse(readFileSync(input, 'utf8')) as TiledMap;

if (tm.infinite) fail('mapas infinitos no soportados (Map > Map Properties > Infinite = off)');
const W = tm.width, H = tm.height, N = Math.max(W, H);
const id = String(forcedId ?? prop(tm.properties, 'id') ?? basename(input, extname(input))).toLowerCase().replace(/[^a-z0-9_]/g, '_');

// --- capas ------------------------------------------------------------------------------------------------------------------
const flat = (ls: TiledLayer[]): TiledLayer[] => ls.flatMap((l) => (l.type === 'group' ? flat(l.layers ?? []) : [l]));
const layers = flat(tm.layers);
const byName = (...names: string[]) => layers.find((l) => names.includes(l.name.toLowerCase()));

function decode(l: TiledLayer): number[] {
    if (Array.isArray(l.data)) return l.data;
    if (l.encoding === 'base64' && !l.compression) {
        const b = Buffer.from(String(l.data), 'base64');
        return Array.from({ length: b.length / 4 }, (_, i) => b.readUInt32LE(i * 4));
    }
    return fail(`capa '${l.name}': formato ${l.encoding}/${l.compression} no soportado (usá CSV o Base64 sin comprimir)`);
}
const tileLayer = (...names: string[]): number[][] | undefined => {
    const l = byName(...names);
    if (!l) return undefined;
    if (l.type !== 'tilelayer') fail(`'${l.name}' tiene que ser una capa de tiles`);
    const d = decode(l);
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (x < W && y < H ? (d[y * W + x] ?? 0) & GID_MASK : 0)));
};
const ground = tileLayer('ground', 'background') ?? fail("falta la capa de tiles 'ground'");
const decor = tileLayer('decor', 'object', 'objects') ?? Array.from({ length: N }, () => new Array<number>(N).fill(0));
const collisions = tileLayer('collisions', 'collision') ?? fail("falta la capa de tiles 'collisions'");

// --- hoja de tiles ----------------------------------------------------------------------------------------------------------
const sets = [...tm.tilesets].sort((a, b) => a.firstgid - b.firstgid);
const setOf = (gid: number) => [...sets].reverse().find((s) => gid >= s.firstgid);
const setName = (s: TiledTileset) => (s.name ?? basename(s.source ?? '', extname(s.source ?? ''))).toLowerCase().replace(/^tileset_/, '');
const used = new Set<TiledTileset>();
for (const g of [ground, decor]) for (const row of g) for (const v of row) if (v) used.add(setOf(v) ?? fail(`gid ${v} sin hoja`));
if (used.size !== 1) fail(`ground y decor tienen que usar UNA sola hoja (usan: ${[...used].map(setName).join(', ') || 'ninguna'})`);
const ts = [...used][0];
const tileset = setName(ts);
if (!(tileset in FLARE_BASE)) fail(`hoja '${tileset}' desconocida: tiene que ser una de ${Object.keys(FLARE_BASE).join(', ')}`);
const toFlare = (g: number[][]) => g.map((row) => row.map((v) => (v ? v - ts.firstgid + 1 : 0)));
const background = toFlare(ground), object = toFlare(decor);

// --- objetos -> celdas ------------------------------------------------------------------------------------------------------
// Ortogonal: x/tilewidth, y/tileheight. Isométrico: Tiled guarda los objetos en unidades de tileheight en los dos ejes.
const [ux, uy] = tm.orientation === 'isometric' ? [tm.tileheight, tm.tileheight] : [tm.tilewidth, tm.tileheight];
const cellOf = (o: TiledObject) => ({ x: Math.floor((o.x + (o.width ?? 0) / 2) / ux), y: Math.floor((o.y + (o.height ?? 0) / 2) / uy) });
const radiusOf = (o: TiledObject) => Math.max(1, Math.round(Math.max((o.width ?? 0) / ux, (o.height ?? 0) / uy) / 2));
const objects = (name: string) => { const l = byName(name); if (l && l.type !== 'objectgroup') fail(`'${name}' tiene que ser una capa de objetos`); return l?.objects ?? []; };
const kindOf = (o: TiledObject) => (o.class ?? o.type ?? '').toLowerCase();
const spawns = objects('spawns'), triggers = objects('triggers');

// --- colisión: bloquea lo que tiene colisión y lo que queda fuera del mapa original; solo queda lo alcanzable desde la entrada ---
const hard = collisions.map((row, y) => row.map((v, x) => v !== 0 || x >= W || y >= H));
const entryObj = spawns.find((o) => kindOf(o) === 'entry' || o.name?.toLowerCase() === 'entry');
let entry = entryObj ? cellOf(entryObj) : undefined;
if (!entry) { outer: for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!hard[y][x]) { entry = { x, y }; break outer; } }
if (!entry) fail('no hay ninguna celda caminable');
if (hard[entry!.y]?.[entry!.x] !== false) fail(`la entrada (${entry!.x}, ${entry!.y}) está bloqueada o fuera del mapa`);
const reach = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
const q: [number, number][] = [[entry!.x, entry!.y]]; reach[entry!.y][entry!.x] = true;
for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && !hard[ny][nx] && !reach[ny][nx]) { reach[ny][nx] = true; q.push([nx, ny]); }
    }
}
let walkable = 0, pockets = 0;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (reach[y][x]) walkable++; else if (!hard[y][x]) pockets++; }
if (pockets) console.log(`${id}: ${pockets} celdas libres sin acceso a pie desde la entrada quedan bloqueadas`);
const free = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && reach[y][x];
const snap = (c: { x: number; y: number }, what: string) => {
    for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy };
    return fail(`${what} en (${c.x}, ${c.y}): no hay celda caminable cerca`);
};

// --- zonas ------------------------------------------------------------------------------------------------------------------
const zones: FlareZone[] = spawns.filter((o) => o !== entryObj).map((o) => {
    const type = String(prop(o.properties, 'mob') ?? prop(o.properties, 'type') ?? fail(`spawn #${o.id} '${o.name ?? ''}': falta la propiedad 'mob'`));
    if (!knownMobs.has(type)) fail(`spawn #${o.id}: tipo de mob desconocido '${type}' (ver MOB_TYPES en mobs.ts)`);
    const c = snap(cellOf(o), `spawn #${o.id}`);
    const r = Number(prop(o.properties, 'r') ?? (o.point ? 4 : radiusOf(o)));
    const kind = String(prop(o.properties, 'kind') ?? 'pit') as FlareZone['kind'];
    if (!['pit', 'loose', 'boss'].includes(kind)) fail(`spawn #${o.id}: kind '${kind}' inválido`);
    const pit = prop(o.properties, 'pit');
    return {
        type, x: c.x, y: c.y, r, n: Number(prop(o.properties, 'n') ?? (kind === 'boss' ? 1 : Math.max(2, Math.min(10, Math.round((r * r) / 10))))),
        name: o.name || `Zona ${o.id}`, lvl: Number(prop(o.properties, 'lvl') ?? 1), kind, ...(kind === 'pit' ? { pit: Number(pit ?? 0) } : {}),
    };
});

// --- conexiones -------------------------------------------------------------------------------------------------------------
const extras: FlareMapData['extras'] = triggers.map((o) => {
    const to = String(prop(o.properties, 'to') ?? fail(`trigger #${o.id}: falta la propiedad 'to' (id de ERIS del mapa destino)`));
    const kind = String(prop(o.properties, 'kind') ?? 'portal') as 'portal' | 'door';
    const gate = prop(o.properties, 'gate');
    return { to, cell: snap(cellOf(o), `trigger #${o.id}`), kind, ...(gate != null ? { gate: Number(gate) } : {}) };
});

// --- salida -----------------------------------------------------------------------------------------------------------------
const P = tm.properties;
const lvl: [number, number] = [Number(prop(P, 'lvlMin') ?? 1), Number(prop(P, 'lvlMax') ?? prop(P, 'lvlMin') ?? 1)];
const data: FlareMapData = {
    id, eris: id, name: String(prop(P, 'name') ?? id), region: String(prop(P, 'region') ?? 'comun'),
    pvp: prop(P, 'pvp') === 'faction' ? 'faction' : 'off', lvl, ...(prop(P, 'dungeon') ? { dungeon: true } : {}),
    tileset, size: N, flareSize: [W, H], entry: entry!,
    source: `Tiled: ${basename(input)}`, license: String(prop(P, 'license') ?? 'propio'),
    walkable, zones, links: [], extras, layers: { background, object }, blocked: reach.map((r) => r.map((v) => (v ? 0 : 1))),
};
const hash = mapHash(buildFlareMap(data));

mkdirSync(outDir, { recursive: true });
const header = `/**\n * Generado por tools/src/maps/tiled_to_ts.ts a partir de '${basename(input)}' (Tiled). No editar a mano: se regenera con pnpm maps:tiled.\n */\n`;
writeFileSync(join(outDir, `${id}.ts`), `${header}import type { FlareMapData } from '../flare/types';\n\n/** mapHash() del mapa armado: el mismo que calculan cliente y server para MapReady. */\nexport const HASH = '${hash}';\n\nexport const DATA: FlareMapData = ${JSON.stringify(data)};\n`);

// registro: todos los .ts generados de la carpeta (orden alfabético, determinista)
const ids = readdirSync(outDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => f.slice(0, -3)).sort();
const v = (s: string) => s.toUpperCase();
writeFileSync(join(outDir, 'index.ts'), `/**\n * Registro de mapas importados de Tiled (tools/src/maps/tiled_to_ts.ts). Generado: no editar a mano.\n */\nimport type { FlareMapData } from '../flare/types';\n${ids.map((i) => `import { DATA as ${v(i)}, HASH as ${v(i)}_HASH } from './${i}';`).join('\n')}\n\nexport const TILED_DATA: { data: FlareMapData; hash: string }[] = [${ids.map((i) => `{ data: ${v(i)}, hash: ${v(i)}_HASH }`).join(', ')}];\n`);

const pits = [0, 1, 2].map((i) => zones.filter((z) => z.pit === i).length);
console.log(`${id}: ${N}x${N} (${tileset}), ${walkable} celdas caminables, ${zones.length} zonas (pits ${pits.join('/')}), ${extras.length} conexiones, hash ${hash} -> packages/world/src/tiled/${id}.ts`);
