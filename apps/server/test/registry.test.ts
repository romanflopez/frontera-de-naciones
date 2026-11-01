import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import { resolveSaved, restPosition } from '../src/persist.ts';
import type { PersistedPlayer, Player } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { PartyService, setParties } from '../src/party.ts';
import { LEGACY_VILLA_LINK, PRUEBA_CAZA, PRUEBA_MAZMORRA } from '@fdn/world';

const settings = loadSettings(), catalogs = loadCatalogs();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
let mem = new MemStorage();
const kinds = (log: ServerMessage[]) => log.map((m) => m.payload?.$case);
const find = <K extends string>(log: ServerMessage[], k: K) => log.find((m) => m.payload?.$case === k)?.payload as any;

/** Un jugador conectado a `world`, con cuenta y personaje creados (guerrero de Solmar), parado en (x, y). */
function join(reg: WorldRegistry, eco: Economy, world: GameWorld, name: string, at?: { x: number; y: number }) {
    const log: ServerMessage[] = [];
    const disconnects: string[] = [];
    const session: TransferSession = { sessionId: `s-${name}`, worldId: world.id };
    const persisted: PersistedPlayer | undefined = at ? { mapId: world.mapId, worldId: world.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true } : undefined;
    world.playerConnected(session.sessionId, name, (m) => log.push(m), (r) => disconnects.push(r), persisted);
    mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
    world.bindAccount(session.sessionId, `acc-${name}`);
    world.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
    const p = world.playerOf(session.sessionId)!;
    void reg; void eco;
    return { session, log, disconnects, p };
}
const fresh = (o: Partial<ConstructorParameters<typeof WorldRegistry>[0]> = {}) => {
    mem = new MemStorage();
    const eco = new Economy(mem);
    const reg = new WorldRegistry({ settings, catalogs, economy: eco, ...o });
    return { eco, reg };
};
const saves: PersistedPlayer[] = [];
// Los mapas de prueba no tienen entrada desde el mundo (el mapa viejo ya no tiene el portal al claro): los cruces se prueban
// desde la escalera de la mazmorra de prueba ('mazmorra_a_caza'), que lleva al claro.
const EXIT = PRUEBA_MAZMORRA.exit, ARRIVE = PRUEBA_CAZA.fromMazmorra;
const save = (s: PersistedPlayer) => { saves.push(s); };

test('el registro crea los mundos a pedido y comparte el mapa', () => {
    const { reg } = fresh();
    assert.equal(reg.size, 0);
    const a = reg.ensure('solmar_legacy');
    assert.equal(reg.size, 1);
    assert.equal(reg.ensure('solmar_legacy'), a);
    assert.equal(reg.get('prueba_caza'), undefined);
    const b = reg.ensure('prueba_caza');
    assert.equal(b.id, 'prueba_caza'); assert.equal(reg.size, 2);
    assert.ok(b.mobCount > 0);
    assert.equal(reg.mapOf('prueba_caza'), reg.mapOf('prueba_caza'));
    assert.throws(() => reg.ensure('no_existe'));
});

test('cruce de portal en dos fases: el jugador conserva su estado y no queda en dos mundos', () => {
    const { reg, eco } = fresh(); saves.length = 0;
    const src = reg.ensure('prueba_mazmorra');
    const J = join(reg, eco, src, 'ana', EXIT);
    const O = join(reg, eco, src, 'beto', { x: EXIT.x + 1, y: EXIT.y + 1 });
    O.log.length = 0;
    J.p.hp = 77; J.p.mp = 9; J.p.econ!.gold = 1234;
    const playerId = J.p.playerId;

    assert.equal(reg.handlePortal(J.session, 'mazmorra_a_caza', save), null);
    // fase 1: fuera del mundo viejo, sin mundo nuevo todavía
    assert.equal(src.playerCount, 1);
    assert.equal(src.playerOf(J.session.sessionId), undefined);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'prueba_caza');
    assert.equal(J.session.worldId, 'prueba_caza');
    assert.ok(kinds(O.log).includes('playersLeftRange'), 'el vecino ve que se fue');
    assert.deepEqual(find(J.log, 'mapTransfer').value.mapId, 'prueba_caza');
    assert.equal(find(J.log, 'mapTransfer').value.gameWorldId, 'prueba_caza');
    assert.equal(find(J.log, 'mapTransfer').value.mapHash, reg.hashOf('prueba_caza'));
    assert.equal(saves.at(-1)!.mapId, 'prueba_caza'); assert.equal(saves.at(-1)!.x, ARRIVE.x); assert.equal(saves.at(-1)!.y, ARRIVE.y);
    const dest = reg.get('prueba_caza')!;
    assert.equal(dest.playerCount, 0);
    // un segundo pedido (doble portal) mientras cruza se ignora
    const n = J.log.length;
    assert.equal(reg.handlePortal(J.session, 'mazmorra_a_caza', save), null);
    assert.equal(J.log.length, n);
    // la celda del portal quedó libre: otro jugador puede pararse ahí
    assert.ok(!kinds(J.log).includes('initialGameWorldState') || J.log.filter((m) => m.payload?.$case === 'initialGameWorldState').length === 1);
    J.log.length = 0;
    // fase 2: MapReady
    assert.equal(reg.completeTransfer(J.session.sessionId, 'prueba_caza', reg.hashOf('prueba_caza')), true);
    assert.equal(dest.playerCount, 1);
    const p2 = dest.playerOf(J.session.sessionId)!;
    assert.equal(p2.playerId, playerId, 'es el mismo jugador (mismo id)');
    assert.equal(p2.hp, 77); assert.equal(p2.mp, 9); assert.equal(p2.econ!.gold, 1234); assert.equal(p2.accountKey, 'acc-ana');
    assert.deepEqual([p2.posX, p2.posY], [ARRIVE.x, ARRIVE.y]);
    assert.equal(p2.world, dest);
    const ig = find(J.log, 'initialGameWorldState').value;
    assert.equal(ig.mapName, 'prueba_caza'); assert.equal(ig.gameWorldId, 'prueba_caza'); assert.equal(ig.playerX, ARRIVE.x);
    assert.ok(!kinds(J.log).includes('initialState'), 'no se reenvía el catálogo entero en cada cruce');
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    // ya no hay nada pendiente: un MapReady repetido no hace nada
    assert.equal(reg.completeTransfer(J.session.sessionId, 'prueba_caza', reg.hashOf('prueba_caza')), false);
    // y a otro mapa: la salida de una vía del claro lleva al mapa viejo
    p2.setPosition(PRUEBA_CAZA.toLegacy.x, PRUEBA_CAZA.toLegacy.y);
    assert.equal(reg.handlePortal(J.session, 'caza_a_solmar', save), null);
    const legacy = reg.get('solmar_legacy')!;
    assert.equal(reg.completeTransfer(J.session.sessionId, 'solmar_legacy', reg.hashOf('solmar_legacy')), true);
    assert.deepEqual([legacy.playerOf(J.session.sessionId)!.posX, legacy.playerOf(J.session.sessionId)!.posY], [11, 12]);
    assert.equal(legacy.playerOf(J.session.sessionId)!.econ!.gold, 1234);
});

test('portales: id inexistente, lejos, requisito de nivel y hash distinto', () => {
    const { reg, eco } = fresh();
    const caza = reg.ensure('prueba_caza');
    const J = join(reg, eco, caza, 'carla', { x: 57, y: 6 });
    // id que no existe en este mapa y vínculo de otro mapa: se ignoran
    assert.equal(reg.handlePortal(J.session, 'legacy_a_villa', save), null);
    assert.equal(reg.handlePortal(J.session, 'no_existe', save), null);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    // puerta con requisito de nivel 2: nivel 1 no pasa y se le avisa
    J.p.prog.lvl = 1;
    const why = reg.handlePortal(J.session, 'caza_a_mazmorra', save);
    assert.match(why!, /nivel 2/);
    assert.ok(kinds(J.log).includes('sendMessage'));
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    assert.equal(caza.playerCount, 1);
    // lejos del portal: se ignora sin aviso
    J.p.prog.lvl = 5; J.p.setPosition(40, 40);
    assert.equal(reg.handlePortal(J.session, 'caza_a_mazmorra', save), null);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    // en la puerta y con nivel: cruza; con hash equivocado se lo desconecta
    J.p.setPosition(57, 6);
    assert.equal(reg.handlePortal(J.session, 'caza_a_mazmorra', save), null);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'prueba_mazmorra');
    assert.equal(reg.completeTransfer(J.session.sessionId, 'prueba_mazmorra', 'deadbeef'), false);
    assert.equal(J.disconnects.length, 1);
});

test('muerto no cruza; cruzar sin estar en un mundo se ignora', () => {
    const { reg, eco } = fresh();
    const legacy = reg.ensure('solmar_legacy');
    const J = join(reg, eco, legacy, 'dani', LEGACY_VILLA_LINK);
    J.p.hp = 0;
    assert.equal(reg.handlePortal(J.session, 'legacy_a_villa', save), null);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
    assert.equal(reg.handlePortal({ sessionId: 'nadie', worldId: 'solmar_legacy' }, 'legacy_a_villa', save), null);
});

test('la llave del requisito se descuenta al cruzar', () => {
    const { reg, eco } = fresh();
    const legacy = reg.ensure('solmar_legacy');
    const J = join(reg, eco, legacy, 'eva');
    J.p.econ!.q.keys.cripta = 2; J.p.prog.keys.cripta = 2;
    legacy.consumeLinkKey(J.p, { id: 'x', map: 'm', x: 0, y: 0, to: { map: 'm', x: 1, y: 1 }, kind: 'door', gate: { key: 'cripta' }, msg: '' });
    assert.equal(J.p.econ!.q.keys.cripta, 1); assert.equal(J.p.prog.keys.cripta, 1);
});

test('los temporizadores del jugador lo siguen al mundo nuevo (nada fantasma en el viejo)', () => {
    const { reg, eco } = fresh();
    const src = reg.ensure('prueba_mazmorra');
    const J = join(reg, eco, src, 'fran', EXIT);
    const ran: string[] = [];
    J.p.timers.push({ at: Date.now() + 5, fn: (w) => ran.push(w.id) });
    reg.handlePortal(J.session, 'mazmorra_a_caza', save);
    reg.completeTransfer(J.session.sessionId, 'prueba_caza', reg.hashOf('prueba_caza'));
    const t = Date.now() + 50;
    src.tick(); assert.deepEqual(ran, []);
    const origNow = Date.now; Date.now = () => t;
    try { reg.get('prueba_caza')!.tick(); } finally { Date.now = origNow; }
    assert.deepEqual(ran, ['prueba_caza']);
});

test('hibernación: los mundos vacíos se duermen, no corren y despiertan con los mobs enteros', () => {
    const { reg, eco } = fresh({ hibernateAfterMs: 1000 });
    const caza = reg.ensure('prueba_caza');
    const J = join(reg, eco, caza, 'gus', { x: 8, y: 58 });
    const t0 = 1_000_000;
    reg.sweep(t0); reg.sweep(t0 + 5000);
    assert.equal(caza.isHibernated, false, 'con un jugador adentro no duerme');
    caza.removePlayer(J.session.sessionId);
    reg.sweep(t0 + 6000); assert.equal(caza.isHibernated, false, 'recién quedó vacío');
    reg.sweep(t0 + 7500);
    assert.equal(caza.isHibernated, true);
    assert.equal(caza.mobCount, 0);
    caza.tick(); // dormido: no hace nada ni rompe
    assert.equal(reg.ensure('prueba_caza'), caza);
    assert.equal(caza.isHibernated, false);
    assert.ok(caza.mobCount > 0);
});

test('un cruce pendiente mantiene despierto el mundo de destino y vence por tiempo', () => {
    const { reg, eco } = fresh({ hibernateAfterMs: 1000, transferTimeoutMs: 5000 });
    const src = reg.ensure('prueba_mazmorra');
    const J = join(reg, eco, src, 'hugo', EXIT);
    reg.handlePortal(J.session, 'mazmorra_a_caza', save);
    const caza = reg.get('prueba_caza')!;
    const now = Date.now();
    reg.sweep(now + 1); reg.sweep(now + 3000);
    assert.equal(caza.isHibernated, false);
    assert.equal(caza.playerCount, 0);
    reg.sweep(now + 6000); // pasó el tiempo: se lo mete igual
    assert.equal(caza.playerCount, 1);
    assert.equal(reg.pendingOf(J.session.sessionId), undefined);
});

test('si se corta la conexión entre MapTransfer y MapReady, queda en el mundo nuevo', () => {
    const { reg, eco } = fresh();
    const src = reg.ensure('prueba_mazmorra');
    const J = join(reg, eco, src, 'ines', EXIT);
    reg.handlePortal(J.session, 'mazmorra_a_caza', save);
    assert.equal(reg.flushPending(J.session.sessionId), true);
    const caza = reg.get('prueba_caza')!;
    assert.equal(caza.playerCount, 1);
    caza.playerDisconnected(J.session.sessionId, true); // en gracia, en el mapa nuevo
    assert.equal(caza.playerOf(J.session.sessionId)!.disconnected, true);
    assert.equal(reg.flushPending(J.session.sessionId), false);
});

test('instancias: clave mapa#instancia, separadas del mundo compartido y con baja al quedar vacías', () => {
    const { reg, eco } = fresh({ hibernateAfterMs: 500, instanceTtlMs: 2000 });
    const legacy = reg.ensure('solmar_legacy');
    const J = join(reg, eco, legacy, 'juan', { x: 11, y: 11 });
    const shared = reg.ensure('prueba_mazmorra');
    assert.ok(reg.beginTransfer(J.session, { map: 'prueba_mazmorra', x: 5, y: 41, instanceId: 'grupo7' }, save));
    assert.equal(J.session.worldId, 'prueba_mazmorra#grupo7');
    J.log.length = 0;
    assert.equal(reg.completeTransfer(J.session.sessionId, 'prueba_mazmorra', reg.hashOf('prueba_mazmorra')), true);
    const inst = reg.get('prueba_mazmorra#grupo7')!;
    assert.notEqual(inst, shared); assert.equal(inst.playerCount, 1); assert.equal(shared.playerCount, 0);
    assert.equal(inst.mapId, 'prueba_mazmorra');
    assert.equal(find(J.log, 'initialGameWorldState').value.gameWorldId, 'prueba_mazmorra#grupo7');
    inst.removePlayer(J.session.sessionId);
    const t0 = Date.now();
    reg.sweep(t0); reg.sweep(t0 + 1000); assert.ok(reg.get('prueba_mazmorra#grupo7'), 'todavía no venció');
    reg.sweep(t0 + 2500); assert.equal(reg.get('prueba_mazmorra#grupo7'), undefined);
    assert.ok(reg.get('prueba_mazmorra'), 'el compartido no se da de baja');
});

test('respawn por mapa: cada mapa reaparece donde dice su MapDef', () => {
    const { reg, eco } = fresh();
    reg.sessionHook = undefined;
    const die = (world: GameWorld, J: ReturnType<typeof join>) => { J.p.hp = 0; J.p.deadAt = Date.now() - 5000; world.handleClientPacket(J.session.sessionId, { payload: { $case: 'respawnRequest', value: {} } } as never); };
    const mz = reg.ensure('prueba_mazmorra');
    const A = join(reg, eco, mz, 'kai', { x: 23, y: 27 });
    die(mz, A);
    assert.deepEqual([A.p.posX, A.p.posY], [7, 41], 'reaparece en la entrada de la mazmorra');
    assert.ok(A.p.hp > 0);
    const caza = reg.ensure('prueba_caza');
    const B = join(reg, eco, caza, 'lia', { x: 24, y: 40 });
    die(caza, B);
    assert.deepEqual([B.p.posX, B.p.posY], [8, 59], 'reaparece en la posta del claro');
    const legacy = reg.ensure('solmar_legacy');
    const C = join(reg, eco, legacy, 'mia', { x: 30, y: 20 });
    die(legacy, C);
    assert.deepEqual([C.p.posX, C.p.posY], [7, 8], 'el mapa original sigue mandando al hogar de la facción');
});

test('pvp por mapa: sin PvP en la mazmorra, de facción en el claro', () => {
    const { reg, eco } = fresh();
    const enemy = (w: GameWorld, a: Player, b: Player) => (w as any).isEnemyPair(a, b) as boolean;
    const mz = reg.ensure('prueba_mazmorra');
    const A = join(reg, eco, mz, 'nora', { x: 20, y: 25 }), B = join(reg, eco, mz, 'omar', { x: 21, y: 25 });
    A.p.profile = 'solmar;g'; B.p.profile = 'vhar;g';
    assert.equal(enemy(mz, A.p, B.p), false);
    const caza = reg.ensure('prueba_caza');
    const C = join(reg, eco, caza, 'pia', { x: 30, y: 30 }), D = join(reg, eco, caza, 'quim', { x: 31, y: 30 });
    C.p.profile = 'solmar;g'; D.p.profile = 'vhar;g';
    assert.equal(enemy(caza, C.p, D.p), true);
    D.p.profile = 'solmar;g'; assert.equal(enemy(caza, C.p, D.p), false);
});

test('posición guardada: sin mapId cae en el mapa por defecto; mapas temporales vuelven a su rest', () => {
    const base = { direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
    // guardado viejo: solo worldId 'solmar' -> mapa original, con su posición (es el mismo mapa)
    let r = resolveSaved({ ...base, worldId: 'solmar', x: 30, y: 20 }, 'solmar_legacy');
    assert.equal(r.mapId, 'solmar_legacy'); assert.equal(r.persisted?.x, 30);
    // sin mapa en absoluto o mapa desconocido: se descarta
    r = resolveSaved({ ...base, worldId: undefined as never, x: 3, y: 3 }, 'solmar_legacy');
    assert.equal(r.mapId, 'solmar_legacy'); assert.equal(r.persisted, undefined);
    r = resolveSaved({ ...base, mapId: 'borrado', worldId: 'borrado', x: 3, y: 3 }, 'solmar_legacy');
    assert.equal(r.persisted, undefined);
    assert.equal(resolveSaved(undefined, 'solmar_legacy').mapId, 'solmar_legacy');
    const { reg } = fresh();
    const mapOf = (id: string) => reg.mapOf(id);
    // arena del mapa original -> spawn; mazmorra de prueba -> la puerta del claro; claro -> tal cual
    assert.deepEqual(restPosition({ ...base, mapId: 'solmar_legacy', worldId: 'solmar_legacy', x: 50, y: 30 }, mapOf)!, { ...base, mapId: 'solmar_legacy', worldId: 'solmar_legacy', x: 7, y: 8 });
    const m = restPosition({ ...base, mapId: 'prueba_mazmorra', worldId: 'prueba_mazmorra', x: 23, y: 27 }, mapOf)!;
    assert.deepEqual([m.mapId, m.x, m.y], ['prueba_caza', 57, 9]);
    const c = restPosition({ ...base, mapId: 'prueba_caza', worldId: 'prueba_caza', x: 30, y: 30 }, mapOf)!;
    assert.deepEqual([c.mapId, c.x, c.y], ['prueba_caza', 30, 30]);
});

test('respawn en otro mapa: la muerte dispara un cruce de dos fases con la vida ya restaurada', () => {
    const { reg, eco } = fresh();
    const caza = reg.ensure('prueba_caza');
    (caza as unknown as { def: unknown }).def = { ...(caza as unknown as { def: object }).def, respawn: { map: 'solmar_legacy', x: 11, y: 12 } };
    const J = join(reg, eco, caza, 'rita', { x: 24, y: 40 });
    reg.sessionHook = (id) => (id === J.session.sessionId ? { session: J.session, save } : undefined);
    J.p.hp = 0; J.p.deadAt = Date.now() - 5000;
    caza.handleClientPacket(J.session.sessionId, { payload: { $case: 'respawnRequest', value: {} } } as never);
    assert.equal(reg.pendingOf(J.session.sessionId)?.map, 'solmar_legacy');
    assert.ok(J.p.hp > 0);
    assert.equal(caza.playerOf(J.session.sessionId), undefined);
    reg.completeTransfer(J.session.sessionId, 'solmar_legacy', reg.hashOf('solmar_legacy'));
    const legacy = reg.get('solmar_legacy')!;
    assert.deepEqual([legacy.playerOf(J.session.sessionId)!.posX, legacy.playerOf(J.session.sessionId)!.posY], [11, 12]);
});

test('mazmorra: cada party entra junta a su propia instancia; los demás, a la suya', () => {
    const { reg, eco } = fresh();
    const caza = reg.ensure('prueba_caza');
    const A = join(reg, eco, caza, 'ana', { x: 57, y: 6 }), B = join(reg, eco, caza, 'beto', { x: 55, y: 8 });
    const C = join(reg, eco, caza, 'carla', { x: 57, y: 5 }), D = join(reg, eco, caza, 'dani', { x: 10, y: 10 });
    for (const j of [A, B, C, D]) j.p.prog.lvl = 5;
    const people = new Map([[A, 'ana'], [B, 'beto'], [C, 'carla'], [D, 'dani']].map(([j, n]) => [(j as typeof A).session.sessionId, n as string]));
    const inbox = new Map<string, ServerMessage[]>();
    const svc = new PartyService({
        sessionByName: (n) => [...people].find(([, v]) => v === n.toLowerCase())?.[0],
        send: (sid, m) => { (inbox.get(sid) ?? inbox.set(sid, []).get(sid)!).push(m); },
        info: (sid) => (people.has(sid) ? { name: people.get(sid)!, faction: 'solmar', level: 5, hp: 100, maxHp: 100, map: 'prueba_caza', online: true } : undefined),
    });
    setParties(svc);
    reg.sessionHook = (sid) => { const j = [A, B, C, D].find((x) => x.session.sessionId === sid); return j && { session: j.session, save }; };
    try {
        svc.handle(A.session.sessionId, 'invite', 'beto'); svc.handle(B.session.sessionId, 'accept', '');
        assert.equal(reg.handlePortal(A.session, 'caza_a_mazmorra', save), null);
        const keyA = A.session.worldId;
        assert.match(keyA, /^prueba_mazmorra#p\d+$/);
        assert.equal(B.session.worldId, keyA, 'el compañero cercano cruza a la misma instancia');
        assert.equal(D.session.worldId, 'prueba_caza', 'quien no está en la party no cruza');
        // alguien sin party: instancia propia, distinta
        assert.equal(reg.handlePortal(C.session, 'caza_a_mazmorra', save), null);
        assert.match(C.session.worldId, /^prueba_mazmorra#u/); assert.notEqual(C.session.worldId, keyA);
        for (const j of [A, B, C]) reg.completeTransfer(j.session.sessionId, 'prueba_mazmorra', reg.hashOf('prueba_mazmorra'));
        assert.equal(reg.get(keyA)!.playerCount, 2);
        assert.equal(reg.get(C.session.worldId)!.playerCount, 1);
        assert.equal(reg.get('prueba_mazmorra'), undefined, 'no se crea el mundo compartido de la mazmorra');
        // un compañero lejos de la puerta no es arrastrado ni cuenta para la instancia
        const caza2 = reg.get('prueba_caza')!; assert.equal(caza2.playerCount, 1);
        // salir de la mazmorra vuelve al mundo compartido
        const ap = reg.get(keyA)!.playerOf(A.session.sessionId)!; ap.setPosition(PRUEBA_MAZMORRA.exit.x, PRUEBA_MAZMORRA.exit.y);
        assert.equal(reg.handlePortal(A.session, 'mazmorra_a_caza', save), null);
        assert.equal(A.session.worldId, 'prueba_caza');
    } finally { setParties(undefined); }
});

test('mazmorra: un compañero que no cumple el requisito no entra y se avisa', () => {
    const { reg, eco } = fresh();
    const caza = reg.ensure('prueba_caza');
    const A = join(reg, eco, caza, 'ana', { x: 57, y: 6 }), B = join(reg, eco, caza, 'beto', { x: 55, y: 8 });
    A.p.prog.lvl = 5; B.p.prog.lvl = 1;
    const people = new Map([[A.session.sessionId, 'ana'], [B.session.sessionId, 'beto']]);
    const svc = new PartyService({
        sessionByName: (n) => [...people].find(([, v]) => v === n.toLowerCase())?.[0], send: () => {},
        info: (sid) => ({ name: people.get(sid)!, faction: 'solmar', level: 5, hp: 100, maxHp: 100, map: 'prueba_caza', online: true }),
    });
    setParties(svc);
    reg.sessionHook = (sid) => { const j = [A, B].find((x) => x.session.sessionId === sid); return j && { session: j.session, save }; };
    try {
        svc.handle(A.session.sessionId, 'invite', 'beto'); svc.handle(B.session.sessionId, 'accept', '');
        B.log.length = 0;
        reg.handlePortal(A.session, 'caza_a_mazmorra', save);
        assert.match(A.session.worldId, /#p/); assert.equal(B.session.worldId, 'prueba_caza');
        assert.ok(kinds(B.log).includes('sendMessage'));
    } finally { setParties(undefined); }
});
