/**
 * Oferta del día de la tienda (docs/ITEMS.md y claude/modelo-de-items-y-stats.md §3.9): GLOBAL y determinística,
 * sale de la fecha UTC, así todos los mundos y todos los jugadores ven lo mismo sin estado compartido.
 * - 3 líneas "del montón": bases comunes con un descuento chico (revisar la tienda a diario tiene que valer la pena, no ser gratis).
 * - La ESTRELLA (no todos los días): un único real con la calidad y el roll YA tirados y visibles, a precio caro en oro.
 *   Es el sumidero de oro grande del juego y stock 1 de TODO el server: el primero que lo compra se lo lleva
 *   (el "¡salió una Dorada en la tienda!" del chat es parte del diseño). El vendido vive en memoria del server
 *   (pre-beta: un reinicio el mismo día lo puede reponer; si molesta, se persiste en el storage).
 * Se compra con EconBuyRequest en el MERCADER con stockIndex = DAILY_INDEX_BASE + índice.
 */
import { BASES, SHOP_BASES, UNIQUE_BASES, VALUE, rollExtras, uniqueIlvl, uniqueValue, type AttrId, type UniqueBase, EXTRAS_BY_QUALITY, UNIQUE_VARIATION } from '@fdn/world';

export const DAILY_INDEX_BASE = 1000;
/** Chance de que el día tenga estrella, y reparto de su calidad (Azul / Dorado). */
export const STAR_CHANCE = 0.35, STAR_GOLD_SHARE = 0.3;
/** Multiplicador del precio de la estrella sobre el valor de lista del único (el sumidero: caro a propósito). */
export const STAR_PRICE_MULT = { 2: 30, 3: 60 } as const;

export interface DailyOffer { base: string; quality: number; attrs: { id: AttrId; v: number }[]; price: number; star?: boolean }

/** PRNG determinístico (mulberry32): mismo día, misma oferta, en cualquier proceso. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Día UTC (clave de la rotación y del "vendido" de la estrella). */
export const dayKey = (now = Date.now()): number => Math.floor(now / 86_400_000);

const pick = <T>(a: readonly T[], r: () => number): T => a[Math.floor(r() * a.length)];

/** La estrella del día, si hoy hay (único + calidad + roll, todo determinístico). */
export function dailyStar(now = Date.now()): { u: UniqueBase; offer: DailyOffer } | null {
    const r = rng(dayKey(now) * 2654435761 + 7);
    if (r() >= STAR_CHANCE) return null;
    const pool = UNIQUE_BASES.filter((u) => !u.uniq.boss); // los de jefe no se venden: se farmean
    const u = pick(pool, r), quality = r() < STAR_GOLD_SHARE ? 3 : 2;
    const attrs = u.uniq.attrs.map(([id, v]) => ({ id, v: Math.max(1, Math.round(v * (1 + (r() * 2 - 1) * UNIQUE_VARIATION))) }));
    for (const [id, v] of rollExtras(u.slot, uniqueIlvl(u), quality, u.uniq.attrs.map(([id]) => id), r)) attrs.push({ id, v });
    const price = uniqueValue(u.uniq.tier, false) * STAR_PRICE_MULT[quality as 2 | 3];
    return { u, offer: { base: u.name, quality, attrs, price, star: true } };
}

/** Las líneas del día: hasta 3 comunes con descuento + la estrella (si hoy hay) al final. */
export function dailyOffers(now = Date.now()): DailyOffer[] {
    const r = rng(dayKey(now) * 1013904223 + 3), out: DailyOffer[] = [];
    const normals = [...BASES, ...SHOP_BASES].filter((b) => VALUE[b.name]);
    for (let i = 0; i < 3 && normals.length; i++) {
        const b = pick(normals, r), disc = 0.75 + r() * 0.15; // 10-25 % de descuento: mediocre pero no inútil
        out.push({ base: b.name, quality: 0, attrs: [], price: Math.max(1, Math.round((VALUE[b.name] ?? 10) * disc)) });
    }
    const star = dailyStar(now);
    if (star) out.push(star.offer);
    return out;
}

/** Cantidad de extras que la calidad de una oferta dice tener (para validar al comprar). */
export const offerExtras = (o: DailyOffer): number => EXTRAS_BY_QUALITY[Math.min(4, Math.max(0, o.quality))] ?? 0;
