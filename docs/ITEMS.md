# Ítems, runas y mejoras (borrador de diseño)

> Las decisiones de diseño viven en [`DISEÑO.md`](DISEÑO.md); este archivo es nota de implementación y estado, y puede estar desactualizado.

Estado 3/11: **modelo de calidad implementado** (ver `claude/modelo-de-items-y-stats.md` en el proyecto). Únicos de T1 a T7 en 8 slots + jefes D1-D7; el botín viejo con rareza al azar se eliminó. Poder por nivel de ítem (ilvl), mejoras +1 a +11 con tope por calidad, reforja de extras, 4 sets con bonos, efectos de jefe y oferta del día; las runas siguen en diseño.

Implementación: `packages/world/src/uniques.ts` (catálogo, ilvl, calidad, extras, sets y efectos), `apps/server/src/economy.ts` (`reward`, `uniqueItem`, `rollQuality`, `bossQuality`, `reforge`), `apps/server/src/dailyShop.ts` (oferta del día), `apps/server/src/mobs.ts` (efectos de jefe en PvE).

## 0. Calidad (el campo `r` del ítem)

La calidad se SORTEA al caer y define cuántos stats extra trae el ítem y hasta dónde se mejora. El poder base sale del catálogo (banda); la calidad no lo toca.

| Calidad | `r` | Extras al azar | Mejora hasta | De dónde cae |
|---|---|---|---|---|
| Común (blanco) | 0 | 0 | +1 | tienda, arranque |
| Verde | 1 | 1 | +3 | lo normal de pits (85 %) y mazmorras (60 %) |
| Azul | 2 | 2 | +5 | pits 15 %, mazmorras 40 %; D1-D2 seguro; jefes de mundo |
| Violeta | 3 | 2 (rango alto) | +8 | jefes: D3-D7 seguro; D1 25 %, D2 40 %, jefes de mundo 25 % |
| Dorado | 4 | 2 (rango alto) + efecto especial | +11 | solo jefes: D3 10 %, D4 15 %, D5 20 %, D6 35 %, D7 60 % |

- **Extras**: al final de `a`, después de los fijos del catálogo (`uniq.attrs.length`). Pool sin `exp`; valor lineal con el ilvl del ítem × ranura (arma/armadura 1×, cabeza 0,65×, anillo 0,5×) × tirada. Pueden salir de otra clase: esa copia es mercadería para la subasta.
- **Topes del server**: crítico 35 % total, vel. ataque 40 %, robo de vida 15 %, y DF ≤ 60 / RM ≤ 75 sumadas de atributos (la base de las armaduras no entra).
- **Mejora**: +4 % por nivel sobre los stats de base (no toca los atributos). De +6 en adelante el fallo BAJA un nivel.
- **Reforja**: re-tira UN extra elegido en el herrero; piedras de reforja (solo de jefes de mazmorra, 1-2 por corrida) + oro, costo que se duplica con cada reforja del mismo ítem (`rf`). La calidad y los fijos no se tocan.
- **Botín personal**: cada drop lo sortea el server por jugador; élites y jefes de mundo dan una tirada a cada participante (amenaza, ≤ 30 celdas). Los comunes del botín viejo son ahora basura vendible por tipo de mob (`JUNK_MATS`, uid 0 en EconSellRequest = "vender basura").
- **Oferta del día** (`dailyShop.ts`): global por día UTC; 3 líneas comunes con descuento + estrella (35 % de los días) con roll visible y stock 1 del server, a 30-60× el valor de lista: el sumidero de oro grande.
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
- Implementado hoy (bandas T1 a T6, niveles 1-40; los mobs de T7 sueltan los únicos de T6 porque la banda de ítems topea en 6): 6 % ítem común sin atributos, la chance de único de la tabla, 45 % oro y el resto nada. Los jefes D1-D7 sueltan siempre uno de sus ítems. El botín viejo (62 % ítem con rareza) ya no lo usa ningún mob común; queda para los jefes sin ítems propios.
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

1. **Ítems únicos** de T1 a T6 y los ítems de los jefes D1-D7 (hecho), con la tabla de drops de la sección 5.
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

## 12. Principios de diseño (del feedback de jugadores de Dreadmyst y de la experiencia en Helbreath)

- Loop buscado: limpiar mobs, mejorar el equipo, hacer mazmorras, en un ritmo tranquilo ("chill").
- **Siempre un próximo objetivo claro**: el ítem de tal jefe, el siguiente +N, el siguiente mapa. Farmear sin objetivo aburre (pasaba en Helbreath). Hay que mostrarlo en el juego.
- Mapa del mundo (tecla M) y wiki generada desde los datos: después de la beta.

## 13. Estado de la mejora +N (implementado)

- Solo ítems únicos (de banda y de jefe), en la bolsa o equipados, en un herrero (armero o armadurero), con el botón "Mejorar" del tooltip.
- MVP: de +1 a +5 (`UP_MAX`). Éxito (como Helbreath, arranca en 33 % para que la gente pueda "limar"): +1 a +3 33 %, +4 25 %, +5 20 % (`UP_RATE`, solo en el server). Costo esperado de llegar a +5: ~59 piedras y ~59 × 40 × banda de oro (a revisar contra el ritmo real de drops de piedras). Si falla, el ítem no baja: se pierden las piedras y el oro del intento. Costo de pasar de +n a +n+1: n+1 piedras de forja y `40 × banda × (n+1)` de oro.
- Cada nivel suma +4 % a daño, defensa, RM y daño mágico base (`upMult`); los atributos fijos no escalan.
- Piedras de forja: 5 % mob suelto, 8 % pit, 18 % mob de mazmorra (1 piedra); los jefes con ítems propios sueltan 3 a 5. Se guardan en la cuenta (`Econ.forge`).
- El nivel de mejora se conserva al guardar en el depósito, subastar y comprar en la subasta.
- Pendiente: +6 a +11 con bajada de nivel al fallar, piedra pura y pergamino de protección (cuando se vean los números reales).
- **Slots (8)**: arma, armadura, cabeza, guantes, botas, amuleto y dos anillos (`anillo`, `anillo2`; los anillos son todos de slot `anillo` y entran en el primer lugar libre). Capa y alas: a futuro.
- **Poder por ilvl**: `stats(arch, ilvl, m)` lineal. Banda T1-T7 = ilvl 5-35; los ítems de jefe, ilvl de su banda +5 con un multiplicador chico (1,06-1,39); el Gran Verdugo (D7) es ilvl 40, lo máximo. Las 7 bandas tienen 16 únicos comunes (8 slots × variantes ofensiva/defensiva o física/mágica) y cada arquetipo toma uno de 4 pares de atributos fijos según su banda (identidad por ítem).
- **Tienda**: armas, armaduras y yelmos al ≤ 75 % del único de su banda; stock común de guantes y botas; los sets de nación no se venden.
- **Sets** (`SETS`): Alba de Solmar (T4, malla), Cenit de Solmar (T5, placas), Ceniza de Vhar (T6, malla), Brasa de Vhar (T7, placas); **8 piezas cada uno** (arma, armadura, cabeza, guantes, botas, amuleto y dos anillos distintos) con bonos a 2/4/6/8 piezas distintas, aplicados en `statsFromChar` por los mismos topes. Las piezas caen solo en mazmorras: la mitad de los únicos de los mobs de la mazmorra del tramo y 50 % extra del jefe de cada mazmorra, **prefiriendo siempre una pieza que todavía no tengas** (completar el set lleva 8 piezas, sin repetidas hasta tenerlas todas).
- **Efectos de jefe** (solo calidad Dorado): Quemadura (15 % de prender fuego en golpes básicos), Estocada aturdidora (10 %, 0,8 s) y Vampirismo (3 % de la vida máxima al matar); PvE.
- **Drops por banda** (`uniqueChance`): se balancean con las muertes reales que pide cada tramo (202, 473, 801, 1153, 1531, 1933 y 4574 muertes por banda): en pits caen ~14 únicos por banda (8-18), así la chance baja de 4 % en T1 a 0,4 % en T7; en mazmorra ~2 únicos por corrida (chance = 2 / mobs de la mazmorra); sueltos a un tercio del pit.
