/**
 * EK y contribución (D.10, DISEÑO.md §5b). EK = contador permanente de kills a jugadores de la otra nación (por personaje).
 * Contribución = lo que cada kill válido suma a tu nación; se gasta en la tienda de contribución (visual y consumibles; nunca poder).
 * Un kill es válido si: pasa en zona roja, no es en arena, y (en mapas de 81 en adelante cuenta todo kill; antes, la víctima no puede estar
 * más de `EK_LEVEL_GAP` niveles por debajo) y no es el mismo jugador más de una vez cada `EK_COOLDOWN_MS`.
 */
/** El mismo jugador cuenta una vez cada 4 horas. */
export const EK_COOLDOWN_MS = 4 * 3600_000;
/** Antes del 81, no cuenta una víctima más de 5 niveles por debajo (freno al farmeo de novatos). */
export const EK_LEVEL_GAP = 5;
/** Tier de mapa desde el que cuenta todo kill, sin regla de nivel (tier 9 = niveles 81-90). */
export const EK_NO_LEVEL_RULE_TIER = 9;
/** Contribución que suma cada kill válido. */
export const CONTRIB_PER_KILL = 10;
/** Cuántas víctimas recientes se recuerdan por personaje (para el cooldown de 4 h). */
export const EK_SEEN_MAX = 300;
/** ¿El nivel de la víctima deja que el kill cuente? `mapTier` = tier del mapa (sin tier = regla de nivel). */
export const ekLevelOk = (killerLvl: number, victimLvl: number, mapTier?: number): boolean => (mapTier ?? 0) >= EK_NO_LEVEL_RULE_TIER || victimLvl >= killerLvl - EK_LEVEL_GAP;

/** Tienda de contribución. Solo cosas visuales o de comodidad: nunca poder. Hoy, títulos (se ven sobre el nombre). */
export interface ContribItem { id: string; name: string; kind: 'title'; cost: number; desc: string }
export const CONTRIB_SHOP: ContribItem[] = [
    { id: 'centinela', name: 'Centinela', kind: 'title', cost: 50, desc: 'Título: aparece sobre tu nombre.' },
    { id: 'defensor', name: 'Defensor de la nación', kind: 'title', cost: 150, desc: 'Título: aparece sobre tu nombre.' },
    { id: 'veterano', name: 'Veterano de frontera', kind: 'title', cost: 300, desc: 'Título: aparece sobre tu nombre.' },
    { id: 'azote', name: 'Azote de la frontera', kind: 'title', cost: 600, desc: 'Título: aparece sobre tu nombre.' },
];
export const CONTRIB_BY_ID = new Map(CONTRIB_SHOP.map((i) => [i.id, i]));
