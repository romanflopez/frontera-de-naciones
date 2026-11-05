/**
 * Etapa 6b del roadmap (balance PvE con números, base Dreadmyst): daño de los mobs por nivel, regeneración de vida por
 * porcentaje fuera de combate y regeneración de maná de PvE separada de la de PvP. Los números salen de `sim:pve`
 * (tools/src/sim/pve): si cambia la curva, este test avisa que hay que volver a correr la simulación.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevel, BOSS_LEVELS, bossDmgMult, HP_REGEN, hpRegenPerSec, MOB_DMG_KNOTS, mobDef, mobDmgCurve, mobDmgMult, MOBS, PVE_MP_REGEN, type MobType } from '@fdn/world';
import { combatMpRegen, pvpMpRegen } from '../src/systems/pvpCombat.ts';
import { foeAt, many } from '../../../tools/src/sim/pve/engine.ts';

test('6b: el multiplicador de daño de los mobs pasa por los puntos de la curva (en nivel de poder) e interpola entre ellos', () => {
    // la curva se mide en la escala vieja 1-40: con el nivel nuevo (relevel) da lo mismo que antes, a redondeo de nivel
    for (const [l, m] of MOB_DMG_KNOTS) assert.ok(Math.abs(mobDmgMult(relevel(l)) - m) < 0.06, `nivel de poder ${l}`);
    assert.equal(mobDmgMult(0), MOB_DMG_KNOTS[0][1]); assert.equal(mobDmgMult(999), MOB_DMG_KNOTS[MOB_DMG_KNOTS.length - 1][1]);
    const [a, b] = [MOB_DMG_KNOTS[2], MOB_DMG_KNOTS[3]], mid = relevel((a[0] + b[0]) / 2);
    assert.ok(Math.abs(mobDmgMult(mid) - (a[1] + b[1]) / 2) < 0.06);
    for (let l = relevel(6); l < 120; l++) assert.ok(mobDmgMult(l + 1) <= mobDmgMult(l) + 1e-9, `no sube desde el 6 (nivel ${l})`);
    for (let l = 1; l <= 120; l++) assert.ok(mobDmgMult(l) > 0);
});

test('6b: los mobs comunes reescalados siguen la curva de daño (con el multiplicador) y los jefes llevan la raíz', () => {
    for (const L of [1, 5, 10, 20, 30, 40].map(relevel)) {
        const d = mobDef('skeleton', { lvl: L }), avg = (d.dmg[0] + d.dmg[1]) / 2;
        assert.ok(Math.abs(avg / mobDmgCurve(L) - 1) < 0.15, `esqueleto nivel ${L}: ${avg} vs ${mobDmgCurve(L).toFixed(1)}`);
    }
    // el goblin de diseño pegaba 4-7 a nivel 1: ahora lleva el ×3,5
    assert.deepEqual(MOBS.goblin.dmg, [Math.round(4 * mobDmgMult(1)), Math.round(7 * mobDmgMult(1))]);
    for (const L of [5, 10, 15, 20].map(relevel)) assert.ok(bossDmgMult(L) < mobDmgMult(L) && bossDmgMult(L) > 1, `jefe nivel ${L}`);
    for (const t of Object.keys(BOSS_LEVELS) as MobType[]) assert.ok(MOBS[t].boss && MOBS[t].dmg[0] > 0 && MOBS[t].boss!.special.dmg![0] > 0, t);
});

test('6b: la vida regenera por porcentaje fuera de combate (más rápido quieto), con piso de 1', () => {
    assert.equal(hpRegenPerSec(3000, false), 3000 * HP_REGEN.pct); assert.equal(hpRegenPerSec(3000, true), 3000 * HP_REGEN.restPct);
    assert.equal(hpRegenPerSec(50, false), HP_REGEN.min);
    assert.ok(HP_REGEN.restPct > HP_REGEN.pct && HP_REGEN.calmMs > 0);
});

test('6b: el maná regenera más contra monstruos (2 %, mínimo 3) y el PvP queda como en K7 (1 %, mínimo 5)', () => {
    assert.equal(combatMpRegen(100), PVE_MP_REGEN.min); assert.equal(combatMpRegen(500), Math.round(500 * PVE_MP_REGEN.pct));
    assert.equal(pvpMpRegen(84), 5); assert.equal(pvpMpRegen(1000), 10);
});

// Nota (integración con main, 4/11): con el modelo de ítems nuevo (equipo por ilvl) el paladín de nivel 20 recibe un poco menos (5,7 %); piso bajado de 6 a 5 (también en 30 y 40).
test('6b: con la curva, un común de tu nivel le saca al paladín una parte chica pero real de la vida (sim:pve)', () => {
    for (const [L, lo, hi] of [[relevel(10), 3, 15], [relevel(20), 5, 16], [relevel(30), 4, 18], [120, 4, 18]] as const) {
        const r = many({ cls: 'guerrero', lvl: L, foe: foeAt('comun', L) }, 12);
        assert.ok(r.win === 1, `gana nivel ${L}`);
        assert.ok(r.tookPct >= lo && r.tookPct <= hi, `nivel ${L}: le saca ${r.tookPct.toFixed(1)} %`);
    }
    for (const L of [25, 30, 40].map(relevel)) assert.ok(many({ cls: 'guerrero', lvl: L, foe: foeAt('elite', L) }, 8).win >= 0.75, `élite nivel ${L}`);
});
