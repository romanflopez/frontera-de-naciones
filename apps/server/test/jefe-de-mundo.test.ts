/** Jefe de mundo del MVP (docs/JEFE_DE_MUNDO.md): uno por día, a hora y mapa del T4 al azar, botín para todos los que pelearon. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MOBS, WORLD_BOSS } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { Player } from '../src/player.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import type { GameWorld } from '../src/world.ts';
import { WorldBossService, artDay, worldBossMaps } from '../src/worldBoss.ts';

class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const H = 3_600_000;
/** 3/11/2026 00:00 de Argentina (03:00 UTC). */
const DAY0 = Date.UTC(2026, 10, 3, 3);

function setup() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings: loadSettings(), economy: eco });
    const said: string[] = [];
    let r = 0.5;
    const svc = new WorldBossService({ ensure: (id) => reg.ensure(id), get: (id) => reg.get(id), announce: (t) => said.push(t), rnd: () => r });
    const mk = (w: GameWorld, name: string) => {
        const sid = `s-${name}`, sp = MAPS[w.mapId].spawn;
        w.playerConnected(sid, name, () => {}, () => {}, { mapId: w.mapId, worldId: w.mapId, x: sp.x, y: sp.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true });
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 }); w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls: 'guerrero', faction: 'solmar' }));
        const p = w.playerOf(sid)!; p.econ!.lvl = 20; return p;
    };
    return { reg, svc, said, mk, setRnd: (v: number) => { r = v; } };
}

test('mapas: los abiertos de nivel 16-20, ninguna mazmorra; el jefe es de nivel 20 con su motor', () => {
    const maps = worldBossMaps();
    assert.ok(maps.length >= 2, 'al menos dos mapas para que sea errante');
    for (const id of maps) { assert.equal(MAPS[id].tier, 2); assert.ok(MAPS[id].lvl![0] >= 16 && MAPS[id].lvl![1] <= 20); assert.ok(!MAPS[id].temporary); }
    assert.equal(MOBS[WORLD_BOSS.type].lvl, 20); assert.ok(MOBS[WORLD_BOSS.type].boss);
});

test('una vez por día, a una hora al azar dentro de la ventana; al día siguiente se sortea otra', () => {
    const { svc, said, setRnd } = setup();
    setRnd(0.5);
    svc.tick(DAY0 + 1 * H); // 01:00 de Argentina: se sortea la hora del día
    const exp = DAY0 + (WORLD_BOSS.fromHour + 0.5 * (WORLD_BOSS.toHour - WORLD_BOSS.fromHour)) * H;
    assert.equal(svc.at, exp, 'a mitad de la ventana con rnd = 0,5');
    assert.equal(svc.state, 'waiting');
    svc.tick(exp - 60_000); assert.equal(said.length, 0, 'antes de la hora no sale');
    svc.tick(exp); assert.equal(svc.state, 'alive'); assert.match(said[0], /despertó en/);
    assert.ok(worldBossMaps().includes(svc.mapId));
    setRnd(0.1); svc.tick(DAY0 + 24 * H + 1 * H); // al otro día, con el jefe todavía vivo de ayer no se pisa
    assert.equal(artDay(DAY0 + 25 * H), artDay(DAY0) + 1);
    svc.tick(exp + WORLD_BOSS.lifeMin * 60_000); // se le terminó el tiempo
    assert.equal(svc.state, 'done'); assert.match(said.at(-1)!, /se hundió/);
    assert.ok(said.some((t) => /10 minutos/.test(t)), 'avisó cuando le quedaban 10 minutos');
    const n = said.length; svc.tick(exp + WORLD_BOSS.lifeMin * 60_000 + H); assert.equal(said.length, n, 'el mismo día no vuelve a salir');
    svc.tick(DAY0 + 24 * H + 1 * H); assert.equal(svc.state, 'waiting'); assert.equal(svc.at, DAY0 + 24 * H + (WORLD_BOSS.fromHour + 0.1 * (WORLD_BOSS.toHour - WORLD_BOSS.fromHour)) * H);
});

test('si el server arranca con la ventana empezada, sale entre ahora y el cierre; si ya cerró, hoy no sale', () => {
    const { svc, setRnd } = setup();
    setRnd(0); svc.tick(DAY0 + 15 * H); assert.equal(svc.at, DAY0 + 15 * H, 'desde ahora');
    const b = setup(); b.svc.tick(DAY0 + 23.5 * H); assert.equal(b.svc.at, Infinity);
});

test('el botín es para todos los que pelearon, de cualquier party; el que miró no cobra; se anuncia la muerte', () => {
    const { reg, svc, said, mk } = setup();
    const id = worldBossMaps()[0], w = reg.ensure(id);
    const A = mk(w, 'ana'), B = mk(w, 'beto'), C = mk(w, 'caro');
    svc.spawn(Date.now(), id);
    const sim = w.mobs!, boss = sim.worldBoss()!; assert.ok(boss);
    for (const p of [A, B, C]) p.setPosition(Math.floor(boss.x) + 1, Math.floor(boss.y));
    const exp0 = [A, B, C].map((p) => p.econ!.exp), bag0 = [A, B, C].map((p) => p.econ!.bag.length);
    sim.skillHit(B as Player, boss.id, 100); // B pega un poco
    sim.skillHit(A as Player, boss.id, 9_999_999); // A lo termina
    assert.equal(sim.worldBoss(), undefined, 'murió');
    assert.ok(A.econ!.exp > exp0[0] || A.econ!.lvl > 20, 'el del golpe final cobra');
    assert.ok(B.econ!.exp > exp0[1] || B.econ!.lvl > 20, 'el que pegó, de otra party, también cobra');
    assert.equal(B.econ!.bag.length, bag0[1] + 1, 'con su propio ítem');
    assert.equal(C.econ!.exp, exp0[2], 'el que solo miró no'); assert.equal(C.econ!.bag.length, bag0[2]);
    assert.match(said.at(-1)!, /ana y 1 más derribaron/);
    assert.equal(svc.state, 'done');
});

test('un mapa vacío con el jefe vivo no hiberna (si no, se borraría)', () => {
    const { reg, svc } = setup();
    const id = worldBossMaps()[1] ?? worldBossMaps()[0];
    svc.spawn(Date.now(), id);
    const w = reg.get(id)!; assert.ok(w.hasWorldBoss);
    const t = Date.now(); reg.sweep(t); reg.sweep(t + 24 * H);
    assert.equal(w.isHibernated, false); assert.ok(w.hasWorldBoss);
    svc.tick(svc.until); assert.equal(w.hasWorldBoss, false, 'al irse se saca');
});
