// Sistema de control de masas (PvP): parálisis, inmunidad posterior y Remover.
// Toda decisión se toma acá en el server; el cliente solo muestra el resultado.

export interface CharacterStatus {
    isParalyzed: boolean;
    paralysisEndTime: number;
    immunityEndTime: number;
    removerCooldown: number;
    isInvisible: boolean;
    invisibleEndTime: number;
    hasDetectInvisible: boolean;
    detectInvisibleEndTime: number;
    /** Ralentización: vence sola; `dirty` avisa al mundo que hay que anunciarlo. */
    slowEndTime: number;
    /** Bendición sagrada del healer (K5): menos daño, más curación recibida e inmunidad a congelado y aturdido. */
    blessEndTime: number;
    /** Veneno (K5): −30 % de curación recibida mientras dura (lo pone el golpe físico con chance de veneno o un mob tóxico). */
    poisonEndTime: number;
    dirty: boolean;
    /** K8: bendiciones y auras activas (fin de cada una). Las que tocan stats (poder, intelecto, fortaleza) dejan `statDirty` al entrar o vencer. */
    buffs: Partial<Record<BuffId, number>>;
    statDirty: boolean;
    /** K8: escudo (absorbe daño antes que la vida): puntos que le quedan y hasta cuándo dura. `vitalsDirty` = hay que avisar la barra. */
    shield: number;
    shieldEndTime: number;
    vitalsDirty: boolean;
    /** Rendimiento decreciente de CC: por tipo, cuántos CC entraron en la ventana y hasta cuándo dura la ventana. */
    dr: Partial<Record<CcKind, { n: number; until: number }>>;
}

/** Tipos de CC con DR propio (P0-B1, docs/COMBATE.md). El daño no tiene DR. */
export type CcKind = 'paralisis' | 'aturdir' | 'slow';
export const DR_WINDOW_MS = 15000;
/** 1º full, 2º 50 %, 3º 25 %, 4º inmune. */
export const DR_MULTS = [1, 0.5, 0.25, 0] as const;
/** Duración tras el DR (0 = inmune). Registra el CC y renueva la ventana de 15 s de ese tipo. */
export function drApply(status: CharacterStatus, kind: CcKind, now: number, durationMs: number): number {
    let e = status.dr[kind];
    if (!e || now >= e.until) e = status.dr[kind] = { n: 0, until: 0 };
    const mult = DR_MULTS[Math.min(e.n, DR_MULTS.length - 1)];
    if (mult === 0) return 0; // inmune: no renueva la ventana, así se libera a los 15 s del último CC que entró
    e.n++; e.until = now + DR_WINDOW_MS;
    return Math.round(durationMs * mult);
}

export const MAX_PARALYSIS_MS = 5000; // Chains of Ice: freeze 5 s
export const IMMUNITY_MS = 8000;
/** Purga (Cleanse de Valdrys, K8): recarga 24 s. */
export const REMOVER_CD_MS = 24000;

export function createDefaultStatus(): CharacterStatus {
    return { isParalyzed: false, paralysisEndTime: 0, immunityEndTime: 0, removerCooldown: 0, isInvisible: false, invisibleEndTime: 0, hasDetectInvisible: false, detectInvisibleEndTime: 0, slowEndTime: 0, blessEndTime: 0, poisonEndTime: 0, dirty: false, buffs: {}, statDirty: false, shield: 0, shieldEndTime: 0, vitalsDirty: false, dr: {} };
}

/**
 * Intenta paralizar/aturdir. Devuelve los ms aplicados tras el DR, o 0 si resistió (inmunidad del Remover o 4º CC en la ventana).
 * No acorta una parálisis más larga ya activa.
 */
export function applyParalysis(status: CharacterStatus, now: number, durationMs = MAX_PARALYSIS_MS, kind: CcKind = 'paralisis'): number {
    if (now < status.immunityEndTime || isBlessed(status, now)) return 0;
    const ms = drApply(status, kind, now, Math.min(MAX_PARALYSIS_MS, Math.max(0, durationMs)));
    if (ms <= 0) return 0;
    status.paralysisEndTime = status.isParalyzed ? Math.max(status.paralysisEndTime, now + ms) : now + ms;
    status.isParalyzed = true;
    return ms;
}

/**
 * Purga (antes Remover, K8): se saca el congelado, el aturdido y el frenado, y da 8 s de inmunidad a parálisis.
 * Solo sirve con alguno de esos estados encima y fuera de su recarga.
 */
export function castRemover(status: CharacterStatus, now: number): boolean {
    const slowed = now < status.slowEndTime;
    if ((!status.isParalyzed && !slowed) || now < status.removerCooldown) return false;
    if (slowed) { status.slowEndTime = 0; status.dirty = true; }
    status.isParalyzed = false;
    status.immunityEndTime = now + IMMUNITY_MS;
    status.removerCooldown = now + REMOVER_CD_MS;
    return true;
}

export const INVISIBLE_MS = 15000;
export const DETECT_MS = 10000;
/** Invisibilidad: 15 s o hasta que hagas algo ofensivo. */
export function castInvisibility(status: CharacterStatus, now: number): boolean {
    status.isInvisible = true; status.invisibleEndTime = now + INVISIBLE_MS; return true;
}
export function breakInvisibility(status: CharacterStatus): boolean {
    if (!status.isInvisible) return false;
    status.isInvisible = false; status.invisibleEndTime = 0; return true;
}
/** Detectar invisible: 10 s viendo a los ocultos. */
export function castDetectInvisible(status: CharacterStatus, now: number): boolean {
    status.hasDetectInvisible = true; status.detectInvisibleEndTime = now + DETECT_MS; return true;
}

/** Se llama en cada tick. Al terminar la parálisis ya no hay inmunidad fija de 8 s: la reemplaza el DR. */
export function updateStatus(status: CharacterStatus, now: number): void {
    if (status.isParalyzed && now >= status.paralysisEndTime) status.isParalyzed = false;
    if (status.isInvisible && now >= status.invisibleEndTime) status.isInvisible = false;
    if (status.hasDetectInvisible && now >= status.detectInvisibleEndTime) status.hasDetectInvisible = false;
}

// ---------- K8: bendiciones, auras y escudos (kits-de-clase.md §2) ----------
/**
 * poder = Bendición de poder (+Daño), amparo = Bendición de amparo (−daño recibido), intelecto = Intelecto arcano (+Magia),
 * fortaleza = Fortaleza (+vida), espiritu = Espíritu divino (+regen de maná), represalia = Aura de represalia, clarividencia = Clarividencia.
 */
export type BuffId = 'poder' | 'amparo' | 'intelecto' | 'fortaleza' | 'espiritu' | 'represalia' | 'clarividencia';
export const BUFF_IDS: readonly BuffId[] = ['poder', 'amparo', 'intelecto', 'fortaleza', 'espiritu', 'represalia', 'clarividencia'];
/** Bendiciones que cambian los stats de combate (hay que recalcularlos al entrar y al vencer). */
export const STAT_BUFFS: ReadonlySet<BuffId> = new Set<BuffId>(['poder', 'intelecto', 'fortaleza']);
/** Aplica (o renueva) una bendición: no se apila, la nueva pisa la duración. */
export function applyBuff(status: CharacterStatus, id: BuffId, now: number, durationMs: number): void {
    const was = hasBuff(status, id, now);
    status.buffs[id] = now + durationMs; status.dirty = true;
    if (!was && STAT_BUFFS.has(id)) status.statDirty = true;
}
export const hasBuff = (status: CharacterStatus, id: BuffId, now: number): boolean => now < (status?.buffs?.[id] ?? 0);
export const activeBuffs = (status: CharacterStatus, now: number): BuffId[] => BUFF_IDS.filter((id) => hasBuff(status, id, now));
/**
 * Escudo: suma `amount` al que ya tenga (Valdrys: los escudos se juntan con tope de una barra llena = la vida máxima) y dura `durationMs`
 * desde ahora. Devuelve los puntos de escudo que quedaron.
 */
export function applyShield(status: CharacterStatus, now: number, amount: number, maxHp: number, durationMs: number): number {
    const cur = now < status.shieldEndTime ? status.shield : 0;
    status.shield = Math.min(Math.max(1, Math.round(maxHp)), cur + Math.max(0, Math.round(amount)));
    status.shieldEndTime = now + durationMs; status.vitalsDirty = true;
    return status.shield;
}
export const shieldOf = (status: CharacterStatus, now: number): number => (now < status.shieldEndTime ? status.shield : 0);
/** El escudo se come el daño primero: devuelve lo que pasa a la vida. */
export function absorbShield(status: CharacterStatus, now: number, dmg: number): number {
    const sh = shieldOf(status, now); if (sh <= 0 || dmg <= 0) return dmg;
    const took = Math.min(sh, dmg);
    status.shield = sh - took; if (status.shield <= 0) { status.shield = 0; status.shieldEndTime = 0; }
    status.vitalsDirty = true;
    return dmg - took;
}
/** Al morir se pierden escudos y bendiciones. */
export function clearBuffs(status: CharacterStatus): void {
    if (status.shield > 0) status.vitalsDirty = true;
    status.shield = 0; status.shieldEndTime = 0;
    if (Object.keys(status.buffs).some((k) => STAT_BUFFS.has(k as BuffId))) status.statDirty = true;
    if (Object.keys(status.buffs).length) status.dirty = true;
    status.buffs = {};
}
/** Ralentización (Carga): menos velocidad al caminar un rato; no se acumula, solo se renueva. */
/** Con DR: devuelve los ms aplicados (0 = inmune). */
export function applySlow(status: CharacterStatus, now: number, durationMs: number): number {
    const ms = drApply(status, 'slow', now, durationMs); if (ms <= 0) return 0;
    status.slowEndTime = Math.max(status.slowEndTime, now + ms); status.dirty = true; return ms;
}
/** Bendición sagrada: dura `durationMs` y, al entrar, corta el congelado o aturdido que tenga el objetivo. */
export function applyBless(status: CharacterStatus, now: number, durationMs: number): void {
    status.blessEndTime = now + durationMs; status.isParalyzed = false; status.paralysisEndTime = 0; status.dirty = true;
}
export const isBlessed = (status: CharacterStatus, now: number) => now < status.blessEndTime;
/** Veneno: dura `durationMs` (uno nuevo renueva, no se apila). */
export function applyPoison(status: CharacterStatus, now: number, durationMs: number): void {
    const was = now < status.poisonEndTime; status.poisonEndTime = Math.max(status.poisonEndTime, now + durationMs); if (!was) status.dirty = true;
}
export const isPoisoned = (status: CharacterStatus, now: number) => now < status.poisonEndTime;
export const isSlowed = (status: CharacterStatus, now: number) => now < status.slowEndTime;
/** Vence los estados temporizados nuevos; deja `dirty` si cambió algo que hay que anunciar. */
export function expireTimed(status: CharacterStatus, now: number): void {
    for (const id of BUFF_IDS) {
        const end = status.buffs[id];
        if (end !== undefined && now >= end) { delete status.buffs[id]; status.dirty = true; if (STAT_BUFFS.has(id)) status.statDirty = true; }
    }
    if (status.shieldEndTime && now >= status.shieldEndTime) { status.shield = 0; status.shieldEndTime = 0; status.vitalsDirty = true; }
    if (status.slowEndTime && now >= status.slowEndTime) { status.slowEndTime = 0; status.dirty = true; }
    if (status.blessEndTime && now >= status.blessEndTime) { status.blessEndTime = 0; status.dirty = true; }
    if (status.poisonEndTime && now >= status.poisonEndTime) { status.poisonEndTime = 0; status.dirty = true; }
}
