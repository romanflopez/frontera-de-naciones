/**
 * Movimiento libre: el cliente se mueve continuo y manda su posición decimal.
 *  - El server valida la velocidad con un presupuesto (no paso por paso): el jitter pasa, ir al doble no.
 *  - La celda del server es floor(x), floor(y); contigua y libre.
 *  - Los que lo ven reciben la posición decimal.
 * Más las pruebas del módulo puro (`stepFree`, `MoveBudget`) que usa el cliente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { BODY_MARGIN, MoveBudget, bodyFits, stepFree } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { RUN_MS } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const count = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k).length;
function clock() {
    const real = Date.now; let off = 0;
    Date.now = () => real() + off;
    return { advance: (ms: number) => { off += ms; }, restore: () => { Date.now = real; } };
}

/** Una fila de celdas libres alrededor del punto de partida, para caminar sin chocar con nada. */
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('solmar_legacy');
    (w as unknown as { mobSim?: unknown }).mobSim = undefined;
    const join = (name: string, at: { x: number; y: number }) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: true } as unknown as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        const p = w.playerOf(sid)!;
        p.spawnProtection = false;
        return { sid, log, p };
    };
    const occ = (w as unknown as { occupancy: { isFree(x: number, y: number): boolean } }).occupancy;
    // buscar 12 celdas libres seguidas en una fila (y las dos filas de al lado) para caminar
    let at = { x: 30, y: 20 };
    search: for (let y = 5; y < 90; y++) for (let x = 5; x < 70; x++) {
        let ok = true;
        for (let k = 0; k < 14 && ok; k++) for (let dy = -1; dy <= 1; dy++) if (!occ.isFree(x + k, y + dy)) ok = false;
        if (ok) { at = { x, y }; break search; }
    }
    const A = join('corre', at);
    const B = join('mira', { x: at.x + 1, y: at.y + 1 });
    return { w, A, B, at, occ };
}
const pos = (w: GameWorld, sid: string, x: number, y: number) => pkt(w, sid, 'playerPositionRequest', { x, y });

test('movimiento libre: caminar continuo a la velocidad del juego no genera correcciones y la celda sigue a la posición', () => {
    const c = clock();
    try {
        const { w, A, at } = setup();
        const v = 1000 / RUN_MS;                  // celdas por segundo
        let x = at.x + 0.5; const y = at.y + 0.5;
        for (let i = 0; i < 40; i++) {            // 4 s a 10 Hz hacia +x
            c.advance(100); x += v * 0.1; pos(w, A.sid, x, y);
        }
        assert.equal(count(A.log, 'resetPosition'), 0, 'ninguna corrección');
        assert.equal(count(A.log, 'playerParalyzed'), 0);
        assert.equal(A.p.posX, Math.floor(x), 'la celda del server es floor(x)');
        assert.equal(A.p.posY, at.y);
        assert.ok(Math.abs(A.p.fx - x) < 1e-6, 'guarda la posición decimal');
    } finally { c.restore(); }
});

test('movimiento libre: los que lo ven reciben la posición decimal', () => {
    const c = clock();
    try {
        const { w, A, B, at } = setup();
        c.advance(100); pos(w, A.sid, at.x + 0.62, at.y + 0.5);
        const ups = B.log.filter((m) => m.payload?.$case === 'playerPositionUpdate');
        assert.equal(ups.length, 1);
        const u = ups[0].payload as { $case: 'playerPositionUpdate'; value: { playerId: bigint; x: number; y: number } };
        assert.equal(u.value.playerId, A.p.playerId);
        assert.ok(Math.abs(u.value.x - (at.x + 0.62)) < 1e-5);
    } finally { c.restore(); }
});

test('movimiento libre: el jitter de red (llegan de a dos) no castiga, ir al doble de velocidad sí', () => {
    const c = clock();
    try {
        const { w, A, at } = setup();
        const v = 1000 / RUN_MS;
        const lo = at.x + 2, hi = at.x + 12;
        let x = at.x + 0.5; const y = at.y + 0.5, ms = [60, 140]; // pares: 60 + 140 = 200 ms por dos pedidos
        // primero se camina hasta lo libre del medio y después vuelta y vuelta sin salir de la fila libre
        for (let i = 0; i < 8; i++) { c.advance(100); x += v * 0.1; pos(w, A.sid, x, y); }
        let dir = 1;
        for (let i = 0; i < 60; i++) {
            const dt = ms[i % 2]; c.advance(dt);
            x += dir * v * dt / 1000; if (x > hi || x < lo) dir = -dir;
            pos(w, A.sid, x, y);
        }
        assert.equal(count(A.log, 'resetPosition'), 0, 'el jitter no es trampa');
        assert.equal(count(A.log, 'playerParalyzed'), 0);
        // ahora al doble: 0,2 celdas cada 100 ms contra 0,1 legales
        for (let i = 0; i < 60; i++) { c.advance(100); x += dir * 2 * v * 0.1; if (x > hi || x < lo) dir = -dir; pos(w, A.sid, x, y); }
        assert.ok(count(A.log, 'resetPosition') > 0, 'las posiciones de más se rechazan');
        assert.equal(count(A.log, 'playerParalyzed'), 1, 'y a la larga paraliza');
    } finally { c.restore(); }
});

test('movimiento libre: una celda bloqueada u ocupada se rechaza y saltar más de una celda también', () => {
    const c = clock();
    try {
        const { w, A, B, at } = setup();
        // B está en (at.x+1, at.y+1): entrar a su celda se rechaza
        c.advance(100); pos(w, A.sid, at.x + 1.5, at.y + 1.5);
        assert.equal(count(A.log, 'resetPosition'), 1, 'celda ocupada por otro jugador');
        assert.equal(A.p.posX, at.x); assert.equal(A.p.posY, at.y);
        // saltar 3 celdas de golpe
        c.advance(100); pos(w, A.sid, at.x + 3.5, at.y + 0.5);
        assert.equal(count(A.log, 'resetPosition'), 2, 'ni siquiera con presupuesto: no se puede saltar celdas');
        assert.equal(B.p.posX, at.x + 1);
    } finally { c.restore(); }
});

test('movimiento libre: después de un teletransporte la posición decimal vuelve al centro de la celda nueva', () => {
    const c = clock();
    try {
        const { w, A, at } = setup();
        c.advance(100); pos(w, A.sid, at.x + 0.7, at.y + 0.5);
        A.p.setPosition(at.x + 6, at.y);           // como un blink o un portal
        c.advance(100); pos(w, A.sid, at.x + 6.55, at.y + 0.5);
        assert.equal(count(A.log, 'resetPosition'), 0);
        assert.equal(A.p.posX, at.x + 6);
        assert.ok(Math.abs(A.p.fx - (at.x + 6.55)) < 1e-6);
    } finally { c.restore(); }
});

// ---------- módulo puro (el que usa el cliente) ----------
const wall = (set: string[]) => (cx: number, cy: number) => !set.includes(`${cx},${cy}`);

test('stepFree: avanza en cualquier ángulo a la velocidad pedida', () => {
    const free = wall([]);
    const r = stepFree({ x: 5.5, y: 5.5, dx: 1, dy: 1, speed: 3, dt: 1 / 60, free });
    assert.ok(Math.abs(r.moved - 3 / 60) < 1e-9, 'distancia euclídea = velocidad * dt');
    assert.ok(Math.abs((r.x - 5.5) - (r.y - 5.5)) < 1e-9, 'diagonal pareja');
    // el largo del vector escala la velocidad
    const half = stepFree({ x: 5.5, y: 5.5, dx: 0.5, dy: 0, speed: 3, dt: 1, free });
    assert.ok(Math.abs(half.moved - 1.5) < 1e-9);
});

test('stepFree: contra una pared desliza por el eje libre y no la atraviesa', () => {
    const free = (cx: number, cy: number) => cx !== 7;                // pared vertical infinita en x = 7
    let x = 5.5, y = 5.5;
    for (let i = 0; i < 120; i++) { const r = stepFree({ x, y, dx: 1, dy: 0.5, speed: 3, dt: 1 / 60, free }); x = r.x; y = r.y; }
    assert.ok(x < 7 - BODY_MARGIN + 1e-9, `no atraviesa la pared (x = ${x})`);
    assert.ok(bodyFits(x, y, free), 'queda dentro de lo libre');
    assert.ok(y > 5.5 + 1, `sigue deslizando a lo largo de la pared (y = ${y})`);
});

test('stepFree: contra una pared de frente se frena y no queda trabado para irse', () => {
    const free = wall(['7,5']);
    let x = 5.5, y = 5.5;
    for (let i = 0; i < 120; i++) { const r = stepFree({ x, y, dx: 1, dy: 0, speed: 3, dt: 1 / 60, free }); x = r.x; y = r.y; }
    assert.ok(x < 7 - BODY_MARGIN + 1e-9);
    const back = stepFree({ x, y, dx: -1, dy: 0, speed: 3, dt: 0.5, free });
    assert.ok(back.moved > 1, 'se puede volver');
});

test('stepFree: si ya quedó adentro de una celda ocupada (otro jugador se paró encima) puede salir', () => {
    const free = wall(['5,5']);
    const r = stepFree({ x: 5.5, y: 5.5, dx: 1, dy: 0, speed: 3, dt: 0.5, free });
    assert.ok(r.moved > 1, 'sale');
});

test('stepFree: un frame largo (lag) no atraviesa una pared fina', () => {
    const free = wall(['7,5']);
    const r = stepFree({ x: 6.4, y: 5.5, dx: 1, dy: 0, speed: 3, dt: 1, free });   // 3 celdas de golpe
    assert.ok(r.x < 7 - BODY_MARGIN + 1e-9);
});

test('MoveBudget: velocidad legal pasa, el doble no; la ráfaga tiene tope', () => {
    const b = new MoveBudget(2, 0);
    let t = 0, ok = 0;
    for (let i = 0; i < 100; i++) { t += 100; if (b.spend(0.3, t, 3)) ok++; }   // 3 celdas/s legales: 0,3 cada 100 ms
    assert.equal(ok, 100);
    const c = new MoveBudget(2, 0);
    let bad = 0; t = 0;
    for (let i = 0; i < 100; i++) { t += 100; if (!c.spend(0.6, t, 3)) bad++; }    // el doble
    assert.ok(bad > 40, `rechaza el exceso sostenido (${bad})`);
    const d = new MoveBudget(2, 0);
    assert.equal(d.spend(2.5, 0, 3), false, 'no se pueden juntar más de 2 celdas de una');
});

test('presupuesto: caminar a velocidad legal a 20 Hz con jitter de red y tirones de hasta 300 ms no dispara correcciones', () => {
    const speed = 1000 / 300; // celdas/s
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const b = new MoveBudget(1.6, 0);
    let arrive = 0, sentAt = 0, violations = 0, n = 0;
    for (let k = 1; k <= 600; k++) {                       // 30 s de caminata
        const gap = (k % 97 === 0 ? 300 : 50);             // de vez en cuando un tirón de 300 ms sin enviar
        sentAt += gap;
        arrive = Math.max(arrive, sentAt + rnd() * 80);    // la red demora hasta 80 ms y nunca desordena
        if (!b.spend(speed * (gap / 1000), arrive, speed)) violations++;
        n++;
    }
    assert.equal(violations, 0, `${violations} de ${n} posiciones rechazadas`);
});

test('presupuesto: el que va al doble de la velocidad legal sí queda al descubierto, aunque mande a 20 Hz', () => {
    const speed = 1000 / 300, b = new MoveBudget(1.6, 0);
    let t = 0, rejected = 0;
    for (let k = 0; k < 200; k++) { t += 50; if (!b.spend(speed * 2 * 0.05, t, speed)) rejected++; }
    assert.ok(rejected > 50, `solo ${rejected} rechazos`);
});
