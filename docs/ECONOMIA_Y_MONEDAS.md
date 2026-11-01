# Economía, monedas y servicios de ciudad

Fecha: 1/11/2026. Junta la decisión de Román sobre las monedas pagas con lo que trae la página "City Hall & Services" de Helbreath Evolution. Complementa `ROADMAP_MVP.md` §9.6 y el paso 3.7 de `PLAN_DE_TRABAJO.md`.

## 1. Decisión de Román (1/11)

Las monedas pagas venden cosas que **aceleran el farmeo** y no poder de PvP. Lo importante es poder **seguir lo que entra al juego**: si después van cayendo ítems buenos, se rastrean y se corrigen.

## 2. Mi lectura: es "pagar por progresar", más suave que pay2win, pero no neutro

- Con la meta de ~30 h hasta el 40, el nivel dura poco y **el largo plazo es conseguir equipo**. Entonces "farmear más rápido" equivale a "tener equipo más rápido", que es poder en PvP. Por eso el límite de cuánto aceleran los ítems es lo que decide si es justo.
- En Helbreath Evolution el modelo es parecido pero más estricto: la tienda de monedas vende **servicios** (cambios de ciudad, de stats, de nombre, tinturas, apariencia, ticket para olvidar talentos y las "slates", unos consumibles de buffs) y, según su propia wiki, nada que cambie una pelea más que el equipo y los talentos. El poder temporal se compra con **fichas de evento**, que se ganan jugando.

### Qué se puede vender y con qué cuidado

| Tipo | Ejemplos | Riesgo |
|---|---|---|
| **Seguro** | Espacios de bolsa y depósito, vender basura automático, cambio de nombre / stats / nación, tinturas, apariencias y **auras** de armas, títulos, ticket de olvidar talento | Ninguno para el balance |
| **Aceleradores con tope** | Poción de exp o de oro: temporal (p. ej. 1 h), +25 a +50 %, no se acumula, no se vende entre jugadores | Moderado: solo afecta la velocidad de subir y de juntar oro |
| **Evitar** | Velocidad de movimiento o de ataque, más chance de drop de ítems, ítems de poder, pociones extra en combate, cualquier cosa que sirva dentro de la arena | Alto: es poder de PvP o equipo comprado |

### Guardas

1. Los aceleradores afectan **exp y oro, no la chance de drop de ítems** (o una chance mínima), para que no se pueda comprar equipo.
2. **No valen en la arena** (la arena normalizada del plan 5.1 ya los ignora).
3. Tienen **tope diario** y no se acumulan.
4. Todo lo que se vende se lista **públicamente** en el juego (qué da, cuánto y cuánto dura).
5. Nada de poder fijo: si alguna vez se vende un ítem, que sea **igual en poder** a uno que se consigue jugando, o frágil (dura días).

## 3. Cómo "tenerlo trackeado" (propuesta concreta)

- Cada ítem lleva un campo **origen**: bicho, jefe, tienda, monedas, evento, crafteo, subasta o intercambio. Hoy el ítem tiene `u`, `n`, `r`, `a` y `up`; se agrega `o`.
- **Registro de movimientos** (ya figuraba como pendiente en `ECONOMIA_SERVER.md`): quién recibió qué, de dónde, cuándo y por cuánto. Con eso se detecta duplicación, abuso y quién compra velocidad.
- Tablero de métricas: ítems por origen y por hora, oro que entra y sale, monedas gastadas por categoría, y los ítems de banda alta que aparecen en cuentas de bajo tiempo de juego (señal de compra de cuentas o de trampa).
- Probarlo en el paso 3.7 (atomicidad) y con el recorrido de regresión del plan.

## 4. Lo que trae la página para ERIS

### 4.1 Subasta (ya tenemos compra directa; falta sumar pujas)
| Regla de Evolution | Sugerencia para ERIS |
|---|---|
| El vendedor elige precio en monedas **o** en oro; todo lo del listado se mueve en esa moneda | Decidir si se aceptan monedas (ver sección 2) |
| Duración de 1, 2 o 3 días; tarifa de listado en oro **que no se devuelve**: 10.000 / 25.000 / 40.000 | Sumidero de oro; escalar con el nivel |
| Retirar una puja cuesta 5.000 de oro; cancelar se puede salvo en la última hora | Que una puja signifique algo |
| Máximo 20 listados activos por jugador; tope de 9.999 monedas o 9.999.999 de oro | Evita el spam |
| No se pueden listar ítems frágiles ni ligados, ni nada que venda una tienda tal cual | Coincide con el plan 3.7 |
| Pestañas con tus ventas, tus pujas y el historial de precios reales | Ayuda a fijar precios |

### 4.2 Correo
Cartas a cualquier personaje por nombre, hasta 20 ítems por carta, 100 de oro, nivel 20 mínimo, lo no reclamado vuelve al remitente a los 30 días, bandeja de 50 cartas. **Lo que sobra del botín (cuando la lista de drops se llena) llega por correo** en vez de perderse.

### 4.3 Depósito
Cada personaje tiene su bóveda (200 ítems en 10 páginas). Además hay un **banco compartido de la cuenta** (200 casillas y un pozo de oro que alcanzan todos los personajes); los ligados no entran. El clan tiene su depósito que crece por nivel (50 casillas por nivel, hasta 500). Hoy ERIS ya tiene depósito de cuenta (`DEPOSITO.md`); los pendientes son el correo y el depósito de clan.

### 4.4 Teletransporte
Por destino con precio: gratis a la zona de nivel medio, 100 a la isla, 250 a la arena 1, 500 a las zonas espejo de cada nación (nivel 20+), 2.500 al mapa final y a la mazmorra profunda. **Los criminales casi no pueden usarlo.** Sirve como sumidero chico y como "castigo" suave.

### 4.5 Rebirth y armas de fin de camino
- **Rebirth** (post-beta): al nivel máximo se reinicia con +3 stats permanentes; cuesta oro (200.000 por rebirth, hasta un millón) y 5 Majestics.
- **Armas oscuras:** al nivel máximo cada personaje recibe **una arma de cada tipo, gratis, una sola vez**, ligada a él. Se mejora hasta +5 con éxito garantizado pagando **solo Majestics**. Es la recompensa de terminar la subida. **Encaja con los puntos Majestic de ERIS y con las armas legendarias con aura.**

### 4.6 Recompensas por mérito y fichas
- **Ítems de héroe** (PvP de naciones): se compran con kills enemigos y contribución (100 kills y 10 de contribución el más barato); tienen bonus que solo valen en combate. Candidato para la guerra de naciones, post-beta.
- **Fichas de evento:** casi todas las misiones permiten **elegir fichas en vez de oro**; el sumo sacerdote tiene una **misión diaria** que paga fichas además del oro. La tienda de eventos vende piedras de mejora, reputación, el ticket de olvidar talento y **versiones frágiles de armas legendarias** ("poder real con vida corta": una semana de uso sin haberla visto caer).
- Para ERIS: misión diaria con fichas y tienda de fichas son la forma de dar un objetivo diario y de entregar piedras sin depender del azar.

### 4.7 Cambio de ciudad
Se rechaza (sin cobrar) si estás muerto, en una arena, en un mapa bloqueado o durante un evento de guerra; el maestro de un clan con miembros tiene que ceder el liderazgo primero. Al cambiar salís del clan y de la party, y las piezas de héroe se convierten en la misma pieza de la ciudad nueva. Útil cuando existan Solmar y Vhar con cambio de nación.

## 5. Escala para ERIS
Los números de oro de Evolution (tarifas de 10.000 a 40.000, rebirth de 200.000, tope de 9.999.999) son para un juego de 140 niveles. En ERIS, con nivel 40 y ~740 de oro por hora por nivel, hay que **escalarlos con el ingreso por hora** (ver `NIVEL_40_E_ITEMS.md` §5.8) y no copiarlos.

## 6. Cuándo
| Idea | Cuándo |
|---|---|
| Campo `origen` en los ítems y registro de movimientos | Con el paso 3.7 (o antes, en la Fase 0) |
| Pujas y tarifas de listado | Fase 2 |
| Correo (con el desborde de botín) | Fase 2 |
| Banco compartido de cuenta | Ya hecho en parte (`DEPOSITO.md`) |
| Misión diaria y tienda de fichas | Post-beta |
| Armas oscuras / legendarias gratis al nivel máximo | Junto con los puntos Majestic (3.9) |
| Tienda de monedas con servicios | Antes de abrir donaciones |
| Aceleradores de exp y oro | Solo después de definir los límites de §2 |
