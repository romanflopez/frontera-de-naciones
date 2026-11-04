# Party y arenas (borrador de diseño)

Estado: **party implementada (paso 1)** y **arenas 2v2 y 3v3 implementadas** (§2).

Hecho de la party: `apps/server/src/party.ts` (`PartyService`), mensajes `PartyRequest`/`PartyState`/`PartyInvited` (tags 600/601), comandos de chat en el cliente (`/invitar nombre`, `/aceptar`, `/rechazar`, `/salir`, `/expulsar nombre`, `/lider nombre`, `/p texto`), panel de compañeros en el HUD, exp compartida (total ×min(1+0,2 por compañero extra, 4), en partes iguales: 2 jugadores ×1,2, 4 jugadores ×1,6; fórmula de Helbreath, cada uno recibe al menos 1) y botín propio de cada compañero cercano (≤20 celdas, mismo mapa, vivo). **Quests en party:** el mob que mata cualquiera de la party cuenta para las misiones y los encargos del día de todos los compañeros cercanos (≤20 celdas del que lo mató, mismo mapa), **también del que está muerto** (ese no cobra exp ni botín, solo la misión; si un encargo lo sube de nivel, no lo revive). El encargo PvP «Defensa de la frontera» también le cuenta a cada compañero cercano, con sus propias reglas (6+ niveles abajo no cuenta, una vez por rival por día). En Dreadmyst no contaban y la gente dejaba de agruparse. **Botín sin "ninjas" [DM]:** los ítems, la exp, el oro del kill y el botín de jefe ya eran propios de cada compañero (van directo a la bolsa). Lo que cae al piso (montoncitos de oro y materiales) queda **30 s reservado a la party que mató al mob** (los que estaban cerca); después es de cualquiera. Cuando alguien de la party lo levanta, **se reparte solo** entre los compañeros vivos a ≤20 celdas del que lo levantó: el oro en partes iguales (lo que sobra, de a 1 al azar) y el material entero a uno al azar; todos ven el reparto en el chat. Los avisos de botín de la party solo llegan a los que están cerca. Pendiente de la party: que la puerta de una mazmorra lleve a toda la party junta, clic derecho para invitar, y barras de los compañeros en el minimapa.

Estado anterior: **borrador**. Orden de trabajo acordado: 1) party, 2) mejoras +1..+5 (`docs/ITEMS.md`), 3) arenas 1v1 y 2v2 con cola, 4) runas.
Hoy no hay party ni colas. Lo que existe: PvP entre facciones y una arena de todos contra todos escrita a mano en el mapa viejo (`isEnemyPair` en `apps/server/src/world.ts`, `docs/COMBATE.md`).

## 1. Party

Necesaria ya para las 6 mazmorras de grupo (`docs/MAPAS_FLARE.md`) y para el 2v2.

- **Tamaño**: hasta 4 jugadores. Un líder (el que invita primero); si el líder sale, pasa al siguiente.
- **Acciones**: invitar (por nombre o clic derecho sobre un jugador), aceptar/rechazar (la invitación vence a los 30 s), salir, expulsar (solo el líder), pasar liderazgo, disolver.
- **Misma facción**: en el MVP, solo jugadores de la misma facción. Una party no cruza facciones.
- **Chat de party**: canal propio, además del chat global actual.
- **Barras de los compañeros**: vida, maná y nivel en un panel chico del HUD, y puntos de los compañeros en el minimapa.
- **Exp**: se reparte entre los miembros que están en el mismo mapa y a menos de ~20 celdas del mob al morir. Con 2+ miembros activos hay un bonus chico de exp por jugador (a ajustar) para que agruparse no sea un castigo.
- **Botín**: **cada miembro cerca tira su propio botín** (oro y drop propios) cuando muere un mob o jefe; no hay pelea por ítems. Los jefes de mazmorra dan su ítem a cada miembro cerca, con tirada independiente. Esto conserva el ritmo tranquilo.
- **Mazmorras**: la puerta de la mazmorra lleva a toda la party cercana junta (hoy cada uno cruza por su cuenta; sigue valiendo, pero la party cae al mismo piso). Si alguien muere, reaparece en la entrada del piso 1 (ya implementado en `MapDef.respawn`).
- **Persistencia**: la party vive en memoria del server; si el server se reinicia se disuelve. Si un miembro se desconecta, queda en la party 2 minutos (como la gracia de desconexión actual) y después sale.

### Datos y protocolo

- Server: nuevo módulo `apps/server/src/party.ts` con el registro de parties (id, líder, miembros, invitaciones pendientes con vencimiento). Un `Player` guarda solo `partyId`.
- Mensajes nuevos (protobuf, siempre al final): `partyInvite`, `partyRespond`, `partyLeave`, `partyKick`, `partyLeader` del cliente; `partyState` (miembros con vida/maná/mapa), `partyInvited`, `partyEvent` (texto) del server.
- La exp y el botín compartidos se resuelven en `Economy.reward` (hoy un golpe final = un jugador): pasa a recibir la lista de beneficiarios.
- El server valida todo (distancia, mismo mapa, facción, tamaño). El cliente solo pide y dibuja.

## 2. Arenas 2v2 y 3v3 con cola (implementado)

Decisión del 3/11/2026 (reemplaza el borrador de 1v1/2v2): **2v2 y 3v3, sin cola 1v1**; se entra **solo con la party armada** del tamaño exacto; **rating Glicko-2 por modo** y por temporada; **penalización de 10 min** por abandonar [DM]; **sin premios de temporada en la beta**.

Código: `apps/server/src/arena.ts` (`ArenaService`: cola, invitación, partida, ranking), `apps/server/src/glicko.ts` (Glicko-2), reglas dentro del mapa en `GameWorld` (sección "arena 2v2 / 3v3" de `apps/server/src/world.ts`) y mapas y constantes en `packages/world/src/arena.ts` (`ARENA_MAPS`, `ARENA_RULES`). Tests: `apps/server/test/arena.test.ts`.

### Ventana de arena (NPC) y comandos
- **Maestro de arena**: NPC `arenero_s` (Brando, patio de armas de Solmar) y `arenero_v` (Sigrun, patio de armas de Vhar). Al hablarle se abre la ventana de arena del cliente: estado (sin party / en cola / partida encontrada / en partida / penalizado), botones **Anotar 2v2 / 3v3** o **Salir de la cola**, tu rating por modo y el ranking de la temporada con pestañas 2v2/3v3. Los datos llegan con `ArenaInfo` (proto 604), que el server manda al recibir `/arena info`; la ventana lo pide al abrirse, después de cada botón y cada 4 s mientras está abierta. Los botones mandan los mismos comandos de chat.
- **Partida encontrada**: el server manda `ArenaInvited` (proto 603) a cada jugador; el cliente muestra el cartel con **Aceptar / Rechazar** y la barra de 30 s (el mismo de la invitación de party) más el aviso grande al centro. Al aceptar todos, el server transfiere a las dos parties a la instancia.
- **Comandos (chat)**, siguen valiendo: `/arena` (ayuda y estado) · `/arena 2v2` · `/arena 3v3` (el líder, con la party armada) · `/arena salir` · `/arena aceptar` · `/arena rechazar` · `/arena ranking [2v2|3v3]` · `/arena rating` · `/arena info` (estado para la ventana).No hace falta protocolo nuevo: el cliente los reenvía como chat y el server contesta con mensajes del sistema.

### Cola
- La anota el **líder** de una party de **exactamente 2 (2v2) o 3 (3v3)**. Cada miembro tiene que estar conectado, vivo, fuera de mazmorras y arenas, sin penalización y **sin haber peleado con un jugador en los últimos 15 s** (la cola no sirve para escapar de una pelea).
- **Emparejador**: junta dos parties del mismo modo con nivel promedio y rating promedio parecidos. La ventana arranca en ±5 niveles y ±150 de rating y se abre cada 30 s de espera (+2 niveles, +50 de rating; tope ±40 niveles). Se puede cruzar con la propia nación: la arena es neutral.
- Hasta **6 partidas a la vez** (una instancia por partida); si están todas ocupadas, la cola espera.

### Invitación
- Al encontrar partida, todos tienen **30 s** para `/arena aceptar`. Si alguien rechaza, no contesta a tiempo o ya no puede entrar (se metió en una mazmorra, murió, se desconectó), **queda penalizado** y su party sale de la cola; **la otra party vuelve a la cola en su lugar** (con su tiempo de espera).

### Partida
1. Se arma una instancia `arena…#a<id>` de una de las tres arenas, en rotación: **Claro** (cuatro piedras bajas, la arena original), **Ruinas** (seis columnas en dos anillos) y **Muros** (dos muros cortos que parten el centro en tres pasillos). Mismo tamaño (34×34) y mismos puestos de salida: oeste y este, el compañero 2 y 3 a dos celdas arriba y abajo.
2. **Preparación, 60 s**: al llegar se sacan buffs y escudos y se llenan vida y maná; nadie se mueve a más de 1,5 celdas de su puesto (la "jaula") y no hay daño.
3. **Pelea, hasta 15 min**: gana el equipo que deja en el piso a todos los rivales; a los 15 min es **empate**. Los equipos son las parties: dos parties de la misma nación pelean entre sí; los compañeros no se pegan y los invisibles se ven dentro del equipo.
   - **Sin pociones, sin recall, sin resurrección** (Despertar no anda); **invisibilidad: 3 usos por jugador**.
   - **Curación y regeneración de vida −20 % cada 3 min** de pelea (100 % → 80 → 60 → 40 → 20 % desde los 12 min): evita dos sanadores que no mueren.
   - **Morir es gratis**: no se pierde exp. El caído queda en el piso hasta el final (no reaparece).
4. **Final, 5 s de festejo**: todos vivos y llenos; después cada uno vuelve **al punto exacto desde donde entró**.

### Abandono y penalización [DM]
- **10 min sin poder entrar** para quien: sale de la cola (`/arena salir`), rechaza o deja vencer la invitación, deja la party mientras está en la cola (si lo expulsan, paga el líder que expulsó) o **abandona la partida**. Desconectarse dentro de una partida no es abandonar: hay 60 s de gracia para volver (la misma gracia de siempre); pasada la gracia, sí.
- Solo paga el que se va: sus compañeros pueden volver a anotarse. Un equipo que se queda sin nadie pierde; el que abandonó cuenta como derrota en su rating.

### Rating y temporadas
- **Glicko-2 por jugador y por modo** (2v2 y 3v3 aparte). En cada partida, cada uno se actualiza contra un rival compuesto: el promedio del rating del otro equipo y la media cuadrática de sus desvíos. Arranca en 1500 (desvío 350).
- **Ranking**: aparece quien tiene **10 partidas** en la temporada; se ve con `/arena ranking`.
- **Temporada**: `FDN_ARENA_TEMPORADA` (número). Al cambiarla, quien jugó 10 o más vuelve hacia el medio (la mitad de la distancia a 1500, desvío al menos 200) y los contadores de la temporada vuelven a cero; el resto queda igual.
- **Premios de temporada: ninguno en la beta.** Si se suman, que sean títulos o apariencias (regla de diseño 6 del roadmap): si dan poder aparece el farmeo de rating con cuentas que pierden a propósito.
- Se guarda en el mismo `Storage` que las cuentas, en el registro `_arena`.

### Para probar con menos gente
`FDN_ARENA_PRUEBA=1` deja anotarse sin party o con una party más chica que el modo (por ejemplo, dos personas solas en la cola de 2v2 juegan un 1v1). Un GM puede mirar las arenas con `/gm ir arena_ruinas` (sin partida son todos contra todos).

### Queda para después
"10 s quieto y visible" para aceptar; evitar la revancha inmediata contra la misma party; normalizar el equipo dentro de la arena (decisión abierta, ver §4).

## 3. Orden de implementación

1. Party: registro y comandos en el server, mensajes, panel del HUD, chat de party (con tests del server y prueba en el navegador con 2 clientes).
2. Exp y botín compartidos en `Economy.reward`, y entrada de la party a mazmorras.
3. ~~Arenas: cola, emparejador, mapa de arena temporal, puntaje y ranking.~~ Hecho (2v2 y 3v3, §2).
4. ~~Reglas de abandono.~~ Hecho (§2).

## 4. Decisiones abiertas

1. ¿Party de hasta 4 como se propone, o 5? (las mazmorras están pensadas para grupo; 4 mantiene el rol de cada uno).
2. ~~¿Pociones dentro de la arena permitidas o no?~~ No (§2).
3. ¿El equipo cuenta o se normaliza? (hoy cuenta; revisar con +N).
4. ~~¿Cola entre facciones o separada por facción?~~ Una sola cola; la arena es neutral (§2).
5. ~~¿Qué dan los puntos de arena?~~ En la beta, nada (§2).

## 5. Chat por canales (implementado)

Cuatro canales, como Helbreath y Dreadmyst: **Global** (por defecto), **Nación** (tu facción), **Party** y **Guild** (todavía no existe: responde "Las guilds llegan próximamente"). Comandos: `/g`, `/n`, `/p`, `/gu` más el texto; sin prefijo el mensaje va por el canal elegido en el selector de la barra de chat (clic o Tab para cambiar entre Global, Nación y Party). Cada mensaje llega con su canal (`ChatMessageReceived.channel`) y se pinta con una etiqueta de color. Server: `handleChat` en `apps/server/src/index.ts`.
Pendiente: pestañas para filtrar por canal, ignorar jugadores, límite de ritmo anti-spam y el canal de guild cuando existan las guilds.
