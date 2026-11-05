/**
 * Estado del chat (Zustand) + puente con el juego.
 * El juego escribe con `logToChat`; el ChatBox avisa los envíos por `chatBus` ('chat:send').
 */
import { create } from 'zustand';

export type ChatChannel = 'all' | 'global' | 'comercio' | 'area' | 'private' | 'party' | 'guild' | 'nacion' | 'system' | 'combat';
export type ChatTab = 'all' | 'global' | 'nacion' | 'comercio' | 'area' | 'private' | 'party' | 'guild' | 'system';

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
    { id: 'all', label: 'All' }, { id: 'global', label: 'Global' }, { id: 'nacion', label: 'Nación' }, { id: 'area', label: 'Area' },
    { id: 'comercio', label: 'Comercio' }, { id: 'party', label: 'Party' }, { id: 'guild', label: 'Guild' }, { id: 'system', label: 'System' },
];
// 'private' (susurros) sigue en los tipos pero sin pestaña hasta que el server tenga mensajes privados.

const TAB_KEY = 'fdn:chattab';
/** Pestaña con la que se cerró la vez anterior (si sigue existiendo). */
function loadTab(): ChatTab {
    try { const v = localStorage.getItem(TAB_KEY); if (v && CHAT_TABS.some((t) => t.id === v)) return v as ChatTab; } catch { /* sin almacenamiento */ }
    return 'all';
}
function saveTab(t: ChatTab): void { try { localStorage.setItem(TAB_KEY, t); } catch { /* sin almacenamiento */ } }

const MAX = 100;

interface ChatState {
    messages: ChatMessage[];
    /** Panel abierto (pestañas, historial y entrada) o colapsado (solo las últimas líneas, sin fondo). Enter lo abre, Esc lo cierra. */
    open: boolean;
    /** Sube cada vez que se pide escribir (Enter): el ChatBox enfoca la entrada recién abierta. */
    focusReq: number;
    setOpen: (open: boolean) => void;
    activeTab: ChatTab;
    /** Mensajes sin leer por pestaña (solo chat de jugadores; el log de combate y del sistema no cuenta). */
    unread: Partial<Record<ChatTab, number>>;
    addMessage: (msg: ChatMessage) => void;
    setActiveTab: (tab: ChatTab) => void;
}

export const useChatStore = create<ChatState>((set) => ({
    messages: [],
    open: false,
    focusReq: 0,
    setOpen: (open) => set({ open }),
    activeTab: loadTab(),
    unread: {},
    addMessage: (msg) => set((s) => {
        const messages = s.messages.length >= MAX ? [...s.messages.slice(s.messages.length - MAX + 1), msg] : [...s.messages, msg];
        if (msg.channel === 'system' || msg.channel === 'combat' || tabShows(s.activeTab, msg.channel)) return { messages }; // ya lo estás viendo
        // cuenta en cada pestaña que mostraría el mensaje (las demás)
        const unread = { ...s.unread };
        for (const t of CHAT_TABS) if (tabShows(t.id, msg.channel)) unread[t.id] = (unread[t.id] ?? 0) + 1;
        return { messages, unread };
    }),
    setActiveTab: (tab) => { saveTab(tab); set((s) => ({ activeTab: tab, unread: { ...s.unread, [tab]: 0 } })); },
}));

/** Enter: abre el chat y pone el cursor en la entrada (para que el juego no dependa de que el input exista mientras está colapsado). */
export const openChat = (): void => useChatStore.setState((s) => ({ open: true, focusReq: s.focusReq + 1 }));

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
