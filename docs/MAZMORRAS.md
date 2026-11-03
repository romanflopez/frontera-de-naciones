# Mazmorras: corridas, una vida, escalado por party y élites

Estado: **implementado en el server** (2/11/2026). Sigue a `DUNGEONS_INSTANCIAS.md` (instancia por party) y toma las reglas de Valdrys y Dreadmyst que están en el proyecto (`kits-de-clase.md` §5 y `dreadmyst-referencia-jefes-y-loot.md`).

## Corridas

- Una **corrida** es una instancia de mazmorra: todos sus pisos son los mundos `mapa#<id>` con el mismo id (`p<party>-<n>`, o `u<sesión>-<n>` sin party).
- **Entrar desde afuera a una mazmorra vacía arranca una corrida nueva**, con todo vivo. Si la corrida de tu party sigue con alguien adentro (en cualquier piso), te sumás a esa.
- Una corrida está viva mientras quede alguien (o alguien llegando) en alguno de sus pisos. Cuando queda vacía, se da de baja al minuto (`DEFAULT_INSTANCE_TTL_MS`). La próxima entrada ya es otra corrida aunque la vieja no se haya borrado.
- **Las instancias no hibernan.** Antes, un piso vacío se dormía a los 15 s y al despertar renacían todos los mobs: bajar al piso 2 y volver al 1 lo encontraba lleno. Ahora el piso queda como estaba hasta que la corrida entera se vacía.

## Lo muerto queda muerto

Dentro de una corrida **no reaparece nada, jefe incluido** (`MobSimOptions.noRespawn`). Para repetir hay que salir y entrar a una corrida nueva, con su llave. Fuera de las mazmorras todo sigue igual (pits a 10 s, sueltos a 22 s, jefes de mundo con su tiempo).

## Una vida por corrida

- Si caés, todavía te pueden levantar con Despertar dentro de los 10 s (regla de K8).
- Al reaparecer, **volvés a la superficie** (el `rest` del mapa) con el aviso "Caíste: tu corrida terminó", y la corrida te marca.
- **No podés volver a entrar a esa corrida** mientras siga viva: ni por la puerta ni arrastrado por tu party. Cuando tu party sale y la corrida queda vacía, podés entrar a una nueva.
- Salir por la escalera o con el regreso a la ciudad no te marca: si la party sigue adentro, podés volver (pagando la llave de nuevo).

## Escalado por party

Los números de los mobs y jefes de mazmorra están pensados para **3 jugadores**. Al crear la corrida se cuenta a los que entraron juntos (el que cruza más los compañeros que arrastra) y se reescala toda la instancia (`dungeonPartyScale` en `packages/world/src/mobTraits.ts`):

| Jugadores | Vida | Daño |
|---|---|---|
| 1 | ×0,5 | ×0,85 |
| 2 | ×0,75 | ×0,925 |
| 3 | ×1 | ×1 |
| 4 | ×1,25 | ×1,075 |
| 5 | ×1,5 | ×1,15 |

- Se aplica sobre todo lo demás (el ×2,5 de vida de `DUNGEON_MULT`, los rasgos), al golpe común, al disparo, a la habilidad del jefe y a la explosión.
- Los otros pisos de la corrida nacen con la misma escala. **Los que se suman después no reescalan.**
- La exp y el botín de cada mob no cambian (la exp ya se reparte en la party). Ojo: hoy un jugador solo gana más exp por minuto que un trío; se mira en la prueba jugada.
- El server manda la **vida máxima real** en la foto de mobs (`MobSnap.hp_max`), así la barra del cliente sale bien con élites y escalado.

## Élites

- Rasgo nuevo `TRAIT_ELITE` (64): **vida ×3, daño ×1,4, botín ×2, exp ×3 y +2 celdas de aggro**. Se muestra como "Élite" delante del nombre.
- No se sortea: en las zonas de mazmorra (`tier: 'dungeon'`, o sea los mapas de Flare marcados como mazmorra), **el primer mob de cada zona par, si la zona tiene 2 o más, es élite** (un élite cada dos packs). Un élite nunca es mutante, pero puede traer una habilidad (tóxico, explosivo…).
- Los jefes no tienen rasgos.

## Checklist de instancia (de los bugs que tuvo Dreadmyst)

- **Sin correa en las corridas:** un mob que persigue no vuelve a su lugar curado por alejarse; si se traba 3 s sin llegar, aparece al lado de su objetivo.
- **La invisibilidad no saltea mazmorras:** un mob que ya tiene amenaza sobre vos no te pierde por ponerte invisible (afuera sí, para escapar).
- **No se entra a una corrida en combate:** si los de adentro están peleando, el que llega espera.
- **Nada reaparece adentro** (ver arriba) y **el botín no depende del líder:** cada uno cobra lo suyo.
- **Al cambiar de mapa** el cliente suelta el objetivo, el movimiento y lo que tenía en cola.
- **Los cofres no existen en las mazmorras del MVP** y el pergamino de teleport no se usa: no hay nada que revisar ahí.

## Élites en el cliente

Rombo dorado sobre la cabeza, nombre "Élite …" en dorado y su barra de vida siempre visibles.

## Densidad

Primera pasada automática (`DUNGEON_DENSITY` en `packages/world/src/flare/index.ts`): **D1 25, D2 40, D3 49, D4 49, D5 55, D6 55 y D7 58** mobs (D7 con packs de 4), sin sueltos y con el jefe intacto. La ubicación fina de packs a mano sobre el mapa queda como ajuste.

## Cronómetro de corrida

La corrida arranca su reloj al entrar. Cuando cae el jefe, todos los del piso ven "<Jefe> cayó. Corrida de <mapa>: mm:ss (n jugadores)." y el server deja una línea `[Corrida] <instancia> jefe=… duracion_s=… jugadores=…` en el log. Sirve para medir en las pruebas la meta de duración: ~25 min solo/dúo y ~30 en grupo, la primera vez y a paso lento (después, con equipo, baja). El modelo de `NIVEL_40_E_ITEMS.md` da hoy ~15-23 min, con jefes de 1-1,5 min: si se queda corto, se estiran los jefes antes que sumar mobs.

## Pendiente

- La exp y el botín de cada mob no se escalan por party: hoy un jugador solo gana más exp por minuto que un trío. Se mira en la prueba.
