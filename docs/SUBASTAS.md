# Casa de subastas

Casa de subastas **server-autoritativa** y **compartida entre facciones**: lo que publica alguien de Solmar lo puede comprar alguien de Vhar y al revés. Esta versión tiene solo **precio de compra directa** (sin pujas).

## Dónde
Un NPC **Subastador** en cada ciudad, con el mismo patrón de rol que los demás (`roleOf(npc) === 'subastador'`):
- Solmar: `subastador_s` (Subastadora Rosalba), en la plaza, celda (12, 10), al lado del brasero del este.
- Vhar: `subastador_v` (Subastador Morvek), en la plaza de hierro, celda (84, 11).

Hablar con él (clic, o caminar hasta él) abre la ventana de la casa de subastas. Se cierra al alejarse, con Escape o con la ×.

## Reglas (decisiones tomadas)
| Regla | Valor |
| --- | --- |
| Qué se publica | Un item de equipo de la bolsa (arma, armadura, cabeza, anillo). No pociones, llaves ni esquirlas (no están en la bolsa de equipo). |
| Precio | Entero, de 1 a 1.000.000 de oro. |
| Duración | 48 h. |
| Tasa de publicación | `max(1, floor(2 % del precio))`, se cobra al publicar y **no se devuelve** (ni al retirar ni al vencer). |
| Comisión de venta | `floor(5 % del precio)`, se descuenta al vendedor. El vendedor recibe `precio - comisión`. |
| Publicaciones activas | Máximo 10 por cuenta. |
| Buzón | Con 40 o más reclamos sin retirar no se puede publicar (las ventas y vencimientos siempre entran). |
| Comprar lo propio | No se puede. |

Las constantes y las fórmulas están en `packages/world/src/auction.ts` (las usa el server para validar y el cliente para mostrar cuánto vas a pagar/recibir).

## Flujo
- **Publicar**: el item **sale de la bolsa** del vendedor y queda en custodia del server (una copia con atributos; el uid se renueva al entregarlo porque los uid son por personaje). Se cobra la tasa.
- **Comprar**: el server valida la publicación (existe y no venció), que no sea tuya, el oro y el lugar en la bolsa; si falta algo se rechaza **antes de cobrar**. Si todo está bien, en un solo paso: sale la publicación, se descuenta el oro, el item entra en la bolsa del comprador y el oro neto va al **buzón del vendedor** (aunque esté desconectado). Si el vendedor está conectado le llega un aviso ("Se vendió tu ...").
- **Retirar (cancelar)**: solo el dueño; el item va al buzón (no a la bolsa, por si está llena).
- **Vencer**: un barrido cada 60 s (y al abrir la ventana o al intentar comprar algo vencido) pasa las publicaciones de más de 48 h al buzón del vendedor. Una publicación vencida no aparece en la búsqueda aunque el barrido todavía no haya pasado.
- **Buzón**: oro de ventas e items retirados/vencidos. Se retira hablando con el Subastador, de a uno o "Retirar todo". El oro siempre entra; los items necesitan lugar en la bolsa (lo que no entra queda en el buzón).

## Validación y concurrencia
Todo lo decide el server (`apps/server/src/auction.ts`); el cliente solo pide:
- Sesión con personaje, vivo, ritmo (~5 pedidos/s por cuenta), **distancia al Subastador** (`SHOP_SERVER_RANGE`, como las tiendas) y que el NPC pedido sea un Subastador.
- Propiedad del item (por uid en la bolsa del server), oro suficiente, lugar en la bolsa, límites de precio y cantidad, dueño de la publicación al retirar.
- **Atomicidad**: cada acción corre síncrona dentro del event loop (igual que el resto de la economía). Dos compras "a la vez" de la misma publicación se resuelven en orden: la primera la saca de la lista y la segunda recibe "Esa publicación ya no está" **sin pagar nada**. No hay estado intermedio en el que el item esté en dos lugares.
- Cada transacción queda en el log del server: `[Subastas] publicación #N ...`, `venta #N: X compra ... por P; comisión C, neto al buzón N`, `cancelada #N`, `vencida #N`, `buzón: X retira ...`.

## Persistencia
- Las publicaciones y los buzones van en un registro propio del **mismo Storage que las cuentas**, con la clave reservada `_subastas` (las claves de cuenta son hexadecimales, no puede chocar): `DATA_DIR/accounts/_subastas.json` con archivos, o una fila más de la tabla `accounts` (`jsonb`) con Postgres (`DATABASE_URL`). No hay tablas nuevas ni migración.
- Después de **cada** transacción se guarda la cuenta tocada (bolsa/oro) y la casa y se fuerza `flush()`, sin esperar el debounce de 1,5 s. Con archivos las dos escrituras son síncronas y seguidas (tmp + rename cada una); con Postgres van en orden por la misma cola de upserts, pero **no en una transacción SQL**: si el proceso muere justo entre las dos escrituras se podría perder o duplicar ese item. Para cerrarlo del todo haría falta un `Storage.putMany` transaccional (pendiente, ver abajo).
- Probado: matar el server con `kill -9` después de publicar y volver a levantarlo deja la publicación y la bolsa como estaban.
- El vendedor desconectado no necesita estar cargado: el oro de la venta va al buzón de la casa, no a su cuenta.

## Protocolo (tags propios desde 300)
- Cliente → server: `AuctionRequest` = 300 en `ClientMessage`: `{ npc_id, action, query, uid, price, listing_id, mail_id }`, con `action` = `open | search | post | cancel | buy | claim` (`claim` con `mail_id = 0` retira todo).
- `AuctionQuery { slot, rarity (0 = todas, 1..4 = Común..Épico), text, lvl_min, lvl_max, max_price, sort (price_asc | price_desc | time_asc | time_desc), page }`. 0 o vacío = sin filtro; filtros inválidos se ignoran.
- Server → cliente: `AuctionSearchResult` = 300 (página de 20, `page`, `pages`, `total`) y `AuctionMyState` = 301 (mis publicaciones y mi buzón). El resultado de cada acción (ok/error con texto en español) va en el `EconResult` de siempre; si cambió el oro o la bolsa también llega `InventoryState`.
- `AuctionListing { id, item (InvItem), price, seller (nombre), expires_in_ms, mine, lvl }`; `AuctionMail { id, item?, gold, text, age_ms }`.

## Búsqueda
Paginada en el server (20 por página). Filtros: tipo (arma/armadura/cabeza/anillo), rareza, texto del nombre (sin mayúsculas ni tildes), rango de nivel y precio máximo. Orden por precio (menor/mayor) o por tiempo restante (termina antes/después).

**Nivel de un item**: los items no tienen requisito de nivel propio, así que el filtro usa el nivel con el que su base se vende en las tiendas (el mismo "Nv" que muestra el vendedor; `itemLevel()` en `packages/world`). Una Espada corta es Nv 1 y un Mandoble Nv 10, tengan la rareza que tengan.

## Cliente
`apps/client/src/auction.ts` arma la ventana (con el estilo de las tiendas: `.srow`, pestañas `.tabs`, íconos de `itemIcon` y el mismo tooltip que la bolsa: nombre con color de rareza, rareza, slot, nivel, daño/defensa/RM y atributos). Pestañas: **Buscar**, **Publicar** (con tasa, comisión y lo que recibís calculados al escribir el precio), **Mis publicaciones** (con tiempo restante y "Retirar") y **Buzón** (con contador en la pestaña). En `main.ts` solo hay enganches chicos: abrirla desde `openShop` cuando el rol es `subastador`, cerrarla con `closeShop`, pasarle los mensajes `auctionSearchResult`/`auctionMyState` y redibujarla en `applyInventory`.

## Pruebas
- Unitarias: `cd apps/server && npx tsx --test test/auction.test.ts` (publicar, validaciones y límites, cancelar, vencer, comprar, comprar sin lugar, sin oro, lo propio, doble compra concurrente, tasas y comisión, buzón parcial con bolsa llena, búsqueda/filtros/orden/páginas, persistencia en archivos y el manejo de red con distancia al NPC).
- De punta a punta: se probó con Playwright contra el server real (dos cuentas de facciones distintas, publicar, comprar, doble compra, aviso al vendedor, buzón, retirar, distancia, y reinicio con `kill -9`). El script no está en el repo.

## Pendientes / ideas
- Pujas (precio inicial + compra directa opcional).
- `Storage.putMany` transaccional (Postgres `BEGIN ... COMMIT`) para escribir la cuenta y la casa en una sola transacción.
- Si el volumen crece: pasar la casa a tablas (`auction_listings`, `auction_mail`) con índices por slot/rareza/precio; hoy la búsqueda filtra en memoria (alcanza para miles de publicaciones).
- Historial de precios por base para sugerir un precio al publicar.
