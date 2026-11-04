/**
 * Guild (docs/GUILDS.md): ventana con el escudo, el lema y la lista de miembros (conectados primero, rango, última conexión y
 * cantidad contra el tope), las acciones por rango (invitar, ascender, bajar, expulsar, ceder, salir, disolver) y el editor del
 * escudo. Solo vista: el server valida todo y manda `guildState` después de cada cambio; los avisos (se conectó, ascendió) llegan
 * por el canal de chat de guild. El cofre compartido vive en la ventana del Depósito (pestaña «Cofre de guild»).
 */
import type { GuildState, GuildMember } from '@fdn/proto';
import type { Net } from './net.ts';

type SendFn = Net['send'];
export interface GuildDeps {
    send: SendFn;
    esc: (s: string) => string;
    /** Nombre de mi personaje (para no ofrecer acciones sobre uno mismo). */
    me: () => string;
    /** Nombre legible de un mapa por id. */
    mapName: (id: string) => string;
    /** Mensaje corto en pantalla. */
    toast: (text: string) => void;
}
export interface GuildUI {
    open(): void; close(): void; toggle(): void;
    readonly isOpen: boolean;
    /** Estado actual (null = sin guild). */
    readonly state: GuildState | null;
    onState(st: GuildState): void;
    /** Cartel de invitación (Aceptar / Rechazar). */
    onInvited(fromName: string, guildName: string, tag: string, expiresMs: number): void;
}

// ---------- escudo: mismas tablas que el server (CREST_SHAPES, CREST_COLORS, CREST_SYMBOLS) ----------
export const CREST_COLORS = ['#2b2b33', '#8a1a28', '#1d4e89', '#2e6b3a', '#c9a227', '#f0e6cf', '#5a2d82', '#b8551c'];
export const CREST_COLOR_NAMES = ['Hierro', 'Carmesí', 'Azur', 'Bosque', 'Oro', 'Marfil', 'Púrpura', 'Cobre'];
const SHAPES = [
    'M4 3h24v13c0 7-5 11-12 14C9 27 4 23 4 16z',          // escudo clásico
    'M4 3h24v16l-12 10L4 19z',                              // apuntado
    'M16 2l13 7v12l-13 9L3 21V9z',                          // hexagonal
    'M5 3h22c0 0 2 10 0 17c-1 4-5 7-11 9c-6-2-10-5-11-9C3 13 5 3 5 3z', // redondeado
];
export const CREST_SHAPE_NAMES = ['Clásico', 'Apuntado', 'Hexagonal', 'Redondeado'];
const SYMBOLS = [
    '<path d="M16 7l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z"/>',                                   // estrella
    '<path d="M15 6h2v9h7v2h-7v9h-2v-9H8v-2h7z"/>',                                            // cruz
    '<path d="M16 6c-4 4-7 8-7 12a7 7 0 0014 0c0-4-3-8-7-12zm0 8c2 2 3 3 3 5a3 3 0 11-6 0c0-2 1-3 3-5z"/>', // llama
    '<path d="M9 22l7-16 7 16-7-4z"/>',                                                        // punta / colmillo
    '<path d="M15 5h2v4l6-3v2l-6 3v2l5 7-2 1-4-6v10h-2V15l-4 6-2-1 5-7v-2L7 8V6l6 3z"/>',      // espada
    '<path d="M16 6a10 10 0 100 20 8 8 0 010-20z"/>',                                          // luna
    '<circle cx="16" cy="15" r="7"/><path d="M16 4l2 4h-4zM16 26l2-4h-4zM5 15l4-2v4zM27 15l-4-2v4z"/>', // sol
    '<path d="M8 8l8 4 8-4v12l-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="2.5"/>', // gema
    '<path d="M6 20l5-9 5 6 5-10 5 13z"/>',                                                    // montañas
    '<path d="M16 6l3 5h6l-4 5 2 7-7-3-7 3 2-7-4-5h6z" fill="none" stroke="currentColor" stroke-width="2"/>', // estrella hueca
    '<path d="M10 24c0-6 2-10 6-16 4 6 6 10 6 16-2-3-4-4-6-4s-4 1-6 4z"/>',                    // hoja / pluma
    '<path d="M7 11l5 3 4-6 4 6 5-3-2 12H9z"/>',                                               // corona
];
export const CREST_SYMBOL_NAMES = ['Estrella', 'Cruz', 'Llama', 'Colmillo', 'Espada', 'Luna', 'Sol', 'Gema', 'Montañas', 'Estrella hueca', 'Pluma', 'Corona'];
export interface Crest { shape: number; bg: number; fg: number; symbol: number }
export const parseCrest = (s: string): Crest => {
    const p = (s || '').split(',').map((x) => Number(x) | 0);
    const c = (n: number, max: number) => Math.max(0, Math.min(max - 1, n || 0));
    return { shape: c(p[0], SHAPES.length), bg: c(p[1], CREST_COLORS.length), fg: c(p[2], CREST_COLORS.length), symbol: c(p[3], SYMBOLS.length) };
};
export const crestString = (c: Crest) => `${c.shape},${c.bg},${c.fg},${c.symbol}`;
/** SVG del escudo (fondo con forma, borde dorado y símbolo). */
export function crestSvg(c: Crest, size = 32): string {
    return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="${SHAPES[c.shape]}" fill="${CREST_COLORS[c.bg]}" stroke="#d8b45a" stroke-width="1.5" stroke-linejoin="round"/><g fill="${CREST_COLORS[c.fg]}" color="${CREST_COLORS[c.fg]}" transform="translate(0 1)">${SYMBOLS[c.symbol]}</g></svg>`;
}

const RANK_LABEL: Record<string, string> = { lider: 'Líder', oficial: 'Oficial', miembro: 'Miembro' };
const CLS_LABEL: Record<string, string> = { guerrero: 'Paladín', paladin: 'Paladín', mago: 'Mago', healer: 'Healer' };
/** "hace 3 min" / "hace 2 d" a partir de un epoch ms. */
export function ago(ms: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return 'recién'; const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60); if (h < 48) return `hace ${h} h`; const d = Math.floor(h / 24); if (d < 30) return `hace ${d} d`;
    return `hace ${Math.floor(d / 30)} mes${d >= 60 ? 'es' : ''}`;
}

const CSS = `
#gld.fw{--W:520px;--H:600px;left:50%;right:auto;top:calc(84px + env(safe-area-inset-top,0px));transform-origin:top center;transform:translateX(-50%) scale(var(--gld-scale,1));padding:52px 14px 18px}
#gld .fw-body{gap:8px;min-height:0}
#gld .ghead{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:8px 10px;background:linear-gradient(#14100c,#0a0807);border:1px solid #4d3b20;border-radius:3px;box-shadow:inset 0 0 12px #000}
#gld .ghead .crest{width:56px;height:56px;filter:drop-shadow(0 2px 2px #000)}
#gld .gname{font:700 18px/1.1 var(--f-cinzel);color:#ecd39a;text-shadow:0 1px 0 #000}
#gld .gname small{font:600 12px var(--f-inter);color:#bfae86;margin-left:6px;letter-spacing:.06em}
#gld .gsub{margin-top:3px;font:400 11.5px/1.3 var(--f-inter);color:#8d7a52}
#gld .gmotd{margin-top:4px;font:italic 12.5px/1.3 var(--f-inter);color:#d9ccaa;white-space:pre-wrap;word-break:break-word}
#gld .gcnt{text-align:right;font:600 12px/1.3 var(--f-inter);color:#bfae86;font-variant-numeric:tabular-nums;white-space:nowrap}
#gld .gcnt b{display:block;font:700 16px var(--f-cinzel);color:#ecd39a}
#gld .gcnt.full b{color:#ff8a7a}
#gld .gbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#gld input.txt{flex:1;min-width:120px;height:30px;box-sizing:border-box;padding:0 8px;font:500 13px var(--f-inter);color:#f0dca4;background:#070605;border:1px solid #6a5028;border-radius:3px;box-shadow:inset 0 0 8px #000}
#gld input.txt:focus{outline:2px solid #ffd986;outline-offset:1px}
#gld .act{height:30px;padding:0 10px;font:600 12px/1 var(--f-cinzel);color:#e6d4a6;background:linear-gradient(#3c0c14,#220509);border:1px solid #a98340;border-radius:3px;white-space:nowrap;cursor:pointer}
#gld .act:hover:not(:disabled){filter:brightness(1.3)}
#gld .act:disabled{opacity:.45;filter:grayscale(.6);cursor:default}
#gld .act.sm{height:24px;padding:0 7px;font-size:11px}
#gld .act.danger{border-color:#8a3a34}
#gld .glist{flex:1;min-height:0;overflow:auto;background:#0a0807;border:1px solid #3a2d19;border-radius:3px;box-shadow:inset 0 0 18px #000;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#gld table{width:100%;border-collapse:collapse;font:500 12.5px/1.3 var(--f-inter);color:#d9ccaa}
#gld th{position:sticky;top:0;background:#14100c;text-align:left;padding:6px 8px;font:700 10.5px var(--f-cinzel);letter-spacing:.1em;text-transform:uppercase;color:#8d7a52;border-bottom:1px solid #3a2d19}
#gld td{padding:5px 8px;border-bottom:1px solid #1d160e;vertical-align:middle;white-space:nowrap}
#gld tr.off td{color:#7d6f55}
#gld td.nm{font-weight:600;color:#f0dca4}
#gld tr.off td.nm{color:#9c8d6c}
#gld td.nm i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#58b85a;margin-right:6px;box-shadow:0 0 4px #58b85a}
#gld tr.off td.nm i{background:#4a4136;box-shadow:none}
#gld td.rk.lider{color:#ffd24a}#gld td.rk.oficial{color:#9fd8ff}
#gld td.ac{text-align:right}
#gld td.ac .act{margin-left:4px}
#gld .gfoot{display:flex;gap:6px;justify-content:space-between;align-items:center;flex-wrap:wrap}
#gld .gmsg{min-height:16px;font-size:12px;text-align:center;color:#bfae86}
#gld .help{font-size:11px;line-height:1.4;color:#8d7a52}
#gld .help b{color:#bfae86;font-weight:600}
#gld .none{display:grid;gap:10px;padding:14px;text-align:center;font:400 13px/1.5 var(--f-inter);color:#bfae86}
#gld .none h3{margin:0;font:700 16px var(--f-cinzel);color:#ecd39a}
#gld .cedit{display:grid;grid-template-columns:auto 1fr;gap:10px 14px;align-items:center;padding:10px;background:linear-gradient(#14100c,#0a0807);border:1px solid #4d3b20;border-radius:3px}
#gld .cedit .crest{width:96px;height:96px;grid-row:span 4;filter:drop-shadow(0 3px 3px #000)}
#gld .cedit label{display:grid;grid-template-columns:70px 1fr;gap:8px;align-items:center;font:600 11px var(--f-cinzel);letter-spacing:.08em;text-transform:uppercase;color:#8d7a52}
#gld .cedit .opts{display:flex;gap:4px;flex-wrap:wrap}
#gld .cedit .opts button{all:unset;cursor:pointer;width:22px;height:22px;border-radius:3px;border:2px solid transparent;box-sizing:border-box}
#gld .cedit .opts button.sw{border-color:#3a2d19}
#gld .cedit .opts button.on{border-color:#ffd986;box-shadow:0 0 0 1px #000}
#gld .cedit .opts button.sym{display:grid;place-items:center;background:#1d160e;color:#e6d4a6}
#gld .cedit .opts button.sym svg{width:18px;height:18px;fill:currentColor}
#gld.narrow{--W:372px}
#gld.narrow .ghead{grid-template-columns:auto 1fr}#gld.narrow .gcnt{grid-column:1 / -1;text-align:left}
#gld.narrow th.lv,#gld.narrow td.lv,#gld.narrow th.mp,#gld.narrow td.mp{display:none}
#gldInv.hud{right:max(12px,env(safe-area-inset-right,0px));top:220px;width:230px;background:rgba(10,12,10,.85);border:1px solid #6b5326;border-radius:4px;padding:10px 12px;font:400 13px/1.4 var(--f-inter);color:#e6d4a6}
#gldInv p{margin:0 0 8px}
#gldInv .pib{display:flex;gap:6px}
#gldInv .pib button{flex:1;height:28px;font:600 12px var(--f-cinzel);color:#e6d4a6;background:linear-gradient(#3c0c14,#220509);border:1px solid #a98340;border-radius:3px;cursor:pointer}
#gldInv .pib button.no{filter:grayscale(.5)}
#gldInv .pit{margin-top:8px;height:3px;background:#1d160e}#gldInv .pit i{display:block;height:100%;width:100%;background:#d8b45a;transition:width linear}
`;

export function createGuildUI(d: GuildDeps): GuildUI {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const el = document.createElement('div'); el.id = 'gld'; el.className = 'hud fw'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Guild');
    el.innerHTML = `<svg class="fw-crest" aria-hidden="true"><use href="#fwcrest"/></svg>
<svg class="fw-c tl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c tr" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c bl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c br" aria-hidden="true"><use href="#fwc"/></svg>
<header class="fw-head"><h2>GUILD</h2><button class="fw-x" id="gldClose" type="button" aria-label="Cerrar Guild">&times;</button></header>
<div class="fw-body" id="gldBody"></div>
<svg class="fw-gem" aria-hidden="true"><use href="#fwgem"/></svg>`;
    document.body.appendChild(el);
    const inv = document.createElement('div'); inv.id = 'gldInv'; inv.className = 'hud'; inv.hidden = true; inv.setAttribute('role', 'alertdialog'); inv.setAttribute('aria-label', 'Invitación a guild');
    document.body.appendChild(inv);
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    const body = q<HTMLElement>('#gldBody');

    let st: GuildState | null = null;
    let view: 'list' | 'crest' = 'list';
    let draft: Crest = parseCrest('');
    let msg = '', msgT: ReturnType<typeof setTimeout> | undefined;
    let tick = 0;

    const send = (action: string, name = '', arg = '') => d.send({ $case: 'guildRequest', value: { action, name, arg } });
    const say = (text: string) => { msg = text; clearTimeout(msgT); msgT = setTimeout(() => { msg = ''; renderMsg(); }, 4000); renderMsg(); };
    const renderMsg = () => { const m = el.querySelector('#gldMsg'); if (m) m.textContent = msg; };
    const canManage = () => st?.myRank === 'lider' || st?.myRank === 'oficial';
    const isLeader = () => st?.myRank === 'lider';

    const row = (m: GuildMember) => {
        const me = m.name === d.me(), rank = m.rank;
        const acts: string[] = [];
        if (!me && st) {
            if (isLeader()) {
                if (rank === 'miembro') acts.push(`<button type="button" class="act sm" data-a="promote" data-n="${d.esc(m.name)}" title="Ascender a oficial">▲</button>`);
                if (rank === 'oficial') acts.push(`<button type="button" class="act sm" data-a="demote" data-n="${d.esc(m.name)}" title="Bajar a miembro">▼</button>`);
                acts.push(`<button type="button" class="act sm" data-a="leader" data-n="${d.esc(m.name)}" title="Ceder el liderazgo">♛</button>`);
                acts.push(`<button type="button" class="act sm danger" data-a="kick" data-n="${d.esc(m.name)}" title="Expulsar">✕</button>`);
            } else if (st.myRank === 'oficial' && rank === 'miembro') acts.push(`<button type="button" class="act sm danger" data-a="kick" data-n="${d.esc(m.name)}" title="Expulsar">✕</button>`);
        }
        const when = m.online ? (m.map ? d.mapName(m.map) : 'Conectado') : (Number(m.lastSeenMs) ? ago(Number(m.lastSeenMs)) : '—');
        return `<tr class="${m.online ? 'on' : 'off'}"><td class="nm"><i></i>${d.esc(m.name)}${me ? ' <small>(vos)</small>' : ''}</td><td class="rk ${rank}">${RANK_LABEL[rank] ?? rank}</td><td class="lv">${m.online && m.level ? `${m.level}${m.cls ? ` · ${CLS_LABEL[m.cls] ?? m.cls}` : ''}` : ''}</td><td class="mp">${d.esc(when)}</td><td class="ac">${acts.join('')}</td></tr>`;
    };

    function renderList() {
        if (!st) return;
        const c = parseCrest(st.crest), online = st.members.filter((m) => m.online).length, full = st.members.length >= st.maxMembers;
        body.innerHTML = `
<div class="ghead">${crestSvg(c, 56)}<div><div class="gname">${d.esc(st.name)}<small>[${d.esc(st.tag)}]</small></div><div class="gsub">${d.esc(st.faction === 'vhar' ? 'Vhar' : 'Solmar')} · sos ${(RANK_LABEL[st.myRank] ?? st.myRank).toLowerCase()} · fundada ${Number(st.createdMs) ? ago(Number(st.createdMs)) : ''}</div>${st.motd ? `<div class="gmotd">«${d.esc(st.motd)}»</div>` : ''}</div><div class="gcnt${full ? ' full' : ''}"><b>${st.members.length} / ${st.maxMembers}</b>${online} conectado${online === 1 ? '' : 's'}</div></div>
${canManage() ? `<div class="gbar"><input class="txt" id="gldInvName" type="text" maxlength="40" autocomplete="off" placeholder="Nombre del jugador (tiene que estar conectado)" aria-label="Invitar"><button type="button" class="act" id="gldInvite">Invitar</button><button type="button" class="act" id="gldMotd">Lema</button>${isLeader() ? `<button type="button" class="act" id="gldCrest">Escudo</button>` : ''}</div>` : ''}
<div class="glist"><table><thead><tr><th>Miembro</th><th>Rango</th><th class="lv">Nivel</th><th class="mp">Dónde / última vez</th><th></th></tr></thead><tbody>${st.members.map(row).join('')}</tbody></table></div>
<div class="gmsg" id="gldMsg" role="status" aria-live="polite">${d.esc(msg)}</div>
<div class="gfoot"><span class="help">Chat de guild: <b>/gu</b> texto (o la pestaña Guild). El <b>cofre compartido</b> se abre en el Depositario.</span><span>${isLeader() && st.members.length > 1 ? '' : `<button type="button" class="act danger" id="gldLeave">${isLeader() ? 'Disolver' : 'Salir'}</button>`}${isLeader() && st.members.length > 1 ? `<button type="button" class="act danger" id="gldLeave" disabled title="Cedé el liderazgo (♛) antes de salir">Salir</button>` : ''}</span></div>`;
        const inp = el.querySelector<HTMLInputElement>('#gldInvName');
        const invite = () => { const n = (inp?.value ?? '').trim(); if (!n) { say('Escribí el nombre del jugador.'); inp?.focus(); return; } send('invite', n); if (inp) inp.value = ''; };
        el.querySelector<HTMLButtonElement>('#gldInvite')?.addEventListener('click', invite);
        inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); invite(); } });
        el.querySelector<HTMLButtonElement>('#gldMotd')?.addEventListener('click', () => { const v = prompt('Lema de la guild (vacío lo borra):', st?.motd ?? ''); if (v !== null) send('motd', '', v.slice(0, 120)); });
        el.querySelector<HTMLButtonElement>('#gldCrest')?.addEventListener('click', () => { draft = parseCrest(st!.crest); view = 'crest'; render(); });
        el.querySelector<HTMLButtonElement>('#gldLeave')?.addEventListener('click', () => {
            if (!st) return;
            if (isLeader()) { if (confirm(`¿Disolver «${st.name}»? El cofre tiene que estar vacío.`)) send('disband'); }
            else if (confirm(`¿Salir de «${st.name}»?`)) send('leave');
        });
    }

    function renderCrest() {
        const sw = (key: 'bg' | 'fg') => CREST_COLORS.map((col, i) => `<button type="button" class="sw${draft[key] === i ? ' on' : ''}" data-k="${key}" data-i="${i}" title="${CREST_COLOR_NAMES[i]}" style="background:${col}"></button>`).join('');
        body.innerHTML = `
<div class="cedit">${crestSvg(draft, 96)}
<label>Forma<span class="opts">${SHAPES.map((_, i) => `<button type="button" class="sym${draft.shape === i ? ' on' : ''}" data-k="shape" data-i="${i}" title="${CREST_SHAPE_NAMES[i]}">${crestSvg({ ...draft, shape: i, symbol: draft.symbol }, 18)}</button>`).join('')}</span></label>
<label>Fondo<span class="opts">${sw('bg')}</span></label>
<label>Figura<span class="opts">${sw('fg')}</span></label>
<label>Símbolo<span class="opts">${SYMBOLS.map((s, i) => `<button type="button" class="sym${draft.symbol === i ? ' on' : ''}" data-k="symbol" data-i="${i}" title="${CREST_SYMBOL_NAMES[i]}"><svg viewBox="0 0 32 32">${s}</svg></button>`).join('')}</span></label>
</div>
<div class="gmsg" id="gldMsg"></div>
<div class="gfoot"><span class="help">El escudo se ve en la ventana de guild y en el cartel de invitación; la etiqueta <b>[${d.esc(st?.tag ?? '')}]</b> va sobre la cabeza.</span><span><button type="button" class="act" id="gldBack">Volver</button> <button type="button" class="act" id="gldSave">Guardar escudo</button></span></div>`;
        body.querySelectorAll<HTMLButtonElement>('.opts button').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.k as keyof Crest; draft = { ...draft, [k]: Number(b.dataset.i) }; renderCrest(); }));
        q<HTMLButtonElement>('#gldBack').onclick = () => { view = 'list'; render(); };
        q<HTMLButtonElement>('#gldSave').onclick = () => { send('crest', '', crestString(draft)); view = 'list'; render(); };
    }

    function renderNone() {
        body.innerHTML = `<div class="none"><h3>No tenés guild</h3><p>Fundá una con <b>/guild crear &lt;nombre&gt; &lt;ETIQUETA&gt;</b> (nivel 10 y 5.000 de oro) o esperá que te inviten: la invitación aparece como cartel a la derecha y también se acepta con <b>/guild aceptar</b>.</p><p>La guild tiene escudo, lema, chat propio (<b>/gu</b>), lista de miembros y un cofre compartido en el Depositario.</p></div><div class="gmsg" id="gldMsg"></div>`;
    }

    function render() {
        if (el.hidden) return;
        if (!st || !st.id) renderNone(); else if (view === 'crest') renderCrest(); else renderList();
        layout();
    }
    // acciones por fila (delegadas)
    body.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]'); if (!b || !st) return;
        const a = b.dataset.a!, n = b.dataset.n!;
        if (a === 'kick' && !confirm(`¿Expulsar a ${n} de la guild?`)) return;
        if (a === 'leader' && !confirm(`¿Ceder el liderazgo a ${n}? Vos quedás como oficial.`)) return;
        send(a, n);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ui.close(); return; } e.stopPropagation(); });
    q<HTMLButtonElement>('#gldClose').onclick = () => ui.close();

    function layout() {
        if (el.hidden) return;
        const narrow = innerWidth < 600; el.classList.toggle('narrow', narrow);
        const W = narrow ? 372 : 520, H = 600, top = el.getBoundingClientRect().top, avail = innerHeight - Math.max(40, top) - 16;
        const s = Math.max(0.5, Math.min(1, (innerWidth - 20) / (W + 20), avail / H));
        el.style.setProperty('--gld-scale', s.toFixed(3));
    }
    addEventListener('resize', layout);

    // cartel de invitación (igual al de la party): se cierra solo cuando vence
    let invTimer = 0;
    const hideInv = () => { clearTimeout(invTimer); inv.hidden = true; };

    const ui: GuildUI = {
        open() { el.hidden = false; view = 'list'; render(); send('info'); clearInterval(tick); tick = window.setInterval(() => { if (!el.hidden && view === 'list') render(); }, 60_000); },
        close() { if (el.hidden) return; el.hidden = true; clearInterval(tick); if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); },
        toggle() { if (el.hidden) ui.open(); else ui.close(); },
        get isOpen() { return !el.hidden; },
        get state() { return st && st.id ? st : null; },
        onState(s) { st = s; if (!s.id) view = 'list'; render(); },
        onInvited(fromName, guildName, tag, expiresMs) {
            const ms = Math.max(1000, Math.min(30_000, expiresMs ? expiresMs - Date.now() : 30_000));
            inv.innerHTML = `<p><b>${d.esc(fromName)}</b> te invitó a la guild <b>${d.esc(guildName)}</b> [${d.esc(tag)}]</p><div class="pib"><button type="button" class="ok">Aceptar</button><button type="button" class="no">Rechazar</button></div><div class="pit"><i></i></div>`;
            const bar = inv.querySelector('.pit i') as HTMLElement; bar.style.transitionDuration = ms + 'ms';
            (inv.querySelector('.ok') as HTMLElement).onclick = () => { send('accept'); hideInv(); };
            (inv.querySelector('.no') as HTMLElement).onclick = () => { send('decline'); hideInv(); };
            inv.hidden = false; void bar.offsetWidth; bar.style.width = '0%';
            clearTimeout(invTimer); invTimer = window.setTimeout(hideInv, ms);
            d.toast(`${fromName} te invitó a la guild ${guildName}`);
        },
    };
    return ui;
}
