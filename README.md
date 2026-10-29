# Frontera de Naciones

MMO isométrico de naciones con PvP de control al estilo Helbreath. Nombre provisorio.

El código parte de [helbreath-base-game](https://github.com/ErkoKnoll/helbreath-base-game) (MIT), pero **no incluye ningún asset del Helbreath**: sprites, mapas, sonidos y música son propios o provisorios generados por código.

## Correrlo

Requisitos: [Node.js](https://nodejs.org) 22 o más nuevo y pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm dev
```

La primera vez, `pnpm dev` genera los assets provisorios (unos 25 segundos) y después abre el cliente en http://localhost:8080.
Por ahora llega hasta la pantalla de conexión: el server en TypeScript es la fase 1.

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `pnpm assets` | Vuelve a generar los assets provisorios |
| `pnpm proto` | Regenera el protocolo TypeScript desde `packages/proto/network.proto` |
| `pnpm build` | Build de producción del cliente |
| `pnpm typecheck` | Chequeo de tipos de todo el repo |

## Estructura

```
apps/client         Cliente: Phaser 3 + React + TypeScript
apps/server         Server en TypeScript (fase 1, todavía no existe)
packages/proto      Protocolo de red compartido (network.proto + código generado)
tools               Generador de assets provisorios y simulador de clientes
reference           Server original en C#, solo como guía para portarlo (se borra al terminar la fase 1)
```

## Plan

| Fase | Qué | Estado |
| --- | --- | --- |
| 0 | Base limpia: monorepo, sin assets del HB, assets provisorios | Hecha |
| 1 | Server en TypeScript con el mismo protocolo | Pendiente |
| 2 | Pipeline de arte: PNG → `.spr`, Tiled → `.amd`, script de Blender | Pendiente |
| 3 | Contenido del MVP | Pendiente |
| 4 | Naciones, loot random, upgrade +N, cuentas | En paralelo |

## Assets

Regla del proyecto: **nunca** se agregan archivos del Helbreath (ni `.pak`, ni `.spr`, ni mapas, ni sonidos), aunque estén modificados.
Los formatos `.spr` y `.amd` son solo contenedores: lo que va adentro es nuestro.

Los assets provisorios se generan en `apps/client/public/assets/` con `tools/src/placeholders/` y no se suben al repo.
Cuando haya arte definitivo, va a tener su propia carpeta versionada.

## Licencia

MIT. Incluye código de helbreath-base-game bajo su licencia MIT original (ver `LICENSE.base-game`).
