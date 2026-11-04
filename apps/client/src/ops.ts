/**
 * Operación del cliente para abrir a gente de afuera: aviso de versión nueva y reporte de errores al server.
 */
import { serverUrl } from './net.ts';
import { CLIENT_VERSION } from './version.ts';

/** Archivo del bundle principal que cargó esta pestaña (`index-AbC123.js`), o '' en desarrollo (Vite no hashea). */
export function loadedBuild(doc: ParentNode = document): string {
    for (const s of Array.from(doc.querySelectorAll('script[src]'))) { const m = /\/assets\/(index-[\w-]+\.js)/.exec(s.getAttribute('src') ?? ''); if (m) return m[1]; }
    return '';
}
/** Bundle principal que referencia un index.html publicado. */
export function publishedBuild(html: string): string { return /\/assets\/(index-[\w-]+\.js)/.exec(html)?.[1] ?? ''; }

/** Cada `everyMs` mira el index.html publicado; si el bundle cambió respecto del cargado, llama a `onStale` una sola vez. */
export function watchForNewVersion(onStale: () => void, everyMs = 300_000): void {
    const mine = loadedBuild();
    if (!mine) return;
    let told = false;
    const check = async () => {
        if (told) return;
        try {
            const r = await fetch(`${location.origin}/index.html?v=${Date.now()}`, { cache: 'no-store' });
            const now = publishedBuild(await r.text());
            if (now && now !== mine) { told = true; onStale(); }
        } catch { /* sin red: se reintenta en el próximo ciclo */ }
    };
    setInterval(check, everyMs);
}

/** Dirección HTTP del server (mismo host que el WebSocket) para mandar reportes. */
export function reportUrl(): string {
    try { const u = new URL(serverUrl()); u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; u.pathname = '/report'; u.search = ''; return u.toString(); } catch { return ''; }
}

/** Manda al server los errores no atrapados del cliente (con tope por sesión y sin repetir el mismo). */
export function installErrorReporting(): void {
    const url = reportUrl(); if (!url) return;
    const sent = new Set<string>(); let count = 0;
    const ver = `${CLIENT_VERSION}${loadedBuild() ? `/${loadedBuild()}` : ''}${(window as unknown as { erisDesktop?: unknown }).erisDesktop ? ' desktop' : ' web'}`;
    const send = (msg: string, src: string, stack: string) => {
        const key = msg + src; if (sent.has(key) || count >= 5) return;
        sent.add(key); count++;
        try { void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg, src, stack, ver }), keepalive: true }).catch(() => {}); } catch { /* nada que hacer */ }
    };
    window.addEventListener('error', (e) => send(e.message || 'error', `${e.filename ?? ''}:${e.lineno ?? 0}:${e.colno ?? 0}`, e.error?.stack ?? ''));
    window.addEventListener('unhandledrejection', (e) => { const r = e.reason as { message?: string; stack?: string } | string | undefined; send(`promesa rechazada: ${typeof r === 'string' ? r : r?.message ?? ''}`, '', typeof r === 'object' ? r?.stack ?? '' : ''); });
}
