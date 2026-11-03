# Dar e Intercambiar entre jugadores

Fecha: 3/11/2026. Paso 3.7 de `PLAN_DE_TRABAJO.md` (parte de intercambio directo). Decisión de Román: como en Helbreath, **dos acciones separadas**: "Dar" (le pasás algo a alguien) e "Intercambiar" (se cambian cosas entre los dos). Referencia de reglas: Dreadmyst (solo con jugadores que ves; también desde el menú de la party).

Código: `apps/server/src/trade.ts` (reglas), `apps/client/src/trade.ts` (ventanas), mensajes `TradeRequest` / `TradeState` / `TradeInvite` en `packages/proto/network.proto` (tags 1300 y 1301). Pruebas: `apps/server/test/trade.test.ts` (17) y `apps/server/scripts/test-trade.ts` (2 jugadores por la red, 23 verificaciones).

## Cómo se usa

- **Clic derecho sobre un aliado** (o clic en su fila de la party) abre el menú: *Intercambiar*, *Dar un item…*, *Dar oro…*.
- **Dar:** elegís un item de tu bolsa **o** una cantidad de oro. La otra persona ve un cartel con *Aceptar / Rechazar* (vence a los 30 s). Recién al aceptar se mueve.
- **Intercambiar:** la otra persona acepta la invitación y se abre una ventana con *Tu oferta | Oferta del otro*. Clic en un item de tu bolsa lo agrega a tu oferta; clic en la oferta lo saca. Hasta 8 items y una cantidad de oro por lado. Cada uno aprieta *Confirmar*; cuando confirman los dos, se hace el cambio. **Cualquier cambio quita las confirmaciones de los dos**, y lo que el otro agregó después de tu última confirmación aparece como *Nuevo*.

## Reglas (las valida el server; el cliente solo pide)

| Regla | Valor |
|---|---|
| Quién | Jugadores del mismo mundo, conectados, vivos, a 12 celdas o menos, **de la misma nación**, y de otra cuenta |
| Qué | Items de equipo del catálogo (hoy no hay ligados ni frágiles; `tradable()` es el lugar donde se van a excluir) y oro. Pociones, llaves y materiales no se pasan |
| Ocupado | Una persona solo puede estar en una invitación o ventana a la vez |
| Lugar | Después del cambio, las dos bolsas tienen que entrar (18); el oro no puede pasar del máximo seguro |
| Invitaciones | Vencen a los 30 s; se pueden rechazar o cancelar |
| Barrido | Cada 1 s se cierra lo que deja de cumplirse (se alejó, se desconectó, cruzó de mapa, murió) |
| Ritmo / reenvíos | Límite de pedidos por segundo por cuenta; un `op_id` repetido no se aplica dos veces |

**Solo Dar** (la ruta natural de las mulas del RMT): nivel mínimo **5**, y topes por cuenta cada 24 h de **20 items** y **1.000.000 de oro**. Intercambiar no los lleva, porque es de dos lados. Los límites van por volumen de la cuenta, no por requisitos de contenido (lección de Dreadmyst: ver `FEEDBACK_COMUNIDAD_DREADMYST.md`). Las constantes están al principio de `trade.ts`.

## Cómo evita duplicar o perder items

1. Los items de una oferta **se quedan en la bolsa** mientras se negocia: no existen en dos lugares.
2. Una sola función (`swap`) hace el movimiento para Dar y para Intercambiar. Valida todo (items todavía en la bolsa y tradeables, oro, lugar de los dos, tope de oro) **antes** de tocar nada; después saca de las dos bolsas, mete en las dos (uid nuevo, porque los uid son por personaje) y guarda las dos cuentas juntas con un solo `flush`. Todo corre síncrono dentro del event loop.
3. Si algo cambió entre la oferta y la confirmación (se vendió, se tiró, se equipó), el item sale de la oferta y hay que confirmar de nuevo. Si no entra en una bolsa, no pasa nada y la ventana queda abierta sin confirmaciones.
4. Cada transferencia queda en el registro del server (`[Intercambio] …` con nombre y cuenta de cada lado, items y oro).

## Qué falta (pendiente)

- **Prueba manual con 2 personas en el navegador** (E del plan): la UI compila y el flujo por la red está probado con bots, pero las ventanas no se probaron a mano.
- **Topes diarios de Dar en memoria:** un reinicio del server los reinicia. Para producción hay que guardarlos en la cuenta (con migración).
- **Campo `origen` del item** (`regalo` / `intercambio`, `ECONOMIA_Y_MONEDAS.md` §3) y **registro de movimientos persistente**: hoy solo hay log en consola.
- **Ítems ligados y frágiles** (`tradable()`), **correo** y **subasta de 1 a 3 días**.
- **Misma nación:** valor por defecto; falta decidir si se permite entre naciones en ciudad neutral.
- Aviso de "Nuevo" para cambios de oro (hoy el cambio solo quita las confirmaciones).
- Lugar en la bolsa: sube de 18 a ~30 en el paso 3.2; las reglas usan `BAG_MAX`.
