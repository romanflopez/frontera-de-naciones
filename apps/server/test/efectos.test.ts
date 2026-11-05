/**
 * Efectos especiales de los ítems de jefe (docs/ITEMS.md): solo están activos en la calidad Dorado (r = 4) y los aplica el server
 * en PvE: quemadura (prende fuego), estocada aturdidora y vampirismo (cura al matar).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { FX_INFO, UNIQUE_BASES, type MobType, type WorldMap } from '@fdn/world';
import { FX_STUN_SECS, FX_VAMP_FRAC, MobSim, type MobHost } from '../src/mobs.ts';
import type { Player } from '../src/player.ts';
import { PvpLimiter, statsFromChar } from '../src/systems/pvpCombat.ts';

const N = 40;
let clock = 190_000_000;
mock.method(Date, 'now', () => clock);

test('fx: el efecto de un ítem de jefe solo está activo en Dorado', () => {
    const arma = (r: number) => statsFromChar({ lvl: 40, cls: 'pala', eq: { arma: { n: 'Hacha del Gran Verdugo', r, a: [] } } } as never);
    assert.deepEqual(arma(4).fx, ['aturdir']);
    for (const r of [0, 1, 2, 3]) assert.equal(arma(r).fx, undefined, `r${r} sin efecto`);
    // todo efecto del catálogo tiene su texto, y solo lo traen ítems de jefe
    for (const u of UNIQUE_BASES) if (u.uniq.fx) { assert.ok(FX_INFO[u.uniq.fx], u.name); assert.ok(u.uniq.boss, `${u.name}: el efecto es de jefe`); }
});

function setup(type: MobType, fx: string[]) {
    clock += 100_000;
    const combat = { ...statsFromChar({ lvl: 12, cls: 'pala', eq: {} }), fx };
    const heals: number[] = [];
    const p = { playerId: 7n, posX: 14, posY: 20, disconnected: false, isDead: false, status: { isInvisible: false }, combat, pvp: new PvpLimiter(), send: (_m: ServerMessage) => {} } as unknown as Player;
    const blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const map = { size: N, tiles: [], blocked, safe, props: [], decals: [], zones: [{ type, x: 14, y: 20, r: 0, n: 1, name: 'prueba' }], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 } } as unknown as WorldMap;
    const host: MobHost = {
        players: () => [p], playerById: (id) => (id === p.playerId ? p : undefined), nearby: () => [p],
        after: () => {}, hurt: () => {}, stun: () => 0, pay: () => true, heal: (_p, n) => { heals.push(n); }, reward: () => {},
    };
    const sim = new MobSim(map, host);
    const m = [...(sim as unknown as { mobs: Map<number, { hp: number; hpMax: number; traits: number; id: number; par: number; burn: number; imm: number }> }).mobs.values()][0];
    m.traits = 0; m.hp = m.hpMax = 1e6;
    return { p, m, heals, hit: () => sim.hit(p, { mobId: m.id, dmg: 0, melee: true, crit: false, parSecs: 0, poisonSecs: 0, spell: 'ataque' } as never) };
}

test('quemadura y aturdir: con el dado a favor prenden y aturden al mob; sin el efecto, nunca', () => {
    const rnd = Math.random;
    try {
        Math.random = () => 0; // todas las chances salen
        const a = setup('goblin', ['quemadura', 'aturdir']); a.hit();
        const t = clock / 1000;
        assert.ok(a.m.burn > 0, 'prendió fuego'); assert.ok(a.m.par > 0 && a.m.par <= t + FX_STUN_SECS + 1, 'aturdió');
        const b = setup('goblin', []); b.hit();
        assert.equal(b.m.burn, 0); assert.equal(b.m.par, 0);
        Math.random = () => 0.99; // ninguna sale
        const c = setup('goblin', ['quemadura', 'aturdir']); c.hit();
        assert.equal(c.m.burn, 0); assert.equal(c.m.par, 0);
    } finally { Math.random = rnd; }
});

test('vampirismo: al matar cura el 3 % de la vida máxima; sin el efecto no cura', () => {
    const a = setup('goblin', ['vampirismo']);
    a.m.hp = 1; a.hit();
    assert.deepEqual(a.heals, [Math.max(1, Math.round(a.p.combat.maxHp * FX_VAMP_FRAC))]);
    const b = setup('goblin', []); b.m.hp = 1; b.hit();
    assert.deepEqual(b.heals, []);
});
