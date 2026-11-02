/** Aplica el mismo CC N veces dentro de la ventana de DR (statusSystem real) y compara con lo que pide el doc. */
import { applyParalysis, createDefaultStatus, type CcKind } from '../../../../apps/server/src/systems/statusSystem.ts';
import type { ScenarioOut } from './types.ts';

export function drSeries(kind: CcKind, baseMs: number, gapMs: number, expected: number[]): ScenarioOut {
    const st = createDefaultStatus(), got: number[] = [];
    for (let i = 0; i < expected.length; i++) got.push(applyParalysis(st, 1_000_000 + i * gapMs, baseMs, kind) / 1000);
    const drProcs = got.filter((g) => g * 1000 < baseMs).length;
    return {
        metrics: { applied: got.join(' / '), drProcs },
        checks: [{ label: `${kind} ×${expected.length} en 15 s`, expected: expected.join(' / '), actual: got.join(' / '), ok: got.every((g, i) => Math.abs(g - expected[i]) < 0.01) }],
    };
}
