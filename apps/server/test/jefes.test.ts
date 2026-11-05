/**
 * Motor de jefes (docs/JEFES.md): barra de casteo con ventana, cortes duros y blandos, salida alternativa, avisos en el piso, charcos,
 * golpe al tanque con sangrado, adds por umbral, furia, respiro entre mecánicas y reinicio.
 */
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { BOSS_KITS, BOSS_UNIQUES, DUNGEON_BOSS, DUNGEON_IDS, castWindowFrom, type MobType, type WorldMap, type Zone } from '@fdn/world';
import { bossRage } from '../src/bosses.ts';
import { MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';
import { PvpLimiter, statsFromChar } from '../src/systems/pvpCombat.ts';

let clock = 50_000_000;
mock.method(Date, 'now', () => clock);

const N = 40;
function arena(type: MobType, at: { x: number; y: number }[] = [{ x: 20, y: 21 }]) {
    clock += 1_000_000;
    const sent: ServerMessage[] = [], hurts: { who: number; raw: number; source: string }[] = [], stuns: number[] = [], slows: number[] = [], poisons: number[] = [], pushes: { who: number; x: number; y: number }[] = [], dispels: number[] = [];
    const timers: { at: number; fn: () => void }[] = [];
    const players = at.map((c, i) => ({
        playerId: BigInt(10 + i), characterName: `p${i}`, posX: c.x, posY: c.y, disconnected: false, isDead: false, status: { isInvisible: false },
        combat: statsFromChar({ lvl: 10, cls: 'paladin', eq: {} }), pvp: new PvpLimiter(), send: (m: ServerMessage) => sent.push(m),
    })) as unknown as Player[];
    const grid = (v: boolean) => Array.from({ length: N }, () => new Array<boolean>(N).fill(v));
    const zones: Zone[] = [{ type, x: 20, y: 20, r: 0, n: 1, name: 'Sala del jefe' }];
    const map = { size: N, tiles: [], blocked: grid(false), safe: grid(false), props: [], decals: [], zones, buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => players, playerById: (id) => players.find((p) => p.playerId === id), nearby: () => players,
        after: (ms, fn) => { timers.push({ at: clock + ms, fn }); },
        hurt: (p, raw, source) => { hurts.push({ who: players.indexOf(p), raw, source }); },
        stun: (_p, secs) => { stuns.push(secs); return secs; }, slow: (_p, secs) => { slows.push(secs); }, poison: (_p, secs) => { poisons.push(secs); },
        push: (p, x, y) => { pushes.push({ who: players.indexOf(p), x, y }); (p as { posX: number; posY: number }).posX = Math.floor(x); (p as { posX: number; posY: number }).posY = Math.floor(y); },
        dispel: (p) => { dispels.push(players.indexOf(p)); },
        pay: () => true, heal: () => {}, reward: () => {},
    };
    const s = new MobSim(map, host, { noRespawn: true });
    const boss = () => s.detail().find((m) => m.boss)!;
    const step = (ms = 100) => {
        clock += ms; s.update();
        for (const t of timers.filter((t) => t.at <= clock)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    };
    const run = (secs: number, until?: () => boolean) => { for (let i = 0; i < secs * 10; i++) { step(); if (until?.()) return true; } return false; };
    const of = <K extends string>(k: K) => sent.filter((m) => m.payload?.$case === k).map((m) => (m.payload as unknown as { value: Record<string, unknown> }).value);
    const casting = (name: string) => () => of('bossCast').some((v) => v.name === name);
    return { s, players, sent, hurts, stuns, slows, poisons, pushes, dispels, boss, step, run, of, casting };
}

test('barra de casteo: nombre, escuela, duración y ventana; si nadie corta, sale el efecto (Lluvia de ácido saca ~70 % a todos)', () => {
    const A = arena('antlion_reina', [{ x: 20, y: 21 }, { x: 24, y: 24 }]);
    assert.ok(A.run(12, A.casting('Lluvia de ácido')), 'la Reina castea la Lluvia en la primera docena de segundos');
    const c = A.of('bossCast').find((v) => v.name === 'Lluvia de ácido')!;
    assert.equal(c.school, 'acido'); assert.equal(c.durationMs, 2500); assert.equal(c.interruptible, true);
    assert.equal(c.windowFromMs, castWindowFrom({ castMs: 2500 }), 'ventana: el 40 % final');
    A.run(3);
    const rain = A.hurts.filter((h) => /Lluvia/.test(h.source));
    assert.equal(rain.length, 2, 'pega a los dos de la sala');
    for (const h of rain) assert.equal(h.raw, Math.round(A.players[h.who].combat.maxHp * 0.7));
    assert.ok(A.of('bossCastEnd').some((v) => v.result === 0));
});

test('corte duro en cualquier momento: no sale el efecto, "Interrumpido" con quién cortó, y la escuela queda bloqueada', () => {
    const A = arena('antlion_reina');
    A.run(12, A.casting('Lluvia de ácido'));
    A.step(); // apenas empezó: fuera de la ventana
    A.s.skillHit(A.players[0], A.boss().id, 5, 0, 'carga');
    const end = A.of('bossCastEnd').at(-1)!;
    assert.equal(end.result, 1); assert.equal(end.by, 'p0');
    A.run(4);
    assert.equal(A.hurts.filter((h) => /Lluvia/.test(h.source)).length, 0, 'la Lluvia no salió');
    assert.equal(A.s.bossOf(A.boss().id)!.stats.cut, 1);
    assert.ok((A.s.bossOf(A.boss().id)!.locks.get('acido') ?? 0) > 0, 'el ácido queda bloqueado un rato');
});

test('corte blando: Castigo solo corta si pega dentro de la ventana dorada', () => {
    const A = arena('antlion_reina');
    A.run(12, A.casting('Lluvia de ácido'));
    A.step();
    A.s.skillHit(A.players[0], A.boss().id, 5, 0, 'castigo'); // temprano
    assert.equal(A.of('bossCastEnd').filter((v) => v.result === 1).length, 0, 'fuera de la ventana no corta');
    A.run(1.6); // ya en el 40 % final (2,5 s de casteo, ventana desde 1,5 s)
    A.s.skillHit(A.players[0], A.boss().id, 5, 0, 'castigo');
    assert.equal(A.of('bossCastEnd').filter((v) => v.result === 1).length, 1, 'en la ventana sí corta');
});

test('los jefes con motor son inmunes al aturdir: el control corta pero no los deja quietos', () => {
    const A = arena('goblin_jefe');
    A.run(1);
    A.s.skillHit(A.players[0], A.boss().id, 5, 0, 'aturdir', 3);
    assert.equal(A.boss().par, 0);
});

test('salida alternativa: si te alejás del Grito de terror, el jefe te carga y te frena en vez de aterrar a todos', () => {
    const A = arena('goblin_jefe');
    assert.ok(A.run(14, A.casting('Grito de terror')));
    A.players[0].posX = 27; // a ~7 celdas: más de 4
    A.run(2.5);
    assert.ok(A.hurts.some((h) => /Carga y desjarrete/.test(h.source)), 'carga');
    assert.ok(A.slows.includes(4), 'frena 4 s');
    assert.ok(Math.hypot(A.boss().x - 27.5, A.boss().y - 21.5) < 2.5, 'el jefe quedó al lado');
    const B = arena('goblin_jefe'); // si te quedás cerca: terror
    B.run(14, B.casting('Grito de terror')); B.run(2.5);
    assert.ok(B.hurts.some((h) => /Grito de terror/.test(h.source))); assert.ok(B.stuns.includes(3));
});

test('aviso en el piso: el Pisotón avisa 1,3 s antes y solo pega a los que siguen en el círculo', () => {
    const A = arena('goblin_jefe', [{ x: 20, y: 21 }, { x: 21, y: 20 }]);
    assert.ok(A.run(8, () => A.of('bossTelegraph').some((v) => v.name === 'Pisotón')));
    const t = A.of('bossTelegraph').find((v) => v.name === 'Pisotón')!;
    assert.equal(t.warnMs, 1300); assert.equal(t.r, 3);
    A.players[1].posX = 30; // se sale del círculo
    A.run(1.5);
    const hit = A.hurts.filter((h) => /Pisotón/.test(h.source)).map((h) => h.who);
    assert.deepEqual(hit, [0]);
});

test('charco que dura: el Chorro de ácido deja una zona que pega cada segundo y se termina', () => {
    const A = arena('antlion_reina');
    assert.ok(A.run(8, () => A.of('bossZone').length > 0));
    const z = A.of('bossZone')[0];
    assert.equal(z.durationMs, 6000);
    A.run(3);
    const n = A.hurts.filter((h) => /Charco/.test(h.source)).length;
    assert.ok(n >= 2, `pulsos en 3 s: ${n}`);
    A.players[0].posX = 35; A.players[0].posY = 35; // se va
    const before = A.hurts.filter((h) => /Charco/.test(h.source)).length;
    A.run(2);
    assert.equal(A.hurts.filter((h) => /Charco/.test(h.source)).length, before);
});

test('golpe al tanque con sangrado que se apila', () => {
    const A = arena('antlion_reina');
    assert.ok(A.run(16, () => A.hurts.some((h) => /Mordida corrosiva\)/.test(h.source))));
    A.run(3);
    assert.ok(A.hurts.filter((h) => /sangrado/.test(h.source)).length >= 2);
});

test('adds por umbral (una sola vez) y furia; el chamán solo aparece en dúo o más, con su propio casteo', () => {
    for (const party of [1, 2]) {
        const A = arena('goblin_jefe');
        A.s.setPartyScale(party);
        A.run(0.5);
        const b = A.boss(), hit = (to: number) => A.s.skillHit(A.players[0], b.id, Math.max(1, Math.round(A.boss().hp - A.boss().hpMax * to)), 0, 'golpe');
        hit(0.49); A.run(0.3);
        const adds = A.s.detail().filter((m) => m.add);
        assert.equal(adds.length, party === 1 ? 2 : 3, `party de ${party}`);
        assert.equal(adds.some((m) => m.type === 'hobgoblin'), party > 1);
        assert.ok(A.of('bossPhase').some((v) => v.event === 'adds'));
        hit(0.45); A.run(0.3);
        assert.equal(A.s.detail().filter((m) => m.add).length, adds.length, 'el umbral no se repite');
        hit(0.2); A.run(0.3);
        assert.ok(A.of('bossPhase').some((v) => v.event === 'furia' && v.enraged === true));
        assert.equal(A.s.bossOf(b.id)!.rage, BOSS_KITS.goblin_jefe!.enrage!.dmg);
        if (party > 1) {
            const sham = A.s.detail().find((m) => m.type === 'hobgoblin')!;
            assert.ok(A.s.bossOf(sham.id), 'el chamán tiene motor');
            assert.ok(A.run(8, A.casting('Fogonazo')), 'y castea');
        }
    }
});

test('respiro: dos mecánicas nunca empiezan con menos de 4 s entre sí', () => {
    const A = arena('antlion_reina');
    const starts: number[] = [];
    let seen = 0;
    for (let i = 0; i < 600; i++) {
        A.step();
        const n = A.of('bossCast').length + A.of('bossTelegraph').length;
        if (n > seen) { starts.push(clock); seen = n; }
    }
    assert.ok(starts.length >= 5, `${starts.length} mecánicas en 60 s`);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 3900, `separación ${starts[i] - starts[i - 1]} ms`);
});

test('reinicio: si nadie lo sigue, vuelve a su lugar, se van los adds y la pelea arranca de cero', () => {
    const A = arena('goblin_jefe');
    A.run(0.5);
    const b = A.boss();
    A.s.skillHit(A.players[0], b.id, Math.round(b.hpMax * 0.55), 0, 'golpe'); A.run(0.3);
    assert.ok(A.s.detail().some((m) => m.add));
    (A.players[0] as unknown as { isDead: boolean }).isDead = true;
    A.run(1);
    assert.equal(A.s.detail().filter((m) => m.add).length, 0, 'adds fuera');
    assert.ok(A.of('bossPhase').some((v) => v.event === 'reinicio'));
    assert.equal(A.s.bossOf(b.id)!.startedAt, 0);
});

test('terror real: el Grito saca al jugador despedido lejos del jefe además de aterrarlo', () => {
    const B = arena('goblin_jefe');
    B.run(14, B.casting('Grito de terror')); B.run(2.5);
    assert.ok(B.stuns.includes(3));
    const push = B.pushes.at(-1)!;
    assert.ok(push, 'lo empujó');
    assert.ok(Math.hypot(push.x - B.boss().x, push.y - B.boss().y) >= 3.5, 'quedó lejos del jefe');
});

test('terror respeta el control: si ya estaba aturdido o congelado no lo mueve; si es inmune, ni lo mueve ni lo aterra', () => {
    const held = arena('goblin_jefe');
    (held.s as unknown as { host: MobHost }).host.held = () => true;
    held.run(14, held.casting('Grito de terror')); held.run(2.5);
    assert.ok(held.hurts.some((h) => /Grito de terror/.test(h.source)), 'el grito pegó');
    assert.equal(held.pushes.length, 0, 'aturdido: no sale despedido');
    const imm = arena('goblin_jefe');
    (imm.s as unknown as { host: MobHost }).host.stun = () => 0; // Bendición sagrada, Purga o rendimiento decreciente
    imm.run(14, imm.casting('Grito de terror')); imm.run(2.5);
    assert.equal(imm.pushes.length, 0, 'inmune: tampoco');
});

test('tirón y explosión: el Vórtice arrastra a todos al jefe y estalla; el que sale del círculo no recibe daño', () => {
    const A = arena('mago_mayor', [{ x: 20, y: 21 }, { x: 26, y: 26 }]);
    assert.ok(A.run(45, () => A.of('bossTelegraph').some((v) => v.name === 'Vórtice')));
    assert.equal(A.pushes.length >= 2, true, 'arrastra a los dos');
    A.players[1].posX = 32; A.players[1].posY = 32; // uno sale corriendo
    A.run(2);
    const hit = A.hurts.filter((h) => /Vórtice/.test(h.source)).map((h) => h.who);
    assert.ok(hit.includes(0) && !hit.includes(1), `alcanzados: ${hit}`);
});

test('disipar: el Mago mayor les saca los buffs a todos, con candado (no se corta)', () => {
    const A = arena('mago_mayor', [{ x: 20, y: 21 }, { x: 22, y: 22 }]);
    assert.ok(A.run(45, A.casting('Disipar magia')));
    assert.equal(A.of('bossCast').find((v) => v.name === 'Disipar magia')!.interruptible, false);
    A.s.skillHit(A.players[0], A.boss().id, 1, 0, 'carga'); // no corta
    A.run(2.5);
    assert.ok(A.dispels.includes(0) && A.dispels.includes(1));
});

test('autocura y furia apilable: si nadie corta el Juramento, el Caballero se cura; y pega más cuanto más dura', () => {
    const A = arena('caballero_cripta');
    A.run(0.5);
    const b = A.boss();
    A.s.skillHit(A.players[0], b.id, Math.round(b.hpMax * 0.3), 0, 'golpe');
    const hp0 = A.boss().hp;
    assert.ok(A.run(20, A.casting('Juramento oscuro')));
    A.run(3);
    assert.ok(A.boss().hp > hp0, 'se curó');
    A.run(25);
    assert.ok(bossRage(A.s.bossOf(b.id) ? { bs: A.s.bossOf(b.id) } : {}) > 1.1, 'furia apilada');
});

test('los seis jefes de mazmorra tienen motor y sus ítems propios', () => {
    for (const d of DUNGEON_IDS) {
        const t = DUNGEON_BOSS[d];
        assert.ok(BOSS_KITS[t], `${d}: ${t} sin kit`);
        assert.ok((BOSS_UNIQUES[t]?.length ?? 0) >= 2, `${d}: ${t} sin ítems de jefe`);
        const A = arena(t);
        assert.ok(A.run(25, () => A.of('bossCast').length + A.of('bossTelegraph').length > 0), `${t} usa sus mecánicas`);
    }
});
