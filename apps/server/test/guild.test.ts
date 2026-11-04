// Pruebas de guilds (docs/GUILDS.md). Correr: cd apps/server && npx tsx --test test/guild.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerMessage, type DepositRequest } from '@fdn/proto';
import { GUILD_CREATE_GOLD, GUILD_MAX, GUILD_MIN_LEVEL, GUILD_STORAGE_KEY, GUILD_VAULT_SLOTS, GuildService, parseCrest, type GuildInfo } from '../src/guild.ts';
import { Depot, NO_TAKE_TEXT, type Actor } from '../src/deposit.ts';
import { newEcon, type Econ } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';

class MemStorage implements Storage {
    data = new Map<string, AccountRecord>(); flushes = 0;
    get(k: string) { return this.data.get(k); }
    put(k: string, r: AccountRecord) { this.data.set(k, r); }
    flush() { this.flushes++; }
}

function setup(storage = new MemStorage()) {
    const people = new Map<string, GuildInfo>(), inbox = new Map<string, ServerMessage[]>(), tags = new Map<string, string>(); let t = 1_000_000;
    const add = (sid: string, name: string, o: Partial<GuildInfo> = {}) => {
        const econ = newEcon('guerrero', o.faction ?? 'solmar'); econ.gold = 20_000; econ.lvl = o.level ?? 15; econ.bag = [];
        const key = `c_${sid}`;
        storage.put(key, { name, salt: '', hash: '', created: 0, lastLogin: 0, econ });
        people.set(sid, { key, name, faction: o.faction ?? 'solmar', level: econ.lvl, cls: 'guerrero', map: 'solmar', online: true, econ, ...o });
        inbox.set(sid, []);
        return { key, econ };
    };
    const svc = new GuildService({
        sessionByName: (n) => [...people].find(([, i]) => i.online && i.name.toLowerCase() === n.toLowerCase())?.[0],
        sessionByKey: (k) => [...people].find(([, i]) => i.key === k)?.[0],
        send: (sid, m) => { inbox.get(sid)?.push(m); },
        info: (sid) => people.get(sid), now: () => t,
        tagChanged: (sid, tag) => tags.set(sid, tag),
    }, storage);
    svc.log = () => {};
    const texts = (sid: string) => inbox.get(sid)!.flatMap((m) => (m.payload?.$case === 'sendMessage' ? [m.payload.value.message] : m.payload?.$case === 'serverChatMessage' ? [m.payload.value.text] : []));
    const state = (sid: string) => { const l = inbox.get(sid)!.filter((m) => m.payload?.$case === 'guildState'); const last = l[l.length - 1]; return last?.payload?.$case === 'guildState' ? last.payload.value : undefined; };
    const has = (sid: string, re: RegExp) => texts(sid).some((x) => re.test(x));
    const dp = new Depot(storage); dp.log = () => {}; dp.guildHost = (k) => svc.vaultHost(k);
    return { svc, add, texts, state, has, people, inbox, tags, storage, dp, advance: (ms: number) => { t += ms; } };
}
const found = (s: ReturnType<typeof setup>, sid: string, name = 'Los Cuervos', tag = 'CRV') => s.svc.handle(sid, 'create', name, tag);
const join = (s: ReturnType<typeof setup>, from: string, to: string, name: string) => { s.svc.handle(from, 'invite', name, ''); s.svc.handle(to, 'accept', '', ''); };

test('guild: fundar cobra el oro, exige nivel y valida nombre y etiqueta', () => {
    const s = setup(); const a = s.add('a', 'Ana'); s.add('n', 'Novato', { level: 3 });
    s.svc.handle('n', 'create', 'Los Novatos', 'NOV'); assert.ok(s.has('n', new RegExp(`nivel ${GUILD_MIN_LEVEL}`)));
    s.svc.handle('a', 'create', 'X', 'CRV'); assert.ok(s.has('a', /3 a 20/));
    s.svc.handle('a', 'create', 'Los Cuervos', 'cuervos'); assert.ok(s.has('a', /2 a 4/));
    found(s, 'a');
    assert.equal(a.econ.gold, 20_000 - GUILD_CREATE_GOLD);
    const st = s.state('a')!; assert.equal(st.name, 'Los Cuervos'); assert.equal(st.tag, 'CRV'); assert.equal(st.myRank, 'lider'); assert.equal(st.members.length, 1); assert.equal(st.maxMembers, GUILD_MAX);
    assert.equal(s.tags.get('a'), 'CRV');
    assert.equal(s.svc.tagOf(a.key), 'CRV');
    // la guild quedó escrita en el registro propio del Storage
    assert.ok((s.storage.get(GUILD_STORAGE_KEY) as AccountRecord & { guilds?: { guilds: unknown[] } }).guilds!.guilds.length === 1);
    s.svc.handle('a', 'create', 'Otra', 'OTR'); assert.ok(s.has('a', /Ya estás en una guild/));
});

test('guild: nombre y etiqueta únicos (sin importar mayúsculas ni tildes)', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto');
    found(s, 'a', 'Dragón Rojo', 'DR');
    s.svc.handle('b', 'create', 'dragon rojo', 'XX'); assert.ok(s.has('b', /ese nombre/));
    s.svc.handle('b', 'create', 'Otro', 'dr'); assert.ok(s.has('b', /esa etiqueta/));
});

test('guild: invitar y aceptar; solo misma nación, solo líder/oficiales, tope de miembros', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto'); s.add('v', 'Vera', { faction: 'vhar' }); s.add('c', 'Cami');
    found(s, 'a');
    s.svc.handle('a', 'invite', 'Vera', ''); assert.ok(s.has('a', /tu nación/));
    s.svc.handle('b', 'invite', 'Cami', ''); assert.ok(s.has('b', /No tenés guild/));
    s.svc.handle('a', 'invite', 'Beto', '');
    const inv = s.inbox.get('b')!.find((m) => m.payload?.$case === 'guildInvited');
    assert.ok(inv && inv.payload?.$case === 'guildInvited' && inv.payload.value.guildName === 'Los Cuervos' && inv.payload.value.fromName === 'Ana');
    s.svc.handle('b', 'accept', '', '');
    assert.equal(s.state('b')!.myRank, 'miembro'); assert.equal(s.state('a')!.members.length, 2);
    assert.ok(s.has('a', /Beto se unió/)); assert.equal(s.tags.get('b'), 'CRV');
    s.svc.handle('b', 'invite', 'Cami', ''); assert.ok(s.has('b', /Solo el líder y los oficiales invitan/));
    s.svc.handle('a', 'promote', 'Beto', ''); assert.equal(s.state('b')!.myRank, 'oficial'); assert.ok(s.has('a', /Beto ascendió a oficial/));
    s.svc.handle('b', 'invite', 'Cami', ''); s.svc.handle('c', 'accept', '', ''); assert.equal(s.state('a')!.members.length, 3);
});

test('guild: la invitación vence, rechazar avisa, y un invitado que ya tiene guild no entra', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto');
    found(s, 'a');
    s.svc.handle('a', 'invite', 'Beto', ''); s.advance(61_000); s.svc.tick();
    assert.ok(s.has('a', /Beto no respondió/));
    s.svc.handle('b', 'accept', '', ''); assert.ok(s.has('b', /No tenés invitaciones/));
    s.svc.handle('a', 'invite', 'Beto', ''); s.svc.handle('b', 'decline', '', ''); assert.ok(s.has('a', /Beto rechazó/));
    assert.equal(s.state('a')!.members.length, 1);
});

test('guild: expulsar (el oficial solo a miembros), bajar de rango, ceder el liderazgo y salir', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto'); s.add('c', 'Cami'); s.add('d', 'Dani');
    found(s, 'a'); join(s, 'a', 'b', 'Beto'); join(s, 'a', 'c', 'Cami'); join(s, 'a', 'd', 'Dani');
    s.svc.handle('a', 'promote', 'Beto', ''); s.svc.handle('a', 'promote', 'Cami', '');
    s.svc.handle('b', 'kick', 'Cami', ''); assert.ok(s.has('b', /solo puede expulsar miembros/)); assert.equal(s.state('a')!.members.length, 4);
    s.svc.handle('b', 'kick', 'Dani', ''); assert.equal(s.state('a')!.members.length, 3); assert.ok(s.has('d', /te expulsó/)); assert.equal(s.tags.get('d'), '');
    assert.deepEqual(s.state('d')!.members, []); assert.equal(s.state('d')!.id, '');
    s.svc.handle('a', 'demote', 'Cami', ''); assert.equal(s.state('c')!.myRank, 'miembro');
    s.svc.handle('b', 'leader', 'Cami', ''); assert.ok(s.has('b', /Solo el líder puede ceder/));
    s.svc.handle('a', 'leave', '', ''); assert.ok(s.has('a', /cedé el liderazgo/));
    s.svc.handle('a', 'leader', 'Beto', ''); assert.equal(s.state('b')!.myRank, 'lider'); assert.equal(s.state('a')!.myRank, 'oficial');
    s.svc.handle('a', 'leave', '', ''); assert.ok(s.has('a', /Saliste/)); assert.equal(s.state('b')!.members.length, 2); assert.equal(s.tags.get('a'), '');
});

test('guild: lista de miembros con conectados primero, rango, última conexión y avisos de conexión', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto'); s.add('c', 'Cami');
    found(s, 'a'); join(s, 'a', 'b', 'Beto'); join(s, 'a', 'c', 'Cami');
    // Beto estaba desconectado (la lista ya lo sabía) y entra al mundo: aviso a los demás
    s.people.get('b')!.online = false; s.svc.tick(); s.people.get('b')!.online = true;
    s.svc.connected('b');
    assert.ok(s.has('a', /Beto se conectó/)); assert.ok(!s.has('b', /Beto se conectó/));
    // Beto se desconecta: queda último con su última conexión; los demás reciben el aviso
    s.svc.disconnected('b'); s.people.get('b')!.online = false;
    assert.ok(s.has('a', /Beto se desconectó/));
    const rows = s.state('a')!.members;
    assert.deepEqual(rows.map((m) => m.name), ['Ana', 'Cami', 'Beto']);
    assert.equal(rows[0].rank, 'lider'); assert.ok(rows[0].online); assert.equal(Number(rows[0].lastSeenMs), 0);
    assert.ok(!rows[2].online); assert.equal(Number(rows[2].lastSeenMs), 1_000_000);
    // al reconectar dentro de la gracia no se repite el aviso; al volver de verdad, sí
    s.people.get('b')!.online = true; s.inbox.set('a', []);
    s.svc.connected('b'); assert.ok(s.has('a', /Beto se conectó/));
    s.inbox.set('a', []); s.svc.connected('b'); assert.ok(!s.has('a', /se conectó/));
    // subir de nivel se refleja en el próximo tick sin que nadie pida nada
    s.people.get('c')!.level = 20; s.inbox.set('a', []); s.svc.tick();
    assert.equal(s.state('a')!.members.find((m) => m.name === 'Cami')!.level, 20);
    s.inbox.set('a', []); s.svc.tick(); assert.equal(s.state('a'), undefined); // sin cambios, no se manda nada
});

test('guild: escudo y lema (solo líder / oficiales), chat de guild y disolver con el cofre vacío', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto');
    found(s, 'a'); join(s, 'a', 'b', 'Beto');
    assert.equal(parseCrest('1,2,3,4'), '1,2,3,4'); assert.equal(parseCrest('9,0,0,0'), null); assert.equal(parseCrest('1,2,3'), null); assert.equal(parseCrest('a,b,c,d'), null);
    s.svc.handle('b', 'crest', '', '1,2,3,4'); assert.ok(s.has('b', /Solo el líder cambia el escudo/));
    s.svc.handle('a', 'crest', '', '1,2,3,4'); assert.equal(s.state('b')!.crest, '1,2,3,4');
    s.svc.handle('b', 'motd', '', 'Hola'); assert.ok(s.has('b', /Solo el líder y los oficiales cambian el lema/));
    s.svc.handle('a', 'motd', '', '  Farmeamos   a las 22 '); assert.equal(s.state('b')!.motd, 'Farmeamos a las 22');
    assert.ok(s.svc.chat('a', 'hola guild', 'Ana', '7'));
    const chat = s.inbox.get('b')!.find((m) => m.payload?.$case === 'serverChatMessage' && m.payload.value.text === 'hola guild');
    assert.ok(chat && chat.payload?.$case === 'serverChatMessage' && chat.payload.value.channel === 'guild');
    assert.equal(s.svc.onlineMembers('a').sort().join(), 'a,b');
    s.add('z', 'Zoe'); assert.ok(!s.svc.chat('z', 'x', 'Zoe'));
    s.svc.handle('b', 'disband', '', ''); assert.ok(s.has('b', /Solo el líder puede disolver/));
    s.svc.handle('a', 'disband', '', ''); assert.ok(s.has('b', /se disolvió/)); assert.equal(s.state('b')!.id, ''); assert.equal(s.tags.get('a'), ''); assert.equal(s.svc.guilds.length, 0);
});

const give = (e: Econ, n = 'Espada larga', r = 2): number => { const u = e.nextUid++; e.bag.push({ u, n, r, a: [{ id: 'crit', v: 4 }] }); return u; };
const actor = (s: ReturnType<typeof setup>, sid: string): Actor => { const i = s.people.get(sid)!; return { key: i.key, name: i.name, econ: i.econ! }; };
const req = (o: Partial<DepositRequest>): DepositRequest => ({ npcId: '', action: 'open', uid: 0, amount: 0, stack: '', opId: 0, scope: 'guild', ...o });

test('cofre de guild: todos guardan, solo líder y oficiales retiran; registro de movimientos y estado con scope', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto');
    found(s, 'a'); join(s, 'a', 'b', 'Beto');
    const a = actor(s, 'a'), b = actor(s, 'b');
    assert.equal(s.svc.vaultHost('c_nadie'), null);
    const u = give(b.econ, 'Mandoble', 3);
    assert.equal(s.dp.apply(b, req({ action: 'put', uid: u, opId: 1 }), s.svc.vaultHost(b.key))!.ok, true);
    assert.equal(b.econ.bag.length, 0);
    const host = s.svc.vaultHost(b.key)!; assert.equal(host.v.items.length, 1); assert.equal(host.canTake, false);
    // el miembro no puede retirar
    const r = s.dp.apply(b, req({ action: 'take', uid: host.v.items[0].u, opId: 2 }), host)!; assert.equal(r.ok, false); assert.equal(r.text, NO_TAKE_TEXT);
    assert.equal(s.dp.apply(b, req({ action: 'gold_in', amount: 500, opId: 3 }), host)!.ok, true); assert.equal(host.v.gold, 500);
    assert.equal(s.dp.apply(b, req({ action: 'gold_out', amount: 100, opId: 4 }), host)!.ok, false);
    // el líder sí
    const ha = s.svc.vaultHost(a.key)!; assert.equal(ha.canTake, true);
    assert.equal(s.dp.apply(a, req({ action: 'take', uid: ha.v.items[0].u, opId: 5 }), ha)!.ok, true); assert.equal(a.econ.bag[0].n, 'Mandoble'); assert.equal(a.econ.bag[0].r, 3);
    assert.equal(s.dp.apply(a, req({ action: 'gold_out', amount: 100, opId: 6 }), ha)!.ok, true); assert.equal(ha.v.gold, 400);
    // reenvío: el mismo op no se aplica dos veces
    assert.equal(s.dp.apply(a, req({ action: 'gold_out', amount: 100, opId: 6 }), ha)!.code, 'dup'); assert.equal(ha.v.gold, 400);
    const st = s.dp.stateMessage(a.key, ha); assert.ok(st.payload?.$case === 'depositState');
    if (st.payload?.$case === 'depositState') {
        assert.equal(st.payload.value.scope, 'guild'); assert.equal(st.payload.value.capacity, GUILD_VAULT_SLOTS); assert.equal(st.payload.value.canTake, true); assert.equal(st.payload.value.gold, 400);
        assert.deepEqual(st.payload.value.log.slice(0, 2), ['Ana retiró 100 de oro', 'Ana retiró Mandoble']);
    }
    // el depósito de la cuenta no se mezcla con el cofre
    assert.equal(s.dp.vault(a.key).items.length, 0); assert.equal(s.dp.vault(a.key).gold, 0);
    // con cosas en el cofre no se disuelve
    s.svc.handle('a', 'disband', '', ''); assert.ok(s.has('a', /vaciálo/)); assert.equal(s.svc.guilds.length, 1);
});

test('guild: persiste y se recarga desde el Storage (miembros, rango, escudo y cofre)', () => {
    const storage = new MemStorage(); const s = setup(storage); s.add('a', 'Ana'); s.add('b', 'Beto');
    found(s, 'a'); join(s, 'a', 'b', 'Beto'); s.svc.handle('a', 'promote', 'Beto', ''); s.svc.handle('a', 'crest', '', '2,3,4,5');
    const b = actor(s, 'b'); s.dp.apply(b, req({ action: 'gold_in', amount: 50, opId: 9 }), s.svc.vaultHost(b.key));
    const s2 = setup(storage); s2.add('a', 'Ana'); s2.add('b', 'Beto');
    assert.equal(s2.svc.guilds.length, 1);
    assert.equal(s2.svc.memberOf('c_b')!.rank, 'oficial'); assert.equal(s2.svc.tagOf('c_a'), 'CRV');
    s2.svc.handle('b', 'info', '', ''); const st = s2.state('b')!; assert.equal(st.crest, '2,3,4,5'); assert.equal(st.myRank, 'oficial');
    assert.equal(s2.svc.vaultHost('c_b')!.v.gold, 50); assert.equal(s2.svc.vaultHost('c_b')!.canTake, true);
});

test('guild: borrar un personaje lo saca de la guild; el líder con gente o con cofre lleno no se puede borrar', () => {
    const s = setup(); s.add('a', 'Ana'); s.add('b', 'Beto');
    found(s, 'a'); join(s, 'a', 'b', 'Beto');
    assert.match(s.svc.characterDeleted('c_a'), /líder/);
    assert.equal(s.svc.characterDeleted('c_b'), ''); assert.equal(s.state('a')!.members.length, 1);
    const a = actor(s, 'a'); s.dp.apply(a, req({ action: 'gold_in', amount: 10, opId: 1 }), s.svc.vaultHost(a.key));
    assert.match(s.svc.characterDeleted('c_a'), /cofre/);
    s.dp.apply(a, req({ action: 'gold_out', amount: 10, opId: 2 }), s.svc.vaultHost(a.key));
    assert.equal(s.svc.characterDeleted('c_a'), ''); assert.equal(s.svc.guilds.length, 0);
});
