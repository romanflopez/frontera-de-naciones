/** Misiones del corte del MVP (@fdn/world quests.ts): cadena de 5, encargos del día y repetible, validados en el server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import {
    DAILY_QUESTS, MAIN_QUESTS, MAPS, REPEAT_MATS, applyQuestEvent, buildMap, cleanQuestBook, dailyEligible, expToLevel, mobDef, msToReset,
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
    assert.match(kill('campos_de_sal').join(), /Misión lista/); assert.equal(b.m.st, 'ready');

    const h = newQuestBook(); h.m.i = 1; h.m.st = 'active'; h.m.prog = [0];
    applyQuestEvent(h, null, none); assert.equal(h.m.st, 'active');
    assert.match(applyQuestEvent(h, null, { mats: {}, maxUp: 1 }).join(), /Misión lista/, 'un ítem en +1, mejorado antes o después de aceptar');

    const c = newQuestBook(); c.m.i = 2; c.m.st = 'active'; c.m.prog = [0];
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

test('cadena completa en el server: de Campos de Sal a la Reina, con premios y elección de ítem', () => {
    const { p, st, ask, kill, eco, smith, smithy, ctxOf, unthrottle, log } = setup();
    const rnd = Math.random;
    try {
        Math.random = () => 0.99; // sin drops al azar (ni colmillos, ni pociones) para contar exacto
        assert.equal(ask('m_turnin').code, 'quest_state');
        assert.equal(ask('m_accept').ok, true);
        for (let i = 0; i < 9; i++) kill('goblin');
        kill('goblin', { map: 'bosque_de_piedra' }); // otro mapa: no cuenta
        assert.equal(st.qb!.m.st, 'active');
        kill('goblin_elite');
        assert.equal(st.qb!.m.st, 'ready');
        // 1) Primeros pasos: exp en % del nivel, oro, 3 piedras y un único T1 de la clase
        st.exp = 0; const lvl = st.lvl, gold = st.gold, forge = st.forge ?? 0, bag = st.bag.length;
        const r1 = ask('m_turnin'); assert.equal(r1.ok, true, r1.text);
        assert.equal(st.forge, forge + 3); assert.equal(st.gold, gold + 150); assert.equal(st.bag.length, bag + 1);
        assert.ok(st.lvl > lvl || st.exp === Math.round(expToLevel(lvl) * 0.25));
        const prize = st.bag.at(-1)!; assert.ok(rewardUniques('class_t1_random', 'guerrero').some((u) => u.name === prize.n));
        assert.equal(st.qb!.m.i, 1); assert.equal(st.qb!.m.st, 'new');

        // 2) El herrero: tener un ítem en +1. Si ya lo mejoró antes de aceptar, queda lista al aceptar
        const sctx = ctxOf(smithy); const home = { x: p.posX, y: p.posY };
        p.setPosition(smith.x + 1, smith.y + 1);
        Math.random = () => 0; // la mejora sale
        unthrottle(); eco.upgrade(p, sctx, smith.id, prize.u);
        assert.equal(prize.up, 1, JSON.stringify(log.filter((m) => m.payload?.$case === 'econResult').slice(-3).map((m) => (m.payload as any).value)));
        p.setPosition(home.x, home.y);
        Math.random = () => 0.99;
        assert.equal(ask('m_accept').ok, true); assert.equal(st.qb!.m.st, 'ready', 'mejorado antes de aceptar también vale');
        assert.equal(ask('m_turnin').ok, true);

        // 3) Colmillos: caen en pits T1 (8 %) y se cuentan; entregar no los gasta (son para la llave)
        assert.equal(ask('m_accept').ok, true);
        Math.random = () => 0.05; // 0,05 < 0,08: cae colmillo (y, de paso, no cae ningún otro botín que dependa de valores más bajos)
        for (let i = 0; i < 8; i++) kill('goblin', { origin: 'pit' });
        Math.random = () => 0.99;
        assert.ok((st.mats?.colmillo ?? 0) >= 8); assert.equal(st.qb!.m.st, 'ready');
        const fangs = st.mats!.colmillo; assert.equal(ask('m_turnin').ok, true); assert.equal(st.mats!.colmillo, fangs);
        kill('goblin', { origin: 'loose' }); assert.equal(st.mats!.colmillo, fangs, 'sueltos no sueltan colmillos');

        // 4) La cueva goblin: pide nivel 3, se completa matando al jefe, y el premio se elige
        st.lvl = 2; assert.equal(ask('m_accept').code, 'quest_lvl');
        st.lvl = 3; st.exp = 0; assert.equal(ask('m_accept').ok, true);
        kill('goblin_jefe', { origin: 'dungeon', map: 'campos_de_sal' }); assert.equal(st.qb!.m.st, 'active', 'el jefe fuera de su piso no cuenta');
        kill('goblin_jefe', { origin: 'dungeon', map: 'minas_goblin' });
        assert.equal(st.qb!.m.st, 'ready');
        const c = ask('m_turnin'); assert.equal(c.code, 'choose'); assert.match(c.text, /Elegí tu premio/);
        assert.equal(ask('m_turnin', 'Vara de raíz').code, 'choose', 'un guerrero no elige el báculo');
        assert.equal(ask('m_turnin', 'Hoja de sal').ok, true); assert.equal(st.bag.at(-1)!.n, 'Hoja de sal');

        // 5) La llave gastada: la Reina, nivel 7, un trofeo de ella a elección
        st.lvl = 7; st.exp = 0; assert.equal(ask('m_accept').ok, true);
        kill('antlion_reina', { origin: 'dungeon', map: 'ruinas_de_stormrock' });
        assert.equal(ask('m_turnin', 'Caparazón de la Reina').ok, true);
        assert.equal(st.qb!.m.i, MAIN_QUESTS.length);
        assert.equal(ask('m_accept').code, 'quest_state', 'la cadena terminó');
    } finally { Math.random = rnd; }
});

test('encargos del día en el server: progreso, la primera entrega da esencia, no se entregan dos veces, no hay cambio', () => {
    const { st, ask, kill, eco, p } = setup();
    const rnd = Math.random;
    try {
        Math.random = () => 0.99;
        st.lvl = 4; eco.snapshot(p); // al entrar se reparten
        const b = st.qb!; assert.deepEqual([...b.d.ids].sort(), dailyEligible(4).map((q) => q.id).sort());
        assert.equal(ask('d_turnin', 'pits').code, 'quest_state');
        for (let i = 0; i < 25; i++) kill('goblin', { def: { ...mobDef('goblin'), lvl: 3 } }); // T2, igual que el jugador
        assert.equal(b.d.prog.pits, 25);
        kill('goblin', { traits: TRAIT_MUTANT, origin: 'loose' }); assert.equal(b.d.prog.mutante, 1);
        const ess = st.mats?.esencia ?? 0;
        const a = ask('d_turnin', 'pits'); assert.equal(a.ok, true, a.text); assert.match(a.text, /Esencia/); assert.equal(st.mats!.esencia, ess + 1);
        assert.equal(ask('d_turnin', 'pits').code, 'quest_state', 'ya entregado');
        const m = ask('d_turnin', 'mutante'); assert.equal(m.ok, true); assert.doesNotMatch(m.text, /Esencia/); assert.equal(st.mats!.esencia, ess + 1);
        assert.equal(ask('d_reroll', 'recolector').code, 'bad_action', 'no hay cambio de encargo');
        assert.equal(ask('accept').code, 'quest_retired', 'la cadena vieja quedó jubilada');
    } finally { Math.random = rnd; }
});

test('pits del encargo: solo cuentan los de tu banda o más alta', () => {
    const { st, kill } = setup();
    st.lvl = 5; const b = st.qb!; b.d = { day: questDay(Date.now()), ids: ['pits'], prog: { pits: 0 }, done: [], ess: false, pvp: [] };
    kill('goblin', { def: { ...mobDef('goblin'), lvl: 1 } }); assert.equal(b.d.prog.pits, 0, 'T1 para alguien T3 no cuenta');
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
    v.econ!.lvl = 5; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 1);
    a.econ!.qb!.d.prog.frontera = 0; credit(faction, v, a); assert.equal(a.econ!.qb!.d.prog.frontera, 0, 'al mismo rival se le cuenta una vez por día');
    const b = mk(safe, 'sol', 'solmar'), w2 = mk(safe, 'vh', 'vhar'); credit(safe, w2, b); assert.equal(b.econ!.qb!.d.prog.frontera, 0, 'sin PvP en el mapa no cuenta');
});
