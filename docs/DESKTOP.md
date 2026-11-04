# App de escritorio y actualizaciones

El juego se juega con una app de escritorio (Electron, `apps/desktop`) que lleva adentro el mismo cliente web (`apps/client`).
El navegador sigue funcionando como respaldo.

## Cómo se actualiza todo

1. **La versión del juego** es `version` en `apps/client/package.json`. Queda fijada en el bundle al compilar (`__CLIENT_VERSION__`)
   y se copia al `package.json` de la app de escritorio antes de empaquetar (`scripts/sync-version.cjs`).
2. **El server** publica `GET /version` → `{ server, minClient, latestClient, downloadUrl }` (`apps/server/src/version.ts`).
   - `minClient`: el cliente con una versión menor queda **bloqueado** con una pantalla de actualización obligatoria.
   - `latestClient`: si es mayor que la del cliente, solo se avisa en el chat del juego.
   - Se cambian en vivo con `/gm minclient <versión>` y `/gm latestclient <versión>` (`off` los saca) y quedan en `version.json`.
     Defaults por entorno: `MIN_CLIENT`, `LATEST_CLIENT`, `DOWNLOAD_URL` (enlace al instalador, para cuando falla la actualización automática).
   - Un cliente sin versión válida (`dev`) nunca se bloquea, y sin `minClient` no se bloquea a nadie.
3. **El cliente** consulta `/version` al abrir, antes de conectar y cada 5 min (`apps/client/src/version.ts`).
4. **La app de escritorio** busca actualizaciones al abrir y cada 30 min con `electron-updater`, las baja sola y las instala al cerrar el juego
   (`apps/desktop/src/updater.cjs`). Si el server exige una versión mínima, la pantalla ofrece **Reiniciar y actualizar** apenas termina la descarga.

## Publicar una versión (en este orden)

1. Subir `version` en `apps/client/package.json` y sumar la entrada al `CHANGELOG` de `apps/server/src/ops.ts`.
2. Mergear a `main` con todo en verde.
3. `git tag vX.Y.Z && git push --tags`: el workflow `desktop.yml` arma el instalador de Windows y lo publica en el repo de releases.
4. Esperar a que el release aparezca (las apps abiertas empiezan a bajarlo solas).
5. **Solo si el parche es incompatible con los clientes viejos:** `/gm minclient X.Y.Z` (y `/gm latestclient X.Y.Z` siempre).
6. `/gm reiniciar 5` y deploy del server. Mirar Discord y `/health` 15 minutos.

Nunca subir `minClient` antes de que el instalador esté publicado: dejaría a todos bloqueados sin nada que bajar.
Si pasa, `/gm minclient off` lo destraba al instante.

## Qué hay que crear una vez

- **Los workflows de GitHub** (el token de la sesión de Claude no puede tocar `.github/workflows`): copiar `docs/workflows/desktop.yml` a `.github/workflows/desktop.yml`
  y aplicar `docs/workflows/ci-desktop-tests.patch` a `ci.yml` (`git apply docs/workflows/ci-desktop-tests.patch`), que suma los tests del actualizador al CI.

- Un repo **público** de releases (`romanflopez/eris-releases`; el nombre está en `apps/desktop/electron-builder.yml`). Las apps no llevan token,
  por eso no puede ser el repo del juego si ese es privado.
- Un secret `RELEASES_TOKEN` en el repo del juego (token con permiso de escritura sobre el repo de releases) y, opcional, la variable `FDN_SERVER`.

## Pendiente

- Firma de código de Windows (sin firmar, SmartScreen muestra "editor desconocido") y macOS (hoy solo se arma Windows).
- La actualización automática solo se probó con tests y abriendo la app empaquetada; el ciclo real (versión vieja → nueva) se prueba a mano con dos instalaciones.
