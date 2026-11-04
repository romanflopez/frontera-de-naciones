/**
 * Alertas y registro por Discord (webhook). Nunca rompe ni frena el juego: sin `DISCORD_WEBHOOK_URL` no hace nada,
 * los envíos van de a uno por una cola chica, y un fallo se descarta.
 *
 *  - `error`/`warn`/`info` → canal de alertas (`DISCORD_WEBHOOK_URL`).
 *  - `event` → canal de registro (`DISCORD_WEBHOOK_LOG`); sin esa variable se descarta (no ensucia el de alertas).
 *  - `ALERT_MENTION` (opcional, ej. `<@123>`): se agrega al texto de los `error` para que suene el celular.
 *
 * Anti-spam: el mismo aviso (nivel + título + mensaje) sale una vez cada 5 min y se cuenta cuántas veces se repitió;
 * hay un tope global por minuto y una cola acotada. No se manda nunca contraseñas, tokens ni chat: los textos se recortan.
 */

export type AlertLevel = 'error' | 'warn' | 'info' | 'event';
export type AlertFields = Record<string, string | number | boolean | undefined | null>;

export const DEDUPE_MS = 5 * 60_000;
export const MAX_PER_MINUTE = 20;
export const MAX_QUEUE = 50;
const COLORS: Record<AlertLevel, number> = { error: 0xe74c3c, warn: 0xf39c12, info: 0x3498db, event: 0x95a5a6 };
const ICONS: Record<AlertLevel, string> = { error: '🔴', warn: '🟠', info: '🔵', event: '⚪' };

/** Recorta y deja solo texto imprimible: lo que llega de un cliente no es confiable y Discord limita los largos. */
export function clip(v: unknown, max: number): string {
    return String(v ?? '').replace(/[^\x20-\x7E -￿\n]/g, ' ').slice(0, max);
}

/** Versión del server para los avisos: el commit que deja Render (u otro proveedor) o `dev`. */
export function buildInfo(env: NodeJS.ProcessEnv = process.env): string {
    const c = env.RENDER_GIT_COMMIT ?? env.GIT_COMMIT ?? env.SOURCE_COMMIT ?? '';
    return c ? c.slice(0, 7) : 'dev';
}

export interface AlerterOptions {
    url?: string;
    logUrl?: string;
    mention?: string;
    fetchFn?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
    now?: () => number;
}

interface Seen { at: number; repeats: number }

export class Alerter {
    url: string; logUrl: string; mention: string;
    private readonly fetchFn: NonNullable<AlerterOptions['fetchFn']>;
    private readonly now: () => number;
    private readonly seen = new Map<string, Seen>();
    private sentAt: number[] = [];
    private dropped = 0;
    private queue: { url: string; body: string }[] = [];
    private sending = false;
    /** Cuántas alertas de cada nivel se dispararon (cuentan aunque no haya webhook): sirve para el resumen y para /health. */
    readonly counts: Record<AlertLevel, number> = { error: 0, warn: 0, info: 0, event: 0 };
    /** Contadores del resumen diario. */
    readonly daily = new Map<string, number>();

    constructor(o: AlerterOptions = {}) {
        this.url = o.url ?? ''; this.logUrl = o.logUrl ?? ''; this.mention = o.mention ?? '';
        this.fetchFn = o.fetchFn ?? ((u, init) => fetch(u, init));
        this.now = o.now ?? Date.now;
    }

    get enabled(): boolean { return this.url !== '' || this.logUrl !== ''; }
    /** Mensajes en cola o enviándose. */
    get pending(): number { return this.queue.length + (this.sending ? 1 : 0); }

    /** Suma uno (o `n`) a un contador del resumen diario; con `peak`, guarda el máximo. */
    count(name: string, n = 1): void { this.daily.set(name, (this.daily.get(name) ?? 0) + n); }
    peak(name: string, v: number): void { if (v > (this.daily.get(name) ?? 0)) this.daily.set(name, v); }
    /** Devuelve los contadores del día y los reinicia. */
    takeDaily(): Record<string, number> { const o = Object.fromEntries(this.daily); this.daily.clear(); return o; }

    send(level: AlertLevel, title: string, fields: AlertFields = {}): void {
        try { this.sendUnsafe(level, title, fields); } catch { /* una alerta jamás tira el juego */ }
    }

    private sendUnsafe(level: AlertLevel, title: string, fields: AlertFields): void {
        this.counts[level]++;
        const url = level === 'event' ? this.logUrl : this.url;
        if (!url) return;
        const t = this.now();
        const key = `${level}|${clip(title, 120)}|${clip(fields.msg ?? fields.mensaje ?? '', 120)}`;
        const prev = this.seen.get(key);
        if (prev && t - prev.at < DEDUPE_MS) { prev.repeats++; return; }
        const repeats = prev?.repeats ?? 0;
        this.seen.set(key, { at: t, repeats: 0 });
        if (this.seen.size > 500) { for (const [k, v] of this.seen) if (t - v.at >= DEDUPE_MS) this.seen.delete(k); }
        this.sentAt = this.sentAt.filter((x) => t - x < 60_000);
        if (this.sentAt.length >= MAX_PER_MINUTE) { this.dropped++; return; }
        this.sentAt.push(t);
        const f: { name: string; value: string; inline: boolean }[] = [];
        if (repeats > 0) f.push({ name: 'Repetido', value: `×${repeats} desde el último aviso`, inline: true });
        if (this.dropped > 0) { f.push({ name: 'Descartadas', value: `${this.dropped} alertas por exceso`, inline: true }); this.dropped = 0; }
        for (const [k, v] of Object.entries(fields)) { if (v === undefined || v === null || f.length >= 8) continue; f.push({ name: clip(k, 40), value: clip(v, 900) || '-', inline: String(v).length < 40 }); }
        const payload = {
            content: level === 'error' && this.mention ? clip(this.mention, 100) : undefined,
            embeds: [{ title: `${ICONS[level]} ${clip(title, 200)}`, color: COLORS[level], fields: f, footer: { text: `server ${buildInfo()}` }, timestamp: new Date(t).toISOString() }],
        };
        if (this.queue.length >= MAX_QUEUE) { this.dropped++; return; }
        this.queue.push({ url, body: JSON.stringify(payload) });
        void this.drain();
    }

    private async drain(): Promise<void> {
        if (this.sending) return;
        this.sending = true;
        try {
            for (let m = this.queue.shift(); m; m = this.queue.shift()) {
                try {
                    const r = await this.fetchFn(m.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: m.body });
                    if (r.status === 429) await new Promise((res) => setTimeout(res, 1500)); // Discord pide esperar: se descarta este y se sigue
                    else if (!r.ok) console.warn(`[Alertas] Discord respondió ${r.status}`);
                } catch (e) { console.warn('[Alertas] No se pudo enviar a Discord:', (e as Error).message); }
            }
        } finally { this.sending = false; }
    }

    /** Espera a que se vacíe la cola (para el cierre del server), con tope de tiempo. */
    async flush(maxMs = 2000): Promise<void> {
        const end = Date.now() + maxMs;
        while (this.pending > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    }
}

/** Alerter del proceso, configurado por entorno. */
export const alerts = new Alerter({ url: process.env.DISCORD_WEBHOOK_URL, logUrl: process.env.DISCORD_WEBHOOK_LOG, mention: process.env.ALERT_MENTION });
export const alert = (level: AlertLevel, title: string, fields?: AlertFields): void => alerts.send(level, title, fields);
