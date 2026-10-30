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
    range: number; cd: number; ticks?: number; every?: number; aoe?: number; melee?: boolean;
}
export const PVP_SPELLS: Record<string, PvpSpell> = {
    ataque: { dmg: [0, 0], lvlK: 1, stat: 'melee', range: 2.6, cd: 0.3, melee: true },
    proyectil: { dmg: [12, 18], lvlK: 2, stat: 'mag', range: 9.5, cd: 0.35 },
    paralisis: { secs: 3, range: 7.5, cd: 4 },
    aturdir: { secs: 2.5, range: 2.8, cd: 5 },
    hoja: { dmg: [13, 19], lvlK: 2, stat: 'mag', range: 8.5, cd: 1.4 },
    lanza: { dmg: [30, 42], lvlK: 3, stat: 'mag', range: 8.5, cd: 4.5 },
    golpe: { dmg: [14, 20], lvlK: 2, stat: 'wdmg', range: 2.8, cd: 0.9, melee: true },
    tajo: { dmg: [22, 30], lvlK: 3, stat: 'wdmg', range: 2.8, cd: 0.9, melee: true },
    bola: { dmg: [18, 26], lvlK: 2, stat: 'mag', range: 9, cd: 3.6, aoe: 1.9 },
    lluvia: { dmg: [11, 16], lvlK: 2, stat: 'mag', range: 9, cd: 8.5, ticks: 4, every: 0.5, aoe: 2.4 },
    ventisca: { dmg: [9, 14], lvlK: 2, stat: 'mag', range: 9, cd: 9.5, ticks: 6, every: 0.4, aoe: 2.7, secs: 1.5 },
    marejada: { dmg: [12, 17], lvlK: 2, stat: 'mag', range: 9, cd: 7.5, ticks: 3, every: 0.6, aoe: 2.2, secs: 1.2 },
    sismo: { dmg: [12, 18], lvlK: 2, stat: 'wdmg', range: 2.5, cd: 5.5, aoe: 2.4 },
    luz: { dmg: [14, 20], lvlK: 2, stat: 'mag', range: 9, cd: 6.5, ticks: 2, every: 0.7, aoe: 1.9 },
};
export const FURY_MS = 10000, FURY_CD_MS = 18000;

export interface CombatStats { lvl: number; cls: string; mag: number; wdmg: [number, number] }
export const DEFAULT_STATS: CombatStats = { lvl: 1, cls: 'guerrero', mag: 0, wdmg: [0, 0] };

/** Bases de items (mismas que el cliente): arma con daño, y bonos de magia. */
const BASE: Record<string, { dmg?: [number, number]; mag?: number; slot: string }> = {
    'Espada corta': { dmg: [4, 8], slot: 'arma' }, 'Hacha de leñador': { dmg: [6, 11], slot: 'arma' }, 'Báculo de fresno': { dmg: [2, 4], mag: 5, slot: 'arma' },
    'Espada larga': { dmg: [7, 12], slot: 'arma' }, 'Hacha de guerra': { dmg: [9, 15], slot: 'arma' }, 'Maza': { dmg: [6, 11], slot: 'arma' },
    'Martillo pesado': { dmg: [10, 16], slot: 'arma' }, 'Mandoble': { dmg: [12, 18], slot: 'arma' }, 'Varita': { dmg: [1, 3], mag: 8, slot: 'arma' },
    'Túnica de mago': { mag: 4, slot: 'armadura' }, 'Capucha de mago': { mag: 3, slot: 'cabeza' },
};
const MELEE: Record<string, [number, number]> = { guerrero: [5, 9], mago: [2, 4] };

/** Stats de combate a partir del JSON del personaje ya validado por `sanitizeCharacter`. */
export function statsFromCharacter(json: string | undefined): CombatStats {
    if (!json) return { ...DEFAULT_STATS };
    try {
        const o = JSON.parse(json) as { lvl?: number; cls?: string; eq?: Record<string, { n: string; a?: { id: string; v: number }[] } | null> };
        const s: CombatStats = { lvl: Math.max(1, Math.min(60, Number(o.lvl) || 1)), cls: o.cls === 'mago' ? 'mago' : 'guerrero', mag: 0, wdmg: [0, 0] };
        for (const [slot, it] of Object.entries(o.eq ?? {})) {
            if (!it) continue;
            const b = BASE[it.n];
            if (b && b.slot === slot) { if (b.dmg) s.wdmg = b.dmg; if (b.mag) s.mag += b.mag; }
            for (const a of it.a ?? []) if (a.id === 'mag') s.mag += a.v;
        }
        return s;
    } catch { return { ...DEFAULT_STATS }; }
}

const rint = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));

/** Daño de un golpe del hechizo `id` (sin resistencias ni defensa: eso lo aplica quien lo recibe). */
export function rollSpellDamage(id: string, s: CombatStats, fury: boolean): number {
    const sp = PVP_SPELLS[id]; if (!sp || !sp.dmg) return 0;
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
    furyUntil = 0; furyCdUntil = 0;

    /** ¿Puede pegar ahora con `id` sobre `targetId`? Registra el golpe si sí. */
    allow(id: string, targetId: bigint, now: number): boolean {
        const sp = PVP_SPELLS[id]; if (!sp) return false;
        const win = sp.ticks ? sp.ticks * (sp.every ?? 0.5) + 0.7 : 0.6, b = this.bursts.get(id);
        if (!b || now > b.end) {
            if (b && now - b.start < sp.cd * 900) return false; // todavía en recarga
            this.bursts.set(id, { start: now, end: now + win * 1000 });
        }
        const key = `${id}|${targetId}`, gap = (sp.ticks ? (sp.every ?? 0.5) * 0.8 : sp.cd * 0.9) * 1000;
        if (now - (this.lastHit.get(key) ?? 0) < gap) return false;
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

    castFury(now: number): boolean {
        if (now < this.furyCdUntil) return false;
        this.furyUntil = now + FURY_MS; this.furyCdUntil = now + FURY_CD_MS; return true;
    }
    get fury(): (now: number) => boolean { return (now) => now < this.furyUntil; }
}
