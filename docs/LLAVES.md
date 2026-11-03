# Llaves de las mazmorras

Estado: **implementado** (2/11/2026) para D1 y D2. Diseño en el doc del proyecto `mvp-dungeons-llaves-quests.md` §3. Regla: farmear una llave cuesta más o menos lo que dura la corrida.

## La cadena

| Llave | Receta | De dónde sale |
|---|---|---|
| **Llave de la cueva** (abre D1, Cueva goblin) | 8 colmillos + 60 de oro | Colmillos: 8 % en los pits de nivel 1-5 (~100 kills) |
| **Llave gastada** | — | La suelta el **jefe goblin** al 100 %, **una para cada uno** de la party que esté cerca, solo si muere en su piso (Minas goblin) |
| **Llave del nido** (abre D2, Nido de hormiga león) | 1 llave gastada + 1 esencia + 120 de oro | Esencia: 3 % en los pits de nivel 6-10, o 1 por día con el primer encargo |

- **Se arma en cualquier lado**: en la bolsa, pestaña de materiales, clic derecho sobre el material o la llave (o clic y el botón "Armar" del detalle). No hace falta un NPC.
- **Cada jugador gasta la suya al cruzar la puerta.** Nadie entra de arrastre: el compañero sin llave se queda afuera y recibe el aviso.
- Dos pedidos de puerta a la vez gastan una sola (el segundo se ignora mientras el primero cruza).
- La puerta que pide llave es la **entrada desde la superficie al primer piso** (`DUNGEON_ENTRY_KEYS`). Los pasos entre pisos no piden nada.
- Con las corridas de `MAZMORRAS.md`: una llave = una corrida. Si caés, la corrida terminó para vos; para volver hace falta otra llave y una corrida nueva.

## En el código

- `packages/world/src/quests.ts`: `KEY_RECIPES`, `BOSS_KEY_DROPS`, `DUNGEON_ENTRY_KEYS`, `keyMissing`. Las llaves viven en los **materiales** del personaje (`mats`), junto a colmillos y esencias: viajan al cliente en el libro de misiones y no se aceptan en la repetible.
- `packages/world/src/flare/index.ts`: le pone la llave a la puerta de entrada de cada mazmorra de la tabla.
- `apps/server/src/economy.ts`: acción `combine` (armar), `consumeKey` (gastar al cruzar) y la llave gastada en el botín del jefe.
- `progressFromEcon` suma las llaves de los materiales a las que miran las puertas.
- Las llaves viejas (cripta y foso, con esquirlas y el Capitán) siguen igual.

## Pendiente

- Llaves de D3, D5 y D7 (con la regla de que los materiales caigan en los pits del mismo tramo y cerca de la entrada).
- Íconos propios (hoy usan los de la llave y la esquirla viejas).
- Venta en la subasta (por defecto, sí; los materiales siguen siendo el límite).
- Si en la prueba se ven más de ~2 corridas por hora sostenidas: "botín del jefe 1 vez cada 20 h".
