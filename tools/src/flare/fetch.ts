/**
 * Baja solo las carpetas de arte que usamos de flare-game (CC-BY-SA 3.0) a reference/flare-game.
 * Esa carpeta está en .gitignore: el arte de Flare no se sube a este repo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dest = join(root, 'reference', 'flare-game');
const run = (args: string[], cwd?: string) => {
    const r = spawnSync('git', args, { cwd, stdio: 'inherit' });
    if (r.error) throw new Error('No encontré git. Instalá Git for Windows (https://git-scm.com) y volvé a correr pnpm assets:flare.');
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló (código ${r.status}).`);
};
const parts = ['engine', 'animations/avatar', 'animations/enemies', 'images/avatar', 'images/enemies', 'images/tilesets', 'tilesetdefs']
    .map((p) => `mods/fantasycore/${p}`);

if (existsSync(join(dest, 'mods', 'fantasycore', 'engine', 'hero_layers.txt'))) {
    console.log('Flare: ya está bajado en reference/flare-game.');
} else {
    if (!existsSync(join(dest, '.git'))) {
        console.log('Flare: bajando el arte (unos 150 MB, una sola vez)…');
        run(['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/flareteam/flare-game.git', dest]);
    }
    // modo cono: solo carpetas (los archivos de la raíz, como LICENSE.txt y CREDITS.txt, vienen igual)
    run(['sparse-checkout', 'set', ...parts], dest);
}
