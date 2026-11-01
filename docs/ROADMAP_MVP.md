# Roadmap al MVP / beta de ERIS

Fecha: 1/11/2026. Es un diagnóstico de qué falta y en qué orden hacerlo, mirando tres referencias: **Helbreath** (lo que vos conocés y querés: PvP de naciones, ítems únicos, mejoras con riesgo), **Dreadmyst** (el loop "chill": limpiar mobs, mejorar equipo, hacer dungeons, arenas 1v1/2v2) y **Apogea** (MMO isométrico hardcore estilo Tibia, sin pay2win, con housing y UI configurable). Estado del juego sacado de los docs y del historial de `main`; si algo cambió y no está en los docs, corregilo.

## 1. Qué agarro de cada uno (y qué dejo)

| Juego | Me quedo con | Lo que evito |
|---|---|---|
| Helbreath | Naciones enfrentadas, ítem único bueno en vez de rarezas, mejora +N con riesgo real (Merien/Xelima), combate rápido y legible | Que no haya objetivo y de tanto farmear aburra (lo dijiste vos) |
| Dreadmyst | Dungeons por llave con dificultades (más dificultad = mejor botín), versión solo y versión de grupo, arenas 1v1/2v2 con ranking, builds fáciles de leer | Contenido escaso y endgame flaco (la queja número uno de sus jugadores); completar el set dependiendo de gemas carísimas que fallan |
| Apogea | Mundo duro con sentido de peligro, "no pay2win" como promesa de marca, housing y UI configurable como visión a futuro | Gestión de inventario y comercio tediosos (los marcan como lo peor); no es para el MVP |

Conclusión de diseño: ERIS tiene que ser **Dreadmyst en estructura (loop, dungeons, arenas) con alma de Helbreath (naciones, ítem único, +N)**, y cuidar lo que a los dos les falla: **endgame y un objetivo claro**.

## 2. Definición del MVP (la vara)

Un jugador nuevo puede: crear cuenta y elegir nación → subir del 1 al 12 por mapas abiertos → hacer los 6 dungeons en party con llaves que farmeó → equiparse con únicos, mejorarlos y ponerles runas → pelear en arenas 1v1 y 2v2 → todo persiste, corre en producción y no hay riesgo legal en el repo/assets. Con un objetivo visible en cada tramo.

Lo de los **cooldowns de dungeon**: tiene sentido y no hace falta un CD en tiempo si las llaves ya limitan. Condición: la llave tiene que costar farmeo real de ítems/materiales de los pits (no solo oro) y no ser comprable a granel en subasta sin un sumidero. Si después se ve farmeo infinito, se agrega un tope diario como parche, no como diseño base.

## 3. Estado actual por pilar

| Pilar | Estado | Lo que hay | Lo que falta |
|---|---|---|---|
| Mundo y mapas | Casi hecho | Mapas abiertos de Flare Nv1-11, 6 dungeons de 2 pisos con jefes, portales, mapas sin vacío negro | Nv12 abierto, dungeons D3-D6 con balance de grupo validado, reserva Nv13+ |
| Party e instancias | Hecho (server) | Party de 4, exp y botín propio por compañero, instancia por party | Invitar con clic derecho, minimapa, volver a la instancia al reconectar, probar con 2 jugadores reales |
| Ítems | A medias | Únicos T1-T3 + jefes D1-D3, tabla de drops por origen, mejora +1..+5 | Únicos T4-T6 y jefes D4-D6, +6..+11, runas, durabilidad |
| Economía | A medias | Server autoritativo, subasta de compra directa, depósito, llaves | Crafteo, pujas, sumideros (durabilidad, llaves), persistir el suelo |
| Combate y clases | A medias | Defensa física/mágica, parálisis, pociones con delay, arqueros que disparan | Balance de grupo y jefes con 2 habilidades, magos con proyectil propio, test de combate al día |
| PvP | Falta lo grande | Flag de PvP por mapa, facción contra facción | Arenas con cola 1v1/2v2, ranking, decisión de equipo real vs normalizado |
| Objetivo y progresión | Falta | Curva 1-12 | Una meta clara por tramo (ver 5.1) |
| Social | A medias | Party, chat de party | Chat por canal (mapa, global, facción), amigos, clanes (post-MVP) |
| Cliente y UI | A medias | HUD, minimapa, subasta, depósito, panel de party | `main.ts` de ~2.300 líneas por partir, música/ambiente por mapa, tutorial de entrada |
| Producción | Falta | Dockerfile, server y Postgres planeados | CI (no hay `.github`), deploy del cliente, monitoreo |
| Legal | Bloqueante | Auditoría hecha, `assets/raw` fuera de git | Catálogos con datos de Helbreath idénticos a la referencia, repo público, licencias de OpenGameArt por pieza |

## 4. Roadmap por fases

Tamaños: S = menos de un día, M = 1-3 días, L = más de 3.

### Fase 0 — Desbloquear la beta (hacer en paralelo, no da juego pero frena todo)
1. **Legal:** reemplazar los catálogos propios de `apps/server/data/catalog/*.json` (hoy idénticos a los de Helbreath) y limpiar nombres; anotar autor y licencia de cada pieza de OpenGameArt; decidir si el repo deja de ser público. (M-L)
2. **CI mínimo:** tests + typecheck en cada push a `main`. Lo dejaste para el final y está bien, pero tiene que estar antes de sumar a tu amigo. (S)
3. **Deploy de prueba** con Postgres para validar persistencia real. (M)

### Fase 1 — Cerrar el loop de grupo (lo que ya empezamos)
1. Party completa: invitar con clic derecho, compañeros en el minimapa, volver a la misma instancia al reconectar. (M)
2. **Prueba real con 2 jugadores** de exp, drops y puerta de dungeon (hoy solo hay tests). (S)
3. Jefes de dungeon con 2 habilidades y vida ~11× de la curva; balance con `test-combat.ts`. (L)
4. Dificultades de dungeon (normal/difícil) con mejor botín, como Dreadmyst: es la forma más barata de alargar el contenido sin mapas nuevos. (M)
5. Versión solo de al menos D1-D2 para quien no tiene party. (M)

### Fase 2 — Ítems y economía (el corazón del "chill loop")
0. **Pasar a nivel 40 antes de seguir con ítems:** `MAX_LVL` 40, nueva curva de kills por nivel, poder de ítems por nivel de ítem, 8 bandas de 5 niveles, topes de atributos, tasas de drop por banda (ver `NIVEL_40_E_ITEMS.md`). (M-L)
1. Únicos T4-T6 y ítems de los jefes D4-D6 (el arte se reutiliza, es sobre todo dato). (M)
2. Mejora +6..+11 con riesgo alto estilo Merien/Xelima, y piedras como sumidero. (M)
3. **Runas (sockets)**, con la regla tuya: completar el set no depende de nada carísimo que falle. (L)
4. Llaves: definir receta (materiales de pit + oro) y asegurar que el farmeo para generarlas sea el CD natural. (M)
5. Crafteo mínimo (llaves y piedras de forja) con validación atómica en el server. (M)
6. Durabilidad y reparación como sumidero de oro. (M)
7. Distribución de farmeo: tabla de qué mob suelta qué nivel de ítem (lo pediste para después de los mapas). (S)

### Fase 3 — PvP y arenas (Dreadmyst + Helbreath)
1. Decisión abierta: **¿equipo real o normalizado en arena?** Con +N y runas, el que más farmeó gana siempre; mi recomendación es dos colas: ranking normalizado y una "libre" con equipo real. (decisión)
2. Concepto de equipo en PvP (hoy solo hay facciones). (M)
3. Cola 1v1 y 2v2, ELO por modo, confirmación de 15 s, mapa de arena temporal. (L)
4. Después del beta: **guerra de naciones** al estilo Helbreath (control de ciudad/zona con recompensa), que es lo que le da sentido a elegir bando. (L)

### Fase 4 — Pulido de beta
1. Tutorial corto de arranque (Nv1-3 es donde más gente se va). (M)
2. Música y ambiente por mapa, banner de zona. (M)
3. Partir `main.ts` del cliente y cargar sprites por mapa (hoy ~12 MB al inicio). (L)
4. Chat por canales (mapa, global, facción). (M)
5. Borde de mapa y magos con proyectil propio. (S)

### Post-beta (decidido o a decidir)
- World map y wiki (ya lo dejaste para después de la beta).
- Nv13+ con la reserva de mapas de Flare.
- Clanes, amigos, ranking semanal.
- **Housing** y UI configurable al estilo Apogea: queda como visión, no entra al MVP.

## 5. Dos cosas que hay que decidir ya

### 5.1 El objetivo claro (el problema de Helbreath y la queja de Dreadmyst)
Cada tramo necesita algo que perseguir. Propuesta mínima: por cada banda T1-T6, **un set o único "de la nación" que se arma con drops de pit + jefe de dungeon + una mejora**; al terminar el T6 el objetivo pasa a ser +N alto, runas y ranking de arena. Así el farmeo siempre apunta a una pieza concreta, no a "subir porque sí".

### 5.2 Nivel máximo: 40 (decidido el 1/11/2026)
El techo pasa de 12 a **40**. Más mapas y más contenido, curva más amable hasta el 10 y más dura después, y el farmeo en área revisado. El análisis con números, la curva propuesta y los 7 problemas de ítems que hay que arreglar para que funcione a 40 niveles están en [`NIVEL_40_E_ITEMS.md`](NIVEL_40_E_ITEMS.md). Esto reemplaza la idea de dejar el 12 como techo.

**Meta de tiempo (2/11/2026):** que un veterano llegue al 40 en **~2 días a full (~30 h)**; ~60 h en el modelo de un bicho a la vez y ~95 h para alguien casual. El nivel dura poco y el largo plazo lo carga el equipo (set por nación, +N, runas, dificultades de dungeon, arenas) más lo que pase después del 40. Detalle y tabla en `NIVEL_40_E_ITEMS.md` §2.4.

## 6. Orden recomendado

1. Fase 0 en paralelo (legal y CI) porque es lo único que puede frenar la beta.
2. Fase 1 (cerrar party, probar con 2 jugadores, jefes y balance).
3. Fase 2 (ítems únicos T4-T6, +6..+11, llaves, runas).
4. Fase 3 (arenas).
5. Fase 4 (pulido) y beta cerrada con tu amigo y gente cercana.

## 7. Ideas candidatas (a leer y decidir: beta / Fase 1 / después)

Salen de las páginas de Helbreath que pasaste (mecánicas de mobs, personaje y exp, combate, economía y mapas). **Ninguna está decidida**: la columna "cuándo" es una sugerencia mía para discutir.

### Progresión
| Idea | De dónde | Para qué | Cuándo (sugerido) |
|---|---|---|---|
| Tabla de exp como ley de potencias (`T(L) ∝ L^2,35`, ×5,1 al duplicar el nivel) | Personaje | Curva predecible; con tope 40 | Fase 2, punto 0 |
| **Puntos tipo Majestic al tope**: la exp que entra al nivel 40 compra puntos de costo fijo (un stat, una runa extra, cosmético) | Personaje | Objetivo claro después del 40; la exp no se pierde | Beta si alcanza, si no Fase 2 |
| Regla de diferencia de nivel en la exp | Mobs | Frena el power-leveling en party | Fase 2 |
| Exp de descanso (acumulada al desconectarse) | Mobs | Casual y "chill" | Post-beta |
| Rebirth: reiniciar niveles conservando habilidades, con puntos extra | Personaje | Rejugabilidad de largo plazo | Post-beta |
| Stat de suerte (+0,175 % al multiplicador de drops por punto) | Personaje | Otra palanca de drops | Post-beta |
| Ángeles tutelares (pendientes que suman stats) | Personaje | Personalización | Descartado por ahora |

### Mobs
| Idea | De dónde | Para qué | Cuándo |
|---|---|---|---|
| Habilidades de mob que multiplican la exp (veneno ×1,3; anti-físico y anti-mágico ×1,5; explosivo ×1,5; etc.) | Mobs | Variedad en pits y freno al área sin penalizar | Fase 1-2 |
| Huida con poca vida (≤7 %, según "valentía" del mob) | Mobs | Vida en los pits, rompe el farmeo perfecto | Fase 1 |
| Mobs salvajes (+⅓ de exp) fuera de los pits y berserk (+75 %) | Mobs | Premia explorar, picos de exp | Fase 2 |
| **Exp por daño** (⅓ al morir, ⅔ repartido durante la pelea según el daño) | Mobs | Evita robo de kills; progreso más suave | Fase 2 |
| Bonus de party más alto: total ×min(1+0,2 por compañero extra, 4), en partes iguales (2 jugadores ×1,2; 4 jugadores ×1,6) | Mobs / Personaje | Incentivar grupos | **Hecho** (2/11) |

### Combate
| Idea | De dónde | Para qué | Cuándo |
|---|---|---|---|
| **Críticos con cargas recargables** (en vez de % pasivo) | Combate | Hoy el crítico lo calcula el cliente; con cargas lo controla el server | Fase 2, junto con topes de atributos |
| Tirada de acierto: ratio de ataque contra ratio de defensa, mínimo 15 % (jugador) / 7 % (mob) y tope 99 % | Combate | Que la defensa y la destreza tengan peso | Evaluar |
| Combos por arma (bonus al 2.º, 3.º y 4.º golpe seguido; se reinicia al fallar) | Combate | Identidad por tipo de arma | Post-beta |
| **Espalda**: si atacante y defensor miran al mismo lado, defensa ×0,5 | Combate | Posicionamiento en PvP y arenas | Fase 3 |
| Bloqueo de escudo según maestría y absorción por zona de armadura (pecho, piernas, casco), tope 80 % | Combate | Profundidad defensiva | Post-beta; el tope 80 % sí conviene ya |
| Aplastar (crush) y aturdimiento, con la suerte que los baja | Combate | Variedad de golpes | Post-beta |
| **Desgaste de equipo**: la armadura se gasta al recibir golpes (los críticos duplican); el agotado se desequipa | Combate | Durabilidad como sumidero de oro | Fase 2 |
| Hambre: con mucha hambre se recupera menos vida/maná/stamina | Combate | Sumidero de comida | Post-beta, opcional |
| Mobs con absorción propia y armas que la reducen (martillo, fuego) | Combate | Pareja natural de los mobs anti-físico/anti-mágico | Fase 2 |

### Economía
| Idea | De dónde | Para qué | Cuándo |
|---|---|---|---|
| **Intercambio directo entre jugadores**: hasta 8 ítems por lado, ambos confirman, cualquier cambio quita las confirmaciones y lo agregado después aparece como "Nuevo"; los ligados y los frágiles no se pueden intercambiar | Economía | Hoy solo hay subasta; es lo más seguro y lo que más se espera | Beta o Fase 2 |
| **Ítems frágiles**: duran N días y no se pueden comerciar | Economía | Premios de eventos sin inflar el mercado | Fase 2 |
| Tienda de eventos con fichas que dan las misiones de caza; se canjean por piedras de mejora y por ítems temporales | Economía | Objetivo diario, sumidero y entrada de materiales | Post-beta |
| Moneda de la tienda de pago que se puede retirar como ítem y comerciar | Economía | Decisión de monetización: tiene que cuadrar con "sin pay2win" | Decisión pendiente |
| Contribución a clanes (se dona del propio saldo al del clan) | Economía | Clanes | Post-beta |
| Pergaminos de reputación | Economía | Reputación entre naciones | Post-beta |

### Mapas y eventos
| Idea | De dónde | Para qué | Cuándo |
|---|---|---|---|
| **Mapas con nivel mínimo y sin máximo** (salvo la zona de principiantes, que se abandona al llegar a cierto nivel) | Mapas | Los mapas altos siguen sirviendo y se necesitan menos | Fase 1-2, es la forma de "abrir los mapas" |
| Zonas espejo por nación (mismo rango y mismo diseño, una para cada bando) | Mapas | Cada nación tiene su territorio | Cuando se armen los mapas nuevos |
| Pisos de mazmorra que piden el nivel máximo (Torre del Infierno exige nivel 140 desde el piso 3) | Mapas | Contenido de endgame a nivel 40 | Fase 2-3 |
| Eventos de nación con teletransporte que expulsa a todos al empezar y al terminar (Cruzada, Heldenian, Capturar la Reliquia desde nivel 40) | Mapas | Guerra de naciones | Post-beta |
| Zona de revivir y zona de principiantes | Mapas | Arranque y muertes más amables | Evaluar |
| Interiores de ciudad (depósito, herrero, municipalidad, sede del clan, tienda, iglesia) | Mapas | Ya tenemos depósito y herrero; falta el resto | Post-beta |
| Arenas numeradas (9 en el original) y una isla de PvP con acceso por NPC | Mapas | Pareja natural de las arenas con cola | Fase 3 |

Fuentes de las referencias: ficha de Dreadmyst en Steam y notas de lanzamiento (clases, dungeons por llave y dificultad, arenas 1v1/2v2, tope de nivel 25), y notas de prensa sobre Apogea (MMO isométrico estilo Tibia, sin pay2win, housing, crítica a inventario y comercio tediosos). Helbreath: tus notas del proyecto y mi conocimiento del juego.
