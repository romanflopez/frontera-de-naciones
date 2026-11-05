/**
 * K7: la simulación PvP (tools/src/sim) usa los números del server. Si alguien cambia una regla de PvP, este test avisa
 * que hay que volver a correr `pnpm --filter @fdn/tools sim:pvp` y revisar la calibración.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { potionHp, potionMp, potionLockMs, pvpCap, pvpMpRegen, pvpScale, pvpVsCtrl } from '../src/systems/pvpCombat.ts';
import { SERVER_RULES, cap, potHp, potMp, scale, vsCtrl } from '../../../tools/src/sim/pvp/rules.ts';
import { runMatchup, ONE_V_ONE, TARGET } from '../../../tools/src/sim/pvp/matchups.ts';
import { simulate } from '../../../tools/src/sim/pvp/engine.ts';
import { BOTS } from '../../../tools/src/sim/pvp/bots.ts';

test('las fórmulas de la sim dan lo mismo que el server con las reglas del server', () => {
    for (const raw of [1, 7, 55, 230, 999]) assert.equal(scale(SERVER_RULES, raw), pvpScale(raw));
    for (const [d, max] of [[50, 1000], [400, 1000], [900, 881]]) assert.equal(cap(SERVER_RULES, d, max), pvpCap(d, max));
    for (const k of [1.1, 1.5, 2]) assert.equal(vsCtrl(SERVER_RULES, k), pvpVsCtrl(k));
    for (const max of [84, 262, 1496]) { assert.equal(potHp(SERVER_RULES, max), potionHp(max, true)); assert.equal(potMp(SERVER_RULES, max), potionMp(max, true)); }
    assert.equal(SERVER_RULES.potLockMs, potionLockMs(true));
    for (const max of [84, 262, 1000]) assert.equal(Math.max(SERVER_RULES.mpRegenMin, Math.round(max * SERVER_RULES.mpRegenPct)), pvpMpRegen(max));
});

test('la simulación es determinista por semilla', () => {
    const run = () => simulate({ lvl: 12, rules: SERVER_RULES, seed: 4242, teams: [[{ cls: 'pala', policy: BOTS.pala }], [{ cls: 'mago', policy: BOTS.mago }]] });
    const a = run(), b = run();
    assert.equal(a.secs, b.secs); assert.equal(a.winner, b.winner); assert.equal(a.winnerHpPct, b.winnerHpPct);
});

test('calibración K7: pala contra mago y el espejo de palas duran 20-40 s a nivel 12', () => {
    for (const name of ['pala vs mago', 'pala vs pala']) {
        const r = runMatchup(ONE_V_ONE.find((m) => m.name === name)!, 12, SERVER_RULES, 16);
        assert.ok(r.secsMed >= TARGET.oneMin && r.secsMed <= TARGET.oneMax, `${name}: ${r.secsMed} s`);
        assert.ok(r.winnerHpMed <= TARGET.winnerHpMax, `${name}: el ganador queda con ${r.winnerHpMed} %`);
    }
});
