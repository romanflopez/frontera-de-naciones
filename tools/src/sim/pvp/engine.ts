/**
 * Motor de la simulación PvP (K7): N contra N en un plano abierto, determinista por semilla.
 *
 * Reutiliza del server todo lo que decide números: tablas de hechizos y habilidades (PVP_SPELLS, SKILLS), tiradas de daño
 * (rollSpellDamage), defensa y resistencia (damageAfterDefense), duración de parálisis por RM (paralysisSecs), curas
 * (healAmount), quemaduras (burnTickDmg), Segundo aliento (secondWindHeal), recargas y maná (PvpLimiter) y los estados con
 * rendimiento decreciente (statusSystem.ts). Las reglas K6 que se calibran (×0,6, tope por golpe, pociones) entran por `Rules`.
 *
 * Igual que world.ts:
 * - el daño a un jugador: Bendición (×0,8) → multiplicador PvP → DF/RM → tope por golpe;
 * - sin abridor: el primer golpe a alguien que no estaba en combate PvP no usa Furia ni bonus sobre controlado o quemado;
 * - un paso cancela el cast; correr no deja castear; un control corta el cast y el Segundo aliento;
 * - pociones con bloqueo compartido y la de vida en 20 % + 4 pulsos de 0,5 s.
 * Lo que no está en el server y es supuesto de la sim: un jugador no actúa más rápido que cada 250-400 ms (tiempo de reacción).
 */
import { BLESS_DMG_TAKEN, BLESS_HEAL_TAKEN, BURN_EVERY, BURN_TICKS, AURA_HEAL_FRAC, FURY_MS, POISON_HEAL_TAKEN, POTION_HOT_EVERY_MS, PVP_COMBAT_MS, PVP_SPELLS, PvpLimiter, RUN_MS, SECOND_WIND, SKILLS, STUN_SPELLS, UTIL_MP, WALK_MS, burnTickDmg, castMsOf, damageAfterDefense, healAmount, hitRoll, isCast, paralysisSecs, potionHpSplit, rollSpellDamage, secondWindHeal, skillMpCost, spellDmgKind, type CombatStats, type DmgKind } from '../../../../apps/server/src/systems/pvpCombat.ts';
import { applyBless, applyParalysis, applyPoison, applySlow, castRemover, createDefaultStatus, expireTimed, isBlessed, isPoisoned, isSlowed, updateStatus, type CharacterStatus } from '../../../../apps/server/src/systems/statusSystem.ts';
import { canUseSkill } from '@fdn/world';
import { cap, potHp, potMp, scale, vsCtrl, type Rules } from './rules.ts';
import { buildStats, type Cls } from './builds.ts';

export type Act =
    | { t: 'use'; id: string; tgt?: Fighter } // hechizo (PVP_SPELLS) o habilidad (SKILLS), con cast si corresponde
    | { t: 'move'; dx: number; dy: number; run: boolean }
    | { t: 'wind' } | { t: 'remover' } | { t: 'furia' }
    | null;
export type Policy = (me: Fighter, w: Sim) => { act: Act; potion?: 'hp' | 'mp' };

export interface Fighter {
    id: number; team: 0 | 1; cls: Cls; name: string;
    s: CombatStats; hp: number; mp: number; x: number; y: number;
    st: CharacterStatus; lim: PvpLimiter;
    cast: { id: string; at: number; tgt: Fighter } | null;
    windUntil: number; windCdUntil: number;
    potReadyAt: number; lastPotAt: number; pvpUntil: number;
    burnSeq: number; burnUntil: number; renewSeq: number; renewUntil: number;
    nextActAt: number; furyCdUntil: number; furyUntil: number;
    lastCast: Map<string, number>; lastMelee: number;
    /** memoria libre para la política (objetivo fijado, etc.) */
    mem: Record<string, number>;
    m: { dmg: number; heal: number; pots: number; potsMp: number; starved: number; winds: number; windsCut: number; casts: number; interrupted: number; ccSecs: number; bySpell: Record<string, number> };
    /** daño recibido: [momento, daño, id del que pegó], para medir ráfagas de una sola persona */
    taken: [number, number, number][];
    deadAt: number;
}

export interface Side { cls: Cls; policy: Policy }
export interface SimSpec { lvl: number; teams: [Side[], Side[]]; rules: Rules; seed: number; maxSecs?: number; dtMs?: number; log?: boolean }
export interface SimResult {
    secs: number; winner: 0 | 1 | -1;
    /** vida que le queda al bando ganador, % de su vida total (los muertos cuentan 0) */
    winnerHpPct: number;
    /** peor ráfaga de un solo atacante en 3 s, % de la vida máxima del que la recibe ("un combo completo saca 40-55 %") */
    burst3sPct: number;
    fighters: Fighter[]; events: string[];
}

/** PRNG mulberry32 (el mismo de scripts/sim-arranque.ts). */
export function mulberry(seed: number) {
    let s = seed | 0;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const T0 = 1_000_000;
/** Radio de la arena (celdas): una zona abierta de frontera. */
export const ARENA_R = 22;

export class Sim {
    now = T0; fighters: Fighter[] = []; events: string[] = [];
    private timers: { at: number; fn: () => void }[] = [];
    readonly rnd: () => number;
    constructor(readonly spec: SimSpec) { this.rnd = mulberry(spec.seed); }

    get t() { return (this.now - T0) / 1000; }
    log(s: string) { if (this.spec.log) this.events.push(`${this.t.toFixed(2)}s ${s}`); }
    later(ms: number, fn: () => void) { this.timers.push({ at: this.now + ms, fn }); }
    dist(a: Fighter, b: Fighter) { return Math.hypot(a.x - b.x, a.y - b.y); }
    alive(f: Fighter) { return f.hp > 0; }
    foes(f: Fighter) { return this.fighters.filter((o) => o.team !== f.team && o.hp > 0); }
    allies(f: Fighter) { return this.fighters.filter((o) => o.team === f.team && o.hp > 0); }
    frozen(f: Fighter) { return f.st.isParalyzed && this.now < f.st.paralysisEndTime; }
    ctrlLeftMs(f: Fighter) { return this.frozen(f) ? f.st.paralysisEndTime - this.now : 0; }
    inPvp(f: Fighter) { return this.now < f.pvpUntil; }
    has(f: Fighter, id: string) { return canUseSkill(f.cls, f.s.lvl, id); }
    burning(f: Fighter) { return f.burnUntil > this.now; }
    fury(f: Fighter) { return this.now < f.furyUntil; }

    /** ¿Se puede usar `id` ahora (kit, maná, recarga)? No mira alcance. */
    ready(f: Fighter, id: string): boolean {
        if (!this.has(f, id)) return false;
        const sp = PVP_SPELLS[id] ?? SKILLS[id]; if (!sp) return false;
        if (f.mp < sp.mp) return false;
        if (id === 'ataque') return this.now - f.lastMelee >= f.lim.meleeGapMs * 0.9;
        if (id === 'curacion' && this.now - (f.lastCast.get(id) ?? -1e12) < this.spec.rules.healCd * 950) return false;
        if (SKILLS[id]) return f.lim.skillReady(id, this.now);
        return this.now - (f.lastCast.get(id) ?? -1e12) >= sp.cd * 900;
    }
    range(id: string) { return (PVP_SPELLS[id] ?? SKILLS[id])?.range ?? 0; }
    inRange(f: Fighter, t: Fighter, id: string) { return this.dist(f, t) <= this.range(id); }
    castMs(id: string) { return isCast(id) ? castMsOf(id) : 0; }

    // ---------- vida ----------
    private markPvp(f: Fighter) {
        const was = this.inPvp(f); f.pvpUntil = this.now + PVP_COMBAT_MS;
        if (!was) f.potReadyAt = Math.min(f.potReadyAt, f.lastPotAt + this.spec.rules.potLockMs);
    }
    /** = world.damagePlayer para un golpe de otro jugador. */
    hurt(t: Fighter, raw: number, kind: DmgKind, src: Fighter, spell: string): number {
        if (t.hp <= 0 || raw <= 0) return 0;
        const R = this.spec.rules;
        if (spell !== 'quemadura' && !hitRoll(src.s, t.s, kind)) { this.markPvp(t); this.markPvp(src); this.log(`${src.name} ${spell} → ${t.name} falla`); return 0; }
        if (isBlessed(t.st, this.now)) raw = Math.max(1, Math.round(raw * BLESS_DMG_TAKEN));
        raw = scale(R, raw);
        const dmg = Math.min(t.hp, cap(R, damageAfterDefense(raw, t.s, kind), t.s.maxHp));
        t.hp -= dmg; this.markPvp(t); this.markPvp(src);
        src.m.dmg += dmg; src.m.bySpell[spell] = (src.m.bySpell[spell] ?? 0) + dmg; t.taken.push([this.now, dmg, src.id]);
        if (dmg > 0 && R.poisonOn.includes(spell)) applyPoison(t.st, this.now, 4000);
        if (dmg > 0 && spell !== 'quemadura' && t.windUntil) { t.windUntil = 0; t.m.windsCut++; this.log(`${t.name} pierde el Segundo aliento`); }
        this.log(`${src.name} ${spell} → ${t.name} −${dmg} (${t.hp}/${t.s.maxHp})`);
        if (t.hp <= 0) { t.deadAt = this.now; t.cast = null; t.windUntil = 0; this.log(`✝ ${t.name}`); }
        return dmg;
    }
    heal(t: Fighter, n: number, by: Fighter = t): number {
        if (t.hp <= 0 || n <= 0) return 0;
        if (isBlessed(t.st, this.now)) n = Math.round(n * BLESS_HEAL_TAKEN);
        if (isPoisoned(t.st, this.now)) n = Math.round(n * POISON_HEAL_TAKEN);
        const got = Math.min(t.s.maxHp, t.hp + n) - t.hp; t.hp += got; by.m.heal += got; return got;
    }
    private burn(t: Fighter, src: Fighter) {
        const seq = ++t.burnSeq, dmg = burnTickDmg(src.s);
        t.burnUntil = this.now + BURN_TICKS * BURN_EVERY * 1000;
        for (let k = 1; k <= BURN_TICKS; k++) this.later(k * BURN_EVERY * 1000, () => { if (t.burnSeq === seq && t.hp > 0) this.hurt(t, dmg, 'magic', src, 'quemadura'); });
    }
    private control(t: Fighter, ms: number, kind: 'paralisis' | 'aturdir', src: Fighter): number {
        const got = applyParalysis(t.st, this.now, ms, kind);
        if (got > 0) {
            src.m.ccSecs += got / 1000;
            if (t.cast) { t.cast = null; t.m.interrupted++; this.log(`${t.name}: cast cortado`); }
            if (t.windUntil) { t.windUntil = 0; t.m.windsCut++; }
        }
        return got;
    }

    // ---------- acciones ----------
    private pay(f: Fighter, c: number) { if (f.mp < c) return false; f.mp -= c; return true; }

    /** Golpe de un hechizo de PVP_SPELLS sobre un jugador (= pvpHitRequest). */
    private spellHit(f: Fighter, id: string, t: Fighter): boolean {
        const sp = PVP_SPELLS[id], R = this.spec.rules;
        if (t.hp <= 0 || this.dist(f, t) > sp.range + 0.6) return false;
        if (!f.lim.allow(id, BigInt(t.id), this.now, (c) => this.pay(f, c))) return false;
        if (id === 'ataque') f.lastMelee = this.now; else f.lastCast.set(id, this.now);
        f.m.casts++;
        const opener = !this.inPvp(t);
        let dmg = rollSpellDamage(id, f.s, !opener && this.fury(f));
        if (id === 'castigo') dmg = Math.max(1, Math.round(dmg * R.castigoMult));
        if (!opener && sp.vsCtrl && this.frozen(t)) dmg = Math.round(dmg * vsCtrl(R, sp.vsCtrl));
        if (!opener && sp.vsBurn && this.burning(t)) dmg = Math.round(dmg * sp.vsBurn);
        let secs = sp.secs && f.lim.allowSecs(id, BigInt(t.id), this.now) ? paralysisSecs(sp.secs, t.s) : 0;
        if (secs > 0) secs = this.control(t, secs * 1000, STUN_SPELLS.has(id) ? 'aturdir' : 'paralisis', f) / 1000;
        if (dmg > 0) dmg = this.hurt(t, dmg, spellDmgKind(id), f, id);
        if (dmg > 0) {
            if (sp.slow) applySlow(t.st, this.now, sp.slow * 1000);
            if (sp.burn) this.burn(t, f);
            if (sp.lifesteal) this.heal(f, Math.round(dmg * sp.lifesteal));
            if (sp.refund) f.mp = Math.min(f.s.maxMp, f.mp + sp.refund);
        }
        return true;
    }

    /** Habilidad de SKILLS (= handleSkill / clerigoSkill / handleBlink). */
    private skill(f: Fighter, id: string, tgt?: Fighter): boolean {
        const sp = SKILLS[id], now = this.now;
        const mp = skillMpCost(id, true); // en la sim todo es combate PvP
        if (!f.lim.skillReady(id, now) || f.mp < mp || this.frozen(f)) return false;
        if (id === 'curacion' && now - (f.lastCast.get('curacion') ?? -1e12) < this.spec.rules.healCd * 950) return false;
        const commit = () => { f.mp -= mp; f.lim.markSkill(id, now); f.lastCast.set(id, now); f.m.casts++; };
        const roll = (t: Fighter) => rollSpellDamage(id, f.s, this.fury(f) && this.inPvp(t));
        const near = (r: number, of: Fighter = f) => this.foes(f).filter((o) => this.dist(of, o) <= r);
        switch (id) {
            case 'blink': { // se aleja del enemigo más cercano
                const e = this.foes(f).sort((a, b) => this.dist(f, a) - this.dist(f, b))[0]; if (!e) return false;
                commit(); const [dx, dy] = this.awayDir(f, e); f.x += dx * 7; f.y += dy * 7; this.clamp(f); this.log(`${f.name} Parpadeo`); return true;
            }
            case 'carga': {
                if (!tgt || this.dist(f, tgt) > sp.range) return false;
                commit(); const d = this.dist(f, tgt); if (d > 1.2) { f.x = tgt.x + ((f.x - tgt.x) / d) * 1; f.y = tgt.y + ((f.y - tgt.y) / d) * 1; }
                this.hurt(tgt, roll(tgt), 'phys', f, id); this.control(tgt, sp.stun! * 1000, 'aturdir', f); return true;
            }
            case 'giro': {
                commit(); const hit = () => { for (const o of near(sp.aoe!)) this.hurt(o, roll(o), 'phys', f, id); };
                hit(); for (let k = 1; k < (sp.sweeps ?? 1); k++) this.later(250 * k, () => { if (f.hp > 0) hit(); }); return true;
            }
            case 'aura': {
                commit();
                for (let k = 1; k <= sp.pulses!; k++) this.later(k * sp.every! * 1000, () => {
                    if (f.hp <= 0) return; let dealt = 0;
                    for (const o of near(sp.aoe!)) dealt += this.hurt(o, roll(o), 'phys', f, id);
                    if (dealt > 0) this.heal(f, Math.round(dealt * AURA_HEAL_FRAC));
                });
                return true;
            }
            case 'nova': {
                commit(); for (const o of near(sp.aoe!)) { this.hurt(o, roll(o), 'magic', f, id); this.control(o, sp.freeze! * 1000, 'paralisis', f); } return true;
            }
            case 'novasagrada': {
                commit(); let dealt = 0; for (const o of near(sp.aoe!)) dealt += this.hurt(o, roll(o), 'magic', f, id);
                if (dealt > 0) this.heal(f, Math.round(dealt * sp.selfHeal!)); return true;
            }
            case 'renovar': {
                const t = tgt ?? f;
                if (this.dist(f, t) > sp.range + 1.5) return false;
                if (t.team !== f.team) { commit(); this.burn(t, f); return true; }
                if (this.now < t.renewUntil) return false; // como el server: no se reaplica sobre el mismo objetivo hasta que termine
                commit(); t.renewUntil = this.now + sp.hot!.ticks * sp.hot!.every * 1000;
                const seq = ++t.renewSeq, per = healAmount(sp.hot!.frac, f.s, t.s.maxHp);
                for (let k = 1; k <= sp.hot!.ticks; k++) this.later(k * sp.hot!.every * 1000, () => { if (t.renewSeq === seq) this.heal(t, per, f); });
                return true;
            }
            case 'curacion': case 'bendicion': case 'orbe': {
                const t = tgt ?? f; if (t.team !== f.team || t.hp <= 0 || this.dist(f, t) > sp.range + 1.5) return false;
                commit();
                if (id === 'curacion') this.heal(t, healAmount(sp.heal!, f.s, t.s.maxHp), f);
                else if (id === 'bendicion') applyBless(t.st, now, sp.bless! * 1000);
                else for (const o of this.allies(f).filter((o) => this.dist(o, t) <= sp.aoe!)) this.heal(o, healAmount(sp.heal!, f.s, o.s.maxHp), f);
                return true;
            }
        }
        return false;
    }

    private fire(f: Fighter, id: string, tgt?: Fighter): boolean {
        if (SKILLS[id]) return this.skill(f, id, tgt);
        return !!tgt && this.spellHit(f, id, tgt);
    }

    awayDir(f: Fighter, from: Fighter): [number, number] {
        let dx = f.x - from.x, dy = f.y - from.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        // cerca del borde de la arena, se escapa en tangente (kiteo en círculo)
        const r = Math.hypot(f.x, f.y);
        if (r > ARENA_R - 3 && (dx * f.x + dy * f.y) > 0) { const tx = -f.y / r, ty = f.x / r; const s = tx * dx + ty * dy >= 0 ? 1 : -1; return [tx * s, ty * s]; }
        return [dx, dy];
    }
    private clamp(f: Fighter) { const r = Math.hypot(f.x, f.y); if (r > ARENA_R) { f.x *= ARENA_R / r; f.y *= ARENA_R / r; } }

    private drinkPotion(f: Fighter, kind: 'hp' | 'mp') {
        if (this.now < f.potReadyAt - 100) return;
        const R = this.spec.rules;
        if (kind === 'hp' ? f.hp >= f.s.maxHp : f.mp >= f.s.maxMp) return;
        f.lastPotAt = this.now; f.potReadyAt = this.now + R.potLockMs; f.m.pots++;
        if (kind === 'mp') { f.m.potsMp++; f.mp = Math.min(f.s.maxMp, f.mp + potMp(R, f.s.maxMp)); return; }
        const [first, ...ticks] = potionHpSplit(potHp(R, f.s.maxHp));
        const add = (n: number) => { if (f.hp > 0) { const got = Math.min(f.s.maxHp, f.hp + n) - f.hp; f.hp += got; } };
        add(first); ticks.forEach((n, i) => this.later((i + 1) * POTION_HOT_EVERY_MS, () => add(n)));
        this.log(`${f.name} toma poción de ${kind === 'hp' ? 'vida' : 'maná'}`);
    }

    private act(f: Fighter, a: Act) {
        const busy = () => { f.nextActAt = this.now + 250 + Math.floor(this.rnd() * 150); };
        if (!a) return;
        if (a.t === 'move') {
            if (this.frozen(f)) return;
            if (f.cast) { f.cast = null; }
            if (f.windUntil) { f.windUntil = 0; f.m.windsCut++; }
            const ms = (a.run ? RUN_MS : WALK_MS) * (isSlowed(f.st, this.now) ? 2 : 1), step = this.spec.dtMs! / ms, d = Math.hypot(a.dx, a.dy) || 1;
            f.x += (a.dx / d) * step; f.y += (a.dy / d) * step; this.clamp(f); return;
        }
        if (this.now < f.nextActAt) return;
        if (a.t === 'remover') { if (this.has(f, 'remover') && f.mp >= UTIL_MP.remover && castRemover(f.st, this.now)) { f.mp -= UTIL_MP.remover; busy(); this.log(`${f.name} Remover`); } return; }
        if (this.frozen(f)) return;
        if (a.t === 'furia') { if (this.now >= f.furyCdUntil && this.pay(f, UTIL_MP.furia)) { f.furyUntil = this.now + FURY_MS; f.furyCdUntil = this.now + 90000; busy(); } return; }
        if (a.t === 'wind') {
            if (f.windUntil || this.now < f.windCdUntil || f.hp >= f.s.maxHp) return;
            f.cast = null; f.windUntil = this.now + SECOND_WIND.castMs; busy(); this.log(`${f.name} empieza el Segundo aliento`); return;
        }
        // usar un hechizo o habilidad
        if (!this.ready(f, a.id)) return;
        if (f.windUntil) { f.windUntil = 0; f.m.windsCut++; }
        const ms = this.castMs(a.id);
        if (ms > 0) { if (f.cast?.id === a.id) return; f.cast = { id: a.id, at: this.now + ms, tgt: a.tgt ?? f }; busy(); return; }
        if (this.fire(f, a.id, a.tgt)) busy();
    }

    private step(f: Fighter, policy: Policy) {
        if (f.hp <= 0) return;
        updateStatus(f.st, this.now); expireTimed(f.st, this.now);
        if (f.mp < 15) f.m.starved += this.spec.dtMs! / 1000;
        // Segundo aliento
        if (f.windUntil && this.now >= f.windUntil) {
            f.windUntil = 0; f.windCdUntil = this.now + SECOND_WIND.cdMs; f.m.winds++;
            const h = secondWindHeal(f.s.maxHp, f.s.maxMp, isPoisoned(f.st, this.now));
            f.mp = Math.min(f.s.maxMp, f.mp + h.mp); this.heal(f, h.hp); this.log(`${f.name} termina el Segundo aliento`);
        }
        // cast que termina
        if (f.cast && this.now >= f.cast.at) { const c = f.cast; f.cast = null; if (!this.frozen(f) && this.fire(f, c.id, c.tgt)) this.log(`${f.name} suelta ${c.id}`); }
        const { act, potion } = policy(f, this);
        if (potion) this.drinkPotion(f, potion);
        if (f.cast && act && act.t !== 'move' && !(act.t === 'use' && !this.castMs(act.id))) return; // casteando: solo se corta moviéndose o con algo instantáneo
        this.act(f, act);
    }

    run(policies: Policy[]): SimResult {
        const dt = this.spec.dtMs!, maxMs = (this.spec.maxSecs ?? 180) * 1000;
        const order = this.fighters.map((_, i) => i);
        let nextRegen = this.now + 1000;
        while (this.now - T0 < maxMs) {
            this.timers.sort((a, b) => a.at - b.at);
            while (this.timers.length && this.timers[0].at <= this.now) this.timers.shift()!.fn();
            if (this.now >= nextRegen) { nextRegen += 1000; for (const f of this.fighters) if (f.hp > 0) f.mp = Math.min(f.s.maxMp, f.mp + Math.max(this.spec.rules.mpRegenMin, Math.round(f.s.maxMp * this.spec.rules.mpRegenPct))); }
            for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
            for (const i of order) this.step(this.fighters[i], policies[i]);
            if (this.fighters.filter((f) => f.team === 0 && f.hp > 0).length === 0 || this.fighters.filter((f) => f.team === 1 && f.hp > 0).length === 0) break;
            this.now += dt;
        }
        const left = (tm: 0 | 1) => this.fighters.filter((f) => f.team === tm && f.hp > 0).length;
        const winner: 0 | 1 | -1 = left(0) && !left(1) ? 0 : left(1) && !left(0) ? 1 : -1;
        const wf = this.fighters.filter((f) => f.team === winner);
        const winnerHpPct = winner < 0 ? 0 : Math.round((wf.reduce((a, f) => a + Math.max(0, f.hp), 0) / wf.reduce((a, f) => a + f.s.maxHp, 0)) * 1000) / 10;
        let burst = 0;
        for (const f of this.fighters) for (let i = 0; i < f.taken.length; i++) {
            let sum = 0; for (let j = i; j < f.taken.length && f.taken[j][0] - f.taken[i][0] <= 3000; j++) if (f.taken[j][2] === f.taken[i][2]) sum += f.taken[j][1];
            burst = Math.max(burst, sum / f.s.maxHp);
        }
        return { secs: (this.now - T0) / 1000, winner, winnerHpPct, burst3sPct: Math.round(burst * 1000) / 10, fighters: this.fighters, events: this.events };
    }
}

/** Arma y corre una pelea. Los bandos arrancan enfrentados a 12-16 celdas, fuera de combate. */
export function simulate(spec: SimSpec): SimResult {
    const realRandom = Math.random, sim = new Sim({ dtMs: 50, ...spec });
    Math.random = sim.rnd; // rollSpellDamage usa Math.random
    try {
        const gap = 12 + sim.rnd() * 4, pols: Policy[] = [];
        let id = 1;
        spec.teams.forEach((team, ti) => team.forEach((side, k) => {
            const s = buildStats(side.cls, spec.lvl);
            const lim = new PvpLimiter(); lim.meleeGapMs = Math.round(0.85 / (1 + s.aspd / 100) * 1000);
            const f: Fighter = {
                id: id++, team: ti as 0 | 1, cls: side.cls, name: `${ti ? 'B' : 'A'}${k + 1}-${side.cls}`, s, hp: s.maxHp, mp: s.maxMp,
                x: (ti ? 1 : -1) * gap / 2, y: (k - (team.length - 1) / 2) * 3, st: createDefaultStatus(), lim, cast: null, windUntil: 0, windCdUntil: 0,
                potReadyAt: 0, lastPotAt: -1e12, pvpUntil: 0, burnSeq: 0, burnUntil: 0, renewSeq: 0, renewUntil: 0, nextActAt: 0, furyCdUntil: 0, furyUntil: 0,
                lastCast: new Map(), lastMelee: -1e12, mem: {}, taken: [], deadAt: 0,
                m: { dmg: 0, heal: 0, pots: 0, potsMp: 0, starved: 0, winds: 0, windsCut: 0, casts: 0, interrupted: 0, ccSecs: 0, bySpell: {} },
            };
            sim.fighters.push(f); pols.push(side.policy);
        }));
        return sim.run(pols);
    } finally { Math.random = realRandom; }
}
