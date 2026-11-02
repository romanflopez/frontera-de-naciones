# Crafting y channels

Decisiones para el MVP.

## Crafting — MVP: enhancement + consumibles

### Enhancement

- Receta: **materiales + item + gold → sube +N**, de +0 a +9.

| Rango | Riesgo al fallar |
|-------|------------------|
| +0 a +3 | Seguro, no pasa nada. |
| +4 a +6 | Puede bajar 1 nivel. |
| +7 a +9 | Puede romperse. |

- Los materiales dropean **solo** en zonas PvP (T3–T5) y en mazmorras.
- Se hace en un NPC/mesa del Hub.
- El brillo del item muestra el nivel de enhancement (+N).
- Enhancement y Veteranía son **ejes separados**: Veteranía es del personaje, enhancement es del equipo.

### Consumibles

- Pociones de HP y maná, scrolls de buff.
- Recetas simples con materiales comunes.

### Fuera del MVP

- Crafting de equipo desde cero (prioridad P4).

## Channels — MVP: no implementar, pero dejar el protocolo listo

- En `packages/proto/network.proto`, el mensaje de entrar al mapa lleva `mapId` + `channelId`.
- En el MVP, `channelId` siempre vale 0.
- Hay channels solo en el Hub (zona segura), con 2–4 copias.
- Zonas disputadas (PvP): **siempre 1 channel**. Nunca se dividen.
- Dungeons: instancia por party (no es un channel).
- A futuro: para las zonas PvP, evaluar sharding por facción en vez de channels.

### Estado del protocolo

Listo: `MapReady` lleva `channel_id = 3` y `TeleportTarget` lleva `channel_id = 4` (`packages/proto/network.proto`). En el MVP siempre valen 0. Los clientes viejos leen 0 por defecto (proto3).