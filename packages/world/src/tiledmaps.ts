/**
 * Mapas importados de Tiled (pnpm maps:tiled <input.json>, tools/src/maps/tiled_to_ts.ts). Comparten el shape de los de Flare
 * (`FlareMapData`) y se arman con el mismo `buildFlareMap`, así que cliente y server los cargan igual que cualquier otro mapa.
 * Entran como `debugOnly` (sin entrada desde el mundo) hasta que algún mapa declare un vínculo hacia ellos.
 */
import type { Link, MapDef } from './maps';
import { buildFlareMap } from './flare';
import { TILED_DATA } from './tiled';

export { TILED_DATA } from './tiled';

/** `defs` = los mapas ya definidos (para la celda de llegada de cada conexión: el spawn del mapa destino). */
export function tiledMaps(defs: Record<string, MapDef>): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    const ids = new Set(TILED_DATA.map((t) => t.data.eris));
    for (const { data: d } of TILED_DATA) {
        if (defs[d.eris]) throw new Error(`tiled: el mapa '${d.eris}' ya existe`);
        const links: Link[] = d.extras.map((e, i) => {
            const spawn = defs[e.to]?.spawn ?? TILED_DATA.find((t) => t.data.eris === e.to)?.data.entry;
            if (!spawn || (!defs[e.to] && !ids.has(e.to))) throw new Error(`tiled ${d.id}: la conexión apunta a '${e.to}', que no existe`);
            return { id: `${d.eris}_a_${e.to}${i ? `_${i + 1}` : ''}`, map: d.eris, x: e.cell.x, y: e.cell.y, to: { map: e.to, ...spawn }, kind: e.kind, ...(e.gate ? { gate: { lvl: e.gate } } : {}), msg: e.kind === 'door' ? 'Cruzás la puerta.' : 'Cruzás el portal.' };
        });
        out[d.eris] = {
            id: d.eris, name: d.name, region: d.region, size: d.size, lvl: d.lvl, pvp: d.pvp, safe: false, debugOnly: true,
            spawn: { ...d.entry }, respawn: { ...d.entry }, links, build: () => buildFlareMap(d),
        };
    }
    return out;
}
