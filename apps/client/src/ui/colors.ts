/** Colores por escuela de hechizo (CastBar + cartel flotante). */
export const SPELL_COLORS = {
    FIRE: { primary: '#ff4400', glow: '#ffaa00' },      // Fuego (Firebolt, Fireball, Inferno)
    ICE: { primary: '#00ccff', glow: '#aaffff' },       // Hielo (Ice Shard, Chains of Ice)
    HOLY: { primary: '#ffdd00', glow: '#ffffcc' },      // Sagrado/Curación (Heal, Holy Blessing)
    NATURE: { primary: '#33cc33', glow: '#99ff99' },    // Naturaleza (Rejuvenation, Root)
    ARCANE: { primary: '#9900ff', glow: '#cc66ff' },    // Arcano (Blink, Mana Shield)
    PHYSICAL: { primary: '#cccccc', glow: '#ffffff' },  // Físico/Melee (Strike, Charge)
} as const;

export type SpellType = keyof typeof SPELL_COLORS;

const TYPE_OF: Record<string, SpellType> = {
    proyectil: 'FIRE', bola: 'FIRE',
    paralisis: 'ICE', esquirla: 'ICE', nova: 'ICE', escudomana: 'ICE', intelecto: 'ICE', clarividencia: 'ICE',
    luz: 'HOLY', castigo: 'HOLY', curacion: 'HOLY', renovar: 'HOLY', bendicion: 'HOLY', novasagrada: 'HOLY', reprender: 'HOLY', orbe: 'HOLY', guardian: 'HOLY', esfera: 'HOLY', despertar: 'HOLY', grupo: 'HOLY', pasoluz: 'HOLY', grito: 'HOLY', amparo: 'HOLY', escudodivino: 'HOLY',
    golpe: 'PHYSICAL', carga: 'PHYSICAL', giro: 'PHYSICAL',
};

/** Escuela de un hechizo por id; PHYSICAL si no está mapeado. */
export const spellTypeOf = (id?: string): SpellType => (id && TYPE_OF[id]) || 'PHYSICAL';
