// Pruebas de personajes por cuenta: máximo 3, nombres únicos, borrado, migración de cuentas viejas y depósito compartido.
// Correr: cd apps/server && npx tsx --test test/personajes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountKey, charKey, charKeysOf, charNameTaken, createCharacter, deleteCharacter, findChar, MAX_CHARS } from '../src/accounts.ts';
import { Depot, type Actor } from '../src/deposit.ts';
import { newEcon, newEconChecked } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';

class MemStorage implements Storage {
    data = new Map<string, AccountRecord>();
    get(k: string) { return this.data.get(k); }
    put(k: string, r: AccountRecord) { this.data.set(k, r); }
    flush() {}
}
const acct = (st: MemStorage, name: string, extra: Partial<AccountRecord> = {}): string => {
    const key = accountKey(name); st.put(key, { name, salt: 'aa', hash: 'bb', created: 1, lastLogin: 1, ...extra }); return key;
};
const mk = (st: MemStorage, acc: string, name: string) => createCharacter(st, acc, name, newEcon('guerrero', 'solmar'));

test('una cuenta nueva no tiene personajes y puede crear hasta 3', () => {
    const st = new MemStorage(), a = acct(st, 'ana');
    assert.deepEqual(charKeysOf(st, a), []);
    assert.equal(MAX_CHARS, 3);
    for (const n of ['Uno', 'Dos', 'Tres']) assert.equal(mk(st, a, n).ok, true, n);
    assert.equal(charKeysOf(st, a).length, 3);
    const r = mk(st, a, 'Cuatro');
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /3 personajes/);
    assert.equal(charKeysOf(st, a).length, 3);
});

test('los nombres son únicos en todo el server, sin importar mayúsculas ni espacios de más', () => {
    const st = new MemStorage(), a = acct(st, 'ana'), b = acct(st, 'beto');
    assert.equal(mk(st, a, 'Gandalf').ok, true);
    for (const n of ['gandalf', 'GANDALF', '  Gandalf ']) { const r = mk(st, b, n); assert.equal(r.ok, false, n); assert.match((r as { error: string }).error, /en uso/); }
    assert.equal(charKeysOf(st, b).length, 0);
    // dos veces el mismo nombre en la misma cuenta tampoco
    assert.equal(mk(st, a, 'Gandalf').ok, false);
});

test('el nombre se valida igual que el de la cuenta (largo y caracteres)', () => {
    const st = new MemStorage(), a = acct(st, 'ana');
    for (const n of ['a', 'x'.repeat(17), 'mal<nombre>', '', '   ']) assert.equal(mk(st, a, n).ok, false, JSON.stringify(n));
    assert.equal(charKeysOf(st, a).length, 0);
    assert.equal(mk(st, a, 'Ñandú_2').ok, true);
});

test('el nombre de una cuenta no bloquea el de un personaje, y un personaje no bloquea el de una cuenta', () => {
    const st = new MemStorage(), a = acct(st, 'ana'), b = acct(st, 'beto');
    assert.equal(mk(st, a, 'beto').ok, true); // existe la cuenta "beto" pero sin personaje
    assert.equal(st.get(accountKey('beto'))?.name, 'beto');
    assert.equal(st.get(charKey('beto'))?.owner, a);
    assert.equal(charKeysOf(st, b).length, 0);
});

test('borrar libera el nombre, deja el cupo y no destruye el dato', () => {
    const st = new MemStorage(), a = acct(st, 'ana'), b = acct(st, 'beto');
    for (const n of ['Uno', 'Dos', 'Tres']) mk(st, a, n);
    const r = deleteCharacter(st, a, 'dos'); assert.equal(r.ok, true);
    assert.deepEqual(charKeysOf(st, a).map((k) => st.get(k)!.name), ['Uno', 'Tres']);
    assert.equal(charNameTaken(st, 'Dos'), false);
    assert.ok(st.get(charKey('Dos'))?.charDeleted, 'borrado lógico: el registro sigue');
    assert.equal(mk(st, b, 'Dos').ok, true); // otra cuenta toma el nombre
    assert.equal(mk(st, a, 'Cuatro').ok, true); // y la cuenta recuperó el cupo
    assert.equal(findChar(st, a, 'DOS'), undefined);
    assert.equal(deleteCharacter(st, a, 'noexiste').ok, false);
});

test('no se puede borrar el personaje de otra cuenta', () => {
    const st = new MemStorage(), a = acct(st, 'ana'), b = acct(st, 'beto');
    mk(st, a, 'Ana1');
    assert.equal(deleteCharacter(st, b, 'Ana1').ok, false);
    assert.equal(charKeysOf(st, a).length, 1);
});

test('cuenta vieja: su personaje es la propia cuenta, se migra solo y ocupa un cupo y su nombre', () => {
    const st = new MemStorage(), a = acct(st, 'Vieja', { econ: newEcon('mago', 'vhar'), pos: undefined });
    assert.equal(st.get(a)?.chars, undefined);
    assert.deepEqual(charKeysOf(st, a), [a]);
    assert.deepEqual(st.get(a)?.chars, [a]);
    assert.equal(charNameTaken(st, 'vieja'), true);
    const b = acct(st, 'otro');
    assert.equal(mk(st, b, 'VIEJA').ok, false);
    assert.equal(mk(st, a, 'Nueva').ok, true);
    assert.equal(charKeysOf(st, a).length, 2);
});

test('cuenta vieja sin personaje (se registró y no llegó a crear): arranca con 0', () => {
    const st = new MemStorage(), a = acct(st, 'Fantasma');
    assert.deepEqual(charKeysOf(st, a), []);
    assert.equal(charNameTaken(st, 'Fantasma'), false);
});

test('borrar el personaje de una cuenta vieja libera el nombre y no toca la contraseña', () => {
    const st = new MemStorage(), a = acct(st, 'Vieja', { econ: newEcon('mago', 'vhar') });
    assert.equal(deleteCharacter(st, a, 'vieja').ok, true);
    assert.deepEqual(charKeysOf(st, a), []);
    assert.equal(charNameTaken(st, 'Vieja'), false);
    assert.equal(st.get(a)?.hash, 'bb'); assert.equal(st.get(a)?.salt, 'aa');
    const r = mk(st, a, 'Vieja'); // puede volver a crear uno con el mismo nombre (clave nueva)
    assert.equal(r.ok, true);
    assert.equal(charKeysOf(st, a).length, 1);
    assert.notEqual(charKeysOf(st, a)[0], a);
});

test('clase y facción inválidas no crean economía', () => {
    assert.equal(newEconChecked('dragon', 'solmar'), undefined);
    assert.equal(newEconChecked('mago', 'nadie'), undefined);
    assert.equal(newEconChecked(undefined, undefined), undefined);
    assert.equal(newEconChecked('healer', 'vhar')?.cls, 'healer');
});

test('el depósito es de la cuenta: los personajes de la misma cuenta lo comparten y otra cuenta no lo ve', () => {
    const st = new MemStorage(), a = acct(st, 'ana'), b = acct(st, 'beto');
    const x = mk(st, a, 'Uno') as { key: string }, y = mk(st, a, 'Dos') as { key: string }, z = mk(st, b, 'Otro') as { key: string };
    const dp = new Depot(st); dp.log = () => {};
    const actor = (key: string, name: string): Actor => ({ key, name, econ: st.get(key)!.econ! });
    const A = actor(x.key, 'Uno'); A.econ.gold = 500; A.econ.bag = [];
    const r = dp.goldIn(A, 300); assert.equal(r.ok, true, r.text);
    assert.equal(dp.vault(y.key).gold, 300, 'el otro personaje de la cuenta ve el oro');
    assert.equal(dp.vault(z.key).gold, 0, 'otra cuenta no');
    const B = actor(y.key, 'Dos'); B.econ.gold = 0;
    assert.equal(dp.goldOut(B, 200).ok, true);
    assert.equal(B.econ.gold, 200);
    assert.equal((st.get(a) as { vault?: { gold: number } }).vault?.gold, 100, 'el depósito vive en el registro de la cuenta');
    assert.equal((st.get(x.key) as { vault?: unknown }).vault, undefined, 'y no en el del personaje');
});
