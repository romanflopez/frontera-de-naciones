/**
 * Operación del server para abrir a gente de afuera: reinicio avisado con cuenta regresiva,
 * reporte de errores del cliente y registro público de cambios (`/novedades`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Registro de cambios que ve cualquiera con `/novedades`. Lo más nuevo primero; solo lo que ya está live. */
export const CHANGELOG: { date: string; items: string[] }[] = [
    { date: '4/11', items: [
        'Movimiento libre: el personaje responde al instante (clic mantenido, WASD o flechas) y se puede caderear y amagar.',
        'La Saeta ígnea y la Bola de fuego ahora son proyectiles: se pueden esquivar moviéndote. Si fallan, igual gastan maná.',
        'Jefe de mundo (Coloso de piedra), botín de jefe sin ninjas, quests que cuentan en party y encargo de dungeon que devuelve una llave.',
        'Las bendiciones del healer duran 15 min y le llegan a toda la party.',
        'Balance de PvE: los bichos pegan según el nivel, la vida y el maná se recuperan por porcentaje.',
    ] },
    { date: '3/11', items: [
        'Hasta 3 personajes por cuenta, Dar e Intercambiar entre jugadores, libro de hechizos (P) y chats de Nación y Comercio.',
        'Nuevo modelo de ítems: calidades, 8 slots, sets de 8 piezas, reforja y oferta del día.',
    ] },
];

/** Líneas de chat con las últimas `n` entradas del registro de cambios. */
export function changelogLines(n = 2): string[] {
    const out = ['Novedades (todo lo que ya está live):'];
    for (const e of CHANGELOG.slice(0, n)) { out.push(`— ${e.date}`); for (const i of e.items) out.push(`  · ${i}`); }
    return out;
}

/** Instantes (segundos antes del final) en los que se avisa por chat. */
export const RESTART_NOTICES = [300, 120, 60, 30, 10, 5, 4, 3, 2, 1];

/** Texto del aviso de reinicio con `secs` segundos por delante. */
export function restartNotice(secs: number): string {
    if (secs <= 0) return 'El servidor se reinicia ahora. Tu personaje queda guardado: volvé a entrar en un minuto.';
    const t = secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs} s`;
    return `Reinicio del servidor en ${t}. Buscá un lugar seguro: el progreso se guarda solo.`;
}

/** Cuenta regresiva de reinicio: avisa en los instantes de RESTART_NOTICES y al llegar a cero ejecuta `onZero`. */
export class RestartCountdown {
    private timer: NodeJS.Timeout | null = null;
    private endAt = 0;
    private lastNotified = Infinity;
    constructor(private readonly announce: (text: string) => void, private readonly onZero: () => void, private readonly now: () => number = Date.now) {}
    get active(): boolean { return this.timer !== null; }
    /** Segundos que faltan (0 si no hay cuenta regresiva). */
    get remaining(): number { return this.timer ? Math.max(0, Math.ceil((this.endAt - this.now()) / 1000)) : 0; }
    start(secs: number): void {
        this.cancel();
        this.endAt = this.now() + secs * 1000; this.lastNotified = Infinity;
        this.announce(restartNotice(secs)); this.lastNotified = secs;
        this.timer = setInterval(() => this.tick(), 250); this.timer.unref();
    }
    /** Avisa si cruzó un instante de aviso, y dispara el reinicio en cero. Público para testearlo sin esperar. */
    tick(): void {
        if (!this.timer) return;
        const left = this.remaining;
        if (left <= 0) { const z = this.onZero; this.cancel(); this.announce(restartNotice(0)); z(); return; }
        const due = RESTART_NOTICES.find((n) => n >= left && n < this.lastNotified);
        // el aviso que toca es el más cercano por debajo del último que se dio, sin repetir ni saltear
        if (due !== undefined && left <= due) { this.lastNotified = due; this.announce(restartNotice(due)); }
    }
    cancel(): boolean {
        const was = this.timer !== null;
        if (this.timer) clearInterval(this.timer); this.timer = null; this.lastNotified = Infinity;
        return was;
    }
}

const REPORT_MAX_BYTES = 4096;
const REPORT_PER_IP_PER_MIN = 10;
const REPORT_FILE_MAX = 1_000_000; // el log deja de crecer pasado ~1 MB
const hits = new Map<string, number[]>();
let reportBytes = 0;

/** Limita los reportes por IP (ventana de 1 min). */
export function reportAllowed(ip: string, t = Date.now()): boolean {
    const arr = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
    if (arr.length >= REPORT_PER_IP_PER_MIN) { hits.set(ip, arr); return false; }
    arr.push(t); hits.set(ip, arr); return true;
}
export const resetReportLimits = (): void => { hits.clear(); reportBytes = 0; };

/** Deja solo texto imprimible y corto: el reporte viene de un cliente no confiable. */
export function cleanReportField(v: unknown, max: number): string {
    return String(v ?? '').replace(/[^\x20-\x7E -￿]/g, ' ').slice(0, max);
}

/**
 * POST /report con {msg, src, stack, ver}: lo anota en la consola y en `client-errors.log` (dentro de `dir`).
 * Devuelve true si la ruta era de reportes (y ya respondió). Con CORS abierto porque el cliente puede estar en otro dominio.
 */
export function handleClientReport(req: IncomingMessage, res: ServerResponse, dir: string): boolean {
    if (!(req.url ?? '').startsWith('/report')) return false;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return true; }
    if (req.method !== 'POST') { res.writeHead(405, cors); res.end(); return true; }
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
    if (!reportAllowed(ip)) { res.writeHead(429, cors); res.end(); return true; }
    let body = '', over = false;
    req.on('data', (c: Buffer) => { if (over) return; body += c; if (body.length > REPORT_MAX_BYTES) { over = true; res.writeHead(413, cors); res.end(); req.destroy(); } });
    req.on('end', () => {
        if (over) return;
        try {
            const j = JSON.parse(body) as Record<string, unknown>;
            const line = `${new Date().toISOString()} ip=${cleanReportField(ip, 45)} ver=${cleanReportField(j.ver, 40)} ${cleanReportField(j.msg, 300)} @ ${cleanReportField(j.src, 200)} | ${cleanReportField(j.stack, 1200).replace(/\s+/g, ' ')}`;
            console.error(`[ClientError] ${line}`);
            if (reportBytes < REPORT_FILE_MAX) { try { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, 'client-errors.log'), line + '\n'); reportBytes += line.length + 1; } catch { /* sin disco: queda en la consola */ } }
            res.writeHead(204, cors); res.end();
        } catch { res.writeHead(400, cors); res.end(); }
    });
    return true;
}
