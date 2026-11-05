/** 8 slots (docs/ITEMS.md): guantes, botas, amuleto y dos anillos. Equipar, desequipar, stats de base por lugar y migración v6. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { BASE_BY_NAME, SLOTS, fitsSlot, slotsFor } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, migrateEcon, newEcon, type EconCtx } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { statsFromChar } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const join = (world: GameWorld, name: string) => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: 11, y: 11, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'paladin', faction: 'solmar' }));
        return { log, p: world.playerOf(session.sessionId)! };
    };
    return { eco, reg, join };
}
const ctx = (): EconCtx => ({ npcs: [], restat: () => {}, ground: { add: () => {} } as never });
const lastResult = (log: ServerMessage[]) => (log.filter((m) => m.payload?.$case === 'econResult').at(-1)?.payload as { value: { ok: boolean; code: string } } | undefined)?.value;

test('slots: son 8, los anillos entran en dos lugares y el resto en uno', () => {
    assert.equal(SLOTS.length, 8);
    assert.deepEqual(slotsFor('anillo'), ['anillo', 'anillo2']); assert.deepEqual(slotsFor('botas'), ['botas']);
    assert.ok(fitsSlot('anillo', 'anillo2') && !fitsSlot('guantes', 'botas'));
    assert.equal(BASE_BY_NAME.get('Amuleto del cazador')!.slot, 'amuleto');
});

test('equipar: el 2.º anillo va al lugar libre; con los dos llenos reemplaza al primero; desequipar el 2.º', () => {
    const { eco, reg, join } = setup(), w = reg.ensure('solmar_legacy');
    const J = join(w, 'anillos'), st = J.p.econ!;
    const mk = (n: string) => ({ u: st.nextUid++, n, r: 0, a: [] });
    const a = mk('Anillo opaco'), b = mk('Anillo de cobre'), c = mk('Anillo de plata');
    st.bag.push(a, b, c);
    eco.equip(J.p, ctx(), a.u); assert.equal(st.eq.anillo, a);
    eco.equip(J.p, ctx(), b.u); assert.equal(st.eq.anillo2, b); assert.equal(st.eq.anillo, a);
    eco.equip(J.p, ctx(), c.u); assert.equal(st.eq.anillo, c, 'con los dos llenos reemplaza al primero'); assert.ok(st.bag.includes(a));
    eco.unequip(J.p, ctx(), 'anillo2'); assert.equal(st.eq.anillo2, null); assert.ok(st.bag.includes(b));
    assert.equal(lastResult(J.log)?.ok, true);
});

test('stats: la base del anillo y los atributos cuentan igual en el 2.º lugar; el amuleto va en su slot', () => {
    const eq = { anillo: { n: 'Anillo opaco', a: [] }, anillo2: { n: 'Anillo opaco', a: [{ id: 'hp', v: 50 }] }, amuleto: { n: 'Amuleto del cazador', a: [{ id: 'hp', v: 16 }] } };
    const s0 = statsFromChar({ lvl: 10, cls: 'paladin', eq: {} } as never), s = statsFromChar({ lvl: 10, cls: 'paladin', eq } as never);
    assert.equal(s.rm - s0.rm, 16, 'rm 8 base de cada Anillo opaco, también en anillo2');
    assert.equal(s.maxHp - s0.maxHp, 66, 'vida de los atributos de anillo2 y del amuleto');
});

test('migración v6: claves nuevas, amuleto mal ubicado y exp fuera de los ítems', () => {
    const st = newEcon('paladin', 'solmar');
    for (const sl of ['guantes', 'botas', 'amuleto', 'anillo2'] as const) delete (st.eq as Record<string, unknown>)[sl]; // cuenta vieja
    const am = { u: st.nextUid++, n: 'Amuleto del cazador', r: 0, a: [{ id: 'exp' as const, v: 5 }] };
    st.eq.anillo = am; st.v = 5;
    assert.equal(migrateEcon(st), true); assert.equal(st.v, ECON_VERSION);
    for (const sl of SLOTS) assert.ok(sl in st.eq, `falta ${sl}`);
    assert.equal(st.eq.anillo, null); assert.equal(st.eq.amuleto, am, 'el amuleto pasa a su lugar');
    assert.equal(am.a.length, 0, 'el bonus de exp de caza se saca de los ítems');
});
