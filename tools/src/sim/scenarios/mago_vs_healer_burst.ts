/** Pendiente: el Healer todavía no existe (ni en el server ni en abilities.ts). */
import type { Scenario } from './types.ts';
export default { name: 'mago_vs_healer_burst', run: () => ({ metrics: {}, checks: [], skipped: 'falta la clase Healer' }) } satisfies Scenario;
