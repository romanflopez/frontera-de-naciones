// Cursor propio del juego (estilo MMO clásico): flecha de madera y oro, variantes según lo que hay bajo el mouse
// y el indicador de lanzamiento de hechizos: anillo AZUL que se llena mientras el hechizo carga y retícula ROJA
// cuando está listo para hacer clic en el objetivo (gris tachada si el blanco no sirve o está lejos).
// Solo visualización: no toca reglas de combate ni tiempos. La posición se actualiza en pointermove (sin esperar
// al loop del juego); el dibujo del estado se rehace en update(), que el juego llama una vez por frame.

export type CursorHover = 'ground' | 'mob' | 'enemy' | 'npc' | 'portal' | 'drop';
export interface CursorState {
    hover: CursorHover;
    /** Hechizo cargando: k = progreso real 0..1. */
    cast: { icon: string; k: number; slot: HTMLElement | null } | null;
    /** Hechizo listo: ok = el clic lo lanzaría sobre un blanco válido y en rango. */
    ready: { icon: string; ok: boolean; slot: HTMLElement | null } | null;
}
export interface GameCursor { update(s: CursorState): void }

const S = 88, C = S / 2, K = 1.3; // tamaño del overlay (px CSS), su centro = punto caliente, y escala de las formas
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
function chargeRing(c: CanvasRenderingContext2D, k: number) {
    const r = 17, a0 = -Math.PI / 2;
    c.save(); c.lineCap = 'round';
    c.strokeStyle = 'rgba(8,14,30,.72)'; c.lineWidth = 6; c.beginPath(); c.arc(C, C, r, 0, 7); c.stroke();
    c.strokeStyle = 'rgba(120,180,255,.28)'; c.lineWidth = 3.4; c.beginPath(); c.arc(C, C, r, 0, 7); c.stroke();
    if (k > 0) { c.strokeStyle = BLUE; c.shadowColor = '#7cc4ff'; c.shadowBlur = 6; c.lineWidth = 3.4; c.beginPath(); c.arc(C, C, r, a0, a0 + k * Math.PI * 2); c.stroke(); }
    c.shadowColor = 'transparent'; c.fillStyle = '#e6f3ff'; c.beginPath(); c.arc(C, C, 1.6, 0, 7); c.fill();
    c.restore();
}
/** Retícula: roja (lista, clic lanza) o gris tachada (blanco inválido o lejos). */
function reticle(c: CanvasRenderingContext2D, ok: boolean, pulse: number) {
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
#cv.cur-own{cursor:none}
.game-cursor{position:fixed;left:0;top:0;width:${S}px;height:${S}px;pointer-events:none;z-index:2147483000;will-change:transform;contain:strict}
.sw.cur-cast::after,.sw.cur-ready::after{content:'';position:absolute;inset:-5px;border-radius:14px;pointer-events:none;padding:3px;
 -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}
.sw.cur-cast::after{background:conic-gradient(${BLUE} calc(var(--ck,0) * 1turn),rgba(20,30,60,.75) 0)}
.sw.cur-ready::after{background:${RED};box-shadow:0 0 10px ${RED};animation:curPulse 1s ease-in-out infinite}
@keyframes curPulse{50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.sw.cur-ready::after{animation:none}}
`;

export function createCursor(cv: HTMLCanvasElement, reduce: boolean): GameCursor {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    // cursor normal propio (en CSS, sin overlay) para la UI del juego: ventanas, HUD, chat
    const ui = document.createElement('canvas'); ui.width = 24; ui.height = 26; const uc = ui.getContext('2d')!; arrow(uc, 2, 1);
    st.textContent += `#game{cursor:url(${ui.toDataURL()}) 2 1,default}#game input,#game textarea{cursor:text}`;

    const ov = document.createElement('canvas'); ov.className = 'game-cursor'; ov.setAttribute('aria-hidden', 'true'); ov.hidden = true;
    document.body.append(ov);
    const ctx = ov.getContext('2d')!; let dpr = 0;
    let onCanvas = false, touch = false, px = -1e4, py = -1e4;
    const place = () => { ov.style.transform = `translate3d(${px - C}px,${py - C}px,0)`; };
    const show = () => { const v = onCanvas && !touch; if (ov.hidden === v) ov.hidden = !v; cv.classList.toggle('cur-own', !touch); };
    window.addEventListener('pointermove', (e) => {
        touch = e.pointerType === 'touch'; onCanvas = e.target === cv; px = e.clientX; py = e.clientY; place(); show();
    }, { capture: true, passive: true });
    window.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch'; onCanvas = e.target === cv; show(); }, { capture: true, passive: true });
    window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) { onCanvas = false; show(); } }); // el mouse salió de la ventana
    cv.addEventListener('pointerleave', () => { onCanvas = false; show(); });
    window.addEventListener('blur', () => { onCanvas = false; show(); });

    let lastKey = '', slot: HTMLElement | null = null;
    const t0 = performance.now();
    return {
        update(s) {
            // indicador en el botón del hechizo (sirve en táctil, donde no hay cursor)
            const sl = s.cast?.slot ?? s.ready?.slot ?? null;
            if (slot && slot !== sl) slot.classList.remove('cur-cast', 'cur-ready');
            slot = sl;
            if (sl) { sl.classList.toggle('cur-cast', !!s.cast); sl.classList.toggle('cur-ready', !s.cast && !!s.ready); if (s.cast) sl.style.setProperty('--ck', s.cast.k.toFixed(3)); }
            if (ov.hidden) return;
            const t = (performance.now() - t0) / 1000, pulse = reduce ? 0 : 0.5 + 0.5 * Math.sin(t * 6);
            const animated = (!!s.ready && s.ready.ok && !reduce) || (s.hover === 'portal' && !s.cast && !s.ready && !reduce);
            const key = s.cast ? `c${s.cast.k.toFixed(3)}${s.cast.icon}` : s.ready ? `r${s.ready.ok}${s.ready.icon}` : s.hover;
            if (key === lastKey && !animated) return; lastKey = key;
            const d = Math.min(2, window.devicePixelRatio || 1);
            if (d !== dpr) { dpr = d; ov.width = ov.height = S * d; }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, S, S);
            if (s.cast) { chargeRing(ctx, s.cast.k); arrow(ctx, C, C, 0.9); spellChip(ctx, s.cast.icon, C + 14, C + 15, BLUE); return; }
            if (s.ready) { reticle(ctx, s.ready.ok, pulse); spellChip(ctx, s.ready.icon, C + 14, C + 15, s.ready.ok ? RED : '#8a8a8a'); return; }
            ctx.translate(C, C); ctx.scale(K, K); ctx.translate(-C, -C); // las formas se dibujan a escala 1 y se agrandan desde el punto caliente
            if (s.hover === 'mob' || s.hover === 'enemy') { sword(ctx, C, C, s.hover === 'enemy'); return; }
            arrow(ctx, C, C);
            if (s.hover === 'npc') bubble(ctx, C + 11, C + 14);
            else if (s.hover === 'portal') portal(ctx, C + 19, C + 10, reduce ? 0 : t * 4);
            else if (s.hover === 'drop') coin(ctx, C + 16, C + 22);
        },
    };
}
