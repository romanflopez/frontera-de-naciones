/**
 * Reglas de mazmorra (docs/MAZMORRAS.md): una vida por corrida, lo muerto queda muerto, escalado por party y élites.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { ELITE_HP_MULT, PRUEBA_MAZMORRA, getMapDef, TRAIT_ELITE, TRAIT_MUTANT, dungeonPartyScale, isEliteSlot, mobDef, traitLabel, type MobType, type WorldMap, type Zone } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import { MobSim, type MobHost } from '../src/mobs.ts';
import { PartyService, setParties } from '../src/party.ts';
import type { PersistedPlayer, Player } from '../src/player.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { PvpLimiter, statsFromChar } from '../src/systems/pvpCombat.ts';
import type { GameWorld } from '../src/world.ts';

// ---------- simulador de mobs ----------
const N = 40;
function sim(zones: Zone[], opts: { noRespawn?: boolean; elites?: boolean } = {}) {
    const timers: { ms: number; fn: () => void }[] = [];
    const p = { playerId: 7n, posX: 1, posY: 1, disconnected: false, isDead: false, status: { isInvisible: false }, combat: statsFromChar({ lvl: 10, cls: 'guerrero', eq: {} }), pvp: new PvpLimiter(), send: () => {} } as unknown as Player;
    const grid = (v: boolean) => Array.from({ length: N }, () => new Array<boolean>(N).fill(v));
    const map = { size: N, tiles: [], blocked: grid(false), safe: grid(false), props: [], decals: [], zones, buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => [p], playerById: (id) => (id === p.playerId ? p : undefined), nearby: () => [p],
        after: (ms, fn) => { timers.push({ ms, fn }); }, hurt: () => {}, stun: () => 0, pay: () => true, heal: () => {}, reward: () => {},
    };
    return { s: new MobSim(map, host, opts), timers, p };
}
const zone = (type: MobType, n: number, extra: Partial<Zone> = {}): Zone => ({ type, x: 20, y: 20, r: 6, n, name: 'prueba', lvl: 5, tier: 'dungeon', ...extra });

test('élites: el primero de cada zona par de una mazmorra, nunca mutante; ×3 de vida; fuera de las mazmorras no hay', () => {
    assert.equal(isEliteSlot(0, 0, 3), true); assert.equal(isEliteSlot(0, 1, 3), false); assert.equal(isEliteSlot(1, 0, 3), false); assert.equal(isEliteSlot(2, 0, 1), false, 'una zona de 1 no tiene élite');
    const { s } = sim([zone('skeleton', 3), zone('skeleton', 3), zone('skeleton', 3), zone('goblin_jefe', 1, { tier: undefined })], { elites: true });
    const ds = s.detail(), elites = ds.filter((m) => m.traits & TRAIT_ELITE);
    assert.deepEqual(elites.map((m) => m.zoneIdx).sort(), [0, 2], 'un élite en la zona 0 y otro en la 2');
    for (const e of elites) {
        assert.equal(e.traits & TRAIT_MUTANT, 0);
        assert.equal(e.hpMax, Math.round(mobDef('skeleton', { lvl: 5, tier: 'dungeon' }).hp * ELITE_HP_MULT));
    }
    assert.ok(!ds.some((m) => m.boss && m.traits), 'el jefe no tiene rasgos');
    assert.match(traitLabel(TRAIT_ELITE), /Élite/);
    const fuera = sim([zone('skeleton', 3), zone('skeleton', 3)]); // sin la opción (mapa compartido): ninguno
    assert.equal(fuera.s.detail().filter((m) => m.traits & TRAIT_ELITE).length, 0);
});

test('en una corrida lo muerto queda muerto (jefe incluido); afuera reaparece', () => {
    for (const noRespawn of [true, false]) {
        const { s, timers, p } = sim([zone('skeleton', 2), zone('goblin_jefe', 1, { tier: undefined })], { noRespawn });
        for (const m of s.detail()) s.skillHit(p, m.id, 999_999);
        assert.equal(s.count, 0);
        for (const t of timers.splice(0)) t.fn();
        assert.equal(s.count, noRespawn ? 0 : 3, noRespawn ? 'nada renace' : 'afuera renacen los 3');
    }
});

test('escalado por party: solo ×0,5, trío ×1, cinco ×1,5 de vida; solo reescala a los que no pelearon', () => {
    assert.deepEqual(dungeonPartyScale(1), { hp: 0.5, dmg: 0.85 });
    assert.deepEqual(dungeonPartyScale(3), { hp: 1, dmg: 1 });
    assert.deepEqual(dungeonPartyScale(9), dungeonPartyScale(5), 'tope de 5');
    // dos zonas lejos (el aggro solo se contagia dentro de la zona) y de merodeadores (sin mutantes al azar): la vida base queda fija
    const { s, p } = sim([zone('skeleton', 1, { name: 'Merodeadores A', x: 6, r: 1 }), zone('skeleton', 1, { name: 'Merodeadores B', x: 34, r: 1 })]);
    const base = mobDef('skeleton', { lvl: 5, tier: 'dungeon' }).hp, [a, b] = s.detail();
    s.skillHit(p, a.id, 10); // este ya peleó: no se toca
    s.setPartyScale(1);
    const after = new Map(s.detail().map((m) => [m.id, m]));
    assert.equal(after.get(b.id)!.hpMax, Math.round(base * 0.5));
    assert.equal(after.get(b.id)!.hp, after.get(b.id)!.hpMax, 'nace con la vida llena');
    assert.equal(after.get(a.id)!.hpMax, base);
    s.setPartyScale(5); // se puede volver a escalar (otro piso de la misma corrida, por ejemplo)
    assert.equal(s.detail().find((m) => m.id === b.id)!.hpMax, Math.round(base * 1.5));
});

// ---------- corridas en el registro ----------
const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const save = () => {};
function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco, instanceTtlMs: 1000 });
    const caza = reg.ensure('prueba_caza');
    const join = (name: string, at: { x: number; y: number }) => {
        const log: ServerMessage[] = [], session: TransferSession = { sessionId: `s-${name}`, worldId: caza.id };
        const persisted = { mapId: caza.mapId, worldId: caza.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true } as PersistedPlayer;
        caza.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        caza.bindAccount(session.sessionId, `acc-${name}`);
        caza.onClientSave(session.sessionId, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
        const p = caza.playerOf(session.sessionId)!; p.prog.lvl = 5;
        return { name, session, log };
    };
    const A = join('ana', { x: 57, y: 6 }), B = join('beto', { x: 55, y: 8 }), all = [A, B];
    const svc = new PartyService({
        sessionByName: (n) => all.find((j) => j.name === n.toLowerCase())?.session.sessionId, send: () => {},
        info: (sid) => ({ name: all.find((j) => j.session.sessionId === sid)!.name, faction: 'solmar', level: 5, hp: 100, maxHp: 100, mp: 0, maxMp: 0, map: 'prueba_caza', online: true }),
    });
    setParties(svc);
    reg.sessionHook = (sid) => { const j = all.find((x) => x.session.sessionId === sid); return j && { session: j.session, save }; };
    svc.handle(A.session.sessionId, 'invite', 'beto'); svc.handle(B.session.sessionId, 'accept', '');
    const arrive = (j: typeof A) => reg.completeTransfer(j.session.sessionId, j.session.worldId.split('#')[0], reg.hashOf(j.session.worldId.split('#')[0]));
    const world = (j: typeof A): GameWorld => reg.get(j.session.worldId)!;
    const me = (j: typeof A) => world(j).playerOf(j.session.sessionId)!;
    const die = (j: typeof A) => { const p = me(j); p.hp = 0; p.deadAt = Date.now() - 5000; world(j).handleClientPacket(j.session.sessionId, { payload: { $case: 'respawnRequest', value: {} } } as never); };
    const enter = (j: typeof A) => { const p = me(j); p.setPosition(57, 6); return reg.handlePortal(j.session, 'caza_a_mazmorra', save); };
    const leave = (j: typeof A) => { me(j).setPosition(PRUEBA_MAZMORRA.exit.x, PRUEBA_MAZMORRA.exit.y); reg.handlePortal(j.session, 'mazmorra_a_caza', save); arrive(j); };
    return { reg, A, B, arrive, world, me, die, enter, leave };
}
const msgs = (log: ServerMessage[]) => log.filter((m) => m.payload?.$case === 'sendMessage').map((m) => (m.payload as { value: { message?: string; text?: string } }).value);

test('corrida: la party entra junta, se escala con los dos y lo muerto no renace', () => {
    const { reg, A, B, arrive, world } = setup();
    try {
        assert.equal(reg.handlePortal(A.session, 'caza_a_mazmorra', save), null);
        assert.equal(B.session.worldId, A.session.worldId); arrive(A); arrive(B);
        const iid = A.session.worldId.split('#')[1], w = world(A);
        assert.equal(reg.runOf(iid)?.size, 2);
        assert.ok(w.isDungeonRun);
        assert.deepEqual(w.mobs!.partyScale, dungeonPartyScale(2), 'mobs escalados a dúo');
        const n0 = w.mobs!.count, p = w.playerOf(A.session.sessionId)!, first = w.mobs!.detail()[0];
        w.mobs!.skillHit(p, first.id, 999_999);
        assert.equal(w.mobs!.count, n0 - 1);
        reg.sweep(Date.now()); reg.sweep(Date.now() + 120_000); // con gente adentro no se da de baja ni hiberna
        assert.equal(world(A), w); assert.equal(w.isHibernated, false); assert.equal(w.mobs!.count, n0 - 1);
    } finally { setParties(undefined); }
});

test('una vida por corrida: el que cae vuelve a la superficie y no puede volver mientras la party siga adentro', () => {
    const { reg, A, B, arrive, die, enter, leave, world } = setup();
    try {
        reg.handlePortal(A.session, 'caza_a_mazmorra', save); arrive(A); arrive(B);
        const key = A.session.worldId, iid = key.split('#')[1];
        die(A); arrive(A);
        assert.equal(A.session.worldId, 'prueba_caza', 'cae y sale a la superficie');
        assert.ok(msgs(A.log).some((m) => /corrida terminó/.test(JSON.stringify(m))));
        assert.deepEqual(reg.runOf(iid)?.dead, ['ana']);
        A.log.length = 0;
        const why = enter(A);
        assert.match(why ?? '', /Caíste en esta corrida/);
        assert.equal(A.session.worldId, 'prueba_caza', 'no entra');
        // Beto sale: la corrida queda vacía; la próxima entrada es una corrida nueva, con todo vivo, y Ana puede entrar
        const n0 = world(B).mobs!.count;
        leave(B);
        assert.equal(reg.runLive(iid), false);
        assert.equal(enter(A), null); arrive(A); arrive(B);
        assert.notEqual(A.session.worldId, key, 'corrida nueva');
        assert.equal(B.session.worldId, A.session.worldId, 'la party entra junta a la nueva');
        assert.ok(world(A).mobs!.count >= n0);
    } finally { setParties(undefined); }
});

test('una corrida vacía (todos sus pisos) se da de baja; con alguien en otro piso, no', () => {
    const { reg, A, B, arrive, leave } = setup();
    try {
        reg.handlePortal(A.session, 'caza_a_mazmorra', save); arrive(A); arrive(B);
        const key = A.session.worldId, iid = key.split('#')[1];
        // otro "piso" de la misma corrida con Beto adentro: el de Ana no se da de baja aunque quede vacío
        const piso2 = reg.ensure('prueba_mazmorra', iid);
        assert.equal(piso2.id, key, 'en la mazmorra de prueba hay un solo piso: se reusa el mismo mundo');
        leave(A);
        const t = Date.now(); reg.sweep(t); reg.sweep(t + 5000);
        assert.ok(reg.get(key), 'Beto sigue adentro');
        leave(B);
        reg.sweep(t + 6000); reg.sweep(t + 8000);
        assert.equal(reg.get(key), undefined, 'vacía: se da de baja');
        assert.equal(reg.runOf(iid), undefined);
    } finally { setParties(undefined); }
});

test('densidad de D1 y D2: ~25 y ~40 mobs, con el jefe intacto y élites repartidos', () => {
    const count = (ids: string[]) => ids.reduce((a, id) => a + getMapDef(id)!.build().zones.reduce((s, z) => s + z.n, 0), 0);
    assert.equal(count(['cueva_goblin', 'minas_goblin']), 25);
    assert.equal(count(['nido_hormiga_leon', 'ruinas_de_stormrock']), 40);
    assert.ok(getMapDef('minas_goblin')!.build().zones.some((z) => z.type === 'goblin_jefe' && z.n === 1));
    assert.ok(getMapDef('ruinas_de_stormrock')!.build().zones.some((z) => z.type === 'antlion_reina' && z.n === 1));
    const elites = getMapDef('cueva_goblin')!.build().zones.filter((z, i) => z.tier === 'dungeon' && isEliteSlot(i, 0, z.n)).length;
    assert.equal(elites, 4, 'un élite cada dos packs');
});

test('checklist de instancia: en una corrida el mob con aggro no pierde al invisible; afuera sí', () => {
    for (const noRespawn of [true, false]) {
        const { s, p } = sim([zone('skeleton', 1, { name: 'Merodeadores' })], { noRespawn });
        const m = s.detail()[0];
        s.skillHit(p, m.id, 1);
        (p.status as { isInvisible: boolean }).isInvisible = true;
        const raw = (s as unknown as { mobs: Map<number, unknown>; canFight(m: unknown, p: unknown): boolean });
        assert.equal(raw.canFight(raw.mobs.get(m.id), p), noRespawn);
        assert.equal(s.inCombat(), true);
    }
});

test('checklist de instancia: no se entra a una corrida mientras los de adentro pelean', () => {
    const { reg, A, B, arrive, world, enter } = setup();
    try {
        reg.get('prueba_caza')!.playerOf(B.session.sessionId)!.setPosition(10, 10); // lejos de la puerta: no entra con Ana
        assert.equal(reg.handlePortal(A.session, 'caza_a_mazmorra', save), null); arrive(A);
        assert.equal(B.session.worldId, 'prueba_caza');
        const w = world(A), m = w.mobs!.detail()[0];
        w.mobs!.skillHit(w.playerOf(A.session.sessionId)!, m.id, 1);
        assert.match(enter(B) ?? '', /peleando/);
        assert.equal(B.session.worldId, 'prueba_caza');
    } finally { setParties(undefined); }
});

test('densidad de D3 a D7: 49, 49, 55, 55 y 58 mobs (D7 la más cargada), con el jefe intacto', () => {
    const count = (ids: string[]) => ids.reduce((a, id) => a + getMapDef(id)!.build().zones.reduce((s, z) => s + z.n, 0), 0);
    assert.equal(count(['cripta_olvidada', 'sepulcro_profundo']), 49);
    assert.equal(count(['torre_del_hechicero', 'camaras_de_investigacion']), 49);
    assert.equal(count(['templo_de_mez', 'salon_de_mez']), 55);
    assert.equal(count(['fortaleza_infernal', 'foso_del_demonio']), 55);
    assert.equal(count(['fuerte_amir', 'camaras_de_tortura']), 58);
    for (const [map, boss] of [['sepulcro_profundo', 'caballero_cripta'], ['camaras_de_investigacion', 'mago_mayor'], ['salon_de_mez', 'wyvern_aire'], ['foso_del_demonio', 'demonio_foso'], ['camaras_de_tortura', 'verdugo']]) assert.ok(getMapDef(map)!.build().zones.some((z) => z.type === boss && z.n === 1), boss);
});
