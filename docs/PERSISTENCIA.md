# Cuentas y progreso guardado

## Cómo funciona
- Al entrar se pide **nombre + contraseña**. Si el nombre no existe se crea la cuenta con esa contraseña; si existe, tiene que coincidir. La contraseña se guarda con `scrypt` + sal, nunca en claro.
- Después de 5 contraseñas incorrectas para un mismo nombre (o 25 desde una misma IP) en 10 minutos, el server frena los intentos por un rato.
- El cliente manda el progreso (nivel, exp, oro, bolsa, equipo, misiones, llaves/esquirlas, pociones, facción y clase) cuando cambia, cada ~20 s aunque no cambie y al cerrar la pestaña. El server **valida y reconstruye** ese JSON (topes de nivel, oro, tamaño; nada se guarda tal cual) y lo deja en la cuenta.
- Al volver a entrar el server manda lo guardado y el cliente lo aplica (se saltea la elección de bando/clase). La posición se guarda salvo que estés en la arena o en una mazmorra: en ese caso volvés al campamento.
- El progreso lo calcula el cliente, así que todavía no es a prueba de trampas: eso llega cuando mobs y combate pasen al server.

## Dónde se guarda
`apps/server/data/accounts/<nombre en hex>.json` (un archivo por cuenta, escritura atómica con `tmp` + `rename`), o en `DATA_DIR` si definís esa variable de entorno. Los personajes del mundo (posición, apariencia) van en `chars/` de la misma carpeta.

## Ojo con Render free
El disco de Render free es **efímero**: cada redeploy (o cada vez que el servicio se duerme y se recrea) **borra las cuentas**. Para que el progreso sobreviva:
1. **Render Disk** (pago): montalo, por ejemplo, en `/var/data` y poné `DATA_DIR=/var/data`.
2. **Postgres gratis (Neon o Supabase)** — ya implementado (`PgStorage`). Creás una base, copiás la cadena de conexión y la ponés en Render como variable de entorno `DATABASE_URL` (Environment → Add). Al arrancar el server crea la tabla `accounts` solo y carga las cuentas; sin `DATABASE_URL` sigue usando archivos. `DATABASE_SSL=off` solo para un Postgres local sin TLS.

La posición del personaje (`chars/`) sigue en disco: si el disco se borra volvés al campamento, pero nivel, items, oro y misiones quedan en la base.
