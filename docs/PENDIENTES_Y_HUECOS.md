# Ideas nuevas, huecos de diseño y decisiones abiertas

Fecha: 1/11/2026. Cierra la primera ronda de discusión. Junta lo que apareció al final (mercado de monedas, transmisión y clips, assets en HD) y lista lo que **todavía no se habló** o está sin decidir. Se lee junto con `ROADMAP_MVP.md`, `PLAN_DE_TRABAJO.md`, `NIVEL_40_E_ITEMS.md` y `ECONOMIA_Y_MONEDAS.md`.

## 1. Ideas nuevas

### 1.1 Mercado de monedas entre jugadores
La idea de Román: la gente consigue ítems buenos y los vende por monedas a quienes pagan. Las monedas se ganan jugando (vendiendo ítems) y se compran con dinero. La tienda de la casa solo vende monedas y servicios; **el poder circula entre jugadores**. Es el modelo de los "bonos" de otros MMO.
- A favor: quien no paga puede ganar monedas jugando; la casa no vende poder directamente.
- Cuidado: quien paga sigue comprando equipo a otros jugadores, así que es pay2win indirecto; el tope de monedas por listado y el registro de origen (`ECONOMIA_Y_MONEDAS.md` §3) son lo que lo hace controlable.
- Los aceleradores de exp u oro (qué son, cuánto duran y qué topes tienen) **siguen sin definirse**: es la pregunta abierta con respecto a las monedas.

### 1.2 Transmisión y clips
Helbreath Evolution tiene transmisión continua en YouTube y de ahí saca resúmenes. Para ERIS, de más barato a más caro:
1. **Botón de clip en el cliente** (grabar los últimos 30 s con `MediaRecorder` del navegador): no cuesta nada en el servidor.
2. **Repeticiones de arena guardadas como eventos** (no como video): se guardan los pedidos y el estado y se reproducen en un modo espectador del cliente. Barato de almacenar; se graba el video solo de lo que valga la pena.
3. **Cliente espectador sin pantalla** (Chromium + codificador de video) que sigue jefes y partidas de arena y transmite a YouTube: es lo que cuesta, porque renderizar y codificar usa CPU. Hay que medir el costo en un servidor chico antes de comprometerse; no tengo un número confiable.
Cuándo: después de la beta, salvo el botón de clip, que puede ir antes.

### 1.3 Assets en HD
Lo que sabemos: el arte de Flare (mapas y bichos) es de 192×96 por celda y hoy se escala a 0,5 en `tools/src/flare/atlas.ts` para llegar a 96×48; las hojas de un bicho miden entre 1.300×3.200 y 3.900×3.400 px. Los mapas de ciudad usan piezas de Kenney y SBS, y los sets de armadura de Solmar y Vhar los generó una IA de imágenes externa.
- **Fácil (el 80 %):** un modo de gráficos altos que use la **resolución original** de Flare (escala 1,0 en vez de 0,5) para mapas y bichos. Cuesta unas 4 veces más memoria y descarga; se mitiga cargando por mapa (que ya se hace) y dejándolo como opción en pantallas grandes.
- **Difícil:** el resto (ciudades, personajes, armaduras, ítems, interfaz) hay que **medir pieza por pieza**: cuáles ya tienen resolución de sobra y cuáles habría que redibujar o reescalar con IA. Antes de decidir hace falta una tabla de resolución nativa por familia de assets.
- Todo lo de Flare es CC-BY-SA: lo modificado hereda la licencia y se atribuye (`MAPAS_FLARE.md` §8).
- Cuándo: modo de gráficos altos para Flare como mejora de la beta; el resto, después de medir.

## 2. Huecos: lo que todavía no se discutió

| Tema | Por qué importa | Cuándo decidirlo |
|---|---|---|
| **Clases y roles de grupo** | Hoy hay guerrero y mago. Las mazmorras de grupo y los jefes piden roles (aguantar, curar, daño). Dreadmyst tiene tanque, sanador y dos de daño. ¿Hay curandero? ¿arquero? ¿cómo funciona el aggro? | **Antes de la Fase 2** (jefes de mazmorra) |
| **Habilidades y talentos** | Helbreath Evolution tiene árbol de talentos y 76 hechizos; ERIS tiene ~14 habilidades fijas y ningún árbol. Define el "build" que mencionaste | Después de los stats (1.2), antes de la beta |
| **Misiones e historia por tramo** | El "objetivo claro" de cada tramo necesita misiones con sentido; hoy son pocas y casi no dan exp | Fase 2 |
| **Reglas de wipe y temporadas** | ¿Se borra el progreso al pasar de beta a lanzamiento? Afecta cuánto se invierte en migraciones | **Antes de abrir la beta** |
| **Moderación y soporte** | Reportes, silenciar, baneos, herramientas de GM, registro de acciones. Hoy hay comandos de GM para pruebas, no moderación | Antes de la beta pública |
| **Términos de uso y privacidad** | Si hay donaciones, cuentas y datos personales: términos, política de privacidad, quién cobra y cómo (procesador de pagos), edad mínima | Antes de cobrar nada |
| **Costos de hosting** | WebSocket + Postgres + cliente: qué plan aguanta cuántos jugadores a la vez, y cuánto cuesta | Con el deploy de prueba (0.3) |
| **Respaldo y recuperación** | Copias de la base de datos y cómo se restaura una cuenta | Con el deploy de prueba (0.3) |
| **Idiomas** | ¿Español primero y después inglés? El cliente y los datos tienen textos en español | Antes de la beta |
| **Móvil y controles** | El cliente corre en el navegador: ¿hay soporte táctil? | Decidir si entra en la beta |
| **Audio** | Música y efectos con licencia clara; hoy no hay música por mapa | Fase 6 |
| **Comunidad** | Discord, wiki y rankings públicos (los usa todo juego de este estilo) | Con la beta cerrada |
| **Analítica** | Qué medir en la beta: abandono, tiempo hasta el nivel 10, muertes, oro (ver `PLAN_DE_TRABAJO.md` 6.3) | Con el deploy de prueba |
| **Repo público o privado** | Hoy es público y tiene datos de Helbreath; condiciona todo lo legal | **Ya** (Fase 0.2) |
| **Reparto de trabajo con tu amigo** | Se había pedido dividir por partes | Antes de que se sume |

Propuesta de reparto por área, a ajustar según lo que le guste a cada uno: **Servidor y economía** (stats, ítems, subasta, intercambio), **Cliente e interfaz** (ventanas, minimapa, tutorial), **Contenido y arte** (mapas, mazmorras, mobs, assets en HD), **Infra y legal** (CI, deploy, catálogos, licencias).

## 3. Decisiones abiertas (resumen)

1. Qué aceleradores se venden con monedas, y sus topes (1.1).
2. Cuánto más rápido puede subir el mago en área: valor por defecto 1,6×.
3. Cuántas horas es "mucho" para llegar al 40: valor por defecto ~30 h de veterano.
4. Si los ítems de jefe se subastan: valor por defecto, sí.
5. Si el nivel máximo de ítem es 30 (6 bandas) o 35 (7 bandas): valor por defecto, 30.
6. Clases y roles de grupo (sección 2).
7. Repo público o privado.
8. Qué entra en la beta y qué en la Fase 1 (lo que se dijo que se iba a leer después).
