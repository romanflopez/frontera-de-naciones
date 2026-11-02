/**
 * Simulación PvP de K7 con las 3 clases: 1v1 y 2v2 con muchas semillas, contra los números que hoy tiene el server.
 *
 *   pnpm --filter @fdn/tools sim:pvp [--lvl 12] [--n 60] [--mult 0.6] [--cap 0.25] [--potlock 10] [--pot 0.5] [--log "paladín vs mago"]
 *
 * Sin parámetros mide lo que está en pvpCombat.ts. Con `--log` imprime una pelea entera del enfrentamiento pedido.
 * Sale con código 1 si algún enfrentamiento queda fuera del objetivo (ver pvp/matchups.ts).
 */
import { BOTS } from './pvp/bots.ts';
import { simulate } from './pvp/engine.ts';
import { ONE_V_ONE, TWO_V_TWO, runAll, table } from './pvp/matchups.ts';
import { SERVER_RULES, type Rules } from './pvp/rules.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const num = (k: string, d: number) => (arg(k) !== undefined ? Number(arg(k)) : d);

const rules: Rules = {
    ...SERVER_RULES,
    dmgMult: num('mult', SERVER_RULES.dmgMult), hitCap: num('cap', SERVER_RULES.hitCap),
    potLockMs: num('potlock', SERVER_RULES.potLockMs / 1000) * 1000, potMult: num('pot', SERVER_RULES.potMult), mpRegenPct: num('regen', SERVER_RULES.mpRegenPct), mpRegenMin: num('regenmin', SERVER_RULES.mpRegenMin),
    poisonOn: arg('veneno') ? arg('veneno')!.split(',') : SERVER_RULES.poisonOn, healCd: num('curacd', SERVER_RULES.healCd), castigoMult: num('castigo', SERVER_RULES.castigoMult), renewTotal: process.argv.includes('--renovar-total'),
};
const lvls = (arg('lvl') ?? '12').split(',').map(Number), n = num('n', 60);

const want = arg('log');
if (want) {
    const m = [...ONE_V_ONE, ...TWO_V_TWO].find((x) => x.name === want);
    if (!m) { console.error(`No existe "${want}". Opciones: ${[...ONE_V_ONE, ...TWO_V_TWO].map((x) => x.name).join(' · ')}`); process.exit(2); }
    const r = simulate({ lvl: lvls[0], rules, seed: num('seed', 1000), log: true, teams: [m.a.map((cls) => ({ cls, policy: BOTS[cls] })), m.b.map((cls) => ({ cls, policy: BOTS[cls] }))] });
    for (const e of r.events) console.log(e);
    console.log(`\n${r.secs} s · gana ${r.winner < 0 ? 'nadie' : r.winner ? 'B' : 'A'} con ${r.winnerHpPct} % · ráfaga 3 s ${r.burst3sPct} %`);
    for (const f of r.fighters) console.log(`  ${f.name}: vida ${f.hp}/${f.s.maxHp}, daño ${f.m.dmg}, cura ${f.m.heal}, pociones ${f.m.pots} (${f.m.potsMp} de maná), sin maná ${f.m.starved.toFixed(0)} s, alientos ${f.m.winds}, por hechizo ${JSON.stringify(f.m.bySpell)}`);
    process.exit(0);
}

const t0 = performance.now();
let bad = 0;
console.log(`Reglas: ×${rules.dmgMult} · tope por golpe ${rules.hitCap * 100} % · pociones cada ${rules.potLockMs / 1000} s al ${rules.potMult * 100} % · ${n} peleas por enfrentamiento\n`);
for (const lvl of lvls) {
    const rows = runAll(lvl, rules, n);
    bad += rows.filter((r) => !r.ok).length;
    console.log(`### Nivel ${lvl}\n\n${table(rows)}\n`);
}
console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s · fuera de objetivo: ${bad}`);
process.exitCode = bad ? 1 : 0;
