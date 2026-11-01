# Mobs nuevos de Flare y auditoría de OpenGameArt

Estado: **9 tipos nuevos agregados y verificados** (definiciones, atlas, cliente, tests). La auditoría de `assets/raw` (OpenGameArt) está hecha; ninguno de esos mobs se agregó todavía. Complementa a [`MAPAS_FLARE.md`](MAPAS_FLARE.md) (sección 6) y [`ZONAS.md`](ZONAS.md).

## 1. Tipos nuevos (Flare, CC-BY-SA 3.0)

Se agregaron **al final** de `MOB_TYPES` (el protocolo manda el índice: los 13 originales no se movieron, y un test lo vigila). Stats sobre las curvas de `ZONAS.md` (vida `29 + 10,5·L + 2,75·L²`, daño medio `2,5·L + 3`, exp `60·L^1,5 / 11`). En una zona con `lvl` se reescalan como cualquier mob común (`mobDef`).

| Índice | Tipo | Nombre | Nv base | Vida | Daño | Exp | Sprite de Flare | Notas |
|---|---|---|---|---|---|---|---|---|
| 13 | `hobgoblin` | Hobgoblin | 3 | 85 | 8-13 | 30 | `hobgoblin` (empyrean) | |
| 14 | `hobgoblin_archer` | Hobgoblin arquero | 3 | 70 | 7-11 | 30 | `hobgoblin_archer` (empyrean) | **cuerpo a cuerpo por ahora** (ver 3) |
| 15 | `skeleton_archer` | Esqueleto arquero | 5 | 125 | 10-16 | 55 | `skeleton_archer` | **cuerpo a cuerpo por ahora** |
| 16 | `zombie_dark` | Zombi oscuro | 4 | 125 | 9-15 | 45 | `zombie_dark` (empyrean) | sprite casi negro: poco visible en mapas oscuros |
| 17 | `cursed_grave` | Tumba maldita | 5 | 150 | 11-18 | 62 | `cursed_grave` | lápida inmóvil en Flare; velocidad 0,5 (ver 3) |
| 18 | `ice_ant` | Hormiga de hielo | 7 | 237 | 15-23 | 101 | `ice_ant` | |
| 19 | `antlion_small` | Cría de hormiga león | 4 | 75 | 6-10 | 28 | `antlion_small` | más débil a propósito (~65 % de la curva) |
| 20 | `wyvern_fire` | Wyvern de fuego | 9 | 346 | 20-31 | 147 | `wyvern_fire` | |
| 21 | `wyvern_ice` | Wyvern de hielo | 8 | 289 | 18-28 | 123 | `wyvern_water` | se llama `wyvern_ice` en ERIS |

Animaciones: los 9 tienen **stance, run, swing, hit y die en 8 direcciones** (las 5 que usa el cliente). Solo `cursed_grave` usa reemplazos por falta de la original (andar = quieto, ataque = `cast`), con la misma regla de `FALLBACK` que ya tenía el minotauro. Los atlas son webp a escala 0,5, como el resto.

## 2. Qué se tocó

| Archivo | Cambio |
|---|---|
| `packages/world/src/mobs.ts` | 9 tipos al final de `MobType`, `MOB_TYPES` y `MOBS` |
| `tools/src/flare/atlas.ts` | busca archivos también en `empyrean_campaign` (de ahí salen `hobgoblin`, `hobgoblin_archer`, `zombie_dark`); lista `EXTRA` con los 9 tipos nuevos (`wyvern_ice` sale de `wyvern_water`); error claro si falta esa carpeta |
| `apps/client/public/assets/*.webp` | 9 atlas nuevos (5,9 MB en total) |
| `apps/client/public/assets/meta.json` | +9 entradas (lo demás quedó igual byte a byte) |
| `apps/client/public/assets/CREDITS.txt` | los 9 `.webp` nuevos en la lista de adaptaciones de Flare |
| `apps/client/src/main.ts` | los 9 nombres en la lista de atlas que carga el cliente |
| `apps/server/test/mobs.test.ts` | **nuevo**: orden del protocolo, definiciones coherentes, curvas, reescalado y que cada tipo tenga atlas y las 5 animaciones |
| `docs/MOBS_NUEVOS.md` | este informe |

Server, proto y economía **no necesitaron cambios**: `MobSnap.type` es un `int32` y todo lo demás lee `MOB_TYPES`/`MOBS` (no hay otros `Record<MobType, …>`).

## 3. Lo que falta o hay que decidir

- **Arqueros con ataque a distancia.** `MobSim` solo pelea cuerpo a cuerpo (avanza hasta 1,1 celdas y golpea) y tiene la habilidad especial de boss. Para que `hobgoblin_archer`, `skeleton_archer` (y los magos que se quieran) disparen hay que agregar a `MobDef` un alcance (`range`) y un proyectil/animación `shoot`, y en `MobSim` un estado que se detenga a distancia de ataque, más el evento de red correspondiente (hoy `MobAttack` solo marca el golpe). Los atlas ya traen la animación `shoot` en Flare, pero `atlas.ts` solo empaqueta las 5 básicas. Hasta entonces pelean cuerpo a cuerpo.
- **`cursed_grave`** no tiene animación de andar. Se le dio velocidad 0,5 (no 0) para no dejar a la IA con velocidad nula: con 0 un mob que vuelve a casa nunca termina de llegar y se queda en estado `return` sin recuperar vida. Se ve "deslizarse" con la animación quieta. Si molesta, la salida limpia es mobs inmóviles en `MobSim` (no persiguen, pegan solo al que está pegado).
- **`hobgoblin` y `hobgoblin_archer`** se parecen mucho entre sí a escala 0,5 (mismo cuerpo, cambia el arma). Dentro de un mismo pit se van a confundir.
- **Carga inicial:** el cliente baja los 9 atlas nuevos al arrancar (+5,9 MB, sobre los ~12 MB de mobs que ya baja). La carga por mapa ya figura en `MUNDO.md` como mejora opcional; con 22 tipos conviene hacerla.
- `docs/ZONAS.md` no lista los tipos nuevos (no se tocó).

### Qué tenés que correr en tu Mac

Los atlas ya están generados y subidos al árbol de trabajo, así que **no hace falta correr nada para jugar**. Para regenerarlos o verificar:

```bash
# regenerar los atlas (Flare v1.14 descomprimido; hace falta empyrean_campaign)
FLARE_DIR=~/Downloads/flare-win-zip pnpm --filter @fdn/tools atlas
pnpm typecheck
pnpm --filter @fdn/server test
```

`pnpm assets:flare` por sí solo **no alcanza** para los tipos nuevos: `tools/src/flare/fetch.ts` solo baja `fantasycore` y `hobgoblin`, `hobgoblin_archer` y `zombie_dark` están en `empyrean_campaign` (hay que sumarle `mods/empyrean_campaign/animations/enemies` y `mods/empyrean_campaign/images/enemies` a la lista de carpetas; no lo toqué porque `MAPAS_FLARE.md` ya prevé cambiarlo para los mapas).

### Verificación hecha acá (Linux)

- El generador corrió completo con un `@napi-rs/canvas` de Linux instalado en una carpeta aparte (fuera del repo). Para validar que es fiel, los 9 mobs que ya existían salieron **idénticos byte a byte** (webp y `meta.json`) a los del repo.
- `tsc --noEmit` en `packages/world`, `apps/server` y `apps/client`: sin errores. En `tools` el único error es uno viejo de `src/boss/atlas.ts` (`willReadFrequently`), anterior a estos cambios.
- Tests del server: **70 de 70** (los 5 nuevos incluidos).
- Revisé a ojo los 9 atlas (8 direcciones, andar, ataque, golpe, muerte). **No** probé el juego en un navegador: falta ver los mobs en pantalla (tamaño y altura de la barra de vida, `head`, calibrados contra mobs parecidos).

## 4. Auditoría de OpenGameArt (`assets/raw`)

Los `.7z` se listaron y extrajeron en una carpeta nueva fuera del repo, sin ejecutar nada. **Licencia y autor: sin verificar** para todo salvo lo indicado, porque los PNG no traen texto de autoría ni licencia. Los `.blend` de `pirateghostmodel`, `piratezombiemodel`, `skeleton_0`, `skeleton_knight`, `skeleton_mage_high` y `skeleton_occultist` traen embebido "CC-BY-SA 3.0 or later" (los dos pirata, además "Copyright (C) 2010 Clint Bellanger"), y `wyvern.blend` "CC-BY-SA 3.0": son material del propio Flare. `Werewolf`, `daemon4`, `golem` y `knife_hobgoblin` no traen ningún texto.

**Formato común:** casi todos los PNG sueltos son sheets en grilla, **8 filas (una por dirección) × N columnas de cuadros de 128 px** (256 px en `demon` y `wyvern_*`). Traen todas las animaciones en una sola fila, pero **no traen definición de animaciones** (qué columnas son stance, run, ataque, golpe y muerte): solo el slime la trae (`slime_anim_def_file.7z`, formato Flare con `position=`). Hay que escribir esas definiciones (mirando cada sheet) antes de usarlos. Los `.blend` son de Blender 2.49 a 2.68; **no hay Blender instalado**, así que nada se puede renderizar acá.

| Mob | Archivos | Sheet / cuadros | Set completo | Veredicto |
|---|---|---|---|---|
| Slime (+ fire, guts, ice, metal) | `slime*.png` x5, `slime_anim_def_file.7z` (5 `.txt`), `slime.7z` (`Slime.blend`, 46 MB) | 5248x1024, 41 col | **Sí, con definición** (stance 4, run 8, swing 5, hit 2, die 11, critdie 10) | **Usar.** El más fácil: 5 recolores listos. Hay que leer su formato `position=` (grilla) en `atlas.ts`, que hoy lee `frame=` |
| Tentacle | `tentacle.png`, `tentacle.7z` (solo `.blend`) | 5632x1024, 44 col | Aparente (se ve la muerte al final), sin definición | **Usar** tras escribir la definición |
| Spider (`_0`, `_large`, `_giant`) | 3 PNG | 4096x1024, 32 col | Aparente, sin definición, sin `.blend` | **Usar** tras definición (3 tamaños sirven para trepar de nivel) |
| Werebear | `werebear_0`, `werebear_white` + 8 variantes `brown/white` × `bare/shirt/armor/armor_rusty` | 3584x1024, 28 col | Aparente en `_0` y `_white`, sin definición | **Usar** `_0` y `_white`. Las 8 variantes no se revisaron (pueden ser capas de equipo y no sheets completos) |
| Werewolf | `werewolf.png`, `Werewolf.blend` | 3584x1024, 28 col | Aparente, sin definición | **Usar** tras definición |
| Orcos sueltos (`archer`, `elite`, `heavy`, `regular`) | 4 PNG | 4096x1024, 32 col | Aparente (muerte visible), sin definición | **Usar** tras definición (4 variantes) |
| Orc Warrior | `Orc Warrior.7z`: frames sueltos | 5 estados (Staying, Walking, Attacking, TakingDamage, Dying) × 8 dir × 16 cuadros de 180x180 | **Sí** | **Usar** (alternativa de más resolución), con un empaquetador de cuadros sueltos |
| Orc Hero / Orc Mage Hero | `Orc Hero.7z`, `Orc Mage Hero.7z`: frames sueltos | solo Staying y Walking, 8 dir × 16 cuadros de 128x128 | **No** (sin ataque, golpe ni muerte) | **Descartar** como mob; sirven de NPC o decoración |
| Wyvern (orco sobre wyvern) | `Wyvern.7z`: frames sueltos | 5 estados × 8 dir, cuadros de 176x176 (Staying 16, Walking 16, Attacking 11, TakingDamage 11, Dying 16) | **Sí** | **Usar** (con el empaquetador de cuadros sueltos) |
| Wyvern (aire/fuego/agua) | `wyvern_air/fire/water.png`, `wyvern_composite/noshadow/shadow/diffuse*.png`, `wyvern.blend` | 14336x2048, 56 col, celda 256 | Sí, sin definición | **No hace falta:** Flare ya trae esos wyvern con definición y `wyvern`, `wyvern_fire` y `wyvern_ice` ya están en ERIS. Los demás PNG son pasos intermedios del render |
| Demon | `demon.png`, `daemon4.blend` | 10752x2048, 42 col, celda 256 | Aparente (muerte al final), sin definición | **Usar** tras definición. No es el `demonio` de ERIS (ese sale de un pack 3D de `boss/atlas.ts`) |
| Flying terror | `flying_terror.png`, `flying_terror.7z` (solo `.blend`) | 4480x1024, 35 col | Aparente, sin definición | **Usar** tras definición (volador, serviría como murciélago) |
| Wolf rider | `wolf_riders.png`, `wolf_rider.7z` (solo `.blend`) | 5376x1024, 42 col | Aparente, sin definición | **Usar** tras definición |
| Knife hobgoblin | `knife_hobgoblin.png`, `.blend` | 6144x1024, 48 col | Aparente, sin definición | **Usar** tras definición (variante de hobgoblin) |
| Skeleton knight / mage high / occultist | PNG + `.blend` de cada uno (hay `skeleton_mage_high (1)` repetido) | 3584x1024, 28 col | Aparente, sin definición | `knight` y `mage_high`: **ya los trae Flare** (`skeleton_knight_boss`, `skeleton_mage_high_boss`), usar los de Flare. `occultist`: **usar** tras definición |
| Antlion mk2 | `antlion_mk2.7z` (`antlion.png`, `antlion_small.png` + 2 `.blend`) | 4864x1024, 38 col | Aparente, sin definición | **Opcional:** ERIS ya tiene `antlion` y `antlion_small` de Flare |
| `output.png` / `output (1).png` | 2 PNG | 4608x1024, 36 col | Aparente (humanoide oscuro), **origen desconocido** | **Revisar a ojo** antes de decidir; no se pudo identificar |
| Knight | `knight.png` (8704x128, una sola fila), `Knight01.png` (320x320), `knight5.png` (868x684) | | **No** (no son sheets de 8 direcciones) | **Descartar** como mob |
| Pirate ghost / pirate zombie | `.blend` | sin render | - | **Renderizar** desde el `.blend` (Blender 2.62, CC-BY-SA 3.0+ embebida; son de Flare) si se quieren |
| Golem | `golem.blend` (31 MB) | sin render | - | **Renderizar** desde el `.blend` si se quiere; ERIS ya tiene un `golem` de otro pack |
| `tileset_desert.png` | 1024x1129 | no es un mob | - | Para mapas (desierto), no para mobs |

Para pasar un sheet a ERIS hay dos pasos: (1) la definición de animaciones (qué columnas son cada animación; hay que mirar el sheet y confirmar el orden), y (2) que `atlas.ts` lea la grilla (sheets sueltos y slime) o los cuadros sueltos (Orc Warrior, Wyvern).

## 5. Licencias: qué sumar a `docs/LICENCIAS_AUDITORIA.md`

- **Tabla de mobs de Flare (fila "Mobs `goblin`, `goblin_elite`, ..."):** agregar `hobgoblin`, `hobgoblin_archer`, `skeleton_archer`, `zombie_dark`, `cursed_grave`, `ice_ant`, `antlion_small`, `wyvern_fire`, `wyvern_ice`. Origen: Flare, `animations/enemies/*` e `images/enemies/*` (fantasycore y **empyrean_campaign**), CC-BY-SA 3.0 o posterior; adaptaciones (atlas, escalado a 0,5, reemplazo de animaciones faltantes en `cursed_grave`). `wyvern_ice` viene de `wyvern_water`.
- **Fila nueva para `assets/raw` (OpenGameArt):** autor y licencia **sin verificar** por pieza. Mientras no se anote cada uno, ningún mob de OpenGameArt debería entrar a un atlas que se publique. Lo único con licencia visible es el material de Flare embebido en los `.blend` listado arriba.
- Recordatorio de la sección 2 de ese archivo: lo derivado (los atlas nuevos) queda CC-BY-SA, sin cifrar ni ofuscar.
