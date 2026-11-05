// Topes de DF/RM por semana del server (D.6). El server decide: el cliente solo muestra lo que recibe en `inventoryState`.
import { capsForWeek, nextCapRaiseAt, serverWeek, type WeekCaps } from '@fdn/world';

/** `SERVER_EPOCH` (ISO, p. ej. 2026-11-09): el lunes de esa semana es la semana 0. Sin definir (o inválido) no hay escalera: topes finales, como antes de D.6. */
export function serverEpochMs(env: string | undefined = process.env.SERVER_EPOCH): number | null {
    if (!env) return null;
    const t = Date.parse(env);
    return Number.isFinite(t) ? t : null;
}
export interface CurrentCaps extends WeekCaps { week: number; /** ms UTC del próximo aumento; 0 si ya no suben */ nextAt: number }
export function currentCaps(now: number = Date.now(), epoch: number | null = serverEpochMs()): CurrentCaps {
    if (epoch === null) return { ...capsForWeek(Infinity), week: Infinity, nextAt: 0 };
    const week = serverWeek(now, epoch), c = capsForWeek(week);
    return { ...c, week, nextAt: c.max ? 0 : nextCapRaiseAt(now, epoch) };
}
