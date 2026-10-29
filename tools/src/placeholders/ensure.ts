/**
 * Genera los assets provisorios solo si faltan o si son de una versión vieja del generador
 * (se usa antes de `pnpm dev`). Subí ASSETS_VERSION en version.ts cuando cambie lo que se genera.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS_VERSION } from './version.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stamp = join(root, 'apps', 'client', 'public', 'assets', '.version');
const serverMap = join(root, 'apps', 'server', 'data', 'maps', 'campamento.amd');
const current = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : '';
if (current === String(ASSETS_VERSION) && existsSync(serverMap)) {
    console.log('Assets provisorios: ya están generados.');
} else {
    await import('./index.ts');
}
