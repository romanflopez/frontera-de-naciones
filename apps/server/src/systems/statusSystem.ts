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
}

export const MAX_PARALYSIS_MS = 4000;
export const IMMUNITY_MS = 8000;
export const REMOVER_CD_MS = 10000;

export function createDefaultStatus(): CharacterStatus {
    return { isParalyzed: false, paralysisEndTime: 0, immunityEndTime: 0, removerCooldown: 0, isInvisible: false, invisibleEndTime: 0, hasDetectInvisible: false, detectInvisibleEndTime: 0, warcryEndTime: 0, slowEndTime: 0, dirty: false };
}

/** Intenta paralizar. Devuelve false si el objetivo está en su ventana de inmunidad (8 s después de una parálisis). */
export function applyParalysis(status: CharacterStatus, now: number, durationMs = MAX_PARALYSIS_MS): boolean {
    if (now < status.immunityEndTime) return false;
    status.isParalyzed = true;
    status.paralysisEndTime = now + Math.min(MAX_PARALYSIS_MS, Math.max(0, durationMs));
    return true;
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

/** Se llama en cada tick: si la parálisis terminó sola, entra la inmunidad. */
export function updateStatus(status: CharacterStatus, now: number): void {
    if (status.isParalyzed && now >= status.paralysisEndTime) {
        status.isParalyzed = false;
        status.immunityEndTime = now + IMMUNITY_MS;
    }
    if (status.isInvisible && now >= status.invisibleEndTime) status.isInvisible = false;
    if (status.hasDetectInvisible && now >= status.detectInvisibleEndTime) status.hasDetectInvisible = false;
}

/** Grito de guerra: sube la defensa hasta `endTime`. */
export function applyWarcry(status: CharacterStatus, now: number, durationMs: number): void { status.warcryEndTime = now + durationMs; status.dirty = true; }
export const hasWarcry = (status: CharacterStatus, now: number) => now < status.warcryEndTime;
/** Ralentización (Carga): menos velocidad al caminar un rato; no se acumula, solo se renueva. */
export function applySlow(status: CharacterStatus, now: number, durationMs: number): void { status.slowEndTime = Math.max(status.slowEndTime, now + durationMs); status.dirty = true; }
export const isSlowed = (status: CharacterStatus, now: number) => now < status.slowEndTime;
/** Vence los estados temporizados nuevos; deja `dirty` si cambió algo que hay que anunciar. */
export function expireTimed(status: CharacterStatus, now: number): void {
    if (status.warcryEndTime && now >= status.warcryEndTime) { status.warcryEndTime = 0; status.dirty = true; }
    if (status.slowEndTime && now >= status.slowEndTime) { status.slowEndTime = 0; status.dirty = true; }
}
