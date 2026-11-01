# Mapas de Flare en ERIS: organización por nivel

Estado: **8 mapas jugables en el juego** (Campos de Sal, Bosque de Piedra, Cañón goblin, Pantano de Merrimead, Altas de Nazia, Cementerio de Lochport, Risco del Sur y La Brecha, con portales desde las ciudades); el resto es propuesta. Complementa a [`MUNDO.md`](MUNDO.md) (grafo y fases) y [`ZONAS.md`](ZONAS.md) (curva de niveles y mobs). Si algo de acá contradice a esos dos, hay que decidir cuál se actualiza (ver sección 9).

## 1. Marco: lo que ya manda en ERIS

- **Tile 96x48.** El arte de Flare es 192x96 y `tools/src/flare/atlas.ts` ya lo escala a 0,5, así que **una celda de Flare = una celda de ERIS**: un mapa de 100x100 tiles de Flare mide 100x100 celdas.
- **Niveles 1-12** (`ZONAS.md`; el demonio Nv12 es el techo). Subir de nivel pide `40·L` kills de un mob común de su nivel: el grindeo en mapas abiertos es el motor de la progresión, misiones y jefes casi no dan exp.
- **Velocidad:** 270 ms por celda, 3,7 celdas/s. 100 celdas = 27 s de lado a lado.
- **Mapas cuadrados y deterministas** (`MapDef.size`, igual en cliente y server, con `map_hash`). Los mapas de Flare no son cuadrados: se rellenan con vacío bloqueado. La importación produce **datos estáticos** (JSON versionado) y el `build()` del mapa los lee: sigue siendo determinista.
- **Zona de caza = `Zone {type, x, y, r, n, name, lvl}`** (círculo de radio 9-12 en los mapas actuales). `mobDef(tipo, {lvl})` reescala cualquier mob no-boss a cualquier nivel (mismo sprite).

## 2. Qué trae Flare v1.14 (analizado en `~/Downloads/flare-win-zip`)

- 55 mapas jugables + `spawn.txt`. Formato `.txt` propio de Flare (capas en CSV); el paquete no trae `.tmx`.
- **745 regiones de spawn** (`[enemy] location=x,y,w,h category=… level=… number=min,max`), unos 1.800 mobs esperados, ~33 por mapa. No son mobs fijos: son zonas que eligen enemigos por categoría y nivel. Se convierten a `Zone` casi 1 a 1.
- Casi todos los mapas son de un solo nivel y de una sola categoría de mob (p. ej. `the_breach`: 23 regiones de antlion). **Ahí está lo que mejoramos:** pits con mobs distintos y sueltos entre medio.
- Colisión: capa `collision` (0 libre; 1, 2, 3 y 4 bloquean). Los mapas son de 50x60 a 164x164 tiles.
- Tilesets: grassland, cave, cave_and_dungeon, dungeon, snowplains (fantasycore) y ruins (empyrean). Los tiles están definidos en `tilesetdefs/*.txt`.
- Sprites de mobs con 8 direcciones y animaciones definidas en `animations/enemies/*.txt`.

## 3. Regla de escala

Los mapas se usan **al tamaño nativo de Flare** (50-136 celdas): en vez de fusionar para llegar a los 128-160 de `MUNDO.md`, se suman más mapas. Con 12 niveles se usa lo que cubre la curva y el resto queda de reserva:

| Tipo | Cantidad | Para qué |
|---|---|---|
| Mapas abiertos | 12 | caza por franja de nivel: 3 pits con mobs distintos + mobs sueltos |
| Cuevas de mini-boss | 4 | una por zona, con mini-boss (las de `MUNDO.md` §3.1) |
| **Dungeons** | **6 (2 pisos cada uno)** | de grupo, uno por rango de 2 niveles, con jefe final en el piso 2 (sección 5) |
| Reserva | ~25 | Nv13+, eventos, ampliaciones |

## 4. Mapas abiertos (12, tamaño nativo)

Cada mapa tiene **3 pits con un mob distinto cada uno** (A más cerca de la entrada y más fácil, C más lejos y más duro, ±1 nivel entre pits) y **mobs sueltos** repartidos entre ellos.

| # | Mapa ERIS (base Flare) | Tam. | Nv | Pit A | Pit B | Pit C | Sueltos |
|---|---|---|---|---|---|---|---|
| 1 | Campos de Sal (`salted_field`) | 60x60 | 1-2 | goblin Nv1 | slime Nv1 (OGA) | goblin_elite Nv2 | goblin |
| 2 | Bosque de Piedra (`stonewood`) | 100x80 | 1-2 | goblin Nv1 | hobgoblin Nv2 * | goblin_elite Nv2 | goblin, slime |
| 3 | Campamento goblin (`goblin_camp`) | 60x60 | 2-3 | goblin_elite Nv2 | hobgoblin_archer Nv3 * | hobgoblin Nv3 * | goblin |
| 4 | Pantano de Merrimead (`merrimead_swamp`) | 80x80 | 3-4 | zombie Nv3 | zombie_dark Nv4 * | tentacle Nv4 (OGA) | zombie, slime |
| 5 | Altas de Nazia (`nazia_highlands`) | 80x80 | 4-5 | antlion_small Nv4 * | antlion Nv4 | fire_ant Nv5 | antlion_small |
| 6 | Cementerio de Lochport (`lochport_cemetery`) | 60x80 | 5 | skeleton Nv5 | skeleton_archer Nv5 * | skeleton_mage Nv5 | cursed_grave * |
| 7 | Risco del Sur (`southern_ridge`) | 80x80 | 5-6 | antlion Nv5 | skeleton_mage Nv6 | werebear Nv6 (OGA) | antlion_small |
| 8 | La Brecha (`the_breach`) | 100x100 | 6-7 | fire_ant Nv6 | antlion Nv6 | spider Nv7 (OGA) | antlion_small, fire_ant |
| 9 | Paso de Stormrock (`stormrock_pass`) | 132x132 | 7-8 | wyvern Nv7 | ice_ant Nv7 * | wyvern_ice Nv8 * | skeleton_archer |
| 10 | Cenizas I (`underworld`) | 120x120 | 8-9 | fire_ant Nv8 | skeleton_mage Nv8 | orc Nv9 (OGA) | skeleton |
| 11 | Cenizas II (`underworld_catacombs`) | 120x105 | 9-10 | skeleton Nv9 | cursed_grave Nv9 * | werebear Nv10 (OGA) | zombie_dark |
| 12 | Cenizas III (`underworld_mines`) | 136x110 | 10-11 | zombie_dark Nv10 * | wyvern_fire Nv11 * | orc_heavy Nv11 (OGA) | fire_ant |

`*` = tipo nuevo que no está en `MOB_TYPES` (el sprite viene de Flare). `(OGA)` = viene de `assets/raw` y hay que auditar sus animaciones antes (sección 6). Es un primer borrador de asignación: se ajusta cuando se vea cada mapa.

**Reserva de Flare** (los más lindos que no entran por ahora): `grot_lagoon` y `lake_kuuma` (nevados), `black_oak_farm/city`, `oasis`, `lochport`, `torture_chambers`, `arrival`, `perdition_harbor`.

**Cuevas de mini-boss** (los 4 "bolsillos" de `MUNDO.md`, ahora cuevas chicas): `nido_arana` (Nv7, base mog_caverns 60x80), `guarida_barbaro` (Nv8, nazia_underground 100x60), `laberinto` (Nv9, nazia_mines 80x60), `cueva_golem` (Nv10, blackmire_mines 80x80).

### Cómo se arman los pits y los sueltos (lo que hace el importador)

- **Pits:** las regiones de spawn de Flare se agrupan en 3 sectores por cercanía (k-means determinista, rebalanceado para que ninguno quede con menos de ~1/3 de las zonas). Se ordenan por distancia a la entrada: A el más cercano, C el más lejano. Cada sector toma el nombre, el mob y el nivel de su pit.
- **Sueltos:** zonas chicas (radio 5, 2 mobs) repartidas por todo el mapa, ~1 cada 250 celdas caminables, a ≥12 celdas de la entrada y fuera de los pits. Son mobs de bajo nivel o ambientales de cada mapa. Respawn igual que los demás.
- Todo cae en celdas caminables (se ajusta el centro a la celda libre más cercana) y es determinista (mismo JSON en cada corrida).
- **Sin partes negras:** el vacío de Flare (fuera de la isla y en los pozos) se rellena con pasto y bosque bloqueado, en vez de dejarlo negro: pinos (ids 248-251 del tileset de pasto), frondosos (240-243 y 252-255), rocas (128-131) y matas (112, 113, 124-127). Ya está en el importador y probado en el juego para pasto y cueva; dungeon, nieve y ruinas necesitan su propio relleno. Además las caras negras de los acantilados se hacen transparentes en el atlas, y el agua de Flare (casi negra) se cambia por la del kit de ciudad.
- En mapas chicos con muchas regiones (p. ej. `salted_field`) quedan pocos sueltos porque los pits ya ocupan casi todo; se sube la densidad a mano si hace falta.

## 5. Los 6 dungeons (uno por rango de nivel, 2 pisos cada uno)

Son de grupo: mobs más fuertes que en abierto, packs, y un jefe final en el piso 2. Reemplazan a la Cripta, al Foso y a los otros dungeons de `MUNDO.md` §3.1. Total: 12 mapas de dungeon.

| # | Dungeon | Nv mobs | Piso 1 | Piso 2 (jefe) | Mobs (sprites disponibles) | Jefe final |
|---|---|---|---|---|---|---|
| D1 | Cueva y minas goblin | 2-3 | goblin_cave (48x48) | perdition_mines (56x38) | goblin, goblin_elite, hobgoblin, hobgoblin_archer | Jefe goblin (Nv4; hobgoblin/goblin_elite escalado) |
| D2 ✅ (en main) | Nido de hormiga león | 6-8 (puerta Nv6 desde La Brecha) | antlion_nest (80x80) | stormrock_ruins (100x100) | antlion, antlion_small, fire_ant | Reina hormiga león (Nv6; `antlion_armored`) |
| D3 ✅ (en main) | Cripta olvidada | 7-9 (puerta Nv6 desde el Cementerio de Lochport; jefe `caballero_cripta`) | st_maria_2 (70x70) | st_maria_3 (40x60) | skeleton, skeleton_archer, skeleton_mage, zombie, cursed_grave | Bárbaro (Nv8, ya existe) o `skeleton_knight_boss` |
| D4 ✅ (en main) | Torre del hechicero | 9-11 (puerta Nv9 desde La Brecha; jefe `mago_mayor`) | wizards_tower_1 (100x100) | wizards_tower_2 (100x108) | skeleton_mage y variantes, zombie_dark | Mago mayor (Nv10; `skeleton_mage_high_boss`) |
| D5 ✅ (en main) | Templo de Mez | 10-12 (puerta Nv10 desde La Brecha; jefe `wyvern_aire`) | temple_of_mez_1 (80x80) | temple_of_mez_2 (100x100) | wyvern en 4 elementos, skeleton | Wyvern del aire (Nv11; `wyvern_air_boss`) |
| D6 ✅ (en main) | Foso del demonio | 11-12 (puerta Nv11 desde La Brecha; jefe `demonio_foso`) | underworld_stronghold_1 (75x92) | the_pit (80x80) | skeleton_mage, wyvern, minotaur | Demonio (Nv12, ya existe) |

Criterio de los pisos: el piso 2 es el mapa de Flare donde está el jefe del tema (o el más parecido), y el piso 1 el que lleva hasta él. Se descartan `st_maria_1` (mausoleo), `wizards_tower_3` (islas flotantes unidas por teletransportes), `temple_of_mez_3` (entrada nevada) y `underworld_stronghold_2` (cuartel con ~130 eventos). Entradas por puerta de nivel o llave, como en `MUNDO.md`. Los pisos de 100x100 son largos para un grupo: recortarlos a ~64-72 de lado (D2 piso 2, D4 ambos pisos, D5 piso 2); el recorte se hace al armar cada spec.

### Balance de grupo (punto de partida; validar con `test-combat.ts`)

Curva común: `hp(L) = 29 + 10,5·L + 2,75·L²` (`mobs.ts`).

- **Mob común de dungeon:** vida ×2,5, daño ×1,25, exp ×2 (menos que el ×2,5 de vida: el grindeo abierto sigue rindiendo igual o mejor; el atractivo del dungeon es botín y esquirlas). Packs de 4-6, con un élite (vida ×4) cada pack. Ejemplo Nv9: 346 de vida común → ~865.
- **Jefe final:** vida ~11× la curva de su nivel (hoy los bosses están en ~3-3,5×, pensados para jugar solo). Ejemplos: Nv4 ~1.300, Nv6 ~2.100, Nv8 ~3.200, Nv10 ~4.500, Nv12 ~6.100. Dos habilidades (la actual más una de área o invocación). Objetivo: un guerrero solo pierde, un grupo de 3-4 gana en 2-3 min.
- Los jefes de dungeon siguen **sin reescalarse** por `zone.lvl` (decisión existente).

## 6. Mobs y animaciones

Todo mob de dungeon necesita animaciones completas: **stance, run, ataque, golpe recibido y muerte**, ×8 direcciones (más cast para magos).

**Hecho (ya en `main`, detalle en `docs/MOBS_NUEVOS.md`):** los 9 tipos nuevos de Flare están en `MOB_TYPES` con su sprite en 8 direcciones (`hobgoblin` y `hobgoblin_archer` ya se usan en Bosque de Piedra y Cañón goblin; el resto todavía no) y la auditoría de los mobs de OpenGameArt está en ese doc. Los arqueros disparan de verdad (ataque a distancia en `MobSim`, ver `docs/MOBS_A_DISTANCIA.md`), y `cursed_grave` es una lápida sin animación de andar (se desliza lento).

- **Los de Flare cumplen** (las definiciones de `animations/enemies/*.txt` traen todas, p. ej. goblin: 8 direcciones × 4 frames de reposo). Las sheets vienen empaquetadas (no son grilla): hay que cortarlas con los rectángulos de esas definiciones, no con una grilla fija.
- **Tipos nuevos para `MOB_TYPES`** (se agregan al **final** de la lista: el protocolo manda el índice): `hobgoblin`, `hobgoblin_archer`, `skeleton_archer`, `zombie_dark`, `cursed_grave`, `ice_ant`, `antlion_small`, `wyvern_fire`, `wyvern_ice`. Los sprites ya están en Flare y salen del mismo pipeline de `atlas.ts`.
- **Arqueros y magos:** los arqueros ya disparan (`docs/MOBS_A_DISTANCIA.md`); para que un mago use proyectil alcanza con ponerle `ranged` en su definición, y falta su proyectil propio.
- **Los de `assets/raw` (OpenGameArt) hay que auditarlos uno por uno:** slime, tentacle, spider, werebear, orc, knight, demon, golem, flying_terror, wolf_rider. Hay PNG sueltos y `.blend` sin renders de animación. Antes de ponerlos en un pit hay que confirmar que tengan el set completo o renderizarlos desde el `.blend`.
- Peso: un mob son sheets de 1.300x3.200 hasta 3.900x3.400 px. A 96x48 se escalan a 0,5 (como el resto) y se carga por mapa, no todo al inicio.

## 7. Importador

**Hecho y verificado en el juego (navegador real contra server y cliente):**
- `tools/src/flare/maps.ts` (`pnpm --filter @fdn/tools flare:maps [id…]`, usa `FLARE_DIR`): genera `packages/world/src/flare/<id>.ts` con tamaño cuadrado, capas de tiles de Flare, colisión **sin bolsillos inalcanzables** (se abre una celda en cada cruce diagonal entre paredes, porque Flare camina en 8 direcciones y ERIS en 4), el **vacío relleno de piso y bosque bloqueado** (sin partes negras), pits, sueltos y vínculos.
- **Hojas con soporte:** pasto (`flare_grassland.webp`) y cueva (`flare_cave.webp`, base 21000). En la cueva el vacío es roca maciza: piso verde oscuro (216-219) cubierto de columnas de roca (64-121, con la cara negra transparente), estalagmitas y piedras. Faltan dungeon, nieve y ruinas.
- `tools/src/flare/mapatlas.ts` (`flare:mapatlas`): arma `flare_<hoja>.webp` con solo las piezas usadas, a media escala. Las caras negras de los acantilados (ids 48-71) pasan a transparentes y el agua de Flare, casi negra, se cambia por la del kit de ciudad.
- `packages/world/src/flare/index.ts`: `buildFlareMap` (zonas seguras en entradas y vínculos, respawn de pits 10 s y sueltos 22 s) y los `MapDef`. El cliente carga cualquier grupo `flare_*` del `meta.json`.
- Mapas (los 8 se suman a los 4 de caza que ya había en `main`): `campos_de_sal` (60x60, Nv 1-2), `bosque_de_piedra` (100x100, Nv 1-2), `canon_goblin` (60x60, Nv 2-3), `pantano_de_merrimead` (80x80, Nv 3-4), `altas_de_nazia` (80x80, Nv 4-5), `cementerio_de_lochport` (80x80, Nv 5), `risco_del_sur` (80x80, Nv 5-6) y `la_brecha` (100x100, Nv 6-7, cueva). Cadena: Campos de Sal → Bosque de Piedra → Cañón goblin → Pantano; del Pantano salen Altas de Nazia (portal de piedra) y el Cementerio (camino de Flare); del Cementerio sale el Risco del Sur (portal de piedra), y del Risco sale La Brecha (portal de piedra). Los portales de piedra son conexiones que Flare no trae (`extras` en la spec): el importador elige una celda caminable con espacio alrededor, lejos de la entrada (`far`) o cerca (`near`).
- **Portales:** en la plaza de la Villa de Solmar, 5 celdas al este del punto de aparición (`villa_a_campos`, de ida y vuelta), y en la plaza de la Ciudadela de Vhar (`ciudadela_a_campos`, de ida).
- Validado: `validateMapGraph()` sin errores con los 33 mapas, tests del server (123 de 124, 1 salteado; 5 de ellos en `apps/server/test/flare.test.ts`), tipos, build y recorrido con navegador (crear cuenta, Villa, portal, los 8 mapas, un pit con mobs, sin errores de consola).

**Falta:**
1. `fetch.ts`: sumar `mods/empyrean_campaign/{maps,tilesetdefs,images/tilesets}` a lo que baja (hoy solo `fantasycore`). Mientras, se apunta `FLARE_DIR` al zip v1.14.
2. Specs de los 4 mapas abiertos restantes (Stormrock, Cenizas I-III) y de los dungeons, y las hojas dungeon, nieve y ruinas en `FLARE_BASE`, con su relleno del vacío (hoy hay para pasto y cueva).
3. Props con colisión propia: hoy los árboles y rocas del relleno bloquean por celda; falta afinar casos como los cruces diagonales abiertos.
4. Portar el render de control a `tools/` (hoy es un script aparte) y el recorrido con navegador a un test del repo.
5. Borde del mapa: al caminar pegado al borde la cámara muestra negro más allá del mapa (pasa igual en los mapas generados por código); se puede resolver para todos con un margen de bosque o un fondo.
6. Magos con proyectil propio, y balance de los arqueros (conservan el daño de cuerpo a cuerpo: conviene bajarlo ~20-30 % tras probarlos en un pit real).

## 8. Licencia

Los mapas de Flare son datos CC-BY-SA 3.0 o posterior: hay que atribuir (autores en `CREDITS.txt` de Flare) y **lo modificado queda CC-BY-SA**. Los JSON importados llevan `source` y `license`, y se mantienen en archivos de datos separados del código (MIT), como pide `LICENCIAS_AUDITORIA.md` §2; no se cifran ni se ofuscan. Cada mapa importado registra "basado en X, modificado". Los assets de `assets/raw` (OpenGameArt) tienen licencia **por pieza**: hay que anotar autor y licencia de cada uno antes de usarlo, y sumarlos a `LICENCIAS_AUDITORIA.md`.

## 9. Decisiones abiertas

1. ¿Los 6 dungeons reemplazan a Cripta/Foso/bolsillos de `MUNDO.md` §3.1? (propuesto: sí; hay que actualizar esa tabla, que además cambia de 9 a 12 mapas abiertos y de tamaños).
2. ¿Qué jefe final para D3: el Bárbaro (ya definido) o `skeleton_knight_boss`? Hoy el Bárbaro aparece dos veces en `MUNDO.md` (guarida y cripta).
3. ¿Mobs a distancia (arqueros, magos) en abierto o solo en dungeons?
4. Dungeons como mapas compartidos (hoy) o instancia de grupo (`MUNDO.md` §5.0 lo prevé más adelante).
5. Qué mapas de la reserva se suman primero para Nv13+.
6. `main` ya trae 4 mapas de caza generados por código (`llanos_alba`, `la_frontera`, `camposanto`, `paramo`, Fase 3 de `MUNDO.md`): ¿los mapas de Flare los reemplazan o se suman?


### Estado de mazmorras
- D1 (Cueva/Minas goblin) y D2 (Nido de hormiga león / Ruinas de Stormrock, jefe `antlion_reina`) están en main. El tileset de mazmorra (`flare_dungeon`, base 22000) ya está; Flare se baja directo de GitHub (sparse: mods/fantasycore + mods/empyrean_campaign) con `FLARE_DIR`.
- Las Ruinas de Stormrock tenían puertas trabadas por evento: el spec las abre con `open`.
- D3 (Cripta olvidada / Sepulcro profundo, jefe `caballero_cripta`) también está en main; el jefe final es nuevo (no el Bárbaro).
- D4 (Torre del hechicero / Cámaras de investigación, jefe `mago_mayor`) en main; la puerta está en La Brecha hasta que haya mapas abiertos de Nv8-9.
- D5 (Templo de Mez / Salón principal de Mez, jefe `wyvern_aire`) en main.
- D6 (Fortaleza infernal / Foso del demonio, jefe `demonio_foso`) en main: las 6 mazmorras están hechas.
- Los 4 mapas abiertos de Nv7-11 están en main: Paso de Stormrock (nieve, unido a La Brecha por 2 de sus 4 caminos de Flare; los otros 2 apuntaban a celdas selladas) y Cenizas I-III (cuevas; el Paso lleva a Cenizas I por portal de piedra). Total: 12 mapas abiertos + 6 mazmorras de 2 pisos. Cenizas III es de 136x136 con 3 pits muy poblados (15/18/14 zonas): si se siente apretado, bajar las zonas.
- Pendiente (a decidir con calma): modelo de ítems. La idea del usuario es ítem ÚNICO con buenos stats (estilo Helbreath/Evolution) en vez de rarezas con atributos al azar; de eso depende la tabla de drops por mob y jefe. Gear score: por ahora NO (con ítems únicos el nombre ya dice el poder); si hace falta para pedir equipo mínimo en mazmorras o inspeccionar en PvP, alcanza la suma de niveles de ítem equipados.
- Pendiente: distribución de farmeo y niveles de ítems por mob (después de definir el modelo de ítems).
