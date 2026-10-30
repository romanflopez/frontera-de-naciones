/**
 * Casa de subastas: reglas compartidas entre cliente y server (duración, tasas, límites, nivel de un item).
 * El server valida TODO con estas constantes; el cliente solo las usa para mostrar cuánto vas a pagar/recibir.
 * Ver docs/SUBASTAS.md.
 */
import { BASE_BY_NAME, SHOPS } from './economy';

/** Duración de una publicación. */
export const AH_DURATION_MS = 48 * 60 * 60 * 1000;
/** Tasa de publicación (no se devuelve): max(1, 2 % del precio), redondeada hacia abajo. */
export const AH_FEE_PCT = 0.02;
/** Comisión de venta que se descuenta al vendedor: 5 % del precio, redondeada hacia abajo. */
export const AH_COMMISSION_PCT = 0.05;
/** Máximo de publicaciones activas por personaje (cuenta). */
export const AH_MAX_LISTINGS = 10;
export const AH_PRICE_MIN = 1;
export const AH_PRICE_MAX = 1_000_000;
/** Resultados por página en la búsqueda (el server pagina). */
export const AH_PAGE_SIZE = 20;
/** Con el buzón así de lleno no se puede publicar más (retirá primero). Las ventas y vencimientos siempre entran. */
export const AH_MAIL_SOFT_MAX = 40;
export type AhSort = 'price_asc' | 'price_desc' | 'time_asc' | 'time_desc';
export const AH_SORTS: AhSort[] = ['price_asc', 'price_desc', 'time_asc', 'time_desc'];

export const ahListingFee = (price: number): number => Math.max(1, Math.floor(price * AH_FEE_PCT));
export const ahCommission = (price: number): number => Math.floor(price * AH_COMMISSION_PCT);
/** Lo que recibe el vendedor cuando se vende (precio menos comisión). */
export const ahSellerNet = (price: number): number => price - ahCommission(price);

let lvlByBase: Map<string, number> | null = null;
/**
 * Nivel de un item para los filtros: el nivel con el que lo vende una tienda (el mismo "Nv" que muestra el vendedor).
 * Los items no tienen requisito de nivel propio; toda base del juego está en alguna tienda (si no, nivel 1).
 */
export function itemLevel(baseName: string): number {
    if (!lvlByBase) {
        lvlByBase = new Map();
        for (const sh of Object.values(SHOPS)) for (const st of sh.stock) if (st.base) lvlByBase.set(st.base, Math.min(lvlByBase.get(st.base) ?? 99, st.lvl));
    }
    return BASE_BY_NAME.has(baseName) ? lvlByBase.get(baseName) ?? 1 : 1;
}

/** Texto normalizado para buscar por nombre (sin mayúsculas ni tildes). */
export const ahNorm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
