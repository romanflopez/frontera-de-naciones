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
- Duración objetivo de pelea PvP: 1v1 de 20-40 s y 2v2 de hasta ~60 s (kits-de-clase §3). Se mide con `sim:pvp` (K7).

## Reglas de PvP (K6, solo jugador contra jugador)

El PvE no cambia. Todo esto vive en `apps/server/src/systems/pvpCombat.ts` (constantes) y `world.ts` (dónde se aplica). Los valores de daño, pociones y maná salen de la calibración con `sim:pvp` (K7, sección siguiente).

| Regla | Valor | Dónde |
|---|---|---|
| "En combate PvP" | pegaste o recibiste daño de otro jugador en los últimos 10 s (`PVP_COMBAT_MS`) | `markPvp` |
| Multiplicador PvP | ×1 sobre el daño crudo, antes de DF/RM (`PVP_DMG_MULT`; era ×0,6, K7) | `damagePlayer` |
| Tope por golpe | ningún golpe saca más del 25 % de la vida máxima (`PVP_HIT_CAP`); vale también para quemaduras, Barrido, Aura, Nova | `damagePlayer` |
| Sin abridor | el primer golpe a alguien que no estaba en combate PvP no usa Furia ni bonus sobre controlado o quemado (no hay críticos en PvP) | `pvpHitRequest`, `handleSkill` |
| Sobre controlado | tope 1,2× contra jugadores (Juicio y Escudo 1,5×, Esquirla 2×) (`PVP_VS_CTRL_MAX`) | `pvpHitRequest` |
| Recall | bloqueado 10 s después de recibir daño de un jugador; el canal de 8 s quieto sigue igual | `startRecall` |
| Pociones | bloqueo compartido: 60 s en PvE, 30 s en PvP con pociones de un cuarto (vida 10 %, maná 12,5 %; eran 10 s y la mitad, K7); al entrar en PvP el bloqueo se acorta a 30 s desde la última; al morir se libera | `usePotion`, `markPvp` |
| Maná en PvP | en combate PvP el maná regenera 1 % por segundo con piso de 5/s (`PVP_MP_REGEN_MIN`, K7); afuera sigue 1 % con piso de 2 | `regenMana` |
| Segundo aliento (`aliento`, todas las clases, tecla Y) | 3 s quieto, recarga 3,5 min, cura 50 % de vida y maná (−30 % envenenado, cuando exista el veneno en jugadores). Lo cortan un golpe directo (la quemadura no), un control, moverse o cualquier otra acción; cortado no gasta la recarga | `startWind` / `finishWind` |
| Invisibilidad | recarga 60 s; se corta al atacar, castear, usar una habilidad o recibir daño | `invisibilityRequest`, `startCast`, `damagePlayer` |
| Detectar | recarga 20 s | `detectInvisibleRequest` |

El cliente recibe el bloqueo de pociones y el Segundo aliento en `AbilityState` (proto, tag 1000).

## Simulación PvP y calibración (K7)

`pnpm --filter @fdn/tools sim:pvp [--lvl 12,40] [--n 60]` corre 1v1 y 2v2 con las 3 clases (bots en `tools/src/sim/pvp/bots.ts`) con los números del server y sale con código 1 si algún enfrentamiento queda fuera del objetivo. `sim:pvp:calibrar` barre combinaciones de reglas; `--log "paladín vs mago"` imprime una pelea entera. Personajes de referencia: equipo común con mejoras moderadas (`pvp/builds.ts`), sin únicos. `apps/server/test/sim-pvp.test.ts` verifica que la sim use las mismas fórmulas que el server.

Objetivo: 1v1 con mediana de 20-40 s, 2v2 de hasta ~60 s, el ganador no termina con más del 65 % de vida y un solo atacante no saca más del 55 % en 3 s.

**Antes (×0,6, pociones cada 10 s a la mitad, maná con piso de 2):** a nivel 12 los 12 enfrentamientos llegaban al tope de 180 s; 11 sin ganador. El paladín pasaba 100-140 s de 180 sin maná y la poción de vida curaba más por segundo de lo que pegaba el rival.

**Después (×1, tope 25 %, pociones cada 30 s a un cuarto, maná con piso de 5 en PvP), nivel 12 / 40, mediana de duración:**

| Enfrentamiento | Nivel 12 | Nivel 40 | |
|---|---|---|---|
| Paladín vs mago | 32,7 s (gana el paladín con 61 %) | 23 s (59 %) | ✓ |
| Paladín vs paladín | 39,6 s | 40,8 s | ✓ / justo |
| Paladín+mago vs paladín+mago | 48 s | 25 s | ✓ |
| Mago vs mago | 11,9 s | 11,9 s | ✗ muy corta |
| Cualquiera con healer | 26-180 s, el bando del healer gana con 80-97 % o no termina | igual | ✗ |

El tope del 25 % casi nunca actúa: ningún golpe solo llega a esa cifra con el equipo de referencia hasta el 40. Se mantiene como seguro.

**Lo que no arreglan estas tres reglas (pendiente de decisión):**
- **Healer.** Gana o no muere en todos los enfrentamientos. La causa principal es Renovar: hoy cura 6,25 % *por pulso* (37,5 % en 6 s, recarga 3 s, 26 de maná). Con 6,25 % en total, el paladín le gana al healer y los 2v2 con healer bajan a 60-130 s (siguen largos). El veneno, que es la herramienta contra los healers, hoy solo lo pone un atributo de ítem: ninguna de las 3 clases lo tiene en el kit. La sim tiene estas propuestas como opciones (`--renovar-total`, `--veneno juicio,golpe,escudo,quemadura`, `--castigo 0.75`, `--curacd 8`).
- **Mago contra mago** dura ~12 s: la sim supone que todo proyectil pega (no modela esquivar) y el mago tiene la menor vida y el mayor daño sostenido.
- **El paladín le gana siempre al mago** (100 % de las peleas, terminando con ~60 % de vida): cumple el criterio de vida pero no el espíritu de "gana el que maneja la distancia". A nivel 40, ya con Parpadeo y Carga sagrada, sigue igual.
- Todos corren a la misma velocidad: sin maná para un control, nadie alcanza a quien se aleja.

## Habilidades de nivel 15 a 35 (K8)

Desbloqueos de la versión 4 del kit (`packages/world/src/kits.ts`, PR #14): del 13 al 40 salen en el 15, 20, 25, 30 y 35, y el escape o acercamiento de las tres clases sale a la vez en el 20. Todo lo aplica el server (`SKILLS` y `BUFF` en `pvpCombat.ts`, estados en `statusSystem.ts`, `k8Skill` y `handleBlink` en `world.ts`). Maná: el del mago y el paladín es el de Valdrys; el del healer, escalado a su pool (~0,45).

| Nv | Clase | Habilidad (id) | Cast | Recarga | Maná | Qué hace en ERIS |
|---|---|---|---|---|---|---|
| 15 | Paladín | Escudo divino (`escudodivino`) | — | 20 s | 45 | Escudo propio del 60 % de la vida, 10 s |
| 20 | Paladín | Carga sagrada (`carga`) | — | 18 s | 60 | Ya estaba (K2) |
| 25 | Paladín | Aura de represalia (`represalia`) | — | 30 s | 48 | 10 s: −20 % de daño recibido y devuelve ⅓ de cada golpe al monstruo que pegó |
| 30 | Paladín | Bendición de poder (`grito`) | 0,8 s | 10 s | 48 | +16 al Daño base 60 s a los aliados a 14 celdas (reemplaza al Grito de guerra; el id queda por las barras guardadas) |
| 35 | Paladín | Bendición de amparo (`amparo`) | 0,8 s | 10 s | 48 | −6 % de daño recibido 60 s a los aliados a 14 celdas |
| 15 | Mago | Escudo de maná (`escudomana`) | — | 10 s | 45 | Escudo propio del 33 % de la vida, 10 s |
| 20 | Mago | Parpadeo (`blink`) | — | 12 s | 0 | Ya estaba |
| 25 | Mago | Clarividencia (`clarividencia`) | — | 30 s | 60 | 10 s: 25 % de crítico (×1,8) en los hechizos contra monstruos; contra jugadores no hay críticos |
| 30 | Mago | Purga (`remover`) | — | 24 s | 30 | Se saca congelado, aturdido y frenado; 8 s de inmunidad a parálisis |
| 35 | Mago | Intelecto arcano (`intelecto`) | 0,8 s | 10 s | 60 | +8 de Magia de equipo 90 s a los aliados a 14 celdas |
| 15 | Healer | Escudo guardián (`guardian`) | — | 12 s | 28 | Escudo del 40 % de la vida del aliado, 10 s |
| 20 | Healer | Paso de luz (`pasoluz`, por `BlinkRequest.skill`) | — | 15 s | 0 | Hasta 6 celdas hacia donde apunta (mismas reglas de celda que el Parpadeo) y se saca el frenado |
| 25 | Healer | Despertar (`despertar`) | 2,4 s | 20 s | 54 | Revive a un aliado caído con 50 % de vida y maná. En mazmorras y arenas, solo dentro de los 10 s de la caída |
| 30 | Healer | Esfera celestial (`esfera`) | — | 8 s | 34 | 8 curas del 13 %: cada una salta al aliado más herido a ≤ 6 celdas (no al mismo de recién) |
| 35 | Healer | Bendición de grupo (`grupo`) | 0,8 s | 10 s | 28 | Fortaleza (+6 % de vida máxima) y Espíritu divino (+50 % de regeneración de maná) juntas, 90 s, a los aliados a 14 celdas |

Reglas comunes:
- **Escudos:** se juntan con tope de una barra llena (la vida máxima) y duran 10 s desde el último. Absorben después de la defensa, del multiplicador PvP y del tope por golpe. Un golpe que se come entero el escudo no corta el Segundo aliento ni la invisibilidad. Viajan en `Vitals.shield` y `PlayerVitals.shield`.
- **Bendiciones y auras:** no se apilan (la nueva renueva la duración). Las que tocan stats (poder, intelecto, fortaleza) recalculan los stats al entrar y al vencer. Viajan en `StatusUpdate.buffs`.
- **Al morir** se pierden escudos, bendiciones y auras.
- **Despertar en el cliente:** con un healer aliado a 15 celdas, el muerto espera 10 s antes de pedir reaparecer.
- Traducción de los atributos de Valdrys (los de ERIS no se tocan en el MVP): Sabiduría → Magia de equipo, Valor → % de vida, Espíritu → regeneración de maná. Son puntos de partida: se ajustan con `sim:pvp` (K7) y la prueba jugada.

## Balance PvE (etapa 6b, base Dreadmyst)

`pnpm --filter @fdn/tools sim:pve [--lvl 1,10,20,40] [--n 40] [--cls guerrero,mago,healer]` mide un personaje típico (el mismo de `sim:pvp`, `pvp/builds.ts`) contra mobs de su nivel con las fórmulas del server: tiempo para matar un común y un élite, vida que sacan, farmeo encadenado de 30 min (kills por hora, tiempo parado a recuperarse, muertes, pociones), horas por tramo con `killsToLevel`, y jefes de mazmorra de a uno con el escalado para jugar solo del PR #17. Metas en `tools/src/sim/pve/targets.ts`; sale con código 1 si algo queda afuera. `apps/server/test/pve-6b.test.ts` vigila la curva.

Modelo: pelea "quieta" (el mob llega desde el radio de aggro; nadie kitea ni esquiva), bot con criterio (el mago no gasta lo caro en un común si le falta maná; el paladín sigue con el ataque básico sin maná), descansa si queda con menos de 50 % de vida (o 25 % de maná el mago y el healer).

| Cambio | Antes | Ahora | Dónde |
|---|---|---|---|
| Daño de los mobs por nivel | curva `2,5·L + 3` (pensada antes del ×4,24 de vida del PvP) | × `mobDmgMult(L)`: 3,5 al 1, 3,3 al 6, 2,6 al 12, 1,4 al 20, 1 al 25, 0,75 al 30, 0,6 al 40 (interpolado). Los jefes, la raíz (`bossDmgMult`). Se aplica a los tipos de `MOBS` a su nivel, al golpe especial de los jefes y a todo lo reescalado por `mobDef` | `packages/world/src/mobs.ts` |
| Vida fuera de combate | 1 por segundo fijo (a nivel 40, 10 min para recuperar un mob) | 1 %/s caminando y 3 %/s quieto, desde 2,5 s sin recibir daño y 10 s sin PvP (`HP_REGEN`, `hpRegenPerSec`) | `stats.ts`, cliente |
| Maná contra monstruos | 1 %/s, mínimo 2 (igual que en PvP) | 2 %/s, mínimo 3 (`PVE_MP_REGEN`). El PvP queda en 1 % con piso de 5 (`pvpMpRegen`, K7): `sim:pvp` da idéntico a antes | `stats.ts`, `pvpCombat.ts`, cliente |

**Antes** (mismo modelo): hasta el 10 un común le sacaba al paladín 1-3 % de la vida y al 20 un 7 % (no había peligro); con 1 de vida por segundo, el paladín se pasaba 58-82 % del tiempo parado entre el 5 y el 40; a nivel 40 el élite le ganaba al paladín y al mago.

**Después** (n = 40):

| Clase | Común le saca (nv 1 / 10 / 20 / 40) | Élite gana (nv 10 / 20 / 40) | Parado (nv 5 / 20 / 40) | Horas 1→10 / 10→20 / 20→30 / 30→40 (total) |
|---|---|---|---|---|
| Paladín | 2 % / 8 % / 10 % / 11 % | 100 % / 100 % / 100 % | 28 % / 18 % / 8 % | 1,4 / 10,4 / 27,1 / 50,8 (89,7 h) |
| Mago | 4 % / 0 % / 12 % / 8 % | 100 % / 100 % / 100 % | 35 % / 24 % / 9 % | 1,7 / 9,8 / 22,8 / 33,5 (67,8 h) |
| Healer | 0 % / 7 % / 24 % / 29 % (se lo cura) | 100 % / 100 % / 100 % | 18 % / 8 % / 1 % | 1,3 / 7,8 / 19,2 / 36,8 (65,1 h) |

Jefes de a uno con el escalado solo del PR #17 (vida ×0,5, daño ×0,85): el paladín y el healer le ganan al jefe goblin, la Reina, el Mago mayor y el Wyvern; el healer también al Caballero y al Señor del Foso. El mago pierde con todos menos el goblin porque la sim no kitea.

**Lo que queda afuera de meta (pendiente, no se arregla con estas palancas):**
- **Maná del mago del 3 al 15:** se pasa 30-40 % del tiempo meditando. Su maná es chico al lado de los costos de Valdrys (la Saeta, 14, es el 16 % del maná al nivel 1). Subir la regeneración no alcanza (al 4 %/s sigue en 26-35 % a nivel bajo y a nivel alto el maná queda infinito). La solución de Dreadmyst es que el costo escale con el nivel (`maná = a + b·nivel`, siempre el mismo % del pozo), pero cambia el PvP calibrado en K7: **decisión pendiente**.
- **Final de tramo del equipo típico (nivel 15 y 30):** el paladín pierde con el élite al 15 y con el Caballero (15) y el Señor del Foso (30) de a uno. Es el equipo de referencia: hasta el 15 lleva el de la tienda sin mejoras. Es el problema de `nivel-40-e-items.md` §5.1 (el poder del ítem no sigue al nivel); se arregla con los ítems, no con los mobs.
- **Paladín del 5 al 15 para un 28-34 % del tiempo:** mata tan rápido (1,6-4,5 s) que la vida que pierde por minuto supera lo que repone. Con pociones a mano baja; si molesta en la prueba, la palanca es `HP_REGEN.pct`.
- **Horas totales:** 65-90 h a un mob por vez contra las ~60 h del modelo de `nivel-40-e-items.md` §2.4. El paladín es el más lento del 20 en adelante (las peleas duran 8-22 s). Se mide en la prueba real antes de tocar `killsToLevel`.

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
