/** Misiones del corte del MVP (@fdn/world quests.ts): cadena de 5, encargos del día y repetible, validados en el server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { relevel,
    DAILY_LIMIT, DAILY_QUESTS, DUNGEON_BOSS, DUNGEON_IDS, DUNGEON_MAP, MAIN_QUESTS, MAPS, REPEAT_MATS, applyQuestEvent, buildMap, cleanQuestBook, dailyEligible, mobDef, msToReset,
    newQuestBook, questDay, expToLevel, DUNGEON_KEY, KEY_MAT_NAMES, rewardUniques, roleOf, rollDailies, TRAIT_MUTANT, type MobType,
} from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy, type EconCtx, type KillInfo } from '../src/economy.ts';
import { PartyService, setParties } from '../src/party.ts';
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
    assert.ok(!b.d.ids.includes('dia_d2') && !b.d.ids.includes('frontera'), 'D2 pide nivel 8 y el PvP nivel 3');
    const again = newQuestBook(); rollDailies(again, 1, t); assert.deepEqual(again.d.ids, b.d.ids, 'todos ven lo mismo');
    assert.equal(rollDailies(b, 1, t + 60_000 - 1), false, 'mismo día (antes de las 09:00 UTC)');
    assert.equal(questDay(t + 60_000), questDay(t) + 1, 'a las 09:00 UTC cambia el día');
    assert.equal(msToReset(t), 60_000);
    b.d.prog.pits = 7;
    assert.equal(rollDailies(b, relevel(8), t), true, 'subió al nivel de D2 en el día: se suman D1, D2 y PvP');
    assert.ok(b.d.ids.includes('dia_d2') && b.d.ids.includes('frontera')); assert.equal(b.d.prog.pits, 7, 'no pierde lo hecho');
    b.d.done.push('pits'); b.d.pvp.push('x');
    assert.equal(rollDailies(b, relevel(8), t + 2 * H), true); assert.deepEqual(b.d.done, []); assert.deepEqual(b.d.pvp, []); assert.ok(Object.values(b.d.prog).every((v) => v === 0));
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
    // los 6 dungeons: el jefe vive en su piso, cada uno está en el camino y los premios a elección existen
    for (const d of DUNGEON_IDS) {
        assert.ok(buildMap(DUNGEON_MAP[d]).zones.some((z) => z.type === DUNGEON_BOSS[d]), `${d}: ${DUNGEON_BOSS[d]} no está en ${DUNGEON_MAP[d]}`);
        assert.ok(MAIN_QUESTS.some((q) => q.goals.some((g) => g.k === 'dungeon' && g.d === d)), `${d} no está en el camino`);
    }
    for (const q of MAIN_QUESTS) if (q.reward.unique) assert.ok(rewardUniques(q.reward.unique, 'mago').length > 0, `${q.name}: sin premio`);
    assert.ok(MAIN_QUESTS.at(-1)!.minLvl >= 29, 'el camino llega al nivel 30');
    const maps = new Set(MAIN_QUESTS.flatMap((q) => q.goals.flatMap((g) => (g.k === 'kill' ? [g.map] : []))));
    for (const m of ['campos_de_sal', 'bosque_de_piedra', 'canon_goblin', 'pantano_de_merrimead', 'altas_de_nazia', 'cementerio_de_lochport', 'risco_del_sur', 'la_brecha', 'paso_de_stormrock', 'cenizas_i', 'cenizas_ii', 'cenizas_iii']) assert.ok(maps.has(m), `falta ${m}`);
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
                    const boss = DUNGEON_BOSS[g.d], map = DUNGEON_MAP[g.d];
                    kill(boss, { origin: 'dungeon', map: 'campos_de_sal' }); assert.equal(st.qb!.m.st, 'active', 'el jefe fuera de su piso no cuenta');
                    kill(boss, { origin: 'dungeon', map });
                }
            }
            assert.equal(st.qb!.m.st, 'ready', q.name);
            st.bag = st.bag.filter((x) => x.n === prize); // los jefes (ahora los seis) sueltan ítems: que la bolsa no se llene en la prueba
            const gold = st.gold, forge = st.forge ?? 0, bag = st.bag.length;
            if (q.reward.unique?.endsWith('_choice')) {
                assert.equal(ask('m_turnin').code, 'choose');
                assert.equal(ask('m_turnin', 'Vara de raíz').code, 'choose', 'un guerrero no elige el báculo');
                const pick = q.reward.unique === 'class_t1_choice' ? 'Hoja de sal' : rewardUniques(q.reward.unique, 'guerrero')[0].name;
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
    st.lvl = relevel(12); const b = st.qb!; b.d = { day: questDay(Date.now()), ids: ['pits'], prog: { pits: 0 }, done: [], ess: false, pvp: [] }; // nivel 12 = T3
    kill('goblin', { def: { ...mobDef('goblin'), lvl: relevel(5) } }); assert.equal(b.d.prog.pits, 0, 'una banda baja para alguien de una alta no cuenta');
    kill('goblin', { def: { ...mobDef('goblin'), lvl: relevel(13) } }); assert.equal(b.d.prog.pits, 1);
    kill('goblin', { def: { ...mobDef('goblin'), lvl: relevel(13) }, origin: 'loose' }); assert.equal(b.d.prog.pits, 1, 'los sueltos no son de pit');
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
    const faction = reg.ensure('pantano_de_merrimead'), safe = reg.ensure('campos_de_sal');
    assert.equal(MAPS.pantano_de_merrimead.pvp, 'faction'); assert.equal(MAPS.campos_de_sal.pvp, 'off');
    const a = mk(faction, 'sol', 'solmar'), v = mk(faction, 'vh', 'vhar'), ally = mk(faction, 'sol2', 'solmar');
    a.econ!.lvl = 10; v.econ!.lvl = 4; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, '6 niveles abajo no cuenta');
    ally.econ!.lvl = 10; credit(faction, ally, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, 'misma nación no cuenta');
    v.econ!.lvl = 5; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 1); assert.ok(a.econ!.qb!.d.done.includes('frontera'), 'se cobra solo');
    a.econ!.qb!.d.prog.frontera = 0; a.econ!.qb!.d.done = []; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, 'al mismo rival se le cuenta una vez por día');
    const b = mk(safe, 'sol', 'solmar'), w2 = mk(safe, 'vh', 'vhar'); credit(safe, w2, b); assert.equal(b.econ!.qb!.d.prog.frontera, 0, 'sin PvP en el mapa no cuenta');
});

// ---------- quests en party [DM]: en Dreadmyst las muertes de un compañero no contaban y la gente dejaba de agruparse ----------
function partyWorld(mapId: string, names: string[], faction = 'solmar') {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure(mapId);
    const mk = (name: string, fac = faction) => {
        const sid = `s-${name}`, persisted: PersistedPlayer = { mapId: w.mapId, worldId: w.mapId, x: MAPS[mapId].spawn.x, y: MAPS[mapId].spawn.y, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true };
        w.playerConnected(sid, name, () => {}, () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(sid, `acc-${name}`);
        w.onClientSave(sid, JSON.stringify({ cls: 'guerrero', faction: fac }));
        w.handleClientPacket(sid, { payload: { $case: 'changePlayerProfileRequest', value: { profile: `${fac};guerrero;` } } } as never);
        return w.playerOf(sid)!;
    };
    const ps = names.map((n) => mk(n));
    const svc = new PartyService({
        sessionByName: (n) => ps.find((p) => p.characterName === n)?.sessionId, send: () => {},
        info: (sid) => ({ name: ps.find((p) => p.sessionId === sid)!.characterName, faction, level: 5, hp: 100, maxHp: 100, mp: 0, maxMp: 0, map: mapId, online: true }),
    });
    setParties(svc);
    for (const p of ps.slice(1)) { svc.handle(ps[0].sessionId, 'invite', p.characterName); svc.handle(p.sessionId, 'accept', ''); }
    return { w, ps, mk };
}

test('quests en party: el mob que mata un compañero cuenta para todos los cercanos, también para el que está muerto', () => {
    const q = MAIN_QUESTS[0], goal = q.goals[0]; assert.equal(goal.k, 'kill');
    const { w, ps: [A, B, C, D] } = partyWorld((goal.k === 'kill' && goal.map) || 'campos_de_sal', ['ana', 'beto', 'caro', 'dani']);
    try {
        const sim = (w as unknown as { mobSim: { detail(): { id: number; type: MobType }[]; skillHit(p: unknown, id: number, dmg: number): void } }).mobSim;
        const target = sim.detail().find((m) => goal.k === 'kill' && goal.mobs.includes(m.type)); assert.ok(target, 'hay un mob del objetivo en el mapa');
        for (const p of [A, B, C, D]) { const b = p.econ!.qb!; b.m = { i: 0, st: 'active', prog: [0] }; b.d.ids = []; p.econ!.lvl = 1; }
        B.setPosition(A.posX + 3, A.posY); C.setPosition(A.posX, A.posY + 3); D.setPosition(A.posX + 40, A.posY);
        C.hp = 0; // muerto, cerca
        const exp0 = C.econ!.exp, gold0 = C.econ!.gold, bag0 = C.econ!.bag.length;
        sim.skillHit(A, target!.id, 999_999);
        assert.equal(A.econ!.qb!.m.prog[0], 1, 'el que lo mató');
        assert.equal(B.econ!.qb!.m.prog[0], 1, 'el compañero vivo cerca');
        assert.equal(C.econ!.qb!.m.prog[0], 1, 'el compañero muerto cerca también avanza la misión');
        assert.equal(D.econ!.qb!.m.prog[0], 0, 'el que está lejos (más de 20 celdas) no');
        assert.equal(C.econ!.exp, exp0, 'el muerto no cobra exp'); assert.equal(C.econ!.gold, gold0, 'ni oro'); assert.equal(C.econ!.bag.length, bag0, 'ni ítems');
        assert.equal(C.hp, 0, 'sigue muerto');
    } finally { setParties(undefined); }
});

test('quests en party: un encargo que se cobra estando muerto puede subir de nivel pero no revive', () => {
    const { w, ps: [A, B] } = partyWorld('campos_de_sal', ['ana', 'beto']);
    try {
        const sim = (w as unknown as { mobSim: { detail(): { id: number }[]; skillHit(p: unknown, id: number, dmg: number): void } }).mobSim;
        const st = B.econ!; st.lvl = 1; st.exp = expToLevel(1) - 1; // a 1 de exp de subir
        st.qb!.d = { day: questDay(Date.now()), ids: ['mutante'], prog: { mutante: 0 }, done: [], ess: false, pvp: [] };
        B.setPosition(A.posX + 2, A.posY); B.hp = 0;
        const m = sim.detail()[0];
        (sim as unknown as { mobs: Map<number, { traits: number }> }).mobs.get(m.id)!.traits |= TRAIT_MUTANT;
        sim.skillHit(A, m.id, 999_999);
        assert.ok(st.qb!.d.done.includes('mutante'), 'el encargo se cobró');
        assert.equal(st.lvl, 2, 'subió de nivel');
        assert.equal(B.hp, 0, 'pero sigue muerto');
    } finally { setParties(undefined); }
});

test('quests en party: el encargo PvP le cuenta a cada compañero cerca con sus propias reglas', () => {
    const { w, ps: [A, B, C], mk } = partyWorld('pantano_de_merrimead', ['sol', 'sol2', 'sol3']);
    try {
        const V = mk('vh', 'vhar');
        for (const p of [A, B, C, V]) { p.econ!.lvl = 10; p.econ!.qb!.d = { day: questDay(Date.now()), ids: ['frontera'], prog: { frontera: 0 }, done: [], ess: false, pvp: [] }; }
        C.econ!.lvl = 20; // la víctima está 10 niveles abajo de C: a él no le cuenta
        B.setPosition(A.posX + 2, A.posY); C.setPosition(A.posX, A.posY + 2);
        (w as unknown as { pvpQuestCredit(v: unknown, id: bigint): void }).pvpQuestCredit(V, A.playerId);
        assert.ok(A.econ!.qb!.d.done.includes('frontera'));
        assert.ok(B.econ!.qb!.d.done.includes('frontera'), 'el compañero cerca también');
        assert.equal(C.econ!.qb!.d.prog.frontera, 0, 'a cada uno con su regla de nivel');
    } finally { setParties(undefined); }
});

test('encargo de dungeon: al cumplirlo devuelve una llave de ese dungeon, una sola vez por día', () => {
    const { st, kill } = setup();
    st.lvl = 15; st.mats = {};
    st.qb!.d = { day: questDay(Date.now()), ids: ['dia_d3'], prog: { dia_d3: 0 }, done: [], ess: true, pvp: [] };
    kill('caballero_cripta', { origin: 'dungeon', map: DUNGEON_MAP.d3 });
    assert.ok(st.qb!.d.done.includes('dia_d3'));
    assert.equal(st.mats[DUNGEON_KEY.d3], 1, 'una llave para volver a entrar');
    kill('caballero_cripta', { origin: 'dungeon', map: DUNGEON_MAP.d3 });
    assert.equal(st.mats[DUNGEON_KEY.d3], 1, 'la segunda corrida del día no da otra');
    for (const d of DUNGEON_IDS) assert.ok(DUNGEON_KEY[d] && KEY_MAT_NAMES[DUNGEON_KEY[d]], `${d} tiene llave`);
});
