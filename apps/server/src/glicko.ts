/**
 * Glicko-2 (Glickman, "Example of the Glicko-2 system", 2012) para el ranking de arena (docs/PARTY_Y_ARENAS.md §2).
 * Cada jugador tiene su propio rating por modo (2v2 y 3v3). En una partida por equipos, cada uno se actualiza contra un rival
 * compuesto: el promedio de los ratings del otro equipo y la media cuadrática de sus desvíos.
 */
export interface Rating { r: number; rd: number; vol: number }

export const GLICKO = { r: 1500, rd: 350, vol: 0.06, tau: 0.5, rdMin: 30 } as const;
const SCALE = 173.7178, EPS = 0.000001;

export const newRating = (): Rating => ({ r: GLICKO.r, rd: GLICKO.rd, vol: GLICKO.vol });

/** Un período de rating con los resultados dados (score: 1 gana, 0,5 empata, 0 pierde). Sin resultados solo crece el desvío. */
export function glicko2(me: Rating, games: { r: number; rd: number; score: number }[], tau: number = GLICKO.tau): Rating {
    const mu = (me.r - GLICKO.r) / SCALE, phi = me.rd / SCALE, sigma = me.vol;
    if (!games.length) return { r: me.r, rd: Math.min(GLICKO.rd, Math.sqrt(phi * phi + sigma * sigma) * SCALE), vol: sigma };
    const g = (ph: number) => 1 / Math.sqrt(1 + (3 * ph * ph) / (Math.PI * Math.PI));
    const E = (m: number, mj: number, phj: number) => 1 / (1 + Math.exp(-g(phj) * (m - mj)));
    let vInv = 0, dSum = 0;
    for (const o of games) {
        const mj = (o.r - GLICKO.r) / SCALE, phj = o.rd / SCALE, e = E(mu, mj, phj), gj = g(phj);
        vInv += gj * gj * e * (1 - e); dSum += gj * (o.score - e);
    }
    const v = 1 / vInv, delta = v * dSum;
    // volatilidad nueva (método de Illinois, paso 5 del paper)
    const a = Math.log(sigma * sigma), f = (x: number) => {
        const ex = Math.exp(x), d = phi * phi + v + ex;
        return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
    };
    let A = a, B: number;
    if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
    else { let k = 1; while (f(a - k * tau) < 0) k++; B = a - k * tau; }
    let fA = f(A), fB = f(B);
    for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
        const C = A + ((A - B) * fA) / (fB - fA), fC = f(C);
        if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
        B = C; fB = fC;
    }
    const sigma2 = Math.exp(A / 2);
    const phiStar = Math.sqrt(phi * phi + sigma2 * sigma2), phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const mu2 = mu + phi2 * phi2 * dSum;
    return { r: mu2 * SCALE + GLICKO.r, rd: Math.max(GLICKO.rdMin, Math.min(GLICKO.rd, phi2 * SCALE)), vol: sigma2 };
}

/** Rival compuesto de un equipo: rating promedio y media cuadrática de los desvíos. */
export function teamOpponent(team: Rating[]): { r: number; rd: number } {
    const n = Math.max(1, team.length);
    return { r: team.reduce((s, t) => s + t.r, 0) / n, rd: Math.sqrt(team.reduce((s, t) => s + t.rd * t.rd, 0) / n) };
}

/** Cambio de temporada: el que jugó al menos `minGames` vuelve hacia el medio (la mitad de la distancia) con más desvío; el resto queda igual. */
export function seasonReset(t: Rating, games: number, minGames: number): Rating {
    if (games < minGames) return { ...t };
    return { r: GLICKO.r + (t.r - GLICKO.r) / 2, rd: Math.max(t.rd, 200), vol: t.vol };
}
