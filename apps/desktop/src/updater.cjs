/**
 * Actualización automática de la app de escritorio (electron-updater). Separado de main.cjs para poder probar la lógica sin Electron:
 * recibe el `autoUpdater` y una función `send` que avisa a la ventana.
 *
 * Flujo: al abrir y cada 30 min busca una versión nueva, la baja sola en segundo plano y la instala al cerrar el juego.
 * Si el server exige una versión mínima, la pantalla de "actualizá" del cliente usa este estado para ofrecer "Reiniciar y actualizar".
 */

/** Estados que ve el cliente: idle (sin buscar todavía), checking, none (no hay nada nuevo), downloading, ready y error. */
function createUpdater({ autoUpdater, send, intervalMs = 30 * 60_000, setIntervalFn = setInterval, log = console }) {
    let state = { state: 'idle' };
    const set = (s) => { state = s; try { send(state); } catch { /* sin ventana abierta */ } };

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // si el jugador no toca nada, se instala al cerrar
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => { if (state.state !== 'downloading' && state.state !== 'ready') set({ state: 'checking' }); });
    autoUpdater.on('update-not-available', () => { if (state.state !== 'ready') set({ state: 'none' }); });
    autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info?.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: state.version, percent: Math.max(0, Math.min(100, Number(p?.percent) || 0)) }));
    autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info?.version ?? state.version }));
    autoUpdater.on('error', (e) => {
        log.warn?.('[updater]', e?.message ?? e);
        if (state.state !== 'ready') set({ state: 'error', error: String(e?.message ?? e).slice(0, 200) });
    });

    /** Busca una actualización (no hace nada si ya se está bajando o ya está lista). */
    async function check() {
        if (state.state === 'downloading' || state.state === 'ready') return;
        try {
            const r = await autoUpdater.checkForUpdates();
            // el actualizador no corre en este sistema (ej. Linux sin AppImage): no va a haber eventos, no se deja la pantalla esperando
            if (r === null && (state.state === 'checking' || state.state === 'idle')) set({ state: 'none' });
        }
        catch (e) { set({ state: 'error', error: String(e?.message ?? e).slice(0, 200) }); }
    }
    /** Cierra el juego e instala la actualización ya descargada. Devuelve false si todavía no hay nada listo. */
    function install() {
        if (state.state !== 'ready') return false;
        autoUpdater.quitAndInstall(false, true); // no silencioso, y vuelve a abrir el juego al terminar
        return true;
    }
    let timer = null;
    function start() {
        void check();
        timer = setIntervalFn(() => void check(), intervalMs);
        timer?.unref?.();
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    return { start, stop, check, install, get state() { return state; } };
}

module.exports = { createUpdater };
