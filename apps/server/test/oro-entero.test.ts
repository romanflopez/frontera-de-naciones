/** Un oro con decimales hacía caer el server (int32 del protocolo) al entrar: se migra a entero y el oro nuevo ya sale entero. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatGold } from '@fdn/world';
import { ECON_VERSION, migrateEcon, newEcon } from '../src/economy.ts';
import { inventoryState } from '../src/messages.ts';
import { ServerMessage } from '@fdn/proto';

test('F: migrateEcon baja a entero el oro con decimales (v14 -> v15)', () => {
    const st = newEcon('mago', 'solmar'); st.v = 14; st.gold = 233.46153846153845;
    migrateEcon(st);
    assert.equal(st.v, ECON_VERSION); assert.equal(st.gold, 233);
    const st2 = newEcon('mago', 'solmar'); st2.v = 14; st2.gold = 6227.25; migrateEcon(st2); assert.equal(st2.gold, 6227);
});
test('el estado de inventario con oro fraccionario igual se codifica', () => {
    const st = newEcon('mago', 'solmar'); st.gold = 269.46153846153845;
    assert.doesNotThrow(() => ServerMessage.encode(inventoryState(st)));
});
test('repeatGold es entero a todos los niveles', () => {
    for (let l = 1; l <= 120; l++) assert.ok(Number.isInteger(repeatGold(l)), `nivel ${l}`);
});
