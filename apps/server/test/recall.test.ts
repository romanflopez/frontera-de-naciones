/**
 * Volver a la ciudad (recall, tecla H) y viaje por el Portal de Frontera a zonas sin portal de llegada.
 * El server lleva el canal de 8 s, lo corta por daño, movimiento o ataque, aplica el enfriamiento de 60 s y hace el viaje al hogar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { HUBS, MAPS, RECALL, TRAINING, VILLA, buildMap, type Waypoint } from '@fdn/world';
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
const all = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k).map((m) => (m.payload as any).value);
const last = (log: ServerMessage[], k: string) => all(log, k).at(-1);
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);

/** Reloj falso: `advance(ms)` corre Date.now; `restore()` lo devuelve. */
function clock() {
    const real = Date.now; let off = 0;
    Date.now = () => real() + off;
    return { advance: (ms: number) => { off += ms; }, restore: () => { Date.now = real; } };
}

function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const sessions = new Map<string, TransferSession>();
    reg.sessionHook = (id) => { const session = sessions.get(id); return session ? { session } : undefined; };
    const join = (world: GameWorld, name: string, at: { x: number; y: number }, faction = 'solmar') => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction }));
        pkt(world, session.sessionId, 'changePlayerProfileRequest', { profile: `${faction};guerrero;` });
        sessions.set(session.sessionId, session);
        const p = world.playerOf(session.sessionId)!;
        p.spawnProtection = false;
        const recall = (cancel = false) => pkt(reg.get(session.worldId)!, session.sessionId, 'recallRequest', { cancel });
        return { session, log, p, recall };
    };
    return { reg, join };
}
const pos = (w: GameWorld, sid: string) => { const p = w.playerOf(sid)!; return [p.posX, p.posY]; };
const ZONE_AT = { x: 30, y: 20 }; // afuera de las ciudades del mapa viejo
/** Sin mobs: que ningún mob pegue o paralice durante los avances del reloj (los cortes se prueban a mano). */
const calm = (w: GameWorld) => { (w as unknown as { mobSim?: unknown }).mobSim = undefined; return w; };

test('el recall canaliza 8 s y lleva a Solmar a la plaza de la villa (cruce de mapa)', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'rosa', ZONE_AT);
        J.recall();
        const st = last(J.log, 'recallState');
        assert.equal(st.state, 1); assert.equal(st.channelMs, RECALL.channelMs); assert.equal(st.remainingMs, RECALL.channelMs);
        assert.ok(J.p.recallUntil > 0);
        // un segundo pedido mientras canaliza no reinicia el canal
        const until = J.p.recallUntil; c.advance(1000); J.recall(); assert.equal(J.p.recallUntil, until);
        c.advance(6500); legacy.tick();
        assert.equal(reg.pendingOf(J.session.sessionId), undefined, 'todavía no terminó');
        c.advance(600); legacy.tick();
        assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_villa');
        const done = last(J.log, 'recallState');
        assert.equal(done.state, 0); assert.equal(done.cooldownMs, RECALL.cooldownMs); assert.equal(done.reason, '');
        reg.completeTransfer(J.session.sessionId, 'solmar_villa', reg.hashOf('solmar_villa'));
        const [x, y] = pos(reg.get('solmar_villa')!, J.session.sessionId);
        assert.ok(Math.abs(x - VILLA.spawn.x) + Math.abs(y - VILLA.spawn.y) <= 3, `${x},${y}`);
    } finally { c.restore(); }
});

test('el recall de Vhar lo lleva a su ciudad dentro del mapa viejo (sin cruce)', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'vito', ZONE_AT, 'vhar');
        J.recall(); c.advance(RECALL.channelMs + 100); legacy.tick();
        assert.equal(reg.pendingOf(J.session.sessionId), undefined);
        const [x, y] = pos(legacy, J.session.sessionId);
        assert.ok(Math.abs(x - HUBS.vhar.x) + Math.abs(y - HUBS.vhar.y) <= 4, `${x},${y}`);
        assert.ok(all(J.log, 'playerTeleported').length >= 1);
    } finally { c.restore(); }
});

test('el recall se corta por daño, movimiento, ataque y hechizo (sin enfriamiento) y se puede volver a empezar', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'tito', ZONE_AT), sid = J.session.sessionId;
        const cut = (re: RegExp) => {
            const st = last(J.log, 'recallState');
            assert.equal(J.p.recallUntil, 0); assert.equal(st.state, 0); assert.match(st.reason, re); assert.equal(st.cooldownMs, 0);
            c.advance(RECALL.channelMs + 100); legacy.tick();
            assert.equal(reg.pendingOf(sid), undefined, 'el temporizador viejo no dispara el viaje');
        };
        // daño (de un mob)
        J.recall(); c.advance(2000);
        (legacy as any).damagePlayer(J.p, 40, 'phys', null, 'Goblin');
        cut(/Te pegaron/);
        // movimiento
        J.recall(); c.advance(1000);
        pkt(legacy, sid, 'requestMovement', { curX: J.p.posX, curY: J.p.posY, destX: J.p.posX + 1, destY: J.p.posY, gameWorldId: '', dashAttack: false });
        cut(/Te moviste/);
        // ataque
        J.recall(); c.advance(1000);
        pkt(legacy, sid, 'pvpHitRequest', { fx: '', x: J.p.posX, y: J.p.posY, targetId: 0n, dmg: 0, secs: 0, r: 0, spell: '' });
        cut(/Atacaste/);
        J.recall(); c.advance(500);
        pkt(legacy, sid, 'mobHitRequest', { mobId: 999999 });
        cut(/Atacaste/);
        // hechizo (cura: maná gastado que el server no cobra)
        J.recall(); c.advance(500);
        pkt(legacy, sid, 'hpReport', { hp: J.p.hp, mpSpent: 5, mp: 0, meditating: false });
        cut(/hechizo/);
        // cancelar a mano
        J.recall(); J.recall(true); cut(/Cancelaste/);
        // un reporte de vida sin maná gastado no corta
        J.recall(); pkt(legacy, sid, 'hpReport', { hp: J.p.hp, mpSpent: 0, mp: 0, meditating: false });
        assert.ok(J.p.recallUntil > 0);
        c.advance(RECALL.channelMs + 100); legacy.tick();
        assert.equal(reg.pendingOf(sid)?.map, 'solmar_villa', 'sin cortes, termina');
    } finally { c.restore(); }
});

test('enfriamiento de 60 s después de un recall completo', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'vhal', ZONE_AT, 'vhar'), sid = J.session.sessionId;
        J.recall(); c.advance(RECALL.channelMs + 100); legacy.tick();
        legacy.playerOf(sid)!.setPosition(ZONE_AT.x, ZONE_AT.y);
        c.advance(10_000); J.recall();
        const st = last(J.log, 'recallState');
        assert.equal(J.p.recallUntil, 0); assert.match(st.reason, /faltan 5\d s/); assert.ok(st.cooldownMs > 49_000 && st.cooldownMs <= 50_100, String(st.cooldownMs));
        c.advance(50_200); J.recall();
        assert.ok(J.p.recallUntil > 0, 'pasó el enfriamiento');
    } finally { c.restore(); }
});

test('no se puede usar muerto, en la arena, ni en la plaza de tu ciudad; morir corta el canal', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'muerta', ZONE_AT), sid = J.session.sessionId;
        J.p.hp = 0; J.recall();
        assert.equal(J.p.recallUntil, 0); assert.match(last(J.log, 'recallState').reason, /muerto/);
        J.p.hp = J.p.combat.maxHp;
        J.recall(); assert.ok(J.p.recallUntil > 0);
        (legacy as any).damagePlayer(J.p, 1e9, 'phys', null, 'Ogro');
        assert.ok(J.p.isDead); assert.equal(J.p.recallUntil, 0);
        c.advance(RECALL.channelMs + 100); legacy.tick();
        assert.equal(reg.pendingOf(sid), undefined);
        // Coliseo (todos contra todos)
        const A = join(legacy, 'gladiador', { x: MAPS.solmar_legacy.ffaRect!.x0 + 4, y: MAPS.solmar_legacy.ffaRect!.y0 + 4 });
        A.recall(); assert.equal(A.p.recallUntil, 0); assert.match(last(A.log, 'recallState').reason, /arena/);
        // ya en la plaza de la villa
        const villa = reg.ensure('solmar_villa');
        const V = join(villa, 'vecina', { x: VILLA.spawn.x + 1, y: VILLA.spawn.y });
        V.recall(); assert.equal(V.p.recallUntil, 0); assert.match(last(V.log, 'recallState').reason, /Ya estás/);
    } finally { c.restore(); }
});

test('no se puede usar durante un cruce de mapa y el cruce corta el canal', () => {
    const c = clock();
    try {
        const { reg, join } = setup();
        const legacy = calm(reg.ensure('solmar_legacy'));
        const J = join(legacy, 'cruzado', ZONE_AT, 'vhar'), sid = J.session.sessionId;
        J.recall(); assert.ok(J.p.recallUntil > 0);
        assert.ok(reg.beginTransfer(J.session, { map: 'solmar_villa', ...VILLA.spawn }));
        assert.equal(J.p.recallUntil, 0, 'cruzar corta el canal');
        // pedidos durante el cruce: el jugador no está en ningún mundo, se ignoran
        J.recall(); pkt(legacy, sid, 'recallRequest', { cancel: false });
        assert.equal(J.p.recallUntil, 0);
        reg.completeTransfer(sid, 'solmar_villa', reg.hashOf('solmar_villa'));
        c.advance(RECALL.channelMs + 100); reg.get('solmar_villa')!.tick(); legacy.tick();
        assert.equal(reg.pendingOf(sid), undefined, 'el canal cortado no viaja después');
        assert.ok(reg.get('solmar_villa')!.playerOf(sid));
    } finally { c.restore(); }
});

test('el Portal de Frontera lleva a una zona que no tiene portal de llegada; las zonas no tienen waypoints', () => {
    const legacyMap = buildMap('solmar_legacy');
    const wps: Waypoint[] = legacyMap.waypoints ?? [];
    // en el mapa viejo queda solo el Portal de Frontera de Vhar (Solmar tiene el suyo en la villa)
    assert.deepEqual(wps.map((q) => q.id), ['city:vhar']);
    assert.deepEqual(buildMap('solmar_villa').waypoints!.map((q) => q.id), ['city:solmar']);
    for (const t of TRAINING) {
        const a = legacyMap.waypointArrivals![t.id]; assert.ok(a, t.id);
        assert.ok(!legacyMap.blocked[a.y][a.x], t.id);
        assert.ok(wps.every((q) => Math.hypot(q.x - a.x, q.y - a.y) > 10), `${t.id}: no hay portal junto a la llegada`);
    }
    const { reg, join } = setup();
    const villa = reg.ensure('solmar_villa');
    const J = join(villa, 'exploradora', { x: VILLA.portal.x + 1, y: VILLA.portal.y + 1 }), sid = J.session.sessionId;
    // zona bloqueada (nivel 1, sin misiones): no viaja
    pkt(villa, sid, 'waypointRequest', { id: 'cantera' });
    assert.equal(reg.pendingOf(sid), undefined); assert.match(last(J.log, 'sendMessage').message, /Portal bloqueado/);
    J.p.prog.lvl = 19;
    pkt(villa, sid, 'waypointRequest', { id: 'cantera' });
    assert.equal(reg.pendingOf(sid)?.map, 'solmar_legacy');
    reg.completeTransfer(sid, 'solmar_legacy', reg.hashOf('solmar_legacy'));
    const legacy = reg.get('solmar_legacy')!, arr = legacyMap.waypointArrivals!.cantera, [x, y] = pos(legacy, sid);
    assert.ok(Math.abs(x - arr.x) + Math.abs(y - arr.y) <= 3, `${x},${y}`);
    // desde la zona no hay portal: el menú no se puede usar (hay que volver con el recall)
    pkt(legacy, sid, 'waypointRequest', { id: 'goblins' });
    assert.equal(reg.pendingOf(sid), undefined);
    // el portal de Vhar no le sirve a uno de Solmar
    const vp = wps[0]; legacy.playerOf(sid)!.setPosition(vp.x + 1, vp.y);
    pkt(legacy, sid, 'waypointRequest', { id: 'goblins' });
    assert.equal(reg.pendingOf(sid), undefined); assert.match(last(J.log, 'sendMessage').message, /tu ciudad/);
});
