/**
 * K5: la clase clerigo (el clérigo sagrado de Valdrys) en el server. Ver el doc del proyecto kits-de-clase.md §2.3.
 * Castigo, Curación, Renovar, Bendición sagrada, Nova sagrada, Reprender y Orbe sagrado (hasta nivel 12).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { kitLevel, CLASS_IDS, canUseSkill, checkSkill, meleeIntervalSecs, type WorldMap } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy, newEcon } from '../src/economy.ts';
import { sanitizeCharacter } from '../src/accounts.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer, Player } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { MobSim, type MobHost } from '../src/mobs.ts';
import { POISON_HEAL_TAKEN, BLESS_DMG_TAKEN, castMsOf, HEAL_THREAT, PVP_SPELLS, PvpLimiter, SKILLS, healAmount, healPower, skillMpCost, PVP_HEAL_MP_MULT, statsFromChar } from '../src/systems/pvpCombat.ts';
import { applyParalysis, applyPoison, isBlessed } from '../src/systems/statusSystem.ts';

let clock = 50_000_000;
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
const setLevel = (p: Player, lvl: number) => { p.combat = { ...p.combat, lvl: kitLevel(lvl) }; }; // los niveles de los tests están en la escala vieja del kit

function setup() {
    clock += 1_000_000;
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
        p.spawnProtection = false; p.mp = p.combat.maxMp;
        return { sid, log, p };
    };
    const clerigo = join('clerigo', { x: 30, y: 20 }, 'solmar', 'clerigo');
    const aliado = join('aliado', { x: 32, y: 20 }, 'solmar', 'pala');
    const enemigo = join('enemigo', { x: 34, y: 20 }, 'vhar', 'mago');
    return { w, clerigo, aliado, enemigo };
}
/** Avanza el reloj y corre el mundo (temporizadores de curas en el tiempo, vencimiento de estados). */
const advance = (w: GameWorld, ms: number) => { for (let t = 0; t < ms; t += 100) { clock += 100; w.tick(); } };
/** Castea en el server: empieza, espera el tiempo del hechizo y vuelve. */
const castFor = (w: GameWorld, sid: string, spell: string) => { pkt(w, sid, 'spellCastStartRequest', { spellId: 0, spell }); clock += castMsOf(spell); };
const skill = (w: GameWorld, sid: string, s: string, targetId = 0n, mobId = 0) => pkt(w, sid, 'skillRequest', { skill: s, targetId, mobId });

// ---------- la clase ----------
test('K5: el clérigo es una clase jugable con su kit por nivel', () => {
    assert.deepEqual([...CLASS_IDS], ['pala', 'mago', 'clerigo', 'arquero']);
    for (const [id, lvl] of [['castigo', 1], ['curacion', 1], ['renovar', 3], ['bendicion', 5], ['novasagrada', 7], ['reprender', 9], ['orbe', 12]] as const) {
        assert.equal(canUseSkill('clerigo', kitLevel(lvl), id), true, `${id} a nivel ${lvl}`);
        if (lvl > 1) assert.deepEqual(checkSkill('clerigo', kitLevel(lvl) - 1, id), { ok: false, reason: 'nivel', need: kitLevel(lvl) });
    }
    assert.equal(canUseSkill('clerigo', kitLevel(40), 'bola'), false, 'no tira bolas de fuego');
    assert.equal(canUseSkill('mago', kitLevel(40), 'curacion'), false, 'el mago ya no cura aliados');
    assert.equal(canUseSkill('pala', kitLevel(40), 'bendicion'), false);
});

test('K5: la vida del clérigo queda entre la del pala y la del mago; maná: el mago tiene más (etapa 6b, como en Dreadmyst) y el clérigo más que el pala; el personaje nuevo se crea con bastón', () => {
    const h = statsFromChar({ lvl: 10, cls: 'clerigo', eq: {} }), m = statsFromChar({ lvl: 10, cls: 'mago', eq: {} }), g = statsFromChar({ lvl: 10, cls: 'pala', eq: {} });
    assert.equal(h.cls, 'clerigo');
    assert.ok(h.maxHp > m.maxHp && h.maxHp < g.maxHp, `vida ${h.maxHp}`);
    assert.ok(m.maxMp > h.maxMp && h.maxMp > g.maxMp, `maná: mago ${m.maxMp}, clerigo ${h.maxMp}, pala ${g.maxMp}`);
    const st = newEcon('clerigo', 'vhar');
    assert.equal(st.cls, 'clerigo');
    assert.equal(st.eq.arma?.n, 'Báculo de fresno');
    const saved = sanitizeCharacter(JSON.stringify({ cls: 'clerigo', faction: 'solmar' }));
    assert.ok(saved && JSON.parse(saved).cls === 'clerigo', 'el guardado del cliente acepta la clase');
});

test('K5: tabla de habilidades (Valdrys, con el maná escalado al pool de ERIS)', () => {
    for (const id of ['castigo', 'curacion', 'orbe']) assert.equal(castMsOf(id), 1408, 'casteo único para todos');
    assert.equal(PVP_SPELLS.castigo.mp, 18); assert.equal(PVP_SPELLS.castigo.refund, 9); assert.equal(PVP_SPELLS.castigo.lifesteal, 0.35);
    assert.equal(PVP_SPELLS.reprender.secs, 3); assert.equal(PVP_SPELLS.reprender.cast, false);
    assert.equal(SKILLS.curacion.heal, 0.4); assert.equal(SKILLS.orbe.heal, 0.2); assert.equal(SKILLS.orbe.aoe, 4);
    assert.equal(SKILLS.bendicion.bless, 10); assert.equal(SKILLS.novasagrada.aoe, 4.5);
    const s = statsFromChar({ lvl: 10, cls: 'clerigo', eq: {} });
    assert.equal(healAmount(0.4, s, 1000), Math.round(400 + healPower(s) * 0.4));
});

// ---------- Curación ----------
test('Curación: castea 1,4 s y cura al aliado el 40 % de su vida; sin el cast terminado no cura', () => {
    const { w, clerigo, aliado } = setup();
    aliado.p.hp = 100;
    skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100, 'sin cast no hay cura');
    assert.equal(denied(clerigo.log, 'curacion'), 1);
    pkt(w, clerigo.sid, 'spellCastStartRequest', { spellId: 0, spell: 'curacion' }); clock += 700;
    skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100, 'cast a medias: no cura');
    clock += 800;
    const mp = clerigo.p.mp;
    skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100 + healAmount(0.4, clerigo.p.combat, aliado.p.combat.maxHp));
    assert.equal(clerigo.p.mp, mp - SKILLS.curacion.mp, 'cobra el maná');
});

test('Curación: no pasa la vida máxima, respeta la recarga y el maná, y no cura a otra nación', () => {
    const { w, clerigo, aliado, enemigo } = setup();
    aliado.p.hp = aliado.p.combat.maxHp - 5;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, aliado.p.combat.maxHp, 'tope en la vida máxima');
    aliado.p.hp = 100;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100, 'recarga de 5 s');
    clock += 5000; clerigo.p.mp = 10;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100, 'sin maná');
    clerigo.p.mp = clerigo.p.combat.maxMp; enemigo.p.hp = 100;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', enemigo.p.playerId);
    assert.equal(enemigo.p.hp, 100, 'otra nación: no');
    assert.ok(texts(clerigo.log).some((t) => t.includes('tu nación')));
});

test('Curación: sin objetivo se cura a sí mismo; muy lejos no llega', () => {
    const { w, clerigo, aliado } = setup();
    clerigo.p.hp = 50;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', 0n);
    assert.ok(clerigo.p.hp > 50, 'se curó');
    clock += 6000; aliado.p.hp = 100; aliado.p.setPosition(clerigo.p.posX + 30, clerigo.p.posY);
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100);
});

// ---------- Renovar ----------
test('Renovar: cura al aliado 12 % en 12 s (4 pulsos de 3 s) y no se reaplica hasta que termina', () => {
    const { w, clerigo, aliado } = setup();
    setLevel(clerigo.p, 3); aliado.p.hp = 100;
    const per = healAmount(SKILLS.renovar.hot!.frac, clerigo.p.combat, aliado.p.combat.maxHp);
    skill(w, clerigo.sid, 'renovar', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100, 'instantáneo, pero cura en el tiempo');
    advance(w, 6050);
    assert.equal(aliado.p.hp, 100 + 2 * per, 'dos pulsos en 6 s');
    const mp = clerigo.p.mp;
    skill(w, clerigo.sid, 'renovar', aliado.p.playerId); // recarga cumplida, pero todavía tiene Renovar
    assert.equal(clerigo.p.mp, mp, 'rechazado: no cobra maná');
    advance(w, 6100);
    assert.equal(aliado.p.hp, 100 + 4 * per, 'el primero dio sus 4 pulsos');
    skill(w, clerigo.sid, 'renovar', aliado.p.playerId);
    assert.ok(clerigo.p.mp < mp, 'terminado: se puede volver a poner');
});

test('Curas en PvP: cuestan ×2,5 de maná mientras el clérigo está en combate contra jugadores', () => {
    const { w, clerigo, aliado } = setup();
    setLevel(clerigo.p, 3);
    clerigo.p.mp = clerigo.p.combat.maxMp; let mp = clerigo.p.mp;
    skill(w, clerigo.sid, 'renovar', aliado.p.playerId);
    assert.equal(mp - clerigo.p.mp, SKILLS.renovar.mp, 'en PvE, el costo de la tabla');
    advance(w, 12100);
    clerigo.p.pvpCombatUntil = Date.now() + 10_000; clerigo.p.mp = clerigo.p.combat.maxMp; mp = clerigo.p.mp;
    skill(w, clerigo.sid, 'renovar', aliado.p.playerId);
    assert.equal(mp - clerigo.p.mp, skillMpCost('renovar', true));
    assert.equal(skillMpCost('renovar', true), Math.round(SKILLS.renovar.mp * PVP_HEAL_MP_MULT));
    assert.equal(skillMpCost('castigo', true), SKILLS.castigo?.mp ?? 0, 'lo que no cura no cambia');
});

test('Renovar sobre un enemigo: quemadura en vez de cura', () => {
    const { w, clerigo, enemigo } = setup();
    setLevel(clerigo.p, 3);
    const hp = enemigo.p.hp;
    skill(w, clerigo.sid, 'renovar', enemigo.p.playerId);
    advance(w, 3100);
    assert.ok(enemigo.p.hp < hp, 'se quemó');
});

// ---------- Bendición sagrada ----------
test('Bendición sagrada: inmune a congelado y aturdido, −20 % de daño y +30 % de curación durante 10 s', () => {
    const { w, clerigo, aliado } = setup();
    setLevel(clerigo.p, 5);
    applyParalysis(aliado.p.status, Date.now(), 3000, 'aturdir');
    assert.ok(aliado.p.isParalyzed(Date.now()));
    skill(w, clerigo.sid, 'bendicion', aliado.p.playerId);
    assert.ok(isBlessed(aliado.p.status, Date.now()));
    assert.equal(aliado.p.isParalyzed(Date.now()), false, 'la Bendición corta el aturdido');
    assert.equal(applyParalysis(aliado.p.status, Date.now(), 3000, 'paralisis'), 0, 'inmune al congelado');
    const st = cases(aliado.log, 'statusUpdate').map((m) => (m.payload as { value: { blessed: boolean } }).value.blessed);
    assert.ok(st.includes(true), 'el cliente se entera');
    // daño: el mismo golpe crudo pega un 20 % menos (antes de la defensa)
    const dmg = (w as unknown as { damagePlayer: (p: Player, raw: number, k: string, by: null) => number }).damagePlayer.bind(w);
    const blessed = dmg(aliado.p, 500, 'phys', null);
    aliado.p.status.blessEndTime = 0; aliado.p.hp = aliado.p.combat.maxHp;
    const plain = dmg(aliado.p, 500, 'phys', null);
    assert.ok(Math.abs(blessed - plain * BLESS_DMG_TAKEN) <= 1, `${blessed} vs ${plain}`);
    advance(w, 100);
    assert.ok(cases(aliado.log, 'statusUpdate').length > 0);
});

test('Bendición sagrada: la curación recibida sube un 30 % y vence a los 10 s', () => {
    const { w, clerigo, aliado } = setup();
    setLevel(clerigo.p, 5);
    skill(w, clerigo.sid, 'bendicion', aliado.p.playerId);
    aliado.p.hp = 100;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    const base = healAmount(0.4, clerigo.p.combat, aliado.p.combat.maxHp);
    assert.equal(aliado.p.hp, Math.min(aliado.p.combat.maxHp, 100 + Math.round(base * 1.3)));
    advance(w, 10_100);
    assert.equal(isBlessed(aliado.p.status, Date.now()), false);
    const last = cases(aliado.log, 'statusUpdate').at(-1)!;
    assert.equal((last.payload as { value: { blessed: boolean } }).value.blessed, false, 'se avisa que venció');
});

test('veneno sobre un jugador: la curación que recibe baja un 30 % y el cliente se entera', () => {
    const { w, clerigo, aliado } = setup();
    applyPoison(aliado.p.status, Date.now(), 4000); advance(w, 100);
    const st = cases(aliado.log, 'statusUpdate').map((m) => (m.payload as { value: { poisoned: boolean } }).value.poisoned);
    assert.ok(st.includes(true), 'aviso de envenenado');
    aliado.p.hp = 100;
    castFor(w, clerigo.sid, 'curacion'); skill(w, clerigo.sid, 'curacion', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100 + Math.round(healAmount(0.4, clerigo.p.combat, aliado.p.combat.maxHp) * POISON_HEAL_TAKEN));
    advance(w, 4000);
    const last = cases(aliado.log, 'statusUpdate').at(-1)!;
    assert.equal((last.payload as { value: { poisoned: boolean } }).value.poisoned, false, 'se avisa que pasó');
});

test('veneno: un golpe físico con chance de veneno del equipo envenena a un jugador enemigo', () => {
    const { w, clerigo, enemigo } = setup();
    const pala = clerigo; // cualquiera sirve para el golpe básico
    pala.p.combat = { ...pala.p.combat, poison: 100 };
    enemigo.p.setPosition(pala.p.posX + 1, pala.p.posY);
    pkt(w, pala.sid, 'pvpHitRequest', { fx: '', x: enemigo.p.posX, y: enemigo.p.posY, targetId: enemigo.p.playerId, dmg: 0, secs: 0, r: 0, spell: 'ataque' });
    assert.ok(enemigo.p.hp < enemigo.p.combat.maxHp, 'pegó');
    assert.ok(enemigo.p.status.poisonEndTime > Date.now(), 'quedó envenenado');
});

// ---------- Nova sagrada, Reprender, Castigo ----------
test('Nova sagrada: daña a los enemigos cerca y se cura el 12 % de lo que hizo; a nivel 6 no sale', () => {
    const { w, clerigo, aliado, enemigo } = setup();
    enemigo.p.setPosition(clerigo.p.posX + 2, clerigo.p.posY);
    skill(w, clerigo.sid, 'novasagrada');
    assert.equal(enemigo.p.hp, enemigo.p.combat.maxHp, 'nivel 1: no');
    setLevel(clerigo.p, 7); clerigo.p.hp = 100;
    const aHp = aliado.p.hp;
    skill(w, clerigo.sid, 'novasagrada');
    const dealt = enemigo.p.combat.maxHp - enemigo.p.hp;
    assert.ok(dealt > 0, 'pegó al enemigo');
    assert.equal(aliado.p.hp, aHp, 'al aliado no le pega');
    assert.equal(clerigo.p.hp, 100 + Math.round(dealt * SKILLS.novasagrada.selfHeal!), 'se curó el 12 %');
});

test('Reprender: instantáneo, aturde 3 s a un jugador enemigo (nivel 9)', () => {
    const { w, clerigo, enemigo } = setup();
    setLevel(clerigo.p, 9);
    pkt(w, clerigo.sid, 'pvpHitRequest', { fx: '', x: enemigo.p.posX, y: enemigo.p.posY, targetId: enemigo.p.playerId, dmg: 0, secs: 3, r: 0, spell: 'reprender' });
    assert.ok(enemigo.p.hp < enemigo.p.combat.maxHp, 'pegó');
    assert.ok(enemigo.p.isParalyzed(Date.now()), 'aturdido');
    assert.ok(enemigo.p.status.dr.aturdir, 'cuenta como aturdido para el rendimiento decreciente');
});

test('Castigo: castea 1 s, pega, devuelve 9 de maná y se cura el 35 % del daño', () => {
    const { w, clerigo, enemigo } = setup();
    clerigo.p.hp = 100;
    const mp = clerigo.p.mp;
    castFor(w, clerigo.sid, 'castigo');
    pkt(w, clerigo.sid, 'pvpHitRequest', { fx: '', x: enemigo.p.posX, y: enemigo.p.posY, targetId: enemigo.p.playerId, dmg: 0, secs: 0, r: 0, spell: 'castigo' });
    const dealt = enemigo.p.combat.maxHp - enemigo.p.hp;
    assert.ok(dealt > 0);
    assert.equal(clerigo.p.mp, mp - 18 + 9, 'neto: 9 de maná');
    assert.equal(clerigo.p.hp, 100 + Math.round(dealt * 0.35));
});

test('Orbe sagrado: cura al objetivo y a los aliados a 4 celdas de él, no a los enemigos (nivel 12)', () => {
    const { w, clerigo, aliado, enemigo } = setup();
    setLevel(clerigo.p, 12);
    clerigo.p.hp = 100; aliado.p.hp = 100; enemigo.p.hp = 100;
    enemigo.p.setPosition(aliado.p.posX + 1, aliado.p.posY);
    castFor(w, clerigo.sid, 'orbe'); skill(w, clerigo.sid, 'orbe', aliado.p.playerId);
    assert.equal(aliado.p.hp, 100 + healAmount(0.2, clerigo.p.combat, aliado.p.combat.maxHp));
    assert.ok(clerigo.p.hp > 100, 'el clérigo está a 2 celdas del objetivo: también se cura');
    assert.equal(enemigo.p.hp, 100, 'el enemigo no');
});

test('server: un mago que pide una cura no cura', () => {
    const { w, aliado } = setup();
    const mago = w.playerOf('s-enemigo')!; // mago de Vhar
    pkt(w, 's-enemigo', 'skillRequest', { skill: 'curacion', targetId: 0n, mobId: 0 });
    mago.hp = 10;
    pkt(w, 's-enemigo', 'skillRequest', { skill: 'curacion', targetId: 0n, mobId: 0 });
    assert.equal(mago.hp, 10);
    assert.ok(aliado.p.hp > 0);
});

// ---------- monstruos: amenaza por curar y Castigo ----------
function mobSetup() {
    clock += 100_000;
    const N = 40, players: Player[] = [], refunds: number[] = [];
    const mk = (id: bigint, cls: string, x: number) => {
        const p = { playerId: id, posX: x, posY: 20, disconnected: false, isDead: false, status: { isInvisible: false }, combat: statsFromChar({ lvl: 12, cls, eq: {} }), pvp: new PvpLimiter(), send: () => {} } as unknown as Player;
        p.pvp.meleeGapMs = meleeIntervalSecs(0) * 1000; players.push(p); return p;
    };
    const pala = mk(1n, 'pala', 11), clerigo = mk(2n, 'clerigo', 15);
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type: 'goblin', x: 12, y: 20, r: 1, n: 2, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => players, playerById: (id) => players.find((p) => p.playerId === id), nearby: () => [pala], after: () => {},
        hurt: () => {}, stun: () => 0, reward: () => {}, pay: () => true, heal: () => {}, refundMp: (_p, n) => { refunds.push(n); },
    };
    const sim = new MobSim(map, host);
    const raws = [...(sim as unknown as { mobs: Map<number, { id: number; hp: number; hpMax: number; traits: number; x: number }> }).mobs.values()];
    for (const m of raws) { m.traits = 0; m.hp = m.hpMax = 1e6; }
    return { sim, pala, clerigo, raws, refunds };
}

test('curar genera amenaza sobre los monstruos que pelean con el curado, y solo sobre esos', () => {
    const { sim, pala, clerigo, raws } = mobSetup();
    const [m1, m2] = raws;
    m2.x = 36; // lejos: no viene a ayudar
    sim.hit(pala, { mobId: m1.id, dmg: 0, melee: false, crit: false, parSecs: 0, poisonSecs: 0, spell: 'golpe' });
    assert.equal(sim.healThreat(clerigo, pala, 100), 1, 'solo el mob que pelea con el pala');
    assert.equal(sim.threatOn(m1.id, clerigo), 100);
    assert.equal(sim.threatOn(m2.id, clerigo), 0);
    assert.equal(HEAL_THREAT, 0.5);
});

test('Castigo sobre un monstruo: devuelve maná al pegar', () => {
    const { sim, clerigo, raws, refunds } = mobSetup();
    sim.hit(clerigo, { mobId: raws[0].id, dmg: 0, melee: false, crit: false, parSecs: 0, poisonSecs: 0, spell: 'castigo' });
    assert.deepEqual(refunds, [9]);
    assert.ok(raws[0].hp < raws[0].hpMax);
});

test('Renovar sobre un monstruo: lo quema y lo engancha', () => {
    const { sim, clerigo, raws } = mobSetup();
    assert.equal(sim.burnMob(clerigo, raws[0].id), true);
    for (let i = 0; i < 35; i++) { clock += 100; sim.update(); }
    assert.ok(raws[0].hp < raws[0].hpMax, 'la quemadura pegó');
    assert.equal(sim.targetOf(raws[0].id), clerigo.playerId);
});
