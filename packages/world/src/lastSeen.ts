/** Texto de «última conexión» para el detalle del personaje (D.18): relativo hasta el mes, después la fecha. `0` = nunca entró. */
export function lastSeenText(ms: number, now: number = Date.now()): string {
    if (!(ms > 0)) return 'Nunca entró';
    const d = now - ms;
    if (d < 0 || d < 60_000) return 'Hace un momento';
    if (d < 3_600_000) return `Hace ${Math.floor(d / 60_000)} min`;
    if (d < 86_400_000) return `Hace ${Math.floor(d / 3_600_000)} h`;
    const days = Math.floor(d / 86_400_000);
    if (days === 1) return 'Ayer';
    if (days < 30) return `Hace ${days} días`;
    const f = new Date(ms);
    return `El ${f.getUTCDate()}/${f.getUTCMonth() + 1}/${f.getUTCFullYear()}`;
}
