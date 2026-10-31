/**
 * Arma todos los mapas, mide el tiempo de armado (primera vez, en frío, y la mejor de 4 más, en caliente), cuenta objetos y mobs,
 * y corre el validador del grafo. Uso: npx tsx src/town/check.ts [mapId...]
 */
import { buildMap, MAPS, validateMapGraph } from '../../../packages/world/src/index.ts';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MAPS);
for (const id of ids) {
    const t0 = performance.now(); const m = buildMap(id); const cold = performance.now() - t0;
    let warm = Infinity; for (let i = 0; i < 4; i++) { const t1 = performance.now(); buildMap(id); warm = Math.min(warm, performance.now() - t1); }
    const mobs = m.zones.reduce((s, z) => s + z.n, 0), pits = m.zones.filter((z) => z.n >= 30).length;
    console.log(`${id.padEnd(22)} ${String(m.size).padStart(3)}  frío ${cold.toFixed(0).padStart(4)} ms  caliente ${warm.toFixed(0).padStart(4)} ms  props ${m.props.length}  decals ${m.decals.length}  edificios ${m.buildings.length}  npcs ${m.npcs.length}  mobs ${mobs}${pits ? ` (${pits} pits)` : ''}`);
}
const errs = validateMapGraph();
console.log(errs.length ? errs.join('\n') : 'grafo OK');
