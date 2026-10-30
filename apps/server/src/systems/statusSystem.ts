// Sistema de control de masas (PvP): parálisis, inmunidad posterior y Remover.
// Toda decisión se toma acá en el server; el cliente solo muestra el resultado.

export interface CharacterStatus {
    isParalyzed: boolean;
    paralysisEndTime: number;
    immunityEndTime: number;
    removerCooldown: number;
}

export const MAX_PARALYSIS_MS = 4000;
export const IMMUNITY_MS = 8000;
export const REMOVER_CD_MS = 10000;

export function createDefaultStatus(): CharacterStatus {
    return { isParalyzed: false, paralysisEndTime: 0, immunityEndTime: 0, removerCooldown: 0 };
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

/** Se llama en cada tick: si la parálisis terminó sola, entra la inmunidad. */
export function updateStatus(status: CharacterStatus, now: number): void {
    if (status.isParalyzed && now >= status.paralysisEndTime) {
        status.isParalyzed = false;
        status.immunityEndTime = now + IMMUNITY_MS;
    }
}
