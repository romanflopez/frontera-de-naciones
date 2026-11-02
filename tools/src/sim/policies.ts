/** Políticas de bot para simulateFight. Cada una decide una acción por tick mirando la `View`. */
import type { Action, Policy, View } from './simulateFight.ts';
import type { AbilityKey } from './abilities.ts';

const away = (v: View): -1 | 1 => (v.self.pos >= v.foe.pos ? 1 : -1);
const toward = (v: View): -1 | 1 => (away(v) === 1 ? -1 : 1);
const tryCast = (v: View, k: AbilityKey): Action => (v.ready(k) && v.inRange(k) ? { cast: k } : null);

/** No hace nada (muñeco de prueba para combos). */
export const idle: Policy = () => null;

/**
 * Mago que kitea con gestión de maná (pct = maná actual / máximo), por prioridad:
 * 1. < 15 %: no castea. Ataque básico si está en alcance (no hay regen); si no, camina hacia atrás.
 * 2. Paladin a ≤2, Blink listo y > 20 % → Blink.
 * 3. < 30 %: solo Firebolt (nada de Blink/Chains/Fireball).
 * 4. > 60 % y Paladin a ≤5 sin congelar → Chains.
 * 5. > 40 % y Paladin congelado o a >6 → Fireball.
 * 6. Filler: Firebolt mientras haya maná. Si no se puede, caminar hacia atrás (walk) o acercarse si está fuera de alcance.
 */
export const mageKite: Policy = (v) => {
    const pct = v.self.mp / v.self.stats.maxMp;
    const fallback = (): Action => (v.dist > 6 && !v.inRange('firebolt') ? { move: toward(v) } : { move: away(v) });
    if (pct < 0.15) return tryCast(v, 'ataque') ?? { move: away(v) };
    if (v.dist <= 2 && pct > 0.2) { const c = tryCast(v, 'blink'); if (c) return c; }
    if (pct < 0.3) return tryCast(v, 'firebolt') ?? fallback();
    if (pct > 0.6 && v.dist <= 5 && !v.foe.frozen) { const c = tryCast(v, 'chains'); if (c) return c; }
    if (pct > 0.4 && (v.foe.frozen || v.dist > 6)) { const c = tryCast(v, 'fireball'); if (c) return c; }
    return tryCast(v, 'firebolt') ?? fallback();
};

/** Paladin que cierra: Holy Charge apenas está en alcance; en melee Hammer → Strike → ataque; si no, corre. */
export const paladinClose: Policy = (v) => {
    if (v.dist > 2.6) return tryCast(v, 'holyCharge') ?? { move: toward(v), run: true };
    return tryCast(v, 'hammer') ?? tryCast(v, 'strike') ?? tryCast(v, 'ataque');
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
