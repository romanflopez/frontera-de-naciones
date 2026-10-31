import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MAP, MAPS, buildMap, canonicalMapId, factionHome, linkGateReason, mapHash, respawnTarget, validateMapGraph, type MapDef } from '@fdn/world';

const clone = (): Record<string, MapDef> => Object.fromEntries(Object.entries(MAPS).map(([k, d]) => [k, { ...d, links: d.links.map((l) => ({ ...l, to: { ...l.to } })) }]));

test('el grafo real de mapas es válido', () => {
    assert.deepEqual(validateMapGraph(), []);
});
test('hay al menos 3 mapas conectados y el mapa viejo sigue siendo solmar_legacy', () => {
    assert.ok(Object.keys(MAPS).length >= 3);
    assert.equal(DEFAULT_MAP, 'solmar_legacy');
    assert.equal(canonicalMapId('solmar'), 'solmar_legacy');
    assert.equal(buildMap('solmar').size, 96);
});
test('los mapas se arman igual dos veces (hash estable)', () => {
    for (const id of Object.keys(MAPS)) assert.equal(mapHash(buildMap(id)), mapHash(buildMap(id)), id);
    assert.notEqual(mapHash(buildMap('prueba_caza')), mapHash(buildMap('prueba_mazmorra')));
});
test('detecta un vínculo a un mapa que no existe', () => {
    const d = clone(); d.prueba_caza.links[0].to.map = 'nada';
    assert.ok(validateMapGraph(d).some((e) => e.includes("destino 'nada' no existe")));
});
test('detecta un destino bloqueado o fuera del mapa', () => {
    const d = clone(); d.solmar_legacy.links[0].to = { map: 'prueba_caza', x: 0, y: 0 };
    assert.ok(validateMapGraph(d).some((e) => e.includes('no es caminable')));
    const f = clone(); f.solmar_legacy.links[0].to = { map: 'prueba_caza', x: 999, y: 3 };
    assert.ok(validateMapGraph(f).some((e) => e.includes('no es caminable')));
});
test('detecta ids de vínculo repetidos', () => {
    const d = clone(); d.prueba_mazmorra.links[0].id = d.prueba_caza.links[0].id;
    assert.ok(validateMapGraph(d).some((e) => e.includes('repetido')));
});
test('detecta un vínculo sin vuelta salvo que sea de una vía', () => {
    const d = clone(); d.prueba_caza.links = d.prueba_caza.links.filter((l) => l.id !== 'caza_a_solmar');
    assert.ok(validateMapGraph(d).some((e) => e.includes('no tiene vínculo de vuelta')));
});
test('detecta que el destino sea una celda disparadora (rebotaría)', () => {
    const d = clone(); const back = d.prueba_caza.links.find((l) => l.id === 'caza_a_solmar')!; d.solmar_legacy.links[0].to = { map: 'prueba_caza', x: back.x, y: back.y };
    assert.ok(validateMapGraph(d).some((e) => e.includes('rebotaría')));
});
test('una puerta sin requisito es un error', () => {
    const d = clone(); delete d.prueba_caza.links.find((l) => l.kind === 'door')!.gate;
    assert.ok(validateMapGraph(d).some((e) => e.includes('pide requisito')));
});
test('detecta mapas inalcanzables y zonas repetidas entre mapas', () => {
    const d = clone(); d.solmar_legacy.links = [];
    assert.ok(validateMapGraph(d).some((e) => e.includes('no se alcanza desde')));
    const z = clone(); const b = z.prueba_mazmorra.build; z.prueba_mazmorra.build = () => { const m = b(); m.zones[0].name = 'Claro de prueba: goblins'; return m; };
    assert.ok(validateMapGraph(z).some((e) => e.includes('repetida')));
});
test('detecta un build no determinista', () => {
    const d = clone(); let n = 0; const b = d.prueba_caza.build; d.prueba_caza.build = () => { const m = b(); if (n++ % 2) m.blocked[5][5] = !m.blocked[5][5]; return m; };
    assert.ok(validateMapGraph(d).some((e) => e.includes('no es determinista')));
});
test('los requisitos de los vínculos', () => {
    const door = MAPS.prueba_caza.links.find((l) => l.kind === 'door')!;
    const prog = (lvl: number, keys: Record<string, number> = {}) => ({ qi: 0, lvl, keys, unlocked: [] });
    assert.ok(linkGateReason(door, prog(1)));
    assert.equal(linkGateReason(door, prog(2)), null);
    const keyed = { ...door, gate: { key: 'cripta' } };
    assert.ok(linkGateReason(keyed, prog(9)));
    assert.equal(linkGateReason(keyed, prog(1, { cripta: 1 })), null);
    assert.ok(linkGateReason({ ...door, gate: { quest: 3 } }, prog(9)));
});
test('respawn por mapa', () => {
    assert.deepEqual(respawnTarget(MAPS.solmar_legacy, 'vhar'), factionHome('vhar'));
    assert.equal(respawnTarget(MAPS.prueba_mazmorra, 'solmar').map, 'prueba_mazmorra');
    assert.equal(respawnTarget(MAPS.prueba_caza, 'vhar').map, 'prueba_caza');
});
