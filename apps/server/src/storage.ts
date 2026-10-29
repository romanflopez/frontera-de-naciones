/**
 * Almacenamiento de cuentas. La interfaz es chica a propósito: hoy hay un adaptador de archivos
 * (un JSON por cuenta); para producción se puede enchufar uno de Postgres (DATABASE_URL) sin tocar el resto.
 * Ver docs/PERSISTENCIA.md.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AccountRecord {
    /** Nombre tal como lo escribió la primera vez (para mostrar). */
    name: string;
    salt: string;
    hash: string;
    created: number;
    lastLogin: number;
    /** Progreso del personaje, ya validado (JSON de CharSave). */
    character?: string;
}

export interface Storage {
    get(key: string): AccountRecord | undefined;
    /** Guarda (con retraso y sin bloquear); `flush` fuerza el guardado pendiente. */
    put(key: string, rec: AccountRecord): void;
    flush(): void;
}

/** Archivos JSON en `<dir>/accounts/<clave>.json`, con escritura atómica (tmp + rename) y debounce. */
export class FileStorage implements Storage {
    private readonly dir: string;
    private readonly cache = new Map<string, AccountRecord>();
    private readonly dirty = new Set<string>();
    private timer: NodeJS.Timeout | null = null;

    constructor(dataDir: string, private readonly debounceMs = 1500) {
        this.dir = join(dataDir, 'accounts');
        mkdirSync(this.dir, { recursive: true });
    }

    private file(key: string): string { return join(this.dir, `${key}.json`); }

    get(key: string): AccountRecord | undefined {
        const hit = this.cache.get(key);
        if (hit) return hit;
        const f = this.file(key);
        if (!existsSync(f)) return undefined;
        try {
            const rec = JSON.parse(readFileSync(f, 'utf8')) as AccountRecord;
            this.cache.set(key, rec);
            return rec;
        } catch { return undefined; }
    }

    put(key: string, rec: AccountRecord): void {
        this.cache.set(key, rec);
        this.dirty.add(key);
        if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.debounceMs); this.timer.unref(); }
    }

    flush(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        for (const key of this.dirty) {
            const rec = this.cache.get(key); if (!rec) continue;
            const f = this.file(key), tmp = `${f}.tmp`;
            try { writeFileSync(tmp, JSON.stringify(rec)); renameSync(tmp, f); }
            catch (err) { console.error(`[Storage] No se pudo guardar ${key}:`, (err as Error).message); }
        }
        this.dirty.clear();
    }
}
