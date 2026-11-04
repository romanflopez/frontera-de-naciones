/**
 * Versión mínima del cliente. `GET /version` le dice al cliente (web o de escritorio) si tiene que actualizarse antes de jugar.
 * Se cambia en vivo con `/gm minclient <versión>` (sin redeploy) y queda en `version.json` dentro de la carpeta de datos.
 * Defaults por entorno: MIN_CLIENT, LATEST_CLIENT y DOWNLOAD_URL (a dónde mandar a bajar el instalador nuevo).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVersion } from '@fdn/world';

export interface VersionInfo { minClient: string; latestClient: string; downloadUrl: string }

export class VersionConfig {
    private info: VersionInfo;
    constructor(private readonly dir: string, env: NodeJS.ProcessEnv = process.env) {
        this.info = { minClient: valid(env.MIN_CLIENT), latestClient: valid(env.LATEST_CLIENT), downloadUrl: url(env.DOWNLOAD_URL) };
        try {
            const f = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')) as Partial<VersionInfo>; // el archivo (lo que cambió un GM) manda sobre el entorno
            if (f.minClient !== undefined) this.info.minClient = valid(f.minClient);
            if (f.latestClient !== undefined) this.info.latestClient = valid(f.latestClient);
            if (f.downloadUrl !== undefined) this.info.downloadUrl = url(f.downloadUrl);
        } catch { /* sin archivo o roto: valen los defaults */ }
    }
    get(): VersionInfo { return { ...this.info }; }
    /** Cambia `minClient` o `latestClient`. `off` (o vacío) lo borra. Devuelve un error de texto si el valor no sirve. */
    set(key: 'minClient' | 'latestClient', value: string): string | null {
        const v = value.trim();
        if (v !== '' && v.toLowerCase() !== 'off' && !parseVersion(v)) return 'La versión tiene que ser tipo 0.3.1 (o "off" para sacarla).';
        this.info[key] = v.toLowerCase() === 'off' ? '' : (parseVersion(v) ? v.replace(/^v/, '') : '');
        try { mkdirSync(this.dir, { recursive: true }); writeFileSync(join(this.dir, 'version.json'), JSON.stringify(this.info, null, 2)); }
        catch (e) { return `Quedó en vivo pero no se pudo guardar el archivo: ${(e as Error).message}`; }
        return null;
    }
    lines(): string[] {
        const i = this.info;
        return [`Versión mínima del cliente: ${i.minClient || 'ninguna'} · última publicada: ${i.latestClient || 'sin dato'}${i.downloadUrl ? ` · descarga: ${i.downloadUrl}` : ''}`];
    }
}
const valid = (v: unknown): string => { const s = String(v ?? '').trim(); return parseVersion(s) ? s.replace(/^v/, '') : ''; };
const url = (v: unknown): string => { const s = String(v ?? '').trim(); return /^https?:\/\//.test(s) ? s.slice(0, 300) : ''; };

/** GET /version → { server, minClient, latestClient, downloadUrl }. Devuelve true si la ruta era esa (y ya respondió). */
export function handleVersion(req: IncomingMessage, res: ServerResponse, cfg: VersionConfig, serverBuild: string): boolean {
    if ((req.url ?? '').split('?')[0] !== '/version') return false;
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'cache-control': 'no-store' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return true; }
    if (req.method !== 'GET') { res.writeHead(405, h); res.end(); return true; }
    res.writeHead(200, { ...h, 'content-type': 'application/json' });
    res.end(JSON.stringify({ server: serverBuild, ...cfg.get() }));
    return true;
}
