/**
 * Chat por canales: global (todos los conectados), comercio (todos, para compraventa), area (los que te ven), party (tu party), nacion (tu facción) y guild (tu guild).
 * Anti-spam: como mucho 1 mensaje por segundo y `CHAT_PER_MINUTE` por minuto por jugador.
 */
import type { ServerMessage } from '@fdn/proto';
import * as M from '../messages.ts';

export type ChatChannel = 'global' | 'comercio' | 'area' | 'party' | 'nacion' | 'guild';
const CHANNELS = new Set<ChatChannel>(['global', 'comercio', 'area', 'party', 'nacion', 'guild']);
export const CHAT_THROTTLE_MS = 1000;
/** Tope de mensajes por minuto (ventana deslizante de 60 s) sumando todos los canales. */
export const CHAT_PER_MINUTE = 12;
const MINUTE_MS = 60_000;

export interface ChatDeps {
    maxLength: number;
    /** Todas las sesiones conectadas. */
    allSessions(): Iterable<string>;
    /** Sesiones que ven a `sid` (mismo mapa, radio de visión), incluida la propia. */
    viewersOf(sid: string): string[];
    /** Sesiones de la party de `sid` (vacío si no tiene). */
    partyOf(sid: string): string[];
    /** Sesiones conectadas de la guild de `sid` (vacío si no tiene). */
    guildOf?(sid: string): string[];
    /** Facción de `sid` (undefined si no tiene). */
    factionOf(sid: string): string | undefined;
    send(sid: string, m: ServerMessage): void;
}

export interface ChatSender { sessionId: string; name: string; playerId: string }

export class ChatManager {
    private last = new Map<string, number>();
    /** Instantes de los últimos mensajes de cada jugador (solo los de los últimos 60 s). */
    private recent = new Map<string, number[]>();
    constructor(private d: ChatDeps, private now: () => number = Date.now) {}

    /** Procesa un ClientChatMessage. Devuelve un texto de error para el que lo mandó, o null si salió. */
    handle(from: ChatSender, channelRaw: string, raw: string): string | null {
        const channel = (channelRaw || 'global').toLowerCase() as ChatChannel;
        if (!CHANNELS.has(channel)) return 'Canal de chat desconocido.';
        const text = raw.trim();
        if (!text) return 'El mensaje no puede estar vacío.';
        if (text.length > this.d.maxLength) return `El mensaje no puede pasar los ${this.d.maxLength} caracteres.`;
        const t = this.now(), prev = this.last.get(from.sessionId) ?? -Infinity;
        if (t - prev < CHAT_THROTTLE_MS) return 'Estás escribiendo muy rápido.';
        const win = (this.recent.get(from.sessionId) ?? []).filter((x) => t - x < MINUTE_MS);
        if (win.length >= CHAT_PER_MINUTE) { this.recent.set(from.sessionId, win); return `Llegaste al límite de ${CHAT_PER_MINUTE} mensajes por minuto.`; }

        let to: Iterable<string>;
        switch (channel) {
            case 'global': case 'comercio': to = this.d.allSessions(); break;
            case 'area': to = this.d.viewersOf(from.sessionId); break;
            case 'party': { const ms = this.d.partyOf(from.sessionId); if (!ms.length) return 'No estás en una party.'; to = ms; break; }
            case 'nacion': {
                const fac = this.d.factionOf(from.sessionId); if (!fac) return 'Todavía no tenés nación.';
                to = [...this.d.allSessions()].filter((s) => this.d.factionOf(s) === fac); break;
            }
            case 'guild': { const ms = this.d.guildOf?.(from.sessionId) ?? []; if (!ms.length) return 'No estás en una guild.'; to = ms; break; }
        }
        this.last.set(from.sessionId, t);
        win.push(t); this.recent.set(from.sessionId, win);
        const m = M.serverChat(channel, from.name, text, from.playerId);
        for (const sid of to) this.d.send(sid, m);
        return null;
    }

    /** Al desconectarse: libera el estado del throttle. */
    forget(sid: string): void { this.last.delete(sid); this.recent.delete(sid); }
}
