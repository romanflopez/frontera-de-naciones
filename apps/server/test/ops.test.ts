import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RestartCountdown, restartNotice, reportAllowed, resetReportLimits, cleanReportField, changelogLines, CHANGELOG } from '../src/ops.ts';

test('restartNotice: minutos, segundos y cero', () => {
    assert.match(restartNotice(300), /5 min/);
    assert.match(restartNotice(30), /30 s/);
    assert.match(restartNotice(0), /se reinicia ahora/);
});

test('cuenta regresiva: avisa en los instantes, sin repetir, y dispara en cero', () => {
    let t = 1_000_000; const said: string[] = []; let fired = 0;
    const c = new RestartCountdown((x) => said.push(x), () => { fired++; }, () => t);
    c.start(130);
    assert.equal(said.length, 1); assert.match(said[0], /2 min/);
    for (let s = 129; s >= 1; s--) { t += 1000; c.tick(); }
    const txt = said.join('|');
    assert.match(txt, /1 min/); assert.match(txt, /30 s/); assert.match(txt, /10 s/);
    assert.equal(said.filter((x) => /30 s/.test(x)).length, 1, 'sin avisos repetidos');
    assert.equal(fired, 0); assert.ok(c.active);
    t += 1000; c.tick();
    assert.equal(fired, 1); assert.ok(!c.active); assert.match(said.at(-1)!, /ahora/);
});

test('cancelar frena el reinicio', () => {
    let t = 0, fired = 0; const c = new RestartCountdown(() => {}, () => { fired++; }, () => t);
    c.start(10); assert.equal(c.cancel(), true); t += 20_000; c.tick();
    assert.equal(fired, 0); assert.equal(c.cancel(), false);
});

test('reportes: tope por IP y limpieza de texto', () => {
    resetReportLimits();
    for (let i = 0; i < 10; i++) assert.ok(reportAllowed('1.1.1.1', 1000 + i));
    assert.ok(!reportAllowed('1.1.1.1', 1500));
    assert.ok(reportAllowed('2.2.2.2', 1500), 'otra IP no se ve afectada');
    assert.ok(reportAllowed('1.1.1.1', 1000 + 61_000), 'pasado el minuto vuelve a andar');
    assert.equal(cleanReportField('a\u0000b\nc', 10), 'a b c');
    assert.equal(cleanReportField('x'.repeat(500), 20).length, 20);
});

test('novedades: lo más nuevo primero y entra en el chat', () => {
    const l = changelogLines(1);
    assert.match(l[1], new RegExp(CHANGELOG[0].date));
    assert.ok(l.every((x) => x.length < 200));
});
