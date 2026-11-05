/**
 * Las ciudades tienen que tener salida a los primeros niveles (docs/CIUDADES.md): desde la aparición se llega a pie a un portón que lleva al campo
 * de entrada de su nación (Campos de Sal, nivel 1-2), y la llegada es caminable. El portal de la plaza es un atajo que se abre recién después de
 * haber llegado a pie. Si se rediseña una ciudad y se rompe esto, los personajes nuevos quedan encerrados.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLARE_FIELD, VHAR, VILLA, buildMap, getMapDef, mapForNation, reachableFrom, type Link } from '@fdn/world';

const CIUDADES = [
    { id: 'solmar_villa', spawn: VILLA.spawn, portal: VILLA.portal, faccion: 'solmar' },
    { id: 'vhar_ciudadela', spawn: VHAR.spawn, portal: VHAR.portal, faccion: 'vhar' },
] as const;

for (const c of CIUDADES) {
    const campo = FLARE_FIELD[c.faccion];
    test(`${c.id}: portón a pie al campo de su nación (nivel 1-2) y atajo por portal que se abre al llegar a pie`, () => {
        const def = getMapDef(c.id)!, m = buildMap(c.id), reach = reachableFrom(m, c.spawn.x, c.spawn.y);
        const salidas = def.links.filter((l) => l.kind !== 'enter' && l.to.map === campo.eris);
        const aPie = salidas.filter((l) => !l.gate), atajo = salidas.filter((l) => l.gate?.unlocked);
        assert.ok(aPie.some((l) => l.kind === 'oneway'), 'falta el portón a pie, sin requisitos');
        assert.ok(atajo.length > 0, 'falta el portal de la plaza (atajo)');
        assert.ok(atajo.every((l) => l.gate!.unlocked === 'campos_de_sal'), 'el atajo se abre con el portal del primer campo');
        const destino = buildMap(campo.eris), alcanzablesDestino = reachableFrom(destino, campo.entry.x, campo.entry.y);
        for (const l of salidas) {
            assert.ok(reach[l.y][l.x], `${l.id}: (${l.x}, ${l.y}) no se alcanza caminando desde la aparición`);
            assert.ok(!destino.blocked[l.to.y][l.to.x], `${l.id}: la llegada (${l.to.x}, ${l.to.y}) está bloqueada`);
            assert.ok(alcanzablesDestino[l.to.y][l.to.x], `${l.id}: la llegada no se conecta con el resto del campo`);
        }
        const primero = getMapDef(campo.eris)!;
        assert.ok(primero.lvl && primero.lvl[0] <= 1, 'el mapa de salida tiene que servir para el nivel 1');
    });

    test(`${c.id}: el Portal de Frontera existe y se alcanza desde la aparición`, () => {
        const m = buildMap(c.id), reach = reachableFrom(m, c.spawn.x, c.spawn.y);
        const wp = (m.waypoints ?? []).find((w) => w.id === `city:${c.faccion}`);
        assert.ok(wp, 'falta el waypoint de la ciudad');
        assert.deepEqual([wp.x, wp.y], [c.portal.x, c.portal.y]);
        assert.ok(reach[wp.y][wp.x], 'el portal no se alcanza');
    });

    test(`${c.id}: yendo solo a pie (sin atajos) se llega del campo al Bosque de Piedra y a los siguientes mapas`, () => {
        // recorrido por mapas: cualquier vínculo sin el requisito de atajo; las puertas de nivel alto no cuentan (solo los primeros niveles)
        const seen = new Set<string>([c.id]), cola: string[] = [c.id];
        const ok = (l: Link) => l.kind !== 'enter' && !l.gate?.unlocked && !l.gate?.key && !(l.gate?.lvl && l.gate.lvl > 5) && (!l.gate?.faction || l.gate.faction === c.faccion);
        for (let i = 0; i < cola.length; i++) for (const l of getMapDef(cola[i])!.links) if (ok(l) && !seen.has(l.to.map)) { seen.add(l.to.map); cola.push(l.to.map); }
        for (const id of [campo.eris, 'bosque_de_piedra', mapForNation('canon_goblin', c.faccion), 'pantano_de_merrimead']) assert.ok(seen.has(id), `a pie desde ${c.id} no se llega a ${id}`);
        const otro = FLARE_FIELD[c.faccion === 'solmar' ? 'vhar' : 'solmar'];
        assert.ok(!seen.has(otro.eris), `desde ${c.id} no se tiene que poder entrar al campo de la otra nación`);
    });
}
