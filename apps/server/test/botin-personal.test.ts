/**
 * Botín personal por participante (docs/ITEMS.md y claude/modelo-de-items-y-stats.md §3.2): los élites y jefes
 * pasan la lista de todos los que les generaron amenaza, para que cada uno reciba su propia tirada; los mobs
 * comunes no (solo cobra el que mata, con su party).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { TRAIT_ELITE, type MobType, type WorldMap } from '@fdn/world';
import { MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';
import { PvpLimiter, statsFromChar } from '../src/systems/pvpCombat.ts';

const N = 40;
let clock = 90_000_000;
mock.method(Date, 'now', () => clock);

type Raw = { hp: number; hpMax: number; traits: number; id: number; threat: Map<bigint, number> };
type RewardInfo = { participants?: bigint[]; type: MobType };

function setup(type: MobType, traits = 0) {
    clock += 100_000;
    const mkPlayer = (id: bigint, x: number, y: number): Player =>
        ({ playerId: id, posX: x, posY: y, disconnected: false, isDead: false, status: { isInvisible: false }, combat: statsFromChar({ lvl: 12, cls: 'pala', eq: {} }), pvp: new PvpLimiter(), send: (_m: ServerMessage) => {} }) as unknown as Player;
    const p1 = mkPlayer(7n, 14, 20), p2 = mkPlayer(8n, 15, 20);
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type, x: 14, y: 20, r: 0, n: 1, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const rewards: { who: bigint; info: RewardInfo }[] = [];
    const host: MobHost = {
        players: () => [p1, p2], playerById: (id) => (id === p1.playerId ? p1 : id === p2.playerId ? p2 : undefined), nearby: () => [p1, p2],
        after: () => {}, hurt: () => {}, stun: () => 0, pay: () => true, heal: () => {},
        reward: (who, info) => { rewards.push({ who: who.playerId, info: info as RewardInfo }); },
    };
    const sim = new MobSim(map, host);
    const m = [...(sim as unknown as { mobs: Map<number, Raw> }).mobs.values()][0];
    m.traits = traits; m.hp = m.hpMax = 1000;
    const hit = (p: Player) => sim.hit(p, { mobId: m.id, dmg: 0, melee: true, crit: false, parSecs: 0, poisonSecs: 0, spell: 'ataque' } as never);
    return { sim, p1, p2, m, hit, rewards };
}

test('élite: al morir pasa a todos los que le pegaron como participantes (botín personal)', () => {
    const { p1, p2, m, hit, rewards } = setup('goblin', TRAIT_ELITE);
    hit(p2); // p2 participa
    clock += 1000;
    m.hp = 1; hit(p1); // p1 lo remata
    assert.equal(rewards.length, 1, 'MobSim avisa una sola vez; el reparto lo hace el mundo');
    assert.equal(rewards[0].who, p1.playerId);
    const ids = rewards[0].info.participants ?? [];
    assert.ok(ids.includes(p1.playerId) && ids.includes(p2.playerId), `participantes: ${ids}`);
    assert.equal(m.hp <= 0, true);
});

test('jefe: también pasa participantes; un mob común no', () => {
    const b = setup('goblin_jefe');
    b.hit(b.p2); clock += 1000; b.m.hp = 1; b.hit(b.p1);
    assert.ok((b.rewards[0].info.participants ?? []).includes(b.p2.playerId), 'el jefe comparte');
    const c = setup('goblin');
    c.hit(c.p2); clock += 1000; c.m.hp = 1; c.hit(c.p1);
    assert.equal(c.rewards[0].info.participants, undefined, 'el común no comparte: solo el que mata (y su party)');
});
