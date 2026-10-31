// Pruebas de persistencia: posición en la cuenta (B1) y guardado por lotes / transaccional (B2).
// Correr: cd apps/server && npx tsx --test test/storage.test.ts
// Con una base real: TEST_DATABASE_URL=postgres://... DATABASE_SSL=off npx tsx --test test/storage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMapDef } from '@fdn/world';
import { FileStorage, PgStorage, type AccountRecord, type PgPoolLike } from '../src/storage.ts';
import { keyOfNetworkId, loadPosition, savePosition } from '../src/persist.ts';
import type { PersistedPlayer } from '../src/player.ts';

const rec = (name: string, gold = 0): AccountRecord => ({ name, salt: '', hash: '', created: 1, lastLogin: 1, econ: { gold } as never });
const pos = (mapId: string, x: number, y: number): PersistedPlayer => ({
    mapId, worldId: mapId, x, y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true,
});
const mapOf = (id: string) => getMapDef(id)!.build();
const tmp = () => mkdtempSync(join(tmpdir(), 'fdn-storage-'));

// ---------- B1: la posición vive en la cuenta ----------
test('B1: la posición se guarda en la cuenta y sobrevive a un reinicio', () => {
    const dir = tmp();
    const a = new FileStorage(dir, 10_000);
    a.put('aa', rec('Ana'));
    savePosition(a, 'acc:aa', pos('llanos_alba', 20, 30), mapOf);
    a.flush();
    const b = new FileStorage(dir); // proceso nuevo, sin cache
    const got = loadPosition(b, 'acc:aa', () => undefined);
    assert.equal(got?.mapId, 'llanos_alba'); assert.equal(got?.x, 20); assert.equal(got?.y, 30);
    assert.equal(b.get('aa')?.econ?.gold, 0); // el resto de la cuenta no se tocó
    rmSync(dir, { recursive: true });
});

test('B1: sin posición en la cuenta se usa el guardado viejo de chars/, y el próximo guardado lo pasa a la cuenta', () => {
    const dir = tmp(), s = new FileStorage(dir, 10_000);
    s.put('bb', rec('Beto'));
    const legacy = pos('solmar_villa', 5, 6);
    assert.deepEqual(loadPosition(s, 'acc:bb', () => legacy), legacy);
    assert.equal(s.get('bb')?.pos, undefined);
    savePosition(s, 'acc:bb', legacy, mapOf);
    assert.equal(s.get('bb')?.pos?.x, 5);
    // ya en la cuenta, manda la cuenta aunque el archivo viejo diga otra cosa
    assert.equal(loadPosition(s, 'acc:bb', () => pos('paramo', 1, 1))?.mapId, 'solmar_villa');
    rmSync(dir, { recursive: true });
});

test('B1: una celda temporal (mazmorra) no se guarda: vuelve al punto de descanso del mapa', () => {
    const def = getMapDef('prueba_mazmorra')!, s = new FileStorage(tmp(), 10_000);
    s.put('cc', rec('Cami'));
    savePosition(s, 'acc:cc', pos(def.id, def.spawn.x, def.spawn.y), mapOf);
    const saved = s.get('cc')!.pos!;
    assert.notEqual(saved.mapId, def.id);
    assert.equal(saved.mapId, def.rest!.map);
});

test('B1: guardar la posición de una cuenta que no existe no crea nada ni rompe', () => {
    const s = new FileStorage(tmp(), 10_000);
    savePosition(s, 'acc:fantasma', pos('llanos_alba', 1, 1), mapOf);
    savePosition(s, 'acc:fantasma', undefined, mapOf);
    assert.equal(s.get('fantasma'), undefined);
    assert.equal(keyOfNetworkId('acc:abc'), 'abc');
});

// ---------- B2: lotes todo o nada ----------
test('B2: FileStorage escribe el lote completo en un flush', () => {
    const dir = tmp(), s = new FileStorage(dir, 10_000);
    s.put('aa', rec('Ana', 5)); s.put('ah', rec('(casa)', 0));
    s.flush();
    const files = readdirSync(join(dir, 'accounts')).sort();
    assert.deepEqual(files, ['aa.json', 'ah.json']);
    rmSync(dir, { recursive: true });
});

test('B2: si un registro del lote no se puede escribir, no se pisa ninguno y el flush siguiente lo termina', () => {
    const dir = tmp(), s = new FileStorage(dir, 10_000);
    s.put('aa', rec('Ana', 100)); s.put('zz', rec('Zeta', 1));
    s.flush();
    // el lote nuevo toca los dos, pero 'zz' no se puede escribir (hay un directorio donde iría su .tmp)
    s.put('aa', rec('Ana', 7)); s.put('zz', rec('Zeta', 2));
    mkdirSync(join(dir, 'accounts', 'zz.json.tmp'));
    const origErr = console.error; console.error = () => {};
    try { s.flush(); } finally { console.error = origErr; }
    const onDisk = (k: string) => (JSON.parse(readFileSync(join(dir, 'accounts', `${k}.json`), 'utf8')) as AccountRecord).econ as unknown as { gold: number };
    assert.equal(onDisk('aa').gold, 100, 'aa no se pisó: el lote falló entero');
    assert.equal(onDisk('zz').gold, 1);
    assert.equal(existsSync(join(dir, 'accounts', 'aa.json.tmp')), false, 'no quedan .tmp huérfanos');
    rmSync(join(dir, 'accounts', 'zz.json.tmp'), { recursive: true });
    s.flush(); // el reintento (a mano, el timer es de 5 s) guarda los dos
    assert.equal(onDisk('aa').gold, 7); assert.equal(onDisk('zz').gold, 2);
    rmSync(dir, { recursive: true });
});

/** Pool falso con semántica de transacción: lo escrito dentro de BEGIN solo se ve si hay COMMIT. */
function fakePool(opts: { failOnKey?: () => string | undefined } = {}) {
    const table = new Map<string, string>(), log: string[] = [];
    const pool: PgPoolLike & { table: Map<string, string>; log: string[] } = {
        table, log,
        async query(sql: string) {
            if (sql.startsWith('SELECT')) return { rows: [...table].map(([key, data]) => ({ key, data: JSON.parse(data) })) };
            return { rows: [] };
        },
        async connect() {
            let staged: Map<string, string> | null = null;
            return {
                async query(sql: string, params?: unknown[]) {
                    log.push(sql.split(' ')[0]);
                    if (sql === 'BEGIN') staged = new Map(table);
                    else if (sql === 'COMMIT') { for (const [k, v] of staged!) table.set(k, v); staged = null; }
                    else if (sql === 'ROLLBACK') staged = null;
                    else if (sql.startsWith('INSERT')) {
                        const key = params![0] as string;
                        if (opts.failOnKey?.() === key) throw new Error('conexión cortada');
                        staged!.set(key, params![1] as string);
                    }
                    return {};
                },
                release() { /* nada */ },
            };
        },
        async end() { /* nada */ },
    };
    return pool;
}

test('B2: PgStorage escribe todo el lote en una sola transacción (cuenta + casa de subastas juntas)', async () => {
    const pool = fakePool(), s = await PgStorage.fromPool(pool, 10_000, 10);
    s.put('aa', rec('Ana', 5)); s.put('__casa', rec('(casa)'));
    await s.close();
    assert.deepEqual(pool.log, ['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
    assert.equal(pool.table.size, 2);
});

test('B2: si falla a la mitad del lote no queda ninguno guardado, y se reintenta con el estado más nuevo', async () => {
    let fail: string | undefined = '__casa';
    const pool = fakePool({ failOnKey: () => fail }), s = await PgStorage.fromPool(pool, 10_000, 20);
    const origErr = console.error; console.error = () => {};
    try {
        s.put('aa', rec('Ana', 5)); s.put('__casa', rec('(casa)'));
        s.flush();
        await new Promise((r) => setTimeout(r, 5)); // el primer intento falla en la casa
        assert.equal(pool.table.size, 0, 'ni la cuenta quedó guardada sin la casa');
        assert.ok(pool.log.includes('ROLLBACK'));
        s.put('aa', rec('Ana', 9)); // mientras tanto el jugador siguió jugando
        fail = undefined; // la base vuelve
        await new Promise((r) => setTimeout(r, 80)); // el timer de reintento (20 ms) lo termina solo
    } finally { console.error = origErr; }
    await s.close();
    assert.equal(pool.table.size, 2);
    assert.equal(((JSON.parse(pool.table.get('aa')!) as AccountRecord).econ as unknown as { gold: number }).gold, 9);
});

// ---------- contra un Postgres de verdad (opcional) ----------
test('Postgres real: posición y lote sobreviven a reabrir el almacén', { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const { default: pg } = await import('pg');
    const clean = new pg.Pool({ connectionString: url, ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false } });
    await clean.query('CREATE TABLE IF NOT EXISTS accounts (key text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())');
    await clean.query("DELETE FROM accounts WHERE key IN ('t_aa','t_casa')");
    const a = await PgStorage.create(url);
    a.put('t_aa', rec('Ana', 5)); a.put('t_casa', rec('(casa)'));
    savePosition(a, 'acc:t_aa', pos('la_frontera', 40, 50), mapOf);
    await a.close();
    const b = await PgStorage.create(url); // "redeploy": proceso nuevo
    assert.equal(loadPosition(b, 'acc:t_aa', () => undefined)?.mapId, 'la_frontera');
    assert.ok(b.get('t_casa'));
    await clean.query("DELETE FROM accounts WHERE key IN ('t_aa','t_casa')");
    await b.close(); await clean.end();
});
