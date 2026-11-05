/** Libro de Hechizos: datos por clase (Habilidades, Técnicas y Caminos), basado en Valdrys. */
export type { SpellType } from '../ui/colors';
import type { SpellType } from '../ui/colors';

export interface Spell {
    id: string;
    name: string;
    type: SpellType;
    description: string;
    manaCost: number;
    cooldown: number; // en segundos
    castTime: number; // en segundos (0 = instantáneo)
    range: number; // en tiles
    iconId: string; // id del ícono (spellIcon); coincide con el id del hechizo en el juego cuando existe
    unlockLevel: number;
}

export interface Technique {
    id: string;
    name: string;
    description: string;
    unlockLevel: number;
}

export interface Path {
    id: string;
    name: string;
    description: string;
    unlockLevel: number; // Siempre 10
}

export interface ClassData {
    name: string;
    spells: Spell[];
    techniques: Technique[];
    paths: Path[];
}

const MAGE: ClassData = {
    name: 'Mago',
    spells: [
        { id: 'proyectil', name: 'Firebolt', type: 'FIRE', description: 'Lanza un proyectil de fuego que daña a un enemigo.', manaCost: 8, cooldown: 0.4, castTime: 1.5, range: 15, iconId: 'proyectil', unlockLevel: 1 },
        { id: 'iceshard', name: 'Ice Shard', type: 'ICE', description: 'Dispara una esquirla de hielo que ralentiza al objetivo.', manaCost: 12, cooldown: 2, castTime: 1, range: 12, iconId: 'iceshard', unlockLevel: 1 },
        { id: 'paralisis', name: 'Chains of Ice', type: 'ICE', description: 'Encadena al objetivo en hielo y lo inmoviliza durante 5 s.', manaCost: 20, cooldown: 15, castTime: 1, range: 6, iconId: 'paralisis', unlockLevel: 3 },
        { id: 'bola', name: 'Fireball', type: 'FIRE', description: 'Bola de fuego que explota e inflige daño en área.', manaCost: 25, cooldown: 4, castTime: 1.5, range: 7, iconId: 'bola', unlockLevel: 5 },
        { id: 'ventisca', name: 'Blizzard', type: 'ICE', description: 'Tormenta de hielo sobre una zona: daña y ralentiza.', manaCost: 50, cooldown: 10, castTime: 2, range: 7, iconId: 'ventisca', unlockLevel: 7 },
        { id: 'lluvia', name: 'Rain of Fire', type: 'FIRE', description: 'Hace llover fuego sobre una zona durante unos segundos.', manaCost: 45, cooldown: 9, castTime: 2, range: 7, iconId: 'lluvia', unlockLevel: 9 },
    ],
    techniques: [
        { id: 'keen_shard', name: 'Keen Shard', description: 'Ice Shard tiene 15% más de probabilidad de crítico.', unlockLevel: 2 },
        { id: 'kindling', name: 'Kindling', description: 'Firebolt reduce 0,5 s el tiempo de casteo de tu próximo Fireball.', unlockLevel: 4 },
        { id: 'deep_winter', name: 'Deep Winter', description: 'Chains of Ice dura 2 s más contra enemigos ralentizados.', unlockLevel: 5 },
        { id: 'mana_flow', name: 'Mana Flow', description: 'Regenerás 10% más de maná fuera de combate.', unlockLevel: 6 },
        { id: 'searing_heat', name: 'Searing Heat', description: 'Los hechizos de fuego queman al objetivo 3 s.', unlockLevel: 8 },
        { id: 'shatter', name: 'Shatter', description: 'El daño a enemigos congelados aumenta 20%.', unlockLevel: 9 },
    ],
    paths: [
        { id: 'frostweaver', name: 'Frostweaver', description: 'Maestro del hielo: control de masas, ralentizaciones y críticos sobre blancos congelados.', unlockLevel: 10 },
        { id: 'pyromancer', name: 'Pyromancer', description: 'Señor del fuego: daño explosivo en área y quemaduras persistentes.', unlockLevel: 10 },
    ],
};

/** Por id de clase del juego (main.ts: 'mago', 'pala' = Paladín). */
export const CLASS_DATA: Record<string, ClassData> = {
    mago: MAGE,
    pala: { name: 'Paladín', spells: [], techniques: [], paths: [] },
    clerigo: { name: 'Clérigo', spells: [], techniques: [], paths: [] },
};
