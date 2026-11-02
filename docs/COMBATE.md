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
DR es multiplicativo sobre la duración base de cada CC. Ventana: 15s por tipo de CC por target.
- 1er CC: 100% de la duración base
- 2do: 50%
- 3ro: 25%
- 4to: inmune (0%)

Ejemplos: Chains of Ice (base 5s): 5/2.5/1.25/0. Hammer (base 3s): 3/1.5/0.75/0. Slow (base 3s): 3/1.5/0.75/0.

| Efecto | Duración full | DR (2º/3º/4º) | Cooldown | Quién |
|---|---|---|---|---|
| Slow (50% vel) | 3s | 1.5 / 0.75 / 0 | 8–10s | Mago (Ice Shard) |
| Root (no se mueve, sí actúa) | 2–4s | 50% / 25% / 0 | 10–15s | Healer (Entangling Roots) |
| Freeze/Stun (no se mueve ni actúa) | 3–5s | 50% / 25% / 0 | 15–20s | Mago (Chains of Ice), Paladin (Hammer of Justice), Healer (Chastise) |
| Gap closer | — | — | 12–18s | Paladin (Holy Charge, 15 tiles) |
| Escape | — | — | 8–12s | Mago (Blink, 7 tiles), Healer (Nature Roll, 7 tiles) |
| Inmunidad a CC | 10s | — | 20–30s | Healer (Holy Blessing) |

Reglas:
- Un solo CC duro por clase. No dos stuns en el mismo kit.
- El slow NO stackea con el root: se reemplazan.
- Los escapes son recursos: cooldown largo (8–12s) define el ritmo de la pelea.
- El CC duro del Mago (Chains of Ice) tiene cast time de 1s: es interrumpible.
- Hammer del Paladin: cast 750ms, interrumpible. Counterplay válido.
- Blink cancela el Hammer casteando si el Mago sale de rango. Counterplay válido.

## HP nivel 40
- HP nivel 40 (sin items ni stats): Paladin ~3560, Mago ~2020 (HP ×4.24 sobre la base vieja; ajustado para pelea 20–30s). Healer TBD.
- HP nivel 10 (sim): Paladin ~1057, Mago ~630.
- La sim usa nivel 10 por velocidad. El balance real se valida a nivel 40.

## Clases del MVP
- Mago: caster, DPS/CC. Blink + Chains of Ice + Ice Shard + Firebolt + Fireball + Ignite.
- Healer: sustain, support. Holy Blessing + Entangling Roots + Chastise + heal core.
- Paladin: melee/tank. Holy Charge + Hammer of Justice + Smite + Divine Shield.

## Counterplay esperado por matchup
- Mago vs Paladin: Mago kitea con slow/root/Blink; Paladin cierra con Holy Charge. Ventana: cuando el Mago gastó Blink + Chains of Ice (12–15s), el Paladin gana.
- Paladin vs Mago: Paladin gana con ~75% de HP. ACEPTADO como matchup desfavorable del Mago. El Mago compensa en otros escenarios (con Healer de partner, con kiting perfecto, o en nivel 40 con items). No calibrar más por ahora. Re-evaluar cuando exista el Healer.
- Paladin vs Healer: Paladin stunea y presiona; Healer usa Holy Blessing + Nature Roll. Ventana: cuando el Healer gastó Holy Blessing (20–30s), el Paladin gana.
- Mago vs Healer: Mago burstea; Healer sostiene. Ventana: cuando el Healer gasta heals grandes, el Mago burstea. Si dura >2 min, el Healer está roto.

## Reglas de counterplay
- Ningún CC encadena sin DR.
- Todo burst grande requiere setup visible (cast time o combo).
- Un combo completo saca 40–55% de la barra, no 100%.
- Duración objetivo de pelea PvP: 20–30s. Si dura <12s o >45s, el balance está roto.

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

## Mapeo doc → código (P0-B1)
| Doc | Código (id) | Valores actuales |
|---|---|---|
| Firebolt (Mago) | `proyectil` | cast 1.5s (cliente `castT`), rango 15 tiles, 12–18 + 2×lvl + MAG, 8 maná, cd 0.35s |
| Strike (Paladin) | `golpe` | sin cast (`instant`), melee 2 tiles (server tolera 2.8), 14–20 + 2×lvl + arma, 10 maná, cd 0.9s |
| Chains of Ice (Mago) | `paralisis` | cast 1s, freeze 5s, cd 15s, 20 maná, rango 7.5 |
| Paladin | clase `guerrero` | id interno sin cambiar (está persistido en personajes); solo cambia el nombre visible |

DR (statusSystem.ts `drApply`): por tipo (`paralisis`, `aturdir`, `slow`) y por target, ventana 15s desde el último CC que entró.
Reemplaza la inmunidad fija de 8s al terminar una parálisis (la del Remover se mantiene).

Nota de calibración: los targets de combo (12–20%) se recalibraron cuando el HP subió ×3.5 (después ×4.24 para llevar la pelea a 20–30s; con ×4.24 los combos dan 12.8% Mago y 16.6% Paladin). El target viejo (40–55%) era para HP 302/180. Al cambiar el HP, siempre recalibrar los targets de % de barra.
