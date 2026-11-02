# Skin de prueba: caballero (solo cuenta GM)

Prueba para ver si el estilo del pack de SmallScaleInt calza con ERIS. **Los PNG no se suben al repo** (la licencia no permite redistribuir los archivos originales); están en `.gitignore`.

## Cómo probarlo
1. Copiá estas 7 hojas de `Spritesheets/With shadows/` a `apps/client/public/assets/skins/caballero/`: `Idle.png`, `Run.png`, `Melee.png`, `Melee2.png` (golpe crítico desde arriba), `TakeDamage.png`, `Die.png`, `CastSpell.png`.
2. Entrá con la cuenta GM (`rowena`) o abrí el cliente con `?skin=caballero`. Solo lo ves vos; los demás jugadores ven el muñeco normal.
3. Sin las hojas no pasa nada: se ve el muñeco de siempre.

## Cómo está armado
- Hojas de 15 cuadros x 8 direcciones, celdas de 128x128. Las filas rotan en sentido horario desde el este; el juego usa 0=O,1=NO,2=N,3=NE,4=E,5=SE,6=S,7=SO, así que la dirección `d` toma la fila `(d+4)%8`.
- Animaciones usadas: stance=Idle, run=Run, swing=Melee, hit=TakeDamage, die=Die, cast=CastSpell. Todas con 15 cuadros; las duraciones están en `initKnight()` de `apps/client/src/main.ts`.
- Ajustes a mano: `sc` (tamaño) y `ay` (pie) en `initKnight()`.
