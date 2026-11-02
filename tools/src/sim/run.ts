/**
 * Corre todos los escenarios PvP dos veces con la misma semilla y verifica: mismo resultado, < 5 s en total.
 *   pnpm --filter @fdn/tools sim:pvp [semilla] [--log]
 */
import type { Scenario } from './scenarios/types.ts';
import gap from './scenarios/paladin_vs_mago_gap.ts';
import palHeal from './scenarios/paladin_vs_healer_empate.ts';
import magHeal from './scenarios/mago_vs_healer_burst.ts';
import comboMago from './scenarios/combo_mago.ts';
import comboPal from './scenarios/combo_paladin.ts';
import drCc from './scenarios/dr_cc.ts';
import drStun from './scenarios/dr_stun.ts';

const SCENARIOS: Scenario[] = [gap, palHeal, magHeal, comboMago, comboPal, drCc, drStun];
const seed = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 12345, log = process.argv.includes('--log');

const t0 = performance.now();
let deterministic = true, failed = 0;
for (const sc of SCENARIOS) {
    const o1 = sc.run(seed), o2 = sc.run(seed);
    const same = JSON.stringify(o1) === JSON.stringify(o2);
    if (!same) deterministic = false;
    if (o1.skipped) { console.log(`\n■ ${sc.name}: SALTEADO (${o1.skipped})`); continue; }
    console.log(`\n■ ${sc.name}${same ? '' : '  ✗ NO DETERMINISTA'}`);
    console.log('  ' + Object.entries(o1.metrics).map(([k, v]) => `${k}=${v}`).join('  '));
    for (const c of o1.checks) { if (!c.ok) failed++; console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}: esperado ${c.expected}, dio ${c.actual}`); }
    if (log && o1.result) for (const e of o1.result.events) console.log('    ' + e);
}
const ms = performance.now() - t0;
console.log(`\nTotal ${ms.toFixed(0)} ms (×2 corridas) ${ms < 5000 ? '✓' : '✗'} < 5 s · determinista ${deterministic ? '✓' : '✗'} · checks de balance fallidos: ${failed}`);
process.exitCode = ms < 5000 && deterministic ? 0 : 1;
