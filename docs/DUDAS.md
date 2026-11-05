# Dudas abiertas

Una línea por duda: qué, dónde, qué opciones se ven.

- **D.12, `sim:pvp`:** con 280/170 el enfrentamiento `paladín+mago vs paladín+mago` queda fuera de objetivo (dura 18,9 s, 42 % en objetivo). En `main` ya estaban fuera `mago vs healer` y `mago vs mago`. Causa probable: el sim mueve a los bots con `RUN_MS`/`WALK_MS` y correr más rápido cambia el kiteo. Opciones: recalibrar la sim una vez que Román fije los números jugando, o ajustar el movimiento de los bots.
- **D.12, tope de combate:** `MOVE_CAP_MS` pasó de 200 a 170 para que correr no quede recortado (`DISEÑO.md` §5 pide "tope duro de velocidad en combate"). Confirmar que 170 es el tope que se quiere. Si no, subir el tope y correr queda en 200.
- **D.12, caminar al castear:** el cliente ya no se mueve mientras castea (un paso corta el cast), así que caminar solo se nota con un hechizo listo (`P.ready`). Si el diseño quiere poder caminar *durante* el casteo sin cortarlo, hay que cambiar esa regla de `DISEÑO.md` §5.
- **Rendimiento (fuera de D.12):** Román nota todo lento y feo, y sospecha de la densidad de mobs (mapa 2 tiene 159). No se midió ni se tocó. Falta perfilar cliente (fps, dibujado de mobs) vs. server (tick) antes de decidir. Va como paso aparte.
