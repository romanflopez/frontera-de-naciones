# Party y arenas (borrador de diseño)

Estado: **party implementada (paso 1)**; arenas y mazmorras en grupo pendientes.

Hecho de la party: `apps/server/src/party.ts` (`PartyService`), mensajes `PartyRequest`/`PartyState`/`PartyInvited` (tags 600/601), comandos de chat en el cliente (`/invitar nombre`, `/aceptar`, `/rechazar`, `/salir`, `/expulsar nombre`, `/lider nombre`, `/p texto`), panel de compañeros en el HUD, exp compartida (total ×(1+0,1 por compañero extra), en partes iguales) y botín propio de cada compañero cercano (≤20 celdas, mismo mapa, vivo). Pendiente de la party: que la puerta de una mazmorra lleve a toda la party junta, clic derecho para invitar, y barras de los compañeros en el minimapa.

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

## 2. Arenas con cola (1v1 y 2v2)

- **Cola**: se entra desde un NPC/portal de la arena en las ciudades. 1v1 solo; 2v2 solo con una party de exactamente 2 (la dupla entra junta). Un jugador no puede estar en cola dentro de una mazmorra ni en combate.
- **Emparejamiento**: por puntaje (ELO simple por modo, arranca en 1000). Busca rivales dentro de un rango que se amplía con el tiempo en cola (por ejemplo ±100 a los 30 s, ±200 a los 60 s). Se puede cruzar facciones (la arena es neutral).
- **Confirmación**: al encontrar partida, 15 s para aceptar. Si alguien no acepta, vuelve a la cola quien aceptó y el otro sale.
- **Partida**: se crea un mapa temporal de arena (como las mazmorras: `temporary`, con `rest` y sin guardar posición), cuenta regresiva de 5 s con movimiento bloqueado, una sola ronda hasta que cae un bando (1v1) o todo un equipo (2v2). Límite de tiempo de 3 minutos: gana quien tiene más porcentaje de vida; empate = sin cambio de puntaje.
- **Reglas**: pociones **no** permitidas dentro (a decidir), sin recall ni teletransporte, muerte sin pérdida de exp ni ítems. Al terminar vuelven todos a su ciudad con la vida llena.
- **Desconexión**: cuenta como derrota si no vuelve en 30 s.
- **Puntaje**: ELO por modo; ranking separado de 1v1 y 2v2 (top 100) visible en el NPC de la arena. Recompensa: puntos de arena (moneda aparte) para cosméticos o ítems de PvP más adelante, sin poder.
- **Anti-abuso**: se evita rematch inmediato contra el mismo rival más de 3 veces seguidas, y se descuenta puntaje de quien abandona.
- **Equipo en la arena**: para el MVP **cuenta el equipo real**. Cuando existan las mejoras +N y las runas conviene revisarlo (normalizar stats o limitar por tier), porque con +N el que más farmeó gana casi siempre y el ranking pierde sentido. Es la decisión abierta más importante de este documento.

### Datos y protocolo

- Server: `apps/server/src/arena.ts` (colas por modo, emparejador, partidas activas, puntajes) y un `MapDef` de arena temporal instanciado por partida. `isEnemyPair` pasa a considerar un **equipo** de arena (hoy solo facción o todos contra todos).
- Persistencia: puntaje por cuenta en el registro (`AccountRecord`), junto a la economía.
- Mensajes: `arenaQueue`, `arenaLeaveQueue`, `arenaAccept`; `arenaState` (en cola, partida encontrada, cuenta regresiva, resultado).

## 3. Orden de implementación

1. Party: registro y comandos en el server, mensajes, panel del HUD, chat de party (con tests del server y prueba en el navegador con 2 clientes).
2. Exp y botín compartidos en `Economy.reward`, y entrada de la party a mazmorras.
3. Arenas: cola 1v1, emparejador, mapa de arena temporal, puntaje y ranking.
4. 2v2 (reusa la party) y reglas de abandono.

## 4. Decisiones abiertas

1. ¿Party de hasta 4 como se propone, o 5? (las mazmorras están pensadas para grupo; 4 mantiene el rol de cada uno).
2. ¿Pociones dentro de la arena permitidas o no?
3. ¿El equipo cuenta o se normaliza? (hoy cuenta; revisar con +N).
4. ¿Cola entre facciones o separada por facción?
5. ¿Qué dan los puntos de arena (cosméticos, ítems de PvP, nada por ahora)?

## 5. Chat por canales (implementado)

Cuatro canales, como Helbreath y Dreadmyst: **Global** (por defecto), **Nación** (tu facción), **Party** y **Guild** (todavía no existe: responde "Las guilds llegan próximamente"). Comandos: `/g`, `/n`, `/p`, `/gu` más el texto; sin prefijo el mensaje va por el canal elegido en el selector de la barra de chat (clic o Tab para cambiar entre Global, Nación y Party). Cada mensaje llega con su canal (`ChatMessageReceived.channel`) y se pinta con una etiqueta de color. Server: `handleChat` en `apps/server/src/index.ts`.
Pendiente: pestañas para filtrar por canal, ignorar jugadores, límite de ritmo anti-spam y el canal de guild cuando existan las guilds.
