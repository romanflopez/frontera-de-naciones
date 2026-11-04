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

/**
 * La atribución de CC-BY-SA tiene que estar al alcance del jugador, no solo en un .txt dentro de /assets. Estos tests cuidan que
 * la pantalla de créditos siga existiendo y que los archivos que muestra estén donde el cliente los busca.
 */
test('la atribución es visible desde el juego y los archivos de créditos existen', () => {
    const html = readFileSync(join(ROOT, 'apps/client/index.html'), 'utf8');
    assert.match(html, /id="credBtn"/, 'falta el botón de Créditos en el login');
    assert.match(html, /id="credits"/, 'falta el panel de créditos');

    for (const f of ['CREDITS.txt', 'CREDITS-CC0.txt']) {
        const p = join(ROOT, 'apps/client/public/assets', f);
        assert.ok(existsSync(p), `falta ${f}`);
        assert.ok(readFileSync(p, 'utf8').trim().length > 200, `${f} está vacío`);
    }

    // CC-BY-SA 3.0 exige nombrar la obra, los autores y la licencia, e indicar que se modificó.
    const cred = readFileSync(join(ROOT, 'apps/client/public/assets/CREDITS.txt'), 'utf8');
    for (const req of ['CC-BY-SA', 'Flare', 'Bellanger', 'creativecommons.org']) {
        assert.ok(cred.includes(req), `CREDITS.txt no menciona "${req}"`);
    }
});

test('los avisos de las dependencias están generados', () => {
    const p = join(ROOT, 'apps/client/public/THIRD_PARTY_NOTICES.txt');
    assert.ok(existsSync(p), 'falta THIRD_PARTY_NOTICES.txt: corré pnpm legal:notices');
    assert.ok(readFileSync(p, 'utf8').includes('@bufbuild/protobuf'), 'los avisos no cubren las dependencias que se distribuyen');
});
