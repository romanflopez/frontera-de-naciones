/**
 * K8: habilidades de nivel 15 a 35 de los kits de Valdrys (ver el doc del proyecto kits-de-clase.md §2, versión 4: 15, 20, 25, 30 y 35).
 * Escudos (de maná, divino, guardián), Paso de luz, Aura de represalia, Clarividencia, Purga, bendiciones de grupo (poder, amparo,
 * intelecto y la Bendición de grupo del clérigo: Fortaleza + Espíritu divino), Esfera celestial y Despertar.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { kitLevel, relevel, canUseSkill, checkSkill, type WorldMap } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import { PartyService, setParties } from '../src/party.ts';
import type { PersistedPlayer, Player } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { MobSim, type MobHost } from '../src/mobs.ts';
import { BUFF, castMsOf, PvpLimiter, SHIELD_MS, SKILLS, healAmount, rollSpellDamage, statsFromChar, withBuffs } from '../src/systems/pvpCombat.ts';
import { REMOVER_CD_MS, absorbShield, applyShield, applySlow, createDefaultStatus, hasBuff, isSlowed, shieldOf } from '../src/systems/statusSystem.ts';

let clock = 80_000_000;
mock.method(Date, 'now', () => clock);

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const cases = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k);
const texts = (log: ServerMessage[]) => cases(log, 'sendMessage').map((m) => String((m.payload as { value: { message?: string } }).value.message ?? ''));
const denied = (log: ServerMessage[], skill: string) => cases(log, 'skillEffect').filter((m) => { const v = (m.payload as { value: { skill: string; ok: boolean } }).value; return v.skill === skill && !v.ok; }).length;
const lastVitals = (log: ServerMessage[]) => (cases(log, 'vitals').at(-1)!.payload as { value: { hp: number; shield: number } }).value;
const lastBuffs = (log: ServerMessage[]) => (cases(log, 'statusUpdate').at(-1)?.payload as { value: { buffs: string[] } } | undefined)?.value.buffs ?? [];
/** Sube de nivel en el server (el guardado validado manda: nivel y clase salen de ahí). */
const setLevel = (w: GameWorld, p: Player, lvl: number) => { p.econ!.lvl = lvl; (w as unknown as { restat(p: Player): void }).restat(p); p.mp = p.combat.maxMp; p.hp = p.combat.maxHp; };
type Priv = { damagePlayer(p: Player, raw: number, kind: 'phys' | 'magic', killer: Player | null, source?: string): number; regenMana(p: Player, now: number): void; mobSim?: unknown };
const priv = (w: GameWorld) => w as unknown as Priv;

function setup(instance = '') {
    clock += 1_000_000;
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('solmar_legacy', instance);
    const host = (priv(w).mobSim as { host: MobHost } | undefined)?.host;
    priv(w).mobSim = undefined;
    const join = (name: string, at: { x: number; y: number }, faction: string, cls: string, lvl = relevel(35)) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls, faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};${cls};` });
        const p = w.playerOf(sid)!;
        p.spawnProtection = false;
        setLevel(w, p, lvl);
        return { sid, log, p };
    };
    const mago = join('mago', { x: 30, y: 20 }, 'solmar', 'mago');
    const pala = join('pala', { x: 31, y: 21 }, 'solmar', 'pala');
    const clerigo = join('clerigo', { x: 32, y: 20 }, 'solmar', 'clerigo');
    const enemigo = join('enemigo', { x: 34, y: 20 }, 'vhar', 'pala');
    return { w, host, mago, pala, clerigo, enemigo, join };
}
const advance = (w: GameWorld, ms: number) => { for (let t = 0; t < ms; t += 100) { clock += 100; w.tick(); } };
const castFor = (w: GameWorld, sid: string, spell: string) => { pkt(w, sid, 'spellCastStartRequest', { spellId: 0, spell }); clock += castMsOf(spell); };
const skill = (w: GameWorld, sid: string, s: string, targetId = 0n, mobId = 0) => pkt(w, sid, 'skillRequest', { skill: s, targetId, mobId });

// ---------- la tabla ----------
test('K8: del 13 al 40 las habilidades salen en el 15, 20, 25, 30 y 35 (escape de todas en el 20)', () => {
    const table: [string, string, number][] = [
        ['mago', 'escudomana', 15], ['mago', 'blink', 20], ['mago', 'clarividencia', 25], ['mago', 'remover', 30], ['mago', 'intelecto', 35],
        ['pala', 'escudodivino', 15], ['pala', 'carga', 20], ['pala', 'represalia', 25], ['pala', 'grito', 30], ['pala', 'amparo', 35],
        ['clerigo', 'guardian', 15], ['clerigo', 'pasoluz', 20], ['clerigo', 'despertar', 25], ['clerigo', 'esfera', 30], ['clerigo', 'grupo', 35],
    ];
    for (const [cls, id, lvl] of table) {
        assert.equal(canUseSkill(cls, kitLevel(lvl), id), true, `${cls} ${id} a nivel ${lvl}`);
        assert.deepEqual(checkSkill(cls, kitLevel(lvl) - 1, id), { ok: false, reason: 'nivel', need: kitLevel(lvl) }, `${cls} ${id} antes del ${lvl}`);
        assert.equal(canUseSkill(cls, kitLevel(40), id), true, 'siguen al 40');
    }
    assert.equal(canUseSkill('mago', kitLevel(40), 'escudodivino'), false, 'cada escudo es de su clase');
    assert.equal(canUseSkill('pala', kitLevel(40), 'despertar'), false);
    assert.equal(SKILLS.escudomana.shield, 0.33); assert.equal(SKILLS.escudodivino.shield, 0.6); assert.equal(SKILLS.guardian.shield, 0.4);
    assert.equal(castMsOf('grito'), 1408); assert.equal(castMsOf('despertar'), 1408);
    assert.equal(SHIELD_MS, 10000);
});

test('K8: el servidor rechaza una habilidad de nivel 15 a un personaje de nivel 14', () => {
    const { w, mago } = setup();
    setLevel(w, mago.p, kitLevel(15) - 1);
    skill(w, mago.sid, 'escudomana');
    assert.equal(shieldOf(mago.p.status, clock), 0);
    assert.equal(denied(mago.log, 'escudomana'), 1);
    assert.ok(texts(mago.log).some((t) => t.includes(`nivel ${kitLevel(15)}`)));
});

// ---------- escudos ----------
test('escudos: se juntan con tope de una barra llena, absorben antes que la vida y duran 10 s', () => {
    const st = createDefaultStatus();
    assert.equal(applyShield(st, clock, 600, 1000, SHIELD_MS), 600);
    assert.equal(applyShield(st, clock, 600, 1000, SHIELD_MS), 1000, 'tope: la vida máxima');
    assert.equal(absorbShield(st, clock, 300), 0, 'se lo come entero');
    assert.equal(shieldOf(st, clock), 700);
    assert.equal(absorbShield(st, clock, 900), 200, 'lo que sobra pasa a la vida');
    assert.equal(shieldOf(st, clock), 0);
    applyShield(st, clock, 100, 1000, SHIELD_MS);
    assert.equal(shieldOf(st, clock + SHIELD_MS + 1), 0, 'vence a los 10 s');
});

test('Escudo de maná: 33 % de la vida del mago; el golpe se lo come y la vida queda igual; el escudo viaja en Vitals', () => {
    const { w, mago } = setup();
    const max = mago.p.combat.maxHp, mp = mago.p.mp;
    skill(w, mago.sid, 'escudomana');
    assert.equal(shieldOf(mago.p.status, clock), Math.round(max * 0.33));
    assert.equal(mago.p.mp, mp - SKILLS.escudomana.mp, 'cobra el maná');
    assert.equal(lastVitals(mago.log).shield, Math.round(max * 0.33));
    const hp = mago.p.hp;
    priv(w).damagePlayer(mago.p, 50, 'phys', null, 'Goblin');
    assert.equal(mago.p.hp, hp, 'la vida no se toca');
    assert.ok(shieldOf(mago.p.status, clock) < Math.round(max * 0.33));
    skill(w, mago.sid, 'escudomana');
    assert.equal(denied(mago.log, 'escudomana'), 1, 'recarga de 10 s');
    advance(w, SHIELD_MS + 200);
    assert.equal(shieldOf(mago.p.status, clock), 0);
    assert.equal(lastVitals(mago.log).shield, 0, 'al vencer se avisa');
});

test('Escudo divino (60 %) y Escudo guardián (40 % al aliado elegido); el guardián no se le pone a un enemigo', () => {
    const { w, pala, clerigo, enemigo } = setup();
    skill(w, pala.sid, 'escudodivino');
    assert.equal(shieldOf(pala.p.status, clock), Math.round(pala.p.combat.maxHp * 0.6));
    skill(w, clerigo.sid, 'guardian', enemigo.p.playerId);
    assert.equal(shieldOf(enemigo.p.status, clock), 0);
    assert.equal(denied(clerigo.log, 'guardian'), 1);
    skill(w, clerigo.sid, 'guardian', pala.p.playerId);
    assert.equal(shieldOf(pala.p.status, clock), pala.p.combat.maxHp, 'se suma al divino con tope de una barra');
    const v = cases(clerigo.log, 'playerVitals').map((m) => (m.payload as { value: { playerId: bigint; shield: number } }).value).filter((x) => x.playerId === pala.p.playerId).at(-1);
    assert.equal(v?.shield, pala.p.combat.maxHp, 'los cercanos ven el escudo en la barra');
});

test('escudo en PvP: absorbe después del multiplicador y del tope por golpe', () => {
    const { w, mago, enemigo } = setup();
    skill(w, mago.sid, 'escudomana');
    const sh = shieldOf(mago.p.status, clock), hp = mago.p.hp;
    const cap = Math.floor(mago.p.combat.maxHp * 0.25);
    assert.ok(sh > cap, 'el 33 % es más que el tope del 25 %');
    assert.equal(priv(w).damagePlayer(mago.p, 100000, 'phys', enemigo.p), 0, 'el escudo se come el golpe topeado entero');
    assert.equal(shieldOf(mago.p.status, clock), sh - cap);
    assert.equal(mago.p.hp, hp);
    const got = priv(w).damagePlayer(mago.p, 100000, 'phys', enemigo.p);
    assert.equal(shieldOf(mago.p.status, clock), 0);
    assert.equal(got, cap - (sh - cap), 'el segundo golpe rompe lo que queda y el resto pasa');
    assert.equal(mago.p.hp, hp - got);
});

// ---------- pala ----------
test('Aura de represalia: −20 % de daño recibido por 10 s', () => {
    const { w, pala } = setup();
    const base = (() => { const hp = pala.p.hp; priv(w).damagePlayer(pala.p, 400, 'magic', null, 'x'); const d = hp - pala.p.hp; pala.p.hp = pala.p.combat.maxHp; return d; })();
    skill(w, pala.sid, 'represalia');
    assert.ok(hasBuff(pala.p.status, 'represalia', clock));
    assert.ok(lastBuffs(pala.log).includes('represalia'), 'se anuncia');
    const hp = pala.p.hp; priv(w).damagePlayer(pala.p, 400, 'magic', null, 'x');
    assert.ok(Math.abs(hp - pala.p.hp - base * 0.8) <= 1, `${hp - pala.p.hp} vs ${base}`);
    advance(w, 10_200);
    assert.equal(hasBuff(pala.p.status, 'represalia', clock), false);
    assert.ok(!lastBuffs(pala.log).includes('represalia'), 'al vencer se anuncia');
});

test('Aura de represalia: devuelve ⅓ del golpe al monstruo que pegó (en el tick siguiente)', () => {
    const { w, host, pala } = setup();
    const hits: [number, number, string][] = [];
    priv(w).mobSim = { skillHit: (_p: Player, id: number, dmg: number, _s: number, sk: string) => hits.push([id, dmg, sk]), update() {}, healThreat() {}, near: () => [] };
    host!.hurt(pala.p, 90, 'Goblin', 'm5', 5);
    assert.equal(hits.length, 0, 'sin aura no devuelve');
    skill(w, pala.sid, 'represalia');
    host!.hurt(pala.p, 90, 'Goblin', 'm5', 5);
    assert.equal(hits.length, 0, 'todavía no: espera al tick');
    advance(w, 100);
    assert.deepEqual(hits, [[5, 30, 'represalia']]);
});

test('Bendición de poder (id grito): cast 0,8 s, +16 al Daño base a los aliados a 14 celdas, no al enemigo; dura 15 min fuera de la arena', () => {
    const { w, mago, pala, clerigo, enemigo } = setup();
    skill(w, pala.sid, 'grito');
    assert.equal(denied(pala.log, 'grito'), 1, 'sin cast no sale');
    castFor(w, pala.sid, 'grito'); skill(w, pala.sid, 'grito');
    for (const o of [pala, mago, clerigo]) { assert.ok(hasBuff(o.p.status, 'poder', clock), o.p.characterName); assert.equal(o.p.combat.dmgBonus, 16); }
    assert.equal(hasBuff(enemigo.p.status, 'poder', clock), false);
    const r = mock.method(Math, 'random', () => 0);
    try {
        const with_ = rollSpellDamage('golpe', pala.p.combat, false), without = rollSpellDamage('golpe', { ...pala.p.combat, dmgBonus: 0 }, false);
        assert.ok(with_ > without, `${with_} > ${without}`);
        assert.equal(rollSpellDamage('bola', mago.p.combat, false) - rollSpellDamage('bola', { ...mago.p.combat, dmgBonus: 0 }, false), Math.round(16 * 3 * mago.p.combat.magicMult), 'bola: ×3 del bonus');
    } finally { r.mock.restore(); }
    advance(w, 899_000);
    assert.ok(hasBuff(pala.p.status, 'poder', clock), 'a los 15 min menos 1 s todavía está');
    advance(w, 1_200);
    assert.equal(pala.p.combat.dmgBonus, 0, 'al vencer se recalculan los stats');
});

test('Bendición de amparo: −6 % de daño recibido', () => {
    const { w, pala, mago } = setup();
    const before = () => { mago.p.hp = mago.p.combat.maxHp; const hp = mago.p.hp; priv(w).damagePlayer(mago.p, 1000, 'magic', null, 'x'); return hp - mago.p.hp; };
    const base = before();
    castFor(w, pala.sid, 'amparo'); skill(w, pala.sid, 'amparo');
    assert.ok(hasBuff(mago.p.status, 'amparo', clock));
    const d = before();
    assert.ok(Math.abs(d - base * 0.94) <= 1, `${d} vs ${base}`);
});

// ---------- bendiciones de grupo: toda la party, 15 min afuera, cortas en la arena ----------
const ARENA_AT = { x: 50, y: 30 }; // dentro de `ffaRect` de solmar_legacy (46-60, 26-38)
function withParty(w: GameWorld, members: { sid: string; p: Player }[], fn: () => void) {
    const by = (n: string) => members.find((m) => m.p.characterName.toLowerCase() === n.toLowerCase());
    const svc = new PartyService({
        sessionByName: (n) => by(n)?.sid, send: () => {},
        info: (sid) => ({ name: members.find((m) => m.sid === sid)!.p.characterName, faction: 'solmar', level: 35, hp: 100, maxHp: 100, mp: 0, maxMp: 0, map: w.mapId, online: true }),
    });
    setParties(svc);
    try { for (const m of members.slice(1)) { svc.handle(members[0].sid, 'invite', m.p.characterName); svc.handle(m.sid, 'accept', ''); } fn(); } finally { setParties(undefined); }
}

test('Bendiciones de grupo: llegan a toda la party aunque esté lejos; a los de cerca sin party también; al enemigo y a los de lejos sin party no', () => {
    const { w, pala, mago, clerigo, enemigo, join } = setup();
    const lejos = join('lejos', { x: 30, y: 52 }, 'solmar', 'pala'), ajeno = join('ajeno', { x: 31, y: 52 }, 'solmar', 'mago');
    assert.ok(Math.hypot(lejos.p.posX - pala.p.posX, lejos.p.posY - pala.p.posY) > 14, 'el de la party está fuera de las 14 celdas');
    withParty(w, [pala, clerigo, lejos], () => {
        castFor(w, pala.sid, 'grito'); skill(w, pala.sid, 'grito');
        for (const o of [pala, clerigo, lejos]) assert.ok(hasBuff(o.p.status, 'poder', clock), `${o.p.characterName} (party)`);
        assert.equal(lejos.p.combat.dmgBonus, 16, 'se recalculan sus stats');
        assert.ok(hasBuff(mago.p.status, 'poder', clock), 'el de cerca sin party sigue recibiéndola (14 celdas)');
        assert.equal(hasBuff(ajeno.p.status, 'poder', clock), false, 'lejos y sin party: no');
        assert.equal(hasBuff(enemigo.p.status, 'poder', clock), false, 'el enemigo no');
        // las otras tres también
        castFor(w, clerigo.sid, 'grupo'); skill(w, clerigo.sid, 'grupo');
        assert.ok(hasBuff(lejos.p.status, 'fortaleza', clock) && hasBuff(lejos.p.status, 'espiritu', clock));
        castFor(w, pala.sid, 'amparo'); skill(w, pala.sid, 'amparo');
        assert.ok(hasBuff(lejos.p.status, 'amparo', clock));
        castFor(w, mago.sid, 'intelecto'); skill(w, mago.sid, 'intelecto');
        assert.ok(hasBuff(pala.p.status, 'intelecto', clock) && hasBuff(clerigo.p.status, 'intelecto', clock), 'el mago (sin party) llega a los de cerca');
        assert.equal(hasBuff(lejos.p.status, 'intelecto', clock), false, 'pero el lejano no está en SU party');
    });
});

test('Bendiciones de grupo: se renuevan sin apilarse (la nueva pisa la duración de 15 min)', () => {
    const { w, pala } = setup();
    castFor(w, pala.sid, 'grito'); skill(w, pala.sid, 'grito');
    advance(w, 600_000);
    clock += 11_000; castFor(w, pala.sid, 'grito'); skill(w, pala.sid, 'grito');
    advance(w, 899_000);
    assert.ok(hasBuff(pala.p.status, 'poder', clock), 'a los 15 min de la segunda tirada sigue');
    assert.equal(pala.p.combat.dmgBonus, 16, 'una sola vez +16');
    advance(w, 2_000);
    assert.equal(hasBuff(pala.p.status, 'poder', clock), false);
});

test('Bendiciones de grupo: dentro de la arena duran lo de Valdrys (60 y 90 s)', () => {
    const { w, pala, clerigo } = setup();
    pala.p.setPosition(ARENA_AT.x, ARENA_AT.y); advance(w, 100);
    castFor(w, pala.sid, 'grito'); skill(w, pala.sid, 'grito');
    assert.ok(hasBuff(pala.p.status, 'poder', clock));
    advance(w, 59_000); assert.ok(hasBuff(pala.p.status, 'poder', clock), 'a los 59 s sigue');
    advance(w, 1_200); assert.equal(hasBuff(pala.p.status, 'poder', clock), false, 'a los 60 s se fue');
    clerigo.p.setPosition(ARENA_AT.x + 2, ARENA_AT.y); advance(w, 100);
    castFor(w, clerigo.sid, 'grupo'); skill(w, clerigo.sid, 'grupo');
    advance(w, 89_000); assert.ok(hasBuff(clerigo.p.status, 'fortaleza', clock));
    advance(w, 1_200); assert.equal(hasBuff(clerigo.p.status, 'fortaleza', clock), false, 'Bendición de grupo: 90 s adentro');
});

test('Bendiciones de grupo: se sacan al entrar a la arena y no vuelven al salir; las auras de 10 s y los escudos no se tocan', () => {
    const { w, pala } = setup();
    const refill = () => { pala.p.mp = pala.p.combat.maxMp; };
    castFor(w, pala.sid, 'grito'); skill(w, pala.sid, 'grito'); refill(); castFor(w, pala.sid, 'amparo'); skill(w, pala.sid, 'amparo');
    refill(); skill(w, pala.sid, 'represalia'); refill(); skill(w, pala.sid, 'escudodivino');
    assert.ok(hasBuff(pala.p.status, 'poder', clock) && hasBuff(pala.p.status, 'amparo', clock));
    pala.p.setPosition(ARENA_AT.x, ARENA_AT.y); advance(w, 100);
    assert.equal(hasBuff(pala.p.status, 'poder', clock), false, 'poder fuera');
    assert.equal(hasBuff(pala.p.status, 'amparo', clock), false, 'amparo fuera');
    assert.equal(pala.p.combat.dmgBonus, 0, 'y los stats se recalculan');
    assert.ok(hasBuff(pala.p.status, 'represalia', clock), 'el aura de 10 s sigue');
    assert.ok(shieldOf(pala.p.status, clock) > 0, 'el escudo sigue');
    assert.ok(!lastBuffs(pala.log).includes('poder'), 'se anuncia');
    pala.p.setPosition(30, 21); advance(w, 100);
    assert.equal(hasBuff(pala.p.status, 'poder', clock), false, 'al salir no vuelve sola');
});

// ---------- mago ----------
test('Clarividencia: 25 % de crítico en los hechizos contra monstruos (×1,8); sin ella los hechizos no critican', () => {
    const N = 40, sent: ServerMessage[] = [];
    const combat = statsFromChar({ lvl: 20, cls: 'mago', eq: {} });
    const p = { playerId: 7n, posX: 14, posY: 20, disconnected: false, isDead: false, status: createDefaultStatus(), combat, pvp: new PvpLimiter(), send: (m: ServerMessage) => sent.push(m) } as unknown as Player;
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type: 'goblin', x: 10, y: 20, r: 0, n: 1, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = { players: () => [p], playerById: () => p, nearby: () => [p], after: () => {}, hurt: () => {}, stun: () => 0, pay: () => true, heal: () => {}, reward: () => {} };
    const sim = new MobSim(map, host);
    const m = [...(sim as unknown as { mobs: Map<number, { id: number; hp: number; hpMax: number; traits: number }> }).mobs.values()][0];
    m.traits = 0; m.hp = m.hpMax = 1e6;
    const crits = () => sent.filter((x) => x.payload?.$case === 'mobDamaged').map((x) => (x.payload as { value: { crit: boolean } }).value.crit);
    const r = mock.method(Math, 'random', () => 0);
    try {
        sim.hit(p, { mobId: m.id, dmg: 0, melee: false, crit: false, parSecs: 0, poisonSecs: 0, spell: 'proyectil' });
        p.status.buffs.clarividencia = clock + 10_000;
        clock += 2000;
        sim.hit(p, { mobId: m.id, dmg: 0, melee: false, crit: false, parSecs: 0, poisonSecs: 0, spell: 'proyectil' });
    } finally { r.mock.restore(); }
    assert.deepEqual(crits(), [false, true]);
    assert.equal(BUFF.clarividenciaCrit, 25);
});

test('Clarividencia: el mago se la pone a sí mismo por 10 s, recarga 30 s', () => {
    const { w, mago } = setup();
    skill(w, mago.sid, 'clarividencia');
    assert.ok(hasBuff(mago.p.status, 'clarividencia', clock));
    clock += 11_000; skill(w, mago.sid, 'clarividencia');
    assert.equal(denied(mago.log, 'clarividencia'), 1);
});

test('Intelecto arcano: +8 de Magia de equipo 15 min a los aliados (más Daño mágico y más poder de curación)', () => {
    const { w, mago, clerigo } = setup();
    const mag0 = clerigo.p.combat.mag;
    castFor(w, mago.sid, 'intelecto'); skill(w, mago.sid, 'intelecto');
    assert.equal(clerigo.p.combat.mag, mag0 + 8);
    assert.equal(mago.p.combat.mag, statsFromChar(mago.p.econ!).mag + 8);
    assert.ok(healAmount(0.4, clerigo.p.combat, 1000) > healAmount(0.4, { ...clerigo.p.combat, mag: mag0 }, 1000));
    advance(w, 899_000);
    assert.equal(clerigo.p.combat.mag, mag0 + 8, 'a los 15 min menos 1 s sigue');
    advance(w, 1_200);
    assert.equal(clerigo.p.combat.mag, mag0);
});

test('Purga (remover): saca el frenado y el congelado, recarga 24 s', () => {
    const { w, mago } = setup();
    applySlow(mago.p.status, clock, 3000);
    assert.ok(isSlowed(mago.p.status, clock));
    pkt(w, mago.sid, 'removerRequest', {});
    assert.equal(isSlowed(mago.p.status, clock), false);
    assert.equal(REMOVER_CD_MS, 24000);
    clock += 10_000; applySlow(mago.p.status, clock, 3000);
    pkt(w, mago.sid, 'removerRequest', {});
    assert.ok(isSlowed(mago.p.status, clock), 'en recarga no sale');
});

// ---------- clerigo ----------
test('Bendición de grupo (Fortaleza): +6 % de vida máxima, 15 min; al vencer la vida se recorta al máximo', () => {
    const { w, clerigo, pala } = setup();
    const max0 = pala.p.combat.maxHp;
    castFor(w, clerigo.sid, 'grupo'); skill(w, clerigo.sid, 'grupo');
    assert.ok(hasBuff(pala.p.status, 'fortaleza', clock) && hasBuff(pala.p.status, 'espiritu', clock), 'las dos a la vez');
    assert.deepEqual(lastBuffs(pala.log).sort(), ['espiritu', 'fortaleza']);
    assert.equal(pala.p.combat.maxHp, Math.round(max0 * 1.06));
    pala.p.hp = pala.p.combat.maxHp;
    advance(w, 900_200);
    assert.equal(pala.p.combat.maxHp, max0);
    assert.ok(pala.p.hp <= max0);
});

test('Bendición de grupo (Espíritu divino): +50 % de regeneración de maná, 15 min fuera de la arena', () => {
    const { w, clerigo, mago } = setup();
    const regen = () => { mago.p.mp = 0; mago.p.nextMpRegenAt = 0; priv(w).regenMana(mago.p, clock); return mago.p.mp; };
    const base = regen();
    castFor(w, clerigo.sid, 'grupo'); skill(w, clerigo.sid, 'grupo');
    assert.ok(hasBuff(mago.p.status, 'espiritu', clock));
    assert.equal(regen(), Math.round(base * 1.5));
    advance(w, 899_000); assert.ok(hasBuff(mago.p.status, 'espiritu', clock), 'dura 15 min');
    advance(w, 1_200); assert.equal(hasBuff(mago.p.status, 'espiritu', clock), false);
});

test('Paso de luz (clerigo, nivel 20): hasta 6 celdas, se saca el frenado, recarga 15 s; el mago no lo tiene', () => {
    const { w, clerigo, mago } = setup();
    applySlow(clerigo.p.status, clock, 3000);
    const x0 = clerigo.p.posX, y0 = clerigo.p.posY;
    pkt(w, clerigo.sid, 'blinkRequest', { x: x0, y: y0 + 7, skill: 'pasoluz' });
    assert.equal(clerigo.p.posY, y0, '7 celdas: muy lejos');
    // una celda libre a 5 de distancia (el mapa tiene casas y árboles)
    for (const [dx, dy] of [[0, 5], [0, -5], [5, 0], [-5, 0], [3, 4], [-3, 4], [3, -4], [-3, -4], [4, 3], [-4, 3], [4, -3], [-4, -3]]) {
        pkt(w, clerigo.sid, 'blinkRequest', { x: x0 + dx, y: y0 + dy, skill: 'pasoluz' });
        if (clerigo.p.posX !== x0 || clerigo.p.posY !== y0) break;
    }
    const x1 = clerigo.p.posX, y1 = clerigo.p.posY;
    assert.equal(Math.hypot(x1 - x0, y1 - y0), 5, 'se movió 5 celdas');
    assert.equal(isSlowed(clerigo.p.status, clock), false, 'se saca el frenado');
    clock += 5000; pkt(w, clerigo.sid, 'blinkRequest', { x: x0, y: y0, skill: 'pasoluz' });
    assert.deepEqual([clerigo.p.posX, clerigo.p.posY], [x1, y1], 'en recarga');
    const my = mago.p.posY;
    pkt(w, mago.sid, 'blinkRequest', { x: mago.p.posX, y: my + 3, skill: 'pasoluz' });
    assert.equal(mago.p.posY, my, 'no es del mago');
    pkt(w, mago.sid, 'blinkRequest', { x: mago.p.posX, y: my + 3 });
    assert.equal(mago.p.posY, my + 3, 'sin skill sigue siendo el Blink');
    setLevel(w, clerigo.p, kitLevel(20) - 1); clock += 20_000;
    pkt(w, clerigo.sid, 'blinkRequest', { x: x0, y: y0, skill: 'pasoluz' });
    assert.deepEqual([clerigo.p.posX, clerigo.p.posY], [x1, y1], 'antes del 20 no');
    setLevel(w, clerigo.p, kitLevel(20));
    pkt(w, clerigo.sid, 'blinkRequest', { x: x0, y: y0, skill: 'pasoluz' });
    assert.deepEqual([clerigo.p.posX, clerigo.p.posY], [x0, y0], 'en el 20 sí');
});

test('Esfera celestial: 8 curas del 13 % que saltan al aliado más herido a ≤ 6 celdas', () => {
    const { w, clerigo, pala, mago } = setup();
    pala.p.hp = 10; mago.p.hp = 10; clerigo.p.hp = 10;
    const per = (o: Player) => healAmount(0.13, clerigo.p.combat, o.combat.maxHp);
    skill(w, clerigo.sid, 'esfera', pala.p.playerId);
    const got = pala.p.hp - 10 + mago.p.hp - 10 + clerigo.p.hp - 10;
    // los tres empiezan en 10: la esfera reparte entre los tres, y la suma son 8 curas
    const min = 8 * Math.min(per(pala.p), per(mago.p), per(clerigo.p)), max = 8 * Math.max(per(pala.p), per(mago.p), per(clerigo.p));
    assert.ok(got >= min && got <= max, `${got} entre ${min} y ${max}`);
    assert.ok(pala.p.hp > 10 && mago.p.hp > 10 && clerigo.p.hp > 10, 'llega a todos');
});

test('Esfera celestial: sola con un aliado lejos, cura una vez', () => {
    const { w, clerigo, join } = setup();
    const lejos = join('lejos', { x: 40, y: 20 }, 'solmar', 'pala');
    lejos.p.hp = 10; clerigo.p.hp = clerigo.p.combat.maxHp;
    skill(w, clerigo.sid, 'esfera', lejos.p.playerId);
    assert.equal(lejos.p.hp, 10 + healAmount(0.13, clerigo.p.combat, lejos.p.combat.maxHp));
});

test('Despertar: cast 2,4 s, revive al aliado caído con 50 % de vida; no a un vivo ni a un enemigo', () => {
    const { w, clerigo, pala, enemigo } = setup();
    priv(w).damagePlayer(pala.p, 1e7, 'magic', null, 'x');
    assert.ok(pala.p.isDead);
    skill(w, clerigo.sid, 'despertar', pala.p.playerId);
    assert.equal(denied(clerigo.log, 'despertar'), 1, 'sin cast no sale');
    clock += 30_000; // en el mundo abierto no hay límite de tiempo (mientras no haya reaparecido)
    castFor(w, clerigo.sid, 'despertar'); skill(w, clerigo.sid, 'despertar', enemigo.p.playerId);
    assert.equal(denied(clerigo.log, 'despertar'), 2, 'a un enemigo (vivo) no');
    castFor(w, clerigo.sid, 'despertar'); skill(w, clerigo.sid, 'despertar', pala.p.playerId);
    assert.equal(pala.p.isDead, false);
    assert.equal(pala.p.hp, Math.round(pala.p.combat.maxHp * 0.5));
    assert.ok(texts(pala.log).some((t) => t.includes('te despertó')));
    pkt(w, pala.sid, 'respawnRequest', {});
    assert.equal(pala.p.hp, Math.round(pala.p.combat.maxHp * 0.5), 'un pedido de reaparecer que llega tarde no hace nada');
});

test('Despertar: en una mazmorra (instancia) solo dentro de los 10 s de la caída', () => {
    const { w, clerigo, pala, mago } = setup('prueba-k8');
    priv(w).damagePlayer(pala.p, 1e7, 'magic', null, 'x');
    clock += 11_000;
    castFor(w, clerigo.sid, 'despertar'); skill(w, clerigo.sid, 'despertar', pala.p.playerId);
    assert.ok(pala.p.isDead);
    assert.ok(texts(clerigo.log).some((t) => t.includes('10 s')));
    priv(w).damagePlayer(mago.p, 1e7, 'magic', null, 'x');
    clock += 21_000; clerigo.p.mp = clerigo.p.combat.maxHp;
    priv(w).damagePlayer(mago.p, 0, 'magic', null, 'x');
    mago.p.deadAt = clock - 5000;
    castFor(w, clerigo.sid, 'despertar'); skill(w, clerigo.sid, 'despertar', mago.p.playerId);
    assert.equal(mago.p.isDead, false, 'a los 5 s sí');
});

test('al morir se pierden escudos y bendiciones (y los stats vuelven)', () => {
    const { w, pala, clerigo } = setup();
    skill(w, pala.sid, 'escudodivino');
    castFor(w, clerigo.sid, 'grupo'); skill(w, clerigo.sid, 'grupo');
    const max0 = withBuffs(statsFromChar(pala.p.econ!), createDefaultStatus(), clock).maxHp;
    priv(w).damagePlayer(pala.p, 1e7, 'magic', null, 'x');
    assert.ok(pala.p.isDead);
    assert.equal(shieldOf(pala.p.status, clock), 0);
    assert.equal(hasBuff(pala.p.status, 'fortaleza', clock), false);
    assert.equal(pala.p.combat.maxHp, max0);
});
