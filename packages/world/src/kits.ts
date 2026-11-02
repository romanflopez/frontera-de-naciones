/**
 * Kits de clase: qué habilidad puede usar cada clase y desde qué nivel (paso K1, ver el doc del proyecto `kits-de-clase.md`).
 * Lo usan el server (rechaza lo que no corresponde) y el cliente (bloquea el botón y avisa el nivel).
 *
 * Los niveles salen de los kits de Valdrys para las habilidades que se quedan. Las que se van a sacar o reemplazar en el
 * paso K2 (hoja, lanza, marejada, ventisca, sismo, torbellino, tajo, luz, curar, curar2, vendar) quedan en nivel 1 hasta entonces,
 * para no dejar la barra vacía mientras no existan sus reemplazos.
 */

export type ClassId = 'guerrero' | 'mago';

/** Habilidad → nivel mínimo, por clase. `ataque` (golpe básico) lo tienen todas. */
export const CLASS_KITS: Record<ClassId, Readonly<Record<string, number>>> = {
    guerrero: {
        ataque: 1, golpe: 1, giro: 3, aturdir: 9, carga: 20, grito: 24,
        furia: 1, remover: 1,
        tajo: 1, vendar: 1, torbellino: 1, sismo: 1, // se van en K2
    },
    mago: {
        ataque: 1, proyectil: 1, paralisis: 3, bola: 9, lluvia: 12, remover: 21, blink: 24,
        furia: 1, invisibilidad: 1, detectar: 1,
        curar: 1, hoja: 1, lanza: 1, ventisca: 1, marejada: 1, luz: 1, curar2: 1, // se van o se reemplazan en K2
    },
};

const isClass = (cls: string): cls is ClassId => cls === 'guerrero' || cls === 'mago';

/** Nivel desde el que `cls` puede usar `id`, o `null` si no es de su kit. */
export function skillLevel(cls: string, id: string): number | null {
    if (!isClass(cls)) return null;
    const lvl = CLASS_KITS[cls][id];
    return lvl === undefined ? null : lvl;
}

/** Resultado de chequear una habilidad: se puede, no es de la clase, o falta nivel. */
export type SkillCheck = { ok: true } | { ok: false; reason: 'clase' } | { ok: false; reason: 'nivel'; need: number };

export function checkSkill(cls: string, lvl: number, id: string): SkillCheck {
    const need = skillLevel(cls, id);
    if (need === null) return { ok: false, reason: 'clase' };
    if (lvl < need) return { ok: false, reason: 'nivel', need };
    return { ok: true };
}

export const canUseSkill = (cls: string, lvl: number, id: string): boolean => checkSkill(cls, lvl, id).ok;

/** Texto para el jugador cuando una habilidad no se puede usar. */
export function skillDeniedText(check: SkillCheck): string {
    if (check.ok) return '';
    return check.reason === 'nivel' ? `Se desbloquea en el nivel ${check.need}.` : 'Esa habilidad no es de tu clase.';
}
