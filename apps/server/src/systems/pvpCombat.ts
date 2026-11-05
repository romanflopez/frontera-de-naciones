/**
 * Daño PvP calculado en el server. El cliente solo dice "este hechizo, sobre aquel jugador": el daño sale de acá,
 * con las mismas fórmulas del juego, el nivel y el equipo del último guardado validado, la Furia que lleva el server,
 * y límites de recarga, alcance y ritmo por hechizo.
 */
import { KEY_RECIPES } from '@fdn/world';
import { hasBuff, type BuffId, type CharacterStatus } from './statusSystem.ts';
import { isClass, type ClassId, BASE_BY_NAME, UNIQUE_BY_NAME, activeSets, fitsSlot, classBaseHp, classBaseMp, powerLevel, STAT_BASE, CRIT_BASE, CRIT_MULT, MAX_LEVEL, PVE_MP_REGEN, MEDITATE, aspdTotal, critTotal, itemDfTotal, itemRmTotal, leechTotal, meleeIntervalSecs, statBonus, upMult, type Stats } from '@fdn/world';
export type Stat = 'mag' | 'wdmg' | 'melee';
export interface PvpSpell {
    dmg?: [number, number]; lvlK?: number; stat?: Stat;
    /** Multiplicador sobre el "Daño" base de la clase, como en Valdrys (1× = Saeta / Golpe). Si está, reemplaza a dmg/lvlK. */
    k?: number;
    /** Fuerza que se castee (true) o que salga al instante (false); si no está, se deduce del tipo (los mágicos se castean). */
    cast?: boolean;
    /** Multiplicador de amenaza sobre el daño (×3 Juicio, ×5 Escudo vengador). Por defecto 1. */
    threat?: number;
    /** Frena (mitad de velocidad) este tiempo (s). */
    slow?: number;
    /** Deja una quemadura: ¼ del Daño base dos veces por segundo durante 3 s (una por objetivo; la nueva reemplaza a la vieja). */
    burn?: boolean;
    /** Multiplicador contra un objetivo congelado, enraizado o aturdido (Esquirla 2×, Juicio y Escudo 1,5×). */
    vsCtrl?: number;
    /** Multiplicador contra un objetivo que se está quemando (Bola de fuego 1,4×). */
    vsBurn?: number;
    /** El que lanza se cura esta fracción del daño que hizo (Juicio 50 %). */
    lifesteal?: number;
    /** Provoca: el monstruo te ataca a vos este tiempo (s). No afecta a jugadores. */
    taunt?: number;
    /** Paralización (s) sobre el objetivo; solo se aplica si el cliente la pide (último tick) y no más seguido que `cd`. */
    secs?: number;
    /** Maná que devuelve si el golpe entra (Castigo: 9 de 18). */
    refund?: number;
    /** Costo de maná (igual al del cliente); se cobra una vez por ráfaga. */
    mp: number;
    range: number; cd: number; ticks?: number; every?: number; aoe?: number; melee?: boolean;
    /** Elemento del efecto visual (fuego: eruption/cataclysm; hielo: blizz/tidal). Ya no cambia el daño: solo existen DF y RM. */
    kind?: string;
}
/** Tipo de daño: el físico lo mitiga la defensa (DF) y el mágico la resistencia mágica (RM). */
export type DmgKind = 'phys' | 'magic';
/** Físico = ataque cuerpo a cuerpo, golpe, tajo, sismo (todo lo que escala con el arma); mágico = el resto de los hechizos. */
export const spellDmgKind = (id: string): DmgKind => { const sp = PVP_SPELLS[id]; return sp && (sp.stat === 'melee' || sp.stat === 'wdmg' || sp.melee) ? 'phys' : 'magic'; };
/** Movimiento (D.12, primera prueba; se afina jugando): correr es el default (RUN_MS) y caminar (WALK_MS) solo mientras se castea o se tiene un hechizo listo. MOVE_CAP_MS es el tope duro de velocidad en combate y el piso para buffs: igual a RUN_MS, así correr no queda recortado. Si Román toca un número, es este. */
export const WALK_MS = 280, RUN_MS = 170, MOVE_CAP_MS = 170;
/** Alcance máximo de hechizos y habilidades a distancia, en celdas: lo que se ve desde el centro hasta la esquina más lejana de la pantalla (el campo de visión es fijo; ver VIEW_* del cliente), para que se pueda tirar a cualquier punto visible como en el cliente de referencia. */
export const VIEW_RANGE = 20;
/** Escala de cast times (ms). */
export const CAST_FAST_MS = 750, CAST_NORMAL_MS = 1000, CAST_HEAVY_MS = 1500, CAST_TELEGRAPH_MS = 2400;
/** true si el hechizo es un cast (no golpe cuerpo a cuerpo): esos no se pueden lanzar corriendo. */
/** Cast time de cada hechizo (ms); los que no figuran usan CAST_FAST_MS. Lo decide el server: el cliente no lo puede cambiar. */
/** Bendiciones de grupo (Valdrys: 0,8 s). */
export const CAST_BUFF_MS = 800;
/** Casteo único para TODOS los hechizos, como en el cliente de referencia: la animación de magia son 16 cuadros de 88 ms = 1408 ms, igual para cualquier hechizo (`MapData.cpp` del cliente 3.82). Una sola constante para ajustar. */
export const CAST_HB_MS = 1408;
export const CAST_MS: Record<string, number> = {};
export const castMsOf = (_id: string): number => CAST_HB_MS;
/** Margen de red al validar que el cast terminó (ms). */
export const CAST_SLACK_MS = 150;
/** Cuánto vale un cast terminado sin soltar (el cliente lo deja "listo" hasta que elegís objetivo). */
export const CAST_READY_MS = 10000;
/** Ventana tras el primer golpe para los demás objetivos y ticks del MISMO cast (áreas y canalizados). */
export const CAST_MULTI_HIT_MS = 3000;
export const isCast = (id: string): boolean => { const sp = PVP_SPELLS[id] ?? SKILLS[id]; if (!sp) return false; if (sp.cast !== undefined) return sp.cast; return !sp.melee && sp.stat !== 'melee' && sp.stat !== 'wdmg' && id !== 'blink'; };
export const PVP_SPELLS: Record<string, PvpSpell> = {
    ataque: { mp: 0, dmg: [0, 0], lvlK: 1, stat: 'melee', range: 2.6, cd: 0.3, melee: true },
    // Mago (kits de Valdrys, ver el doc del proyecto kits-de-clase.md). Daño = múltiplo del Daño base mágico.
    proyectil: { mp: 14, dmg: [14, 21], k: 1, stat: 'mag', range: VIEW_RANGE, cd: 0.35 },                                     // Saeta ígnea: cast 0,75 s
    esquirla: { mp: 24, dmg: [14, 21], k: 1.2, stat: 'mag', range: VIEW_RANGE, cd: 0.7, slow: 3, vsCtrl: 2 },                   // Esquirla de hielo: cast 1 s, frena 3 s
    paralisis: { mp: 36, dmg: [14, 21], k: 0.2, stat: 'mag', secs: 5, range: VIEW_RANGE, cd: 6 },                             // Cadenas de hielo: cast 1 s, congela 5 s
    ignicion: { mp: 30, dmg: [14, 21], k: 0.5, stat: 'mag', range: VIEW_RANGE, cd: 5, cast: false, burn: true },                // Ignición: instantánea + quemadura
    bola: { mp: 72, kind: 'eruption', dmg: [14, 21], k: 3, stat: 'mag', range: VIEW_RANGE, cd: 10, burn: true, vsBurn: 1.4 },  // Bola de fuego: cast 1,5 s, un objetivo
    lluvia: { mp: 90, kind: 'cataclysm', dmg: [14, 21], k: 1.2, stat: 'mag', range: VIEW_RANGE, cd: 18, aoe: 4.5, burn: true }, // Infierno: cast 2,4 s, área
    // Paladín. Daño = múltiplo del Daño base físico (arma).
    golpe: { mp: 10, dmg: [14, 20], lvlK: 2, stat: 'wdmg', range: 2.8, cd: 0.9, melee: true },                        // Golpe: cuerpo a cuerpo, sin cast
    juicio: { mp: 15, dmg: [14, 20], k: 1.5, stat: 'wdmg', range: 4, cd: 1.4, cast: true, lifesteal: 0.5, vsCtrl: 1.5, threat: 3 }, // Juicio: cast 1 s
    escudo: { mp: 36, dmg: [14, 20], k: 2.3, stat: 'wdmg', secs: 3, range: 10, cd: 9, cast: false, vsCtrl: 1.5, threat: 5 },    // Escudo vengador: aturde 3 s
    aturdir: { mp: 30, dmg: [14, 20], k: 0.8, stat: 'wdmg', secs: 3, range: 8, cd: 11, taunt: 3 },                     // Martillo de justicia: aturde y provoca 3 s
    // Clérigo (K5): el clérigo sagrado de Valdrys. Daño mágico, como el mago.
    castigo: { mp: 18, refund: 9, dmg: [14, 21], k: 1.4, stat: 'mag', range: VIEW_RANGE, cd: 0.95, lifesteal: 0.35, vsCtrl: 1.5 }, // Castigo: cast 1 s, se cura el 35 %
    reprender: { mp: 30, dmg: [14, 21], k: 0.8, stat: 'mag', secs: 3, range: VIEW_RANGE, cd: 15, cast: false },              // Reprender: instantáneo, aturde 3 s
};
/** Hechizos cuyo control es un aturdido (no una parálisis): llevan su propio rendimiento decreciente. */
export const STUN_SPELLS = new Set(['aturdir', 'escudo', 'reprender']);
/**
 * Habilidades de clase (las valida y cobra el server): Mago = blink; Paladín (id interno 'paladin', persistido) = carga, giro, grito.
 * Van aparte de PVP_SPELLS a propósito: no se pueden pedir por pvpHitRequest para pegar sin moverse.
 */
export interface ClassSkill extends PvpSpell { cls: ClassId;
    /** Cura directa: fracción de la vida máxima del objetivo (más la misma fracción del poder de curación). */ heal?: number;
    /** Cura en el tiempo (Renovar): pulsos, cada cuánto (s) y fracción de la vida máxima por pulso. */ hot?: { ticks: number; every: number; frac: number };
    /** Bendición sagrada: duración (s). */ bless?: number;
    /** El que lanza se cura esta fracción del daño de área (Nova sagrada 12 %). */ selfHeal?: number; /** aturdimiento (s) al llegar */ stun?: number; /** congelado (s) a los que alcanza (Nova) */ freeze?: number; /** barridos seguidos (Barrido: 2, a 0,25 s) */ sweeps?: number; /** pulsos de un aura (Aura sagrada: 20, uno cada `every` s) */ pulses?: number;
    /** K8. Escudo: fracción de la vida máxima del que lo recibe, dura SHIELD_MS. */ shield?: number;
    /** K8. Bendición o aura que deja (a uno mismo, o a los aliados a `aoe` celdas si tiene `aoe`) y cuánto dura (s). Bendición de grupo: dos a la vez. */ buff?: BuffId | BuffId[]; buffSecs?: number;
    /** K8. Bendición de grupo: dura esto (s) fuera de la arena; `buffSecs` queda para adentro de la arena. */ buffSecsLong?: number;
    /** K8. Bendición de grupo: además de los aliados a `aoe` celdas, le llega a toda la party que esté en este mundo (sin importar la distancia). */ party?: boolean;
    /** K8. Despertar: revive a un aliado caído con esta fracción de vida y maná. */ revive?: number;
    /** K8. Esfera celestial: cantidad de curas y salto máximo (celdas) entre un aliado y el siguiente. */ bounce?: { n: number; jump: number } }
/** Bendiciones de grupo (poder, amparo, intelecto, grupo): duración fuera de la arena, para no tener que repetirlas todo el tiempo. En la arena valen las de Valdrys (60-90 s). */
export const BLESSING_LONG_S = 15 * 60;
export const SKILLS: Record<string, ClassSkill> = {
    blink: { cls: 'mago', mp: 0, range: 7.25, cd: 12 },                                                                  // Parpadeo: sin maná (Valdrys)
    pasoluz: { cls: 'clerigo', mp: 0, range: 6.25, cd: 15 },                                                              // Paso de luz (K8): hasta 6 celdas, se saca el frenado
    nova: { cls: 'mago', mp: 60, dmg: [14, 21], k: 0.8, stat: 'mag', range: 0, cd: 8, aoe: 3, freeze: 2, cast: false }, // Nova de escarcha: congela 2 s alrededor
    carga: { cls: 'paladin', mp: 60, dmg: [14, 20], k: 0.6, stat: 'wdmg', range: VIEW_RANGE, cd: 18, melee: true, stun: 1, threat: 3 }, // Carga sagrada: aturde 1 s al llegar
    giro: { cls: 'paladin', mp: 36, dmg: [14, 20], k: 0.75, stat: 'wdmg', range: 0, cd: 8, melee: true, aoe: 2, sweeps: 2, threat: 3 }, // Barrido: 2 × 0,75
    mandato: { cls: 'paladin', mp: 42, range: 0, cd: 6, aoe: 6, taunt: 7 },                                              // Mandato: provoca a los monstruos cercanos 7 s
    aura: { cls: 'paladin', mp: 48, dmg: [14, 20], k: 0.25, stat: 'wdmg', range: 0, cd: 15, melee: true, aoe: 3, pulses: 20, every: 0.5, threat: 3 }, // Aura sagrada: 10 s de pulsos
    // K8 (nivel 15 a 35). Id interno `grito` = Bendición de poder (reemplaza al Grito de guerra; el id queda por las barras guardadas).
    represalia: { cls: 'paladin', mp: 48, range: 0, cd: 30, cast: false, buff: 'represalia', buffSecs: 10 },             // Aura de represalia: 10 s
    escudodivino: { cls: 'paladin', mp: 45, range: 0, cd: 20, cast: false, shield: 0.6 },                                // Escudo divino: 60 % de la vida
    grito: { cls: 'paladin', mp: 48, range: 0, cd: 10, cast: true, aoe: 14, party: true, buff: 'poder', buffSecs: 60, buffSecsLong: BLESSING_LONG_S }, // Bendición de poder: +Daño (60 s en la arena, 15 min afuera)
    amparo: { cls: 'paladin', mp: 48, range: 0, cd: 10, cast: true, aoe: 14, party: true, buff: 'amparo', buffSecs: 60, buffSecsLong: BLESSING_LONG_S }, // Bendición de amparo: −6 % de daño (60 s en la arena, 15 min afuera)
    escudomana: { cls: 'mago', mp: 45, range: 0, cd: 10, cast: false, shield: 0.33 },                                     // Escudo de maná: 33 % de la vida
    clarividencia: { cls: 'mago', mp: 60, range: 0, cd: 30, cast: false, buff: 'clarividencia', buffSecs: 10 },           // Clarividencia: +25 % de crítico de hechizos
    intelecto: { cls: 'mago', mp: 60, range: 0, cd: 10, cast: true, aoe: 14, party: true, buff: 'intelecto', buffSecs: 90, buffSecsLong: BLESSING_LONG_S }, // Intelecto arcano: +Magia (90 s en la arena, 15 min afuera)
    // Clérigo (K5). Maná: los costos de Valdrys escalados al pool de ERIS (Castigo queda igual: 18).
    curacion: { cls: 'clerigo', mp: 48, range: VIEW_RANGE, cd: 5, cast: true, heal: 0.4 },                                         // Curación: cast 1,5 s, 40 % de la vida
    renovar: { cls: 'clerigo', mp: 26, range: VIEW_RANGE, cd: 3, cast: false, hot: { ticks: 4, every: 3, frac: 0.03 }, burn: true }, // Renovar: aliado 12 % en 12 s (1 %/s, no se reaplica hasta que termine); enemigo, quemadura
    bendicion: { cls: 'clerigo', mp: 30, range: VIEW_RANGE, cd: 20, cast: false, bless: 10 },                                     // Bendición sagrada: 10 s
    novasagrada: { cls: 'clerigo', mp: 36, dmg: [14, 21], k: 1.2, stat: 'mag', range: 0, cd: 6, aoe: 4.5, cast: false, selfHeal: 0.12 }, // Nova sagrada
    orbe: { cls: 'clerigo', mp: 56, range: VIEW_RANGE, cd: 10, cast: true, aoe: 4, heal: 0.2 },                                   // Orbe sagrado: cast 1,5 s, 20 % en área
    guardian: { cls: 'clerigo', mp: 28, range: VIEW_RANGE, cd: 12, cast: false, shield: 0.4 },                                    // Escudo guardián: 40 % de la vida del aliado
    esfera: { cls: 'clerigo', mp: 34, range: VIEW_RANGE, cd: 8, cast: false, heal: 0.13, bounce: { n: 8, jump: 6 } },             // Esfera celestial: 8 curas del 13 %
    despertar: { cls: 'clerigo', mp: 54, range: VIEW_RANGE, cd: 20, cast: true, revive: 0.5 },                                   // Despertar: cast 2,4 s, revive con 50 %
    grupo: { cls: 'clerigo', mp: 28, range: 0, cd: 10, cast: true, aoe: 14, party: true, buff: ['fortaleza', 'espiritu'], buffSecs: 90, buffSecsLong: BLESSING_LONG_S }, // Bendición de grupo: Fortaleza + Espíritu divino (90 s en la arena, 15 min afuera)
};
/** K8: habilidades de nivel 15 a 35 que se piden por skillRequest (escudos, bendiciones, auras, Esfera y Despertar). Paso de luz va por blinkRequest. */
export const K8_SKILLS = ['represalia', 'escudodivino', 'grito', 'amparo', 'escudomana', 'clarividencia', 'intelecto', 'guardian', 'esfera', 'despertar', 'grupo'] as const;
/** Escudos: duran 10 s (Valdrys) y se juntan con tope de una barra llena. */
export const SHIELD_MS = 10000;
/**
 * K8: cómo se traducen las bendiciones de Valdrys a los atributos de ERIS (que no se tocan en el MVP, kits-de-clase.md §4). Puntos de partida.
 * - poder: +16 al Daño base (como el +16 de daño de Valdrys), antes de los multiplicadores de la habilidad.
 * - amparo: daño recibido ×0,94. represalia: daño recibido ×0,8 y devuelve ⅓ del golpe del monstruo.
 * - intelecto: +8 de Magia de equipo (suma al Daño base mágico y al poder de curación; la Sabiduría de Valdrys).
 * - fortaleza: +6 % de vida máxima (el +8 Valor de Valdrys). espiritu: +50 % de regeneración de maná (el +8 Espíritu). El clérigo los da juntos (Bendición de grupo).
 * - clarividencia: 25 % de crítico en los hechizos (×1,8) contra monstruos; contra jugadores no hay críticos (K6).
 * - Despertar: en mazmorras y arenas solo dentro de los 10 s de la caída.
 */
export const BUFF = { poderDmg: 16, amparoTaken: 0.94, represaliaTaken: 0.8, represaliaReflect: 1 / 3, intelectoMag: 8, fortalezaHp: 0.06, espirituRegen: 1.5, clarividenciaCrit: 25, reviveWindowMs: 10000 } as const;
/** Stats de combate con las bendiciones activas encima. */
export function withBuffs(s: CombatStats, status: CharacterStatus, now: number): CombatStats {
    const out = { ...s };
    if (hasBuff(status, 'poder', now)) out.dmgBonus += BUFF.poderDmg;
    if (hasBuff(status, 'intelecto', now)) out.mag += BUFF.intelectoMag;
    if (hasBuff(status, 'fortaleza', now)) out.maxHp = Math.round(out.maxHp * (1 + BUFF.fortalezaHp));
    return out;
}
/** Multiplicador de daño recibido por bendiciones y auras (Bendición sagrada aparte). */
export function buffTakenMult(status: CharacterStatus, now: number): number {
    return (hasBuff(status, 'amparo', now) ? BUFF.amparoTaken : 1) * (hasBuff(status, 'represalia', now) ? BUFF.represaliaTaken : 1);
}
/** Habilidades del clérigo que se piden por skillRequest. */
/**
 * Curas en PvP (balance del clérigo, sale de K7): mientras el que cura está en combate contra jugadores, sus curas cuestan
 * ×2,5 de maná. En PvE se queda el costo de la tabla. Sin esto, el piso de 5 de maná por segundo de PvP le paga al clérigo
 * casi una Curación cada 10 s y no muere nunca (`sim:pvp`). La cura en sí no se reduce: contra jugadores sigue valiendo solo el veneno.
 */
export const PVP_HEAL_MP_MULT = 2.5;
export const PVP_HEAL_MP_SKILLS: readonly string[] = ['curacion', 'renovar', 'orbe', 'esfera', 'guardian'];
/** Maná que cuesta una habilidad de SKILLS, según si el que la usa está en combate PvP. */
export const skillMpCost = (id: string, inPvp: boolean): number => {
    const mp = SKILLS[id]?.mp ?? 0;
    return inPvp && PVP_HEAL_MP_SKILLS.includes(id) ? Math.round(mp * PVP_HEAL_MP_MULT) : mp;
};
export const CLERIGO_SKILLS = ['curacion', 'renovar', 'bendicion', 'novasagrada', 'orbe'] as const;
/** Bendición sagrada: daño recibido ×0,8 y curación recibida ×1,3 mientras dura; inmune a congelado y aturdido. */
export const BLESS_DMG_TAKEN = 0.8, BLESS_HEAL_TAKEN = 1.3;
/** Veneno sobre un jugador: la curación que recibe ×0,7 (Valdrys: −30 %). Es la herramienta contra los clérigos en PvP. */
export const POISON_HEAL_TAKEN = 0.7;
/** Amenaza que genera curar: fracción de lo curado, sobre los monstruos que están peleando con el curado. */
export const HEAL_THREAT = 0.5;
/** Poder de curación: el Daño base mágico sin la tirada (nivel × 2 + Magia), con el multiplicador de Magia. */
export const healPower = (s: CombatStats): number => Math.round((s.plvl * BASE_LVL_K + s.mag) * s.magicMult);
/** Cura de una habilidad: `frac` de la vida máxima del objetivo más `frac` del poder de curación del que la lanza. */
export const healAmount = (frac: number, caster: CombatStats, targetMaxHp: number): number => Math.max(1, Math.round(targetMaxHp * frac + healPower(caster) * frac));
/** Golpes de área contra mobs (paso 1.4): máximo de objetivos por lanzamiento (los más cercanos al centro) y caída de daño por cada objetivo extra. */
export const AOE_MAX_TARGETS: Record<string, number> = { lluvia: 5, giro: 4, nova: 5, aura: 5, novasagrada: 5 };
/** Quemadura: pulsos, cada cuánto (s) y fracción del Daño base por pulso (6 × ¼ = 1,5×). */
export const BURN_TICKS = 6, BURN_EVERY = 0.5, BURN_K = 0.25;
/** Aura sagrada: el paladín se cura esta fracción del daño de cada pulso (Valdrys no da el número). */
export const AURA_HEAL_FRAC = 0.25;
/** Amenaza que genera una habilidad por punto de daño. */
export const threatOf = (id: string): number => (PVP_SPELLS[id] ?? SKILLS[id])?.threat ?? 1;
/** Daño de un pulso de quemadura: ¼ del Daño base mágico (1×) del que la puso. */
export const burnTickDmg = (s: CombatStats): number => Math.max(1, Math.round(rollSpellDamage('proyectil', s, false) * BURN_K));
export const AOE_FALLOFF = 0.12, AOE_MIN_MULT = 0.5, AOE_GROUP_MS = 250;
/** Multiplicador de daño del objetivo número `index` (0 = el más cercano al centro): 100 %, 88 %, 76 %, 64 %, 52 %... mínimo 50 %. */
export const aoeMult = (index: number): number => Math.max(AOE_MIN_MULT, 1 - AOE_FALLOFF * Math.max(0, index));
export const FURY_MS = 60000, FURY_CD_MS = 90000;
/** Furia por clase: el mago la tira más fuerte (todo su daño), el paladín más débil. */
export const FURY_MULT: Record<string, number> = { mago: 1.35, paladin: 1.15, clerigo: 1.2 };
/** Costos de maná de los hechizos de utilidad que cobra el server (iguales a los del cliente). */
export const UTIL_MP = { furia: 15, invisibilidad: 40, detectar: 30, remover: 30 } as const;
/** Maná por clase (base, por nivel) y poción: mismas cuentas que el cliente. */
/** Regen de maná en combate contra jugadores (base de `pvpMpRegen`, calibrada en K7): 1 % del pool por segundo. */
export const COMBAT_MP_REGEN_PCT = 0.01;
/**
 * Regen de maná fuera de ciudad y fuera de combate PvP (contra monstruos y caminando): etapa 6b, calibrada con `sim:pve`.
 * Con el 1 % (mínimo 2) el mago, con los costos de Valdrys y su pool de ERIS, se pasaba 30-45 % del tiempo meditando entre el
 * nivel 1 y el 20. No toca el PvP: ahí manda `pvpMpRegen`.
 */
export const combatMpRegen = (maxMp: number): number => Math.max(PVE_MP_REGEN.min, Math.round(maxMp * PVE_MP_REGEN.pct));
export { PVE_MP_REGEN, MEDITATE };
export const potionMp = (maxMp: number, pvp = false) => Math.max(pvp ? 20 : 40, Math.round(maxMp * 0.5 * (pvp ? POTION_PVP_MULT : 1)));

export interface CombatStats { lvl: number; /** Destreza y Magia repartidas (para la chance de golpe y de impacto mágico en PvP) */ dexStat?: number; magStat?: number; /** nivel de poder (escala vieja 1-40): el daño y las curas por nivel se miden con este */ plvl: number; cls: string; /** multiplicadores de daño por Fuerza (físico) y Magia (hechizos) */ meleeMult: number; magicMult: number; /** % de crítico en hechizos de daño (Inteligencia) */ critMag?: number; mag: number; wdmg: [number, number]; maxHp: number; def: number; rm: number; rpar: number; /** crítico total %, velocidad de ataque %, robo de vida % y chance de veneno % (ya con topes) */ crit: number; aspd: number; leech: number; poison: number; savedHp: number; maxMp: number; savedMp: number; /** K8: Daño base extra (Bendición de poder) */ dmgBonus: number; /** efectos especiales de los ítems Dorado de jefe puestos (docs/ITEMS.md): quemadura, aturdir, vampirismo */ fx?: string[] }

export const DEFAULT_STATS: CombatStats = { lvl: 1, plvl: 1, cls: 'paladin', meleeMult: 1, magicMult: 1, mag: 0, wdmg: [0, 0], maxHp: 140, def: 0, rm: 0, rpar: 0, crit: 5, aspd: 0, leech: 0, poison: 0, savedHp: 140, maxMp: 40, savedMp: 40, dmgBonus: 0 };

/** Las bases de items son las compartidas de @fdn/world (el cliente usa las mismas). */
const MELEE: Record<string, [number, number]> = { paladin: [5, 9], mago: [2, 4], clerigo: [3, 6] };

/** Lo mínimo del personaje que hace falta para calcular los stats de combate: nivel, clase, vida/maná guardados y el EQUIPO. */
export interface StatSource { lvl: number; cls: string; stats?: Stats; hp?: number; mp?: number; eq: Partial<Record<string, { n: string; r?: number; a?: { id: string; v: number }[]; up?: number } | null>> }

/** Stats de combate a partir del personaje del server (equipo autoritativo, ver economy.ts). */
export function statsFromChar(o: StatSource | undefined, uncapCrit = false): CombatStats {
    if (!o) return { ...DEFAULT_STATS };
    const cls = isClass(o.cls) ? o.cls : 'paladin', lvl = Math.max(1, Math.min(MAX_LEVEL, Number(o.lvl) || 1));
    const s: CombatStats = { lvl, plvl: Math.round(powerLevel(lvl)), cls, meleeMult: 1, magicMult: 1, mag: 0, wdmg: [0, 0], maxHp: 0, def: 0, rm: 0, rpar: 0, crit: 5, aspd: 0, leech: 0, poison: 0, savedHp: 1, maxMp: 0, savedMp: 0, dmgBonus: 0 };
    let bonusHp = 0, bonusMp = 0, itemDmg = 0, itemCrit = 0, itemAspd = 0, itemLeech = 0, itemDf = 0, itemRm = 0;
    const names: string[] = [], fx = new Set<string>();
    const addAttr = (a: { id: string; v: number }): void => { if (a.id === 'mag') s.mag += a.v; else if (a.id === 'hp') bonusHp += a.v; else if (a.id === 'mp') bonusMp += a.v; else if (a.id === 'df') itemDf += a.v; else if (a.id === 'rm' || a.id === 'fres' || a.id === 'ires') itemRm += a.v; /* fres/ires: atributos viejos, ahora valen RM 1:1 */ else if (a.id === 'rpar') s.rpar += a.v; else if (a.id === 'crit') itemCrit += a.v; else if (a.id === 'aspd') itemAspd += a.v; else if (a.id === 'leech') itemLeech += a.v; else if (a.id === 'poison') s.poison += a.v; else if (a.id === 'dmg') itemDmg += a.v; };
    for (const [slot, it] of Object.entries(o.eq ?? {})) {
        if (!it) continue;
        names.push(it.n);
        const b = BASE_BY_NAME.get(it.n);
        if (b && fitsSlot(b.slot, slot)) { const k = upMult(it.up); if (b.dmg) s.wdmg = k === 1 ? b.dmg : [Math.round(b.dmg[0] * k), Math.round(b.dmg[1] * k)]; if (b.mag) s.mag += Math.round(b.mag * k); if (b.def) s.def += Math.round(b.def * k); if (b.rm) s.rm += Math.round(b.rm * k); }
        for (const a of it.a ?? []) addAttr(a);
        const f = UNIQUE_BY_NAME.get(it.n)?.uniq.fx; if (f && (it.r ?? 0) >= 4) fx.add(f); // el efecto especial solo está activo en la calidad Dorado
    }
    for (const bonus of activeSets(names)) for (const [id, v] of bonus.stats) addAttr({ id, v }); // bonos de set (2/4/6 piezas): pasan por los mismos topes
    if (itemDmg > 0 && s.wdmg[1] > 0) s.wdmg = [s.wdmg[0] + itemDmg, s.wdmg[1] + itemDmg]; // daño plano de los afijos: suma al golpe del arma equipada
    if (fx.size) s.fx = [...fx];
    s.def += itemDfTotal(itemDf); s.rm += itemRmTotal(itemRm); // la DF/RM de ATRIBUTOS se topea; la base de las armaduras no
    s.crit = uncapCrit ? Math.min(100, CRIT_BASE + itemCrit) : critTotal(itemCrit); s.aspd = aspdTotal(itemAspd); s.leech = leechTotal(itemLeech); s.poison = Math.min(100, s.poison); // topes del paso 1.3
    const baseHp = classBaseHp(cls, lvl), sb = statBonus(o.stats, baseHp); // puntos de Fuerza, Vitalidad, Destreza y Magia (Vitalidad en % de la vida base)
    bonusHp += sb.hp; bonusMp += sb.mp; s.def += sb.def; s.dexStat = o.stats?.dex ?? STAT_BASE; s.magStat = o.stats?.mag ?? STAT_BASE; s.meleeMult = sb.meleeMult; s.magicMult = sb.magicMult; s.critMag = sb.critMag;
    s.maxHp = baseHp + bonusHp;
    s.maxMp = classBaseMp(cls, lvl) + bonusMp;
    s.savedMp = Math.max(0, Math.min(s.maxMp, Math.round(Number(o.mp) || 0)));
    s.savedHp = Math.max(1, Math.min(s.maxHp, Math.round(Number(o.hp) || s.maxHp)));
    return s;
}

/** Progreso para los portales (del estado del server) */
export function progressFromEcon(st: { lvl: number; q: { i: number; keys: Record<string, number> }; u: string[]; faction?: string; mats?: Record<string, number> } | undefined): { faction?: string; qi: number; lvl: number; keys: Record<string, number>; unlocked: string[] } {
    if (!st) return { qi: 0, lvl: 1, keys: {}, unlocked: [] };
    // las llaves de las mazmorras del corte viven en los materiales (docs/LLAVES.md)
    const keys: Record<string, number> = { ...st.q.keys };
    for (const k of Object.keys(KEY_RECIPES)) if (st.mats?.[k]) keys[k] = st.mats[k];
    return { qi: st.q.i, lvl: st.lvl, keys, unlocked: [...st.u], faction: st.faction };
}

// ---------- golpe en PvP (chance de pegar entre jugadores; doc del proyecto "formulas de stats y hit ratio") ----------
/**
 * Chance de que un golpe de jugador le pegue a otro jugador: `lo que ataca / lo que defiende × K`, topeada entre 10 % y 90 %.
 * Físico: ataca 100 + (DEX − 50) si DEX > 50; defiende 2 × DEX del objetivo. Mágico: nunca falla (chance 1; ni MAG ni DEX entran).
 * La armadura (DF/RM) NO entra acá: ya mitiga el daño después. Solo vale contra jugadores (los monstruos no esquivan).
 * `K` de la referencia es 50 y ahí la armadura entra en la defensa; acá la armadura mitiga el daño aparte, y con K = 90 un duelo parejo dura lo mismo que sin tirada de golpe (calibrado con `sim:pvp`: con 50 el paladín contra paladín tardaba 133 s en vez de 48).
 */
export const HIT = { skill: 100, k: Number(process.env.FDN_HITK) || 90, min: 10, max: 90, threshold: 50 };
/** Encendido salvo bajo `node --test` (los tests de combate no dependen del azar; los de golpe lo prenden a mano) o con FDN_HITROLL=0. */
export const HIT_ROLL = { enabled: process.env.FDN_HITROLL !== '0' && !process.env.NODE_TEST_CONTEXT };
const above = (n: number): number => Math.max(0, n - HIT.threshold);
export function hitChance(att: CombatStats, def: CombatStats, kind: DmgKind): number {
    if (kind === 'magic') return 1; // D.2: la magia nunca falla; se mitiga con RM (DISEÑO.md §5)
    const a = HIT.skill + above(att.dexStat ?? STAT_BASE);
    const d = 2 * (def.dexStat ?? STAT_BASE);
    return Math.min(HIT.max, Math.max(HIT.min, (a / Math.max(1, d)) * HIT.k)) / 100;
}
/** ¿Pega? (tirada con `rnd`, por defecto Math.random). Apagable con FDN_HITROLL=0. */
export const hitRoll = (att: CombatStats, def: CombatStats, kind: DmgKind, rnd: () => number = Math.random): boolean => !HIT_ROLL.enabled || rnd() < hitChance(att, def, kind);

/** Mitigación con rendimiento decreciente: daño × 100 / (100 + X), con X = DF (físico) o RM (mágico). Mínimo 1. */
export const mitigate = (raw: number, x: number): number => Math.max(1, Math.round((raw * 100) / (100 + Math.max(0, x))));
/** Daño que realmente recibe un jugador según su DF o RM. */
export function damageAfterDefense(raw: number, s: CombatStats, kind: DmgKind): number {
    return mitigate(raw, kind === 'magic' ? s.rm : s.def);
}
/** Segundos de parálisis que le quedan a quien resiste: base × 100/(100+RM), menos el % de resistencia a parálisis (tope 75 %); mínimo 0,4 s. */
export const MIN_PARALYSIS_S = 0.4;
export function paralysisSecs(base: number, s: CombatStats): number {
    if (base <= 0) return 0;
    const t = (base * 100) / (100 + Math.max(0, s.rm)) * (1 - Math.min(75, Math.max(0, s.rpar)) / 100);
    return Math.max(MIN_PARALYSIS_S, Math.round(t * 100) / 100);
}

// ---------- pociones ----------
/**
 * Bloqueo compartido entre pociones (vida o maná), independiente de los hechizos (K6, kits-de-clase.md §3):
 * en PvE es el minuto de Valdrys; en una pelea contra jugadores, 30 s y pociones de un cuarto (calibrado con sim:pvp, K7).
 */
export const POTION_LOCK_PVE_MS = 60000, POTION_LOCK_PVP_MS = 60000;
/**
 * En PvP la poción cura esta fracción de la normal. Desde el re-nivel a 120 es 1: pociones iguales en PvP y PvE (como en HB).
 * `sim:pvp` a nivel 120 mostró que el tamaño de la poción casi no mueve las peleas; lo que las regula es el daño.
 */
export const POTION_PVP_MULT = 1;
/** Tolerancia por jitter de red: el server acepta una poción si pasó el bloqueo menos esto. */
export const POTION_GCD_SLACK_MS = 100;
/** Vida: parte instantánea y el resto en `POTION_HOT_TICKS` ticks cada `POTION_HOT_EVERY_MS` (2 s en total). */
export const POTION_INSTANT = 0.2, POTION_HOT_TICKS = 4, POTION_HOT_EVERY_MS = 500;
export const potionHp = (maxHp: number, pvp = false) => Math.max(pvp ? 25 : 50, Math.round(maxHp * 0.4 * (pvp ? POTION_PVP_MULT : 1)));
export const potionLockMs = (pvp: boolean) => (pvp ? POTION_LOCK_PVP_MS : POTION_LOCK_PVE_MS);
/** Reparto de una poción de vida: [instantáneo, ...ticks]; la suma da exactamente `total`. */
export function potionHpSplit(total: number): number[] {
    const first = Math.round(total * POTION_INSTANT), rest = total - first, tick = Math.floor(rest / POTION_HOT_TICKS);
    return [first, ...Array.from({ length: POTION_HOT_TICKS }, (_, i) => (i === POTION_HOT_TICKS - 1 ? rest - tick * (POTION_HOT_TICKS - 1) : tick))];
}

// ---------- K6: reglas de PvP (solo jugador contra jugador; el PvE queda igual a Dreadmyst y Valdrys) ----------
/** Estar "en combate PvP": haber pegado o recibido daño de otro jugador en estos últimos ms. */
export const PVP_COMBAT_MS = 10000;
/**
 * Multiplicador global del daño contra jugadores. Calibrado con `sim:pvp` (K7): con ×0,6 ninguna pelea terminaba (la vida
 * de los jugadores ya se había multiplicado ×4,24 para peleas largas). Con ×1 paladin contra mago y los espejos de paladín
 * duran 25-40 s (a nivel 120 con 357 puntos de estadísticas hizo falta ×1,5). Queda como palanca: si la vida o el daño cambian, se vuelve a correr la simulación.
 */
export const PVP_DMG_MULT = 1.5;
/** Ningún golpe solo saca más que esta fracción de la vida máxima de un jugador (K7: se mantiene; casi nunca llega a actuar hasta el 40). */
export const PVP_HIT_CAP = 0.25;
/**
 * Piso de la regeneración de maná en combate PvP (por segundo). Con el 1 % (mínimo 2) el paladín, con 84 de maná a nivel 12,
 * pasaba más de la mitad de la pelea sin poder usar nada (K7). Solo vale mientras estás en combate contra jugadores.
 */
export const PVP_MP_REGEN_MIN = 5;
export const pvpMpRegen = (maxMp: number): number => Math.max(PVP_MP_REGEN_MIN, Math.round(maxMp * COMBAT_MP_REGEN_PCT));
/** Tope de los multiplicadores "sobre controlado" contra jugadores (Juicio y Escudo 1,5× → 1,2×; Esquirla 2× → 1,2×). */
export const PVP_VS_CTRL_MAX = 1.2;
/** Daño que llega a un jugador desde otro: primero el multiplicador PvP (antes de la defensa) y después el tope por golpe. */
export const pvpScale = (raw: number): number => Math.max(1, Math.round(raw * PVP_DMG_MULT));
export const pvpCap = (dmg: number, maxHp: number): number => Math.min(dmg, Math.max(1, Math.floor(maxHp * PVP_HIT_CAP)));
/** Multiplicador "sobre controlado" que se usa contra un jugador. */
export const pvpVsCtrl = (k: number): number => Math.min(k, PVP_VS_CTRL_MAX);
/** El recall se bloquea estos ms después de recibir daño de un jugador. */
export const RECALL_PVP_LOCK_MS = 10000;
/** Invisibilidad (para escapar, no para emboscar) y Detectar: recargas del server. */
export const INVIS_CD_MS = 60000, DETECT_CD_MS = 20000;

// ---------- Segundo aliento (común a todas las clases) ----------
/**
 * Casteo de 3 s quieto, recarga de 3,5 min; recupera la mitad de la vida y del maná máximos (menos si estás envenenado).
 * Lo corta un golpe directo (las quemaduras no), un aturdido o congelado, moverse o hacer otra cosa.
 */
export const SECOND_WIND = { castMs: 3000, cdMs: 210000, hp: 0.5, mp: 0.5, poisoned: 0.7 } as const;
export function secondWindHeal(maxHp: number, maxMp: number, poisoned: boolean): { hp: number; mp: number } {
    const k = poisoned ? SECOND_WIND.poisoned : 1;
    return { hp: Math.round(maxHp * SECOND_WIND.hp * k), mp: Math.round(maxMp * SECOND_WIND.mp * k) };
}

const rint = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));

/** Daño de un golpe del hechizo `id` (sin resistencias ni defensa: eso lo aplica quien lo recibe). */
/** Daño base por nivel (lo que suma cada nivel al Daño 1×). */
export const BASE_LVL_K = 2;
export function rollSpellDamage(id: string, s: CombatStats, fury: boolean): number {
    const sp = PVP_SPELLS[id] ?? SKILLS[id]; if (!sp || !sp.dmg) return 0;
    const bonus = s.dmgBonus ?? 0; // Bendición de poder
    let d = id === 'ataque' ? rint(...(MELEE[s.cls] ?? MELEE.paladin)) + s.plvl + rint(s.wdmg[0], s.wdmg[1]) + bonus
        : sp.k !== undefined ? (rint(sp.dmg[0], sp.dmg[1]) + s.plvl * BASE_LVL_K + (sp.stat === 'mag' ? s.mag : rint(s.wdmg[0], s.wdmg[1])) + bonus) * sp.k // múltiplo del Daño base (Valdrys)
        : rint(sp.dmg[0], sp.dmg[1]) + s.plvl * (sp.lvlK ?? 0) + (sp.stat === 'mag' ? s.mag : sp.stat === 'wdmg' ? rint(s.wdmg[0], s.wdmg[1]) : 0) + bonus;
    d = Math.round(d * (id === 'ataque' || sp.stat === 'wdmg' || sp.stat === 'melee' || sp.melee ? s.meleeMult : sp.stat === 'mag' ? s.magicMult : 1)); // Fuerza / Magia
    if (fury) d = Math.round(d * (FURY_MULT[s.cls] ?? 1.15));
    if (sp.stat === 'mag' && (s.critMag ?? 0) > 0 && Math.random() * 100 < s.critMag!) d = Math.round(d * CRIT_MULT); // Inteligencia: crítico en hechizos de daño
    return Math.max(1, d);
}

/** Estado de límites de un jugador: ráfagas por hechizo y último golpe por (hechizo, objetivo). */
export class PvpLimiter {
    private bursts = new Map<string, { start: number; end: number }>();
    private lastHit = new Map<string, number>();
    private castAt = new Map<string, number>();
    furyUntil = 0; furyCdUntil = 0;
    /** Ms mínimos entre dos golpes cuerpo a cuerpo (depende de la velocidad de ataque del equipo; lo fija el server al calcular los stats). */
    meleeGapMs = meleeIntervalSecs(0) * 1000;
    private lastMelee = -1e12;

    /** ¿Puede pegar ahora con `id` sobre `targetId`? Registra el golpe si sí. */
    allow(id: string, targetId: bigint, now: number, pay?: (cost: number) => boolean): boolean {
        const sp = PVP_SPELLS[id]; if (!sp) return false;
        if (id === 'ataque') { if (now - this.lastMelee < this.meleeGapMs * 0.9) return false; this.lastMelee = now; return true; } // 10 % de tolerancia por la red
        const win = sp.ticks ? sp.ticks * (sp.every ?? 0.5) + 0.7 : 0.6, b = this.bursts.get(id);
        const fresh = !b || now > b.end;
        if (fresh && b && now - b.start < sp.cd * 900) return false; // todavía en recarga
        const key = `${id}|${targetId}`, gap = (sp.ticks ? (sp.every ?? 0.5) * 0.8 : sp.cd * 0.9) * 1000;
        if (now - (this.lastHit.get(key) ?? 0) < gap) return false;
        // un lanzamiento nuevo cuesta maná (los golpes de un mismo lanzamiento, sobre varios objetivos o en varios ticks, no)
        const newCast = now - (this.castAt.get(id) ?? -1e12) >= sp.cd * 900;
        if (newCast) { if (pay && sp.mp > 0 && !pay(sp.mp)) return false; this.castAt.set(id, now); }
        if (fresh) this.bursts.set(id, { start: now, end: now + win * 1000 });
        this.lastHit.set(key, now);
        return true;
    }

    private aoeGroup = new Map<string, { start: number; n: number }>();
    /** Lugar (0, 1, 2...) que ocupa este golpe dentro del lanzamiento de área en curso, o -1 si ya se llegó al tope de objetivos. */
    aoeSlot(id: string, now: number): number {
        const max = AOE_MAX_TARGETS[id]; if (!max) return 0;
        let g = this.aoeGroup.get(id);
        if (!g || now - g.start > AOE_GROUP_MS) { g = { start: now, n: 0 }; this.aoeGroup.set(id, g); }
        if (g.n >= max) return -1;
        return g.n++;
    }

    private lastSecs = new Map<string, number>();
    /** La parálisis de un hechizo solo se aplica una vez por su recarga y objetivo. */
    allowSecs(id: string, targetId: bigint, now: number): boolean {
        const sp = PVP_SPELLS[id]; if (!sp?.secs) return false;
        const key = `${id}|${targetId}`; if (now - (this.lastSecs.get(key) ?? 0) < sp.cd * 900) return false;
        this.lastSecs.set(key, now); return true;
    }

    private skillAt = new Map<string, number>();
    /** ¿Terminó la recarga de la habilidad de clase `id`? (un 5 % de tolerancia por la latencia) */
    skillReady(id: string, now: number): boolean { const sp = SKILLS[id]; return !!sp && now - (this.skillAt.get(id) ?? -1e12) >= sp.cd * 950; }
    markSkill(id: string, now: number): void { this.skillAt.set(id, now); }

    castFury(now: number): boolean {
        if (now < this.furyCdUntil) return false;
        this.furyUntil = now + FURY_MS; this.furyCdUntil = now + FURY_CD_MS; return true;
    }
    get fury(): (now: number) => boolean { return (now) => now < this.furyUntil; }
}
