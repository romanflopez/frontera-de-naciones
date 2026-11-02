# Cosas para probar con otra persona

Lo que no se puede probar solo: hace falta un segundo jugador conectado (otra compu, otro navegador o una ventana de incógnito con otra cuenta).

## Party (ver docs/PARTY_Y_ARENAS.md)

Preparación: dos personajes **de la misma facción**, conectados a la vez.

**Invitación**
- [ ] A escribe `/invitar NombreDeB`: a B le aparece arriba a la derecha el cartel "¡A te invitó a su party!" con Aceptar / Rechazar y la barra de tiempo.
- [ ] B toca **Aceptar**: el cartel se cierra y a los dos les aparece el panel de party con ambos.
- [ ] B toca **Rechazar** (con otra invitación): el cartel se cierra, no se arma la party y A recibe el aviso.
- [ ] B no toca nada: el cartel se cierra solo a los 15 s.
- [ ] A invita dos veces seguidas: el cartel de B se reemplaza, no se apilan.
- [ ] `/aceptar` y `/rechazar` por chat siguen funcionando igual que los botones.
- [ ] Invitar a alguien de otra facción da error y no muestra cartel.

**Panel**
- [ ] Encabezado "PARTY · 2", corona en el líder, nivel a la derecha.
- [ ] Un mob le pega a B: en la pantalla de A la barra roja de B baja **suave**, no de golpe, y el % se actualiza.
- [ ] B usa un hechizo: la barra azul (maná) de B baja en la pantalla de A.
- [ ] B regenera o toma poción: las barras suben.
- [ ] B cambia de mapa: en la pantalla de A, la fila de B queda transparente; al volver, se ve normal.
- [ ] B se desconecta: su fila queda transparente; al reconectar, vuelve.
- [ ] Cambiar líder (`/lider B`): la corona pasa a B.
- [ ] B sale (`/salir`) o A lo expulsa (`/expulsar B`): B desaparece del panel de A y a B se le oculta el panel.
- [ ] Con 3 o 4 jugadores, el contador y el orden de las filas son correctos.

**Solo (sin segunda persona)**
- [ ] Con `?debug`, **Shift+I** muestra una invitación simulada de KingLuthor; Aceptar o Rechazar escribe `[party] (simulado, no se envía)` en la consola. La **I** sola sigue abriendo la bolsa.
