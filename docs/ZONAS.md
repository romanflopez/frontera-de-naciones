# Zonas y mobs: curva de nivel

Fuente de verdad: `packages/world/src/mobs.ts` (tipos) y las zonas en `index.ts`, `frontier.ts` (páramo, cripta) y `ashlands.ts` (tierras de ceniza, foso).
El server y el cliente comparten las definiciones: `mobDef(tipo, zona)` devuelve el mob con el nivel de la zona.

## Cómo se escala

- Cada tipo tiene un nivel base. Una zona puede fijar `lvl`; entonces vida, daño y exp se reescalan sobre las curvas del mob común (mismo sprite, misma IA):
  - vida = `29 + 10,5·L + 2,75·L²`
  - daño promedio por golpe = `2,5·L + 3`
  - exp por kill = `mobExpCurve(L) = 60·L^1,5 / 11` (los tipos base de nivel bajo dan un poco más: goblin 14, élite 22)
  - **Grindeo estilo HB:** subir del nivel L pide `40·L` kills de un mob común del propio nivel (`killsToLevel`): 40 en Nv1, 200 en Nv5, 400 en Nv10. `expToLevel(L) = exp real del mob común de nivel L × 40·L` (Nv1 560, Nv5 12.400, Nv10 68.995). Cliente y server usan la misma función de `mobs.ts`.
  - Misiones y jefes casi no aportan exp (decisión del usuario: "solo grindear"): la misión 1 es ~12 % del Nv1 y las del final menos del 1 % de un nivel; sirven por oro, esquirlas y llaves.
  - Morir quita el 5 % de la exp del nivel (en Nv10 equivale a ~20 kills).
- Los bosses y mini-bosses no se reescalan (`lvl` se ignora): su nivel es el del tipo. Vida de boss ~3-3,5x la del común, exp ~3-5x.
- El botín del server (`rollMobDrop`) usa el nivel real del mob de la zona.

## Tabla zona -> nivel

| Zona | Tipo | Nv | Vida | Daño | Exp | Notas |
|---|---|---|---|---|---|---|
| Ciudad de Solmar / Ciudad de Vhar | - | - | - | - | - | zonas seguras, sin mobs |
| Campamento goblin | goblin | 1 | 42 | 4-7 | 14 | núcleo de Solmar |
| Avanzada goblin | goblin_elite | 2 | 62 | 5-9 | 22 | |
| Pantano muerto | zombie | 3 | 85 | 7-11 | 30 | |
| Hoyos de hormiga león | antlion | 4 | 115 | 9-14 | 45 | |
| Cementerio viejo / Ruinas del nigromante | skeleton / skeleton_mage | 5 | 150 / 130 | 11-18 | 62 / 58 | |
| Hormiguero ardiente | fire_ant | 6 | 190 | 13-20 | 80 | |
| Nido de wyverns | wyvern | 7 | 240 | 16-24 | 101 | |
| Nido de la araña (boss) | arana | 7 | 720 | 14-22 | 520 | bolsillo lejano, opcional |
| Guarida del bárbaro (boss) | barbaro | 8 | 900 | 18-28 | 420 | |
| Laberinto del minotauro (mini-boss) | minotaur | 9 | 1200 | 22-34 | 560 | |
| Cueva del gólem de hielo (boss) | golem | 10 | 1300 | 24-34 | 900 | |
| Foso del demonio (boss, núcleo) | demonio | 12 | 1900 | 30-44 | 1500 | |
| Páramo reseco | antlion | 5 | 150 | 11-17 | 63 | antes goblin Nv1 (salto hacia atrás) |
| Cripta olvidada | skeleton / zombie | 6 / 7 | 191 / 237 | 13-21 | 81 / 107 | jefe final: bárbaro Nv8 |
| Camino de brasas | fire_ant | 6 | 190 | 13-20 | 80 | entrada de Tierras de ceniza |
| Forja apagada | skeleton | 6 | 191 | 13-20 | 81 | bolsillo oeste (antes un gólem Nv10) |
| Nidal de ceniza | wyvern | 7 | 240 | 16-24 | 101 | misión "Alas de ceniza" |
| Osario ardiente | skeleton_mage | 8 | 250 | 18-27 | 117 | misión "El osario ardiente" |
| Cantera del minotauro (mini-boss) | minotaur | 9 | 1200 | 22-34 | 560 | misión; suelta esquirla del foso |
| Brasas profundas | fire_ant | 10 | 407 | 20-31 | 172 | nueva |
| Guardia del foso | wyvern | 11 | 483 | 24-36 | 199 | nueva, junto a la escalera |
| Cámara del foso | skeleton_mage (x6) | 11 | 413 | 24-35 | 189 | mazmorra (antes Nv5) |
| Cámara del foso (boss) | demonio | 12 | 1900 | 30-44 | 1500 | jefe de la mazmorra |

Progresión pensada: núcleo 1-7 -> páramo 5 -> cripta 6-8 -> Tierras de ceniza 6 a 11 (oeste a este) -> foso 11-12.
Los bosses del núcleo (Nv 7-12) son bolsillos opcionales lejos del campamento; el demonio Nv12 del núcleo es el techo de todo el mapa.

## Chequeo de combate (estimación, sin defensa ni mejoras de equipo)

Daño del jugador con las fórmulas de `PVP_SPELLS`/`BASE` (`pvpCombat.ts`): Guerrero `tajo` 22-30 + 3·Nv + arma (cd 0,9 s); Mago `hoja`/`lanza` (2-3·Nv + mag) con cd 1,4/4,5 s. Vida: guerrero `140 + 18·(Nv-1)`, mago `90 + 10·(Nv-1)` (más ~8/5 por nivel de equipo).

Con un jugador de nivel igual al del mob común, matar uno lleva ~2-6 s al Guerrero y ~5-13 s al Mago (Nv 11 en el foso: 5 s / 12 s). Un mob común tarda ~20-35 s en matar al Guerrero y ~12-22 s al Mago peleando 1 a 1, así que se puede ganar cada pelea con margen y los grupos de 3-4 ya exigen parálisis, cura o pociones. Mini-boss y bosses: 14-23 s (Guerrero) y 30-50 s (Mago); el Mago tiene que kitear/paralizar.

## Cambios de esta pasada

- Nuevo `mobDef` y `Zone.lvl` (compartido), usado por el server (`mobs.ts`: vida/daño/nivel de botín) y el cliente (nivel y exp mostrados, rótulo de zona y de misión).
- Wyvern: vida 300 -> 240 y exp 130 -> 101 para quedar sobre la curva.
- Páramo: goblin Nv1 -> hormiga león Nv5. Cripta: Nv6-7. Foso: hechiceros Nv5 -> Nv11.
- Tierras de ceniza: sacado el gólem Nv10 del extremo oeste; nuevas Brasas profundas (Nv10) y Guardia del foso (Nv11). Misiones y zonas de misión sin cambios (mismos nombres y tipos).
