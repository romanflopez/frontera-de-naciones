/** D.6: topes de DF y RM por semana del server (escalera desde SERVER_EPOCH hasta 60/75). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_BY_NAME, COMBAT_CAP, CAP_LADDER, capsForWeek, itemDfTotal, itemRmTotal, nextCapRaiseAt, serverWeek } from '@fdn/world';
import { currentCaps, serverEpochMs } from '../src/systems/weekCaps.ts';
import { statsFromChar } from '../src/systems/pvpCombat.ts';
import * as M from '../src/messages.ts';
import { newEcon } from '../src/economy.ts';

const WEEK = 7 * 86_400_000;
// 2026-11-04 es miércoles: su lunes AR es el 2026-11-02 00:00 (03:00 UTC)
const EPOCH = Date.parse('2026-11-04T15:00:00Z'), MONDAY0 = Date.parse('2026-11-02T03:00:00Z');

test('A: la escalera arranca en DF 30 / RM 40, sube 5 por semana y termina en 60 / 75', () => {
    assert.deepEqual(capsForWeek(0), { df: 30, rm: 40, max: false });
    assert.deepEqual(capsForWeek(3), { df: 45, rm: 55, max: false }, 'el ejemplo de DISEÑO.md: DF 45 / RM 55');
    assert.deepEqual(capsForWeek(6), { df: 60, rm: 70, max: false });
    assert.deepEqual(capsForWeek(7), { df: 60, rm: 75, max: true });
    assert.deepEqual(capsForWeek(10), { df: 60, rm: 75, max: true });
    assert.equal(CAP_LADDER.dfStart, 30);
    let prev = capsForWeek(0);
    for (let w = 1; w < 30; w++) { const c = capsForWeek(w); assert.ok(c.df >= prev.df && c.rm >= prev.rm, `semana ${w}: nunca baja`); assert.ok(c.df <= COMBAT_CAP.df && c.rm <= COMBAT_CAP.rm, 'nunca pasa los finales'); prev = c; }
    assert.deepEqual(capsForWeek(-4), capsForWeek(0)); assert.deepEqual(capsForWeek(NaN), capsForWeek(0)); assert.equal(capsForWeek(Infinity).max, true);
});

test('A: las semanas empiezan el lunes 00:00 de Argentina y sube el tope ese momento', () => {
    assert.equal(serverWeek(EPOCH, EPOCH), 0);
    assert.equal(serverWeek(MONDAY0 - 1, EPOCH), 0, 'antes del epoch no hay semana negativa');
    assert.equal(serverWeek(MONDAY0 + WEEK - 1, EPOCH), 0, 'hasta el domingo 23:59:59 AR sigue la semana 0');
    assert.equal(serverWeek(MONDAY0 + WEEK, EPOCH), 1, 'el lunes 00:00 AR sube');
    assert.equal(nextCapRaiseAt(EPOCH, EPOCH), MONDAY0 + WEEK);
    assert.equal(nextCapRaiseAt(MONDAY0 + WEEK, EPOCH), MONDAY0 + 2 * WEEK);
});

test('A: SERVER_EPOCH de hace 10 semanas da 60 / 75 y ya no sube; sin epoch, los topes finales', () => {
    const now = EPOCH + 10 * WEEK, c = currentCaps(now, EPOCH);
    assert.equal(c.df, 60); assert.equal(c.rm, 75); assert.equal(c.max, true); assert.equal(c.nextAt, 0);
    const w0 = currentCaps(EPOCH, EPOCH);
    assert.equal(w0.df, 30); assert.equal(w0.rm, 40); assert.equal(w0.nextAt, MONDAY0 + WEEK);
    const sin = currentCaps(EPOCH, null);
    assert.equal(sin.df, 60); assert.equal(sin.rm, 75); assert.equal(sin.nextAt, 0);
    assert.equal(serverEpochMs(undefined), null); assert.equal(serverEpochMs('basura'), null); assert.equal(serverEpochMs('2026-11-02'), Date.parse('2026-11-02'));
});

test('A: itemDfTotal / itemRmTotal usan el tope que se les pasa (y el final por defecto)', () => {
    assert.equal(itemDfTotal(300, 30), 30); assert.equal(itemRmTotal(300, 40), 40);
    assert.equal(itemDfTotal(300), COMBAT_CAP.df); assert.equal(itemRmTotal(300), COMBAT_CAP.rm);
    assert.equal(itemDfTotal(12, 30), 12, 'bajo el tope no se toca');
});

test('B: el server topea la DF/RM de los ítems con el tope de la semana, y la base de la armadura no entra', () => {
    const eq = { armadura: { n: 'Armadura de placas', a: [{ id: 'df', v: 300 }] }, anillo: { n: 'Anillo opaco', a: [{ id: 'rm', v: 300 }] } };
    const arm = BASE_BY_NAME.get('Armadura de placas')!, ring = BASE_BY_NAME.get('Anillo opaco')!, prev = process.env.SERVER_EPOCH;
    try {
        process.env.SERVER_EPOCH = new Date(Date.now() - 1000).toISOString(); // semana 0: 30 / 40
        const s0 = statsFromChar({ lvl: 40, cls: 'paladin', eq } as never);
        assert.equal(s0.def, arm.def! + 30); assert.equal(s0.rm, arm.rm! + ring.rm! + 40);
        process.env.SERVER_EPOCH = new Date(Date.now() - 10 * WEEK).toISOString(); // máximo
        const s1 = statsFromChar({ lvl: 40, cls: 'paladin', eq } as never);
        assert.equal(s1.def, arm.def! + 60); assert.equal(s1.rm, arm.rm! + ring.rm! + 75);
    } finally { if (prev === undefined) delete process.env.SERVER_EPOCH; else process.env.SERVER_EPOCH = prev; }
});

test('E (protocolo): el inventario le dice al cliente el tope de la semana y cuándo sube', () => {
    const prev = process.env.SERVER_EPOCH;
    try {
        process.env.SERVER_EPOCH = new Date(Date.now() - 1000).toISOString();
        const v = (M.inventoryState(newEcon('paladin', 'solmar')).payload as { value: { capDf: number; capRm: number; capNextAt: bigint } }).value;
        assert.equal(v.capDf, 30); assert.equal(v.capRm, 40); assert.ok(Number(v.capNextAt) > Date.now(), 'el próximo lunes');
        process.env.SERVER_EPOCH = new Date(Date.now() - 10 * WEEK).toISOString();
        const w = (M.inventoryState(newEcon('paladin', 'solmar')).payload as { value: { capDf: number; capRm: number; capNextAt: bigint } }).value;
        assert.equal(w.capDf, 60); assert.equal(w.capRm, 75); assert.equal(Number(w.capNextAt), 0, 'ya no suben');
    } finally { if (prev === undefined) delete process.env.SERVER_EPOCH; else process.env.SERVER_EPOCH = prev; }
});
