/**
 * Chat + log de combate: abajo a la izquierda, a la altura del HUD (D.15). Abierto: pestañas, mensajes con scroll y entrada. Colapsado: las últimas 3 líneas sin fondo; Enter o un clic lo abre, Esc lo cierra.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CHAT_TABS, chatBus, tabShows, useChatStore, type ChatMessage, type ChatTab } from './chatStore';

const GOLD = '#d6a445';
const NAME_COLOR: Partial<Record<ChatMessage['channel'], string>> = {
    global: '#5fd3e6', comercio: '#e0a96b', area: '#7be07b', party: '#7fb6ff', guild: '#7fe0b0', nacion: '#e0b04a', private: '#e58fe0',
};

const S: Record<string, CSSProperties> = {
    // D.15: abajo a la izquierda, a la altura del HUD (el HUD se corre a la derecha o se achica si no entran los dos; ver layoutHud en main.ts).
    box: {
        position: 'fixed', left: 'max(12px, env(safe-area-inset-left, 0px))', bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))', width: 'var(--chat-w, 360px)', maxWidth: 'calc(100vw - 24px)', height: 170, zIndex: 20,
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, rgba(14,18,24,.86), rgba(8,11,15,.9))',
        border: '1px solid rgba(255,255,255,.08)', boxShadow: '0 6px 24px rgba(0,0,0,.5)',
        font: "13px 'Alegreya Sans', system-ui, sans-serif", color: '#dfe7ef',
    },
    // colapsado: solo las últimas líneas, sin fondo (se clickea para abrir)
    boxClosed: { height: 'auto', background: 'none', border: '1px solid transparent', boxShadow: 'none', cursor: 'pointer', textShadow: '0 1px 2px #000, 0 0 3px #000' },
    toggle: { flex: 'none', marginLeft: 'auto', background: 'none', border: 0, color: '#8da0b2', font: 'inherit', fontSize: 13, padding: '3px 8px', cursor: 'pointer' },
    tabsScroll: { display: 'flex', gap: 2, flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' },
    tabs: { display: 'flex', gap: 2, padding: '0 4px', borderBottom: '1px solid rgba(138,118,64,.45)', flex: 'none', background: 'linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,0))' },
    tab: { background: 'none', border: 0, borderBottom: '2px solid transparent', color: '#8da0b2', font: 'inherit', fontSize: 12, padding: '5px 7px 4px', cursor: 'pointer', whiteSpace: 'nowrap' },
    badge: { display: 'inline-block', minWidth: 14, marginLeft: 4, padding: '0 4px', borderRadius: 8, background: '#b3262f', color: '#fff', fontSize: 10, lineHeight: '14px', textAlign: 'center', verticalAlign: 'top' },
    tabOn: { color: '#f2dc9e', borderBottomColor: GOLD },
    list: { flex: 1, overflowY: 'auto', padding: '4px 8px', lineHeight: 1.35, overflowWrap: 'anywhere' },
    listClosed: { flex: 'none', overflow: 'hidden', maxHeight: 62, padding: '4px 8px', lineHeight: 1.35, overflowWrap: 'anywhere' },
    line: { margin: 0 },
    ts: { color: '#64748399', marginRight: 5, fontSize: 11 },
    sys: { color: '#9fb2c4', fontSize: 12 },
    input: { flex: 'none', background: 'rgba(0,0,0,.55)', border: 0, borderTop: '1px solid rgba(138,118,64,.35)', color: '#fff', font: 'inherit', padding: '7px 9px', outline: 'none' },
};

function Line({ m }: { m: ChatMessage }) {
    const sys = m.channel === 'system' || m.channel === 'combat';
    const body = m.html ? <span dangerouslySetInnerHTML={{ __html: m.text }} /> : <span>{m.text}</span>;
    return (
        <p style={{ ...S.line, ...(sys ? S.sys : null), ...(m.color ? { color: m.color } : null) }}>
            <span style={S.ts}>{m.timestamp}</span>
            {sys
                ? m.sender && m.sender !== 'System' ? <><span style={{ color: m.color ?? '#c9c9c9' }}>{m.sender}: </span>{body}</> : body
                : m.sender
                    ? <><span style={{ color: NAME_COLOR[m.channel] ?? '#5fd3e6', fontWeight: 600 }}>{m.sender}: </span><span style={{ color: m.color ?? '#fff' }}>{body}</span></>
                    : <span style={{ color: m.color ?? NAME_COLOR[m.channel] ?? '#fff' }}>{body}</span>}
        </p>
    );
}

/** A qué canal sale lo que escribís según la pestaña (All y System mandan a Global). */
const TAB_SAY: Record<ChatTab, string> = {
    all: 'Global', system: 'Global', global: 'Global', nacion: 'Nación', area: 'Área', comercio: 'Comercio', party: 'Party', guild: 'Guild', private: 'Privado',
};

/** Cuántas líneas muestra el chat colapsado. */
const CLOSED_LINES = 3;

export function ChatBox() {
    const open = useChatStore((s) => s.open), setOpen = useChatStore((s) => s.setOpen), focusReq = useChatStore((s) => s.focusReq);
    const inputRef = useRef<HTMLInputElement>(null), tabsRef = useRef<HTMLDivElement>(null);
    const messages = useChatStore((s) => s.messages), tab = useChatStore((s) => s.activeTab), setTab = useChatStore((s) => s.setActiveTab), unread = useChatStore((s) => s.unread);
    const shown = useMemo(() => messages.filter((m) => tabShows(tab, m.channel)), [messages, tab]);
    // colapsado: las últimas líneas de todo lo que pasa (charla, sistema y combate), sin importar la pestaña
    const lastLines = useMemo(() => messages.slice(-CLOSED_LINES), [messages]);
    // en un panel angosto no entran todas las pestañas: la activa se trae a la vista
    useEffect(() => { tabsRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [tab, open]);
    // Enter abre el chat y pone el cursor en la entrada
    useEffect(() => { if (focusReq > 0) inputRef.current?.focus(); }, [focusReq, open]);
    const listRef = useRef<HTMLDivElement>(null);
    const [text, setText] = useState('');

    // auto-scroll al llegar mensajes (o al cambiar de pestaña)
    useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [shown.length, tab]);

    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation(); // el juego no ve las teclas mientras se escribe
        if (e.key === 'Enter') {
            e.preventDefault();
            const t = text.trim();
            if (t) chatBus.emit('chat:send', { text: t, channel: tab });
            setText(''); e.currentTarget.blur(); setOpen(false); // al mandar, el chat vuelve a colapsarse
        } else if (e.key === 'Escape') { e.currentTarget.blur(); setOpen(false); }
        else if (e.key === 'Tab') {
            e.preventDefault();
            const i = CHAT_TABS.findIndex((x) => x.id === tab), n = CHAT_TABS.length;
            setTab(CHAT_TABS[(i + (e.shiftKey ? -1 : 1) + n) % n].id);
        }
    };

    if (!open) {
        return (
            <div style={{ ...S.box, ...S.boxClosed }} className="hud" role="log" aria-live="polite" aria-label="Chat (clic o Enter para escribir)" title="Clic o Enter para abrir el chat"
                onMouseDown={(e) => e.stopPropagation()} onClick={() => useChatStore.setState((st) => ({ open: true, focusReq: st.focusReq + 1 }))}>
                <div style={S.listClosed}>{lastLines.map((m) => <Line key={m.id} m={m} />)}</div>
            </div>
        );
    }
    return (
        <div style={S.box} className="hud" onMouseDown={(e) => e.stopPropagation()}>
            <div style={S.tabs}>
              <div style={S.tabsScroll} role="tablist" ref={tabsRef}>
                {CHAT_TABS.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={{ ...S.tab, ...(tab === t.id ? S.tabOn : null) }} onClick={() => setTab(t.id)}>
                        {t.label}{tab !== t.id && unread[t.id] ? <span style={S.badge} aria-label={`${unread[t.id]} sin leer`}>{unread[t.id]! > 99 ? '99+' : unread[t.id]}</span> : null}
                    </button>
                ))}
              </div>
                <button type="button" style={S.toggle} aria-label="Cerrar el chat (Esc)" title="Cerrar (Esc)" onClick={() => setOpen(false)}>▾</button>
            </div>
            <div ref={listRef} style={S.list} aria-live="polite">
                {shown.map((m) => <Line key={m.id} m={m} />)}
            </div>
            <input ref={inputRef} id="chatIn" style={S.input} maxLength={200} autoComplete="off" placeholder={`Decir en ${TAB_SAY[tab]}:`} aria-label={`Chat (${TAB_SAY[tab]})`}
                value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        </div>
    );
}
