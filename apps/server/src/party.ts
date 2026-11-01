/**
 * Party (docs/PARTY_Y_ARENAS.md §1): hasta 4 jugadores de la misma facción. Vive en memoria del server y es independiente de los
 * mundos: la identidad es el `sessionId`. Las acciones llegan como PartyRequest y el resultado se avisa con SendMessage / PartyState.
 * La exp y el botín compartidos los resuelve el mundo con `mates()` (ver `GameWorld` / `Economy.reward`).
 */
import type { ServerMessage } from '@fdn/proto';
import * as M from './messages.ts';

export const PARTY_MAX = 4;
export const INVITE_MS = 30_000;
/** Distancia (en celdas) a la que un compañero comparte exp y botín de un mob. */
export const PARTY_SHARE_RANGE = 20;
/** Exp total del grupo = exp del mob × (1 + 0,1 por compañero extra), repartida en partes iguales. */
export const partyExpMult = (n: number): number => (n <= 1 ? 1 : (1 + 0.1 * (n - 1)) / n);

export interface MemberInfo { name: string; faction: string; level: number; hp: number; maxHp: number; map: string; online: boolean }
export interface PartyHooks {
    /** sessionId por nombre de personaje (solo jugadores conectados). */
    sessionByName(name: string): string | undefined;
    send(sessionId: string, m: ServerMessage): void;
    info(sessionId: string): MemberInfo | undefined;
    now?(): number;
}

interface Party { id: number; leader: string; members: string[] }
interface Invite { from: string; partyId: number | null; expires: number }

export class PartyService {
    private readonly parties = new Map<number, Party>();
    private readonly partyOf = new Map<string, number>();
    private readonly invites = new Map<string, Invite>();
    private nextId = 1;
    constructor(private readonly h: PartyHooks) {}
    private now(): number { return this.h.now ? this.h.now() : Date.now(); }
    private say(sid: string, text: string): void { this.h.send(sid, M.sendMessage(text)); }
    private nameOf(sid: string): string { return this.h.info(sid)?.name ?? '?'; }

    partyIdOf(sid: string): number | undefined { return this.partyOf.get(sid); }
    /** Compañeros de la party (incluido él), o [sid] si no tiene party. */
    mates(sid: string): string[] { const p = this.parties.get(this.partyOf.get(sid) ?? -1); return p ? [...p.members] : [sid]; }
    membersOf(sid: string): string[] { return this.mates(sid); }
    isLeader(sid: string): boolean { const p = this.parties.get(this.partyOf.get(sid) ?? -1); return !!p && p.leader === sid; }

    /** Punto de entrada de PartyRequest. */
    handle(sid: string, action: string, name: string): void {
        const arg = name.trim().slice(0, 32);
        switch (action) {
            case 'invite': return this.invite(sid, arg);
            case 'accept': return this.accept(sid);
            case 'decline': return this.decline(sid);
            case 'leave': return this.leave(sid, 'Saliste de la party.');
            case 'kick': return this.kick(sid, arg);
            case 'leader': return this.setLeader(sid, arg);
            default: this.say(sid, 'Acción de party inválida.');
        }
    }

    private invite(sid: string, name: string): void {
        const me = this.h.info(sid), to = name ? this.h.sessionByName(name) : undefined, other = to ? this.h.info(to) : undefined;
        if (!me) return;
        if (!to || !other || to === sid || !other.online) { this.say(sid, 'No encontré a ese jugador conectado.'); return; }
        if (other.faction !== me.faction) { this.say(sid, 'Solo podés invitar a jugadores de tu facción.'); return; }
        const pid = this.partyOf.get(sid), party = pid ? this.parties.get(pid) : undefined;
        if (party && party.leader !== sid) { this.say(sid, 'Solo el líder puede invitar.'); return; }
        if (party && party.members.length >= PARTY_MAX) { this.say(sid, `La party ya tiene ${PARTY_MAX} jugadores.`); return; }
        if (this.partyOf.has(to)) { this.say(sid, `${other.name} ya está en una party.`); return; }
        const cur = this.invites.get(to);
        if (cur && cur.expires > this.now() && cur.from === sid) { this.say(sid, 'Ya le mandaste una invitación.'); return; }
        const expires = this.now() + INVITE_MS;
        this.invites.set(to, { from: sid, partyId: party?.id ?? null, expires });
        this.say(sid, `Invitaste a ${other.name} a tu party.`);
        this.h.send(to, M.partyInvited(me.name, expires));
        this.say(to, `${me.name} te invitó a su party. Escribí /aceptar o /rechazar (vence en 30 s).`);
    }

    private accept(sid: string): void {
        const inv = this.invites.get(sid); this.invites.delete(sid);
        if (!inv || inv.expires < this.now()) { this.say(sid, 'No tenés invitaciones pendientes.'); return; }
        if (this.partyOf.has(sid)) { this.say(sid, 'Ya estás en una party.'); return; }
        if (!this.h.info(inv.from)) { this.say(sid, 'Quien te invitó ya no está.'); return; }
        let party = inv.partyId !== null ? this.parties.get(inv.partyId) : this.parties.get(this.partyOf.get(inv.from) ?? -1);
        if (!party) {
            if (this.partyOf.has(inv.from)) { this.say(sid, 'La invitación ya no es válida.'); return; }
            party = { id: this.nextId++, leader: inv.from, members: [inv.from] };
            this.parties.set(party.id, party); this.partyOf.set(inv.from, party.id);
        }
        if (party.members.length >= PARTY_MAX) { this.say(sid, 'La party ya está completa.'); return; }
        party.members.push(sid); this.partyOf.set(sid, party.id);
        this.broadcast(party, `${this.nameOf(sid)} se unió a la party.`);
        this.pushState(party);
    }

    private decline(sid: string): void {
        const inv = this.invites.get(sid); this.invites.delete(sid);
        if (!inv) { this.say(sid, 'No tenés invitaciones pendientes.'); return; }
        this.say(sid, 'Rechazaste la invitación.'); this.say(inv.from, `${this.nameOf(sid)} rechazó tu invitación.`);
    }

    /** Sale de la party (o se va del juego). Si queda un solo miembro, se disuelve; si era el líder, pasa al siguiente. */
    leave(sid: string, msg?: string): void {
        this.invites.delete(sid);
        for (const [to, inv] of this.invites) if (inv.from === sid) this.invites.delete(to);
        const pid = this.partyOf.get(sid), party = pid ? this.parties.get(pid) : undefined;
        if (!party) { if (msg) this.say(sid, 'No estás en una party.'); return; }
        const name = this.nameOf(sid);
        party.members = party.members.filter((m) => m !== sid); this.partyOf.delete(sid);
        if (msg) this.say(sid, msg);
        this.h.send(sid, M.partyState([]));
        this.afterChange(party, `${name} salió de la party.`);
    }

    private kick(sid: string, name: string): void {
        const pid = this.partyOf.get(sid), party = pid ? this.parties.get(pid) : undefined;
        if (!party || party.leader !== sid) { this.say(sid, 'Solo el líder puede expulsar.'); return; }
        const target = party.members.find((m) => this.nameOf(m).toLowerCase() === name.toLowerCase());
        if (!target || target === sid) { this.say(sid, 'Ese jugador no está en tu party.'); return; }
        const tname = this.nameOf(target);
        party.members = party.members.filter((m) => m !== target); this.partyOf.delete(target);
        this.say(target, 'Te expulsaron de la party.'); this.h.send(target, M.partyState([]));
        this.afterChange(party, `${tname} fue expulsado de la party.`);
    }

    private setLeader(sid: string, name: string): void {
        const pid = this.partyOf.get(sid), party = pid ? this.parties.get(pid) : undefined;
        if (!party || party.leader !== sid) { this.say(sid, 'Solo el líder puede pasar el liderazgo.'); return; }
        const target = party.members.find((m) => this.nameOf(m).toLowerCase() === name.toLowerCase());
        if (!target || target === sid) { this.say(sid, 'Ese jugador no está en tu party.'); return; }
        party.leader = target;
        this.broadcast(party, `${this.nameOf(target)} es el nuevo líder.`); this.pushState(party);
    }

    private afterChange(party: Party, text: string): void {
        if (party.members.length <= 1) {
            for (const m of party.members) { this.partyOf.delete(m); this.say(m, `${text} La party se disolvió.`); this.h.send(m, M.partyState([])); }
            this.parties.delete(party.id); return;
        }
        if (!party.members.includes(party.leader)) party.leader = party.members[0];
        this.broadcast(party, text); this.pushState(party);
    }

    private broadcast(party: Party, text: string): void { for (const m of party.members) this.say(m, text); }

    /** Chat de party: lo recibe cada miembro. Devuelve false si no tiene party. */
    chat(sid: string, text: string, senderName: string): boolean {
        const party = this.parties.get(this.partyOf.get(sid) ?? -1); if (!party) return false;
        for (const m of party.members) this.h.send(m, M.chatMessageReceived(senderName, text, 'party'));
        return true;
    }

    private pushState(party: Party): void {
        const members = party.members.map((m) => { const i = this.h.info(m); return i ? { name: i.name, level: i.level, hp: i.hp, maxHp: i.maxHp, map: i.map, leader: m === party.leader, online: i.online } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
        const msg = M.partyState(members);
        for (const m of party.members) this.h.send(m, msg);
    }

    /** Cada ~1 s: vence invitaciones y refresca las barras de los compañeros. */
    tick(): void {
        const t = this.now();
        for (const [to, inv] of this.invites) if (inv.expires < t) { this.invites.delete(to); this.say(inv.from, `${this.nameOf(to)} no respondió a tu invitación.`); }
        for (const party of this.parties.values()) this.pushState(party);
    }
}

/** Servicio activo (lo crea index.ts); el mundo lo usa para repartir exp y botín sin depender del módulo de red. */
let active: PartyService | undefined;
export const setParties = (svc: PartyService | undefined): void => { active = svc; };
export const partyMates = (sid: string): string[] => active?.mates(sid) ?? [sid];

export const partyIdOf = (sid: string): number | undefined => active?.partyIdOf(sid);
