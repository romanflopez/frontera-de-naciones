/**
 * Bots de la simulación: un jugador competente de cada clase, no uno perfecto. Juegan con lo que el kit tiene a su nivel
 * (canUseSkill), manejan la distancia (peleas de moverse, acercarse y alejarse) y usan pociones, Furia, Remover y Segundo aliento.
 *
 * Comunes a todos: poción de vida debajo del 55 % (de maná si el maná baja del 20 % y la vida está bien), Furia apenas
 * empieza el combate, Remover si quedan ≥ 1,5 s de control, Segundo aliento debajo del 45 % cuando nadie lo puede cortar.
 */
import type { Act, Fighter, Policy, Sim } from './engine.ts';

const toward = (w: Sim, f: Fighter, t: Fighter, run = true): Act => ({ t: 'move', dx: t.x - f.x, dy: t.y - f.y, run });
const away = (w: Sim, f: Fighter, t: Fighter, run = true): Act => { const [dx, dy] = w.awayDir(f, t); return { t: 'move', dx, dy, run }; };
const use = (w: Sim, f: Fighter, id: string, tgt?: Fighter): Act => (w.ready(f, id) && (!tgt || tgt === f || w.inRange(f, tgt, id)) ? { t: 'use', id, tgt } : null);
const nearest = (w: Sim, f: Fighter) => w.foes(f).sort((a, b) => w.dist(f, a) - w.dist(f, b))[0];
/** Objetivo: el enemigo con menos vida (porcentual) entre los que están a `reach`; si no hay, el más cercano. Se mantiene 2 s. */
function target(w: Sim, f: Fighter, reach: number): Fighter | undefined {
    const cur = w.fighters.find((o) => o.id === f.mem.tgt && o.hp > 0);
    if (cur && w.now < (f.mem.tgtUntil ?? 0)) return cur;
    const foes = w.foes(f); if (!foes.length) return undefined;
    const inReach = foes.filter((o) => w.dist(f, o) <= reach);
    const t = (inReach.length ? inReach : foes).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || w.dist(f, a) - w.dist(f, b))[0];
    f.mem.tgt = t.id; f.mem.tgtUntil = w.now + 2000; return t;
}
/** Nadie enemigo le puede pegar en los próximos 3 s (todos lejos o controlados). */
const safe = (w: Sim, f: Fighter) => w.foes(f).every((o) => w.ctrlLeftMs(o) >= 3000 || (w.dist(f, o) > 16));

function common(w: Sim, f: Fighter): { act: Act; potion?: 'hp' | 'mp' } | { potion?: 'hp' | 'mp' } {
    const hp = f.hp / f.s.maxHp, mp = f.mp / f.s.maxMp;
    const potion = hp < 0.5 ? 'hp' : mp < 0.3 && hp > 0.5 ? 'mp' : hp < 0.7 ? 'hp' : undefined;
    if (w.frozen(f)) return { act: w.ctrlLeftMs(f) >= 1500 ? { t: 'remover' } : null, potion };
    if (f.windUntil) return { act: null, potion }; // quieto hasta que termine
    if (hp < 0.45 && w.now >= f.windCdUntil && safe(w, f)) return { act: { t: 'wind' }, potion };
    if (w.inPvp(f) && w.now >= f.furyCdUntil && f.mp > 40) return { act: { t: 'furia' }, potion };
    return { potion };
}

/** Paladín: cierra la distancia con Escudo vengador, Martillo y Carga; en cuerpo a cuerpo Aura, Juicio, Golpe y Barrido. Corta casteos. */
export const paladin: Policy = (f, w) => {
    const c = common(w, f); if ('act' in c) return c as ReturnType<Policy>;
    const t = target(w, f, 4); if (!t) return { act: null, ...c };
    const d = w.dist(f, t), hpT = t.hp / t.s.maxHp, ctrl = w.ctrlLeftMs(t);
    // cortar un casteo enemigo
    if (t.cast && ctrl === 0) { const a = use(w, f, 'aturdir', t) ?? use(w, f, 'escudo', t); if (a) return { act: a, ...c }; }
    if (d > 2.4) {
        const a = (ctrl === 0 ? use(w, f, 'escudo', t) ?? use(w, f, 'aturdir', t) : null) ?? (d > 5 ? use(w, f, 'carga', t) : null)
            ?? (ctrl > 0 || d <= 4 ? use(w, f, 'juicio', t) : null);
        if (a && (a as { id: string }).id === 'juicio' && d > 4) return { act: toward(w, f, t), ...c };
        return { act: a ?? toward(w, f, t, !(f.cast)), ...c };
    }
    const a = (w.foes(f).some((o) => w.dist(f, o) <= 3) && f.mp >= 48 ? use(w, f, 'aura') : null)
        ?? (ctrl > 900 || f.hp / f.s.maxHp < 0.7 ? use(w, f, 'juicio', t) : null)
        ?? (ctrl === 0 && hpT > 0 ? use(w, f, 'escudo', t) : null)
        ?? (f.mp >= 25 ? use(w, f, 'golpe', t) : null)
        ?? (f.mp >= 60 ? use(w, f, 'giro') : null)
        ?? use(w, f, 'ataque', t);
    return { act: a, ...c };
};

/** Mago: frena y congela para ganar distancia, remata con fuego cuando el otro no se puede mover. Contra rango, castea y se acomoda a 10-13. */
export const mage: Policy = (f, w) => {
    const c = common(w, f); if ('act' in c) return c as ReturnType<Policy>;
    const t = target(w, f, 15); if (!t) return { act: null, ...c };
    const close = nearest(w, f), dc = w.dist(f, close), melee = close.cls === 'guerrero';
    const d = w.dist(f, t), ctrl = w.ctrlLeftMs(t), mp = f.mp;
    // peligro: un paladín pegado
    if (melee && dc <= 3 && w.ctrlLeftMs(close) < 600) {
        const a = use(w, f, 'nova') ?? use(w, f, 'blink');
        if (a) return { act: a, ...c };
        if (f.cast && f.cast.at - w.now < 250) return { act: null, ...c }; // termina el cast
        return { act: away(w, f, close), ...c };
    }
    // un paladín que se acerca: frenarlo o congelarlo antes de que llegue
    if (melee && dc <= 9 && w.ctrlLeftMs(close) < 800) {
        const a = (dc <= 7 ? use(w, f, 'paralisis', close) : null) ?? (!isSlow(w, close) ? use(w, f, 'esquirla', close) : null);
        if (a) return { act: a, ...c };
        if (dc <= 5) return { act: away(w, f, close), ...c };
    }
    if (f.cast) return { act: null, ...c };
    // cortar una cura larga del healer
    if (t.cast && t.cast.id === 'curacion' && ctrl === 0) { const a = use(w, f, 'paralisis', t); if (a) return { act: a, ...c }; }
    const a = (!w.burning(t) ? use(w, f, 'ignicion', t) : null)
        ?? ((ctrl >= 1300 || !melee || d > 8) && mp >= 72 ? use(w, f, 'bola', t) : null)
        ?? (ctrl >= 800 ? use(w, f, 'esquirla', t) : null)
        ?? (w.foes(f).length > 1 && mp >= 90 && !melee ? use(w, f, 'lluvia', t) : null)
        ?? (mp >= 14 ? use(w, f, 'proyectil', t) : null);
    if (a) return { act: a, ...c };
    if (d > 14) return { act: toward(w, f, t, false), ...c };
    if (melee && dc < 8) return { act: away(w, f, close, false), ...c };
    return { act: null, ...c };
};
const isSlow = (w: Sim, f: Fighter) => f.st.slowEndTime > w.now;

/** Healer: se cura y cura al aliado más golpeado, se bendice cuando lo encaran, corta con Reprender y pega con Castigo y Nova. */
export const healer: Policy = (f, w) => {
    const c = common(w, f); if ('act' in c) return c as ReturnType<Policy>;
    const t = target(w, f, 15), close = nearest(w, f); if (!t || !close) return { act: null, ...c };
    const dc = w.dist(f, close), melee = close.cls === 'guerrero';
    const hurt = w.allies(f).sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp)[0], hh = hurt.hp / hurt.s.maxHp;
    if (f.cast) { // no se deja cortar la cura si viene un control
        if (melee && dc <= 2.5 && f.cast.id !== 'curacion') return { act: use(w, f, 'novasagrada') ?? null, ...c };
        return { act: null, ...c };
    }
    // Bendición: cuando un paladín llega o alguien del equipo está controlado
    const blessT = w.allies(f).find((a) => w.ctrlLeftMs(a) >= 1500) ?? (melee && dc <= 10 && f.hp / f.s.maxHp < 0.9 ? f : undefined);
    if (blessT) { const a = use(w, f, 'bendicion', blessT); if (a) return { act: a, ...c }; }
    // cortar casteos y frenar al que llega
    if (t.cast && w.ctrlLeftMs(t) === 0) { const a = use(w, f, 'reprender', t); if (a) return { act: a, ...c }; }
    if (melee && dc <= 3 && w.ctrlLeftMs(close) === 0) { const a = use(w, f, 'reprender', close) ?? use(w, f, 'novasagrada'); if (a) return { act: a, ...c }; }
    // curar
    if (hh < 0.6) { const a = (w.allies(f).filter((x) => x.hp / x.s.maxHp < 0.75).length > 1 ? use(w, f, 'orbe', hurt) : null) ?? use(w, f, 'curacion', hurt); if (a) return { act: a, ...c }; }
    if (hh < 0.9 && w.now >= (hurt.mem.renewUntil ?? 0)) { const a = use(w, f, 'renovar', hurt); if (a) { hurt.mem.renewUntil = w.now + 6000; return { act: a, ...c }; } }
    // pegar
    if (melee && dc <= 4) { const a = use(w, f, 'novasagrada'); if (a) return { act: a, ...c }; }
    if (melee && dc <= 3 && w.ctrlLeftMs(close) < 1000) return { act: away(w, f, close), ...c };
    const a = (!w.burning(t) && f.mp > f.s.maxMp * 0.5 ? use(w, f, 'renovar', t) : null) ?? (f.mp >= 18 ? use(w, f, 'castigo', t) : null);
    if (a) return { act: a, ...c };
    if (w.dist(f, t) > 14) return { act: toward(w, f, t, false), ...c };
    return { act: null, ...c };
};

export const BOTS = { guerrero: paladin, mago: mage, healer } as const;
