# Revisión punta a punta (pantalla por pantalla)

Fecha: 5/11/2026. Román y Claude recorren el juego desde el login y anotan qué falta, qué está mal y qué decisión hace falta. Cada pantalla: **estado** (qué hay), **a corregir** (bugs/ajustes), **falta** (cosas nuevas) y **decisiones**. Los puntos cerrados se marcan `[x]`. Cuando una sección queda cerrada pasa a pasos del `PLAN_DE_TRABAJO.md`.

Código: `apps/client/index.html` (bloque `#login`), `apps/client/src/loginui.ts`, `login.css`, GUI kit comprado en `public/assets/ui/craftpix/`. Server: `apps/server/src/accounts.ts`.

---

## 1. Login

**Estado:** usuario + contraseña (4-64 caracteres), "Recordarme", crear cuenta en el mismo formulario (repetir contraseña), créditos, fondo con brasas y niebla por código, logo `assets/logo-eris.webp`.

**A corregir**
- [ ] GUI kit: ya está puesto; pulir un toque (Román). Definir qué se pule cuando se mire con los logos nuevos.
- [x] **Paso D.18 (5/11), login y crear cuenta:** sin versales (tipografía Alegreya con minúsculas; `Alegreya SC` y `Cinzel` dibujan todo en mayúsculas), sin borde dorado (campos, botones, checkbox, separadores y corchetes del botón pasan al acero/azul del kit), etiquetas visibles en vez de solo placeholder, botón mostrar/ocultar contraseña, **Iniciar sesión** y **Crear cuenta** juntos en el formulario, «¿Olvidaste tu contraseña?» chico al lado de «Recordarme», pie solo con Créditos, botón principal que dice «Conectando…» con spinner mientras espera.
- [x] **El fondo no se movía:** la capa del kit (`lg-bg.webp`) se pintaba encima de las brasas, la niebla y el zoom y los tapaba. Ahora van por encima, en tonos fríos (celeste y verde agua, al tono del kit y de la gema del logo) y la capa del kit deriva despacio; con `prefers-reduced-motion` queda quieto.
- [x] **Contraste medido** (capturas reales a 1366×768, texto contra el fondo renderizado): antes «¿Olvidaste…?» 2,4:1 y el error 1,6:1 en la zona más clara. Con un velo oscuro suave detrás del formulario y grises más claros todo el texto normal pasa de 4,5:1 (el texto del botón principal es grande y negrita: pide 3:1).
- [ ] **«¿Olvidaste tu contraseña?» todavía no hace nada:** muestra un aviso en el lugar del error. Se cablea en D.17 (email en la cuenta + Resend).
- [ ] **Errores de login (server, va con D.17):** hoy «Contraseña incorrecta. Si el nombre ya es de otra persona, elegí otro.» confirma que el usuario existe, y **iniciar sesión y crear cuenta son el mismo pedido**: un usuario que no existe crea la cuenta sola, así que un error de tipeo en el nombre crea una cuenta nueva. Hace falta una intención explícita (login vs registro) y un mensaje genérico «Usuario o contraseña incorrectos», con la misma demora en ambos casos.
- [ ] **Bloqueo por intentos:** 5 fallos por nombre en 10 minutos bloquean al nombre **aunque se ponga la clave correcta** (se comprobó en local); cualquiera puede dejar afuera a otro jugador. Mejor espera creciente por IP + nombre que bloqueo duro.
- [ ] **Login lento y «Se cortó la conexión»** (lo ve Román en `onrender.com`): en local el server responde la clave incorrecta en ~70 ms y manda el motivo del cierre bien. Hipótesis a descartar en producción: servicio dormido del plan gratuito de Render o un proxy que descarta el motivo del cierre del WebSocket. Si es lo segundo, el cliente tendría que recibir el error como mensaje y no solo en el cierre.
- [x] Contraseña mínima de 4 caracteres es poco para un juego público: **subir a 8** (Román, 5/11). Las cuentas existentes no se tocan; se pide al cambiar.

**Falta**
- [ ] **Logo de ERIS** definitivo (hoy hay uno provisorio). Román define.
- [ ] **Recuperar contraseña.** Requiere: (1) **email en la cuenta** (hoy la cuenta es solo usuario + hash; `accounts.ts` no tiene email), (2) un proveedor de mail (Resend, gratis hasta 3.000/mes, va por HTTPS así que pasa el allowlist de Render), (3) flujo: "Olvidé mi contraseña" → email → link con token de 30 min → nueva contraseña. Las cuentas viejas sin email lo cargan la primera vez que entran (opcional hasta que quieran recuperar).

**Decisiones**
- [x] **Email obligatorio** al crear cuenta, sin verificar al principio (se verifica solo si se usa para recuperar). Envío con Resend. (Román, 5/11)

## 2. Selección de personaje

**Estado:** lista de hasta 3 personajes (clase, nación, nivel), arte del personaje elegido (`#selArt`, canvas con el muñeco), detalle al costado, borrar con confirmación escribiendo el nombre (`#delBox`, hecho a mano en CSS), botones Volver y Jugar.

**A corregir**
- [x] **Muñeco nítido y centrado (D.18, 5/11):** el canvas se dimensiona en píxeles reales de pantalla (el escenario escala con `--s`) y el sprite se dibuja a **escala entera sin suavizado**, así que cada píxel del arte ocupa un número entero de píxeles; se acomoda al cambiar el tamaño de la ventana (`resizeDolls`). Crear personaje estaba 45 px a la izquierda del centro. **Sigue siendo pixel art de 64 px**: para que deje de verse pixelado hacen falta sprites en mayor resolución (`PLAN_HD.md`).
- [x] **Sin versales ni dorado (D.18):** títulos, nombres, botones y fichas en minúscula; fuera la guarda dorada de los encabezados, el filete del botón Jugar y los corchetes dorados. «+ Crear personaje» es un botón con borde punteado, la X de borrar mide 32 px, vida roja y maná azul (antes al revés).
- [ ] (ya estaba) Redistribuir la pantalla (Román): el muñeco queda pixelado y descentrado. Causa probable: el canvas del muñeco se escala con `data-h` sin `image-rendering` ni tamaño múltiplo del sprite; hay que fijar el tamaño del canvas al del sprite × un entero y centrarlo en una columna propia.
- [ ] Los dos botones de abajo son distintos (ghost "Volver" / primario "Jugar"): está bien así, se mantiene.
- [x] **Modal de borrar: usar el del GUI kit** (D.18, hecho; falta que Román lo pruebe) en vez del `delbox` a mano (hay `win-bg`, `win-hdr-*`, `btn-sq` en `craftpix/`). Misma lógica (escribir el nombre), solo cambia la piel.

**Falta**
- [x] Detalle del personaje: el mapa donde quedó ya está; **última conexión** hecha en D.18 (el server la guarda al entrar y al salir del mundo). EK cuando exista.
- [ ] **Logo/escudo de cada nación** (Solmar, Vhar) y **emblema de cada clase** (paladín, clérigo, mago, arquero): hoy se dibujan por código (`shield()`, `clsIcon()`). Román define si van como arte propio o quedan por código.

## 3. Crear personaje

**Estado:** elegir nación y clase (fichas con texto), arte del muñeco, nombre, Volver/Crear. Stats iniciales fijos por clase (no se eligen).

**A corregir**
- [x] Mismo problema de escala/centrado del muñeco que en selección: arreglado en D.18 (ver §2).
- [x] Campo de nombre con etiqueta visible, texto alineado a la izquierda y velo oscuro para que se lea (D.18).
- [ ] Solo 3 clases: agregar **arquero** cuando exista (D.0 deja el esqueleto; hasta entonces no se muestra).

**Falta**
- [x] (D.18) Fichas de nación con su escudo y una línea de identidad (bosque y mar / nieve) y fichas de clase con su emblema y rol en una línea (los roles de `DISEÑO.md` §4).
- [ ] Vista previa del set inicial de la clase en el muñeco (hoy el muñeco es genérico).

**Decisiones**
- [ ] ¿Se puede cambiar de nación después? Hoy no. La tienda de gemas lo lista como servicio (`ECONOMIA_Y_MONEDAS.md`); si va, hay que decidir qué pasa con guild, EK y contribución al cambiar. Voto: después de la beta.

---

## 4. Carga y entrada al mundo

**Estado:** pantalla de carga inicial (`#loading`), pantalla "Viajando a" por mapa (`#maploading`), después el mundo.

**A corregir**
- [x] **Al entrar se ven el HUD (D.14, falta prueba manual) y el chat antes de que cargue el mundo** (Román, 5/11): el HUD se destapa al pasar el login, antes de recibir el estado inicial del mapa. Arreglo: el HUD, el chat y el minimapa quedan `hidden` hasta que llegue `InitialGameWorldState` **y** el mapa esté renderizado; la pantalla "Viajando a" se mantiene arriba de todo hasta ese momento y recién ahí se funde. Un solo estado `worldReady` en el cliente del que dependen los tres, en lugar de destaparlos por separado.
- [x] Revisar que al cambiar de mapa pase lo mismo (D.14) (que no se vea el mapa viejo ni el HUD "vacío" mientras llega el nuevo).

**Falta**
- [ ] Primeros minutos / tutorial: pendiente (fase 6.1 del plan).


## 5. HUD y chat

**Estado:** HUD centrado abajo (`#hudroot`: orbes, hotbar 1-0, pociones, exp), con una franja reservada de 200 px (`--hud-h`). El chat (`#chat`, entrada + selector de canal) y el log (`#log`) están **arriba de esa franja**, a la izquierda, apilados sobre el HUD. Botones de ventanas (`#bagBtn`) sueltos. Buffs, toast, ayuda y party también se posicionan contra `--hud-h`.

**A corregir**
- [x] **Chat al lado del HUD, no arriba** (D.15, hecho; falta que Román lo pruebe) (Román, 5/11): como en todos los MMO, el chat va **abajo a la izquierda, a la misma altura que el HUD**, y el HUD queda centrado (o corrido a la derecha si no entra). Propuesta:
  - `#chatPanel` abajo-izquierda, `bottom: 8px`, ancho 340-380 px, alto 150-180 px, con **log e input juntos** en un solo panel con fondo del GUI kit (hoy el log flota sin fondo y no se puede scrollear).
  - **Pestañas de canal** en el borde superior del panel (General / Nación / Party / Guild / Sistema) en lugar del selector chico `#chatCh`; el combate (daño, drops) va a una pestaña Sistema para no tapar la charla.
  - En pantallas angostas (< 1400 px) el HUD ya se escala con `--hud-scale`; si igual se pisan, el chat se achica a 280 px antes de que el HUD baje de escala.
  - Buffs, toast, ayuda y party dejan de depender de `--hud-h` y se posicionan contra el HUD real.
- [ ] (sin hacer, no entra en D.15) Botones de ventanas (`Personaje`, `Bolsa`, `Misiones`, `Libro`, `Guild`, `Salir`): pasan a una **barra de íconos** del GUI kit al lado del HUD (derecha), con la tecla en el tooltip.

**Falta**
- [ ] **Orbes de vida y maná sin efecto** (Román, 5/11): hoy tienen líquido con burbujas por CSS pero no se sienten. Propuesta: ola doble en el borde del líquido, brillo que respira cuando estás lleno, pulso rojo y viñeta cuando la vida baja del 25 %, y "sacudón" del orbe al recibir un golpe grande. Nada que cueste rendimiento: CSS y un canvas chico.
- [ ] El resto del HUD (hotbar, pociones, exp, minimapa) queda como está por ahora (Román, 5/11); se revisa más adelante.

## 6. NPCs de ciudad

**Estado:** cada ciudad tiene 8 interiores con su NPC (vendedores, herrero, depositario, Capitán, arenero). Al hablar hay diálogo (`#qdlg`) y después se abre la tienda. `CIUDADES.md` §7 ya pedía una auditoría de NPCs.

**A corregir**
- [ ] **Rehacer los NPCs** (Román, 5/11): sprites propios con el mismo origen de arte que las ciudades nuevas (Blender, misma cámara y luz), uno por rol, con una variante de paleta por nación.
- [x] **Hablar con un vendedor abre directamente lo que vende** (D.19, hecho; falta que Román lo pruebe) (Román, 5/11), sin diálogo previo. Como mucho una línea de saludo en la cabecera de la ventana de la tienda. El diálogo queda solo para los NPCs de misión (Capitán) y el arenero.

**Falta**
- [x] (D.19) Nombre y rol sobre la cabeza del NPC (el rol en texto, más el ícono que ya tenía). El ícono de rol en el minimapa no se tocó.

**Decisiones**
- [x] Los vendedores venden lo mismo en las dos ciudades; la diferencia es visual (Román, 5/11).


**Decisiones**
- [x] Chat colapsable: se hace y se prueba (Román, 5/11). Enter abre, Esc cierra; colapsado muestra las últimas 3 líneas sin fondo.


## 7. Ventanas (personaje, bolsa, libro, misiones, tienda, depósito, subasta)

**Estado:** ventanas flotantes `.fw` de **alto fijo** (340×516 px; personaje 640 px), arriba a la derecha, escaladas enteras con `--win-scale` para entrar entre el borde superior y los 200 px del HUD (`main.ts:2204`). Las grillas de ítems tienen `overflow: auto`. Román está rehaciendo Personaje e Inventario en el canvas de diseño.

**A corregir**
- [ ] **Scrolls innecesarios y ventanas que no entran** (Román, 5/11). Causa: alto fijo + escalar todo + reservar 200 px al HUD. Arreglo:
  - Las ventanas toman el alto de su contenido con `max-height: calc(100vh - HUD real - márgenes)`; sin `--H` fijo.
  - La grilla de la bolsa muestra **todas las casillas sin scroll** (p. ej. 5×8 = 40) y el scroll existe solo si de verdad hay más; la ventana de personaje separa equipo/atributos/stats en pestañas si no entra, en lugar de apilar y scrollear.
  - `--win-scale` baja solo como último recurso (piso 0,8 en vez de 0,45): antes de achicar, se reorganiza.
  - Con el chat al lado del HUD (§5), el espacio reservado baja de 200 px a lo que mide el HUD real.
- [x] **Tienda (vendedores) rota** (Román, 5/11; D.16 parcial). Era un solo componente (`renderShop` en `main.ts`, estilos en `bag-craftpix.css`) compartido por mercader, armero, armadurero, joyero y alquimista: una grilla de 2 columnas dentro de un marco de 392 px (el cuerpo medía 559 px: scroll horizontal y tarjetas angostas con el nombre cortado). Ahora: Comprar y Tu bolsa **lado a lado**, filas con nombre completo (hasta 2 líneas), rareza/tipo y precio con moneda, cada panel con su scroll **solo vertical**, sin scroll horizontal; el marco queda centrado, con alto que deja libres el HUD de abajo y el saludo del vendedor (D.19) arriba de los paneles (en < 720 px los paneles se apilan). Falta: confirmar antes de vender y el oro del jugador con etiqueta.
- [ ] Mismo criterio para libro, misiones, tienda, depósito, subasta y arena: una pasada ventana por ventana en una pantalla de 1366×768, que es la peor que vale la pena soportar.

**Falta**
- [ ] Piel del GUI kit en todas las ventanas (hoy mezclan kit y CSS a mano).
- [ ] Ventanas de Personaje e Inventario: las nuevas que hace Román en el canvas reemplazan a las actuales.

**Decisiones**
- [ ] Resolución mínima soportada: voto **1366×768**; abajo de eso no se garantiza nada.

## 8. Juego: moverse, mouse, pegar, castear, morir

**Estado:** movimiento continuo con predicción local (`moveFree`, 20 envíos/s), velocidad que manda el server (280 ms/celda caminar, 170 correr; D.12). Cursor nativo (`cursor: image-set(...)` a 1x y 2x, con hotspot) para la flecha y sus variantes (espada, globo, portal, moneda, retícula de hechizo listo) en `cursor.ts`; el canvas overlay de 88 px queda solo para el anillo de casteo.

**A corregir**
- [x] **Se mueve lento** (D.12, hecho; falta que Román lo pruebe y afine) (Román, 5/11). No es red: es el valor. Probar 280 ms caminar / 170 correr (server, `movementSpeedMs`) y decidir jugando; el tope de 200 en combate de `COMBATE.md` se revisa con el mismo criterio.
- [x] **Mouse con "sensibilidad loca"** (D.13, hecho; falta que Román lo pruebe) (Román, 5/11). Causa: el cursor es un overlay que va un frame atrás del mouse real y flota cuando bajan los fps. Arreglo: la flecha pasa a **cursor nativo** (`cursor: url(...)`, con hotspot) y el canvas queda solo para el anillo de casteo y la retícula. Verificar además que el clic caiga en la celda bajo la flecha con `devicePixelRatio` ≠ 1 y con el canvas escalado.
- [x] **La movilidad es lo que está mal, antes que todo lo demás** (D.12, hecho: correr por defecto, caminar al castear, arranque y giro; falta frenado y la prueba de Román) (Román, 5/11): es el primer ítem de esta sección a resolver, jugando, no en papel. Velocidad, aceleración al arrancar/frenar, giro, y que correr sea el default.
- [ ] **Castear necesita una animación piola** (Román, 5/11): hoy hay texto y anillo en el cursor; falta la pose/animación del personaje (manos, brillo en el piso, partículas del color del hechizo) y el "suelte" al terminar el casteo. Entra con el pipeline de sprites (Character Creator 2D tiene animación de cast).
- [ ] Pegar: depende de las animaciones (Román, 5/11); se revisa cuando estén.
- [x] Morir y revivir: está bien (Román, 5/11).

**Decisiones**
- [ ] ¿Correr es el modo por defecto (como juega todo el mundo en HB) y caminar se activa para castear, o al revés? Voto: correr por defecto; caminar se activa solo al apretar un hechizo.
