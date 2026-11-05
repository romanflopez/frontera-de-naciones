/**
 * D.5: el PvP es un atributo de región (puesto seguro / zona abierta / zona roja), no de mapa. `isEnemyPair` mira la región de LOS DOS jugadores,
 * calculada con la posición que tiene el server (un paquete que miente la región no cambia nada).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { MAPS, buildMap, inMapRect, pvpRegionAt, type MapRect } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { statsFromChar } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage { private m = new Map<string, AccountRecord>(); get(k: string) { return this.m.get(k); } put(k: string, r: AccountRecord) { this.m.set(k, r); } flush() {} }
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
let off = 0;
const realNow = Date.now;
mock.method(Date, 'now', () => realNow() + off);

const MAP_ID = 'cenizas_i', DEF = MAPS[MAP_ID];
/** Dos celdas caminables pegadas (para pegar cuerpo a cuerpo) dentro de la región pedida. */
function pairIn(region: 'roja' | 'abierta'): [{ x: number; y: number }, { x: number; y: number }] {
    const m = buildMap(MAP_ID);
    for (let y = 2; y < m.size - 2; y++) for (let x = 2; x < m.size - 3; x++) {
        const ok = (cx: number) => !m.blocked[y][cx] && !m.safe[y]?.[cx] && pvpRegionAt(DEF, false, cx, y) === region;
        if (ok(x) && ok(x + 1) && ok(x + 2)) return [{ x, y }, { x: x + 1, y }];
    }
    throw new Error(`sin celdas en región ${region}`);
}

function setup(posA: { x: number; y: number }, posB: { x: number; y: number }, factionB = 'vhar') {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure(MAP_ID);
    (w as unknown as { mobSim?: unknown }).mobSim = undefined;
    const join = (name: string, at: { x: number; y: number }, faction: string, cls: string) => {
        const log: ServerMessage[] = [], sid = `s-${name}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls, faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};${cls};` });
        const p = w.playerOf(sid)!;
        p.combat = statsFromChar({ lvl: 70, cls, eq: {} });
        p.spawnProtection = false; p.mp = p.combat.maxMp; p.hp = p.combat.maxHp;
        return { sid, log, p };
    };
    off += 1_000_000;
    const A = join(`a${off}`, posA, 'solmar', 'paladin'), B = join(`b${off}`, posB, factionB, 'paladin');
    const enemies = () => (w as unknown as { isEnemyPair(a: unknown, b: unknown): boolean }).isEnemyPair(A.p, B.p);
    // `x, y, dmg` del paquete son del cliente y no cuentan: el server usa su propia posición y su propio daño
    const hit = (lieX = B.p.posX, lieY = B.p.posY) => pkt(w, A.sid, 'pvpHitRequest', { fx: '', x: lieX, y: lieY, targetId: B.p.playerId, dmg: 99999, secs: 0, r: 0, spell: 'ataque' });
    return { w, A, B, enemies, hit };
}

test('A: pvpRegionAt: zona roja solo dentro de los rectángulos; fuera, zona abierta; el puesto seguro manda; mapas sin rectángulos son todo rojo', () => {
    const r: MapRect = { x0: 10, y0: 10, x1: 20, y1: 20 };
    const def = { pvp: 'faction' as const, safe: false, redRects: [r] };
    assert.equal(pvpRegionAt(def, false, 15, 15), 'roja'); assert.equal(pvpRegionAt(def, false, 15.9, 20.4), 'roja', 'decimales: cuenta la celda');
    assert.equal(pvpRegionAt(def, false, 9, 15), 'abierta'); assert.equal(pvpRegionAt(def, false, 15, 21), 'abierta');
    assert.equal(pvpRegionAt(def, true, 15, 15), 'seguro', 'el puesto seguro gana sobre la zona roja');
    assert.equal(pvpRegionAt({ pvp: 'faction', safe: false }, false, 3, 3), 'roja', 'sin rectángulos: todo rojo (81+)');
    assert.equal(pvpRegionAt({ pvp: 'off', safe: false }, false, 15, 15), 'abierta');
    assert.equal(pvpRegionAt({ pvp: 'ffa', safe: false }, false, 15, 15), 'roja');
    assert.equal(pvpRegionAt({ pvp: 'off', safe: true }, false, 15, 15), 'seguro');
    assert.equal(pvpRegionAt(undefined, false, 1, 1), 'roja');
});

test('A: los mapas 1-60 no tienen zona roja y los del tramo 61-83 tienen una parte', () => {
    for (const [id, d] of Object.entries(MAPS)) {
        if (d.tier && d.tier <= 6) assert.equal(d.pvp, 'off', `${id}: sin PvP hasta el 60`);
    }
    for (const id of ['paso_de_stormrock', 'cenizas_i', 'cenizas_ii']) assert.ok(MAPS[id].redRects?.length, id);
    assert.equal(MAPS.cenizas_iii.redRects, undefined, '81+: todo rojo salvo el puesto');
    assert.ok(!MAPS[MAP_ID].redRects!.some((rr) => inMapRect(rr, MAPS[MAP_ID].spawn.x, MAPS[MAP_ID].spawn.y)), 'la entrada es zona abierta');
});

test('B: dos jugadores de distinta nación en zona roja se pueden pegar', () => {
    const [a, b] = pairIn('roja'), { B, enemies, hit } = setup(a, b);
    assert.equal(enemies(), true);
    const hp = B.p.hp; hit();
    assert.ok(B.p.hp < hp, 'le pega');
});

test('B: cruce de región: afuera de la zona roja no se pueden pegar, aunque uno esté adentro', () => {
    const [r1] = pairIn('roja'), [o1, o2] = pairIn('abierta');
    // los dos en zona abierta
    let s = setup(o1, o2); assert.equal(s.enemies(), false); let hp = s.B.p.hp; s.hit(); assert.equal(s.B.p.hp, hp, 'zona abierta: sin PvP');
    // uno en roja y el otro en abierta (en las dos direcciones)
    s = setup(r1, o1); assert.equal(s.enemies(), false); assert.equal(s.w.playerOf(s.B.sid)!.posX, o1.x);
    s = setup(o1, r1); assert.equal(s.enemies(), false);
});

test('B: el cruce se nota al caminar: al entrar a la zona roja los dos pasan a ser enemigos y al salir dejan de serlo', () => {
    const [red1, red2] = pairIn('roja'), [o1] = pairIn('abierta');
    const { w, B, enemies } = setup(red1, red2);
    assert.equal(enemies(), true);
    // el server mueve a B a la zona abierta (teletransporte de servidor, como un recall o una salida)
    (w as unknown as { moveTo(p: unknown, fx: number, fy: number, tx: number, ty: number, d: boolean, t: boolean): void }).moveTo(B.p, B.p.posX, B.p.posY, o1.x, o1.y, false, true);
    assert.equal(enemies(), false, 'B salió de la zona roja');
    (w as unknown as { moveTo(p: unknown, fx: number, fy: number, tx: number, ty: number, d: boolean, t: boolean): void }).moveTo(B.p, B.p.posX, B.p.posY, red2.x, red2.y, false, true);
    assert.equal(enemies(), true, 'B volvió');
});

test('B: misma nación nunca es enemiga, ni en zona roja', () => {
    const [a, b] = pairIn('roja'), { enemies } = setup(a, b, 'solmar');
    assert.equal(enemies(), false);
});

test('H: un paquete que miente la región (x, y de otra celda, daño inventado) no le pega a alguien en zona abierta', () => {
    const [red] = pairIn('roja'), [o1, o2] = pairIn('abierta');
    const { A, B, hit } = setup(o1, o2), hp = B.p.hp;
    hit(red.x, red.y); // dice que el blanco está en la zona roja
    hit(red.x + 0.5, red.y + 0.5);
    assert.equal(B.p.hp, hp, 'el server usa la posición que tiene de B (zona abierta)');
    assert.equal(A.p.hp, A.p.combat.maxHp);
});

test('H: el cliente no manda región: el pedido no tiene ese campo y la decisión no cambia por ningún campo del paquete', () => {
    const [o1, o2] = pairIn('abierta'), { B, hit, w, A } = setup(o1, o2), hp = B.p.hp;
    pkt(w, A.sid, 'pvpHitRequest', { fx: 'zona_roja', x: 0, y: 0, targetId: B.p.playerId, dmg: 5, secs: 3, r: 99, spell: 'ataque', region: 'roja', red: true });
    hit();
    assert.equal(B.p.hp, hp);
    assert.equal(B.p.isParalyzed(Date.now()), false, 'tampoco paraliza');
});
