/** Misiones del corte del MVP (@fdn/world quests.ts): cadena de 5, encargos del día y repetible, validados en el server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import {
    DAILY_LIMIT, DAILY_QUESTS, MAIN_QUESTS, MAPS, REPEAT_MATS, applyQuestEvent, buildMap, cleanQuestBook, dailyEligible, mobDef, msToReset,
    newQuestBook, questDay, rewardUniques, roleOf, rollDailies, TRAIT_MUTANT, type MobType,
} from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy, type EconCtx, type KillInfo } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';
import type { GameWorld } from '../src/world.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const H = 3_600_000;

function setup(cls = 'guerrero') {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const town = reg.ensure('solmar_ayuntamiento'), smithy = reg.ensure('solmar_herreria');
    const cap = buildMap('solmar_ayuntamiento').npcs.find((n) => roleOf(n) === 'capitan')!;
    const smith = buildMap('solmar_herreria').npcs.find((n) => roleOf(n) === 'armero')!;
    const log: ServerMessage[] = [];
    const session: TransferSession = { sessionId: 's-q', worldId: town.id };
    const persisted: PersistedPlayer = { mapId: town.mapId, worldId: town.mapId, x: cap.x + 1, y: cap.y + 1, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
    town.playerConnected(session.sessionId, 'quester', (m) => log.push(m), () => {}, persisted);
    mem.put('acc-q', { name: 'quester', salt: '', hash: '', created: 0, lastLogin: 0 });
    town.bindAccount(session.sessionId, 'acc-q');
    town.onClientSave(session.sessionId, JSON.stringify({ cls, faction: 'solmar' }));
    reg.sessionHook = (id) => (id === session.sessionId ? { session } : undefined);
    const p = town.playerOf(session.sessionId)!;
    p.setPosition(cap.x + 1, cap.y + 1);
    const ctxOf = (w: GameWorld) => (w as unknown as { ctx: EconCtx }).ctx;
    const last = () => (log.filter((m) => m.payload?.$case === 'econResult').at(-1)!.payload as { value: { ok: boolean; code: string; text: string } }).value;
    /** Pedido al Capitán por la red, como lo manda el cliente. */
    const ask = (action: string, key = '') => { town.handleClientPacket(session.sessionId, { payload: { $case: 'econQuestRequest', value: { npcId: cap.id, action, key } } } as never); return last(); };
    const kill = (type: MobType, o: Partial<KillInfo> = {}) => eco.reward(p, ctxOf(town), { mobId: 1, type, def: mobDef(type), zoneName: 'Pit', origin: 'pit', x: p.posX, y: p.posY, map: 'campos_de_sal', traits: 0, ...o });
    // el límite de ritmo de acciones (20 por ráfaga, 12 por segundo) se reinicia para que los tests no dependan del reloj
    const unthrottle = () => (eco as unknown as { rate: WeakMap<object, unknown> }).rate.delete(p);
    return { eco, p, st: p.econ!, cap, smith, smithy, ctxOf, ask: (a: string, k = '') => { unthrottle(); return ask(a, k); }, kill, log, unthrottle };
}

test('encargos del día fijos: todos los de tu nivel, sin sorteo; reinicio a las 09:00 UTC (06:00 de Argentina); al subir de nivel se suman', () => {
    const b = newQuestBook(), t = Date.UTC(2026, 10, 2, 8, 59);
    assert.equal(rollDailies(b, 1, t), true);
    assert.deepEqual(b.d.ids, dailyEligible(1).map((q) => q.id));
    assert.ok(!b.d.ids.includes('dia_d2') && !b.d.ids.includes('frontera'), 'D2 pide nivel 7 y el PvP nivel 3');
    const again = newQuestBook(); rollDailies(again, 1, t); assert.deepEqual(again.d.ids, b.d.ids, 'todos ven lo mismo');
    assert.equal(rollDailies(b, 1, t + 60_000 - 1), false, 'mismo día (antes de las 09:00 UTC)');
    assert.equal(questDay(t + 60_000), questDay(t) + 1, 'a las 09:00 UTC cambia el día');
    assert.equal(msToReset(t), 60_000);
    b.d.prog.pits = 7;
    assert.equal(rollDailies(b, 7, t), true, 'subió a 7 en el día: se suman D2 y PvP');
    assert.ok(b.d.ids.includes('dia_d2') && b.d.ids.includes('frontera')); assert.equal(b.d.prog.pits, 7, 'no pierde lo hecho');
    b.d.done.push('pits'); b.d.pvp.push('x');
    assert.equal(rollDailies(b, 7, t + 2 * H), true); assert.deepEqual(b.d.done, []); assert.deepEqual(b.d.pvp, []); assert.ok(Object.values(b.d.prog).every((v) => v === 0));
});

test('objetivos: el mapa cuenta; los de "tener" (colmillos, ítem en +1) se leen de lo que tenés', () => {
    const none = { mats: {}, maxUp: 0 };
    const b = newQuestBook(); b.m.st = 'active'; b.m.prog = [0];
    const kill = (map: string, type: MobType = 'goblin') => applyQuestEvent(b, { k: 'kill', type, map, pit: true, tier: 1, myTier: 1, mutant: false }, none);
    kill('canon_goblin'); kill('campos_de_sal', 'zombie'); assert.equal(b.m.prog[0], 0, 'otro mapa u otro mob no cuenta');
    for (let i = 0; i < 9; i++) kill('campos_de_sal', i % 2 ? 'goblin' : 'goblin_elite');
    assert.equal(b.m.st, 'active');
    assert.match(kill('campos_de_sal').msgs.join(), /Misión lista/); assert.equal(b.m.st, 'ready');

    const h = newQuestBook(); h.m.i = MAIN_QUESTS.findIndex((q) => q.id === 'el_herrero'); h.m.st = 'active'; h.m.prog = [0];
    applyQuestEvent(h, null, none); assert.equal(h.m.st, 'active');
    assert.match(applyQuestEvent(h, null, { mats: {}, maxUp: 1 }).msgs.join(), /Misión lista/, 'un ítem en +1, mejorado antes o después de aceptar');

    const c = newQuestBook(); c.m.i = MAIN_QUESTS.findIndex((q) => q.id === 'colmillos'); c.m.st = 'active'; c.m.prog = [0];
    applyQuestEvent(c, { k: 'gather', n: 1 }, { mats: { colmillo: 7 }, maxUp: 0 }); assert.equal(c.m.st, 'active');
    applyQuestEvent(c, { k: 'gather', n: 1 }, { mats: { colmillo: 8 }, maxUp: 0 }); assert.equal(c.m.st, 'ready');
    applyQuestEvent(c, { k: 'gather', n: 1 }, { mats: { colmillo: 2 }, maxUp: 0 }); assert.equal(c.m.st, 'active', 'si gastó los colmillos vuelve a activa');
});

test('libro guardado roto o viejo: se sanea sin romper', () => {
    const b = cleanQuestBook({ m: { i: 99, st: 'ready', prog: [5000] }, d: { day: 'x', ids: ['nada', 'pits', 'pits', 'mutante', 'recolector'], prog: { pits: -4 }, done: ['nada'], rerolled: true, pvp: [3, 'vh'] } });
    assert.equal(b.m.i, MAIN_QUESTS.length); assert.equal(b.m.st, 'new');
    assert.deepEqual(b.d.ids, ['pits', 'mutante', 'recolector']); assert.equal(b.d.prog.pits, 0); assert.deepEqual(b.d.done, []); assert.deepEqual(b.d.pvp, ['vh']);
    assert.deepEqual(cleanQuestBook(undefined), newQuestBook());
});

test('premios por clase: el mago recibe ítems con Magia y el guerrero no; los anillos son de todos', () => {
    const w = rewardUniques('class_t1_choice', 'guerrero'), m = rewardUniques('class_t1_choice', 'mago');
    assert.ok(w.length >= 3 && m.length >= 3);
    assert.ok(w.every((u) => u.slot === 'anillo' || !u.mag)); assert.ok(m.every((u) => u.slot === 'anillo' || (u.mag ?? 0) > 0));
    assert.ok(rewardUniques('boss_d2_choice', 'guerrero').every((u) => u.uniq.boss === 'antlion_reina'));
});

test('el camino recorre los mapas en orden de nivel y cada objetivo de matar apunta a un mob que vive en ese mapa', () => {
    let last = 0;
    for (const q of MAIN_QUESTS) {
        assert.ok(q.minLvl >= last, `${q.name}: el nivel no baja`); last = q.minLvl;
        for (const g of q.goals) if (g.k === 'kill') {
            const zones = buildMap(g.map!).zones; assert.ok(zones.length, `${g.map} existe`);
            assert.ok(g.mobs.some((t) => zones.some((z) => z.type === t)), `${q.name}: ${g.mobs} no vive en ${g.map}`);
        }
    }
    const maps = new Set(MAIN_QUESTS.flatMap((q) => q.goals.flatMap((g) => (g.k === 'kill' ? [g.map] : []))));
    for (const m of ['campos_de_sal', 'bosque_de_piedra', 'canon_goblin', 'pantano_de_merrimead', 'altas_de_nazia', 'cementerio_de_lochport', 'risco_del_sur', 'la_brecha']) assert.ok(maps.has(m), `falta ${m}`);
});

test('cadena completa en el server: de Campos de Sal a la Reina, con premios, niveles y elección de ítem', () => {
    const { p, st, ask, kill, eco, smith, smithy, ctxOf, unthrottle, cap } = setup();
    const rnd = Math.random;
    try {
        Math.random = () => 0.99; // sin drops al azar para contar exacto
        assert.equal(ask('m_turnin').code, 'quest_state');
        st.qb!.d.done = ['pits', 'recolector', 'mutante']; // tope del día alcanzado: los encargos no cobran exp ni oro en el medio
        let prize = '';
        for (const q of MAIN_QUESTS) {
            st.lvl = Math.max(st.lvl, q.minLvl); st.exp = 0;
            if (q.minLvl > 1) { st.lvl = q.minLvl - 1; assert.equal(ask('m_accept').code, 'quest_lvl', q.name); st.lvl = q.minLvl; }
            const a = ask('m_accept'); assert.equal(a.ok, true, `${q.name}: ${a.text}`);
            for (const g of q.goals) {
                if (g.k === 'kill') {
                    kill(g.mobs[0], { map: 'otro_mapa' }); // otro mapa no cuenta
                    for (let n = 0; n < g.n; n++) kill(g.mobs[n % g.mobs.length], { map: g.map });
                } else if (g.k === 'upgraded') {
                    const it = st.bag.find((x) => x.n === prize)!; p.setPosition(smith.x + 1, smith.y + 1);
                    Math.random = () => 0; unthrottle(); eco.upgrade(p, ctxOf(smithy), smith.id, it.u); Math.random = () => 0.99;
                    assert.equal(it.up, 1); p.setPosition(cap.x + 1, cap.y + 1); // de vuelta con el Capitán
                } else if (g.k === 'collect') {
                    Math.random = () => 0.05; for (let n = 0; n < g.n; n++) kill('goblin', { origin: 'pit', map: 'campos_de_sal' }); Math.random = () => 0.99;
                } else if (g.k === 'dungeon') {
                    const boss = g.d === 'd1' ? 'goblin_jefe' : 'antlion_reina', map = g.d === 'd1' ? 'minas_goblin' : 'ruinas_de_stormrock';
                    kill(boss, { origin: 'dungeon', map: 'campos_de_sal' }); assert.equal(st.qb!.m.st, 'active', 'el jefe fuera de su piso no cuenta');
                    kill(boss, { origin: 'dungeon', map });
                }
            }
            assert.equal(st.qb!.m.st, 'ready', q.name);
            const gold = st.gold, forge = st.forge ?? 0, bag = st.bag.length;
            if (q.reward.unique?.endsWith('_choice')) {
                assert.equal(ask('m_turnin').code, 'choose');
                assert.equal(ask('m_turnin', 'Vara de raíz').code, 'choose', 'un guerrero no elige el báculo');
                const pick = q.reward.unique === 'boss_d2_choice' ? 'Caparazón de la Reina' : 'Hoja de sal';
                assert.equal(ask('m_turnin', pick).ok, true); assert.equal(st.bag.at(-1)!.n, pick);
            } else {
                const r = ask('m_turnin'); assert.equal(r.ok, true, `${q.name}: ${r.text}`);
                if (q.reward.unique) { prize = st.bag.at(-1)!.n; assert.ok(rewardUniques('class_t1_random', 'guerrero').some((u) => u.name === prize)); assert.equal(st.bag.length, bag + 1); }
            }
            assert.equal(st.gold, gold + q.reward.gold, q.name); assert.equal(st.forge ?? 0, forge + (q.reward.forge ?? 0));
            if (q.id === 'colmillos') assert.ok((st.mats?.colmillo ?? 0) >= 8, 'entregar no gasta los colmillos');
        }
        assert.equal(st.qb!.m.i, MAIN_QUESTS.length);
        assert.equal(ask('m_accept').code, 'quest_state', 'la cadena terminó');
    } finally { Math.random = rnd; }
});

test('encargos del día en el server: se cobran solos sin NPC, el primero da esencia, tope de 3 por día', () => {
    const { st, ask, kill, eco, p, log } = setup();
    const rnd = Math.random;
    try {
        Math.random = () => 0.99;
        st.lvl = 4; eco.snapshot(p);
        const b = st.qb!; assert.deepEqual([...b.d.ids].sort(), dailyEligible(4).map((q) => q.id).sort());
        const gold0 = st.gold, ess = st.mats?.esencia ?? 0;
        for (let i = 0; i < 25; i++) kill('goblin', { def: { ...mobDef('goblin'), lvl: 3 } }); // T2, igual que el jugador
        assert.ok(b.d.done.includes('pits'), 'cobrado solo'); assert.equal(st.mats!.esencia, ess + 1); assert.ok(st.gold > gold0);
        const msg = log.filter((m) => m.payload?.$case === 'econResult').map((m) => (m.payload as any).value.text).join('\n');
        assert.match(msg, /Encargo cumplido: «Limpieza de pits».*Esencia/);
        kill('goblin', { traits: TRAIT_MUTANT, origin: 'loose' }); assert.ok(b.d.done.includes('mutante')); assert.equal(st.mats!.esencia, ess + 1, 'la esencia es una por día');
        eco.addLoot(p, 'goblin_ear', 10); assert.ok(b.d.done.includes('recolector'));
        assert.equal(b.d.done.length, DAILY_LIMIT);
        const prog = { ...b.d.prog };
        kill('goblin_jefe', { origin: 'dungeon', map: 'minas_goblin' }); assert.ok(!b.d.done.includes('dia_d1'), 'tope de 3: no se cobra un cuarto');
        assert.deepEqual(b.d.prog, prog, 'con el tope alcanzado no avanzan');
        assert.equal(ask('d_turnin', 'pits').code, 'bad_action', 'no hay que entregarlos');
        assert.equal(ask('accept').code, 'quest_retired', 'la cadena vieja quedó jubilada');
    } finally { Math.random = rnd; }
});

test('pits del encargo: solo cuentan los de tu banda o más alta', () => {
    const { st, kill } = setup();
    st.lvl = 5; const b = st.qb!; b.d = { day: questDay(Date.now()), ids: ['pits'], prog: { pits: 0 }, done: [], ess: false, pvp: [] };
    kill('goblin', { def: { ...mobDef('goblin'), lvl: 1 } }); assert.equal(b.d.prog.pits, 0, `T1 para alguien T3 no cuenta: ${JSON.stringify({ lvl: st.lvl, d: b.d, same: st.qb === b, now: Date.now() })}`);
    kill('goblin', { def: { ...mobDef('goblin'), lvl: 6 } }); assert.equal(b.d.prog.pits, 1);
    kill('goblin', { def: { ...mobDef('goblin'), lvl: 6 }, origin: 'loose' }); assert.equal(b.d.prog.pits, 1, 'los sueltos no son de pit');
});

test('repetible: 10 materiales iguales por oro o piedra; los de las llaves no se aceptan', () => {
    const { st, ask } = setup();
    st.mats = { goblin_ear: REPEAT_MATS * 2 + 3, colmillo: 50 };
    assert.equal(ask('r_turnin', 'colmillo|gold').code, 'bad_mat');
    assert.equal(ask('r_turnin', 'goblin_ear|nada').code, 'bad_action');
    const g = st.gold; assert.equal(ask('r_turnin', 'goblin_ear|gold').ok, true); assert.ok(st.gold > g);
    const f = st.forge ?? 0; assert.equal(ask('r_turnin', 'goblin_ear|forge').ok, true); assert.equal(st.forge, f + 1);
    assert.equal(ask('r_turnin', 'goblin_ear|gold').code, 'mats'); assert.equal(st.mats.goblin_ear, 3);
});

test('el libro viaja al cliente en InventoryState.quest_book', () => {
    const { log, eco, p } = setup();
    eco.snapshot(p);
    const inv = log.filter((m) => m.payload?.$case === 'inventoryState').at(-1)!.payload as { value: { questBook: string } };
    const v = JSON.parse(inv.value.questBook);
    assert.equal(v.m.i, 0); assert.deepEqual(v.d.ids, dailyEligible(1).map((q) => q.id)); assert.ok(v.d.resetMs > 0 && v.d.resetMs <= 24 * H);
    assert.ok(DAILY_QUESTS.length >= 6 && MAPS.campos_de_sal, 'mapas y pool presentes');
});

test('encargo PvP: cuenta ganarle a la otra nación en mapa de facción, una vez por rival, no a un novato 6+ niveles abajo ni en mapas sin PvP', () => {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const mk = (w: GameWorld, name: string, faction: string) => {
        const persisted: PersistedPlayer = { mapId: w.mapId, worldId: w.mapId, x: MAPS[w.mapId].spawn.x, y: MAPS[w.mapId].spawn.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        w.playerConnected(`s-${name}-${w.mapId}`, name, () => {}, () => {}, persisted);
        mem.put(`acc-${name}-${w.mapId}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(`s-${name}-${w.mapId}`, `acc-${name}-${w.mapId}`);
        w.onClientSave(`s-${name}-${w.mapId}`, JSON.stringify({ cls: 'guerrero', faction }));
        w.handleClientPacket(`s-${name}-${w.mapId}`, { payload: { $case: 'changePlayerProfileRequest', value: { profile: `${faction};guerrero;` } } } as never);
        const p = w.playerOf(`s-${name}-${w.mapId}`)!; p.econ!.lvl = 10; p.econ!.qb!.d = { day: questDay(Date.now()), ids: ['frontera'], prog: { frontera: 0 }, done: [], ess: false, pvp: [] };
        return p;
    };
    const credit = (w: GameWorld, victim: ReturnType<typeof mk>, killer: ReturnType<typeof mk>) => (w as unknown as { pvpQuestCredit(v: unknown, id: bigint): void }).pvpQuestCredit(victim, killer.playerId);
    const faction = reg.ensure('canon_goblin'), safe = reg.ensure('campos_de_sal');
    assert.equal(MAPS.canon_goblin.pvp, 'faction'); assert.equal(MAPS.campos_de_sal.pvp, 'off');
    const a = mk(faction, 'sol', 'solmar'), v = mk(faction, 'vh', 'vhar'), ally = mk(faction, 'sol2', 'solmar');
    a.econ!.lvl = 10; v.econ!.lvl = 4; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, '6 niveles abajo no cuenta');
    ally.econ!.lvl = 10; credit(faction, ally, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, 'misma nación no cuenta');
    v.econ!.lvl = 5; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 1); assert.ok(a.econ!.qb!.d.done.includes('frontera'), 'se cobra solo');
    a.econ!.qb!.d.prog.frontera = 0; a.econ!.qb!.d.done = []; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, 'al mismo rival se le cuenta una vez por día');
    const b = mk(safe, 'sol', 'solmar'), w2 = mk(safe, 'vh', 'vhar'); credit(safe, w2, b); assert.equal(b.econ!.qb!.d.prog.frontera, 0, 'sin PvP en el mapa no cuenta');
});
