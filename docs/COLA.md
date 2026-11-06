# Cola de ejecución (de a un paso, Román prueba entre paso y paso)

Regla: **un paso a la vez, en orden**. Cada paso es una sesión nueva de Claude Code en un worktree propio, con el prompt
`Hacé el paso D.x de docs/PLAN_DE_TRABAJO.md. Leé CLAUDE.md primero.` Cuando el PR está en verde, Román prueba lo de la
columna "Probás" y mergea. Recién ahí arranca el siguiente. Si un paso deja algo en `DUDAS.md`, se resuelve antes de seguir.

| # | Paso | Depende de | Probás vos (2 minutos) |
|---|---|---|---|
| 1 | **D.0** Renombres paladín/clérigo + esqueleto arquero | — | Entrás con un personaje viejo y sigue siendo su clase; crear personaje muestra 3 clases con nombres nuevos |
| 2 | **D.14** Entrada sin flash de HUD | — | Login → no se ve HUD ni chat hasta que aparece el mapa; cambiar de mapa igual |
| 3 | **D.13** Cursor nativo | — | El mouse responde al instante; el clic cae en la celda bajo la flecha; el anillo de casteo sigue andando |
| 4 | **D.12** Movilidad | D.13 (para probar bien) | Correr es el default; caminás solo al castear; se siente rápido. Si no, tocás los dos números y repetís |
| 5 | **D.2** Magia no falla | — | Un mago en PvP nunca ve "Falló"; `sim:pvp` no empeora |
| 6 | **D.3** 4 stats (sacar Inteligencia) | D.0 | Personaje viejo con puntos en INT los tiene libres; ventana muestra 4 stats; `sim:pvp` no empeora |
| 7 | **D.4** Remover propio | D.3 | Paralizado podés castear Remover (1,5 s); después 4 s no te paralizan; a otro tarda 1 s |
| 8 | **D.1** Curva a 30 h | — | `sim:pve --horas` da ~30 h al 120 y < 1 h al 10 |
| 9 | **D.6** Topes DF/RM por semana | — | Ventana de personaje muestra "Tope actual DF x / RM y · sube el lunes"; con `SERVER_EPOCH` de hace 10 semanas da 60/75 |
| 10 | **D.5** PvP por región | — | En un mapa 61-80 entrás a la zona roja (cartel) y podés pegarle a uno de la otra nación; afuera no |
| 11 | **D.9** Zem y caída en PvP | D.5, D.1 | Cae zem de mobs (~8 %); morís en zona roja contra un jugador y se cae tu zem + 10 % del oro con tope; la forja solo toma zem del depósito; piedras viejas convertidas |
| 12 | **D.10** EK y contribución | D.9 | Matás a uno: EK +1; al mismo otra vez antes de 4 h: no suma; la tienda de contribución vende algo visual |
| 13 | **D.11** Quests alineadas | D.5, D.9 | "Defensa de la frontera" no aparece antes de 61; la primera misión da zem |
| 14 | **D.7** Reset de stats por gemas | D.3 | El ítem resetea igual que el reset por oro |
| 15 | **D.17** Email + recuperar contraseña | — | Crear cuenta pide email; contraseña de 7 caracteres rechazada; "Olvidé mi contraseña" te manda un mail real y el link funciona 30 min |
| 16 | **D.18** Pantallas de entrada | D.0, logos de Román | Muñeco centrado y nítido en selección y creación; borrar usa el modal del kit; detalle muestra última conexión |
| 17 | **D.15** Chat al lado del HUD + colapsable | — | En 1366×768 y 1920×1080 el chat está abajo-izquierda a la altura del HUD, con pestañas; Enter abre, Esc cierra |
| 18 | **D.16** Ventanas sin scroll | D.15 | En 1366×768 ninguna ventana scrollea si no hace falta; la bolsa muestra todas las casillas |
| 19 | **D.19** NPCs: tienda directa | — | Hablarle a un vendedor abre la tienda sin diálogo; el Capitán sigue con diálogo |
| 20 | **D.8** Compensador de nación | D.5 | Después de la beta |
| 21 | **D.21** Curva de exp con forma HB | D.1 | Con un personaje nuevo subís al nivel 2 con 3 kills y al 4 en un par de minutos; `sim:pve --horas` sigue en ~30 h; un personaje guardado conserva su nivel y su fracción de exp |

Los pasos sin dependencia (2, 3, 5, 8, 9, 15, 17, 19) se pueden adelantar si alguno se traba. Los de economía y stats (6, 7, 11, 12, 14) van estrictamente en este orden.

## Después de la cola
**D.20 Balance general** va cuando los ítems estén bien definidos, con el material de Helbreath que pase Román. Hasta entonces, los pasos solo tienen que no empeorar `sim:pvp` y `sim:pve`.

Catálogo de mecánicas de mazmorra (con los videos de Dreadmyst), kits de las 4 clases con tipo de hechizo, arquero completo, mapas 51-120 y mapa central, animaciones de casteo, orbes con efecto, sprites de NPC. Cada uno se escribe como paso cuando se define.
