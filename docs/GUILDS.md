# Guilds: escudo, cofre compartido y lista de miembros

Implementado el 4/11/2026. Antes de esto solo existía el canal de chat `/gu` (respondía "próximamente"). Lo que se reutilizó: la membresía
sigue el molde de la party (`party.ts`), el cofre corre por el mismo código del depósito (`deposit.ts`) y la persistencia copia a la casa de
subastas (un registro propio en el Storage).

## 1. Reglas

- **Una guild por personaje, una nación por guild.** La identidad es la clave del personaje (`c_<hex>`; en las cuentas viejas, la de la cuenta): la guild es del personaje, no de la cuenta.
- **Fundar:** `/guild crear <nombre> <ETIQUETA>`. Nivel mínimo **10** y **5.000 de oro** (sumidero). Nombre de 3 a 20 letras/números (espacios, guiones y apóstrofos permitidos), único sin importar mayúsculas ni tildes. Etiqueta de 2 a 4 letras/números, única; se muestra sobre la cabeza como `[CRV] Nombre`.
- **Tope: 40 miembros.** Invitaciones solo a jugadores conectados, de la misma nación y sin guild; vencen a los 60 s.
- **Rangos:** líder (uno), oficial y miembro.

| Puede | Líder | Oficial | Miembro |
|---|:-:|:-:|:-:|
| Invitar, cambiar el lema | ✓ | ✓ | |
| Expulsar | a cualquiera | solo a miembros | |
| Ascender / bajar, ceder el liderazgo, cambiar el escudo, disolver | ✓ | | |
| Guardar en el cofre | ✓ | ✓ | ✓ |
| Retirar del cofre | ✓ | ✓ | |

- El líder no puede salir mientras haya otros miembros: cede con `/guild lider <nombre>` (queda como oficial) o disuelve. Disolver exige el cofre vacío. Borrar un personaje que es líder con gente o con cosas en el cofre se rechaza en la pantalla de personajes; un miembro común sale de la guild al borrarse.
- **Escudo:** `forma,fondo,figura,símbolo` (4 formas, 8 colores, 12 símbolos). El cliente lo dibuja como SVG (`apps/client/src/guild.ts`); el server solo valida los índices (`parseCrest`). Se cambia desde la ventana (botón «Escudo», solo el líder).
- **Chat:** canal `guild` (`/gu texto` o la pestaña Guild). Por ese canal llegan también los avisos del sistema con remitente «Guild»: *X se conectó / se desconectó*, *X se unió / salió / fue expulsado*, *X ascendió a oficial*, *X es el nuevo líder*, cambios de escudo y lema.

## 2. Lista de miembros

Ventana con **O**, el botón «Guild (O)» o `/guild` sin nada. Arriba: escudo, nombre y etiqueta, nación, tu rango, lema y **miembros contra el tope** (en rojo si está llena) con cuántos hay conectados. La tabla va **conectados primero**, después por rango y por última conexión; cada fila muestra rango, nivel y clase (si está conectado), **dónde está** o **hace cuánto se conectó** («hace 3 d»), y las acciones que te deja tu rango (▲ ascender, ▼ bajar, ♛ ceder, ✕ expulsar). Invitar desde el campo de arriba o con `/guild invitar <nombre>`.

El server manda `GuildState` completo al entrar, después de cada cambio y cuando alguien se conecta o desconecta; cada 5 s revisa niveles y mapas y manda de nuevo solo si cambió algo (`GuildService.tick`).

## 3. Cofre compartido

Se abre hablando con cualquier **Depositario**: con guild, la ventana del depósito tiene dos pestañas, «Depósito» (de la cuenta) y «Cofre de guild». Es el mismo `DepositRequest` con `scope = 'guild'` y las mismas acciones (put, take, gold_in, gold_out, stack_in, stack_out, sort), con la misma atomicidad y el mismo anti-reenvío por `op_id` (los `ops` viven en el vault de la guild). **96 casillas** de equipo (el doble del depósito), oro y los mismos stacks (pociones, llaves, esquirlas).

- Todos guardan; **retiran el líder y los oficiales** (`DepositState.can_take`; el server rechaza con `rank`).
- **Registro:** los últimos 40 movimientos («Ana retiró Mandoble», «Beto depositó 500 de oro») se guardan con la guild y se ven abajo del cofre, para que se sepa quién sacó qué.
- Cuando alguien mueve algo, los demás conectados reciben el estado nuevo; el cliente lo usa solo si tiene esa pestaña abierta.

En el server: `Depot.apply(actor, req, host)` recibe un `VaultHost` (vault, casillas, `canTake`, cómo guardar y dónde anotar) que arma `GuildService.vaultHost(key)`. Sin host es el depósito de la cuenta de siempre.

## 4. Persistencia

Todas las guilds van en el registro `_guilds` del mismo Storage que las cuentas (archivo JSON o fila jsonb en Postgres), como `_subastas`: `{ v: 1, nextId, guilds: [{ id, name, tag, faction, crest, motd, created, members: [{ key, name, rank, joined, lastSeen }], vault, log }] }`. Cada cambio se escribe con `flush` junto con la cuenta tocada (el oro de fundar, la bolsa al mover algo del cofre), así un reinicio no duplica ni pierde nada. Lo que no se guarda y se rearma al arrancar: quién está conectado y las invitaciones pendientes.

## 5. Protocolo

- `GuildRequest { action, name, arg }` (tag 1500): `create` (name = nombre, arg = etiqueta), `invite`, `accept`, `decline`, `leave`, `kick`, `promote`, `demote`, `leader`, `crest` (arg), `motd` (arg), `disband`, `info`.
- `GuildState` (1500): id (vacío = sin guild), nombre, etiqueta, nación, escudo, miembros (`name, rank, online, level, cls, map, last_seen_ms, joined_ms`), tope, lema, tu rango, fecha de fundación.
- `GuildInvited` (1501): cartel a la derecha con Aceptar / Rechazar (igual al de la party).
- `DepositRequest.scope` / `DepositState.scope`, `log`, `can_take` para el cofre.
- El perfil de un jugador (`faccion;clase;look`) lleva la etiqueta como 4.ª parte, que **pone el server** (`withGuildTag` en `world.ts`); lo que mande el cliente ahí se ignora.

## 6. Código y pruebas

`apps/server/src/guild.ts` (servicio), `deposit.ts` (`VaultHost`), `systems/chat.ts` (canal), `world.ts` (etiqueta), `index.ts` (cableado); `apps/client/src/guild.ts` (ventana y escudo), `deposit.ts` (pestaña del cofre), `main.ts` (comandos, tecla O, etiqueta sobre la cabeza). Pruebas: `apps/server/test/guild.test.ts` (fundar, invitar, rangos, expulsar, lista con conectados primero y última conexión, avisos de conexión, escudo y lema, chat, disolver, cofre con permisos y registro, persistencia y recarga, borrado de personaje).

## 7. Pendiente / ideas

- Rangos con nombre propio y permisos configurables por el líder (hoy son fijos).
- Escudo sobre la cabeza o en el panel de party (hoy solo la etiqueta; el escudo se ve en la ventana).
- Oro de la guild que no sea retirable (contribución, como en Helbreath Evolution) y puestos a defender como Valdrys: post-beta.
- Buscador de guilds / cartel de reclutamiento en el chat.
