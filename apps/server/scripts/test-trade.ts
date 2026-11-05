/**
 * Prueba de Dar e Intercambiar con dos jugadores reales contra un server en marcha (ver docs/INTERCAMBIO.md):
 *   DATA_DIR=<carpeta vacía> PORT=8114 FDN_DEBUG_WARP=1 pnpm --filter @fdn/server start
 *   DATA_DIR=<la misma carpeta> npx tsx scripts/test-trade.ts [ws://localhost:8114/ws]
 * Verifica por la red: Dar con aceptación, Dar rechazado, Intercambiar con confirmación de los dos, rechazo por distancia,
 * cuenta que no se duplica ni pierde items, y que lo recibido sigue ahí después de reconectar (se guardó).
 */
import { WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { ClientMessage, ServerMessage } from '@fdn/proto';

const URL = process.argv[2] ?? 'ws://localhost:8114/ws';
const DATA_DIR = process.env.DATA_DIR ?? '';
const RUN = Math.random().toString(36).slice(2, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0, checks = 0;
const check = (ok: boolean, msg: string) => { checks++; if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); };
type Payload = NonNullable<ClientMessage['payload']>;
type Srv = NonNullable<ServerMessage['payload']>;
type Inv = Extract<Srv, { $case: 'inventoryState' }>['value'];
type Res = { ok: boolean; code: string; text: string };
type TState = Extract<Srv, { $case: 'tradeState' }>['value'];
type TInvite = Extract<Srv, { $case: 'tradeInvite' }>['value'];

class Bot {
    ws!: WebSocket; id = 0n; teleports = 0; inv: Inv | null = null; results: Res[] = []; seen = new Set<bigint>();
    state: TState | null = null; invite: TInvite | null = null; states = 0;
    constructor(readonly name: string) {}
    async connect() {
        this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
        let ready!: () => void; const got = new Promise<void>((r) => (ready = r));
        this.ws.on('message', (d: Buffer) => {
            const p = ServerMessage.decode(new Uint8Array(d)).payload as Srv | undefined; if (!p) return;
            switch (p.$case) {
                case 'characterList': this.send(p.value.characters.some((c) => c.name === this.name) ? { $case: 'selectCharacterRequest', value: { name: this.name } } : { $case: 'createCharacterRequest', value: { name: this.name, cls: 'paladin', faction: 'solmar' } }); if (p.value.error) throw new Error(p.value.error); break;
                case 'initialState': this.id = p.value.playerId; break;
                case 'initialGameWorldState': ready(); break;
                case 'inventoryState': this.inv = p.value; break;
                case 'econResult': this.results.push(p.value); break;
                case 'playerTeleported': this.teleports++; break;
                case 'playersEnteredRange': for (const q of p.value.players) this.seen.add(q.playerId); break;
                case 'playersLeftRange': for (const id of p.value.playerIds) this.seen.delete(id); break;
                case 'tradeState': this.state = p.value; this.states++; break;
                case 'tradeInvite': this.invite = p.value; break;
            }
        });
        await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
        this.send({ $case: 'authenticateRequest', value: { id: '', characterName: this.name, password: 'test1234' } });
        await Promise.race([got, sleep(6000).then(() => { throw new Error(`${this.name}: no entró al mundo`); })]);
        await sleep(300);
    }
    send(p: Payload) { this.ws.send(ClientMessage.encode({ payload: p } as ClientMessage).finish()); }
    close() { this.ws.close(); }
    async warp(x: number, y: number) { const n = this.teleports; this.send({ $case: 'playerTeleportRequested', value: { x, y } }); for (let i = 0; i < 40 && this.teleports === n; i++) await sleep(50); return this.teleports > n; }
    async warpNear(x: number, y: number) { for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]]) if (await this.warp(x + dx, y + dy)) return; throw new Error('no pude moverme'); }
    async tx(action: string, extra: Record<string, unknown> = {}) {
        const n = this.results.length;
        this.send({ $case: 'tradeRequest', value: { action, targetId: 0n, uid: 0, amount: 0, opId: 0, ...extra } } as Payload);
        await sleep(350); return this.results.slice(n);
    }
    async refresh(): Promise<Inv> { this.send({ $case: 'econSortRequest', value: {} }); await sleep(300); return this.inv!; }
    async waitSees(o: Bot) { for (let i = 0; i < 60 && !this.seen.has(o.id); i++) await sleep(50); return this.seen.has(o.id); }
}

function seed(name: string, bag: unknown[], gold: number) {
    const dir = join(DATA_DIR, 'accounts'); mkdirSync(dir, { recursive: true });
    const salt = randomBytes(16), key = Buffer.from(name.normalize('NFC').toLowerCase(), 'utf8').toString('hex');
    const character = { v: 1, faction: 'solmar', cls: 'paladin', lvl: 20, exp: 0, gold, hp: 500, mp: 50, bag, eq: { arma: null, armadura: null, cabeza: null, anillo: null },
        q: { i: 0, st: 'new', prog: 0, keys: { cripta: 0, foso: 0 }, shards: { cripta: 0, foso: 0 } }, pots: { hp: 3, mp: 0 }, u: [] };
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ name, salt: salt.toString('hex'), hash: scryptSync('test1234', salt, 32).toString('hex'), created: Date.now(), lastLogin: Date.now(), character: JSON.stringify(character) }));
}
const names = (i: Inv | null) => (i?.bag ?? []).map((x) => x.base).sort().join('|');

async function main() {
    if (!DATA_DIR) throw new Error('Falta DATA_DIR (el mismo del server).');
    const an = `ana${RUN}`, bn = `beto${RUN}`;
    seed(an, [{ n: 'Mandoble', r: 3, a: [{ id: 'hp', v: 20 }] }, { n: 'Espada larga', r: 1, a: [] }], 5000);
    seed(bn, [{ n: 'Maza', r: 1, a: [] }], 1000);
    let a = new Bot(an), b = new Bot(bn); await a.connect(); await b.connect();
    await a.warp(20, 20); await b.warpNear(21, 20);
    check(await a.waitSees(b) && await b.waitSees(a), 'los dos se ven entre sí');
    const before = names(a.inv) + '#' + names(b.inv);
    check(names(a.inv) === 'Espada larga|Mandoble' && names(b.inv) === 'Maza', 'cuentas preparadas');

    // ---------- Dar: sin aceptar no se mueve; al aceptar, sí ----------
    const mand = a.inv!.bag.find((i) => i.base === 'Mandoble')!;
    await a.tx('give', { targetId: b.id, uid: mand.uid });
    check(b.invite?.kind === 'give' && b.invite.fromName === an && b.invite.item?.base === 'Mandoble', 'Beto recibe la invitación de regalo con el item');
    check(names(await a.refresh()) === 'Espada larga|Mandoble', 'sin aceptar, Ana todavía tiene el Mandoble');
    const [r1] = await b.tx('accept');
    void r1; await sleep(300);
    check(names(await a.refresh()) === 'Espada larga' && names(await b.refresh()) === 'Mandoble|Maza', 'al aceptar, el Mandoble pasa de Ana a Beto (con sus atributos)');
    const got = b.inv!.bag.find((i) => i.base === 'Mandoble');
    check(!!got && got.rarity === mand.rarity && JSON.stringify(got.attrs) === JSON.stringify(mand.attrs), `el item llega con la misma rareza y atributos que tenía (r${mand.rarity}, ${JSON.stringify(mand.attrs)}; la importación normaliza el seed)`);
    check(b.results.some((r) => r.ok && r.code === 'got') && a.results.some((r) => r.ok && r.code === 'gave'), 'los dos reciben el resultado');
    const [dup] = await b.tx('accept');
    check(dup && !dup.ok && dup.code === 'gone', 'aceptar de nuevo no hace nada');

    // ---------- Dar rechazado ----------
    const esp = a.inv!.bag.find((i) => i.base === 'Espada larga')!;
    await a.tx('give', { targetId: b.id, uid: esp.uid }); await b.tx('decline');
    check(names(await a.refresh()) === 'Espada larga', 'rechazar un regalo no mueve nada');

    // ---------- Dar oro ----------
    await a.tx('give', { targetId: b.id, amount: 1500 }); await b.tx('accept'); await sleep(200);
    await a.refresh(); await b.refresh();
    check(a.inv!.goldD === 3500 && b.inv!.goldD === 2500, `el oro pasa entero (Ana ${a.inv!.goldD}, Beto ${b.inv!.goldD})`);

    // ---------- Intercambiar ----------
    await a.tx('offer', { targetId: b.id }); await b.tx('accept');
    check(a.state?.open === true && b.state?.open === true && a.state.partner === bn, 'se abre la ventana en los dos');
    const espA = (await a.refresh()).bag.find((i) => i.base === 'Espada larga')!;
    const mazB = (await b.refresh()).bag.find((i) => i.base === 'Maza')!;
    await a.tx('add', { uid: espA.uid }); await b.tx('add', { uid: mazB.uid }); await b.tx('gold', { amount: 200 });
    check(a.state?.theirs.length === 1 && a.state.theirGold === 200 && b.state?.mine.length === 1, 'cada uno ve la oferta del otro');
    await a.tx('confirm');
    check(a.state?.myConfirmed === true && b.state?.theirConfirmed === true, 'la confirmación de Ana le llega a Beto');
    await b.tx('gold', { amount: 300 }); // Beto cambia después de que Ana confirmó
    check(a.state?.myConfirmed === false && b.state?.theirConfirmed === false, 'cambiar la oferta quita la confirmación de Ana');
    await a.tx('confirm'); await b.tx('confirm'); await sleep(300);
    check(a.state?.open === false && b.state?.open === false, 'al confirmar los dos, la ventana se cierra');
    await a.refresh(); await b.refresh();
    check(names(a.inv) === 'Maza' && names(b.inv) === 'Espada larga|Mandoble', `los items cambiaron de lado (Ana: ${names(a.inv)} · Beto: ${names(b.inv)})`);
    check(a.inv!.goldD === 3800 && b.inv!.goldD === 2200, `y el oro (Ana ${a.inv!.goldD}, Beto ${b.inv!.goldD})`);

    // ---------- distancia: lejos no se puede ----------
    await b.warp(60, 60); await sleep(400);
    const far = await a.tx('offer', { targetId: b.id });
    check(far.some((r) => !r.ok), 'no se puede ofrecer a alguien que no ves / está lejos');
    check(a.state?.open !== true, 'y no se abre ninguna ventana');
    await b.warpNear(21, 20); await a.waitSees(b);

    // ---------- mitad de la ventana: se aleja ----------
    await a.tx('offer', { targetId: b.id }); await b.tx('accept');
    const mz = a.inv!.bag[0];
    await a.tx('add', { uid: mz.uid }); await a.tx('confirm');
    await b.warp(60, 60); await sleep(1800); // el barrido de 1 s cierra la ventana
    check(a.state?.open === false, 'si se aleja con la ventana abierta, el server la cierra');
    check(names(await a.refresh()) === 'Maza', 'y no se movió nada');

    // ---------- persiste: reconectar ----------
    a.close(); b.close(); await sleep(800);
    a = new Bot(an); b = new Bot(bn); await a.connect(); await b.connect();
    check(names(a.inv) === 'Maza' && names(b.inv) === 'Espada larga|Mandoble' && a.inv!.goldD === 3800 && b.inv!.goldD === 2200, 'después de reconectar, todo sigue donde quedó (se guardó)');
    const total = (a.inv!.bag.length + b.inv!.bag.length);
    check(total === 3 && before.length > 0, `en total siguen los 3 items del principio (hay ${total}): nada se duplicó ni se perdió`);
    a.close(); b.close();
    console.log(`\n${checks - failures}/${checks} verificaciones OK`);
    process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
