/** Utilidad para combos: un atacante con secuencia fija contra un muñeco quieto. Doc: un combo completo saca 40–55 % de la barra. */
import { simulateFight, type ClassId } from '../simulateFight.ts';
import { idle, script } from '../policies.ts';
import type { AbilityKey } from '../abilities.ts';
import type { ScenarioOut } from './types.ts';

export function combo(seed: number, cls: ClassId, foeCls: ClassId, seq: AbilityKey[], dist: number, maxDuration: number): ScenarioOut {
    const r = simulateFight({ seed, maxDuration, a: { class: cls, level: 10, policy: script(seq), pos: 0 }, b: { class: foeCls, level: 10, policy: idle, pos: dist } });
    const pct = Math.round((r.a.dmgDone / r.b.maxHp) * 1000) / 10;
    return {
        result: r,
        metrics: { duration: r.duration, comboPct: pct, casts: r.a.casts, castsInterrupted: r.castsInterrupted, cdsUsed: r.cdsUsed, drProcs: r.drProcs },
        checks: [
            { label: 'todas las habilidades salieron', expected: `${seq.length}`, actual: `${r.a.casts}`, ok: r.a.casts === seq.length },
            { label: 'combo saca 40–55 % de la barra', expected: '40–55', actual: `${pct}`, ok: pct >= 40 && pct <= 55 },
        ],
    };
}
