import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CLASS_DATA, type Spell } from '../data/spells';
import { spellIcon } from '../icons.ts';
import { SPELL_COLORS } from './colors';
import { SPELL_DND, useSpellbook } from './spellbookStore';

type Tab = 'spells' | 'techniques' | 'paths';
const TABS: [Tab, string][] = [['spells', 'Habilidades'], ['techniques', 'Técnicas'], ['paths', 'Caminos']];
const GOLD = 'rgba(214,164,69,.55)';
const FONT = "'Alegreya SC', Georgia, serif";

const panel: React.CSSProperties = {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 500, zIndex: 60,
    display: 'flex', flexDirection: 'column', background: 'rgba(14,12,10,.88)', color: '#f0e2c0', font: `14px ${FONT}`,
    border: '3px solid #6d6a66', borderRadius: 6, boxShadow: 'inset 0 0 0 1px #b8b4ad, inset 0 0 0 4px #3a3836, 0 8px 30px rgba(0,0,0,.7)',
};
const fmtS = (s: number) => `${+s.toFixed(1)}s`;

function Tooltip({ s, x, y }: { s: Spell; x: number; y: number }) {
    const c = SPELL_COLORS[s.type];
    const left = Math.min(x + 16, innerWidth - 270), top = Math.min(y + 16, innerHeight - 150);
    return (
        <div role="tooltip" style={{ position: 'fixed', left, top, width: 250, zIndex: 70, pointerEvents: 'none', padding: '8px 10px', background: 'rgba(0,0,0,.92)', border: `1px solid ${GOLD}`, borderRadius: 4, font: `13px ${FONT}` }}>
            <div style={{ color: c.primary, textShadow: `0 0 6px ${c.glow}`, fontSize: 15, fontWeight: 700 }}>{s.name}</div>
            <div style={{ color: '#8fc8ff' }}>{s.manaCost} Maná</div>
            <div>Casteo: {s.castTime ? fmtS(s.castTime) : 'Instantáneo'} · CD: {fmtS(s.cooldown)} · Rango: {s.range}</div>
            <div style={{ marginTop: 6, color: '#d8ccb0' }}>{s.description}</div>
            {s.unlockLevel > useSpellbook.getState().level && <div style={{ marginTop: 6, color: '#ff7a6a' }}>Desbloquea al Nivel {s.unlockLevel}</div>}
        </div>
    );
}

function SpellsTab({ spells, level }: { spells: Spell[]; level: number }) {
    const [hover, setHover] = useState<{ s: Spell; x: number; y: number } | null>(null);
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 64px)', gap: 14, padding: 16 }}>
            {spells.map((s) => {
                const locked = level < s.unlockLevel, c = SPELL_COLORS[s.type];
                return (
                    <div key={s.id} draggable={!locked} aria-label={`${s.name}${locked ? `, bloqueado hasta nivel ${s.unlockLevel}` : ''}`} tabIndex={0}
                        onDragStart={(e) => { e.dataTransfer.setData(SPELL_DND, s.id); e.dataTransfer.effectAllowed = 'move'; setHover(null); }}
                        onMouseMove={(e) => setHover({ s, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}
                        style={{ position: 'relative', width: 64, height: 64, borderRadius: 4, cursor: locked ? 'not-allowed' : 'grab', overflow: 'hidden',
                            background: `radial-gradient(circle, ${c.glow}, ${c.primary} 70%)`, border: `2px solid ${locked ? '#555' : c.primary}`,
                            boxShadow: locked ? 'none' : `0 0 8px ${c.glow}`, filter: locked ? 'grayscale(1) brightness(.6)' : 'none' }}>
                        <img src={spellIcon(s.iconId, c.primary)} alt="" draggable={false} width={64} height={64} style={{ mixBlendMode: 'multiply' }} />
                        {locked && <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 26 }}>🔒</span>}
                    </div>
                );
            })}
            {!spells.length && <p style={{ gridColumn: '1/-1', opacity: .7 }}>Sin habilidades todavía.</p>}
            {hover && <Tooltip {...hover} />}
        </div>
    );
}

export function Spellbook() {
    const { open, level, classId, paths, toggle, choosePath } = useSpellbook();
    const [tab, setTab] = useState<Tab>('spells');
    if (!open) return null;
    const data = CLASS_DATA[classId] ?? { name: classId, spells: [], techniques: [], paths: [] };
    const chosen = paths[classId];
    return (
        <div role="dialog" aria-label="Libro de Hechizos" style={panel} onKeyDown={(e) => e.key === 'Escape' && toggle(false)}>
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${GOLD}` }}>
                <div role="tablist" style={{ display: 'flex', flex: 1 }}>
                    {TABS.map(([id, label]) => (
                        <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
                            style={{ flex: 1, padding: '10px 0', font: `600 15px ${FONT}`, cursor: 'pointer', border: 'none', color: tab === id ? '#ffd98a' : '#a89a7c',
                                background: tab === id ? 'rgba(214,164,69,.18)' : 'transparent', borderBottom: tab === id ? '2px solid #d6a445' : '2px solid transparent' }}>{label}</button>
                    ))}
                </div>
                <button type="button" aria-label="Cerrar" onClick={() => toggle(false)} style={{ width: 40, background: 'none', border: 'none', color: '#f0e2c0', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {tab === 'spells' && <SpellsTab spells={data.spells} level={level} />}
                {tab === 'techniques' && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {data.techniques.map((t) => {
                            const locked = level < t.unlockLevel;
                            return (
                                <li key={t.id} style={{ padding: '10px 12px', border: `1px solid ${locked ? '#444' : GOLD}`, borderRadius: 4, background: 'rgba(0,0,0,.35)', opacity: locked ? .55 : 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ color: locked ? '#999' : '#ffd98a' }}>{t.name}</b>{locked && <span style={{ color: '#ff7a6a' }}>🔒 Desbloquea al Nivel {t.unlockLevel}</span>}</div>
                                    <div style={{ fontSize: 13, color: '#d8ccb0' }}>{t.description}</div>
                                </li>
                            );
                        })}
                        {!data.techniques.length && <li style={{ opacity: .7 }}>Sin técnicas todavía.</li>}
                    </ul>
                )}
                {tab === 'paths' && (
                    <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', boxSizing: 'border-box' }}>
                        {data.paths.map((p) => {
                            const isChosen = chosen === p.id, blocked = (!!chosen && !isChosen) || level < p.unlockLevel;
                            return (
                                <button key={p.id} type="button" disabled={blocked || isChosen} onClick={() => choosePath(p.id)}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 18, textAlign: 'left', font: `14px ${FONT}`, color: '#f0e2c0', borderRadius: 6,
                                        cursor: blocked || isChosen ? 'default' : 'pointer', background: isChosen ? 'rgba(214,164,69,.22)' : 'rgba(0,0,0,.4)',
                                        border: `2px solid ${isChosen ? '#ffd98a' : blocked ? '#444' : GOLD}`, boxShadow: isChosen ? '0 0 16px rgba(255,217,138,.5)' : 'none',
                                        filter: blocked ? 'grayscale(1)' : 'none', opacity: blocked ? .5 : 1 }}>
                                    <b style={{ fontSize: 20, color: '#ffd98a' }}>{p.name}</b>
                                    <span>{p.description}</span>
                                    <span style={{ marginTop: 'auto', color: isChosen ? '#9fe39f' : '#ff7a6a' }}>
                                        {isChosen ? '✔ Camino elegido' : chosen ? '🔒 Bloqueado' : level < p.unlockLevel ? `🔒 Desbloquea al Nivel ${p.unlockLevel}` : 'Click para elegir'}
                                    </span>
                                </button>
                            );
                        })}
                        {!data.paths.length && <p style={{ opacity: .7 }}>Sin caminos todavía.</p>}
                    </div>
                )}
            </div>
        </div>
    );
}

export function mountSpellbook(host: HTMLElement): void { createRoot(host).render(<Spellbook />); }
