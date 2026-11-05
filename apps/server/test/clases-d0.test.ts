/** D.0: renombres de clase (guerrero -> pala, healer -> clerigo) y esqueleto del arquero. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASS_IDS, CLASS_KITS, CREATABLE_CLASS_IDS, canUseSkill, canonicalClass, isClass } from '@fdn/world';
import { ECON_VERSION, importLegacy, migrateEcon, newEcon, newEconChecked } from '../src/economy.ts';
import { sanitizeCharacter } from '../src/accounts.ts';

test('A: isClass acepta los ids nuevos y rechaza los viejos', () => {
    for (const c of ['pala', 'clerigo', 'mago', 'arquero']) assert.equal(isClass(c), true, c);
    for (const c of ['guerrero', 'healer', 'paladin', '', 'constructor']) assert.equal(isClass(c), false, c);
});

test('A: canonicalClass traduce solo los ids viejos', () => {
    assert.equal(canonicalClass('guerrero'), 'pala');
    assert.equal(canonicalClass('healer'), 'clerigo');
    for (const c of ['pala', 'clerigo', 'mago', 'arquero', 'otra', 'constructor', '__proto__']) assert.equal(canonicalClass(c), c);
});

test('A: el arquero está registrado, sin kit y sin poder crearse', () => {
    assert.ok(CLASS_IDS.includes('arquero'));
    assert.equal(CREATABLE_CLASS_IDS.includes('arquero'), false);
    assert.deepEqual(CLASS_KITS.arquero, {});
    assert.equal(canUseSkill('arquero', 120, 'ataque'), false);
});

test('H: el server no deja crear un arquero aunque el cliente lo pida', () => {
    assert.equal(newEconChecked('arquero', 'solmar'), undefined);
    assert.equal(sanitizeCharacter(JSON.stringify({ faction: 'solmar', cls: 'arquero' })), null);
});

for (const [viejo, nuevo] of [['guerrero', 'pala'], ['healer', 'clerigo']] as const) {
    test(`F: una cuenta guardada como ${viejo} sigue siendo su clase (${nuevo})`, () => {
        const st = newEcon(nuevo, 'solmar');
        st.cls = viejo; st.v = 6; st.lvl = 12; st.gold = 777;
        assert.equal(migrateEcon(st), true);
        assert.equal(st.cls, nuevo); assert.equal(st.v, ECON_VERSION);
        assert.equal(st.lvl, 12); assert.equal(st.gold, 777);
        assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
    });

    test(`F: los guardados previos a la economía del server con ${viejo} también se leen`, () => {
        const raw = JSON.stringify({ v: 1, faction: 'solmar', cls: viejo, lvl: 1, exp: 0, gold: 0, hp: 1, mp: 0, bag: [], eq: {} });
        assert.equal(importLegacy(raw)?.cls, nuevo);
        assert.equal(JSON.parse(sanitizeCharacter(raw)!).cls, nuevo);
    });
}

test('F: migrar no cambia a mago ni a una clase ya renombrada', () => {
    for (const c of ['mago', 'pala', 'clerigo']) {
        const st = newEcon(c, 'solmar'); st.v = 6;
        migrateEcon(st); assert.equal(st.cls, c);
    }
});
