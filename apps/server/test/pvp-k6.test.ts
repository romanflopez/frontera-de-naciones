/**
 * K6: reglas de PvP (solo contra jugadores), Segundo aliento, pociones e invisibilidad nerfeada.
 * Ver el doc del proyecto kits-de-clase.md §2.4, §2.5 y §3.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import {
    DETECT_CD_MS, INVIS_CD_MS, mitigate, POTION_LOCK_PVE_MS, POTION_LOCK_PVP_MS, potionHp, PVP_COMBAT_MS, PVP_DMG_MULT, PVP_HIT_CAP, pvpMpRegen, combatMpRegen, pvpCap, pvpScale, pvpVsCtrl,
    RECALL_PVP_LOCK_MS, rollSpellDamage, SECOND_WIND, secondWindHeal, statsFromChar,
} from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const all = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k).map((m) => (m.payload as any).value);
const last = (log: ServerMessage[], k: string) => all(log, k).at(-1);

let off = 0;
const realNow = Date.now;
mock.method(Date, 'now', () => realNow() + off);
const advance = (w: GameWorld, ms: number) => { for (let t = 0; t < ms; t += 100) { off += Math.min(100, ms - t); w.tick(); } };

function setup(clsA = 'mago', clsB = 'pala') {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('solmar_legacy');
    (w as unknown as { mobSim?: unknown }).mobSim = undefined; // sin mobs que molesten
    const join = (name: string, at: { x: number; y: number }, faction: string, cls: string) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls, faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};${cls};` });
        const p = w.playerOf(sid)!;
        p.combat = statsFromChar({ lvl: 20, cls, eq: {} });
        p.spawnProtection = false; p.mp = p.combat.maxMp = 5000; p.hp = p.combat.maxHp;
        return { sid, log, p };
    };
    const A = join(`a${off}`, { x: 30, y: 20 }, 'solmar', clsA);
    const B = join(`b${off}`, { x: 32, y: 20 }, 'vhar', clsB);
    const hit = (spell: string, from = A, to = B) => pkt(w, from.sid, 'pvpHitRequest', { fx: '', x: to.p.posX, y: to.p.posY, targetId: to.p.playerId, dmg: 9999, secs: 0, r: 0, spell });
    off += 1_000_000; // separa cada prueba de las recargas de la anterior
    return { w, A, B, hit };
}

// ---------- funciones puras ----------
test('PvP: multiplicador (×1,5 desde el re-nivel a 120) antes de la defensa, tope del 25 % por golpe y bonus sobre controlado de 1,2× como mucho', () => {
    assert.equal(pvpScale(100), Math.round(100 * PVP_DMG_MULT)); assert.ok(pvpScale(1) >= 1);
    assert.equal(PVP_DMG_MULT, 1.5);
    assert.equal(pvpCap(900, 1000), 250); assert.equal(pvpCap(100, 1000), 100);
    assert.equal(pvpVsCtrl(1.5), 1.2); assert.equal(pvpVsCtrl(2), 1.2); assert.equal(pvpVsCtrl(1.1), 1.1);
    assert.equal(PVP_HIT_CAP, 0.25);
});

test('Segundo aliento: recupera la mitad de vida y maná; envenenado, un 30 % menos', () => {
    assert.deepEqual(secondWindHeal(1000, 400, false), { hp: 500, mp: 200 });
    assert.deepEqual(secondWindHeal(1000, 400, true), { hp: 350, mp: 140 });
    assert.equal(SECOND_WIND.castMs, 3000); assert.equal(SECOND_WIND.cdMs, 210000);
});

// ---------- daño contra jugadores ----------
test('el daño contra un jugador pasa por el multiplicador PvP y la defensa', () => {
    const { A, B, hit } = setup('pala', 'pala');
    mock.method(Math, 'random', () => 0.5);
    try {
        const raw = rollSpellDamage('ataque', A.p.combat, false), hp0 = B.p.hp;
        hit('ataque');
        assert.equal(hp0 - B.p.hp, mitigate(pvpScale(raw), B.p.combat.def));
    } finally { (Math.random as any).mock.restore(); }
});

test('ningún golpe solo saca más del 25 % de la vida máxima de un jugador', () => {
    const { A, B, hit } = setup('pala', 'mago');
    A.p.combat.wdmg = [100000, 100000];
    const hp0 = B.p.hp; hit('ataque');
    assert.equal(hp0 - B.p.hp, Math.floor(B.p.combat.maxHp * PVP_HIT_CAP));
    assert.ok(!B.p.isDead);
});

test('sin ventaja de abridor: la Furia no vale en el primer golpe a alguien fuera de combate, sí en los siguientes', () => {
    const { w, A, B, hit } = setup('pala', 'pala');
    mock.method(Math, 'random', () => 0.5);
    try {
        A.p.pvp.castFury(Date.now());
        let hp = B.p.hp; hit('ataque'); const first = hp - B.p.hp;
        advance(w, 2000); hp = B.p.hp; hit('ataque'); const second = hp - B.p.hp;
        assert.ok(second > first, `${first} → ${second}`);
        assert.ok(Date.now() < B.p.pvpCombatUntil && Date.now() < A.p.pvpCombatUntil, 'los dos quedan en combate PvP');
        advance(w, PVP_COMBAT_MS + 500); hp = B.p.hp; hit('ataque');
        assert.equal(hp - B.p.hp, first, 'pasados 10 s sin pelear, vuelve a contar como primer golpe');
    } finally { (Math.random as any).mock.restore(); }
});

// ---------- recall ----------
test('el recall se bloquea 10 s después de recibir daño de un jugador', () => {
    const { w, A, B, hit } = setup('pala', 'pala');
    hit('ataque');
    pkt(w, B.sid, 'recallRequest', { cancel: false });
    const st = last(B.log, 'recallState');
    assert.equal(st.state, 0); assert.match(st.reason, /jugador/);
    advance(w, RECALL_PVP_LOCK_MS + 200);
    pkt(w, B.sid, 'recallRequest', { cancel: false });
    assert.equal(last(B.log, 'recallState').state, 1, 'pasados los 10 s sí puede');
    // el que pegó no queda bloqueado
    pkt(w, A.sid, 'recallRequest', { cancel: false });
    assert.equal(last(A.log, 'recallState').state, 1);
});

// ---------- pociones ----------
test('pociones: mismo bloqueo (1 min) y misma poción en PvE y en PvP', () => {
    const { w, A, B, hit } = setup('pala', 'pala');
    const max = B.p.combat.maxHp;
    B.p.hp = Math.round(max * 0.3);
    pkt(w, B.sid, 'potionRequest', { kind: 0 });
    const lock = last(B.log, 'abilityState');
    assert.equal(lock.id, 'pocion'); assert.equal(lock.cooldownTotalMs, POTION_LOCK_PVE_MS);
    advance(w, 3000);
    assert.equal(B.p.hp, Math.round(max * 0.3) + potionHp(max), 'PvE: poción entera');
    B.p.hp = Math.round(max * 0.3); const hp1 = B.p.hp;
    pkt(w, B.sid, 'potionRequest', { kind: 0 }); advance(w, 3000);
    assert.equal(B.p.hp, hp1, 'en PvE no se puede tomar otra antes del minuto');
    hit('ataque', A, B); // entra en PvP: el bloqueo es el mismo
    assert.ok(B.p.potionReadyAt <= B.p.lastPotionAt + POTION_LOCK_PVP_MS);
    advance(w, POTION_LOCK_PVP_MS);
    B.p.hp = Math.round(max * 0.3); // que la poción no llene la barra
    hit('ataque', A, B); const hp2 = B.p.hp;
    pkt(w, B.sid, 'potionRequest', { kind: 0 }); advance(w, 2200);
    assert.equal(B.p.hp, hp2 + potionHp(max, true), 'PvP: la misma poción que en PvE');
    assert.equal(potionHp(max, true), potionHp(max), 'igual a la normal (40 %)');
    assert.equal(POTION_LOCK_PVP_MS, POTION_LOCK_PVE_MS);
    assert.equal(last(B.log, 'abilityState').cooldownTotalMs, POTION_LOCK_PVP_MS);
});

// ---------- Segundo aliento ----------
test('Segundo aliento: 3 s quieto, cura y arranca la recarga de 3,5 min', () => {
    const { w, B } = setup('pala', 'pala');
    const max = B.p.combat.maxHp; B.p.hp = 100; B.p.mp = 0;
    pkt(w, B.sid, 'skillRequest', { skill: 'aliento', targetId: 0n, mobId: 0 });
    assert.equal(last(B.log, 'abilityState').channeling, true);
    advance(w, 2800); assert.equal(B.p.hp, 100, 'todavía canaliza');
    advance(w, 400);
    assert.equal(B.p.hp, 100 + Math.round(max * 0.5));
    assert.ok(B.p.mp >= Math.round(B.p.combat.maxMp * 0.5), 'la mitad del maná (más la regeneración de esos 3 s)');
    const st = last(B.log, 'abilityState');
    assert.equal(st.channeling, false); assert.equal(st.cooldownMs, SECOND_WIND.cdMs);
    B.p.hp = 100;
    pkt(w, B.sid, 'skillRequest', { skill: 'aliento', targetId: 0n, mobId: 0 });
    assert.match(last(B.log, 'abilityState').reason, /recargando/);
    advance(w, 3500); assert.equal(B.p.hp, 100, 'en recarga no cura');
});

test('Segundo aliento: lo cortan un golpe directo, moverse y un control; la quemadura no', () => {
    const { w, A, B } = setup('mago', 'pala');
    const start = () => { B.p.hp = 100; B.p.windCdUntil = 0; pkt(w, B.sid, 'skillRequest', { skill: 'aliento', targetId: 0n, mobId: 0 }); assert.ok(B.p.windUntil > 0); };
    // golpe directo
    start(); advance(w, 1000);
    pkt(w, A.sid, 'skillRequest', { skill: 'nova', targetId: 0n, mobId: 0 }); // B está a 2 celdas: la Nova (radio 3) le pega y lo congela
    assert.equal(B.p.windUntil, 0, 'la Nova lo cortó');
    assert.match(last(B.log, 'abilityState').reason, /pegaron|controlaron/);
    // moverse
    advance(w, 3000); start();
    pkt(w, B.sid, 'requestMovement', { curX: B.p.posX, curY: B.p.posY, destX: B.p.posX + 1, destY: B.p.posY, dashAttack: false, gameWorldId: '' });
    assert.equal(B.p.windUntil, 0, 'moverse lo cortó');
    // quemadura: no lo corta
    advance(w, 6000); start();
    (w as any).burnPlayer(B.p, A.p);
    advance(w, 3200);
    assert.equal(B.p.windUntil, 0);
    assert.ok(B.p.windCdUntil > Date.now(), 'terminó: la quemadura no lo cortó');
});

// ---------- invisibilidad y detectar ----------
test('invisibilidad: recarga de 60 s y se corta al recibir daño o al castear; detectar, 20 s', () => {
    const { w, A, B, hit } = setup('pala', 'mago');
    pkt(w, B.sid, 'invisibilityRequest', {});
    assert.ok(B.p.status.isInvisible);
    hit('ataque', A, B);
    assert.equal(B.p.status.isInvisible, false, 'recibir daño la corta');
    const mp = B.p.mp; pkt(w, B.sid, 'invisibilityRequest', {});
    assert.equal(B.p.status.isInvisible, false, 'en recarga'); assert.equal(B.p.mp, mp, 'no cobra maná en recarga');
    advance(w, INVIS_CD_MS);
    pkt(w, B.sid, 'invisibilityRequest', {}); assert.ok(B.p.status.isInvisible, 'pasado el minuto, sí');
    pkt(w, B.sid, 'spellCastStartRequest', { spellId: 0, spell: 'proyectil' });
    assert.equal(B.p.status.isInvisible, false, 'castear la corta');
    pkt(w, B.sid, 'detectInvisibleRequest', {}); assert.ok(B.p.status.hasDetectInvisible);
    advance(w, 11000); assert.equal(B.p.status.hasDetectInvisible, false);
    pkt(w, B.sid, 'detectInvisibleRequest', {}); assert.equal(B.p.status.hasDetectInvisible, false, 'en recarga');
    advance(w, DETECT_CD_MS - 11000);
    pkt(w, B.sid, 'detectInvisibleRequest', {}); assert.ok(B.p.status.hasDetectInvisible);
});

// ---------- K7: maná en combate PvP ----------
test('K7: en combate PvP el maná regenera al menos 5 por segundo (1 %); fuera del PvP, la regla de PvE de la etapa 6b (2 %, mínimo 3)', () => {
    const { w, A, B, hit } = setup('pala', 'pala');
    assert.equal(pvpMpRegen(84), 5); assert.equal(pvpMpRegen(1000), 10); // el PvP no cambia con la etapa 6b
    assert.equal(combatMpRegen(84), 3); assert.equal(combatMpRegen(1000), 20);
    A.p.combat.maxMp = 84; // un paladín de nivel 12
    A.p.mp = 0; advance(w, 1100);
    const calm = A.p.mp; assert.ok(calm >= 3 && calm <= 6, `fuera del PvP: ${calm}`);
    hit('ataque', A, B); A.p.mp = 0; advance(w, 1100);
    assert.ok(A.p.mp >= 5, `en PvP: ${A.p.mp}`);
});
