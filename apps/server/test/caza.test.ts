/** Núcleo de caza (Fase 3): Llanos del Alba, La Frontera, Camposanto Viejo y Páramo Reseco. Vínculos, llegadas del menú de viaje, pits, respawn y rendimiento. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { CAMPOSANTO, FRONTERA, HUNT_ARRIVALS, LLANOS, MAPS, PARAMO, TRAINING, VILLA, buildMap, mobDef, reachableFrom, respawnTarget, validateMapGraph, waypointTarget, zoneRespawnSecs } from '@fdn/world';
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
    const sessions = new Map<string, TransferSession>();
    reg.sessionHook = (id) => { const s = sessions.get(id); return s ? { session: s } : undefined; };
    const join = (world: GameWorld, name: string, at: { x: number; y: number }, faction = 'solmar') => {
        const log: ServerMessage[] = [];
        const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
        sessions.set(session.sessionId, session);
        const persisted: PersistedPlayer = { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        world.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        world.bindAccount(session.sessionId, `acc-${name}`);
        world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction }));
        world.handleClientPacket(session.sessionId, { payload: { $case: 'changePlayerProfileRequest', value: { profile: `${faction};guerrero;` } } } as never);
        return { session, log, p: world.playerOf(session.sessionId)! };
    };
    return { reg, eco, join };
}
const pos = (w: GameWorld, sid: string) => { const p = w.playerOf(sid)!; return [p.posX, p.posY]; };
const HUNT = [LLANOS, FRONTERA, CAMPOSANTO, PARAMO];
/** Pits = zonas de 30 mobs o más. */
const pitsOf = (id: string) => buildMap(id).zones.filter((z) => z.n >= 30);

test('el grafo valida con los cuatro mapas de caza', () => {
    assert.deepEqual(validateMapGraph(), []);
    const exp: Record<string, [number, number, 'off' | 'faction']> = { llanos_alba: [128, 1, 'off'], la_frontera: [160, 3, 'faction'], camposanto: [144, 5, 'faction'], paramo: [160, 5, 'faction'] };
    for (const [id, [size, lvl, pvp]] of Object.entries(exp)) {
        const d = MAPS[id]; assert.ok(d, id);
        assert.equal(d.size, size, id); assert.equal(d.lvl![0], lvl, id); assert.equal(d.pvp, pvp, id); assert.equal(d.safe, false);
    }
});

test('cada mapa: 3-5 pits de 30-60 mobs, 150-300 mobs en total, reaparición rápida y mobs sueltos en los caminos', () => {
    for (const M of HUNT) {
        const m = buildMap(M.id), pits = pitsOf(M.id), total = m.zones.reduce((s, z) => s + z.n, 0);
        assert.ok(pits.length >= 3 && pits.length <= 5, `${M.id}: ${pits.length} pits`);
        for (const z of pits) {
            assert.ok(z.n >= 30 && z.n <= 60, `${z.name}: ${z.n}`);
            assert.ok(z.respawn! >= 8 && z.respawn! <= 15, `${z.name}: respawn ${z.respawn}`);
            assert.equal(zoneRespawnSecs(z.type, z), z.respawn);
        }
        assert.ok(total >= 150 && total <= 300, `${M.id}: ${total} mobs`);
        assert.ok(m.zones.some((z) => z.n < 30), `${M.id}: sin mobs sueltos`);
    }
    // los mapas viejos no cambian: siguen con la reaparición del tipo (22 s)
    for (const z of buildMap('solmar_legacy').zones) assert.equal(zoneRespawnSecs(z.type, z), z.type === 'goblin' ? 22 : zoneRespawnSecs(z.type));
});

test('niveles de los pits: exp y vida de mobDef según el nivel de la zona', () => {
    const lv = (id: string, name: string) => { const z = buildMap(id).zones.find((q) => q.name === name)!; return mobDef(z.type, z); };
    assert.equal(lv('llanos_alba', 'Campamento goblin').lvl, 1); assert.equal(lv('llanos_alba', 'Avanzada goblin').lvl, 2);
    assert.equal(lv('la_frontera', 'Pantano muerto').lvl, 3); assert.equal(lv('la_frontera', 'Hoyos de hormiga león').lvl, 4);
    assert.equal(lv('camposanto', 'Cementerio viejo').lvl, 5); assert.equal(lv('camposanto', 'Ruinas del nigromante').lvl, 5);
    const p = lv('paramo', 'Páramo reseco'); assert.equal(p.lvl, 5); assert.equal(p.exp, mobDef('antlion', { lvl: 5 }).exp);
});

test('los pits están despejados (la IA en línea recta no se traba) y lejos del campamento seguro', () => {
    for (const M of HUNT) {
        const m = buildMap(M.id), reach = reachableFrom(m, m.spawn.x, m.spawn.y);
        for (const z of pitsOf(M.id)) {
            let free = 0, all = 0;
            for (let y = z.y - z.r; y <= z.y + z.r; y++) for (let x = z.x - z.r; x <= z.x + z.r; x++) { all++; if (!m.blocked[y][x] && reach[y][x]) free++; if (m.safe[y][x]) assert.fail(`${z.name}: celda segura dentro del pit`); }
            assert.ok(free / all > 0.75, `${z.name}: solo ${(100 * free / all).toFixed(0)} % caminable`);
            const c = M.camp, dx = Math.max(c.x0 - z.x, 0, z.x - c.x1), dy = Math.max(c.y0 - z.y, 0, z.y - c.y1);
            assert.ok(Math.hypot(dx, dy) > z.r + 10, `${z.name}: muy cerca del campamento`);
        }
        // campamento: seguro, fogata y respawn adentro
        assert.ok(m.safe[M.respawn.y][M.respawn.x] && !m.blocked[M.respawn.y][M.respawn.x], M.id);
        assert.deepEqual(m.fire, M.fire);
        assert.deepEqual(respawnTarget(MAPS[M.id], 'solmar'), { map: M.id, ...M.respawn });
        assert.deepEqual(respawnTarget(MAPS[M.id], 'vhar'), { map: M.id, ...M.respawn });
    }
});

test('vínculos de ida y vuelta: villa -> Llanos -> Frontera -> Camposanto -> Páramo, y Llanos <-> mapa viejo', () => {
    const { reg, join } = setup();
    const villa = reg.ensure('solmar_villa');
    const J = join(villa, 'andariega', VILLA.spawn);
    J.p.prog.lvl = 10;
    const cross = (from: string, linkId: string) => {
        const w = reg.get(from)!, l = MAPS[from].links.find((q) => q.id === linkId)!;
        w.playerOf(J.session.sessionId)!.setPosition(l.x, l.y);
        assert.equal(reg.handlePortal(J.session, linkId), null, linkId);
        assert.equal(reg.pendingOf(J.session.sessionId)?.map, l.to.map, linkId);
        reg.completeTransfer(J.session.sessionId, l.to.map, reg.hashOf(l.to.map));
        assert.deepEqual(pos(reg.get(l.to.map)!, J.session.sessionId), [l.to.x, l.to.y], linkId);
    };
    for (const [m, id] of [['solmar_villa', 'villa_a_llanos'], ['llanos_alba', 'llanos_a_frontera'], ['la_frontera', 'frontera_a_camposanto'], ['camposanto', 'camposanto_a_paramo'],
        ['paramo', 'paramo_a_camposanto'], ['camposanto', 'camposanto_a_frontera'], ['la_frontera', 'frontera_a_llanos'], ['llanos_alba', 'llanos_a_legacy'], ['solmar_legacy', 'legacy_a_llanos'], ['llanos_alba', 'llanos_a_villa']] as const) cross(m, id);
    // cada vínculo de un mapa de caza tiene su vuelta en el mapa destino (salvo la escalera sellada de la Cripta, que vuelve por el páramo viejo)
    for (const M of HUNT) for (const l of MAPS[M.id].links) assert.ok(MAPS[l.to.map].links.some((b) => b.to.map === M.id), l.id);
});

test('la escalera de la Cripta en el Páramo pide la llave y lleva a la Cripta del mapa viejo; el páramo viejo vuelve al nuevo', () => {
    const { reg, join } = setup();
    const par = reg.ensure('paramo');
    const J = join(par, 'cripta', PARAMO.fromCamposanto);
    par.playerOf(J.session.sessionId)!.setPosition(PARAMO.crypt.x, PARAMO.crypt.y);
    assert.match(reg.handlePortal(J.session, 'paramo_a_cripta') ?? '', /llave/);
    J.p.prog.keys.cripta = 1;
    assert.equal(reg.handlePortal(J.session, 'paramo_a_cripta'), null);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_legacy');
    reg.completeTransfer(J.session.sessionId, 'solmar_legacy', reg.hashOf('solmar_legacy'));
    const legacy = reg.get('solmar_legacy')!, back = MAPS.solmar_legacy.links.find((l) => l.id === 'legacy_a_paramo')!;
    legacy.playerOf(J.session.sessionId)!.setPosition(back.x, back.y);
    assert.equal(reg.handlePortal(J.session, 'legacy_a_paramo'), null);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'paramo');
});

test('menú del Portal de Frontera: cada zona mudada llega a su celda en el mapa de caza (caminable, fuera del campamento, junto a su pit)', () => {
    const moved: Record<string, string> = { goblins: 'llanos_alba', avanzada: 'llanos_alba', hoyos: 'la_frontera', pantano: 'la_frontera', cementerio: 'camposanto', nigromante: 'camposanto' };
    assert.deepEqual(Object.keys(HUNT_ARRIVALS).sort(), Object.keys(moved).sort());
    for (const [id, map] of Object.entries(moved)) {
        const t = TRAINING.find((q) => q.id === id)!, a = HUNT_ARRIVALS[id], m = buildMap(map);
        assert.deepEqual(waypointTarget(id, 'solmar'), { map, x: a.x, y: a.y, step: t.step });
        assert.ok(!m.blocked[a.y][a.x] && !m.safe[a.y][a.x], `${id}: (${a.x}, ${a.y})`);
        assert.ok(reachableFrom(m, m.spawn.x, m.spawn.y)[a.y][a.x], `${id}: no se llega a pie`);
        const z = m.zones.find((q) => q.name === t.zone)!; assert.ok(z, `${id}: el mapa no tiene la zona ${t.zone}`);
        const d = Math.hypot(a.x - z.x, a.y - z.y); assert.ok(d >= z.r && d <= z.r + 6, `${id}: a ${d.toFixed(1)} del centro del pit (r ${z.r})`);
    }
    // el orden y los bloqueos de la cadena no cambian
    assert.deepEqual(TRAINING.map((t) => t.id), ['goblins', 'avanzada', 'hoyos', 'pantano', 'cementerio', 'nigromante', 'hormiguero', 'nidal', 'osario', 'cantera']);
    // desde la villa: un personaje nuevo puede ir a los goblins pero no a los hoyos
    const { reg, join } = setup();
    const villa = reg.ensure('solmar_villa'), J = join(villa, 'novata', { x: VILLA.portal.x + 1, y: VILLA.portal.y + 1 });
    villa.handleClientPacket(J.session.sessionId, { payload: { $case: 'waypointRequest', value: { id: 'hoyos' } } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    villa.handleClientPacket(J.session.sessionId, { payload: { $case: 'waypointRequest', value: { id: 'goblins' } } } as never);
    assert.deepEqual(reg.pendingOf(J.session.sessionId), { map: 'llanos_alba', key: 'llanos_alba', x: HUNT_ARRIVALS.goblins.x, y: HUNT_ARRIVALS.goblins.y });
});

test('cada pit nace lleno y los mobs nacen dentro de su zona, nunca en el campamento', () => {
    const { reg } = setup();
    for (const M of HUNT) {
        const w = reg.ensure(M.id), m = buildMap(M.id), counts = w.mobs!.countByZone();
        m.zones.forEach((z, i) => assert.equal(counts[i], z.n, `${M.id}/${z.name}: nacieron ${counts[i]} de ${z.n}`));
        for (const o of w.mobs!.list()) {
            const z = m.zones[o.zoneIdx];
            assert.ok(Math.abs(o.x - 0.5 - z.x) <= z.r && Math.abs(o.y - 0.5 - z.y) <= z.r, `${z.name}: mob fuera de la zona`);
            assert.ok(!m.safe[Math.floor(o.y)][Math.floor(o.x)] && !m.blocked[Math.floor(o.y)][Math.floor(o.x)]);
        }
    }
});

test('respawn por zona: un goblin del pit vuelve a los 8 s (no a los 22 del mapa viejo)', () => {
    const real = Date.now; let off = 0; Date.now = () => real() + off;
    try {
        const { reg, join } = setup();
        const w = reg.ensure('llanos_alba'), m = buildMap('llanos_alba'), zi = m.zones.findIndex((z) => z.name === 'Campamento goblin'), z = m.zones[zi];
        const J = join(w, 'cazadora', { x: z.x, y: z.y - z.r - 2 });
        const victim = w.mobs!.list().find((o) => o.zoneIdx === zi)!;
        w.mobs!.skillHit(J.p, victim.id, 9999);
        assert.equal(w.mobs!.countByZone()[zi], z.n - 1);
        off = (z.respawn! - 1) * 1000; w.tick(); assert.equal(w.mobs!.countByZone()[zi], z.n - 1, 'todavía no');
        off = (z.respawn! + 0.5) * 1000; w.tick(); assert.equal(w.mobs!.countByZone()[zi], z.n, 'ya volvió');
    } finally { Date.now = real; }
});

test('rendimiento: los cuatro mapas despiertos con jugadores parados en cada pit', () => {
    const { reg, join } = setup();
    let k = 0;
    for (const M of HUNT) {
        const w = reg.ensure(M.id);
        for (const z of pitsOf(M.id)) for (let j = 0; j < 3; j++) { const J = join(w, `p${k++}`, { x: z.x + j, y: z.y + z.r + 1 }); J.p.prog.lvl = 30; }
    }
    // calentar y medir 400 vueltas del reloj (20 s de juego a 50 ms)
    for (let i = 0; i < 50; i++) reg.tickAll();
    reg.tickStats.flush(reg);
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) reg.tickAll();
    const ms = (performance.now() - t0) / 400, s = reg.tickStats.flush(reg);
    console.log(`[medición] ${s.worlds} mapas, ${s.mobs} mobs (${s.awake} activos), ${s.players} jugadores: vuelta del reloj prom ${ms.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms, máx ${s.max.toFixed(2)} ms`);
    assert.ok(s.mobs >= 600, `${s.mobs}`);
    assert.ok(ms < 15, `vuelta del reloj de ${ms.toFixed(2)} ms (presupuesto 50 ms)`);
});
