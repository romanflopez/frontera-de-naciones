/**
 * Mobs: definiciones compartidas entre cliente y server (el server los simula, el cliente los dibuja).
 */
export type MobType = 'goblin' | 'zombie' | 'skeleton' | 'barbaro' | 'goblin_elite' | 'antlion' | 'skeleton_mage' | 'fire_ant' | 'wyvern' | 'minotaur' | 'arana' | 'golem' | 'demonio'
    // tipos nuevos (docs/MOBS_NUEVOS.md): siempre al final, el protocolo manda el índice
    | 'hobgoblin' | 'hobgoblin_archer' | 'skeleton_archer' | 'zombie_dark' | 'cursed_grave' | 'ice_ant' | 'antlion_small' | 'wyvern_fire' | 'wyvern_ice';
/** Orden fijo: el protocolo manda el índice del tipo. */
export const MOB_TYPES: MobType[] = ['goblin', 'zombie', 'skeleton', 'barbaro', 'goblin_elite', 'antlion', 'skeleton_mage', 'fire_ant', 'wyvern', 'minotaur', 'arana', 'golem', 'demonio',
    'hobgoblin', 'hobgoblin_archer', 'skeleton_archer', 'zombie_dark', 'cursed_grave', 'ice_ant', 'antlion_small', 'wyvern_fire', 'wyvern_ice'];
/** Habilidad de boss: cada `every` s, si el jugador está a menos de `range`, carga un golpe y lo lanza a los 0,8 s. Alcanza a quien esté a menos de `r`. */
export interface BossSpecial { name: string; every: number; range: number; r: number; dmg?: [number, number]; stun?: number; col: string }
export interface BossDef { respawn: number; minRar: number; gold: [number, number]; special: BossSpecial }
export interface MobDef { name: string; lvl: number; hp: number; dmg: [number, number]; spd: number; ref: number; exp: number; hitR: number; head: number; atk: number; boss?: BossDef }
export const MOBS: Record<MobType, MobDef> = {
    goblin: { name: 'Goblin lancero', lvl: 1, hp: 42, dmg: [4, 7], spd: 1.8, ref: 2.6, exp: 14, hitR: 20, head: 42, atk: 1.3 },
    zombie: { name: 'Zombi del pantano', lvl: 3, hp: 85, dmg: [7, 11], spd: 1.0, ref: 1.5, exp: 30, hitR: 22, head: 50, atk: 1.6 },
    barbaro: { name: 'Bárbaro sangriento', lvl: 8, hp: 900, dmg: [18, 28], spd: 1.3, ref: 2.4, exp: 420, hitR: 40, head: 90, atk: 1.8, boss: { respawn: 120, minRar: 2, gold: [60, 110], special: { name: 'Rugido', every: 11, range: 3.2, r: 3, stun: 1.2, dmg: [8, 12], col: '#ff8a4a' } } },
    arana: { name: 'Reina araña', lvl: 7, hp: 720, dmg: [14, 22], spd: 1.7, ref: 2.8, exp: 520, hitR: 52, head: 88, atk: 1.4, boss: { respawn: 150, minRar: 2, gold: [70, 120], special: { name: 'Telaraña', every: 9, range: 4, r: 3.5, stun: 1.8, col: '#9fe8ff' } } },
    golem: { name: 'Gólem de hielo', lvl: 10, hp: 1300, dmg: [24, 34], spd: 1.0, ref: 1.8, exp: 900, hitR: 50, head: 112, atk: 2.0, boss: { respawn: 180, minRar: 2, gold: [110, 170], special: { name: 'Grito helado', every: 10, range: 3, r: 3, dmg: [30, 42], stun: 0.8, col: '#7fd6ff' } } },
    demonio: { name: 'Demonio del foso', lvl: 12, hp: 1900, dmg: [30, 44], spd: 1.4, ref: 2.4, exp: 1500, hitR: 44, head: 120, atk: 1.7, boss: { respawn: 240, minRar: 3, gold: [180, 260], special: { name: 'Salto sísmico', every: 12, range: 4.5, r: 3.2, dmg: [45, 60], stun: 1, col: '#ff5a3c' } } },
    skeleton: { name: 'Esqueleto guerrero', lvl: 5, hp: 150, dmg: [11, 17], spd: 1.5, ref: 2.1, exp: 62, hitR: 23, head: 53, atk: 1.4 },
    goblin_elite: { name: 'Goblin de élite', lvl: 2, hp: 62, dmg: [5, 9], spd: 1.9, ref: 2.6, exp: 22, hitR: 21, head: 46, atk: 1.2 },
    antlion: { name: 'Hormiga león', lvl: 4, hp: 115, dmg: [9, 14], spd: 1.5, ref: 2.0, exp: 45, hitR: 24, head: 40, atk: 1.5 },
    skeleton_mage: { name: 'Esqueleto hechicero', lvl: 5, hp: 130, dmg: [12, 18], spd: 1.3, ref: 2.1, exp: 58, hitR: 22, head: 55, atk: 1.6 },
    fire_ant: { name: 'Hormiga de fuego', lvl: 6, hp: 190, dmg: [13, 20], spd: 1.7, ref: 2.0, exp: 80, hitR: 24, head: 42, atk: 1.3 },
    wyvern: { name: 'Wyvern', lvl: 7, hp: 240, dmg: [16, 24], spd: 1.6, ref: 2.3, exp: 101, hitR: 32, head: 90, atk: 1.7 },
    minotaur: { name: 'Minotauro (mini-boss)', lvl: 9, hp: 1200, dmg: [22, 34], spd: 1.4, ref: 2.4, exp: 560, hitR: 40, head: 130, atk: 1.9 },
    // Tipos nuevos: nivel base sobre las curvas de ZONAS.md (vida 29+10,5·L+2,75·L², daño medio 2,5·L+3, exp 60·L^1,5/11); en una zona con `lvl` se reescalan igual que los demás.
    // Los dos arqueros pelean cuerpo a cuerpo hasta que MobSim tenga ataque a distancia (ver docs/MOBS_NUEVOS.md).
    hobgoblin: { name: 'Hobgoblin', lvl: 3, hp: 85, dmg: [8, 13], spd: 1.5, ref: 2.2, exp: 30, hitR: 22, head: 42, atk: 1.5 },
    hobgoblin_archer: { name: 'Hobgoblin arquero', lvl: 3, hp: 70, dmg: [7, 11], spd: 1.4, ref: 2.2, exp: 30, hitR: 21, head: 40, atk: 1.6 },
    skeleton_archer: { name: 'Esqueleto arquero', lvl: 5, hp: 125, dmg: [10, 16], spd: 1.4, ref: 2.1, exp: 55, hitR: 22, head: 55, atk: 1.6 },
    zombie_dark: { name: 'Zombi oscuro', lvl: 4, hp: 125, dmg: [9, 15], spd: 1.1, ref: 1.6, exp: 45, hitR: 22, head: 50, atk: 1.6 },
    // Lápida inmóvil en Flare (sin animación de andar): se arrastra muy lento para no dejar a la IA con velocidad 0 (volver a casa nunca terminaría).
    cursed_grave: { name: 'Tumba maldita', lvl: 5, hp: 150, dmg: [11, 18], spd: 0.5, ref: 1.0, exp: 62, hitR: 24, head: 55, atk: 1.8 },
    ice_ant: { name: 'Hormiga de hielo', lvl: 7, hp: 237, dmg: [15, 23], spd: 1.6, ref: 2.1, exp: 101, hitR: 24, head: 42, atk: 1.3 },
    antlion_small: { name: 'Cría de hormiga león', lvl: 4, hp: 75, dmg: [6, 10], spd: 1.9, ref: 2.2, exp: 28, hitR: 17, head: 26, atk: 1.2 },
    wyvern_fire: { name: 'Wyvern de fuego', lvl: 9, hp: 346, dmg: [20, 31], spd: 1.6, ref: 2.3, exp: 147, hitR: 32, head: 90, atk: 1.7 },
    wyvern_ice: { name: 'Wyvern de hielo', lvl: 8, hp: 289, dmg: [18, 28], spd: 1.6, ref: 2.3, exp: 123, hitR: 32, head: 90, atk: 1.7 },
};

/** Segundos hasta que reaparece un mob muerto. */
export const mobRespawnSecs = (t: MobType): number => MOBS[t].boss?.respawn ?? (t === 'minotaur' ? 120 : 22);
/** Segundos de reaparición de un mob de la zona: la de la zona si la define (pits de caza), si no la del tipo. Los bosses usan siempre la suya. */
export const zoneRespawnSecs = (t: MobType, zone?: { respawn?: number }): number => (MOBS[t].boss ? mobRespawnSecs(t) : zone?.respawn ?? mobRespawnSecs(t));
/** Radio de aggro por defecto (celdas) y radio de contagio a los compañeros de zona. */
export const MOB_AGGRO = 4.5, MOB_ASSIST = 3.2;

/** Curvas de referencia por nivel (mob común): vida, daño promedio por golpe y exp por kill. Los tipos base ya las siguen; sirven para reescalar un tipo a otro nivel. */
export const mobHpCurve = (l: number): number => 29 + 10.5 * l + 2.75 * l * l;
export const mobDmgCurve = (l: number): number => 2.5 * l + 3;
/** Exp por kill de un mob común de nivel `l` (curva de referencia para reescalar tipos; los MOBS base ya la siguen: ~60·l^1,5 / 11). */
export const mobExpCurve = (l: number): number => (60 * Math.pow(l, 1.5)) / 11;
/** Kills de un mob común del propio nivel que hacen falta para subir del nivel `l` (grindeo estilo HB: 40 en Nv1, 400 en Nv10). */
export const killsToLevel = (l: number): number => 40 * l;
/** Exp real de un mob común de nivel `l`: la del tipo base de ese nivel si existe (los de nivel bajo dan algo más que la curva), si no la curva. */
const refExp = (l: number): number => Math.max(mobExpCurve(l), ...Object.values(MOBS).filter((m) => !m.boss && m.lvl === l && m.exp < 3 * mobExpCurve(l)).map((m) => m.exp));
/** Exp que pide subir del nivel `l` al siguiente (cliente y server usan esta misma función). */
export const expToLevel = (l: number): number => Math.round(refExp(l) * killsToLevel(l));

const scaled = new Map<string, MobDef>();
/**
 * Definición del mob en una zona: si la zona fija `lvl`, vida, daño y exp se reescalan sobre las curvas desde el nivel base del tipo
 * (mismo sprite, mismo comportamiento). Los bosses no se reescalan: su nivel es el del tipo.
 */
export function mobDef(type: MobType, zone?: { lvl?: number }): MobDef {
    const base = MOBS[type], L = zone?.lvl;
    if (!L || L === base.lvl || base.boss) return base;
    const key = type + ':' + L;
    let d = scaled.get(key);
    if (!d) {
        const kh = mobHpCurve(L) / mobHpCurve(base.lvl), kd = mobDmgCurve(L) / mobDmgCurve(base.lvl), ke = mobExpCurve(L) / mobExpCurve(base.lvl);
        d = { ...base, lvl: L, hp: Math.round(base.hp * kh), dmg: [Math.round(base.dmg[0] * kd), Math.round(base.dmg[1] * kd)], exp: Math.round(base.exp * ke) };
        scaled.set(key, d);
    }
    return d;
}
