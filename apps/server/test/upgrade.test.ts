/** Mejora +N de ítems únicos (docs/ITEMS.md §7): costo, probabilidades, tope y efecto en el combate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { MAPS, buildMap, roleOf } from '@fdn/world';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';

const settings = loadSettings(), catalogs = loadCatalogs();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const join = (world: GameWorld, name: string, at: { x: number; y: number }, faction = 'solmar') => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction }));
        world.handleClientPacket(session.sessionId, { payload: { $case: 'changePlayerProfileRequest', value: { profile: `${faction};guerrero;` } } } as never);
        reg.sessionHook = (id) => (id === session.sessionId ? { session } : undefined);
        return { session, log, p: world.playerOf(session.sessionId)! };
    };
    return { reg, eco, join };
}

test('mejora +N: gasta piedras y oro, puede fallar sin bajar, arranca en 33 %, tope +5 y solo ítems únicos', () => {
    const { reg, join } = setup(), w = reg.ensure('solmar_herreria');
    const npc = buildMap('solmar_herreria').npcs.find((n) => roleOf(n) === 'armero')!;
    const J = join(w, 'herrero', MAPS.solmar_herreria.spawn); J.p.setPosition(npc.x + 1, npc.y + 1);
    const st = J.p.econ!; st.gold = 100_000; st.forge = 100;
    st.bag.push({ u: 900, n: 'Hoja de sal', r: 2, a: [{ id: 'aspd', v: 8 }, { id: 'crit', v: 4 }] }, { u: 901, n: 'Espada corta', r: 0, a: [] });
    const up = (uid = 900) => { J.log.length = 0; J.p.econ!; w.handleClientPacket(J.session.sessionId, { payload: { $case: 'econUpgradeRequest', value: { npcId: npc.id, uid } } } as never); return (J.log.filter((m) => m.payload?.$case === 'econResult').at(-1)!.payload as any).value; };
    const it = () => st.bag.find((x) => x.u === 900)!, rnd = Math.random;
    try {
        Math.random = () => 0; // todo sale bien
        // el límite de ritmo de acciones (20 por ráfaga) no estorba: son pocas
        for (let i = 1; i <= 3; i++) assert.equal(up().ok, true, `+${i}`);
        assert.equal(it().up, 3); assert.equal(st.forge, 100 - (1 + 2 + 3)); assert.equal(st.gold, 100_000 - 40 * 1 * (1 + 2 + 3));
        Math.random = () => 0.95; // falla la de +4 (25 %): se pierde el costo, el ítem queda igual
        const f = up(); assert.equal(f.ok, true); assert.match(f.text, /falló/); assert.equal(it().up, 3); assert.equal(st.forge, 94 - 4); assert.equal(st.gold, 100_000 - 240 - 160);
        Math.random = () => 0; assert.equal(up().ok, true); assert.equal(it().up, 4);
        assert.equal(up().ok, true); assert.equal(it().up, 5);
        const m = up(); assert.equal(m.ok, false); assert.equal(m.code, 'max');
        assert.equal(up(901).code, 'not_unique');
        st.forge = 0; it().up = 0; assert.equal(up().code, 'stones');
        st.forge = 10; st.gold = 0; assert.equal(up().code, 'gold');
    } finally { Math.random = rnd; }
});

test('mejora +N: las probabilidades arrancan en 33 % y no suben con el nivel', async () => {
    const { UP_RATE } = await import('../src/economy.ts');
    assert.equal(UP_RATE[0], 0.33); assert.ok(UP_RATE.every((r, i) => r <= (UP_RATE[i - 1] ?? 1) && r > 0 && r <= 0.33));
});

test('mejora +N: sube los stats base (+4 % por nivel) en el cálculo de combate del server', async () => {
    const { statsFromChar } = await import('../src/systems/pvpCombat.ts');
    const base = statsFromChar({ lvl: 5, cls: 'guerrero', eq: { arma: { n: 'Espada del Cañón' } } }), up5 = statsFromChar({ lvl: 5, cls: 'guerrero', eq: { arma: { n: 'Espada del Cañón', up: 5 } } });
    assert.ok(up5.wdmg[1] > base.wdmg[1] && up5.wdmg[0] >= base.wdmg[0]);
    assert.equal(up5.wdmg[1], Math.round(base.wdmg[1] * 1.2));
});

