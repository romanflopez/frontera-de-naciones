import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// La versión del cliente sale de este package.json y queda fijada en el bundle: el server la compara con su versión mínima (`/version`).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
    define: { __CLIENT_VERSION__: JSON.stringify(pkg.version) },
});
