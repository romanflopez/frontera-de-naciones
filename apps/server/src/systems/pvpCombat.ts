/**
 * Daño PvP calculado en el server. El cliente solo dice "este hechizo, sobre aquel jugador": el daño sale de acá,
 * con las mismas fórmulas del juego, el nivel y el equipo del último guardado validado, la Furia que lleva el server,
 * y límites de recarga, alcance y ritmo por hechizo.
 */
export type Stat = 'mag' | 'wdmg' | 'melee';
export interface PvpSpell {
    dmg?: [number, number]; lvlK?: number; stat?: Stat;
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
export const PVP_SPELLS: Record<string, PvpSpell> = {
    ataque: { mp: 0, dmg: [0, 0], lvlK: 1, stat: 'melee', range: 2.6, cd: 0.3, melee: true },
    proyectil: { mp: 8, dmg: [12, 18], lvlK: 2, stat: 'mag', range: 9.5, cd: 0.35 },
    paralisis: { mp: 20, secs: 3, range: 7.5, cd: 4 },
    aturdir: { mp: 18, secs: 2.5, range: 2.8, cd: 5 },
    hoja: { mp: 14, dmg: [13, 19], lvlK: 2, stat: 'mag', range: 8.5, cd: 1.4 },
    lanza: { mp: 30, dmg: [30, 42], lvlK: 3, stat: 'mag', range: 8.5, cd: 4.5 },
    golpe: { mp: 10, dmg: [14, 20], lvlK: 2, stat: 'wdmg', range: 2.8, cd: 0.9, melee: true },
    tajo: { mp: 12, dmg: [22, 30], lvlK: 3, stat: 'wdmg', range: 2.8, cd: 0.9, melee: true },
    bola: { mp: 25, kind: 'eruption', dmg: [18, 26], lvlK: 2, stat: 'mag', range: 9, cd: 3.6, aoe: 1.9 },
    lluvia: { mp: 45, kind: 'cataclysm', dmg: [11, 16], lvlK: 2, stat: 'mag', range: 9, cd: 8.5, ticks: 4, every: 0.5, aoe: 2.4 },
    ventisca: { mp: 50, kind: 'blizz', dmg: [9, 14], lvlK: 2, stat: 'mag', range: 9, cd: 9.5, ticks: 6, every: 0.4, aoe: 2.7, secs: 1.5 },
    marejada: { mp: 40, kind: 'tidal', dmg: [12, 17], lvlK: 2, stat: 'mag', range: 9, cd: 7.5, ticks: 3, every: 0.6, aoe: 2.2, secs: 1.2 },
    sismo: { mp: 25, dmg: [12, 18], lvlK: 2, stat: 'wdmg', range: 2.5, cd: 5.5, aoe: 2.4 },
    luz: { mp: 35, dmg: [14, 20], lvlK: 2, stat: 'mag', range: 9, cd: 6.5, ticks: 2, every: 0.7, aoe: 1.9 },
};
/**
 * Habilidades de clase (las valida y cobra el server): Mago = blink; Guerrero = carga, giro, grito.
 * Van aparte de PVP_SPELLS a propósito: no se pueden pedir por pvpHitRequest para pegar sin moverse.
 */
export interface ClassSkill extends PvpSpell { cls: 'mago' | 'guerrero'; /** ralentización (s) que aplica */ slow?: number }
export const SKILLS: Record<string, ClassSkill> = {
    // blink: ≈ 39 % del maná base del Mago a nivel 1 (90); alcance en celdas
    blink: { cls: 'mago', mp: 35, range: 4.25, cd: 12 },
    carga: { cls: 'guerrero', mp: 15, dmg: [14, 20], lvlK: 2, stat: 'wdmg', range: 6.3, cd: 10, melee: true, slow: 1.5 },
    giro: { cls: 'guerrero', mp: 8, dmg: [16, 22], lvlK: 2, stat: 'wdmg', range: 0, cd: 4, melee: true, aoe: 1.9 },
    grito: { cls: 'guerrero', mp: 20, range: 0, cd: 25 },
};
/** Grito de guerra: duración (ms), radio de aliados y defensa plana que suma. */
export const WARCRY_MS = 10000, WARCRY_RADIUS = 5, WARCRY_DEF = 15;
export const FURY_MS = 10000, FURY_CD_MS = 18000;
/** Costos de maná de los hechizos de utilidad que cobra el server (iguales a los del cliente). */
export const UTIL_MP = { furia: 15, invisibilidad: 40, detectar: 30, remover: 20 } as const;
/** Maná por clase (base, por nivel) y poción: mismas cuentas que el cliente. */
const CLASS_MP: Record<string, [number, number]> = { guerrero: [40, 4], mago: [90, 12] };
export const potionMp = (maxMp: number) => Math.max(40, Math.round(maxMp * 0.5));

export interface CombatStats { lvl: number; cls: string; mag: number; wdmg: [number, number]; maxHp: number; def: number; rm: number; rpar: number; savedHp: number; maxMp: number; savedMp: number }
const CLASS_HP: Record<string, [number, number]> = { guerrero: [140, 18], mago: [90, 10] };
export const DEFAULT_STATS: CombatStats = { lvl: 1, cls: 'guerrero', mag: 0, wdmg: [0, 0], maxHp: 140, def: 0, rm: 0, rpar: 0, savedHp: 140, maxMp: 40, savedMp: 40 };

/** Bases de items (mismas que el cliente): arma con daño, y bonos de magia. */
const BASE: Record<string, { dmg?: [number, number]; mag?: number; def?: number; rm?: number; slot: string }> = {
    'Espada corta': { dmg: [4, 8], slot: 'arma' }, 'Hacha de leñador': { dmg: [6, 11], slot: 'arma' }, 'Báculo de fresno': { dmg: [2, 4], mag: 5, slot: 'arma' },
    'Espada larga': { dmg: [7, 12], slot: 'arma' }, 'Hacha de guerra': { dmg: [9, 15], slot: 'arma' }, 'Maza': { dmg: [6, 11], slot: 'arma' },
    'Martillo pesado': { dmg: [10, 16], slot: 'arma' }, 'Mandoble': { dmg: [12, 18], slot: 'arma' }, 'Varita': { dmg: [1, 3], mag: 8, slot: 'arma' },
    // DF = defensa física, RM = resistencia mágica (ver docs/COMBATE.md): mitigación = X / (100 + X)
    'Túnica de mago': { mag: 4, def: 4, rm: 24, slot: 'armadura' }, 'Capucha de mago': { mag: 3, def: 2, rm: 10, slot: 'cabeza' },
    'Coraza de cuero': { def: 12, rm: 4, slot: 'armadura' }, 'Cota de malla': { def: 22, rm: 8, slot: 'armadura' }, 'Armadura de placas': { def: 34, rm: 12, slot: 'armadura' }, 'Ropas de tela': { def: 4, rm: 6, slot: 'armadura' },
    'Capucha de cuero': { def: 4, rm: 2, slot: 'cabeza' }, 'Cofia de malla': { def: 8, rm: 3, slot: 'cabeza' }, 'Yelmo de hierro': { def: 12, rm: 4, slot: 'cabeza' },
    'Anillo opaco': { rm: 8, slot: 'anillo' },
};
const MELEE: Record<string, [number, number]> = { guerrero: [5, 9], mago: [2, 4] };

/** Stats de combate a partir del JSON del personaje ya validado por `sanitizeCharacter`. */
export function statsFromCharacter(json: string | undefined): CombatStats {
    if (!json) return { ...DEFAULT_STATS };
    try {
        const o = JSON.parse(json) as { lvl?: number; cls?: string; hp?: number; mp?: number; eq?: Record<string, { n: string; a?: { id: string; v: number }[] } | null> };
        const cls = o.cls === 'mago' ? 'mago' : 'guerrero', lvl = Math.max(1, Math.min(60, Number(o.lvl) || 1));
        const s: CombatStats = { lvl, cls, mag: 0, wdmg: [0, 0], maxHp: 0, def: 0, rm: 0, rpar: 0, savedHp: 1, maxMp: 0, savedMp: 0 };
        let bonusHp = 0, bonusMp = 0;
        for (const [slot, it] of Object.entries(o.eq ?? {})) {
            if (!it) continue;
            const b = BASE[it.n];
            if (b && b.slot === slot) { if (b.dmg) s.wdmg = b.dmg; if (b.mag) s.mag += b.mag; if (b.def) s.def += b.def; if (b.rm) s.rm += b.rm; }
            for (const a of it.a ?? []) { if (a.id === 'mag') s.mag += a.v; else if (a.id === 'hp') bonusHp += a.v; else if (a.id === 'mp') bonusMp += a.v; else if (a.id === 'df') s.def += a.v; else if (a.id === 'rm' || a.id === 'fres' || a.id === 'ires') s.rm += a.v; /* fres/ires: atributos viejos, ahora valen RM 1:1 */ else if (a.id === 'rpar') s.rpar += a.v; }
        }
        const [hp0, hpL] = CLASS_HP[cls];
        s.maxHp = hp0 + (lvl - 1) * hpL + bonusHp;
        const [mp0, mpL] = CLASS_MP[cls];
        s.maxMp = mp0 + (lvl - 1) * mpL + bonusMp;
        s.savedMp = Math.max(0, Math.min(s.maxMp, Math.round(Number(o.mp) || 0)));
        s.savedHp = Math.max(1, Math.min(s.maxHp, Math.round(Number(o.hp) || s.maxHp)));
        return s;
    } catch { return { ...DEFAULT_STATS }; }
}

/** Progreso para los portales (misiones entregadas, nivel, llaves, portales abiertos) a partir del JSON ya validado. */
export function progressFromCharacter(json: string | undefined): { qi: number; lvl: number; keys: Record<string, number>; unlocked: string[] } {
    const out = { qi: 0, lvl: 1, keys: {} as Record<string, number>, unlocked: [] as string[] };
    if (!json) return out;
    try {
        const o = JSON.parse(json) as { lvl?: number; q?: { i?: number; keys?: Record<string, number> }; u?: unknown };
        out.lvl = Math.max(1, Math.min(60, Number(o.lvl) || 1)); out.qi = Math.max(0, Number(o.q?.i) || 0);
        for (const [k, v] of Object.entries(o.q?.keys ?? {})) out.keys[k] = Math.max(0, Number(v) || 0);
        out.unlocked = Array.isArray(o.u) ? o.u.filter((x): x is string => typeof x === 'string') : [];
    } catch { /* se queda con lo básico */ }
    return out;
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
export function rollSpellDamage(id: string, s: CombatStats, fury: boolean): number {
    const sp = PVP_SPELLS[id] ?? SKILLS[id]; if (!sp || !sp.dmg) return 0;
    let d = id === 'ataque' ? rint(...(MELEE[s.cls] ?? MELEE.guerrero)) + s.lvl + rint(s.wdmg[0], s.wdmg[1])
        : rint(sp.dmg[0], sp.dmg[1]) + s.lvl * (sp.lvlK ?? 0) + (sp.stat === 'mag' ? s.mag : sp.stat === 'wdmg' ? rint(s.wdmg[0], s.wdmg[1]) : 0);
    if (sp.aoe && (sp.stat === 'mag' && id === 'bola')) d = Math.round(d * (0.85 + Math.random() * 0.3));
    if (fury) d = Math.round(d * (sp.melee ? 1.3 : s.cls === 'mago' ? 1.2 : 1));
    return Math.max(1, d);
}

/** Estado de límites de un jugador: ráfagas por hechizo y último golpe por (hechizo, objetivo). */
export class PvpLimiter {
    private bursts = new Map<string, { start: number; end: number }>();
    private lastHit = new Map<string, number>();
    private castAt = new Map<string, number>();
    furyUntil = 0; furyCdUntil = 0;

    /** ¿Puede pegar ahora con `id` sobre `targetId`? Registra el golpe si sí. */
    allow(id: string, targetId: bigint, now: number, pay?: (cost: number) => boolean): boolean {
        const sp = PVP_SPELLS[id]; if (!sp) return false;
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
