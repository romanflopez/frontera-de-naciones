/**
 * K3 (habilidades nuevas hasta nivel 12) y K4 (amenaza y provocación), sobre la simulación de mobs.
 * Ver el doc del proyecto kits-de-clase.md.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { meleeIntervalSecs, type WorldMap } from '@fdn/world';
import { MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';
import { BURN_EVERY, BURN_TICKS, PvpLimiter, statsFromChar, threatOf } from '../src/systems/pvpCombat.ts';

const N = 40;
let clock = 9_000_000;
mock.method(Date, 'now', () => clock);

type Raw = { id: number; hp: number; hpMax: number; par: number; imm: number; slow: number; burn: number; x: number; y: number; target: bigint | null; state: string; traits: number };

function setup(n = 1) {
    clock += 100_000;
    const sent: ServerMessage[] = [], heals: { id: bigint; n: number }[] = [];
    const mk = (id: bigint, cls: string, x: number) => {
        const p = { playerId: id, posX: x, posY: 20, disconnected: false, isDead: false, status: { isInvisible: false }, combat: statsFromChar({ lvl: 12, cls, eq: {} }), pvp: new PvpLimiter(), send: (m: ServerMessage) => sent.push(m) } as unknown as Player;
        p.pvp.meleeGapMs = meleeIntervalSecs(0) * 1000;
        return p;
    };
    const pala = mk(1n, 'guerrero', 11), mago = mk(2n, 'mago', 13);
    const players = [pala, mago];
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type: 'goblin', x: 12, y: 20, r: 1, n, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => players, playerById: (id) => players.find((p) => p.playerId === id), nearby: () => [pala], after: () => {}, // los avisos llegan una sola vez (al paladín)
        hurt: () => {}, stun: () => 0, reward: () => {}, pay: () => true,
        heal: (p, v) => { heals.push({ id: p.playerId, n: v }); },
    };
    const sim = new MobSim(map, host);
    const raws = [...(sim as unknown as { mobs: Map<number, Raw> }).mobs.values()];
    for (const m of raws) { m.traits = 0; m.hp = m.hpMax = 1e6; }
    const hit = (p: Player, m: Raw, spell: string, extra: Record<string, unknown> = {}) => sim.hit(p, { mobId: m.id, dmg: 0, melee: false, crit: false, parSecs: 0, poisonSecs: 0, spell, ...extra });
    const dmgs = () => sent.filter((x) => x.payload?.$case === 'mobDamaged').map((x) => (x.payload as { value: { dmg: number } }).value.dmg);
    const step = (secs: number) => { const n = Math.round(secs / 0.1); for (let i = 0; i < n; i++) { clock += 100; sim.update(); } };
    return { sim, pala, mago, raws, hit, dmgs, heals, step, sent };
}

// ---------- K4: amenaza ----------
test('amenaza: el mob persigue al que más amenaza le generó, no al primero que le pegó', () => {
    const { sim, pala, mago, raws, hit, step } = setup();
    const m = raws[0];
    hit(pala, m, 'golpe'); step(0.2);
    assert.equal(sim.targetOf(m.id), pala.playerId, 'primero va al paladín');
    for (let i = 0; i < 4; i++) { hit(mago, m, 'proyectil'); clock += 1000; }
    step(0.2);
    assert.ok(sim.threatOn(m.id, mago) > sim.threatOn(m.id, pala));
    assert.equal(sim.targetOf(m.id), mago.playerId, 'el mago generó más amenaza y se lo lleva');
});

test('amenaza: Juicio y Escudo vengador multiplican la amenaza (×3 y ×5)', () => {
    assert.equal(threatOf('juicio'), 3); assert.equal(threatOf('escudo'), 5); assert.equal(threatOf('proyectil'), 1);
    assert.equal(threatOf('giro'), 3); assert.equal(threatOf('carga'), 3);
});

test('provocación: el Martillo hace que el mob ataque al paladín aunque el mago tenga más amenaza', () => {
    const { sim, pala, mago, raws, hit, step } = setup();
    const m = raws[0];
    for (let i = 0; i < 6; i++) { hit(mago, m, 'proyectil'); clock += 1000; }
    step(0.2); assert.equal(sim.targetOf(m.id), mago.playerId);
    hit(pala, m, 'aturdir', { parSecs: 3 }); step(0.2);
    assert.equal(sim.targetOf(m.id), pala.playerId, 'provocado');
    step(3.5);
    assert.equal(sim.targetOf(m.id), mago.playerId, 'pasados los 3 s vuelve al de más amenaza');
});

test('Mandato: provoca a todos los monstruos a 6 celdas durante 7 s', () => {
    const { sim, pala, mago, raws, hit, step } = setup(4);
    for (const m of raws) { hit(mago, m, 'proyectil'); clock += 400; }
    step(0.2);
    const n = sim.tauntNear(pala, pala.posX + 0.5, pala.posY + 0.5, 6, 7); step(0.2);
    assert.equal(n, raws.length);
    for (const m of raws) assert.equal(sim.targetOf(m.id), pala.playerId);
    step(7.5);
    for (const m of raws) assert.equal(sim.targetOf(m.id), mago.playerId, 'al terminar vuelven al de más amenaza');
});

// ---------- K3: habilidades nuevas ----------
test('Esquirla de hielo: frena 3 s y pega 2× a un mob congelado', () => {
    const { mago, raws, hit, dmgs } = setup(), m = raws[0], rnd = Math.random;
    Math.random = () => 0.5;
    try {
        hit(mago, m, 'esquirla');
        assert.ok(m.slow > clock / 1000 + 2.9, 'frenado 3 s');
        clock += 1000; hit(mago, m, 'paralisis', { parSecs: 5 }); clock += 1000;
        hit(mago, m, 'esquirla');
        const d = dmgs(); assert.ok(Math.abs(d[2] / d[0] - 2) < 0.05, `${d[0]} → ${d[2]}`);
    } finally { Math.random = rnd; }
});

test('Ignición: daño inicial + 6 pulsos de quemadura (1,5× en total) y una sola por mob', () => {
    const { mago, raws, hit, dmgs, step } = setup(), m = raws[0];
    hit(mago, m, 'ignicion');
    assert.ok(m.burn > clock / 1000 + 2.9, 'quema 3 s');
    step(BURN_TICKS * BURN_EVERY + 0.3);
    assert.equal(dmgs().length, 1 + BURN_TICKS, 'golpe + 6 pulsos');
    clock += 6000; hit(mago, m, 'ignicion'); step(1); clock += 4000; hit(mago, m, 'ignicion'); step(4);
    assert.equal(dmgs().length, 3 + 3 * BURN_TICKS - 4, 'la segunda quemadura se reemplazó por la tercera');
});

test('Bola de fuego: 1,4× sobre un mob que se está quemando', () => {
    const { mago, raws, hit, dmgs } = setup(), m = raws[0], rnd = Math.random;
    Math.random = () => 0.5;
    try {
        hit(mago, m, 'bola'); clock += 11000;
        hit(mago, m, 'ignicion'); hit(mago, m, 'bola');
        const d = dmgs(); assert.ok(Math.abs(d[2] / d[0] - 1.4) < 0.05, `${d[0]} → ${d[2]}`);
    } finally { Math.random = rnd; }
});

test('Juicio: el paladín se cura la mitad del daño que hizo', () => {
    const { pala, raws, hit, dmgs, heals } = setup();
    hit(pala, raws[0], 'juicio');
    const d = dmgs()[0];
    assert.equal(heals.length, 1); assert.equal(heals[0].n, Math.round(d * 0.5));
});

test('Escudo vengador: aturde 3 s y pega 1,5× a un mob ya aturdido', () => {
    const { pala, raws, hit, dmgs } = setup(), m = raws[0], rnd = Math.random;
    Math.random = () => 0.5;
    try {
        hit(pala, m, 'escudo', { parSecs: 3 });
        assert.ok(m.par > clock / 1000 + 2.9, 'aturdido 3 s');
        clock += 9500; m.par = clock / 1000 + 2; m.imm = 0; // otro lo aturdió
        hit(pala, m, 'escudo', { parSecs: 3 });
        const d = dmgs(); assert.ok(Math.abs(d[1] / d[0] - 1.5) < 0.05, `${d[0]} → ${d[1]}`);
    } finally { Math.random = rnd; }
});
