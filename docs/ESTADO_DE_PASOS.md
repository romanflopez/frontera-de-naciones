# Estado de los pasos del plan

Se actualiza a medida que se cierra cada paso de `PLAN_DE_TRABAJO.md`. Última actualización: 1/11/2026 (paso 1.4).

| Paso | Estado | Detalle |
|---|---|---|
| 0.1 CI mínimo | **Hecho** | Corre en cada push y pull request: tipos de los 5 paquetes, tests del server y build del cliente (~1 min). Se comprobó que queda verde en `main` y rojo con un test roto. Falta (en GitHub): exigir el chequeo en Settings → Branches |
| 0.2 Legal y catálogos | Pendiente | |
| 0.3 Deploy de prueba | Pendiente | |
| **1.1 Techo 40 y curva de nivel** | **Implementado** (faltan la simulación y la prueba manual) | Ver abajo |
| **1.2 Puntos de stats** | **Implementado** (falta la prueba de balance con el script de combate) | Ver abajo |
| **1.3 Atributos autoritativos y topes** | **Implementado** (faltan crítico con cargas, topes de absorción y la prueba manual) | Ver abajo |
| **1.4 Daño en área y habilidades de mobs** | **Implementado** (falta la simulación D del área y la prueba manual) | Ver abajo |
| **1.5 Tiers de zona** (paso nuevo) | Diseñado, pendiente | `TIERS_DE_ZONA.md`: cada mapa lleva un tier y de ahí salen los niveles de los mobs y la banda de ítems; con los 12 mapas actuales alcanza hasta el T6 |

## Paso 1.1: qué quedó

**Valores finales**
- Nivel máximo **40** (`MAX_LEVEL` en `packages/world/src/mobs.ts`; `MAX_LVL` del server pasa a valer lo mismo).
- Kills para subir con un mob común de tu nivel: `killsToLevel(l) = round(l · (11 + 0,1·l))`. Da 11 en el nivel 1, 58 en el 5, 120 en el 10, 260 en el 20, 420 en el 30 y 581 en el 39: **~10.600 en total hasta el 40** (antes 40·L, ~31.200).
- **Multiplicador de exp por nivel del jugador** (`levelExpMult`): 100 % en el nivel 1 y baja en línea recta hasta ~35 % en el 40. Lo aplica el server a la exp de cada mob. La exp que pide cada nivel ya lo incluye, por eso sigue creciendo de forma continua.
- **Regla de diferencia de nivel** (`levelGapMult`): un mob más de 5 niveles por encima del jugador paga menos (−10 % por nivel de más, mínimo 10 %); uno más de 20 niveles por debajo no paga nada. **Por ahora solo afecta a la exp**; para los drops queda en el paso 3.2.
- Exp que pide cada nivel (ejemplos): nivel 1 → 154, 5 → 3.356, 10 → 17.588, 20 → 86.598, 30 → 194.127, 40 → 289.780.
- La **exp de las misiones** se recalculó para pesar lo mismo que antes sobre la curva (la primera ~12 % del nivel 1, las del final ~3 %): 19, 32, 52, 71, 114, 141, 187, 250, 298 y 438.

**Migración de cuentas** (`ECON_VERSION` 2 → 3, función `migrateEcon`): al cargar una cuenta vieja se conserva la **fracción de progreso del nivel** (no se regalan ni se quitan niveles) y un nivel mayor a 40 se recorta a 40 con exp en cero. Se guarda ya migrada.

**Pruebas** (`apps/server/test/nivel.test.ts`, 11 tests): curvas crecientes y enteras de 1 a 40; total de kills dentro de rango; multiplicador monótono; regla de diferencia; simulación de matar mobs del propio nivel (goblin, zombie, esqueleto, wyvern) y comprobar que los kills para subir coinciden con la curva (±10 %); subida de varios niveles de una vez y respeto del tope; exp 0 de un mob muy inferior y reducida en zona muy alta; peso de las misiones; migración (fracción, tope y guardado). La suite completa del server queda en 151 verdes y 1 salteado.

**Lo que falta de este paso**
- **D, simulación:** extender `sim-arranque.ts` a 40 y confirmar que las horas por tramo caen dentro de ±25 % de la meta (0,9 / 6 / 24 / 60 h acumuladas del modelo de un mob por vez).
- **E, prueba manual:** guerrero y mago nuevos de 1 a 10 midiendo el tiempo real (meta: menos de una hora).

**Efecto que hay que saber.** Hoy no hay mapas con mobs por encima del nivel ~12 (llegan Fase 4). Con el multiplicador y la regla de diferencia, **a partir del nivel 12-15 subir se vuelve muy lento hasta que existan zonas de nivel alto**. Para probar niveles altos se usa el comando de GM `/gm nivel`.

## Paso 1.2: qué quedó

**Atributos** (`packages/world/src/stats.ts`, compartido cliente/server): Fuerza, Vitalidad, Destreza, Magia y Suerte, base 10 y tope 100 cada uno. Se arranca con 10 puntos libres y se ganan 3 por nivel (22 libres en el nivel 5 con `/gm nivel 5`).
- Fuerza: +2/3 de vida y +0,2 % de daño cuerpo a cuerpo por punto sobre la base.
- Vitalidad: +2,5 de vida por punto.
- Destreza: +0,5 de defensa por punto.
- Magia: +2 de maná y +0,3 % de daño mágico por punto.
- Suerte: +0,1 % a la probabilidad de drop por punto (afecta únicos, comunes y oro).
- Reset: gratis hasta el nivel 10, después `200 · nivel` de oro.

**Server (autoritativo):** `statAlloc` en `economy.ts` valida stat, puntos enteros ≥ 1, puntos libres, tope 100 y personaje vivo; usa `Economy.run()` (límite de frecuencia y snapshot). `ECON_VERSION` pasa a 4 y `migrateEcon` sanea los stats guardados. Mensaje nuevo `StatAllocRequest` (tag 700) y campos 20-25 en `InventoryState`. El PvP ya usa los stats (vida, maná, defensa y multiplicadores de daño en `pvpCombat.ts`).

**Cliente:** panel de atributos en la ventana de personaje (`+`, shift-click = +5, botón reset). Se corrigió un bug previo de `toggleChar` y la ventana pasa a 640 px de alto para que entre.

**Pruebas:** `apps/server/test/stats.test.ts` (13 tests: fórmulas, asignación, concurrencia, tope, muerto, protocolo, reset, Monte Carlo de Suerte, guardado anti-trampa, migraciones). Suite del server: 164 verdes y 1 salteado. Verificado además a mano en el navegador.

**Lo que falta:** correr `test-combat.ts` con distribuciones extremas (todo en Fuerza, todo en Vitalidad) y la prueba manual. El daño PvE sigue calculándose en el cliente (con tope en el server); pasa a ser autoritativo en el paso 1.3.

## Paso 1.3: qué quedó

**Hallazgo del spike:** el server solo topeaba el daño PvE con `120 + nivel × 20`; el crítico, la velocidad de ataque, el robo de vida y el veneno los decidía el cliente (`main.ts`). El PvP ya era autoritativo, así que el PvE pasó a usar el mismo camino.

**Cómo funciona ahora.** `MobHitRequest` lleva un campo nuevo `spell` (el hechizo o `ataque`) y el server **ignora** `dmg`, `crit` y `poison_secs`. Con el hechizo, el server:
- valida alcance, recarga (`PvpLimiter`) y **cobra el maná** (un hechizo desconocido o sin maná no pega);
- calcula el daño con `rollSpellDamage` (nivel, arma, Magia, multiplicadores de Fuerza/Magia y Furia);
- tira el **crítico** (solo el ataque básico, ×1,8), el **veneno** y el **robo de vida** (solo daño físico, sobre el daño que de verdad quitó) con los atributos del equipo que él guarda;
- limita el ritmo de `ataque` por la **velocidad de ataque** del equipo (`meleeGapMs`, 10 % de tolerancia). Esto vale también para el PvP, donde antes el ataque tenía solo 0,3 s de recarga.
- La parálisis dura lo que dice el hechizo (no lo que pide el cliente) y entra una vez por recarga.

**Topes** (`packages/world/src/stats.ts`): crítico total 35 % (5 % base + equipo), velocidad de ataque 40 %, robo de vida 15 %; se aplican sobre la **suma** del equipo. La ventana de personaje muestra los valores ya topeados.

**Cliente:** `damageMob` ahora solo pide el golpe con el id del hechizo; se sacó el cálculo de daño, crítico, robo de vida y veneno. Un hechizo que pega a un mob lo cobra el server, así que el cliente ya no reporta ese maná gastado (un área que no alcanza a nadie no gasta maná en el server). El torbellino quedó en la tabla de hechizos del server.

**Pruebas:** `apps/server/test/combate.test.ts` (17 tests): topes y suma de varios ítems; el cliente no impone daño, crítico ni veneno; hechizo inexistente, fuera de alcance, sin maná y en recarga; spam de ataque topeado con y sin +200 % de velocidad; proporción de crítico (35 % y 5 %) y ×1,8; robo de vida topeado; veneno; parálisis; rango de daño de la fórmula. Suite del server: 181 verdes y 1 salteado. `test-combat.ts` 17/17 y `test-economy.ts` 81/81 contra un server real (se ajustaron para pedir hechizos por id y pegar a un ritmo legal).

**Lo que falta**
- **Crítico con cargas recargables:** el plan lo menciona pero no define las reglas; hay que decidirlas antes de implementarlo.
- **Topes de absorción (60 % mágica, 80 % física por zona):** todavía no existe un atributo de absorción (hoy se mitiga con DF/RM de rendimiento decreciente); se hace cuando entre.
- **E, prueba manual:** equiparse un arma con velocidad y crítico y comparar lo que se ve con lo que registra el server.
- `live-arranque.ts` se adaptó al protocolo nuevo pero no se corrió.

## Paso 1.4: qué quedó

**Medición previa.** Se simularon los 596 pozos y zonas de los mapas actuales: al tirar de un bicho se suman en promedio **1,4 bichos** (66 % solo, 29 % de a 2, 4 % de a 3 y 0,7 % de 4 o más). O sea que las bandas de 4 a 8 vienen casi siempre de pegar en **área**, no de la cercanía natural; por eso se limita el área y **no** se pone tope a los que te siguen.

**Área (solo en el server).** Tope de objetivos por lanzamiento: Bola, Lluvia, Ventisca, Marejada, Pilar de luz y Sismo 5; Torbellino y Giro 4. Los objetivos van del más cercano al centro al más lejano y cada uno extra cobra **−12 % de daño (mínimo 50 %)**: 100, 88, 76, 64 y 52 %. Un mismo lanzamiento (ventana de 250 ms) no pasa del tope aunque el cliente repita los pedidos. Con 5 objetivos el área rinde 3,8 golpes. El Giro elige él mismo los más cercanos. El cliente manda ordenados por cercanía. **El área contra jugadores (PvP) no cambió.**

**Huida.** Un mob cobarde con ≤ 7 % de vida corre 5 s en dirección contraria a quien lo atacó (velocidad ×1,2), no se contagia ni vuelve a pelear, y después vuelve a casa y se cura. La chance depende del tipo (`fleeChance`): goblins 40-70 %, hormigas 50-70 %, wyverns y hechiceros 30 %, no huyen zombis, esqueletos guerreros ni jefes. Un mob **paralizado no huye**.

**Rasgos de mob** (`packages/world/src/mobTraits.ts`, se sortean al nacer y viajan en la foto de mobs, campo nuevo `traits`):
- **Mutante** (3 % en pozos y mazmorras): ×3 de exp, ×2 de chance de drop, +50 % de vida y +25 % de daño.
- **Habilidad** (10 %, una sola): **anti-físico** y **anti-mágico** (reciben la mitad de ese daño, ×1,5 de exp), **tóxico** (su golpe deja un sangrado de 3 ticks del 15 % del golpe, ×1,3) y **explosivo** (al morir pega 1,5× su daño medio a los jugadores a menos de 2,5 celdas, ×1,5).
- **Salvaje** (+25 % de exp): todos los mobs sueltos fuera de los pozos.
- Los jefes no llevan rasgos. El nombre en pantalla lleva el rasgo adelante ("Mutante Goblin lancero") y la barra de vida usa la vida real.

**Pruebas:** `apps/server/test/area-y-rasgos.test.ts` (18 tests): fórmula de caída con 1, 2, 3 y 6 objetivos; de 8 mobs solo 5 reciben daño y de forma decreciente; un cliente tramposo que repite no pasa del tope; la recarga habilita otro lanzamiento; un solo objetivo no tiene castigo; huida (sí / no con vida alta, no huyen valientes ni jefes ni paralizados, se aleja y termina); anti-físico y anti-mágico reducen a la mitad de verdad sin tocar el otro tipo; tóxico y explosivo; multiplicadores de exp y de botín (incluido el cálculo real del server); proporciones del sorteo (3 % y 10 %); **G:** 60 mobs con rasgos mantienen el p95 del tick del simulador por debajo de 10 ms. Suite del server: 199 verdes y 1 salteado; `test-combat.ts` 17/17 y `test-economy.ts` 81/81 contra un server real.

**Lo que falta**
- **D, simulación:** confirmar con `sim-arranque.ts` que el mago en área saca ≤ 1,6× la exp por hora del guerrero. Con un pozo medio (1,4 bichos por tirada) y el tope no debería pasarse, pero no se midió.
- **E, prueba manual:** 15 minutos en un pozo con cada clase para ver si se siente repetitivo, y el aspecto de los rasgos (hoy solo el nombre; una marca visual queda para el arte HD).
- El tóxico y el explosivo no tienen animación propia todavía.
