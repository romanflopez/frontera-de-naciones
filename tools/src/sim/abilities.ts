/**
 * Kit PvP para la simulación (P0-D). Nombre del doc (docs/COMBATE.md) → id del server cuando existe.
 * Con `server` el daño, la recarga, el maná y la duración del CC salen de pvpCombat.ts (PVP_SPELLS / SKILLS).
 * Sin `server` (`simOnly`) la habilidad todavía no está en el código: los números son los del doc y hay que
 * reemplazarlos cuando se implemente.
 */
import { PVP_SPELLS, SKILLS, castMsOf, isCast, type DmgKind } from '../../../apps/server/src/systems/pvpCombat.ts';
import type { CcKind } from '../../../apps/server/src/systems/statusSystem.ts';

export interface Ability {
    name: string;
    /** id del server (PVP_SPELLS o SKILLS); undefined = solo existe en la sim */
    server?: string;
    simOnly?: boolean;
    castMs: number; range: number; cd: number; mp: number;
    /** daño propio (solo simOnly): base, por nivel, escala con 'mag' o 'wdmg' */
    dmg?: { base: [number, number]; lvlK: number; stat: 'mag' | 'wdmg' };
    kind: DmgKind;
    /** CC duro con DR (ms antes del DR) */
    cc?: { kind: CcKind; ms: number };
    slowMs?: number;
    /** Daño en el tiempo: ticks × cada ms (el daño por tick es el rollo / ticks) */
    dot?: { ticks: number; everyMs: number };
    /** Multiplicador de daño si el objetivo está congelado/aturdido */
    vsFrozen?: number;
    blink?: number;
    /** Gap closer: se para al lado del objetivo */
    charge?: boolean;
}

/** Arma una habilidad a partir del server; `over` solo para lo que el server no modela (p. ej. el CC de un skill). */
function fromServer(name: string, id: string, over: Partial<Ability> = {}): Ability {
    const sp = PVP_SPELLS[id] ?? SKILLS[id];
    if (!sp) throw new Error(`id de server desconocido: ${id}`);
    const phys = sp.stat === 'melee' || sp.stat === 'wdmg' || !!sp.melee;
    const a: Ability = { name, server: id, castMs: isCast(id) ? castMsOf(id) : 0, range: sp.range, cd: sp.cd, mp: sp.mp, kind: phys ? 'phys' : 'magic' };
    if (sp.secs && !sp.dmg) a.cc = { kind: id === 'aturdir' ? 'aturdir' : 'paralisis', ms: sp.secs * 1000 };
    const slow = (sp as { slow?: number }).slow; if (slow) a.slowMs = slow * 1000;
    return { ...a, ...over };
}

export const AB = {
    // ---- Mago ----
    firebolt: fromServer('Firebolt', 'proyectil'),
    fireball: fromServer('Fireball', 'bola'),
    chains: fromServer('Chains of Ice', 'paralisis'),
    blink: fromServer('Blink', 'blink', { castMs: 0, blink: 7 }),
    iceShard: { name: 'Ice Shard', simOnly: true, castMs: 750, range: 9, cd: 8, mp: 12, dmg: { base: [10, 14], lvlK: 2, stat: 'mag' }, kind: 'magic', slowMs: 3000, vsFrozen: 1.5 } as Ability,
    ignite: { name: 'Ignite', simOnly: true, castMs: 750, range: 9, cd: 6, mp: 12, dmg: { base: [12, 18], lvlK: 2, stat: 'mag' }, kind: 'magic', dot: { ticks: 4, everyMs: 1000 } } as Ability,
    // ---- Paladin (clase 'guerrero') ----
    holyCharge: fromServer('Holy Charge', 'carga', { charge: true }),
    hammer: fromServer('Hammer of Justice', 'aturdir'),
    strike: fromServer('Strike', 'golpe'),
    smite: { name: 'Smite', simOnly: true, castMs: 0, range: 2.8, cd: 6, mp: 12, dmg: { base: [16, 22], lvlK: 2, stat: 'wdmg' }, kind: 'magic' } as Ability,
    ataque: fromServer('Ataque', 'ataque'),
} satisfies Record<string, Ability>;
export type AbilityKey = keyof typeof AB;

export const KITS = {
    mago: ['firebolt', 'fireball', 'chains', 'blink', 'iceShard', 'ignite', 'ataque'],
    paladin: ['holyCharge', 'hammer', 'strike', 'smite', 'ataque'],
} satisfies Record<string, AbilityKey[]>;
