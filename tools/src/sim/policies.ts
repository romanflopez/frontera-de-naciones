/** Políticas de bot para simulateFight. Cada una decide una acción por tick mirando la `View`. */
import type { Action, Policy, View } from './simulateFight.ts';
import type { AbilityKey } from './abilities.ts';

const away = (v: View): -1 | 1 => (v.self.pos >= v.foe.pos ? 1 : -1);
const toward = (v: View): -1 | 1 => (away(v) === 1 ? -1 : 1);
const tryCast = (v: View, k: AbilityKey): Action => (v.ready(k) && v.inRange(k) ? { cast: k } : null);

/** No hace nada (muñeco de prueba para combos). */
export const idle: Policy = () => null;

/**
 * Mago que kitea, por prioridad:
 * 1. Paladin a ≤3 y Blink listo → Blink alejándose.
 * 2. Paladin a ≤5 y Chains lista → Chains.
 * 3. Paladin a ≤5 y Chains en recarga → Ice Shard.
 * 4. Paladin congelado o a >6 → Fireball si está lista; si no, Firebolt.
 * 5. Sin nada de lo anterior (incluye ≤2 sin CC/Blink) → caminar hacia atrás (walk, no run).
 *    Firebolt no es instantáneo (cast 1.5 s) y moverse cancela el cast, así que acá no se castea.
 */
export const mageKite: Policy = (v) => {
    if (v.dist <= 3 && v.ready('blink')) return { cast: 'blink' };
    if (v.dist <= 5 && !v.foe.frozen) {
        if (v.ready('chains')) { const c = tryCast(v, 'chains'); if (c) return c; }
        else { const c = tryCast(v, 'iceShard'); if (c) return c; }
    }
    if (v.foe.frozen || v.dist > 6) { const c = tryCast(v, 'fireball') ?? tryCast(v, 'firebolt'); if (c) return c; if (v.dist > 6) return { move: toward(v) }; }
    return { move: away(v) };
};

/** Paladin que cierra: Holy Charge apenas está en alcance; en melee Hammer → Smite → Strike → ataque; si no, corre. */
export const paladinClose: Policy = (v) => {
    if (v.dist > 2.6) return tryCast(v, 'holyCharge') ?? { move: toward(v), run: true };
    return tryCast(v, 'hammer') ?? tryCast(v, 'smite') ?? tryCast(v, 'strike') ?? tryCast(v, 'ataque');
};

/** Secuencia fija: lanza cada habilidad en orden apenas esté lista (combos). */
export function script(seq: AbilityKey[]): Policy {
    let i = 0;
    return (v) => {
        if (i >= seq.length) return null;
        const k = seq[i];
        if (v.ready(k) && v.inRange(k)) { i++; return { cast: k }; }
        return v.inRange(k) ? null : { move: toward(v) };
    };
}
