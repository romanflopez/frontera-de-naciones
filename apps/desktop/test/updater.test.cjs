const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../src/updater.cjs');

function fake(over = {}) {
    const au = new EventEmitter();
    au.checks = 0; au.installs = [];
    au.checkForUpdates = async () => { au.checks++; au.emit('checking-for-update'); if (over.check) await over.check(au); else au.emit('update-not-available'); };
    au.quitAndInstall = (...a) => au.installs.push(a);
    const sent = [];
    const u = createUpdater({ autoUpdater: au, send: (s) => sent.push(s), setIntervalFn: (fn) => { au.tick = fn; return { unref() {} }; }, log: { warn() {} } });
    return { au, u, sent };
}

test('configura la descarga automática e instala al cerrar', () => {
    const { au } = fake();
    assert.equal(au.autoDownload, true); assert.equal(au.autoInstallOnAppQuit, true); assert.equal(au.allowPrerelease, false);
});

test('sin versión nueva: checking → none', async () => {
    const { u, sent } = fake();
    await u.check();
    assert.deepEqual(sent.map((s) => s.state), ['checking', 'none']);
});

test('con versión nueva: baja con progreso y queda lista; instalar solo anda cuando está lista', async () => {
    const { au, u, sent } = fake({ check: async (a) => { a.emit('update-available', { version: '0.3.0' }); a.emit('download-progress', { percent: 40.5 }); } });
    await u.check();
    assert.equal(u.state.state, 'downloading'); assert.equal(u.state.version, '0.3.0'); assert.equal(u.state.percent, 40.5);
    assert.equal(u.install(), false, 'todavía no está lista');
    assert.equal(au.installs.length, 0);
    au.emit('update-downloaded', { version: '0.3.0' });
    assert.deepEqual(u.state, { state: 'ready', version: '0.3.0' });
    assert.equal(u.install(), true);
    assert.deepEqual(au.installs, [[false, true]]);
    assert.equal(sent.at(-1).state, 'ready');
});

test('una vez lista o bajando, las búsquedas periódicas no pisan el estado ni vuelven a buscar', async () => {
    const { au, u } = fake({ check: async (a) => { a.emit('update-available', { version: '0.3.0' }); a.emit('update-downloaded', { version: '0.3.0' }); } });
    await u.check(); const n = au.checks;
    await u.check(); await u.check();
    assert.equal(au.checks, n); assert.equal(u.state.state, 'ready');
    au.emit('update-not-available'); au.emit('checking-for-update');
    assert.equal(u.state.state, 'ready', 'un evento tardío no borra lo ya descargado');
});

test('error de red: queda en error, no tira, y se puede reintentar', async () => {
    let fail = true;
    const { u, sent } = fake({ check: async (a) => { if (fail) throw new Error('sin red'); a.emit('update-not-available'); } });
    await u.check();
    assert.equal(u.state.state, 'error'); assert.match(u.state.error, /sin red/);
    fail = false; await u.check();
    assert.equal(u.state.state, 'none');
    assert.ok(sent.some((s) => s.state === 'error'));
});

test('start busca ya y repite con el intervalo; un fallo del send no rompe', async () => {
    const au = new EventEmitter(); let checks = 0, tick;
    au.checkForUpdates = async () => { checks++; au.emit('update-not-available'); };
    const u = createUpdater({ autoUpdater: au, send: () => { throw new Error('ventana cerrada'); }, setIntervalFn: (fn) => { tick = fn; return { unref() {} }; }, log: { warn() {} } });
    u.start(); await new Promise((r) => setImmediate(r));
    assert.equal(checks, 1);
    tick(); await new Promise((r) => setImmediate(r));
    assert.equal(checks, 2);
});

test('si el actualizador no corre en este sistema (devuelve null sin eventos), pasa a none y no queda esperando', async () => {
    const au = new EventEmitter();
    au.checkForUpdates = async () => null; // sin ni siquiera 'checking-for-update'
    const u = createUpdater({ autoUpdater: au, send() {}, setIntervalFn: () => ({ unref() {} }), log: { warn() {} } });
    await u.check();
    assert.equal(u.state.state, 'none');
});
