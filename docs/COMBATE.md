# Combate — Números base (P0)

## Tamaño y grilla
- Colisión de personaje: 1 tile
- Sprite: 2 tiles de alto (huella lógica 1 tile)
- Todas las distancias se miden en tiles, no en píxeles
- Cliente: TW = 96, TH = 48 (solo para render; el server usa celdas int32)

## Movimiento (sin stamina)
- Walk: 333 ms/celda (~3 tiles/s). Permite castear.
- Run: 200 ms/celda (~5 tiles/s). NO permite castear (el cast se cancela o no inicia).
- Fuera de combate: 166–142 ms/celda (sprint/montura), solo en zonas safe.
- El server calcula movement_speed_ms según estado (walk/run). El cliente NO manda el número.
- Cap duro en combate/PvP: 200 ms/celda. Ningún buff puede bajarlo de ahí.
- NO existe barra de stamina. La decisión es walk (castear) vs run (moverse).

## Cast times (escala)
- Rápido: 0.75s
- Normal: 1.0s
- Pesado: 1.5s
- Telegrafiado: 2.4s
- Un paso cancela el cast y devuelve maná/cooldown

## Gap management (slows, roots, stuns, escapes)
Regla: todo CC tiene DR. Ventana de DR: 15s.
- Primer CC: duración full
- Segundo en ventana: 50%
- Tercero: 25%
- Cuarto: inmune contra jugadores

| Efecto | Duración full | DR (2º/3º/4º) | Cooldown | Quién |
|---|---|---|---|---|
| Slow (50% vel) | 3s | 1.5 / 0.75 / 0 | 8–10s | Mago (Ice Shard) |
| Root (no se mueve, sí actúa) | 2–4s | 2 / 1 / 0 | 10–15s | Healer (Entangling Roots) |
| Freeze/Stun (no se mueve ni actúa) | 3–5s | 1.5 / 0.75 / 0 | 15–20s | Mago (Chains of Ice), Paladin (Hammer of Justice), Healer (Chastise) |
| Gap closer | — | — | 12–18s | Paladin (Holy Charge, 15 tiles) |
| Escape | — | — | 8–12s | Mago (Blink, 7 tiles), Healer (Nature Roll, 7 tiles) |
| Inmunidad a CC | 10s | — | 20–30s | Healer (Holy Blessing) |

Reglas:
- Un solo CC duro por clase. No dos stuns en el mismo kit.
- El slow NO stackea con el root: se reemplazan.
- Los escapes son recursos: cooldown largo (8–12s) define el ritmo de la pelea.
- El CC duro del Mago (Chains of Ice) tiene cast time de 1s: es interrumpible.

## Clases del MVP
- Mago: caster, DPS/CC. Blink + Chains of Ice + Ice Shard + Firebolt + Fireball + Ignite.
- Healer: sustain, support. Holy Blessing + Entangling Roots + Chastise + heal core.
- Paladin: melee/tank. Holy Charge + Hammer of Justice + Smite + Divine Shield.

## Counterplay esperado por matchup
- Mago vs Paladin: Mago kitea con slow/root/Blink; Paladin cierra con Holy Charge. Ventana: cuando el Mago gastó Blink + Chains of Ice (12–15s), el Paladin gana.
- Paladin vs Healer: Paladin stunea y presiona; Healer usa Holy Blessing + Nature Roll. Ventana: cuando el Healer gastó Holy Blessing (20–30s), el Paladin gana.
- Mago vs Healer: Mago burstea; Healer sostiene. Ventana: cuando el Healer gasta heals grandes, el Mago burstea. Si dura >2 min, el Healer está roto.

## Reglas de counterplay
- Ningún CC encadena sin DR.
- Todo burst grande requiere setup visible (cast time o combo).
- Un combo completo saca 40–55% de la barra, no 100%.
- Duración objetivo de pelea PvP: 20–40s.
- Si una pelea dura <10s o >60s, el balance está roto.

## Progresión post-40: Veteranía (no reset)
- Niveles 1–50 después del 40.
- Canal 1 (30–40%): stats capeados (+15–20% total a Veteranía 50).
- Canal 2 (40–50%): eficiencia de farmeo (drop, gold, velocidad fuera de combate).
- Canal 3 (hitos 10/25/50): Techniques extra o modificador de Path.
- Criterio: Veterano 50 vs Veterano 10 gana 60–65%, no 95%.

## Items que brillan
- Brillo atado al upgrade +N (0 sin brillo, +3 sutil, +6 medio, +9 fuerte).
- Color por facción (Sol cálido, Vhar frío).
- Rareza = partículas/aura, no brillo de arma.
- Cosmético; el stat viene del upgrade.
- Implementación: tinte de sprite + capa de glow (no shaders pesados).
- Brillo fuerte solo desde +7 (legibilidad PvP).

## Pendiente de código (P0)
- Borrar handler changePlayerMovementSpeedRequest (world.ts:441) y el mensaje del proto si nadie lo manda. El server calcula la velocidad.
- Cap duro de movement_speed_ms en 200 ms/celda dentro de combate/PvP.
