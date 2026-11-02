/** Holy Charge → Hammer → Smite ×2 (el segundo Smite espera su recarga). */
import { combo } from './combo.ts';
import type { Scenario } from './types.ts';
export default { name: 'combo_paladin', run: (seed) => combo(seed, 'paladin', 'mago', ['holyCharge', 'hammer', 'smite', 'smite'], 6, 10) } satisfies Scenario;
