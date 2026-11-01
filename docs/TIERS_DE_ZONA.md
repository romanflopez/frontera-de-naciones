# Tiers de zona (estilo Albion)

Fecha: 1/11/2026. Respuesta a la pregunta de Román: con muchos mapas no se puede regular a mano la dificultad, los mobs y los drops de cada uno. La idea es que **cada zona tenga un tier recomendado**, como en Albion, y que el tier decida casi todo. Entra al plan como **paso 1.5** (después del 1.4), porque también resuelve el problema que dejó el paso 1.1: hoy no hay mapas por encima del nivel ~12.

## 1. La idea

Un solo número por mapa (`tier`, del 1 al 7) que se ve en el juego ("Zona T3 · niveles 11-15") y del que salen:
- el **nivel de los mobs** de cada pit (dentro del rango del tier);
- la **banda de ítems** que sueltan (tier de zona = banda de ítems, paso 3.1);
- el **nivel recomendado** y el nivel mínimo para entrar (sin máximo);
- la **dificultad de la mazmorra** del tier.

Con eso agregar un mapa es asignarle un tier, no recalcular nada. Y un validador comprueba que todo cierre.

## 2. Los tiers

| Tier | Niveles recomendados | Banda de ítems | Mazmorra de la banda |
|---|---|---|---|
| T1 | 1-5 | T1 | D1 |
| T2 | 6-10 | T2 | D2 |
| T3 | 11-15 | T3 | D3 |
| T4 | 16-20 | T4 | D4 |
| T5 | 21-25 | T5 | D5 |
| T6 | 26-30 | T6 | D6 |
| T7 | 31-40 | T6 (más legendarios) | dificultades altas y armas legendarias |

Dentro de un mapa, los pits A, B y C quedan dentro del rango del tier (A el más fácil, C el más difícil, como hoy con ±1 nivel).

## 3. Con los mapas que ya hay alcanza hasta el tier 6

Los 12 mapas abiertos de hoy están apretados en los niveles 1-11 (uno por nivel). Como `mobDef` reescala cualquier mob que no sea jefe a cualquier nivel con el mismo sprite, se pueden **repartir entre los 6 tiers, dos por tier**, sin dibujar nada:

| Tier | Mapas (propuesta) |
|---|---|
| T1 | Campos de Sal, Bosque de Piedra, Cañón goblin |
| T2 | Pantano de Merrimead, Altas de Nazia |
| T3 | Cementerio de Lochport, Risco del Sur |
| T4 | La Brecha, Paso de Stormrock |
| T5 | Cenizas I, Cenizas II |
| T6 | Cenizas III |

Faltan mapas para el T7 (niveles 31-40) y más variedad en los tiers altos: salen de la reserva de Flare. Hoy hay 12 mapas de mazmorra (niveles 2 a 12, de la Cueva goblin al Foso del demonio): se reparten dos por tier y los jefes no se reescalan solos, hay que subirles el nivel a mano (ver paso 3.1).

## 4. Cómo se implementa

- `MapDef` suma `tier` (1-7). Las ciudades y zonas seguras no lo llevan.
- Una función `zoneLevel(tier, pit)` da el nivel de los mobs de cada pit; las zonas dejan de escribir `lvl` a mano.
- El tier de la zona decide la banda de ítems del botín (paso 3.1); el requisito de nivel de la puerta es el mínimo del tier menos 2, y no hay máximo.
- Al entrar a la zona, el cliente muestra el tier y el rango recomendado (el cartel de zona ya muestra el nivel).
- Variante más adelante, a la Albion: **color de riesgo** por zona (segura, normal, de frontera con PvP de nación, de guerra). Hoy el PvP ya se define por mapa (`pvp: 'off' | 'facción'`); esto solo lo haría visible y lo ataría al tier.

## 5. Pruebas (paso 1.5)

- A: la tabla de tiers cubre los niveles 1 a 40 sin huecos ni solapes.
- B (en `validateMapGraph`): todo mapa abierto tiene `tier`; los niveles de los pits caen dentro del rango del tier; los mapas con mazmorra de grupo apuntan a la mazmorra del mismo tier.
- B: cada tier de 1 a 6 tiene al menos 2 mapas abiertos y 1 mazmorra; el T7 se admite vacío hasta que existan mapas.
- B: un mob suelta ítems de la banda de su zona o de la anterior.
- E: recorrer los 12 mapas de T1 a T6 con un personaje de nivel adecuado y comprobar que se puede subir de nivel sin quedarse sin mobs ni pasarse de nivel antes de salir del tier.

## 6. Efecto sobre el paso 1.1

Con esto desaparece el límite práctico del nivel 12: un personaje de nivel 25 tiene zonas T5 con mobs de su nivel. Hasta que se haga el paso 1.5, para probar niveles altos se sigue usando `/gm nivel`.
