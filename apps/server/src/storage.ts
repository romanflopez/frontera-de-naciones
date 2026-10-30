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

/**
 * Postgres (Neon, Supabase, Render...). Se cargan todas las cuentas al arrancar (son pocas) y se
 * escribe con upsert, con retraso. La interfaz sigue siendo síncrona para el resto del server.
 */
export class PgStorage implements Storage {
    private readonly cache = new Map<string, AccountRecord>();
    private readonly dirty = new Set<string>();
    private timer: NodeJS.Timeout | null = null;
    private pending: Promise<void> = Promise.resolve();

    private constructor(private readonly pool: import('pg').Pool, private readonly debounceMs = 1500) {}

    static async create(url: string): Promise<PgStorage> {
        const { default: pg } = await import('pg');
        // Neon/Supabase exigen TLS; DATABASE_SSL=off lo desactiva (Postgres local).
        const ssl = process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false };
        const pool = new pg.Pool({ connectionString: url, ssl, max: 4 });
        await pool.query('CREATE TABLE IF NOT EXISTS accounts (key text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())');
        const st = new PgStorage(pool);
        const { rows } = await pool.query('SELECT key, data FROM accounts');
        for (const r of rows) st.cache.set(r.key as string, r.data as AccountRecord);
        console.log(`[Storage] Postgres listo: ${rows.length} cuentas cargadas.`);
        return st;
    }

    get(key: string): AccountRecord | undefined { return this.cache.get(key); }

    put(key: string, rec: AccountRecord): void {
        this.cache.set(key, rec);
        this.dirty.add(key);
        if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.debounceMs); this.timer.unref(); }
    }

    flush(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        const keys = [...this.dirty]; this.dirty.clear();
        for (const key of keys) {
            const rec = this.cache.get(key); if (!rec) continue;
            const json = JSON.stringify(rec);
            this.pending = this.pending.then(() => this.pool.query(
                'INSERT INTO accounts (key, data) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated = now()', [key, json],
            ).then(() => undefined)).catch((err) => { console.error(`[Storage] No se pudo guardar ${key} en Postgres:`, (err as Error).message); this.dirty.add(key); });
        }
    }

    /** Espera a que terminen los guardados en curso (al cerrar el server). */
    async close(): Promise<void> { this.flush(); await this.pending; await this.pool.end(); }
}
