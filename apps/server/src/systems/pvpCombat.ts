/**
 * Daño PvP calculado en el server. El cliente solo dice "este hechizo, sobre aquel jugador": el daño sale de acá,
 * con las mismas fórmulas del juego, el nivel y el equipo del último guardado validado, la Furia que lleva el server,
 * y límites de recarga, alcance y ritmo por hechizo.
 */
import { BASE_BY_NAME, CRIT_BASE, MAX_LEVEL, aspdTotal, critTotal, leechTotal, meleeIntervalSecs, statBonus, upMult, type Stats } from '@fdn/world';
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
/** Movimiento (docs/COMBATE.md): walk 333 ms/celda permite castear; run 200 ms/celda no. Cap duro 200 ms/celda: ningún buff baja de ahí. */
export const WALK_MS = 333, RUN_MS = 200, MOVE_CAP_MS = 200;
/** Escala de cast times (ms). */
export const CAST_FAST_MS = 750, CAST_NORMAL_MS = 1000, CAST_HEAVY_MS = 1500, CAST_TELEGRAPH_MS = 2400;
/** true si el hechizo es un cast (no golpe cuerpo a cuerpo): esos no se pueden lanzar corriendo. */
/** Cast time de cada hechizo (ms); los que no figuran usan CAST_FAST_MS. Lo decide el server: el cliente no lo puede cambiar. */
export const CAST_MS: Record<string, number> = { proyectil: CAST_FAST_MS, esquirla: CAST_NORMAL_MS, paralisis: CAST_NORMAL_MS, bola: CAST_HEAVY_MS, lluvia: CAST_TELEGRAPH_MS, juicio: CAST_NORMAL_MS };
export const castMsOf = (id: string): number => CAST_MS[id] ?? CAST_FAST_MS;
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
    proyectil: { mp: 14, dmg: [14, 21], k: 1, stat: 'mag', range: 15, cd: 0.35 },                                     // Saeta ígnea: cast 0,75 s
    esquirla: { mp: 24, dmg: [14, 21], k: 1.2, stat: 'mag', range: 15, cd: 0.7, slow: 3, vsCtrl: 2 },                   // Esquirla de hielo: cast 1 s, frena 3 s
    paralisis: { mp: 36, dmg: [14, 21], k: 0.2, stat: 'mag', secs: 5, range: 15, cd: 6 },                             // Cadenas de hielo: cast 1 s, congela 5 s
    ignicion: { mp: 30, dmg: [14, 21], k: 0.5, stat: 'mag', range: 15, cd: 5, cast: false, burn: true },                // Ignición: instantánea + quemadura
    bola: { mp: 72, kind: 'eruption', dmg: [14, 21], k: 3, stat: 'mag', range: 15, cd: 10, burn: true, vsBurn: 1.4 },  // Bola de fuego: cast 1,5 s, un objetivo
    lluvia: { mp: 90, kind: 'cataclysm', dmg: [14, 21], k: 1.2, stat: 'mag', range: 15, cd: 18, aoe: 4.5, burn: true }, // Infierno: cast 2,4 s, área
    // Paladín. Daño = múltiplo del Daño base físico (arma).
    golpe: { mp: 10, dmg: [14, 20], lvlK: 2, stat: 'wdmg', range: 2.8, cd: 0.9, melee: true },                        // Golpe: cuerpo a cuerpo, sin cast
    juicio: { mp: 15, dmg: [14, 20], k: 1.5, stat: 'wdmg', range: 4, cd: 1.4, cast: true, lifesteal: 0.5, vsCtrl: 1.5, threat: 3 }, // Juicio: cast 1 s
    escudo: { mp: 36, dmg: [14, 20], k: 2.3, stat: 'wdmg', secs: 3, range: 10, cd: 9, cast: false, vsCtrl: 1.5, threat: 5 },    // Escudo vengador: aturde 3 s
    aturdir: { mp: 30, dmg: [14, 20], k: 0.8, stat: 'wdmg', secs: 3, range: 8, cd: 11, taunt: 3 },                     // Martillo de justicia: aturde y provoca 3 s
};
/**
 * Habilidades de clase (las valida y cobra el server): Mago = blink; Paladin (id interno 'guerrero', persistido) = carga, giro, grito.
 * Van aparte de PVP_SPELLS a propósito: no se pueden pedir por pvpHitRequest para pegar sin moverse.
 */
export interface ClassSkill extends PvpSpell { cls: 'mago' | 'guerrero'; /** aturdimiento (s) al llegar */ stun?: number; /** congelado (s) a los que alcanza (Nova) */ freeze?: number; /** barridos seguidos (Barrido: 2, a 0,25 s) */ sweeps?: number; /** pulsos de un aura (Aura sagrada: 20, uno cada `every` s) */ pulses?: number }
export const SKILLS: Record<string, ClassSkill> = {
    blink: { cls: 'mago', mp: 0, range: 7.25, cd: 12 },                                                                  // Parpadeo: sin maná (Valdrys)
    nova: { cls: 'mago', mp: 60, dmg: [14, 21], k: 0.8, stat: 'mag', range: 0, cd: 8, aoe: 3, freeze: 2, cast: false }, // Nova de escarcha: congela 2 s alrededor
    carga: { cls: 'guerrero', mp: 60, dmg: [14, 20], k: 0.6, stat: 'wdmg', range: 15, cd: 18, melee: true, stun: 1, threat: 3 }, // Carga sagrada: aturde 1 s al llegar
    giro: { cls: 'guerrero', mp: 36, dmg: [14, 20], k: 0.75, stat: 'wdmg', range: 0, cd: 8, melee: true, aoe: 2, sweeps: 2, threat: 3 }, // Barrido: 2 × 0,75
    mandato: { cls: 'guerrero', mp: 42, range: 0, cd: 6, aoe: 6, taunt: 7 },                                              // Mandato: provoca a los monstruos cercanos 7 s
    aura: { cls: 'guerrero', mp: 48, dmg: [14, 20], k: 0.25, stat: 'wdmg', range: 0, cd: 15, melee: true, aoe: 3, pulses: 20, every: 0.5, threat: 3 }, // Aura sagrada: 10 s de pulsos
    grito: { cls: 'guerrero', mp: 20, range: 0, cd: 25 },                                                                  // pasa a Bendición de poder en K8
};
/** Golpes de área contra mobs (paso 1.4): máximo de objetivos por lanzamiento (los más cercanos al centro) y caída de daño por cada objetivo extra. */
export const AOE_MAX_TARGETS: Record<string, number> = { lluvia: 5, giro: 4, nova: 5, aura: 5 };
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
/** Grito de guerra: duración (ms), radio de aliados y defensa plana que suma. */
export const WARCRY_MS = 10000, WARCRY_RADIUS = 5, WARCRY_DEF = 15;
export const FURY_MS = 60000, FURY_CD_MS = 90000;
/** Furia por clase: el mago la tira más fuerte (todo su daño), el guerrero más débil. */
export const FURY_MULT: Record<string, number> = { mago: 1.35, guerrero: 1.15 };
/** Costos de maná de los hechizos de utilidad que cobra el server (iguales a los del cliente). */
export const UTIL_MP = { furia: 15, invisibilidad: 40, detectar: 30, remover: 20 } as const;
/** Maná por clase (base, por nivel) y poción: mismas cuentas que el cliente. */
/** Regen de maná fuera de ciudad (incluye combate): 1 % del pool por segundo, mínimo 2/s (el piso viejo). */
export const COMBAT_MP_REGEN_PCT = 0.01;
export const combatMpRegen = (maxMp: number): number => Math.max(2, Math.round(maxMp * COMBAT_MP_REGEN_PCT));
const CLASS_MP: Record<string, [number, number]> = { guerrero: [40, 4], mago: [90, 12] };
export const potionMp = (maxMp: number) => Math.max(40, Math.round(maxMp * 0.5));

export interface CombatStats { lvl: number; cls: string; /** multiplicadores de daño por Fuerza (físico) y Magia (hechizos) */ meleeMult: number; magicMult: number; mag: number; wdmg: [number, number]; maxHp: number; def: number; rm: number; rpar: number; /** crítico total %, velocidad de ataque %, robo de vida % y chance de veneno % (ya con topes) */ crit: number; aspd: number; leech: number; poison: number; savedHp: number; maxMp: number; savedMp: number }
const CLASS_HP: Record<string, [number, number]> = { guerrero: [593, 76], mago: [381, 42] };
export const DEFAULT_STATS: CombatStats = { lvl: 1, cls: 'guerrero', meleeMult: 1, magicMult: 1, mag: 0, wdmg: [0, 0], maxHp: 140, def: 0, rm: 0, rpar: 0, crit: 5, aspd: 0, leech: 0, poison: 0, savedHp: 140, maxMp: 40, savedMp: 40 };

/** Las bases de items son las compartidas de @fdn/world (el cliente usa las mismas). */
const MELEE: Record<string, [number, number]> = { guerrero: [5, 9], mago: [2, 4] };

/** Lo mínimo del personaje que hace falta para calcular los stats de combate: nivel, clase, vida/maná guardados y el EQUIPO. */
export interface StatSource { lvl: number; cls: string; stats?: Stats; hp?: number; mp?: number; eq: Partial<Record<string, { n: string; a?: { id: string; v: number }[]; up?: number } | null>> }

/** Stats de combate a partir del personaje del server (equipo autoritativo, ver economy.ts). */
export function statsFromChar(o: StatSource | undefined, uncapCrit = false): CombatStats {
    if (!o) return { ...DEFAULT_STATS };
    const cls = o.cls === 'mago' ? 'mago' : 'guerrero', lvl = Math.max(1, Math.min(MAX_LEVEL, Number(o.lvl) || 1));
    const s: CombatStats = { lvl, cls, meleeMult: 1, magicMult: 1, mag: 0, wdmg: [0, 0], maxHp: 0, def: 0, rm: 0, rpar: 0, crit: 5, aspd: 0, leech: 0, poison: 0, savedHp: 1, maxMp: 0, savedMp: 0 };
    let bonusHp = 0, bonusMp = 0, itemCrit = 0, itemAspd = 0, itemLeech = 0;
    for (const [slot, it] of Object.entries(o.eq ?? {})) {
        if (!it) continue;
        const b = BASE_BY_NAME.get(it.n);
        if (b && b.slot === slot) { const k = upMult(it.up); if (b.dmg) s.wdmg = k === 1 ? b.dmg : [Math.round(b.dmg[0] * k), Math.round(b.dmg[1] * k)]; if (b.mag) s.mag += Math.round(b.mag * k); if (b.def) s.def += Math.round(b.def * k); if (b.rm) s.rm += Math.round(b.rm * k); }
        for (const a of it.a ?? []) { if (a.id === 'mag') s.mag += a.v; else if (a.id === 'hp') bonusHp += a.v; else if (a.id === 'mp') bonusMp += a.v; else if (a.id === 'df') s.def += a.v; else if (a.id === 'rm' || a.id === 'fres' || a.id === 'ires') s.rm += a.v; /* fres/ires: atributos viejos, ahora valen RM 1:1 */ else if (a.id === 'rpar') s.rpar += a.v; else if (a.id === 'crit') itemCrit += a.v; else if (a.id === 'aspd') itemAspd += a.v; else if (a.id === 'leech') itemLeech += a.v; else if (a.id === 'poison') s.poison += a.v; }
    }
    s.crit = uncapCrit ? Math.min(100, CRIT_BASE + itemCrit) : critTotal(itemCrit); s.aspd = aspdTotal(itemAspd); s.leech = leechTotal(itemLeech); s.poison = Math.min(100, s.poison); // topes del paso 1.3
    const sb = statBonus(o.stats); // puntos de Fuerza, Vitalidad, Destreza y Magia
    bonusHp += sb.hp; bonusMp += sb.mp; s.def += sb.def; s.meleeMult = sb.meleeMult; s.magicMult = sb.magicMult;
    const [hp0, hpL] = CLASS_HP[cls];
    s.maxHp = hp0 + (lvl - 1) * hpL + bonusHp;
    const [mp0, mpL] = CLASS_MP[cls];
    s.maxMp = mp0 + (lvl - 1) * mpL + bonusMp;
    s.savedMp = Math.max(0, Math.min(s.maxMp, Math.round(Number(o.mp) || 0)));
    s.savedHp = Math.max(1, Math.min(s.maxHp, Math.round(Number(o.hp) || s.maxHp)));
    return s;
}

/** Progreso para los portales (del estado del server) */
export function progressFromEcon(st: { lvl: number; q: { i: number; keys: Record<string, number> }; u: string[] } | undefined): { qi: number; lvl: number; keys: Record<string, number>; unlocked: string[] } {
    return st ? { qi: st.q.i, lvl: st.lvl, keys: { ...st.q.keys }, unlocked: [...st.u] } : { qi: 0, lvl: 1, keys: {}, unlocked: [] };
}

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
/** Delay global entre pociones (vida o maná), independiente de los hechizos. */
export const POTION_GCD_MS = 1750;
/** Tolerancia por jitter de red: el server acepta una poción si pasaron al menos GCD - esto. */
export const POTION_GCD_SLACK_MS = 100;
/** Vida: parte instantánea y el resto en `POTION_HOT_TICKS` ticks cada `POTION_HOT_EVERY_MS` (2 s en total). */
export const POTION_INSTANT = 0.2, POTION_HOT_TICKS = 4, POTION_HOT_EVERY_MS = 500;
export const potionHp = (maxHp: number) => Math.max(50, Math.round(maxHp * 0.4));
/** Reparto de una poción de vida: [instantáneo, ...ticks]; la suma da exactamente `total`. */
export function potionHpSplit(total: number): number[] {
    const first = Math.round(total * POTION_INSTANT), rest = total - first, tick = Math.floor(rest / POTION_HOT_TICKS);
    return [first, ...Array.from({ length: POTION_HOT_TICKS }, (_, i) => (i === POTION_HOT_TICKS - 1 ? rest - tick * (POTION_HOT_TICKS - 1) : tick))];
}

const rint = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));

/** Daño de un golpe del hechizo `id` (sin resistencias ni defensa: eso lo aplica quien lo recibe). */
/** Daño base por nivel (lo que suma cada nivel al Daño 1×). */
export const BASE_LVL_K = 2;
export function rollSpellDamage(id: string, s: CombatStats, fury: boolean): number {
    const sp = PVP_SPELLS[id] ?? SKILLS[id]; if (!sp || !sp.dmg) return 0;
    let d = id === 'ataque' ? rint(...(MELEE[s.cls] ?? MELEE.guerrero)) + s.lvl + rint(s.wdmg[0], s.wdmg[1])
        : sp.k !== undefined ? (rint(sp.dmg[0], sp.dmg[1]) + s.lvl * BASE_LVL_K + (sp.stat === 'mag' ? s.mag : rint(s.wdmg[0], s.wdmg[1]))) * sp.k // múltiplo del Daño base (Valdrys)
        : rint(sp.dmg[0], sp.dmg[1]) + s.lvl * (sp.lvlK ?? 0) + (sp.stat === 'mag' ? s.mag : sp.stat === 'wdmg' ? rint(s.wdmg[0], s.wdmg[1]) : 0);
    d = Math.round(d * (id === 'ataque' || sp.stat === 'wdmg' || sp.stat === 'melee' || sp.melee ? s.meleeMult : sp.stat === 'mag' ? s.magicMult : 1)); // Fuerza / Magia
    if (fury) d = Math.round(d * (FURY_MULT[s.cls] ?? 1.15));
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
