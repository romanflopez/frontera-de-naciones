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
cd apps/server
DATA_DIR=<carpeta vacía> PORT=8213 FDN_DEBUG_TRUST_SAVE=1 FDN_DEBUG_WARP=1 npx tsx src/index.ts   # server nuevo en cada corrida
npx tsx scripts/test-combat.ts ws://localhost:8213/ws
```

`FDN_DEBUG_TRUST_SAVE=1` es imprescindible: desde que la economía es autoritativa el server ignora los guardados del cliente (nivel, equipo), y sin esa variable todos los bots quedan en nivel 1 con el kit inicial y ningún rango de daño calza. Hay que reiniciar el server (con la carpeta de datos vacía) entre corridas: los bots quedan 60 s en el mundo y ocupan celdas. Los bots se ubican en el mapa inicial `solmar_legacy` y la ruta evita portales, vínculos, waypoints y NPC. Verifica el daño con DF/RM 0, 100 y 300, la parálisis con RM y `rpar`, el GCD y el reparto del HoT (17 comprobaciones).


## Arranque del nivel 1-3

Medición de cuánto aguanta y cuánto tarda un personaje nuevo, hecha con `apps/server/scripts/sim-arranque.ts` (simulación headless que usa el `MobSim` real del server y las fórmulas reales de `pvpCombat.ts`: vida y maná por nivel, DF, pociones y GCD; el bot imita al cliente: fórmulas de daño de `main.ts`, 0,7 s de lanzamiento + 0,2 s humanos para soltar, ataque cuerpo a cuerpo cada 0,85 s) y validada contra un server en marcha con `scripts/live-arranque.ts`. Reloj virtual y semilla fija: `npx tsx scripts/sim-arranque.ts 300` reproduce estas tablas (300 combates por celda).

Supuestos: kit inicial (Mago: Báculo de fresno + Túnica de mago, 90 de vida, 90 de maná, DF 4; Guerrero: Espada corta + Coraza de cuero, 140 de vida, 40 de maná, DF 12), 3 pociones de vida y 3 de maná, vida < 40 % toma poción (0,5 s de reacción), los mobs vienen agrupados desde ~6 celdas, sin Blink ni parálisis, sin huir. Goblin = Nv1, 42 de vida, 4-7 de daño cada 1,3 s; élite = Nv2, 62 de vida, 5-9 cada 1,2 s. "Básico" = Mago con Proyectil arcano (23-29 de daño a Nv1 gracias al Báculo y la Túnica: +9 de magia), Guerrero con ataque normal (~14).

### Cuánto dura un combate (política básica; % de victorias / segundos que dura)

| Clase | Nv | Mob | 1 mob | 2 mobs | 4 mobs | 6 mobs |
|---|---|---|---|---|---|---|
| Mago | 1 | goblin | 100 % / 2,4 | 100 % / 4,7 | 100 % / 9,7 | 100 % / 14,9 |
| Mago | 2 | goblin | 100 % / 2,4 | 100 % / 4,8 | 100 % / 10,1 | 100 % / 15,2 |
| Mago | 3 | goblin | 100 % / 2,4 | 100 % / 4,6 | 100 % / 9,8 | 100 % / 14,6 |
| Mago | 1 | élite | 100 % / 3,3 | 100 % / 6,8 | 100 % / 14,3 | 19 % / 21,0 |
| Mago | 2 | élite | 100 % / 3,2 | 100 % / 6,5 | 100 % / 13,5 | 40 % / 19,8 |
| Mago | 3 | élite | 100 % / 2,9 | 100 % / 6,0 | 100 % / 12,4 | 76 % / 18,1 |
| Guerrero | 1 | goblin | 100 % / 3,1 | 100 % / 6,0 | 100 % / 11,7 | 100 % / 17,6 |
| Guerrero | 2 | goblin | 100 % / 2,9 | 100 % / 5,5 | 100 % / 10,8 | 100 % / 16,2 |
| Guerrero | 3 | goblin | 100 % / 2,8 | 100 % / 5,3 | 100 % / 10,4 | 100 % / 15,5 |
| Guerrero | 1 | élite | 100 % / 4,4 | 100 % / 8,4 | 100 % / 16,7 | 7 % / 24,2 |
| Guerrero | 2 | élite | 100 % / 4,2 | 100 % / 8,0 | 100 % / 15,7 | 43 % / 23,1 |
| Guerrero | 3 | élite | 100 % / 3,9 | 100 % / 7,3 | 100 % / 14,5 | 99 % / 21,7 |

La vida que queda al ganar contra 4 élites a Nv1 es 61 % (Mago, 1,8 pociones) y 54 % (Guerrero, 2,1 pociones). Con la política avanzada (Mago: Bola de fuego sobre grupos; Guerrero: Golpe brutal + Giro) todo gana el 100 % hasta 6 mobs, y el Mago liquida 4-6 mobs en ~3 s, pero ese número es optimista porque la simulación los agrupa a menos de 1,9 celdas.

### Cuánto tarda en morir un jugador que no reacciona (sin atacar ni tomar pociones)

Segundos desde el primer golpe recibido hasta morir (mediana), con 1 / 2 / 4 / 6 mobs encima:

| Clase | Nv | Mob | 1 | 2 | 4 | 6 |
|---|---|---|---|---|---|---|
| Mago | 1 | goblin | 26,0 | 11,7 | 5,6 | 3,9 |
| Mago | 1 | élite | 18,7 | 8,2 | 4,0 | 2,9 |
| Mago | 3 | élite | 22,4 | 10,0 | 4,8 | 3,6 |
| Guerrero | 1 | goblin | 50,7 | 21,4 | 10,4 | 6,9 |
| Guerrero | 1 | élite | 36,1 | 15,7 | 7,4 | 5,2 |
| Guerrero | 3 | élite | 44,9 | 19,9 | 9,4 | 6,5 |

Tiempo para matar a un solo mob (media, política básica): Mago Nv1 2,4 s (goblin) / 3,3 s (élite); Guerrero Nv1 3,1 s / 4,4 s; a Nv3 baja a 2,3 / 2,9 s (Mago) y 2,8 / 3,9 s (Guerrero). El Mago necesita 2 Proyectiles por goblin y 3 por élite.

### Subir al nivel 2

`expToLevel(1)` = 560 exp: 40 goblins (14 exp) o 26 élites (22 exp). De ahí al 3: 1760 exp (80 élites); del 3 al 4: 3600 exp (120 zombis de 30). Con la zona real (3 mobs que reaparecen a los 22 s), 85 % de vida antes de cada tanda y 45 s de castigo por muerte (no hubo muertes):

| Clase | Mob | Minutos hasta el Nv2 | Kills |
|---|---|---|---|
| Mago | goblin | 5,4 | 40 |
| Guerrero | goblin | 7,0 (5,8 con Golpe/Giro) | 40 |
| Mago | élite | 4,1 | 26 |
| Guerrero | élite | 8,0 (5,8 con Golpe/Giro) | 26 |

El cuello de botella no es el combate sino el reaparecer: 3 mobs cada 22 s son como mucho ~8 kills por minuto, o sea 4,9 min mínimo para 40 goblins aunque se mataran al instante (el Mago tarda ~1,6 min de puro combate; el Guerrero ~2,1). El Mago va limitado además por el maná (8 por Proyectil contra 2 de regeneración por s): sin pociones de maná no llega a los 40 kills seguidos sin descansar.

### Validación contra el server en marcha

`live-arranque.ts` (bots por WebSocket contra `solmar_legacy`, 3 mobs por zona, 20 s de espera inicial por la protección de entrada) coincide con la simulación cuando solo pelean los goblins de la zona: Mago vs 3 goblins ganó 7 de 7 en 5,2-9,7 s (sim: ~7 s); Guerrero vs 3 goblins ganó 3 de 3 en 8,9-13 s (sim: ~9 s); Mago vs 3 élites ganó 2 de 2 en 8,8-9,3 s (sim: ~10 s) y Guerrero vs 3 élites 2 de 2 en 11-12 s (sim: ~12 s). Las muertes que aparecieron en vivo no vinieron de los goblins: el bot registra el tipo de cada mob que le pega y eran esqueletos (Cementerio viejo, 11-17 de daño) que se sumaron en el Campamento goblin (el Guerrero murió 2 de 3 veces), y zombis (7-11) y hormigas de fuego (13-20) en la Avanzada goblin (el Guerrero murió 3 de 3, el Mago recibió hormigas en una prueba). Otra corrida anterior, todavía sin registrar el tipo, dio 4 muertes de 4 al Guerrero en el Campamento con un daño por golpe promedio de 13, que tampoco es de goblins (4-7). Las zonas de entrenamiento del mapa viejo se solapan con zonas de mayor nivel y los mobs persiguen a quien se les acerca a menos de 4,5 celdas (el Guerrero sale al encuentro y los arrastra). Además el server da 20 s de protección al entrar (`spawnProtectionTime`) que solo se corta al moverse: un personaje quieto que ataca desde el principio es invulnerable ese rato, lo que falsea cualquier prueba en vivo si no se espera.

### Conclusiones y recomendación

- **El Mago no está peor que el Guerrero al arrancar**: mata ~25 % más rápido (2,4 contra 3,1 s por goblin), gana el 100 % de los combates con 1, 2 y 4 mobs y llega al Nv2 antes. Solo es más frágil si no reacciona: quieto, aguanta ~0,5× lo que aguanta el Guerrero (18,7 contra 36,1 s ante una élite).
- **Un Nv1 no es demasiado letal con las reglas actuales**: con juego activo gana el 100 % contra 1-4 goblins o élites; el límite está en 6 élites juntas (Mago 19 %, Guerrero 7 %), y una zona tiene 3. Morir en 1-2 s no sale de estos números: ni 6 élites encima matan a un Mago quieto en menos de ~3 s (mediana), y para 1-2 s harían falta 10 o más mobs en contacto. Lo más probable es que al reportado se le sumaron mobs de otras zonas (esqueletos, zombis, hormigas, como se vio en vivo) o que el agente tardó segundos en reaccionar (el reloj de pared de un agente no es el de un jugador).
- **No se cambió ningún número de balance.** Si se quiere dar más margen igual, estas son las opciones medidas (Mago Nv1, política básica, 300 combates, solo variando el dato indicado; se reproducen con `SIM_MAGE_HP=20` y `SIM_ELITE_DMG=4,7`):

| Opción | 6 élites: victorias | Quieto vs 4 élites: muere a los | Quieto vs 1 élite |
|---|---|---|---|
| Actual (90 de vida, élite 5-9) | 19 % | 4,0 s | 18,7 s |
| Mago con +20 de vida base (110) | 34 % | 5,0 s | 22,5 s |
| Élite con 4-7 de daño (igual al goblin común) | 87 % | 5,3 s | 25,0 s |
| Las dos | 96 % | 6,4 s | 31,2 s |

  La de la vida base del Mago es la más barata y no toca a los mobs (que están sobre las curvas `mobHpCurve` / `mobDmgCurve`; bajar el daño de la élite la saca de la curva de Nv2). Lo que más seguridad compraría de verdad es otra cosa: separar las zonas de entrenamiento de las de nivel alto en `solmar_legacy` (o achicar el radio de deambular de Pantano muerto / Cementerio viejo) para que un Nv1-3 no arrastre zombis o esqueletos a la Avanzada o al Campamento goblin.
- **El grindeo de 40·L es largo por el reaparecer, no por el combate**: Nv2 pide ≥ 5 min aunque se juegue perfecto, Nv3 ≥ 10 min (80 élites con 3 mobs cada 22 s) y Nv4 ≥ 15 min. Si se quiere acelerarlo sin tocar la fórmula, subir `n` de las zonas de entrenamiento (3 → 5) o bajar `mobRespawnSecs` (22 s → 14 s) tiene un efecto casi lineal en esos tiempos; no se tocó.
