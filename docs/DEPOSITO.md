# Depósito (baúl / banco)

Depósito **por cuenta** y **server-autoritativo**: el cliente solo pide; el server valida todo y guarda.

## Dónde
Cualquier NPC con rol `depositario` (`roleOf(npc) === 'depositario'`, ids `depositario_s`, `depositario_v`, `depositario_s2`...). El server reconoce **el rol, no una posición**: funciona en cualquier mapa, siempre que el NPC esté en el mismo mundo/mapa que el jugador (se busca en los NPC del mundo donde está) y a distancia de charla (`SHOP_SERVER_RANGE`, como las tiendas y la casa de subastas).

Hoy, en el mapa viejo `solmar_legacy`:
- Solmar: `depositario_s` (Depositario Anselmo), plaza, celda (13, 6), al norte de la Subastadora.
- Vhar: `depositario_v` (Depositaria Ilsa), plaza de hierro, celda (84, 14), al sur del Subastador.

La ciudad nueva de Solmar lo pone en su edificio "Depósito" con el mismo rol: no hace falta tocar nada del depósito para que ande ahí. Si el id no tiene aspecto propio en el cliente (`NPC_LOOKS`), usa el de `depositario_s`.

Hablar con él (clic, o caminar hasta él) abre la ventana. Se cierra con la ×, con Escape o al alejarse.

## Qué guarda
| Qué | Capacidad |
| --- | --- |
| Equipo (arma, armadura, cabeza, anillo) | 48 casillas (`DEPOT_SLOTS`). El item conserva base, rareza y atributos; el uid se renueva al entrar y al salir (los uid de la bolsa son por personaje). |
| Oro | Sin tope de juego. Techo técnico `Number.MAX_SAFE_INTEGER`, igual que el oro de la bolsa; si una operación lo pasaría, se rechaza (no se pierde oro). |
| Pociones de vida y de maná | Stack por tipo, hasta 9.999 cada uno (`DEPOT_STACK_MAX`). Encima se siguen pudiendo llevar como mucho 99 (`POT_MAX`). |
| Llaves (cripta, foso) y esquirlas (cripta, foso) | Stack por tipo, hasta 9.999. Encima, como mucho 99 (`MAT_MAX`, el mismo tope que ya usaba la economía). |

Es **de la cuenta** (`AccountRecord.vault`), no del personaje: si un día hay varios personajes por cuenta, lo comparten. Hoy hay uno.

Constantes y nombres de los stacks: `packages/world/src/deposit.ts` (las usa el server para validar y el cliente para dibujar).

## Operaciones (todas validadas en el server)
`DepositRequest.action`:
- `open`: manda el contenido.
- `put` (uid de la bolsa) / `take` (uid del depósito): mover un item.
- `gold_in` / `gold_out` (`amount`): oro.
- `stack_in` / `stack_out` (`stack` + `amount`): pociones, llaves o esquirlas (`pot_hp`, `pot_mp`, `key_cripta`, `key_foso`, `shard_cripta`, `shard_foso`).
- `sort`: ordena el depósito por tipo, rareza y nombre (la bolsa tiene su propio "Ordenar").

Validaciones: sesión con personaje, ritmo (~6 pedidos/s por cuenta, ráfaga de 12, como en subastas), vivo, **no durante el cruce de mapa** (el jugador no está en ningún mundo entre `MapTransfer` y `MapReady`; además el pedido nunca llega a un mundo que no lo tiene), NPC con rol `depositario` en el mapa del jugador y cerca, propiedad (el uid tiene que estar en la bolsa / en el depósito de esa cuenta), lugar en el destino (bolsa < 18, depósito < 48), montos enteros positivos y suficientes, topes de stack. Los errores vuelven en `EconResult` con texto en español ("El depósito está lleno (48 / 48).", "La bolsa está llena (18 / 18): hacé lugar antes de retirar.", "No hay tanto oro en el depósito: hay 1.000.", "Solo podés llevar 99 de Poción de vida (podés retirar 2).", "Estás muy lejos del Depositario.", ...).

## Atomicidad y reenvíos
- Cada acción corre síncrona dentro del event loop: valida todo, después aplica. El item **sale** de un lado antes de **existir** en el otro, y un segundo pedido por el mismo uid ya no lo encuentra ("Ese item ya no está en el depósito.").
- Bolsa y depósito viven en el **mismo registro** de la cuenta (`econ` y `vault` del JSON de la cuenta). El guardado es inmediato (`put` + `flush`, sin esperar el debounce de 1,5 s) y es **una sola escritura**: un archivo con tmp + rename, o un único upsert `jsonb` en Postgres. No hay estado intermedio en disco en el que el item esté en los dos lados o en ninguno (a diferencia de subastas, que escribe dos registros).
- **Pedido repetido** (por ejemplo, el cliente reenvía después de un corte): cada pedido lleva un `op_id` elegido por el cliente. Los últimos 32 `op_id` aplicados se guardan en el depósito **en la misma escritura** que el cambio; un pedido con un `op_id` ya aplicado no se vuelve a aplicar (se contesta con el estado actual), tampoco después de un reinicio. Un pedido que falló no "gasta" su número.
- Corte de conexión en el medio: la acción ya corrió entera y quedó guardada, o no corrió.

## Persistencia
`AccountRecord.vault = { v: 1, items[], gold, stacks{}, nextUid, ops[] }`, dentro de la cuenta, en el mismo `Storage` (archivos `DATA_DIR/accounts/<clave>.json` o la tabla `accounts` de Postgres con `DATABASE_URL`). No hay tablas nuevas ni migración: una cuenta sin `vault` tiene el depósito vacío y se crea con la primera operación.

Probado: `kill -9` del server después de guardar y volver a levantarlo deja depósito y bolsa como estaban.

## Protocolo (tags propios desde 400)
- Cliente → server: `DepositRequest` = 400 en `ClientMessage`: `{ npc_id, action, uid, amount (double), stack, op_id }`.
- Server → cliente: `DepositState` = 400 en `ServerMessage`: `{ items (InvItem), gold (double), stacks [{id, qty}], capacity, stack_max }`. Se manda al abrir y después de cada acción. El resultado va en el `EconResult` de siempre y, si cambió algo de la bolsa, también llega `InventoryState`.

## Cliente
`apps/client/src/deposit.ts` arma la ventana con el marco de las ventanas Personaje/Inventario (madera oscura, cabecera roja, filigrana dorada, Cinzel):
- Dos grillas lado a lado: **Bolsa** (18, con contador `x / 18`) y **Depósito** (48, con contador `x / 48` y "Ordenar"). Debajo de cada una, los consumibles y materiales con su cantidad.
- Mover: **doble clic**, **Shift+clic**, **arrastrar y soltar** a la otra grilla, o seleccionar y usar el botón de la barra de abajo. En los stacks, la barra pide la cantidad (con "Máx."); doble clic / Shift+clic / arrastrar mueve todo lo que se pueda.
- Oro: campo de monto (acepta "1.500") con **Depositar →** y **← Retirar**; tocar el oro de un lado copia todo ese monto al campo.
- Tooltip igual al de la bolsa (nombre con color de rareza, rareza, slot, daño/defensa/RM y atributos).
- Teclado: Tab llega a las grillas, flechas recorren, Enter selecciona, **Shift+Enter** mueve, **Escape** cierra; lo que se teclea en la ventana no dispara atajos del juego.
- Pantallas chicas: se escala para entrar en el alto disponible; por debajo de 640 px de ancho las dos grillas se apilan y la ventana se desplaza.
- En `main.ts` solo hay enganches chicos: abrirla desde `openShop` cuando el rol es `depositario`, cerrarla con `closeShop`, pasarle `depositState` y `econResult`, redibujarla en `applyInventory`, el aspecto de los dos NPC y el ícono de baúl sobre su cabeza.

## Logs
`[Depósito] <nombre> guarda <item> (r<rareza>, atributos); depósito N/48.`, `... retira <item> ...`, `... deposita N de oro; en depósito X, encima Y.`, `... retira N de oro ...`, `... guarda N × <stack>; en depósito X, encima Y.`, `... retira N × <stack> ...`.

## Pruebas
- Unitarias: `cd apps/server && npx tsx --test test/deposit.test.ts` (depositar/retirar item con atributos intactos, propiedad, sin lugar en bolsa/depósito, oro con montos inválidos, sin oro y techo técnico, pociones/llaves/esquirlas con topes, doble envío por uid y por `op_id`, ordenar, persistencia en archivos tras "reinicio" y en un solo archivo, depósito compartido por la cuenta, red: rol y no posición, distancia, NPC de otro mapa, muerto, cruce de mapa y ritmo; y que el NPC del mapa viejo no pise portales ni otros NPC).
- De punta a punta: Playwright contra server y cliente reales (crear cuenta, comprar, ir al Depositario, mover items con doble clic / Shift+clic / arrastrar / botón / Shift+Enter, oro en los dos sentidos, errores, pociones, Escape, salir y volver a entrar, `kill -9` del server y volver a entrar, alejarse cierra, 390×760 y 1024×600). El script no está en el repo.

## Pendientes / ideas
- Más pestañas o ampliar casillas (pago en oro).
- Pasar `vault` a tablas si algún día se consulta entre cuentas (hoy no hace falta).
