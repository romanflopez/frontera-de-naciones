# Motor de jefes

Estado: **implementado en el server, con el dibujo mínimo en el cliente** (2/11/2026). Diseño en los docs del proyecto `motor-de-jefes.md` y `dreadmyst-referencia-jefes-y-loot.md`. Datos en `packages/world/src/bosses.ts`, ejecución en `apps/server/src/bosses.ts`.

## Cómo funciona

Cada jefe con kit (`BOSS_KITS`) y cada add lanzador (`ADD_KITS`) tiene un estado de motor. Mientras persigue a alguien, en cada vuelta de la IA:

1. **Umbrales:** adds al cruzar su % de vida (una sola vez), furia al 25 % y furia final por tiempo.
2. **Casteo en curso:** el jefe se queda quieto; al terminar aplica el efecto (o la salida alternativa).
3. **Siguiente mecánica:** de las que están listas, la que más tiempo lleva esperando (así ninguna se queda sin salir), si está en rango, respetando el **respiro de 4 s** entre mecánicas (dos fuertes nunca caen juntas) y el **bloqueo de escuela** después de un corte.

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
| `pull` (tirón y explosión) | Arrastra a todos al lado del jefe y marca un círculo que estalla (el Vortex → Apocalypse de Dreadmyst) | Salir corriendo del círculo |
| furia apilable | +3 % de daño cada 10 s de pelea (el Duke's Fury de Dreadmyst) | No alargar la pelea (cortar la autocura) |
| `dispel` | Les saca los buffs y escudos a los alcanzados | Volver a ponerlos |
| `heal` | El jefe se cura una parte de su vida | Cortar |
| terror | El jugador sale despedido ~4 celdas lejos del jefe y queda aterrado | Cortar o alejarse antes |

## Cortes

- **Corte duro** (en cualquier momento): Cadenas de hielo (`paralisis`), Nova de escarcha, Escudo vengador, Martillo de justicia, Carga sagrada, Reprender.
- **Corte blando** (solo en la ventana, el 40 % final de la barra con mínimo 0,8 s): Castigo, Juicio, Esquirla de hielo.
- Al cortar: "¡Interrumpido!" con el nombre de quien cortó, el jefe queda **1 s sin castear** y esa **escuela bloqueada 4 s**.
- **Los jefes con kit son inmunes al aturdir**: el control corta el casteo pero no los deja quietos. Los adds sí se aturden.

## Los jefes

**Jefe goblin (D1):** Pisotón (círculo de 3 alrededor, aviso 1,3 s, aturde 1 s) · Grito de terror (casteo de 2 s, terror de 3 s en 6 celdas; si te alejás más de 4, te carga y te frena 4 s) · al 50 %, 2 goblins y, en dúo o más, un chamán que castea Fogonazo · furia al 25 %. Ningún corte es obligatorio.

**Reina hormiga león (D2):** Chorro de ácido (círculo en uno al azar que deja un charco de 6 s) · Lluvia de ácido (casteo de 2,5 s cada ~12 s que saca el 70 % de la vida a todos si no se corta) · Mordida corrosiva (al tanque, ×3 y sangrado de hasta 3 pilas) · crías al 60 % y al 30 %, con una obrera escupidora que castea anti-cura · furia al 25 % y furia final a los 5 min.

**Caballero de la cripta (D3):** Golpe de escudo al tanque · Juramento oscuro (se cura 12 % si no se corta) · Tajo sombrío (círculo en uno al azar) · esqueletos al 60 % y al 30 % (con un hechicero que castea) · furia apilable · furia al 25 %.

**Mago mayor (D4):** Bola arcana a uno al azar (cortable) · Lluvia de fuego de sala (60 %, cortable) · Vórtice (tirón y explosión) · Disipar magia con candado · aprendices que castean al 50 % · furia al 25 %.

**Wyvern del aire (D5):** Ráfaga (círculo que deja un remolino) · Rugido de sala que aterra (cortable) · Tormenta de viento con candado (40 % a todos: escudos y curas) · Zarpazo al tanque con sangrado · dos wyverns chicos al 50 % · furia al 25 % y furia final a los 6 min.

**Señor del Foso (D6):** Salto sísmico al tanque · Llamas del foso de sala (65 %, cortable) · Vórtice infernal · Desgarro con sangrado · Grito del foso (aterra y disipa, cortable) · wyverns de fuego al 60 % y al 30 % con un brujo · furia apilable · furia al 25 % y final a los 7 min.

Los seis jefes tienen sus dos ítems propios (D4 a D6 en la banda T6) y las misiones del Camino de D4, D5 y D6 dejan elegir uno.

## Protocolo

`BossCast`, `BossCastEnd` (0 salió, 1 cortado, 2 cancelado), `BossTelegraph`, `BossZone` y `BossPhase` (`adds`, `furia`, `furia_final`, `reinicio`), tags 1100-1104 de `ServerMessage`.

## Reinicio

Si nadie lo sigue y vuelve a su lugar: se cancela el casteo, se van los adds, y la pelea arranca de cero (fases, timers, furia).

## Cliente

Lo mínimo para jugar (`apps/client/src/main.ts`, "motor de jefes"): barra de casteo con el color de la escuela y el tramo dorado de la ventana, candado, "¡Interrumpido!", círculos de aviso que se llenan, charcos verdes y nombre en rojo con furia. Falta lo visual fino: íconos de escuela, sonido, efectos propios.

## Pendiente

- Silencio y rompe-armadura de Dreadmyst (no los usa ningún jefe del MVP).
- Lo visual fino del cliente: íconos de escuela, sonido, efectos.
- Calibrar los números en la prueba jugada.
