import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerMessage } from '@fdn/proto';
import { PARTY_MAX, PartyService, partyExpMult, type MemberInfo } from '../src/party.ts';

function setup() {
    const people = new Map<string, MemberInfo>(), inbox = new Map<string, ServerMessage[]>(); let t = 1_000_000;
    const add = (sid: string, name: string, faction = 'solmar', online = true) => { people.set(sid, { name, faction, level: 5, hp: 100, maxHp: 120, map: 'campos_de_sal', online }); inbox.set(sid, []); };
    const svc = new PartyService({
        sessionByName: (n) => [...people].find(([, i]) => i.online && i.name.toLowerCase() === n.toLowerCase())?.[0],
        send: (sid, m) => { inbox.get(sid)?.push(m); },
        info: (sid) => people.get(sid), now: () => t,
    });
    const texts = (sid: string) => inbox.get(sid)!.flatMap((m) => (m.payload?.$case === 'sendMessage' ? [m.payload.value.message] : []));
    const state = (sid: string) => { const l = inbox.get(sid)!.filter((m) => m.payload?.$case === 'partyState'); const last = l[l.length - 1]; return last?.payload?.$case === 'partyState' ? last.payload.value.members : undefined; };
    return { svc, add, texts, state, people, inbox, advance: (ms: number) => { t += ms; } };
}
const join = (svc: PartyService, a: string, b: string, nameB: string) => { svc.handle(a, 'invite', nameB); svc.handle(b, 'accept', ''); };

test('party: invitar y aceptar arma la party con líder y avisa a los miembros', () => {
    const { svc, add, texts, state } = setup(); add('a', 'Ana'); add('b', 'Beto');
    svc.handle('a', 'invite', 'beto'); assert.ok(inboxHas(texts('b'), /Ana te invitó/));
    svc.handle('b', 'accept', '');
    assert.deepEqual(svc.mates('a').sort(), ['a', 'b']); assert.ok(svc.isLeader('a')); assert.ok(!svc.isLeader('b'));
    assert.equal(state('a')!.length, 2); assert.equal(state('b')!.find((m) => m.leader)!.name, 'Ana');
});
const inboxHas = (l: string[], re: RegExp) => l.some((x) => re.test(x));

test('party: solo misma facción, no a uno mismo, no a desconectados', () => {
    const { svc, add, texts } = setup(); add('a', 'Ana'); add('b', 'Vera', 'vhar'); add('c', 'Off', 'solmar', false);
    svc.handle('a', 'invite', 'Vera'); assert.ok(inboxHas(texts('a'), /tu facción/));
    svc.handle('a', 'invite', 'Ana'); svc.handle('a', 'invite', 'Off'); svc.handle('a', 'invite', 'nadie');
    assert.equal(svc.mates('a').length, 1);
});

test('party: máximo 4, solo el líder invita y no se invita a quien ya tiene party', () => {
    const { svc, add, texts } = setup(); for (const [s, n] of [['a', 'Ana'], ['b', 'Beto'], ['c', 'Cami'], ['d', 'Dani'], ['e', 'Eli']]) add(s, n);
    join(svc, 'a', 'b', 'Beto'); join(svc, 'a', 'c', 'Cami'); join(svc, 'a', 'd', 'Dani');
    assert.equal(svc.mates('a').length, PARTY_MAX);
    svc.handle('a', 'invite', 'Eli'); assert.ok(inboxHas(texts('a'), /ya tiene/));
    svc.handle('b', 'invite', 'Eli'); assert.ok(inboxHas(texts('b'), /Solo el líder/));
    add('f', 'Fede'); svc.handle('f', 'invite', 'Beto'); assert.ok(inboxHas(texts('f'), /ya está en una party/));
});

test('party: la invitación vence a los 30 s', () => {
    const { svc, add, texts, advance } = setup(); add('a', 'Ana'); add('b', 'Beto');
    svc.handle('a', 'invite', 'Beto'); advance(31_000); svc.tick();
    svc.handle('b', 'accept', ''); assert.ok(inboxHas(texts('b'), /No tenés invitaciones/)); assert.equal(svc.mates('b').length, 1);
    assert.ok(inboxHas(texts('a'), /no respondió/));
});

test('party: rechazar, salir, líder que se va pasa al siguiente y con uno solo se disuelve', () => {
    const { svc, add, texts, state } = setup(); add('a', 'Ana'); add('b', 'Beto'); add('c', 'Cami');
    svc.handle('a', 'invite', 'Beto'); svc.handle('b', 'decline', ''); assert.equal(svc.mates('a').length, 1);
    join(svc, 'a', 'b', 'Beto'); join(svc, 'a', 'c', 'Cami');
    svc.leave('a', 'Saliste de la party.'); assert.deepEqual(svc.mates('b').sort(), ['b', 'c']); assert.ok(svc.isLeader('b'));
    assert.deepEqual(state('a'), []);
    svc.handle('c', 'leave', ''); assert.equal(svc.mates('b').length, 1); assert.equal(svc.partyIdOf('b'), undefined);
    assert.ok(inboxHas(texts('b'), /se disolvió/));
});

test('party: expulsar y pasar liderazgo solo el líder', () => {
    const { svc, add, texts } = setup(); add('a', 'Ana'); add('b', 'Beto'); add('c', 'Cami');
    join(svc, 'a', 'b', 'Beto'); join(svc, 'a', 'c', 'Cami');
    svc.handle('b', 'kick', 'Cami'); assert.ok(inboxHas(texts('b'), /Solo el líder/));
    svc.handle('a', 'leader', 'Beto'); assert.ok(svc.isLeader('b'));
    svc.handle('b', 'kick', 'cami'); assert.equal(svc.mates('b').length, 2); assert.equal(svc.partyIdOf('c'), undefined);
    assert.ok(inboxHas(texts('c'), /expulsaron/));
});

test('party: chat de party solo llega a los miembros; sin party devuelve false', () => {
    const { svc, add, inbox } = setup(); add('a', 'Ana'); add('b', 'Beto'); add('c', 'Cami');
    assert.equal(svc.chat('a', 'hola', 'Ana'), false);
    join(svc, 'a', 'b', 'Beto'); assert.equal(svc.chat('a', 'hola', 'Ana'), true);
    const got = (sid: string) => inbox.get(sid)!.filter((m) => m.payload?.$case === 'chatMessageReceived').length;
    assert.equal(got('a'), 1); assert.equal(got('b'), 1); assert.equal(got('c'), 0);
});

test('party: la exp total crece 10 % por compañero extra y se reparte en partes iguales', () => {
    assert.equal(partyExpMult(1), 1);
    assert.ok(Math.abs(partyExpMult(2) * 2 - 1.1) < 1e-9); assert.ok(Math.abs(partyExpMult(4) * 4 - 1.3) < 1e-9);
});
