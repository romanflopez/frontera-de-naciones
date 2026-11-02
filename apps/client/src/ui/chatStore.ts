/**
 * Estado del chat (Zustand) + puente con el juego.
 * El juego escribe con `logToChat`; el ChatBox avisa los envíos por `chatBus` ('chat:send').
 */
import { create } from 'zustand';

export type ChatChannel = 'all' | 'global' | 'area' | 'private' | 'party' | 'guild' | 'nacion' | 'system' | 'combat';
export type ChatTab = 'all' | 'global' | 'area' | 'private' | 'party' | 'guild' | 'system';

export interface ChatMessage {
    id: string;
    channel: ChatChannel;
    sender: string;
    text: string;
    /** HH:MM */
    timestamp: string;
    /** Opcional para sobreescribir el color por defecto. */
    color?: string;
    /** Texto ya escapado con marcado (líneas viejas del log del juego, con colores de rareza). */
    html?: boolean;
}

export const CHAT_TABS: { id: ChatTab; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'global', label: 'Global' }, { id: 'area', label: 'Area' }, { id: 'private', label: 'Private' },
    { id: 'party', label: 'Party' }, { id: 'guild', label: 'Guild' }, { id: 'system', label: 'System' },
];

const MAX = 100;

interface ChatState {
    messages: ChatMessage[];
    activeTab: ChatTab;
    addMessage: (msg: ChatMessage) => void;
    setActiveTab: (tab: ChatTab) => void;
}

export const useChatStore = create<ChatState>((set) => ({
    messages: [],
    activeTab: 'all',
    addMessage: (msg) => set((s) => ({ messages: s.messages.length >= MAX ? [...s.messages.slice(s.messages.length - MAX + 1), msg] : [...s.messages, msg] })),
    setActiveTab: (tab) => set({ activeTab: tab }),
}));

/** Qué canales muestra cada pestaña. */
export function tabShows(tab: ChatTab, ch: ChatChannel): boolean {
    if (tab === 'all') return true;
    if (tab === 'system') return ch === 'system' || ch === 'combat';
    return tab === ch;
}

/** Colores con nombre que acepta `logToChat` además de CSS. */
const NAMED: Record<string, string> = { 'púrpura': '#b26bff', purpura: '#b26bff', purple: '#b26bff', azul: '#5fa8ff', blue: '#5fa8ff' };

let seq = 0;
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Agrega una línea al chat. `color` acepta CSS o 'púrpura' / 'azul'. */
export function logToChat(channel: ChatChannel, sender: string, text: string, color?: string, html = false): void {
    useChatStore.getState().addMessage({ id: `${Date.now()}-${seq++}`, channel, sender, text, timestamp: hhmm(), color: color ? NAMED[color] ?? color : undefined, html });
}

// ---------- bus de eventos UI → juego ----------
type ChatEvents = { 'chat:send': { text: string; channel: ChatTab } };
const handlers = new Map<string, Set<(v: never) => void>>();
export const chatBus = {
    on<K extends keyof ChatEvents>(k: K, fn: (v: ChatEvents[K]) => void): () => void {
        let set = handlers.get(k); if (!set) handlers.set(k, (set = new Set()));
        set.add(fn as (v: never) => void); return () => { set.delete(fn as (v: never) => void); };
    },
    emit<K extends keyof ChatEvents>(k: K, v: ChatEvents[K]): void { handlers.get(k)?.forEach((fn) => (fn as (v: ChatEvents[K]) => void)(v)); },
};
