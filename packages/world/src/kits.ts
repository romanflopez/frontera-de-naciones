/**
 * Kits de clase: qué habilidad puede usar cada clase y desde qué nivel (paso K1, ver el doc del proyecto `kits-de-clase.md`).
 * Lo usan el server (rechaza lo que no corresponde) y el cliente (bloquea el botón y avisa el nivel).
 *
 * Niveles: del 1 al 12, los de Valdrys (completos desde K3; el clérigo desde K5). Del 13 al 40 (tope de ERIS; Valdrys llega al 30)
 * las 5 habilidades que quedan de cada clase salen en el 15, 20, 25, 30 y 35, una o dos por tramo de dungeon, y **el escape o
 * acercamiento de cada clase sale a la vez, en el 20** (Carga sagrada, Parpadeo y Paso de luz). Ver `kits-de-clase.md` §2.0.
 * Las de 15 a 35 (escudos, Paso de luz, auras, Despertar y bendiciones) llegan con K8.
 * Furia, invisibilidad y detectar son utilidad compartida (recargas en K6). Segundo aliento (`aliento`) es común a todas las clases.
 */

export type ClassId = 'paladin' | 'mago' | 'clerigo' | 'arquero';

/** Habilidad → nivel mínimo, por clase. `ataque` (golpe básico) lo tienen todas. */
const KITS_BASE: Record<ClassId, Readonly<Record<string, number>>> = {
    // `grito` = Bendición de poder (id viejo del Grito de guerra, queda por las barras guardadas)
    paladin: {
        ataque: 1, golpe: 1, juicio: 1, giro: 3, escudo: 5, mandato: 7, aturdir: 9, aura: 12, escudodivino: 15, carga: 20, represalia: 25, grito: 30, amparo: 35,
        furia: 1, remover: 1, aliento: 1,
    },
    mago: {
        ataque: 1, proyectil: 1, esquirla: 1, paralisis: 3, nova: 5, ignicion: 7, bola: 9, lluvia: 12, escudomana: 15, blink: 20, clarividencia: 25, intelecto: 35,
        furia: 1, remover: 1, invisibilidad: 1, detectar: 1, aliento: 1,
    },
    // Clérigo sagrado de Valdrys (K5): Castigo y Curación desde el 1, Renovar 3, Bendición 5, Nova 7, Reprender 9, Orbe 12.
    // K8: Escudo guardián 15, Paso de luz 20 (escape), Despertar 25, Esfera celestial 30, Bendición de grupo 35 (Fortaleza + Espíritu divino).
    clerigo: {
        ataque: 1, castigo: 1, curacion: 1, renovar: 3, bendicion: 5, novasagrada: 7, reprender: 9, orbe: 12,
        guardian: 15, pasoluz: 20, despertar: 25, esfera: 30, grupo: 35,
        furia: 1, remover: 1, detectar: 1, aliento: 1,
    },
    // Esqueleto (D.0): registrada sin habilidades y sin poder crearse hasta que tenga kit (ver CREATABLE_CLASS_IDS).
    arquero: {},
};

/**
 * Los niveles de arriba están en la escala vieja (1-40, el kit completo en el 35). Con el juego en 1-120 el kit se completa en el nivel 60
 * (`KIT_TOP`): cada habilidad sale en `round(vieja × 60 / 35)`; después del 60 el progreso es de ítems y stats.
 */
export const KIT_TOP = 60;
/** Nivel nuevo de una habilidad que en la escala vieja salía en `old`. */
export const kitLevel = (old: number): number => (old <= 1 ? 1 : Math.round((old * KIT_TOP) / 35));
export const CLASS_KITS: Record<ClassId, Readonly<Record<string, number>>> = Object.fromEntries(
    Object.entries(KITS_BASE).map(([c, k]) => [c, Object.fromEntries(Object.entries(k).map(([id, l]) => [id, kitLevel(l)]))]),
) as Record<ClassId, Readonly<Record<string, number>>>;

/** Clases registradas, en el orden en que se muestran. */
export const CLASS_IDS: readonly ClassId[] = ['paladin', 'mago', 'clerigo', 'arquero'];

/** Clases con las que se puede crear un personaje. El arquero entra acá cuando tenga kit. */
export const CREATABLE_CLASS_IDS: readonly ClassId[] = ['paladin', 'mago', 'clerigo'];

/** Ids viejos que pueden venir de datos guardados (D.0). Solo para leer: nada nuevo se escribe con estos nombres. */
const LEGACY_CLASS_IDS: Readonly<Record<string, ClassId>> = { guerrero: 'paladin', healer: 'clerigo' };

/** Traduce un id de clase viejo al actual; cualquier otro valor vuelve igual. */
export const canonicalClass = (cls: string): string => (Object.hasOwn(LEGACY_CLASS_IDS, cls) ? LEGACY_CLASS_IDS[cls] : cls);

export const isClass = (cls: string): cls is ClassId => (CLASS_IDS as readonly string[]).includes(cls);

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
