# Combate: defensa, resistencia mágica y pociones

Todo lo que sigue lo decide el **server** (`apps/server/src/systems/pvpCombat.ts` y `world.ts`). El cliente solo muestra y predice.

## Defensa con rendimiento decreciente

Hay dos defensas: **DF** (defensa física) y **RM** (resistencia mágica).

```
daño recibido = max(1, round(daño base × 100 / (100 + X)))      X = DF (físico) o RM (mágico)
mitigación    = X / (100 + X)
```

| X | 0 | 25 | 50 | 100 | 200 | 300 |
|---|---|----|----|-----|-----|-----|
| daño evitado | 0 % | 20 % | 33 % | 50 % | 67 % | 75 % |

Nunca llega al 100 %: cada punto vale menos que el anterior.

### Qué es físico y qué es mágico

- **Físico** (lo mitiga la DF): ataque básico, `golpe`, `tajo`, `sismo` (todo lo que escala con el arma) y los ataques de los mobs (normales y especiales de boss; hoy no se distinguen mobs mágicos).
- **Mágico** (lo mitiga la RM): el resto de los hechizos (`proyectil`, `hoja`, `lanza`, `bola`, `lluvia`, `ventisca`, `marejada`, `luz`).

Ya no hay resistencias separadas a fuego y hielo.

### Valores base de equipo (DF / RM)

Escala elegida para que, con equipo acorde, la mitigación quede entre ~10 % y ~40 %.

| Pieza | DF | RM |
|---|---|---|
| Ropas de tela | 4 | 6 |
| Coraza de cuero | 12 | 4 |
| Cota de malla | 22 | 8 |
| Armadura de placas | 34 | 12 |
| Túnica de mago | 4 | 24 |
| Capucha de cuero / Cofia de malla / Yelmo de hierro | 4 / 8 / 12 | 2 / 3 / 4 |
| Capucha de mago | 2 | 10 |
| Anillo opaco | 0 | 8 |

Ejemplos: guerrero con coraza de cuero = DF 12 (~11 %); placas + yelmo = DF 46 (~31 %), RM 16 (~14 %); mago con túnica + capucha + anillo = RM 42 (~30 %), DF 6 (~6 %). Los atributos extra de los items suman encima:

- `df` (+3 a +9 por afijo): suma a la DF.
- `rm` (+4 a +12 por afijo): suma a la RM.
- `rpar`: resistencia a parálisis, como antes (ver abajo).
- Compatibilidad: los atributos guardados `fres` / `ires` (resistencia al fuego / hielo, en %) valen ahora **RM 1:1** (un `fres` 10 = +10 RM); el server los suma al calcular y el cliente los convierte a `rm` al cargar (si un item tenía ambos, se juntan). `sanitizeCharacter` los deja pasar sin tocarlos. El generador de botín del server sale ahora con `defense` y `magic_resistance` en lugar de `fire_resistance` / `ice_resistance` (el cliente sigue entendiendo las claves viejas) y baja esos valores (x0,6, tope 30) a la escala DF/RM.

### Parálisis

```
segundos = max(0,4, base × 100 / (100 + RM) × (1 − min(75, rpar) / 100))
```

La RM acorta la duración y la resistencia a parálisis (`rpar`) la acorta además en su porcentaje; cada una cuenta una sola vez. Vale para los hechizos de jugadores y para el aturdimiento de los mobs. Ejemplo: `paralisis` (3 s) contra RM 100 = 1,5 s; contra RM 100 y 50 % de `rpar` = 0,75 s. La inmunidad posterior (8 s) no cambia.

## Pociones

- **Delay global (GCD) de 1,75 s** entre cualquier poción (vida o maná), independiente de la recarga de los hechizos. El server acepta una poción si pasó al menos 1,65 s (100 ms de margen por jitter de red) desde la anterior aceptada, y como mucho 5 por ventana de 10 s.
- **Vida**: 40 % de la vida máxima (mín. 50). El **20 %** se cura al instante y el resto en **4 ticks de 0,5 s (2 s)**; la suma es exacta. Si morís o revivís, los ticks pendientes se cancelan.
- **Maná**: 50 % del máximo (mín. 40), al instante.
- Si ya tenés la vida / el maná llenos, no se gasta el delay.
- Mensaje `PotionRequest { kind }` (0 = vida, 1 = maná). El server cura y avisa con `Vitals`; el cliente ya no cura solo estando conectado (sin server, curación local de respaldo). Las pociones **no** se aceptan por `hpReport`: el maná por reporte solo puede bajar, y las subas de vida por reporte (hechizos de cura, regeneración) quedan limitadas a ~50 % de la máxima por segundo (tope 2 s) y 100 % de la máxima en cualquier ventana de 5 s.
- Cliente: el delay se ve como overlay con cuenta atrás en los chips Q / E y en los slots de la bolsa; no cambia el peso ni el inventario.

## Prueba

```
DATA_DIR=<carpeta vacía> PORT=8213 pnpm --filter @fdn/server start
cd apps/server && npx tsx scripts/test-combat.ts ws://localhost:8213/ws
```

Reiniciar el server entre corridas (los bots quedan 60 s en el mundo y ocupan celdas). Verifica el daño con DF/RM 0, 100 y 300, la parálisis con RM y `rpar`, el GCD y el reparto del HoT.
