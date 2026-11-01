# Dungeons: instancia por grupo

Estado: **implementado en el server** (registro de mundos). Decidido el 1/11/2026: las mazmorras (`MapDef.temporary`) son una instancia por party; los mapas abiertos siguen compartidos.

## Reglas (hechas)

- Cruzar un vínculo hacia una mazmorra desde fuera lleva a la instancia `mapa#p<idParty>`; sin party, a una propia `mapa#u<sessionId>`.
- Los compañeros de party cerca del portal (mismo mundo, vivos, a `PARTY_SHARE_RANGE` celdas o menos) cruzan juntos. Cada uno debe cumplir el requisito del vínculo (nivel, misión, llave) y paga su propia llave; el que no cumple se queda y recibe el aviso.
- Cambiar de piso o reaparecer en la entrada de otra mazmorra mantiene la instancia. Salir a un mapa no-mazmorra vuelve al mundo compartido.
- Mobs, jefe, drops y respawn son por instancia (cada instancia es un `GameWorld`). Exp y botín de party ya se resuelven dentro del mismo mundo, así que no cruzan instancias.
- Una instancia vacía se da de baja a los 5 min (`DEFAULT_INSTANCE_TTL_MS`).
- Un compañero que llega tarde a la puerta con la instancia viva entra a la misma (su party id da la misma clave).

## Pendiente / a decidir

- Anti-farmeo: cooldown o límite diario por dungeon (hoy no hay; las llaves son el sumidero).
- Reconexión: al reconectar después de la gracia se vuelve al `rest` del mapa, no a la instancia.
- Cuando existan los pisos de Flare (D1-D6), marcarlos `temporary` con su `rest`.
