/** Hammer of Justice ×4 en 15 s → 3 / 1.5 / 0.75 / 0. */
import { AB } from '../abilities.ts';
import { drSeries } from './dr.ts';
import type { Scenario } from './types.ts';
export default { name: 'dr_stun', run: () => drSeries('aturdir', AB.hammer.cc!.ms, 4000, [3, 1.5, 0.75, 0]) } satisfies Scenario;
