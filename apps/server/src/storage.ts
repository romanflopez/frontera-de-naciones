/**
 * Almacenamiento de cuentas. La interfaz es chica a propósito: hoy hay un adaptador de archivos
 * (un JSON por cuenta); para producción se puede enchufar uno de Postgres (DATABASE_URL) sin tocar el resto.
 * Ver docs/PERSISTENCIA.md.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Econ } from './economy.ts';
import type { PersistedPlayer } from './player.ts';

export interface AccountRecord {
    /** Nombre tal como lo escribió la primera vez (para mostrar). */
    name: string;
    salt: string;
    hash: string;
    created: number;
    lastLogin: number;
    /** Progreso del personaje, ya validado (JSON de CharSave). */
    character?: string;
    /** Estado económico autoritativo del personaje (oro, bolsa, equipo, nivel, misiones). Ver economy.ts. */
    econ?: Econ;
    /** Dónde quedó el personaje (mapa, celda, apariencia). Vive en la cuenta para sobrevivir a los redeploys (antes estaba en `chars/`, en disco). */
    pos?: PersistedPlayer;
}

export interface Storage {
    get(key: string): AccountRecord | undefined;
    /**
     * Guarda (con retraso y sin bloquear); `flush` fuerza el guardado pendiente.
     * Todo lo que quedó sucio hasta el `flush` se escribe como UN lote: en Postgres es una sola transacción
     * (o se guardan todos los registros o ninguno), así una acción que toca varias cuentas y la casa de subastas no queda a medias.
     */
    put(key: string, rec: AccountRecord): void;
    flush(): void;
}

/** Espera antes de reintentar un guardado que falló. */
const RETRY_MS = 5000;

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
        if (this.dirty.size === 0) return;
        // dos fases: primero se escriben todos los .tmp y recién si salieron todos se renombran; si falla uno no se pisa ningún archivo
        const staged: [string, string][] = [];
        try {
            for (const key of this.dirty) {
                const rec = this.cache.get(key); if (!rec) continue;
                const f = this.file(key), tmp = `${f}.tmp`;
                writeFileSync(tmp, JSON.stringify(rec)); staged.push([tmp, f]);
            }
            for (const [tmp, f] of staged) renameSync(tmp, f);
            this.dirty.clear();
        } catch (err) {
            console.error('[Storage] No se pudo guardar el lote, se reintenta:', (err as Error).message);
            for (const [tmp] of staged) { try { unlinkSync(tmp); } catch { /* ya no está */ } }
            this.timer = setTimeout(() => this.flush(), RETRY_MS); this.timer.unref();
        }
    }
}

/** Lo mínimo que PgStorage necesita de un `pg.Pool` (así se prueba sin base real). */
export interface PgPoolLike {
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<unknown>; release(err?: unknown): void }>;
    end(): Promise<void>;
}

/**
 * Postgres (Neon, Supabase, Render...). Se cargan todas las cuentas al arrancar (son pocas) y se
 * escribe con upsert, con retraso. La interfaz sigue siendo síncrona para el resto del server.
 * Cada `flush` escribe todo lo sucio en UNA transacción; si falla, se deshace entero y se reintenta.
 */
export class PgStorage implements Storage {
    private readonly cache = new Map<string, AccountRecord>();
    private readonly dirty = new Set<string>();
    private timer: NodeJS.Timeout | null = null;
    private pending: Promise<void> = Promise.resolve();

    private constructor(private readonly pool: PgPoolLike, private readonly debounceMs = 1500, private readonly retryMs = RETRY_MS) {}

    static async create(url: string): Promise<PgStorage> {
        const { default: pg } = await import('pg');
        // Neon/Supabase exigen TLS; DATABASE_SSL=off lo desactiva (Postgres local).
        const ssl = process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false };
        return PgStorage.fromPool(new pg.Pool({ connectionString: url, ssl, max: 4 }) as unknown as PgPoolLike);
    }

    /** Crea la tabla, carga las cuentas y devuelve el almacén. Separado de `create` para poder probarlo con un pool falso. */
    static async fromPool(pool: PgPoolLike, debounceMs = 1500, retryMs = RETRY_MS): Promise<PgStorage> {
        await pool.query('CREATE TABLE IF NOT EXISTS accounts (key text PRIMARY KEY, data jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())');
        const st = new PgStorage(pool, debounceMs, retryMs);
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
        if (this.dirty.size === 0) return;
        // se toma la foto de lo sucio AHORA (síncrono): una acción que tocó varios registros entra entera en el lote
        const batch = [...this.dirty].flatMap((key) => { const rec = this.cache.get(key); return rec ? [[key, JSON.stringify(rec)] as const] : []; });
        this.dirty.clear();
        this.pending = this.pending.then(() => this.writeBatch(batch)).catch((err) => {
            console.error(`[Storage] No se pudo guardar el lote de ${batch.length} cuentas en Postgres, se reintenta:`, (err as Error).message);
            for (const [key] of batch) this.dirty.add(key);
            if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.retryMs); this.timer.unref(); }
        });
    }

    /** Una transacción por lote: o quedan todos los registros o ninguno. */
    private async writeBatch(batch: readonly (readonly [string, string])[]): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const [key, json] of batch) {
                await client.query('INSERT INTO accounts (key, data) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated = now()', [key, json]);
            }
            await client.query('COMMIT');
            client.release();
        } catch (err) {
            try { await client.query('ROLLBACK'); client.release(); } catch (e) { client.release(e); } // si ni el ROLLBACK anduvo, se descarta la conexión
            throw err;
        }
    }

    /** Espera a que terminen los guardados en curso (al cerrar el server). */
    async close(): Promise<void> {
        this.flush(); await this.pending;
        // si el último lote falló y quedó para reintentar, un intento más antes de cerrar
        if (this.dirty.size > 0) { this.flush(); await this.pending; }
        if (this.dirty.size > 0) console.error(`[Storage] Se cierra con ${this.dirty.size} cuentas sin guardar.`);
        await this.pool.end();
    }
}
