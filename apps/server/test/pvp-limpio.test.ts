/** Legibilidad del PvP: los mapas de facción tienen que ser abiertos (poco bloqueado, poca decoración) para que se vea al rival y se pueda esquivar. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, buildMap } from '@fdn/world';

/** Excepciones conocidas (mapas con paredes o acantilados de verdad): se abren cuando se rehaga su arte. */
const EXCEPCIONES = new Set(['la_brecha', 'cenizas_i']);
const MAX_BLOQUEADO = 0.10, MAX_PROPS_POR_CELDA = 0.09;

function medir(id: string) {
    const m = buildMap(id), N = m.size;
    // caja de las celdas caminables (el mapa se rellena hasta ser cuadrado y ese relleno no cuenta)
    let x0 = N, x1 = -1, y0 = N, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!m.blocked[y][x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const area = (x1 - x0 + 1) * (y1 - y0 + 1); let blk = 0, props = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m.blocked[y][x]) blk++;
    for (const p of m.props) if (p.x >= x0 && p.x <= x1 + 1 && p.y >= y0 && p.y <= y1 + 1) props++;
    return { blocked: blk / area, props: props / area };
}

test('pvp limpio: los mapas de facción tienen menos de 10 % de celdas bloqueadas y pocos props (salvo excepciones conocidas)', () => {
    const ids = Object.values(MAPS).filter((d) => d.pvp === 'faction' && !d.legacy && !d.debugOnly).map((d) => d.id);
    assert.ok(ids.length >= 10);
    for (const id of ids) {
        const r = medir(id);
        if (EXCEPCIONES.has(id)) { assert.ok(r.blocked > MAX_BLOQUEADO, `${id} ya cumple: sacalo de EXCEPCIONES`); continue; }
        assert.ok(r.blocked <= MAX_BLOQUEADO, `${id}: ${(100 * r.blocked).toFixed(0)} % bloqueado`);
        assert.ok(r.props <= MAX_PROPS_POR_CELDA, `${id}: ${(100 * r.props).toFixed(1)} props cada 100 celdas`);
    }
});
