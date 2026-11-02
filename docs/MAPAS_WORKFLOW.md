# Workflow de mapas en Tiled

Reglas para armar mapas nuevos a mano en Tiled. Para los mapas portados de Flare ver `MAPAS_FLARE.md`.

## 1. Tileset

- Solo Flare, o Flare + **un** pack que matchee su paleta.
- No mezclar packs de estilos distintos en un mismo mapa.
- Tile 96x48 (el arte de Flare ya escalado a 0,5, ver `MAPAS_FLARE.md`).

## 2. Tamaño

- **40×40 tiles** para el MVP.

## 3. Capas

| # | Capa | Tipo | Uso |
|---|------|------|-----|
| 0 | `ground` | tile layer | Piso. Pintar con la **Terrain tool**, no tile por tile. |
| 1 | `decoracion` | tile layer | Árboles, rocas, ruinas, detalles. Es el 80% del look. |
| 2 | `colision` | object layer | Áreas bloqueadas. |
| 3 | `objetos` | object layer | Spawns, triggers y POIs. |

## 4. Stamps

- Armar chunks de **10×10 o 15×15**: claro, bosque, ruina, camino.
- Guardarlos como stamps de Tiled y reutilizarlos entre mapas.

## 5. Checklist de diseño

Cada mapa debe tener:

- [ ] **Silueta reconocible**: la forma se lee en el minimapa.
- [ ] **Choke point**: al menos un paso angosto que obligue a pelear o rodear.
- [ ] **Punto de interés**: un lugar al que el jugador quiera ir.

## 6. Exportar

- Exportar el mapa de Tiled como JSON y convertirlo a TS con el nuevo converter (`pnpm maps:tiled <archivo.json>`), que escribe `packages/world/src/<id>.ts` en el mismo formato que `flare:maps` produce.
- El cliente y el server ya leen ese formato, no hay que tocar el loader.

---

**Nota:** El reader de `.amd` (`apps/server/src/map.ts:61`, `loadOccupancy`) es código muerto y se puede eliminar; no se usa en el pipeline actual.
