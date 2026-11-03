# Llaves de las mazmorras

Estado: **implementado para los seis dungeons** (2/11/2026). D7 no existe todavía (falta el mapa). Diseño en el doc del proyecto `mvp-dungeons-llaves-quests.md` §3. Regla: farmear una llave cuesta más o menos lo que dura la corrida.

## La cadena

| Llave | Receta | De dónde sale |
|---|---|---|
| **Llave de la cueva** (abre D1, Cueva goblin) | 8 colmillos + 60 de oro | Colmillos: 8 % en los pits de nivel 1-5 (~100 kills) |
| **Llave gastada** | — | La suelta el **jefe goblin** al 100 %, **una para cada uno** de la party que esté cerca, solo si muere en su piso (Minas goblin) |
| **Llave del nido** (abre D2, Nido de hormiga león) | 1 llave gastada + 1 esencia + 120 de oro | Esencia: 3 % en los pits de nivel 6-10, o 1 por día con el primer encargo |
| **Llave de la cripta olvidada** (abre D3) | 8 huesos antiguos + 200 de oro | Hueso antiguo: 4 % en los pits de nivel 11-15 (Cementerio de Lochport, donde está la entrada) |
| **Llave de la torre** (abre D4, Torre del hechicero) | 8 tintas arcanas + 300 de oro | Tinta arcana: 4 % en los pits de nivel 16-20 (La Brecha) |
| **Llave del templo** (abre D5, Templo de Mez) | 8 plumas de tormenta + 450 de oro | Pluma de tormenta: 4 % en los pits de nivel 21-25 (Cenizas II) |
| **Llave de la fortaleza** (abre D6, el Foso) | 8 brasas infernales + 650 de oro | Brasa infernal: 4 % en los pits de nivel 26-30 (Cenizas III) |

**Cadena solo en D1 → D2** (es el tutorial). De D3 en adelante cada llave sale de los pits del mismo tramo y del mapa de la entrada: un jugador alto nunca vuelve a contenido bajo por una llave (fue de las quejas más fuertes en Dreadmyst).

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

- D7 (cuando exista el mapa).
- Íconos propios (hoy usan los de la llave y la esquirla viejas).
- Si en la prueba se ven más de ~2 corridas por hora sostenidas: "botín del jefe 1 vez cada 20 h".


## Encargo del día de dungeon: una llave de vuelta
Cada encargo del día de dungeon (D1 a D7, el de tu tramo) se puede cumplir una vez por día y, al cobrarse, además del oro y la exp **devuelve una llave de ese dungeon** (`DUNGEON_KEY` en `quests.ts`). El ciclo: farmeás los materiales, armás la llave, matás al jefe, el encargo te da otra y repetís la corrida gratis; para una tercera, a farmear. En party le toca a cada uno (las quests cuentan para todos los cercanos). Entra dentro del tope de 3 encargos por día.

**Para que no se spamee** (Román, 3/11): con la llave del encargo, los materiales de llave de D3 a D7 bajaron de 6 % a 4 % (8 materiales: ~133 → ~200 mobs). Las dos primeras corridas del día salen más baratas que antes (~100 mobs cada una) y de la tercera en adelante, más caras (~200). D1 y D2 no cambian (son el tutorial).
