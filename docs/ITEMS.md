# Ítems, runas y mejoras (borrador de diseño)

Estado: **paso 1 del MVP implementado** (ítems únicos de T1 a T3 + ítems de los jefes D1-D3 + tabla de drops). Runas y mejoras +N siguen en diseño. Los números son puntos de partida para probar, no valores finales.

Implementación: `packages/world/src/uniques.ts` (catálogo; cada único es una `Base` más y entra en `ALL_BASES`), `apps/server/src/economy.ts` (`reward`, `uniqueItem`, `UNIQUE_CHANCE`, `COMMON_CHANCE`, `GOLD_CHANCE`). Rareza en el juego: los únicos de banda son rareza 2 (se muestra "Raro") y los de jefe rareza 3 ("Épico"); no se cambiaron los nombres de la interfaz.
Depende de: `docs/MAPAS_FLARE.md` (mapas, mazmorras y jefes), `docs/ECONOMIA_SERVER.md` (el server valida precios, stock y atributos) y `docs/ZONAS.md` (curvas de vida/exp por nivel).

## 1. Idea general

Hoy: 4 slots (arma, armadura, cabeza, anillo), ~18 bases genéricas y 4 rarezas con atributos al azar. Se pasa a:

- **Ítems únicos con nombre y stats fijos**, uno o más por banda de nivel y slot. El nombre ya dice cuánto poder tiene.
- **Variación chica** (±10 %) en uno o dos stats, para dar motivo a repetir el farmeo sin romper el balance de PvP.
- **Runas** (sockets) como segunda capa de personalización.
- **Mejora de +1 a +11** con probabilidad de fallar, como sumidero de recursos y objetivo de largo plazo.
- Sin gear score por ahora (con ítems únicos el nombre ya indica el poder). Si hace falta pedir equipo mínimo en mazmorras o inspeccionar en PvP, alcanza con sumar los niveles de ítem equipados.

## 2. Bandas de nivel (alineadas con las mazmorras)

6 bandas de 2 niveles. Cada una tiene su mazmorra y su jefe, que es el dueño de los ítems característicos de la banda.

| Banda | Niveles | Mapas abiertos | Mazmorra | Jefe (ítem característico) |
|---|---|---|---|---|
| T1 | 1-2 | Campos de Sal, Bosque de piedra | D1 Cueva/Minas goblin (Nv2-4) | Jefe goblin |
| T2 | 3-4 | Cañón goblin, Pantano de Merrimead | (D1 sigue siendo la de la banda) | Jefe goblin |
| T3 | 5-6 | Altas de Nazia, Cementerio de Lochport, Risco del Sur | D2 Nido de hormiga león (Nv6-8) | Reina hormiga león |
| T4 | 7-8 | La Brecha, Paso de Stormrock | D3 Cripta olvidada (Nv7-9) | Caballero de la cripta |
| T5 | 9-10 | Cenizas I y II | D4 Torre del hechicero (Nv9-11) | Mago mayor |
| T6 | 11-12 | Cenizas III | D5 Templo de Mez (Nv10-12), D6 Foso del demonio (Nv11-12) | Wyvern del aire, Señor del Foso |

Nota: D1 cubre T1 y T2; las bandas T5-T6 tienen dos o tres mazmorras. Es el reparto natural de los mapas que ya existen; si se quiere uno a uno, hay que mover puertas o rangos.

## 3. Cantidad de ítems (primera estimación: ~70)

Por banda y por slot, para que cada clase tenga qué ponerse:

| Slot | Ítems por banda | Detalle |
|---|---|---|
| Arma | 3 | una mano, dos manos, mágica |
| Armadura | 3 | pesada, media, de tela/mago |
| Cabeza | 2 | física, mágica |
| Anillo | 2 | ofensivo, defensivo |
| **Subtotal** | **10** | × 6 bandas = **60** |
| Jefes | 2 por jefe | ítems característicos (arma y pieza de armadura) = ~12 más |

El arte se reutiliza (`look` de las bases actuales y los sets de armadura de Solmar y Vhar), así que los ítems nuevos son sobre todo datos: nombre, slot, stats, nivel, quién lo suelta.

## 4. Tipos de ítem

- **Normal**: se vende en tiendas y cae de mobs comunes de bandas bajas. Stats fijos y bajos. Sirve para arrancar.
- **Único**: cae de pits y mobs de mazmorra. Stats fijos buenos, con variación chica.
- **De jefe**: cae solo de un jefe de mazmorra. Mejores stats de la banda, con 1 socket de runa.

## 5. Dónde cae qué (propuesta inicial)

Chances por muerte, a probar y ajustar con el juego andando.

| Origen | Normal | Único de la banda | De jefe | Runas |
|---|---|---|---|---|
| Mob suelto (mapa abierto) | 6 % | 0,5 % | — | 1 % |
| Pit de mapa abierto (mobs agrupados) | 6 % | 1,5 % | — | 2 % |
| Mob de mazmorra (tier dungeon) | 6 % | 4 % | — | 5 % |
| Jefe de mazmorra | — | — | 100 % (1 ítem de los suyos) | 100 % (1 runa) |

Reglas:
- El nivel de ítem sale del nivel del mob (como hoy), pero cada mob solo suelta ítems de su banda o de la anterior. No cae equipo de bandas altas en mapas bajos.
- Los pits dan mejor chance que los mobs sueltos: es el motivo para ir a los pits.
- Las mazmorras suben la chance de únicos, porque se hacen en grupo y los mobs son más fuertes (`DUNGEON_MULT`).
- El oro y la exp siguen la curva actual; este cuadro solo cambia equipo y runas.
- Implementado hoy (bandas T1 a T3, niveles 1-6): 6 % ítem común sin atributos, la chance de único de la tabla, 45 % oro y el resto nada. Los mobs de nivel 7+ y los jefes sin ítems propios (D4-D6, bosses viejos) siguen con el botín viejo hasta que existan sus ítems. Los jefes D1-D3 ya no dan esquirlas de la llave vieja.
- Pendiente: la runa de los jefes y un segundo ítem extra del jefe.

## 6. Runas

Un ítem tiene 0 a 2 sockets: los ítems de jefe tienen 1, el segundo se agrega más adelante (mejora o evento). Cada runa da un atributo del juego (crit, aspd, leech, hp, mp, mag, exp, poison, rpar, df, rm: los `AttrId` actuales) con valor que depende del nivel de la runa.

- **Insertar** una runa tiene probabilidad de **fallar**, y si falla **se pierde la runa, no el ítem**. El costo es oro más la runa.
- Las runas de mayor nivel fallan más y cuestan más. Se pueden **combinar** 3 runas del mismo nivel para obtener una de nivel superior (también con probabilidad de falla).
- **Sacar** una runa cuesta oro y la destruye (para que no se pueda mover de ítem gratis).
- Ítems con nombre del mismo set (más adelante, si se hacen sets) pueden dar un bonus extra, pero **el set no depende de las gemas**. Esto evita el problema que describiste de Dreadmyst: gemas carísimas que fallaban casi siempre para completar el set. Acá el set se completa solo con ítems.

MVP: runas de 3 niveles, 1 socket en los ítems de los jefes D1-D3, y sin segunda ranura.

## 7. Mejora +1 a +11

Para ítems Únicos y de jefe (los normales no se mejoran, para no gastar recursos en equipo que se va a reemplazar).

Sumidero de oro y de materiales, con dos recursos:
- **Piedra de forja** (común): la usan todas las mejoras. Cae de mobs.
- **Piedra de forja pura** (rara): hace falta desde +7. Cae de jefes y mobs de mazmorra.

Probabilidades iniciales (a ajustar):

| Mejora | Éxito | Si falla |
|---|---|---|
| +1 a +3 | 100 % | — |
| +4 a +6 | 80 % → 60 % | se queda en el mismo nivel |
| +7 a +9 | 50 % → 35 % | baja 1 nivel |
| +10 a +11 | 20 % → 10 % | baja 1 nivel |

- **Nunca se destruye el ítem**, solo baja de nivel. Es una decisión de MVP (perder ítems únicos duele demasiado con ítems únicos que no se pueden reemplazar fácil).
- Existe un **pergamino de protección** (caro, se vende en tiendas o se obtiene de jefes) que evita la bajada de nivel al fallar.
- Cada nivel de mejora suma un porcentaje al daño/defensa base del ítem (a definir, ~+4 % por nivel; +11 ≈ +45 %).
- Los números de arriba están pensados para que llegar a +11 sea raro y valioso. Cuando haya jugadores se ven las estadísticas reales de fallos y se ajusta.

## 8. Economía y subasta

- Las **Piedras de forja** y las **runas** son lo que más se mueve en la subasta (ya hecha, `docs/SUBASTAS.md`).
- Los ítems únicos tienen precio de mercado por nombre, lo que hace funcionar mejor la subasta que con afijos al azar.
- Sumideros de oro: intentos de mejora, insertar y sacar runas, pergaminos de protección. Sin eso el oro se infla.
- El server valida todo (como hoy con `economy.ts`): tablas de drop, probabilidades de mejora y de inserción **solo viven en el server**, el cliente no las conoce ni las calcula.

## 9. Qué cambia en el código (para cuando se apruebe)

- `packages/world/src/economy.ts`: tabla de ítems únicos (hoy `BASES` + `SHOP_BASES`) con `tier`, `socket`s y stats fijos; `Stock` ya admite atributos fijos.
- Server: generador de botín por origen (mob suelto / pit / mazmorra / jefe) según la tabla de la sección 5, y nuevas acciones validadas para mejorar, insertar y sacar runas.
- Cliente: mostrar nombre y nivel de mejora (+N), sockets y runas en el ítem, y las ventanas de forja y de runas.
- **Ítems viejos de los jugadores**: se dejan como están (ítems "legacy", con su rareza y atributos), siguen valiendo, y no se pueden mejorar ni engarzar. Más simple y no le roba nada a nadie. Alternativa: convertirlos a un Normal equivalente.

## 10. Plan de MVP (en este orden)

1. **Ítems únicos** de T1 a T3 y los ítems de los jefes D1-D3, con la tabla de drops de la sección 5.
2. **Runas** (3 niveles, 1 socket) con inserción que puede fallar.
3. **Mejora** de +1 a +5, y recién después +6 a +11 cuando se vean los números reales.
4. Ajustar probabilidades con partidas de prueba.

## 11. Decisiones abiertas

1. ¿Cuántos ítems únicos por banda: 10 como se propone, o menos para el MVP?
2. ¿Los ítems de jefe pueden venderse y subastarse, o quedan ligados al que los obtiene?
3. ¿Hay sets con bonus por piezas, o solo ítems sueltos?
4. ¿Los ítems legacy de los jugadores se conservan tal cual o se convierten?
5. ¿Se permite destruir el ítem al fallar mejoras altas (+10, +11) para que tenga más riesgo, o nunca?
6. Nombres de las piedras: las mejoras de Helbreath usaban piedras con nombre propio (Merien, Xelima); decidir si se les pone nombres de ese estilo o nombres propios de ERIS.
