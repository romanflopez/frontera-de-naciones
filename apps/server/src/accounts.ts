/**
 * Cuentas (nombre + contraseña) y validación del progreso que manda el cliente.
 * Las contraseñas se guardan con scrypt + sal (nunca en claro). Intentos fallidos limitados por IP y por nombre.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AccountRecord, Storage } from './storage.ts';
import { TRAINING, trainingUnlocked } from '@fdn/world';

const NAME_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
const MAX_FAILS_PER_NAME = 5, MAX_FAILS_PER_IP = 25, WINDOW_MS = 10 * 60 * 1000;

/** Clave de archivo estable: nombre en minúsculas, normalizado, en hexadecimal. */
export const accountKey = (name: string): string => Buffer.from(name.normalize('NFC').toLowerCase(), 'utf8').toString('hex');

export type AuthResult =
    | { ok: true; key: string; created: boolean; account: AccountRecord }
    | { ok: false; error: string };

const fails = new Map<string, number[]>();
function recent(k: string, now: number): number[] { const a = (fails.get(k) ?? []).filter((t) => now - t < WINDOW_MS); fails.set(k, a); return a; }
const blocked = (k: string, max: number, now: number) => recent(k, now).length >= max;
const fail = (k: string, now: number) => { recent(k, now).push(now); };

const hashPassword = (password: string, salt: Buffer): Buffer => scryptSync(password.normalize('NFKC'), salt, 32);

export function authenticate(storage: Storage, rawName: string, password: string, ip: string): AuthResult {
    const now = Date.now(), name = rawName.trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(name)) return { ok: false, error: 'El nombre tiene que tener entre 2 y 16 letras, números, espacios, guiones o _.' };
    if (password.length < 4 || password.length > 64) return { ok: false, error: 'La contraseña tiene que tener entre 4 y 64 caracteres.' };
    const key = accountKey(name), nameKey = `n:${key}`, ipKey = `i:${ip}`;
    if (blocked(nameKey, MAX_FAILS_PER_NAME, now) || blocked(ipKey, MAX_FAILS_PER_IP, now)) return { ok: false, error: 'Demasiados intentos fallidos. Esperá unos minutos y probá de nuevo.' };

    const acc = storage.get(key);
    if (!acc) {
        const salt = randomBytes(16), rec: AccountRecord = { name, salt: salt.toString('hex'), hash: hashPassword(password, salt).toString('hex'), created: now, lastLogin: now };
        storage.put(key, rec);
        return { ok: true, key, created: true, account: rec };
    }
    const expected = Buffer.from(acc.hash, 'hex'), got = hashPassword(password, Buffer.from(acc.salt, 'hex'));
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
        fail(nameKey, now); fail(ipKey, now);
        return { ok: false, error: 'Contraseña incorrecta. Si el nombre ya es de otra persona, elegí otro.' };
    }
    acc.lastLogin = now; storage.put(key, acc);
    return { ok: true, key, created: false, account: acc };
}

// ---------- progreso del personaje ----------
const num = (v: unknown, lo: number, hi: number, def = lo): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : def);
const word = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max && /^[\p{L}\p{N}_\- ().']+$/u.test(v) ? v : null);
const KEYS = ['cripta', 'foso'] as const;
const CLASSES = ['guerrero', 'mago'];
const SLOTS = ['arma', 'armadura', 'cabeza', 'anillo'] as const;

interface SavedItem { n: string; r: number; a: { id: string; v: number }[] }
function cleanItem(v: unknown): SavedItem | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>, n = word(o.n, 40); if (!n) return null;
    const a = (Array.isArray(o.a) ? o.a : []).slice(0, 3).flatMap((x) => { const e = (x ?? {}) as Record<string, unknown>; const id = word(e.id, 10); return id ? [{ id, v: num(e.v, 0, 200) }] : []; });
    return { n, r: num(o.r, 0, 3), a };
}

/** Valida y reconstruye el JSON del cliente: nada de lo que llegue se guarda tal cual. Devuelve null si no sirve. */
export function sanitizeCharacter(raw: string): string | null {
    if (raw.length > 20000) return null;
    let o: Record<string, unknown>;
    try { o = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
    if (!o || typeof o !== 'object') return null;
    const faction = word(o.faction, 12), cls = typeof o.cls === 'string' && CLASSES.includes(o.cls) ? o.cls : null;
    if (!faction || !cls) return null;
    const q = (o.q ?? {}) as Record<string, unknown>, keys = (q.keys ?? {}) as Record<string, unknown>, shards = (q.shards ?? {}) as Record<string, unknown>;
    const pots = (o.pots ?? {}) as Record<string, unknown>, eq = (o.eq ?? {}) as Record<string, unknown>;
    const qi = num(q.i, 0, 50), lvl = num(o.lvl, 1, 60, 1);
    // portales de entrenamiento abiertos: solo se guardan los que la misión entregada o el nivel realmente justifican
    const asked = new Set(Array.isArray(o.u) ? o.u.filter((x): x is string => typeof x === 'string') : []);
    const u = TRAINING.filter((t) => asked.has(t.id) && trainingUnlocked(t.step, qi, lvl)).map((t) => t.id);
    const out = {
        v: 1, faction, cls,
        lvl, exp: num(o.exp, 0, 1e9), gold: num(o.gold, 0, 1e9),
        hp: num(o.hp, 1, 100000, 1), mp: num(o.mp, 0, 100000),
        bag: (Array.isArray(o.bag) ? o.bag : []).slice(0, 18).map(cleanItem).filter((x): x is SavedItem => !!x),
        eq: Object.fromEntries(SLOTS.map((s) => [s, cleanItem(eq[s])])),
        q: {
            i: qi, st: q.st === 'active' || q.st === 'ready' ? q.st : 'new', prog: num(q.prog, 0, 50),
            keys: Object.fromEntries(KEYS.map((k) => [k, num(keys[k], 0, 99)])), shards: Object.fromEntries(KEYS.map((k) => [k, num(shards[k], 0, 99)])),
        },
        pots: { hp: num(pots.hp, 0, 99), mp: num(pots.mp, 0, 99) },
        u,
    };
    return JSON.stringify(out);
}
