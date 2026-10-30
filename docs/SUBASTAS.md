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

## Historial de transacciones
Cada cuenta tiene un registro de sus transacciones en la casa, que se ve en la pestaña **Historial**:

| Tipo (`kind`) | Cuándo | Monto |
| --- | --- | --- |
| `post` (Publicación) | Al publicar | `-tasa` (guarda precio y tasa) |
| `buy` (Compra) | Al comprar (en el historial del comprador) | `-precio` (guarda el vendedor) |
| `sell` (Venta) | Al venderse (en el historial del vendedor, aunque esté desconectado) | `+neto` (guarda precio, comisión y comprador) |
| `cancel` (Retirada) | Al retirar una publicación | 0 (el item va al buzón) |
| `expire` (Vencida) | Cuando el barrido vence una publicación | 0 (el item va al buzón) |
| `claim` (Retiro del buzón) | Una entrada por cada reclamo retirado (oro o item) | `+oro` o 0 si es un item |

- Lo escribe **solo el server**, en el mismo paso que la transacción (dentro de `post`/`buy`/`cancel`/`claim`/`sweep`) y se guarda en el mismo `save` + `flush`. Las acciones rechazadas no dejan entradas. El cliente no puede escribir nada: solo pide verlo (`action = history`).
- Tope: las últimas **200** entradas por cuenta (`AH_HISTORY_MAX` en `packages/world`); al pasarse se descartan las más viejas.
- Cada entrada guarda una copia del item (nombre, rareza y atributos) para mostrar ícono y tooltip aunque el item ya no exista.
- Filtros en el cliente (son datos propios, ya validados): por tipo y por rango de fechas (hoy / 7 días / 30 días / todo), con el balance del período. La fecha se calcula con `age_ms` y el reloj del cliente, así que no importa el desfase entre relojes.

## Validación y concurrencia
Todo lo decide el server (`apps/server/src/auction.ts`); el cliente solo pide:
- Sesión con personaje, vivo, ritmo (~5 pedidos/s por cuenta), **distancia al Subastador** (`SHOP_SERVER_RANGE`, como las tiendas) y que el NPC pedido sea un Subastador.
- Propiedad del item (por uid en la bolsa del server), oro suficiente, lugar en la bolsa, límites de precio y cantidad, dueño de la publicación al retirar.
- **Atomicidad**: cada acción corre síncrona dentro del event loop (igual que el resto de la economía). Dos compras "a la vez" de la misma publicación se resuelven en orden: la primera la saca de la lista y la segunda recibe "Esa publicación ya no está" **sin pagar nada**. No hay estado intermedio en el que el item esté en dos lugares.
- Cada transacción queda en el log del server: `[Subastas] publicación #N ...`, `venta #N: X compra ... por P; comisión C, neto al buzón N`, `cancelada #N`, `vencida #N`, `buzón: X retira ...`.

## Persistencia
- Las publicaciones, los buzones y los historiales van en un registro propio del **mismo Storage que las cuentas**, con la clave reservada `_subastas` (las claves de cuenta son hexadecimales, no puede chocar): `DATA_DIR/accounts/_subastas.json` con archivos, o una fila más de la tabla `accounts` (`jsonb`) con Postgres (`DATABASE_URL`). No hay tablas nuevas ni migración.
- Después de **cada** transacción se guarda la cuenta tocada (bolsa/oro) y la casa y se fuerza `flush()`, sin esperar el debounce de 1,5 s. Con archivos las dos escrituras son síncronas y seguidas (tmp + rename cada una); con Postgres van en orden por la misma cola de upserts, pero **no en una transacción SQL**: si el proceso muere justo entre las dos escrituras se podría perder o duplicar ese item. Para cerrarlo del todo haría falta un `Storage.putMany` transaccional (pendiente, ver abajo).
- Probado: matar el server con `kill -9` después de publicar y volver a levantarlo deja la publicación y la bolsa como estaban; y después de comprar/vender/retirar, el historial de cada cuenta sigue completo.
- Compatibilidad: `history` y `nextHist` son opcionales en el registro; una casa guardada antes del historial carga igual (con historial vacío).
- El vendedor desconectado no necesita estar cargado: el oro de la venta va al buzón de la casa, no a su cuenta.

## Protocolo (tags propios desde 300)
- Cliente → server: `AuctionRequest` = 300 en `ClientMessage`: `{ npc_id, action, query, uid, price, listing_id, mail_id }`, con `action` = `open | search | post | cancel | buy | claim | history` (`claim` con `mail_id = 0` retira todo; `history` pide el historial propio).
- `AuctionQuery { slot, rarity (0 = todas, 1..4 = Común..Épico), text, lvl_min, lvl_max, max_price, sort (price_asc | price_desc | time_asc | time_desc), page }`. 0 o vacío = sin filtro; filtros inválidos se ignoran.
- Server → cliente: `AuctionSearchResult` = 300 (página de 20, `page`, `pages`, `total`) y `AuctionMyState` = 301 (mis publicaciones y mi buzón). El resultado de cada acción (ok/error con texto en español) va en el `EconResult` de siempre; si cambió el oro o la bolsa también llega `InventoryState`.
- `AuctionListing { id, item (InvItem), price, seller (nombre), expires_in_ms, mine, lvl }`; `AuctionMail { id, item?, gold, text, age_ms }`.
- Server → cliente: `AuctionHistory` = 302 `{ entries: AuctionHistoryEntry[] }`, del más nuevo al más viejo. `AuctionHistoryEntry { id, kind, item?, amount (con signo), price, fee, other (la otra parte), age_ms }`. Se manda al abrir, al pedirlo (`history`), después de cada acción que salió bien y, al vendedor/dueño conectado, cuando se vende o vence algo suyo.
- Regenerar `packages/proto/src/network.ts`: `pnpm --filter @fdn/proto generate` usa el `protoc` de `grpc-tools`; si ese binario no se pudo bajar, se usa `grpc_tools` de Python con el mismo plugin y opciones (el resultado es idéntico salvo la línea de versión de protoc del encabezado, que se deja como estaba):
  `cd packages/proto && python3 -m grpc_tools.protoc --plugin=protoc-gen-ts_proto=$PWD/node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=src --ts_proto_opt=esModuleInterop=true,env=browser,forceLong=bigint,oneof=unions-value,outputServices=none,outputJsonMethods=false --proto_path=$PWD $PWD/network.proto`

## Búsqueda
Paginada en el server (20 por página). Filtros: tipo (arma/armadura/cabeza/anillo), rareza, texto del nombre (sin mayúsculas ni tildes), rango de nivel y precio máximo. Orden por precio (menor/mayor) o por tiempo restante (termina antes/después).

**Nivel de un item**: los items no tienen requisito de nivel propio, así que el filtro usa el nivel con el que su base se vende en las tiendas (el mismo "Nv" que muestra el vendedor; `itemLevel()` en `packages/world`). Una Espada corta es Nv 1 y un Mandoble Nv 10, tengan la rareza que tengan.

## Cliente
`apps/client/src/auction.ts` arma la ventana con la misma estética que Personaje/Inventario: marco de metal oscuro con filetes dorados y las esquinas, cresta y gema de `#fwc`/`#fwcrest`/`#fwgem`, placa roja con el título **CASA DE SUBASTAS** centrado y la × roja en la esquina; Cinzel para títulos, pestañas y nombres; precios en dorado; nombres con el color de su rareza; íconos de `itemIcon` y moneda de `coinIcon`.

- **Pestañas** grandes rojas con borde dorado (la activa iluminada), con contadores: *Mis publicaciones (n)*, *Buzón (n)*. Son cinco: **Buscar**, **Publicar**, **Mis publicaciones**, **Buzón** e **Historial**.
- **Columna izquierda**: el item destacado (lo seleccionado en la tabla: ícono grande con marco de rareza, nombre, precio grande, estado, stats/atributos y la acción: Comprar, Publicar con precio y tasas calculadas, Retirar publicación, Retirar del buzón) y debajo una lista corta: los items de la página en Buscar, lo que está en venta en Publicar y lo que espera en el buzón en el resto (tocar uno lleva a esa pestaña).
- **Columna derecha**: barra con el título y el **saldo** de oro, filtros (desplegables y campos con el mismo estilo), una tabla tipo registro con filas alternadas (Item · Rareza/Nivel · Vendedor/Transacción · Tiempo restante/Fecha · Precio/Monto) y el paginado (Buscar pagina en el server; bolsa, buzón e historial en el cliente, de a 20).
- **Responsive**: por debajo de 860 px la columna izquierda pasa arriba (sin la lista) y el cuerpo se desplaza; por debajo de 600 px las pestañas van en dos filas con nombres cortos, se ocultan las columnas Rareza y Vendedor (pasan como subtítulo debajo del nombre) y los filtros de nivel/precio/rareza se abren con "Más filtros". Probado a 1280×720, 760×700 y 390×844 sin desborde horizontal.
- **Teclado**: flechas izquierda/derecha (e Inicio/Fin) entre pestañas; Tab entra a la tabla en la fila seleccionada; flechas arriba/abajo, Inicio/Fin cambian de fila (la selección sigue al foco), RePág/AvPág cambian de página y Enter salta a la acción del destacado; Escape cierra y devuelve el foco al juego. Foco visible dorado en todo. Las teclas dentro de la ventana no llegan a los atajos del juego (salvo Escape). El foco se conserva cuando llegan mensajes del server y se redibuja.

En `main.ts` solo hay enganches chicos: abrirla desde `openShop` cuando el rol es `subastador`, cerrarla con `closeShop`, pasarle los mensajes `auctionSearchResult`/`auctionMyState`/`auctionHistory` y redibujarla en `applyInventory`.

## Pruebas
- Unitarias: `cd apps/server && npx tsx --test test/auction.test.ts` (publicar, validaciones y límites, cancelar, vencer, comprar, comprar sin lugar, sin oro, lo propio, doble compra concurrente, tasas y comisión, buzón parcial con bolsa llena, búsqueda/filtros/orden/páginas, persistencia en archivos y el manejo de red con distancia al NPC) y del historial (cada tipo de transacción con sus montos, que las acciones rechazadas no dejan entradas, el tope de 200, persistencia y carga de una casa vieja sin historial, y cuándo se manda por red).
- De punta a punta: se probó con Playwright contra el server real (dos cuentas de facciones distintas, publicar, comprar, doble compra, aviso al vendedor, buzón, retirar, distancia, y reinicio con `kill -9`). Con la ventana nueva: publicar, comprar, retirar, retirar del buzón, contadores de las pestañas, Historial de vendedor y comprador con filtros de tipo y fecha, navegación con teclado, Escape, vista de celular sin desborde y el historial después de un `kill -9`. Los scripts no están en el repo.

## Pendientes / ideas
- Pujas (precio inicial + compra directa opcional).
- `Storage.putMany` transaccional (Postgres `BEGIN ... COMMIT`) para escribir la cuenta y la casa en una sola transacción.
- Si el volumen crece: pasar la casa a tablas (`auction_listings`, `auction_mail`) con índices por slot/rareza/precio; hoy la búsqueda filtra en memoria (alcanza para miles de publicaciones).
- Historial de precios por base para sugerir un precio al publicar.
