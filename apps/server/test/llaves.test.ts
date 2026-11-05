/**
 * Llaves de las mazmorras (docs/LLAVES.md): receta, puertas con llave, una por jugador, cadena D1 → llave gastada → D2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { DUNGEON_ENTRY_KEYS, KEY_RECIPES, MOBS, QUEST_MATS, findLink, getMapDef, keyMissing, linkGateReason, itemBandOfLevel } from '@fdn/world';
import { loadSettings } from '../src/config.ts';
import { Economy, type EconCtx } from '../src/economy.ts';
import { PartyService, setParties } from '../src/party.ts';
import type { PersistedPlayer } from '../src/player.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { progressFromEcon } from '../src/systems/pvpCombat.ts';

const settings = loadSettings();
class MemStorage implements Storage {
    private m = new Map<string, AccountRecord>();
    get(k: string) { return this.m.get(k); }
    put(k: string, r: AccountRecord) { this.m.set(k, r); }
    flush() {}
}
const save = () => {};
const ctx: EconCtx = { npcs: [], restat: () => {}, ground: { add: () => {} } as never };
const DOOR = findLink('canon_goblin', 'canon_goblin_a_cueva_goblin')!;

function setup(names: string[]) {
    const mem = new MemStorage(), eco = new Economy(mem), reg = new WorldRegistry({ settings, economy: eco });
    const w = reg.ensure('canon_goblin');
    const js = names.map((name, i) => {
        const log: ServerMessage[] = [], session: TransferSession = { sessionId: `s-${name}`, worldId: w.id };
        const persisted = { mapId: w.mapId, worldId: w.mapId, x: DOOR.x, y: DOOR.y + (i ? 1 : 0), direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true, attackMode: true } as PersistedPlayer;
        w.playerConnected(session.sessionId, name, (m) => log.push(m), () => {}, persisted);
        mem.put(`acc-${name}`, { name, salt: '', hash: '', created: 0, lastLogin: 0 });
        w.bindAccount(session.sessionId, `acc-${name}`);
        w.onClientSave(session.sessionId, JSON.stringify({ cls: 'paladin', faction: 'solmar' }));
        const p = w.playerOf(session.sessionId)!;
        p.econ!.lvl = 5; p.econ!.gold = 1000;
        const sync = () => { p.prog = progressFromEcon(p.econ); };
        sync();
        return { name, session, log, p, sync };
    });
    reg.sessionHook = (sid) => { const j = js.find((x) => x.session.sessionId === sid); return j && { session: j.session, save }; };
    return { eco, reg, w, js };
}
const lastText = (log: ServerMessage[]) => JSON.stringify(log.filter((m) => ['econResult', 'sendMessage'].includes(m.payload?.$case ?? '')).at(-1)?.payload);

test('las puertas de D1 y D2 piden su llave; los pasos entre pisos, no', () => {
    assert.equal(DOOR.gate?.key, 'llave_cueva');
    const nido = getMapDef('altas_de_nazia')!.links.find((l) => l.to.map === 'nido_hormiga_leon')!;
    assert.equal(nido.gate?.key, 'llave_nido');
    for (const id of ['cueva_goblin', 'minas_goblin', 'nido_hormiga_leon', 'ruinas_de_stormrock']) {
        for (const l of getMapDef(id)!.links) assert.equal(l.gate?.key, undefined, `${l.id} no pide llave`);
    }
    assert.match(linkGateReason(DOOR, { qi: 0, lvl: 5, keys: {}, unlocked: [] }) ?? '', /Llave de la cueva/);
    assert.equal(linkGateReason(DOOR, { qi: 0, lvl: 5, keys: { llave_cueva: 1 }, unlocked: [] }), null);
});

test('receta: 8 colmillos + 60 de oro arman la llave de la cueva, en cualquier lado; si falta algo, avisa qué', () => {
    const { eco, js: [A] } = setup(['ana']);
    const st = A.p.econ!;
    st.mats = { colmillo: 5 }; st.gold = 50;
    eco.quest(A.p, ctx, '', 'combine', 'llave_cueva');
    assert.match(lastText(A.log), /3 colmillos.*10 de oro/);
    assert.equal(st.mats.llave_cueva ?? 0, 0);
    st.mats.colmillo = 9; st.gold = 100;
    eco.quest(A.p, ctx, '', 'combine', 'llave_cueva');
    assert.equal(st.mats.llave_cueva, 1); assert.equal(st.mats.colmillo, 1); assert.equal(st.gold, 40);
    assert.equal(progressFromEcon(st).keys.llave_cueva, 1, 'la llave cuenta para las puertas');
    assert.equal(keyMissing('llave_nido', { llave_gastada: 1, esencia: 1 }, 120), null);
    assert.match(keyMissing('llave_nido', { esencia: 1 }, 500) ?? '', /llave gastada/);
    assert.deepEqual(KEY_RECIPES.llave_nido.mats, { llave_gastada: 1, esencia: 1 });
});

test('sin llave no se entra; con llave se entra y se gasta una sola vez aunque lleguen dos pedidos', () => {
    const { reg, js: [A] } = setup(['ana']);
    assert.match(reg.handlePortal(A.session, DOOR.id, save) ?? '', /sellado/);
    assert.equal(A.session.worldId, 'canon_goblin');
    A.p.econ!.mats = { llave_cueva: 2 }; A.sync();
    assert.equal(reg.handlePortal(A.session, DOOR.id, save), null);
    assert.equal(reg.handlePortal(A.session, DOOR.id, save), null, 'el segundo pedido se ignora');
    assert.match(A.session.worldId, /^cueva_goblin#/);
    assert.equal(A.p.econ!.mats!.llave_cueva, 1, 'gastó una');
});

test('party: cada uno gasta la suya; el que no tiene llave se queda afuera con aviso', () => {
    const { reg, js: [A, B] } = setup(['ana', 'beto']);
    const svc = new PartyService({
        sessionByName: (n) => [A, B].find((j) => j.name === n.toLowerCase())?.session.sessionId, send: () => {},
        info: (sid) => ({ name: [A, B].find((j) => j.session.sessionId === sid)!.name, faction: 'solmar', level: 5, hp: 100, maxHp: 100, mp: 0, maxMp: 0, map: 'canon_goblin', online: true }),
    });
    setParties(svc);
    try {
        svc.handle(A.session.sessionId, 'invite', 'beto'); svc.handle(B.session.sessionId, 'accept', '');
        A.p.econ!.mats = { llave_cueva: 1 }; A.sync();
        reg.handlePortal(A.session, DOOR.id, save);
        assert.match(A.session.worldId, /^cueva_goblin#/); assert.equal(B.session.worldId, 'canon_goblin');
        assert.match(lastText(B.log), /sellado/);
        assert.equal(A.p.econ!.mats!.llave_cueva, 0);
    } finally { setParties(undefined); }
});

test('el jefe de D1 suelta una llave gastada a cada uno, solo si muere en su piso', () => {
    const { eco, js: [A] } = setup(['ana']);
    const st = A.p.econ!; st.mats = {};
    const kill = (map: string) => eco.reward(A.p, ctx, { mobId: 1, type: 'goblin_jefe', def: MOBS.goblin_jefe, zoneName: 'Jefe', origin: 'dungeon', x: 0, y: 0, traits: 0, map });
    kill('canon_goblin');
    assert.equal(st.mats.llave_gastada ?? 0, 0, 'fuera de su piso no cuenta');
    kill('minas_goblin');
    assert.equal(st.mats.llave_gastada, 1);
    assert.ok(A.log.some((m) => m.payload?.$case === 'econResult' && /Llave gastada/.test(m.payload.value.text)));
});

test('los siete dungeons tienen llave: puerta cerrada, receta, y el material cae en los pits del mapa de la entrada', () => {
    const entries: Record<string, string> = { cueva_goblin: 'canon_goblin', nido_hormiga_leon: 'altas_de_nazia', cripta_olvidada: 'cementerio_de_lochport', torre_del_hechicero: 'la_brecha', templo_de_mez: 'cenizas_ii', fortaleza_infernal: 'cenizas_iii', fuerte_amir: 'lago_kuuma' };
    assert.deepEqual(Object.keys(DUNGEON_ENTRY_KEYS).sort(), Object.keys(entries).sort());
    for (const [dungeon, surface] of Object.entries(entries)) {
        const key = DUNGEON_ENTRY_KEYS[dungeon], r = KEY_RECIPES[key];
        assert.ok(r, `${dungeon}: receta`);
        const door = getMapDef(surface)!.links.find((l) => l.to.map === dungeon)!;
        assert.equal(door.gate?.key, key, `${surface} → ${dungeon} pide ${key}`);
        // cada material de pit de la receta cae en los pits del mapa de la entrada
        const pitTiers = new Set<number>(getMapDef(surface)!.build().zones.filter((z) => z.respawn === 10).map((z) => itemBandOfLevel(z.lvl ?? 0)));
        for (const m of Object.keys(r.mats)) if (QUEST_MATS[m]) assert.ok(pitTiers.has(QUEST_MATS[m].tier), `${m} (T${QUEST_MATS[m].tier}) cae en ${surface}`);
    }
});
