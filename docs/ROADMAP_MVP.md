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

## 6. Orden recomendado

1. Fase 0 en paralelo (legal y CI) porque es lo único que puede frenar la beta.
2. Fase 1 (cerrar party, probar con 2 jugadores, jefes y balance).
3. Fase 2 (ítems únicos T4-T6, +6..+11, llaves, runas).
4. Fase 3 (arenas).
5. Fase 4 (pulido) y beta cerrada con tu amigo y gente cercana.

Fuentes de las referencias: ficha de Dreadmyst en Steam y notas de lanzamiento (clases, dungeons por llave y dificultad, arenas 1v1/2v2, tope de nivel 25), y notas de prensa sobre Apogea (MMO isométrico estilo Tibia, sin pay2win, housing, crítica a inventario y comercio tediosos). Helbreath: tus notas del proyecto y mi conocimiento del juego.
