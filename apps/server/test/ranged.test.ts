/** Mobs a distancia (docs/MOBS_A_DISTANCIA.md): alcance, cadencia, línea de tiro, esquiva, defensa, aggro y leash. MobSim con host y reloj falsos. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { MOBS, MOB_TYPES, mobDef, type MobType, type WorldMap, type Zone } from '@fdn/world';
import { MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';

const N = 40;
let clock = 1_000_000;
mock.method(Date, 'now', () => clock);
const tick = (ms: number, sim: MobSim, steps = 1) => { for (let i = 0; i < steps; i++) { clock += ms; sim.update(); } };

function fakePlayer(x: number, y: number) {
    const sent: ServerMessage[] = [];
    const p = { playerId: 7n, posX: x, posY: y, disconnected: false, isDead: false, status: { isInvisible: false }, send: (m: ServerMessage) => sent.push(m) } as unknown as Player;
    return { p, sent };
}
function mapWith(type: MobType, wall?: { x: number; y0: number; y1: number }, zone: Partial<Zone> = {}): WorldMap {
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    if (wall) for (let y = wall.y0; y <= wall.y1; y++) blocked[y][wall.x] = true;
    const safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    return { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type, x: 10, y: 20, r: 0, n: 1, name: 'prueba', ...zone }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
}
function setup(type: MobType, player: { x: number; y: number }, wall?: { x: number; y0: number; y1: number }, zone: Partial<Zone> = {}) {
    clock += 100_000;
    const { p, sent } = fakePlayer(player.x, player.y), timers: { at: number; fn: () => void }[] = [], hurts: { raw: number; source: string }[] = [];
    const host: MobHost = {
        players: () => [p], playerById: (id) => (id === p.playerId ? p : undefined), nearby: () => [p],
        after: (ms, fn) => { timers.push({ at: clock + ms, fn }); },
        hurt: (_p, raw, source) => { hurts.push({ raw, source }); }, stun: () => 0, reward: () => {},
    };
    const sim = new MobSim(mapWith(type, wall, zone), host);
    const fire = () => { for (const t of timers.filter((x) => x.at <= clock)) { timers.splice(timers.indexOf(t), 1); t.fn(); } };
    const projectiles = () => sent.filter((m) => m.payload?.$case === 'mobProjectile').map((m) => (m.payload as { value: { mobId: number; fromX: number; fromY: number; toX: number; toY: number; travelMs: number; kind: number } }).value);
    return { sim, p, sent, hurts, fire, projectiles, mob: () => sim.list()[0] };
}

test('los arqueros tienen definición a distancia y los demás no', () => {
    for (const t of ['hobgoblin_archer', 'skeleton_archer'] as const) { const r = MOBS[t].ranged!; assert.ok(r.range > 4 && r.keep < r.range && r.speed > 0, t); assert.ok(mobDef(t, { lvl: 6 }).ranged, `${t}: reescalado conserva ranged`); }
    for (const t of MOB_TYPES) if (t !== 'hobgoblin_archer' && t !== 'skeleton_archer') assert.equal(MOBS[t].ranged, undefined, t);
});

test('dispara desde lejos (a rango, sin acercarse a cuerpo a cuerpo) y el daño llega con el proyectil', () => {
    const { sim, hurts, fire, projectiles, mob } = setup('skeleton_archer', { x: 16, y: 20 }, undefined, { aggro: 8 });
    tick(100, sim, 3);
    const pr = projectiles();
    assert.ok(pr.length >= 1, 'tiene que disparar');
    assert.equal(pr[0].kind, 0);
    assert.ok(Math.hypot(pr[0].toX - pr[0].fromX, pr[0].toY - pr[0].fromY) > 3, 'dispara de lejos');
    assert.ok(Math.hypot(mob().x - 16.5, mob().y - 20.5) > 3, 'se queda a distancia');
    assert.equal(hurts.length, 0, 'todavía no llegó el proyectil');
    clock += pr[0].travelMs + 10; fire();
    assert.equal(hurts.length, 1);
    assert.ok(hurts[0].raw >= MOBS.skeleton_archer.dmg[0] && hurts[0].raw <= MOBS.skeleton_archer.dmg[1]);
    assert.equal(hurts[0].source, 'Esqueleto arquero');
});

test('respeta la cadencia: un disparo cada `atk` segundos', () => {
    const { sim, projectiles } = setup('hobgoblin_archer', { x: 15, y: 20 }, undefined, { aggro: 8 });
    tick(100, sim, 40); // 4 s
    const n = projectiles().length, atk = MOBS.hobgoblin_archer.atk;
    assert.ok(n >= 2 && n <= Math.ceil(4 / atk) + 1, `${n} disparos en 4 s con atk ${atk}`);
});

test('no dispara si la línea de tiro está bloqueada por una pared', () => {
    const wall = { x: 13, y0: 0, y1: N - 1 };
    const { sim, projectiles, hurts, fire } = setup('hobgoblin_archer', { x: 16, y: 20 }, wall, { aggro: 8 });
    tick(100, sim, 30); clock += 2000; fire();
    assert.equal(projectiles().length, 0);
    assert.equal(hurts.length, 0);
    const m = sim.list()[0]; assert.ok(m.x < 13, 'no atraviesa la pared');
    assert.equal(sim.clearShot(10.5, 20.5, 16.5, 20.5), false);
    assert.equal(sim.clearShot(10.5, 20.5, 12.5, 20.5), true);
});

test('el proyectil se esquiva: si el jugador ya no está donde se apuntó, no pega', () => {
    const { sim, p, hurts, fire, projectiles } = setup('skeleton_archer', { x: 16, y: 20 }, undefined, { aggro: 8 });
    tick(100, sim, 3);
    const pr = projectiles()[0]; assert.ok(pr);
    (p as unknown as { posX: number }).posX = 19; // se corre 3 celdas
    clock += pr.travelMs + 10; fire();
    assert.equal(hurts.length, 0);
});

test('retrocede si el jugador lo pisa (cuida su distancia)', () => {
    const { sim, mob } = setup('hobgoblin_archer', { x: 11, y: 20 }, undefined, { aggro: 8 });
    const before = Math.hypot(mob().x - 11.5, mob().y - 20.5);
    tick(100, sim, 15);
    assert.ok(Math.hypot(mob().x - 11.5, mob().y - 20.5) > before, 'se aleja del jugador');
});

test('aggro y leash: no dispara a quien está lejos del aggro y vuelve a casa si el jugador se va de la correa', () => {
    const far = setup('skeleton_archer', { x: 30, y: 20 }, undefined, { aggro: 4 });
    tick(100, far.sim, 20); assert.equal(far.projectiles().length, 0, 'fuera del aggro no dispara');
    const { sim, p, mob } = setup('skeleton_archer', { x: 16, y: 20 }, undefined, { aggro: 8 });
    tick(100, sim, 5);
    (p as unknown as { posX: number }).posX = 38; // más lejos que la correa (17 celdas al centro de la zona)
    let maxD = 0;
    for (let i = 0; i < 600; i++) { tick(100, sim); maxD = Math.max(maxD, Math.hypot(mob().x - 10.5, mob().y - 20.5)); }
    assert.ok(maxD <= 18, `no pasa la correa (llegó a ${maxD.toFixed(1)})`);
    assert.ok(Math.hypot(mob().x - 10.5, mob().y - 20.5) <= 2, 'volvió a su zona');
});

test('un jugador en zona segura no es objetivo', () => {
    const { sim, p, projectiles, mob } = setup('hobgoblin_archer', { x: 16, y: 20 }, undefined, { aggro: 8 });
    void mob;
    const map = (sim as unknown as { map: WorldMap }).map;
    map.safe[20][16] = true; void p;
    tick(100, sim, 30);
    assert.equal(projectiles().length, 0);
});
