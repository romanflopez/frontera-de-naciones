/**
 * Proyectiles esquivables (Saeta ígnea, Bola de fuego): el server valida el cast, calcula el vuelo y decide el impacto
 * mirando dónde está el blanco al llegar. Quieto o en línea recta (con puntería adelantada) pega; moverse a tiempo erra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { castMsOf } from '../src/systems/pvpCombat.ts';
import { PROJECTILES, leadAim, projectileFlightMs, projectileHits } from '@fdn/world';

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

function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('solmar_legacy');
    (w as unknown as { mobSim?: unknown }).mobSim = undefined; // sin mobs que molesten
    const join = (name: string, at: { x: number; y: number }, faction: string, cls: string) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: true, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls, faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};${cls};` });
        const p = w.playerOf(sid)!;
        p.spawnProtection = false; p.mp = 1000;
        return { sid, log, p };
    };
    const A = join('caster', { x: 30, y: 20 }, 'solmar', 'mago');
    const B = join('blanco', { x: 38, y: 20 }, 'vhar', 'pala');
    const launch = (spell: string, ax = B.p.posX + 0.5, ay = B.p.posY + 0.5) => pkt(w, A.sid, 'projectileLaunchRequest', { spell, targetId: B.p.playerId, aimX: ax, aimY: ay });
    const cast = (spell: string, c: ReturnType<typeof clock>) => { pkt(w, A.sid, 'spellCastStartRequest', { spellId: 0, spell }); c.advance(castMsOf(spell) + 100); };
    return { w, A, B, launch, cast };
}


test('proyectil: quieto, pega al llegar (no antes)', () => {
    const c = clock();
    try {
        const { w, A, B, launch, cast } = setup();
        const hp = B.p.hp; cast('proyectil', c); launch('proyectil');
        assert.equal(B.p.hp, hp, 'recién salió: todavía vuela');
        c.advance(projectileFlightMs('proyectil', 30.5, 20.5, 38.5, 20.5) + 50); w.tick();
        assert.ok(B.p.hp < hp, 'llegó y pegó');
        assert.equal(count(B.log, 'playerProjectile'), 1, 'el que mira ve el proyectil (el que lanza lo dibuja solo)');
        assert.equal(count(A.log, 'playerProjectile'), 0);
    } finally { c.restore(); }
});

test('proyectil: si el blanco se mueve mientras vuela, erra (y igual gasta maná)', () => {
    const c = clock();
    try {
        const { w, A, B, launch, cast } = setup();
        const hp = B.p.hp; cast('proyectil', c);
        const mp = A.p.mp; launch('proyectil');
        // el blanco corre 1,8 celdas hacia un costado durante el vuelo (8 celdas / 16 = 0,5 s)
        for (let i = 1; i <= 5; i++) { c.advance(100); pkt(w, B.sid, 'playerPositionRequest', { x: 38.5, y: 20.5 + i * 0.33 }); w.tick(); }
        c.advance(50); w.tick();
        assert.equal(B.p.hp, hp, 'el proyectil cayó donde ya no estaba');
        assert.ok(A.p.mp < mp, 'errar cuesta maná');
    } finally { c.restore(); }
});

test('proyectil: apuntando con anticipación se le pega a quien corre derecho', () => {
    const sp = 'proyectil', v = 1000 / 300;
    // el blanco corre en +y a la velocidad de movimiento; sin anticipar erra, anticipando pega
    const T = projectileFlightMs(sp, 30.5, 20.5, 38.5, 20.5) / 1000;
    const finalY = 20.5 + v * T;
    assert.equal(projectileHits(sp, 38.5, 20.5, 38.5, finalY), false, 'apuntar a donde está erra');
    const a = leadAim(sp, 30.5, 20.5, 38.5, 20.5, 0, v);
    assert.ok(projectileHits(sp, a.x, a.y, 38.5, 20.5 + v * (Math.hypot(a.x - 30.5, a.y - 20.5) / PROJECTILES[sp].vp)), 'con anticipación lineal pega');
});

test('proyectil: no se pide por pvpHit directo, ni sin cast, ni apuntando fuera de alcance', () => {
    const c = clock();
    try {
        const { w, A, B, launch, cast } = setup();
        const hp = B.p.hp;
        launch('proyectil'); c.advance(1000); w.tick();
        assert.equal(B.p.hp, hp, 'sin cast no sale');
        cast('proyectil', c);
        pkt(w, A.sid, 'pvpHitRequest', { fx: '', x: 38, y: 20, targetId: B.p.playerId, dmg: 9999, secs: 0, r: 0, spell: 'proyectil' });
        assert.equal(B.p.hp, hp, 'el golpe directo con un proyectil se descarta');
        launch('proyectil', 80, 80); c.advance(1000); w.tick();
        assert.equal(B.p.hp, hp, 'apuntar a 50 celdas no sale');
        launch('proyectil'); c.advance(1000); w.tick();
        assert.ok(B.p.hp < hp, 'el cast seguía vigente: ahora sí');
    } finally { c.restore(); }
});

test('bola de fuego: también es un proyectil esquivable', () => {
    const c = clock();
    try {
        const { w, A, B, launch, cast } = setup();
        A.p.combat.lvl = 40; // la bola de fuego se desbloquea más arriba
        const hp = B.p.hp; cast('bola', c); launch('bola'); c.advance(1500); w.tick();
        assert.ok(B.p.hp < hp);
    } finally { c.restore(); }
});
