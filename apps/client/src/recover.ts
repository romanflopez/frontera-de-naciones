/**
 * Recuperar la contraseña y pedir el email a las cuentas viejas (D.17). Solo vista: el server valida todo (código de 30 minutos, un solo uso,
 * contraseña de 8 o más, límites por IP y por cuenta) y responde siempre lo mismo exista o no la cuenta.
 */
import type { Net } from './net.ts';
import { oneShot } from './net.ts';

const CSS = `
.rcv{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(6,2,16,.72);font-family:var(--f-inter,system-ui,sans-serif);color:#eadfe8}
.rcv[hidden]{display:none}
.rcv .box{width:min(420px,92vw);padding:20px 22px;background:linear-gradient(180deg,rgba(38,16,78,.96),rgba(14,6,34,.98));border:1px solid rgba(206,150,255,.45);border-radius:6px;box-shadow:0 0 0 1px #0a0220,0 0 34px rgba(170,80,255,.3),0 18px 50px #000c}
.rcv h2{margin:0 0 6px;font:700 20px var(--f-ui,Georgia,serif);color:#f4e8f0}
.rcv p{margin:0 0 12px;font-size:13.5px;line-height:1.45;color:#cdbfe0}
.rcv label{display:block;margin:10px 0 4px;font-size:12px;letter-spacing:.04em;color:#bfa8dc}
.rcv input{box-sizing:border-box;width:100%;height:40px;padding:0 10px;font:15px var(--f-inter,system-ui);color:#fff;background:rgba(8,3,22,.85);border:1px solid rgba(206,150,255,.4);border-radius:4px}
.rcv input:focus{outline:2px solid #c25bff;outline-offset:1px}
.rcv .msg{min-height:20px;margin:10px 0 0;font-size:13px}
.rcv .msg.err{color:#ff8b8b}.rcv .msg.ok{color:#9be59b}
.rcv .acts{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.rcv button{height:40px;padding:0 16px;font:700 14px var(--f-ui,Georgia,serif);color:#f4e8f0;cursor:pointer;border-radius:4px;border:1px solid rgba(206,150,255,.5);background:linear-gradient(180deg,rgba(40,18,84,.7),rgba(16,6,38,.8))}
.rcv button.pri{background:linear-gradient(180deg,#b040e6,#7022bc 52%,#40107f);border-color:#ff8be6}
.rcv button[disabled]{opacity:.55;cursor:default}
.rcv .lnk{height:auto;padding:0;border:0;background:none;font:600 13px var(--f-inter,system-ui);color:#d9a8ff;text-decoration:underline}
`;
const mount = (id: string, html: string): HTMLElement => {
    if (!document.getElementById('rcv-css')) { const st = document.createElement('style'); st.id = 'rcv-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = document.createElement('div'); el.id = id; el.className = 'rcv'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="box">${html}</div>`; document.body.appendChild(el); return el;
};
const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T => root.querySelector(sel) as T;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const looksLikeEmail = (s: string): boolean => s.trim().length <= 254 && EMAIL_RE.test(s.trim());

export interface RecoverUI { open(step?: 'ask' | 'reset', token?: string, identifier?: string): void; close(): void }
export function createRecoverUI(d: { url: () => string; onDone: () => void }): RecoverUI {
    const el = mount('recover', `
        <div data-step="ask">
            <h2>Recuperar la contraseña</h2>
            <p>Escribí el nombre de tu cuenta o tu email y te mandamos un mail con un código para elegir una contraseña nueva. El código vale 30 minutos.</p>
            <label for="rcvId">Cuenta o email</label><input id="rcvId" maxlength="254" autocomplete="username" spellcheck="false" autocapitalize="none">
            <div class="acts"><button type="button" class="pri" data-a="send">Mandar el código</button><button type="button" data-a="close">Cancelar</button></div>
            <p style="margin-top:12px"><button type="button" class="lnk" data-a="have">Ya tengo el código</button></p>
        </div>
        <div data-step="reset" hidden>
            <h2>Elegí una contraseña nueva</h2>
            <p>Pegá el código del mail y elegí una contraseña de 8 a 64 caracteres.</p>
            <label for="rcvTok">Código</label><input id="rcvTok" maxlength="400" autocomplete="one-time-code" spellcheck="false" autocapitalize="none">
            <label for="rcvPw">Contraseña nueva</label><input id="rcvPw" type="password" maxlength="64" autocomplete="new-password">
            <label for="rcvPw2">Repetila</label><input id="rcvPw2" type="password" maxlength="64" autocomplete="new-password">
            <div class="acts"><button type="button" class="pri" data-a="reset">Cambiar la contraseña</button><button type="button" data-a="close">Cancelar</button></div>
        </div>
        <div class="msg" role="status" aria-live="polite"></div>`);
    const msg = q<HTMLElement>(el, '.msg'), say = (t: string, kind: '' | 'ok' | 'err' = '') => { msg.textContent = t; msg.className = 'msg' + (kind ? ' ' + kind : ''); };
    const step = (s: 'ask' | 'reset') => { el.querySelectorAll<HTMLElement>('[data-step]').forEach((e) => { e.hidden = e.dataset.step !== s; }); say(''); q<HTMLInputElement>(el, s === 'ask' ? '#rcvId' : '#rcvTok').focus(); };
    const busy = (on: boolean) => el.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = on; });
    const ui: RecoverUI = {
        open(s = 'ask', token = '', identifier = '') {
            el.hidden = false; if (identifier) q<HTMLInputElement>(el, '#rcvId').value = identifier; if (token) q<HTMLInputElement>(el, '#rcvTok').value = token; step(s);
        },
        close() { el.hidden = true; },
    };
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') ui.close(); else if (e.key === 'Enter') { const a = (e.target as HTMLElement).closest('[data-step]') as HTMLElement | null; (a?.querySelector('button.pri') as HTMLElement | null)?.click(); } });
    el.addEventListener('click', async (e) => {
        const a = (e.target as HTMLElement).closest('button')?.dataset.a; if (!a) return;
        if (a === 'close') { ui.close(); return; }
        if (a === 'have') { step('reset'); return; }
        if (a === 'send') {
            const id = q<HTMLInputElement>(el, '#rcvId').value.trim(); if (!id) { say('Escribí tu cuenta o tu email.', 'err'); return; }
            busy(true); say('Mandando…');
            const r = await oneShot(d.url(), { $case: 'forgotPasswordRequest', value: { identifier: id } }, 'forgot'); busy(false);
            say(r.text, r.ok ? 'ok' : 'err'); // si salió bien, el mail trae el código: «Ya tengo el código» lleva al paso siguiente
            return;
        }
        if (a === 'reset') {
            const token = q<HTMLInputElement>(el, '#rcvTok').value.trim(), pw = q<HTMLInputElement>(el, '#rcvPw').value, pw2 = q<HTMLInputElement>(el, '#rcvPw2').value;
            if (!token) { say('Pegá el código del mail.', 'err'); return; }
            if (pw.length < 8 || pw.length > 64) { say('La contraseña tiene que tener entre 8 y 64 caracteres.', 'err'); return; }
            if (pw !== pw2) { say('Las contraseñas no coinciden.', 'err'); return; }
            busy(true); say('Cambiando…');
            const r = await oneShot(d.url(), { $case: 'resetPasswordRequest', value: { token, password: pw } }, 'reset'); busy(false);
            say(r.text, r.ok ? 'ok' : 'err');
            if (r.ok) { q<HTMLInputElement>(el, '#rcvPw').value = ''; q<HTMLInputElement>(el, '#rcvPw2').value = ''; setTimeout(() => { ui.close(); d.onDone(); }, 1800); }
        }
    });
    return ui;
}

/** Cuenta vieja sin email: se pide antes de elegir personaje (el server no deja seguir sin cargarlo). */
export interface EmailPrompt { show(error?: string): void; hide(): void; readonly isOpen: boolean }
export function createEmailPrompt(d: { send: Net['send'] }): EmailPrompt {
    const el = mount('emailPrompt', `
        <h2>Agregá tu email</h2>
        <p>Ahora las cuentas llevan un email: sirve para recuperar la contraseña si la perdés. Escribí uno que uses; lo cargás una sola vez.</p>
        <label for="epIn">Email</label><input id="epIn" type="email" maxlength="254" autocomplete="email" spellcheck="false" autocapitalize="none">
        <div class="msg err" role="alert"></div>
        <div class="acts"><button type="button" class="pri" data-a="save">Guardar</button></div>`);
    const input = q<HTMLInputElement>(el, '#epIn'), msg = q<HTMLElement>(el, '.msg');
    const submit = () => {
        if (!looksLikeEmail(input.value)) { msg.textContent = 'Escribí un email válido (por ejemplo nombre@correo.com).'; input.focus(); return; }
        msg.textContent = ''; (q<HTMLButtonElement>(el, 'button')).disabled = true; d.send({ $case: 'setEmailRequest', value: { email: input.value.trim() } });
    };
    el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) submit(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } e.stopPropagation(); });
    return {
        get isOpen() { return !el.hidden; },
        show(error = '') { el.hidden = false; msg.textContent = error; (q<HTMLButtonElement>(el, 'button')).disabled = false; input.focus(); },
        hide() { el.hidden = true; },
    };
}
