/**
 * P0-A: el cliente no controla números de combate.
 *  - La velocidad de movimiento la calcula el server (walk 333 / run 200); un pedido del cliente con otra velocidad se ignora.
 *  - El cast time lo decide el server: un golpe de hechizo sin cast empezado, o antes de que termine, se descarta.
 *  - Corriendo no se castea.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { castMsOf, RUN_MS, WALK_MS } from '../src/systems/pvpCombat.ts';

const settings = loadSettings(), catalogs = loadCatalogs();
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
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
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
    const B = join('blanco', { x: 33, y: 20 }, 'vhar', 'guerrero');
    const fire = (spell: string) => pkt(w, A.sid, 'pvpHitRequest', { fx: '', x: B.p.posX, y: B.p.posY, targetId: B.p.playerId, dmg: 9999, secs: 0, r: 0, spell });
    return { w, A, B, fire };
}

test('movimiento: el server fija walk 333 / run 200 e ignora la velocidad del guardado y del cliente', () => {
    const { w, A } = setup();
    assert.equal(A.p.runningMode, false, 'siempre se entra caminando');
    assert.equal(A.p.movementSpeedMs, WALK_MS);
    pkt(w, A.sid, 'changePlayerMovementSpeedRequest', { movementSpeedMs: 100 }); // mensaje retirado del proto
    assert.equal(A.p.movementSpeedMs, WALK_MS);
    pkt(w, A.sid, 'playerMovementStateChangeRequest', { runningMode: true });
    assert.equal(A.p.movementSpeedMs, RUN_MS);
    assert.ok(A.p.movementSpeedMs >= 200, 'cap duro de combate');
});

test('cast: un golpe de hechizo sin cast empezado en el server se descarta', () => {
    const c = clock();
    try {
        const { B, fire } = setup();
        const hp = B.p.hp; fire('proyectil');
        assert.equal(B.p.hp, hp);
    } finally { c.restore(); }
});

test('cast: el golpe antes del cast time del server se descarta; después pega', () => {
    const c = clock();
    try {
        const { w, A, B, fire } = setup();
        const hp = B.p.hp;
        pkt(w, A.sid, 'changePlayerCastSpeedRequest', { castSpeedMs: 200 }); // un cliente modificado pide 200 ms: no existe más
        pkt(w, A.sid, 'spellCastStartRequest', { spellId: 0, spell: 'proyectil' });
        c.advance(200); fire('proyectil');
        assert.equal(B.p.hp, hp, 'a los 200 ms no puede salir (cast de 1,5 s)');
        c.advance(castMsOf('proyectil')); fire('proyectil');
        assert.ok(B.p.hp < hp, 'terminado el cast, pega');
        const hp2 = B.p.hp; c.advance(500); fire('proyectil');
        assert.equal(B.p.hp, hp2, 'el cast se consumió: otro golpe necesita otro cast');
    } finally { c.restore(); }
});

test('cast: corriendo no inicia; ponerse a correr corta el cast en curso', () => {
    const c = clock();
    try {
        const { w, A, B, fire } = setup();
        const hp = B.p.hp;
        pkt(w, A.sid, 'playerMovementStateChangeRequest', { runningMode: true });
        pkt(w, A.sid, 'spellCastStartRequest', { spellId: 0, spell: 'proyectil' });
        assert.equal(count(A.log, 'spellCastFailed'), 1);
        c.advance(2000); fire('proyectil'); assert.equal(B.p.hp, hp);

        pkt(w, A.sid, 'playerMovementStateChangeRequest', { runningMode: false });
        pkt(w, A.sid, 'spellCastStartRequest', { spellId: 0, spell: 'proyectil' });
        c.advance(500); pkt(w, A.sid, 'playerMovementStateChangeRequest', { runningMode: true });
        c.advance(2000); fire('proyectil'); assert.equal(B.p.hp, hp);
    } finally { c.restore(); }
});
