# Roadmap de mapas: dónde estamos

Documento vivo para no perder el hilo. Última actualización: 4/11/2026. El detalle técnico está en `MAPAS_FLARE.md` (importador, relleno, licencias) y en `TIERS_DE_ZONA.md` (tiers, niveles y jefes).

## 1. El mundo hoy

Se entra por la **Villa de Solmar** o por la **Ciudadela de Vhar**. El **Portal de Frontera** de cada ciudad lleva a la entrada de los 17 mapas abiertos, que se abren por nivel, y los portones de las dos ciudades salen a los Campos de Sal. Para volver está la tecla H. Todos los mapas de caza son de Flare (CC-BY-SA).

| Tier | Niveles | Mapas abiertos (niveles) | Mazmorra de grupo (2 pisos) | Entrada (nivel de la puerta, llave) |
|---|---|---|---|---|
| T1 | 1-5 | Campos de Sal 1-2 (uno por nación) · Bosque de Piedra 2-3 · Cañón goblin 3-5 | D1 Cueva goblin / Minas goblin, Jefe goblin Nv5 | Cañón goblin (2) |
| T2 | 6-10 | Pantano de Merrimead 6-8 · Altas de Nazia 8-10 | D2 Nido de hormiga león / Ruinas de Stormrock, Reina Nv10 | Altas de Nazia (4) |
| T3 | 11-15 | Cementerio de Lochport 11-13 · Risco del Sur 13-15 | D3 Cripta olvidada / Sepulcro profundo, Caballero Nv15 | Cementerio (9) |
| T4 | 16-20 | La Brecha 16-18 · Paso de Stormrock 18-20 | D4 Torre del hechicero / Cámaras, Mago mayor Nv20 | La Brecha (14) |
| T5 | 21-25 | Cenizas I 21-23 · Cenizas II 23-25 | D5 Templo de Mez / Salón de Mez, Wyvern del aire Nv25 | Cenizas II (19) |
| T6 | 26-30 | Cenizas III 26-28 · Granja de Roble Negro 28-30 | D6 Fortaleza infernal / Foso del demonio, Señor del Foso Nv30 | Cenizas III (24) |
| T7 | 31-40 | Oasis de Ceniza 31-33 · Lago Kuuma 33-35 · Laguna de la Gruta 35-37 · Minas abandonadas 38-40 | **D7 Fuerte Amir / Cámaras de tortura, Gran Verdugo Nv40** | Lago Kuuma (29, llave del Fuerte Amir) |

Cadena a pie: Campos de Sal (el de Solmar o el de Vhar, se juntan acá) → Bosque de Piedra → Cañón goblin → Pantano → (Altas de Nazia | Cementerio → Risco del Sur → La Brecha) → Paso de Stormrock → Cenizas I → II → III → Granja de Roble Negro → Oasis de Ceniza → Lago Kuuma → Laguna de la Gruta → Minas abandonadas.

Aparte: las **arenas** 2v2 y 3v3 (claro plano de 34x34): sin portal, se entra por la cola y el Maestro de Arena de cada ciudad (`PARTY_Y_ARENAS.md`).

## 2. Hecho

- [x] 31 mapas de Flare importados al tamaño nativo (17 abiertos y 7 mazmorras de 2 pisos), con 3 pits por mapa más mobs sueltos (1-3/11).
- [x] Sin partes negras afuera: el vacío de los mapas de pasto y nieve se rellena con bosque o nieve, y el agua es la de Flare teñida (2/11).
- [x] Cuevas y mazmorras: el vacío se funde a oscuridad en tres bandas, sin trozos de pared sueltos (antes parecían columnas sobre una losa) (3/11).
- [x] Tiers T1-T7 (paso 1.5): un tier por mapa, niveles de los pits automáticos, jefes en el tope de su tier, banda de ítems por tier y validador con tests (2/11).
- [x] Mapas abiertos más amplios para PvP: se sacaron ~3 de cada 4 obstáculos sueltos del medio (2/11).
- [x] Afuera los mapas de caza viejos. Tierras de Solmar quedó sin entrada, como mapa de pruebas (2/11).
- [x] Portal de Frontera con una zona por mapa abierto, de T1 a T7 (2-3/11).
- [x] T6 y T7 completos: Granja de Roble Negro (T6) y Minas abandonadas (T7) (3/11).
- [x] **D7** con el **Gran Verdugo** (motor de jefe, 4 ítems de jefe, llave, densidad) y el camino del aventurero hasta el 40 (3/11).
- [x] Mapa de la **arena** (3/11).
- [x] `maps:render`: vista de un mapa entero en PNG para revisar sin abrir el juego (2/11). Desde el 3/11 acepta `SIN=<edificios>` para omitir piezas y carga también los atlas de Flare.
- [x] **Ciudades rediseñadas e integradas** (Solmar 64×64 con costa y Vhar 58×58 nevada, arte propio, 393 tests ok); falta revisarlas en el juego (ver punto 4 de pendientes) (3/11).

## 3. Pendiente, en orden

1. **Probar los jefes en grupo**, D7 incluido: nadie probó el balance todavía.
2. **Recorrido de los tiers (prueba E).** Subir del 1 al 40 jugando o con un bot, para ver que cada tier tenga mobs suficientes y que no te pases de nivel antes de salir de él.
3. **Arenas: probarlas jugando.** La cola, el emparejador, la partida y el puntaje ya están en `main` (4/11); falta jugarlas de verdad (`PARTY_Y_ARENAS.md`).
4. **Rediseño de las ciudades (entra al MVP).** Solmar y Vhar de cero: arte propio renderizado en Blender y mapas de 58×58 (Solmar 64×64 por el mar; antes 128×128) con una sola planta para las dos. Antes tenían 62 y 100 edificios y solo 8 por ciudad hacían algo; ahora son 8 con función, 3 casas, muralla con 4 torres, portón y 2 fuentes. Solmar recupera la costa con muelle y Vhar pasa de lava a nieve. Detalle en `CIUDADES.md`.
   - [x] C1 cámara y ancla verificadas; C2 piloto; C3 render por lotes; C4 los 17 sprites por ciudad; C5-C6 los dos mapas integrados (puertas, interiores y NPC intactos; 393 tests ok) (3/11).
   - [x] Salidas a los primeros niveles: cada ciudad tiene el portón a pie hacia el Campos de Sal de su nación (nivel 1-2) y el portal de la plaza como atajo; lo vigila `salidas.test.ts`. **Regla para todo mapa nuevo de inicio** (Román, 3/11).
   - [x] **Primeros niveles lejos y por nación** (Román, 3/11): `campos_de_sal` (Solmar) y `campos_de_sal_vhar` (Vhar), unidos en el Bosque de Piedra; el atajo de la plaza y el Portal de Frontera a ese campo se abren después de llegar a pie una vez; cada nación entra solo a su campo (`CIUDADES.md` §8).
   - [ ] Falta el OK de Román mirando el juego (no solo `maps:render`), pulir los sprites (ver `CIUDADES.md` §5.1) y C8: borrar las fachadas viejas `sm_*`/`vh_*` y su código en `town.ts`/`atlas.ts`.
4b. **Mapas de PvP abiertos y planos (Román, 4/11).** Los 14 mapas de caza con PvP revisados uno por uno con Román y aprobados: sin agua ni paredes que traben, árboles solo en el borde, zonas de caza en lugares despejados, cuevas ensanchadas con variedad de piezas. Detalle en `MAPAS_FLARE.md` («PvP más plano»). **Ya en `main`** (4/11, `f33477e`, CI en verde; en el merge con las arenas los maestros de arena `arenero_s`/`arenero_v` quedaron en la plaza de cada ciudad, celda 33,35).
   - [ ] Confirmar que el deploy a prod tomó `main` (el 4/11 no se veían los cambios; ver con quien administra el hosting) y que las cuentas viejas aparecen bien en las ciudades nuevas.
   - [ ] Falta verlos corriendo en el juego (no solo `maps:render`), sobre todo Paso de Stormrock y Lago Kuuma con las piedras y estructuras nuevas de la nieve.
   - [ ] Las zonas de caza quedaron menos en los mapas de pasto (Cañón Goblin pasó de ~23 a 13): repasar la densidad de mobs jugando.
5. **Auditoría de NPC de las ciudades.** Hay 38 (19 por ciudad) y nadie revisó que estén bien configurados. Resultado de la primera pasada en `CIUDADES.md` §7; falta: un test que cuide que cada ciudad tenga los 8 roles con servicio, decidir qué hacen la sanadora y el mago (hoy solo hablan), y sumar los NPC que faltan (teletransporte, quests extra). El maestro de arena ya está (`arenero_s`/`arenero_v`, en la plaza de cada ciudad desde el 4/11).
6. **Mini-cuevas de mini-jefe** (opcional, de `MUNDO.md`): `mog_caverns`, `nazia_underground`, `nazia_mines` y `blackmire_mines`.
7. **Borrar Tierras de Solmar del todo**: hay que migrar los tests del server que la usan de mundo genérico (~10 archivos). Ojo: el mapa viejo comparte ids de NPC con las ciudades nuevas (ver punto 5).
8. **Pulido de mapas.**
   - Pasos de 1 celda en algunos mapas (el Bosque de Piedra tiene ~150).
   - Props con colisión propia en vez de por celda.
   - Revisar a ojo cada mapa en el juego (las cuevas nuevas, sobre todo).
9. **Arte en HD**: usar la escala 1,0 de Flare en vez de 0,5 (`PENDIENTES_Y_HUECOS.md`). Las ciudades no hay que rehacerlas: se regeneran en HD con el mismo script (ver `CIUDADES.md` §6).
10. **Música por mapa** y licencias de los audios.
11. **Después de la beta**: el mapa del mundo y la wiki.

## 4. Cómo se agrega un mapa

1. `pnpm assets:flare` (una vez) baja Flare a `reference/flare-game`.
2. Sumá la spec en `tools/src/flare/maps.ts`, con `tier`, `lvl` (sub-rango del tier), 3 pits, sueltos y conexiones `extras`. Si Flare tiene puertas o rejas que se abren con eventos, `openMods: true`; si el mapa ya importado tiene un vínculo de Flare hacia el nuevo que no querés, `dropLinks` en ese mapa.
3. Corré `pnpm --filter @fdn/tools flare:maps <id>` y después `flare:mapatlas`.
4. Importalo en `packages/world/src/flare/index.ts` (`FLARE_DATA`) y, si es abierto, sumalo a `TRAINING` (`training.ts`).
5. Revisalo con `pnpm --filter @fdn/tools maps:render <id-eris>`. Los tests (`tiers.test.ts`, `recall.test.ts`, el validador del grafo) dicen si algo no cierra.
