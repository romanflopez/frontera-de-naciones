/** Arma los mapas de la villa, mide el tiempo y corre el validador del grafo. Uso: npx tsx src/town/check.ts */
import { buildMap, MAPS, validateMapGraph } from '../../../packages/world/src/index.ts';

for (const id of Object.keys(MAPS)) {
    const t0 = performance.now(); const m = buildMap(id);
    console.log(`${id.padEnd(22)} ${String(m.size).padStart(3)}  ${(performance.now() - t0).toFixed(0).padStart(4)} ms  props ${m.props.length}  decals ${m.decals.length}  edificios ${m.buildings.length}  npcs ${m.npcs.length}`);
}
const errs = validateMapGraph();
console.log(errs.length ? errs.join('\n') : 'grafo OK');
