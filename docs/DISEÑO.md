# ERIS — diseño: qué es el juego (fuente de verdad)

Nombre provisorio: **ERIS** (el repo se llama `frontera-de-naciones`).

Última actualización: 5/11/2026 mediodía (sesión de diseño con Román). **Este doc dice qué ES el juego: las decisiones cerradas.** Los demás docs de esta carpeta son notas de implementación y estado; cuando contradicen a este, manda este y se corrige el otro. Toda sesión nueva arranca leyendo este archivo.

Qué NO va acá: estado de implementación, pasos, tests, números finos de balance (esos viven en el código y en la sim). Acá van las reglas que no cambian de una sesión a otra.

## 1. En una frase

MMO 2D isométrico, HD y limpio (look Dreadmyst/Flare, nada retro-pixel), con el PvP y la lógica de Helbreath (dos naciones, paralizar, casteo fijo, golpe direccional), mazmorras con mecánicas estilo Dreadmyst, y progresión de equipo estilo Albion (tiers y calidades). PC, navegador. Público, gratis, server autoritativo.

Referencias: Helbreath (PvP, naciones, casteo, items), Dreadmyst (mazmorras, look clean, tamaño de mobs), Albion (tiers de zona), Argentum Online (proyectiles/aim), Nox (cámara y arte).

## 2. Mundo y mapas

- **Un solo mundo compartido, un solo server.** No hay mapas espejo por nación ni shards. Lo único que se duplica son las dos capitales y el primer campo de nivel 1-2 de cada nación (se juntan en el segundo mapa; `CIUDADES.md` §8). Esa copia es por identidad (salís de tu ciudad a tu campo), no por gameplay, y vale solo mientras sea barata: **mismo mapa, otra paleta, NPCs y quests por data**. El día que haya que escribir algo dos veces, se fusiona.
- **Dos naciones:** Solmar (bosque y mar) y Vhar (nieve). Se elige al crear el personaje. Las parties son de una sola nación.
- **Tiers de zona:** 12 tiers de 10 niveles, tope **120**. El tier es una etiqueta del mapa (`MapDef.tier`): fija el nivel de los mobs, la banda de ítems que sueltan, el nivel de la puerta y la mazmorra que le corresponde. Agregar un mapa es asignarle un tier.
- **Mapas de leveleo: pocos y grandes.** Un mapa puede cubrir dos tiers (ej. "Mapa 2, niveles 8-20"). Meta: unos 6 mapas abiertos para 1-120 más el mapa central. Son transitorios (el jugador pasa ~5 h en cada uno): livianos en quests y arte.
- **Anatomía de cada mapa abierto:** un **puesto seguro** (entrada, vendedor, encargos, teleport), una **zona abierta** (mobs normales) y una **zona roja** (PvP entre naciones, con los mejores pits del mapa y materiales exclusivos). Lo que cambia por tier es la proporción:
  - Niveles 1-60: sin zona roja.
  - Mapa 61-80: zona roja chica, para ir probando.
  - 81 en adelante: todo rojo salvo el puesto.
- **El PvP es un atributo de región, no de mapa** (`pvp` por zona dentro del `MapDef`; hoy es por mapa, se cambia).
- **Mapa central** ("Middleland"): **nivel mínimo 100 para entrar** (para que no entren a que los maten), pits de 101 a 120, 100 % PvP, los mejores spots del juego y los jefes de mundo cuando no salen errantes. **Sin puesto seguro adentro**: la única salida es el recall (H, bloqueado 10 s tras daño). Dos entradas, una del lado de cada nación. Grande (~250×250, como el Gran claro de prueba).
- La zona roja no da bonus artificial de exp: tiene los mejores mobs del mapa y materiales que solo caen ahí. Eso alcanza.
- **Desbalance de naciones:** cuando el 80+ sea compartido, si una nación dobla a la otra en población la chica no puede subir. Hay que tener un compensador listo (bonus de exp/oro a la nación con menos gente online). Diseño pendiente, pero es obligatorio antes de abrir.

## 3. Progresión

- **Tope 120. Meta: ~30 horas hasta el tope** matando un mob por vez (1-10 en menos de 1 h). La curva actual está en ~60 h y se corrige (`killsToLevel`, `targets.ts`, sim `sim:pve --horas`).
- **Las 30 horas son el tutorial largo; el juego es el endgame**: mapa central, mazmorras, calidades, +N, sets, arenas. Ahí va el esfuerzo de contenido.
- Exp: solo grindeo. Misiones y jefes casi no dan exp; dan oro, materiales y llaves.
- Morir: −5 % de la exp del nivel.

## 4. Clases y stats

- **Cuatro clases en el MVP: paladín, clérigo, mago y arquero.** (En el código: `paladin`, `clerigo`, `mago`, `arquero`; el arquero está registrado sin kit y no se puede crear todavía.) Roles: paladín = melee/tank, dueño del golpe direccional y de los controles duros; clérigo = sustain y soporte, existe por las mazmorras; mago = daño mágico, dueño del `ground` (área y predicción); arquero = daño físico a distancia, dueño del `projectile` (aim en línea). Cuatro clases son 10 matchups de PvP: se balancean con `sim:pvp` después, no antes. No hay berserk: la Furia es un hechizo que da stats ofensivos, sin quitar defensa ni vida.
- **4 stats:** Fuerza (daño físico, requisitos de armas pesadas), Vitalidad (vida), Destreza (precisión, evasión, requisitos de arcos/armas livianas), Magia (maná, daño mágico, requisitos de hechizos). **Se elimina Inteligencia** (solo daba crit mágico, y el crit mágico se saca).
- Stats iniciales fijos por clase. **3 puntos por nivel, a mano.** Reset: gratis hasta nivel 10, después por oro (`200 × nivel`), y un **ítem de reset en la tienda de gemas** (comodidad, no poder).
- **Kits** de habilidades por clase, completos hacia el nivel 60.

## 5. Combate

- **Melee direccional** (pegás al tile de adelante; si el otro se movió, pegás al aire). Movimiento: caminar (castea) o correr (no castea), sin stamina. Tope duro de velocidad en combate.
- **Casteo fijo** por hechizo, igual para todos (0,75 / 1 / 1,5 / 2,4 s). Un paso lo cancela.
- **Tres tipos de hechizo/ataque** (es data del hechizo, no código): `target` (clickeás al enemigo, pega sí o sí, efecto moderado), `ground` (cae en el tile elegido al terminar el casteo, se esquiva, daño alto, indicador en el piso) y `projectile` (sale en la dirección apuntada y pega al primero que toca, lento para que se vea venir). Ahí vive el aim.
- **Miss:** solo físico (precisión de Destreza contra evasión de Destreza). **La magia nunca falla**: se mitiga con RM.
- **Defensas: DF (físico) y RM (mágico)**, con rendimiento decreciente. Topes de atributos **que suben con las semanas del server** (`SERVER_EPOCH`): arrancan bajos y escalan hasta 60/75. Se ve en el juego ("Tope actual DF 45 / RM 55 · sube el lunes") y la sim corre en cada escalón.
- **Crítico:** solo físico y **solo en PvE**. En PvP no hay crit; el tope de 25 % de la vida por golpe hace ese trabajo.
- **PvP:** ningún golpe saca más del 25 % de la vida máxima; un combo completo saca 40-55 %; 1v1 de 20-40 s. Sin abridor con Furia. Pociones con bloqueo de 60 s. Lo mide `sim:pvp` y falla el CI si se va de rango.
- **Control (paralizar, congelar, aturdir):** rendimiento decreciente por tipo en 15 s (100 / 50 / 25 % / inmune). RM y resistencia acortan. Además, **Remover sobre uno mismo** (todas las clases, cast 1,5 s): paralizado no te quedás mirando; el que te paralizó tiene esa ventana y nada más. Remover a otro es más rápido (1 s).
- **Tabla de ataque en orden fijo:** ¿pega? → control y efectos tiran su resistencia → crítico → mitigación y escudo. Vale igual en PvE y PvP.
- Sin recuperación de vida/maná por ítems con timing (estilo HB): se levelea, se toma poción o se medita/Segundo aliento.

## 5b. Loop de PvP (qué ganás y qué perdés)

- **Solo entre naciones.** No hay PvP intra-nación fuera de la arena, así que no existe criminal ni cazador.
- **Zem**: material que cae de **todos los mobs al 7-10 %**, en cualquier mapa. No es objetivo de farmeo, se junta jugando. **Reemplaza a la piedra de forja**: es el material de la mejora +N. Sin tope para llevar encima.
- **Al morir en PvP** se cae **todo el zem que llevás encima** y **el 10 % del oro de la bolsa, con tope (`nivel × 100`)**. El equipo no se cae nunca. Lo que cae queda 30 s para el que mató (o su party), después es de cualquiera.
- **Al morir contra mobs** no se cae nada.
- **La forja usa solo el zem del depósito** (se hace en ciudad). Depositar es la decisión; la bolsa llena es siempre riesgo.
- **EK** permanente por kill, y **contribución** a la nación que se gasta en una tienda propia (tinturas, títulos, set visual, consumibles de PvP; nunca poder).
- **De 81 a 120 cuenta todo kill**, sin regla de diferencia de nivel. El mismo jugador cuenta una vez cada **4 horas**.

## 6. Ítems

- **8 slots:** arma, armadura, cabeza, guantes, botas, amuleto, dos anillos. Capa y alas, a futuro.
- **7 bandas de ítems** (catálogo de únicos y sets) estiradas sobre 1-120 (~17 niveles por banda). No se hace un set cada 10 niveles: el ítem dura porque se mejora con +N.
- **Calidad** se sortea al caer: Común / Verde / Azul / Violeta / Dorado. Define cuántos **extras al azar** trae (0/1/2/2/2, los altos con mejor tirada) y hasta dónde se mejora (+1/+3/+5/+8/+11). El poder base lo da el catálogo (ilvl); la calidad no lo toca. Dorado solo de jefes y trae efecto especial.
- **Extras** = los atributos del juego (crit, robo de vida, hp, mp, daño mágico, exp, veneno, resistencia a parálisis, DF, RM, daño plano). Topes del server por atributo.
- **Mejora +N**: +4 % por nivel sobre los stats base, con chance de fallo (33 % de arranque, estilo HB). Material: **zem** (ver 5b). Hasta +5 hoy; +6 a +11 cuando haya números reales. **Ningún ítem se destruye nunca**; de +6 en adelante al fallar baja un nivel.
- **Reforja**: re-tira un extra elegido; piedras de reforja solo de jefes de mazmorra.
- **Sets de nación** (8 piezas, bonos a 2/4/6/8) solo en mazmorras, prefiriendo la pieza que te falta.
- **Botín personal:** cada jugador tira su propio drop; nada de ninjas. En party, lo que cae al piso queda 30 s para la party y se reparte solo entre los cercanos.
- Ningún ítem se destruye por bolsa llena (cae al suelo). Sin tope de oro.
- Runas/sockets: en diseño, no en el MVP.

## 7. Mazmorras

- **Instancia por party** (hasta 4), una vida por corrida, nada reaparece adentro, escalado por cantidad de jugadores, élites.
- **Mecánicas estilo Dreadmyst:** cada mob/jefe pide hacer algo (dónde pegarle, qué cortar, qué esquivar). Es lo que justifica al healer. Se arman desde un **catálogo de mecánicas como data** (en definición; Román revisa los videos de Dreadmyst). **Fallar una mecánica de jefe te mata o te deja al borde y te remata**; una vida por corrida lo hace valer.
- **Llaves crafteadas** con materiales que caen en los pits del mismo tramo (nunca contenido bajo para un jugador alto). Encargo del día devuelve una llave. Una llave = una corrida.
- **7 mazmorras, una por banda de ítems** (D1 nv 11, D2 23, D3 48, D4 63, D5 77, D6 98, D7 116); D1 y D2 son el tutorial.

## 7b. Quests

- **Nunca son la forma de subir**: dan oro, materiales, llaves y un ítem de arranque; la exp es simbólica (20 % de un nivel por misión).
- **Camino del aventurero**: una cadena de ~26 misiones, una por mapa, del nivel 1 al 116, que te lleva de la mano hasta la puerta del endgame (el Gran Verdugo) y ahí te suelta. Al consolidar mapas 51-120, se re-mapea.
- **Encargos del día**: sin NPC, se abren por nivel, tope de 3 cobrados por día, reinicio 6:00 Argentina. El de la mazmorra de tu tramo devuelve una llave. El de PvP ("Defensa de la frontera") existe solo **desde nivel 61** y pide ganar una pelea en zona roja.
- Cuentan para toda la party cercana (en Dreadmyst no contaban y la gente dejaba de agruparse).

## 8. Economía

- **Oro** (todo lo del juego) y **gemas** (pagas). Las gemas venden **comodidad y aceleración con tope**, nunca poder: espacios, tinturas, apariencias, cambio de nombre/nación/stats, pociones de exp/oro temporales y no acumulables. Nada que sirva en la arena. Todo lo que se vende se lista públicamente en el juego.
- Sumideros de oro: mejora +N, reforja, oferta del día, tarifas de subasta, reset de stats.
- Casa de subastas con oro. Intercambio y Dar entre jugadores.
- Todo ítem lleva **origen** y hay registro de movimientos para rastrear qué entra y de dónde.

## 9. Arte y presentación

- 2D isométrico pre-renderizado, HD y "clean": **un solo origen de arte** por mapa (misma cámara, misma luz, misma escala), pocos props, suelo continuo, pocos edificios grandes y legibles. Nada de packs mezclados.
- Cuerpo humano: Character Creator 2D. Monstruos: pipeline propio 3D → sprites o packs; los packs 3D grandes son jefes.
- Íconos de habilidades e ítems propios, con relieve y efecto; nada "planito".
- Pantallas de entrada estilo HB: login, selección (hasta 3 personajes por cuenta), creación (nación y clase).
- Licencias: se auditan al final (`LICENCIAS_AUDITORIA.md`), pero no se publica nada sin eso.

## 10. Decisiones tomadas que NO se vuelven a discutir

1. Un mundo compartido, sin mapas espejo ni shards.
2. Tope 120, ~30 h al tope, 12 tiers de 10.
3. Cuatro clases (paladín, clérigo, mago, arquero), 4 stats, puntos a mano con reset.
4. Magia no falla; crit solo físico y solo PvE; DF/RM con topes por semana.
5. Paralizar con rendimiento decreciente + Remover propio.
6. 7 bandas de ítems, 5 calidades, +N sin destrucción, botín personal.
7. Mazmorras instanciadas con llave crafteada.
8. Gemas = comodidad, nunca poder.
9. Ningún ítem se destruye; sin tope de oro.
10. PvP solo entre naciones; al morir en PvP se cae el zem y 10 % del oro con tope, nunca el equipo; EK y contribución; 4 h por mismo jugador.

## 11. Abierto (se decide cuando toque, no antes)

- Compensador de nación con menos población: **después de la beta** (Román, 5/11). Propuesta guardada: si una nación tiene menos del 40 % de los online en 81+, cobra +25 % de exp y oro en zona roja, visible en el HUD, sin tocar el daño.
- Reset/temporadas: `SERVER_EPOCH` deja la puerta abierta; no se decide ahora.
- Runas y sockets.
- Guerra de naciones, clanes, housing, rebirth: después de la beta.
