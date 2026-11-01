# Nivel máximo 40, curva de exp, daño en área e ítems (análisis)

Fecha: 1/11/2026. Pedido: subir el techo a nivel 40, abrir mapas, que los primeros 10 niveles sean más fáciles y después se ponga más difícil aunque los bichos den más exp, revisar el farmeo en área y hacer un análisis profundo de los ítems.

**Cómo leer los números:** son de un modelo simple (guerrero, un bicho a la vez, 85 % del tiempo pegando, 2,5 s entre bichos, 300 kills/hora en un pit, sin muertes ni pociones). Sirven para ver la forma de las curvas y los problemas, **no** para prometer horas reales. Hay que validarlos con `sim-arranque.ts` extendido a 40 antes de fijar valores.

## 1. Resumen: qué encontré

1. **La curva actual ya es casi la que querés**, solo hay que subir el techo (`MAX_LVL` está en 60 en `economy.ts`; el tope de importación ya es 40). Con el techo en 40 un guerrero a un bicho por vez tarda ~4 h hasta el 10, ~26 h hasta el 20 y ~190 h hasta el 40. Lo que falta es aliviar el arranque y frenar el daño en área.
2. **El daño en área es lo que más puede romper la curva.** Con 2-3 bichos por golpe, esas ~190 h bajan a ~60-95 h. Hay que decidir cuánto más rápido puede ser un mago que un guerrero.
3. **Los ítems tienen 7 problemas que hay que arreglar antes de pasar a 40 niveles** (sección 5). Los tres más graves: el poder de los ítems deja de seguir al nivel pasado el 12; **tres de los atributos de los únicos (crítico, velocidad de ataque, robo de vida) los calcula el cliente y el server no los aplica**; y el oro pierde valor frente a los precios y las mejoras.
4. **Contenido:** para llegar a 40 faltan unos 29 niveles de mundo. Se puede cubrir estirando el rango de cada mapa y sumando mapas de la reserva de Flare (sección 4).

## 2. Curva de nivel 1 a 40

### 2.1 Hoy

- `killsToLevel(L) = 40·L` kills de un bicho común de tu nivel. Vida del bicho `29 + 10,5·L + 2,75·L²`, daño del jugador sube ~`3·L`: **el tiempo por kill crece con el nivel** y los kills por nivel también, así que las horas por nivel crecen como L².
- Modelo (arma que sube ~1,05 por nivel, ver 5.1):

| Nivel | Vida del bicho | Exp por kill | Kills para subir | Horas por nivel | Horas acumuladas |
|---|---|---|---|---|---|
| 1 | 42 | 5 | 40 | 0,04 | 0 |
| 5 | 150 | 61 | 200 | 0,30 | 0,8 |
| 10 | 409 | 172 | 400 | 0,94 | 4,1 |
| 15 | 805 | 317 | 600 | 2,0 | 11,8 |
| 20 | 1.339 | 488 | 800 | 3,6 | 26,3 |
| 30 | 2.819 | 896 | 1.200 | 8,2 | 85,9 |
| 39 | 4.621 | 1.328 | 1.560 | 14,2 | ~190 |

### 2.2 Propuesta: fácil hasta el 10, más duro después

Un solo mando: **`killsToLevel`**. Subir la exp por bicho y subir los kills por nivel es lo mismo (se compensan), así que alcanza con tocar esta función y dejar `mobExpCurve` como está. Objetivo (guerrero a un bicho por vez): ~2,5 h hasta el 10, ~18 h del 10 al 20, ~55 h del 20 al 30, ~115 h del 30 al 40 (≈190 h en total).

| Nivel | Kills hoy | Kills propuestos | Relación |
|---|---|---|---|
| 1 | 40 | 12 | 0,3× |
| 3 | 120 | 73 | 0,6× |
| 5 | 200 | 151 | 0,76× |
| 9 | 360 | 307 | 0,85× |
| 12 | 480 | 418 | 0,87× |
| 20 | 800 | 829 | 1,04× |
| 30 | 1.200 | 1.381 | 1,15× |
| 39 | 1.560 | 1.905 | 1,22× |

Fórmula aproximada: `kills(L) = 12·L^1,5` para L < 10 y `≈ 340·(L/10)^1,3` desde el 10 (se afina con la tabla). El cambio hacia abajo en 1-10 es chico (los primeros niveles ya son rápidos); la curva sube más fuerte desde el 25.

Para que se sienta "más exp pero más difícil" sin tocar el modelo: mostrar la exp por kill más alta (multiplicar `mobExpCurve` y `expToLevel` por el mismo factor, p. ej. 10×) deja las horas iguales y los números más lindos.

### 2.3 Cosas a tocar en el código

- `MAX_LVL` 60 → 40 (`apps/server/src/economy.ts`). El `HP/MP` de clase y el daño ya suben lineal por nivel (`CLASS_HP`, `CLASS_MP`), así que a 40 no hay que cambiar fórmulas.
- Castigo de muerte: 5 % de la exp del nivel. A nivel 39 son ~0,75 h de farmeo; es proporcional y está bien.
- **Riesgo de power-leveling (hoy sin protección en mapa abierto):** la exp que se reparte usa la exp del bicho sin mirar el nivel del jugador. Un nivel 40 que lleva a un nivel 5 a un pit de nivel 30 le da exp a full. Falta una regla de diferencia de nivel (p. ej. exp ×(1 − 0,1 por nivel de diferencia pasados 5, mínimo 10 %)). En mazmorras lo frenan las puertas con requisito de nivel, que ya validan a cada compañero.
- Los **bichos de mazmorra** dan ×2 de exp pero tienen ×2,5 de vida: rinden menos exp por segundo que un pit. Es lo que se busca (la mazmorra es por botín), pero hay que saberlo.

### 2.4 Meta de tiempo ajustada (2 de noviembre, a pedido): llegar a 40 en ~2 días a full

Las ~190 h de arriba eran demasiado. La vara que dio Román: un veterano que ya sabe las mecánicas llegaba al máximo en unos 2 días de juego intenso. Además, a la gente le gusta más ir encontrando ítems y armando un set que subir de nivel sin parar. Entonces **el nivel dura poco y el equipo carga el largo plazo.**

| Quién | Horas hasta el 40 | Cómo sale |
|---|---|---|
| Veterano, farmeando en área | ~30 h | ≈ 2 días a full |
| Modelo un bicho a la vez | ~60 h | es el modelo base de este documento |
| Jugador casual (muertes, camina, mira el mapa) | ~95 h | ≈ 1,6× el modelo |

Curva con la forma de la tabla de Helbreath (`T(L) ∝ L^2,35`) y exp por bicho que casi no crece (exponente ~0,15):

| Tramo | Modelo un bicho | Veterano en área |
|---|---|---|
| 1 → 10 | 0,9 h | 0,5 h |
| 10 → 20 | 6,1 h | 3 h |
| 20 → 30 | 17,4 h | 8,7 h |
| 30 → 40 | 35,7 h | 17,8 h |

Kills por nivel resultantes (de ~0,3× lo que había propuesto): 12 en el 1, 56 en el 5, 120 en el 10, 267 en el 20, 430 en el 30 y 586 en el 39. Seguimos con "fácil hasta el 10 y más duro después", pero ahora el 39 → 40 son ~2,3 h para el veterano y no 15 h.

Consecuencias:
- Las **tasas de drop de 5.3 hay que recalcularlas**: con bandas mucho más cortas, la chance de único de hoy (1,5 % en pit) alcanza y no hace falta bajarla por banda. El objetivo de largo plazo pasa al equipo: set por nación, mejoras +N, runas, dificultades de dungeon, arenas y los puntos tipo Majestic al tope.
- El tiempo hasta el 40 ya no es el cuello de la progresión: lo es **conseguir y mejorar el equipo** (5.1 a 5.9 siguen valiendo, y ahora con más urgencia).
- Corrección: el "73 h" que viste en mi tabla era solo el tramo 30 → 40 de la fila "como hoy"; el total de esa fila rondaba las 190 h, o sea que tu reacción era correcta.

## 3. Matar en área

### 3.1 Cuánto distorsiona

Los pits tienen ~1 bicho cada 7-8 celdas, pero los bichos se agrupan al pelear. Con Bola de fuego (radio 1,9) o Giro del guerrero (radio 1,9), en una pelea normal pegás a 2-4 bichos por golpe; en `COMBATE.md` el mago liquida 4-6 goblins en ~3 s. Tomo un multiplicador de 1,5× a 3×:

| Multiplicador de área | Horas totales hasta 40 | 1 → 10 | 10 → 20 | 30 → 40 |
|---|---|---|---|---|
| 1× (un bicho) | 191 | 2,5 | 18 | 115 |
| 1,5× | 127 | 1,7 | 12 | 77 |
| 2× | 95 | 1,2 | 9 | 58 |
| 3× | 64 | 0,8 | 6 | 38 |

Un mago bueno con 3× llega a 40 en un tercio del tiempo. Eso solo es un problema si el guerrero no puede acercarse; el contenido de grupo también se vacía más rápido.

### 3.2 Qué hacer (en orden de mi preferencia)

1. **Penalidad por objetivo extra** en el daño en área: cada bicho golpeado de más hace −12 % (mínimo 50 %). Mantiene que el área sirva y evita que sea 3× de gratis. Se aplica solo en el server.
2. **Maná como límite:** Bola cuesta 25 de maná cada 3,6 s. Sin bonus de maná, el mago se queda sin maná antes que sin bichos; las pociones de maná pasan a ser sumidero de oro. Hay que medirlo (el mago sube maná 12 por nivel).
3. **Bichos más peligrosos en grupo:** los pits altos con un "líder" (élite con ×4 de vida) que obligue a elegir objetivo.
4. **No penalizar la exp por kill** (queda raro y castiga a los grupos).
5. Calibrar la curva para que el **área rinda hasta ~1,6× lo del guerrero**, no más. Si queda más, se baja el multiplicador con la penalidad.

Parte compartida: con 4 jugadores, cada uno recibe `(1 + 0,1·3)/4 = 32,5 %` de la exp del bicho, pero mata ~4× más rápido, así que ronda 1,3× de la exp de ir solo. Está bien, no hace falta tocarlo.

## 4. Contenido para llegar a 40

Hoy hay 12 mapas abiertos (niveles 1-11) y 6 mazmorras (2-12). Para 12-40 faltan ~29 niveles. Dos palancas, que se combinan:

- **Estirar el rango de cada mapa.** `mobDef` reescala cualquier bicho que no sea jefe a cualquier nivel (mismo sprite). Hoy los pits de un mapa difieren ±1 nivel; con ±3 cada mapa cubre 4-6 niveles y los 12 mapas actuales alcanzan hasta ~el 18-20 sin tocar el arte.
- **Sumar mapas de la reserva de Flare** (hay ~25: `grot_lagoon`, `lake_kuuma`, `black_oak_farm/city`, `oasis`, `lochport`, `torture_chambers`, `arrival`, `perdition_harbor`, etc.): ~10 mapas más para 20-40, y 4 a 6 mazmorras nuevas (una cada ~5 niveles) con sus jefes. Cada mazmorra más requiere ítems de jefe (sección 5.2).

Con el techo en 40 conviene que los **mapas ya no sean 1 por nivel**: a nivel alto cada mapa dura más horas (cada nivel pide más kills), así que menos mapas por nivel alcanzan.

## 5. Ítems: análisis profundo

Estado de los ítems hoy: ítems únicos fijos T1 a T3 (niveles 1-6), ítems de jefes D1-D3, mejora +1 a +5, runas en diseño. A partir del nivel 7 los bichos aún sueltan el botín viejo (62 % ítem con rareza). Cada banda (tier) son 2 niveles: `tier = ceil(nivel / 2)`, máximo 6.

### 5.1 El poder de los ítems no sigue al nivel (grave para 40 niveles)

Las armas y armaduras únicas crecen por banda, pero la banda se corta en 6 (nivel 12). A partir de ahí el ítem deja de crecer mientras el jugador sigue sumando ~3 de daño por nivel:

| Nivel | Aporte del arma al daño por golpe (hoy, tope en T6) | Si el arma sigue creciendo ~1,05 por nivel |
|---|---|---|
| 6 | 22 % | 22 % |
| 12 | 23 % | 23 % |
| 20 | 18 % | 24 % |
| 30 | 14 % | 24 % |
| 40 | **11 %** | 25 % |

A nivel 40 el arma casi no pesa, y con ella toda la idea de "equiparse mejor". **Propuesta:** definir el poder del ítem por *nivel de ítem* (no por banda de 2 niveles) con la misma pendiente que el nivel (arma ≈ `6 + 1,05·L`, armadura y yelmo con la misma lógica), de modo que el equipo aporte siempre ~25 % del daño y una parte estable de la defensa. La defensa ya usa `X/(100+X)`, así que no se escapa; solo hay que subirla con el nivel.

### 5.2 Cantidad de ítems y arte

- 40 niveles con bandas de 2 niveles serían **20 bandas × 10 ítems = 200 únicos**: inviable. **Propuesta: 8 bandas de 5 niveles × 10 = 80 únicos**, más 2 ítems por cada jefe de mazmorra (~12 mazmorras → ~24). Total ~105.
- El arte se reutiliza (los 4 sets de armadura Solmar/Vhar y los `look` de las bases), así que ítems de bandas distintas se verían iguales y no se nota la progresión. **Barato y efectivo:** teñir el aspecto por banda (cambio de paleta) para que el jugador vea que subió de tier.

### 5.3 Tasas de drop vs. duración de cada banda

Hoy: único por kill = 0,5 % (suelto), 1,5 % (pit), 4 % (mazmorra); 10 únicos por banda al azar; a 300 kills/hora.

- Un único cualquiera cae cada ~13 min en un pit; un ítem **específico** cada ~2,2 h; tener los **4 mejores para tu clase** (arma, armadura, yelmo, anillo) lleva ~4,6 h en pit y ~1,7 h en mazmorra.
- Con la curva propuesta la banda dura entre 0,5 h (niveles 1-5) y ~55 h (niveles 36-39). O sea: **en las bandas altas completás tu equipo mucho antes de salir de la banda y después no queda nada que perseguir** (justo la queja de Dreadmyst); en las bajas lo completás después de irte.
- **Propuesta:** que la chance de único baje con la banda para que el equipo completo tome ~40 % del tiempo de la banda (mínimo ~2 h). Tabla orientativa (pit, con área 1,5×):

| Banda | Duración (con área 1,5×) | Único por kill en pit (hoy 1,5 %) |
|---|---|---|
| 1-5 | 0,4 h | 3,5 % (sin importar mucho: casi no se farmea) |
| 6-10 | 1,8 h | 3,5 % |
| 11-15 | 4,6 h | 3,5 % |
| 16-20 | 9,2 h | ~1,9 % |
| 21-25 | 15,8 h | ~1,1 % |
| 26-30 | 24 h | ~0,7 % |
| 31-35 | 35 h | ~0,5 % |
| 36-39 | 37 h | ~0,47 % |

(En las bandas bajas el tiempo real es en su mayoría caminar, misiones y muertes, no farmeo, así que la tasa ahí pesa menos.)

### 5.4 Pool de drop diluido: la mitad no es para tu clase

De los 10 únicos de cada banda, un guerrero usa ~6 (armas 1 y 2 manos, armadura pesada/media, yelmo físico, 2 anillos) y un mago ~5. Con el botín propio de cada compañero, el server **sabe la clase de quien recibe**: se puede sesgar el sorteo (p. ej. 60 % ítems de tu clase / 40 % del resto, para que sirvan de mercancía en la subasta). Eso casi duplica la velocidad de armarse sin tocar la tasa.

### 5.5 Basura en una bolsa de 18

`BAG_MAX = 18` y se sueltan ítems "comunes" sin atributos en el 6 % de los kills (~18/h) más ~4,5 únicos/h en pit: **la bolsa se llena en menos de una hora** y lo que sobra cae al suelo. Apogea recibe críticas justamente por el inventario tedioso. Propuesta: sacar los comunes del botín (convertirlos en oro), subir la bolsa a ~30, y un botón "vender basura". Las piedras de forja ya se acumulan aparte (`Econ.forge`).

### 5.6 Atributos: tres no los aplica el server y ninguno tiene tope

- Los únicos usan 2 atributos por ítem de 11 posibles. El server (`statsFromChar` y la exp) aplica: maná, vida, mag, DF, RM y resistencia a parálisis (`rpar`), y la exp. **El crítico, la velocidad de ataque y el robo de vida los calcula el cliente** (`main.ts`: `5 + t.crit`, `0,85/(1+aspd/100)`, curación local). Los usan `arma1` (vel. ataque, crítico), `arma2` (crítico, robo de vida) y los anillos ofensivos: **más de la mitad de los atributos de las armas y los anillos de ataque no dependen del server**. Verificar cuánto del daño los respeta el presupuesto de golpes del server; si no lo respeta, son un hueco para hacer trampa, y si lo topea, a veces el atributo "no hace nada".
- No encontré topes (crítico, velocidad, robo de vida). Con T6 un único da hasta ×2 el valor medio (p. ej. 16 % de vel. ataque por ítem, 8 % de robo de vida) y suman entre ranuras, runas y mejora. Hay que definir topes en el server (referencia: crítico total ≤ 35 %, robo de vida ≤ 15 %, vel. de ataque ≤ 40 %).
- **Runas:** no incluir `exp` entre los atributos (el bonus de exp ya existe y se suma entre ítems; acelera la curva que acabamos de calibrar). Si se incluye, tope 10 % total.

### 5.7 Mejoras +N

- Cada nivel suma +4 % a los stats base. En el diseño completo (+11) son +44 %, y un salto de banda de 5 niveles aporta ~13 %. O sea: **un ítem viejo +11 supera a ~3 bandas de ítems nuevos**. Eso rompe la progresión.
- Hoy +5 cuesta ~59 piedras y ~11.800 de oro en banda 5; con pits (8 % de piedra) son ~2,5 h de farmeo para +20 % en un ítem que vas a cambiar en menos de 2 h. Resultado: **nadie va a mejorar hasta las bandas finales** y las piedras se acumularán sin sumidero (no es malo si es a propósito).
- **Propuestas:** (1) bajar a ~2,5 % por nivel (+11 ≈ +27 %, unas 2 bandas); (2) o limitar el máximo según la banda del ítem (+3 en T1-T4, +5 en T5-T6, +11 solo en las dos últimas), para que el sumidero grande quede en el endgame; (3) opcional: un "pergamino de traspaso" que conserva parte de los niveles al cambiar de ítem.

### 5.8 Oro y precios

- Oro por kill ≈ `2,5·L`; a 300 kills/h son ~740·L por hora: ~7.400/h en el nivel 10 y ~29.700/h en el 40.
- `uniqueValue = 60·tier^1,6` (×2 si es de jefe): un único de la banda 5 vale ~790; en la banda 8 ~1.700. El costo de mejorar (`40·tier·(up+1)` por intento) llega a ~19 mil para +5 en la banda 8, menos de una hora de ingresos.
- **A nivel alto el oro no vale nada**: todo cuesta menos que una hora de farmeo y no hay en qué gastarlo. Hay que escalar precios y costos con el *nivel* y no con la banda, y sumar sumideros reales (reparación de ítems, pociones más caras, runas, pergaminos de protección, llaves).

### 5.9 Suministro y valor en la subasta

- Los jefes sueltan un ítem propio al 100 % **por compañero cercano**. Una party de 4 que repite el dungeon produce 4 ítems por corrida: los ítems de jefe valdrán poco en la subasta si las llaves son baratas.
- Las llaves son el límite natural (farmeadas con materiales de pit, como dijiste): ahí está el control real del suministro. Si el ítem de jefe se puede vender, el precio mínimo depende de lo que cueste la llave más el tiempo del grupo.
- Decidir de una vez si los ítems de jefe quedan atados a la cuenta o se pueden subastar (decisión abierta #2 de `ITEMS.md`).

## 6. Orden de trabajo sugerido

1. `MAX_LVL` 40, nueva `killsToLevel`, regla de diferencia de nivel para la exp. (S)
2. Penalidad de daño en área por objetivo extra y revisión de maná. (S-M)
3. Pasar el poder de los ítems de banda a nivel de ítem (5.1) y fijar 8 bandas de 5 niveles (5.2). (M)
4. Verificar y mover al server crítico, velocidad y robo de vida, con topes (5.6). (M-L)
5. Tasas de drop por banda, sesgo por clase, sacar los comunes y ampliar la bolsa (5.3-5.5). (M)
6. Rebalancear +N (tope por banda o 2,5 %) y escalar oro y precios con el nivel (5.7-5.8). (M)
7. Extender `sim-arranque.ts` hasta 40 y validar horas reales de los puntos 1-2. (M)
8. Mapas y mazmorras para 12-40 (sección 4). (L)

## 7. Preguntas abiertas

1. ¿Cuántas horas querés que dure llegar a 40 para alguien que juega bien (guerrero a un bicho vs. mago en área)?
2. ¿Cuánto más rápido puede subir el mago en área: 1,3×, 1,6× o 2×?
3. ¿Banda de 5 niveles (8 bandas) o 4 niveles (10 bandas)?
4. ¿Los ítems de jefe se pueden subastar?
5. ¿Tope de +N por banda, o bajar el porcentaje por nivel?
