/**
 * Motor de jefes (docs/JEFES.md): ejecuta en el server las mecánicas de `BOSS_KITS` / `ADD_KITS` (packages/world/src/bosses.ts).
 *
 * Cada jefe (o add lanzador) con kit tiene un `BossState`. En cada vuelta de la IA, mientras persigue a alguien, `bossTick` decide:
 *   - umbrales de vida (adds una sola vez, furia) y furia final por tiempo;
 *   - si está casteando, si terminó (y aplica el efecto) o sigue quieto;
 *   - si no, la primera mecánica lista, respetando el respiro entre mecánicas y el bloqueo de escuela después de un corte.
 * Los cortes los resuelve `bossInterrupt` cuando le pega una habilidad: duro en cualquier momento, blando solo en la ventana final.
 */
import {
    ADD_KITS, BOSS_CUT_PAUSE, BOSS_GAP_DEFAULT, BOSS_KITS, BOSS_SCHOOL_LOCK, HARD_INTERRUPTS, SOFT_INTERRUPTS, castWindowFrom,
    type BossAbilityDef, type BossCastDef, type BossKit, type BossSchool, type BossTankHitDef, type BossTelegraphDef, type MobType,
} from '@fdn/world';
import type { ServerMessage } from '@fdn/proto';
import * as M from './messages.ts';
import type { Player } from './player.ts';

/** Lo mínimo que el motor necesita de un mob (lo implementa el SimMob de mobs.ts). */
export interface BossMob { id: number; x: number; y: number; hp: number; hpMax: number; target: bigint | null; bs?: BossState; def: { name: string; dmg: [number, number] } }

/** Lo que el motor necesita del simulador de mobs. */
export interface BossHost {
    now(): number;
    alive(id: number): boolean;
    /** Jugadores elegibles (vivos, visibles, fuera de zona segura) a `r` celdas o menos de (x, y). */
    playersNear(x: number, y: number, r: number): Player[];
    playerById(id: bigint): Player | undefined;
    eligible(p: Player | undefined): p is Player;
    /** Golpe común del mob ya multiplicado (rasgos, party, furia). */
    roll(m: BossMob): number;
    hurt(p: Player, raw: number, source: string, m: BossMob): void;
    stun(p: Player, secs: number): number;
    slow(p: Player, secs: number): void;
    poison(p: Player, secs: number): void;
    after(ms: number, fn: () => void): void;
    broadcast(m: { x: number; y: number }, msg: ServerMessage): void;
    /** Mete un add al lado del jefe, ya peleando contra su objetivo. Devuelve su id (o undefined si no hubo lugar). */
    spawnAdd(boss: BossMob, type: MobType, lvl: number | undefined, kit: string | undefined): number | undefined;
    despawn(id: number): void;
    /** Mueve al mob a una celda libre junto a (x, y) (la carga de la salida alternativa). */
    dashTo(m: BossMob, x: number, y: number): void;
    partySize(): number;
}

interface Cast { def: BossCastDef; start: number; end: number; windowAt: number; target: bigint | null }
interface Zone { id: number; x: number; y: number; r: number; until: number; dps: number; name: string }

export interface BossState {
    kit: BossKit;
    next: Map<string, number>;
    /** Respiro entre mecánicas, pausa después de un corte y bloqueo por escuela (en s del reloj del server). */
    global: number; pauseUntil: number; locks: Map<BossSchool, number>;
    cast?: Cast;
    /** Quieto cargando un aviso (Pisotón, Mordida) hasta este momento. */
    busyUntil: number;
    startedAt: number;
    addsDone: Set<number>;
    adds: Set<number>;
    rage: number; enraged: boolean; hard: boolean;
    zones: Zone[];
    /** Sangrados activos por jugador: vencimientos. */
    bleeds: Map<bigint, number[]>;
    /** Para tests: cuántas veces salió cada mecánica y cuántas se cortaron. */
    stats: { done: Map<string, number>; cut: number };
}

let zoneSeq = 1;

/** Estado inicial de un jefe con kit (o undefined si el tipo no tiene). `kitId` = kit de add lanzador. */
export function bossStateFor(type: MobType, kitId?: string): BossState | undefined {
    const kit = kitId ? ADD_KITS[kitId] : BOSS_KITS[type];
    if (!kit) return undefined;
    return { kit, next: new Map(), global: 0, pauseUntil: 0, locks: new Map(), busyUntil: 0, startedAt: 0, addsDone: new Set(), adds: new Set(), rage: 1, enraged: false, hard: false, zones: [], bleeds: new Map(), stats: { done: new Map(), cut: 0 } };
}

const dist = (ax: number, ay: number, b: Player) => Math.hypot(ax - (b.posX + 0.5), ay - (b.posY + 0.5));

/**
 * Una vuelta del motor para `m`, que persigue a `tgt`. Devuelve true si el jefe tiene que quedarse quieto (casteando o cargando un aviso):
 * en ese caso la IA no lo mueve ni pega.
 */
export function bossTick(h: BossHost, m: BossMob, tgt: Player | undefined): boolean {
    const s = m.bs!, T = h.now(), kit = s.kit;
    if (!s.startedAt) {
        s.startedAt = T;
        for (const a of kit.abilities) s.next.set(a.id, T + (a.first ?? a.every));
    }
    phases(h, m, s, T);
    tickZones(h, m, s, T);
    if (s.cast) {
        if (T < s.cast.end) return true;
        const c = s.cast; s.cast = undefined;
        resolveCast(h, m, s, c);
        return false;
    }
    if (T < s.busyUntil) return true;
    if (!tgt || T < s.global || T < s.pauseUntil) return false;
    for (const a of kit.abilities) {
        if ((s.next.get(a.id) ?? 0) > T) continue;
        if (a.kind === 'cast' && (s.locks.get(a.school) ?? 0) > T) continue; // escuela bloqueada por un corte: espera
        if (!inRange(m, a, tgt)) continue;
        start(h, m, s, a, tgt, T);
        s.next.set(a.id, T + a.every);
        s.global = T + (kit.gap ?? BOSS_GAP_DEFAULT);
        return true;
    }
    return false;
}

function inRange(m: BossMob, a: BossAbilityDef, tgt: Player): boolean {
    const d = dist(m.x, m.y, tgt);
    if (a.kind === 'tankHit') return d <= 2.2;
    if (a.kind === 'telegraph') return a.at === 'self' ? d <= a.r + 1 : d <= 14;
    return d <= 15;
}

function start(h: BossHost, m: BossMob, s: BossState, a: BossAbilityDef, tgt: Player, T: number): void {
    if (a.kind === 'cast') {
        const castMs = Math.round(a.castMs * (s.enraged ? s.kit.enrage?.castSpeed ?? 1 : 1));
        const target = a.effect.r > 0 && !a.alt ? null : pickTarget(h, m, a.target ?? 'tank', tgt)?.playerId ?? tgt.playerId;
        const from = castWindowFrom(a, castMs);
        s.cast = { def: a, start: T, end: T + castMs / 1000, windowAt: T + from / 1000, target };
        h.broadcast(m, M.bossCast(m.id, a.name, a.school, castMs, from, !a.lock));
        return;
    }
    if (a.kind === 'telegraph') return telegraph(h, m, s, a, tgt, T);
    return tankHit(h, m, s, a, tgt, T);
}

function pickTarget(h: BossHost, m: BossMob, how: 'tank' | 'random', tgt: Player): Player | undefined {
    if (how === 'tank') return tgt;
    const all = h.playersNear(m.x, m.y, 14);
    return all.length ? all[Math.floor(Math.random() * all.length)] : tgt;
}

function resolveCast(h: BossHost, m: BossMob, s: BossState, c: Cast): void {
    const a = c.def, e = a.effect;
    h.broadcast(m, M.bossCastEnd(m.id, 0));
    count(s, a.id);
    const t = c.target != null ? h.playerById(c.target) : undefined;
    if (a.alt && h.eligible(t) && dist(m.x, m.y, t) > a.alt.beyond) {
        // salida alternativa: el objetivo se alejó, el jefe lo carga en vez de lanzar el efecto
        h.dashTo(m, t.posX + 0.5, t.posY + 0.5);
        h.hurt(t, Math.round(h.roll(m) * a.alt.dmgK), `${m.def.name} (${a.alt.name})`, m);
        if (a.alt.slow) h.slow(t, a.alt.slow);
        count(s, `${a.id}:alt`);
        return;
    }
    const victims = e.r > 0 ? h.playersNear(m.x, m.y, e.r) : h.eligible(t) ? [t] : [];
    for (const p of victims) {
        const raw = Math.round((e.dmgK ? h.roll(m) * e.dmgK : 0) + (e.pctHp ? p.combat.maxHp * e.pctHp * s.rage : 0));
        if (raw > 0) h.hurt(p, raw, `${m.def.name} (${a.name})`, m);
        if (e.stun) h.stun(p, e.stun);
        if (e.terror) h.stun(p, e.terror);
        if (e.slow) h.slow(p, e.slow);
        if (e.antiHeal) h.poison(p, e.antiHeal);
    }
    if (e.heal) { m.hp = Math.min(m.hpMax, m.hp + Math.round(m.hpMax * e.heal)); }
}

function telegraph(h: BossHost, m: BossMob, s: BossState, a: BossTelegraphDef, tgt: Player, T: number): void {
    const at = a.at === 'self' ? { x: m.x, y: m.y } : (() => { const p = pickTarget(h, m, a.at === 'tank' ? 'tank' : 'random', tgt)!; return { x: p.posX + 0.5, y: p.posY + 0.5 }; })();
    h.broadcast(m, M.bossTelegraph(m.id, a.name, at.x, at.y, a.r, a.warnMs));
    s.busyUntil = T + a.warnMs / 1000;
    h.after(a.warnMs, () => {
        if (!h.alive(m.id) || m.bs !== s) return;
        count(s, a.id);
        for (const p of h.playersNear(at.x, at.y, a.r)) {
            if (a.dmgK) h.hurt(p, Math.round(h.roll(m) * a.dmgK), `${m.def.name} (${a.name})`, m);
            if (a.stun) h.stun(p, a.stun);
        }
        if (a.pool) {
            const z: Zone = { id: zoneSeq++, x: at.x, y: at.y, r: a.pool.r, until: h.now() + a.pool.secs, dps: a.pool.dpsK, name: a.pool.name };
            s.zones.push(z);
            h.broadcast(m, M.bossZone(z.id, m.id, z.name, z.x, z.y, z.r, a.pool.secs * 1000));
        }
    });
}

function tankHit(h: BossHost, m: BossMob, s: BossState, a: BossTankHitDef, tgt: Player, T: number): void {
    h.broadcast(m, M.bossTelegraph(m.id, a.name, tgt.posX + 0.5, tgt.posY + 0.5, 1.2, a.warnMs));
    s.busyUntil = T + a.warnMs / 1000;
    const tid = tgt.playerId;
    h.after(a.warnMs, () => {
        const p = h.playerById(tid);
        if (!h.alive(m.id) || m.bs !== s || !h.eligible(p) || dist(m.x, m.y, p) > 2.6) return; // se alejó o se lo sacó de encima: falla
        count(s, a.id);
        h.hurt(p, Math.round(h.roll(m) * a.mult), `${m.def.name} (${a.name})`, m);
        if (a.bleed) bleed(h, m, s, p, a.bleed, a.name);
    });
}

function bleed(h: BossHost, m: BossMob, s: BossState, p: Player, b: NonNullable<BossTankHitDef['bleed']>, name: string): void {
    const T = h.now(), list = (s.bleeds.get(p.playerId) ?? []).filter((t) => t > T);
    if (list.length >= b.maxStacks) list.sort((x, y) => x - y).shift(); // con el tope de pilas, la nueva reemplaza a la más vieja
    const until = T + b.ticks + 0.05; list.push(until); s.bleeds.set(p.playerId, list);
    const pid = p.playerId;
    for (let i = 1; i <= b.ticks; i++) h.after(i * 1000, () => {
        const q = h.playerById(pid); if (!h.eligible(q) || m.bs !== s) return;
        if (!(s.bleeds.get(pid) ?? []).includes(until)) return; // la reemplazó otra
        h.hurt(q, Math.max(1, Math.round(q.combat.maxHp * b.pct)), `${m.def.name} (${name}: sangrado)`, m);
    });
}

function phases(h: BossHost, m: BossMob, s: BossState, T: number): void {
    const kit = s.kit, frac = m.hp / m.hpMax;
    (kit.adds ?? []).forEach((ad, i) => {
        if (s.addsDone.has(i) || frac > ad.atHp) return;
        s.addsDone.add(i);
        const n = h.partySize();
        for (const sp of ad.spawn) {
            if (sp.minParty && n < sp.minParty) continue;
            for (let k = 0; k < sp.n; k++) { const id = h.spawnAdd(m, sp.type, sp.lvl, sp.kit); if (id !== undefined) s.adds.add(id); }
        }
        h.broadcast(m, M.bossPhase(m.id, 'adds', ad.text, s.enraged));
    });
    if (kit.enrage && !s.enraged && frac <= kit.enrage.atHp) {
        s.enraged = true; s.rage = Math.max(s.rage, kit.enrage.dmg);
        h.broadcast(m, M.bossPhase(m.id, 'furia', `${m.def.name} entra en furia.`, true));
    }
    if (kit.hardEnrage && !s.hard && T - s.startedAt >= kit.hardEnrage.secs) {
        s.hard = true; s.enraged = true; s.rage = Math.max(s.rage, kit.hardEnrage.dmg);
        h.broadcast(m, M.bossPhase(m.id, 'furia_final', `${m.def.name} pierde la paciencia.`, true));
    }
}

function tickZones(h: BossHost, m: BossMob, s: BossState, T: number): void {
    if (!s.zones.length) return;
    s.zones = s.zones.filter((z) => z.until > T);
    for (const z of s.zones) {
        const key = `zona${z.id}`, last = s.next.get(key) ?? 0;
        if (T - last < 1) continue; // un pulso por segundo
        s.next.set(key, T);
        for (const p of h.playersNear(z.x, z.y, z.r)) h.hurt(p, Math.max(1, Math.round(h.roll(m) * z.dps)), `${m.def.name} (${z.name})`, m);
    }
}

function count(s: BossState, id: string): void { s.stats.done.set(id, (s.stats.done.get(id) ?? 0) + 1); }

/**
 * Le pegó `spell` de `by` a un mob con motor. Devuelve true si cortó el casteo. Duro: en cualquier momento; blando: solo en la ventana.
 * Al cortar: "¡Interrumpido!", 1 s sin castear y 4 s con esa escuela bloqueada.
 */
export function bossInterrupt(h: BossHost, m: BossMob, spell: string, by: Player): boolean {
    const s = m.bs, c = s?.cast; if (!s || !c || c.def.lock) return false;
    const T = h.now();
    const ok = HARD_INTERRUPTS.has(spell) || (SOFT_INTERRUPTS.has(spell) && T >= c.windowAt);
    if (!ok) return false;
    s.cast = undefined; s.stats.cut++;
    s.locks.set(c.def.school, T + BOSS_SCHOOL_LOCK); s.pauseUntil = T + BOSS_CUT_PAUSE;
    h.broadcast(m, M.bossCastEnd(m.id, 1, by.characterName));
    return true;
}

/** El jefe vuelve a su lugar (nadie lo sigue): se corta lo que estaba haciendo, se van los adds y los charcos, y la pelea arranca de cero. */
export function bossReset(h: BossHost, m: BossMob): void {
    const s = m.bs; if (!s) return;
    if (s.cast) h.broadcast(m, M.bossCastEnd(m.id, 2));
    for (const id of s.adds) h.despawn(id);
    if (s.startedAt) h.broadcast(m, M.bossPhase(m.id, 'reinicio', '', false));
    Object.assign(s, { next: new Map(), global: 0, pauseUntil: 0, locks: new Map(), cast: undefined, busyUntil: 0, startedAt: 0, addsDone: new Set(), adds: new Set(), rage: 1, enraged: false, hard: false, zones: [], bleeds: new Map() });
}

/** Multiplicador de daño por furia (1 si no tiene motor o no está en furia). */
export const bossRage = (m: { bs?: BossState }): number => m.bs?.rage ?? 1;
