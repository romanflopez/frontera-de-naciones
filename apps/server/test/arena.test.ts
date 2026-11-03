/**
 * Arenas 2v2 y 3v3 (docs/PARTY_Y_ARENAS.md §2): cola con party exacta, invitación de 30 s, penalización de 10 min [DM], partida en una
 * instancia con preparación y pelea entre equipos (aunque sean de la misma nación), Glicko-2 por modo y vuelta al punto de entrada.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { ARENA_MAPS, ARENA_RULES, arenaHealMult, arenaStarts, getMapDef, mapHash } from '@fdn/world';
import { ArenaService, ARENA_STORAGE_KEY } from '../src/arena.ts';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import { GLICKO, glicko2, seasonReset, teamOpponent } from '../src/glicko.ts';
import { PartyService, setParties } from '../src/party.ts';
import type { PersistedPlayer } from '../src/player.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import type { GameWorld } from '../src/world.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
let off = 0;
const realNow = Date.now;
mock.method(Date, 'now', () => realNow() + off);

// ---------- funciones puras ----------
test('Glicko-2: el ejemplo del paper de Glickman (1500/200 contra 1400, 1550 y 1700) da 1464,06 / 151,52 / 0,05999', () => {
    const r = glicko2({ r: 1500, rd: 200, vol: 0.06 }, [{ r: 1400, rd: 30, score: 1 }, { r: 1550, rd: 100, score: 0 }, { r: 1700, rd: 300, score: 0 }]);
    assert.ok(Math.abs(r.r - 1464.06) < 0.05, String(r.r));
    assert.ok(Math.abs(r.rd - 151.52) < 0.05, String(r.rd));
    assert.ok(Math.abs(r.vol - 0.05999) < 0.0001, String(r.vol));
    const idle = glicko2({ r: 1500, rd: 50, vol: 0.06 }, []);
    assert.equal(idle.r, 1500); assert.ok(idle.rd > 50, 'sin jugar crece el desvío');
});

test('Glicko-2: rival compuesto del equipo y cambio de temporada (solo vuelve hacia el medio el que jugó 10)', () => {
    assert.deepEqual(teamOpponent([{ r: 1400, rd: 30, vol: 0.06 }, { r: 1600, rd: 40, vol: 0.06 }]), { r: 1500, rd: Math.sqrt((30 * 30 + 40 * 40) / 2) });
    assert.equal(seasonReset({ r: 1800, rd: 60, vol: 0.06 }, 12, 10).r, 1650);
    assert.equal(seasonReset({ r: 1800, rd: 60, vol: 0.06 }, 12, 10).rd, 200);
    assert.equal(seasonReset({ r: 1800, rd: 60, vol: 0.06 }, 9, 10).r, 1800, 'con menos de 10 partidas no cambia');
});

test('curación en la arena: −20 % cada 3 min de pelea, hasta 20 %', () => {
    const min = 60_000;
    assert.deepEqual([0, 2.9, 3, 6, 9, 12, 15].map((m) => arenaHealMult(m * min)), [1, 1, 0.8, 0.6, 0.4, 0.2, 0.2]);
});

test('mapas de arena: tres, sin portal, temporales, los puestos de salida libres y la arena del Claro no cambió', () => {
    assert.equal(ARENA_MAPS.length, 3);
    for (const a of ARENA_MAPS) {
        const d = getMapDef(a.id)!, map = d.build();
        assert.ok(d.temporary && d.debugOnly && d.pvp === 'ffa' && d.region === 'arena' && d.links.length === 0, a.id);
        for (const t of [0, 1] as const) for (const c of arenaStarts(t, 3)) assert.equal(map.blocked[c.y][c.x], false, `${a.id} ${c.x},${c.y}`);
        assert.equal(mapHash(map), mapHash(d.build()), 'determinista');
    }
    assert.notEqual(mapHash(getMapDef('arena_ruinas')!.build()), mapHash(getMapDef('arena_muros')!.build()));
    assert.equal(mapHash(getMapDef('arena')!.build()), '60a94a25', 'el Claro es la arena de antes (mismo hash)');
});

// ---------- servicio con mundos reales ----------
interface J { name: string; session: TransferSession; log: ServerMessage[]; key: string; online: boolean }
function setup(names: string[], opts: { allowSmall?: boolean } = {}) {
    off += 10_000_000;
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco, instanceTtlMs: 1000 });
    const caza = reg.ensure('prueba_caza');
    (caza as unknown as { mobSim?: unknown }).mobSim = undefined; // sin mobs que molesten
    const js: J[] = [];
    names.forEach((name, i) => {
        const log: ServerMessage[] = [], session: TransferSession = { sessionId: `s-${name}`, worldId: caza.id };
        const persisted = { mapId: caza.mapId, worldId: caza.mapId, x: 40 + i * 2, y: 30, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true } as PersistedPlayer;
        caza.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        caza.bindAccount(session.sessionId, `acc-${name}`);
        caza.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
        caza.handleClientPacket(session.sessionId, { payload: { $case: 'changePlayerProfileRequest', value: { profile: 'solmar;guerrero;' } } } as never);
        js.push({ name, session, log, key: `acc-${name}`, online: true });
    });
    const by = (sid: string) => js.find((j) => j.session.sessionId === sid);
    let arenaRef: ArenaService | undefined;
    const parties = new PartyService({
        left: (sid, by) => arenaRef?.partyLeft(sid, by),
        sessionByName: (n) => js.find((j) => j.name === n.toLowerCase())?.session.sessionId, send: () => {},
        info: (sid) => { const j = by(sid); return j && { name: j.name, faction: 'solmar', level: 10, hp: 100, maxHp: 100, mp: 0, maxMp: 0, map: 'prueba_caza', online: j.online }; },
    });
    setParties(parties);
    const save = () => {};
    reg.sessionHook = (sid) => { const j = by(sid); return j && { session: j.session, save }; };
    const arena = new ArenaService({
        send: (sid, m) => by(sid)?.log.push(m),
        session: (sid) => { const j = by(sid); return j && { name: j.name, accountKey: j.key, worldKey: j.session.worldId, online: j.online }; },
        partyMembers: (sid) => parties.partyMembers(sid), isLeader: (sid) => parties.isLeader(sid),
        world: (k) => reg.get(k), ensure: (m, i) => reg.ensure(m, i),
        transfer: (sid, dest) => { const j = by(sid); return !!j && reg.beginTransfer(j.session, dest, save); },
        pending: (sid) => !!reg.pendingOf(sid),
    }, mem, { allowSmallTeams: opts.allowSmall });
    arenaRef = arena;
    const party = (...members: J[]) => { for (const m of members.slice(1)) { parties.handle(members[0].session.sessionId, 'invite', m.name); parties.handle(m.session.sessionId, 'accept', ''); } };
    const cmd = (j: J, text: string) => arena.command(j.session.sessionId, text);
    const texts = (j: J) => j.log.flatMap((m) => (m.payload?.$case === 'sendMessage' ? [m.payload.value.message] : []));
    const saw = (j: J, re: RegExp) => texts(j).some((t) => re.test(t));
    const world = (j: J): GameWorld => reg.get(j.session.worldId)!;
    const me = (j: J) => world(j).playerOf(j.session.sessionId)!;
    const arrive = (j: J) => { const map = j.session.worldId.split('#')[0]; reg.completeTransfer(j.session.sessionId, map, reg.hashOf(map)); };
    const step = (ms: number) => { for (let t = 0; t < ms; t += 1000) { off += Math.min(1000, ms - t); reg.tickAll(); arena.tick(); } };
    /** Dos parties anotadas, partida aceptada y todos adentro de la arena. */
    const startMatch = (a: J[], b: J[], mode: '2v2' | '3v3') => {
        party(...a); party(...b);
        cmd(a[0], `/arena ${mode}`); cmd(b[0], `/arena ${mode}`); arena.tick();
        for (const j of [...a, ...b]) cmd(j, '/arena aceptar');
        for (const j of [...a, ...b]) arrive(j);
        step(1000);
    };
    return { reg, js, arena, parties, mem, cmd, texts, saw, world, me, arrive, step, party, startMatch };
}

test('cola: party exacta, solo el líder, y nadie penalizado, en mazmorra ni recién salido de una pelea', () => {
    const { js: [a, b, c, d], cmd, saw, party, arena, me } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        cmd(a, '/arena 2v2'); assert.ok(saw(a, /exactamente 2/), 'sin party no');
        party(a, b, c); cmd(a, '/arena 2v2'); assert.ok(saw(a, /exactamente 2.*tenés 3/), 'party de 3 en 2v2 no');
        cmd(b, '/arena 3v3'); assert.ok(saw(b, /Solo el líder/));
        me(c).pvpCombatUntil = Date.now() + 5_000; cmd(a, '/arena 3v3'); assert.ok(saw(a, /cami peleó con un jugador/), 'recién peleó');
        me(c).pvpCombatUntil = 0;
        cmd(a, '/arena 3v3'); assert.equal(arena.stateOf(c.session.sessionId), 'cola');
        assert.ok(saw(c, /entró a la cola de 3v3/));
        void d;
    } finally { setParties(undefined); }
});

test('salir de la cola penaliza solo al que sale (10 min) y el penalizado no puede volver a anotarse', () => {
    const { js: [a, b], cmd, saw, party, arena, step } = setup(['ana', 'beto']);
    try {
        party(a, b); cmd(a, '/arena 2v2');
        cmd(b, '/arena salir');
        assert.equal(arena.stateOf(a.session.sessionId), null); assert.equal(arena.queued('2v2'), 0);
        assert.ok(arena.penaltyLeft(b.key) > 9 * 60_000); assert.equal(arena.penaltyLeft(a.key), 0, 'el líder no paga');
        assert.ok(saw(a, /beto sacó a la party de la cola/));
        cmd(a, '/arena 2v2'); assert.ok(saw(a, /beto está penalizado/));
        step(ARENA_RULES.penaltyMs);
        cmd(a, '/arena 2v2'); assert.equal(arena.stateOf(b.session.sessionId), 'cola', 'pasados los 10 min vuelve a poder');
    } finally { setParties(undefined); }
});

test('si alguien deja la party mientras está en la cola, la party sale y solo él cobra la penalización', () => {
    const { js: [a, b, c], cmd, party, arena, parties, saw } = setup(['ana', 'beto', 'cami']);
    try {
        party(a, b); cmd(a, '/arena 2v2');
        parties.handle(b.session.sessionId, 'leave', ''); arena.tick();
        assert.equal(arena.queued('2v2'), 0);
        assert.ok(arena.penaltyLeft(b.key) > 0); assert.equal(arena.penaltyLeft(a.key), 0);
        assert.ok(saw(a, /La party cambió \(beto salió\)/));
        // expulsar: paga el líder que expulsa
        party(a, c); cmd(a, '/arena 2v2'); parties.handle(a.session.sessionId, 'kick', 'cami');
        assert.equal(arena.queued('2v2'), 0); assert.ok(arena.penaltyLeft(a.key) > 0); assert.equal(arena.penaltyLeft(c.key), 0);
    } finally { setParties(undefined); }
});

test('invitación: el que rechaza queda penalizado y su party sale; la otra vuelve a la cola en su lugar', () => {
    const { js: [a, b, c, d], cmd, party, arena, saw } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        party(a, b); party(c, d);
        cmd(a, '/arena 2v2'); cmd(c, '/arena 2v2'); arena.tick();
        for (const j of [a, b, c, d]) { assert.equal(arena.stateOf(j.session.sessionId), 'invitacion'); assert.ok(saw(j, /Partida de arena 2v2 encontrada/)); }
        cmd(a, '/arena aceptar'); cmd(d, '/arena rechazar');
        assert.ok(arena.penaltyLeft(d.key) > 0); assert.equal(arena.penaltyLeft(c.key), 0); assert.equal(arena.penaltyLeft(a.key), 0);
        assert.equal(arena.stateOf(a.session.sessionId), 'cola'); assert.equal(arena.stateOf(c.session.sessionId), null);
        assert.ok(saw(a, /dani rechazó la partida: volvés a la cola/)); assert.ok(saw(c, /dani rechazó la partida: tu party salió/));
    } finally { setParties(undefined); }
});

test('invitación: a los 30 s, los que no aceptaron quedan penalizados', () => {
    const { js: [a, b, c, d], cmd, party, arena, step } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        party(a, b); party(c, d);
        cmd(a, '/arena 2v2'); cmd(c, '/arena 2v2'); arena.tick();
        for (const j of [a, b, c]) cmd(j, '/arena aceptar');
        step(ARENA_RULES.acceptMs + 1000);
        assert.ok(arena.penaltyLeft(d.key) > 0);
        for (const j of [a, b, c]) assert.equal(arena.penaltyLeft(j.key), 0, j.name);
        assert.equal(arena.stateOf(a.session.sessionId), 'cola');
    } finally { setParties(undefined); }
});

test('emparejador: niveles muy distintos no se cruzan al toque, pero la ventana se abre con la espera', () => {
    const { js: [a, b, c, d], cmd, party, arena, me, step } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        me(c).econ!.lvl = 35; me(d).econ!.lvl = 35; // ana y beto son nivel 1
        party(a, b); party(c, d); cmd(a, '/arena 2v2'); cmd(c, '/arena 2v2'); arena.tick();
        assert.equal(arena.stateOf(a.session.sessionId), 'cola');
        let waited = 0; while (arena.stateOf(a.session.sessionId) === 'cola' && waited < 10 * 60_000) { step(1000); waited += 1000; }
        assert.equal(arena.stateOf(a.session.sessionId), 'invitacion');
        assert.ok(waited >= 7 * 60_000 && waited <= 8 * 60_000, `34 niveles de diferencia: ~7,5 min de espera (${waited / 1000} s)`);
    } finally { setParties(undefined); }
});

test('partida 2v2 completa: preparación sin daño, pelea entre la misma nación, gana el que deja al otro en el piso y vuelven a su lugar', () => {
    const { js: [a, b, c, d], arena, me, world, step, saw, startMatch, mem } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        startMatch([a, b], [c, d], '2v2');
        const info = arena.matchInfo(a.session.sessionId)!;
        assert.equal(info.phase, 'prep'); assert.match(info.key, /^arena(_\w+)?#a\d+$/);
        for (const j of [a, b, c, d]) assert.equal(j.session.worldId, info.key, `${j.name} en la arena`);
        const w = world(a), A = me(a), C = me(c);
        assert.deepEqual([A.posX, A.posY], [arenaStarts(0, 2)[0].x, arenaStarts(0, 2)[0].y]);
        // preparación: no hay daño ni se sale de la jaula; pociones y resurrección no existen
        const hit = (from: typeof A, to: typeof A) => w.handleClientPacket(from.sessionId, { payload: { $case: 'pvpHitRequest', value: { fx: '', x: to.posX, y: to.posY, targetId: to.playerId, dmg: 0, secs: 0, r: 0, spell: 'ataque' } } } as never);
        C.setPosition(A.posX + 1, A.posY); // como si estuviera al lado (solo para probar el daño)
        const hp0 = C.hp; hit(A, C); assert.equal(C.hp, hp0, 'en la preparación no se pega');
        w.handleClientPacket(a.session.sessionId, { payload: { $case: 'requestMovement', value: { curX: A.posX, curY: A.posY, destX: A.posX + 1, destY: A.posY + 1, dashAttack: false } } } as never);
        w.handleClientPacket(a.session.sessionId, { payload: { $case: 'requestMovement', value: { curX: A.posX, curY: A.posY, destX: A.posX + 1, destY: A.posY + 1, dashAttack: false } } } as never);
        assert.ok(Math.hypot(A.posX - arenaStarts(0, 2)[0].x, A.posY - arenaStarts(0, 2)[0].y) <= ARENA_RULES.cageR, 'no sale de la jaula');
        w.handleClientPacket(a.session.sessionId, { payload: { $case: 'potionRequest', value: { kind: 0 } } } as never);
        assert.ok(saw(a, /no se usan pociones/));
        // pelea
        step(ARENA_RULES.prepMs);
        assert.equal(arena.matchInfo(a.session.sessionId)!.phase, 'fight');
        assert.ok(saw(a, /¡A pelear!/));
        const hp1 = C.hp; hit(A, C); assert.ok(C.hp < hp1, 'equipos distintos de la misma nación se pegan');
        const B = me(b), hpB = B.hp; B.setPosition(A.posX, A.posY + 1); hit(A, B); assert.equal(B.hp, hpB, 'al compañero no');
        // morir en la arena no cuesta exp y no se reaparece hasta el final
        const exp0 = C.econ!.exp; C.hp = 1; C.combat.def = 0; for (let i = 0; i < 20 && !C.isDead; i++) { off += 2000; hit(A, C); }
        assert.ok(C.isDead); assert.equal(C.econ!.exp, exp0, 'sin pérdida de exp');
        off += 5000; w.handleClientPacket(c.session.sessionId, { payload: { $case: 'respawnRequest', value: {} } } as never);
        assert.ok(C.isDead && c.session.worldId === info.key, 'no reaparece');
        me(d).hp = 0;
        step(1000);
        assert.equal(arena.matchInfo(a.session.sessionId)!.phase, 'end');
        assert.ok(saw(a, /Ganan ana y beto/));
        const lad = (mem.get(ARENA_STORAGE_KEY) as AccountRecord & { arena?: { modes: Record<string, Record<string, { r: number; n: number; w: number; l: number }>> } }).arena!.modes['2v2'];
        assert.ok(lad[a.key].r > GLICKO.r && lad[b.key].r > GLICKO.r && lad[c.key].r < GLICKO.r && lad[d.key].r < GLICKO.r);
        assert.deepEqual([lad[a.key].n, lad[a.key].w, lad[c.key].l], [1, 1, 1]);
        assert.ok(!C.isDead && C.hp === C.combat.maxHp, 'al terminar todos vivos y llenos');
        // festejo y vuelta al punto de entrada
        step(ARENA_RULES.endMs + 1000);
        for (const j of [a, b, c, d]) { assert.equal(arena.stateOf(j.session.sessionId), null); assert.equal(j.session.worldId, 'prueba_caza'); }
    } finally { setParties(undefined); }
});

test('vuelta al punto exacto de entrada y el rating no se mueve para nadie de afuera', () => {
    const { js: [a, b, c, d], arena, me, step, startMatch, arrive, world } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        const origins = [a, b, c, d].map((j) => ({ x: me(j).posX, y: me(j).posY }));
        startMatch([a, b], [c, d], '2v2');
        step(ARENA_RULES.prepMs); me(c).hp = 0; me(d).hp = 0; step(1000); step(ARENA_RULES.endMs + 1000);
        [a, b, c, d].forEach((j, i) => { arrive(j); assert.equal(world(j).mapId, 'prueba_caza'); assert.deepEqual({ x: me(j).posX, y: me(j).posY }, origins[i], j.name); });
        assert.equal(arena.ratingOf('acc-nadie', '2v2').r, GLICKO.r);
    } finally { setParties(undefined); }
});

test('abandonar la partida (se le vence la gracia) penaliza al que se fue; si se va todo un equipo, gana el otro', () => {
    const { js: [a, b, c, d], arena, step, startMatch, saw, reg } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        startMatch([a, b], [c, d], '2v2');
        step(ARENA_RULES.prepMs);
        for (const j of [c, d]) { reg.get(j.session.worldId)!.removePlayer(j.session.sessionId); arena.sessionGone(j.session.sessionId, j.key); }
        assert.ok(arena.penaltyLeft(c.key) > 0 && arena.penaltyLeft(d.key) > 0); assert.equal(arena.penaltyLeft(a.key), 0);
        assert.ok(saw(a, /cami abandonó la partida/));
        step(1000);
        assert.ok(saw(a, /Ganan ana y beto/));
        assert.ok(arena.ratingOf(c.key, '2v2').r < GLICKO.r, 'el que abandona pierde rating');
    } finally { setParties(undefined); }
});

test('a los 15 min de pelea es empate', () => {
    const { js: [a, b, c, d], arena, step, startMatch, saw } = setup(['ana', 'beto', 'cami', 'dani']);
    try {
        startMatch([a, b], [c, d], '2v2');
        step(ARENA_RULES.prepMs + ARENA_RULES.fightMs);
        assert.ok(saw(a, /Empate\./));
        assert.equal(arena.ratingOf(a.key, '2v2').d, 1);
    } finally { setParties(undefined); }
});

test('3v3: rating aparte del 2v2 y tres puestos por equipo; invisibilidad limitada a 3 por partida', () => {
    const { js, arena, step, startMatch, me, world, saw } = setup(['ana', 'beto', 'cami', 'dani', 'eli', 'fede']);
    try {
        const [a, b, c, d, e, f] = js;
        startMatch([a, b, c], [d, e, f], '3v3');
        const info = arena.matchInfo(a.session.sessionId)!;
        assert.equal(info.mode, '3v3'); assert.deepEqual(info.teams.map((t) => t.length), [3, 3]);
        step(ARENA_RULES.prepMs);
        const w = world(a), A = me(a); A.combat.cls = 'mago'; A.combat.lvl = 20; A.mp = A.combat.maxMp = 9999;
        for (let i = 0; i < 4; i++) { A.invisCdUntil = 0; A.status.isInvisible = false; w.handleClientPacket(a.session.sessionId, { payload: { $case: 'invisibilityRequest', value: {} } } as never); }
        assert.ok(saw(a, /te quedan 0/)); assert.ok(saw(a, /Ya usaste las 3 invisibilidades/));
        for (const j of [d, e, f]) me(j).hp = 0;
        step(1000);
        assert.ok(arena.ratingOf(a.key, '3v3').r > GLICKO.r);
        assert.equal(arena.ratingOf(a.key, '2v2').n, 0, 'el 2v2 no se toca');
    } finally { setParties(undefined); }
});

test('modo de prueba (FDN_ARENA_PRUEBA): se puede entrar solo para probar con dos personas', () => {
    const { js: [a, b], arena, cmd } = setup(['ana', 'beto'], { allowSmall: true });
    try {
        cmd(a, '/arena 2v2'); cmd(b, '/arena 2v2'); arena.tick();
        assert.equal(arena.stateOf(a.session.sessionId), 'invitacion');
    } finally { setParties(undefined); }
});
