# Auditoría de licencias y procedencia (previa al lanzamiento público)

Fecha: 2026-10-30. **Revisión de estado: 2026-11-03** (ver sección 0 bis). Alcance: todo el árbol de trabajo y el historial completo de git.

> **Aviso.** Es una auditoría técnica hecha leyendo el repo y las páginas públicas de cada pack. **No es asesoramiento legal.**
> Antes de lanzar (y sobre todo antes de cobrar cosméticos) conviene que lo revise un abogado con experiencia en propiedad intelectual y videojuegos.
> Lo que figura como CONFIRMADA se basa en un archivo de licencia incluido en el repo o en la página oficial del autor consultada hoy; lo demás está marcado DUDOSA.

## 0 bis. Estado al 3/11/2026

Desde la auditoría original se resolvieron varios bloqueantes. Lo que sigue abierto está en la sección 6, actualizada.

| Bloqueante original | Estado hoy |
|---|---|
| `reference/server-csharp/**` (código y datos de Helbreath) | **Resuelto:** ya no está en el árbol de trabajo |
| `apps/server/data/catalog/*.json` (copia exacta de datos de Helbreath) | **Resuelto:** ya no existen; nunca llegaron a estar versionados en git |
| Nombres de terceros en código y textos | **Resuelto y protegido:** `apps/server/test/legal.test.ts` falla si aparece alguno |
| Atribución CC-BY-SA visible dentro del juego | **Resuelto (3/11):** botón "Créditos" en el login que muestra `CREDITS.txt` y `CREDITS-CC0.txt`, con test que lo cuida |
| Avisos de licencia de las dependencias | **Resuelto (3/11):** `THIRD_PARTY_NOTICES.txt` generado con `pnpm legal:notices`, con test |
| Repo público | **Abierto:** sigue público |
| Bosses 3D (`barbaro`, `arana`, `golem`, `demonio`) | **Resuelto (3/11):** sacados del repo por decisión de Román. Los mobs que los usaban apuntan a sprites de Flare como provisorio (`sprite` en `mobs.ts`). Se rearmarán con arte de origen conocido. Siguen en el historial de git |
| `fantasy_house.webp` | **Abierto:** sigue en el repo y en uso (`meta.json` → `buildings`) |
| Efectos TOMAS (`fx.webp`) | **Abierto:** licencia sin verificar |
| Íconos de hechizos generados con IA | **Abierto:** falta registrar herramienta y términos |
| Texturas de Craftpix (`ui/craftpix/*`) | **Abierto:** commiteadas a propósito, repo todavía público |
| Efectos de Frostwindz (`fx_priv.*`) y vórtice de los portales (`portal_priv.png`, pack "Pixel Art Animated Portal" comprado en itch.io, 4/11) | **Abierto (nuevo):** la licencia (uso comercial y modificación sí; redistribución y uso en IA no; atribución opcional) prohíbe publicarlos y están commiteados de forma temporal. Texto de la licencia en el pack (`Frostwindz Asset License Agreement.docx`) |
| Marca y nombre | **Abierto:** sin búsqueda de marca. El juego pasó a llamarse ERIS |

**Novedad que sube la apuesta (3/11):** se decidió distribuir ERIS como **aplicación de escritorio** (Steam como destino). Distribuir
un ejecutable comercial es más exigente que tener un repo: los packs con licencia de "no redistribución" y el arte de origen no
probado pasan de ser un riesgo de repositorio a un riesgo de producto. Conviene cerrar la sección 6 **antes** de publicar en Steam.

Leyenda: **Uso comercial** sí / no / dudoso. **Riesgo** alto / medio / bajo. **Acción**: mantener / reemplazar / pedir permiso / eliminar.

## 0. Hallazgo urgente

`gh api repos/romanflopez/frontera-de-naciones` devuelve `"private": false`: **el repo de GitHub es hoy público**.
Si es así, ya están publicados (con historial) la carpeta `reference/server-csharp` (datos de Helbreath), los atlas de bosses de origen no confirmado y `fantasy_house.webp` sin licencia.
Reescribir el historial no deshace lo ya descargado o forkeado. Ver `docs/PLAN_REMOVER_REFERENCIAS.md`, paso 0.

## 1. Tabla de assets (apps/client/public/assets)

| Asset / familia | Fuente original | Licencia | Atribución / SA | Uso comercial | Modificado | Estado | Riesgo | Acción |
|---|---|---|---|---|---|---|---|---|
| `world.webp` (tiles y objetos del pasto) | Flare (flare-game), mod fantasycore, `tileset_grassland.png`; Clint Bellanger y colaboradores | CC-BY-SA 3.0 (README de flare-game: "All of the art and data files ... are released under CC-BY-SA 3.0", "or later") | Atribución obligatoria + CompartirIgual para adaptaciones | Sí (CC-BY-SA permite uso comercial) | Sí: recortado, empaquetado en estantes, escalado 0,5 (`tools/src/flare/atlas.ts`) | CONFIRMADA a nivel repo; la atribución por archivo está en el wiki de Flare y no se verificó pieza por pieza | Medio | Mantener con atribución; si se quiere cobrar, no usarlo en ítems de pago |
| `paper/*.webp` (42 piezas: cuerpo, cabezas, cuero/malla/placas/tela/mago, armas, escudos) | Flare, `animations/avatar/male/*` | CC-BY-SA 3.0 | Ídem | Sí | Sí: atlas por pieza, escalado 0,5 | CONFIRMADA a nivel repo | Medio | Mantener con atribución |
| Mobs `goblin`, `goblin_elite`, `zombie`, `skeleton`, `skeleton_mage`, `antlion`, `fire_ant`, `wyvern`, `minotaur` (`.webp`) | Flare, `animations/enemies/*` | CC-BY-SA 3.0 | Ídem | Sí | Sí: atlas, escalado, reemplazo de animaciones faltantes | CONFIRMADA a nivel repo | Medio | Mantener con atribución |
| NPC mercader | Piezas de avatar de Flare en tiempo de ejecución | CC-BY-SA 3.0 | Ídem | Sí | No (capas) | CONFIRMADA a nivel repo | Bajo | Mantener |
| `terrain.webp` | Screaming Brain Studios, "Isometric Floor Tiles" (`tools/src/dungeon/atlas.ts`) | CC0 (texto de licencia en `CREDITS-CC0.txt`, copiado del pack) | No exigida | Sí | Sí: reescalado a 100x50, magenta a transparente | CONFIRMADA (texto de licencia del pack en el repo) | Bajo | Mantener |
| `dungeon.webp` | Kenney, "Isometric Dungeon" / Dungeon Pack 2.3 (kenney.nl) | CC0 (pack incluye licencia; la página de Kenney también dice CC0 1.0) | No exigida (agradecida) | Sí | Sí: reescalado a 0,375 | CONFIRMADA | Bajo | Mantener |
| `town.webp`, `sm_*.webp`, `vh_*.webp` (kit y fachadas de la Villa de Solmar y de la Ciudadela de Vhar) | Screaming Brain Studios: "Isometric Overworld Pack" (Small/Large), "Isometric Wall Pack" (Small/Large) e "Isometric Object Pack" (`tools/src/town/atlas.ts`); más muebles de Kenney agrandados desde `dungeon.webp` y objetos dibujados por código (puerta, cartel, toldo, farol, bandera, botes, bolardo; en Vhar: puerta y cartel de hierro, brasero, estandarte, forja, yunque, rocas, obsidiana, lingotes, monolito, pinchos, pisos de adoquín, placas y lava) | CC0 (`License.txt` de cada pack: "released under the CC0/Public Domain License"; texto copiado en `CREDITS-CC0.txt`) | No exigida | Sí | Sí: reescalado a la grilla de 96x48, paredes apiladas en dos pisos, magenta/negro a transparente, fachadas compuestas | CONFIRMADA (texto de licencia de los packs en el repo; fuentes crudas no commiteadas) | Bajo | Mantener |
| `sm2_*.webp`, `vh2_*.webp` (34 edificios de las ciudades rediseñadas: edificios, casas, torres, muralla, portones y fuente) | **Arte propio**: modelos hechos desde cero con cajas, techos y materiales procedurales y renderizados con Blender (`tools/src/iso3d/city_edificios.py`); no usan texturas ni modelos de terceros | Propia (sin obligaciones) | No exigida | Sí | No (se generan por código y se pueden regenerar a cualquier resolución) | CONFIRMADA (el código es el origen) | Bajo | Mantener. Los `sm_*`/`vh_*` viejos quedan sin uso hasta C8 de `CIUDADES.md` |
| `fx.webp`, `fx.json` (14 efectos de hechizo) | "TOMAS" (Fire, Water, Wind, Earth, Ailment) de Miradin, hechos con Effekseer; horneados con `tools/src/fx/bake.py` | El CREDITS anterior decía CC-BY-SA. La página de itch.io (miradin.itch.io/tomas-fire) **no declara licencia**; hay que mirar el archivo dentro del `.rar` | Si es CC-BY-SA: atribución + SA para los cuadros | Dudoso hasta ver el archivo de licencia del pack | Sí: render a cuadros 160 px | DUDOSA | Medio | Pedir permiso / confirmar licencia en el `.rar` descargado; si no hay licencia escrita, escribirle a Miradin o reemplazar |
| `barbaro.webp` | Pack de sprites 3D prerenderizados (`tools/src/boss/atlas.ts`, carpeta `x256p_Spritesheets`, 16 ángulos). Origen no registrado en el repo. Candidato probable: "Animated Isometric Barbarian" de engvee (itch.io, US$3) | Si es ese pack: la página dice "can be used in both commercial and non-commercial projects ... you can modify these sprites"; **no habla de redistribución ni de atribución**. Los nombres de animación del script (`Idle_Armed`, `Attack_01`, `Roar`) no coinciden con los de la página, así que **no está probado que sea ese pack** | Sin dato | Dudoso | Sí: 8 ángulos, cuadros elegidos, escalado | DUDOSA (origen sin probar) | Alto | Pedir permiso / probar la compra (recibo + archivo de licencia). Mientras tanto no publicar el repo con el atlas |
| `arana.webp` (Reina araña) | Pack 3D x256 (`Idle_Nervous`, `Attack_Capture (Heavy)`). Candidato: "Animated Isometric Spider Boss" de engvee (US$4) | Mismo texto de licencia (uso comercial y modificación sí; redistribución no tratada). Nombres de animación sin coincidencia | Sin dato | Dudoso | Sí | DUDOSA | Alto | Ídem |
| `golem.webp` (Gólem de hielo) | Pack 3D x320p con sombra (`Battlecry`, `Attack_01`). Candidato: "Animated Iso Boss Creature" de engvee (US$2); la página no dice qué criatura es | Mismo texto | Sin dato | Dudoso | Sí | DUDOSA | Alto | Ídem |
| `demonio.webp` (Demonio del foso) | Pack 3D x320p (`Attack_Swipe`, `Attack_Jump`). Origen sin identificar | Desconocida | Sin dato | Dudoso | Sí | DUDOSA | Alto | Ídem |
| `fantasy_house.webp` (casa del campamento) | `Fantesy_House.zip` (PSD de 2020) subido por el dueño, "sin archivo de licencia ni autor" (`tools/src/house/export-psd.py`, `atlas.ts`) | Desconocida | Desconocida | **No** hasta que se pruebe | Sí: capa recortada, escalada 0,34 | DUDOSA (sin licencia, sin autor) | Alto | Eliminar o reemplazar si no se identifica al autor; si se identifica, pedir permiso por escrito |
| `spells/*.png` (49 íconos de hechizos, nombres tipo `burbuja-arcana`, `paso-sombrio`) | Generados con IA a partir de una imagen de referencia (dato del dueño). En el historial figuran en el commit `5d9b840` con "Co-Authored-By: Claude Opus 5.5"; el `CREDITS.txt` anterior decía "arte propio del autor del repo", lo cual **no era exacto** | Depende de los términos del generador usado y de qué era la imagen de referencia (ambos sin registrar). La protección de autor sobre salida 100 % generada por IA es incierta en muchas jurisdicciones | Sin dato | Dudoso | Sí (generados) | DUDOSA | Medio-alto | Registrar herramienta, fecha, prompts y referencia; leer los términos comerciales del generador; si la referencia era arte ajeno, reemplazar. Para cosméticos de pago, no depender de ellos |
| `ui/craftpix/*` (login y ventanas) | Pack "RPG MMO Game User Interface" de Craftpix (craftpix-net-745192), comprado por el dueño. Texturas de `Textures/` y tres piezas sacadas de `PSD Files/rnm_6.psd` | **Sin leer**: el `license.txt` del pack solo trae el enlace a craftpix.net/file-licenses. Respuestas del vendedor en itch.io: uso comercial sí, "reselling or redistributing the original files as standalone assets is prohibited" (no es el texto de la licencia) | Sin dato | Probable sí | Sí: renombradas y recortadas; las del PSD, compuestas por capa | DUDOSA | Alto mientras el repo sea público | Leer la licencia; mientras tanto están commiteadas a propósito para verlas en prod y salen al pasar el repo a privado |
| `meta.json` | Generado por los scripts del repo | Propia | No | Sí | n/a | CONFIRMADA | Bajo | Mantener |

### Íconos y UI dibujados por código (apps/client/src)

| Elemento | Origen | Estado | Riesgo | Acción |
|---|---|---|---|---|
| `icons.ts`, `itemicons.ts` (íconos de hechizos e ítems dibujados en canvas) | Código propio, originales | CONFIRMADA (propia) | Bajo | Mantener |
| HUD (orbes, barra de slots, cresta), ventanas Personaje e Inventario, login/selección (`index.html`, `login.css`, `loginui.ts`) | Implementados en HTML/CSS/SVG a partir de "diseños" hechos con IA por el dueño (commits `9e0f050`, `e05af21`, `af33760`). No hay imágenes de esos diseños en el repo | DUDOSA (menor): el código es propio, pero no hay registro de la herramienta ni de si el diseño imitaba la UI de otro juego | Medio-bajo | Guardar los diseños originales y los términos de la herramienta; revisar a ojo que no copie marcos/orbes reconocibles de otro juego (p. ej. Diablo) |
| Nombre "Frontera de Naciones", facciones Solmar/Vhar, clases | Propios. Una búsqueda web simple no mostró un juego con ese nombre, pero **no es una búsqueda de marca** | A CONFIRMAR | Medio | Búsqueda de marca (INPI Argentina y bases internacionales, clases 9 y 41) antes de invertir en branding; el README dice "nombre provisorio" |

## 2. Qué implica CC-BY-SA 3.0 (Flare) para este proyecto

Resumen técnico, a validar con un abogado:

- **Atribución:** hay que nombrar a los autores, el título, enlazar la obra y la licencia, e indicar que se modificó. Se resolvió en `apps/client/public/assets/CREDITS.txt`; falta mostrarla dentro del juego (pantalla de créditos) y en la página pública, porque el archivo en `/assets/` casi nadie lo lee.
- **Arte derivado y atlas:** los atlas (`world.webp`, `paper/`, mobs) son adaptaciones. Deben seguir bajo CC-BY-SA 3.0 (o una versión posterior/compatible). Cualquiera puede extraerlos y reutilizarlos, incluso comercialmente, con atribución y mismos términos.
- **Arte nuevo basado en Flare** (recolores, skins nuevas, piezas redibujadas sobre un sprite de Flare) también es adaptación: queda CC-BY-SA.
- **Uso comercial:** permitido. CC-BY-SA no prohíbe cobrar. Lo que no se puede es cobrar y a la vez impedir que otros copien esa arte adaptada.
- **Código:** la SA aplica a la obra adaptada, no al código aparte, mientras los assets sean archivos separados y no se fundan en una sola imagen con arte propio. Conviene mantener esa separación (no incrustar sprites de Flare en el bundle ni mezclarlos en un mismo raster con arte propio o de pago).
- **Medidas técnicas:** CC-BY-SA 3.0 prohíbe imponer medidas tecnológicas que impidan a los destinatarios ejercer la licencia. No cifrar ni ofuscar los atlas de Flare.
- **Cosméticos de pago:** no basar skins vendibles en arte de Flare. Si se hacen, esos cosméticos serían CC-BY-SA y no se podría garantizar exclusividad.

## 3. Código, protocolo y datos

| Elemento | Procedencia | Licencia | Estado | Riesgo | Acción |
|---|---|---|---|---|---|
| `reference/server-csharp/**` (server C#, .NET 10) | Copia de `ErkoKnoll/helbreath-base-game` (carpeta del server multijugador). Es una base "inspirada en Helbreath" para proyectos MMO | MIT (README del repo: "source code is released under the MIT License"; `LICENSE.base-game`: "Copyright (c) Ion Fraction OÜ"). La licencia excluye `sp-client/public/assets`, "propiedad de Siementech Co. Ltd" (assets de Helbreath), que **no** están en nuestro repo ni en su historial. El README del repo base advierte: "Those assets remain proprietary" y recomienda evaluar la situación legal de los assets | CONFIRMADA para el código MIT; los **datos** no (ver abajo) | Alto (por los datos) | Eliminar del repo y del historial (ver plan) |
| `reference/server-csharp/Config/*.json` y `apps/server/data/catalog/*.json` | `Items.json` (315 ítems), `Monsters.json` (63), `NPCs.json` (10), `Spells.json` (26): **idénticos byte a byte** (`diff` sin diferencias) a los de la referencia. Contienen nombres y datos del juego Helbreath ("Aresden Hero Armor", "Abaddon", "Gandalf", "Hellclaw", "Fire Wyvern", "Battle Golem"...) | La licencia MIT cubre el código del base-game; que cubra además los datos de un juego comercial ajeno es **dudoso**: los nombres y tablas pertenecen al juego original | DUDOSA | Alto | Reemplazar con catálogos propios (hoy el cliente casi no los usa: viaja `itemsDirectory` / `monstersList` en el estado inicial) y borrar de la historia |
| `reference/server-csharp/Config/GameWorlds.json` | Mapas de Helbreath ("Aresden Shop", `hbsh6` "HB Sleepy Hollow 6 map (unofficial)") | Datos de terceros | DUDOSA | Alto | Eliminar |
| `apps/server/data/worlds.json`, `settings.json` | `worlds.json` reescrito (solmar...), `settings.json` modificado (43 líneas de diferencia) | Derivado del MIT; contenido propio | CONFIRMADA | Bajo | Mantener |
| `apps/server/src/*.ts` (~2 500 líneas) | Port a TypeScript, según los comentarios, de `Server.cs`, `GameWorld.cs`, `Spawn.cs`, `Movement.cs`, `Map.cs`, `GameWorldOccupancyTracker.cs`, `Location.cs`, `NetworkManager.cs` y `GlobalWorld`. El resto (mobs, loot, PvP, estados, cuentas, Postgres) es propio | Obra derivada de código MIT: hay que **conservar el aviso de copyright y la licencia** (ya está `LICENSE.base-game`) | CONFIRMADA | Bajo | Mantener `LICENSE.base-game`; cambiar los comentarios "mismo server de referencia" por una nota de origen sin mencionar Helbreath |
| `packages/proto/network.proto` y `src/network.ts` | Protocolo del base-game (paquete `mmorpg.network`), extendido por nosotros | MIT (Ion Fraction OÜ) | CONFIRMADA | Bajo | Mantener |
| Historial: primer commit (`1e29c79`) | Trajo el cliente Phaser/React completo del base-game (`HBSprite.ts`, `HBMap.ts`, `SoundFileNames.ts`, ~20 clases de hechizos estilo Helbreath), un simulador de clientes y generadores de placeholders | MIT (código). **Sin assets binarios** | CONFIRMADA | Medio (nombres y referencias de Helbreath en el historial) | Quitar del historial al limpiar |
| `README.md` | Dice "PvP de control al estilo Helbreath" y enlaza el base-game | n/a | n/a | Medio (uso de marca ajena en material público) | Reescribir sin nombrar Helbreath |
| `LICENSE` (MIT, Román López) | Cubre código propio. No menciona que los assets tienen otras licencias | n/a | n/a | Bajo | Agregar aclaración "los assets tienen sus propias licencias, ver CREDITS" |

### Regla "nunca assets de Helbreath": verificación en el historial

- `git log --all --name-only` de los 73 commits (incluye ramas `worktree-agent-*`): **no hay** ningún `.pak`, `.spr`, `.amd`, `.dat`, `.wav`, `.mp3`, `.ogg`, `.bmp`, `.zip`, `.psd`, ni carpeta `sp-client` ni `Chars`. La única imagen de la historia son los atlas listados arriba (todos de las fuentes de la tabla, más `hero_warrior/mage/berserk.webp`, ya borrados, también de Flare).
- `.gitignore` bloquea `**/*.pak` y `reference/**/Chars/`.
- **Pero** sí hay datos y nombres de Helbreath (JSON de Config, ids de mapas `hbsh6`, `areshop`) y la referencia sigue en el árbol. No hay rastro de archivos de arte.
- Los `.webp` de Flare, los packs 3D y la casa no son de Helbreath. No se encontró evidencia de sprites "ripped" de Helbreath en el repo.

## 4. Dependencias npm

`pnpm licenses list` (producción y desarrollo, unos 77 paquetes): MIT 54, ISC 9, BlueOak-1.0.0 4, BSD-3-Clause 3, Apache-2.0 3, BSD-2-Clause 2, (Apache-2.0 AND BSD-3-Clause) 1 (`@bufbuild/protobuf`), y `grpc-tools` (solo dev, no se distribuye) con licencia no detectada por pnpm. **Ningún GPL/AGPL/LGPL ni licencia con restricción de uso comercial.**

- Se distribuye al cliente: `@bufbuild/protobuf` (Apache-2.0/BSD-3). Requiere conservar su aviso: incluir un `THIRD_PARTY_NOTICES` en el build.
- Server: `ws` (MIT), `pg` (MIT).
- Herramientas: `@napi-rs/canvas` (MIT), `tsx`, `typescript` (dev).
- Riesgo: bajo. Acción: generar el archivo de avisos con `pnpm licenses list --json` antes del lanzamiento.

## 5. Fuentes tipográficas

`apps/client/index.html` carga desde Google Fonts: Cinzel, Inter, Alegreya Sans, Alegreya SC. Todas son SIL Open Font License 1.1 (fuentes del catálogo de Google Fonts, que sólo acepta OFL/Apache/Ubuntu). Uso comercial permitido, sin vender la fuente suelta. Atribución ya agregada en `CREDITS.txt`.
No pude abrir el `OFL.txt` de cada familia desde esta sesión (dominios fuera de la lista permitida), por lo que quedan como **confirmación pendiente de lectura del archivo**, con riesgo bajo.
Recomendación: autoalojar los `.woff2` en vez de pedirlos a Google (privacidad de los jugadores, dependencia externa) y copiar el `OFL.txt` junto a los archivos.

## 6. Bloqueantes antes del lanzamiento público

1. **Repo público hoy** con historial que incluye datos de Helbreath, la casa sin licencia y los atlas de bosses sin origen probado. Hacerlo privado ya y decidir limpieza (plan en `docs/PLAN_REMOVER_REFERENCIAS.md`).
2. **Bosses 3D (`barbaro`, `arana`, `golem`, `demonio`)**: origen no registrado. Si son de itch.io de pago, probar la compra y leer el archivo de licencia; el texto de la página no menciona redistribución y los packs de pago normalmente no permiten republicar los archivos. Si no se prueba, reemplazar.
3. **`fantasy_house.webp`**: sin autor ni licencia. Eliminar o reemplazar salvo permiso por escrito.
4. **Catálogos `apps/server/data/catalog/*.json`**: copia exacta de datos de Helbreath. Reemplazar por datos propios antes de publicar el server.
5. **Efectos TOMAS (`fx.webp`)**: licencia no verificable en la página del autor. Confirmar el archivo de licencia del pack o pedir permiso.
6. **Íconos de hechizos hechos con IA**: registrar herramienta, términos comerciales y referencia; el `CREDITS.txt` previo los llamaba "arte propio" (corregido).
7. **Atribución CC-BY-SA visible en el juego** y copia de la licencia; sin esto se incumple la licencia de Flare.
8. **Marca/nombre**: búsqueda de marca antes del lanzamiento y antes de cobrar.
9. **Texturas de Craftpix (`ui/craftpix/*`)**: commiteadas a propósito y de forma temporal para verlas en prod, con el repo todavía público. Leer la licencia del pack y sacarlas del repo (volver a la regla del `.gitignore`) al pasarlo a privado.

## 7. Decisiones que debe tomar el dueño

- Hacer privado el repo ahora y limpiar el historial (repo nuevo o `git filter-repo`).
- Qué pasa con los 4 bosses y la casa: probar origen y licencia, o reemplazar (encargo con cesión escrita o packs con licencia clara).
- Aceptar CC-BY-SA en el arte base (Flare) y no vender cosméticos derivados, o reemplazar el arte base por original/CC0 antes de monetizar.
- Si los íconos de IA se quedan, y con qué documentación.
- Si el código del juego va a ser abierto (hoy MIT) o cerrado; afecta qué hace falta publicar y bajo qué licencia.
- Nombre definitivo y búsqueda de marca.

## 8. Qué podemos monetizar de forma segura

Con la información de hoy:

- **Cosméticos con arte nuevo y propio**, o encargado con contrato de cesión de derechos, o hecho a partir de CC0 (Kenney, Screaming Brain Studios). Son la vía más limpia.
- **Servicio, cuentas, premium/pase, slots de personaje, cambios de nombre**, y cualquier ítem sin arte de terceros, siempre que no dependa de assets dudosos.
- **Código propio** (server, cliente, protocolo, sistemas de combate, loot, UI en código): se puede monetizar; el base-game es MIT, solo exige conservar su aviso.
- **Arte de Flare:** se puede usar en un juego de pago respetando atribución y SA, pero el arte derivado queda libre para todos. No lo usaría para ítems vendibles.
- **No monetizar todavía:** nada que dependa de los bosses 3D, la casa, los efectos TOMAS ni los íconos de IA hasta resolver lo de la sección 6. Tampoco nombres, ítems o tablas copiados de Helbreath.
- **Reglas de plataforma y consumo** (cobro a menores, loot boxes con probabilidad, impuestos): fuera del alcance de esta auditoría.
