/**
 * Paso K1: cada clase usa solo las habilidades de su kit y desde el nivel que corresponde (packages/world/src/kits.ts).
 * El server rechaza lo demás aunque el cliente lo pida a mano.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { CLASS_KITS, canUseSkill, checkSkill, skillDeniedText } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer, Player } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { PVP_SPELLS, SKILLS } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const cases = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k);
const texts = (log: ServerMessage[]) => cases(log, 'sendMessage').map((m) => String((m.payload as { value: { message?: string; text?: string } }).value.message ?? (m.payload as { value: { text?: string } }).value.text ?? ''));
const setLevel = (p: Player, lvl: number) => { p.combat = { ...p.combat, lvl }; };

function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('solmar_legacy');
    (w as unknown as { mobSim?: unknown }).mobSim = undefined;
    const join = (name: string, at: { x: number; y: number }, faction: string, cls: string) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls, faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};${cls};` });
        const p = w.playerOf(sid)!;
        p.spawnProtection = false; p.mp = 1000;
        return { sid, log, p };
    };
    const mago = join('mago', { x: 30, y: 20 }, 'solmar', 'mago');
    const pala = join('pala', { x: 33, y: 20 }, 'vhar', 'guerrero');
    return { w, mago, pala };
}

// ---------- A. la tabla ----------
test('kits: cada habilidad del server pertenece a por lo menos una clase', () => {
    const all = new Set([...Object.keys(PVP_SPELLS), ...Object.keys(SKILLS), 'furia', 'invisibilidad', 'detectar', 'remover']);
    const inKits = new Set(Object.values(CLASS_KITS).flatMap((k) => Object.keys(k)));
    for (const id of all) assert.ok(inKits.has(id), `${id} no está en ningún kit`);
});

test('kits: clase y nivel', () => {
    assert.equal(canUseSkill('mago', 1, 'proyectil'), true);
    assert.equal(canUseSkill('guerrero', 40, 'proyectil'), false, 'el paladín no tira saetas');
    assert.equal(canUseSkill('mago', 40, 'carga'), false, 'el mago no carga');
    assert.deepEqual(checkSkill('mago', 8, 'bola'), { ok: false, reason: 'nivel', need: 9 });
    assert.equal(canUseSkill('mago', 9, 'bola'), true);
    assert.equal(canUseSkill('guerrero', 19, 'carga'), false);
    assert.equal(canUseSkill('guerrero', 20, 'carga'), true);
    assert.equal(canUseSkill('nadie', 40, 'ataque'), false, 'clase desconocida: nada');
    assert.equal(skillDeniedText(checkSkill('mago', 1, 'blink')), 'Se desbloquea en el nivel 24.');
    assert.equal(skillDeniedText(checkSkill('guerrero', 1, 'blink')), 'Esa habilidad no es de tu clase.');
});

// ---------- H. el cliente pide lo que no le corresponde ----------
test('server: un paladín que pide un hechizo de mago no castea ni pega', () => {
    const { w, mago, pala } = setup();
    setLevel(pala.p, 40);
    const hp = mago.p.hp;
    pkt(w, pala.sid, 'spellCastStartRequest', { spellId: 0, spell: 'proyectil' });
    assert.equal(cases(pala.log, 'spellCastFailed').length, 1, 'el cast se rechaza');
    pkt(w, pala.sid, 'pvpHitRequest', { fx: '', x: mago.p.posX, y: mago.p.posY, targetId: mago.p.playerId, dmg: 9999, secs: 0, r: 0, spell: 'proyectil' });
    assert.equal(mago.p.hp, hp, 'sin daño');
    assert.ok(texts(pala.log).some((t) => t.includes('no es de tu clase')), 'se le avisa');
});

test('server: un mago de nivel 1 no puede castear Bola; a nivel 9 sí', () => {
    const { w, mago } = setup();
    pkt(w, mago.sid, 'spellCastStartRequest', { spellId: 0, spell: 'bola' });
    assert.equal(cases(mago.log, 'spellCastFailed').length, 1);
    assert.ok(texts(mago.log).some((t) => t.includes('nivel 9')));
    setLevel(mago.p, 9);
    pkt(w, mago.sid, 'spellCastStartRequest', { spellId: 0, spell: 'bola' });
    assert.equal(cases(mago.log, 'spellCastFailed').length, 1, 'a nivel 9 el cast arranca');
    assert.ok(mago.p.cast?.spell === 'bola');
});

test('server: habilidades de clase (carga, blink) respetan clase y nivel', () => {
    const { w, mago, pala } = setup();
    const denied = (log: ServerMessage[], skill: string) => cases(log, 'skillEffect').filter((m) => { const v = (m.payload as { value: { skill: string; ok: boolean } }).value; return v.skill === skill && !v.ok; }).length;
    pkt(w, pala.sid, 'skillRequest', { skill: 'carga', targetId: mago.p.playerId, mobId: 0 });
    assert.equal(denied(pala.log, 'carga'), 1, 'carga a nivel 1: rechazada');
    assert.ok(texts(pala.log).some((t) => t.includes('nivel 20')));
    pkt(w, mago.sid, 'blinkRequest', { x: mago.p.posX + 3, y: mago.p.posY });
    assert.equal(denied(mago.log, 'blink'), 1, 'blink a nivel 1: rechazado');
    pkt(w, mago.sid, 'skillRequest', { skill: 'carga', targetId: pala.p.playerId, mobId: 0 });
    assert.equal(denied(mago.log, 'carga'), 1, 'el mago no carga');
});

test('server: invisibilidad es del mago; el paladín no la puede pedir', () => {
    const { w, mago, pala } = setup();
    pkt(w, pala.sid, 'invisibilityRequest', {});
    assert.equal(pala.p.status.isInvisible, false);
    pkt(w, mago.sid, 'invisibilityRequest', {});
    assert.equal(mago.p.status.isInvisible, true);
});
