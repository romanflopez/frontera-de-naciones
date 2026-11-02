/** Pendiente: el Healer todavía no existe (ni en el server ni en abilities.ts). */
import type { Scenario } from './types.ts';
export default { name: 'paladin_vs_healer_empate', run: () => ({ metrics: {}, checks: [], skipped: 'falta la clase Healer' }) } satisfies Scenario;
