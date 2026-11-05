/** Golpe y resistencia entre jugadores (doc del proyecto "formulas de stats y hit ratio", §2): chance, topes 10-90 % y tirada. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIT, HIT_ROLL, hitChance, hitRoll, statsFromChar, DEFAULT_STATS } from '../src/systems/pvpCombat.ts';
import { defaultStats } from '@fdn/world';

const char = (cls: string, dex: number, mag: number) => statsFromChar({ lvl: 120, cls, stats: { ...defaultStats(), dex, mag }, eq: {} } as never);

test('golpe físico: ataca 100 + (DEX − 50) contra 2 × DEX del objetivo, con tope 10-90 %', () => {
    const naked = char('guerrero', 10, 10), tank = char('guerrero', 120, 10), ace = char('guerrero', 200, 10);
    assert.equal(hitChance(naked, naked, 'phys'), HIT.max / 100, 'sin DEX nadie esquiva: tope 90 %');
    assert.equal(hitChance(ace, naked, 'phys'), HIT.max / 100);
    // DEX 200 contra DEX 200: (100 + 150) / 400 × K
    assert.ok(Math.abs(hitChance(ace, ace, 'phys') - Math.min(HIT.max, (250 / 400) * HIT.k) / 100) < 1e-9);
    // el que tiene más DEX pega más y recibe menos
    assert.ok(hitChance(ace, tank, 'phys') > hitChance(tank, ace, 'phys'));
    // nunca baja del 10 %
    const slow = { ...naked, dexStat: 10 }, wall = { ...ace, dexStat: 5000 };
    assert.equal(hitChance(slow, wall, 'phys'), HIT.min / 100);
});

test('golpe mágico: nunca falla, sin importar MAG ni DEX de nadie (D.2)', () => {
    const mage = char('mago', 10, 200), plain = char('guerrero', 10, 10), dexy = char('guerrero', 200, 10), magy = char('mago', 10, 5000);
    for (const [a, d] of [[mage, plain], [plain, mage], [mage, dexy], [mage, magy], [magy, mage], [plain, plain]]) assert.equal(hitChance(a, d, 'magic'), 1);
    HIT_ROLL.enabled = true;
    try { assert.equal(hitRoll(plain, magy, 'magic', () => 0.999999), true, 'ni con la peor tirada'); } finally { HIT_ROLL.enabled = false; }
});

test('la tirada usa la chance (y se apaga con la bandera de los tests)', () => {
    const a = char('guerrero', 120, 10), b = char('guerrero', 120, 10), p = hitChance(a, b, 'phys');
    assert.equal(HIT_ROLL.enabled, false, 'bajo node --test la tirada está apagada: los tests de combate no dependen del azar');
    assert.equal(hitRoll(a, b, 'phys', () => 0.9999), true, 'apagada: siempre pega');
    HIT_ROLL.enabled = true;
    try {
        assert.equal(hitRoll(a, b, 'phys', () => p - 0.001), true);
        assert.equal(hitRoll(a, b, 'phys', () => p + 0.001), false);
        assert.equal(hitRoll(DEFAULT_STATS, DEFAULT_STATS, 'phys', () => 0.899), true, 'stats por defecto: 90 %');
        assert.equal(hitRoll(DEFAULT_STATS, DEFAULT_STATS, 'phys', () => 0.91), false);
    } finally { HIT_ROLL.enabled = false; }
});
