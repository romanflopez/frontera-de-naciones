# Roadmap de mapas: dónde estamos

Documento vivo para no perder el hilo. Última actualización: 2/11/2026. El detalle técnico está en `MAPAS_FLARE.md` (importador, relleno, licencias) y en `TIERS_DE_ZONA.md` (tiers, niveles y jefes).

## 1. El mundo hoy

Se entra por la **Villa de Solmar** o por la **Ciudadela de Vhar**. El **Portal de Frontera** de cada ciudad lleva a la entrada de los 15 mapas abiertos, que se abren por nivel, y los portones de las dos ciudades salen a los Campos de Sal. Para volver está la tecla H. Todos los mapas de caza son de Flare (CC-BY-SA).

| Tier | Niveles | Mapas abiertos (niveles) | Mazmorra de grupo (2 pisos) | Entrada de la mazmorra (nivel de la puerta) |
|---|---|---|---|---|
| T1 | 1-5 | Campos de Sal 1-2 · Bosque de Piedra 2-3 · Cañón goblin 3-5 | D1 Cueva goblin / Minas goblin, Jefe goblin Nv5 | Cañón goblin (2) |
| T2 | 6-10 | Pantano de Merrimead 6-8 · Altas de Nazia 8-10 | D2 Nido de hormiga león / Ruinas de Stormrock, Reina Nv10 | Altas de Nazia (4) |
| T3 | 11-15 | Cementerio de Lochport 11-13 · Risco del Sur 13-15 | D3 Cripta olvidada / Sepulcro profundo, Caballero Nv15 | Cementerio (9) |
| T4 | 16-20 | La Brecha 16-18 · Paso de Stormrock 18-20 | D4 Torre del hechicero / Cámaras, Mago mayor Nv20 | La Brecha (14) |
| T5 | 21-25 | Cenizas I 21-23 · Cenizas II 23-25 | D5 Templo de Mez / Salón de Mez, Wyvern del aire Nv25 | Cenizas II (19) |
| T6 | 26-30 | Cenizas III 26-30 | D6 Fortaleza infernal / Foso del demonio, Señor del Foso Nv30 | Cenizas III (24) |
| T7 | 31-40 | Oasis de Ceniza 31-34 · Lago Kuuma 34-37 · Laguna de la Gruta 37-40 | **falta (D7)** | — |

Cadena a pie: Campos de Sal → Bosque de Piedra → Cañón goblin → Pantano → (Altas de Nazia | Cementerio → Risco del Sur → La Brecha) → Paso de Stormrock → Cenizas I → II → III → Oasis de Ceniza → Lago Kuuma → Laguna de la Gruta.

## 2. Hecho

- [x] 24 mapas de Flare importados al tamaño nativo, con 3 pits por mapa más mobs sueltos (1/11).
- [x] Sin partes negras: el vacío se rellena con bosque, roca o nieve; el agua es la de Flare teñida y las cuevas tienen piso de roca oscura (2/11).
- [x] Tiers T1-T7 (paso 1.5): un tier por mapa, niveles de los pits automáticos, jefes en el tope de su tier, banda de ítems por tier y validador con tests (2/11).
- [x] Cada mazmorra sale de un mapa de su tier (2/11).
- [x] Mapas abiertos más amplios para PvP: se sacaron ~3 de cada 4 obstáculos sueltos del medio (2/11).
- [x] Afuera los mapas de caza viejos (Llanos, Frontera, Camposanto, Páramo). Tierras de Solmar quedó sin entrada, como mapa de pruebas (2/11).
- [x] Portal de Frontera con una zona por mapa abierto, de T1 a T7 (2/11).
- [x] T7 con 3 mapas abiertos de la reserva de Flare (2/11).
- [x] `maps:render`: vista de un mapa entero en PNG para revisar sin abrir el juego (2/11).

## 3. Pendiente, en orden

1. **Jefes (lo próximo grande).** Mecánicas estilo Dreadmyst para los 6 jefes, ver los docs "mecanicas-de-jefe" y "mvp-dungeons-llaves-quests" del proyecto en claude.ai y `ROADMAP_MVP.md`. Hoy los jefes tienen una sola habilidad y vida ~11 veces la de un mob común. Al pasarlos de Nv 4-12 a Nv 5-30 los reescalé con las curvas, pero **nadie probó el balance**: hay que pelearlos en grupo.
2. **D7, la mazmorra del T7 (Nv 38-40).** Candidatos de Flare: `torture_chambers` (piso de mazmorra, 102x100, trae el jefe `vohn`) y `wizards_tower_3` o `temple_of_mez_3`. Necesita un jefe nuevo Nv 40, las armas legendarias del T7 y su entrada (puerta desde la Laguna de la Gruta, nivel 29).
3. **Recorrido de los tiers (prueba E).** Subir del 1 al 40 jugando o con un bot, para ver que cada tier tenga mobs suficientes y que no te pases de nivel antes de salir de él. Los mapas del T6 y del T7 son pocos para 5 y 10 niveles: puede hacer falta otro mapa por tier.
4. **Arenas 1v1 y 2v2.** Mapa chico, plano y casi sin obstáculos, aparte de los de caza (`PARTY_Y_ARENAS.md`).
5. **Mini-cuevas de mini-jefe** (opcional, de `MUNDO.md`): `mog_caverns`, `nazia_underground`, `nazia_mines` y `blackmire_mines`, una por zona.
6. **Borrar Tierras de Solmar del todo**: hay que migrar los tests del server que la usan de mundo genérico (~10 archivos).
7. **Pulido de mapas.**
   - Pasos de 1 celda en algunos mapas (el Bosque de Piedra tiene ~150).
   - Props con colisión propia en vez de por celda.
   - Revisar a ojo cada mapa con `maps:render` y en el juego.
8. **Arte en HD**: usar la escala 1,0 de Flare en vez de 0,5, como opción para pantallas grandes (`PENDIENTES_Y_HUECOS.md`).
9. **Música por mapa** y licencias de los audios.
10. **Después de la beta**: el mapa del mundo y la wiki.

## 4. Cómo se agrega un mapa

1. `pnpm assets:flare` (una vez) baja Flare a `reference/flare-game`.
2. Sumá la spec en `tools/src/flare/maps.ts`, con `tier`, `lvl` (sub-rango del tier), 3 pits, sueltos y conexiones `extras`.
3. Corré `pnpm --filter @fdn/tools flare:maps <id>` y después `flare:mapatlas`.
4. Importalo en `packages/world/src/flare/index.ts` (`FLARE_DATA`) y, si es abierto, sumalo a `TRAINING` (`training.ts`).
5. Revisalo con `pnpm --filter @fdn/tools maps:render <id-eris>`. Los tests (`tiers.test.ts`, `recall.test.ts`, el validador del grafo) dicen si algo no cierra.
