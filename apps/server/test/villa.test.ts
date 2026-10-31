/** Villa de Solmar (Fase 2): puertas de los edificios ida y vuelta, respawn en el templo, hogar de la facción y Portal de Frontera. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { HUNT_ARRIVALS, INTERIORS, LLANOS, MAPS, TEMPLE_RESPAWN, VILLA, VILLA_BUILDINGS, buildMap, factionHome, getMapDef, respawnTarget, roleOf, roomOf, validateMapGraph, villaDoor, type VillaBuilding } from '@fdn/world';
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
const find = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k).at(-1)?.payload as any;
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
const pos = (w: GameWorld, sid: string) => { const p = w.playerOf(sid)!; return [p.posX, p.posY]; };

test('la villa y sus interiores están en el registro y el grafo valida', () => {
    assert.deepEqual(validateMapGraph(), []);
    assert.ok(MAPS.solmar_villa);
    for (const it of INTERIORS) {
        const d = MAPS[it.id]; assert.ok(d, it.id);
        assert.equal(d.safe, true); assert.equal(d.pvp, 'off');
        assert.ok(d.size >= 16 && d.size <= 28, `${it.id}: ${d.size}`);
    }
    assert.equal(MAPS.solmar_villa.size, 128); assert.equal(MAPS.solmar_villa.pvp, 'off');
});

test('cada edificio tiene puerta de ida (villa -> interior) y de vuelta (interior -> frente a la puerta)', () => {
    const villa = buildMap('solmar_villa');
    for (const k of Object.keys(VILLA_BUILDINGS) as VillaBuilding[]) {
        const it = INTERIORS.find((i) => i.building === k)!, d = villaDoor(k), r = roomOf(it);
        const go = MAPS.solmar_villa.links.find((l) => l.id === `villa_a_${k}`)!, back = MAPS[it.id].links.find((l) => l.id === `${k}_a_villa`)!;
        assert.deepEqual([go.x, go.y], [d.door.x, d.door.y]); assert.deepEqual(go.to, { map: it.id, ...r.arrive });
        assert.deepEqual([back.x, back.y], [r.exit.x, r.exit.y]); assert.deepEqual(back.to, { map: 'solmar_villa', ...d.out });
        assert.equal(Math.abs(d.door.x - d.out.x) + Math.abs(d.door.y - d.out.y), 1, 'la llegada al salir queda pegada a la puerta');
        assert.ok(!villa.blocked[d.door.y][d.door.x] && !villa.blocked[d.out.y][d.out.x], k);
        // la puerta está pegada a la fachada del edificio
        const b = villa.buildings.find((q) => q.x === VILLA_BUILDINGS[k].x && q.y === VILLA_BUILDINGS[k].y)!;
        assert.ok((d.door.y === b.y + b.h && d.door.x >= b.x && d.door.x < b.x + b.w) || (d.door.x === b.x + b.w && d.door.y >= b.y && d.door.y < b.y + b.h), k);
    }
});

test('los NPC de cada interior (incluido el Subastador en el Ayuntamiento)', () => {
    const roles = (id: string) => buildMap(id).npcs.map(roleOf).sort();
    assert.deepEqual(roles('solmar_ayuntamiento'), ['capitan', 'guardia', 'subastador']);
    assert.deepEqual(roles('solmar_herreria'), ['armadurero', 'armero']);
    assert.deepEqual(roles('solmar_tienda'), ['alquimista', 'mercader']);
    assert.deepEqual(roles('solmar_joyeria'), ['joyero']);
    assert.deepEqual(roles('solmar_deposito'), ['depositario']);
    assert.deepEqual(roles('solmar_templo'), ['sanador']);
    assert.deepEqual(roles('solmar_torre'), ['mago']);
    assert.ok(roles('solmar_cuartel').every((r) => r === 'guardia') && roles('solmar_cuartel').length >= 2);
    assert.equal(buildMap('solmar_ayuntamiento').npcs.find((n) => roleOf(n) === 'subastador')!.id, 'subastador_s');
});

test('entrar y salir del Templo por la puerta (cruce de dos fases ida y vuelta)', () => {
    const { reg, join } = setup();
    const villa = reg.ensure('solmar_villa'), d = villaDoor('templo');
    const J = join(villa, 'teo', VILLA.spawn); // (setPosition no mueve la ocupación: se entra lejos de la llegada)
    villa.playerOf(J.session.sessionId)!.setPosition(d.door.x, d.door.y);
    assert.equal(reg.handlePortal(J.session, 'villa_a_templo'), null);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_templo');
    assert.equal(reg.completeTransfer(J.session.sessionId, 'solmar_templo', reg.hashOf('solmar_templo')), true);
    const templo = reg.get('solmar_templo')!, r = roomOf(INTERIORS.find((i) => i.id === 'solmar_templo')!);
    assert.deepEqual(pos(templo, J.session.sessionId), [r.arrive.x, r.arrive.y]);
    // lejos de la salida no pasa nada
    assert.equal(reg.handlePortal(J.session, 'templo_a_villa'), null);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    templo.playerOf(J.session.sessionId)!.setPosition(r.exit.x, r.exit.y);
    assert.equal(reg.handlePortal(J.session, 'templo_a_villa'), null);
    assert.equal(reg.completeTransfer(J.session.sessionId, 'solmar_villa', reg.hashOf('solmar_villa')), true);
    assert.deepEqual(pos(villa, J.session.sessionId), [d.out.x, d.out.y]);
});

test('Solmar reaparece en el Templo al morir en el mapa viejo; Vhar en su ciudad', () => {
    assert.deepEqual(respawnTarget(getMapDef('solmar_legacy')!, 'solmar'), { map: 'solmar_templo', ...TEMPLE_RESPAWN });
    assert.deepEqual(respawnTarget(getMapDef('solmar_villa')!, 'solmar'), { map: 'solmar_templo', ...TEMPLE_RESPAWN });
    assert.equal(respawnTarget(getMapDef('solmar_legacy')!, 'vhar').map, 'solmar_legacy');
    const { reg, join } = setup();
    const legacy = reg.ensure('solmar_legacy');
    const J = join(legacy, 'rita', { x: 26, y: 26 });
    J.p.hp = 0; J.p.deadAt = Date.now() - 5000;
    legacy.handleClientPacket(J.session.sessionId, { payload: { $case: 'respawnRequest', value: {} } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_templo');
    assert.ok(J.p.hp > 0);
    reg.completeTransfer(J.session.sessionId, 'solmar_templo', reg.hashOf('solmar_templo'));
    assert.deepEqual(pos(reg.get('solmar_templo')!, J.session.sessionId), [TEMPLE_RESPAWN.x, TEMPLE_RESPAWN.y]);
});

test('un personaje nuevo de Solmar va a la villa (hogar de la facción); uno de Vhar se queda en el mapa viejo', () => {
    const home = factionHome('solmar')!;
    assert.deepEqual(home, { map: 'solmar_villa', ...VILLA.spawn });
    const { reg, join } = setup();
    const legacy = reg.ensure('solmar_legacy');
    const J = join(legacy, 'nuevo', { x: 7, y: 8 });
    legacy.handleClientPacket(J.session.sessionId, { payload: { $case: 'playerTeleportRequested', value: { x: home.x, y: home.y } } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_villa');
    reg.completeTransfer(J.session.sessionId, 'solmar_villa', reg.hashOf('solmar_villa'));
    assert.deepEqual(pos(reg.get('solmar_villa')!, J.session.sessionId), [home.x, home.y]);
    assert.equal(factionHome('vhar')!.map, 'solmar_legacy');
});

test('el Portal de Frontera de la villa lleva a las zonas (mapas de caza y mapa viejo)', () => {
    const { reg, join } = setup();
    const villa = reg.ensure('solmar_villa');
    const J = join(villa, 'viajera', { x: VILLA.portal.x + 1, y: VILLA.portal.y + 1 });
    // Campamento goblin se mudó a los Llanos del Alba (Fase 3)
    villa.handleClientPacket(J.session.sessionId, { payload: { $case: 'waypointRequest', value: { id: 'goblins' } } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'llanos_alba');
    assert.deepEqual([reg.pendingOf(J.session.sessionId)!.x, reg.pendingOf(J.session.sessionId)!.y], [HUNT_ARRIVALS.goblins.x, HUNT_ARRIVALS.goblins.y]);
    reg.completeTransfer(J.session.sessionId, 'llanos_alba', reg.hashOf('llanos_alba'));
    // de vuelta a la villa a pie y una zona que sigue en el mapa viejo (Hormiguero ardiente, abierta por nivel)
    const llanos = reg.get('llanos_alba')!;
    llanos.playerOf(J.session.sessionId)!.setPosition(LLANOS.toVilla.x, LLANOS.toVilla.y);
    reg.handlePortal(J.session, 'llanos_a_villa');
    reg.completeTransfer(J.session.sessionId, 'solmar_villa', reg.hashOf('solmar_villa'));
    villa.playerOf(J.session.sessionId)!.setPosition(VILLA.portal.x + 1, VILLA.portal.y + 1);
    J.p.prog.lvl = 20;
    villa.handleClientPacket(J.session.sessionId, { payload: { $case: 'waypointRequest', value: { id: 'hormiguero' } } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_legacy');
    reg.completeTransfer(J.session.sessionId, 'solmar_legacy', reg.hashOf('solmar_legacy'));
    const legacy = reg.get('solmar_legacy')!, arr = buildMap('solmar_legacy').waypointArrivals!.hormiguero;
    const [x, y] = pos(legacy, J.session.sessionId);
    assert.ok(Math.abs(x - arr.x) + Math.abs(y - arr.y) <= 3);
    // la zona no tiene portal de regreso: "volver a la ciudad" desde ahí se rechaza (para eso está el recall, ver recall.test.ts)
    assert.equal(buildMap('solmar_legacy').waypoints!.find((q) => q.id === 'zone:hormiguero'), undefined);
    legacy.handleClientPacket(J.session.sessionId, { payload: { $case: 'waypointRequest', value: { id: 'city' } } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    assert.match(find(J.log, 'sendMessage').value.message, /Portal de Frontera/);
});

test('camino entre la villa y los Llanos del Alba, ida y vuelta', () => {
    const { reg, join } = setup();
    const villa = reg.ensure('solmar_villa');
    const J = join(villa, 'caminante', VILLA.spawn);
    villa.playerOf(J.session.sessionId)!.setPosition(VILLA.toLegacy.x, VILLA.toLegacy.y);
    reg.handlePortal(J.session, 'villa_a_llanos');
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'llanos_alba');
    reg.completeTransfer(J.session.sessionId, 'llanos_alba', reg.hashOf('llanos_alba'));
    const llanos = reg.get('llanos_alba')!;
    assert.deepEqual(pos(llanos, J.session.sessionId), [LLANOS.fromVilla.x, LLANOS.fromVilla.y]);
    llanos.playerOf(J.session.sessionId)!.setPosition(LLANOS.toVilla.x, LLANOS.toVilla.y);
    reg.handlePortal(J.session, 'llanos_a_villa');
    reg.completeTransfer(J.session.sessionId, 'solmar_villa', reg.hashOf('solmar_villa'));
    assert.deepEqual(pos(villa, J.session.sessionId), [VILLA.fromLegacy.x, VILLA.fromLegacy.y]);
});

test('las tiendas de los interiores validan la distancia contra los NPC del interior', () => {
    const { reg, join } = setup();
    const tienda = reg.ensure('solmar_tienda'), m = buildMap('solmar_tienda'), merc = m.npcs.find((n) => n.id === 'mercader_s')!;
    const J = join(tienda, 'compradora', { x: merc.x, y: merc.y + 1 });
    J.p.econ!.gold = 500;
    tienda.handleClientPacket(J.session.sessionId, { payload: { $case: 'econBuyRequest', value: { npcId: 'mercader_s', stockIndex: 0 } } } as never);
    assert.equal(find(J.log, 'econResult').value.ok, true, find(J.log, 'econResult').value.text);
    // el mismo id de NPC no existe en la villa: allá no se puede comprar
    const villa = reg.ensure('solmar_villa'), K = join(villa, 'lejana', VILLA.spawn);
    K.p.econ!.gold = 500;
    villa.handleClientPacket(K.session.sessionId, { payload: { $case: 'econBuyRequest', value: { npcId: 'mercader_s', stockIndex: 0 } } } as never);
    assert.equal(find(K.log, 'econResult').value.ok, false);
});
