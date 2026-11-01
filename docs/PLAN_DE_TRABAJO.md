# Plan de trabajo paso por paso, con pruebas

Fecha: 1/11/2026. Ordena todo lo que salió en `ROADMAP_MVP.md` y `NIVEL_40_E_ITEMS.md` en pasos concretos. Cada paso dice **qué se hace, qué pruebas automáticas lleva, qué se prueba a mano y cuándo se da por terminado**. Tamaños: S = menos de un día, M = 1-3 días, L = más de 3.

Estado de partida (`main`, 1/11): 140 de 141 tests del server en verde (1 salteado). Faltan CI, nivel 40, puntos de stats, ítems T4+, arenas y mapas de nivel alto. Lo que dice cada paso sobre el código sale de lo que leí del repo; si algo cambió, el paso se corrige.

## 0. Cómo se prueba (vale para todos los pasos)

**Tipos de prueba**

| Tipo | Qué es | Dónde / cómo |
|---|---|---|
| A. Unitaria | Funciones puras (curvas, fórmulas, costos) | `apps/server/test/*.test.ts` y `packages/world` con `pnpm test` |
| B. Integración del server | `GameWorld` / `WorldRegistry` con almacenamiento en memoria, como `registry.test.ts` y `party.test.ts` | mismos archivos de test |
| C. Script contra server en marcha | Flujos completos con cliente falso | `apps/server/scripts/test-economy.ts`, `test-combat.ts` (con `FDN_DEBUG_TRUST_SAVE=1`) |
| D. Simulación de balance | Mide horas por nivel, kills por hora, tiempo de pelea | `sim-arranque.ts` (hay que extenderlo a nivel 40) |
| E. Manual con 2 jugadores | Lo que los tests no ven: sensación, UI, latencia | checklists de cada paso, con el menú GM (F9) para saltar de mapa y subir nivel |
| F. Persistencia y migración | Reiniciar el server, cuentas viejas, guardado atómico | tests con almacenamiento en memoria + prueba en el deploy con Postgres |
| G. Rendimiento | Tick del servidor con muchos mundos y mobs | `FDN_TICK_STATS=1` (promedio, p95 y máximo cada 30 s) |
| H. Antitrampa | El cliente miente y el server tiene que ignorarlo | tests B que mandan paquetes inválidos |

**Reglas fijas**
1. Todo paso nuevo trae sus tests; no se mergea con tests en rojo.
2. **El server decide todo**: oro, ítems, stats, daño, exp. El cliente solo pide y dibuja.
3. Tags nuevos del protocolo siempre al final (el protocolo usa el índice).
4. Cada cambio que toque datos guardados lleva su migración y su test F.
5. Antes de cerrar un paso: `pnpm test`, typecheck del server y del cliente, y recorrido manual corto.

**Decisiones que bloquean pasos, con el valor que tomo si no decidís otra cosa**

| Decisión | Bloquea | Valor por defecto |
|---|---|---|
| Curva de nivel (exponente de la exp por bicho) | 1.1 | 0,15 (≈ 30 h de veterano hasta el 40) |
| Cuánto más rápido puede subir el mago en área | 1.4 | máximo 1,6× el guerrero |
| Bandas de ítems: 5 o 4 niveles | 3.1 | 5 niveles (8 bandas) |
| Ítems de jefe: ¿se subastan? | 3.7 | Sí, con las llaves como límite del suministro |
| Tope de +N por banda o % menor por nivel | 3.4 | Tope por banda: +3 hasta la banda 4, +5 en 5-6, +11 en las dos últimas |
| ¿Afijos en ítems comunes? | 3.3 | Sí, después de los únicos T4+ |
| ¿Puntos Majestic y ángel en la beta? | 3.9 | Puntos sí, ángel si hay tiempo |

---

## FASE 0 — Cimientos (en paralelo, no se juega pero frena la beta)

### 0.1 CI mínimo (S)
**Hacer:** acción de GitHub que en cada push y pull request corra `pnpm install --frozen-lockfile`, typecheck del server y del cliente, y `pnpm test`, con caché.
**Pruebas:**
- Crear una rama con un test roto a propósito: el CI tiene que fallar. Con el test arreglado, tiene que pasar.
- Medir el tiempo total (objetivo menos de 5 min).
**Listo cuando:** `main` tiene el check verde y una rama roja bloquea el merge.

### 0.2 Legal y catálogos (M-L)
**Hacer:** reemplazar `apps/server/data/catalog/*.json` (hoy idénticos a los de Helbreath: ítems, monstruos, NPCs y hechizos) por catálogos propios; anotar autor y licencia de cada pieza de OpenGameArt en `LICENCIAS_AUDITORIA.md`; decidir si el repo deja de ser público.
**Pruebas:**
- A: un test que falle si algún catálogo o texto del juego contiene nombres de una lista prohibida (nombres propios de Helbreath).
- A: un test que falle si un asset del `meta.json` no tiene entrada de licencia.
- Antes de reemplazar: revisar qué usa el cliente de esos catálogos (`itemsDirectory`, `monstersList`) para no romper la UI.
- E: crear cuenta, jugar 10 minutos y revisar que ningún texto visible quedó sin nombre o con uno viejo.
**Listo cuando:** el repo no contiene datos de terceros sin licencia clara y la auditoría no tiene filas "DUDOSA" ni "Riesgo alto".

### 0.3 Deploy de prueba (M)
**Hacer:** server en Render, Postgres en Neon, cliente en Cloudflare Pages.
**Pruebas:**
- F: crear cuenta, jugar, reiniciar el server y comprobar que el personaje, la bolsa, el oro y la posición siguen.
- C: correr `test-economy.ts` contra el deploy.
- G: con `FDN_TICK_STATS=1`, 10 minutos con 2 jugadores: p95 del tick bajo el presupuesto (el intervalo configurado).
- E: abrir desde otra red y otro navegador, medir la latencia.
**Listo cuando:** dos personas de afuera pueden jugar 30 minutos sin perder progreso.

---

## FASE 1 — Nivel 40, stats y topes (la base de todo lo demás)

### 1.1 Techo 40 y curva de nivel (M)
**Hacer:**
- `MAX_LVL` de 60 a 40 en `apps/server/src/economy.ts`.
- Nueva `killsToLevel`/`expToLevel` en `packages/world/src/mobs.ts` (cliente y server usan la misma función): forma `T(L) ∝ L^2,35`, exp por bicho casi constante.
- Multiplicador de exp por nivel del jugador: 100 % al nivel 1, bajando en línea recta hasta ~11 %, aplicado en `Economy.reward`.
- Regla de diferencia de nivel: sin exp ni drops de bichos muy por debajo, y reducción para el que es llevado a una zona de nivel muy alto.
**Pruebas:**
- A: `expToLevel` crece de forma estrictamente creciente de 1 a 39; la exp acumulada a 40 coincide con el objetivo (±2 %); sin `NaN` ni desbordes.
- A: el multiplicador vale 1 en el nivel 1 y baja de forma monótona hasta su piso.
- B: matar bichos hasta cruzar varios niveles de una vez sube bien; nunca pasa de 40; la exp sobrante en el 40 no se pierde ni rompe el guardado.
- B: nivel 40 matando bichos nivel 1 recibe exp cero; nivel 5 en party con un 40 en un pit alto recibe la exp reducida.
- F: una cuenta guardada con nivel mayor a 40 se recorta a 40 sin perder objetos.
- D: `sim-arranque.ts` extendido a 40: horas por tramo dentro de ±25 % de la meta (modelo un bicho: 0,9 h hasta el 10, 6 h hasta el 20, 24 h hasta el 30, 60 h hasta el 40).
- E: guerrero y mago nuevos de 1 a 10 midiendo el tiempo real (objetivo: menos de una hora).
**Listo cuando:** tests verdes, la simulación en meta y un veterano de prueba llega al 40 en un tiempo cercano a la meta (~30 h en área).

### 1.2 Puntos de stats (M-L)
**Hacer:** cinco stats (Fuerza, Vitalidad, Destreza, Magia, Suerte), 10 por stat al crear + 10 libres, +3 por nivel (~190 en total a 40), tope por stat ~100; acción nueva de protocolo para asignar; reasignar gratis hasta el nivel 10 y después con un ticket; estado en `Econ` con migración; ventana de personaje con botones +/−; `statsFromChar` usa los stats.
**Pruebas:**
- A: fórmulas de vida, maná, daño y chance de drop con cada stat.
- B: asignar con puntos libres funciona; falla con negativos, más de lo disponible, sobre el tope, sin vivir, o con dos pedidos al mismo tiempo (no puede gastar el mismo punto dos veces).
- H: `saveCharacterRequest` del cliente no puede pisar los stats.
- F: cuenta de la versión anterior se migra sin perder nada y con los puntos libres que le corresponden.
- D/C: `test-combat.ts` con distribuciones extremas (todo Vitalidad, todo Fuerza, todo Magia): el tiempo de pelea contra un bicho de su nivel queda en ±20 % de la referencia.
- E: subir tres niveles, repartir, ver cómo cambian vida y maná en la ventana y que los valores coinciden con el server.
**Listo cuando:** ningún stat rompe el balance y no se puede hacer trampa con los puntos.

### 1.3 Atributos autoritativos y topes (M-L)
**Hacer:** verificar primero (spike corto) qué respeta hoy el server del crítico, la velocidad de ataque y el robo de vida (hoy los calcula el cliente en `main.ts`); mover esos tres al server; topes (crítico total ≤ 35 %, robo de vida ≤ 15 %, velocidad ≤ 40 %, absorción mágica 60 %, absorción física 80 % por zona); crítico con cargas recargables.
**Pruebas:**
- A: los topes se aplican cuando se suman equipo, runas y mejora.
- H: un cliente que manda siempre crítico, o ataca más rápido que la recarga del hechizo, es topeado o ignorado.
- B: el robo de vida cura la vida del server; el bonus de velocidad no deja atacar más rápido que el límite.
- C: `test-combat.ts` en verde.
- E: equiparse un arma con velocidad y crítico y ver que lo que se ve en pantalla coincide con lo que registra el server.
**Listo cuando:** ningún atributo de ítem depende de lo que diga el cliente.

### 1.4 Daño en área y habilidades de mobs (M-L)
**Hacer:**
- Penalidad de daño en área: −12 % por objetivo extra, mínimo 50 %, solo en el server; revisión del consumo de maná.
- Mobs que huyen a ≤7 % de vida según su valentía (no huyen si están paralizados).
- Habilidades de mob con multiplicador de exp: anti-físico y anti-mágico (×1,5), tóxico (×1,3), explosivo (×1,5); mutantes (×3 de exp, ×2 de chance de drop) como variante de un pit; salvajes (+25 %) fuera de los pits.
**Pruebas:**
- A: daño con 1, 2, 3 y 6 objetivos; los multiplicadores de exp por habilidad.
- B: un mob con vida baja huye según su valentía y no en el resto; un mob anti-mágico recibe el daño reducido de verdad; el mutante da ×3.
- D: simulación en un pit: el mago en área obtiene ≤ 1,6× la exp por hora del guerrero.
- G: un mapa con 60 mobs y mutantes con p95 del tick estable.
- E: pasar 15 minutos en un pit con cada clase y anotar si se siente repetitivo.
**Listo cuando:** la ventaja del área está acotada y los pits tienen variedad.

---

## FASE 2 — Grupo y mazmorras

### 2.1 Cerrar la party (M)
**Hacer:** invitar con clic derecho, compañeros en el minimapa, **volver a la misma instancia al reconectar** (guardar el id de la instancia en la sesión mientras dure la gracia de 2 minutos), exp por daño (un tercio al morir, dos tercios durante la pelea) para evitar el robo de kills.
**Pruebas:**
- B: reconectar dentro de la gracia vuelve a la misma instancia; pasada la gracia, al punto de descanso; si la party se disuelve con gente adentro, cada uno queda en una instancia propia; un compañero que llega tarde entra a la misma.
- B: la exp por daño reparte bien entre dos atacantes y no se puede robar con el último golpe.
- E (checklist con 2 jugadores reales): invitar, aceptar, entrar al mismo dungeon, matar un jefe, ver que cada uno recibe su ítem, desconectar a uno y reconectar, salir y volver.
**Listo cuando:** la checklist con 2 personas reales pasa sin errores.

### 2.2 Instancias de mazmorra bajo carga (S)
**Hacer:** prueba de memoria y de carga de las instancias que ya existen.
**Pruebas:**
- B: crear 50 instancias vacías y comprobar que se dan de baja a los 5 minutos y que el mundo compartido no se toca.
- G: 20 instancias con mobs activos y p95 del tick estable.
**Listo cuando:** no hay fugas y el tiempo del tick queda dentro del presupuesto.

### 2.3 Jefes de mazmorra (L)
**Hacer:** dos habilidades por jefe (la actual y una de área o invocación), vida ~11× la curva, premio de un ítem propio por compañero cercano.
**Pruebas:**
- D: simulación de grupo: un guerrero solo pierde; 3-4 jugadores ganan en 2-3 minutos.
- B: el drop del jefe llega una vez por compañero cercano y nunca se duplica; un compañero lejos o muerto no cobra.
- E: pelear cada jefe con un grupo real y anotar si las habilidades se pueden esquivar o resolver.
**Listo cuando:** cada jefe tiene su rango de tiempo de pelea y no hay forma de repetir el premio.

### 2.4 Llaves y dificultades (M)
**Hacer:** receta de la llave (materiales de pit + oro), dificultades normal y difícil con mejor botín.
**Pruebas:**
- B: sin llave no se entra; la llave se descuenta una vez por jugador; dos pedidos de portal a la vez no la descuentan dos veces.
- A: el costo en kills de la llave (para que sea el límite natural de farmeo).
- E: conseguir una llave desde cero con un personaje y medir cuánto tarda.
**Listo cuando:** repetir un dungeon sin parar no es posible sin farmear.

### 2.5 Versión en solitario de D1 y D2 (M)
**Pruebas:** B de que un jugador sin party entra a su instancia propia con mobs más livianos; D de que un jugador de su nivel la completa en un tiempo razonable.

---

## FASE 3 — Ítems y economía (a 40 niveles)

### 3.1 Poder de los ítems por nivel y bandas (M)
**Hacer:** pasar de bandas de 2 niveles con tope 6 a 8 bandas de 5 niveles; el poder del ítem sale del nivel de ítem (arma ≈ `6 + 1,05·L`); teñir el aspecto por banda.
**Pruebas:**
- A: el arma aporta entre 22 y 27 % del daño por golpe en los niveles 6, 12, 20, 30 y 40; la defensa mitiga entre 30 y 55 %.
- B: un bicho solo suelta ítems de su banda o la anterior.
- E: ver en pantalla que se nota el cambio de banda por el aspecto.

### 3.2 Tasas de drop, bolsa y basura (M)
**Hacer:** tasa de único (hoy 1,5 % en pit); sesgo por clase (60 % ítems de tu clase); sacar los ítems comunes del botín; subir la bolsa de 18 a ~30; botón de vender basura.
**Pruebas:**
- A/Monte Carlo: simular 100.000 kills y comprobar que las tasas quedan a ±10 % de lo diseñado, con la clase sesgada.
- B: bolsa llena sigue dejando el ítem en el suelo; vender basura no vende ítems únicos ni mejorados.
- E: farmear 30 minutos y ver cuántos ítems útiles caen y si se llena la bolsa.

### 3.3 Afijos en ítems comunes (M, si se decide)
**Pruebas:** A de que un afijo nunca se agrega con el encantado (solo sube); B de que los ítems únicos nunca salen con afijos; Monte Carlo de las tasas de cada afijo.

### 3.4 Mejoras +N (M)
**Hacer:** tope por banda, +6 a +11, piedra pura, pergamino de protección.
**Pruebas:**
- Extender `upgrade.test.ts`: costos y probabilidades con Monte Carlo (el éxito observado a ±3 % del diseñado con 20.000 intentos); el tope por banda; que el nivel de mejora se conserve al guardar en el depósito, subastar y comprar; que fallar baja un nivel solo cuando corresponde.
- H: pedir una mejora sin piedras, sin oro, sobre un ítem que no es tuyo o duplicando el pedido.

### 3.5 Oro, precios y sumideros (M)
**Hacer:** precios y costos escalados con el nivel; durabilidad y reparación; pociones.
**Pruebas:**
- D: simular 100 horas de un jugador: lo que entra de oro por hora contra lo que sale por sumideros queda en una proporción objetivo (p. ej. 60-80 % del ingreso se gasta).
- A: ningún precio ni costo desborda el entero seguro.
- B: el desgaste baja la durabilidad al recibir golpes; el ítem agotado se desequipa; la reparación cobra y restaura.

### 3.6 Runas (L)
**Pruebas:** A de la probabilidad de inserción y de la fusión de tres runas; B de que el fallo pierde la runa y no el ítem, de que sacar una runa la destruye y de que la runa de experiencia está topeada.

### 3.7 Intercambio directo y subasta extendida (M-L)
**Hacer:** ventana de intercambio (hasta 8 ítems por lado, ambos confirman, cualquier cambio quita las confirmaciones); ítems frágiles y ligados; correo; subasta de 1 a 3 días.
**Pruebas (las más delicadas):**
- B: el intercambio es atómico: o pasa todo o no pasa nada; **un ítem nunca está en dos lugares**.
- B: desconectar a mitad, bolsa llena de uno de los dos, cambiar una oferta después de confirmar, intentar intercambiar un ítem ligado o frágil.
- F: caída del server entre dos pasos del intercambio no duplica ni pierde ítems.
- H: pedidos con ítems ajenos, repetidos o con cantidad negativa.

### 3.8 Crafteo mínimo (M)
**Pruebas:** B de validación atómica (se consumen los materiales y se entrega el resultado, o nada); A de las recetas.

### 3.9 Puntos al llegar al 40 y ángel (M)
**Pruebas:** A del costo de cada punto (~15 minutos de veterano); B de que la exp del 40 se convierte en puntos sin pérdida de sobrante; B de las mejoras del ángel (sin tirada de fallo, no se saltan niveles); H del pedido de comprar sin puntos.

---

## FASE 4 — Contenido para llegar a 40

### 4.1 Estirar los mapas (M)
**Hacer:** rangos de nivel con mínimo y sin máximo; pits que cubren varios niveles.
**Pruebas:** `validateMapGraph()` sin errores; la prueba de mapas (`flare.test.ts`) en verde; el hash del mapa es el mismo en cliente y server; recorrido del cliente por todos los mapas sin errores de consola.

### 4.2 Mapas nuevos y mazmorras D7+ (L)
**Hacer:** 10 mapas de la reserva de Flare y 4 a 6 mazmorras con jefes.
**Pruebas:** las mismas del paso 4.1 por cada mapa, más: portales con requisito de nivel, instancias de mazmorra (paso 2.2), y una prueba automática de navegador (Playwright) que recorra los mapas.

---

## FASE 5 — PvP y arenas

### 5.1 Concepto de equipo y reglas de PvP (M)
**Pruebas:** B de que dos jugadores de la misma facción pueden ser rivales en arena; que el recall se bloquea 10 s después de recibir un golpe de jugador; el daño por la espalda (si se adopta).

### 5.2 Cola 2v2, Glicko-2 y temporadas (L)
**Pruebas:**
- A: Glicko-2 contra valores de referencia conocidos; el rating tras 10 partidas; el reinicio de temporada hacia el centro.
- B: cola con parejas exactas; emparejamiento por bandas; la invitación vence a los 30 s y devuelve a los otros a la cola en su lugar; no se puede aceptar en combate.
- B: reglas de la arena (sin consumibles, curación −20 % cada 3 minutos, 3 invisibilidades), desconexión con 60 s de gracia, empate a los 15 minutos, volver al punto de entrada.
- E: 10 partidas reales de dos parejas, probando todas las arenas.

### 5.3 Duelos 1v1 con apuesta (M)
**Pruebas (críticas):** B de que la apuesta sale de las dos bolsas en el mismo momento y vuelve completa en un empate o si el server se cae; el ganador cobra el pozo menos 5 %; no se puede apostar más oro del que se tiene; un jugador que se desconecta pierde.

---

## FASE 6 — Pulido y beta cerrada

### 6.1 Tutorial y primeros 10 minutos (M)
**Pruebas:** E con 3 personas que nunca jugaron; medir cuántos terminan el tutorial y el nivel 5.

### 6.2 Música y ambiente, chat por canales, partir `main.ts` (L)
**Pruebas:** G de la carga inicial del cliente (hoy ~12 MB de sprites; objetivo cargar por mapa); B de que el chat de cada canal no se filtra a otros.

### 6.3 Prueba de carga y beta (M)
**Pruebas:** G con 50 a 100 bots por 30 minutos (tick, memoria, reconexiones); recorrido completo de un jugador nuevo con un script de navegador (crear cuenta, elegir nación, nivel 5, party, dungeon, drop, mejora, subasta, arena).
**Medir en la beta:** tiempo hasta el nivel 10 y hasta el 40, abandono en los niveles 1 a 3, muertes por hora, ítems por hora, oro por hora, cuánto dura una cola de arena.

---

## Después de la beta
World map y wiki; Nv13+ con más mapas; clanes y amigos; guerra de naciones; rebirth; exp de descanso; housing.

## Recorrido de regresión (se corre antes de cada versión)
1. `pnpm test` y typecheck.
2. `test-economy.ts` y `test-combat.ts` contra un server limpio.
3. Dos jugadores: party, mazmorra, jefe, drop para cada uno, reconexión.
4. Reiniciar el server y comprobar que nada se perdió.
5. Mirar `FDN_TICK_STATS` durante todo el recorrido.
