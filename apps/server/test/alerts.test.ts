import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Alerter, clip, buildInfo, DEDUPE_MS, MAX_PER_MINUTE } from '../src/alerts.ts';

type Sent = { url: string; body: any };
function make(over: Partial<ConstructorParameters<typeof Alerter>[0]> = {}) {
    const sent: Sent[] = []; let t = 1_000_000;
    const a = new Alerter({ url: 'http://x/alertas', logUrl: 'http://x/log', now: () => t, fetchFn: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; }, ...over });
    return { a, sent, adv: (ms: number) => { t += ms; } };
}
const idle = async (a: Alerter) => { await a.flush(500); };

test('sin webhook no hace nada y no rompe', async () => {
    const { a, sent } = make({ url: '', logUrl: '' });
    assert.equal(a.enabled, false);
    a.send('error', 'algo', { msg: 'x' });
    await idle(a);
    assert.equal(sent.length, 0);
    assert.equal(a.counts.error, 1, 'igual cuenta para el resumen');
});

test('error y warn van al canal de alertas; event al de registro, y sin registro se descarta', async () => {
    const { a, sent } = make();
    a.send('error', 'caída'); a.send('warn', 'cliente'); a.send('event', 'resumen');
    await idle(a);
    assert.deepEqual(sent.map((s) => s.url), ['http://x/alertas', 'http://x/alertas', 'http://x/log']);
    const b = make({ logUrl: '' });
    b.a.send('event', 'resumen'); await idle(b.a);
    assert.equal(b.sent.length, 0);
});

test('anti-spam: el mismo aviso sale una vez por ventana y cuenta las repeticiones', async () => {
    const { a, sent, adv } = make();
    for (let i = 0; i < 5; i++) a.send('error', 'No se pudo guardar', { msg: 'timeout' });
    await idle(a);
    assert.equal(sent.length, 1);
    adv(DEDUPE_MS + 1);
    a.send('error', 'No se pudo guardar', { msg: 'timeout' }); await idle(a);
    assert.equal(sent.length, 2);
    assert.match(JSON.stringify(sent[1].body), /×4 desde el último aviso/);
    a.send('error', 'No se pudo guardar', { msg: 'otro error' }); await idle(a);
    assert.equal(sent.length, 3, 'otro mensaje no se agrupa');
});

test('tope por minuto: el exceso se descarta y se avisa cuántas', async () => {
    const { a, sent, adv } = make();
    for (let i = 0; i < MAX_PER_MINUTE + 5; i++) a.send('warn', `aviso ${i}`);
    await idle(a);
    assert.equal(sent.length, MAX_PER_MINUTE);
    adv(61_000);
    a.send('warn', 'después'); await idle(a);
    assert.match(JSON.stringify(sent.at(-1)!.body), /5 alertas por exceso/);
});

test('un fallo de red o un 500 no tira nada y la cola sigue', async () => {
    let n = 0;
    const a = new Alerter({ url: 'http://x', fetchFn: async () => { n++; if (n === 1) throw new Error('sin red'); return { ok: false, status: 500 }; } });
    a.send('error', 'uno'); a.send('error', 'dos'); a.send('error', 'tres');
    await idle(a);
    assert.equal(n, 3);
});

test('recorta y limpia lo que no es confiable; menciona solo en error', async () => {
    assert.equal(clip('a\u0000b\u0007c', 10), 'a b c');
    assert.equal(clip('x'.repeat(2000), 900).length, 900);
    const { a, sent } = make({ mention: '<@123>' });
    a.send('error', 'caída', { msg: 'x'.repeat(5000), nada: undefined, nulo: null });
    a.send('warn', 'cliente');
    await idle(a);
    const e = sent[0].body;
    assert.equal(e.content, '<@123>');
    assert.ok(e.embeds[0].fields.every((f: any) => f.value.length <= 900));
    assert.ok(!e.embeds[0].fields.some((f: any) => f.name === 'nada' || f.name === 'nulo'));
    assert.equal(sent[1].body.content, undefined);
});

test('contadores diarios: suma, pico y reinicio', () => {
    const { a } = make();
    a.count('x'); a.count('x', 2); a.peak('p', 5); a.peak('p', 3);
    assert.deepEqual(a.takeDaily(), { x: 3, p: 5 });
    assert.deepEqual(a.takeDaily(), {});
});

test('buildInfo toma el commit del proveedor o dev', () => {
    assert.equal(buildInfo({ RENDER_GIT_COMMIT: 'abcdef1234567' } as any), 'abcdef1');
    assert.equal(buildInfo({} as any), 'dev');
});
