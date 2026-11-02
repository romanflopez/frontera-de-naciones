/**
 * simulateFight (P0-D): duelo PvP 1 vs 1, determinista por semilla.
 *
 * Reutiliza del server: PvpLimiter (recargas, maná por lanzamiento, ritmo melee), rollSpellDamage, damageAfterDefense,
 * paralysisSecs y statsFromChar (pvpCombat.ts); CharacterStatus, applyParalysis/applySlow con DR (statusSystem.ts).
 * Igual que scripts/sim-arranque.ts: reloj virtual (el tiempo lo lleva la sim, no Date.now) y Math.random sembrado
 * mientras corre la pelea (rollSpellDamage usa Math.random).
 *
 * Modelo espacial: una línea (1D) entre dos paredes; alcances en tiles. Walk 333 ms/celda (castea), run 200 ms/celda (no),
 * slow = 50 % de velocidad. Moverse cancela el cast; un CC duro lo interrumpe.
 */
import { PvpLimiter, combatMpRegen, WALK_MS, RUN_MS, damageAfterDefense, paralysisSecs, rollSpellDamage, statsFromChar, type CombatStats } from '../../../apps/server/src/systems/pvpCombat.ts';
import { applyParalysis, applySlow, createDefaultStatus, isSlowed, updateStatus, expireTimed, type CharacterStatus } from '../../../apps/server/src/systems/statusSystem.ts';
import { AB, KITS, type Ability, type AbilityKey } from './abilities.ts';

export type ClassId = 'mago' | 'paladin';
export type Action = { cast: AbilityKey } | { move: -1 | 1; run?: boolean } | null;
export interface View {
    now: number; dist: number; self: Fighter; foe: Fighter;
    ready(k: AbilityKey): boolean; inRange(k: AbilityKey): boolean;
}
export type Policy = (v: View) => Action;
export interface FighterSpec { class: ClassId; level: number; hp?: number; /** multiplica la vida de statsFromChar (solo sim; el daño no cambia) */ hpMult?: number; abilities?: AbilityKey[]; policy: Policy; pos?: number }
export interface FightSpec { a: FighterSpec; b: FighterSpec; maxDuration?: number; seed?: number; arena?: number; dtMs?: number; log?: boolean }

export interface Metrics { castsInterrupted: number; cdsUsed: Partial<Record<AbilityKey, number>>; drProcs: number; dmgDone: number; casts: number; dbg: Dbg }
// TEMP (reporte): contadores de diagnóstico
export interface Dbg { castsStarted: number; castsCompleted: number; castsInterrupted: number; blinkUsed: number; chainsUsed: number; slowUsed: number; damageDealtInRange: number; damageDealtInMelee: number; timeInMelee: number; timeInRange: number }
export interface FightResult {
    duration: number; winner: 'a' | 'b' | 'draw'; winnerHpPct: number;
    castsInterrupted: number; cdsUsed: number; drProcs: number;
    a: Metrics & { hp: number; maxHp: number }; b: Metrics & { hp: number; maxHp: number };
    events: string[];
}

const KIT_ITEMS: Record<ClassId, Record<string, { n: string }>> = {
    paladin: { arma: { n: 'Espada corta' }, armadura: { n: 'Coraza de cuero' } },
    mago: { arma: { n: 'Báculo de fresno' }, armadura: { n: 'Túnica de mago' } },
};

export class Fighter {
    stats: CombatStats; hp: number; mp: number; pos: number;
    status: CharacterStatus = createDefaultStatus();
    limiter = new PvpLimiter();
    simCd = new Map<AbilityKey, number>();
    nextRegenAt = 1_000_000 + 1000; // T0 + 1 s
    casting: { k: AbilityKey; fireAt: number } | null = null;
    dots: { at: number; dmg: number; left: number; every: number; from: Fighter }[] = [];
    m: Metrics = { castsInterrupted: 0, cdsUsed: {}, drProcs: 0, dmgDone: 0, casts: 0, dbg: { castsStarted: 0, castsCompleted: 0, castsInterrupted: 0, blinkUsed: 0, chainsUsed: 0, slowUsed: 0, damageDealtInRange: 0, damageDealtInMelee: 0, timeInMelee: 0, timeInRange: 0 } };
    readonly kit: Set<AbilityKey>;
    constructor(readonly id: 'a' | 'b', readonly spec: FighterSpec, pos: number) {
        this.stats = statsFromChar({ lvl: spec.level, cls: spec.class === 'mago' ? 'mago' : 'guerrero', eq: KIT_ITEMS[spec.class] });
        if (spec.hp) this.stats.maxHp = spec.hp;
        if (spec.hpMult) this.stats.maxHp = Math.round(this.stats.maxHp * spec.hpMult);
        this.hp = this.stats.maxHp; this.mp = this.stats.maxMp; this.pos = pos;
        this.kit = new Set(spec.abilities ?? KITS[spec.class]);
    }
    get frozen() { return this.status.isParalyzed; }
    get tid() { return this.id === 'a' ? 1n : 2n; }
}

/** PRNG mulberry32, el mismo de sim-arranque.ts. */
export function mulberry(seed: number) {
    let s = seed | 0;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function simulateFight(spec: FightSpec): FightResult {
    const rnd = mulberry(spec.seed ?? 12345), realRandom = Math.random;
    Math.random = rnd;
    try { return run(spec, rnd); } finally { Math.random = realRandom; }
}

function run(spec: FightSpec, rnd: () => number): FightResult {
    const maxMs = (spec.maxDuration ?? 120) * 1000, dt = spec.dtMs ?? 50, wall = spec.arena ?? 15;
    const T0 = 1_000_000; let now = T0;
    const A = new Fighter('a', spec.a, spec.a.pos ?? -6), B = new Fighter('b', spec.b, spec.b.pos ?? 6);
    const events: string[] = [];
    const ev = (s: string) => { if (spec.log !== false) events.push(`${((now - T0) / 1000).toFixed(2)}s ${s}`); };
    const rint = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
    const abil = (k: AbilityKey): Ability => AB[k];

    const ready = (f: Fighter, k: AbilityKey): boolean => {
        const a = abil(k);
        if (!f.kit.has(k) || f.mp < a.mp) return false;
        if (a.simOnly) return now >= (f.simCd.get(k) ?? 0);
        if (a.server === 'ataque') return now - ((f.limiter as unknown as { lastMelee: number }).lastMelee) >= f.limiter.meleeGapMs * 0.9;
        if (a.server && a.server in { blink: 1, carga: 1, giro: 1, grito: 1 }) return f.limiter.skillReady(a.server, now);
        // PVP_SPELLS: misma regla que PvpLimiter.allow (cd × 900 ms desde el último lanzamiento)
        const castAt = (f.limiter as unknown as { castAt: Map<string, number> }).castAt.get(a.server!) ?? -1e12;
        return now - castAt >= a.cd * 900;
    };
    const dist = () => Math.abs(A.pos - B.pos);
    const view = (self: Fighter, foe: Fighter): View => ({ now: now - T0, dist: dist(), self, foe, ready: (k) => ready(self, k), inRange: (k) => dist() <= abil(k).range });

    const hurt = (from: Fighter, to: Fighter, raw: number, kind: Ability['kind'], what: string) => {
        const d = damageAfterDefense(raw, to.stats, kind);
        to.hp = Math.max(0, to.hp - d); from.m.dmgDone += d; if (dist() > 3) from.m.dbg.damageDealtInRange += d; else from.m.dbg.damageDealtInMelee += d;
        ev(`${from.id} ${what} → ${to.id} −${d} (${to.hp}/${to.stats.maxHp})`);
    };

    /** Aplica una habilidad terminada. Devuelve false si el server la rechazaría (recarga/maná/alcance). */
    const fire = (f: Fighter, foe: Fighter, k: AbilityKey): boolean => {
        const a = abil(k);
        if (!a.blink && dist() > a.range + (a.charge ? 0 : 0)) { ev(`${f.id} ${a.name} fuera de alcance`); return false; }
        const pay = (c: number) => (f.mp >= c ? ((f.mp -= c), true) : false);
        // validación y cobro del server
        if (a.simOnly) { if (!pay(a.mp)) return false; f.simCd.set(k, now + a.cd * 1000); }
        else if (a.server && a.server in { blink: 1, carga: 1, giro: 1, grito: 1 }) { if (!f.limiter.skillReady(a.server, now) || !pay(a.mp)) return false; f.limiter.markSkill(a.server, now); }
        else if (!f.limiter.allow(a.server!, foe.tid, now, pay)) return false;
        f.m.casts++;
        if (k === 'blink') f.m.dbg.blinkUsed++; if (k === 'chains') f.m.dbg.chainsUsed++; if (a.slowMs) f.m.dbg.slowUsed++;
        if (a.cd >= 3) f.m.cdsUsed[k] = (f.m.cdsUsed[k] ?? 0) + 1;

        if (a.blink) { const dir = Math.sign(f.pos - foe.pos) || 1; f.pos = Math.max(-wall, Math.min(wall, f.pos + dir * a.blink)); ev(`${f.id} Blink → ${f.pos.toFixed(1)}`); return true; }
        if (a.charge) { f.pos = foe.pos + Math.sign(f.pos - foe.pos) * 1; ev(`${f.id} ${a.name} cierra`); }

        let raw = 0;
        if (a.server && !a.simOnly) raw = rollSpellDamage(a.server, f.stats, false);
        else if (a.dmg) {
            const s = f.stats;
            raw = rint(...a.dmg.base) + s.lvl * a.dmg.lvlK + (a.dmg.stat === 'mag' ? s.mag : rint(s.wdmg[0], s.wdmg[1]));
            raw = Math.max(1, Math.round(raw * (a.dmg.stat === 'mag' ? s.magicMult : s.meleeMult)));
        }
        if (a.vsFrozen && foe.frozen) raw = Math.round(raw * a.vsFrozen);
        if (raw > 0) {
            if (a.dot) { const per = Math.max(1, Math.round(raw / a.dot.ticks)); foe.dots.push({ at: now + a.dot.everyMs, dmg: per, left: a.dot.ticks, every: a.dot.everyMs, from: f }); ev(`${f.id} ${a.name} prende (${a.dot.ticks}×${per})`); }
            else hurt(f, foe, raw, a.kind, a.name);
        }
        if (a.cc) {
            const req = a.cc.kind === 'paralisis' ? paralysisSecs(a.cc.ms / 1000, foe.stats) * 1000 : a.cc.ms;
            const got = applyParalysis(foe.status, now, req, a.cc.kind);
            if (got < req) f.m.drProcs++;
            ev(`${f.id} ${a.name}: ${a.cc.kind} ${(got / 1000).toFixed(2)}s${got < req ? ' (DR)' : ''}`);
            if (got > 0 && foe.casting) { foe.m.castsInterrupted++; foe.m.dbg.castsInterrupted++; ev(`${foe.id} cast ${abil(foe.casting.k).name} interrumpido`); foe.casting = null; }
        }
        if (a.slowMs) {
            const got = applySlow(foe.status, now, a.slowMs);
            if (got < a.slowMs) f.m.drProcs++;
            ev(`${f.id} ${a.name}: slow ${(got / 1000).toFixed(2)}s${got < a.slowMs ? ' (DR)' : ''}`);
        }
        return true;
    };

    const step = (f: Fighter, foe: Fighter) => {
        if (f.hp <= 0) return;
        updateStatus(f.status, now); expireTimed(f.status, now);
        if (now >= f.nextRegenAt) { f.nextRegenAt += 1000; f.mp = Math.min(f.stats.maxMp, f.mp + combatMpRegen(f.stats.maxMp)); } // igual que world.regenMana
        for (const d of f.dots) if (d.left > 0 && now >= d.at) { d.left--; d.at += d.every; hurt(d.from, f, d.dmg, 'magic', 'Ignite tick'); }
        f.dots = f.dots.filter((d) => d.left > 0);
        if (f.frozen) return;
        if (f.casting) {
            if (now >= f.casting.fireAt) { const k = f.casting.k; f.casting = null; f.m.dbg.castsCompleted++; fire(f, foe, k); }
            else return; // castea quieto; la política no actúa
        }
        const act = f.spec.policy(view(f, foe));
        if (!act) return;
        if ('move' in act) {
            const ms = (act.run ? RUN_MS : WALK_MS) * (isSlowed(f.status, now) ? 2 : 1);
            f.pos = Math.max(-wall, Math.min(wall, f.pos + act.move * (dt / ms)));
            return;
        }
        const k = act.cast, a = abil(k);
        if (!ready(f, k)) return;
        if (a.castMs > 0) { f.casting = { k, fireAt: now + a.castMs }; f.m.dbg.castsStarted++; ev(`${f.id} castea ${a.name}`); }
        else fire(f, foe, k);
    };

    // orden alternado por tick para no favorecer siempre a A
    let tick = 0, wasMelee = false;
    while (now - T0 < maxMs && A.hp > 0 && B.hp > 0) {
        { const inM = dist() <= 2; for (const f of [A, B]) { if (inM) f.m.dbg.timeInMelee += dt / 1000; else f.m.dbg.timeInRange += dt / 1000; } if (inM !== wasMelee) ev(inM ? 'MELEE (≤2 tiles)' : `sale de melee (${dist().toFixed(1)} tiles)`); wasMelee = inM; }
        if (tick++ % 2 === 0) { step(A, B); step(B, A); } else { step(B, A); step(A, B); }
        now += dt;
    }
    const winner = A.hp <= 0 && B.hp <= 0 ? 'draw' : A.hp <= 0 ? 'b' : B.hp <= 0 ? 'a' : 'draw';
    const W = winner === 'a' ? A : winner === 'b' ? B : null;
    const sum = (f: Fighter) => Object.values(f.m.cdsUsed).reduce((x, y) => x + (y ?? 0), 0);
    return {
        duration: (now - T0) / 1000, winner,
        winnerHpPct: W ? Math.round((W.hp / W.stats.maxHp) * 1000) / 10 : 0,
        castsInterrupted: A.m.castsInterrupted + B.m.castsInterrupted,
        cdsUsed: sum(A) + sum(B),
        drProcs: A.m.drProcs + B.m.drProcs,
        a: { ...A.m, hp: A.hp, maxHp: A.stats.maxHp }, b: { ...B.m, hp: B.hp, maxHp: B.stats.maxHp },
        events,
    };
}
