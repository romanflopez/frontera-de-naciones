# Estado de los pasos del plan

Se actualiza a medida que se cierra cada paso de `PLAN_DE_TRABAJO.md`. Última actualización: 1/11/2026.

| Paso | Estado | Detalle |
|---|---|---|
| 0.1 CI mínimo | **Hecho** | Corre en cada push y pull request: tipos de los 5 paquetes, tests del server y build del cliente (~1 min). Se comprobó que queda verde en `main` y rojo con un test roto. Falta (en GitHub): exigir el chequeo en Settings → Branches |
| 0.2 Legal y catálogos | Pendiente | |
| 0.3 Deploy de prueba | Pendiente | |
| **1.1 Techo 40 y curva de nivel** | **Implementado** (faltan la simulación y la prueba manual) | Ver abajo |
| 1.2 Puntos de stats | Pendiente | |
| 1.3 Atributos autoritativos y topes | Pendiente | |
| 1.4 Daño en área y habilidades de mobs | Pendiente | |

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
