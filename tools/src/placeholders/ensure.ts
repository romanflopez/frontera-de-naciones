/** Genera los assets provisorios solo si todavía no existen (se usa antes de `pnpm dev`). */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'client', 'public', 'assets', 'sprites', 'wm.spr');
if (existsSync(marker)) {
    console.log('Assets provisorios: ya están generados.');
} else {
    await import('./index.ts');
}
