/**
 * Campos de Sal propios por nación (docs/CIUDADES.md §8): dos copias del mapa de nivel 1-2, una por ciudad, que se juntan en el Bosque de Piedra.
 * El portal de la plaza y el del Portal de Frontera hacia ese campo se abren recién al llegar a pie una vez.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLARE_FIELD, MAPS, TRAINING, buildMap, goalStep, linkGateReason, trainingMapFor, trainingOfMap, trainingUnlocked, waypointTarget, type QuestGoal } from '@fdn/world';

const S = FLARE_FIELD.solmar, V = FLARE_FIELD.vhar;

test('los dos campos son el mismo mapa (tamaño, nivel, tier y celdas) con zonas de nombres distintos', () => {
    assert.notEqual(S.eris, V.eris);
    assert.equal(MAPS[S.eris].size, MAPS[V.eris].size);
    assert.deepEqual(MAPS[S.eris].lvl, MAPS[V.eris].lvl); assert.equal(MAPS[S.eris].tier, MAPS[V.eris].tier);
    assert.deepEqual(buildMap(S.eris).blocked, buildMap(V.eris).blocked);
    const nombres = new Set(buildMap(S.eris).zones.map((z) => z.name));
    for (const z of buildMap(V.eris).zones) assert.ok(!nombres.has(z.name), `la zona '${z.name}' se repite entre los dos campos`);
    assert.equal(buildMap(V.eris).zones.length, buildMap(S.eris).zones.length);
});

test('los dos campos se juntan en el Bosque de Piedra, cada uno por su lado, y cada nación solo entra al suyo', () => {
    const bosque = MAPS.bosque_de_piedra.links;
    const aS = bosque.find((l) => l.to.map === S.eris)!, aV = bosque.find((l) => l.to.map === V.eris)!;
    assert.ok(aS && aV && (aS.x !== aV.x || aS.y !== aV.y), 'dos salidas distintas del Bosque de Piedra');
    assert.deepEqual(aS.gate, { faction: 'solmar' }); assert.deepEqual(aV.gate, { faction: 'vhar' });
    for (const campo of [S, V]) assert.ok(MAPS[campo.eris].links.some((l) => l.to.map === 'bosque_de_piedra'), `${campo.eris} sale al Bosque de Piedra`);
    const pr = (faction: string) => ({ qi: 0, lvl: 1, keys: {}, unlocked: [] as string[], faction });
    assert.equal(linkGateReason(aS, pr('solmar')), null); assert.match(linkGateReason(aS, pr('vhar'))!, /otra nación/);
    assert.equal(linkGateReason(aV, pr('vhar')), null); assert.match(linkGateReason(aV, pr('solmar'))!, /otra nación/);
    // la llegada al Bosque de Piedra es caminable y segura desde cualquiera de los dos campos
    const b = buildMap('bosque_de_piedra');
    for (const campo of [S, V]) { const l = MAPS[campo.eris].links.find((q) => q.to.map === 'bosque_de_piedra')!; assert.ok(!b.blocked[l.to.y][l.to.x] && b.safe[l.to.y][l.to.x], `${campo.eris}: llegada al Bosque de Piedra`); }
});

test('el portal de vuelta de cada campo lleva a la ciudad de su nación y solo lo usa esa nación', () => {
    const pr = (faction: string) => ({ qi: 0, lvl: 1, keys: {}, unlocked: [] as string[], faction });
    for (const [campo, ciudad, fac, otra] of [[S, 'solmar_villa', 'solmar', 'vhar'], [V, 'vhar_ciudadela', 'vhar', 'solmar']] as const) {
        const back = MAPS[campo.eris].links.find((l) => l.to.map === ciudad)!;
        assert.ok(back, `${campo.eris} vuelve a ${ciudad}`);
        assert.equal(linkGateReason(back, pr(fac)), null); assert.ok(linkGateReason(back, pr(otra)));
    }
});

test('el atajo y el Portal de Frontera al primer campo piden haber llegado a pie; los demás siguen por nivel', () => {
    const paso0 = TRAINING[0];
    assert.equal(paso0.onFoot, true);
    assert.equal(trainingUnlocked(0, 0, 40), false, 'por nivel no se abre nunca');
    assert.equal(trainingUnlocked(1, 0, 2), true, 'el Bosque de Piedra sigue abriéndose por nivel');
    assert.equal(trainingMapFor(paso0, 'solmar'), S.eris); assert.equal(trainingMapFor(paso0, 'vhar'), V.eris);
    assert.equal(trainingOfMap(S.eris)?.step, 0); assert.equal(trainingOfMap(V.eris)?.step, 0);
    assert.equal(waypointTarget('campos_de_sal', 'vhar')?.map, V.eris); assert.equal(waypointTarget('campos_de_sal', 'solmar')?.map, S.eris);
    const atajo = MAPS.solmar_villa.links.find((l) => l.id === 'villa_a_campos')!;
    const pr = (unlocked: string[]) => ({ qi: 0, lvl: 1, keys: {}, unlocked, faction: 'solmar' });
    assert.match(linkGateReason(atajo, pr([]))!, /a pie/); assert.equal(linkGateReason(atajo, pr(['campos_de_sal'])), null);
});

test('una misión de matar goblins en Campos de Sal también cuenta en el campo de Vhar', () => {
    const g: QuestGoal = { k: 'kill', mobs: ['goblin'], map: 'campos_de_sal', n: 10, what: 'Goblins en Campos de Sal' };
    const ev = (map: string) => ({ k: 'kill' as const, type: 'goblin' as const, map }) as never;
    assert.equal(goalStep(g, ev('campos_de_sal')), 1);
    assert.equal(goalStep(g, ev('campos_de_sal_vhar')), 1);
    assert.equal(goalStep(g, ev('bosque_de_piedra')), 0);
});
