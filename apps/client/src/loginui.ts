/**
 * Pantallas de entrada: login, selección de personaje, clase, facción y creación.
 * El fondo es assets/background-login.webp; el resto del arte (emblema, brasas, siluetas, escudos) se dibuja por código.
 * Este módulo es solo vista y flujo; la conexión, el guardado y enterWorld siguen en main.ts.
 */
import './login.css';

export interface ClassInfo { id: string; name: string; desc: string; hp: number; hpL: number; mp: number; mpL: number; melee: [number, number]; weapon: string; armor?: string; spells: string[] }
export interface FactionInfo { id: string; name: string; col: string; desc: string }
export interface SaveInfo { cls: string; faction: string; lvl: number }
export interface FlowCtx {
    classes: ClassInfo[];
    factions: FactionInfo[];
    spellName: (id: string) => string;
    /** ciudad inicial de una facción */
    cityName: (factionId: string) => string;
    get: () => { cls: string; faction: string };
    set: (p: { cls?: string; faction?: string }) => void;
}
export interface StartInfo { name: string; saved: SaveInfo | null; zone: string; onPlay: () => void; onBack: () => void }
export type Screen = 'login' | 'select' | 'class' | 'faction' | 'create';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CLS_COL: Record<string, string> = { mago: '#b872ff', guerrero: '#ff5a3c' };
const CLS_TAG: Record<string, string> = { mago: 'Domina el poder arcano', guerrero: 'Lucha con honor' };
const CLS_LORE: Record<string, string> = {
    mago: 'Los magos canalizan la energía arcana a través de sus hechizos. Pegan de lejos, paralizan y curan, pero necesitan maná y poca gente que los toque.',
    guerrero: 'Los guerreros son maestros del combate cuerpo a cuerpo. Su vida y su resistencia les permiten sostener la línea de frente y frenar a los enemigos.',
};
const clsCol = (id: string) => CLS_COL[id] ?? '#d6a445';

// ---------- arte ----------
function emblem(): string {
    let rays = '';
    for (let i = 0; i < 13; i++) {
        const a = -90 + (i - 6) * 11;
        rays += `<path d="M120 62 L${(120 + Math.cos((a - 2.2) * Math.PI / 180) * 70).toFixed(1)} ${(62 + Math.sin((a - 2.2) * Math.PI / 180) * 70).toFixed(1)} L${(120 + Math.cos((a + 2.2) * Math.PI / 180) * 70).toFixed(1)} ${(62 + Math.sin((a + 2.2) * Math.PI / 180) * 70).toFixed(1)}Z" opacity="${(0.28 + 0.5 * Math.cos((i - 6) * 0.22)).toFixed(2)}"/>`;
    }
    return `<svg viewBox="0 0 240 124" width="240" height="124" role="presentation">
  <defs>
    <linearGradient id="emG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd2f4"/><stop offset=".35" stop-color="#c25bff"/><stop offset="1" stop-color="#4a1590"/></linearGradient>
    <linearGradient id="emG2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9ad8"/><stop offset="1" stop-color="#7b27c9"/></linearGradient>
    <linearGradient id="emL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8a0c0" stop-opacity="0"/><stop offset=".6" stop-color="#f4c9d8"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <linearGradient id="emGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8de94"/><stop offset=".5" stop-color="#c9954a"/><stop offset="1" stop-color="#6a3f16"/></linearGradient>
    <radialGradient id="emGlow"><stop offset="0" stop-color="#d870ff" stop-opacity=".75"/><stop offset="1" stop-color="#d870ff" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="120" cy="62" r="60" fill="url(#emGlow)" class="pulse"/>
  <g fill="url(#emGold)" stroke="#2b1710" stroke-width=".8" opacity=".8">${rays}</g>
  <path d="M12 82 H92 M148 82 H228" stroke="url(#emL)" stroke-width="1.4" fill="none"/><path d="M228 82 H148" stroke="url(#emL)" stroke-width="1.4"/>
  <path d="M30 78 L36 82 L30 86 L24 82Z M210 78 L216 82 L210 86 L204 82Z" fill="#f4c9d8"/>
  <path d="M96 70 Q70 74 44 64 Q74 90 108 84Z M144 70 Q170 74 196 64 Q166 90 132 84Z" fill="url(#emGold)" stroke="#2b1710" stroke-width="1"/>
  <path d="M120 14 L148 62 L120 110 L92 62Z" fill="url(#emG)" stroke="#f6d98a" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M120 14 L148 62 L120 62Z" fill="#fff" opacity=".22"/><path d="M120 62 L148 62 L120 110Z" fill="#2a0a55" opacity=".35"/>
  <path d="M120 14 L120 110 M92 62 H148" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>
  <path d="M104 40 L112 28" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>
  <path d="M120 6 L124 14 H116Z M120 118 L124 110 H116Z" fill="url(#emGold)" stroke="#2b1710" stroke-width=".8"/>
</svg>`;
}

/** Siluetas (retrato) dibujadas a mano: mago con báculo y guerrero con espada. */
function silhouette(kind: string, col: string, uid: string): string {
    const rim = `<filter id="${uid}f" x="-30%" y="-10%" width="160%" height="120%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="${col}" flood-opacity=".75"/></filter>`;
    const body = `<linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241830"/><stop offset="1" stop-color="#07040a"/></linearGradient>`;
    if (kind === 'mago') {
        return `<svg viewBox="0 0 220 420" role="presentation"><defs>${rim}${body}<radialGradient id="${uid}o"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="${col}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient></defs>
  <circle cx="168" cy="52" r="46" fill="url(#${uid}o)" class="pulse"/>
  <g filter="url(#${uid}f)" fill="url(#${uid}b)" stroke="${col}" stroke-opacity=".55" stroke-width="1.2">
    <path d="M168 62 L168 410" stroke="#120a1a" stroke-width="5" fill="none"/>
    <path d="M154 40 Q150 20 164 14 M182 40 Q186 20 172 14" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
    <path d="M100 26 C84 26 74 40 74 58 C74 71 80 82 88 88 C72 100 62 126 58 166 C54 218 46 300 36 412 L170 412 C160 300 150 218 146 166 C142 138 134 112 122 96 C130 88 136 76 136 58 C136 40 126 26 100 26Z"/>
    <path d="M120 120 L156 150 L150 164 L116 140Z"/>
    <path d="M88 88 C96 96 112 96 120 88" fill="none"/>
  </g>
  <ellipse cx="105" cy="62" rx="20" ry="23" fill="#030204"/>
  <circle cx="97" cy="62" r="2.6" fill="${col}"/><circle cx="113" cy="62" r="2.6" fill="${col}"/>
  <circle cx="168" cy="52" r="9" fill="#fff"/><circle cx="168" cy="52" r="6" fill="${col}"/>
</svg>`;
    }
    return `<svg viewBox="0 0 220 420" role="presentation"><defs>${rim}${body}</defs>
  <g filter="url(#${uid}f)" fill="url(#${uid}b)" stroke="${col}" stroke-opacity=".6" stroke-width="1.2">
    <path d="M100 8 C108 -2 128 4 124 22 C122 12 110 10 104 20Z" fill="${col}" fill-opacity=".5"/>
    <path d="M100 20 C86 20 80 32 80 46 L80 66 C80 76 88 84 100 84 C112 84 120 76 120 66 L120 46 C120 32 114 20 100 20Z"/>
    <path d="M42 100 C42 84 64 82 76 92 L124 92 C136 82 158 84 158 100 C158 116 144 124 130 120 L70 120 C56 124 42 116 42 100Z"/>
    <path d="M72 96 L128 96 L138 176 L130 214 L70 214 L62 176Z"/>
    <path d="M66 214 L134 214 L130 250 L126 392 L104 392 L100 262 L96 392 L74 392 L70 250Z"/>
    <path d="M56 160 L44 214 L58 220 L72 170Z M144 160 L156 214 L142 220 L128 170Z"/>
    <path d="M178 40 L190 40 L190 316 L184 336 L178 316Z" fill="#150c1c"/>
    <path d="M160 250 H208 L204 262 H164Z M180 262 H188 V300 H180Z"/>
    <circle cx="184" cy="306" r="6"/>
  </g>
  <rect x="86" y="42" width="28" height="5" rx="2" fill="#030204"/><rect x="92" y="38" width="3" height="12" fill="#030204"/>
  <circle cx="94" cy="53" r="2.2" fill="${col}"/><circle cx="106" cy="53" r="2.2" fill="${col}"/>
  <path d="M184 44 L184 310" stroke="${col}" stroke-opacity=".75" stroke-width="1.4"/>
</svg>`;
}

function clsIcon(id: string, col: string): string {
    const glyph = id === 'mago'
        ? `<path d="M0 -17 L5 -4 L17 0 L5 4 L0 17 L-5 4 L-17 0 L-5 -4Z" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/><path d="M0 -26 V26" stroke="${col}" stroke-width="2" opacity=".6"/><circle r="4" fill="#fff"/>`
        : `<path d="M-14 -16 L16 14 M14 -16 L-16 14" stroke="${col}" stroke-width="3.2" stroke-linecap="round"/><path d="M-19 10 L-11 18 M19 10 L11 18" stroke="${col}" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="-2" r="3.2" fill="#fff"/>`;
    return badge(glyph, col);
}
function badge(glyph: string, col: string): string {
    return `<svg viewBox="-34 -38 68 76" role="presentation"><path d="M0 -36 L30 -18 V18 L0 36 L-30 18 V-18Z" fill="#0c0610" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/><path d="M0 -30 L25 -15 V15 L0 30 L-25 15 V-15Z" fill="none" stroke="${col}" stroke-opacity=".4" stroke-width="1"/>${glyph}</svg>`;
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
    $('lEmblem').innerHTML = emblem();

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
    }

    // --- selección de personaje (un personaje por cuenta; el resto de los slots aún no existen) ---
    function renderSelect() {
        const sv = info?.saved; if (!info || !sv) return;
        const c = clsOf(sv.cls), f = facOf(sv.faction), col = clsCol(c.id);
        $('slots').innerHTML = `<li><button type="button" class="slot on" aria-pressed="true"><span class="sbadge">${clsIcon(c.id, col)}</span><span class="stxt"><b>${esc(info.name)}</b><small>Nivel ${sv.lvl} · ${c.name}</small></span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></li>`
            + [1, 2, 3].map(() => `<li><button type="button" class="slot empty" disabled aria-label="Slot vacío, próximamente"><span class="sbadge dim"><svg viewBox="-34 -38 68 76" role="presentation"><path d="M0 -36 L30 -18 V18 L0 36 L-30 18 V-18Z" fill="none" stroke="#6a5a68" stroke-width="2"/></svg></span><span class="stxt"><b>Vacío</b><small>Próximamente</small></span></button></li>`).join('');
        $('selArt').innerHTML = silhouette(c.id, col, 'sa');
        $('selDetail').innerHTML = `<h3>${esc(info.name)}</h3><dl><dt>Nivel</dt><dd>${sv.lvl}</dd><dt>Clase</dt><dd style="color:${col}">${c.name}</dd><dt>Facción</dt><dd style="color:${f.col}">${f.name}</dd><dt>Zona</dt><dd>${esc(info.zone)}</dd></dl>`;
    }

    // --- tarjetas de clase / facción ---
    function bullets(c: ClassInfo): string[] {
        const sp = (...ids: string[]) => ids.map((i) => ctx.spellName(i)).join(', ');
        if (c.id === 'mago') return [`Hechizos a distancia: ${sp('proyectil', 'bola', 'lanza')}`, `Parálisis y curación (${sp('paralisis', 'curar')})`, `Mucho maná: ${c.mp} base, +${c.mpL} por nivel`, `Frágil: ${c.hp} de vida base`];
        if (c.id === 'guerrero') return [`Cuerpo a cuerpo: ${c.melee[0]}–${c.melee[1]} de daño`, `Resistente: ${c.hp} de vida base, +${c.hpL} por nivel`, `Frena enemigos (${sp('aturdir', 'sismo')})`, `Poco maná: ${c.mp} base`];
        return [c.desc];
    }
    function cardsHtml(kind: 'cls' | 'fac'): string {
        const sel = kind === 'cls' ? ctx.get().cls : ctx.get().faction;
        if (kind === 'cls') return ctx.classes.map((c) => { const col = clsCol(c.id), on = c.id === sel; return `<button type="button" role="radio" aria-checked="${on}" class="card${on ? ' on' : ''}" data-id="${c.id}" style="--c:${col}"><span class="cbadge">${clsIcon(c.id, col)}</span><span class="cart">${silhouette(c.id, col, 'c' + c.id)}</span><span class="cname">${c.name.toUpperCase()}</span><span class="ctag">${CLS_TAG[c.id] ?? c.desc}</span><ul>${bullets(c).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></button>`; }).join('');
        return ctx.factions.map((f) => { const on = f.id === sel; return `<button type="button" role="radio" aria-checked="${on}" class="card fcard${on ? ' on' : ''}" data-id="${f.id}" style="--c:${f.col}"><span class="cbadge">${shield(f.id, f.col)}</span><span class="cart fart">${factionBanner(f.id, f.col)}</span><span class="cname">${f.name.toUpperCase()}</span><span class="ctag">${esc(f.desc)}</span><ul><li>Ciudad inicial: ${esc(ctx.cityName(f.id))}</li><li>${f.id === 'solmar' ? 'Tierras costeras del sol y el mar' : 'Tierras secas del hierro y la ceniza'}</li></ul></button>`; }).join('');
    }
    function renderClass() { $('clsCards').innerHTML = cardsHtml('cls'); }
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
        $('crArt').innerHTML = silhouette(c.id, col, 'cr');
        $('crBody').innerHTML = `
  <div class="crhead"><span class="cbadge">${clsIcon(c.id, col)}</span><div><h3 style="color:${col}">${c.name.toUpperCase()}</h3><p>${esc(CLS_TAG[c.id] ?? '')}. ${esc(c.desc)}</p></div></div>
  <div class="crgrid">
    <section class="pnl"><h4>ATRIBUTOS BASE</h4><ul class="attrs">
      ${row('Vida', String(c.hp), c.hp, mx((x) => x.hp))}${row('Maná', String(c.mp), c.mp, mx((x) => x.mp))}${row('Cuerpo a cuerpo', `${c.melee[0]}–${c.melee[1]}`, mid(c), mx(mid))}${row('Hechizos', String(c.spells.length), c.spells.length, mx((x) => x.spells.length))}
    </ul></section>
    <section class="pnl"><h4>DESCRIPCIÓN</h4><p class="lore">${esc(CLS_LORE[c.id] ?? c.desc)}</p>
      <h4 class="h4b">BONUS DE CLASE</h4><ul class="bon"><li style="--b:${col}">+${c.hpL} de vida por nivel</li><li style="--b:#5aa0ff">+${c.mpL} de maná por nivel</li><li style="--b:#d6a445">Equipo inicial: ${esc(c.weapon)}${c.armor ? ' y ' + esc(c.armor) : ''}</li></ul></section>
  </div>
  <div class="pnl crstrip"><dl><div><dt>Nombre</dt><dd>${esc(info.name)}</dd></div><div><dt>Clase</dt><dd style="color:${col}">${c.name}</dd></div><div><dt>Facción</dt><dd style="color:${f.col}">${f.name}</dd></div><div><dt>Ciudad inicial</dt><dd>${esc(ctx.cityName(f.id))}</dd></div></dl></div>`;
    }

    // --- botones ---
    $('selPlay').addEventListener('click', () => info?.onPlay());
    $('selBack').addEventListener('click', () => info?.onBack());
    $('clsBack').addEventListener('click', () => info?.onBack());
    $('clsOk').addEventListener('click', () => show('faction'));
    $('facBack').addEventListener('click', () => show('class'));
    $('facOk').addEventListener('click', () => show('create'));
    $('crBack').addEventListener('click', () => show('faction'));
    $('crOk').addEventListener('click', () => info?.onPlay());
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur !== 'login') { e.preventDefault(); ({ select: () => info?.onBack(), class: () => info?.onBack(), faction: () => show('class'), create: () => show('faction'), login: () => {} })[cur](); } });

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
        /** Ya conectado y con el mundo cargado: tiene personaje → selección, si no → clase, facción y creación. */
        start(i: StartInfo) { info = i; show(i.saved ? 'select' : 'class'); },
    };
}
