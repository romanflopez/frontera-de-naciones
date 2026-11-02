/** Holy Charge → Hammer → Strike ×2. */
import { combo } from './combo.ts';
import type { Scenario } from './types.ts';
export default { name: 'combo_paladin', run: (seed) => combo(seed, 'paladin', 'mago', ['holyCharge', 'hammer', 'strike', 'strike'], 6, 10) } satisfies Scenario;
