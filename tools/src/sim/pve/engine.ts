/**
 * Simulación PvE (etapa 6b del roadmap): un personaje típico contra un mob de su nivel, con las fórmulas REALES del server
 * (daño de habilidades, defensa, escudos, curas, pociones, maná) y el kit desbloqueado a ese nivel.
 *
 * Es un modelo de pelea "quieto": el mob llega desde el radio de aggro, el jugador no kitea ni esquiva. Sirve para medir
 * tiempos y recursos por nivel, no la habilidad del jugador. El personaje típico es el mismo de la sim PvP (pvp/builds.ts).
 */
import { CLASS_KITS, CRIT_MULT, HP_REGEN, MOB_AGGRO, mobDef, MOBS, type MobType } from '@fdn/world';
import {
    BURN_EVERY, BURN_TICKS, burnTickDmg, castMsOf, combatMpRegen, damageAfterDefense, healAmount, PVP_SPELLS, potionHp, potionMp,
    POTION_LOCK_PVE_MS, rollSpellDamage, SECOND_WIND, SKILLS, type CombatStats,
} from '../../../../apps/server/src/systems/pvpCombat.ts';
import { buildStats, type Cls } from '../pvp/builds.ts';
import { mulberry } from '../pvp/engine.ts';

export type Foe = 'comun' | 'elite' | 'mazmorra' | 'jefe';
/** Mob de referencia: un esqueleto guerrero reescalado al nivel (cuerpo a cuerpo, sigue las curvas de vida y daño). */
export const REF_MOB: MobType = 'skeleton';
/** Élite: vida ×3 y daño ×1,4 sobre el común de su nivel (los de mazmorra del PR #17 usan el mismo ×3 / ×1,4). */
export const ELITE = { hp: 3, dmg: 1.4 } as const;

export interface FoeDef { name: string; hp: number; dmg: [number, number]; atk: number; spd: number; boss: boolean; special?: { every: number; dmg: [number, number]; stun: number } }
/** Escalado de mazmorra para jugar solo (PR #17: vida ×0,5 y daño ×0,85 con 1 jugador; base 3 = ×1). */
export const SOLO = { hp: 0.5, dmg: 0.85 } as const;
export function foeAt(kind: Foe, lvl: number, boss?: MobType, solo = false): FoeDef {
    if (kind === 'jefe') {
        const b = MOBS[boss!]; const sp = b.boss!.special, k = solo ? SOLO : { hp: 1, dmg: 1 };
        return { name: b.name, hp: Math.round(b.hp * k.hp), dmg: [Math.round(b.dmg[0] * k.dmg), Math.round(b.dmg[1] * k.dmg)], atk: b.atk, spd: b.spd, boss: true, special: { every: sp.every, dmg: sp.dmg ? [Math.round(sp.dmg[0] * k.dmg), Math.round(sp.dmg[1] * k.dmg)] : [0, 0], stun: sp.stun ?? 0 } };
    }
    const d = mobDef(REF_MOB, kind === 'mazmorra' ? { lvl, tier: 'dungeon' } : { lvl });
    const e = kind === 'elite' ? ELITE : { hp: 1, dmg: 1 };
    return { name: kind, hp: Math.round(d.hp * e.hp), dmg: [Math.round(d.dmg[0] * e.dmg), Math.round(d.dmg[1] * e.dmg)], atk: d.atk, spd: d.spd, boss: false };
}

/** Prioridad de habilidades por clase (la primera disponible y pagable se usa). */
const ROTATION: Record<Cls, string[]> = {
    guerrero: ['escudodivino', 'represalia', 'escudo', 'aturdir', 'aura', 'juicio', 'golpe', 'ataque'],
    mago: ['escudomana', 'paralisis', 'ignicion', 'bola', 'esquirla', 'proyectil', 'ataque'],
    healer: ['guardian', 'curacion', 'renovar', 'reprender', 'castigo', 'ataque'],
};
/** Tiempo que ocupa una acción instantánea (animación + reacción humana). */
const INSTANT_S = 0.45;

export interface PveResult { end?: Carry; win: boolean; secs: number; tookPct: number; mpPct: number; hpLeftPct: number; pots: number; potsMp: number; winds: number; starved: number; firstHit: number }
/** Estado que pasa de una pelea a la siguiente (farmeo encadenado). Los tiempos son relativos al inicio de la pelea (negativos = antes). */
export interface Carry { hp: number; mp: number; potAt: number; windAt: number }
export interface PveSpec { cls: Cls; lvl: number; foe: FoeDef; seed: number; startHpPct?: number; potionsAllowed?: boolean; maxSecs?: number; carry?: Carry }

export function fight(spec: PveSpec): PveResult {
    const rnd = mulberry(spec.seed), saved = Math.random; Math.random = rnd;
    try { return run(spec, rnd); } finally { Math.random = saved; }
}

function run(spec: PveSpec, rnd: () => number): PveResult {
    const s: CombatStats = buildStats(spec.cls, spec.lvl), f = spec.foe, kit = CLASS_KITS[spec.cls], dt = 0.05;
    const rint = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
    let hp = spec.carry ? spec.carry.hp : Math.round(s.maxHp * (spec.startHpPct ?? 1)), mp = spec.carry ? spec.carry.mp : s.maxMp, shield = 0, shieldUntil = 0;
    let mobHp = f.hp, mobDist = spec.cls === 'guerrero' ? 0 : MOB_AGGRO, mobNextAtk = 0, mobPar = 0, mobBurn = 0, burnTick = 0, burnDmg = 0, nextSp = f.special ? f.special.every * 0.6 : 1e9, stunned = 0;
    let busyUntil = 0, pending: { id: string; at: number } | null = null, potAt = spec.carry?.potAt ?? -1e9, windAt = spec.carry?.windAt ?? -1e9, windUntil = 0, hot = 0, hotFrac = 0, hotNext = 0, mitigK = 1, mitigUntil = 0;
    const cd = new Map<string, number>(); let took = 0, mpSpent = 0, pots = 0, potsMp = 0, winds = 0, starved = 0, firstHit = -1;
    const max = spec.maxSecs ?? 240;
    const hurt = (raw: number, t: number) => {
        let d = damageAfterDefense(raw, s, 'phys'); if (t < mitigUntil) d = Math.round(d * mitigK);
        if (t < shieldUntil && shield > 0) { const a = Math.min(shield, d); shield -= a; d -= a; }
        hp -= d; took += d; if (firstHit < 0) firstHit = t; if (windUntil > t) windUntil = 0;
    };
    for (let t = 0; t < max; t += dt) {
        if (hp <= 0) return { win: false, secs: t, tookPct: (100 * took) / s.maxHp, mpPct: (100 * mpSpent) / s.maxMp, hpLeftPct: 0, pots, potsMp, winds, starved, firstHit };
        if (mobHp <= 0) return { end: { hp, mp, potAt: potAt - t, windAt: windAt - t }, win: true, secs: t, tookPct: (100 * took) / s.maxHp, mpPct: (100 * mpSpent) / s.maxMp, hpLeftPct: (100 * hp) / s.maxHp, pots, potsMp, winds, starved, firstHit };
        // maná y quemadura
        if (Math.floor(t) !== Math.floor(t - dt)) mp = Math.min(s.maxMp, mp + combatMpRegen(s.maxMp));
        if (mobBurn > t && t >= burnTick) { mobHp -= burnDmg; burnTick += BURN_EVERY; }
        if (hot > 0 && t >= hotNext) { hp = Math.min(s.maxHp, hp + Math.round(s.maxHp * hotFrac)); hot--; hotNext += 1; }
        if (windUntil && t >= windUntil) { hp = Math.min(s.maxHp, hp + Math.round(s.maxHp * SECOND_WIND.hp)); mp = Math.min(s.maxMp, mp + Math.round(s.maxMp * SECOND_WIND.mp)); windUntil = 0; winds++; }
        // mob: se acerca y pega
        if (mobDist > 1.1 && mobPar <= t) mobDist = Math.max(1, mobDist - f.spd * dt);
        if (mobDist <= 1.5 && mobPar <= t && t >= mobNextAtk) { mobNextAtk = t + f.atk; hurt(rint(f.dmg[0], f.dmg[1]), t); }
        if (f.special && t >= nextSp && mobPar <= t) { nextSp = t + f.special.every; if (f.special.dmg[1] > 0) hurt(rint(f.special.dmg[0], f.special.dmg[1]), t + 0.8); stunned = Math.max(stunned, t + 0.8 + f.special.stun); }
        // pociones (bloqueo de PvE) y Segundo aliento
        if (spec.potionsAllowed !== false && t - potAt >= POTION_LOCK_PVE_MS / 1000) {
            if (hp < s.maxHp * 0.45) { hp = Math.min(s.maxHp, hp + potionHp(s.maxHp)); potAt = t; pots++; }
            else if (mp < s.maxMp * 0.15) { mp = Math.min(s.maxMp, mp + potionMp(s.maxMp)); potAt = t; potsMp++; }
        }
        if (stunned > t || windUntil > t) continue;
        if (hp < s.maxHp * 0.3 && t - windAt >= SECOND_WIND.cdMs / 1000 && t - potAt < 50) { windAt = t; windUntil = t + SECOND_WIND.castMs / 1000; continue; }
        // acción del jugador
        if (pending && t >= pending.at) { apply(pending.id, t); pending = null; }
        if (t < busyUntil) continue;
        let chosen = '';
        for (const id of ROTATION[spec.cls]) {
            if (kit[id] === undefined || kit[id] > spec.lvl) continue;
            const sp = (PVP_SPELLS[id] ?? SKILLS[id]) as typeof SKILLS[string] | undefined; if (!sp) continue;
            if ((cd.get(id) ?? -1e9) > t || mp < sp.mp) continue;
            // con criterio: lo caro (más del 6 % del maná) solo si sobra maná o el mob todavía tiene mucha vida
            if (spec.cls !== 'guerrero' && id !== 'proyectil' && id !== 'castigo' && sp.mp > s.maxMp * 0.06 && !sp.shield && !sp.heal && (f.boss || f.hp > foeAt('comun', spec.lvl).hp * 1.5 ? mp < s.maxMp * 0.3 : mp < s.maxMp * 0.75)) continue;
            if (sp.shield && shieldUntil > t) continue;
            if ((id === 'curacion' || id === 'renovar') && hp > s.maxHp * (id === 'curacion' ? 0.55 : 0.8)) continue;
            if (id === 'renovar' && hot > 0) continue;
            if ((id === 'escudodivino' || id === 'escudomana' || id === 'guardian' || id === 'represalia') && (firstHit < 0 || hp > s.maxHp * 0.9)) continue;
            if ((sp.secs || sp.stun) && (f.boss || mobPar > t)) { if (!sp.dmg) continue; if (id === 'paralisis' || id === 'reprender') continue; }
            if (id === 'bola' && mobBurn <= t && kit.ignicion !== undefined && kit.ignicion <= spec.lvl && (cd.get('ignicion') ?? 0) <= t + 1) continue;
            if (sp.melee || id === 'ataque') { if (mobDist > 1.6 && spec.cls === 'guerrero') continue; }
            chosen = id; break;
        }
        if (!chosen) { starved += dt; continue; }
        const sp = PVP_SPELLS[chosen] ?? SKILLS[chosen];
        mp -= sp.mp; mpSpent += sp.mp; cd.set(chosen, t + (chosen === 'ataque' ? 0.85 : sp.cd));
        const castS = (sp.cast ?? !(sp.melee || sp.stat === 'wdmg' || sp.stat === 'melee')) ? castMsOf(chosen) / 1000 : 0;
        if (castS > 0) { pending = { id: chosen, at: t + castS }; busyUntil = t + castS + 0.15; }
        else { apply(chosen, t); busyUntil = t + (chosen === 'ataque' ? 0.85 : INSTANT_S); }
    }
    return { win: false, secs: max, tookPct: (100 * took) / s.maxHp, mpPct: (100 * mpSpent) / s.maxMp, hpLeftPct: (100 * Math.max(0, hp)) / s.maxHp, pots, potsMp, winds, starved, firstHit };

    function apply(id: string, t: number) {
        const sp = PVP_SPELLS[id] ?? SKILLS[id], ext = sp as typeof SKILLS[string];
        if (ext.shield) { shield = Math.min(s.maxHp, shield + Math.round(s.maxHp * ext.shield)); shieldUntil = t + 10; return; }
        if (id === 'represalia') { mitigK = 0.8; mitigUntil = t + 10; return; }
        if (ext.heal) { hp = Math.min(s.maxHp, hp + healAmount(ext.heal, s, s.maxHp)); return; }
        if (ext.hot) { hot = ext.hot.ticks; hotFrac = ext.hot.frac; hotNext = t + ext.hot.every; return; }
        if (!sp.dmg) return;
        const reps = ext.pulses ?? ext.sweeps ?? 1;
        for (let i = 0; i < reps; i++) {
            let d = rollSpellDamage(id, s, false);
            if (sp.vsCtrl && mobPar > t) d = Math.round(d * sp.vsCtrl);
            if (sp.vsBurn && mobBurn > t) d = Math.round(d * sp.vsBurn);
            if (id === 'ataque' && rnd() * 100 < s.crit) d = Math.round(d * CRIT_MULT);
            mobHp -= d; if (sp.lifesteal) hp = Math.min(s.maxHp, hp + Math.round(d * sp.lifesteal));
        }
        if (sp.burn) { mobBurn = t + BURN_TICKS * BURN_EVERY + 0.05; burnTick = t + BURN_EVERY; burnDmg = burnTickDmg(s); }
        const ctl = sp.secs ?? ext.stun ?? ext.freeze ?? 0;
        if (ctl && !f.boss) mobPar = Math.max(mobPar, t + ctl);
    }
}

/** Corre `n` peleas y devuelve medianas y tasas. */
export function many(spec: Omit<PveSpec, 'seed'>, n: number, seed0 = 1000) {
    const rs = Array.from({ length: n }, (_, i) => fight({ ...spec, seed: seed0 + i }));
    const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] ?? 0; };
    return {
        win: rs.filter((r) => r.win).length / n, secs: med(rs.map((r) => r.secs)), tookPct: med(rs.map((r) => r.tookPct)), mpPct: med(rs.map((r) => r.mpPct)),
        hpLeftPct: med(rs.map((r) => r.hpLeftPct)), pots: rs.reduce((a, r) => a + r.pots, 0) / n, starved: med(rs.map((r) => r.starved)),
    };
}

/**
 * Farmeo encadenado durante `secs` segundos contra comunes de tu nivel: pelea, camina `travel` s hasta el siguiente (regenera
 * vida y maná fuera de combate), y para a recuperarse si quedó con poca vida o maná (descansa quieto: regeneración en reposo,
 * meditación y la poción si está lista). Devuelve kills por hora, fracción del tiempo parado y muertes.
 */
export function farm(cls: Cls, lvl: number, secs: number, seed: number, travel: number, regen: (maxHp: number, resting: boolean) => number, meditate: { pct: number; min: number }) {
    const s = buildStats(cls, lvl), foe = foeAt('comun', lvl);
    let c: Carry = { hp: s.maxHp, mp: s.maxMp, potAt: -1e9, windAt: -1e9 }, clock = 0, kills = 0, rest = 0, deaths = 0, pots = 0, i = 0;
    const needMp = cls === 'guerrero' ? 0 : 0.25; // el paladín sigue con el ataque básico sin maná
    const pass = (dt: number, resting: boolean) => {
        c.hp = Math.min(s.maxHp, c.hp + regen(s.maxHp, resting) * dt);
        c.mp = Math.min(s.maxMp, c.mp + (resting ? Math.max(meditate.min, s.maxMp * meditate.pct) : combatMpRegen(s.maxMp)) * dt);
        c.potAt -= dt; c.windAt -= dt; clock += dt;
    };
    while (clock < secs) {
        if (c.hp < s.maxHp * 0.5 || c.mp < s.maxMp * needMp) {
            const t0 = clock;
            while ((c.hp < s.maxHp * 0.9 || c.mp < s.maxMp * (needMp ? 0.8 : 0)) && clock - t0 < 600) {
                if (c.hp < s.maxHp * 0.5 && -c.potAt >= POTION_LOCK_PVE_MS / 1000) { c.hp = Math.min(s.maxHp, c.hp + potionHp(s.maxHp)); c.potAt = 0; pots++; }
                pass(0.5, true);
            }
            rest += clock - t0;
        }
        const r = fight({ cls, lvl, foe, seed: seed + i++, carry: c });
        pots += r.pots; clock += r.secs;
        if (!r.win) { deaths++; c = { hp: s.maxHp, mp: s.maxMp, potAt: -1e9, windAt: -1e9 }; clock += 30; continue; }
        c = { ...r.end! }; kills++;
        // viaje: la vida no regenera hasta la calma (el último golpe recibido fue ~1 s antes de matar al mob); el maná sí
        const calm = Math.min(travel, Math.max(0, HP_REGEN.calmMs / 1000 - 1)), hp0 = c.hp;
        pass(calm, false); c.hp = hp0; pass(travel - calm, false);
    }
    return { killsPerHour: (kills * 3600) / clock, restFrac: rest / clock, deaths: (deaths * 3600) / clock, potsPerHour: (pots * 3600) / clock };
}
