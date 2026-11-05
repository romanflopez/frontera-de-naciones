# Cuentas: email y recuperar contraseña (D.17)

Notas de implementación. Lo que manda es `DISEÑO.md`.

## Reglas
- **Crear una cuenta** pide **email** (obligatorio y **único**, sin importar mayúsculas ni espacios) y **contraseña de 8 a 64**. Sin email, un login a un nombre que no existe responde «Esa cuenta no existe» y **no crea nada** (antes creaba la cuenta sola).
- Las **cuentas viejas** siguen entrando con su contraseña (mínimo 4). Al entrar sin email, el server manda `CharacterList.need_email` y **no deja elegir, crear ni borrar personajes** hasta que cargan uno (`SetEmailRequest`). Se carga **una sola vez**; cambiarlo después no está hecho.
- El email vive en `AccountRecord.email`. Para buscar una cuenta por email hay un registro-índice `e_<hex del email>` (`emailOf` = clave de la cuenta). No choca con las cuentas (solo hex) ni con los personajes (`c_`); si el índice queda viejo se ignora.

## Recuperar la contraseña
1. «¿Olvidaste tu contraseña?» → el cliente abre una conexión **sin sesión** y manda `ForgotPasswordRequest { identifier }` (nombre de cuenta o email). El server **responde siempre lo mismo** exista o no la cuenta (no se puede averiguar qué cuentas o emails existen).
2. Si la cuenta existe y tiene email, genera un código `<clave de la cuenta>.<48 hex>`, **guarda solo su sha256** (`AccountRecord.reset`) y lo manda por mail con un link `PUBLIC_URL/?reset=<código>` (el cliente abre el paso de la contraseña nueva con el código cargado y limpia la URL).
3. `ResetPasswordRequest { token, password }`: el código **vale 30 minutos y se usa una sola vez**, y se invalida a los **5 intentos fallidos**. Una contraseña inválida (menos de 8) **no gasta** el código. Al cambiar: nueva sal y hash, se borran los intentos fallidos de login y se manda un mail de aviso («tu contraseña cambió»).
- **Límites** (en memoria): pedir el código, 10 por hora por IP y 3 por hora por cuenta; usar el código, 20 por hora por IP.

## Configuración del server (mail)
| Variable | Qué es |
|---|---|
| `RESEND_API_KEY` | Clave de la API de [Resend](https://resend.com). |
| `MAIL_FROM` | Remitente de un **dominio verificado** en Resend, p. ej. `ERIS <no-reply@tudominio.com>`. |
| `PUBLIC_URL` | Dirección pública del juego para el link del mail (por defecto `http://localhost:8080`). |

Sin `RESEND_API_KEY` **y** `MAIL_FROM` no sale ningún mail: el server avisa en el log (`[Mail] sin RESEND_API_KEY…`) y, **solo fuera de producción** (`NODE_ENV !== 'production'`), imprime el mail con el código para poder probar el flujo completo en local.

## Código
`apps/server/src/accounts.ts` (reglas, `requestPasswordReset`, `resetPassword`, `setEmail`), `mail.ts` (Resend, plantillas), `index.ts` (mensajes antes de autenticar), cliente: `recover.ts` (modales) y `loginui.ts`. Tests: `apps/server/test/cuentas-email.test.ts`.
