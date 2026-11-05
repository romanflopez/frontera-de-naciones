/** D.18: «última conexión» en el detalle del personaje (texto relativo y mensaje de la lista de personajes). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerMessage } from '@fdn/proto';
import { lastSeenText } from '@fdn/world';
import * as M from '../src/messages.ts';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

test('A: lastSeenText: nunca, hace un momento, minutos, horas, ayer, días y fecha', () => {
    assert.equal(lastSeenText(0, NOW), 'Nunca entró'); assert.equal(lastSeenText(-5, NOW), 'Nunca entró'); assert.equal(lastSeenText(NaN, NOW), 'Nunca entró');
    assert.equal(lastSeenText(NOW - 30_000, NOW), 'Hace un momento'); assert.equal(lastSeenText(NOW + 5 * MIN, NOW), 'Hace un momento', 'un reloj adelantado no da un texto raro');
    assert.equal(lastSeenText(NOW - 5 * MIN, NOW), 'Hace 5 min'); assert.equal(lastSeenText(NOW - 59 * MIN, NOW), 'Hace 59 min');
    assert.equal(lastSeenText(NOW - 60 * MIN, NOW), 'Hace 1 h'); assert.equal(lastSeenText(NOW - 23 * H, NOW), 'Hace 23 h');
    assert.equal(lastSeenText(NOW - 24 * H, NOW), 'Ayer'); assert.equal(lastSeenText(NOW - 3 * D, NOW), 'Hace 3 días'); assert.equal(lastSeenText(NOW - 29 * D, NOW), 'Hace 29 días');
    assert.equal(lastSeenText(NOW - 40 * D, NOW), 'El 26/9/2026');
});

test('A: la lista de personajes manda la última conexión (0 si nunca entró) y llega intacta', () => {
    const m = M.characterList([{ name: 'Ana', cls: 'mago', faction: 'solmar', level: 12, zone: 'Villa', lastLogin: NOW }, { name: 'Beto', cls: 'paladin', faction: 'vhar', level: 1, zone: '' }], 3);
    const back = ServerMessage.decode(ServerMessage.encode(m).finish()).payload as { $case: 'characterList'; value: { characters: { name: string; lastLogin: bigint }[] } };
    assert.equal(back.$case, 'characterList');
    assert.equal(Number(back.value.characters[0].lastLogin), NOW); assert.equal(Number(back.value.characters[1].lastLogin), 0, 'sin dato = nunca');
});
