/** Chains of Ice ×4 en 15 s → 5 / 2.5 / 1.25 / 0 (DR 100/50/25/0 % sobre 5 s). */
import { AB } from '../abilities.ts';
import { drSeries } from './dr.ts';
import type { Scenario } from './types.ts';
export default { name: 'dr_cc', run: () => drSeries('paralisis', AB.chains.cc!.ms, 4000, [5, 2.5, 1.25, 0]) } satisfies Scenario;
