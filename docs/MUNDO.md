# El mundo: de un mapa único a mapas separados

Estado: **Fases 0 y 1 implementadas** (infraestructura multi-mapa con 3 mapas de prueba) **Fase 2 en curso: Villa de Solmar hecha** (villa exterior + 8 interiores; Vhar pendiente) y **Fase 3 hecha: núcleo de caza** (Llanos del Alba, La Frontera, Camposanto Viejo y Páramo Reseco con pits de 45-60 mobs). Ver «Estado de la implementación» al final de la sección 4. El resto sigue en diseño. Diagrama: [`mundo-grafo.html`](mundo-grafo.html) (SVG autocontenido; se abre en el navegador).
Base que se mantiene: la curva de niveles y mobs de [`ZONAS.md`](ZONAS.md) (niveles 1-12), la cadena de misiones del Capitán y los portales de `packages/world/src/training.ts`.

Decisión del usuario: **mapas separados**. Cada zona es su propio mapa grande; se conectan con caminos, portales y puertas, con pantalla de carga. La idea de organizar el mundo como un grafo (naciones enfrentadas, zona de principiantes, tierra compartida, mazmorras en cadena, zonas por evento) viene de un diagrama de referencia; los nombres, el lore y el contenido son nuestros.

---

## 1. Arquitectura actual (lo que hay hoy)

### 1.1 Mundo y generación (`packages/world`)
- Un solo `WorldMap` (`index.ts`): `size`, `tiles[y][x]`, `blocked`, `safe`, `props`, `decals`, `zones`, `buildings`, `npcs`, `spawn`, `fire`, `portals`, `waypoints`, `waypointArrivals`, `dungeon(s)`, `hubs`, `cities`.
- Se arma **por código y con semillas fijas**, igual en cliente y server: `buildSolmar()` (40x40) → `extendSolmar` (`frontier.ts`: páramo, cripta, arena, a 64) → `extendAshlands` (`ashlands.ts`: tierras de ceniza y Cámara del foso, a 96) → `extendCities` (`cities.ts`: Solmar y Vhar) → `extendTraining` (`training.ts`: waypoints). Todo comparte una grilla cuadrada de 96x96. Ninguna función usa `Math.random`/hora (si lo hicieran, cliente y server divergirían).
- Registro de mapas: `MAPS: Record<string, () => WorldMap> = { solmar: buildSolmar }`. Es el único.
- Coordenadas **globales** de todo: `CITIES` (rectángulos), `HUBS` (punto de aparición por facción), `RESERVED`, la arena `{46,26,60,38}`, `dungeon`/`dungeons` (rectángulos que el cliente oscurece), y las zonas de mobs (`Zone {type,x,y,r,n,name,lvl?}`).
- Un `Portal` es `{x,y,tx,ty,msg,key?,train?}`: pisar `(x,y)` te lleva a `(tx,ty)` **del mismo mapa**. `portalGate()` decide si deja pasar (misión/nivel de `train`, o llave).
- `TRAINING` (10 pasos) + `Waypoint`: hoy solo los **Portales de Frontera** de ciudad (`city:solmar` en la plaza de la villa, `city:vhar` en la ciudad de Vhar del mapa viejo); las zonas no tienen portal, solo `waypointArrivals` (celda de llegada, destino del menú). `waypointTarget()` devuelve `{map,x,y,step}`; `WAYPOINT_RANGE = 3`. Para volver: recall (H), ver 3.3.
- Mobs: `mobs.ts` (13 tipos, `MOB_TYPES` fija el índice del protocolo), `mobDef(tipo, zona)` reescala vida/daño/exp con `zone.lvl` (los bosses no se reescalan).
- Economía compartida (`economy.ts`): `QUESTS` (por **tipo de mob**; `zone` es solo texto), `KEYDEFS` (llaves `cripta` y `foso`), `SHARDS_PER_KEY = 3`.

### 1.2 Server (`apps/server`)
- **Ya hay noción de varios mundos, pero un solo mapa en la práctica.** `index.ts` lee `data/worlds.json` (hoy una entrada: `solmar`), construye un `GameWorld` por entrada (`worlds: Map<string, GameWorld>`) y cada sesión guarda su `worldId`. El server original en C# (`reference/server-csharp/Server.cs`, `RunWorldTransferLoopAsync` con `TransferPlayerOut/In`) sí transfería jugadores entre mundos; **el port a TypeScript no lo trajo**. En el protocolo quedaron `WorldChangeRequest` (campo 9 de `ClientMessage`), `WorldsList` y `TeleportTarget`, sin handler.
- `GameWorld` (`world.ts`, 923 líneas) = un mapa: `players`, `playersById`, `timers`, `mobSim`, `loot` (`GroundLoot`), `Occupancy` (`map.ts`, bloqueos + celdas ocupadas por jugadores; los mobs **no** ocupan celdas), y su propio `setInterval` de 50 ms (`tick`: temporizadores, estado, regen de maná, `mobSim.update()`, sincronía del suelo cada 400 ms, timeouts de ping).
- **Interés (AOI)**: caja por distancia, no grilla. `nearbyPlayers()` recorre todos los jugadores del mundo y filtra por `viewRadiusX/Y` (18 x 11, `settings.json`); `playersInRange` por jugador y `syncVisibilityAfterMovement()` mandan solo las diferencias (`PlayersEnteredRange/LeftRange/PlayerMoved`). Los mobs van en `MobsSnapshot` a 10 Hz con caja `VIEW_X=20, VIEW_Y=13` (`mobs.ts`). El suelo, igual (`syncGround`).
- **Movimiento** (`handleRequestMovement`): el server valida un paso por vez (distancia exacta 1, ocupación, cadencia anti-speedhack). Ignora `requestMovement` cuyo `gameWorldId` no coincide con el del mundo (línea ~343): **ya es una defensa útil contra mensajes viejos tras cambiar de mapa**. Hoy el cliente manda siempre la constante `'solmar'`.
- **IA de mobs** (`MobSim`, `mobs.ts`): máquina `idle → chase → return`, aggro por distancia (4,5; contagio a 3,2 celdas), correa de 17 celdas al centro de la zona, habilidad de boss con aviso de 0,8 s, respawn `mobRespawnSecs` (22 s común, 120/150/180/240 s bosses). **Sin pathfinding**: el mob avanza en línea recta y se desliza por los lados si choca (`step`). Spawns: por cada `Zone`, `n` mobs en un cuadrado de ±`r` (hasta 40 intentos). Recorre todos los mobs cada tick (no duerme sin jugadores); el empuje entre mobs en `chase` es O(M²). El snapshot es O(jugadores x mobs).
- **Colisión**: grilla estática `blocked`/`safe` (el cliente usa A* propio para clickear; el server solo valida pasos).
- **PvP** (`isEnemyPair`): enemigos = distinta facción fuera de zona segura, o **todos contra todos si ambos están en la arena** (rectángulo `46..61 x 26..39` **escrito a mano** en `world.ts:746`; también en `main.ts:683` y `index.ts:74`). La facción sale del campo `profile` (lo manda el cliente) para visibilidad/PvP, y de `econ.faction` para el progreso.
- **Teletransportes** (`handleTeleport`): solo acepta (a) un portal del mapa cuyo destino `(tx,ty)` coincide con lo pedido y a ≤1 celda, con `portalGate`, o (b) ir al `HUBS[facción]` en los primeros 30 s. La llave se descuenta **al cruzar** (`consumeKey`). `handleWaypoint` valida `WAYPOINT_RANGE` y que la zona esté abierta.
- **Muerte** (`respawn`): vuelve al `HUBS[facción]` del mismo mapa; pierde 5 % de la exp del nivel (`Economy.onDeath`).
- **Botín y economía**: `Economy.reward()` decide exp/oro/item/poción/esquirla y avance de misión al matar; el boss suelta esquirla `foso` **si `zoneName === 'Cripta olvidada'`** (si no, `cripta`). `maxLootLvl()` recorre `buildSolmar().zones`. El suelo (`GroundLoot`) es por mundo y vive en memoria. `EconCtx.npcs` = NPCs del mapa (se valida distancia a tiendas y Capitán).
- **Chat** (`index.ts: handleChat`): **global** (todas las sesiones, sin canales). El aviso de muerte (`pvpKill`) va a todos los del mundo.
- **Party**: no existe. Hay un diseño propuesto en `ECONOMIA_SERVER.md` (reparto entre miembros "en el mismo mundo y a ≤25 celdas").

### 1.3 Protocolo (`packages/proto/network.proto`)
- `InitialGameWorldState { gameWorldId, mapName, playerX/Y, playerDirection, musicFile, weather, teleportLocs }` ("se manda en cada carga de mapa"). El cliente hoy solo hace `snapTo` y limpia `others`/`drops`: no recarga el mapa.
- `PlayerTeleported {x,y}` (mismo mapa), `ResetPosition/PositionCorrected` (con `gameWorldId`), `PingResponse.playersInMap`.
- `MobsSnapshot/MobSnap.zone` y `MobDied.zone` son **índices en `map.zones`**; el cliente los resuelve con `ZONES[idx]`. Vale mientras cliente y server tengan la misma lista de zonas (por mapa).
- Mensajes nuevos van por encima del tag 144 (`GroundItemRemoved`); el oneof tiene huecos libres.

### 1.4 Persistencia (`docs/PERSISTENCIA.md`, `index.ts`, `player.ts`, `storage.ts`)
- **Cuenta** (archivo o Postgres): estado económico `Econ` (nivel, exp, oro, bolsa, equipo, pociones, misión `q`, llaves/esquirlas, portales abiertos `u`, facción, clase). **No tiene posición.**
- **Personaje del mundo** (`chars/<id>.json`, **solo disco**, se pierde en un redeploy de Render free): `PersistedPlayer { worldId, x, y, direction, apariencia, velocidad, ... }`. Se escribe al desconectar y al apagar, no periódicamente. `worldId` ya existe: al entrar, si `saved.worldId` está en `worlds` se usa, si no se cae a `initialMap`.
- `restPosition()`: si la posición cae en la arena o en una mazmorra (rectángulos fijos del mapa único), se guarda el spawn del campamento.
- Flujo de cuenta nueva: se entra a `initialMap`, el cliente elige clase y facción, manda `saveCharacterRequest`, el server crea el personaje (`createFromSave`) y el cliente pide el teletransporte a su `HUB` (solo válido 30 s).

### 1.5 Cliente (`apps/client/src/main.ts`, 1875 líneas)
- `const MAP = buildSolmar()` a nivel de módulo, y de él salen constantes: `N`, `tiles`, `blocked`, `safe`, `props`, `decals`, `ZONES`, `WAYPOINTS`, `MAP.portals`, `MAP.npcs`, `MAP.fire`, `MAP.dungeon(s)`, `MAP.cities`. Todo el código (A*, `walk`, `isSafe`, render, HUD, tiendas) las usa directamente. Constantes de mapa escritas a mano: `MAP_WORLD_ID = 'solmar'`, `ARENA`.
- Render: canvas 2D isométrico (tile 96x48), recorta por viewport (tiles) pero **itera todos los `props` cada frame** (ok con ~4.000, no con decenas de miles). Iluminación: viñeta oscura alrededor del jugador, velo violeta en `inDungeon`, luz de fogata en `MAP.fire`. **No hay minimapa ni mapa del mundo.**
- `checkPortals()` detecta que pisás un `Portal` y manda `playerTeleportRequested{x,y}`; el menú de waypoints manda `waypointRequest{id}`.
- Carga inicial (`boot`): atlas de tiles (`world`, `dungeon`, `terrain`) y los **13 sprites de mobs (~12 MB)** de una vez. Los ids de tiles y props son globales, así que sirven para todos los mapas.
- Zona/nivel en pantalla: `ZONES.find(...)` y `cityAt()` (rectángulos globales). `questLevel()` y `currentTrainStep()` buscan zonas por nombre solo en el mapa cargado.

### 1.6 Lo que ya está a favor
1. Server con `Map<id, GameWorld>`, `worldId` en sesión y en el guardado, `gameWorldId` en los mensajes de movimiento.
2. Mapas generados por código compartido: el cliente puede construir cualquier mapa por id sin pedirlo por red.
3. Botín, ocupación, mobs, AOI y NPCs ya son **por mundo**: no hay que "partir" nada, solo instanciar N.
4. El chat ya es global; `Player.playerId` es global y único (contador de módulo).
5. Patrón de referencia del server original para la transferencia.

---

## 2. Qué hay que cambiar para soportar N mapas

### 2.1 Modelo de datos nuevo (`packages/world`)

```ts
interface MapDef {
  id: string; name: string; region: 'solmar'|'vhar'|'inicio'|'comun'|'cripta'|'ceniza'|'foso'|'jefe'|'pvp';
  size: number;                         // mapas cuadrados (ver riesgos)
  lvl: [number, number] | null;         // rango recomendado (solo informativo/HUD)
  pvp: 'off' | 'faction' | 'ffa';       // reemplaza el rectángulo de la arena
  temporary?: boolean;                  // no se guarda la posición: al volver se usa `rest`
  rest?: { map: string; x: number; y: number } | 'faction_home';
  respawn: { map: string; x: number; y: number } | 'faction_home' | 'here';
  ambient?: { tint?: string; dark?: number; weather?: number; music?: string };
  build(): WorldMap;
}
interface Link {                        // evolución de `Portal`
  id: string;                           // estable: el cliente pide por id, no por coordenadas
  map: string; x: number; y: number;    // celda disparadora
  to: { map: string; x: number; y: number };
  kind: 'walk'|'oneway'|'portal'|'door'|'npc';
  gate?: { lvl?: number; quest?: number; key?: string };
  msg: string;
}
```
- `WORLD_GRAPH` (datos puros) + `MAPS` por id. `HUBS`/`CITIES`/`cityAt` globales se reemplazan por `MapDef.city` y `faction → {map,x,y}` (hogar de cada facción).
- `Zone` gana `mapId` implícito (la lista es por mapa) y `drops?: { shard?: KeyId }` (reemplaza el `zoneName === 'Cripta olvidada'`).
- `Waypoint`/`waypointArrivals`/`waypointDest()` pasan a `{map, x, y}`.
- Un validador de grafo (`check:graph`): destinos caminables y dentro del mapa, reciprocidad salvo `oneway`, todo alcanzable desde ambos hogares, nombres de zona únicos globalmente, `lvl` monótono por camino.
- `caminos` (`walk`): una franja de 3 celdas en el borde del mapa que dispara el vínculo, igual que una escalera. Un solo mecanismo para los 5 tipos; cambian el requisito y el dibujo.

### 2.2 Server: cambios concretos

| Área | Archivo / función | Cambio | Riesgo |
|---|---|---|---|
| Registro de mundos | `index.ts` (bucle `for wc of worldConfigs`), `config.ts: loadWorlds`, `data/worlds.json` | Un `WorldRegistry` que crea `GameWorld` **a pedido** desde `MapDef` (no desde `worlds.json`); `settings.initialMap` pasa a ser el mapa de la villa neutral para cuentas nuevas. | Arranque lento si se crean 29 de golpe: crear en la primera entrada. |
| Tick | `GameWorld` constructor (`setInterval` por mundo) | Un solo scheduler que recorre los mundos **activos**; mundo vacío = hibernar (`MobSim` no actualiza, mobs vuelven a vida llena al despertar; los timers de respawn siguen). | Mobs "congelados" visibles al despertar: reiniciar posiciones. |
| Jugador | `player.ts: Player`, `toPersisted(worldId)` | Campo `mapId`. `Player` pasa a **moverse** entre mundos conservando `status`, `pvp`, `econ`, `prog`, `hp/mp`, `profile`. | Estado atado al mundo viejo (ver timers). |
| Transferencia | `world.ts` (nuevo `detachPlayer` / `attachPlayer`), `index.ts` (`session.worldId`) | `detachPlayer`: libera la celda de `Occupancy`, avisa `PlayersLeftRange` a los que lo veían, limpia `playersInRange`/`groundSeen`. `attachPlayer`: `spawnLocation`, `Occupancy`, `completeJoin`. Guard `transferPending` por sesión (existe en el C# original). | Doble disparo del portal; desconexión a mitad de camino. |
| Timers | `world.ts: setTimeout` (HoT de pociones ~l.823, protección de aparición, ataques de mobs) | Los closures usan `this` del mundo viejo (`announceVitals` → `broadcastNear` con coordenadas del mapa equivocado). Mover los HoT a temporizadores **del jugador** o verificar `p.mapId === this.id`. | Curaciones/avisos fantasma tras cruzar. |
| Portales | `world.ts: handleTeleport`, `isPortalCell`, `HUBS` | Pedido por **`portalId`** (hoy se identifica por destino `(tx,ty)`, ambiguo entre mapas). Validar distancia ≤1, `portalGate` ampliado (`lvl`, `quest`, `key`), vivo, no `transferPending`. La llave se consume al cruzar (igual que hoy). | Perder una llave si se muere dentro (ver decisiones). |
| Waypoints | `handleWaypoint`, `waypointDest`, `TRAINING` | Destino `{map,x,y}`; viaje entre mapas = transferencia. El menú sigue validando `WAYPOINT_RANGE` contra los waypoints **del mapa actual**. | Bajo. |
| PvP | `isEnemyPair` (arena `46..61`), `index.ts: restPosition`, `main.ts: ARENA` | Reglas por `MapDef.pvp` (`off`/`faction`/`ffa`) y `temporary`. Tres lugares con números mágicos pasan a leer el mapa. | Olvidar uno: PvP donde no debe. |
| Muerte | `respawn()` | `MapDef.respawn`; si es otro mapa, transferencia. | Viajes largos tras morir. |
| Mobs | `mobs.ts: MobSim` | `this.N = map.size` asume cuadrado (se mantiene). `reward()` recibe `mapId`. VIEW_X/Y fijo vs `settings.radius`. | Mapas grandes = más mobs: medir O(M²). |
| Economía | `economy.ts`: `maxLootLvl()` (usa `buildSolmar().zones`), `reward()` (`'Cripta olvidada'`), `QUESTS[].zone` | `maxLootLvl` itera todas las zonas de todos los mapas; la esquirla sale de `zone.drops`; las misiones por tipo de mob cuentan en **cualquier** mapa (decisión: acotar por mapa/zona). | Una misión "Alas de ceniza" se completaría en los Riscos del Wyvern. |
| Chat | `index.ts: handleChat`, `messages.ts: chatMessageReceived` | Agregar `channel` (mapa / global / facción) en el proto; por defecto **mapa** + comando global. | Spam global entre 29 mapas. |
| Ping | `pingResponse.playersInMap` | Sigue por mapa; sumar `playersOnline`. | Bajo. |
| Persistencia | ver 2.5 | | |

### 2.3 Protocolo (propuesta, tags libres desde 150)

- Cliente → server: `PortalRequest { portal_id }`; `MapReady { map_id, map_hash }`.
- Server → cliente: `MapTransfer { map_id, name, x, y, direction, hash, music, ambient }`.
- `InitialGameWorldState` queda como "mapa cargado": se manda **después** del `MapReady`.
- `WorldChangeRequest` (campo 9) se deja sin uso (marcar `reserved`).
- `map_hash` (FNV de `blocked` + tamaño): el cliente verifica que generó el mismo mapa que el server; evita que un cliente desactualizado camine por paredes fantasma tras un deploy.

Secuencia de cruce (dos fases, para que el server no mande estado antes de que el cliente arme el mapa):
1. El cliente pisa el vínculo y manda `PortalRequest(id)`.
2. El server valida y hace `detachPlayer` del mundo A (el jugador queda **fuera de todo mundo**, no se lo puede atacar), `session.worldId = B`, guarda el personaje y manda `MapTransfer`.
3. El cliente muestra la pantalla de carga, limpia `others/mobs/drops/fx`, construye el mapa (en bloques o con `requestIdleCallback` para no trabar la UI), carga lo que falte (sprites) y manda `MapReady`.
4. El server hace `attachPlayer` en B y manda `InitialGameWorldState` + vecinos + mobs + suelo. Se reinicia `pingGraceUntil` (el cliente se traba al armar el mapa; el comentario de `PING_JOIN_GRACE_MS` ya lo prevé).
5. Si no llega `MapReady` en ~20 s: se adjunta igual (o se desconecta). Si el socket cae entre 2 y 4, al reconectar se vuelve a mandar `MapTransfer`.

Como el WebSocket es ordenado, todo lo que el mundo A había encolado llega antes de `MapTransfer`: no hay mensajes de A mezclados con el mapa B (los índices de zona de `MobsSnapshot` siguen siendo válidos).

### 2.4 Cliente: cambios concretos
- Convertir el módulo a **estado de mapa mutable**: `loadMap(id)` reemplaza `MAP, N, tiles, blocked, safe, props, decals, ZONES, WAYPOINTS`; un objeto `world` en lugar de constantes (hay ~40 referencias; es la parte más invasiva y está toda en un solo archivo).
- `MAP_WORLD_ID` dinámico (se manda en `requestMovement`).
- `checkPortals()` usa los `Link` del mapa actual y manda `PortalRequest`. Mostrar el requisito sin ir al server (`portalGate`).
- Pantalla de carga con nombre del mapa, rango de nivel y consejo; reutilizar el estilo del login. Cierre al recibir `InitialGameWorldState`.
- Iluminación por mapa (`ambient`): hoy `inDungeon()` mira rectángulos; pasa a un flag del mapa. `MAP.fire` → lista de luces.
- Zona/nivel: `cityAt` y `ZONES.find` pasan al mapa actual; `questLevel`/`currentTrainStep` necesitan un **índice global de zonas por nombre** (`ALL_ZONES`).
- **Minimapa y mapa del mundo** (hoy no hay): a 160x160 son casi obligatorios. El mapa del mundo puede dibujar el mismo grafo del diagrama.
- Opcional: cargar los sprites de mobs por mapa (hoy ~12 MB al inicio).
- `enterWorld()`/`startFlow()`: ya no pide teletransporte al `HUB`; el server decide el mapa de aparición.

### 2.5 Persistencia y migración
- `PersistedPlayer` ya guarda `worldId`; agregar `v: 2`. `restPosition()` se generaliza con `MapDef.temporary/rest` (arena, mazmorras y Campo de Batalla no guardan posición).
- Guardar también **en cada cambio de mapa** (cuesta una escritura chica y evita que un crash deje al jugador "en el mapa viejo").
- Recomendado: mover `{mapId,x,y}` al registro de la **cuenta** (archivo/Postgres). Hoy `chars/` es solo disco: en Render free la posición se pierde en cada redeploy (nivel/ítems no).
- **Migración de jugadores existentes**: sus `chars/*.json` tienen `worldId: 'solmar'` y coordenadas del mapa de 96x96. No se pueden reinterpretar (caerían en cualquier lado, incluso en celdas bloqueadas). Regla: sin `v` o `v < 2` → **se coloca en el hogar de su facción** (la facción está en la cuenta). Cuenta (`Econ`: nivel, exp, oro, bolsa, misión, llaves, portales abiertos `u`) **no cambia**: los 12 ids de TRAINING siguen válidos. Para no tocar el mapa legado mientras dura la migración, los ids nuevos no reutilizan `solmar` (ver fases).
- Los scripts de prueba (`scripts/test-economy.ts`, `test-combat.ts`) usan `playerTeleportRequested` con coordenadas globales y `MAPS.solmar`: hay que reescribirlos para viajar por portal/`FDN_DEBUG_WARP` con `mapId`.

### 2.6 Cosas que dependen del mapa único (inventario)
- Arena `46,26,60,38` en tres archivos. `HUBS`, `CITIES`, `cityAt`, `RESERVED` (cities.ts). `restPosition` y `home.dungeon(s)` (`index.ts`). `maxLootLvl` (`economy.ts`). `'Cripta olvidada'` en `reward()`. `questLevel`, `currentTrainStep`, `startFlow` (zona por nombre/ distancia). Portal a Vhar `(34,14) ↔ (78,24)` y escalera a la arena `(13,13)` en `cities.ts`/`frontier.ts`.
- **Party/botín**: el botín ya es por mundo; el diseño de grupos ("mismo mundo y ≤25 celdas") sigue valiendo y hoy se cumple solo. Un grupo debe poder tener miembros en mapas distintos (lista de miembros por `accountKey`, no por mundo); el chat de grupo, global.
- **Misiones**: el Capitán está en la villa; la entrega no depende de coordenadas. Solo cambia el conteo por tipo de mob (ver tabla de economía).
- **Interés (AOI)**: es por mundo, así que mapas distintos no se ven entre sí sin trabajo extra; solo habría que optimizar (`nearbyPlayers` O(P)) en mapas con 100+ jugadores simultáneos (villas, Frontera): grilla espacial recién ahí.

### 2.7 Riesgos transversales
1. Cliente y server deben construir el **mismo** mapa: determinismo estricto + `map_hash`. Cualquier mapa nuevo con `Math.random` rompe todo.
2. Tiempo de generación en el cliente (160x160 con ruido): medir; hacerlo en la pantalla de carga.
3. Un deploy que cambie un mapa invalida posiciones guardadas (mitiga el `v`/hogar de facción).
4. `props` sin índice espacial: tope práctico ~5.000 por mapa hasta indexar por chunks.
5. Memoria: 286.000 celdas en total (~7 MB en el server); sin problema. El cliente carga **un** mapa.
6. Cruce atómico: doble portal, caída de socket, muerte justo al cruzar.
7. Mundo vacío vs mobs "vivos": hibernación.

---

## 3. El grafo del mundo (29 mapas)

Tamaños pensados con la velocidad actual (270 ms por celda corriendo = 3,7 celdas/s): 64 → 17 s de lado a lado, 128 → 35 s, 160 → 43 s. Hoy todo el mundo junto es de 96 celdas (26 s). Total propuesto: ~286.000 celdas (~31 veces el mapa actual).
Reglas de lectura: **Nv** = nivel del mob (de `ZONAS.md`; los jefes no se reescalan). `n x campamentos` = mobs por campamento (`Zone.n`, radio `r` 9-12) y cantidad de campamentos; densidad objetivo ~1 mob cada 30-60 celdas dentro de un campamento y mapa mayormente despejado entre campamentos.

### 3.1 Tabla de mapas

| id | Nombre | Tam. | Nv | Mobs (tipo, Nv, n x campamentos) | PvP | Notas |
|---|---|---|---|---|---|---|
| `solmar_villa` | Villa de Solmar | 96 | - | - | no | plaza con círculo rúnico, Portal de Frontera, Capitán Aldric, mercader de pociones, guardias. Spawn de Solmar. |
| `solmar_puerto` | Puerto de la Marea | 72 | - | - | no | joyera, alquimista, mercado y muelles |
| `solmar_cuartel` | Cuartel del Faro | 48 | - | - | no | armero, armadurero, patio de entrenamiento; acceso al Coliseo |
| `solmar_jardin` | Jardín de las Mareas | 64 | - | - | no | descanso, lore, sin tiendas (espacio para pesca/eventos) |
| `vhar_ciudadela` | Ciudadela de Vhar | 96 | - | - | no | muralla de hierro, plaza de brasas, Portal de Frontera, Capitán Kharos. Spawn de Vhar. |
| `vhar_forja` | Forja de Hierro | 72 | - | - | no | espejo del puerto: joyero, alquimista, mercado |
| `vhar_cuartel` | Cuartel de la Muralla | 48 | - | - | no | armero, armadurero, patio de armas |
| `vhar_huerto` | Huerto de Brasas | 64 | - | - | no | espejo del jardín |
| `llanos_alba` | Llanos del Alba | 128 | 1-2 | **hecho (Fase 3)**: goblin Nv1 (50-55 x 2 pits), goblin_elite Nv2 (45-60 x 2 pits) = 230 | no | zona de principiantes; las dos villas llegan aquí. Un puesto seguro con mercader. Portales 1 y 2. |
| `la_frontera` | La Frontera | 160 | 3-4 | **hecho (Fase 3)**: antlion Nv4 (50-60 x 2 pits), zombie Nv3 (50-60 x 2 pits) = 240 | facción | cruce de caminos compartido; Pantano muerto (este) y Hoyos de hormiga león (oeste). Portales 3 (hoyos) y 4 (pantano). Posta segura. |
| `camposanto` | Camposanto Viejo | 144 | 5 | **hecho (Fase 3)**: skeleton Nv5 (45-60 x 2 pits), skeleton_mage Nv5 (45-55 x 2 pits) = 225 | facción | Cementerio viejo + Ruinas del nigromante. Portales 5 y 6. |
| `paramo` | Páramo Reseco | 160 | 5 | **hecho (Fase 3)**: antlion Nv5 (45-60 x 4 pits) = 230 | facción | Oasis del Páramo seguro; escalera sellada a la Cripta (sigue en el mapa viejo); el corredor a las Tierras de ceniza queda para la Fase 4 |
| `hormiguero` | Hormiguero Ardiente | 128 | 6 | fire_ant Nv6 (10 x 3) = 30 | facción | portal 7; puerta a la Guarida del bárbaro |
| `riscos` | Riscos del Wyvern | 128 | 7 | wyvern Nv7 (6 x 4) = 24 | facción | puertas al Laberinto y a la Cueva del gólem |
| `nido_arana` | Nido de la Reina Araña | 64 | 7 | **arana** (boss) + 6 zombie (escolta) | no | desde La Frontera, Nv >= 6; suelta esquirla de la cripta |
| `guarida_barbaro` | Guarida del Bárbaro | 64 | 8 | **barbaro** (boss) + 6 goblin_elite reescalados a Nv6 | no | desde el Hormiguero, Nv >= 7; esquirla de la cripta |
| `laberinto` | Laberinto del Minotauro | 80 | 9 | **minotaur** (mini-boss) x3 | no | desde los Riscos, Nv >= 8; laberinto de 1 celda de ancho |
| `cueva_golem` | Cueva del Gólem de Hielo | 64 | 10 | **golem** (boss) + 6 skeleton_mage Nv9 | no | desde los Riscos, Nv >= 9; piso de hielo (SBS `ice1/ice2`); esquirla de la cripta |
| `cripta_1` | Cripta · Vestíbulo | 64 | 6 | skeleton Nv6 (8) | no | llave de la cripta |
| `cripta_2` | Cripta · Galería de osarios | 72 | 7 | zombie Nv7 (8), skeleton Nv6 (6) | no | |
| `cripta_3` | Cripta · Cámara del Bárbaro | 64 | 8 | **barbaro** (boss) + skeleton Nv6 (4) | no | suelta esquirla del foso; salida de un solo sentido |
| `ceniza_brasas` | Camino de Brasas | 144 | 6-7 | fire_ant Nv6 (10 x 2), skeleton Nv6 (10, Forja apagada), wyvern Nv7 (6 x 2, Nidal de ceniza) = 42 | facción | portal 8 (nidal); entra el corredor desde el páramo |
| `ceniza_osario` | Osario Ardiente | 144 | 8-9 | skeleton_mage Nv8 (10 x 2), minotaur (2 x 2, Cantera) = 24 | facción | portales 9 (osario) y 10 (cantera); esquirla del foso (misión) |
| `ceniza_foso` | Brasas Profundas | 128 | 10-11 | fire_ant Nv10 (10 x 2), wyvern Nv11 (6 x 2, Guardia del foso) = 32 | facción | escalera sellada al foso |
| `foso_1` | Foso · Cámara I | 64 | 11 | skeleton_mage Nv11 (8) | no | llave del foso |
| `foso_2` | Foso · Cámara II | 72 | 11 | skeleton_mage Nv11 (8), wyvern Nv11 (4) | no | |
| `foso_3` | Foso · Trono del Demonio | 64 | 12 | **demonio** (boss) + skeleton_mage Nv11 (4) | no | techo del mundo; salida de un solo sentido |
| `arena` | Coliseo de Arena | 64 | - | - | todos contra todos | duelos; sin pérdida de exp ni botín (decisión) |
| `campo_batalla` | Campo de Batalla de la Frontera | 128 | 5+ | - | guerra de facciones | solo por evento / NPC; puntaje por facción |

Total de mobs de caza: ~375 (hoy ~70). El mayor por mapa es 42, así que el O(M²) de `MobSim` no es problema.

Cambios respecto de `ZONAS.md`: (1) el Foso del demonio del núcleo (Nv12) **desaparece**: su jefe es el del Trono (un solo demonio, un solo techo); (2) los bosses del núcleo pasan de "bolsillos lejanos" a mapas propios con puerta por nivel; (3) las escoltas de los bolsillos usan tipos existentes reescalados con `Zone.lvl`. Los números de vida/daño/exp de la tabla de `ZONAS.md` no se tocan.

### 3.2 Conexiones

| De | A | Tipo | Requisito / nota |
|---|---|---|---|
| `solmar_villa` | `solmar_puerto`, `solmar_cuartel`, `solmar_jardin` | camino ambos sentidos | puertas de la villa |
| `vhar_ciudadela` | `vhar_forja`, `vhar_cuartel`, `vhar_huerto` | camino | |
| `solmar_villa` | `llanos_alba` | camino | "Camino de la Marea" (portón este) |
| `vhar_ciudadela` | `llanos_alba` | camino | "Camino del Yunque" (puerta sur) |
| `llanos_alba` | `la_frontera` | camino | "Paso de la Frontera" |
| `la_frontera` | `camposanto`, `hormiguero`, `riscos` | camino | |
| `la_frontera` | `nido_arana` | puerta | Nv >= 6 |
| `hormiguero` | `guarida_barbaro` | puerta | Nv >= 7 |
| `riscos` | `laberinto` / `cueva_golem` | puerta | Nv >= 8 / Nv >= 9 |
| `camposanto` | `paramo` | camino | portón sur (el actual) |
| `paramo` | `cripta_1` | puerta | llave de la cripta (se consume al cruzar, como hoy); la salida de `cripta_1` vuelve libre |
| `cripta_1` ↔ `cripta_2` ↔ `cripta_3` | | camino | cadena |
| `cripta_3` | `paramo` | **una vía** | atajo tras el jefe |
| `paramo` | `ceniza_brasas` | camino | corredor actual |
| `ceniza_brasas` ↔ `ceniza_osario` ↔ `ceniza_foso` | | camino | oeste a este |
| `ceniza_foso` | `foso_1` | puerta | llave del foso |
| `foso_1` ↔ `foso_2` ↔ `foso_3` | | camino | cadena |
| `foso_3` | `ceniza_foso` | **una vía** | salida tras el jefe |
| `solmar_cuartel`, `vhar_cuartel` | `arena` | portal | libre; vuelta por portal |
| `solmar_cuartel`, `vhar_cuartel` | `campo_batalla` | teletransporte de NPC | Capitán, durante el evento |
| `*_villa` | cualquier zona de entrenamiento abierta | portal (Portal de Frontera) | ver 3.3 |

### 3.3 Portales de Frontera y "Volver a la ciudad" (un solo portal por ciudad)
- **Un Portal de Frontera por ciudad** (`city:solmar` en la plaza de la Villa de Solmar, `city:vhar` en `HUB+(3,0)` de la ciudad de Vhar del mapa viejo; el de la ciudad vieja de Solmar se sacó porque Solmar vive en la villa). Abre el menú de zonas en el orden de la cadena de misiones (bloqueos por misión o nivel). El server solo acepta el viaje junto al portal **de tu facción** (≤ `WAYPOINT_RANGE`).
- **Las zonas no tienen portal** (antes había 10 "portales de regreso" chicos, amontonados cerca de la ciudad vieja porque las zonas están pegadas). Cada paso de `TRAINING` conserva su **celda de llegada** (`waypointArrivals`), que es el destino del menú, sin plataforma. La celda se elige a 1-5 celdas del borde de su zona y, si se puede, a 3+ celdas del borde de las demás (las zonas están pegadas: antes se podía llegar al Campamento goblin al lado del Pantano muerto). Cuando las zonas se muevan a sus mapas, cada paso apuntará a `(mapa, celda)`:

| Paso | Zona (TRAINING) | Mapa | Nivel de desbloqueo alt. (hoy) |
|---|---|---|---|
| 1 `goblins` | Campamento goblin | `llanos_alba` (hecho) | 1 |
| 2 `avanzada` | Avanzada goblin | `llanos_alba` (hecho) | 3 |
| 3 `hoyos` | Hoyos de hormiga león | `la_frontera` (hecho) | 5 |
| 4 `pantano` | Pantano muerto | `la_frontera` (hecho) | 7 |
| 5 `cementerio` | Cementerio viejo | `camposanto` (hecho) | 9 |
| 6 `nigromante` | Ruinas del nigromante | `camposanto` (hecho) | 11 |
| 7 `hormiguero` | Hormiguero ardiente | `hormiguero` | 13 |
| 8 `nidal` | Nidal de ceniza | `ceniza_brasas` | 15 |
| 9 `osario` | Osario ardiente | `ceniza_osario` | 17 |
| 10 `cantera` | Cantera del minotauro | `ceniza_osario` | 19 |

  La cadena de misiones del Capitán y los `after` no cambian; `waypointTarget` devuelve el mapa. Para saltar de una zona a otra hay que volver a la ciudad y usar el portal.
- **Volver a la ciudad (recall estilo MMO clásico)**: tecla **H** o el botón junto a la poción de maná (ícono de casita, tooltip "Volver a la ciudad (H)"). Canaliza **8 s** (anillo azul en el cursor y en el botón, barra sobre el personaje); se corta si te movés, recibís daño, atacás, usás una habilidad o lanzás un hechizo; al completarse te lleva a `factionHome()` (plaza de la villa / ciudad de Vhar, cruce de mapa si hace falta). Enfriamiento de **60 s** (empieza al completarse; cancelar no lo gasta). Lo valida todo el server (`world.ts`: `startRecall`/`cancelRecall`/`finishRecall`, temporizador del jugador que corre en el mundo donde esté): no se puede usar muerto, paralizado, en la arena (Coliseo `ffaRect` o mapa `ffa`), ni ya en la plaza; durante un cruce de mapa el jugador no está en ningún mundo y el pedido se ignora, y el cruce corta un canal en curso. Protocolo: `RecallRequest{cancel}` (cliente, tag 500) y `RecallState{state, channel_ms, remaining_ms, cooldown_ms, reason}` (server, 500). Constantes en `RECALL` (`maps.ts`).
- Observación (no la toco): los niveles de desbloqueo alternativos 1, 3, ..., 19 están **muy por encima** del nivel del mob (la cantera es Nv9 y pide nivel 19); en la práctica solo vale la misión. Conviene alinearlos (decisión 6).
- Se pueden sumar hasta 3 portales de viaje rápido opcionales (Posta de la Frontera, Oasis del Páramo, Boca del foso) sin tocar el diseño (decisión del usuario por ahora: un solo portal por ciudad).

### 3.4 Progresión
Núcleo 1-2 (Alba) → 3-4 (Frontera) → 5 (Camposanto, Páramo) → 6 (Hormiguero, Cripta 6-8, Brasas 6-7) → 7 (Riscos, Araña) → 8-9 (Osario, Bárbaro, Minotauro) → 10-11 (Gólem, Brasas profundas) → 11-12 (Foso). Esquirlas: araña + bárbaro + la esquirla de la misión 7 = llave de la cripta (3); el gólem Nv10 sobra y puede dar una extra. La llave del foso sale del jefe de la cripta (como hoy).

### 3.5 Extensión opcional (Nv 13+)
`mobDef(tipo, {lvl})` ya reescala cualquier tipo no-boss a cualquier nivel. Se pueden agregar mapas de Nv 13-16 reutilizando sprites; para un jefe final nuevo hay que definir un `MobDef` de boss (hoy no se reescalan) y su sprite. No es parte de las fases 1-7.

---

## 4. Plan por fases (cada fase deja el juego jugable)

Estrategia "estrangulador": el mapa actual sigue existiendo (con id propio, `solmar_legacy`) hasta que todo su contenido se haya movido. Los portales y waypoints apuntan a `(mapa, celda)`, así que durante la migración conviven zonas ya movidas y zonas que siguen en el mapa viejo.

### Fase 0 - Datos y validador (S)
- Toca: `packages/world` (`MapDef`, `Link`, `WORLD_GRAPH`, `check:graph`), sin cambio de comportamiento. Mover `HUBS`/`CITIES` detrás de funciones por mapa.
- Verificación: `pnpm typecheck`; `check:graph` pasa sobre el mapa único.
- Paralelo: sí, independiente. Riesgo: bajo.

### Fase 1 - Infraestructura multi-mapa con 3 mapas de prueba (L)
- Mapas: el actual (id nuevo `solmar_legacy`, para que `v: 1` no se confunda), `prueba_a` (48x48, segura) y `prueba_b` (64x64, mobs, PvP de facción, una puerta por nivel y una salida de una vía).
- Toca: `packages/proto` (3 mensajes), `apps/server` (`WorldRegistry`, `detach/attach`, `handlePortal`, hibernación, `index.ts` sesiones, `player.ts`, persistencia `v: 2` + migración al hogar de facción), `apps/client` (`loadMap`, pantalla de carga, `MAP_WORLD_ID`, `checkPortals` por id), `packages/world` (portales con `id` y mapa destino).
- Verificación: typecheck; nuevo `scripts/test-maps.ts` (ida y vuelta, `portalId` inválido, requisito no cumplido, movimiento viejo con `gameWorldId` previo ignorado, cierre de socket entre `MapTransfer` y `MapReady`, doble portal); capturas con Playwright de la pantalla de carga y de ambos mapas; test de migración con un `chars/*.json` v1.
- Orden interno: (1) contrato de proto (commit chico), luego (2) server y (3) cliente **en paralelo**, (4) persistencia/migración. Server y migración tocan `index.ts`: un solo agente. El cliente es un solo archivo (`main.ts`): un solo agente.
- Riesgos: timers atados al mundo viejo; carrera en el cruce; refactor del cliente (~40 referencias).

### Fase 2 - Ciudades (M-L)
- 8 mapas (4 por ciudad) con NPCs por mapa, zona segura, Portal de Frontera, hogar de facción, respawn. Sacar el rectángulo de Vhar y de Solmar del mapa viejo. Reescribir `cities.ts` en `cities/solmar.ts` y `cities/vhar.ts` (los helpers `cabinA/B`, `fenceH/V` se extraen primero). El cliente decide el mapa de aparición según el server.
- Verificación: typecheck, `test-economy.ts` adaptado, capturas de cada mapa, recorrer tiendas y Capitán.
- Paralelo: Solmar y Vhar en dos agentes (archivos nuevos) tras extraer los helpers (paso serie corto).

### Fase 3 - Núcleo de caza: Alba, Frontera, Camposanto, Páramo (L)
- Extraer del `frontier.ts` un kit de terreno (`terrain.ts`: ruido, conjuntos de tiles, bordes, claros, caminos) y un generador `buildFromSpec`. Un mapa por archivo. Zonas con `n`, `r`, `lvl` como en 3.1. `waypointArrivals` por mapa. `Zone.drops`.
- Verificación: `check:graph`, hash igual en cliente y server, tiempo de generación (< 200 ms por mapa en el server; medir en cliente), capturas de cada biomas, bot que cruza de la villa al Camposanto, test de misiones 1-6 contando kills.
- Paralelo: un agente por mapa tras tener el kit. Riesgo: densidad de mobs/estética (iterar con capturas).

### Fase 4 - Hormiguero, Riscos y Tierras de ceniza (M-L)
- 5 mapas (Hormiguero, Riscos, Brasas, Osario, Brasas profundas). Corredor del páramo, escalera sellada al foso.
- Paralelo: sí (un mapa por agente).

### Fase 5 - Bolsillos de jefe y mazmorras en cadena (M-L)
- 4 bolsillos + Cripta x3 + Foso x3; puertas por nivel; vínculos de una vía; `Zone.drops`; llave por cruce; `MapDef.respawn` en mazmorras; reemplazo de `dungeon(s)` por `ambient`.
- Verificación: test de llaves/esquirlas, jefe único, respawn, capturas de iluminación.
- Paralelo: bolsillos y cadenas son independientes.

### Fase 6 - PvP (M)
- Coliseo (todos contra todos, sin penalización), Campo de Batalla (evento, NPC, puntaje); `MapDef.pvp` aplicado en `isEnemyPair`; borrar los números mágicos de la arena. Zonas `off` (principiantes, mazmorras, ciudades).
- Depende de F1 y F2 (cuarteles). Paralelo con F3-F5 (archivos distintos).

### Fase 7 - Experiencia (M)
- Minimapa y mapa del mundo (puede reutilizar el diagrama), banner de zona, canales de chat (mapa/global/facción), música y ambiente por mapa, carga perezosa de sprites, índice espacial de props si hace falta.
- Paralelo: sí (cliente/proto).

### Fase 8 - Limpieza y balance (S-M)
- Borrar `buildSolmar/extend*` y `solmar_legacy`; revisar densidades y desbloqueos; extensión Nv 13+ (opcional); instancias de jefes/mazmorras y party (aparte).

### Estado de la implementación (Fases 0 y 1)

**Hecho y verificado** (rama `claude/blissful-allen-8fq0p4`):
- **Fase 0** (`packages/world/src/maps.ts`, `testmaps.ts`): `MapDef`, `Link` (`id` estable, `kind` walk/portal/oneway/door/npc, `gate` con `lvl`/`quest`/`key`), registro `MAPS` por id, `validateMapGraph()` (ids únicos, destinos caminables y no disparadores, reciprocidad salvo `oneway`, puertas con requisito, todo alcanzable a pie desde el spawn, zonas únicas entre mapas, `build()` determinista, mapas seguros sin mobs) y `mapHash()` (FNV-1a de tamaño, bloqueos y zonas). El mapa actual es `solmar_legacy` (`buildSolmar` y sus `extend*` sin cambios). `Zone.drops` opcional.
- **Fase 1, protocolo:** `PortalRequest` (cliente, tag 123), `MapReady` (cliente, 124), `MapTransfer` (server, 150). `WorldChangeRequest` queda en desuso. Regenerado con `grpc_tools` de Python porque el `protoc` de `grpc-tools` no se pudo bajar (el resultado es idéntico salvo lo nuevo).
- **Fase 1, server:** `registry.ts` (`WorldRegistry`: un `GameWorld` por `mapId`/`mapId#instanceId` a pedido, un solo reloj, hibernación de vacíos, baja de instancias, cruce en dos fases con tiempo límite de 20 s y cruce pendiente que se completa si cae el socket). `world.ts`: `detachPlayer`/`attachPlayer`, temporizadores que siguen al jugador (pociones en el tiempo, furia, protección al aparecer), `checkLink` (distancia, vida, nivel/misión/llave; la llave se descuenta al cruzar), respawn y PvP por `MapDef`, hub solo válido en el mapa original. `persist.ts`: guardado con `mapId` y `rest` de mapas temporales. Economía: `maxLootLvl()` recorre todos los mapas; la esquirla del boss puede salir de `Zone.drops`.
- **Fase 1, cliente:** `loadMap()` (el mapa es estado mutable), pantalla de carga violeta (`#maploading`), verificación de hash y `MapReady`, portales entre mapas dibujados con `portal.ts`, `cityAt`/PvP/arena por mapa, `MAP_WORLD_ID` dinámico.
- **Mapas de prueba:** `solmar_legacy` (96) ↔ `prueba_caza` (64, goblins Nv1, goblins de élite Nv2 y esqueletos Nv4, campamento seguro con respawn propio, PvP de facción) → puerta de nivel 2 → `prueba_mazmorra` (48, esqueletos Nv3 y hechiceros Nv4, vestíbulo seguro con respawn propio, sin PvP, `temporary` con `rest` en la puerta del claro) → atajo de una vía a `solmar_legacy`. **Actualización:** el portal del mapa viejo al claro (`solmar_a_caza`, celda 11,11) se sacó (un solo portal por ciudad); los mapas de prueba quedan con `debugOnly: true` (el validador no exige alcanzarlos desde el mapa inicial), la salida del claro (`caza_a_solmar`) pasó a ser de una vía y los tests llegan a ellos con `WorldRegistry.beginTransfer` o por la escalera de la mazmorra de prueba.
- Verificación: `pnpm --filter @fdn/server test` (27 tests: validador del grafo, registro, transferencia, hibernación, instancias, respawn, PvP, guardado) y una pasada con Playwright contra server y cliente reales (cruce de ida y vuelta, puerta bloqueada a nivel 1, puerta abierta a nivel 5, muerte con respawn en la entrada de la mazmorra, atajo de una vía y reconexión con el personaje guardado en otro mapa).

**Desvíos del plan original:** (1) no hay `v: 2` ni migración al hogar de facción (decisión del usuario: sin usuarios reales); (2) `data/worlds.json` ya no se lee (los mundos salen de `MAPS`; `settings.initialMap` ahora es `solmar_legacy`); (3) el scheduler es uno solo en el registro, no un `setInterval` por mundo; (4) los vínculos viven en `MapDef.links`, no dentro de `WorldMap.portals` (las escaleras del mapa viejo siguen siendo `Portal` del mismo mapa); (5) los waypoints y el Portal de Frontera siguen siendo del mapa original (Fase 2/3 los mueven); (6) `scripts/test-maps.ts` del plan quedó como tests de `node --test` (`apps/server/test`).

**Pendiente de la Fase 1:** posición en la cuenta/Postgres (decisión 9), canales de chat por mapa, minimapa. Quedan sin usar: instancias de party, `Link.kind` `walk`/`npc` (solo `portal`, `door` y `oneway` se probaron).

### Estado de la implementación (Fase 2, primera parte: Villa de Solmar)

**Hecho** (decisiones del usuario: villa exterior grande + edificios con interior al estilo de las capitales de un MMO clásico):
- **`solmar_villa`** (128x128, segura, sin PvP, `packages/world/src/solmar/villa.ts`): ciudad costera con muralla de piedra y siete torres, portón este (camino al mapa viejo), plaza mayor con el **Portal de Frontera** (waypoint `city:solmar`, el mismo menú de `training.ts`), calles empedradas, maceteros, banderas y faroles, mercado con tiendas de lona, patio de armas del cuartel, ~40 casas sin interior, jardines, paseo marítimo con balaustrada y bajadas, playa, agua de verdad (bloqueada, con espuma en la orilla), tres muelles con botes y bolardos y una escollera con el faro. Afuera de la muralla, bosque.
- **8 interiores** (`solmar/interiors.ts`, 16x16 a 20x20, seguros): Ayuntamiento (Capitán Aldric `capitan_s` y Subastadora Rosalba `subastador_s`), Templo de la Marea (Hermana Celina `sanador_s`, charla), Herrería (`armero_s`, `armadurero_s`), Tienda (`mercader_s`, `alquimista_s`), Joyería (`joyero_s`), Depósito (`depositario_s`: usa el depósito por cuenta que ya existe), Torre de Magia (`mago_s`, "Próximamente") y Cuartel (tres guardias). Paredes en corte: las del fondo (norte/oeste) altas con ventanas, las de adelante muretes bajos, así el jugador nunca queda tapado.
- **Puertas**: `Link.kind` nuevo `enter` (sin requisito ni plataforma de portal). La puerta está en la cara sur o este de la fachada (las que se ven); el vínculo de la villa va de la celda de la puerta al interior y la salida del interior vuelve a la celda de enfrente de la puerta (`villaDoor()`). Las tiendas, el Capitán y la subasta validan distancia contra los NPC **del mapa donde está el jugador** (`EconCtx.npcs` = NPC del mundo), así que funcionan adentro sin cambios.
- **Hogar y respawn de Solmar**: `factionHome('solmar')` = villa (al sur del portal); un personaje nuevo entra al mapa inicial y el pedido de "ir al hogar" de los primeros 30 s hace el cruce a la villa (`handleTeleport`). `factionRespawn('solmar')` = Templo (`respawnTarget` de los mapas con `'faction_home'`, incluido el mapa viejo). Vhar no cambia (hogar y respawn en su ciudad del mapa viejo).
- **Portal de Frontera entre mapas**: `waypointTarget()` devuelve `{map, x, y}`; desde la villa las zonas llevan al mapa viejo. Para volver está el recall (H, ver 3.3), que lleva al hogar de la facción (cruce de mapa si hace falta).
- **Camino villa ↔ mapa viejo**: `villa_a_legacy` en el portón este (125, 52) ↔ `legacy_a_villa` en la puerta sur de la ciudad vieja (8, 26), llegada en (8, 24). El mapa viejo se muestra como «Tierras de Solmar».
- **Arte**: kit de ciudad CC0 de Screaming Brain Studios (`tools/src/town/atlas.ts` → `town.webp` + fachadas `sm_*.webp`; ids en `packages/world/src/town.ts`). Las fachadas son edificios cerrados con terraza plana y pretil (estilo mediterráneo), puerta, cartel con el nombre y toldo dibujados por el script. No se usa `fantasy_house` (licencia dudosa) en la villa.
- **Cliente**: atlas `town`, edificios dibujados en tiras de media celda con la profundidad de su columna (un personaje delante de la fachada ya no queda tapado por el edificio entero) y translúcidos si tapan al jugador; puertas con nombre y marca en el piso (sin plataforma de portal); NPC nuevos (sanadora, maga) con charla; colores del kit en el minimapa; los NPC de un mapa nuevo arman su muñeco al cargarlo.
- **Verificación**: `apps/server/test/villa.test.ts` (grafo, puertas ida y vuelta de los 8 edificios, NPC por interior, cruce al Templo y vuelta, respawn en el Templo, hogar de un personaje nuevo, Portal de Frontera a una zona del mapa viejo y vuelta, camino al mapa viejo, compra en la Tienda validando la distancia del interior) y una pasada con Playwright contra server y cliente reales (capturas en el scratchpad de la sesión). Herramientas: `tools/src/town/render.ts` (render de control de un mapa sin levantar el juego) y `tools/src/town/check.ts` (tiempos de armado y validador).

**Desvíos y límites**: (1) la villa reemplaza a los cuatro mapas de Solmar de la tabla 3.1 (`solmar_villa` + puerto, cuartel y jardín) por **un** mapa exterior de 128 con todo adentro + interiores; (2) la ciudad vieja de Solmar del mapa original queda como está (con sus NPC) hasta que se muevan las zonas de caza (Fase 3); (3) las celdas de llegada de las zonas siguen en el mapa viejo (ya sin portal de regreso: se vuelve con H); (4) el sanador no cura (dentro de la ciudad ya se regenera rápido) y la Torre de Magia es un NPC "Próximamente".

**Falta**: Ciudadela de Vhar (misma receta con otro estilo de muros), sacar la ciudad vieja de Solmar del mapa original cuando se muevan las zonas, función del sanador y de la Torre.

### Estado de la implementación (Fase 3: núcleo de caza)

**Hecho** (`packages/world/src/hunt/`: `kit.ts` y un archivo por mapa; enganche en `maps.ts` con `huntMaps()` de `hunt/index.ts`):
- **Kit de terreno** (`HuntMap`): grilla determinista, ruido, `border()` natural (bosque o peñascos), `thicket()`, `pond()` con espuma, `path()` (caminos con curva y borde gastado), `camp()` (campamento seguro con cerco, fogata, tiendas y círculo de reaparición), `pit()` (zona densa con núcleo despejado), `palisade()`, `decorate()` y `finish()` (bloquea lo que no se alcanza a pie: ningún mob nace en un bolsillo cerrado).
- **`llanos_alba`** (128, Nv 1-2, sin PvP): praderas, granjas (campos, cercos, casas del kit de ciudad), laguna, bosquecillos y borde de bosque. Puesto del Alba (campamento, respawn) al oeste, junto al portón de la villa. Pits: Campamento goblin (55), Granjas tomadas (50), Avanzada goblin (60 élites) y Empalizada goblin (45), con empalizada, tiendas y cajas. Goblins sueltos por los caminos.
- **`la_frontera`** (160, Nv 3-4, PvP de facción): bosque cerrado y cruce de caminos; arenales de los Hoyos de hormiga león (oeste, 2 pits con hondonadas y piedras), Pantano muerto y Ciénaga honda (este, 2 pits con barro, charcas y árboles secos), camino al sur hacia el Camposanto. Posta de la Frontera (seguro) junto al Paso.
- **`camposanto`** (144, Nv 5, PvP de facción, con niebla): Cementerio viejo (muro bajo con portones y lápidas en hileras), Mausoleos (6 criptas), Ruinas del nigromante y Capilla en ruinas (muros rotos, columnas). Capilla del guardián (seguro) junto a la entrada norte; portón sur al Páramo. La niebla es solo visual (`WorldMap.fog`; el cliente dibuja bancos de niebla con parallax).
- **`paramo`** (160, Nv 5, PvP de facción): arcilla agrietada, arena y roca con peñascos y árboles secos; 4 pits de hormiga león Nv5. Oasis del Páramo (seguro, con charca) al norte. Escalera de caracol **sellada** al sur: `paramo_a_cripta` (puerta con llave `cripta`, se consume al cruzar) lleva a la sala de entrada de la Cripta **del mapa viejo**, celda (46, 18); en el mapa viejo, el portal `legacy_a_paramo` (celda (44, 50)) vuelve al Páramo Reseco. Es un placeholder: la Cripta se mueve a sus mapas en la Fase 5.
- **Vínculos**: el portón este de la villa va ahora a los Llanos (`villa_a_llanos` / `llanos_a_villa`, tipo `walk`); los Llanos conservan el camino al mapa viejo por el norte (`llanos_a_legacy` / `legacy_a_llanos`: Tierras de Solmar y desde ahí Vhar); `llanos_a_frontera`, `frontera_a_camposanto`, `camposanto_a_paramo` y sus vueltas. Todos con reciprocidad (lo verifica `validateMapGraph`, que ahora también sigue las escaleras del mismo mapa al calcular alcanzabilidad).
- **Menú del Portal de Frontera**: `HUNT_ARRIVALS` (`hunt/index.ts`) manda goblins y avanzada a los Llanos, hoyos y pantano a La Frontera, cementerio y nigromante al Camposanto; `waypointTarget()` lo consulta primero. Ids, orden y bloqueos de `TRAINING` no cambian; las celdas de llegada están a 0-8 celdas del borde de su pit y fuera de los campamentos. Hormiguero, Nidal, Osario y Cantera siguen llegando al mapa viejo (Fase 4). Las zonas del mapa viejo **no se borraron** (Fase 8); por eso el validador tolera nombres de zona repetidos entre `solmar_legacy` y un mapa de caza.
- **Mobs** (`Zone.respawn`, `Zone.aggro`, `zoneRespawnSecs()`): reaparición por zona (pits: 8 s goblins, 10 s antlion, zombi y élite, 12 s esqueletos y páramo; los mapas viejos siguen en 22 s), aggro de 3 celdas en los pits (4,5 por defecto; el contagio es 0,7 x el aggro) para que acercarse no arrastre medio pit. Exp por kill: la de `mobDef` según el nivel de la zona (sin tocar la curva). Mobs sueltos por los caminos: zonas de 5 mobs con reaparición de 15 s.
- **IA y rendimiento** (`apps/server/src/mobs.ts`): celdas de nacimiento precalculadas por zona, un spawn evita nacer encima de otro mob, los mobs quietos a más de 26 celdas de todo jugador **no se simulan** y el empuje entre perseguidores recorre solo la lista de los que persiguen. Sigue sin haber pathfinding: los pits se arman con un núcleo despejado (`pit(zone, clear)`) y sin obstáculos densos adentro.
- **Mediciones** (contenedor Linux de desarrollo):
  - Reloj del server (`WorldRegistry.tickStats`; con `FDN_TICK_STATS=1` se loguea cada 30 s): los 4 mapas despiertos, **925 mobs** y 48 jugadores parados en los pits (test de rendimiento de `caza.test.ts`): vuelta del reloj **prom 0,64 ms, p95 0,99 ms, máx 1,83 ms** (presupuesto 50 ms). En vivo con 1 jugador: prom 0,3-0,4 ms, p95 0,6 ms.
  - Armado de mapa (`tools/src/town/check.ts`; Node, primera vez / mejor de 4): Llanos 115 / 64 ms, Frontera 107 / 89 ms, Camposanto 74 / 71 ms, Páramo 109 / 101 ms (villa 33 / 19 ms). En el cliente (Chromium headless, `__fdn.perf()`): 29-45 ms de `loadMap` y 8-21 ms de minimapa (el primer mapa de la sesión tardó 1,1 s por JIT en frío y atlas). Bajo el tope de ~300 ms: no hizo falta precalcular.
  - FPS parado en un pit lleno (Chromium headless con render por software, 1600x900, 40-55 mobs a la vista): 28-42 fps. Es un piso (una GPU real rinde más); con mobs peleando encima hubo una caída puntual a 16 fps.
- **Tests** (`apps/server/test/caza.test.ts`, 10): grafo, pits (3-5 por mapa, 30-60 mobs, 150-300 en total, respawn 8-15 s), niveles de `mobDef`, pits despejados y lejos del campamento, ida y vuelta de los vínculos, escalera de la Cripta (llave), llegadas del menú, nacimiento de cada pit, respawn por zona y rendimiento.

**Límites y falta**: (1) sin pathfinding: los mobs que persiguen se deslizan por los lados pero pueden trabarse con los árboles densos del borde; (2) Vhar todavía no llega a los Llanos a pie (solo por el mapa viejo y el portal de su ciudad); (3) la Cripta y el corredor a las Tierras de ceniza siguen en el mapa viejo; (4) las llegadas del Hormiguero y siguientes siguen en el mapa viejo; (5) los mapas de caza no tienen NPC (la ciudad queda a una H de distancia).

### Qué se puede paralelizar
- Sí: F2 (Solmar/Vhar), mapas de F3-F5 una vez listo el kit, F6, F7. Cada uno en archivos nuevos.
- No: F1 (contrato proto → server/cliente), cualquier cambio a `main.ts` y a `world.ts`/`index.ts` (un agente por vez), la extracción del kit de terreno (antes de F3).

### Migración de jugadores (resumen)
`v < 2` → hogar de facción; cuentas y llaves intactas; `solmar` deja de existir como id de mapa; los 10 `u` siguen. Probar con una copia de `chars/` real. Si hay Postgres: agregar `pos` al registro de cuenta con valor por defecto.

---

## 5.0 Decisiones ya tomadas por el usuario

- **PvP:** no hay PvP en las ciudades. Tampoco en los bosses/bolsillos de jefe por ahora (se decide más adelante). PvP de facción solo en tierras compartidas y zonas de caza, y en el Coliseo/Campo de Batalla por evento.
- **Mazmorras y jefes:** por ahora mapas compartidos. Más adelante se quiere una **cola de grupo** (o un comando de chat para invitar) para entrar a una mazmorra o jefe en **instancia privada**: al entrar el líder, aparecen todos los miembros de la party en la misma instancia. La Fase 1 debe dejar el registro de mundos preparado para eso (clave `mapId` + `instanceId`, hibernar instancias vacías) aunque todavía no se use.
- **Muerte:** si morís dentro de una mazmorra reaparecés en la entrada de esa mazmorra. Cada `MapDef` define su punto de respawn (`respawn`); los mapas de caza y de ciudad definen el suyo. Por ahora no hay lógica especial de llaves (la llave se sigue consumiendo al cruzar).
- **Mapas compartidos:** sin instancias por ahora, pero el registro de mundos ya usa la clave `mapId` + `instanceId` y sabe hibernar mundos vacíos y dar de baja instancias vacías (implementado, sin uso todavía).
- **Misiones:** se siguen contando por tipo de mob, sin importar el mapa (no se acotan por mapa; deja sin efecto la recomendación 7).
- **Foso:** un solo demonio, el del Trono (mapa futuro). En las fases 0-1 no se tocaron las zonas del mapa viejo.
- **Posición del personaje:** todavía no hay usuarios reales: sin migración de datos. Se guarda `mapId` + celda donde ya se guardaba (`chars/<id>.json`, sin Postgres); cargar un guardado sin `mapId` válido cae en el mapa por defecto sin crashear (un `worldId: 'solmar'` viejo vale como `solmar_legacy`).
- **Resto de las decisiones (secciones siguientes):** sin respuesta todavía; se toma la recomendación del documento hasta que el usuario diga otra cosa.

## 5. Decisiones para el usuario (con recomendación)

1. **Generación**: ¿mapas por código determinista compartido (como hoy) o JSON generado en build? Recomiendo código determinista + `map_hash` en F1-F5 y evaluar JSON (editor tipo Tiled) más adelante.
2. **¿Instancias?** Mapas compartidos (sin instancias) por ahora; las mazmorras en cadena y los jefes quedan abiertos a todos. Recomiendo compartido; instancias de grupo cuando exista party.
3. **PvP por mapa**: ciudades/mazmorras/principiantes sin PvP; Frontera y zonas de caza con PvP de facción. ¿Está bien que los Llanos del Alba y las mazmorras no tengan PvP? Recomiendo sí.
4. **Muerte**: ¿volver a la villa o a un punto cercano (posta/oasis/entrada de mazmorra)? Recomiendo el mapa de entrada en mazmorras (sin gastar otra llave) y la posta en zonas de caza, no la villa.
5. **Llave por cruce**: hoy se consume al entrar; si morís dentro, pagás otra. Recomiendo que la llave se consuma una vez por "corrida" y que volver a entrar tras morir dentro de los 10 minutos no la cobre.
6. **Desbloqueo por nivel** de los portales de entrenamiento (1, 3, ... 19): están muy por encima del nivel del mob. Recomiendo alinearlos a `nivel del mob - 1` (3, 4, 5, 7...) o quitarlos.
7. **Misiones por tipo de mob**: hoy cuenta cualquier wyvern, esté donde esté. Recomiendo acotar cada misión al mapa/zona (`Quest.map`).
8. **Chat**: canal por defecto "mapa" + comando global. Recomiendo sí.
9. **Posición en la cuenta** (Postgres) y no en `chars/` (disco efímero). Recomiendo sí, junto con F1.
10. **Tamaños**: ¿aceptás ~160 como máximo (43 s de lado a lado)? Si querés mapas más grandes hay que indexar `props` por chunks y medir la generación en el cliente. Recomiendo empezar en 128-160 y subir con datos.
11. **Foso duplicado**: un solo demonio (en el Trono) y retirar el "Foso del demonio" del núcleo. Recomiendo sí.
12. **Campo de Batalla**: ¿lo hacemos ahora (F6) o lo dejamos como mapa reservado hasta que haya sistema de eventos? Recomiendo reservar el id y construir solo el Coliseo en F6.
13. **Nv 13+**: ¿seguimos en 12 por ahora? Recomiendo sí; con 29 mapas ya hay contenido para varias iteraciones.
