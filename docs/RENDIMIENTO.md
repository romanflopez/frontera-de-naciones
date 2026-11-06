# Rendimiento del cliente

Medido el 5/11/2026 en una Apple M3 Pro (GPU real, ANGLE/Metal), Chrome, pantalla retina (DPR 2, canvas de 2992×1362), mapa Cañón goblin (159 mobs, el más denso junto con Oasis de Ceniza y Cenizas II). Román reportó que «todo anda re lento, más al castear».

## Cómo se mide
Con `?debug` en la URL, desde la consola o un script:
- `__fdn.prof()` → fps, y por parte del cuadro (`update`, `hover`, `render`, `hud`, `winTick`, `minimap`, `frameMs`, `chunkBuild`) promedio, p95 y máximo de los últimos 6 s; `hitches` lista los cuadros de dibujo de más de 30 ms con lo que pasaba (sección de `render` que se pasó, posición, mobs, bloques de terreno).
- `__fdn.profReset()` reinicia, `__fdn.groundCache(true|false)` prende/apaga el caché del terreno (para comparar), `__fdn.sheets()` muestra las hojas de sprites convertidas (solo con `?half`).
- `/gm dios`, `/gm pos x y`, `/gm mob goblin 20 20` (hasta 20 por vez) arman la escena con muchos mobs; el server tiene que arrancar con `FDN_GM=all` (solo local).
- Una página vacía en este navegador automatizado ya no pasa de ~47 fps: el techo real de la máquina es incierto; por eso se compara siempre contra la misma escena con y sin el cambio.

## Lo que se encontró
1. **El costo del cuadro era la cantidad de órdenes `drawImage`, no los píxeles ni los mobs.** Anulando todos los `drawImage` el cuadro bajaba de 25 ms a 8,5 ms; con la mitad, 13,7 ms (lineal, ~9 µs por llamada). Bajar la resolución del canvas a la cuarta parte no cambió nada. El JS de `render` era de 2-3 ms: el hilo principal estaba libre.
2. **~1.870 de las ~1.930 órdenes por cuadro eran el terreno** (un `drawImage` por tile y por calcomanía, y 58 % fuera de pantalla); cada mob suma 1.
3. **Hojas de sprites gigantes.** Están guardadas a escala nativa ×2 y decodificadas pesan: `cursed_grave` 180 MB, `minotaur` 167, `wyvern` 158, `antlion`/`fire_ant`/`ice_ant` 126 c/u, `skeleton` 123, `skeleton_archer` 95, `skeleton_mage` 91, `goblin_elite` 83, `zombie`/`zombie_dark` 57, `goblin` 49, `hobgoblin` 40: **~1,5 GB las 15**. Con 5 tipos de mob distintos a la vez a la vista (~290 MB de texturas) los cuadros se congelan de **1,5 a 3,3 s**, no solo la primera vez sino cuadro tras cuadro mientras esa mezcla esté a la vista (en una corrida: más de 40 s congelado cruzando el mapa). Con 188 goblins solos a la vista, no pasa nada (una sola hoja de 49 MB).
4. El casteo en sí no suma costo medible de JS (`hud`, `update` y `render` iguales castee o no); lo que se siente al castear es el punto 3 cuando aparece un mob o efecto nuevo.

## Lo que se arregló (este paso)
- **Caché del terreno** (`groundCached` en `main.ts`): el terreno y las calcomanías, que no cambian dentro de un mapa, se dibujan una vez en bloques de 256×256 px del dispositivo y cada cuadro se pegan solo los visibles: **~1.870 → ~350 órdenes por cuadro**. Los bloques se arman a razón de 1 por cuadro (varios detrás de la pantalla de carga), se precargan los vecinos, mientras falta uno ese pedazo se dibuja directo, y se tiran al cambiar de mapa o de escala. Con 250 mobs a la vista: **30,7 fps (32 ms) → 74,5 fps (13 ms)**, peor cuadro 42 → 19 ms. El terreno se ve igual (diferencias de ≤ 8 sobre 765 por píxel en el 66 % de los píxeles, imperceptibles).
- Perfilador por partes y registro de cuadros lentos (`?debug`).

## Lo que NO está arreglado (decisión de Román)
Las hojas de sprites (punto 3). Lo medido:
- Convertir las hojas del mapa a `ImageBitmap` entero **no ayudó** (cuadros de 2,2 s igual).
- Con **`?half`** (las hojas de los mobs del mapa a la mitad de resolución, 4× menos memoria) los congelamientos bajan a **una quinta parte** (7 cuadros de ~1,2 s contra 19 de ~2,2 s) y después anda a 120 fps. Se ve más suave (menos definición). Es solo una opción de prueba: **Román puede abrir el juego con `?half` en su PC y decir si el lag se va**.
- Arreglos de fondo posibles (cada uno cambia el arte o la carga, no se hicieron):
  1. Reexportar las hojas **recortando el espacio transparente** de cada celda y a la escala que realmente se usa (hoy se dibujan a 0,4 de la hoja ×2: en pantalla estándar queda 0,5-0,7 píxel de pantalla por píxel de hoja).
  2. Una variante a escala 1 para pantallas estándar y la de escala 2 solo para retina o ventanas grandes.
  3. Cargar y soltar hojas **por mapa** (hoy se bajan las 15 al arrancar).
  4. Partir cada hoja por animación y cargar solo las que se usan.
