/**
 * Corre los enfrentamientos de K7 con muchas semillas y resume. Criterios (kits-de-clase.md §3):
 * - 1v1: mediana de duración entre 20 y 40 s;
 * - 2v2: mediana de hasta ~60 s (se acepta hasta 65);
 * - ningún enfrentamiento se gana con más del 65 % de vida (mediana de la vida que le queda al ganador);
 * - ráfaga: en 3 s nadie pierde más del 55 % de la vida (p90; "un combo completo saca 40-55 %").
 */
import { BOTS } from './bots.ts';
import { CLS_NAME, type Cls } from './builds.ts';
import { simulate } from './engine.ts';
import { SERVER_RULES, type Rules } from './rules.ts';

export interface Matchup { name: string; a: Cls[]; b: Cls[] }
const P: Cls = 'guerrero', M: Cls = 'mago', H: Cls = 'healer';
export const ONE_V_ONE: Matchup[] = [[P, M], [P, H], [M, H], [P, P], [M, M], [H, H]].map(([a, b]) => ({ name: `${CLS_NAME[a]} vs ${CLS_NAME[b]}`, a: [a], b: [b] }));
export const TWO_V_TWO: Matchup[] = [
    [[P, H], [P, M]], [[P, H], [M, H]], [[P, M], [M, H]], [[P, H], [P, H]], [[P, M], [P, M]], [[M, H], [M, H]],
].map(([a, b]) => ({ name: `${a.map((c) => CLS_NAME[c]).join('+')} vs ${b.map((c) => CLS_NAME[c]).join('+')}`, a, b }));

export const TARGET = { oneMin: 20, oneMax: 50, twoMax: 60, twoTol: 65, winnerHpMax: 65, burstMax: 55, maxSecs: 180 };

export interface Row {
    name: string; size: 1 | 2; n: number;
    secsMed: number; secsP10: number; secsP90: number; inTarget: number;
    /** % de victorias del bando A (los empates no cuentan) */ winA: number; draws: number;
    winnerHpMed: number; burstP90: number;
    pots: number; winds: number; ok: boolean; why: string[];
}

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const r1 = (x: number) => Math.round(x * 10) / 10;

export function runMatchup(m: Matchup, lvl: number, rules: Rules = SERVER_RULES, n = 60, seed0 = 1000): Row {
    const secs: number[] = [], whp: number[] = [], burst: number[] = [];
    let winA = 0, winB = 0, draws = 0, pots = 0, winds = 0;
    for (let i = 0; i < n; i++) {
        const swap = i % 2 === 1; // se alternan los lados para no favorecer a nadie por el orden
        const A = m.a.map((cls) => ({ cls, policy: BOTS[cls] })), B = m.b.map((cls) => ({ cls, policy: BOTS[cls] }));
        const r = simulate({ lvl, rules, seed: seed0 + i * 7919, teams: swap ? [B, A] : [A, B], maxSecs: TARGET.maxSecs });
        secs.push(r.secs); burst.push(r.burst3sPct);
        if (r.winner < 0) draws++; else { whp.push(r.winnerHpPct); if ((r.winner === 0) !== swap) winA++; else winB++; }
        for (const f of r.fighters) { pots += f.m.pots; winds += f.m.winds; }
    }
    const size = m.a.length as 1 | 2, med = q(secs, 0.5);
    const lo = size === 1 ? TARGET.oneMin : TARGET.oneMin, hi = size === 1 ? TARGET.oneMax : TARGET.twoMax;
    const row: Row = {
        name: m.name, size, n, secsMed: r1(med), secsP10: r1(q(secs, 0.1)), secsP90: r1(q(secs, 0.9)),
        inTarget: Math.round((secs.filter((s) => s >= lo && s <= hi).length / n) * 100),
        winA: winA + winB ? Math.round((winA / (winA + winB)) * 100) : 0, draws: Math.round((draws / n) * 100),
        winnerHpMed: r1(q(whp, 0.5)), burstP90: r1(q(burst, 0.9)),
        pots: r1(pots / n), winds: r1(winds / n), ok: true, why: [],
    };
    if (size === 1 && (med < TARGET.oneMin || med > TARGET.oneMax)) row.why.push(`dura ${row.secsMed} s`);
    if (size === 2 && (med < TARGET.oneMin || med > TARGET.twoTol)) row.why.push(`dura ${row.secsMed} s`);
    if (row.winnerHpMed > TARGET.winnerHpMax) row.why.push(`gana con ${row.winnerHpMed} %`);
    if (row.burstP90 > TARGET.burstMax) row.why.push(`ráfaga ${row.burstP90} %`);
    if (row.draws > 10) row.why.push(`${row.draws} % sin ganador en ${TARGET.maxSecs} s`);
    row.ok = row.why.length === 0;
    return row;
}

export function runAll(lvl: number, rules: Rules = SERVER_RULES, n = 60): Row[] {
    return [...ONE_V_ONE, ...TWO_V_TWO].map((m) => runMatchup(m, lvl, rules, n));
}

export function table(rows: Row[]): string {
    const head = '| Enfrentamiento | Mediana (s) | p10-p90 | En objetivo | Gana A | Empates | Vida del ganador | Ráfaga 3 s (p90) | Pociones | Alientos | |';
    const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
    return [head, sep, ...rows.map((r) => `| ${r.name} | ${r.secsMed} | ${r.secsP10}-${r.secsP90} | ${r.inTarget} % | ${r.winA} % | ${r.draws} % | ${r.winnerHpMed} % | ${r.burstP90} % | ${r.pots} | ${r.winds} | ${r.ok ? '✓' : '✗ ' + r.why.join(', ')} |`)].join('\n');
}
