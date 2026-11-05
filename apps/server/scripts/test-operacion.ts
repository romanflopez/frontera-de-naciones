/**
 * Prueba de red de lo operativo para abrir a gente de afuera, contra un server en marcha:
 *   DATA_DIR=<carpeta vacía> PORT=8116 FDN_GM=gmoperacion pnpm --filter @fdn/server start
 *   DATA_DIR=<la misma carpeta> npx tsx scripts/test-operacion.ts [ws://localhost:8116/ws]
 * Verifica: /novedades, POST /report (anota, rechaza lo grande y limita por IP), y /gm reiniciar (aviso a todos, cancelar,
 * cuenta regresiva real hasta el cierre del server), GET /version y /gm minclient, GET /health y, si se pasa WEBHOOK_PORT, las alertas a Discord (el script
 * hace de Discord falso). Para eso el server tiene que arrancar con
 *   DISCORD_WEBHOOK_URL=http://127.0.0.1:8117/a DISCORD_WEBHOOK_LOG=http://127.0.0.1:8117/l
 * y el script correrse con WEBHOOK_PORT=8117. OJO: la última prueba APAGA el server.
 */
import { WebSocket } from 'ws';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { ClientMessage, ServerMessage } from '@fdn/proto';

const URL = process.argv[2] ?? 'ws://localhost:8116/ws';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const DATA_DIR = process.env.DATA_DIR ?? '';
const RUN = Math.random().toString(36).slice(2, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failures++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); };
type Srv = NonNullable<ServerMessage['payload']>;

class Bot {
    ws!: WebSocket; lines: string[] = [];
    constructor(readonly name: string) {}
    async connect() {
        this.ws = new WebSocket(URL); this.ws.binaryType = 'nodebuffer';
        let ready!: () => void; const got = new Promise<void>((r) => (ready = r));
        this.ws.on('message', (d: Buffer) => {
            const p = ServerMessage.decode(new Uint8Array(d)).payload as Srv | undefined; if (!p) return;
            if (p.$case === 'characterList') this.send({ $case: 'selectCharacterRequest', value: { name: this.name } });
            else if (p.$case === 'initialGameWorldState') ready();
            else if (p.$case === 'sendMessage') this.lines.push(p.value.message);
            else if (p.$case === 'serverChatMessage') this.lines.push(`${p.value.senderName}: ${p.value.text}`);
        });
        await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
        this.send({ $case: 'authenticateRequest', value: { id: '', characterName: this.name, password: 'test1234' } });
        await Promise.race([got, sleep(6000).then(() => { throw new Error(`${this.name}: no entró al mundo`); })]);
        await sleep(300);
    }
    send(p: unknown) { this.ws.send(ClientMessage.encode({ payload: p } as ClientMessage).finish()); }
    say(t: string) { this.send({ $case: 'chatMessageSendRequest', value: { message: t } }); }
    has(re: RegExp) { return this.lines.some((l) => re.test(l)); }
    async waitFor(re: RegExp, ms = 3000) { for (let i = 0; i < ms / 50 && !this.has(re); i++) await sleep(50); return this.has(re); }
}

function seed(name: string) {
    const dir = join(DATA_DIR, 'accounts'); mkdirSync(dir, { recursive: true });
    const salt = randomBytes(16), key = Buffer.from(name.normalize('NFC').toLowerCase(), 'utf8').toString('hex');
    const character = { v: 1, faction: 'solmar', cls: 'paladin', lvl: 5, exp: 0, gold: 0, hp: 100, mp: 50, bag: [], eq: { arma: null, armadura: null, cabeza: null, anillo: null },
        q: { i: 0, st: 'new', prog: 0, keys: { cripta: 0, foso: 0 }, shards: { cripta: 0, foso: 0 } }, pots: { hp: 3, mp: 0 }, u: [] };
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ name, salt: salt.toString('hex'), hash: scryptSync('test1234', salt, 32).toString('hex'), created: Date.now(), lastLogin: Date.now(), character: JSON.stringify(character) }));
}
const post = (body: string, path = '/report') => fetch(`${HTTP}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

/** Discord falso: guarda lo que llega a cada ruta. */
const hooks: { path: string; body: string }[] = [];
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? 0);
if (WEBHOOK_PORT) createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => { hooks.push({ path: rq.url ?? '', body: b }); rs.writeHead(204); rs.end(); }); }).listen(WEBHOOK_PORT, '127.0.0.1');
const hookHas = async (path: string, re: RegExp, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { if (hooks.some((h) => h.path === path && re.test(h.body))) return true; await sleep(50); } return false; };

async function main() {
    if (!DATA_DIR) throw new Error('Falta DATA_DIR (el mismo del server).');
    const gn = 'gmoperacion', pn = `pj${RUN}`; seed(gn); seed(pn);
    const gm = new Bot(gn), pj = new Bot(pn); await gm.connect(); await pj.connect();

    // ---------- 1. /novedades ----------
    pj.say('/novedades');
    check(await pj.waitFor(/Novedades/) && pj.has(/Movimiento libre/), '/novedades muestra el registro de cambios');

    // ---------- 2. reporte de errores ----------
    const ok = await post(JSON.stringify({ msg: 'TypeError: x is undefined', src: 'main.ts:10:2', stack: 'at foo\nat bar', ver: 'index-test.js' }));
    check(ok.status === 204 && ok.headers.get('access-control-allow-origin') === '*', 'POST /report responde 204 con CORS');
    const log = join(DATA_DIR, 'client-errors.log');
    check(existsSync(log) && /TypeError: x is undefined/.test(readFileSync(log, 'utf8')) && /ver=index-test\.js/.test(readFileSync(log, 'utf8')), 'el error quedó en client-errors.log con la versión');
    check((await post('x'.repeat(6000))).status === 413, 'un reporte de más de 4 KB se rechaza (413)');
    check((await post('no es json')).status === 400, 'un cuerpo que no es JSON da 400');
    check((await fetch(`${HTTP}/report`, { method: 'OPTIONS' })).status === 204, 'la preflight de CORS responde');
    for (let i = 0; i < 3; i++) await post(JSON.stringify({ msg: 'repetido igual', src: 'a.js:1' }));
    let limited = 0; for (let i = 0; i < 15; i++) if ((await post(JSON.stringify({ msg: `e${i}` }))).status === 429) limited++;
    check(limited >= 1, `el tope por IP corta los reportes en ráfaga (${limited} de 15 rechazados con 429)`);

    // ---------- 2b. /health y alertas ----------
    const hr = await fetch(`${HTTP}/health`); const hj = await hr.json() as Record<string, unknown>;
    check(hr.status === 200 && hj.ok === true && typeof hj.build === 'string' && Number(hj.online) >= 2 && hj.storage === 'archivos', `/health responde ok con build, conectados y storage (${JSON.stringify(hj)})`);
    // ---------- 2c. versión mínima del cliente ----------
    const ver = async () => (await (await fetch(`${HTTP}/version`)).json()) as Record<string, string>;
    const vr = await fetch(`${HTTP}/version`);
    check(vr.status === 200 && vr.headers.get('access-control-allow-origin') === '*' && typeof (await ver()).server === 'string', 'GET /version responde con CORS y el build del server');
    const minNow = async (want: string, ms = 2000) => { for (let i = 0; i < ms / 50; i++) { if ((await ver()).minClient === want) return true; await sleep(50); } return false; };
    pj.lines.length = 0; pj.say('/gm minclient 9.9.9');
    check(await pj.waitFor(/no sos gm/i) && (await ver()).minClient !== '9.9.9', 'un jugador común no puede cambiar la versión mínima');
    pj.lines.length = 0;
    gm.say('/gm minclient 0.3.1');
    check(await minNow('0.3.1'), '/gm minclient 0.3.1 se refleja en /version al instante');
    gm.say('/gm minclient abc');
    check(await gm.waitFor(/tipo 0\.3\.1/) && (await ver()).minClient === '0.3.1', 'una versión inválida se rechaza y no cambia nada');
    gm.say('/gm latestclient 0.4.0');
    for (let i = 0; i < 40 && (await ver()).latestClient !== '0.4.0'; i++) await sleep(50);
    check((await ver()).latestClient === '0.4.0', '/gm latestclient publica la última versión');
    gm.say('/gm minclient off');
    check(await minNow(''), '/gm minclient off saca el mínimo (no queda a nadie bloqueado)');
    gm.say('/gm latestclient off');

    if (WEBHOOK_PORT) {
        check(await hookHas('/a', /Error del cliente[\s\S]*TypeError: x is undefined/), 'un error del cliente por /report llegó a Discord (canal de alertas)');
        const n = hooks.filter((h) => h.path === '/a' && /repetido igual/.test(h.body)).length;
        check(n === 1, `el anti-spam agrupa 3 reportes idénticos en 1 aviso (${n})`);
    } else console.log('(sin WEBHOOK_PORT: se saltean las pruebas de Discord)');

    // ---------- 3. reinicio avisado ----------
    pj.say('/gm reiniciar 60');
    check(await pj.waitFor(/no sos gm/i), 'un jugador común no puede reiniciar');
    gm.say('/gm reiniciar 2'); await sleep(300);
    check(gm.has(/entre 5 y 3600/), 'un valor fuera de rango se rechaza');
    gm.say('/gm reiniciar 120');
    check(await pj.waitFor(/Reinicio del servidor en 2 min/), 'todos los conectados reciben el aviso de reinicio');
    gm.say('/gm reiniciar cancelar');
    check(await pj.waitFor(/se canceló el reinicio/i), 'cancelar avisa a todos');
    pj.lines.length = 0;
    gm.say('/gm reiniciar 8');
    check(await pj.waitFor(/en 8 s/), 'arranca la cuenta regresiva corta');
    check(await pj.waitFor(/en 5 s/, 6000), 'avisa a los 5 s');
    check(await pj.waitFor(/se reinicia ahora/, 8000), 'avisa en cero');
    if (WEBHOOK_PORT) check(await hookHas('/l', /Reinicio avisado/), 'el reinicio avisado quedó en el canal de registro');
    const closed = await Promise.race([new Promise<boolean>((r) => pj.ws.once('close', () => r(true))), sleep(5000).then(() => false)]);
    check(closed, 'el server cierra y desconecta a los jugadores después del aviso');
    if (WEBHOOK_PORT) check(await hookHas('/a', /El server se apaga/), 'a Discord llegó el aviso de apagado');

    console.log(failures ? `\n${failures} fallas` : '\nTodo OK');
    process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
