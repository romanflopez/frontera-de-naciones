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
    /** Grito de guerra (suma defensa) y ralentización: vencen solos; `dirty` avisa al mundo que hay que anunciarlo. */
    warcryEndTime: number;
    slowEndTime: number;
    dirty: boolean;
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
export const REMOVER_CD_MS = 10000;

export function createDefaultStatus(): CharacterStatus {
    return { isParalyzed: false, paralysisEndTime: 0, immunityEndTime: 0, removerCooldown: 0, isInvisible: false, invisibleEndTime: 0, hasDetectInvisible: false, detectInvisibleEndTime: 0, warcryEndTime: 0, slowEndTime: 0, dirty: false, dr: {} };
}

/**
 * Intenta paralizar/aturdir. Devuelve los ms aplicados tras el DR, o 0 si resistió (inmunidad del Remover o 4º CC en la ventana).
 * No acorta una parálisis más larga ya activa.
 */
export function applyParalysis(status: CharacterStatus, now: number, durationMs = MAX_PARALYSIS_MS, kind: CcKind = 'paralisis'): number {
    if (now < status.immunityEndTime) return 0;
    const ms = drApply(status, kind, now, Math.min(MAX_PARALYSIS_MS, Math.max(0, durationMs)));
    if (ms <= 0) return 0;
    status.paralysisEndTime = status.isParalyzed ? Math.max(status.paralysisEndTime, now + ms) : now + ms;
    status.isParalyzed = true;
    return ms;
}

/** Remover (contragolpe): corta la parálisis ya y da 8 s de inmunidad. Solo sirve paralizado y fuera de su cooldown. */
export function castRemover(status: CharacterStatus, now: number): boolean {
    if (!status.isParalyzed || now < status.removerCooldown) return false;
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

/** Grito de guerra: sube la defensa hasta `endTime`. */
export function applyWarcry(status: CharacterStatus, now: number, durationMs: number): void { status.warcryEndTime = now + durationMs; status.dirty = true; }
export const hasWarcry = (status: CharacterStatus, now: number) => now < status.warcryEndTime;
/** Ralentización (Carga): menos velocidad al caminar un rato; no se acumula, solo se renueva. */
/** Con DR: devuelve los ms aplicados (0 = inmune). */
export function applySlow(status: CharacterStatus, now: number, durationMs: number): number {
    const ms = drApply(status, 'slow', now, durationMs); if (ms <= 0) return 0;
    status.slowEndTime = Math.max(status.slowEndTime, now + ms); status.dirty = true; return ms;
}
export const isSlowed = (status: CharacterStatus, now: number) => now < status.slowEndTime;
/** Vence los estados temporizados nuevos; deja `dirty` si cambió algo que hay que anunciar. */
export function expireTimed(status: CharacterStatus, now: number): void {
    if (status.warcryEndTime && now >= status.warcryEndTime) { status.warcryEndTime = 0; status.dirty = true; }
    if (status.slowEndTime && now >= status.slowEndTime) { status.slowEndTime = 0; status.dirty = true; }
}
