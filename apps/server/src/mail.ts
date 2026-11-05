/**
 * Mails de la cuenta (D.17). Se mandan por Resend (https://resend.com): hace falta `RESEND_API_KEY` y `MAIL_FROM` (un remitente de un dominio verificado,
 * por ejemplo `ERIS <no-reply@tudominio.com>`). Sin clave no se manda nada: se avisa en el log (y en desarrollo se imprime el mail para poder probar el flujo).
 * Los tests usan un `Mailer` falso.
 */
export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(m: MailMessage): Promise<void> }

const RESEND_URL = 'https://api.resend.com/emails';

export class ResendMailer implements Mailer {
    constructor(private readonly apiKey: string, private readonly from: string, private readonly doFetch: typeof fetch = fetch) {}
    async send(m: MailMessage): Promise<void> {
        const res = await this.doFetch(RESEND_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        });
        if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
}

/** Sin clave de Resend: no sale ningún mail. En desarrollo imprime el contenido (trae el código de recuperación) para poder probar el flujo completo. */
export class LogMailer implements Mailer {
    constructor(private readonly dev: boolean) {}
    async send(m: MailMessage): Promise<void> {
        console.warn(`[Mail] sin RESEND_API_KEY: no se mandó "${m.subject}" a ${m.to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
        if (this.dev) console.log(`[Mail] (solo desarrollo) ${m.subject}\n${m.text}`);
    }
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
    const key = env.RESEND_API_KEY?.trim(), from = env.MAIL_FROM?.trim();
    if (key && from) return new ResendMailer(key, from);
    if (key && !from) console.warn('[Mail] RESEND_API_KEY está pero falta MAIL_FROM: no se manda ningún mail.');
    return new LogMailer(env.NODE_ENV !== 'production');
}

const escHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Dirección pública del juego (para el link del mail). */
export const publicUrl = (env: NodeJS.ProcessEnv = process.env): string => (env.PUBLIC_URL?.trim() || 'http://localhost:8080').replace(/\/+$/, '');

export function resetMail(to: string, accountName: string, token: string, minutes: number, base = publicUrl()): MailMessage {
    const link = `${base}/?reset=${encodeURIComponent(token)}`;
    const text = `Hola ${accountName}:\n\nPediste recuperar la contraseña de tu cuenta de ERIS. Entrá a este link para elegir una nueva (vale ${minutes} minutos y se usa una sola vez):\n\n${link}\n\nSi el link no abre, en el juego tocá "¿Olvidaste tu contraseña?", elegí "Ya tengo el código" y pegá esto:\n\n${token}\n\nSi no lo pediste vos, ignorá este mail: tu contraseña no cambia.`;
    const html = `<p>Hola <b>${escHtml(accountName)}</b>:</p><p>Pediste recuperar la contraseña de tu cuenta de ERIS. Entrá a este link para elegir una nueva (vale ${minutes} minutos y se usa una sola vez):</p><p><a href="${escHtml(link)}">${escHtml(link)}</a></p><p>Si el link no abre, en el juego tocá «¿Olvidaste tu contraseña?», elegí «Ya tengo el código» y pegá esto:</p><p><code>${escHtml(token)}</code></p><p>Si no lo pediste vos, ignorá este mail: tu contraseña no cambia.</p>`;
    return { to, subject: 'ERIS: recuperá tu contraseña', text, html };
}
export function passwordChangedMail(to: string, accountName: string): MailMessage {
    const text = `Hola ${accountName}:\n\nLa contraseña de tu cuenta de ERIS se acaba de cambiar. Si fuiste vos, no hay nada más que hacer. Si no, pedí otra recuperación desde el juego y escribinos.`;
    return { to, subject: 'ERIS: tu contraseña cambió', text, html: `<p>Hola <b>${escHtml(accountName)}</b>:</p><p>La contraseña de tu cuenta de ERIS se acaba de cambiar. Si fuiste vos, no hay nada más que hacer. Si no, pedí otra recuperación desde el juego y escribinos.</p>` };
}
