# Motor de jefes

Estado: **implementado en el server, con el dibujo mínimo en el cliente** (2/11/2026). Diseño en los docs del proyecto `motor-de-jefes.md` y `dreadmyst-referencia-jefes-y-loot.md`. Datos en `packages/world/src/bosses.ts`, ejecución en `apps/server/src/bosses.ts`.

## Cómo funciona

Cada jefe con kit (`BOSS_KITS`) y cada add lanzador (`ADD_KITS`) tiene un estado de motor. Mientras persigue a alguien, en cada vuelta de la IA:

1. **Umbrales:** adds al cruzar su % de vida (una sola vez), furia al 25 % y furia final por tiempo.
2. **Casteo en curso:** el jefe se queda quieto; al terminar aplica el efecto (o la salida alternativa).
3. **Siguiente mecánica:** la primera lista de su lista, si está en rango, respetando el **respiro de 4 s** entre mecánicas (dos fuertes nunca caen juntas) y el **bloqueo de escuela** después de un corte.

Los jefes que no tienen kit siguen con su `special` de siempre.

## Tipos de mecánica

| Tipo | Qué hace | Respuesta |
|---|---|---|
| `cast` | Barra con nombre y escuela; al terminar, efecto en radio (o a un objetivo): daño en múltiplos del golpe del jefe o en % de la vida, aturdido, terror, frenado, anti-cura, autocura | Cortar |
| `cast` con `alt` | Si al terminar su objetivo está lejos, en vez del efecto lo carga y lo frena (el Minotauro de Kandorys) | Cortar o alejarse |
| `cast` con `lock` | Candado: no se corta | Defenderse o moverse |
| `telegraph` | Círculo en el piso (en el jefe, en el tanque o en uno al azar) que pega a los `warnMs`; puede dejar un charco | Salir del círculo |
| charco (`pool`) | Pega cada segundo a quien esté adentro durante `secs` | No pararse ahí |
| `tankHit` | Aviso corto y golpe ×`mult` al que tanquea, con sangrado que se apila | Escudos, curas, alejarse |
| adds | Mobs al cruzar un umbral; algunos solo en dúo o más; pueden tener su propio kit (el chamán castea) | Área, cortar al lanzador |
| furia | Daño ×1,5 y casteos 30 % más cortos; la furia final por tiempo, daño ×3 | Matarlo antes |

## Cortes

- **Corte duro** (en cualquier momento): Cadenas de hielo (`paralisis`), Nova de escarcha, Escudo vengador, Martillo de justicia, Carga sagrada, Reprender.
- **Corte blando** (solo en la ventana, el 40 % final de la barra con mínimo 0,8 s): Castigo, Juicio, Esquirla de hielo.
- Al cortar: "¡Interrumpido!" con el nombre de quien cortó, el jefe queda **1 s sin castear** y esa **escuela bloqueada 4 s**.
- **Los jefes con kit son inmunes al aturdir**: el control corta el casteo pero no los deja quietos. Los adds sí se aturden.

## Los dos jefes del MVP

**Jefe goblin (D1):** Pisotón (círculo de 3 alrededor, aviso 1,3 s, aturde 1 s) · Grito de terror (casteo de 2 s, terror de 3 s en 6 celdas; si te alejás más de 4, te carga y te frena 4 s) · al 50 %, 2 goblins y, en dúo o más, un chamán que castea Fogonazo · furia al 25 %. Ningún corte es obligatorio.

**Reina hormiga león (D2):** Chorro de ácido (círculo en uno al azar que deja un charco de 6 s) · Lluvia de ácido (casteo de 2,5 s cada ~12 s que saca el 70 % de la vida a todos si no se corta) · Mordida corrosiva (al tanque, ×3 y sangrado de hasta 3 pilas) · crías al 60 % y al 30 %, con una obrera escupidora que castea anti-cura · furia al 25 % y furia final a los 5 min.

## Protocolo

`BossCast`, `BossCastEnd` (0 salió, 1 cortado, 2 cancelado), `BossTelegraph`, `BossZone` y `BossPhase` (`adds`, `furia`, `furia_final`, `reinicio`), tags 1100-1104 de `ServerMessage`.

## Reinicio

Si nadie lo sigue y vuelve a su lugar: se cancela el casteo, se van los adds, y la pelea arranca de cero (fases, timers, furia).

## Cliente

Lo mínimo para jugar (`apps/client/src/main.ts`, "motor de jefes"): barra de casteo con el color de la escuela y el tramo dorado de la ventana, candado, "¡Interrumpido!", círculos de aviso que se llenan, charcos verdes y nombre en rojo con furia. Falta lo visual fino: íconos de escuela, sonido, efectos propios.

## Pendiente

- Terror de verdad (hoy es un aturdido con otro nombre; falta hacer correr al jugador).
- Las 6 mecánicas nuevas de Dreadmyst (furia apilable, autocura, tirón y explosión, rompe-armadura, silencio y disipar, fase inmune): el motor ya tiene el `heal` del casteo; el resto va con los jefes de D3 en adelante.
- Calibrar números en la prueba jugada (daño de cada mecánica, ritmo de cortes con 1, 2 y 3 jugadores).
