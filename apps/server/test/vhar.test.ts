/** Ciudadela de Vhar (Fase 2): puertas ida y vuelta, NPC por interior, respawn en el Santuario, hogar de la facción, recall y camino al mapa viejo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { HUNT_ARRIVALS, LEGACY_VHAR_LINK, MAPS, RECALL, VHAR, VHAR_BUILDINGS, VHAR_INTERIORS, VHAR_RESPAWN, buildMap, factionHome, getMapDef, reachableFrom, respawnTarget, roleOf, roomOf, validateMapGraph, vharDoor, type VharBuilding } from '@fdn/world';
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
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
function clock() {
    const real = Date.now; let off = 0;
    Date.now = () => real() + off;
    return { advance: (ms: number) => { off += ms; }, restore: () => { Date.now = real; } };
}
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const sessions = new Map<string, TransferSession>();
    reg.sessionHook = (id) => { const session = sessions.get(id); return session ? { session } : undefined; };
    const join = (world: GameWorld, name: string, at: { x: number; y: number }, faction = 'vhar') => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction }));
        pkt(world, session.sessionId, 'changePlayerProfileRequest', { profile: `${faction};guerrero;` });
        sessions.set(session.sessionId, session);
        const p = world.playerOf(session.sessionId)!; p.spawnProtection = false;
        return { session, log, p };
    };
    return { reg, join };
}
const pos = (w: GameWorld, sid: string) => { const p = w.playerOf(sid)!; return [p.posX, p.posY]; };
const calm = (w: GameWorld) => { (w as unknown as { mobSim?: unknown }).mobSim = undefined; return w; };

test('la ciudadela y sus interiores están en el registro y el grafo valida', () => {
    assert.deepEqual(validateMapGraph(), []);
    for (const it of VHAR_INTERIORS) {
        const d = MAPS[it.id]; assert.ok(d, it.id);
        assert.equal(d.safe, true); assert.equal(d.pvp, 'off'); assert.equal(d.region, 'vhar');
        assert.ok(d.size >= 16 && d.size <= 28, `${it.id}: ${d.size}`);
    }
    assert.equal(VHAR_INTERIORS.length, 8);
    assert.equal(MAPS.vhar_ciudadela.size, 128); assert.equal(MAPS.vhar_ciudadela.pvp, 'off');
    // todo alcanzable a pie desde el spawn: el portal, las 8 puertas y el camino al mapa viejo
    const m = buildMap('vhar_ciudadela'), reach = reachableFrom(m, VHAR.spawn.x, VHAR.spawn.y);
    for (const c of [VHAR.portal, VHAR.toLegacy, VHAR.fromLegacy, ...(Object.keys(VHAR_BUILDINGS) as VharBuilding[]).map((k) => vharDoor(k).door)]) assert.ok(reach[c.y][c.x], JSON.stringify(c));
});

test('cada edificio tiene puerta de ida (ciudadela -> interior) y de vuelta (interior -> frente a la puerta)', () => {
    const city = buildMap('vhar_ciudadela');
    for (const k of Object.keys(VHAR_BUILDINGS) as VharBuilding[]) {
        const it = VHAR_INTERIORS.find((i) => i.building === k)!, d = vharDoor(k), r = roomOf(it);
        const go = MAPS.vhar_ciudadela.links.find((l) => l.id === `ciudadela_a_${k}`)!, back = MAPS[it.id].links.find((l) => l.id === `${k}_a_ciudadela`)!;
        assert.deepEqual([go.x, go.y], [d.door.x, d.door.y]); assert.deepEqual(go.to, { map: it.id, ...r.arrive });
        assert.deepEqual([back.x, back.y], [r.exit.x, r.exit.y]); assert.deepEqual(back.to, { map: 'vhar_ciudadela', ...d.out });
        assert.equal(Math.abs(d.door.x - d.out.x) + Math.abs(d.door.y - d.out.y), 1);
        assert.ok(!city.blocked[d.door.y][d.door.x] && !city.blocked[d.out.y][d.out.x], k);
        const b = city.buildings.find((q) => q.x === VHAR_BUILDINGS[k].x && q.y === VHAR_BUILDINGS[k].y)!;
        assert.ok((d.door.y === b.y + b.h && d.door.x >= b.x && d.door.x < b.x + b.w) || (d.door.x === b.x + b.w && d.door.y >= b.y && d.door.y < b.y + b.h), k);
    }
});

test('los NPC de cada interior conservan el sufijo _v (incluido el Subastador en la Casa de Concejo)', () => {
    const roles = (id: string) => buildMap(id).npcs.map(roleOf).sort();
    assert.deepEqual(roles('vhar_concejo'), ['capitan', 'guardia', 'subastador']);
    assert.deepEqual(roles('vhar_forja'), ['armadurero', 'armero']);
    assert.deepEqual(roles('vhar_bazar'), ['alquimista', 'mercader']);
    assert.deepEqual(roles('vhar_orfebreria'), ['joyero']);
    assert.deepEqual(roles('vhar_camara'), ['depositario']);
    assert.deepEqual(roles('vhar_santuario'), ['sanador']);
    assert.deepEqual(roles('vhar_torre'), ['mago']);
    assert.ok(roles('vhar_cuartel').every((r) => r === 'guardia') && roles('vhar_cuartel').length >= 2);
    for (const it of VHAR_INTERIORS) for (const n of buildMap(it.id).npcs) assert.match(n.id, /_v\d*$/, n.id);
    assert.equal(buildMap('vhar_concejo').npcs.find((n) => roleOf(n) === 'subastador')!.id, 'subastador_v');
});

test('el Portal de Frontera de la ciudad vieja de Vhar ya no existe: hay uno solo, en la plaza de la ciudadela', () => {
    assert.deepEqual(buildMap('solmar_legacy').waypoints ?? [], []);
    const wps = buildMap('vhar_ciudadela').waypoints!;
    assert.deepEqual(wps.map((q) => q.id), ['city:vhar']);
    assert.deepEqual([wps[0].x, wps[0].y], [VHAR.portal.x, VHAR.portal.y]);
});

test('entrar y salir del Santuario por la puerta', () => {
    const { reg, join } = setup();
    const city = reg.ensure('vhar_ciudadela'), d = vharDoor('templo');
    const J = join(city, 'teo', VHAR.spawn);
    city.playerOf(J.session.sessionId)!.setPosition(d.door.x, d.door.y);
    assert.equal(reg.handlePortal(J.session, 'ciudadela_a_templo'), null);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'vhar_santuario');
    assert.equal(reg.completeTransfer(J.session.sessionId, 'vhar_santuario', reg.hashOf('vhar_santuario')), true);
    const sant = reg.get('vhar_santuario')!, r = roomOf(VHAR_INTERIORS.find((i) => i.id === 'vhar_santuario')!);
    assert.deepEqual(pos(sant, J.session.sessionId), [r.arrive.x, r.arrive.y]);
    sant.playerOf(J.session.sessionId)!.setPosition(r.exit.x, r.exit.y);
    assert.equal(reg.handlePortal(J.session, 'templo_a_ciudadela'), null);
    assert.equal(reg.completeTransfer(J.session.sessionId, 'vhar_ciudadela', reg.hashOf('vhar_ciudadela')), true);
    assert.deepEqual(pos(city, J.session.sessionId), [d.out.x, d.out.y]);
});

test('Vhar reaparece en el Santuario al morir (mapa viejo o ciudadela); Solmar no cambia', () => {
    assert.deepEqual(respawnTarget(getMapDef('solmar_legacy')!, 'vhar'), { map: 'vhar_santuario', ...VHAR_RESPAWN });
    assert.deepEqual(respawnTarget(getMapDef('vhar_ciudadela')!, 'vhar'), { map: 'vhar_santuario', ...VHAR_RESPAWN });
    assert.equal(respawnTarget(getMapDef('vhar_ciudadela')!, 'solmar').map, 'solmar_templo');
    const { reg, join } = setup();
    const legacy = reg.ensure('solmar_legacy');
    const J = join(legacy, 'rita', { x: 26, y: 26 });
    J.p.hp = 0; J.p.deadAt = Date.now() - 5000;
    pkt(legacy, J.session.sessionId, 'respawnRequest', {});
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'vhar_santuario');
    assert.ok(J.p.hp > 0);
    reg.completeTransfer(J.session.sessionId, 'vhar_santuario', reg.hashOf('vhar_santuario'));
    assert.deepEqual(pos(reg.get('vhar_santuario')!, J.session.sessionId), [VHAR_RESPAWN.x, VHAR_RESPAWN.y]);
});

test('un personaje nuevo de Vhar va a la ciudadela (hogar de la facción)', () => {
    const home = factionHome('vhar')!;
    assert.deepEqual(home, { map: 'vhar_ciudadela', ...VHAR.spawn });
    const { reg, join } = setup();
    const legacy = reg.ensure('solmar_legacy');
    const J = join(legacy, 'nuevo', { x: 7, y: 8 });
    pkt(legacy, J.session.sessionId, 'playerTeleportRequested', { x: home.x, y: home.y });
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'vhar_ciudadela');
    reg.completeTransfer(J.session.sessionId, 'vhar_ciudadela', reg.hashOf('vhar_ciudadela'));
    assert.deepEqual(pos(reg.get('vhar_ciudadela')!, J.session.sessionId), [home.x, home.y]);
});

test('el recall (H) de Vhar lleva a la plaza de la ciudadela', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'vera', { x: 30, y: 20 });
        pkt(legacy, J.session.sessionId, 'recallRequest', { cancel: false });
        assert.equal(find(J.log, 'recallState').value.state, 1);
        c.advance(RECALL.channelMs + 100); legacy.tick();
        assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'vhar_ciudadela');
        reg.completeTransfer(J.session.sessionId, 'vhar_ciudadela', reg.hashOf('vhar_ciudadela'));
        const [x, y] = pos(reg.get('vhar_ciudadela')!, J.session.sessionId);
        assert.ok(Math.abs(x - VHAR.spawn.x) + Math.abs(y - VHAR.spawn.y) <= 3, `${x},${y}`);
    } finally { c.restore(); }
});

test('el Portal de Frontera de la ciudadela lleva a las zonas de caza (Llanos del Alba)', () => {
    const { reg, join } = setup();
    const city = reg.ensure('vhar_ciudadela');
    const J = join(city, 'viajero', { x: VHAR.portal.x + 1, y: VHAR.portal.y + 1 });
    pkt(city, J.session.sessionId, 'waypointRequest', { id: 'goblins' });
    assert.deepEqual([reg.pendingOf(J.session.sessionId)!.map, reg.pendingOf(J.session.sessionId)!.x, reg.pendingOf(J.session.sessionId)!.y], ['llanos_alba', HUNT_ARRIVALS.goblins.x, HUNT_ARRIVALS.goblins.y]);
});

test('camino entre la ciudadela y el mapa viejo, ida y vuelta (llega junto a la puerta de la ciudad vieja de Vhar)', () => {
    const { reg, join } = setup();
    const city = reg.ensure('vhar_ciudadela');
    const J = join(city, 'caminante', VHAR.spawn);
    city.playerOf(J.session.sessionId)!.setPosition(VHAR.toLegacy.x, VHAR.toLegacy.y);
    reg.handlePortal(J.session, 'ciudadela_a_legacy');
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_legacy');
    reg.completeTransfer(J.session.sessionId, 'solmar_legacy', reg.hashOf('solmar_legacy'));
    const legacy = reg.get('solmar_legacy')!, [lx, ly] = pos(legacy, J.session.sessionId);
    assert.ok(Math.abs(lx - 34) <= 4 && Math.abs(ly - 14) <= 5, `${lx},${ly}`); // puerta de la ciudad vieja de Vhar en (34, 14)
    legacy.playerOf(J.session.sessionId)!.setPosition(LEGACY_VHAR_LINK.x, LEGACY_VHAR_LINK.y);
    reg.handlePortal(J.session, 'legacy_a_ciudadela');
    reg.completeTransfer(J.session.sessionId, 'vhar_ciudadela', reg.hashOf('vhar_ciudadela'));
    assert.deepEqual(pos(city, J.session.sessionId), [VHAR.fromLegacy.x, VHAR.fromLegacy.y]);
});

test('comprar dentro del Bazar y los NPC _v de la ciudadela', () => {
    const { reg, join } = setup();
    const bazar = reg.ensure('vhar_bazar'), merc = buildMap('vhar_bazar').npcs.find((n) => n.id === 'mercader_v')!;
    const J = join(bazar, 'compradora', { x: merc.x, y: merc.y + 1 });
    J.p.econ!.gold = 500;
    pkt(bazar, J.session.sessionId, 'econBuyRequest', { npcId: 'mercader_v', stockIndex: 0 });
    assert.equal(find(J.log, 'econResult').value.ok, true, find(J.log, 'econResult').value.text);
    const city = reg.ensure('vhar_ciudadela'), K = join(city, 'lejana', VHAR.spawn);
    K.p.econ!.gold = 500;
    pkt(city, K.session.sessionId, 'econBuyRequest', { npcId: 'mercader_v', stockIndex: 0 });
    assert.equal(find(K.log, 'econResult').value.ok, false);
});
