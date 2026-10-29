# Frontera de Naciones

MMO isométrico de naciones con PvP de control al estilo Helbreath. Nombre provisorio.

El código parte de [helbreath-base-game](https://github.com/ErkoKnoll/helbreath-base-game) (MIT), pero **no incluye ningún asset del Helbreath**: sprites, mapas, sonidos y música son propios o provisorios generados por código.

## Correrlo

Requisitos: [Node.js](https://nodejs.org) 22 o más nuevo y pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm dev
```

La primera vez, `pnpm dev` genera los assets provisorios (alrededor de un minuto). Después levanta el server en `ws://localhost:1337/ws` y el cliente en http://localhost:8080.
Para probar con dos personajes, abrí el cliente en dos ventanas (una normal y una de incógnito) y conectá con nombres distintos.

Lo que anda hoy: entrar al mundo Campamento, caminar y correr con el control del server (anti-speedhack incluido), ver a otros jugadores, chat global, reconexión dentro de 20 segundos y guardado del personaje al salir.

### Con el arte de Flare (recomendado)

```bash
pnpm assets:flare
```

Baja una vez el arte de [Flare](https://github.com/flareteam/flare-game) (unos 150 MB, necesita `git`) a `reference/flare-game/` y lo convierte al formato del motor: personajes, equipo, mobs, NPCs, pasto, árboles y objetos.
Sin esto el juego anda igual, pero con figuras provisorias dibujadas por código.

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `pnpm server` | Solo el server, con recarga al guardar cambios |
| `pnpm assets` | Vuelve a generar los assets provisorios |
| `pnpm proto` | Regenera el protocolo TypeScript desde `packages/proto/network.proto` |
| `pnpm build` | Build de producción del cliente |
| `pnpm typecheck` | Chequeo de tipos de todo el repo |

## Estructura

```
apps/client         Cliente: Phaser 3 + React + TypeScript
apps/server         Server autoritativo en TypeScript (Node + ws), mismo protocolo que el cliente
packages/proto      Protocolo de red compartido (network.proto + código generado)
tools               Generador de assets provisorios y simulador de clientes
reference           Server original en C#, solo como guía para portarlo (se borra al terminar la fase 1)
```

## Plan

| Fase | Qué | Estado |
| --- | --- | --- |
| 0 | Base limpia: monorepo, sin assets del HB, assets provisorios | Hecha |
| 1 | Server en TypeScript con el mismo protocolo | En curso: conexión, mapa, movimiento y visibilidad listos. Faltan mobs, combate, hechizos, ítems y teletransportes |
| 2 | Pipeline de arte: PNG → `.spr`, Tiled → `.amd`, script de Blender | Pendiente |
| 3 | Contenido del MVP | Pendiente |
| 4 | Naciones, loot random, upgrade +N, cuentas | En paralelo |

## Assets

Regla del proyecto: **nunca** se agregan archivos del Helbreath (ni `.pak`, ni `.spr`, ni mapas, ni sonidos), aunque estén modificados.
Los formatos `.spr` y `.amd` son solo contenedores: lo que va adentro es nuestro.

Los assets provisorios se generan en `apps/client/public/assets/` con `tools/src/placeholders/` y no se suben al repo.
Cuando haya arte definitivo, va a tener su propia carpeta versionada.

## Créditos del arte provisorio

El arte que genera `pnpm assets:flare` sale de Flare (Clint Bellanger y colaboradores, ver `reference/flare-game/CREDITS.txt`) bajo [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
Lo convertido también queda bajo CC-BY-SA 3.0. No está en este repo: se genera en cada máquina.

## Licencia

MIT. Incluye código de helbreath-base-game bajo su licencia MIT original (ver `LICENSE.base-game`).
