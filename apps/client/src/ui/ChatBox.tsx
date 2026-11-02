/**
 * Chat + log de combate: abajo a la izquierda, pestañas arriba, mensajes con scroll y el input abajo.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CHAT_TABS, chatBus, tabShows, useChatStore, type ChatMessage } from './chatStore';

const GOLD = '#d6a445';
const NAME_COLOR: Partial<Record<ChatMessage['channel'], string>> = {
    global: '#5fd3e6', area: '#7be07b', party: '#7fb6ff', guild: '#7fe0b0', nacion: '#e0b04a', private: '#e58fe0',
};

const S: Record<string, CSSProperties> = {
    box: {
        position: 'fixed', left: 0, bottom: 0, width: 450, maxWidth: '100vw', height: 250, zIndex: 20,
        display: 'flex', flexDirection: 'column', background: 'rgba(15,15,15,0.85)',
        borderTop: '1px solid rgba(214,164,69,.25)', borderRight: '1px solid rgba(214,164,69,.25)', borderTopRightRadius: 6,
        font: "13px 'Alegreya Sans', system-ui, sans-serif", color: '#eee',
    },
    tabs: { display: 'flex', gap: 2, padding: '0 4px', borderBottom: '1px solid rgba(255,255,255,.08)', flex: 'none' },
    tab: { background: 'none', border: 0, borderBottom: '2px solid transparent', color: '#8a8a8a', font: 'inherit', fontSize: 12, padding: '5px 7px 4px', cursor: 'pointer' },
    tabOn: { color: '#f3e3b5', borderBottomColor: GOLD },
    list: { flex: 1, overflowY: 'auto', padding: '4px 8px', lineHeight: 1.35, overflowWrap: 'anywhere' },
    line: { margin: 0 },
    ts: { color: '#666', marginRight: 5, fontSize: 11 },
    sys: { color: '#a0a0a0', fontSize: 12 },
    input: { flex: 'none', background: 'rgba(0,0,0,.6)', border: 0, borderTop: '1px solid rgba(255,255,255,.08)', color: '#fff', font: 'inherit', padding: '6px 8px', outline: 'none' },
};

function Line({ m }: { m: ChatMessage }) {
    const sys = m.channel === 'system' || m.channel === 'combat';
    const body = m.html ? <span dangerouslySetInnerHTML={{ __html: m.text }} /> : <span>{m.text}</span>;
    return (
        <p style={{ ...S.line, ...(sys ? S.sys : null), ...(m.color ? { color: m.color } : null) }}>
            <span style={S.ts}>{m.timestamp}</span>
            {sys
                ? m.sender && m.sender !== 'System' ? <><span style={{ color: m.color ?? '#c9c9c9' }}>{m.sender}: </span>{body}</> : body
                : <><span style={{ color: NAME_COLOR[m.channel] ?? '#5fd3e6', fontWeight: 600 }}>{m.sender}: </span><span style={{ color: m.color ?? '#fff' }}>{body}</span></>}
        </p>
    );
}

export function ChatBox() {
    const messages = useChatStore((s) => s.messages), tab = useChatStore((s) => s.activeTab), setTab = useChatStore((s) => s.setActiveTab);
    const shown = useMemo(() => messages.filter((m) => tabShows(tab, m.channel)), [messages, tab]);
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
            setText(''); e.currentTarget.blur();
        } else if (e.key === 'Escape') e.currentTarget.blur();
        else if (e.key === 'Tab') {
            e.preventDefault();
            const i = CHAT_TABS.findIndex((x) => x.id === tab), n = CHAT_TABS.length;
            setTab(CHAT_TABS[(i + (e.shiftKey ? -1 : 1) + n) % n].id);
        }
    };

    return (
        <div style={S.box} className="hud" onMouseDown={(e) => e.stopPropagation()}>
            <div style={S.tabs} role="tablist">
                {CHAT_TABS.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={{ ...S.tab, ...(tab === t.id ? S.tabOn : null) }} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
            </div>
            <div ref={listRef} style={S.list} aria-live="polite">
                {shown.map((m) => <Line key={m.id} m={m} />)}
            </div>
            <input id="chatIn" style={S.input} maxLength={200} autoComplete="off" placeholder="Decir:" aria-label="Chat"
                value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        </div>
    );
}
