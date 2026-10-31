# Economía autoritativa del server

Desde esta versión el **server es dueño** del oro, la bolsa, el equipo, el nivel/exp, las pociones y las misiones de cada personaje. El cliente pide acciones; el server las valida contra su propio estado y contra tablas compartidas, y le devuelve una foto (`InventoryState`). El `saveCharacterRequest` del cliente **ya no puede subir oro, items ni nivel**.

## Modelo (Etapa 1)
- Código: `apps/server/src/economy.ts` (estado y acciones) y `packages/world/src/economy.ts` (tablas compartidas: bases de items, rangos de atributos, tiendas/stock/precios, pociones, misiones, llaves).
- Estado por personaje (`Econ`, `v: 2`), guardado en la propia cuenta (`AccountRecord.econ`, JSON) por el mismo `Storage` (archivos o Postgres con `DATABASE_URL`; no hay tablas nuevas ni migración de esquema: la cuenta ya es un `jsonb`).
  - `gold`, `lvl`, `exp`, `hp/mp` al salir, `bag[]` (máx. 18), `eq{arma,armadura,cabeza,anillo}`, `pots{hp,mp}`, `q{i,st,prog,keys,shards}`, `u[]` (portales abiertos), `nextUid`.
  - Cada item es una instancia: `{u (uid único por personaje), n (base), r (rareza 0..3), a[{id,v}]}`.
  - Se eligió JSON en la cuenta (y no `characters`/`inventory_items`/`currencies`) porque hay un solo proceso escritor, cada acción es síncrona y atómica en el event loop y el guardado es de la cuenta entera. Cuando haya casa de subastas (consultas entre cuentas) conviene pasar a tablas; el modelo ya tiene identidad por item.
- Guardado: cada acción marca la cuenta como sucia (debounce de 1,5 s) y se fuerza `flush()` al desconectarse y al cerrar el server.

## Migración de cuentas existentes
- Al primer login de una cuenta con `character` (guardado viejo del cliente) y sin `econ`, `importLegacy()` arma el estado **una sola vez**, con topes: oro ≤ 25 000, nivel ≤ 40, exp < la del nivel, pociones ≤ 99, llaves/esquirlas ≤ 9; items solo de bases válidas (`ALL_BASES`), máx. 18 en bolsa, rareza 0..3, **a lo sumo `rareza` atributos** y cada valor ≤ el máximo que puede dar el generador (`attrCap`, a nivel de mob máximo); las bases de tienda solo valen comunes y con su atributo fijo; la misión "lista" sin progreso suficiente vuelve a "activa". Los recortes se registran en el log (`[Economía] ... recortado: ...`) y en `econ.imported`.
- De ahí en más el guardado del cliente solo sirve para **crear** una cuenta nueva (clase y bando): el personaje arranca con el kit de su clase, 0 de oro, nivel 1 y 3+3 pociones, sin importar lo que diga el cliente.
- `acc.character` (guardado viejo) queda intacto en la cuenta como respaldo; el cliente recibe `characterLoaded` generado desde `econ`.

## Mensajes (proto, números nuevos)
Cliente → server (`ClientMessage`): `EconBuyRequest`=90, `EconSellRequest`=91, `EconEquipRequest`=92, `EconUnequipRequest`=93, `EconDropRequest`=94, `EconSortRequest`=95, `EconQuestRequest`=96 (`accept | turnin | forge`).
Server → cliente (`ServerMessage`): `InventoryState`=140 (foto completa; al entrar, después de cada acción, kill, muerte, poción y portal con llave), `EconResult`=141 (ok/código/texto), `KillReward`=142 (qué ganó el golpe final, para mostrar). `LootRoll`=130 quedó sin uso.
Botín en el suelo: `PickupRequest`=97 (cliente → server), `GroundItemSpawned`=143 y `GroundItemRemoved`=144 (server → cliente).
Depósito por cuenta: `DepositRequest`=400 (cliente → server) y `DepositState`=400 (server → cliente), ver `docs/DEPOSITO.md`.
Oro: `InventoryState.gold_d`=18 y `KillReward.gold_d`=13 (double, exacto hasta 2^53-1); `gold` (int32) queda por compatibilidad, topado a 2.147.483.647.

## Acciones (Etapa 2)
- **Comprar/vender**: valida jugador vivo, distancia al NPC (≤ 4,6 celdas, tabla `SHOPS` por rol del NPC), línea de stock existente, oro suficiente, bolsa < 18 y tope de 99 pociones. Vender: el item tiene que estar en la bolsa (se saca *antes* de cobrar). Precio de compra y de venta salen de `packages/world` (`SHOPS`, `sellPrice`).
- **Equipar/desequipar/tirar/ordenar**: por uid (tirar deja el item en el suelo, no lo destruye); equipar intercambia con lo puesto; desequipar necesita lugar. Recalculan los stats de combate (vida/maná máximos, DF, RM, daño de arma...).
- **Pociones**: `PotionRequest` descuenta del inventario del server (después de validar GCD y que haga falta).
- **Botín al matar** (`MobSim.kill` → `Economy.reward`, una sola vez por mob): exp (con el atributo `exp` del equipo del server), item (62 % o boss: rareza mínima) u oro, 14 % poción, esquirla de boss, avance de misión y subida de nivel. Va directo a la bolsa/bolsillo de quien dio el golpe final; si la bolsa está llena el item **cae al suelo** (ver "Botín en el suelo").
- **Misiones**: aceptar/entregar/forjar llave las decide el server (recompensas de `QUESTS`, progreso contado en el server); el portal con llave gasta la llave en el server.
- **Muerte**: pierde el 5 % de la exp del nivel (nunca baja de nivel).
- Límite de ritmo: ~12 acciones por segundo por jugador.

## Stats derivados (Etapa 3)
`statsFromChar` (pvpCombat.ts) se calcula desde `Econ` (equipo y nivel del server) y se vuelve a calcular en cada cambio de equipo o nivel. El presupuesto de golpes a mobs usa el nivel del server, no el que reporta el cliente.

## Qué queda del lado cliente
Solo vistas: `applyInventory()` reemplaza P.gold/bag/eq/pots/Q con la foto del server; las ventanas Personaje/Inventario, tiendas y diálogo del Capitán mandan pedidos y se redibujan al llegar el estado. El cliente sigue calculando su daño (el server lo topea) y la vida/maná son del server (`Vitals`). El botín va a la bolsa; si está llena cae al suelo y el cliente lo dibuja con lo que manda `GroundItemSpawned` (clic o Espacio para recoger).

## Botín en el suelo (server-autoritativo)
Código: `apps/server/src/ground.ts` (un `GroundLoot` por mundo, dentro de `GameWorld`), `Economy.pickup/drop/reward` y `GameWorld.syncGround`.
- Entidad `GroundItem{id, item (instancia completa), x, y, ownerIds[], freeAt, expiresAt}`. `ownerIds` son **claves de cuenta** (no ids de sesión: sobreviven a una reconexión), y es una lista para poder usarla con grupos.
- Quién lo genera: (1) un mob muere y la bolsa del que dio el golpe final está llena: cae junto al jugador, `ownerIds=[ese jugador]`, `freeAt=+60 s`; (2) el jugador **tira** un item de la bolsa (antes se destruía): `ownerIds=[él]`, `freeAt=+30 s` para poder arrepentirse. Vence a los 5 min (`expiresAt`; recién ahí se destruye). Máx. 40 items propios sin recoger por jugador (anti-abuso de memoria al tirar).
- Visibilidad: cada ~0,4 s y en cada alta/baja, `syncGround` manda a cada jugador solo las diferencias de lo que tiene en su radio de visión (`GroundItemSpawned` al aparecer o entrar en rango, `GroundItemRemoved` al recogerse, vencer o salir de rango). Al (re)conectar se manda de nuevo. El mensaje trae `locked` y `free_in_ms` calculados para quien lo recibe; el cliente cuenta el tiempo localmente.
- `PickupRequest{id}` (todo validado en el server, síncrono y atómico): jugador vivo, el item existe, distancia <= 2 celdas, permitido (`ownerIds` incluye su cuenta o `now >= freeAt`) y lugar en la bolsa (si no: "Bolsa llena." y el item sigue ahí). El item se saca del suelo **antes** de entrar en la bolsa (con uid nuevo: los uid son por personaje), así que dos pickups simultáneos de un mismo item resuelven en orden y el segundo recibe "ya no está". Sin duplicación ante desconexión: la acción ya corrió entera o no corrió; el item solo está en un lugar (bolsa guardada o suelo).
- **No persiste entre reinicios**: el suelo está en memoria. Lo tirado/caído se pierde si el server se reinicia antes de recogerlo (a futuro: persistirlo junto con el mundo o devolverlo por correo). Con `FDN_DEBUG_LOOT_SCALE=0.1` las esperas de 60/30 s se acortan (solo pruebas).
- Cliente: bolsita con el color de la rareza (brillo desde Mágico, haz de luz desde Raro), nombre con color de rareza al pasar el mouse (o mientras camina hacia él), "libre en N s" si es de otro. **Clic** sobre el item: camina hasta él y manda `PickupRequest`; **Espacio**: recoge el más cercano (o camina hasta el más cercano que se pueda recoger). El botón de la bolsa dice "Tirar".

## Grupos (party): diseño propuesto, NO implementado
Hoy no existe el sistema de grupos (invitaciones, lista de miembros, UI). El botín ya está preparado: `ownerIds` es una lista y `freeAt` es por item. Diseño propuesto para cuando exista `Party{id, leader, members[], mode}`:
- **Participación**: miembros vivos, en el mismo mundo y a <= ~25 celdas del mob al morir (o que le hayan hecho daño en los últimos ~30 s). Solo ellos "participaron".
- **Libre con protección (por defecto)**: el item que dropea queda en el suelo con `ownerIds = todos los miembros que participaron` y `freeAt = +60 s` (cualquiera de ellos lo recoge; pasado el tiempo, cualquiera). No va directo a la bolsa de nadie: así no hay que decidir quién lo gana y no se pierde nada si alguien tiene la bolsa llena. Los dos primeros segundos solo lo pueden recoger quienes participaron cerca (evita robos por latencia).
- **Ronda**: el item se asigna directo a la bolsa del siguiente miembro de la rotación que participó (se salta a quien tenga la bolsa llena; si todos están llenos, cae al suelo con `ownerIds=[el de turno]`). La rotación avanza solo cuando se asigna un item, no con el oro.
- **Oro**: se divide en partes iguales entre los miembros participantes (resto al que dio el golpe final); ya es entero y sin tope, así que no hay límites que repartir.
- **Exp**: cada participante recibe `exp_base * (1 + 0,1 * (n-1))` dividido entre n (bonus del 10 % por miembro extra, máx. 5 miembros), con su propio atributo `exp` del equipo; el avance de misión cuenta para todos los participantes que tengan la misión activa de ese tipo.
- **Cambios mínimos en el código**: `Economy.reward` pasa de "un jugador" a "lista de participantes" (resuelta por el mundo con la party), y reemplaza el `[p.accountKey]` de las llamadas a `ctx.ground.add` por la lista. `canPickup` y `PickupRequest` no cambian. Faltan mensajes de party (invitar/aceptar/salir/expulsar, estado del grupo) y su UI.

## Oro sin límite
- Se quitaron `MAX_GOLD = 10.000.000` y `IMPORT_CAPS.gold = 25.000`. El techo es el técnico: `Number.MAX_SAFE_INTEGER` (9.007.199.254.740.991), que es el mayor entero exacto de JS y del `double` del protocolo. `addGold` solo topa ahí (y en 0 hacia abajo).
- Importación de cuentas viejas: el oro se toma tal cual lo guardó el cliente, solo saneado (número finito, entero, >= 0; texto/negativo/NaN/Infinity -> 0; por encima del techo técnico -> techo). Los demás topes (nivel 40, pociones 99, llaves/esquirlas 9) siguen.
- Protocolo: el oro iba como `int32` (tope 2^31-1). Se agregaron campos nuevos `double gold_d` en `InventoryState` (18) y `KillReward` (13); el viejo `gold` queda topado a 2.147.483.647 por compatibilidad y el cliente usa `gold_d`. `sanitizeCharacter` (cuentas viejas) también dejó de recortar el oro a 1e9.
- Precios y tiendas: todos los precios/recompensas son enteros chicos; la resta de compras y la suma de ventas/misiones no pueden desbordar un entero seguro (se topa en el techo técnico).
- Cliente: el oro se formatea con puntos de miles (`es-AR`) en la bolsa, tienda, Capitán y mensajes; el contador de la bolsa baja de línea en vez de cortarse.
- Otros: se arregló que al entrar al mundo el save local pisaba la bolsa con ids locales (el primer "tirar/vender" fallaba con "No tenés ese item"); ahora se reaplica la última foto del server al entrar.

## Pruebas
- `apps/server/scripts/test-economy.ts` (también cubre el suelo y el oro sin tope: arrancar el server con `FDN_DEBUG_LOOT_SCALE=0.1` y el script con `LOOT_SCALE=0.1`, y una carpeta de datos nueva en cada corrida porque el suelo vive en la memoria del server; antitrampa: migración, save inflado, comprar sin oro/lejos, vender lo ajeno, equipar ajeno, ventas concurrentes, desconexión, kill único, stats desde el equipo). Uso en el encabezado del script (necesita `FDN_DEBUG_WARP=1` y el mismo `DATA_DIR`).
- `test-combat.ts` necesita `FDN_DEBUG_TRUST_SAVE=1` (el save del cliente define todo el estado; **solo pruebas**).
- Variables de depuración: `FDN_DEBUG_WARP=1` (teletransporte libre), `FDN_DEBUG_GOLD=<n>` (oro inicial de personajes nuevos), `FDN_DEBUG_TRUST_SAVE=1`. Nunca en producción.

## Pendientes
- ~~Casa de subastas~~: hecha (compra directa, custodia de items, buzón, tasa y comisión), ver `docs/SUBASTAS.md`. Faltan pujas.
- Crafteo (recetas en `packages/world`, validación y consumo atómico en el server).
- ~~Banco/almacén por cuenta~~: hecho (Depositario: 48 casillas de equipo, oro sin tope y stacks de pociones/llaves/esquirlas, en el mismo registro de la cuenta), ver `docs/DEPOSITO.md`.
- Sistema de grupos y el reparto de exp/botín/oro descripto arriba; persistir el suelo entre reinicios.
- Pasar `u` (portales), llaves y quests a un módulo propio; log/auditoría de transacciones (`transactions`) y alertas de anomalías.
- Probar la persistencia contra un Postgres real (el camino es el mismo upsert `jsonb` de la cuenta; no se corrió acá).
- `sanitizeCharacter` (accounts.ts) quedó sin uso en el flujo en vivo; se puede borrar.
