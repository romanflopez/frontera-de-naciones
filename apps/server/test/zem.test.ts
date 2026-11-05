/**
 * D.9: zem (reemplaza a la piedra de forja) y caída en PvP. Drop 7-10 % en todo mob; al morir contra un jugador de la otra nación en zona roja
 * se cae todo el zem de la bolsa y min(10 % del oro, nivel × 100), reservado 30 s para el que mató y su party; la forja solo usa el zem del depósito.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { MAPS, ZEM_CHANCE, buildMap, pvpGoldLoss, pvpRegionAt } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, migrateEcon, newEcon, type Econ, type KillInfo } from '../src/economy.ts';
import { Depot, type Actor } from '../src/deposit.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { statsFromChar } from '../src/systems/pvpCombat.ts';
import { LOOT_OWNED_MS, splitLoot } from '../src/systems/loot.ts';
import { mobDef } from '@fdn/world';

const settings = loadSettings();
class MemStorage implements Storage { private m = new Map<string, AccountRecord>(); get(k: string) { return this.m.get(k); } put(k: string, r: AccountRecord) { this.m.set(k, r); } flush() {} }
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const texts = (log: ServerMessage[]) => log.filter((m) => m.payload?.$case === 'sendMessage').map((m) => String((m.payload as { value: { message?: string } }).value.message ?? ''));
let off = 0;
const realNow = Date.now;
mock.method(Date, 'now', () => realNow() + off);

// ---------- A. fórmulas y drop ----------
test('A: pvpGoldLoss = min(10 % del oro, nivel × 100), entero y nunca más que lo que hay', () => {
    assert.equal(pvpGoldLoss(5000, 70), 500, '10 % de 5.000 < 7.000');
    assert.equal(pvpGoldLoss(1_000_000, 70), 7000, 'tope nivel × 100');
    assert.equal(pvpGoldLoss(9, 70), 0, '10 % de 9 = 0 (se redondea para abajo)');
    assert.equal(pvpGoldLoss(0, 70), 0); assert.equal(pvpGoldLoss(-5, 70), 0); assert.equal(pvpGoldLoss(NaN, 70), 0);
    assert.equal(pvpGoldLoss(100, 1), 10);
});

test('A: el zem cae al 7-10 % según el origen del mob y va a la bolsa', () => {
    for (const v of Object.values(ZEM_CHANCE)) assert.ok(v >= 0.07 && v <= 0.1, `${v} entre 7 y 10 %`);
    const mem = new MemStorage(), eco = new Economy(mem);
    const st = newEcon('paladin', 'solmar'); st.lvl = 5;
    mem.put('acc-z', { name: 'z', salt: '', hash: '', created: 0, lastLogin: 0, econ: st });
    const sent: ServerMessage[] = [];
    const p = { econ: st, accountKey: 'acc-z', disconnected: false, isDead: false, posX: 5, posY: 5, characterName: 'z', send: (m: ServerMessage) => sent.push(m), partyId: undefined } as never;
    const ctx = { restat: () => {}, ground: { add: () => ({}) }, npcs: [] } as never;
    const kill = (origin: KillInfo['origin']): KillInfo => ({ mobId: 1, type: 'goblin', def: mobDef('goblin', { lvl: 5 }), zoneName: 'prueba', origin, x: 0, y: 0 });
    const rnd = Math.random;
    try {
        Math.random = () => 0.06; eco.reward(p, ctx, kill('loose')); assert.equal(st.zem, 1, '6 % < 7 % (suelto): cae');
        Math.random = () => 0.075; eco.reward(p, ctx, kill('loose')); assert.equal(st.zem, 1, '7,5 % ≥ 7 % (suelto): no cae');
        eco.reward(p, ctx, kill('dungeon')); assert.equal(st.zem, 2, '7,5 % < 9 % (mazmorra): cae');
        Math.random = () => 0.5; eco.reward(p, ctx, kill('pit')); assert.equal(st.zem, 2, 'sin suerte no cae');
    } finally { Math.random = rnd; }
    assert.equal(st.forge, undefined, 'ya no hay piedras de forja');
});

test('A: el zem de una caída de PvP se reparte en la party como el oro', () => {
    const parts = splitLoot('zem', 10, 3, () => 0);
    assert.equal(parts.reduce((n, x) => n + x.amount, 0), 10);
    assert.ok(parts.length > 1, 'no le toca todo a uno');
    assert.deepEqual(splitLoot('zem', 7, 1), [{ i: 0, amount: 7 }]);
});

// ---------- B. caída en PvP ----------
const MAP_ID = 'cenizas_i', DEF = MAPS[MAP_ID];
function cells(region: 'roja' | 'abierta', n = 4): { x: number; y: number }[] {
    const m = buildMap(MAP_ID);
    for (let y = 2; y < m.size - 2; y++) for (let x = 2; x < m.size - n - 1; x++) {
        let ok = true; for (let i = 0; i < n; i++) if (m.blocked[y][x + i] || m.safe[y]?.[x + i] || pvpRegionAt(DEF, false, x + i, y) !== region) ok = false;
        if (ok) return Array.from({ length: n }, (_, i) => ({ x: x + i, y }));
    }
    throw new Error(`sin celdas en ${region}`);
}
function world() {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure(MAP_ID);
    (w as unknown as { mobSim?: unknown }).mobSim = undefined;
    off += 1_000_000;
    const join = (name: string, at: { x: number; y: number }, faction: string) => {
        const log: ServerMessage[] = [], sid = `s-${name}${off}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}${off}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}${off}`);
        w.onClientSave(sid, JSON.stringify({ cls: 'paladin', faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};paladin;` });
        const p = w.playerOf(sid)!;
        p.combat = statsFromChar({ lvl: 70, cls: 'paladin', eq: {} });
        p.spawnProtection = false; p.mp = p.combat.maxMp; p.hp = p.combat.maxHp;
        return { sid, log, p };
    };
    const kill = (victim: ReturnType<typeof join>, killer: ReturnType<typeof join>) => {
        victim.p.hp = 1;
        (w as unknown as { damagePlayer(p: unknown, raw: number, k: 'phys', killer: unknown): number }).damagePlayer(victim.p, 99999, 'phys', killer.p);
        assert.equal(victim.p.isDead, true, 'murió');
    };
    const piles = () => [...(w as unknown as { floorLoot: { items: Map<string, { lootId: string; itemId: string; amount: number; owners?: string[]; freeAt?: number }> } }).floorLoot.items.values()];
    return { w, mem, join, kill, piles };
}

test('B: morir contra un jugador de la otra nación en zona roja suelta todo el zem y min(10 % del oro, nivel × 100)', () => {
    const [c1, c2] = cells('roja'), { join, kill, piles } = world();
    const killer = join('asesino', c1, 'solmar'), victim = join('victima', c2, 'vhar');
    victim.p.econ!.zem = 50; victim.p.econ!.gold = 5000; victim.p.econ!.lvl = 70; killer.p.econ!.zem = 3;
    kill(victim, killer);
    assert.equal(victim.p.econ!.zem, 0, 'el zem de la bolsa se cayó entero');
    assert.equal(victim.p.econ!.gold, 4500, '10 % de 5.000 = 500 (el tope nivel × 100 es 7.000)');
    const zem = piles().find((x) => x.itemId === 'zem')!, gold = piles().find((x) => x.itemId === 'gold')!;
    assert.equal(zem.amount, 50); assert.equal(gold.amount, 500);
    assert.deepEqual(zem.owners, [killer.sid], 'reservado para el que mató'); assert.ok((zem.freeAt ?? 0) - Date.now() > LOOT_OWNED_MS - 2000);
    assert.ok(texts(victim.log).some((t) => /zona roja.*50 zem y 500 de oro/.test(t)), 'avisa a la víctima');
    assert.ok(texts(killer.log).some((t) => /50 zem y 500 de oro/.test(t)), 'avisa al que mató');
});

test('B: el tope del oro es nivel × 100 y el equipo nunca se cae', () => {
    const [c1, c2] = cells('roja'), { join, kill, piles } = world();
    const killer = join('asesino', c1, 'solmar'), victim = join('victima', c2, 'vhar'), st = victim.p.econ!;
    st.lvl = 70; st.gold = 1_000_000; st.zem = 0;
    const eq = JSON.stringify(st.eq), bag = st.bag.length;
    kill(victim, killer);
    assert.equal(st.gold, 1_000_000 - 7000);
    assert.equal(piles().some((x) => x.itemId === 'zem'), false, 'sin zem no hay montón de zem');
    assert.equal(JSON.stringify(st.eq), eq); assert.equal(st.bag.length, bag);
});

test('B: reservado 30 s: otro jugador no lo levanta hasta que pasa el tiempo; el que mató lo cobra', () => {
    const [c1, c2, c3] = cells('roja'), { w, join, kill, piles } = world();
    const killer = join('asesino', c1, 'solmar'), victim = join('victima', c2, 'vhar'), ladron = join('ladron', c3, 'vhar');
    victim.p.econ!.zem = 20; victim.p.econ!.gold = 2000; victim.p.econ!.lvl = 70;
    kill(victim, killer);
    const zem = piles().find((x) => x.itemId === 'zem')!, gold = piles().find((x) => x.itemId === 'gold')!;
    for (const p of [killer, ladron]) p.p.setPosition(c2.x, c2.y);
    pkt(w, ladron.sid, 'clientPickupItem', { lootId: zem.lootId });
    assert.ok(texts(ladron.log).some((t) => /party que mató/.test(t)), 'locked: es de la party del que mató');
    assert.equal(ladron.p.econ!.zem ?? 0, 0);
    pkt(w, killer.sid, 'clientPickupItem', { lootId: zem.lootId });
    assert.equal(killer.p.econ!.zem, 20, 'el que mató lo cobra en la bolsa');
    off += LOOT_OWNED_MS + 1000; // pasaron 30 s: de cualquiera
    const g0 = ladron.p.econ!.gold;
    pkt(w, ladron.sid, 'clientPickupItem', { lootId: gold.lootId });
    assert.equal(ladron.p.econ!.gold, g0 + 200, 'después de 30 s lo levanta cualquiera');
});

test('B: fuera de la zona roja (zona abierta), contra mobs o sin zem ni oro no cae nada', () => {
    const [r1, r2] = cells('roja'), [o1, o2] = cells('abierta'), { join, kill, piles, w } = world();
    // los dos en zona abierta: ni siquiera se pueden pegar, pero si el server mata (daño directo), tampoco cae nada
    const a = join('a', o1, 'solmar'), b = join('b', o2, 'vhar');
    b.p.econ!.zem = 9; b.p.econ!.gold = 900; b.p.econ!.lvl = 70;
    kill(b, a);
    assert.equal(b.p.econ!.zem, 9); assert.equal(b.p.econ!.gold, 900); assert.equal(piles().length, 0, 'zona abierta: no cae nada');
    // muere en zona roja pero sin killer jugador (mob / sin daño de jugador): nada
    const c = join('c', r1, 'vhar'), d = join('d', r2, 'solmar');
    c.p.econ!.zem = 5; c.p.econ!.gold = 500; c.p.econ!.lvl = 70; c.p.hp = 1;
    (w as unknown as { damagePlayer(p: unknown, raw: number, k: 'phys', killer: null, source: string): number }).damagePlayer(c.p, 99999, 'phys', null, 'Goblin');
    assert.equal(c.p.isDead, true); assert.equal(c.p.econ!.zem, 5, 'contra mobs no se cae nada'); assert.equal(c.p.econ!.gold, 500);
    assert.equal(d.p.isDead, false);
});

// ---------- H. el cliente miente ----------
test('H: depositar más zem del que hay en la bolsa se rechaza; la forja no acepta el zem de la bolsa', () => {
    const storage = new MemStorage(), dp = new Depot(storage); dp.log = () => {};
    const econ = newEcon('paladin', 'solmar'); econ.zem = 5;
    storage.put('aa', { name: 'Ana', salt: '', hash: '', created: 0, lastLogin: 0, econ });
    const a: Actor = { key: 'aa', name: 'Ana', econ };
    assert.equal(dp.stackIn(a, 'zem', 500).code, 'no_stack', 'miente: dice 500 y tiene 5');
    assert.equal(econ.zem, 5); assert.equal(dp.vault('aa').stacks.zem ?? 0, 0);
    assert.equal(dp.stackIn(a, 'zem', 5).ok, true); assert.equal(econ.zem, 0); assert.equal(dp.vault('aa').stacks.zem, 5);
    assert.equal(dp.stackOut(a, 'zem', 9).code, 'no_stack', 'retirar más de lo que hay');
    assert.equal(dp.stackOut(a, 'zem', 2).ok, true); assert.equal(econ.zem, 2); assert.equal(dp.vault('aa').stacks.zem, 3);
});

// ---------- F. migración ----------
test('F: una cuenta con piedras de forja las recibe como zem 1:1 en la bolsa, sin tocar nada más', () => {
    const st: Econ = newEcon('paladin', 'solmar'); st.v = 9; st.lvl = 33; st.gold = 777; st.forge = 41; st.zem = undefined;
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION); assert.equal(st.zem, 41); assert.equal('forge' in st, false);
    assert.equal(st.lvl, 33); assert.equal(st.gold, 777);
    assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
    const sin: Econ = newEcon('mago', 'vhar'); sin.v = 4; delete sin.forge;
    migrateEcon(sin); assert.equal(sin.zem, 0);
    const raro: Econ = newEcon('mago', 'vhar'); raro.v = 9; raro.forge = -5 as number; migrateEcon(raro); assert.equal(raro.zem, 0, 'un valor raro no da zem');
});
