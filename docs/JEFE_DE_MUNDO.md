# Jefe de mundo (MVP)

Decisión de Román (3/11/2026): **uno solo en el MVP**, para ver cómo funciona. Sale **una vez por día a una hora al azar** (si saliera siempre a la misma hora, lo camparían) y **en un mapa al azar de su tier** (errante entre los mapas del tramo).

## Cómo funciona

| | |
|---|---|
| Jefe | **Coloso de piedra**, nivel 20 (T4, 16-20), sprite del gólem (`MOBS.coloso`, `BOSS_KITS.coloso`) |
| Cuándo | Una vez por día de Argentina, a una hora al azar entre las 10:00 y las 23:00 (`WORLD_BOSS.fromHour` / `toHour`) |
| Dónde | Al azar entre los mapas abiertos del T4 (hoy La Brecha y Paso de Stormrock, los dos de facción con PvP), en el centro de una zona de mobs al azar |
| Cuánto dura | 40 minutos (`lifeMin`); si nadie lo mata, se va. Aviso a los 10 minutos del final |
| Avisos | En el chat de todos los conectados: al aparecer (mapa y nivel), a 10 minutos del final, al morir (quién dio el golpe final y cuántos más pelearon) y al irse |
| Vida | ~3 veces la del Mago mayor (jefe de D4, mismo nivel): pensado para varias parties |
| Botín | **Para todos los que pelearon** (los que le sumaron amenaza: pegaron, curaron o tanquearon), de cualquier party o sin party, cada uno con lo suyo: exp completa del jefe, un ítem (rareza mínima 3), oro y piedras de forja. Cuenta para las misiones. El que solo miró no cobra |

## Mecánicas (motor de jefes)
- **Temblor** (aviso en el piso, a alguien al azar): daño y aturde 1 s.
- **Derrumbe** (casteo de sala, cortable): 50 % de la vida a todos si no se corta.
- **Puño de roca** (al tanque): ×3 con sangrado apilable.
- **Avalancha** (tirón + explosión): hay que salir del círculo.
- **Adds** al 60 % y al 30 %: guardianes de piedra (minotauros nivel 20) y, al 30 %, un brujo que castea.
- Furia al 25 % y furia dura a los 10 minutos.

## Detalles del server
- `apps/server/src/worldBoss.ts`: el reloj (sortea la hora del día y el mapa, avisa, lo saca al vencer). Vive en memoria: si el server se reinicia, se sortea de nuevo la hora de ese día; si la ventana ya cerró, ese día no sale.
- El mundo con el jefe vivo **no hiberna** aunque se vacíe (si hibernara, se borrarían los mobs).
- GM: `/gm jefemundo` (estado y próxima salida), `/gm jefemundo aca` (sale al lado tuyo, para probar) y `/gm jefemundo ya` (sale ahora en un mapa al azar).
- Tests: `apps/server/test/jefe-de-mundo.test.ts`.

## A mirar en la prueba
- Si 40 minutos alcanzan para que la gente se entere y llegue.
- Cuánto tarda con 2-3 jugadores (con más gente, menos) y si las mecánicas se leen en un mapa abierto.
- Si el PvP alrededor del jefe (mapas de facción) suma o arruina el evento.
- Si la ventana de 10 a 23 h está bien para la gente que juega.
