/** Mago kitea (slow/root/Blink), Paladin cierra (Holy Charge). Doc: pelea 20–40 s; fuera de 10–60 s = balance roto. */
import { simulateFight } from '../simulateFight.ts';
import { mageKite, paladinClose } from '../policies.ts';
import type { Scenario } from './types.ts';

export default {
    name: 'paladin_vs_mago_gap',
    run(seed) {
        const r = simulateFight({ seed, maxDuration: 120, a: { class: 'paladin', level: 10, policy: paladinClose, pos: -7 }, b: { class: 'mago', level: 10, policy: mageKite, pos: 7 } });
        const { duration, winner, winnerHpPct, castsInterrupted, cdsUsed, drProcs } = r;
        return {
            result: r, metrics: { duration, winner, winnerHpPct, castsInterrupted, cdsUsed, drProcs },
            checks: [{ label: 'duración en 10–60 s', expected: '10–60', actual: `${duration}`, ok: duration >= 10 && duration <= 60 }],
        };
    },
} satisfies Scenario;
