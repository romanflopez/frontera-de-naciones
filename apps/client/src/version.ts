/**
 * Versión del cliente y puerta de actualización: consulta `GET /version` del server y, si este cliente es más viejo que el mínimo
 * que pide, tapa el juego con una pantalla de "actualizá" (sin esto, un cliente viejo contra un server nuevo se rompe a mitad de partida).
 * Con la app de escritorio, el botón instala la actualización que ya bajó Electron; en el navegador, recarga la página.
 */
import { hasNewer, mustUpdate } from '@fdn/world';
import { serverUrl } from './net.ts';

declare const __CLIENT_VERSION__: string | undefined;
/** Versión de este cliente (la del package.json al compilar); `dev` si corre sin compilar. */
export const CLIENT_VERSION: string = typeof __CLIENT_VERSION__ === 'string' ? __CLIENT_VERSION__ : 'dev';

/** Estado de la actualización que informa la app de escritorio (ver apps/desktop/src/updater.cjs). */
export interface UpdateState { state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number; error?: string }
/** Puente que expone el preload de Electron; no existe en el navegador. */
export interface DesktopBridge {
    version: string;
    onUpdate(cb: (s: UpdateState) => void): void;
    getUpdate(): Promise<UpdateState>;
    checkUpdates(): Promise<void>;
    installUpdate(): Promise<void>;
}
export const desktopBridge = (): DesktopBridge | null => (window as unknown as { erisDesktop?: DesktopBridge }).erisDesktop ?? null;

export interface ServerVersion { server: string; minClient: string; latestClient: string; downloadUrl: string }

/** Dirección HTTP del `/version` del server (mismo host que el WebSocket). */
export function versionUrl(): string {
    try { const u = new URL(serverUrl()); u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; u.pathname = '/version'; u.search = ''; return u.toString(); } catch { return ''; }
}

/** Pregunta la versión al server; null si no hay red o la respuesta no sirve (no se bloquea a nadie por no poder preguntar). */
export async function fetchServerVersion(fetchFn: typeof fetch = fetch): Promise<ServerVersion | null> {
    const url = versionUrl(); if (!url) return null;
    try {
        const r = await fetchFn(url, { cache: 'no-store' }); if (!r.ok) return null;
        const j = await r.json() as Partial<ServerVersion>;
        return { server: String(j.server ?? ''), minClient: String(j.minClient ?? ''), latestClient: String(j.latestClient ?? ''), downloadUrl: String(j.downloadUrl ?? '') };
    } catch { return null; }
}

let overlay: HTMLElement | null = null;
/** Pantalla que tapa el juego hasta actualizar. Se rearma sola con el progreso de la descarga (escritorio). */
function showRequired(v: ServerVersion): void {
    if (overlay) return;
    const el = document.createElement('div'); overlay = el;
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0d100efa;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#e9dfc0;text-align:center;padding:24px';
    el.innerHTML = '<div style="max-width:440px"><h2 style="margin:0 0 12px;font-size:22px">Hay una actualización obligatoria</h2><p id="updMsg" style="margin:0 0 18px;line-height:1.5"></p><button id="updBtn" style="font-size:16px;padding:10px 22px;border-radius:6px;border:1px solid #b9985a;background:#3a2f1c;color:#e9dfc0;cursor:pointer"></button><p id="updLink" style="margin:16px 0 0;font-size:13px;opacity:.8"></p></div>';
    document.body.appendChild(el);
    const msg = el.querySelector('#updMsg') as HTMLElement, btn = el.querySelector('#updBtn') as HTMLButtonElement, link = el.querySelector('#updLink') as HTMLElement;
    const bridge = desktopBridge();
    const manual = () => { if (v.downloadUrl) { link.innerHTML = ''; const a = document.createElement('a'); a.href = v.downloadUrl; a.target = '_blank'; a.rel = 'noopener'; a.style.color = '#e9dfc0'; a.textContent = 'Bajá el instalador nuevo desde acá'; link.append(a); } };
    if (!bridge) {
        msg.textContent = `El juego cambió y esta versión (${CLIENT_VERSION}) ya no es compatible. Recargá la página para jugar con la última.`;
        btn.textContent = 'Recargar'; btn.onclick = () => location.reload(); return;
    }
    const render = (s: UpdateState) => {
        if (s.state === 'ready') { msg.textContent = 'La actualización ya está lista. Se reinicia el juego para instalarla.'; btn.disabled = false; btn.textContent = 'Reiniciar y actualizar'; btn.onclick = () => { btn.disabled = true; void bridge.installUpdate(); }; }
        else if (s.state === 'downloading') { msg.textContent = `Descargando la actualización${s.version ? ` ${s.version}` : ''}… ${Math.round(s.percent ?? 0)} %`; btn.disabled = true; btn.textContent = 'Descargando…'; }
        else if (s.state === 'error') { msg.textContent = 'No pudimos descargar la actualización automática.'; btn.disabled = false; btn.textContent = 'Reintentar'; btn.onclick = () => { btn.disabled = true; void bridge.checkUpdates(); }; manual(); }
        else if (s.state === 'none') { msg.textContent = 'Todavía no hay una actualización publicada para tu sistema. Probá de nuevo en unos minutos.'; btn.disabled = false; btn.textContent = 'Buscar de nuevo'; btn.onclick = () => { btn.disabled = true; void bridge.checkUpdates(); }; manual(); }
        else { msg.textContent = 'Buscando la actualización…'; btn.disabled = true; btn.textContent = 'Buscando…'; manual(); }
    };
    let last: UpdateState = { state: 'idle' };
    const draw = (s: UpdateState) => { last = s; render(s); };
    bridge.onUpdate(draw); void bridge.getUpdate().then(draw); void bridge.checkUpdates(); manual();
    setInterval(() => { if (last.state === 'idle' || last.state === 'checking') draw({ state: 'none' }); }, 25_000); // la búsqueda nunca deja la pantalla esperando para siempre
}

export const isBlocked = (): boolean => overlay !== null;

/** Consulta una vez; si hay que actualizar, muestra la pantalla y devuelve true. */
export async function checkVersionNow(onNewer?: (latest: string) => void): Promise<boolean> {
    const v = await fetchServerVersion(); if (!v) return false;
    if (mustUpdate(CLIENT_VERSION, v.minClient)) { showRequired(v); return true; }
    if (onNewer && hasNewer(CLIENT_VERSION, v.latestClient)) onNewer(v.latestClient);
    return false;
}

/** Revisa al abrir y cada `everyMs`. `onNewer` avisa una sola vez de una versión nueva que no es obligatoria. */
export function watchClientVersion(onNewer: (latest: string) => void, everyMs = 300_000): void {
    let told = false;
    const tell = (l: string) => { if (!told) { told = true; onNewer(l); } };
    void checkVersionNow(tell);
    setInterval(() => { if (!overlay) void checkVersionNow(tell); }, everyMs);
    desktopBridge()?.onUpdate((s) => { if (s.state === 'ready' && !overlay) tell(s.version ?? ''); });
}
