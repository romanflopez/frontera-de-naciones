/**
 * Versiones del cliente (semver simple: `1.2.3`, con `v` opcional; lo que viene después de un `-` se ignora).
 * Las usan el server (versión mínima) y el cliente (decidir si tiene que actualizarse).
 */

/** `[mayor, menor, parche]` o null si no es una versión válida. */
export function parseVersion(v: string): [number, number, number] | null {
    const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+].*)?$/.exec(String(v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1 si a < b, 0 si son iguales, 1 si a > b. Lo que no es una versión válida se trata como 0.0.0. */
export function compareVersions(a: string, b: string): number {
    const x = parseVersion(a) ?? [0, 0, 0], y = parseVersion(b) ?? [0, 0, 0];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}

/**
 * ¿Un cliente `client` tiene que actualizarse para jugar contra un server que pide `min`?
 * Un cliente sin versión válida (desarrollo, `dev`) nunca queda bloqueado, y sin mínimo no se bloquea a nadie.
 */
export function mustUpdate(client: string, min: string): boolean {
    if (!parseVersion(client) || !parseVersion(min)) return false;
    return compareVersions(client, min) < 0;
}

/** ¿Hay una versión más nueva que la del cliente (no obligatoria)? */
export function hasNewer(client: string, latest: string): boolean {
    if (!parseVersion(client) || !parseVersion(latest)) return false;
    return compareVersions(client, latest) < 0;
}
