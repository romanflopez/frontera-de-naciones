/**
 * Minimapa y mapa grande del cliente.
 *
 * No depende del mapa único: `setMap(map, meta)` se llama al entrar al juego y cada vez que se cambia de mapa, pre-renderiza
 * el terreno UNA vez en un canvas fuera de pantalla (que se reutiliza entre mapas, sin fugas) y arma la lista de etiquetas
 * (ciudades, zonas, portales). `update(state)` solo dibuja marcadores; `tick(getState)` lo limita a ~10 fps.
 *
 * Proyección: la vista del juego es isométrica 2:1 (x hacia el sudeste, y hacia el sudoeste). El minimapa usa la misma
 * rotación en rombo (achatado 2:1 como la pantalla), así el arriba del minimapa es el arriba de la pantalla del juego.
 * Se dejó la opción `proj: 'grilla'` (cuadrado alineado a la grilla, arriba = norte de la grilla) solo para comparar.
 *
 * Teclas: M abre/cierra el mapa grande, Escape lo cierra. No captura nada mientras el foco está en un campo de texto (chat).
 */
import { getMapDef, mapLinks, SHOPS, type WorldMap } from '@fdn/world';

export interface MinimapMeta { id: string; name: string }
/** Dirección como la de los sprites: 0 = oeste de la pantalla, en sentido horario (2 = arriba, 6 = abajo). */
export interface MinimapState {
    player: { x: number; y: number; dir: number };
    party?: { x: number; y: number; name: string }[];
    /** Otros jugadores que el server ya manda (los que se ven). */
    others?: { x: number; y: number; faction: string }[];
    mobs?: { x: number; y: number; boss?: unknown }[];
    npcs?: { x: number; y: number; role: string }[];
    /** Portales extra además de los del mapa (vínculos, escaleras y waypoints ya salen de `setMap`). */
    portals?: MinimapPortal[];
}
export interface MinimapPortal { x: number; y: number; kind: 'link' | 'stairs' | 'waypoint'; label: string }
export interface Minimap {
    readonly el: HTMLElement;
    setMap(map: WorldMap, meta: MinimapMeta): void;
    update(state: MinimapState): void;
    /** Llamar en cada frame: pide el estado y redibuja solo cada ~100 ms. */
    tick(get: () => MinimapState): void;
    toggleBig(open?: boolean): void;
    readonly bigOpen: boolean;
    destroy(): void;
}
export interface MinimapOptions {
    proj?: 'rombo' | 'grilla';
    factionCol?: Record<string, string>;
    /** Si devuelve false, la tecla M no hace nada (por ejemplo, en el login o durante la pantalla de carga). */
    active?: () => boolean;
}

const FACTION_COL: Record<string, string> = { solmar: '#6fb3ff', vhar: '#ff7a6b' };
/** Píxeles por celda (a lo largo de cada eje de la grilla) de cada nivel de zoom del minimapa chico. */
const ZOOMS = [2.4, 3.6, 5.4];
const SMALL = 176;
const FPS_MS = 100;

// ---------- colores del terreno ----------
type RGB = [number, number, number];
/** Kenney: 2000 + índice de nombre * 4 + orientación (ver frontier.ts KENNEY_NAMES: 8-9 dirt, 10-12 planks). */
function tileRGB(id: number): RGB {
    if (id >= 16 && id <= 31) return [80, 116, 54]; // pasto
    if (id >= 32 && id <= 43) return [134, 128, 114]; // piedra del campamento
    if (id >= 44 && id <= 47) return [138, 104, 64]; // camino de tierra
    if (id >= 2000) { const n = (id - 2000) >> 2; return n === 8 || n === 9 ? [112, 86, 60] : n >= 10 && n <= 12 ? [124, 88, 52] : [96, 92, 92]; }
    if (id >= 1000) {
        const s = Math.floor((id - 1000) / 18), c = (id - 1000) % 18;
        if (s === 0) return c === 12 || c === 16 || c === 17 ? [150, 92, 66] : [170, 140, 96]; // seco / arcilla
        if (s === 1) return [192, 166, 114]; // arena
        if (s === 4 || s === 5 || s === 6 || s === 7) return [88, 124, 60]; // flora / pasto
        if (s === 8 || s === 9) return [180, 206, 222]; // hielo
        if (s === 10 || s === 11) return [118, 108, 96]; // rocoso
        if (s === 14 || s === 15) return [134, 88, 70]; // ladrillo
        return [124, 120, 112];
    }
    return [92, 98, 82];
}
const TREES = new Set([240, 241, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255]);
const ROCKS = new Set([128, 129, 130, 131, 136, 137]);
const hash = (x: number, y: number) => { let h = Math.imul(x * 374761393 + y * 668265263, 1103515245); h = (h ^ (h >>> 13)) >>> 0; return (Math.imul(h, 2654435761) >>> 0) / 4294967296; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Pinta el terreno en `cv` (S píxeles por celda). Una sola pasada por celda: es lo único "caro" y corre una vez por mapa. */
function paintTerrain(cv: HTMLCanvasElement, m: WorldMap, S: number) {
    const N = m.size;
    cv.width = N * S; cv.height = N * S;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(N * S, N * S), d = img.data;
    const blockProp = new Map<number, number>();
    for (const p of m.props) { const x = Math.floor(p.x), y = Math.floor(p.y); if (m.blocked[y]?.[x]) blockProp.set(y * N + x, p.id); }
    const roof = new Set<number>();
    for (const b of m.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) roof.add(y * N + x);
    const dung = [m.dungeon, ...(m.dungeons ?? [])].filter((r): r is NonNullable<typeof r> => !!r);
    const inDung = (x: number, y: number) => dung.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const k = y * N + x, dg = inDung(x, y);
        let c = tileRGB(m.tiles[y]?.[x] ?? 0);
        if (dg) c = mix(c, [40, 30, 60], 0.35); // mazmorra: más oscura y fría
        if (m.blocked[y]?.[x]) {
            const p = blockProp.get(k);
            if (roof.has(k)) c = [150, 84, 58];
            else if (p !== undefined && TREES.has(p)) c = [34, 62, 34];
            else if (p !== undefined && ROCKS.has(p)) c = [86, 82, 78];
            else if (p !== undefined) c = mix(c, [58, 44, 34], 0.55); // vallas, cabañas, muebles
            else c = dg || x === 0 || y === 0 || x === N - 1 || y === N - 1 ? [16, 12, 24] : mix(c, [20, 16, 26], 0.6); // roca / borde
        } else if (m.safe[y]?.[x]) c = mix(c, [150, 200, 230], 0.18); // zona segura: tinte celeste
        const v = 0.93 + hash(x, y) * 0.12;
        for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
            const i = ((y * S + py) * N * S + (x * S + px)) * 4;
            d[i] = Math.min(255, c[0] * v); d[i + 1] = Math.min(255, c[1] * v); d[i + 2] = Math.min(255, c[2] * v); d[i + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    // borde suave de las zonas seguras (ciudades): una línea clara alrededor
    g.fillStyle = 'rgba(200,235,255,.55)';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!m.safe[y][x]) continue;
        if (!m.safe[y - 1]?.[x]) g.fillRect(x * S, y * S, S, 1);
        if (!m.safe[y + 1]?.[x]) g.fillRect(x * S, (y + 1) * S - 1, S, 1);
        if (!m.safe[y][x - 1]) g.fillRect(x * S, y * S, 1, S);
        if (!m.safe[y][x + 1]) g.fillRect((x + 1) * S - 1, y * S, 1, S);
    }
}

// ---------- estilos (se inyectan una vez) ----------
const CSS = `
.mm{position:absolute;z-index:3;top:calc(54px + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));width:${SMALL + 16}px;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:auto;font-family:var(--f-inter,system-ui,sans-serif);color:#eadfe8;user-select:none}
.mm-name{max-width:100%;padding:3px 12px;border-radius:999px;font:600 12.5px/1.25 var(--f-cinzel,Georgia,serif);letter-spacing:.04em;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(180deg,rgba(38,16,78,.78),rgba(14,6,34,.88));border:1px solid rgba(206,150,255,.38);box-shadow:0 0 12px rgba(170,80,255,.2),0 4px 10px rgba(0,0,0,.45);text-shadow:0 1px 2px #000}
.mm-disc{position:relative;width:${SMALL}px;height:${SMALL}px;border-radius:50%;padding:0;background:rgba(10,4,24,.85);border:2px solid rgba(206,150,255,.5);box-shadow:0 0 0 1px rgba(10,2,30,.8),0 0 22px rgba(170,80,255,.28),0 10px 24px rgba(0,0,0,.55),inset 0 0 18px rgba(0,0,0,.6);overflow:hidden;cursor:pointer}
.mm-disc canvas{display:block;width:100%;height:100%;cursor:pointer}
.mm-disc::after{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),inset 0 -14px 26px rgba(20,4,44,.45)}
.mm-foot{display:flex;align-items:center;gap:4px}
.mm-xy{min-width:66px;padding:2px 8px;border-radius:999px;font:600 11px/1.3 var(--f-inter,system-ui,sans-serif);font-variant-numeric:tabular-nums;text-align:center;background:rgba(14,6,34,.82);border:1px solid rgba(206,150,255,.3);color:#d8c8ef}
.mm button{width:22px;height:22px;padding:0;display:grid;place-items:center;border-radius:6px;font:700 14px/1 var(--f-inter,system-ui,sans-serif);color:#f0e4ff;background:linear-gradient(180deg,rgba(70,34,130,.9),rgba(30,12,64,.95));border:1px solid rgba(206,150,255,.45);box-shadow:0 2px 6px rgba(0,0,0,.45);cursor:pointer}
.mm button:hover{border-color:#e2b8ff;box-shadow:0 0 10px rgba(194,91,255,.45)}
.mm button:disabled{opacity:.4;cursor:default;box-shadow:none}
.mm button:focus-visible,.mm-big button:focus-visible{outline:2px solid #e2b8ff;outline-offset:2px}
.mm-big{position:absolute;inset:0;z-index:4;display:grid;place-items:center;background:rgba(6,2,16,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);font-family:var(--f-inter,system-ui,sans-serif);color:#eadfe8}
.mm-big[hidden]{display:none}
.mm-panel{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px 16px 12px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);box-sizing:border-box;border-radius:16px;background:linear-gradient(180deg,rgba(38,16,78,.80),rgba(14,6,34,.90));border:1px solid rgba(206,150,255,.38);box-shadow:0 0 0 1px rgba(10,2,30,.7),0 0 30px rgba(170,80,255,.22),0 16px 40px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12)}
.mm-head{display:flex;align-items:baseline;gap:10px;padding-right:34px}
.mm-head h2{margin:0;font:700 20px/1.2 var(--f-cinzel,Georgia,serif);letter-spacing:.04em;color:#f6ecff;text-shadow:0 0 12px rgba(194,91,255,.5)}
.mm-head span{font-size:12px;color:#b9a6d6}
.mm-close{position:absolute;top:10px;right:12px;width:28px;height:28px;padding:0;display:grid;place-items:center;border-radius:8px;font:700 16px/1 var(--f-inter,system-ui,sans-serif);color:#f0e4ff;background:rgba(40,16,80,.85);border:1px solid rgba(206,150,255,.45);cursor:pointer}
.mm-close:hover{border-color:#e2b8ff}
.mm-bigcv{display:block;border-radius:10px;background:rgba(6,2,16,.55);box-shadow:inset 0 0 0 1px rgba(206,150,255,.15)}
.mm-leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:#d6c8ea}
.mm-leg span{display:inline-flex;align-items:center;gap:5px}
.mm-leg i{display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.6)}
.mm-leg kbd{font:600 11px/1 var(--f-inter,system-ui,sans-serif);padding:2px 5px;border-radius:4px;border:1px solid rgba(206,150,255,.4);background:rgba(20,8,44,.8);color:#f0e4ff}
@media (max-width:640px){.mm{width:${Math.round(SMALL * 0.72) + 16}px}.mm-disc{width:${Math.round(SMALL * 0.72)}px;height:${Math.round(SMALL * 0.72)}px}.mm-name{font-size:11px}.mm-xy{min-width:48px}}
@media (prefers-reduced-motion:reduce){.mm *,.mm-big,.mm-big *{transition:none!important;animation:none!important}}
`;
let cssRefs = 0;
function useCss(): () => void {
    if (cssRefs++ === 0 && !document.getElementById('mm-css')) { const s = document.createElement('style'); s.id = 'mm-css'; s.textContent = CSS; document.head.appendChild(s); }
    return () => { if (--cssRefs === 0) document.getElementById('mm-css')?.remove(); };
}

interface Label { x: number; y: number; text: string; kind: 'city' | 'zone' }
interface Proj { a: number; b: number; c: number; d: number }

export function createMinimap(host: HTMLElement, opts: MinimapOptions = {}): Minimap {
    const releaseCss = useCss();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const facCol = { ...FACTION_COL, ...opts.factionCol };
    const isRombo = (opts.proj ?? 'rombo') === 'rombo';
    /** Matriz de la proyección: X = a*gx + c*gy, Y = b*gx + d*gy (en múltiplos de "píxeles por celda"). */
    const P: Proj = isRombo ? { a: 1, b: 0.5, c: -1, d: 0.5 } : { a: Math.SQRT2, b: 0, c: 0, d: Math.SQRT2 };

    // ----- DOM -----
    const el = document.createElement('div'); el.className = 'mm'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Minimapa');
    el.innerHTML = `<div class="mm-name"></div><div class="mm-disc" title="Abrir el mapa (M)"><canvas></canvas></div>
        <div class="mm-foot"><button type="button" data-z="-1" aria-label="Alejar">−</button><span class="mm-xy" aria-live="off"></span><button type="button" data-z="1" aria-label="Acercar">+</button><button type="button" data-big aria-label="Abrir el mapa grande (M)" title="Mapa (M)">⤢</button></div>`;
    const big = document.createElement('div'); big.className = 'mm-big'; big.hidden = true; big.setAttribute('role', 'dialog'); big.setAttribute('aria-modal', 'true'); big.setAttribute('aria-label', 'Mapa');
    big.innerHTML = `<div class="mm-panel"><div class="mm-head"><h2></h2><span></span></div><button type="button" class="mm-close" aria-label="Cerrar el mapa">✕</button><canvas class="mm-bigcv"></canvas>
        <div class="mm-leg"><span><i style="background:#fff3c4"></i>Vos</span><span><i style="background:#5fdc6a"></i>Grupo</span><span><i style="background:${facCol.solmar}"></i>Solmar</span><span><i style="background:${facCol.vhar}"></i>Vhar</span><span><i style="background:#e8453a"></i>Mob</span><span><i style="background:#ffb02e;width:12px;height:12px"></i>Boss</span><span><i style="background:#e9dfc0;border-radius:2px"></i>NPC</span><span><i style="background:#b46cff;box-shadow:0 0 0 2px #6ff0ff inset"></i>Portal / escalera</span><span><i style="background:rgba(150,200,230,.6)"></i>Zona segura</span><span><kbd>M</kbd> / <kbd>Esc</kbd> cerrar</span></div></div>`;
    host.append(el, big);
    const cv = el.querySelector('canvas')!, g = cv.getContext('2d')!;
    const bcv = big.querySelector('canvas')!, bg = bcv.getContext('2d')!;
    const nameEl = el.querySelector('.mm-name')!, xyEl = el.querySelector('.mm-xy')!;
    const zBtns = [...el.querySelectorAll<HTMLButtonElement>('button[data-z]')];
    const terrain = document.createElement('canvas'); // se reutiliza en cada setMap

    let map: WorldMap | null = null;
    let labels: Label[] = [], mapPortals: MinimapPortal[] = [];
    let zoom = 1, last: MinimapState | null = null, lastT = 0, S = 4;
    try { const v = localStorage.getItem('fdn:mmzoom'), z = Number(v); if (v !== null && Number.isInteger(z) && z >= 0 && z < ZOOMS.length) zoom = z; } catch { /* sin almacenamiento */ }

    const sizeCanvas = (c: HTMLCanvasElement, w: number, h: number) => {
        const r = Math.min(2, window.devicePixelRatio || 1), W = Math.round(w * r), H = Math.round(h * r);
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        c.style.width = w + 'px'; c.style.height = h + 'px';
        return r;
    };
    const refreshZoomBtns = () => { zBtns[0].disabled = zoom <= 0; zBtns[1].disabled = zoom >= ZOOMS.length - 1; };
    refreshZoomBtns();

    // ----- dibujo -----
    /** Dibuja terreno + etiquetas + marcadores en `ctx` (de w x h px CSS), centrado en la celda (cx, cy) con k px por celda. */
    function draw(ctx: CanvasRenderingContext2D, dpr: number, w: number, h: number, cx: number, cy: number, k: number, bigMode: boolean) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!map) return;
        const ox = w / 2 - (P.a * cx + P.c * cy) * k, oy = h / 2 - (P.b * cx + P.d * cy) * k;
        const pt = (gx: number, gy: number) => ({ x: ox + (P.a * gx + P.c * gy) * k, y: oy + (P.b * gx + P.d * gy) * k });
        if (!bigMode) { ctx.fillStyle = '#0b0618'; ctx.fillRect(0, 0, w, h); }
        // terreno: una sola drawImage con la matriz de la proyección
        ctx.save();
        ctx.setTransform(dpr * P.a * k / S, dpr * P.b * k / S, dpr * P.c * k / S, dpr * P.d * k / S, dpr * ox, dpr * oy);
        ctx.imageSmoothingEnabled = k / S < 1.6;
        ctx.drawImage(terrain, 0, 0);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const st = last;
        /** Escala de los marcadores: el mapa grande en pantallas chicas los achica para que no tapen el terreno. */
        const ms = bigMode ? Math.max(0.6, Math.min(1.15, k / 5)) : 1;
        // zonas de mobs (solo en el mapa grande): halo rojo tenue
        if (bigMode) {
            for (const z of map.zones) {
                const p = pt(z.x + 0.5, z.y + 0.5);
                ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, isRombo ? 0.5 : 1);
                const r = Math.max(3, z.r * k * Math.SQRT2);
                const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgba(232,69,58,.26)'); gr.addColorStop(1, 'rgba(232,69,58,0)');
                ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            }
        }
        // portales y escaleras
        const portals = st?.portals ? [...mapPortals, ...st.portals] : mapPortals;
        for (const q of portals) drawPortal(ctx, pt(q.x + 0.5, q.y + 0.5), q.kind, bigMode ? ms : 0.8);
        // npcs
        for (const n of st?.npcs ?? []) drawNpc(ctx, pt(n.x + 0.5, n.y + 0.5), n.role, ms);
        // mobs
        for (const m of st?.mobs ?? []) {
            const p = pt(m.x, m.y), bs = !!m.boss;
            ctx.beginPath(); ctx.arc(p.x, p.y, (bs ? 4.2 : 2.2) * ms, 0, Math.PI * 2);
            ctx.fillStyle = bs ? '#ffb02e' : '#e8453a'; ctx.fill();
            ctx.lineWidth = bs ? 1.6 : 1; ctx.strokeStyle = bs ? '#5a1408' : 'rgba(30,4,4,.85)'; ctx.stroke();
            if (bs) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * ms, 0, Math.PI * 2); ctx.fillStyle = '#c0281c'; ctx.fill(); }
        }
        // otros jugadores (color de facción) y grupo
        for (const o of st?.others ?? []) dot(ctx, pt(o.x, o.y), 2.8 * ms, facCol[o.faction] ?? '#e9dfc0');
        for (const o of st?.party ?? []) dot(ctx, pt(o.x, o.y), 3.4 * ms, '#5fdc6a');
        // etiquetas del mapa grande
        if (bigMode) drawLabels(ctx, pt, portals, k, st ? pt(st.player.x, st.player.y) : null, w, h);
        // vínculos a otros mapas fuera del minimapa chico: una flechita en el borde
        if (!bigMode) {
            const R = w / 2 - 7;
            for (const q of mapPortals) {
                if (q.kind !== 'link') continue;
                const p = pt(q.x + 0.5, q.y + 0.5), dx = p.x - w / 2, dy = p.y - h / 2, dd = Math.hypot(dx, dy);
                if (dd <= R) continue;
                const a = Math.atan2(dy, dx);
                ctx.save(); ctx.translate(w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R); ctx.rotate(a);
                ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -4); ctx.lineTo(-3, 4); ctx.closePath();
                ctx.fillStyle = '#c99bff'; ctx.strokeStyle = '#1a0838'; ctx.lineWidth = 1.2; ctx.fill(); ctx.stroke(); ctx.restore();
            }
        }
        // jugador: flecha con su dirección (la del sprite, pasada a la grilla y proyectada)
        if (st) {
            const p = pt(st.player.x, st.player.y);
            const sa = Math.PI + st.player.dir * (Math.PI / 4), sx = Math.cos(sa), sy = Math.sin(sa);
            const gx = (sx + 2 * sy) / 2, gy = (2 * sy - sx) / 2; // pantalla -> grilla (iso 2:1)
            const a = Math.atan2(P.b * gx + P.d * gy, P.a * gx + P.c * gy);
            const s = bigMode ? 1.35 * ms : 1.15;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a); ctx.scale(s, s);
            ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, 5); ctx.closePath();
            ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
            ctx.fillStyle = '#fff3c4'; ctx.fill(); ctx.shadowBlur = 0; ctx.lineWidth = 1.3; ctx.strokeStyle = '#2a1a00'; ctx.stroke();
            ctx.restore();
        }
    }
    /**
     * Rótulos del mapa grande, por prioridad (ciudades, salidas a otros mapas, zonas, portales y escaleras): cada uno se prueba
     * en su lugar y un poco arriba/abajo; si pisa a otro ya puesto (o a la flecha del jugador) no se dibuja. Son pocas decenas.
     */
    function drawLabels(ctx: CanvasRenderingContext2D, pt: (x: number, y: number) => { x: number; y: number }, portals: MinimapPortal[], k: number, me: { x: number; y: number } | null, W: number, H: number) {
        const fz = Math.max(9.5, Math.min(12, k * 2.2)), fc = Math.max(11, Math.min(15, k * 2.8));
        const zoneNames = new Set(labels.filter((l) => l.kind === 'zone').map((l) => l.text));
        type C = { x: number; y: number; text: string; font: string; col: string; dy: number };
        const cands: C[] = [];
        for (const l of labels) if (l.kind === 'city') cands.push({ ...pt(l.x, l.y), text: l.text, font: `700 ${fc}px 'Cinzel', Georgia, serif`, col: '#ffe7a8', dy: 0 });
        for (const q of portals) if (q.kind === 'link' && q.label) cands.push({ ...pt(q.x + 0.5, q.y + 0.5), text: q.label, font: `700 ${fz}px 'Inter', system-ui, sans-serif`, col: '#e6c8ff', dy: -11 });
        for (const l of labels) if (l.kind === 'zone') cands.push({ ...pt(l.x, l.y), text: l.text, font: `600 ${fz}px 'Inter', system-ui, sans-serif`, col: '#ffc9c2', dy: 0 });
        for (const q of portals) if (q.kind !== 'link' && q.label && !zoneNames.has(q.label)) cands.push({ ...pt(q.x + 0.5, q.y + 0.5), text: q.label, font: `600 ${fz - 1}px 'Inter', system-ui, sans-serif`, col: q.kind === 'waypoint' ? '#9ff4ff' : '#d9bfff', dy: -10 });
        const boxes: { x0: number; y0: number; x1: number; y1: number }[] = me ? [{ x0: me.x - 7, y0: me.y - 7, x1: me.x + 7, y1: me.y + 7 }] : [];
        const hit = (b: (typeof boxes)[number]) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        for (const c of cands) {
            ctx.font = c.font;
            const w = ctx.measureText(c.text).width + 4, h = parseFloat(c.font.split(' ')[1]);
            const offs: [number, number][] = c.dy ? [[0, c.dy], [0, -c.dy], [w / 2 + 6, 0], [-w / 2 - 6, 0], [0, c.dy * 2], [0, -c.dy * 2], [w / 2 + 6, c.dy], [-w / 2 - 6, c.dy]] : [[0, 0], [0, -h], [0, h]];
            for (const [ox2, oy2] of offs) {
                const x = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, c.x + ox2)), y = c.y + oy2, b = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
                if (b.y0 < 0 || b.y1 > H || hit(b)) continue;
                boxes.push(b);
                ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,3,18,.92)'; ctx.strokeText(c.text, x, y);
                ctx.fillStyle = c.col; ctx.fillText(c.text, x, y);
                break;
            }
        }
    }
    function dot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, r: number, col: string) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
    }
    function drawNpc(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, role: string, s: number) {
        const col = SHOPS[role]?.col ?? '#e9dfc0';
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
        if (role === 'capitan') { // banderín dorado: el que da las misiones
            ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 2 : 4.6, a = (i * Math.PI) / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath();
            ctx.fillStyle = '#ffd24a';
        } else { ctx.beginPath(); ctx.rect(-2.6, -2.6, 5.2, 5.2); ctx.fillStyle = col; }
        ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(10,6,0,.9)'; ctx.stroke(); ctx.restore();
    }
    function drawPortal(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, kind: MinimapPortal['kind'], s: number) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s);
        const outer = kind === 'waypoint' ? '#6ff0ff' : '#b46cff', inner = kind === 'waypoint' ? '#1d5f78' : '#3a136e';
        ctx.beginPath(); ctx.ellipse(0, 0, kind === 'stairs' ? 3.4 : 4.6, kind === 'stairs' ? 3.4 : 4.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = inner; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = outer; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fillStyle = kind === 'waypoint' ? '#c8fbff' : '#6ff0ff'; ctx.fill();
        ctx.restore();
    }

    function drawSmall() {
        if (!map || !last) return;
        const w = (el.querySelector('.mm-disc') as HTMLElement).clientWidth || SMALL;
        const dpr = sizeCanvas(cv, w, w);
        draw(g, dpr, w, w, last.player.x, last.player.y, ZOOMS[zoom] * (w / SMALL), false);
        xyEl.textContent = `${Math.floor(last.player.x)}, ${Math.floor(last.player.y)}`;
    }
    function drawBig() {
        if (!map || big.hidden) return;
        const N = map.size, vw = window.innerWidth, vh = window.innerHeight;
        const W = Math.max(240, Math.min(vw - 56, 1100)), H = Math.max(200, Math.min(vh - 150, 760));
        // el rombo 2:1 mide 2N*k de ancho y N*k de alto
        const k = isRombo ? Math.min(W / (2 * N), H / N) * 0.96 : (Math.min(W, H) / (N * Math.SQRT2)) * 0.96;
        const w = Math.ceil(isRombo ? 2 * N * k / 0.96 : N * Math.SQRT2 * k / 0.96), h = Math.ceil(isRombo ? N * k / 0.96 : w);
        const dpr = sizeCanvas(bcv, w, h);
        draw(bg, dpr, w, h, N / 2, N / 2, k, true);
    }

    // ----- API -----
    function setMap(m: WorldMap, mt: MinimapMeta) {
        map = m;
        S = m.size > 128 ? 2 : m.size > 64 ? 3 : 4;
        paintTerrain(terrain, m, S);
        nameEl.textContent = mt.name;
        big.querySelector('h2')!.textContent = mt.name;
        const def = getMapDef(mt.id);
        big.querySelector('.mm-head span')!.textContent = def?.lvl ? `Nivel ${def.lvl[0]}–${def.lvl[1]}` : '';
        // etiquetas: ciudades y zonas (las zonas con varios campamentos se rotulan una vez, en el promedio)
        labels = (m.cities ?? []).map((c) => ({ x: (c.x0 + c.x1 + 1) / 2, y: (c.y0 + c.y1 + 1) / 2, text: c.name, kind: 'city' as const }));
        const byName = new Map<string, { x: number; y: number; n: number }>();
        for (const z of m.zones) { const e = byName.get(z.name) ?? { x: 0, y: 0, n: 0 }; e.x += z.x + 0.5; e.y += z.y + 0.5; e.n++; byName.set(z.name, e); }
        for (const [name, e] of byName) labels.push({ x: e.x / e.n, y: e.y / e.n, text: name.replace(/^.*?: /, ''), kind: 'zone' });
        // portales: vínculos a otros mapas (Fase 1), escaleras del mismo mapa y waypoints
        mapPortals = [
            ...mapLinks(mt.id).map((l) => ({ x: l.x, y: l.y, kind: 'link' as const, label: '→ ' + (getMapDef(l.to.map)?.name ?? l.to.map) })),
            ...(m.portals ?? []).map((p) => ({ x: p.x, y: p.y, kind: 'stairs' as const, label: p.key ? 'Escalera sellada' : p.train ? '' : 'Escalera' })),
            ...(m.waypoints ?? []).map((q) => ({ x: q.x, y: q.y, kind: 'waypoint' as const, label: q.kind === 'city' ? 'Portal de Frontera' : q.name })),
        ];
        last = last ? { ...last, others: [], mobs: [], party: [], npcs: [] } : null; // lo del mapa anterior no se dibuja
        lastT = 0;
        drawSmall(); drawBig();
    }
    function update(st: MinimapState) { last = st; lastT = performance.now(); drawSmall(); drawBig(); }
    function tick(get: () => MinimapState) { const t = performance.now(); if (t - lastT >= (reduce ? FPS_MS * 2 : FPS_MS)) update(get()); }
    function toggleBig(open = big.hidden) {
        if (open === !big.hidden) return;
        big.hidden = !open;
        if (open) { drawBig(); (big.querySelector('.mm-close') as HTMLButtonElement).focus({ preventScroll: true }); }
        else if (big.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    }
    function setZoom(dz: number) {
        zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom + dz)); refreshZoomBtns(); drawSmall();
        try { localStorage.setItem('fdn:mmzoom', String(zoom)); } catch { /* sin almacenamiento */ }
    }

    // ----- eventos -----
    const typing = (t: EventTarget | null) => { const a = (t instanceof HTMLElement ? t : null) ?? (document.activeElement as HTMLElement | null); return !!a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || a.isContentEditable); };
    const onKey = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || typing(document.activeElement)) return;
        if ((e.key === 'm' || e.key === 'M') && !e.repeat) { if (!map || (big.hidden && (opts.active?.() === false || el.offsetParent === null))) return; e.preventDefault(); toggleBig(); }
        else if (e.key === 'Escape' && !big.hidden) { e.preventDefault(); e.stopPropagation(); toggleBig(false); }
    };
    const onClick = (e: MouseEvent) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b?.dataset.z) setZoom(Number(b.dataset.z)); else if (b?.hasAttribute('data-big') || (e.target as HTMLElement).closest('.mm-disc')) toggleBig(true);
        if (b) b.blur(); // que el foco vuelva al juego y no se coma las teclas
    };
    const onBigClick = (e: MouseEvent) => { if (e.target === big || (e.target as HTMLElement).closest('.mm-close')) toggleBig(false); };
    const onResize = () => { drawSmall(); drawBig(); };
    // captura: el Escape del mapa grande no tiene que llegar al resto del juego (que soltaría el objetivo)
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    el.addEventListener('click', onClick);
    big.addEventListener('click', onBigClick);
    // que los clicks en el minimapa no muevan al personaje
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stop); big.addEventListener('pointerdown', stop);

    return {
        el, setMap, update, tick, toggleBig,
        get bigOpen() { return !big.hidden; },
        destroy() {
            window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize);
            el.remove(); big.remove(); terrain.width = terrain.height = 0; map = null; last = null; labels = []; mapPortals = []; releaseCss();
        },
    };
}
