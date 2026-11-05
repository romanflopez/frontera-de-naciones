/**
 * D.17: cuenta con email y recuperar contraseña. Email obligatorio y único al crear, contraseña de 8 o más (las cuentas viejas siguen entrando con la suya),
 * código de recuperación de 30 minutos y un solo uso (por mail, con un mailer falso acá), y las cuentas viejas cargan el email al entrar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_MIN, RESET_BAD, RESET_GENERIC, RESET_MAX_TRIES, RESET_TTL_MS, accountKey, authenticate, emailKey, emailOwner, normalizeEmail, requestPasswordReset, resetPassword, setEmail, validEmail } from '../src/accounts.ts';
import { LogMailer, ResendMailer, mailerFromEnv, resetMail, type MailMessage, type Mailer } from '../src/mail.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';

class MemStorage implements Storage {
    m = new Map<string, AccountRecord>(); flushes = 0;
    get(k: string) { return this.m.get(k); } put(k: string, r: AccountRecord) { this.m.set(k, r); } flush() { this.flushes++; }
}
class FakeMailer implements Mailer {
    sent: MailMessage[] = []; fail = false;
    async send(m: MailMessage) { if (this.fail) throw new Error('caído'); this.sent.push(m); }
    /** El código que viaja en el mail. */
    token(i = -1): string { const t = this.sent.at(i)!.text.match(/\n([0-9a-f]+\.[0-9a-f]{48})\n/); assert.ok(t, 'el mail trae el código'); return t![1]; }
}
let n = 0;
/** IP única por prueba: los límites por IP son globales del módulo. */
const ip = () => `10.0.${Math.floor(++n / 250)}.${n % 250}`;
const mk = (s: MemStorage, name: string, email: string, password = 'claveSegura1') => { const r = authenticate(s, name, password, ip(), email); assert.equal(r.ok, true, JSON.stringify(r)); return accountKey(name); };

// ---------- A. reglas de creación ----------
test('A: validEmail y normalizeEmail', () => {
    for (const ok of ['a@b.co', 'nombre.apellido+juego@correo.com.ar']) assert.equal(validEmail(normalizeEmail(ok)), true, ok);
    for (const bad of ['', 'sin-arroba', '@b.co', 'a@b', 'a b@c.com', 'a@@b.com', 'a@b..com', `${'x'.repeat(250)}@b.co`]) assert.equal(validEmail(normalizeEmail(bad)), false, bad);
    assert.equal(normalizeEmail('  Ana@Correo.COM '), 'ana@correo.com');
});

test('A: crear una cuenta pide email válido y contraseña de 8 o más; sin email no se crea nada', () => {
    const s = new MemStorage();
    const sin = authenticate(s, 'Nueva Uno', 'claveSegura1', ip(), '');
    assert.equal(sin.ok, false); assert.match((sin as { error: string }).error, /no existe.*Crear cuenta/i); assert.equal(s.get(accountKey('Nueva Uno')), undefined, 'no se creó');
    assert.match((authenticate(s, 'Nueva Uno', 'claveSegura1', ip(), 'esto no es un mail') as { error: string }).error, /email válido/);
    assert.equal(PASSWORD_MIN, 8);
    assert.match((authenticate(s, 'Nueva Uno', '1234567', ip(), 'uno@correo.com') as { error: string }).error, /entre 8 y 64/);
    assert.equal(s.get(accountKey('Nueva Uno')), undefined);
    const ok = authenticate(s, 'Nueva Uno', '12345678', ip(), '  Uno@Correo.com ');
    assert.equal(ok.ok, true); assert.equal(s.get(accountKey('Nueva Uno'))!.email, 'uno@correo.com', 'se guarda normalizado');
    assert.equal(emailOwner(s, 'uno@correo.com'), accountKey('Nueva Uno'));
});

test('B: el email es único (sin importar mayúsculas ni espacios) y mismo nombre con otro email no pisa la cuenta', () => {
    const s = new MemStorage(); mk(s, 'Dueña', 'duena@correo.com');
    const r = authenticate(s, 'Otra Cuenta', 'claveSegura1', ip(), ' DUENA@correo.com ');
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /ya tiene una cuenta/); assert.equal(s.get(accountKey('Otra Cuenta')), undefined);
    mk(s, 'Otra Cuenta', 'otra@correo.com');
    // entrar a una cuenta existente ignora el email que mande el cliente
    const entra = authenticate(s, 'Dueña', 'claveSegura1', ip(), 'cambio@correo.com');
    assert.equal(entra.ok, true); assert.equal(s.get(accountKey('Dueña'))!.email, 'duena@correo.com'); assert.equal(emailOwner(s, 'cambio@correo.com'), undefined);
    // las claves de índice y de cuenta no se pisan
    assert.ok(emailKey('a@b.co').startsWith('e_')); assert.equal(/^[0-9a-f]+$/.test(accountKey('x')), true);
});

// ---------- F. cuentas viejas ----------
test('F: una cuenta vieja (sin email, contraseña de 5) sigue entrando y carga el email una sola vez', () => {
    const s = new MemStorage();
    const viejo = authenticate(s, 'Veterano', 'abcde', ip(), 'viejo@correo.com'); // la creamos y le sacamos el email para simular una cuenta de antes de D.17
    assert.equal(viejo.ok, false, 'hoy una contraseña de 5 no alcanza para crear');
    // cuenta vieja a mano (como estaba guardada antes): hash de una contraseña de 5 letras
    mk(s, 'Antigua', 'tmp@correo.com');
    const key = accountKey('Antigua'), acc = s.get(key)!; delete acc.email; s.m.delete(emailKey('tmp@correo.com'));
    const again = authenticate(s, 'Antigua', 'claveSegura1', ip());
    assert.equal(again.ok, true, 'las cuentas sin email siguen entrando'); assert.equal(s.get(key)!.email, undefined);
    assert.deepEqual(setEmail(s, key, 'esto no'), { ok: false, error: 'Escribí un email válido (por ejemplo nombre@correo.com).' });
    mk(s, 'Ocupa', 'ocupado@correo.com');
    assert.match((setEmail(s, key, 'OCUPADO@correo.com') as { error: string }).error, /ya está en uso/);
    assert.deepEqual(setEmail(s, key, ' Antigua@Correo.com '), { ok: true });
    assert.equal(s.get(key)!.email, 'antigua@correo.com'); assert.equal(emailOwner(s, 'antigua@correo.com'), key); assert.ok(s.flushes > 0);
    assert.match((setEmail(s, key, 'otro@correo.com') as { error: string }).error, /ya tiene un email/, 'una vez cargado no se cambia desde acá');
    assert.deepEqual(setEmail(s, 'no-existe', 'x@y.co'), { ok: false, error: 'La cuenta no existe.' });
});

// ---------- recuperar contraseña ----------
test('B: flujo completo: pedir por nombre o por email, llega un mail con el código, se elige contraseña nueva y entra', async () => {
    const s = new MemStorage(), mail = new FakeMailer(); mk(s, 'Olvidadiza', 'olvida@correo.com', 'claveVieja123');
    const r1 = await requestPasswordReset(s, mail, 'Olvidadiza', ip());
    assert.deepEqual(r1, { ok: true, text: RESET_GENERIC }); assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, 'olvida@correo.com'); assert.match(mail.sent[0].subject, /recuperá tu contraseña/); assert.match(mail.sent[0].text, /\/\?reset=/); assert.match(mail.sent[0].text, /30 minutos/);
    const token = mail.token(); assert.ok(token.startsWith(accountKey('Olvidadiza') + '.'));
    assert.ok(!JSON.stringify([...s.m.values()]).includes(token.split('.')[1]), 'el código no se guarda en claro: solo su hash');
    const bad = await resetPassword(s, mail, token, 'corta', ip());
    assert.match(bad.text, /entre 8 y 64/); assert.equal(bad.ok, false);
    const done = await resetPassword(s, mail, token, 'claveNueva456', ip());
    assert.equal(done.ok, true, 'el código siguió valiendo después de una contraseña inválida');
    assert.equal(authenticate(s, 'Olvidadiza', 'claveNueva456', ip()).ok, true, 'entra con la nueva');
    assert.equal(authenticate(s, 'Olvidadiza', 'claveVieja123', ip()).ok, false, 'la vieja ya no');
    assert.equal(s.get(accountKey('Olvidadiza'))!.reset, undefined);
    assert.match(mail.sent.at(-1)!.subject, /tu contraseña cambió/, 'avisa del cambio');
    // por email
    const mail2 = new FakeMailer(); await requestPasswordReset(s, mail2, ' OLVIDA@correo.com ', ip()); assert.equal(mail2.sent.length, 1); assert.equal(mail2.sent[0].to, 'olvida@correo.com');
});

test('H: el código se usa una sola vez, vence a los 30 minutos y no sirve para otra cuenta', async () => {
    const s = new MemStorage(), mail = new FakeMailer(), T = 5_000_000_000_000, H = 3600_000; // los pedidos van separados por horas: hay un límite de 3 por hora por cuenta
    mk(s, 'Cuenta A', 'a@correo.com'); mk(s, 'Cuenta B', 'b@correo.com');
    await requestPasswordReset(s, mail, 'Cuenta A', ip(), T); const tokA = mail.token();
    assert.equal((await resetPassword(s, mail, tokA, 'claveNueva456', ip(), T + 1000)).ok, true);
    assert.deepEqual(await resetPassword(s, mail, tokA, 'otraClave789', ip(), T + 2000), { ok: false, text: RESET_BAD }, 'segundo uso: no');
    await requestPasswordReset(s, mail, 'Cuenta A', ip(), T + 2 * H); const tok2 = mail.token();
    assert.deepEqual(await resetPassword(s, mail, tok2, 'claveNueva456', ip(), T + 2 * H + RESET_TTL_MS + 1), { ok: false, text: RESET_BAD }, 'vencido');
    assert.equal(s.get(accountKey('Cuenta A'))!.reset, undefined, 'un código vencido se borra');
    await requestPasswordReset(s, mail, 'Cuenta A', ip(), T + 4 * H); const justo = mail.token();
    assert.equal((await resetPassword(s, mail, justo, 'claveNueva456', ip(), T + 4 * H + RESET_TTL_MS - 1)).ok, true, 'a los 29:59 todavía vale');
    // el código de A con la clave de B no resetea a B
    await requestPasswordReset(s, mail, 'Cuenta A', ip(), T + 6 * H); const a3 = mail.token().split('.')[1];
    await requestPasswordReset(s, mail, 'Cuenta B', ip(), T + 6 * H);
    assert.deepEqual(await resetPassword(s, mail, `${accountKey('Cuenta B')}.${a3}`, 'claveRobada99', ip(), T + 6 * H + 1000), { ok: false, text: RESET_BAD });
    assert.equal(authenticate(s, 'Cuenta B', 'claveSegura1', ip()).ok, true, 'B no cambió');
});

test('H: a los 5 intentos fallidos el código se invalida (aunque después llegue el bueno)', async () => {
    const s = new MemStorage(), mail = new FakeMailer(); mk(s, 'Fuerza Bruta', 'fb@correo.com');
    await requestPasswordReset(s, mail, 'Fuerza Bruta', ip()); const good = mail.token(), key = good.split('.')[0];
    for (let i = 0; i < RESET_MAX_TRIES; i++) assert.equal((await resetPassword(s, mail, `${key}.${'0'.repeat(47)}${i}`, 'claveNueva456', ip())).ok, false);
    assert.deepEqual(await resetPassword(s, mail, good, 'claveNueva456', ip()), { ok: false, text: RESET_BAD }, 'ya no vale ni el bueno');
    assert.equal(authenticate(s, 'Fuerza Bruta', 'claveSegura1', ip()).ok, true, 'la contraseña no cambió');
});

test('H: pedir la recuperación no revela qué cuentas existen y tiene límites', async () => {
    const s = new MemStorage(), mail = new FakeMailer(); mk(s, 'Existe', 'existe@correo.com');
    const a = await requestPasswordReset(s, mail, 'Existe', ip()), b = await requestPasswordReset(s, mail, 'No Existe', ip()), c = await requestPasswordReset(s, mail, 'nadie@correo.com', ip()), d = await requestPasswordReset(s, mail, '', ip());
    assert.deepEqual([a, b, c, d], [a, a, a, a], 'misma respuesta exista o no'); assert.equal(mail.sent.length, 1, 'solo se mandó el de la cuenta que existe');
    // una cuenta vieja sin email tampoco manda nada ni lo dice
    mk(s, 'Sin Mail', 'tmp2@correo.com'); delete s.get(accountKey('Sin Mail'))!.email; s.m.delete(emailKey('tmp2@correo.com'));
    assert.deepEqual(await requestPasswordReset(s, mail, 'Sin Mail', ip()), a); assert.equal(mail.sent.length, 1);
    // por cuenta: 3 por hora (el 4.º responde igual pero no manda)
    const lim = new FakeMailer(); mk(s, 'Limitada', 'lim@correo.com'); const T = 6_000_000_000_000;
    for (let i = 0; i < 5; i++) assert.equal((await requestPasswordReset(s, lim, 'Limitada', ip(), T + i)).text, RESET_GENERIC);
    assert.equal(lim.sent.length, 3, 'máximo 3 mails por hora por cuenta');
    assert.equal((await requestPasswordReset(s, lim, 'Limitada', ip(), T + 3600_000 + 10)).text, RESET_GENERIC); assert.equal(lim.sent.length, 4, 'a la hora vuelve a andar');
    // por IP: 10 por hora, después avisa
    const IP = ip(); let last = { ok: true, text: '' };
    for (let i = 0; i < 11; i++) last = await requestPasswordReset(s, new FakeMailer(), 'Existe', IP, T + 7_000_000_000_000 + i);
    assert.equal(last.ok, false); assert.match(last.text, /demasiados pedidos/i);
});

test('H: códigos mal armados no hacen nada ni rompen (sin punto, key o secreto raros, claves de personajes o de índice, textos enormes)', async () => {
    const s = new MemStorage(), mail = new FakeMailer(); mk(s, 'Victima', 'v@correo.com'); const key = accountKey('Victima');
    const pw = 'claveNueva456';
    for (const t of ['', '.', 'abc', `${key}`, `${key}.`, `${key}.zz`, `.${'a'.repeat(48)}`, `c_${key}.${'a'.repeat(48)}`, `${emailKey('v@correo.com')}.${'a'.repeat(48)}`, `${key}.${'a'.repeat(48)}`, 'x'.repeat(100_000), `${key}.${'a'.repeat(48)}.extra`, '../../etc.passwd'])
        assert.deepEqual(await resetPassword(s, mail, t, pw, ip()), { ok: false, text: RESET_BAD }, JSON.stringify(t).slice(0, 40));
    assert.equal(authenticate(s, 'Victima', 'claveSegura1', ip()).ok, true);
    // un registro de personaje (c_) no se puede resetear aunque tenga la forma
    s.put(`c_${key}`, { name: 'Pj', salt: '', hash: '', created: 0, lastLogin: 0, owner: key, reset: { h: '00'.repeat(32), exp: Date.now() + 1e6, tries: 0 } });
    assert.equal((await resetPassword(s, mail, `c_${key}.${'a'.repeat(48)}`, pw, ip())).ok, false);
    // si el mailer está caído el pedido igual responde igual (y no se cuelga)
    const roto = new FakeMailer(); roto.fail = true; assert.equal((await requestPasswordReset(s, roto, 'Victima', ip())).text, RESET_GENERIC);
});

// ---------- el mailer ----------
test('A: ResendMailer arma el pedido a la API de Resend y falla si responde mal; mailerFromEnv elige según el entorno', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = new ResendMailer('re_clave', 'ERIS <no-reply@ejemplo.com>', (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"id":"1"}', { status: 200 }); }) as typeof fetch);
    await ok.send({ to: 'x@y.co', subject: 'Asunto', text: 'texto', html: '<p>html</p>' });
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer re_clave');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { from: 'ERIS <no-reply@ejemplo.com>', to: ['x@y.co'], subject: 'Asunto', text: 'texto', html: '<p>html</p>' });
    const mal = new ResendMailer('k', 'f', (async () => new Response('dominio no verificado', { status: 403 })) as typeof fetch);
    await assert.rejects(() => mal.send({ to: 'x@y.co', subject: 's', text: 't', html: 'h' }), /403/);
    assert.ok(mailerFromEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.co' } as NodeJS.ProcessEnv) instanceof ResendMailer);
    assert.ok(mailerFromEnv({} as NodeJS.ProcessEnv) instanceof LogMailer); assert.ok(mailerFromEnv({ RESEND_API_KEY: 'k' } as NodeJS.ProcessEnv) instanceof LogMailer, 'sin MAIL_FROM no manda');
});

test('A: el mail de recuperación usa el link público, no inyecta HTML del nombre y trae el código aparte', () => {
    const m = resetMail('x@y.co', '<b>Hack</b>', 'abc.def', 30, 'https://juego.ejemplo.com');
    assert.match(m.text, /https:\/\/juego\.ejemplo\.com\/\?reset=abc\.def/); assert.ok(!m.html.includes('<b>Hack</b>')); assert.match(m.html, /&lt;b&gt;Hack&lt;\/b&gt;/);
    assert.match(m.text, /\nabc\.def\n/);
});
