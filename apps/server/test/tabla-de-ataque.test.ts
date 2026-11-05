/**
 * Orden de la tabla de ataque (docs/COMBATE.md "Tabla de ataque"; checklist sacado de los bugs de la primera semana de Dreadmyst,
 * doc del proyecto dreadmyst-changelog-referencia.md §4):
 *   1. ¿pega? (hoy no hay esquiva, parada ni bloqueo: todo golpe que llega, entra)
 *   2. control y efectos secundarios: tiran su propia resistencia/inmunidad (RM, Bendición, Purga, rendimiento decreciente)
 *   3. crítico (solo contra monstruos; en PvP no hay)
 *   4. mitigación (DF o RM) y después el escudo, que también se come el daño en el tiempo
 * Más: el miedo respeta el aturdido/congelado y la inmunidad, los inmunes muestran "Inmune", el daño en el tiempo no rompe
 * el control propio y un mob que huye no arrastra a otros.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import type { MobType, WorldMap } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer, Player } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { MobSim, type MobHost } from '../src/mobs.ts';
import { castMsOf, HIT_ROLL, PvpLimiter, statsFromChar } from '../src/systems/pvpCombat.ts';
import { applyBless, applyShield, isSlowed, shieldOf } from '../src/systems/statusSystem.ts';

let clock = 120_000_000;
mock.method(Date, 'now', () => clock);

// ---------- mundo real (PvP y daño a jugadores) ----------
const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const resists = (log: ServerMessage[]) => log.filter((m) => m.payload?.$case === 'pvpHit' && (m.payload.value as { fx: string }).fx === 'resist').length;
type Priv = { damagePlayer(p: Player, raw: number, kind: 'phys' | 'magic', killer: Player | null): number; burnPlayer(t: Player, s: Player): void; mobSim?: unknown; restat(p: Player): void };
const priv = (w: GameWorld) => w as unknown as Priv;
const advance = (w: GameWorld, ms: number) => { for (let t = 0; t < ms; t += 100) { clock += 100; w.tick(); } };

function world() {
    clock += 1_000_000;
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('solmar_legacy', '');
    const host = (priv(w).mobSim as { host: MobHost }).host;
    priv(w).mobSim = undefined;
    const join = (name: string, at: { x: number; y: number }, faction: string, cls: string) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls, faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};${cls};` });
        const p = w.playerOf(sid)!;
        p.spawnProtection = false;
        p.econ!.lvl = 35; priv(w).restat(p); p.mp = p.combat.maxMp; p.hp = p.combat.maxHp;
        return { sid, log, p };
    };
    const mago = join('mago', { x: 30, y: 20 }, 'solmar', 'mago');
    const enemigo = join('enemigo', { x: 34, y: 20 }, 'vhar', 'pala');
    const shield = (p: Player) => applyShield(p.status, clock, 100000, p.combat.maxHp, 10000); // una barra llena
    const hitPvp = (spell: string) => pkt(w, mago.sid, 'pvpHitRequest', { fx: '', x: enemigo.p.posX, y: enemigo.p.posY, targetId: enemigo.p.playerId, dmg: 0, secs: 0, r: 0, spell });
    return { w, host, mago, enemigo, shield, hitPvp };
}

test('escudos (paso 4): la quemadura de un jugador se come el escudo antes que la vida', () => {
    const { w, mago, enemigo, shield } = world();
    const sh = shield(enemigo.p), hp = enemigo.p.hp;
    priv(w).burnPlayer(enemigo.p, mago.p);
    advance(w, 3500);
    assert.equal(enemigo.p.hp, hp, 'la vida no se toca');
    assert.ok(shieldOf(enemigo.p.status, clock) < sh, 'los pulsos salieron del escudo');
});

test('escudos (paso 4): el sangrado de un mob tóxico y el charco de un jefe (golpes de mob) también pasan por el escudo', () => {
    const { host, enemigo, shield } = world();
    const sh = shield(enemigo.p), hp = enemigo.p.hp;
    host.hurt(enemigo.p, 40, 'Goblin tóxico', '');
    assert.equal(enemigo.p.hp, hp);
    assert.ok(shieldOf(enemigo.p.status, clock) < sh);
});

test('un golpe que se come entero el escudo igual "entró": la Ignición quema y la Esquirla frena', () => {
    const { w, mago, enemigo, shield, hitPvp } = world();
    shield(enemigo.p);
    const hp = enemigo.p.hp, sh = shieldOf(enemigo.p.status, clock);
    hitPvp('ignicion');
    assert.equal(enemigo.p.hp, hp, 'el escudo se lo comió entero');
    assert.ok(shieldOf(enemigo.p.status, clock) < sh, 'pegó');
    assert.ok(enemigo.p.burnUntil > clock, 'quedó quemado');
    pkt(w, mago.sid, 'spellCastStartRequest', { spellId: 0, spell: 'esquirla' }); clock += castMsOf('esquirla');
    hitPvp('esquirla');
    assert.equal(enemigo.p.hp, hp);
    assert.ok(isSlowed(enemigo.p.status, clock), 'quedó frenado');
});

test('inmune: el aturdido de un jefe sobre un jugador con Bendición sagrada no entra y se ve "Inmune"', () => {
    const { host, enemigo } = world();
    applyBless(enemigo.p.status, clock, 10000);
    assert.equal(host.stun(enemigo.p, 3), 0);
    assert.equal(enemigo.p.isParalyzed(clock), false);
    assert.equal(resists(enemigo.log), 1);
    assert.equal(host.held!(enemigo.p), false);
});

// ---------- simulador de mobs ----------
const N = 40;
type Raw = { id: number; x: number; y: number; hp: number; hpMax: number; par: number; imm: number; slow: number; traits: number; state: string; fleeUntil: number; lastAttacker: bigint | null; burn: number; burnTick: number; burnDmg: number; burnBy: bigint | null; poison: number; poisonTick: number; zoneIdx: number };
function sim(zones: { type: MobType; x: number; y: number }[], at = { x: 5, y: 20 }) {
    clock += 1_000_000;
    const sent: ServerMessage[] = [], timers: { at: number; fn: () => void }[] = [];
    const p = { playerId: 7n, posX: at.x, posY: at.y, disconnected: false, isDead: false, status: { isInvisible: false }, combat: statsFromChar({ lvl: 20, cls: 'mago', eq: {} }), pvp: new PvpLimiter(), send: (m: ServerMessage) => sent.push(m) } as unknown as Player;
    const grid = (v: boolean) => Array.from({ length: N }, () => new Array<boolean>(N).fill(v));
    const map = { size: N, tiles: [], blocked: grid(false), safe: grid(false), props: [], decals: [], zones: zones.map((z, i) => ({ ...z, r: 0, n: 1, name: `zona ${i}` })), buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => [p], playerById: (id) => (id === p.playerId ? p : undefined), nearby: () => [p],
        after: (ms, fn) => { timers.push({ at: clock + ms, fn }); },
        hurt: () => {}, stun: () => 0, pay: () => true, heal: () => {}, reward: () => {},
    };
    const s = new MobSim(map, host, { noRespawn: true });
    const mobs = [...(s as unknown as { mobs: Map<number, Raw> }).mobs.values()];
    for (const m of mobs) { m.traits = 0; m.hp = m.hpMax = 1e6; }
    const step = (ms = 100) => { clock += ms; s.update(); for (const t of timers.filter((t) => t.at <= clock)) { timers.splice(timers.indexOf(t), 1); t.fn(); } };
    const hit = (m: Raw, spell: string, parSecs = 0) => s.hit(p, { mobId: m.id, dmg: 0, melee: false, crit: false, parSecs, poisonSecs: 0, spell });
    return { s, p, mobs, sent, step, hit, T: () => clock / 1000 };
}
const resistsAt = (sent: ServerMessage[]) => sent.filter((m) => m.payload?.$case === 'pvpHit' && (m.payload.value as { fx: string }).fx === 'resist').length;

test('inmune: controlar a un mob en sus 8 s de inmunidad no lo deja quieto y le avisa "Inmune" al que lo tiró', () => {
    const { mobs, sent, hit, T } = sim([{ type: 'goblin', x: 10, y: 20 }], { x: 8, y: 20 });
    const m = mobs[0];
    m.imm = T() + 8;
    hit(m, 'paralisis', 5);
    assert.ok(m.par <= T(), 'no quedó congelado');
    assert.equal(resistsAt(sent), 1);
});

test('inmune: aturdir a un jefe con motor le corta, no lo deja quieto y se ve "Inmune"', () => {
    const { s, p, mobs, sent } = sim([{ type: 'goblin_jefe', x: 10, y: 20 }], { x: 9, y: 20 });
    s.skillHit(p, mobs[0].id, 5, 0, 'aturdir', 3);
    assert.equal(mobs[0].par, 0);
    assert.equal(resistsAt(sent), 1);
});

test('el daño en el tiempo propio no rompe el control propio (en Dreadmyst el veneno despertaba al dormido)', () => {
    const { p, mobs, step, T } = sim([{ type: 'goblin', x: 10, y: 20 }], { x: 8, y: 20 });
    const m = mobs[0];
    m.par = T() + 5; m.imm = T() + 13;
    // una quemadura enorme (más del 45 % de la vida, lo que rompería el congelado si fuera un golpe directo) y un veneno
    m.burn = T() + 3; m.burnTick = T(); m.burnDmg = Math.round(m.hpMax * 0.5); m.burnBy = p.playerId;
    m.poison = T() + 3; m.poisonTick = T();
    step();
    assert.ok(m.hp < m.hpMax, 'los pulsos pegaron');
    assert.ok(m.par > T(), 'sigue congelado');
});

test('huida (el "miedo" de los mobs): respeta el congelado y el frenado', () => {
    const run = (setup: (m: Raw, T: number) => void) => {
        const { p, mobs, step, T } = sim([{ type: 'goblin', x: 10, y: 20 }], { x: 8, y: 20 });
        const m = mobs[0], x0 = m.x;
        m.state = 'flee'; m.fleeUntil = T() + 5; m.lastAttacker = p.playerId; setup(m, T());
        for (let i = 0; i < 10; i++) step();
        return Math.abs(m.x - x0);
    };
    assert.equal(run((m, T) => { m.par = T + 5; }), 0, 'congelado: no se mueve');
    const free = run(() => {}), slowed = run((m, T) => { m.slow = T + 5; });
    assert.ok(free > 1, `huye (${free.toFixed(2)} celdas en 1 s)`);
    assert.ok(Math.abs(slowed - free / 2) < 0.15, `frenado corre la mitad (${slowed.toFixed(2)} vs ${free.toFixed(2)})`);
});

test('huida: el mob que huye no arrastra a otros, ni de su pit ni de otro por el que pase', () => {
    // A (pit 0) huye del jugador hacia +x y pasa por encima de B (pit 1); C es de su mismo pit y queda en el camino
    const { p, mobs, step, hit, T } = sim([{ type: 'goblin', x: 10, y: 20 }, { type: 'goblin', x: 15, y: 20 }, { type: 'goblin', x: 10, y: 20 }]);
    const [A, B, C] = [mobs.find((m) => m.zoneIdx === 0)!, mobs.find((m) => m.zoneIdx === 1)!, mobs.find((m) => m.zoneIdx === 2)!];
    C.zoneIdx = A.zoneIdx; (C as unknown as { zone: unknown }).zone = (A as unknown as { zone: unknown }).zone; C.x = A.x + 1.5; C.y = A.y;
    A.state = 'flee'; A.fleeUntil = T() + 5; A.lastAttacker = p.playerId;
    for (let i = 0; i < 50; i++) {
        step();
        if (Math.abs(A.x - B.x) < 2) hit(A, 'proyectil'); // pegarle mientras pasa al lado de B
    }
    assert.ok(A.x > B.x, 'pasó por al lado de B');
    assert.equal(B.state, 'idle', 'el otro pit no se entera');
    assert.equal(C.state, 'idle', 'huyendo no contagia ni a los de su pit');
});

test('golpe entre jugadores (paso 1): una tirada alta falla y manda "Falló"; una baja pega', () => {
    const { w, mago, enemigo } = world();
    enemigo.p.combat = { ...enemigo.p.combat, dexStat: 200 }; mago.p.combat = { ...mago.p.combat, dexStat: 10, magStat: 10 };
    HIT_ROLL.enabled = true;
    const rnd = mock.method(Math, 'random', () => 0.99);
    try {
        const hp = enemigo.p.hp;
        assert.equal(priv(w).damagePlayer(enemigo.p, 50, 'phys', mago.p), 0, 'falla');
        assert.equal(enemigo.p.hp, hp);
        assert.ok(mago.log.some((m) => m.payload?.$case === 'pvpHit' && (m.payload.value as { fx: string }).fx === 'miss'), 'el que pegó ve "Falló"');
        assert.ok(enemigo.log.some((m) => m.payload?.$case === 'pvpHit' && (m.payload.value as { fx: string }).fx === 'miss'), 'el que esquivó también');
        rnd.mock.mockImplementation(() => 0.01);
        assert.ok(priv(w).damagePlayer(enemigo.p, 50, 'phys', mago.p) > 0, 'con tirada baja pega');
        assert.ok(enemigo.p.hp < hp);
    } finally { rnd.mock.restore(); HIT_ROLL.enabled = false; }
});
