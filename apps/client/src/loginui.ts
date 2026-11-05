/**
 * Pantallas de entrada: login, selección de personaje, clase, facción y creación.
 * El fondo es assets/background-login.webp; el logo es assets/logo-eris.webp; el resto del arte (brasas, siluetas, escudos) se dibuja por código.
 * Este módulo es solo vista y flujo; la conexión, el guardado y enterWorld siguen en main.ts.
 */
import './login.css';
import './ui/login-craftpix.css';
import { classBaseHp, classBaseMp } from '@fdn/world';
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
export type Screen = 'login' | 'select' | 'create';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CLS_COL: Record<string, string> = { mago: '#b872ff', guerrero: '#ff5a3c', healer: '#f2d36b' };
const CLS_TAG: Record<string, string> = { mago: 'Domina el poder arcano', guerrero: 'Lucha con honor', healer: 'Sostiene al grupo' };
const CLS_LORE: Record<string, string> = {
    mago: 'Los magos canalizan la energía arcana a través de sus hechizos. Pegan de lejos, congelan y queman, pero necesitan maná y poca gente que los toque.',
    healer: 'Los healers canalizan la luz sagrada: curan y bendicen a los suyos, castigan de lejos y cortan los casteos peligrosos. Pueden cazar solos, pero brillan en grupo.',
    guerrero: 'Los paladines son maestros del combate cuerpo a cuerpo. Su vida y su resistencia les permiten sostener la línea de frente y frenar a los enemigos.',
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

    const screens: Record<Screen, string> = { login: 'scrLogin', select: 'scrSelect', create: 'scrCreate' };
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
        if (s === 'select') renderSelect(); else if (s === 'create') renderCreate();
        const focusId = { login: '', select: 'selPlay', create: 'crName' }[s];
        if (focusId) ($(focusId) as HTMLElement).focus({ preventScroll: true });
        if (s !== 'select') delBox.hidden = true;
    }

    // --- selección de personaje (hasta `info.max` por cuenta: elegir, crear uno nuevo o borrar) ---
    let chars: CharInfo[] = [], selIdx = 0, newName = '', creating = false;
    const setBusy = (on: boolean) => {
        ($('crOk') as HTMLButtonElement).disabled = on;
        ($('selPlay') as HTMLButtonElement).disabled = on || !chars.length;
    };
    function renderSelect() {
        if (!info) return;
        selIdx = Math.min(selIdx, Math.max(0, chars.length - 1));
        const top = (fn: (x: ClassInfo) => number) => Math.max(...ctx.classes.map((x) => fn(x)));
        const bar = (label: string, v: number, m: number) => `<li><span class="al">${label}</span><span class="av">${v}</span><span class="bar"><i style="width:${Math.round((v / m) * 100)}%"></i></span></li>`;
        const slotHtml = (i: number): string => {
            const sv = chars[i];
            if (!sv) return `<li><button type="button" class="slot empty" data-new="1" aria-label="Crear personaje nuevo"><span class="sbadge dim"><svg viewBox="-34 -34 68 68" role="presentation"><circle r="32" fill="none" stroke="#a78ad8" stroke-width="2" stroke-dasharray="5 4"/><path d="M0 -9 V9 M-9 0 H9" stroke="#d9c4ff" stroke-width="2.4" stroke-linecap="round"/></svg></span><span class="stxt"><b>Crear personaje</b><small>${chars.length ? `Quedan ${info!.max - chars.length}` : 'Slot libre'}</small></span></button></li>`;
            const c = clsOf(sv.cls), f = facOf(sv.faction), on = i === selIdx;
            return `<li><button type="button" class="slot${on ? ' on' : ''}" data-i="${i}" aria-pressed="${on}"><span class="sbadge">${clsIcon(c.id, clsCol(c.id))}</span><span class="stxt"><b>${esc(sv.name)}</b><small>${c.name} · ${f.name}</small></span><span class="lvl">Nv. ${sv.lvl}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button><button type="button" class="sdel" data-del="${i}" title="Borrar personaje" aria-label="Borrar a ${esc(sv.name)}">&times;</button></li>`;
        };
        const filas = Math.min(chars.length + 1, info.max); // los personajes y, si queda lugar, una sola fila para crear
        $('slots').innerHTML = Array.from({ length: filas }, (_, i) => slotHtml(i)).join('');
        const sv = chars[selIdx];
        if (!sv) { $('selArt').innerHTML = ''; $('selDetail').innerHTML = ''; setBusy(false); return; }
        const c = clsOf(sv.cls), f = facOf(sv.faction), col = clsCol(c.id);
        root.dataset.cls = c.id; root.style.setProperty('--ac', col); root.style.setProperty('--fc', f.col);
        const hpMax = classBaseHp(c.id, sv.lvl), mpMax = classBaseMp(c.id, sv.lvl);
        $('selArt').innerHTML = dollCv(c.id, 0.66); mountDolls($('selArt'));
        $('selDetail').innerHTML = `<h3>${esc(sv.name)}</h3><p class="dsub"><b style="color:${col}">${c.name}</b> · <b style="color:${f.col}">${f.name}</b></p><ul class="attrs">${bar('Vida', hpMax, top((x) => x.hp + (sv.lvl - 1) * x.hpL))}${bar('Maná', mpMax, top((x) => x.mp + (sv.lvl - 1) * x.mpL))}</ul><dl><dt>Nivel</dt><dd>${sv.lvl}</dd><dt>Zona</dt><dd>${esc(sv.zone || ciudadInicial(f.id))}</dd></dl>`;
        setBusy(false);
    }
    const ciudadInicial = (fid: string) => ctx.cityName(fid);
    $('slots').addEventListener('click', (e) => {
        const d = (e.target as HTMLElement).closest<HTMLElement>('.sdel');
        if (d) { selIdx = Number(d.dataset.del); renderSelect(); openDelete(); return; }
        const b = (e.target as HTMLElement).closest<HTMLElement>('.slot'); if (!b || !info) return;
        if (b.dataset.new) { newName = ''; ($('crName') as HTMLInputElement).value = ''; ($('selErr') as HTMLElement).textContent = ''; show('create'); return; }
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
    $('delNo').addEventListener('click', () => { delBox.hidden = true; ($('slots').querySelector<HTMLElement>('.slot.on') ?? $('selPlay')).focus(); });
    delOk.addEventListener('click', () => { const sv = chars[selIdx]; if (!info || !sv || !sameName(delIn.value, sv.name)) return; delBox.hidden = true; setBusy(true); info.onDelete(sv.name); });
    delIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !delOk.disabled) delOk.click(); });

    // --- tarjetas de clase / facción ---
    function bullets(c: ClassInfo): string[] {
        const sp = (...ids: string[]) => ids.map((i) => ctx.spellName(i)).join(', ');
        if (c.id === 'mago') return [`Hechizos a distancia: ${sp('proyectil', 'bola', 'lluvia')}`, `Congela para controlar (${sp('paralisis')})`, `Mucho maná: ${c.mp} base, +${c.mpL} por nivel`, `Frágil: ${c.hp} de vida base`];
        if (c.id === 'healer') return [`Cura a los suyos: ${sp('curacion', 'renovar', 'orbe')}`, `Bendice y protege (${sp('bendicion')})`, `Castiga de lejos y corta casteos (${sp('castigo', 'reprender')})`, `Maná: ${c.mp} base, +${c.mpL} por nivel`];
        if (c.id === 'guerrero') return [`Cuerpo a cuerpo: ${c.melee[0]}–${c.melee[1]} de daño`, `Resistente: ${c.hp} de vida base, +${c.hpL} por nivel`, `Aturde y barre (${sp('aturdir', 'giro')})`, `Poco maná: ${c.mp} base`];
        return [c.desc];
    }
    /** Íconos de facción y de clase: una sola pantalla de creación, como el diseño del pack. */
    function pickHtml(kind: 'cls' | 'fac'): string {
        const { cls, faction } = ctx.get();
        const btn = (id: string, name: string, col: string, on: boolean, glyph: string) =>
            `<button type="button" role="radio" aria-checked="${on}" class="pk${on ? ' on' : ''}" data-k="${kind}" data-id="${id}" style="--c:${col}" aria-label="${esc(name)}" title="${esc(name)}">${glyph}</button>`;
        if (kind === 'fac') return ctx.factions.map((f) => btn(f.id, f.name, f.col, f.id === faction, shield(f.id, f.col))).join('');
        return ctx.classes.map((c) => btn(c.id, c.name, clsCol(c.id), c.id === cls, clsIcon(c.id, clsCol(c.id)))).join('');
    }
    /** Ficha de la clase o la facción elegida (la columna derecha, donde el diseño del pack pone la apariencia). */
    function fichaCls(c: ClassInfo): string {
        const col = clsCol(c.id);
        return `<article class="crcard"><h3 style="color:${col}">${esc(c.name.toUpperCase())}</h3><p class="crtag">${esc(CLS_TAG[c.id] ?? '')}</p>`
            + `<ul class="crbul">${bullets(c).map((b) => `<li style="--b:${col}">${esc(b)}</li>`).join('')}</ul>`
            + `<p class="crlore">${esc(CLS_LORE[c.id] ?? c.desc)}</p>`
            + `<dl class="crnums"><div><dt>Vida</dt><dd>${c.hp} <small>+${c.hpL}/nivel</small></dd></div><div><dt>Maná</dt><dd>${c.mp} <small>+${c.mpL}/nivel</small></dd></div>`
            + `<div><dt>Cuerpo a cuerpo</dt><dd>${c.melee[0]}–${c.melee[1]}</dd></div><div><dt>Equipo</dt><dd>${esc(c.weapon)}${c.armor ? `, ${esc(c.armor)}` : ''}</dd></div></dl></article>`;
    }
    function fichaFac(f: FactionInfo): string {
        return `<article class="crcard sm"><h3 style="color:${f.col}">${esc(f.name.toUpperCase())}</h3><p class="crlore">${esc(f.desc)}</p>`
            + `<dl class="crnums"><div><dt>Empezás en</dt><dd>${esc(ctx.cityName(f.id))}</dd></div></dl></article>`;
    }
    function renderCreate() {
        if (!info) return;
        const { cls, faction } = ctx.get(), c = clsOf(cls), f = facOf(faction);
        $('facPicks').innerHTML = pickHtml('fac');
        $('clsPicks').innerHTML = pickHtml('cls');
        $('crArt').innerHTML = dollCv(c.id, 0.66); mountDolls($('crArt'));
        $('crFacInfo').innerHTML = fichaFac(f);
        $('crSide').innerHTML = fichaCls(c);
        setBusy(false);
    }
    function pick(e: Event) {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.pk'); if (!b) return;
        const kind = b.dataset.k as 'cls' | 'fac', id = b.dataset.id!;
        ctx.set(kind === 'cls' ? { cls: id } : { faction: id });
        renderCreate();
        root.dataset.cls = ctx.get().cls;
        root.style.setProperty('--ac', clsCol(ctx.get().cls));
        root.style.setProperty('--fc', facOf(ctx.get().faction).col);
        $(kind === 'cls' ? 'clsPicks' : 'facPicks').querySelector<HTMLElement>(`.pk[data-id="${id}"]`)?.focus();
    }
    for (const id of ['facPicks', 'clsPicks']) {
        $(id).addEventListener('click', pick);
        $(id).addEventListener('keydown', (e) => {
            const k = (e as KeyboardEvent).key; if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
            const pks = [...$(id).querySelectorAll<HTMLElement>('.pk')], i = pks.findIndex((x) => x.classList.contains('on'));
            pks[(i + (k === 'ArrowRight' ? 1 : pks.length - 1)) % pks.length].click(); e.preventDefault();
        });
    }
    {
        const inp = $('crName') as HTMLInputElement;
        inp.addEventListener('input', () => { newName = inp.value; $('crErr').textContent = ''; });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('crOk').click(); } });
    }

    // --- botones ---
    $('selPlay').addEventListener('click', play);
    $('selBack').addEventListener('click', () => info?.onBack());
    $('crBack').addEventListener('click', () => (chars.length ? show('select') : info?.onBack()));
    $('crOk').addEventListener('click', () => {
        if (!info) return;
        const name = newName.trim().replace(/\s+/g, ' '), { cls, faction } = ctx.get();
        if (!NAME_RE.test(name)) { $('crErr').textContent = 'El nombre tiene que tener entre 2 y 16 letras, números, espacios, guiones o _.'; ($('crName') as HTMLElement).focus(); return; }
        if (chars.some((c) => sameName(c.name, name))) { $('crErr').textContent = 'Ya tenés un personaje con ese nombre.'; return; }
        creating = true; newName = name; setBusy(true); info.onCreate({ name, cls, faction });
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur !== 'login') { e.preventDefault(); ({ select: () => { if (!delBox.hidden) delBox.hidden = true; else info?.onBack(); }, create: () => (chars.length ? show('select') : info?.onBack()), login: () => {} })[cur](); } });

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

    // Créditos: la licencia del arte de Flare (CC-BY-SA 3.0) obliga a mostrar la atribución de una forma razonable para el medio,
    // así que los archivos de atribución se leen y se muestran dentro del juego, no solo como .txt en /assets.
    let credLoaded = false;
    const abrirCreditos = async () => {
        $('credits').hidden = false;
        if (credLoaded) return;
        const pre = $('credText');
        try {
            const partes = await Promise.all(['CREDITS.txt', 'CREDITS-CC0.txt'].map(async (f) => {
                const r = await fetch(`assets/${f}`);
                if (!r.ok) throw new Error(f);
                return r.text();
            }));
            pre.textContent = partes.join('\n\n' + '─'.repeat(60) + '\n\n');
            credLoaded = true;
        } catch {
            pre.textContent = 'No se pudieron cargar los créditos. Están en assets/CREDITS.txt y assets/CREDITS-CC0.txt.';
        }
    };
    $('credBtn').addEventListener('click', () => void abrirCreditos());
    $('credClose').addEventListener('click', () => { $('credits').hidden = true; });
    $('credits').addEventListener('click', (e) => { if (e.target === $('credits')) $('credits').hidden = true; });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('credits').hidden) $('credits').hidden = true; });

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
            show(chars.length ? 'select' : 'create');
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
            show(chars.length ? 'select' : 'create');
        },
    };
}
