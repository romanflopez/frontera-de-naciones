/**
 * Guilds (docs/GUILDS.md): escudo, cofre compartido y lista de miembros con avisos de conexión y ascensos.
 *
 * - La identidad de un miembro es la clave de su personaje (`c_<hex>`, o la de la cuenta en las cuentas viejas): la guild
 *   es del personaje, no de la cuenta. Un personaje está en una sola guild; una guild es de una sola facción.
 * - Rangos: líder (uno), oficial y miembro. Líder y oficiales invitan y expulsan (el oficial, solo a miembros) y pueden
 *   retirar del cofre; todos pueden guardar. Solo el líder asciende, baja, cede el liderazgo, cambia el escudo y el lema y disuelve.
 * - Persistencia: todas las guilds viven en un registro propio (`_guilds`) del mismo Storage que las cuentas (archivo JSON o
 *   fila jsonb en Postgres), igual que la casa de subastas. Cada cambio se escribe con `flush` junto con la cuenta tocada.
 * - El cofre compartido corre sobre las mismas acciones del Depósito (`Depot` con un `VaultHost`): se abre en el Depositario con
 *   `DepositRequest.scope = 'guild'`. Guarda un registro de los últimos movimientos para que se vea quién sacó qué.
 * - Lo que vive en memoria del server (y se arma de nuevo al arrancar): quién está conectado y las invitaciones pendientes.
 */
import type { ServerMessage } from '@fdn/proto';
import type { Econ } from './economy.ts';
import { newVault, type Actor, type Vault, type VaultHost } from './deposit.ts';
import * as M from './messages.ts';
import type { AccountRecord, Storage } from './storage.ts';

export const GUILD_STORAGE_KEY = '_guilds';
export const GUILD_MAX = 40;
/** Crear una guild: oro (sumidero) y nivel mínimo del fundador. */
export const GUILD_CREATE_GOLD = 5000;
export const GUILD_MIN_LEVEL = 10;
export const GUILD_INVITE_MS = 60_000;
/** Casillas de equipo del cofre compartido (el doble del depósito de cuenta). */
export const GUILD_VAULT_SLOTS = 96;
/** Movimientos del cofre que se recuerdan. */
export const GUILD_LOG_KEEP = 40;
export const GUILD_MOTD_MAX = 120;
/** Escudo: "forma,fondo,figura,símbolo" (índices). El cliente tiene las mismas tablas (apps/client/src/guild.ts). */
export const CREST_SHAPES = 4, CREST_COLORS = 8, CREST_SYMBOLS = 12;
export const DEFAULT_CREST = '0,0,1,0';

export type GuildRank = 'lider' | 'oficial' | 'miembro';
const RANK_ORDER: Record<GuildRank, number> = { lider: 0, oficial: 1, miembro: 2 };
const RANK_NAME: Record<GuildRank, string> = { lider: 'líder', oficial: 'oficial', miembro: 'miembro' };

export interface GuildMemberRec { key: string; name: string; rank: GuildRank; joined: number; lastSeen: number }
export interface Guild {
    id: number; name: string; tag: string; faction: string; crest: string; motd: string; created: number;
    members: GuildMemberRec[];
    vault: Vault;
    /** Últimos movimientos del cofre, del más viejo al más nuevo. */
    log: { at: number; text: string }[];
}
export interface GuildBook { v: 1; nextId: number; guilds: Guild[] }
type BookRecord = AccountRecord & { guilds?: GuildBook };

/** Lo que el server sabe de un jugador conectado (por sesión). */
export interface GuildInfo { key: string; name: string; faction: string; level: number; cls: string; map: string; online: boolean; econ?: Econ }
export interface GuildHooks {
    /** sessionId de un personaje conectado por nombre. */
    sessionByName(name: string): string | undefined;
    /** sessionId de un personaje conectado por clave. */
    sessionByKey(key: string): string | undefined;
    send(sessionId: string, m: ServerMessage): void;
    info(sessionId: string): GuildInfo | undefined;
    now?(): number;
    /** Cambió la etiqueta de guild del jugador (entró, salió o la guild se disolvió): el mundo la muestra sobre su cabeza. */
    tagChanged?(sessionId: string, tag: string): void;
}

interface Invite { from: string; guildId: number; expires: number }

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '\-]{2,19}$/u;
const TAG_RE = /^[A-Z0-9]{2,4}$/;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fmt = (n: number) => Math.floor(n).toLocaleString('es-AR');

/** Valida y normaliza un escudo "forma,fondo,figura,símbolo"; null si no sirve. */
export function parseCrest(raw: string): string | null {
    const p = String(raw ?? '').split(',').map((x) => Number(x.trim()));
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0)) return null;
    if (p[0] >= CREST_SHAPES || p[1] >= CREST_COLORS || p[2] >= CREST_COLORS || p[3] >= CREST_SYMBOLS) return null;
    return p.join(',');
}

export class GuildService {
    private book: GuildBook;
    private readonly invites = new Map<string, Invite>();
    /** Lo último que se mandó por guild (para refrescar solo si cambió algo). */
    private readonly sent = new Map<number, string>();
    log: (line: string) => void = (line) => console.log(`[Guilds] ${line}`);

    constructor(private readonly h: GuildHooks, private readonly storage: Storage) {
        const rec = storage.get(GUILD_STORAGE_KEY) as BookRecord | undefined;
        this.book = rec?.guilds ?? { v: 1, nextId: 1, guilds: [] };
        for (const g of this.book.guilds) { g.vault ??= newVault(); g.vault.ops ??= []; g.vault.stacks ??= {}; g.log ??= []; g.crest ||= DEFAULT_CREST; g.motd ??= ''; }
        if (rec?.guilds) console.log(`[Guilds] ${this.book.guilds.length} guilds cargadas.`);
    }
    private now(): number { return this.h.now ? this.h.now() : Date.now(); }
    private say(sid: string, text: string): void { this.h.send(sid, M.sendMessage(text)); }

    // ---------- persistencia ----------
    /** Escribe la guild (todas viven en el mismo registro) y, si se pasa, la cuenta del actor, en un solo lote. */
    private save(actor?: Actor): void {
        if (actor) { const acc = this.storage.get(actor.key); if (acc) { acc.econ = actor.econ; this.storage.put(actor.key, acc); } }
        const rec: BookRecord = (this.storage.get(GUILD_STORAGE_KEY) as BookRecord | undefined) ?? { name: '(guilds)', salt: '', hash: '', created: this.now(), lastLogin: 0 };
        rec.guilds = this.book;
        this.storage.put(GUILD_STORAGE_KEY, rec);
        this.storage.flush();
    }

    // ---------- consultas ----------
    get guilds(): readonly Guild[] { return this.book.guilds; }
    guildOfKey(key: string): Guild | undefined { return this.book.guilds.find((g) => g.members.some((m) => m.key === key)); }
    memberOf(key: string): GuildMemberRec | undefined { return this.guildOfKey(key)?.members.find((m) => m.key === key); }
    guildOf(sid: string): Guild | undefined { const i = this.h.info(sid); return i ? this.guildOfKey(i.key) : undefined; }
    tagOf(key: string): string { return this.guildOfKey(key)?.tag ?? ''; }
    /** Sesiones conectadas de la guild de `sid` (vacío si no tiene guild). */
    onlineMembers(sid: string): string[] { const g = this.guildOf(sid); return g ? this.online(g) : []; }
    private online(g: Guild): string[] { return g.members.map((m) => this.h.sessionByKey(m.key)).filter((s): s is string => !!s); }
    private rankOf(g: Guild, key: string): GuildRank | undefined { return g.members.find((m) => m.key === key)?.rank; }
    canInvite(rank: GuildRank | undefined): boolean { return rank === 'lider' || rank === 'oficial'; }

    /** Cofre compartido del personaje `key` para el Depósito (null si no tiene guild). */
    vaultHost(key: string): VaultHost | null {
        const g = this.guildOfKey(key); if (!g) return null;
        const rank = this.rankOf(g, key);
        return {
            v: g.vault, slots: GUILD_VAULT_SLOTS, canTake: this.canInvite(rank), label: 'el cofre de la guild', scope: 'guild',
            save: (a) => { this.save(a); this.vaultChanged(g, a.key); },
            note: (_a, text) => { g.log.push({ at: this.now(), text }); if (g.log.length > GUILD_LOG_KEEP) g.log.splice(0, g.log.length - GUILD_LOG_KEEP); },
            log: () => [...g.log].reverse().map((l) => l.text),
        };
    }
    /** Alguien movió algo del cofre: los demás conectados que lo tengan abierto reciben el estado nuevo (lo manda index.ts). */
    onVaultChanged: (g: Guild, byKey: string) => void = () => {};
    private vaultChanged(g: Guild, byKey: string): void { this.onVaultChanged(g, byKey); }

    // ---------- acciones (GuildRequest) ----------
    handle(sid: string, action: string, rawName: string, rawArg: string): void {
        const name = rawName.trim().slice(0, 40), arg = rawArg.trim().slice(0, 160);
        switch (action) {
            case 'create': return this.create(sid, name, arg);
            case 'invite': return this.invite(sid, name);
            case 'accept': return this.accept(sid);
            case 'decline': return this.decline(sid);
            case 'leave': return this.leave(sid);
            case 'kick': return this.kick(sid, name);
            case 'promote': return this.setRank(sid, name, +1);
            case 'demote': return this.setRank(sid, name, -1);
            case 'leader': return this.setLeader(sid, name);
            case 'crest': return this.setCrest(sid, arg);
            case 'motd': return this.setMotd(sid, arg);
            case 'disband': return this.disband(sid);
            case 'info': return this.sendState(sid);
            default: this.say(sid, 'Acción de guild inválida.');
        }
    }

    private create(sid: string, name: string, tagRaw: string): void {
        const me = this.h.info(sid); if (!me || !me.econ) return;
        const tag = tagRaw.toUpperCase();
        if (this.guildOfKey(me.key)) { this.say(sid, 'Ya estás en una guild.'); return; }
        if (!me.faction) { this.say(sid, 'Todavía no tenés nación.'); return; }
        if (me.level < GUILD_MIN_LEVEL) { this.say(sid, `Para fundar una guild hay que ser nivel ${GUILD_MIN_LEVEL}.`); return; }
        if (!NAME_RE.test(name)) { this.say(sid, 'El nombre de la guild tiene que tener de 3 a 20 letras o números (se permiten espacios, guiones y apóstrofos).'); return; }
        if (!TAG_RE.test(tag)) { this.say(sid, 'La etiqueta tiene que tener de 2 a 4 letras o números: /guild crear <nombre> <ETIQUETA>.'); return; }
        if (this.book.guilds.some((g) => norm(g.name) === norm(name))) { this.say(sid, 'Ya hay una guild con ese nombre.'); return; }
        if (this.book.guilds.some((g) => g.tag === tag)) { this.say(sid, 'Ya hay una guild con esa etiqueta.'); return; }
        if (me.econ.gold < GUILD_CREATE_GOLD) { this.say(sid, `Fundar una guild cuesta ${fmt(GUILD_CREATE_GOLD)} de oro y llevás ${fmt(me.econ.gold)}.`); return; }
        me.econ.gold -= GUILD_CREATE_GOLD;
        const g: Guild = { id: this.book.nextId++, name, tag, faction: me.faction, crest: DEFAULT_CREST, motd: '', created: this.now(), members: [{ key: me.key, name: me.name, rank: 'lider', joined: this.now(), lastSeen: this.now() }], vault: newVault(), log: [] };
        this.book.guilds.push(g);
        this.save({ key: me.key, name: me.name, econ: me.econ });
        this.log(`${me.name} fundó «${g.name}» [${g.tag}] (${g.faction}).`);
        this.say(sid, `Fundaste la guild «${g.name}» [${g.tag}] por ${fmt(GUILD_CREATE_GOLD)} de oro. Invitá con /guild invitar <nombre>; el escudo se cambia desde la ventana de guild.`);
        this.h.tagChanged?.(sid, g.tag);
        this.pushState(g, true);
    }

    private invite(sid: string, name: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g) { this.say(sid, 'No tenés guild. Fundá una con /guild crear <nombre> <ETIQUETA>.'); return; }
        if (!this.canInvite(this.rankOf(g, me.key))) { this.say(sid, 'Solo el líder y los oficiales invitan.'); return; }
        const to = name ? this.h.sessionByName(name) : undefined, other = to ? this.h.info(to) : undefined;
        if (!to || !other || to === sid || !other.online) { this.say(sid, 'No encontré a ese jugador conectado.'); return; }
        if (other.faction !== g.faction) { this.say(sid, 'Solo podés invitar a jugadores de tu nación.'); return; }
        if (this.guildOfKey(other.key)) { this.say(sid, `${other.name} ya está en una guild.`); return; }
        if (g.members.length >= GUILD_MAX) { this.say(sid, `La guild está completa (${GUILD_MAX} miembros).`); return; }
        const cur = this.invites.get(to);
        if (cur && cur.expires > this.now() && cur.guildId === g.id) { this.say(sid, 'Ya tiene una invitación de la guild pendiente.'); return; }
        const expires = this.now() + GUILD_INVITE_MS;
        this.invites.set(to, { from: sid, guildId: g.id, expires });
        this.say(sid, `Invitaste a ${other.name} a la guild.`);
        this.h.send(to, M.guildInvited(me.name, g.name, g.tag, expires));
        this.say(to, `${me.name} te invitó a la guild «${g.name}» [${g.tag}]. Escribí /guild aceptar o /guild rechazar (vence en 60 s).`);
    }

    private accept(sid: string): void {
        const inv = this.invites.get(sid); this.invites.delete(sid);
        const me = this.h.info(sid); if (!me) return;
        if (!inv || inv.expires < this.now()) { this.say(sid, 'No tenés invitaciones de guild pendientes.'); return; }
        if (this.guildOfKey(me.key)) { this.say(sid, 'Ya estás en una guild.'); return; }
        const g = this.book.guilds.find((x) => x.id === inv.guildId);
        if (!g) { this.say(sid, 'Esa guild ya no existe.'); return; }
        if (g.faction !== me.faction) { this.say(sid, 'Esa guild es de otra nación.'); return; }
        if (g.members.length >= GUILD_MAX) { this.say(sid, 'La guild ya está completa.'); return; }
        g.members.push({ key: me.key, name: me.name, rank: 'miembro', joined: this.now(), lastSeen: this.now() });
        this.save();
        this.log(`${me.name} entró a «${g.name}».`);
        this.announce(g, `${me.name} se unió a la guild.`);
        this.h.tagChanged?.(sid, g.tag);
        this.pushState(g, true);
    }

    private decline(sid: string): void {
        const inv = this.invites.get(sid); this.invites.delete(sid);
        if (!inv) { this.say(sid, 'No tenés invitaciones de guild pendientes.'); return; }
        this.say(sid, 'Rechazaste la invitación.');
        const me = this.h.info(sid); if (me) this.say(inv.from, `${me.name} rechazó la invitación a la guild.`);
    }

    private leave(sid: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g) { this.say(sid, 'No estás en una guild.'); return; }
        if (this.rankOf(g, me.key) === 'lider') {
            if (g.members.length > 1) { this.say(sid, 'Sos el líder: cedé el liderazgo con /guild lider <nombre> antes de salir, o disolvé la guild con /guild disolver.'); return; }
            this.disband(sid); return;
        }
        this.removeMember(g, me.key);
        this.save();
        this.log(`${me.name} salió de «${g.name}».`);
        this.say(sid, `Saliste de «${g.name}».`);
        this.h.send(sid, M.guildState(null)); this.h.tagChanged?.(sid, '');
        this.announce(g, `${me.name} salió de la guild.`);
        this.pushState(g, true);
    }

    private kick(sid: string, name: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key), myRank = g ? this.rankOf(g, me.key) : undefined;
        if (!g || !this.canInvite(myRank)) { this.say(sid, 'Solo el líder y los oficiales expulsan.'); return; }
        const t = this.findMember(g, name);
        if (!t || t.key === me.key) { this.say(sid, 'Ese jugador no está en tu guild.'); return; }
        if (t.rank === 'lider' || (myRank === 'oficial' && t.rank !== 'miembro')) { this.say(sid, `Un oficial solo puede expulsar miembros.`); return; }
        this.removeMember(g, t.key);
        this.save();
        this.log(`${me.name} expulsó a ${t.name} de «${g.name}».`);
        const ts = this.h.sessionByKey(t.key);
        if (ts) { this.say(ts, `${me.name} te expulsó de «${g.name}».`); this.h.send(ts, M.guildState(null)); this.h.tagChanged?.(ts, ''); }
        this.announce(g, `${t.name} fue expulsado de la guild por ${me.name}.`);
        this.pushState(g, true);
    }

    private setRank(sid: string, name: string, dir: 1 | -1): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g || this.rankOf(g, me.key) !== 'lider') { this.say(sid, 'Solo el líder asciende y baja de rango.'); return; }
        const t = this.findMember(g, name);
        if (!t || t.key === me.key) { this.say(sid, 'Ese jugador no está en tu guild.'); return; }
        const next: GuildRank | null = dir > 0 ? (t.rank === 'miembro' ? 'oficial' : null) : (t.rank === 'oficial' ? 'miembro' : null);
        if (!next) { this.say(sid, dir > 0 ? `${t.name} ya es ${RANK_NAME[t.rank]}; el liderazgo se cede con /guild lider <nombre>.` : `${t.name} ya es ${RANK_NAME[t.rank]}.`); return; }
        t.rank = next;
        this.save();
        this.log(`${me.name} ${dir > 0 ? 'ascendió' : 'bajó'} a ${t.name} a ${RANK_NAME[next]} en «${g.name}».`);
        this.announce(g, dir > 0 ? `${t.name} ascendió a ${RANK_NAME[next]}.` : `${t.name} pasó a ${RANK_NAME[next]}.`);
        this.pushState(g, true);
    }

    private setLeader(sid: string, name: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g || this.rankOf(g, me.key) !== 'lider') { this.say(sid, 'Solo el líder puede ceder el liderazgo.'); return; }
        const t = this.findMember(g, name);
        if (!t || t.key === me.key) { this.say(sid, 'Ese jugador no está en tu guild.'); return; }
        const mine = g.members.find((m) => m.key === me.key)!;
        mine.rank = 'oficial'; t.rank = 'lider';
        this.save();
        this.log(`${me.name} le cedió «${g.name}» a ${t.name}.`);
        this.announce(g, `${t.name} es el nuevo líder de la guild (${me.name} queda como oficial).`);
        this.pushState(g, true);
    }

    private setCrest(sid: string, raw: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g || this.rankOf(g, me.key) !== 'lider') { this.say(sid, 'Solo el líder cambia el escudo.'); return; }
        const crest = parseCrest(raw);
        if (!crest) { this.say(sid, 'Escudo inválido.'); return; }
        g.crest = crest;
        this.save();
        this.announce(g, `${me.name} cambió el escudo de la guild.`);
        this.pushState(g, true);
    }

    private setMotd(sid: string, raw: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g || !this.canInvite(this.rankOf(g, me.key))) { this.say(sid, 'Solo el líder y los oficiales cambian el lema.'); return; }
        g.motd = raw.replace(/\s+/g, ' ').slice(0, GUILD_MOTD_MAX);
        this.save();
        this.announce(g, g.motd ? `Lema nuevo: ${g.motd}` : `${me.name} borró el lema.`);
        this.pushState(g, true);
    }

    private disband(sid: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        if (!g || this.rankOf(g, me.key) !== 'lider') { this.say(sid, 'Solo el líder puede disolver la guild.'); return; }
        if (g.vault.items.length || g.vault.gold > 0 || Object.keys(g.vault.stacks).length) { this.say(sid, 'El cofre de la guild tiene cosas: vaciálo antes de disolverla.'); return; }
        const online = this.online(g);
        this.book.guilds = this.book.guilds.filter((x) => x !== g);
        for (const [to, inv] of this.invites) if (inv.guildId === g.id) this.invites.delete(to);
        this.sent.delete(g.id);
        this.save();
        this.log(`${me.name} disolvió «${g.name}».`);
        for (const s of online) { this.say(s, `La guild «${g.name}» se disolvió.`); this.h.send(s, M.guildState(null)); this.h.tagChanged?.(s, ''); }
    }

    // ---------- conexión y estado ----------
    /** El personaje entró al mundo (o se reconectó): avisa a la guild y le manda su estado. */
    connected(sid: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key); if (!g) return;
        const m = g.members.find((x) => x.key === me.key)!;
        const wasOffline = !this.lastOnline.get(g.id)?.has(me.key); // en la gracia de reconexión no se vuelve a avisar
        m.lastSeen = this.now(); if (m.name !== me.name) m.name = me.name;
        this.h.tagChanged?.(sid, g.tag);
        if (wasOffline) for (const s of this.online(g)) if (s !== sid) this.h.send(s, M.serverChat('guild', 'Guild', `${me.name} se conectó.`, ''));
        this.pushState(g, true);
    }
    /** El personaje salió del mundo de verdad (no la gracia de reconexión). */
    disconnected(sid: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key); if (!g) return;
        const m = g.members.find((x) => x.key === me.key); if (m) m.lastSeen = this.now();
        this.save(); // la última conexión queda guardada
        this.lastOnline.get(g.id)?.delete(me.key);
        for (const s of this.online(g)) if (s !== sid) this.h.send(s, M.serverChat('guild', 'Guild', `${me.name} se desconectó.`, ''));
        this.pushState(g, true, sid);
    }
    /** Chat de guild: lo recibe cada miembro conectado. Devuelve false si no tiene guild. */
    chat(sid: string, text: string, senderName: string, senderId = ''): boolean {
        const g = this.guildOf(sid); if (!g) return false;
        const m = M.serverChat('guild', senderName, text, senderId);
        for (const s of this.online(g)) this.h.send(s, m);
        return true;
    }
    /** Un personaje se borra: sale de su guild (si era líder con gente, el que borra tiene que ceder antes). Devuelve un error o ''. */
    characterDeleted(key: string): string {
        const g = this.guildOfKey(key); if (!g) return '';
        const m = g.members.find((x) => x.key === key)!;
        if (m.rank === 'lider' && g.members.length > 1) return 'Ese personaje es líder de una guild: cedé el liderazgo (o disolvela) antes de borrarlo.';
        if (m.rank === 'lider') {
            if (g.vault.items.length || g.vault.gold > 0 || Object.keys(g.vault.stacks).length) return 'Ese personaje es líder de una guild con cosas en el cofre: vaciálo o disolvé la guild antes de borrarlo.';
            this.book.guilds = this.book.guilds.filter((x) => x !== g); this.save(); return '';
        }
        this.removeMember(g, key); this.save(); this.announce(g, `${m.name} dejó la guild (personaje borrado).`); this.pushState(g, true);
        return '';
    }

    private announce(g: Guild, text: string): void { for (const s of this.online(g)) this.h.send(s, M.serverChat('guild', 'Guild', text, '')); }
    private findMember(g: Guild, name: string): GuildMemberRec | undefined { const n = norm(name); return n ? g.members.find((m) => norm(m.name) === n) : undefined; }
    private removeMember(g: Guild, key: string): void {
        g.members = g.members.filter((m) => m.key !== key);
        this.lastOnline.get(g.id)?.delete(key);
    }

    /** Claves conectadas por guild en el último estado mandado (para el aviso "se conectó" una sola vez por conexión). */
    private readonly lastOnline = new Map<number, Set<string>>();

    private snapshot(g: Guild, exceptSid?: string) {
        const t = this.now();
        const rows = g.members.map((m) => {
            const s = this.h.sessionByKey(m.key), i = s && s !== exceptSid ? this.h.info(s) : undefined, online = !!i?.online;
            return { name: m.name, rank: m.rank, online, level: i?.level ?? 0, cls: i?.cls ?? '', map: online ? i!.map : '', lastSeenMs: online ? 0 : m.lastSeen || t, joinedMs: m.joined };
        });
        // conectados primero, después por rango y por última conexión (la más reciente arriba)
        rows.sort((a, b) => Number(b.online) - Number(a.online) || RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || b.lastSeenMs - a.lastSeenMs || a.name.localeCompare(b.name, 'es'));
        return rows;
    }
    private stateFor(g: Guild, key: string, rows: ReturnType<GuildService['snapshot']>): ServerMessage {
        return M.guildState({ id: String(g.id), name: g.name, tag: g.tag, faction: g.faction, crest: g.crest, members: rows, maxMembers: GUILD_MAX, motd: g.motd, myRank: this.rankOf(g, key) ?? '', createdMs: g.created });
    }
    /** Estado de tu guild a vos (o "sin guild"). */
    sendState(sid: string): void {
        const me = this.h.info(sid); if (!me) return;
        const g = this.guildOfKey(me.key);
        this.h.send(sid, g ? this.stateFor(g, me.key, this.snapshot(g)) : M.guildState(null));
    }
    /** Estado completo a todos los conectados de la guild; si `force` es false, solo cuando cambió algo (nivel, mapa, conexión). */
    private pushState(g: Guild, force: boolean, exceptSid?: string): void {
        const rows = this.snapshot(g, exceptSid);
        const key = JSON.stringify([g.name, g.tag, g.crest, g.motd, rows.map((r) => [r.name, r.rank, r.online, r.level, r.map])]);
        if (!force && this.sent.get(g.id) === key) return;
        this.sent.set(g.id, key);
        this.lastOnline.set(g.id, new Set(g.members.filter((m) => { const s = this.h.sessionByKey(m.key); return s && s !== exceptSid && this.h.info(s)?.online; }).map((m) => m.key)));
        for (const s of this.online(g)) { if (s === exceptSid) continue; const i = this.h.info(s); if (i) this.h.send(s, this.stateFor(g, i.key, rows)); }
    }

    /** Cada ~5 s: vence invitaciones y refresca la lista si cambió algo (niveles, mapas). */
    tick(): void {
        const t = this.now();
        for (const [to, inv] of this.invites) if (inv.expires < t) { this.invites.delete(to); const o = this.h.info(to); this.say(inv.from, `${o?.name ?? 'El invitado'} no respondió a la invitación a la guild.`); }
        for (const g of this.book.guilds) if (this.sent.has(g.id)) this.pushState(g, false);
    }
}

/** Servicio activo (lo crea index.ts); el mundo lo usa para la etiqueta sobre la cabeza sin depender del módulo de red. */
let active: GuildService | undefined;
export const setGuilds = (svc: GuildService | undefined): void => { active = svc; };
export const guildTagOf = (key: string): string => active?.tagOf(key) ?? '';
