import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVersion, compareVersions, mustUpdate, hasNewer } from '@fdn/world';
import { VersionConfig, handleVersion } from '../src/version.ts';

test('parseVersion: acepta semver con v y sufijo, rechaza lo demás', () => {
    assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('v0.10.0-beta.1'), [0, 10, 0]);
    for (const x of ['', 'dev', '1.2', '1.2.x', 'index-AbC.js', '1.2.3.4']) assert.equal(parseVersion(x), null, x);
});

test('compareVersions: compara número a número (0.10.0 > 0.9.0, no como texto)', () => {
    assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
    assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
    assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
    assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

test('mustUpdate: solo bloquea a un cliente con versión válida más vieja que el mínimo', () => {
    assert.equal(mustUpdate('0.2.0', '0.3.0'), true);
    assert.equal(mustUpdate('0.3.0', '0.3.0'), false);
    assert.equal(mustUpdate('0.4.0', '0.3.0'), false);
    assert.equal(mustUpdate('dev', '9.9.9'), false, 'el cliente de desarrollo no se bloquea');
    assert.equal(mustUpdate('0.1.0', ''), false, 'sin mínimo no se bloquea a nadie');
    assert.equal(hasNewer('0.2.0', '0.2.1'), true);
    assert.equal(hasNewer('0.2.1', '0.2.1'), false);
});

test('VersionConfig: defaults del entorno, el archivo manda, valida y persiste', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ver-'));
    const a = new VersionConfig(dir, { MIN_CLIENT: 'v0.2.0', LATEST_CLIENT: 'basura', DOWNLOAD_URL: 'https://x.test/d' } as any);
    assert.deepEqual(a.get(), { minClient: '0.2.0', latestClient: '', downloadUrl: 'https://x.test/d' });
    assert.match(a.set('minClient', 'abc')!, /tipo 0\.3\.1/);
    assert.equal(a.get().minClient, '0.2.0', 'un valor inválido no cambia nada');
    assert.equal(a.set('minClient', 'v0.3.1'), null);
    assert.equal(a.get().minClient, '0.3.1');
    const b = new VersionConfig(dir, { MIN_CLIENT: '0.1.0' } as any);
    assert.equal(b.get().minClient, '0.3.1', 'el archivo gana sobre el entorno');
    assert.equal(b.set('minClient', 'off'), null);
    assert.equal(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')).minClient, '');
    writeFileSync(join(dir, 'version.json'), '{roto');
    assert.equal(new VersionConfig(dir, {} as any).get().minClient, '', 'archivo roto: vale el entorno');
});

const cfg = new VersionConfig(mkdtempSync(join(tmpdir(), 'ver-')), { MIN_CLIENT: '0.3.0', LATEST_CLIENT: '0.4.0' } as any);
const srv = createServer((req, res) => { if (!handleVersion(req, res, cfg, 'abc1234')) { res.writeHead(404); res.end(); } });
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(srv.address() as any).port}`;
after(() => srv.close());

test('GET /version: responde la versión mínima con CORS y sin caché; sigue los cambios en vivo', async () => {
    const r = await fetch(`${base}/version?x=1`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { server: 'abc1234', minClient: '0.3.0', latestClient: '0.4.0', downloadUrl: '' });
    cfg.set('minClient', '0.3.5');
    assert.equal(((await (await fetch(`${base}/version`)).json()) as any).minClient, '0.3.5');
    assert.equal((await fetch(`${base}/version`, { method: 'OPTIONS' })).status, 204);
    assert.equal((await fetch(`${base}/version`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/otra`)).status, 404);
});
