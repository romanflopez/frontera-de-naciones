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

## Acciones (Etapa 2)
- **Comprar/vender**: valida jugador vivo, distancia al NPC (≤ 4,6 celdas, tabla `SHOPS` por rol del NPC), línea de stock existente, oro suficiente, bolsa < 18 y tope de 99 pociones. Vender: el item tiene que estar en la bolsa (se saca *antes* de cobrar). Precio de compra y de venta salen de `packages/world` (`SHOPS`, `sellPrice`).
- **Equipar/desequipar/tirar/ordenar**: por uid; equipar intercambia con lo puesto; desequipar necesita lugar. Recalculan los stats de combate (vida/maná máximos, DF, RM, daño de arma...).
- **Pociones**: `PotionRequest` descuenta del inventario del server (después de validar GCD y que haga falta).
- **Botín al matar** (`MobSim.kill` → `Economy.reward`, una sola vez por mob): exp (con el atributo `exp` del equipo del server), item (62 % o boss: rareza mínima) u oro, 14 % poción, esquirla de boss, avance de misión y subida de nivel. Va directo a la bolsa/bolsillo de quien dio el golpe final.
- **Misiones**: aceptar/entregar/forjar llave las decide el server (recompensas de `QUESTS`, progreso contado en el server); el portal con llave gasta la llave en el server.
- **Muerte**: pierde el 5 % de la exp del nivel (nunca baja de nivel).
- Límite de ritmo: ~12 acciones por segundo por jugador.

## Stats derivados (Etapa 3)
`statsFromChar` (pvpCombat.ts) se calcula desde `Econ` (equipo y nivel del server) y se vuelve a calcular en cada cambio de equipo o nivel. El presupuesto de golpes a mobs usa el nivel del server, no el que reporta el cliente.

## Qué queda del lado cliente
Solo vistas: `applyInventory()` reemplaza P.gold/bag/eq/pots/Q con la foto del server; las ventanas Personaje/Inventario, tiendas y diálogo del Capitán mandan pedidos y se redibujan al llegar el estado. El cliente sigue calculando su daño (el server lo topea) y la vida/maná son del server (`Vitals`). El botín ya no cae al suelo: va a la bolsa (si está llena se pierde y se avisa).

## Pruebas
- `apps/server/scripts/test-economy.ts` (antitrampa: migración, save inflado, comprar sin oro/lejos, vender lo ajeno, equipar ajeno, ventas concurrentes, desconexión, kill único, stats desde el equipo). Uso en el encabezado del script (necesita `FDN_DEBUG_WARP=1` y el mismo `DATA_DIR`).
- `test-combat.ts` necesita `FDN_DEBUG_TRUST_SAVE=1` (el save del cliente define todo el estado; **solo pruebas**).
- Variables de depuración: `FDN_DEBUG_WARP=1` (teletransporte libre), `FDN_DEBUG_GOLD=<n>` (oro inicial de personajes nuevos), `FDN_DEBUG_TRUST_SAVE=1`. Nunca en producción.

## Pendientes
- Casa de subastas (tablas Postgres con identidad por item, escrow de oro/items, comisión).
- Crafteo (recetas en `packages/world`, validación y consumo atómico en el server).
- Banco/almacén por cuenta.
- Botín en el suelo con dueño y tiempo (hoy, bolsa llena = item perdido), reparto de exp/botín en grupo.
- Pasar `u` (portales), llaves y quests a un módulo propio; log/auditoría de transacciones (`transactions`) y alertas de anomalías.
- Probar la persistencia contra un Postgres real (el camino es el mismo upsert `jsonb` de la cuenta; no se corrió acá).
- `sanitizeCharacter` (accounts.ts) quedó sin uso en el flujo en vivo; se puede borrar.
