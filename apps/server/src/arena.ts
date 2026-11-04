/**
 * Arenas 2v2 y 3v3 con ranking por temporada (docs/PARTY_Y_ARENAS.md §2). Vive fuera de los mundos, como la party: la identidad es el
 * `sessionId` y el rating va por cuenta. Se maneja con comandos de chat (`/arena …`), así que no hace falta protocolo nuevo.
 *
 * Flujo: el líder de una party de exactamente 2 (o 3) la mete en la cola → el emparejador junta dos parties del mismo modo con nivel y
 * rating parecidos (la ventana se abre con la espera) → los jugadores tienen 30 s para aceptar → se arma una instancia de arena
 * (`arena…#a<id>`) y se los lleva → 1 min de preparación en sus puestos → hasta 15 min de pelea (gana el equipo que deja en el piso al otro;
 * si no, empate) → 5 s de festejo → cada uno vuelve al punto exacto desde donde entró, con la vida llena.
 *
 * Penalización de 10 min [DM] al que sale de la cola, rechaza o deja vencer la invitación, o abandona la partida (desconectarse y no volver
 * dentro de la gracia de 60 s cuenta como abandonar). Solo la cobra el que se va; sus compañeros vuelven a poder anotarse.
 * El rating es Glicko-2 por jugador y por modo (glicko.ts); el equipo usa el promedio. En la beta no hay premios de temporada.
 */
import type { ServerMessage } from '@fdn/proto';
import { ARENA_MAPS, ARENA_MODES, ARENA_RULES, arenaStarts, arenaTeamSize, getMapDef, type ArenaMode } from '@fdn/world';
import { glicko2, newRating, seasonReset, teamOpponent, type Rating } from './glicko.ts';
import * as M from './messages.ts';
import type { AccountRecord, Storage } from './storage.ts';
import { PVP_COMBAT_MS } from './systems/pvpCombat.ts';
import type { GameWorld } from './world.ts';

export const ARENA_STORAGE_KEY = '_arena';

export interface LadderEntry extends Rating { name: string; n: number; w: number; l: number; d: number }
export interface Ladder { v: 1; season: number; modes: Record<ArenaMode, Record<string, LadderEntry>> }
type LadderRecord = AccountRecord & { arena?: Ladder };

export interface ArenaHooks {
    now?(): number;
    send(sid: string, m: ServerMessage): void;
    /** Sesión viva (conectada o en la gracia de reconexión). `worldKey` = mundo donde está o hacia donde cruza. */
    session(sid: string): { name: string; accountKey: string; worldKey: string; online: boolean } | undefined;
    /** Miembros de la party de `sid` (incluido él); vacío si no tiene. */
    partyMembers(sid: string): string[];
    isLeader(sid: string): boolean;
    world(key: string): GameWorld | undefined;
    /** Crea (o despierta) el mundo de (mapa, instancia). */
    ensure(map: string, instanceId: string): GameWorld;
    /** Cruce de mapa (registry.beginTransfer). */
    transfer(sid: string, dest: { map: string; x: number; y: number; instanceId?: string }): boolean;
    /** ¿Está entre MapTransfer y MapReady? */
    pending(sid: string): boolean;
}

export interface ArenaOptions {
    /** Temporada actual. Si cambia, los ratings vuelven hacia el medio (glicko.ts `seasonReset`). */
    season?: number;
    /** Modo de prueba (FDN_ARENA_PRUEBA=1): se puede entrar sin party o con una party más chica que el modo. */
    allowSmallTeams?: boolean;
}

interface Entry { id: number; mode: ArenaMode; leader: string; members: string[]; rating: number; level: number; since: number }
interface Invite { id: number; mode: ArenaMode; entries: [Entry, Entry]; accepted: Set<string>; expires: number }
interface Match {
    id: number; mode: ArenaMode; mapId: string; iid: string; key: string; teams: [string[], string[]];
    names: Map<string, string>; accounts: Map<string, string>; origins: Map<string, { map: string; x: number; y: number }>;
    prepared: Set<string>; gone: Set<string>; phase: 'prep' | 'fight' | 'end'; phaseUntil: number; fightStart: number;
}

const MODE_ALIASES: Record<string, ArenaMode> = { '2v2': '2v2', '2': '2v2', '3v3': '3v3', '3': '3v3' };
const fmtMin = (ms: number) => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`; };

export class ArenaService {
    private readonly queue = new Map<ArenaMode, Entry[]>(ARENA_MODES.map((m) => [m, []]));
    private readonly invites = new Map<number, Invite>();
    private readonly matches = new Map<number, Match>();
    /** Dónde está cada sesión: en cola (entrada), con invitación o en partida. */
    private readonly entryOf = new Map<string, Entry>();
    private readonly inviteOf = new Map<string, Invite>();
    private readonly matchOf = new Map<string, Match>();
    /** Penalizaciones por cuenta: hasta cuándo no puede entrar. */
    private readonly penalties = new Map<string, number>();
    private ladder: Ladder;
    private nextId = 1;
    private nextMap = 0;
    private readonly season: number;
    private readonly allowSmall: boolean;

    constructor(private readonly h: ArenaHooks, private readonly storage: Storage, o: ArenaOptions = {}) {
        this.season = Math.max(1, Math.floor(o.season ?? 1));
        this.allowSmall = !!o.allowSmallTeams;
        const rec = storage.get(ARENA_STORAGE_KEY) as LadderRecord | undefined;
        this.ladder = rec?.arena ?? { v: 1, season: this.season, modes: { '2v2': {}, '3v3': {} } };
        for (const m of ARENA_MODES) this.ladder.modes[m] ??= {};
        if (this.ladder.season !== this.season) this.newSeason();
    }

    private now(): number { return this.h.now ? this.h.now() : Date.now(); }
    private say(sid: string, text: string): void { this.h.send(sid, M.sendMessage(text)); }
    private sayAll(sids: Iterable<string>, text: string): void { for (const s of sids) this.say(s, text); }
    private nameOf(sid: string): string { return this.h.session(sid)?.name ?? '?'; }
    private playerOf(sid: string) { const s = this.h.session(sid); return s ? this.h.world(s.worldKey)?.playerOf(sid) : undefined; }

    // ---------- ranking ----------
    private newSeason(): void {
        for (const m of ARENA_MODES) for (const e of Object.values(this.ladder.modes[m])) {
            Object.assign(e, seasonReset(e, e.n, ARENA_RULES.rankedMin), { n: 0, w: 0, l: 0, d: 0 });
        }
        console.log(`[Arena] Temporada ${this.ladder.season} → ${this.season}: los ratings vuelven hacia el medio.`);
        this.ladder.season = this.season; this.persist();
    }
    private persist(): void {
        const rec = (this.storage.get(ARENA_STORAGE_KEY) as LadderRecord | undefined) ?? { name: ARENA_STORAGE_KEY, salt: '', hash: '', created: this.now(), lastLogin: 0 };
        rec.arena = this.ladder; this.storage.put(ARENA_STORAGE_KEY, rec);
    }
    /** Rating de una cuenta en un modo (uno nuevo si nunca jugó). */
    ratingOf(accountKey: string, mode: ArenaMode): LadderEntry {
        return this.ladder.modes[mode][accountKey] ?? { ...newRating(), name: '', n: 0, w: 0, l: 0, d: 0 };
    }
    /** Los `n` mejores de la temporada (con al menos `rankedMin` partidas). */
    top(mode: ArenaMode, n = 10): LadderEntry[] {
        return Object.values(this.ladder.modes[mode]).filter((e) => e.n >= ARENA_RULES.rankedMin).sort((a, b) => b.r - a.r).slice(0, n);
    }
    get seasonNumber(): number { return this.ladder.season; }

    // ---------- penalización ----------
    penaltyLeft(accountKey: string): number { const t = this.penalties.get(accountKey) ?? 0; return Math.max(0, t - this.now()); }
    private penalize(sid: string, why: string): void {
        const key = this.h.session(sid)?.accountKey; if (!key) return;
        this.penalties.set(key, this.now() + ARENA_RULES.penaltyMs);
        this.say(sid, `${why} No podés entrar a la arena por ${fmtMin(ARENA_RULES.penaltyMs)}.`);
    }

    // ---------- estado (tests y depuración) ----------
    stateOf(sid: string): 'cola' | 'invitacion' | 'partida' | null {
        return this.matchOf.has(sid) ? 'partida' : this.inviteOf.has(sid) ? 'invitacion' : this.entryOf.has(sid) ? 'cola' : null;
    }
    queued(mode: ArenaMode): number { return this.queue.get(mode)!.length; }
    matchInfo(sid: string): { key: string; phase: Match['phase']; team: 0 | 1; teams: [string[], string[]]; mode: ArenaMode } | undefined {
        const m = this.matchOf.get(sid); if (!m) return undefined;
        return { key: m.key, phase: m.phase, team: m.teams[0].includes(sid) ? 0 : 1, teams: [[...m.teams[0]], [...m.teams[1]]], mode: m.mode };
    }

    // ---------- comandos ----------
    /** `/arena …` desde el chat. */
    command(sid: string, text: string): void {
        const [, sub = '', arg = ''] = text.trim().split(/\s+/);
        const c = sub.toLowerCase();
        if (MODE_ALIASES[c]) return this.join(sid, MODE_ALIASES[c]);
        switch (c) {
            case 'salir': return this.leaveQueue(sid);
            case 'aceptar': return this.accept(sid);
            case 'rechazar': return this.decline(sid);
            case 'ranking': return this.showRanking(sid, MODE_ALIASES[arg.toLowerCase()] ?? '2v2');
            case 'rating': return this.showRating(sid);
            case 'info': return this.sendInfo(sid); // la ventana del cliente
            case '': case 'estado': case 'ayuda': return this.showStatus(sid);
            default: this.say(sid, 'Comando de arena desconocido. Escribí /arena para ver la ayuda.');
        }
    }

    private showStatus(sid: string): void {
        const st = this.stateOf(sid), key = this.h.session(sid)?.accountKey ?? '', pen = this.penaltyLeft(key);
        const lines = [`Arena (temporada ${this.ladder.season}): /arena 2v2 o /arena 3v3 (el líder, con la party armada) · /arena salir · /arena aceptar · /arena rechazar · /arena ranking [2v2|3v3] · /arena rating`];
        if (st === 'cola') { const e = this.entryOf.get(sid)!; lines.push(`Estás en la cola de ${e.mode} hace ${fmtMin(this.now() - e.since)} (${this.queued(e.mode)} parties esperando).`); }
        if (st === 'invitacion') lines.push('Tenés una partida esperando: /arena aceptar o /arena rechazar.');
        if (st === 'partida') { const m = this.matchOf.get(sid)!; lines.push(`Estás en una partida de ${m.mode} (${m.phase === 'prep' ? 'preparación' : m.phase === 'fight' ? 'pelea' : 'terminada'}).`); }
        if (pen > 0) lines.push(`Penalizado: faltan ${fmtMin(pen)} para poder entrar.`);
        for (const l of lines) this.say(sid, l);
    }
    /** Estado completo para la ventana de arena del cliente (`/arena info`). */
    private sendInfo(sid: string): void {
        const s = this.h.session(sid); if (!s) return;
        const st = this.stateOf(sid), e = this.entryOf.get(sid), m = this.matchOf.get(sid), party = this.h.partyMembers(sid);
        this.h.send(sid, M.arenaInfo({
            season: String(this.ladder.season), state: st ?? '', queuedMode: e?.mode ?? '', queuedMs: e ? this.now() - e.since : 0, queuedParties: e ? this.queued(e.mode) : 0,
            matchPhase: m?.phase ?? '', penaltyMs: this.penaltyLeft(s.accountKey), partySize: party.length, leader: !party.length || this.h.isLeader(sid), rankedMin: ARENA_RULES.rankedMin,
            ratings: ARENA_MODES.map((mode) => { const r = this.ratingOf(s.accountKey, mode); return { mode, rating: Math.round(r.r), wins: r.w, losses: r.l, draws: r.d, gamesLeft: Math.max(0, ARENA_RULES.rankedMin - r.n) }; }),
            top: ARENA_MODES.flatMap((mode) => this.top(mode).map((r, i) => ({ mode, pos: i + 1, name: r.name, rating: Math.round(r.r), wins: r.w, losses: r.l, draws: r.d }))),
        }));
    }
    private showRating(sid: string): void {
        const key = this.h.session(sid)?.accountKey; if (!key) return;
        const parts = ARENA_MODES.map((m) => {
            const e = this.ratingOf(key, m), left = Math.max(0, ARENA_RULES.rankedMin - e.n);
            return `${m}: ${Math.round(e.r)} (${e.w}G ${e.l}P ${e.d}E${left ? `, ${left} partidas más para entrar al ranking` : ''})`;
        });
        this.say(sid, `Tu rating, temporada ${this.ladder.season}: ${parts.join(' · ')}`);
    }
    private showRanking(sid: string, mode: ArenaMode): void {
        const top = this.top(mode);
        if (!top.length) { this.say(sid, `Ranking ${mode}, temporada ${this.ladder.season}: todavía nadie tiene ${ARENA_RULES.rankedMin} partidas.`); return; }
        for (const l of [`Ranking ${mode}, temporada ${this.ladder.season}:`, ...top.map((e, i) => `${i + 1}. ${e.name} — ${Math.round(e.r)} (${e.w}G ${e.l}P ${e.d}E)`)]) this.say(sid, l);
    }

    // ---------- cola ----------
    /** Motivo por el que `sid` no puede anotarse (o null). */
    private ineligible(sid: string): string | null {
        const s = this.h.session(sid), name = s?.name ?? 'Un compañero';
        if (!s || !s.online) return `${name} no está conectado.`;
        if (this.stateOf(sid)) return `${name} ya está en la cola o en una partida.`;
        const pen = this.penaltyLeft(s.accountKey); if (pen > 0) return `${name} está penalizado por abandonar (faltan ${fmtMin(pen)}).`;
        if (this.h.pending(sid)) return `${name} está cruzando de mapa.`;
        const w = this.h.world(s.worldKey), p = w?.playerOf(sid);
        if (!w || !p) return `${name} no está en el mundo.`;
        if (getMapDef(w.mapId)?.temporary) return `${name} está en una mazmorra o en la arena.`;
        if (p.isDead) return `${name} está muerto.`;
        const lastPvp = Math.max(p.pvpHurtAt, p.pvpCombatUntil - PVP_COMBAT_MS);
        if (this.now() - lastPvp < ARENA_RULES.pvpQuietMs) return `${name} peleó con un jugador hace menos de ${ARENA_RULES.pvpQuietMs / 1000} s.`;
        return null;
    }

    private join(sid: string, mode: ArenaMode): void {
        const size = arenaTeamSize(mode), party = this.h.partyMembers(sid), members = party.length ? party : [sid];
        if (party.length && !this.h.isLeader(sid)) { this.say(sid, 'Solo el líder de la party la anota en la arena.'); return; }
        if (members.length !== size && !(this.allowSmall && members.length <= size)) {
            this.say(sid, party.length ? `Para la arena ${mode} necesitás una party de exactamente ${size} (tenés ${members.length}).` : `Para la arena ${mode} necesitás una party de exactamente ${size}: armala con /invitar nombre.`);
            return;
        }
        for (const m of members) { const why = this.ineligible(m); if (why) { this.say(sid, `No pueden entrar: ${why}`); return; } }
        const ratings = members.map((m) => this.ratingOf(this.h.session(m)!.accountKey, mode).r);
        const levels = members.map((m) => this.playerOf(m)?.econ?.lvl ?? 1);
        const e: Entry = { id: this.nextId++, mode, leader: sid, members: [...members], rating: avg(ratings), level: avg(levels), since: this.now() };
        this.enqueue(e);
        this.sayAll(members, `Tu party entró a la cola de ${mode} (rating ${Math.round(e.rating)}, nivel ${Math.round(e.level)}). /arena salir para salir: el que sale queda penalizado ${fmtMin(ARENA_RULES.penaltyMs)}.`);
    }
    private enqueue(e: Entry): void {
        const q = this.queue.get(e.mode)!; q.push(e); q.sort((a, b) => a.since - b.since);
        for (const m of e.members) this.entryOf.set(m, e);
    }
    private dequeue(e: Entry): void {
        const q = this.queue.get(e.mode)!, i = q.indexOf(e); if (i >= 0) q.splice(i, 1);
        for (const m of e.members) if (this.entryOf.get(m) === e) this.entryOf.delete(m);
    }

    private leaveQueue(sid: string): void {
        if (this.inviteOf.has(sid)) return this.decline(sid);
        if (this.matchOf.has(sid)) { this.say(sid, 'Estás en una partida: no se puede salir hasta que termine.'); return; }
        const e = this.entryOf.get(sid); if (!e) { this.say(sid, 'No estás en la cola de la arena.'); return; }
        this.dequeue(e);
        this.penalize(sid, `Saliste de la cola de ${e.mode}.`);
        this.sayAll(e.members.filter((m) => m !== sid), `${this.nameOf(sid)} sacó a la party de la cola de ${e.mode}.`);
    }

    // ---------- invitación ----------
    private accept(sid: string): void {
        const inv = this.inviteOf.get(sid); if (!inv) { this.say(sid, 'No tenés ninguna partida de arena esperando.'); return; }
        if (inv.accepted.has(sid)) { this.say(sid, 'Ya aceptaste: esperando a los demás.'); return; }
        inv.accepted.add(sid);
        const all = inv.entries.flatMap((e) => e.members);
        if (inv.accepted.size < all.length) { this.say(sid, `Aceptaste (${inv.accepted.size}/${all.length}). Esperando a los demás…`); return; }
        this.closeInvite(inv);
        const bad = all.find((m) => this.ineligibleToStart(m));
        if (bad) { this.failInvite(inv, [bad], `${this.nameOf(bad)} ya no puede entrar (${this.ineligibleToStart(bad)})`); return; }
        this.startMatch(inv);
    }
    private decline(sid: string): void {
        const inv = this.inviteOf.get(sid); if (!inv) { this.say(sid, 'No tenés ninguna partida de arena esperando.'); return; }
        this.closeInvite(inv);
        this.failInvite(inv, [sid], `${this.nameOf(sid)} rechazó la partida`, 'Rechazaste la partida.');
    }
    private closeInvite(inv: Invite): void {
        this.invites.delete(inv.id);
        for (const e of inv.entries) for (const m of e.members) if (this.inviteOf.get(m) === inv) this.inviteOf.delete(m);
    }
    /** Lo mismo que `ineligible`, pero sin contar que ya tiene la invitación. */
    private ineligibleToStart(sid: string): string | null {
        const s = this.h.session(sid);
        if (!s || !s.online) return 'se desconectó';
        if (this.h.pending(sid)) return 'está cruzando de mapa';
        const w = this.h.world(s.worldKey), p = w?.playerOf(sid);
        if (!w || !p) return 'no está en el mundo';
        if (getMapDef(w.mapId)?.temporary) return 'entró a una mazmorra';
        if (p.isDead) return 'está muerto';
        return null;
    }
    /**
     * La partida no arranca: los culpables (rechazaron, no contestaron o ya no pueden) quedan penalizados y su party sale de la cola;
     * la otra party vuelve a la cola en el mismo lugar (con su tiempo de espera).
     */
    private failInvite(inv: Invite, culprits: string[], why: string, culpritText = 'No entraste a la partida.'): void {
        const bad = new Set(culprits);
        for (const c of culprits) if (this.h.session(c)) this.penalize(c, culpritText);
        for (const e of inv.entries) {
            const others = e.members.filter((m) => !bad.has(m));
            if (e.members.some((m) => bad.has(m))) { this.sayAll(others, `${why}: tu party salió de la cola.`); continue; }
            this.enqueue(e);
            this.sayAll(e.members, `${why}: volvés a la cola de ${e.mode} en tu lugar.`);
        }
    }

    // ---------- emparejador ----------
    /** ¿Pueden pelear estas dos parties? La ventana de nivel y de rating se abre cada 30 s de espera del que más esperó. */
    private compatible(a: Entry, b: Entry, now: number): boolean {
        if (a.members.some((m) => b.members.includes(m))) return false;
        const steps = Math.floor((now - Math.min(a.since, b.since)) / 30_000);
        return Math.abs(a.level - b.level) <= Math.min(40, 5 + 2 * steps) && Math.abs(a.rating - b.rating) <= 150 + 50 * steps;
    }
    private matchmake(now: number): void {
        for (const mode of ARENA_MODES) {
            const q = this.queue.get(mode)!;
            for (let i = 0; i < q.length; i++) {
                if (this.matches.size + this.invites.size >= ARENA_RULES.maxMatches) return;
                const a = q[i], j = q.findIndex((b, k) => k > i && this.compatible(a, b, now));
                if (j < 0) continue;
                const b = q[j];
                this.dequeue(a); this.dequeue(b); i--;
                const inv: Invite = { id: this.nextId++, mode, entries: [a, b], accepted: new Set(), expires: now + ARENA_RULES.acceptMs };
                this.invites.set(inv.id, inv);
                for (const e of inv.entries) for (const m of e.members) {
                    this.inviteOf.set(m, inv);
                    this.h.send(m, M.arenaInvited(mode, inv.expires)); // el cliente muestra el aviso con Aceptar / Rechazar
                    this.say(m, `¡Partida de arena ${mode} encontrada! Aceptá en el aviso o escribí /arena aceptar (vence en ${ARENA_RULES.acceptMs / 1000} s) o /arena rechazar. Rechazar o no contestar penaliza ${fmtMin(ARENA_RULES.penaltyMs)}.`);
                }
            }
        }
    }

    // ---------- partida ----------
    private startMatch(inv: Invite): void {
        const now = this.now(), id = inv.id, arena = ARENA_MAPS[this.nextMap++ % ARENA_MAPS.length], iid = `a${id}`;
        const world = this.h.ensure(arena.id, iid);
        const teams: [string[], string[]] = [[...inv.entries[0].members], [...inv.entries[1].members]];
        const m: Match = {
            id, mode: inv.mode, mapId: arena.id, iid, key: world.id, teams, names: new Map(), accounts: new Map(), origins: new Map(),
            prepared: new Set(), gone: new Set(), phase: 'prep', phaseUntil: now + ARENA_RULES.prepMs, fightStart: 0,
        };
        const cages = new Map<string, { x: number; y: number }>(), side = new Map<string, 0 | 1>();
        teams.forEach((t, ti) => { const starts = arenaStarts(ti as 0 | 1, t.length); t.forEach((sid, k) => { cages.set(sid, starts[k]); side.set(sid, ti as 0 | 1); }); });
        world.arenaSetup(side, cages);
        this.matches.set(id, m);
        for (const sid of [...teams[0], ...teams[1]]) {
            const s = this.h.session(sid)!, w = this.h.world(s.worldKey), p = w?.playerOf(sid);
            m.names.set(sid, s.name); m.accounts.set(sid, s.accountKey); this.matchOf.set(sid, m);
            if (w && p) m.origins.set(sid, { map: w.mapId, x: p.posX, y: p.posY });
            const c = cages.get(sid)!;
            if (!this.h.transfer(sid, { map: arena.id, x: c.x, y: c.y, instanceId: iid })) { m.gone.add(sid); this.say(sid, 'No se pudo entrar a la arena.'); }
        }
        const vs = (t: string[]) => t.map((s) => m.names.get(s)).join(' y ');
        console.log(`[Arena] Partida ${id} (${m.mode}) en ${arena.id}: ${vs(teams[0])} contra ${vs(teams[1])}`);
        this.sayAll([...teams[0], ...teams[1]], `${arena.name}: ${vs(teams[0])} contra ${vs(teams[1])}. Tienen ${ARENA_RULES.prepMs / 1000} s de preparación en su puesto.`);
    }

    private members(m: Match): string[] { return [...m.teams[0], ...m.teams[1]]; }
    /** Vivos de un equipo: los que siguen en la partida (o están llegando) y no están en el piso. */
    private alive(m: Match, t: 0 | 1): number {
        const w = this.h.world(m.key);
        return m.teams[t].filter((sid) => !m.gone.has(sid) && (this.h.pending(sid) || (!!w?.playerOf(sid) && !w.playerOf(sid)!.isDead))).length;
    }

    private tickMatch(m: Match, now: number): void {
        const w = this.h.world(m.key);
        // abandonos: el que ya no está en la instancia (se le venció la gracia, se cayó la sesión o salió por otro lado)
        for (const sid of this.members(m)) {
            if (m.gone.has(sid)) continue;
            const s = this.h.session(sid);
            if (!s || s.worldKey !== m.key) { this.abandon(m, sid); continue; }
            if (m.phase === 'prep' && !m.prepared.has(sid) && w?.playerOf(sid) && !this.h.pending(sid)) { w.arenaPrepare(sid); m.prepared.add(sid); }
        }
        if (m.phase === 'end') { if (now >= m.phaseUntil) this.closeMatch(m); return; }
        if (m.phase === 'prep' && now >= m.phaseUntil) {
            m.phase = 'fight'; m.fightStart = now; m.phaseUntil = now + ARENA_RULES.fightMs;
            w?.arenaFight(now);
            this.sayAll(this.members(m), `¡A pelear! Gana el equipo que deje en el piso al otro; a los ${ARENA_RULES.fightMs / 60_000} min es empate. Sin pociones ni resurrección; la curación baja 20 % cada 3 min.`);
        }
        const a0 = this.alive(m, 0), a1 = this.alive(m, 1);
        if (a0 === 0 || a1 === 0) return this.finish(m, a0 === 0 && a1 === 0 ? 'draw' : a0 === 0 ? 1 : 0);
        if (m.phase === 'fight' && now >= m.phaseUntil) return this.finish(m, 'draw');
    }

    private abandon(m: Match, sid: string): void {
        m.gone.add(sid);
        const name = m.names.get(sid) ?? '?';
        console.log(`[Arena] Partida ${m.id}: ${name} abandonó.`);
        const key = m.accounts.get(sid); if (key) this.penalties.set(key, this.now() + ARENA_RULES.penaltyMs);
        if (this.h.session(sid)) this.say(sid, `Abandonaste la partida de arena. No podés entrar por ${fmtMin(ARENA_RULES.penaltyMs)}.`);
        this.sayAll(this.members(m).filter((s) => s !== sid && !m.gone.has(s)), `${name} abandonó la partida.`);
    }

    /** Fin de la partida: se actualizan los ratings de todos (los que abandonaron cuentan como derrota de su equipo) y arranca el festejo. */
    private finish(m: Match, winner: 0 | 1 | 'draw'): void {
        const now = this.now();
        m.phase = 'end'; m.phaseUntil = now + ARENA_RULES.endMs;
        const before = new Map(this.members(m).map((sid) => [sid, this.ratingOf(m.accounts.get(sid)!, m.mode)]));
        const opp = (t: 0 | 1) => teamOpponent(m.teams[t === 0 ? 1 : 0].map((s) => before.get(s)!));
        const lines: string[] = [];
        for (const t of [0, 1] as const) for (const sid of m.teams[t]) {
            const key = m.accounts.get(sid)!, cur = before.get(sid)!, score = winner === 'draw' ? 0.5 : winner === t ? 1 : 0;
            const next = glicko2(cur, [{ ...opp(t), score }]);
            const e: LadderEntry = { ...next, name: m.names.get(sid) ?? cur.name, n: cur.n + 1, w: cur.w + (score === 1 ? 1 : 0), l: cur.l + (score === 0 ? 1 : 0), d: cur.d + (score === 0.5 ? 1 : 0) };
            this.ladder.modes[m.mode][key] = e;
            const diff = Math.round(e.r) - Math.round(cur.r);
            lines.push(`${e.name} ${Math.round(e.r)} (${diff >= 0 ? '+' : ''}${diff})`);
        }
        this.persist();
        const names = (t: 0 | 1) => m.teams[t].map((s) => m.names.get(s)).join(' y ');
        const head = winner === 'draw' ? 'Empate.' : `Ganan ${names(winner)}.`;
        console.log(`[Arena] Partida ${m.id} terminó: ${winner === 'draw' ? 'empate' : `gana el equipo ${winner}`} (${Math.round((now - (m.fightStart || now)) / 1000)} s de pelea).`);
        this.sayAll(this.members(m).filter((s) => !m.gone.has(s)), `${head} Rating ${m.mode}: ${lines.join(' · ')}. Volvés a donde estabas en ${ARENA_RULES.endMs / 1000} s.`);
        this.h.world(m.key)?.arenaEnd();
    }

    /** Vuelve cada uno al punto exacto desde donde entró, con la vida llena (la revive el mundo en `arenaEnd`). */
    private closeMatch(m: Match): void {
        const w = this.h.world(m.key);
        for (const sid of this.members(m)) {
            if (this.matchOf.get(sid) === m) this.matchOf.delete(sid);
            if (m.gone.has(sid) || !w?.playerOf(sid)) continue;
            const o = m.origins.get(sid);
            if (!o || !this.h.transfer(sid, o)) console.log(`[Arena] ${m.names.get(sid)} no pudo volver a su punto de entrada.`);
        }
        this.matches.delete(m.id);
    }

    // ---------- reloj y salidas ----------
    /** Cada ~1 s: vence invitaciones, revisa la cola, empareja y avanza las partidas. */
    tick(): void {
        const now = this.now();
        for (const inv of [...this.invites.values()]) if (now >= inv.expires) {
            this.closeInvite(inv);
            const late = inv.entries.flatMap((e) => e.members).filter((m) => !inv.accepted.has(m));
            this.failInvite(inv, late, `${late.map((s) => this.nameOf(s)).join(' y ')} no aceptó a tiempo`, 'No aceptaste la partida a tiempo.');
        }
        // red de seguridad: una party que cambió sin pasar por `partyLeft` (desconexión en la gracia, server raro) sale de la cola sin penalizar
        for (const mode of ARENA_MODES) for (const e of [...this.queue.get(mode)!]) {
            const party = this.h.partyMembers(e.leader);
            const same = e.members.length === 1 ? party.length === 0 : party.length === e.members.length && e.members.every((m) => party.includes(m));
            const off = e.members.filter((m) => !this.h.session(m)?.online);
            if (same && !off.length) continue;
            this.dequeue(e);
            this.sayAll(e.members, `La party cambió${off.length ? ` (${off.map((c) => this.nameOf(c)).join(' y ')} se desconectó)` : ''}: salió de la cola de ${e.mode}.`);
        }
        this.matchmake(now);
        for (const m of [...this.matches.values()]) this.tickMatch(m, now);
    }

    /**
     * Alguien dejó la party (party.ts): si estaba en la cola, la party sale y la penalización la paga quien lo decidió (`by`: el que se fue,
     * o el líder si lo expulsó). Con una invitación pendiente cuenta como no entrar. En partida no cambia nada (los equipos ya están armados).
     */
    partyLeft(sid: string, by: string): void {
        const e = this.entryOf.get(sid);
        if (e && e.members.length > 1) {
            this.dequeue(e);
            if (this.h.session(by)?.online) this.penalize(by, by === sid ? `Dejaste la party mientras estaba en la cola de ${e.mode}.` : `Expulsaste a un compañero mientras estaban en la cola de ${e.mode}.`);
            this.sayAll(e.members.filter((m) => m !== by), `La party cambió (${this.nameOf(sid)} ${by === sid ? 'salió' : 'fue expulsado'}): salió de la cola de ${e.mode}.`);
        }
        const inv = this.inviteOf.get(sid);
        if (inv && this.h.session(by)?.online) { this.closeInvite(inv); this.failInvite(inv, [by], `${this.nameOf(sid)} dejó la party`, 'Dejaste la party con una partida de arena esperando.'); }
    }

    /**
     * La sesión se terminó (se le venció la gracia o cerró): si estaba en la cola o con una invitación cuenta como salir (penalización);
     * si estaba en una partida, como abandono (lo detecta `tickMatch`).
     */
    sessionGone(sid: string, accountKey: string): void {
        const inv = this.inviteOf.get(sid);
        if (inv) { this.closeInvite(inv); this.penalties.set(accountKey, this.now() + ARENA_RULES.penaltyMs); this.failInvite(inv, [sid], `${this.nameOf(sid)} se desconectó`); }
        const e = this.entryOf.get(sid);
        if (e) {
            this.dequeue(e); this.penalties.set(accountKey, this.now() + ARENA_RULES.penaltyMs);
            this.sayAll(e.members.filter((m) => m !== sid), `${this.nameOf(sid)} se desconectó: tu party salió de la cola de ${e.mode}.`);
        }
        const m = this.matchOf.get(sid);
        if (m && !m.gone.has(sid)) this.abandon(m, sid);
    }
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
