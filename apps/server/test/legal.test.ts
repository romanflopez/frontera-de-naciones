/**
 * Guarda legal (paso 0.2 del plan): el código, los datos y los textos del juego no pueden traer nombres ni datos de
 * juegos de terceros. Si este test falla, sacá el nombre o reemplazalo por uno propio.
 *
 * Quedan afuera a propósito: `docs/` (notas de diseño internas), los avisos de licencia (`LICENSE*`) y `CREDITS.txt`,
 * que tienen que nombrar el proyecto base MIT para cumplir su licencia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Nombres propios de Helbreath (juego, naciones, mapas, ítems, mobs y NPC únicos) y de su editora. */
const FORBIDDEN = [
    'helbreath', 'siementech', 'aresden', 'elvine', 'heldenian', 'hbsh6', 'areshop',
    'abaddon', 'hellclaw', 'tigerworm', 'gandalf', 'mcgaffin', 'merien', 'xelima', 'zemstone',
];

/** Carpetas que se revisan (código, datos y textos que llegan al jugador). */
const SCAN = ['apps/server/src', 'apps/server/data', 'apps/server/scripts', 'apps/client/src', 'apps/client/index.html', 'packages/world/src', 'packages/proto/src', 'tools/src', 'README.md'];
const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.css', '.md', '.txt', '.proto', '.py', '.tmx', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', 'accounts', 'chars', 'flare-game']);

function files(path: string, out: string[] = []): string[] {
    if (!existsSync(path)) return out;
    const st = statSync(path);
    if (st.isFile()) { if (TEXT.has(extname(path))) out.push(path); return out; }
    for (const name of readdirSync(path)) if (!SKIP_DIRS.has(name)) files(join(path, name), out);
    return out;
}

test('no hay nombres de juegos de terceros en código, datos ni textos del juego', () => {
    const re = new RegExp(`\\b(${FORBIDDEN.join('|')})`, 'i');
    const hits: string[] = [];
    for (const f of SCAN.flatMap((p) => files(join(ROOT, p)))) {
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
            const m = re.exec(line);
            if (m) hits.push(`${relative(ROOT, f)}:${i + 1}: "${m[1]}"`);
        });
    }
    assert.deepEqual(hits, [], `Nombres prohibidos:\n${hits.join('\n')}`);
});

test('no vuelven los catálogos ni la carpeta de referencia del server original', () => {
    assert.equal(existsSync(join(ROOT, 'apps/server/data/catalog')), false, 'apps/server/data/catalog no debe existir');
    assert.equal(existsSync(join(ROOT, 'reference/server-csharp')), false, 'reference/server-csharp no debe existir');
});
