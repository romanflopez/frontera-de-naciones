# Rediseño de ciudades: Solmar y Vhar

Fecha: 3/11/2026. Decisión de Román: rehacer las dos ciudades **de cero, look y distribución**. Referencias: **distribución de Aresden/Elvine** (Helbreath) y **look "clean" de Dreadmyst**. Se lee junto con `ROADMAP_MAPAS.md` y `ECONOMIA_Y_MONEDAS.md` §4.

## 0. Decisiones (Román, 3/11)

1. **Entra al MVP.** Va como punto 4 de `ROADMAP_MAPAS.md`.
2. **Vhar es de nieve** (hoy es lava y obsidiana). Suelo exterior nevado, techos con nieve, pinos, luz fría. Ver §3.3.
3. **Menos arquitectura y mapa más chico.** Las ciudades eran de 128×128. Quedaron de **58×58** (Vhar) y **64×64** (Solmar, que suma 6 celdas al sur para el mar), con un recinto amurallado de 38×38. Con 66×66 y un recinto de 48×48 se veía bastante pasto vacío entre los edificios y la muralla, así que se achicó 3 celdas por lado; con el mapa armado se ve apretado pero lleno, y se puede ajustar.
4. **Bosque y mar en Solmar, nieve en Vhar** (Román, 3/11): del Solmar viejo gustó el bosque y el mar con puerto, y de Vhar la nieve. Solmar recuperó la costa: playa, mar, muelle, botes y un segundo portón (sur) que baja por la avenida hasta el puerto.
5. **Salidas a los primeros niveles, siempre** (Román, 3/11): toda ciudad (y todo mapa de inicio) tiene que tener salida a los primeros niveles. Cada ciudad tiene el portón a pie hacia el campo de su nación (nivel 1-2) y un atajo por portal que se abre después de haber llegado a pie (ver §8). Lo vigila `apps/server/test/salidas.test.ts`. El puerto de Solmar es decorativo por ahora.
6. **Los primeros niveles tienen que quedar lejos** (Román, 3/11, como en Helbreath): cada nación sube en **su propio Campos de Sal** (dos copias del mapa 1-2) que se juntan en el Bosque de Piedra, y el portal a ese campo (el de la plaza y el Portal de Frontera) se desbloquea al llegar a pie una vez. Ver §8.
7. **Nombres**: se deciden con el mapa terminado.
8. **NPC al roadmap**: Román no está seguro de que estén bien configurados. Auditoría en §7 y punto 5 de `ROADMAP_MAPAS.md`.

## 1. Diagnóstico de las ciudades actuales

Renderizadas con `maps:render` el 3/11 (`npx tsx src/town/render.ts solmar_villa out.png 0.2` desde `tools/`):

| | Solmar (villa) | Vhar (ciudadela) |
|---|---|---|
| Tamaño | 128×128 | 128×128 |
| Edificios | 62 | 100 |
| Con función (interior + NPC) | 8 | 8 |
| Relleno | 54 | 92 |
| Props | 2.274 | 1.304 |

- **Más del 85 % de los edificios no hacen nada.** Son casas del mismo kit repetidas; por eso las ciudades se ven grandes pero vacías de sentido. Es lo que Román sintió como "tanta arquitectura".
- Las piezas vienen de Screaming Brain Studios y Kenney (CC0, licencia limpia según `LICENCIAS_AUDITORIA.md`): el problema no es legal, es de **coherencia y resolución**. Cajas planas de baja resolución que desentonan con el arte pre-renderizado de Flare del resto del mundo, y sin original en HD.
- Vhar es una fortaleza de bloques grises rodeada de un foso de lava; todos los edificios se leen igual. Solmar tiene plaza central y calles, pero la distribución no marca un circuito.
- Las dos ciudades ya tienen **interiores** (`solmar/interiors.ts`, `vhar/interiors.ts`) con los NPC adentro. Eso se conserva (ver §4.3).

## 2. Por qué Dreadmyst se ve "clean" (y qué copiamos)

Dreadmyst usa mapas de Flare, así que su limpieza no es magia: es **un solo estilo de arte** (pre-render 3D con la misma cámara, la misma luz y la misma escala en todo el mapa), **pocos props sueltos**, calles anchas, suelo uniforme y sombras coherentes. Lo que hace sucia a una ciudad de packs mezclados es lo contrario: tres cámaras distintas, tres estilos de sombra, escalas que no cierran.

Reglas de "clean" para ERIS:
1. **Un solo origen de arte**: todo sale del mismo generador con la misma cámara y la misma luz. Nada de packs mezclados.
2. **Pocos props**: barriles, cajas y carteles solo donde cuentan algo (frente al herrero, en el mercado). El resto, calle libre.
3. **Suelo continuo**: adoquín en las calles, una sola textura con variantes sutiles. Pasto o nieve solo fuera de la muralla.
4. **Pocos edificios, grandes y legibles**: cada uno se lee de lejos ("eso es el herrero"). Nada de relleno.
5. **Sombra única**: luz desde la izquierda de la pantalla (cara izquierda iluminada, derecha en sombra), igual para todo.

## 3. Dirección de arte: edificios propios renderizados en Blender

Se modelan **desde cero con geometría simple y materiales procedurales** (cajas, techos a dos aguas, pirámides, piedra/tablas/tejas generadas por nodos) y se renderizan con la misma cámara ortográfica. Es el mismo método con el que Flare hizo sus mapas, pero sin depender de arte ajeno: **no hay licencia que atribuir ni heredar**, a diferencia de re-renderizar piezas de Clint Bellanger o rubberduck (CC-BY-SA, que obliga a compartir igual lo derivado). Esos packs quedan solo como **referencia de proporciones**, no como fuente.

Se renderiza a **192×96 por celda** (HD) y se baja a la mitad para el cliente actual; cuando se prenda el modo HD (`plan-hd`, doc del proyecto claude.ai) las ciudades ya están listas, no hace falta rehacerlas.

### 3.1 Herramienta y cámara (hecho, C1)

`tools/src/iso3d/city.py` (usa `bpy` por pip, corre en CPU, no hace falta instalar Blender ni tener GPU). Convenciones iguales al formato de `meta.json → buildings`: `w = (fw+fh)·48`, ancla en la esquina **sur** de la huella, abajo del PNG, en `x = fw·48`.

**Hallazgo: la cámara de `iso3d/render.py` estaba mal.** El README decía que la elevación tenía que ser `atan(1/2)` = 26,565°. Con cámara ortográfica el rombo de una celda mide ancho/alto = 1/sin(elevación): a 26,565° da **2,238:1** y a **30° da 2,000:1 exacto** (medido renderizando un rombo; los 26,565° son el ángulo de las *líneas* en pantalla, no el de la cámara). Todo lo que se haga con la cámara vieja queda ~11 % más aplastado que el piso. `render.py` y el README ya están corregidos a 30°. Como todavía no hay ningún sprite de producción hecho con esa cámara, no hay nada que rehacer.

Verificación (`python3 -I tools/src/iso3d/city.py`): para huellas 5×4, 7×5, 3×3 y 6×9 el rombo toca los bordes del PNG donde el formato promete (izquierda x=0, derecha x=W-1, esquina sur en `(fw·96, H-1)`, tolerancia 2 px) y mide 1,997-1,999.

### 3.2 Pipeline

1. `city.py` arma la escena (cámara, sol, ambiente), el modelo (funciones `caja`, `techo_dos_aguas`, `techo_piramide`, materiales `piedra`/`tablas`/`tejas`/`adoquin`, con `nieve=True` para Vhar) y renderiza con Cycles (48 muestras + denoise; 24 en el lote).
2. Sale `<nombre>.png` (HD), `<nombre>_1x.png` (lógico) y `<nombre>.json` con `{w, h, ax, ay, fw, fh}`.
3. `city_edificios.py --exportar` deja el `.webp` en `apps/client/public/assets/` y suma `{w, h, ax, ay, fw, fh}` a `meta.json → buildings`, igual que los `sm_*`/`vh_*` viejos; el cliente y la geometría no cambian. Los edificios se registran en `PRERENDER_BUILDINGS` (`packages/world/src/town.ts`) con su huella y su puerta.
4. Se revisa con `maps:render` (con `SIN=` para omitir piezas y comparar antes/después en la misma vista).

Todo corre en el workspace de Claude: Román no tiene que instalar nada para ver avances.

### 3.3 Identidad por nación: mismo modelo, materiales distintos

Un solo set de modelos y dos juegos de materiales: las dos ciudades comparten planta (como Aresden y Elvine) y se reconocen al instante por los materiales y el clima. La segunda cuesta casi nada.

| | Solmar (villa) | Vhar (ciudadela) |
|---|---|---|
| Piedra | arenisca clara, cal | basalto gris oscuro con escarcha en las juntas |
| Techos | teja roja y madera | pizarra negra con nieve acumulada |
| Madera | roble claro | madera oscura, vigas con hielo |
| Metal | bronce | hierro negro |
| Color de nación | azul y dorado (estandartes, toldos) | rojo y negro |
| Vegetación | árboles frondosos, pasto | pinos y árboles pelados, sin pasto |
| Suelo exterior | pasto y tierra | **nieve** (la de los mapas de nieve de Flare) |
| Luz | día claro, cálida | día frío, azulada; antorchas y ventanas encendidas |
| Muralla | piedra con almenas, portón de madera | muralla alta con torres, portón de hierro |

La nieve va como capa de material (se mezcla en las caras que miran hacia arriba), no como modelos aparte.

## 4. Distribución: esquema Aresden/Elvine con menos piezas

Ciudad amurallada, **plaza central** que es el mercado de jugadores, los servicios alrededor a pocos pasos, y las salidas en los bordes. Las dos usan **la misma planta** (con las mismas puertas), para que quien cambie de nación no se pierda; cambian los materiales, el clima y el lado del portón: este en Solmar y sur en Vhar. No se espejó porque un espejo pediría sprites con las puertas en el otro lado.

### 4.1 Qué se dibuja (y nada más)

Los **8 edificios con función**, que ya existen en `VILLA_BUILDINGS` / `VHAR_BUILDINGS` y **se conservan con sus claves, mapas interiores y puertas** (así no se rompen interiores, NPC ni tests, solo cambian fachada y posición):

| Clave | Edificio | Qué hay adentro hoy |
|---|---|---|
| `ayuntamiento` | Ayuntamiento / Concejo | Capitán (quests) y Subastador/a |
| `templo` | Templo / Santuario | Sanador/a (solo frases; el revivir es `TEMPLE_RESPAWN`) |
| `joyeria` | Joyería / Orfebrería | Joyero/a |
| `tienda` | Tienda / Bazar | Mercader y Alquimista |
| `herreria` | Herrería / Forja | Armero (mejora de ítems) y Armadurero |
| `deposito` | Depósito / Cámara | Depositario/a |
| `cuartel` | Cuartel | 3 guardias |
| `torre` | Torre de magia | Archimago/a (hoy "Próximamente") |

Más el resto de lo que hace falta para que se lea como ciudad, **sin llegar a 20 piezas**:
- **Muralla** con 4 torres y **un portón** a los Campos de Sal (este en Solmar, sur en Vhar). Solmar suma el portón del puerto en el sur.
- **Portal de Frontera** (waypoint) en la plaza.
- **Dos fuentes** en la plaza.
- **3 casas** de relleno (de 54 y 92 a 3), solo para dar escala y vida.
- Faroles, banderas y flores del kit viejo (Screaming Brain Studios y Flare): quedan para esta versión.

Fuera por ahora: sede de clanes y casa de subastas separada (las subastas ya funcionan dentro del Ayuntamiento; los clanes son post-beta).

### 4.2 Plano (hecho: `packages/world/src/solmar/city.ts`)

**58×58 celdas** (**64×64 en Solmar**, por el mar), recinto de **38×38** (x e y de 10 a 47) y 8 celdas de bosque o nieve afuera. Un solo constructor, `buildCity`, arma las dos ciudades; `villa.ts` y `citadel.ts` solo eligen materiales, guardias y lado del portón. Coordenadas del juego: x crece hacia abajo-derecha de la pantalla e y hacia abajo-izquierda.

| Pieza | Esquina norte (x, y) | Celda de la puerta |
|---|---|---|
| Plaza de adoquín (14×14) con anillo de calle de 2 celdas | plaza 23-36, anillo 21-38 | — |
| Templo 7×7 | (18, 14) | (21, 21) |
| Ayuntamiento 9×6 | (26, 15) | (30, 21) |
| Torre de magia 4×4 | (36, 17) | (38, 21) |
| Depósito 6×5 | (42, 16) | (44, 21) |
| Tienda 6×5 | (15, 23) | (21, 25) |
| Joyería 5×5 | (16, 30) | (21, 32) |
| Cuartel 8×6 | (13, 35) | (21, 38) |
| Herrería 7×5 | (41, 23) | (44, 28) |
| Casas 4×4, 4×4 y 5×4 | (24, 40), (24, 44), (33, 40) | sobre la avenida sur |

- **Portal de Frontera** en (29, 27), aparición en (29, 32) y portal a los Campos de Sal en (34, 32), todo dentro de la plaza.
- **Calles**: avenida oeste (y 28-29), avenida este (x 39-47, y 28-31), avenida sur (x 28-31, y 39-47) y calle noreste (y 21-22) para el depósito. Las puertas dan al anillo de la plaza o a una avenida.
- **Portón**: el paso mide 2 celdas. Solmar: muralla este (x = 48), paso en y 28-29 y camino hasta (56, 28). Vhar: muralla sur (y = 48), paso en x 28-29 y camino hasta (28, 56).
- **Puerto de Solmar** (solo ahí): segundo portón en la muralla sur (paso en x 28-29) sobre la avenida sur, playa de arena de y 50 a 53 o 55, mar al sur (costa irregular, tres profundidades con espuma en la orilla), muelle de tablones de 4 celdas (x 28-31, y 51-61) con remate en T, bolardos, cajas y 4 botes. La playa solo lleva piedras.
- **Fuentes** en (24, 25) y (33, 25). **Guardias**: 5 por ciudad, todos sobre calles (portón, plaza, avenida oeste y calle noreste, o la fragua en Vhar).
- Desde cualquier edificio al resto hay menos de 20 celdas.

### 4.3 Interiores

Ya existen y se conservan tal cual: los NPC con servicio viven adentro, y la ciudad solo tiene guardias afuera. Lo único que cambia es la **puerta**: la de cada sprite sale de la misma especificación (`PRERENDER_BUILDINGS`, lado e índice) que usan `villaDoor(k)` / `vharDoor(k)`, así que el rombo de entrada y la puerta dibujada coinciden.

## 5. Plan de trabajo (entra al MVP)

| # | Paso | Tamaño | Estado |
|---|---|---|---|
| C1 | Cámara 2:1 verificada y ancla por píxeles; herramienta `city.py` con materiales, geometría y salida en formato `meta.json` | S | **Hecho (3/11)** |
| C2 | **Piloto de 3 edificios** (herrería, una casa, tramo de muralla con portón) en Solmar y Vhar nevada, con luz y sombra, puestos al lado de arte de Flare y de las ciudades viejas con `maps:render`. **Acá se decide si el camino sirve** | M | **Hecho (3/11), falta el OK de Román** (resultado abajo) |
| C3 | Render por lotes de los edificios (`city_edificios.py`): PNG + JSON, y `--exportar` los pasa a webp del cliente y a `meta.json` | S | **Hecho (3/11)** |
| C4 | 17 sprites por nación: los 8 edificios con función, 3 casas, torre de muralla, tramos de muralla, 2 portones y fuente | L | **Hecho (3/11)**, con lo pendiente de §5.1 |
| C5 | Mapa de Solmar: `buildCity` con la planta de §4.2; puertas desde `villaDoor`; tests migrados | M | **Hecho (3/11)** |
| C6 | Mapa de Vhar: misma planta, materiales de nieve, portón sur | S | **Hecho (3/11)** |
| C6b | Costa de Solmar: playa, mar, muelle, botes y portón del puerto | S | **Hecho (3/11)** |
| C7 | Revisión a ojo en el juego, Normal y Alto; pulido de sprites y props | S | **Pendiente (Román)** |
| C9 | Campos de Sal por nación y atajos que se abren al llegar a pie (§8) | M | **Hecho (3/11)** |
| C8 | Borrar fachadas y kit viejo (`sm_*`, `vh_*` y sus entradas en `town.ts`/`atlas.ts`), actualizar `CREDITS` | S | Pendiente |

### 5.1 Resultado del piloto C2 (3/11)

Código: `tools/src/iso3d/city_piloto.py` (herrería 7×5, casa 4×3, muralla con portón 6×2, en Solmar y en Vhar nevada). Seis sprites, ~17 s cada uno en CPU.

- **Escala y ancla calzan.** Puestos en la misma huella que la herrería y el depósito viejos del mapa de Solmar (`SIN=sm_herreria,sm_deposito npx tsx src/town/render.ts ...`, opción nueva de `maps:render`), encajan en la grilla. La puerta mide ~85 px lógicos, igual que las de los edificios actuales, así que la escala respecto de los personajes se mantiene.
- **Se ven mucho más limpios y legibles** que las cajas actuales: volúmenes claros, techo a dos aguas, sombra única hacia la derecha. La comparación justa será con la ciudad entera, porque hoy conviven con el resto del kit viejo.
- **A pulir en C4:** techo de Solmar algo salmón (llevarlo a terracota más profundo); la piedra parece lajas y no hiladas de bloques; la nieve de Vhar cubre todo el techo y se pierde la pizarra (dejar que asome); el hogar de la fragua parece una bandeja; la identidad rojo y negro de Vhar casi no se nota; faltan los tiles de suelo con nieve y el adoquín propio.
- **Puertas:** en el piloto la puerta quedó corrida respecto del rombo rosa de entrada. Resuelto en C4: la puerta de cada sprite se coloca desde la misma especificación (lado e índice) que usan `villaDoor(k)` / `vharDoor(k)`, no a ojo.

### 5.2 Resultado de C3-C6 (3/11)

- **Render**: `python3 -I tools/src/iso3d/city_edificios.py <dir> <solmar|vhar>` genera los 17 sprites de una nación; con `LOGICO=1 MUESTRAS=24` sale directo a la resolución del cliente (~15-20 s por sprite en 2 núcleos, ~10 min las dos naciones). Sin `LOGICO` renderiza a 192×96 por celda (HD) y baja a la mitad. `--exportar <dir> <nación>` deja los `.webp` en `apps/client/public/assets/` y suma las medidas a `meta.json`. 34 webp, 1 MB en total.
- **Integración**: los sprites se registran en `PRERENDER_BUILDINGS` (`town.ts`) con su huella y su puerta; el atlas viejo (`tools/src/town/atlas.ts`) los saltea. `solmar/city.ts` arma el mapa; `villa.ts` y `citadel.ts` quedaron en ~70 líneas cada uno y conservan los mismos exports (`VILLA`, `VILLA_BUILDINGS`, `villaDoor`, `VHAR`...), así que `maps.ts`, los interiores y los NPC no cambiaron.
- **Verificación**: la suite del servidor pasa (393 tests, 392 ok y 1 salteado, el mismo salteado de antes) y `tsc` limpio en `server`, `client`, `world` y `tools`. Los únicos tests que hubo que tocar son los dos que afirmaban `size === 128`. Los vínculos de puerta (`villa_a_templo`...) validan en el grafo, así que las puertas nuevas son caminables y alcanzables.
- **Tres cosas que aparecieron**: (1) las molduras finas de la muralla quedaban en el mismo plano que el muro y se renderizaban negras; se retrajeron 0,02. (2) Los faroles de las esquinas del anillo estaban sobre las puertas del templo, la torre y el cuartel y el validador del grafo lo detectó; ahora el constructor respeta las celdas de puerta. (3) El cliente carga todos los atlas `flare_*` al arrancar (no por mapa), así que el suelo de nieve de Flare funciona en la ciudad; solo `maps:render` no los cargaba y se corrigió.
- **No verificado**: el juego corriendo en el navegador. Todo se revisó con `maps:render` y con los tests del servidor.

## 6. Pendiente

- **OK de Román mirando el juego** (C7). Si algo no gusta, es barato de cambiar: son parámetros en `city_edificios.py` y `city.ts`.
- **Pulido de sprites** (lista en §5.1): salmón del techo, piedra de lajas, nieve de Vhar muy blanca, hogar de la fragua, identidad rojo y negro de Vhar, adoquín y suelo propios.
- **Props del kit viejo** (faroles, banderas, braseros) y árboles de Flare conviven con los edificios nuevos; los pelados de la nieve son enormes y se dejaron ralos. Si se quiere unidad total, hacer los props en Blender igual que los edificios.
- **Modo Alto (HD)**: regenerar los sprites sin `LOGICO` y sumarlos a `assets/hd/` cuando se prenda el modo (`plan-hd`).
- **Nombres** de las ciudades: se decide mirando el juego.
- **Licencias**: el arte nuevo es propio (sin atribución). Está anotado en `LICENCIAS_AUDITORIA.md`.

## 7. Auditoría de NPC (primera pasada, 3/11)

Se listaron los NPC de las dos ciudades y sus interiores (`t.npc(...)` en `solmar/villa.ts`, `vhar/citadel.ts` y los dos `interiors.ts`) y se buscó, para cada id, si algo del código lo usa. **El rol sale del prefijo del id** (`roleOf = id.split('_')[0]`, `economy.ts:134`): un NPC con un prefijo que no está en `SHOPS` no hace nada. Son **38 NPC, 19 por ciudad**.

| Rol (prefijo) | Solmar / Vhar | Dónde | Qué hace | Estado |
|---|---|---|---|---|
| `mercader` | Ilario / Orlak | Tienda | Pociones (`SHOPS`) | Con servicio; tests: `calidad`, `villa`, `vhar` |
| `alquimista` | Celeste / Vexa | Tienda | Tienda | Con servicio; ningún test lo nombra |
| `armero` | Teodoro / Kragen | Herrería | Mejora de ítems | Con servicio; tests: `upgrade`, `calidad` |
| `armadurero` | Evaristo / Dovan | Herrería | Tienda de armaduras | Con servicio; ningún test lo nombra |
| `joyero` | Marisol / Sethra | Joyería | Tienda | Con servicio; script de economía |
| `depositario` | Bruno / Ilsa | Depósito | Depósito de cuenta | Con servicio; `deposit.test` (genérico) |
| `subastador` | Rosalba / Morvek | Ayuntamiento | Subastas | Con servicio; tests: `villa`, `vhar`, `auction` |
| `capitan` | Aldric / Kharos | Ayuntamiento | Quests (marca "!" en el cliente) | Con servicio; `quests.test`. **Un solo dador de quests por ciudad** |
| `sanador` | Celina / Nerya | Templo | **Solo frases.** El revivir es `TEMPLE_RESPAWN`, no el NPC | Decorativo, sin función |
| `mago` | Ondina / Zorvak | Torre | **"Próximamente"**, sin servicio | Pendiente de los kits de clase |
| `guardia` | 9 por ciudad (5 afuera, 1 Ayuntamiento, 3 Cuartel) | | Frases | Decorativo (`guardia_s4/s5`, `guardia_v4/v5` no los usa nada) |

**Dudas que hay que cerrar (no verificado todavía):**
1. **Ids repetidos entre el mapa viejo y las ciudades nuevas.** `packages/world/src/cities.ts` define NPC con los mismos ids (`mercader_s`, `guardia_s1`, `depositario_s`…) pero otros nombres y posiciones (por ejemplo "Depositario Anselmo" vs "Depositario Bruno"; `guardia_s1` es "Guardia del Faro" en uno y "Guardia del Portón" en la otra). Por las coordenadas chicas parece el mapa viejo de 40×40 (Tierras de Solmar). Si algún test o script ubica al NPC por id en el mapa equivocado, está probando el mapa viejo. Se resuelve con el punto 7 del roadmap (borrar Tierras de Solmar).
2. **Servicios sin test que los nombre**: alquimista, armadurero y depositario. Funcionan por rol, pero nadie verifica que en las ciudades nuevas estén en su lugar.
3. **El cliente decide qué abre cada NPC por rol** (`main.ts` ~2550): hay que confirmar que `sanador` y `mago` no caen en una rama por defecto rara y que la dialogación `_v` (Vhar) usa el texto de Vhar.
4. **Alcance**: `TALK_RANGE` es 2,6 celdas; los NPC adentro de interiores chicos pueden quedar contra una pared o en una celda bloqueada. Falta chequear que cada NPC sea alcanzable desde la puerta.

**Faltan NPC que el roadmap necesita:** maestro de arena (cola 1v1/2v2, `PARTY_Y_ARENAS.md`), teletransporte por destino (hoy el Portal es un waypoint, no un NPC), cambio de nación y reputación (Municipalidad, post-beta), misión diaria y tienda de fichas (post-beta), más dadores de quests si el MVP quiere que "las quests guíen todo" (`mvp-dungeons-llaves-quests`, doc del proyecto claude.ai), y entrenador de hechizos (Torre) cuando estén los kits de mago y healer.

**Tareas:**

| # | Tarea | Tamaño |
|---|---|---|
| N1 | Test `ciudades.test.ts`: cada ciudad tiene los 8 edificios con interior; cada interior tiene sus NPC con rol en `SHOPS` (o en la lista de decorativos); ids únicos por mapa; ningún NPC en celda bloqueada; cada NPC alcanzable desde la puerta y dentro de `TALK_RANGE` de una celda caminable | S |
| N2 | Resolver las dudas 1-3: ids duplicados con `cities.ts`, rama del cliente para `sanador`/`mago`, texto de Vhar | S |
| N3 | Decidir qué hacen `sanador` (¿cura gratis? ¿guarda el punto de revivir?) y `mago` (depende de `kits-de-clase` (doc del proyecto claude.ai)) | S |
| N4 | Sumar los NPC que faltan según prioridad del MVP: dadores de quests extra y maestro de arena primero | M |
| N5 | Con el plano nuevo (C5-C6): reubicar guardias y NPC y volver a correr N1. Los guardias ya están sobre calles (el del puerto y el vigía del faro viejos se reemplazaron: no hay faro, y el muelle nuevo todavía no tiene guardia); falta N1 | S |

## 8. Campos de Sal por nación y atajos (3/11)

Pedido de Román: los primeros niveles de leveo tienen que quedar **lejos** de las ciudades, como en Helbreath, y separados por bando. Antes las dos ciudades daban a un mismo Campos de Sal, a un paso del portón o del portal de la plaza.

**Qué hay ahora**
- **Dos campos de entrada**: `campos_de_sal` (Solmar, el de siempre) y `campos_de_sal_vhar` (Vhar), copias exactas del mismo mapa de nivel 1-2 (60×60, tier 1, mismas celdas y mismos pits) con las zonas renombradas ("Puesto goblin (Vhar)"…) porque el validador no admite el mismo nombre de zona en dos mapas. La copia se arma al cargar (`flare/index.ts`) a partir de los datos de `salted_field`, sin generar archivos nuevos.
- **Cada ciudad sale al suyo**: el portón a pie (`villa_a_llanos`, `ciudadela_a_legacy`) y el atajo de la plaza llevan al campo de su nación, y el portal de vuelta de cada campo (`campos_a_ciudad`, `campos_de_sal_vhar_a_ciudad`) lleva a su ciudad. Antes el único retorno llevaba a Solmar, incluso para Vhar.
- **Se juntan en el Bosque de Piedra**: el campo de Solmar entra por el borde oeste de siempre, `(1, 8)`; el de Vhar, por una salida propia en `(1, 6)` (llegada `(2, 6)`). Del campo al bosque se camina por el borde, como antes (los dos campos tienen su salida en `(57, 13)`, a unas 46 celdas de la entrada).
- **Cada nación entra solo a su campo**: los enlaces del Bosque de Piedra a cada campo y el portal de vuelta llevan `gate.faction`, así que un personaje de Vhar no puede entrar al campo de Solmar (ni a su ciudad por el portal de vuelta), y al revés. Es un requisito nuevo de los enlaces (`LinkGate.faction`, con `PortalProgress.faction`).
- **Los atajos se abren al llegar a pie una vez**: el portal de la plaza (`villa_a_campos`, `ciudadela_a_campos`) lleva `gate.unlocked: 'campos_de_sal'` y el paso 0 del Portal de Frontera es `onFoot` (no se abre por nivel). Al entrar a cualquiera de los dos campos el server (en `attachPlayer`) abre `campos_de_sal` en el personaje y lo guarda (`econ.u`), le avisa ("Portal desbloqueado: Campos de Sal") y desde ahí los dos atajos funcionan. El resto de las zonas del Portal de Frontera siguen abriéndose por nivel. Los personajes que ya tenían el portal abierto lo conservan.
- **Misiones**: la de matar goblins en Campos de Sal cuenta también en el campo de Vhar (`questMap` en `quests.ts`).

**Cómo se prueba**: `apps/server/test/campos.test.ts` (mismo mapa y zonas distintas, enlaces al Bosque de Piedra, restricción por nación, portal de vuelta, atajos y mapa por facción, misión) y `salidas.test.ts` (a pie desde cada ciudad se llega al Bosque de Piedra, al Cañón goblin y al Pantano, y nunca al campo de la otra nación); el desbloqueo de punta a punta está en `villa.test.ts`.

**Lo que se ve con el mapa armado**: Vhar pasó de ser alcanzable solo desde el mapa viejo de pruebas a serlo desde el mundo real (campo de Vhar → Bosque de Piedra → campo de Solmar).

**Limitaciones y decisiones abiertas**
- El campo de Vhar es de pasto, no de nieve: es la misma hoja de tiles de Flare (`grassland`). Si se quiere nevado hay que rehacer los tiles con la hoja `snowplains`, que tiene otra numeración.
- Distancia real: la entrada del campo (a la que llega la ciudad) está a unas 46 celdas de su salida al Bosque de Piedra, con tres pits en el medio. Si se quiere más lejos todavía, la forma barata es mover la llegada de la ciudad al otro extremo del campo; la cara es sumar un mapa-camino por nación.
- Los dos campos comparten tier, nivel y tabla de mobs; si más adelante cada nación tiene sus propios mobs, es cambiar `SALTED_FIELD_VHAR`.
