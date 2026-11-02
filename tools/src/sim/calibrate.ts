/**
 * Barrido de las reglas de PvP (K7): prueba combinaciones de multiplicador, tope por golpe, pociones y regeneración de maná,
 * y ordena por qué tan cerca quedan todos los enfrentamientos del objetivo (ver pvp/matchups.ts).
 *
 *   pnpm --filter @fdn/tools sim:pvp:calibrar [--lvl 12] [--n 12] [--top 10]
 *     [--mult 0.6,0.8,1] [--cap 0.2,0.25] [--potlock 10,20,30] [--pot 0.25,0.5] [--regen 0.01,0.02]
 */
import { runAll, TARGET, type Row } from './pvp/matchups.ts';
import { SERVER_RULES, type Rules } from './pvp/rules.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const list = (k: string, d: number[]) => (arg(k) ? arg(k)!.split(',').map(Number) : d);

const lvl = Number(arg('lvl') ?? 12), n = Number(arg('n') ?? 12), top = Number(arg('top') ?? 10);
const grid = {
    mult: list('mult', [0.6, 0.8, 1, 1.2]), cap: list('cap', [0.25]), lock: list('potlock', [10, 20, 30, 60]),
    pot: list('pot', [0.25, 0.5]), regen: list('regen', [SERVER_RULES.mpRegenPct]), rmin: list('regenmin', [SERVER_RULES.mpRegenMin]),
};

/** Penalidad de un enfrentamiento: 0 si cumple todo. */
export function penalty(r: Row): number {
    const lo = TARGET.oneMin, hi = r.size === 1 ? TARGET.oneMax : TARGET.twoMax;
    const dur = r.secsMed < lo ? (lo - r.secsMed) / 10 : r.secsMed > hi ? (r.secsMed - hi) / 10 : 0;
    return dur + Math.max(0, r.winnerHpMed - TARGET.winnerHpMax) / 10 + Math.max(0, r.burstP90 - TARGET.burstMax) / 10 + r.draws / 20;
}

const out: { rules: Rules; score: number; fails: number; rows: Row[] }[] = [];
const t0 = performance.now();
for (const dmgMult of grid.mult) for (const hitCap of grid.cap) for (const lock of grid.lock) for (const potMult of grid.pot) for (const mpRegenPct of grid.regen) for (const mpRegenMin of grid.rmin) {
    const rules: Rules = { ...SERVER_RULES, dmgMult, hitCap, potLockMs: lock * 1000, potMult, mpRegenPct, mpRegenMin, renewTotal: process.argv.includes('--renovar-total') || SERVER_RULES.renewTotal };
    const rows = runAll(lvl, rules, n);
    out.push({ rules, rows, score: Math.round(rows.reduce((a, r) => a + penalty(r), 0) * 10) / 10, fails: rows.filter((r) => !r.ok).length });
}
out.sort((a, b) => a.fails - b.fails || a.score - b.score);
console.log(`Nivel ${lvl} · ${out.length} combinaciones × ${n} peleas · ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
console.log('| ×daño | tope | pociones (s) | tamaño | regen | piso | fuera | penalidad | duraciones 1v1 | duraciones 2v2 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const o of out.slice(0, top)) {
    const d = (s: 1 | 2) => o.rows.filter((r) => r.size === s).map((r) => r.secsMed).join(' / ');
    console.log(`| ${o.rules.dmgMult} | ${o.rules.hitCap} | ${o.rules.potLockMs / 1000} | ${o.rules.potMult} | ${o.rules.mpRegenPct} | ${o.rules.mpRegenMin} | ${o.fails} | ${o.score} | ${d(1)} | ${d(2)} |`);
}
