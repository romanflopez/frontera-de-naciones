/** Políticas de bot para simulateFight. Cada una decide una acción por tick mirando la `View`. */
import type { Action, Policy, View } from './simulateFight.ts';
import type { AbilityKey } from './abilities.ts';

const away = (v: View): -1 | 1 => (v.self.pos >= v.foe.pos ? 1 : -1);
const toward = (v: View): -1 | 1 => (away(v) === 1 ? -1 : 1);
const tryCast = (v: View, k: AbilityKey): Action => (v.ready(k) && v.inRange(k) ? { cast: k } : null);

/** No hace nada (muñeco de prueba para combos). */
export const idle: Policy = () => null;

/** Mago que kitea: Blink si lo alcanzan, Chains si se acerca, Ice Shard para frenar, Firebolt a distancia; corre si está muy cerca. */
export const mageKite: Policy = (v) => {
    const close = v.dist <= 3.5;
    if (close && v.ready('blink')) return { cast: 'blink' };
    if (v.foe.frozen) return tryCast(v, 'iceShard') ?? tryCast(v, 'fireball') ?? tryCast(v, 'ignite') ?? tryCast(v, 'firebolt');
    if (v.dist <= 6 && !close) { const c = tryCast(v, 'chains'); if (c) return c; }
    if (close) return tryCast(v, 'chains') ?? { move: away(v), run: true };
    if (v.dist < 8 && !v.foe.status.slowEndTime) { const c = tryCast(v, 'iceShard'); if (c) return c; }
    return tryCast(v, 'ignite') ?? tryCast(v, 'fireball') ?? tryCast(v, 'firebolt') ?? { move: toward(v) };
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
