# Mobs a distancia

Estado: **andando de punta a punta** para `hobgoblin_archer` y `skeleton_archer` (server, protocolo, cliente y tests). Rama `mobs-ranged`.
El resto de los mobs sigue cuerpo a cuerpo; para sumar otro a distancia (por ejemplo `skeleton_mage`) alcanza con ponerle `ranged` en su `MobDef`.

## Cómo funciona

**Definición** (`packages/world/src/mobs.ts`): `MobDef.ranged?: { range, keep, speed, kind }`.

| Campo | Qué es | Hobgoblin arquero | Esqueleto arquero |
|---|---|---|---|
| `range` | celdas a las que dispara | 7 | 8 |
| `keep` | distancia que le gusta mantener (retrocede si el jugador queda a menos de `keep`·0,6) | 4,5 | 5 |
| `speed` | celdas por segundo del proyectil | 11 | 12 |
| `kind` | 0 flecha, 1 virote (solo cambia el dibujo) | 0 | 0 |

La cadencia es el `atk` de siempre (1,6 s) y el daño sale de `dmg`. `mobDef(tipo, zona)` conserva `ranged` al reescalar de nivel.

**IA** (`MobSim`, `apps/server/src/mobs.ts`), dentro del estado `chase` de siempre (idle → chase → return, aggro y correa de 17 celdas sin cambios):
- Si está a más de `range`·0,95 o **no tiene línea de tiro**, se acerca (igual que un mob común).
- Si tiene tiro y está a rango, **se queda quieto y dispara** cada `atk` s.
- Si el jugador lo pisa (a menos de `keep`·0,6), **retrocede** a 0,8 de su velocidad (si no puede, igual dispara).
- Línea de tiro: `clearShot` muestrea la recta cada 0,25 celdas y corta con la primera celda bloqueada (`blocked`). No dispara ni atraviesa paredes.
- No dispara a jugadores en zona segura, invisibles o muertos (misma regla `eligible` que el cuerpo a cuerpo).

**Daño:** el proyectil es solo visual; el server decide al llegar (`travel = distancia / speed`, mínimo 120 ms). Pega si el jugador sigue a **menos de 1 celda del punto al que se apuntó**, así que **se puede esquivar** caminando. Usa `host.hurt`, o sea las mismas reglas de defensa que el cuerpo a cuerpo. Si el mob muere o el jugador deja de ser objetivo válido mientras vuela, no pega.

## Protocolo

`MobProjectile mob_projectile = 151` (server → cliente, rango libre desde 150; nada reordenado, `network.ts` regenerado con `pnpm proto` solo agrega líneas):
`mob_id, from_x, from_y, to_x, to_y, travel_ms, kind`. Junto con él se sigue mandando `MobAttack` (el mob gira hacia el blanco y hace la animación de ataque) y, al impacto, `MobHitPlayer` (daño). Los mobs cuerpo a cuerpo no cambian.

## Cliente (`apps/client/src/main.ts`)

`case 'mobProjectile'` guarda el proyectil (tope de 80 a la vez) y el bucle de dibujo lo pinta como una flecha con estela que vuela en un arco corto del mob al punto apuntado; `kind 1` (virote) es más gruesa y azulada. Gancho de debug: `window.__fdn.arrows()` (cantidad en vuelo). La animación de ataque del mob es la de `swing` que ya existía.

## Verificación

- Tests nuevos, `apps/server/test/ranged.test.ts` (8, con `MobSim`, host y reloj falsos, deterministas; corridos 8 veces seguidas): definiciones (solo los dos arqueros tienen `ranged`), dispara desde lejos y el daño llega con el proyectil, cadencia, pared bloquea (no dispara ni atraviesa), esquiva, retroceso, aggro y correa (nunca pasa de 17 celdas y vuelve a casa), zona segura. Se comprobó que fallan si se rompe el disparo o la lógica de distancia.
- Suite completa del server: 123 de 124 pasan (1 salteado, ya estaba), tipos de world, server y cliente, y build del cliente.
- Navegador real contra server y cliente: Villa → portal → Campos de Sal → Bosque de Piedra → Cañón goblin, al pit "Puesto de arqueros": se ven flechas en vuelo hacia el personaje y el impacto (`-6`), sin errores de consola.

## Falta o a decidir

- **Magos** (`skeleton_mage`, hechiceros de la torre): usan el mismo mecanismo con `kind` propio (bola o rayo en vez de flecha); falta decidir su arte y si hacen daño de área.
- **Sonido y efecto de impacto** del proyectil (hoy solo el número de daño).
- **Balance:** los arqueros conservan el `dmg` y el `atk` de cuando eran cuerpo a cuerpo; a distancia son más peligrosos de lo que parecen (no se les puede pegar sin acercarse). Conviene bajar `dmg` ~20-30 % o subir `atk` tras probarlos en un pit real.
- **Dispersión por grupo:** varios arqueros apuntan al mismo jugador; no coordinan, y se empujan entre sí con la lógica de empuje de siempre.
- Si más adelante se pide `range` mayor al radio de interés del cliente (`viewRadius` 18 x 11), el proyectil igual se ve (se manda a los `nearby` del mob).
