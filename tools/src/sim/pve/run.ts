/**
 * Simulación PvE por clase y nivel (etapa 6b del roadmap). Mide, contra mobs de tu nivel:
 *  - tiempo para matar un común y un élite, y cuánta vida te sacan;
 *  - farmeo encadenado de 30 min: kills por hora, tiempo parado a recuperarse, muertes y pociones;
 *  - horas por tramo con la curva de exp real (killsToLevel).
 *
 *   pnpm --filter @fdn/tools sim:pve [--lvl 1,5,10,20,30,40] [--n 40] [--cls paladin,mago,clerigo] [--horas]
 *
 * Sale con código 1 si algún nivel queda fuera de las metas (pve/targets.ts).
 */
import { BOSS_LEVELS, hpRegenPerSec, killsToLevel, MAX_LEVEL, MEDITATE, type MobType } from '@fdn/world';
import { buildStats, CLS_NAME, type Cls } from '../pvp/builds.ts';
import { farm, foeAt, many } from './engine.ts';
import { PVE_TARGETS, TRAVEL_S } from './targets.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const lvls = (arg('lvl') ?? '1,3,5,8,10,15,20,25,30,35,40').split(',').map(Number);
const n = Number(arg('n') ?? 40), clss = (arg('cls') ?? 'paladin,mago,clerigo').split(',') as Cls[];
const f1 = (x: number) => x.toFixed(1), f0 = (x: number) => x.toFixed(0);
const farmAt = (cls: Cls, lvl: number, secs = 1800) => farm(cls, lvl, secs, 7000 + lvl, TRAVEL_S, hpRegenPerSec, MEDITATE);

let bad = 0;
for (const cls of clss) {
    console.log(`\n## ${CLS_NAME[cls]}\n`);
    console.log('| Nivel | Vida | Común: s | Común: vida que saca | Élite: s | Élite: vida que saca | Élite: gana | Farmeo: kills/h | Parado | Muertes/h | Pociones/h | |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const lvl of lvls) {
        const s = buildStats(cls, lvl), c = many({ cls, lvl, foe: foeAt('comun', lvl) }, n), e = many({ cls, lvl, foe: foeAt('elite', lvl) }, n), fm = farmAt(cls, lvl);
        const t = PVE_TARGETS.check(cls, lvl, { ttk: c.secs, took: c.tookPct, eliteWin: e.win, rest: fm.restFrac, deaths: fm.deaths });
        if (!t.ok) bad++;
        console.log(`| ${lvl} | ${s.maxHp} | ${f1(c.secs)} | ${f0(c.tookPct)} % | ${f1(e.secs)} | ${f0(e.tookPct)} % | ${f0(e.win * 100)} % | ${f0(fm.killsPerHour)} | ${f0(fm.restFrac * 100)} % | ${f1(fm.deaths)} | ${f1(fm.potsPerHour)} | ${t.ok ? '✓' : '✗ ' + t.why.join(', ')} |`);
    }
}

if (process.argv.includes('--horas') || !arg('lvl')) {
    console.log('\n## Horas hasta cada nivel (un mob por vez, farmeo encadenado)\n');
    console.log('| Clase | 1 → 10 | 10 → 20 | 20 → 30 | 30 → 40 | Total |');
    console.log('|---|---|---|---|---|---|');
    for (const cls of clss) {
        const per: number[] = [];
        for (let L = 1; L < Math.min(MAX_LEVEL, 40); L++) per.push(killsToLevel(L) / farmAt(cls, L, 900).killsPerHour);
        const sum = (a: number, b: number) => per.slice(a - 1, b - 1).reduce((x, y) => x + y, 0);
        console.log(`| ${CLS_NAME[cls]} | ${f1(sum(1, 10))} | ${f1(sum(10, 20))} | ${f1(sum(20, 30))} | ${f1(sum(30, 40))} | ${f1(sum(1, 40))} |`);
    }
    console.log('\n## Jefes de mazmorra de a uno, con el escalado para jugar solo del PR #17 (vida ×0,5, daño ×0,85)\n');
    console.log('| Jefe | Nivel | Vida | Clase | Tiempo | Gana | Pociones |');
    console.log('|---|---|---|---|---|---|---|');
    for (const [boss, L] of Object.entries(BOSS_LEVELS) as [MobType, number][]) for (const cls of clss) {
        const r = many({ cls, lvl: L, foe: foeAt('jefe', L, boss, true), maxSecs: 600 }, Math.max(10, Math.round(n / 2)));
        console.log(`| ${boss} | ${L} | ${foeAt('jefe', L, boss, true).hp} | ${CLS_NAME[cls]} | ${f0(r.secs)} s | ${f0(r.win * 100)} % | ${f1(r.pots)} |`);
    }
}
console.log(`\nViaje entre mobs: ${TRAVEL_S} s. Fuera de meta: ${bad}`);
process.exitCode = bad ? 1 : 0;
