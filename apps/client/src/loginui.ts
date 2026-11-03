/**
 * Pantallas de entrada: login, selección de personaje, clase, facción y creación.
 * El fondo es assets/background-login.webp; el logo es assets/logo-eris.webp; el resto del arte (brasas, siluetas, escudos) se dibuja por código.
 * Este módulo es solo vista y flujo; la conexión, el guardado y enterWorld siguen en main.ts.
 */
import './login.css';
import './ui/login-craftpix.css';
import { mountDoll } from './paperdoll.ts';

export interface ClassInfo { id: string; name: string; desc: string; hp: number; hpL: number; mp: number; mpL: number; melee: [number, number]; weapon: string; armor?: string; spells: string[] }
export interface FactionInfo { id: string; name: string; col: string; desc: string }
/** Un personaje de la cuenta, como lo manda el server. */
export interface CharInfo { name: string; cls: string; faction: string; lvl: number; zone: string }
export interface FlowCtx {
    classes: ClassInfo[];
    factions: FactionInfo[];
    spellName: (id: string) => string;
    /** ciudad inicial de una facción */
    cityName: (factionId: string) => string;
    get: () => { cls: string; faction: string };
    set: (p: { cls?: string; faction?: string }) => void;
}
export interface StartInfo {
    account: string; chars: CharInfo[]; max: number;
    /** Personaje que se marca al abrir la selección (el último que se jugó). */
    preselect?: string;
    /** `isNew`: el personaje se acaba de crear (arranca en su ciudad). */
    onPlay: (name: string, isNew: boolean) => void;
    onCreate: (p: { name: string; cls: string; faction: string }) => void;
    onDelete: (name: string) => void;
    onBack: () => void;
}
const NAME_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
export type Screen = 'login' | 'select' | 'class' | 'faction' | 'create';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CLS_COL: Record<string, string> = { mago: '#b872ff', guerrero: '#ff5a3c', healer: '#f2d36b' };
const CLS_TAG: Record<string, string> = { mago: 'Domina el poder arcano', guerrero: 'Lucha con honor', healer: 'Sostiene al grupo' };
const CLS_LORE: Record<string, string> = {
    mago: 'Los magos canalizan la energía arcana a través de sus hechizos. Pegan de lejos, congelan y queman, pero necesitan maná y poca gente que los toque.',
    healer: 'Los healers canalizan la luz sagrada: curan y bendicen a los suyos, castigan de lejos y cortan los casteos peligrosos. Pueden cazar solos, pero brillan en grupo.',
    guerrero: 'Los guerreros son maestros del combate cuerpo a cuerpo. Su vida y su resistencia les permiten sostener la línea de frente y frenar a los enemigos.',
};
const clsCol = (id: string) => CLS_COL[id] ?? '#d6a445';

// ---------- arte ----------
/** Lienzo del muñeco real (sprites del juego) de una clase; mountDocs() lo pinta después de insertar el HTML. */
const dollCv = (id: string, h = 0.82) => `<canvas class="doll" data-doll="${id}" data-h="${h}" aria-hidden="true"></canvas>`;
function mountDolls(host: HTMLElement) {
    host.querySelectorAll<HTMLCanvasElement>('canvas[data-doll]').forEach((cv) => { void mountDoll(cv, cv.dataset.doll!, clsCol(cv.dataset.doll!), Number(cv.dataset.h) || undefined); });
}

function clsIcon(id: string, col: string): string {
    if (id === 'healer') return badge(`<path d="M-5 -17 H5 V-5 H17 V5 H5 V17 H-5 V5 H-17 V-5 H-5Z" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/><circle r="4.5" fill="#fff"/>`, col);
    const glyph = id === 'mago'
        ? `<path d="M0 -17 L4.5 -4.5 L17 0 L4.5 4.5 L0 17 L-4.5 4.5 L-17 0 L-4.5 -4.5Z" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/><circle r="4.5" fill="#fff"/><path d="M12 -14 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" fill="#fff" opacity=".85" transform="scale(.5) translate(24 -26)"/>`
        : `<g stroke="${col}" stroke-linecap="round" stroke-linejoin="round"><path d="M-15 -17 L13 11 M15 -17 L-13 11" stroke-width="3.6"/><path d="M-19 7 L-9 17 M19 7 L9 17" stroke-width="3"/><path d="M-15 -17 L13 11 M15 -17 L-13 11" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></g><path d="M-8 -5 H8 V4 C8 10 3 13 0 15 C-3 13 -8 10 -8 4Z" fill="#150a14" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`;
    return badge(glyph, col);
}
function badge(glyph: string, col: string): string {
    return `<svg viewBox="-34 -34 68 68" role="presentation"><circle r="32" fill="#0c0610" stroke="${col}" stroke-width="2.4"/><circle r="27" fill="none" stroke="${col}" stroke-opacity=".4" stroke-width="1"/>${glyph}</svg>`;
}
function shield(id: string, col: string): string {
    const glyph = id === 'solmar'
        ? `<circle cy="-6" r="7" fill="${col}"/>${[...Array(8)].map((_, i) => `<path d="M0 -6 L${(Math.cos(i * Math.PI / 4) * 15).toFixed(1)} ${(-6 + Math.sin(i * Math.PI / 4) * 15).toFixed(1)}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`).join('')}<path d="M-16 12 q4 -5 8 0 t8 0 t8 0 t8 0" fill="none" stroke="${col}" stroke-width="2"/>`
        : `<path d="M-12 14 L-8 -4 L-2 4 L0 -16 L4 2 L8 -8 L12 14Z" fill="${col}" fill-opacity=".85"/><path d="M-14 16 H14" stroke="${col}" stroke-width="3" stroke-linecap="round"/>`;
    return `<svg viewBox="-34 -38 68 76" role="presentation"><path d="M-28 -30 H28 V6 C28 22 14 32 0 38 C-14 32 -28 22 -28 6Z" fill="#0c0610" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/><path d="M-23 -25 H23 V5 C23 18 12 27 0 32 C-12 27 -23 18 -23 5Z" fill="none" stroke="${col}" stroke-opacity=".4"/>${glyph}</svg>`;
}
function factionBanner(id: string, col: string): string {
    // paisaje simbólico de la facción: sol sobre el mar (Solmar) / forja y cenizas entre montañas (Vhar)
    if (id === 'solmar') return `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice" role="presentation"><defs><linearGradient id="fbS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10234a"/><stop offset=".6" stop-color="#2a4f8a"/><stop offset="1" stop-color="#0a1428"/></linearGradient><radialGradient id="fbSs"><stop offset="0" stop-color="#fff2b0"/><stop offset=".4" stop-color="#ffc24a"/><stop offset="1" stop-color="#ffc24a" stop-opacity="0"/></radialGradient></defs><rect width="300" height="190" fill="url(#fbS)"/><circle cx="150" cy="104" r="80" fill="url(#fbSs)"/><circle cx="150" cy="104" r="26" fill="#ffe08a"/><path d="M0 112 H300 V190 H0Z" fill="#0b1c3c"/>${[0, 1, 2, 3, 4].map((i) => `<path d="M${40 + i * 10} ${118 + i * 14} H${260 - i * 10}" stroke="${col}" stroke-opacity="${0.55 - i * 0.08}" stroke-width="2" stroke-dasharray="14 9"/>`).join('')}<path d="M110 112 L118 60 L126 112Z M174 112 L182 76 L190 112Z" fill="#071226"/></svg>`;
    return `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice" role="presentation"><defs><linearGradient id="fbV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0808"/><stop offset=".7" stop-color="#6a1c10"/><stop offset="1" stop-color="#1a0604"/></linearGradient><radialGradient id="fbVf"><stop offset="0" stop-color="#ffb04a"/><stop offset=".5" stop-color="#ff4a1c" stop-opacity=".6"/><stop offset="1" stop-color="#ff4a1c" stop-opacity="0"/></radialGradient></defs><rect width="300" height="190" fill="url(#fbV)"/><circle cx="150" cy="130" r="90" fill="url(#fbVf)"/><path d="M0 190 V120 L40 80 L70 110 L110 60 L150 112 L190 70 L230 108 L270 76 L300 110 V190Z" fill="#0a0305"/><path d="M130 190 V150 L140 140 H160 L170 150 V190Z" fill="#150608"/><rect x="138" y="132" width="24" height="9" rx="2" fill="#150608"/>${[...Array(14)].map((_, i) => `<circle cx="${60 + i * 14}" cy="${70 + (i * 37) % 80}" r="1.6" fill="#ffb04a" opacity=".8"/>`).join('')}</svg>`;
}

// ---------- fondo animado (brasas) ----------
let fxRunning = false;
function startFx() {
    if (fxRunning || reduce) { if (reduce) drawStatic(); return; }
    const root = $('login'), cv = $('lbgFx') as HTMLCanvasElement, c = cv.getContext('2d');
    if (!c) return;
    fxRunning = true;
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    type Em = { x: number; y: number; r: number; vy: number; vx: number; ph: number; hue: number };
    let W = 0, H = 0; const parts: Em[] = [];
    const spawn = (init: boolean): Em => ({ x: Math.random() * W, y: init ? Math.random() * H : H + 10, r: 0.6 + Math.random() * 2.1, vy: 14 + Math.random() * 38, vx: -6 + Math.random() * 14, ph: Math.random() * 6.28, hue: Math.random() < 0.28 ? 280 : 14 + Math.random() * 20 });
    const size = () => { W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); while (parts.length < 70) parts.push(spawn(true)); };
    size(); addEventListener('resize', size);
    let last = performance.now();
    const loop = (t: number) => {
        if (root.hidden) { fxRunning = false; removeEventListener('resize', size); return; }
        const dt = Math.min(0.05, (t - last) / 1000); last = t;
        c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i]; p.y -= p.vy * dt; p.x += (p.vx + Math.sin(t / 900 + p.ph) * 10) * dt;
            if (p.y < -10) parts[i] = spawn(false);
            const a = Math.min(1, (H - p.y) / (H * 0.25)) * Math.max(0, p.y / H) * (0.5 + 0.5 * Math.sin(t / 380 + p.ph));
            const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
            g.addColorStop(0, `hsla(${p.hue},100%,68%,${(a * 0.95).toFixed(3)})`); g.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
            c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r * 4, 0, 6.2832); c.fill();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
function drawStatic() {
    const cv = $('lbgFx') as HTMLCanvasElement, c = cv.getContext('2d'); if (!c) return;
    cv.width = cv.clientWidth; cv.height = cv.clientHeight; c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 50; i++) { const x = Math.random() * cv.width, y = Math.random() * cv.height; c.fillStyle = `hsla(${Math.random() < 0.3 ? 280 : 20},100%,65%,.5)`; c.beginPath(); c.arc(x, y, 1 + Math.random() * 1.6, 0, 6.2832); c.fill(); }
}

// ---------- flujo ----------
export function initLoginUI(ctx: FlowCtx) {
    const root = $('login');
    $('lbgScene').innerHTML = '<img src="assets/background-login.webp" alt="" decoding="async">';

    const fit = () => { const s = Math.min(innerWidth / 1280, innerHeight / 720); root.style.setProperty('--s', String(s)); };
    fit(); addEventListener('resize', fit);
    new MutationObserver(() => { if (!root.hidden) { fit(); startFx(); } }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
    if (!root.hidden) startFx();

    const screens: Record<Screen, string> = { login: 'scrLogin', select: 'scrSelect', class: 'scrClass', faction: 'scrFaction', create: 'scrCreate' };
    let info: StartInfo | null = null;
    let cur: Screen = 'login';
    const clsOf = (id: string) => ctx.classes.find((c) => c.id === id) ?? ctx.classes[0];
    const facOf = (id: string) => ctx.factions.find((f) => f.id === id) ?? ctx.factions[0];

    function show(s: Screen) {
        cur = s;
        root.dataset.screen = s;
        const { cls, faction } = ctx.get();
        root.dataset.cls = s === 'login' ? '' : cls;
        root.style.setProperty('--ac', s === 'login' ? '#c25bff' : clsCol(cls));
        root.style.setProperty('--fc', facOf(faction).col);
        for (const [k, id] of Object.entries(screens)) $(id).hidden = k !== s;
        if (s === 'select') renderSelect(); else if (s === 'class') renderClass(); else if (s === 'faction') renderFaction(); else if (s === 'create') renderCreate();
        const focusId = { login: '', select: 'selPlay', class: 'clsOk', faction: 'facOk', create: 'crOk' }[s];
        if (focusId) ($(focusId) as HTMLElement).focus({ preventScroll: true });
        if (s !== 'select') delBox.hidden = true;
    }

    // --- selección de personaje (hasta `info.max` por cuenta: elegir, crear uno nuevo o borrar) ---
    let chars: CharInfo[] = [], selIdx = 0, newName = '', creating = false;
    const setBusy = (on: boolean) => {
        ($('crOk') as HTMLButtonElement).disabled = on;
        ($('selPlay') as HTMLButtonElement).disabled = on || !chars.length;
        ($('selDel') as HTMLButtonElement).disabled = on || !chars.length;
    };
    function renderSelect() {
        if (!info) return;
        selIdx = Math.min(selIdx, Math.max(0, chars.length - 1));
        const top = (fn: (x: ClassInfo) => number) => Math.max(...ctx.classes.map((x) => fn(x)));
        const bar = (label: string, v: number, m: number) => `<li><span class="al">${label}</span><span class="av">${v}</span><span class="bar"><i style="width:${Math.round((v / m) * 100)}%"></i></span></li>`;
        const slotHtml = (i: number): string => {
            const sv = chars[i];
            if (!sv) return `<li><button type="button" class="slot empty" data-new="1" aria-label="Crear personaje nuevo"><span class="sbadge dim"><svg viewBox="-34 -34 68 68" role="presentation"><circle r="32" fill="none" stroke="#a78ad8" stroke-width="2" stroke-dasharray="5 4"/><path d="M0 -9 V9 M-9 0 H9" stroke="#d9c4ff" stroke-width="2.4" stroke-linecap="round"/></svg></span><span class="stxt"><b>Crear personaje</b><small>Slot libre</small></span></button></li>`;
            const c = clsOf(sv.cls), f = facOf(sv.faction), on = i === selIdx;
            return `<li><button type="button" class="slot${on ? ' on' : ''}" data-i="${i}" aria-pressed="${on}"><span class="sbadge">${clsIcon(c.id, clsCol(c.id))}</span><span class="stxt"><b>${esc(sv.name)}</b><small>${c.name} · ${f.name}</small></span><span class="lvl">Nv. ${sv.lvl}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></li>`;
        };
        $('slots').innerHTML = Array.from({ length: info.max }, (_, i) => slotHtml(i)).join('');
        const sv = chars[selIdx];
        if (!sv) { $('selArt').innerHTML = ''; $('selDetail').innerHTML = ''; setBusy(false); return; }
        const c = clsOf(sv.cls), f = facOf(sv.faction), col = clsCol(c.id);
        root.dataset.cls = c.id; root.style.setProperty('--ac', col); root.style.setProperty('--fc', f.col);
        const hpMax = c.hp + (sv.lvl - 1) * c.hpL, mpMax = c.mp + (sv.lvl - 1) * c.mpL;
        $('selArt').innerHTML = dollCv(c.id, 0.66); mountDolls($('selArt'));
        $('selDetail').innerHTML = `<h3>${esc(sv.name)}</h3><p class="dsub"><b style="color:${col}">${c.name}</b> · <b style="color:${f.col}">${f.name}</b></p><ul class="attrs">${bar('Vida', hpMax, top((x) => x.hp + (sv.lvl - 1) * x.hpL))}${bar('Maná', mpMax, top((x) => x.mp + (sv.lvl - 1) * x.mpL))}</ul><dl><dt>Nivel</dt><dd>${sv.lvl}</dd><dt>Zona</dt><dd>${esc(sv.zone || ciudadInicial(f.id))}</dd></dl>`;
        setBusy(false);
    }
    const ciudadInicial = (fid: string) => ctx.cityName(fid);
    $('slots').addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.slot'); if (!b || !info) return;
        if (b.dataset.new) { newName = ''; ($('selErr') as HTMLElement).textContent = ''; show('class'); return; }
        selIdx = Number(b.dataset.i); ($('selErr') as HTMLElement).textContent = ''; renderSelect();
    });
    $('slots').addEventListener('dblclick', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.slot[data-i]'); if (b && chars[selIdx]) play(); });
    function play() { const sv = chars[selIdx]; if (!info || !sv) return; setBusy(true); info.onPlay(sv.name, false); }

    // --- borrar personaje: hay que escribir el nombre ---
    const delBox = $('delBox'), delIn = $('delIn') as HTMLInputElement, delOk = $('delOk') as HTMLButtonElement;
    const sameName = (a: string, b: string) => a.trim().normalize('NFC').toLowerCase() === b.trim().normalize('NFC').toLowerCase();
    function openDelete() {
        const sv = chars[selIdx]; if (!sv) return;
        $('delTxt').innerHTML = `Vas a borrar a <b>${esc(sv.name)}</b> (${clsOf(sv.cls).name}, nivel ${sv.lvl}) con todo lo que lleva encima. No se puede deshacer. El depósito de la cuenta no se toca.`;
        delIn.value = ''; delOk.disabled = true; $('delErr').textContent = ''; delBox.hidden = false; delIn.focus();
    }
    delIn.addEventListener('input', () => { delOk.disabled = !chars[selIdx] || !sameName(delIn.value, chars[selIdx].name); });
    $('delNo').addEventListener('click', () => { delBox.hidden = true; ($('selDel') as HTMLElement).focus(); });
    delOk.addEventListener('click', () => { const sv = chars[selIdx]; if (!info || !sv || !sameName(delIn.value, sv.name)) return; delBox.hidden = true; setBusy(true); info.onDelete(sv.name); });
    delIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !delOk.disabled) delOk.click(); });
    $('selDel').addEventListener('click', openDelete);

    // --- tarjetas de clase / facción ---
    function bullets(c: ClassInfo): string[] {
        const sp = (...ids: string[]) => ids.map((i) => ctx.spellName(i)).join(', ');
        if (c.id === 'mago') return [`Hechizos a distancia: ${sp('proyectil', 'bola', 'lluvia')}`, `Congela para controlar (${sp('paralisis')})`, `Mucho maná: ${c.mp} base, +${c.mpL} por nivel`, `Frágil: ${c.hp} de vida base`];
        if (c.id === 'healer') return [`Cura a los suyos: ${sp('curacion', 'renovar', 'orbe')}`, `Bendice y protege (${sp('bendicion')})`, `Castiga de lejos y corta casteos (${sp('castigo', 'reprender')})`, `Maná: ${c.mp} base, +${c.mpL} por nivel`];
        if (c.id === 'guerrero') return [`Cuerpo a cuerpo: ${c.melee[0]}–${c.melee[1]} de daño`, `Resistente: ${c.hp} de vida base, +${c.hpL} por nivel`, `Aturde y barre (${sp('aturdir', 'giro')})`, `Poco maná: ${c.mp} base`];
        return [c.desc];
    }
    function cardsHtml(kind: 'cls' | 'fac'): string {
        const sel = kind === 'cls' ? ctx.get().cls : ctx.get().faction;
        if (kind === 'cls') return ctx.classes.map((c) => { const col = clsCol(c.id), on = c.id === sel; return `<button type="button" role="radio" aria-checked="${on}" class="card${on ? ' on' : ''}" data-id="${c.id}" style="--c:${col}"><span class="tick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="cname">${c.name.toUpperCase()}</span><span class="cbadge">${clsIcon(c.id, col)}</span><span class="cart"><i class="halo"></i><i class="floor"></i><i class="spk s1"></i><i class="spk s2"></i><i class="spk s3"></i>${dollCv(c.id)}</span><span class="ctag">${CLS_TAG[c.id] ?? c.desc}</span><ul>${bullets(c).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></button>`; }).join('');
        return ctx.factions.map((f) => { const on = f.id === sel; return `<button type="button" role="radio" aria-checked="${on}" class="card fcard${on ? ' on' : ''}" data-id="${f.id}" style="--c:${f.col}"><span class="tick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="cbadge">${shield(f.id, f.col)}</span><span class="cart fart">${factionBanner(f.id, f.col)}</span><span class="cname">${f.name.toUpperCase()}</span><span class="ctag">${esc(f.desc)}</span><ul><li>Ciudad inicial: ${esc(ctx.cityName(f.id))}</li><li>${f.id === 'solmar' ? 'Tierras costeras del sol y el mar' : 'Tierras secas del hierro y la ceniza'}</li></ul></button>`; }).join('');
    }
    function renderClass() { $('clsCards').innerHTML = cardsHtml('cls'); mountDolls($('clsCards')); }
    function renderFaction() { $('facCards').innerHTML = cardsHtml('fac'); }
    function pick(kind: 'cls' | 'fac', host: HTMLElement, e: Event) {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.card'); if (!b) return;
        ctx.set(kind === 'cls' ? { cls: b.dataset.id } : { faction: b.dataset.id });
        host.querySelectorAll<HTMLElement>('.card').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
        root.dataset.cls = ctx.get().cls; root.style.setProperty('--ac', kind === 'cls' ? clsCol(b.dataset.id!) : clsCol(ctx.get().cls)); root.style.setProperty('--fc', facOf(ctx.get().faction).col);
    }
    $('clsCards').addEventListener('click', (e) => pick('cls', $('clsCards'), e));
    $('facCards').addEventListener('click', (e) => pick('fac', $('facCards'), e));
    for (const id of ['clsCards', 'facCards']) $(id).addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key; if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
        const cards = [...$(id).querySelectorAll<HTMLElement>('.card')], i = cards.findIndex((x) => x.classList.contains('on'));
        const n = cards[(i + (k === 'ArrowRight' ? 1 : cards.length - 1)) % cards.length]; n.click(); n.focus(); e.preventDefault();
    });

    // --- crear personaje (atributos base de la clase, solo lectura: el juego no tiene puntos asignables) ---
    function renderCreate() {
        if (!info) return;
        const { cls, faction } = ctx.get(), c = clsOf(cls), f = facOf(faction), col = clsCol(c.id);
        const mx = (fn: (x: ClassInfo) => number) => Math.max(...ctx.classes.map(fn));
        const row = (label: string, val: string, v: number, m: number) => `<li><span class="al">${label}</span><span class="av">${val}</span><span class="bar"><i style="width:${Math.round((v / m) * 100)}%"></i></span></li>`;
        const mid = (x: ClassInfo) => (x.melee[0] + x.melee[1]) / 2;
        $('crArt').innerHTML = dollCv(c.id, 0.66); mountDolls($('crArt'));
        $('crBody').innerHTML = `
  <div class="crhead"><span class="cbadge">${clsIcon(c.id, col)}</span><div><h3 style="color:${col}">${c.name.toUpperCase()}</h3><p>${esc(CLS_TAG[c.id] ?? '')}. ${esc(c.desc)}</p></div></div>
  <div class="crgrid">
    <section class="pnl"><h4>ATRIBUTOS BASE</h4><ul class="attrs">
      ${row('Vida', String(c.hp), c.hp, mx((x) => x.hp))}${row('Maná', String(c.mp), c.mp, mx((x) => x.mp))}${row('Cuerpo a cuerpo', `${c.melee[0]}–${c.melee[1]}`, mid(c), mx(mid))}${row('Hechizos', String(c.spells.length), c.spells.length, mx((x) => x.spells.length))}
    </ul></section>
    <section class="pnl"><h4>DESCRIPCIÓN</h4><p class="lore">${esc(CLS_LORE[c.id] ?? c.desc)}</p>
      <h4 class="h4b">BONUS DE CLASE</h4><ul class="bon"><li style="--b:${col}">+${c.hpL} de vida por nivel</li><li style="--b:#5aa0ff">+${c.mpL} de maná por nivel</li><li style="--b:#d6a445">Equipo inicial: ${esc(c.weapon)}${c.armor ? ' y ' + esc(c.armor) : ''}</li></ul></section>
  </div>
  <div class="pnl crstrip"><dl><div><dt>Nombre</dt><dd><input id="crName" class="crname" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Nombre del personaje" value="${esc(newName)}" aria-describedby="crErr"></dd></div><div><dt>Clase</dt><dd style="color:${col}">${c.name}</dd></div><div><dt>Facción</dt><dd style="color:${f.col}">${f.name}</dd></div><div><dt>Ciudad inicial</dt><dd>${esc(ctx.cityName(f.id))}</dd></div></dl></div>
  <p class="err crerr" id="crErr" role="alert"></p>`;
        const inp = $('crName') as HTMLInputElement;
        inp.addEventListener('input', () => { newName = inp.value; $('crErr').textContent = ''; });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('crOk').click(); } });
        setBusy(false);
    }

    // --- botones ---
    $('selPlay').addEventListener('click', play);
    $('selBack').addEventListener('click', () => info?.onBack());
    $('clsBack').addEventListener('click', () => (chars.length ? show('select') : info?.onBack()));
    $('clsOk').addEventListener('click', () => show('faction'));
    $('facBack').addEventListener('click', () => show('class'));
    $('facOk').addEventListener('click', () => show('create'));
    $('crBack').addEventListener('click', () => show('faction'));
    $('crOk').addEventListener('click', () => {
        if (!info) return;
        const name = newName.trim().replace(/\s+/g, ' '), { cls, faction } = ctx.get();
        if (!NAME_RE.test(name)) { $('crErr').textContent = 'El nombre tiene que tener entre 2 y 16 letras, números, espacios, guiones o _.'; ($('crName') as HTMLElement).focus(); return; }
        if (chars.some((c) => sameName(c.name, name))) { $('crErr').textContent = 'Ya tenés un personaje con ese nombre.'; return; }
        creating = true; newName = name; setBusy(true); info.onCreate({ name, cls, faction });
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur !== 'login') { e.preventDefault(); ({ select: () => { if (!delBox.hidden) delBox.hidden = true; else info?.onBack(); }, class: () => (chars.length ? show('select') : info?.onBack()), faction: () => show('class'), create: () => show('faction'), login: () => {} })[cur](); } });

    // --- login / crear cuenta (el server crea la cuenta si el nombre no existe) ---
    let reg = false;
    const setReg = (on: boolean) => {
        reg = on;
        $('pass2Row').hidden = !on; $('regHint').hidden = !on;
        ($('pass2In') as HTMLInputElement).required = on;
        ($('passIn') as HTMLInputElement).autocomplete = on ? 'new-password' : 'current-password';
        $('loginBtn').textContent = on ? 'CREAR CUENTA' : 'INICIAR SESIÓN';
        $('altTxt').textContent = on ? '¿Ya tenés una cuenta?' : '¿No tenés una cuenta?';
        $('altBtn').textContent = on ? 'Iniciar sesión' : 'Crear cuenta';
        $('loginErr').textContent = '';
    };
    $('altBtn').addEventListener('click', () => { setReg(!reg); ($('nameIn') as HTMLInputElement).focus(); });

    return {
        show,
        /** Antes de conectar: en modo "crear cuenta" las dos contraseñas tienen que coincidir. */
        checkRegister(): string {
            if (!reg) return '';
            return ($('passIn') as HTMLInputElement).value === ($('pass2In') as HTMLInputElement).value ? '' : 'Las contraseñas no coinciden.';
        },
        /** Cuenta autenticada, antes de entrar al mundo: con personajes → selección; sin ninguno → clase, facción y creación. */
        start(i: StartInfo) {
            info = i; chars = i.chars; creating = false; newName = '';
            selIdx = Math.max(0, chars.findIndex((c) => c.name === i.preselect));
            ($('selErr') as HTMLElement).textContent = '';
            show(chars.length ? 'select' : 'class');
        },
        /** El server mandó la lista de nuevo (tras crear o borrar) o rechazó la última acción (`error`). */
        update(list: CharInfo[], error: string) {
            if (!info) return;
            const wasCreating = creating; creating = false;
            chars = list;
            if (error) {
                if (cur === 'create' && wasCreating) { $('crErr').textContent = error; setBusy(false); ($('crName') as HTMLElement).focus(); } // no se pudo crear: sigue en el formulario
                else { ($('selErr') as HTMLElement).textContent = error; if (cur !== 'select') show('select'); else renderSelect(); }
                return;
            }
            if (wasCreating) { // recién creado: entra directo al mundo
                const nuevo = chars.find((c) => sameName(c.name, newName));
                if (nuevo) { selIdx = chars.indexOf(nuevo); setBusy(true); info.onPlay(nuevo.name, true); return; }
            }
            ($('selErr') as HTMLElement).textContent = '';
            show(chars.length ? 'select' : 'class');
        },
    };
}
