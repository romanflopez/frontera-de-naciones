/**
 * Proceso principal del cliente de escritorio de ERIS.
 *
 * Envuelve el mismo cliente web (apps/client) en Electron, que trae su propio Chromium. Eso importa más de lo que parece: las hojas
 * de sprites a tamaño nativo llegan a 3072x15360, que entra holgado en Chromium pero pasa el límite de área de canvas de WebKit.
 * Por eso el cliente de escritorio va con Electron y no con el webview del sistema.
 *
 * El build del cliente se sirve por el esquema `app://`, no por `file://`: así el renderer tiene un origin de verdad y funcionan
 * `fetch` de los assets y el almacenamiento local, que con `file://` quedan bloqueados.
 *
 * Dirección del server, en orden: --server=<url> en la línea de comandos, la variable FDN_SERVER, un `server.json` junto al
 * ejecutable (para poder cambiarla sin recompilar), y por último DEFAULT_SERVER.
 */
const { app, BrowserWindow, protocol, net, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createUpdater } = require('./updater.cjs');

/** Server al que se conecta el juego si no se configura nada. */
const DEFAULT_SERVER = 'ws://localhost:1337/ws';
/** En desarrollo se carga el Vite de apps/client en vez del build. */
const DEV_URL = process.env.FDN_DEV_URL || '';
/** Raíz del cliente ya construido. Empaquetado va como recurso; en desarrollo, la carpeta dist del repo. */
const CLIENT_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'client')
    : path.join(__dirname, '..', '..', 'client', 'dist');

function serverUrl() {
    const arg = process.argv.find((a) => a.startsWith('--server='));
    if (arg) return arg.slice('--server='.length);
    if (process.env.FDN_SERVER) return process.env.FDN_SERVER;
    try { // junto al ejecutable, para que se pueda apuntar a otro server sin recompilar
        const f = path.join(path.dirname(app.getPath('exe')), 'server.json');
        const v = JSON.parse(fs.readFileSync(f, 'utf8')).server;
        if (typeof v === 'string' && v) return v;
    } catch { /* sin archivo de configuración: se usa el valor por defecto */ }
    return DEFAULT_SERVER;
}

// Tiene que declararse antes de que la app esté lista: le da a `app://` el mismo trato que a https (origin, fetch, almacenamiento).
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** Sirve un archivo del cliente, sin dejar salir de CLIENT_DIR. */
function serveClient(request) {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(CLIENT_DIR, rel);
    if (!file.startsWith(CLIENT_DIR + path.sep) && file !== path.join(CLIENT_DIR, 'index.html')) {
        return new Response('No', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1366,
        height: 800,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: '#0d100e',
        show: false,
        autoHideMenuBar: true,
        title: 'ERIS',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
    });
    win.once('ready-to-show', () => win.show());

    const q = `?server=${encodeURIComponent(serverUrl())}`;
    win.loadURL(DEV_URL ? `${DEV_URL}/${q}` : `app://eris/index.html${q}`);

    // Nada de abrir otras páginas adentro del juego: los enlaces externos van al navegador del sistema.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        const ok = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('app://');
        if (!ok) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); }
    });
    return win;
}

/**
 * Actualizaciones: solo en la app instalada (en desarrollo no hay nada que actualizar). FDN_NO_UPDATE=1 las apaga.
 * Los instaladores se publican en GitHub Releases (ver `publish` en electron-builder.yml).
 */
let updater = null;
function startUpdater() {
    if (!app.isPackaged || process.env.FDN_NO_UPDATE) return;
    try {
        const { autoUpdater } = require('electron-updater');
        updater = createUpdater({ autoUpdater, send: (s) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('eris:update', s); } });
        updater.start();
    } catch (e) { console.warn('[desktop] no se pudo iniciar el actualizador:', e?.message ?? e); }
}
ipcMain.on('eris:version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle('eris:update-state', () => updater ? updater.state : { state: 'none' });
ipcMain.handle('eris:update-check', () => updater?.check());
ipcMain.handle('eris:update-install', () => updater?.install());

// Una sola instancia: si ya hay una abierta, se trae al frente en vez de abrir otra.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const [w] = BrowserWindow.getAllWindows();
        if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
    });

    app.whenReady().then(() => {
        if (!DEV_URL) protocol.handle('app', serveClient);
        createWindow();
        startUpdater();
        app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); // macOS
    });

    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
