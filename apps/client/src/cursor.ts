// Cursor propio del juego (estilo MMO clásico): flecha de madera y oro, variantes según lo que hay bajo el mouse
// y el indicador de lanzamiento de hechizos: anillo AZUL que se llena mientras el hechizo carga y retícula ROJA
// cuando está listo para hacer clic en el objetivo (gris tachada si el blanco no sirve o está lejos).
// Solo visualización: no toca reglas de combate ni tiempos.
// La flecha y sus variantes (espada, globo, portal, moneda, retícula) son cursor NATIVO del sistema (`cursor: image-set(...)` con
// hotspot): lo dibuja el SO con el mouse real, sin lag. El canvas overlay queda solo para el anillo de casteo, que es animado.

export type CursorHover = 'ground' | 'mob' | 'enemy' | 'npc' | 'portal' | 'drop';
export interface CursorState {
    hover: CursorHover;
    /** Hechizo cargando: k = progreso real 0..1. */
    cast: { icon: string; k: number; slot: HTMLElement | null } | null;
    /** Hechizo listo: ok = el clic lo lanzaría sobre un blanco válido y en rango. */
    ready: { icon: string; ok: boolean; slot: HTMLElement | null } | null;
}
export interface GameCursor { update(s: CursorState): void }

const S = 88, OV_C = S / 2, K = 1.3; // overlay del anillo de casteo (px CSS), su centro = punto caliente, y escala de las formas
const NS = 64, HX = 8, NC = NS / 2; // cursor nativo: lado de la imagen (px CSS; el tope del navegador es 128), hotspot de las formas que salen hacia abajo-derecha, y centro de la retícula
const BLUE = '#4aa8ff', RED = '#ff3b2e';
const imgs = new Map<string, HTMLImageElement>();
function img(src: string) { let i = imgs.get(src); if (!i) { i = new Image(); i.src = src; imgs.set(src, i); } return i; }

/** Flecha de fantasía: punta en (0,0), cuerpo de oro viejo con borde oscuro. */
function arrow(c: CanvasRenderingContext2D, x: number, y: number, a = 1) {
    c.save(); c.translate(x, y); c.globalAlpha = a;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 19); c.lineTo(4.6, 14.8); c.lineTo(8.2, 22.4); c.lineTo(11.6, 20.8); c.lineTo(8, 13.4); c.lineTo(14, 13.2); c.closePath();
    const g = c.createLinearGradient(0, 0, 12, 20); g.addColorStop(0, '#fbe3a4'); g.addColorStop(0.45, '#d29a40'); g.addColorStop(1, '#7a4614');
    c.fillStyle = g; c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 3; c.shadowOffsetY = 1.5; c.fill();
    c.shadowColor = 'transparent'; c.lineJoin = 'round'; c.lineWidth = 1.4; c.strokeStyle = '#2a1606'; c.stroke();
    c.beginPath(); c.moveTo(1.6, 3.6); c.lineTo(1.6, 14.5); c.strokeStyle = 'rgba(255,248,220,.75)'; c.lineWidth = 1; c.stroke();
    c.restore();
}
/** Espada para atacar: la punta es el punto caliente. Roja si es un jugador enemigo. */
function sword(c: CanvasRenderingContext2D, x: number, y: number, enemy: boolean) {
    c.save(); c.translate(x, y); c.rotate(-Math.PI / 4); // hoja hacia arriba-izquierda
    c.shadowColor = enemy ? 'rgba(255,40,30,.8)' : 'rgba(0,0,0,.6)'; c.shadowBlur = enemy ? 5 : 3;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(3.4, 5); c.lineTo(3.4, 19); c.lineTo(-3.4, 19); c.lineTo(-3.4, 5); c.closePath();
    const g = c.createLinearGradient(-3, 0, 3, 0); g.addColorStop(0, '#9aa6b4'); g.addColorStop(0.5, '#f4f8ff'); g.addColorStop(1, '#6d7684');
    c.fillStyle = g; c.fill(); c.shadowColor = 'transparent'; c.strokeStyle = enemy ? '#7a0c06' : '#1c1f26'; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = enemy ? '#c8261c' : '#d29a40'; c.strokeStyle = '#2a1606'; c.lineWidth = 1;
    c.beginPath(); c.roundRect(-8, 19, 16, 3.6, 1.5); c.fill(); c.stroke(); // guarda
    c.fillStyle = '#5a3210'; c.beginPath(); c.rect(-1.8, 22.6, 3.6, 7); c.fill(); c.stroke(); // empuñadura
    c.fillStyle = enemy ? '#ff5a4a' : '#f0c878'; c.beginPath(); c.arc(0, 31.5, 2.4, 0, 7); c.fill(); c.stroke(); // pomo
    c.restore();
}
function bubble(c: CanvasRenderingContext2D, x: number, y: number) {
    c.save(); c.translate(x, y);
    c.beginPath(); c.roundRect(0, 0, 18, 12, 5); c.moveTo(4, 11); c.lineTo(2, 16); c.lineTo(9, 11.5);
    c.fillStyle = '#fbf1d6'; c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 3; c.fill(); c.shadowColor = 'transparent';
    c.strokeStyle = '#5a3210'; c.lineWidth = 1.3; c.stroke();
    c.fillStyle = '#5a3210'; for (const dx of [5, 9, 13]) { c.beginPath(); c.arc(dx, 6, 1.3, 0, 7); c.fill(); }
    c.restore();
}
function portal(c: CanvasRenderingContext2D, x: number, y: number, t: number) {
    c.save(); c.translate(x, y);
    const g = c.createRadialGradient(0, 0, 1, 0, 0, 9); g.addColorStop(0, '#f4eaff'); g.addColorStop(0.45, '#a46bff'); g.addColorStop(1, 'rgba(70,30,160,.9)');
    c.fillStyle = g; c.shadowColor = 'rgba(160,100,255,.9)'; c.shadowBlur = 6; c.beginPath(); c.ellipse(0, 0, 7, 9, 0, 0, 7); c.fill();
    c.shadowColor = 'transparent'; c.strokeStyle = '#d29a40'; c.lineWidth = 1.6; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 4, t, t + 3.6); c.stroke();
    c.restore();
}
function coin(c: CanvasRenderingContext2D, x: number, y: number) {
    c.save(); c.translate(x, y); c.fillStyle = '#f2c94c'; c.strokeStyle = '#6a4210'; c.lineWidth = 1.3;
    c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 2; c.beginPath(); c.arc(0, 0, 5.5, 0, 7); c.fill(); c.shadowColor = 'transparent'; c.stroke();
    c.strokeStyle = '#fff3c0'; c.beginPath(); c.arc(0, 0, 3, 3.6, 5.4); c.stroke(); c.restore();
}
/** Ícono chiquito del hechizo con marco dorado, abajo a la derecha del cursor. */
function spellChip(c: CanvasRenderingContext2D, src: string, x: number, y: number, edge: string) {
    const im = img(src), s = 17;
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 3;
    c.fillStyle = '#1a0f06'; c.beginPath(); c.roundRect(x - 1.5, y - 1.5, s + 3, s + 3, 4); c.fill(); c.shadowColor = 'transparent';
    if (im.complete && im.naturalWidth) { c.save(); c.beginPath(); c.roundRect(x, y, s, s, 3); c.clip(); c.drawImage(im, x, y, s, s); c.restore(); }
    c.strokeStyle = edge; c.lineWidth = 1.5; c.beginPath(); c.roundRect(x - 0.75, y - 0.75, s + 1.5, s + 1.5, 3.5); c.stroke();
    c.restore();
}
/** Anillo de carga azul alrededor del punto caliente. */
function chargeRing(c: CanvasRenderingContext2D, k: number, C = OV_C) {
    const r = 17, a0 = -Math.PI / 2;
    c.save(); c.lineCap = 'round';
    c.strokeStyle = 'rgba(8,14,30,.72)'; c.lineWidth = 6; c.beginPath(); c.arc(C, C, r, 0, 7); c.stroke();
    c.strokeStyle = 'rgba(120,180,255,.28)'; c.lineWidth = 3.4; c.beginPath(); c.arc(C, C, r, 0, 7); c.stroke();
    if (k > 0) { c.strokeStyle = BLUE; c.shadowColor = '#7cc4ff'; c.shadowBlur = 6; c.lineWidth = 3.4; c.beginPath(); c.arc(C, C, r, a0, a0 + k * Math.PI * 2); c.stroke(); }
    c.shadowColor = 'transparent'; c.fillStyle = '#e6f3ff'; c.beginPath(); c.arc(C, C, 1.6, 0, 7); c.fill();
    c.restore();
}
/** Retícula: roja (lista, clic lanza) o gris tachada (blanco inválido o lejos). */
function reticle(c: CanvasRenderingContext2D, ok: boolean, pulse: number, C = OV_C) {
    const r = 13 * (1 + pulse * 0.08), col = ok ? RED : '#9a9a9a';
    c.save(); c.lineCap = 'round';
    for (const [w, s] of [[4.2, 'rgba(0,0,0,.7)'], [2, col]] as const) {
        c.strokeStyle = s; c.lineWidth = w; if (ok && s === col) { c.shadowColor = RED; c.shadowBlur = 4 + pulse * 5; }
        c.beginPath(); c.arc(C, C, r, 0, 7); c.stroke();
        for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a); c.beginPath(); c.moveTo(C + ca * (r - 4), C + sa * (r - 4)); c.lineTo(C + ca * (r + 6), C + sa * (r + 6)); c.stroke(); }
        if (!ok) { c.beginPath(); c.moveTo(C - r * 0.75, C + r * 0.75); c.lineTo(C + r * 0.75, C - r * 0.75); c.stroke(); }
        c.shadowColor = 'transparent';
    }
    c.fillStyle = ok ? '#ffd2cc' : '#cfcfcf'; c.beginPath(); c.arc(C, C, 1.6, 0, 7); c.fill();
    c.restore();
}

const CSS = `
.game-cursor{position:fixed;left:0;top:0;width:${S}px;height:${S}px;pointer-events:none;z-index:2147483000;will-change:transform;contain:strict}
.sw.cur-cast::after,.sw.cur-ready::after,.pot.cur-cast::after{content:'';position:absolute;inset:-5px;border-radius:14px;pointer-events:none;padding:3px;
 -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}
.sw.cur-cast::after,.pot.cur-cast::after{background:conic-gradient(${BLUE} calc(var(--ck,0) * 1turn),rgba(20,30,60,.75) 0)}
.sw.cur-ready::after{background:${RED};box-shadow:0 0 10px ${RED};animation:curPulse 1s ease-in-out infinite}
@keyframes curPulse{50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.sw.cur-ready::after{animation:none}}
`;

/** Dibuja un cursor en un canvas de NS×NS px CSS a la densidad `d` y lo devuelve como data URL. */
function render(d: number, draw: (c: CanvasRenderingContext2D) => void): string {
    const k = document.createElement('canvas'); k.width = k.height = NS * d;
    const c = k.getContext('2d')!; c.setTransform(d, 0, 0, d, 0, 0); draw(c); return k.toDataURL();
}
/** `cursor:` CSS con imagen a 1x y 2x (pantalla normal y retina) y hotspot en px CSS. */
function cssCursor(draw: (c: CanvasRenderingContext2D) => void, hx: number, hy: number): string {
    const u1 = render(1, draw), u2 = render(2, draw);
    return `-webkit-image-set(url(${u1}) 1x,url(${u2}) 2x) ${hx} ${hy},image-set(url(${u1}) 1x,url(${u2}) 2x) ${hx} ${hy},default`;
}
/** Las formas se dibujan a escala 1 desde el hotspot y se agrandan K veces desde ahí. */
const shape = (f: (c: CanvasRenderingContext2D, x: number, y: number) => void) => (c: CanvasRenderingContext2D) => {
    c.translate(HX, HX); c.scale(K, K); c.translate(-HX, -HX); f(c, HX, HX);
};

export function createCursor(cv: HTMLCanvasElement, reduce: boolean): GameCursor {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    // cursor normal propio (en CSS, sin overlay) para la UI del juego: ventanas, HUD, chat
    const ui = document.createElement('canvas'); ui.width = 24; ui.height = 26; const uc = ui.getContext('2d')!; arrow(uc, 2, 1);
    st.textContent += `#game{cursor:url(${ui.toDataURL()}) 2 1,default}#game input,#game textarea{cursor:text}`;

    // variantes del canvas del mundo: una por lo que hay bajo el mouse, armadas una sola vez
    const hoverCur: Record<CursorHover, string> = {
        ground: cssCursor(shape((c, x, y) => arrow(c, x, y)), HX, HX),
        mob: cssCursor(shape((c, x, y) => sword(c, x, y, false)), HX, HX),
        enemy: cssCursor(shape((c, x, y) => sword(c, x, y, true)), HX, HX),
        npc: cssCursor(shape((c, x, y) => { arrow(c, x, y); bubble(c, x + 11, y + 14); }), HX, HX),
        portal: cssCursor(shape((c, x, y) => { arrow(c, x, y); portal(c, x + 19, y + 10, 0); }), HX, HX),
        drop: cssCursor(shape((c, x, y) => { arrow(c, x, y); coin(c, x + 16, y + 22); }), HX, HX),
    };
    // retícula de "hechizo listo": depende del ícono, así que se arma cuando la imagen ya cargó y se guarda
    const readyCache = new Map<string, string>();
    const readyCur = (icon: string, ok: boolean) => {
        const key = icon + (ok ? '1' : '0'), hit = readyCache.get(key); if (hit) return hit;
        const im = img(icon); if (!(im.complete && im.naturalWidth)) return null; // todavía no cargó: se reintenta en el próximo frame
        const v = cssCursor((c) => { reticle(c, ok, 0.5, NC); spellChip(c, icon, NC + 13, NC + 13, ok ? RED : '#8a8a8a'); }, NC, NC);
        readyCache.set(key, v); return v;
    };

    const ov = document.createElement('canvas'); ov.className = 'game-cursor'; ov.setAttribute('aria-hidden', 'true'); ov.hidden = true;
    document.body.append(ov);
    const ctx = ov.getContext('2d')!; let dpr = 0;
    let onCanvas = false, touch = false, px = -1e4, py = -1e4, casting = false;
    const place = () => { ov.style.transform = `translate3d(${px - OV_C}px,${py - OV_C}px,0)`; };
    const show = () => { const v = onCanvas && !touch && casting; if (ov.hidden === v) ov.hidden = !v; };
    window.addEventListener('pointermove', (e) => {
        touch = e.pointerType === 'touch'; onCanvas = e.target === cv; px = e.clientX; py = e.clientY; if (casting) place(); show();
    }, { capture: true, passive: true });
    window.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch'; onCanvas = e.target === cv; show(); }, { capture: true, passive: true });
    window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { onCanvas = false; show(); } }); // el mouse salió de la ventana
    cv.addEventListener('pointerleave', () => { onCanvas = false; show(); });
    window.addEventListener('blur', () => { onCanvas = false; show(); });

    let lastKey = '', lastCur = '', slot: HTMLElement | null = null;
    return {
        update(s) {
            // indicador en el botón del hechizo (sirve en táctil, donde no hay cursor)
            const sl = s.cast?.slot ?? s.ready?.slot ?? null;
            if (slot && slot !== sl) slot.classList.remove('cur-cast', 'cur-ready');
            slot = sl;
            if (sl) { sl.classList.toggle('cur-cast', !!s.cast); sl.classList.toggle('cur-ready', !s.cast && !!s.ready); if (s.cast) sl.style.setProperty('--ck', s.cast.k.toFixed(3)); }

            // cursor nativo del canvas: solo se toca el estilo cuando cambia
            const cur = !s.cast && s.ready ? readyCur(s.ready.icon, s.ready.ok) ?? hoverCur.ground : hoverCur[s.cast ? 'ground' : s.hover];
            if (cur !== lastCur) { lastCur = cur; cv.style.cursor = cur; }

            // overlay: solo el anillo de casteo (más el chip del hechizo), centrado en el hotspot
            const was = casting; casting = !!s.cast;
            if (casting !== was) { if (casting) place(); show(); }
            if (!s.cast) { lastKey = ''; return; }
            if (ov.hidden) return;
            const key = `c${s.cast.k.toFixed(3)}${s.cast.icon}`;
            if (key === lastKey) return; lastKey = key;
            const d = Math.min(2, window.devicePixelRatio || 1);
            if (d !== dpr) { dpr = d; ov.width = ov.height = S * d; }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, S, S);
            chargeRing(ctx, s.cast.k); spellChip(ctx, s.cast.icon, OV_C + 14, OV_C + 15, BLUE);
        },
    };
}
