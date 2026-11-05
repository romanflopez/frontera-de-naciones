# ERIS (frontera-de-naciones) — instrucciones para agentes

Leé esto entero antes de tocar nada.

## Qué es
MMO 2D isométrico en TypeScript (server autoritativo + cliente web). Monorepo pnpm: `apps/server`, `apps/client`, `apps/desktop`, `packages/world` (reglas compartidas), `packages/proto` (protobuf), `tools` (sims, generadores).

## Dónde está la verdad
1. **`docs/DISEÑO.md`** — qué ES el juego. Es ley. Si lo que te piden lo contradice, no lo resolvés solo: lo anotás en `docs/DUDAS.md` (una línea: qué, dónde, qué opciones ves) y seguís con lo que no depende de eso.
2. **`docs/PLAN_DE_TRABAJO.md`** — los pasos, con sus pruebas. **`docs/COLA.md`** — el orden en que se hacen y qué prueba Román después de cada uno. Tu tarea es un paso (D.x, o un número de fase). Un paso = una rama = un PR. No hacés nada fuera de tu paso.
3. **`docs/REVISION_PANTALLAS.md`** — bugs y ajustes de UI anotados pantalla por pantalla, con causa probable.
4. El resto de `docs/` son notas de implementación: pueden estar desactualizadas. Cuando terminás un paso, actualizás el doc del tema y `docs/ESTADO_DE_PASOS.md`.

## Reglas fijas
- **El server decide todo** (oro, ítems, stats, daño, exp, drops). El cliente pide y dibuja. Nada de reglas de juego en `apps/client`.
- **Tests en verde o no se mergea**: `pnpm test` y typecheck de los 5 paquetes. Cuando tocás combate o progresión, corrés `sim:pvp` / `sim:pve` y no pueden empeorar: la cantidad de resultados fuera de objetivo no sube respecto de `main` y el PR muestra el antes y el después (hoy salen en rojo; el balance se arregla en el paso D.20). Todo paso trae sus tests (ver tipos A-H en `PLAN_DE_TRABAJO.md` §0).
- **Protocolo**: tags nuevos siempre al final de `packages/proto/network.proto`; nunca renumerar.
- **Datos guardados**: todo cambio lleva migración (`ECON_VERSION` + `migrateEcon`) y su test F.
- Las curvas, tablas de drop y probabilidades viven **solo en el server**; el cliente no las conoce.
- Nombres de clase: `paladin`, `clerigo`, `mago`, `arquero` (después del paso D.0). Stats: `str`, `vit`, `dex`, `mag` (después de D.3).
- No commiteás ni pusheás a `main`; trabajás en tu rama y dejás el PR. No borrás archivos sin que el paso lo pida.
- Español rioplatense en docs, comentarios y textos del juego.

## Cómo cerrar un paso
Rama `paso/D.x-nombre` → cambios + tests → `pnpm test` y typecheck en verde → actualizar el doc del tema + `ESTADO_DE_PASOS.md` → PR con: qué se hizo, qué se probó, qué quedó en `DUDAS.md`.
