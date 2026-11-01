/** Atributos de combate autoritativos (docs/PLAN_DE_TRABAJO.md paso 1.3): topes, crítico, velocidad de ataque, robo de vida, veneno, recarga y maná del lado del server. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { COMBAT_CAP, CRIT_MULT, aspdTotal, critTotal, leechTotal, meleeIntervalSecs, type MobType, type WorldMap } from '@fdn/world';
import { MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';
import { PvpLimiter, statsFromChar, type CombatStats } from '../src/systems/pvpCombat.ts';

const N = 40;
let clock = 5_000_000;
mock.method(Date, 'now', () => clock);

type Eq = Record<string, { n: string; a?: { id: string; v: number }[]; up?: number } | null>;
const withAttrs = (attrs: { id: string; v: number }[], extra: Eq = {}): Eq => ({ arma: { n: 'Espada corta', a: attrs }, ...extra });
const statsFor = (eq: Eq, cls = 'guerrero', lvl = 10) => statsFromChar({ lvl, cls, eq });

function setup(combat: CombatStats, at = { x: 14, y: 20 }, type: MobType = 'goblin') {
    clock += 100_000;
    const sent: ServerMessage[] = [], heals: number[] = [], paid: number[] = [];
    let mana = 1000;
    const p = { playerId: 7n, posX: at.x, posY: at.y, disconnected: false, isDead: false, status: { isInvisible: false }, combat, pvp: new PvpLimiter(), send: (m: ServerMessage) => sent.push(m) } as unknown as Player;
    p.pvp.meleeGapMs = meleeIntervalSecs(combat.aspd) * 1000;
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type, x: 10, y: 20, r: 0, n: 1, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => [p], playerById: (id) => (id === p.playerId ? p : undefined), nearby: () => [p], after: () => {},
        hurt: () => {}, stun: () => 0, reward: () => {},
        pay: (_p, c) => { if (mana < c) return false; mana -= c; paid.push(c); return true; },
        heal: (_p, n) => { heals.push(n); },
    };
    const sim = new MobSim(map, host);
    const raw = [...(sim as unknown as { mobs: Map<number, { hp: number; hpMax: number; par: number; imm: number; poison: number }> }).mobs.values()][0];
    raw.hp = raw.hpMax = 1e9; // el mob no se muere en medio de la prueba
    const id = sim.list()[0].id;
    const hit = (spell: string, extra: Record<string, unknown> = {}) => sim.hit(p, { mobId: id, dmg: 0, melee: spell === 'ataque', crit: false, parSecs: 0, poisonSecs: 0, spell, ...extra });
    const hits = () => sent.filter((m) => m.payload?.$case === 'mobDamaged').map((m) => (m.payload as { value: { dmg: number; crit: boolean } }).value);
    return { sim, p, raw, id, hit, hits, heals, paid, setMana: (n: number) => { mana = n; } };
}

// ---------- A. topes ----------
test('topes: crítico total 35 %, velocidad 40 %, robo de vida 15 %, y nunca negativos', () => {
    assert.equal(critTotal(0), 5); assert.equal(critTotal(10), 15); assert.equal(critTotal(500), COMBAT_CAP.crit); assert.equal(critTotal(-20), 0);
    assert.equal(aspdTotal(25), 25); assert.equal(aspdTotal(999), COMBAT_CAP.aspd); assert.equal(aspdTotal(-5), 0);
    assert.equal(leechTotal(9), 9); assert.equal(leechTotal(999), COMBAT_CAP.leech); assert.equal(leechTotal(NaN), 0);
    assert.ok(Math.abs(meleeIntervalSecs(40) - 0.85 / 1.4) < 1e-9);
    assert.equal(meleeIntervalSecs(300), meleeIntervalSecs(40), 'pasarse del tope no acelera más');
});

test('topes: al sumar varios ítems (equipo, anillos, mejoras) se aplican sobre el total, no por ítem', () => {
    const eq = withAttrs([{ id: 'crit', v: 6 }, { id: 'aspd', v: 12 }, { id: 'leech', v: 6 }], {
        anillo: { n: 'Anillo del filo', a: [{ id: 'crit', v: 6 }, { id: 'aspd', v: 12 }, { id: 'leech', v: 6 }] },
        amuleto: { n: 'Sello del veloz', a: [{ id: 'crit', v: 6 }, { id: 'aspd', v: 12 }, { id: 'leech', v: 6 }] },
        casco: { n: 'Casco', a: [{ id: 'crit', v: 6 }, { id: 'aspd', v: 12 }, { id: 'leech', v: 6 }] },
    });
    const s = statsFor(eq);
    assert.ok(s.crit <= 35 && s.aspd <= 40 && s.leech <= 15);
    const big = statsFor(withAttrs([{ id: 'crit', v: 90 }, { id: 'aspd', v: 90 }, { id: 'leech', v: 90 }]));
    assert.deepEqual([big.crit, big.aspd, big.leech], [35, 40, 15]);
    assert.deepEqual([statsFor({}).crit, statsFor({}).aspd, statsFor({}).leech], [5, 0, 0], 'sin equipo: 5 % de crítico base');
});

// ---------- H. el cliente no manda el daño ----------
test('el daño, el crítico y el veneno que diga el cliente se ignoran', () => {
    const { hit, hits, raw } = setup(statsFor({}, 'guerrero', 1));
    hit('ataque', { dmg: 999999, crit: true, poisonSecs: 5 });
    const h = hits(); assert.equal(h.length, 1);
    assert.ok(h[0].dmg < 60, `daño del server (${h[0].dmg}), no el 999999 del cliente`);
    assert.equal(raw.poison, 0, 'el veneno lo decide el server');
});

test('sin hechizo (o con uno que no existe) no hay golpe, aunque venga con daño enorme', () => {
    const { hit, hits } = setup(statsFor({}));
    hit('', { dmg: 5000 }); hit('inventado', { dmg: 5000 }); hit('DROP TABLE', { dmg: 5000 }); hit('curar', { dmg: 5000 });
    assert.equal(hits().length, 0);
});

test('un hechizo no puede pegar desde más lejos que su alcance', () => {
    const { hit, hits } = setup(statsFor({}), { x: 38, y: 20 }); // el mob está en x≈10
    hit('ataque'); hit('lanza'); hit('bola');
    assert.equal(hits().length, 0);
});

test('velocidad de ataque: spamear "ataque" no pasa del ritmo permitido (sin equipo)', () => {
    const { hit, hits } = setup(statsFor({}));
    for (let i = 0; i < 500; i++) { hit('ataque'); clock += 10; } // 500 pedidos en 5 s
    const n = hits().length, max = Math.ceil(5 / (meleeIntervalSecs(0) * 0.9)) + 1;
    assert.ok(n >= 4 && n <= max, `${n} golpes en 5 s (máx ${max})`);
});

test('velocidad de ataque: con +200 % en el equipo se topea en 40 %', () => {
    const base = setup(statsFor({}));
    for (let i = 0; i < 1000; i++) { base.hit('ataque'); clock += 10; }
    const fast = setup(statsFor(withAttrs([{ id: 'aspd', v: 200 }])));
    for (let i = 0; i < 1000; i++) { fast.hit('ataque'); clock += 10; }
    const a = base.hits().length, b = fast.hits().length;
    assert.ok(b > a, 'la velocidad sí sirve');
    assert.ok(b <= Math.ceil(10 / (meleeIntervalSecs(40) * 0.9)) + 1, `${b} golpes en 10 s: no pasa del tope`);
    assert.ok(b / a < 1.5, `razón ${(b / a).toFixed(2)} ≤ 1,4 + redondeo de 10 ms`);
});

test('recarga: un hechizo no se puede repetir antes de su recarga', () => {
    const { hit, hits, paid } = setup(statsFor({}, 'mago', 10), { x: 14, y: 20 });
    hit('lanza'); clock += 500; hit('lanza'); clock += 500; hit('lanza');
    assert.equal(hits().length, 1, 'solo el primero (cd 4,5 s)');
    assert.deepEqual(paid, [30], 'y se cobra una sola vez');
    clock += 4500; hit('lanza');
    assert.equal(hits().length, 2);
    assert.deepEqual(paid, [30, 30]);
});

test('maná: sin maná el server no aplica el golpe', () => {
    const { hit, hits, setMana } = setup(statsFor({}, 'mago', 10));
    setMana(5); hit('lanza'); hit('bola');
    assert.equal(hits().length, 0);
    setMana(100); hit('lanza');
    assert.equal(hits().length, 1);
});

// ---------- B. crítico, robo de vida y veneno ----------
test('crítico: la proporción sigue el total topeado y el golpe crítico pega ×1,8', () => {
    const { hit, hits } = setup(statsFor(withAttrs([{ id: 'crit', v: 500 }]), 'guerrero', 10)); // pide 505 %, vale 35 %
    for (let i = 0; i < 3000; i++) { hit('ataque'); clock += 1000; }
    const h = hits(), crits = h.filter((x) => x.crit), rate = crits.length / h.length;
    assert.ok(rate > 0.30 && rate < 0.40, `${(rate * 100).toFixed(1)} % de críticos (esperado ~35 %)`);
    const nonMax = Math.max(...h.filter((x) => !x.crit).map((x) => x.dmg)), critMin = Math.min(...crits.map((x) => x.dmg));
    assert.ok(critMin >= Math.round(Math.min(...h.filter((x) => !x.crit).map((x) => x.dmg)) * CRIT_MULT) - 1);
    assert.ok(Math.max(...crits.map((x) => x.dmg)) <= Math.round(nonMax * CRIT_MULT) + 1);
});

test('crítico: sin equipo es 5 % y los hechizos no critican', () => {
    const a = setup(statsFor({}, 'guerrero', 10));
    for (let i = 0; i < 4000; i++) { a.hit('ataque'); clock += 1000; }
    const rate = a.hits().filter((x) => x.crit).length / a.hits().length;
    assert.ok(rate > 0.035 && rate < 0.065, `${(rate * 100).toFixed(1)} %`);
    const b = setup(statsFor(withAttrs([{ id: 'crit', v: 500 }]), 'mago', 10));
    for (let i = 0; i < 100; i++) { b.hit('hoja'); clock += 2000; }
    assert.equal(b.hits().filter((x) => x.crit).length, 0);
});

test('robo de vida: cura al server lo que de verdad quitó, con el tope de 15 %', () => {
    const { hit, hits, heals } = setup(statsFor(withAttrs([{ id: 'leech', v: 80 }]), 'guerrero', 10));
    for (let i = 0; i < 20; i++) { hit('ataque'); clock += 1000; }
    const h = hits(); assert.equal(heals.length, h.length);
    h.forEach((x, i) => assert.equal(heals[i], Math.max(1, Math.round((x.dmg * 15) / 100)), 'curación = 15 % del daño, no 80 %'));
});

test('robo de vida: sin atributo no cura, y un hechizo mágico tampoco cura', () => {
    const a = setup(statsFor({}, 'guerrero', 10)); a.hit('ataque'); assert.equal(a.heals.length, 0);
    const b = setup(statsFor(withAttrs([{ id: 'leech', v: 15 }]), 'mago', 10)); b.hit('lanza'); assert.equal(b.hits().length, 1); assert.equal(b.heals.length, 0, 'el robo de vida es del daño físico');
});

test('veneno: lo decide el server según el atributo del equipo', () => {
    const yes = setup(statsFor(withAttrs([{ id: 'poison', v: 100 }]), 'guerrero', 10));
    yes.hit('ataque'); assert.ok(yes.raw.poison > 0);
    const no = setup(statsFor({}, 'guerrero', 10));
    no.hit('ataque'); assert.equal(no.raw.poison, 0);
});

// ---------- control ----------
test('parálisis: dura lo que dice el hechizo (no lo que pide el cliente) y una vez por recarga', () => {
    const { hit, raw } = setup(statsFor({}, 'mago', 10));
    const t0 = clock / 1000;
    hit('paralisis', { parSecs: 99 });
    assert.ok(raw.par > t0 && raw.par <= t0 + 3.01, `par hasta +${(raw.par - t0).toFixed(2)} s (máx 3)`);
    const first = raw.par; clock += 500; hit('paralisis', { parSecs: 99 });
    assert.equal(raw.par, first, 'dentro de la recarga no se renueva');
});

test('parálisis: pedirla con un hechizo que no paraliza no hace nada', () => {
    const { hit, raw } = setup(statsFor({}, 'mago', 10));
    hit('proyectil', { parSecs: 5 }); assert.equal(raw.par, 0);
});

// ---------- el daño del server coincide con la fórmula ----------
test('daño de un hechizo: rango de la fórmula con nivel, arma, Magia y el multiplicador de stats', () => {
    const s = statsFor(withAttrs([{ id: 'mag', v: 20 }]), 'mago', 20);
    const { hit, hits } = setup(s);
    for (let i = 0; i < 50; i++) { hit('lanza'); clock += 5000; }
    const lo = Math.round((30 + 20 * 3 + s.mag) * s.magicMult), hi = Math.round((42 + 20 * 3 + s.mag) * s.magicMult);
    for (const x of hits()) assert.ok(x.dmg >= lo && x.dmg <= hi, `${x.dmg} fuera de ${lo}-${hi}`);
});
