/**
 * Chat por canales: global (todos los conectados), area (los que te ven), party (tu party) y nacion (tu facción).
 * Anti-spam: como mucho 1 mensaje por segundo por jugador.
 */
import type { ServerMessage } from '@fdn/proto';
import * as M from '../messages.ts';

export type ChatChannel = 'global' | 'area' | 'party' | 'nacion' | 'guild';
const CHANNELS = new Set<ChatChannel>(['global', 'area', 'party', 'nacion', 'guild']);
export const CHAT_THROTTLE_MS = 1000;

export interface ChatDeps {
    maxLength: number;
    /** Todas las sesiones conectadas. */
    allSessions(): Iterable<string>;
    /** Sesiones que ven a `sid` (mismo mapa, radio de visión), incluida la propia. */
    viewersOf(sid: string): string[];
    /** Sesiones de la party de `sid` (vacío si no tiene). */
    partyOf(sid: string): string[];
    /** Facción de `sid` (undefined si no tiene). */
    factionOf(sid: string): string | undefined;
    send(sid: string, m: ServerMessage): void;
}

export interface ChatSender { sessionId: string; name: string; playerId: string }

export class ChatManager {
    private last = new Map<string, number>();
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

        let to: Iterable<string>;
        switch (channel) {
            case 'global': to = this.d.allSessions(); break;
            case 'area': to = this.d.viewersOf(from.sessionId); break;
            case 'party': { const ms = this.d.partyOf(from.sessionId); if (!ms.length) return 'No estás en una party.'; to = ms; break; }
            case 'nacion': {
                const fac = this.d.factionOf(from.sessionId); if (!fac) return 'Todavía no tenés nación.';
                to = [...this.d.allSessions()].filter((s) => this.d.factionOf(s) === fac); break;
            }
            case 'guild': return 'Las guilds llegan próximamente.';
        }
        this.last.set(from.sessionId, t);
        const m = M.serverChat(channel, from.name, text, from.playerId);
        for (const sid of to) this.d.send(sid, m);
        return null;
    }

    /** Al desconectarse: libera el estado del throttle. */
    forget(sid: string): void { this.last.delete(sid); }
}
