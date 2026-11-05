/**
 * Cuentas (nombre + contraseña) y validación del progreso que manda el cliente.
 * Las contraseñas se guardan con scrypt + sal (nunca en claro). Intentos fallidos limitados por IP y por nombre.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { passwordChangedMail, resetMail, type Mailer } from './mail.ts';
import type { AccountRecord, Storage } from './storage.ts';
import type { Econ } from './economy.ts';
import { CREATABLE_CLASS_IDS, TRAINING, canonicalClass, trainingUnlocked } from '@fdn/world';

const NAME_RE = /^[\p{L}\p{N}_\- ]{2,16}$/u;
const MAX_FAILS_PER_NAME = 5, MAX_FAILS_PER_IP = 25, WINDOW_MS = 10 * 60 * 1000;

/** Clave de archivo estable: nombre en minúsculas, normalizado, en hexadecimal. */
export const accountKey = (name: string): string => Buffer.from(name.normalize('NFC').toLowerCase(), 'utf8').toString('hex');

// ---------- email y recuperación de contraseña (D.17) ----------
/** Contraseña de una cuenta NUEVA o cambiada: 8 a 64. Las cuentas viejas (4 a 64) siguen entrando con la suya hasta que la cambien. */
export const PASSWORD_MIN = 8, PASSWORD_MAX = 64, LEGACY_PASSWORD_MIN = 4;
export const PASSWORD_ERROR = `La contraseña tiene que tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`;
/** El código de recuperación vale 30 minutos, una sola vez, y se invalida a los 5 intentos fallidos. */
export const RESET_TTL_MS = 30 * 60 * 1000, RESET_MAX_TRIES = 5;
const HOUR_MS = 3600_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const normalizeEmail = (raw: string): string => String(raw ?? '').trim().toLowerCase();
export const validEmail = (email: string): boolean => email.length <= 254 && EMAIL_RE.test(email);
/** Registro-índice de un email (`e_<hex>`): no choca con las cuentas (solo hex) ni con los personajes (`c_`). */
export const emailKey = (email: string): string => `e_${Buffer.from(email, 'utf8').toString('hex')}`;
/** Cuenta dueña de un email (verifica que el índice no esté viejo). */
export function emailOwner(storage: Storage, email: string): string | undefined {
    const owner = storage.get(emailKey(email))?.emailOf;
    return owner && storage.get(owner)?.email === email ? owner : undefined;
}
function claimEmail(storage: Storage, accKey: string, email: string, now: number): void {
    storage.put(emailKey(email), { name: email, salt: '', hash: '', created: now, lastLogin: now, emailOf: accKey });
}

const hits = new Map<string, number[]>();
/** Límite por ventana (en memoria): true si ya se pasó. Cuenta el intento. */
function limited(k: string, max: number, windowMs: number, now: number): boolean {
    const a = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
    if (a.length >= max) { hits.set(k, a); return true; }
    a.push(now); hits.set(k, a); return false;
}
const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

/** Carga el email de una cuenta que no lo tenía (cuentas viejas). Una vez cargado no se cambia desde acá. */
export function setEmail(storage: Storage, accKey: string, rawEmail: string, now = Date.now()): { ok: true } | { ok: false; error: string } {
    const acc = storage.get(accKey); if (!acc) return { ok: false, error: 'La cuenta no existe.' };
    if (acc.email) return { ok: false, error: 'Tu cuenta ya tiene un email cargado.' };
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email)) return { ok: false, error: 'Escribí un email válido (por ejemplo nombre@correo.com).' };
    const owner = emailOwner(storage, email);
    if (owner && owner !== accKey) return { ok: false, error: 'Ese email ya está en uso por otra cuenta.' };
    acc.email = email; storage.put(accKey, acc); claimEmail(storage, accKey, email, now); storage.flush();
    return { ok: true };
}

export const RESET_GENERIC = `Si hay una cuenta con esos datos, te mandamos un mail con el código para elegir una contraseña nueva. Vale ${RESET_TTL_MS / 60000} minutos.`;
export const RESET_BAD = 'El código no es válido o ya venció. Pedí uno nuevo.';
/**
 * Pide la recuperación (ANTES de entrar). `identifier` = nombre de cuenta o email. Responde siempre lo mismo exista o no la cuenta (no se puede averiguar
 * qué cuentas o emails existen) y limita los pedidos por IP (10/hora) y por cuenta (3/hora). El código viaja solo por mail; en el server queda su hash.
 */
export async function requestPasswordReset(storage: Storage, mailer: Mailer, identifier: string, ip: string, now = Date.now()): Promise<{ ok: boolean; text: string }> {
    if (limited(`ri:${ip}`, 10, HOUR_MS, now)) return { ok: false, text: 'Hiciste demasiados pedidos. Probá de nuevo en un rato.' };
    const id = String(identifier ?? '').trim().slice(0, 254);
    const key = id.includes('@') ? emailOwner(storage, normalizeEmail(id)) : NAME_RE.test(normalizeName(id)) ? accountKey(normalizeName(id)) : undefined;
    const acc = key ? storage.get(key) : undefined;
    if (!key || !acc || !acc.email || acc.owner) return { ok: true, text: RESET_GENERIC };
    if (limited(`ra:${key}`, 3, HOUR_MS, now)) return { ok: true, text: RESET_GENERIC };
    const secret = randomBytes(24).toString('hex');
    acc.reset = { h: sha256(secret).toString('hex'), exp: now + RESET_TTL_MS, tries: 0 };
    storage.put(key, acc); storage.flush();
    try { await mailer.send(resetMail(acc.email, acc.name, `${key}.${secret}`, RESET_TTL_MS / 60000)); }
    catch (e) { console.error(`[Cuentas] no se pudo mandar el mail de recuperación (${(e as Error).message})`); }
    return { ok: true, text: RESET_GENERIC };
}
/** Elige la contraseña nueva con el código del mail (ANTES de entrar). El código se usa una sola vez; se invalida al vencer o a los 5 intentos fallidos. */
export async function resetPassword(storage: Storage, mailer: Mailer, rawToken: string, password: string, ip: string, now = Date.now()): Promise<{ ok: boolean; text: string }> {
    if (limited(`rt:${ip}`, 20, HOUR_MS, now)) return { ok: false, text: 'Hiciste demasiados intentos. Probá de nuevo en un rato.' };
    const token = String(rawToken ?? '').trim(), dot = token.indexOf('.');
    const key = dot > 0 ? token.slice(0, dot) : '', secret = dot > 0 ? token.slice(dot + 1) : '';
    if (!/^[0-9a-f]{4,160}$/.test(key) || !/^[0-9a-f]{48}$/.test(secret)) return { ok: false, text: RESET_BAD };
    const acc = storage.get(key), r = acc?.reset;
    if (!acc || !r || acc.owner) return { ok: false, text: RESET_BAD };
    if (now > r.exp || r.tries >= RESET_MAX_TRIES) { delete acc.reset; storage.put(key, acc); return { ok: false, text: RESET_BAD }; }
    const want = Buffer.from(r.h, 'hex'), got = sha256(secret);
    if (want.length !== got.length || !timingSafeEqual(want, got)) { r.tries++; storage.put(key, acc); return { ok: false, text: RESET_BAD }; }
    const pw = String(password ?? '');
    if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) return { ok: false, text: PASSWORD_ERROR }; // el código sigue valiendo: se corrige y se manda de nuevo
    const salt = randomBytes(16);
    acc.salt = salt.toString('hex'); acc.hash = hashPassword(pw, salt).toString('hex'); delete acc.reset;
    storage.put(key, acc); storage.flush();
    fails.delete(`n:${key}`); // los intentos fallidos de antes ya no cuentan
    if (acc.email) mailer.send(passwordChangedMail(acc.email, acc.name)).catch((e) => console.error(`[Cuentas] no se pudo avisar del cambio de contraseña (${(e as Error).message})`));
    return { ok: true, text: 'Listo: ya podés entrar con tu contraseña nueva.' };
}

export type AuthResult =
    | { ok: true; key: string; created: boolean; account: AccountRecord }
    | { ok: false; error: string };

const fails = new Map<string, number[]>();
function recent(k: string, now: number): number[] { const a = (fails.get(k) ?? []).filter((t) => now - t < WINDOW_MS); fails.set(k, a); return a; }
const blocked = (k: string, max: number, now: number) => recent(k, now).length >= max;
const fail = (k: string, now: number) => { recent(k, now).push(now); };

const hashPassword = (password: string, salt: Buffer): Buffer => scryptSync(password.normalize('NFKC'), salt, 32);

export function authenticate(storage: Storage, rawName: string, password: string, ip: string, rawEmail = ''): AuthResult {
    const now = Date.now(), name = rawName.trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(name)) return { ok: false, error: 'El nombre tiene que tener entre 2 y 16 letras, números, espacios, guiones o _.' };
    if (password.length < LEGACY_PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, error: 'Contraseña o cuenta incorrectas.' };
    const key = accountKey(name), nameKey = `n:${key}`, ipKey = `i:${ip}`;
    if (blocked(nameKey, MAX_FAILS_PER_NAME, now) || blocked(ipKey, MAX_FAILS_PER_IP, now)) return { ok: false, error: 'Demasiados intentos fallidos. Esperá unos minutos y probá de nuevo.' };

    const acc = storage.get(key);
    if (!acc) {
        // D.17: crear una cuenta pide email (obligatorio y único) y contraseña de 8 o más. Sin email no se crea nada: es un login a una cuenta que no existe.
        if (!rawEmail.trim()) return { ok: false, error: 'Esa cuenta no existe. Para crearla tocá «Crear cuenta» y poné un email.' };
        const email = normalizeEmail(rawEmail);
        if (!validEmail(email)) return { ok: false, error: 'Escribí un email válido (por ejemplo nombre@correo.com).' };
        if (password.length < PASSWORD_MIN) return { ok: false, error: PASSWORD_ERROR };
        if (emailOwner(storage, email)) return { ok: false, error: 'Ese email ya tiene una cuenta. Si es tuya, recuperá la contraseña.' };
        const salt = randomBytes(16), rec: AccountRecord = { name, salt: salt.toString('hex'), hash: hashPassword(password, salt).toString('hex'), created: now, lastLogin: now, email };
        storage.put(key, rec); claimEmail(storage, key, email, now); storage.flush();
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

// ---------- personajes de la cuenta ----------
// Una cuenta (usuario + contraseña) tiene hasta MAX_CHARS personajes. Cada personaje es un registro propio (`c_<hex del nombre>`)
// con su economía y su posición; el depósito sigue siendo de la cuenta (ver deposit.ts). Los nombres de personaje son únicos en todo el server.
// Las cuentas viejas tienen su único personaje dentro del propio registro de la cuenta: se migra en el primer login (clave del personaje = clave de la cuenta).
export const MAX_CHARS = 3;
/** Clave del registro de un personaje nuevo. El prefijo `c_` no puede chocar con las claves de cuenta (hexadecimales). */
export const charKey = (name: string): string => `c_${accountKey(name)}`;
export const normalizeName = (raw: string): string => raw.trim().replace(/\s+/g, ' ');
export const NAME_ERROR = 'El nombre tiene que tener entre 2 y 16 letras, números, espacios, guiones o _.';

const hasLegacyChar = (r: AccountRecord): boolean => !r.charDeleted && !r.owner && !!(r.econ || r.character);

/** Claves de los personajes vivos de la cuenta, en orden. Migra la cuenta vieja la primera vez. */
export function charKeysOf(storage: Storage, accKey: string): string[] {
    const acc = storage.get(accKey); if (!acc) return [];
    if (!acc.chars) { acc.chars = hasLegacyChar(acc) ? [accKey] : []; storage.put(accKey, acc); }
    return acc.chars.filter((k) => { const r = storage.get(k); return !!r && !r.charDeleted; });
}
/** ¿Ya existe un personaje vivo con ese nombre (en cualquier cuenta)? Sin distinguir mayúsculas. */
export function charNameTaken(storage: Storage, name: string): boolean {
    const c = storage.get(charKey(name));
    if (c && !c.charDeleted) return true;
    const legacy = storage.get(accountKey(name));
    return !!legacy && hasLegacyChar(legacy);
}
/** ¿El personaje (por clave) es de esa cuenta? */
export const ownsChar = (storage: Storage, accKey: string, key: string): boolean => charKeysOf(storage, accKey).includes(key);
/** Busca entre los personajes de la cuenta por nombre (sin distinguir mayúsculas). */
export function findChar(storage: Storage, accKey: string, rawName: string): { key: string; rec: AccountRecord } | undefined {
    const n = normalizeName(rawName).normalize('NFC').toLowerCase();
    for (const key of charKeysOf(storage, accKey)) { const rec = storage.get(key); if (rec && rec.name.normalize('NFC').toLowerCase() === n) return { key, rec }; }
    return undefined;
}

export type CharResult = { ok: true; key: string; name: string } | { ok: false; error: string };

/** Crea un personaje (con su economía ya armada) en la cuenta. Valida nombre, tope y unicidad. */
export function createCharacter(storage: Storage, accKey: string, rawName: string, econ: Econ, now = Date.now()): CharResult {
    const name = normalizeName(rawName);
    if (!NAME_RE.test(name)) return { ok: false, error: NAME_ERROR };
    const acc = storage.get(accKey); if (!acc) return { ok: false, error: 'La cuenta no existe.' };
    if (charKeysOf(storage, accKey).length >= MAX_CHARS) return { ok: false, error: `Ya tenés ${MAX_CHARS} personajes: borrá uno para crear otro.` };
    if (charNameTaken(storage, name)) return { ok: false, error: 'Ese nombre ya está en uso. Elegí otro.' };
    const key = charKey(name);
    storage.put(key, { name, salt: '', hash: '', created: now, lastLogin: now, owner: accKey, econ });
    acc.chars = [...(acc.chars ?? []), key]; storage.put(accKey, acc);
    storage.flush();
    return { ok: true, key, name };
}

/**
 * Borra un personaje de la cuenta (borrado lógico: el nombre queda libre, el dato no se destruye). El depósito no se toca: es de la cuenta.
 * El que llama tiene que haber verificado antes que no está conectado y que no tiene nada en la casa de subastas.
 */
export function deleteCharacter(storage: Storage, accKey: string, rawName: string, now = Date.now()): CharResult {
    const f = findChar(storage, accKey, rawName); if (!f) return { ok: false, error: 'Ese personaje no existe.' };
    const acc = storage.get(accKey)!;
    f.rec.charDeleted = now; storage.put(f.key, f.rec);
    acc.chars = (acc.chars ?? []).filter((k) => k !== f.key); storage.put(accKey, acc);
    storage.flush();
    return { ok: true, key: f.key, name: f.rec.name };
}

// ---------- progreso del personaje ----------
const num = (v: unknown, lo: number, hi: number, def = lo): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : def);
const word = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max && /^[\p{L}\p{N}_\- ().']+$/u.test(v) ? v : null);
const KEYS = ['cripta', 'foso'] as const;
const SLOTS = ['arma', 'armadura', 'cabeza', 'guantes', 'botas', 'amuleto', 'anillo', 'anillo2'] as const;

interface SavedItem { n: string; r: number; a: { id: string; v: number }[] }
function cleanItem(v: unknown): SavedItem | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>, n = word(o.n, 40); if (!n) return null;
    const a = (Array.isArray(o.a) ? o.a : []).slice(0, 5).flatMap((x) => { const e = (x ?? {}) as Record<string, unknown>; const id = word(e.id, 10); return id ? [{ id, v: num(e.v, 0, 200) }] : []; });
    return { n, r: num(o.r, 0, 4), a };
}

/** Valida y reconstruye el JSON del cliente: nada de lo que llegue se guarda tal cual. Devuelve null si no sirve. */
export function sanitizeCharacter(raw: string): string | null {
    if (raw.length > 20000) return null;
    let o: Record<string, unknown>;
    try { o = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
    if (!o || typeof o !== 'object') return null;
    const faction = word(o.faction, 12), cls = typeof o.cls === 'string' && (CREATABLE_CLASS_IDS as readonly string[]).includes(canonicalClass(o.cls)) ? canonicalClass(o.cls) : null;
    if (!faction || !cls) return null;
    const q = (o.q ?? {}) as Record<string, unknown>, keys = (q.keys ?? {}) as Record<string, unknown>, shards = (q.shards ?? {}) as Record<string, unknown>;
    const pots = (o.pots ?? {}) as Record<string, unknown>, eq = (o.eq ?? {}) as Record<string, unknown>;
    const qi = num(q.i, 0, 50), lvl = num(o.lvl, 1, 60, 1);
    // portales de entrenamiento abiertos: solo se guardan los que la misión entregada o el nivel realmente justifican
    const asked = new Set(Array.isArray(o.u) ? o.u.filter((x): x is string => typeof x === 'string') : []);
    const u = TRAINING.filter((t) => asked.has(t.id) && trainingUnlocked(t.step, qi, lvl)).map((t) => t.id);
    const out = {
        v: 1, faction, cls,
        lvl, exp: num(o.exp, 0, 1e9), gold: num(o.gold, 0, Number.MAX_SAFE_INTEGER),
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
