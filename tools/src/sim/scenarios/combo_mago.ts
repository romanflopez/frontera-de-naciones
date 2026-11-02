/** Ignite → Fireball → Ice Shard (este último con el objetivo congelado por Chains of Ice). */
import { combo } from './combo.ts';
import type { Scenario } from './types.ts';
export default { name: 'combo_mago', run: (seed) => combo(seed, 'mago', 'paladin', ['chains', 'ignite', 'fireball', 'iceShard'], 7, 8) } satisfies Scenario;
