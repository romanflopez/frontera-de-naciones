/**
 * D.10: EK y contribución. Un kill a un jugador de la otra nación en zona roja suma 1 EK y 10 de contribución; el mismo jugador cuenta una vez cada
 * 4 h; antes del mapa 81 no cuenta una víctima más de 5 niveles por debajo; la tienda vende títulos (visual, nunca poder).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { CONTRIB_PER_KILL, CONTRIB_SHOP, EK_COOLDOWN_MS, MAPS, buildMap, ekLevelOk, pvpRegionAt } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { ECON_VERSION, Economy, cleanContrib, migrateEcon, newEcon, type Econ } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';
import { statsFromChar } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage { private m = new Map<string, AccountRecord>(); get(k: string) { return this.m.get(k); } put(k: string, r: AccountRecord) { this.m.set(k, r); } flush() {} }
const pkt = (w: GameWorld, sid: string, $case: string, value: object) => w.handleClientPacket(sid, { payload: { $case, value } } as never);
const cases = (log: ServerMessage[], k: string) => log.filter((m) => m.payload?.$case === k).map((m) => (m.payload as { value: any }).value);
const texts = (log: ServerMessage[]) => cases(log, 'sendMessage').map((v) => String(v.message ?? ''));
let off = 0;
const realNow = Date.now;
mock.method(Date, 'now', () => realNow() + off);

// ---------- A. reglas puras y de la economía ----------
test('A: ekLevelOk: antes del 81 no cuenta una víctima más de 5 niveles por debajo; desde el tier 9 cuenta todo', () => {
    assert.equal(ekLevelOk(70, 65, 7), true); assert.equal(ekLevelOk(70, 64, 7), false, '6 niveles por debajo');
    assert.equal(ekLevelOk(70, 90, 7), true, 'uno más fuerte siempre cuenta');
    assert.equal(ekLevelOk(100, 20, 9), true, 'mapa 81+: sin regla de nivel'); assert.equal(ekLevelOk(100, 20, 12), true);
    assert.equal(ekLevelOk(100, 20, 8), false); assert.equal(ekLevelOk(100, 20, undefined), false, 'sin tier: regla de nivel');
});

function eco() {
    const mem = new MemStorage(), e = new Economy(mem), st = newEcon('paladin', 'solmar'); st.lvl = 70;
    mem.put('acc-k', { name: 'k', salt: '', hash: '', created: 0, lastLogin: 0, econ: st });
    const p = { econ: st, accountKey: 'acc-k', disconnected: false, isDead: false, characterName: 'k', send: () => {} } as never;
    return { e, st, p };
}

test('A: cooldown de 4 h por víctima: la misma no cuenta de nuevo hasta que pasan 4 h; otras sí', () => {
    const { e, st, p } = eco(), T0 = 1_000_000_000_000;
    const r1 = e.pvpKill(p, 'acc-v1', 70, 7, T0); assert.ok('ek' in r1 && r1.ek === 1 && r1.contrib === CONTRIB_PER_KILL);
    assert.deepEqual(e.pvpKill(p, 'acc-v1', 70, 7, T0 + 1000), { why: 'cooldown' });
    assert.deepEqual(e.pvpKill(p, 'acc-v1', 70, 7, T0 + EK_COOLDOWN_MS - 1), { why: 'cooldown' });
    assert.ok('ek' in e.pvpKill(p, 'acc-v2', 70, 7, T0 + 2000), 'otra víctima cuenta');
    assert.ok('ek' in e.pvpKill(p, 'acc-v1', 70, 7, T0 + EK_COOLDOWN_MS), 'a las 4 h cuenta otra vez');
    assert.equal(st.ek, 3); assert.equal(st.contrib, 3 * CONTRIB_PER_KILL); assert.equal(st.contribTotal, 3 * CONTRIB_PER_KILL);
    assert.deepEqual(e.pvpKill(p, '', 70, 7, T0), { why: 'level' }, 'sin víctima identificable no cuenta');
});

test('A: tienda: comprar gasta contribución, no se compra dos veces ni sin plata, y solo se pone lo comprado', () => {
    const { e, st, p } = eco(); const ctx = { restat: () => {}, ground: { add: () => ({}) }, npcs: [] } as never;
    st.contrib = 120; const it = CONTRIB_SHOP[0];
    assert.equal(e.contribAction(p, ctx, 'equip', it.id), false); assert.equal(st.title, '', 'no se pone lo que no se compró');
    e.contribAction(p, ctx, 'buy', it.id); assert.equal(st.contrib, 120 - it.cost); assert.deepEqual(st.titles, [it.id]);
    e.contribAction(p, ctx, 'buy', it.id); assert.equal(st.contrib, 120 - it.cost, 'ya lo tiene: no cobra');
    const caro = CONTRIB_SHOP.at(-1)!; e.contribAction(p, ctx, 'buy', caro.id); assert.ok(!st.titles!.includes(caro.id), 'sin contribución no se compra');
    assert.equal(e.contribAction(p, ctx, 'equip', it.id), true); assert.equal(st.title, it.id);
    e.contribAction(p, ctx, 'buy', 'inventado'); assert.equal(st.titles!.length, 1, 'un id que no existe se ignora');
    assert.equal(e.contribAction(p, ctx, 'unequip', ''), true); assert.equal(st.title, '');
});

// ---------- B. kills repetidos en el mundo ----------
function cellsIn(mapId: string, red: boolean, n = 3) {
    const def = MAPS[mapId], m = buildMap(mapId);
    for (let y = 2; y < m.size - 2; y++) for (let x = 2; x < m.size - n - 1; x++) {
        let ok = true; for (let i = 0; i < n; i++) if (m.blocked[y][x + i] || m.safe[y]?.[x + i] || (pvpRegionAt(def, false, x + i, y) === 'roja') !== red) ok = false;
        if (ok) return Array.from({ length: n }, (_, i) => ({ x: x + i, y }));
    }
    throw new Error('sin celdas');
}
function world(mapId: string, redCells = true) {
    const mem = new MemStorage(), e = new Economy(mem), reg = new WorldRegistry({ settings, economy: e });
    const w = reg.ensure(mapId); (w as unknown as { mobSim?: unknown }).mobSim = undefined;
    off += 1_000_000;
    const [c1, c2, c3] = cellsIn(mapId, redCells);
    const join = (name: string, at: { x: number; y: number }, faction: string, lvl = 70) => {
        const log: ServerMessage[] = [], sid = `s-${name}${off}`;
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: at.x, y: at.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 100, runningMode: false, attackMode: true } as PersistedPlayer;
        w.playerConnected(sid, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}${off}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}${off}`);
        w.onClientSave(sid, JSON.stringify({ cls: 'paladin', faction }));
        pkt(w, sid, 'changePlayerProfileRequest', { profile: `${faction};paladin;` });
        const p = w.playerOf(sid)!; p.econ!.lvl = lvl;
        p.combat = statsFromChar({ lvl, cls: 'paladin', eq: {} }); p.spawnProtection = false; p.mp = p.combat.maxMp; p.hp = p.combat.maxHp;
        return { sid, log, p };
    };
    const kill = (victim: ReturnType<typeof join>, killer: ReturnType<typeof join>) => {
        victim.p.hp = 1;
        (w as unknown as { damagePlayer(p: unknown, raw: number, k: 'phys', killer: unknown): number }).damagePlayer(victim.p, 99999, 'phys', killer.p);
        assert.equal(victim.p.isDead, true);
    };
    return { w, join, kill, c: [c1, c2, c3] };
}

test('B: kills repetidos: el mismo jugador cuenta una vez cada 4 h y otro jugador cuenta aparte', () => {
    const { join, kill, c } = world('cenizas_i');
    const killer = join('asesino', c[0], 'solmar'), v1 = join('uno', c[1], 'vhar'), v2 = join('dos', c[2], 'vhar');
    kill(v1, killer); assert.equal(killer.p.econ!.ek, 1); assert.equal(killer.p.econ!.contrib, CONTRIB_PER_KILL);
    assert.ok(texts(killer.log).some((t) => /\+1 EK \(1 en total\) y \+10 de contribución/.test(t)));
    kill(v1, killer); kill(v1, killer); assert.equal(killer.p.econ!.ek, 1, 'matar de nuevo al mismo no suma');
    assert.ok(texts(killer.log).some((t) => /menos de 4 horas/.test(t)));
    kill(v2, killer); assert.equal(killer.p.econ!.ek, 2, 'otro jugador sí');
    off += EK_COOLDOWN_MS + 1000;
    kill(v1, killer); assert.equal(killer.p.econ!.ek, 3, 'pasadas 4 h vuelve a contar');
    assert.equal(v1.p.econ!.ek ?? 0, 0, 'la víctima no suma nada');
});

test('B: regla de nivel: antes del mapa 81 una víctima 6 niveles por debajo no cuenta; en el 81+ sí', () => {
    const a = world('cenizas_i'); // tier 7
    const k1 = a.join('asesino', a.c[0], 'solmar', 70), low = a.join('novato', a.c[1], 'vhar', 60);
    a.kill(low, k1); assert.equal(k1.p.econ!.ek ?? 0, 0, 'mapa < 81: 10 niveles de diferencia no cuenta');
    assert.ok(texts(k1.log).some((t) => /5 niveles por debajo/.test(t)));
    const b = world('cenizas_iii'); // tier 9: todo kill cuenta
    assert.ok((MAPS.cenizas_iii.tier ?? 0) >= 9);
    const k2 = b.join('asesino', b.c[0], 'solmar', 100), low2 = b.join('novato', b.c[1], 'vhar', 60);
    b.kill(low2, k2); assert.equal(k2.p.econ!.ek, 1, 'mapa 81+: sin regla de nivel');
});

test('B: en zona abierta o contra mobs no suma EK', () => {
    const { join, kill, c, w } = world('cenizas_i', false); // celdas de zona abierta
    const killer = join('asesino', c[0], 'solmar'), victim = join('victima', c[1], 'vhar');
    kill(victim, killer); assert.equal(killer.p.econ!.ek ?? 0, 0);
    const mob = join('otro', c[2], 'solmar'); mob.p.hp = 1;
    (w as unknown as { damagePlayer(p: unknown, raw: number, k: 'phys', killer: null, s: string): number }).damagePlayer(mob.p, 99999, 'phys', null, 'Goblin');
    assert.equal(mob.p.econ!.ek ?? 0, 0);
});

// ---------- tienda en el mundo (pedido del cliente) y título en el perfil ----------
test('E/H: comprar y ponerse un título por paquete cambia el perfil que ven los demás; pedidos que mienten no hacen nada', () => {
    const { w, join, c } = world('cenizas_i');
    const a = join('compra', c[0], 'solmar'), b = join('mira', c[1], 'solmar');
    a.p.econ!.contrib = 60; const it = CONTRIB_SHOP[0];
    pkt(w, a.sid, 'contribRequest', { action: 'equip', id: it.id }); assert.equal(a.p.econ!.title ?? '', '', 'miente: no lo compró');
    pkt(w, a.sid, 'contribRequest', { action: 'buy', id: 'inventado' }); assert.equal(a.p.econ!.titles?.length ?? 0, 0);
    pkt(w, a.sid, 'contribRequest', { action: 'buy', id: CONTRIB_SHOP.at(-1)!.id }); assert.equal(a.p.econ!.titles?.length ?? 0, 0, 'miente: no le alcanza');
    pkt(w, a.sid, 'contribRequest', { action: 'buy', id: it.id }); assert.equal(a.p.econ!.contrib, 60 - it.cost);
    b.log.length = 0;
    pkt(w, a.sid, 'contribRequest', { action: 'equip', id: it.id });
    assert.equal(a.p.econ!.title, it.id); assert.equal(a.p.profile.split(';')[4], it.id, 'el título va en la 5.ª parte del perfil');
    assert.ok(cases(b.log, 'playerProfileChanged').length > 0, 'los demás lo ven');
    const inv = cases(a.log, 'inventoryState').at(-1)!; assert.equal(inv.title, it.id); assert.equal(inv.contrib, 60 - it.cost); assert.deepEqual(inv.titles, [it.id]);
    // el cliente no puede ponerse un título por el perfil: el server lo reescribe con el suyo
    pkt(w, a.sid, 'changePlayerProfileRequest', { profile: 'solmar;paladin;;;azote' });
    assert.equal(a.p.profile.split(';')[4], it.id, 'un perfil truchado no cambia el título');
    pkt(w, a.sid, 'contribRequest', { action: 'unequip', id: '' }); assert.equal(a.p.profile.split(';')[4] ?? '', '');
});

// ---------- F. migración ----------
test('F: una cuenta v10 arranca con EK y contribución en 0 sin perder nada; un guardado raro se sanea', () => {
    const st: Econ = newEcon('paladin', 'solmar'); st.v = 10; st.lvl = 55; st.gold = 321; st.zem = 7;
    assert.equal(migrateEcon(st), true);
    assert.equal(st.v, ECON_VERSION); assert.equal(st.ek, 0); assert.equal(st.contrib, 0); assert.deepEqual(st.titles, []); assert.equal(st.title, '');
    assert.equal(st.lvl, 55); assert.equal(st.gold, 321); assert.equal(st.zem, 7);
    assert.equal(migrateEcon(st), false, 'migrar dos veces no cambia nada');
    const raro = newEcon('mago', 'vhar'); raro.v = 10; Object.assign(raro, { ek: -3, contrib: 'mucho', titles: ['centinela', 'centinela', 'falso', 5], title: 'azote', ekSeen: { a: 5, b: 'x' } });
    migrateEcon(raro);
    assert.equal(raro.ek, 0); assert.equal(raro.contrib, 0); assert.deepEqual(raro.titles, ['centinela']); assert.equal(raro.title, '', 'el puesto tiene que ser uno comprado'); assert.deepEqual(raro.ekSeen, { a: 5 });
    cleanContrib(raro); assert.equal(raro.title, '');
});
