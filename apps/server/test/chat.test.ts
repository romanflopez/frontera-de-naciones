import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { CHAT_PER_MINUTE, CHAT_THROTTLE_MS, ChatManager } from '../src/systems/chat.ts';

function setup() {
    let t = 1_000_000;
    const inbox = new Map<string, ServerMessage[]>(), factions = new Map<string, string>(), parties = new Map<string, string[]>();
    for (const [sid, fac] of [['a', 'solmar'], ['b', 'solmar'], ['c', 'vhar']] as const) { inbox.set(sid, []); factions.set(sid, fac); }
    const chat = new ChatManager({
        maxLength: 200,
        allSessions: () => inbox.keys(),
        viewersOf: (sid) => [sid],
        partyOf: (sid) => parties.get(sid) ?? [],
        factionOf: (sid) => factions.get(sid),
        send: (sid, m) => { inbox.get(sid)?.push(m); },
    }, () => t);
    const me = { sessionId: 'a', name: 'Ana', playerId: '1' };
    const got = (sid: string) => inbox.get(sid)!.length;
    return { chat, me, got, advance: (ms: number) => { t += ms; } };
}

test('chat: comercio le llega a todos los conectados, de cualquier nación', () => {
    const { chat, me, got } = setup();
    assert.equal(chat.handle(me, 'comercio', 'vendo espada'), null);
    assert.deepEqual(['a', 'b', 'c'].map(got), [1, 1, 1]);
});

test('chat: nación solo llega a la propia facción', () => {
    const { chat, me, got } = setup();
    assert.equal(chat.handle(me, 'nacion', 'hola'), null);
    assert.deepEqual(['a', 'b', 'c'].map(got), [1, 1, 0]);
});

test('chat: canal desconocido y mensaje vacío se rechazan', () => {
    const { chat, me } = setup();
    assert.match(chat.handle(me, 'susurro', 'hola')!, /desconocido/);
    assert.match(chat.handle(me, 'global', '   ')!, /vacío/);
});

test('chat: máximo de mensajes por minuto, sumando todos los canales', () => {
    const { chat, me, got, advance } = setup();
    for (let i = 0; i < CHAT_PER_MINUTE; i++) {
        assert.equal(chat.handle(me, i % 2 ? 'comercio' : 'global', `m${i}`), null, `mensaje ${i}`);
        advance(CHAT_THROTTLE_MS + 1);
    }
    assert.equal(got('b'), CHAT_PER_MINUTE);
    assert.match(chat.handle(me, 'global', 'uno más')!, /límite/);
    assert.equal(got('b'), CHAT_PER_MINUTE, 'el mensaje bloqueado no se reparte');
});

test('chat: pasado el minuto se puede volver a escribir y forget limpia el estado', () => {
    const { chat, me, advance } = setup();
    for (let i = 0; i < CHAT_PER_MINUTE; i++) { chat.handle(me, 'global', `m${i}`); advance(CHAT_THROTTLE_MS + 1); }
    assert.match(chat.handle(me, 'global', 'x')!, /límite/);
    advance(60_000);
    assert.equal(chat.handle(me, 'global', 'ya puedo'), null);
    chat.forget('a');
    for (let i = 0; i < CHAT_PER_MINUTE; i++) { advance(CHAT_THROTTLE_MS + 1); assert.equal(chat.handle(me, 'global', `n${i}`), null); }
});

test('chat: el tope de 1 mensaje por segundo sigue vigente y no gasta cupo por minuto', () => {
    const { chat, me, advance } = setup();
    assert.equal(chat.handle(me, 'global', 'a'), null);
    assert.match(chat.handle(me, 'global', 'b')!, /muy rápido/);
    advance(CHAT_THROTTLE_MS + 1);
    for (let i = 1; i < CHAT_PER_MINUTE; i++) { assert.equal(chat.handle(me, 'global', `m${i}`), null); advance(CHAT_THROTTLE_MS + 1); }
    assert.match(chat.handle(me, 'global', 'z')!, /límite/);
});
