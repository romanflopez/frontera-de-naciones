/**
 * Arranque en desarrollo: espera a que el Vite de apps/client responda y recién ahí abre Electron apuntando ahí, para que la ventana
 * no se abra en blanco. Pensado para correrse en paralelo con el server y el cliente (`pnpm dev:desktop` en la raíz).
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const URL_DEV = process.env.FDN_DEV_URL || 'http://localhost:8080';
const SERVER = process.env.FDN_SERVER || 'ws://localhost:1337/ws';
const TIMEOUT_MS = 60_000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarVite() {
    const hasta = Date.now() + TIMEOUT_MS;
    while (Date.now() < hasta) {
        try {
            const r = await fetch(URL_DEV, { method: 'GET' });
            if (r.ok) return true;
        } catch { /* todavía no levantó */ }
        await wait(400);
    }
    return false;
}

(async () => {
    process.stdout.write(`[desktop] esperando a ${URL_DEV}…\n`);
    if (!await esperarVite()) {
        process.stderr.write(`[desktop] ${URL_DEV} no respondió en ${TIMEOUT_MS / 1000}s. ¿Está corriendo el cliente?\n`);
        process.exit(1);
    }
    // electron trae su binario; require.resolve da la ruta sin depender de que esté en el PATH
    const electron = require('electron');
    const hijo = spawn(electron, [path.join(__dirname, 'main.cjs')], {
        stdio: 'inherit',
        env: { ...process.env, FDN_DEV_URL: URL_DEV, FDN_SERVER: SERVER },
    });
    hijo.on('close', (code) => process.exit(code ?? 0));
})();
