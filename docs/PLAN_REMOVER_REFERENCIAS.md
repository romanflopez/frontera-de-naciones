# Plan para sacar referencias y material dudoso antes de publicar

Complementa `docs/LICENCIAS_AUDITORIA.md`. Es una guía técnica, no asesoramiento legal. Nada de esto se ejecutó: son comandos para correr a mano, sobre un clon de respaldo.

## 0. Primero: el repo hoy es público

`gh api repos/romanflopez/frontera-de-naciones --jq .private` devolvió `false`. Mientras se decide la limpieza:

```bash
gh repo edit romanflopez/frontera-de-naciones --visibility private --accept-visibility-change-consequences
```

Aunque se reescriba el historial, lo que ya se publicó pudo ser clonado o forkeado. Revisar en GitHub: Insights > Forks, y ramas/PR con `refs/pull/*`. Si hay forks de terceros no se pueden borrar desde acá.

## 1. Qué sacar

Del árbol de trabajo:

| Ruta | Motivo |
|---|---|
| `reference/` completo (`server-csharp`, `README.md`) | Copia del server de helbreath-base-game con JSON de Helbreath (ítems, monstruos, NPC, mapas `hbsh6`, `areshop`) |
| `apps/server/data/catalog/{Items,Monsters,NPCs,Spells}.json` | Idénticos a `reference/server-csharp/Config/*`. Reemplazar por catálogos propios (el server los carga en `config.ts`; ver paso 3) |
| `apps/client/public/assets/fantasy_house.webp`, `tools/src/house/` | Sin autor ni licencia |
| `apps/client/public/assets/{barbaro,arana,golem,demonio}.webp`, `tools/src/boss/` | Origen no probado (ver auditoría). Dejarlos sólo si se prueba la compra y la licencia permite lo que hacemos |
| `apps/client/public/assets/{fx.webp,fx.json}`, `tools/src/fx/` | Hasta confirmar licencia de TOMAS |
| `apps/client/public/assets/spells/` | Decidir (IA). No sacarlos si se documenta el origen |

Textos a editar (sin borrar archivos):

- `README.md`: quitar "al estilo Helbreath", el enlace al base-game y la sección que habla de `reference/`; dejar la nota de origen del código MIT.
- `apps/server/package.json` (`description`) y comentarios de cabecera en `apps/server/src/*.ts` que citan `Server.cs`, `GameWorld.cs`, etc.: reescribir como "basado en un server MIT, ver LICENSE.base-game".
- `.gitignore` (`reference/**/Chars/`, comentario "Nunca subir assets del Helbreath original") y `.dockerignore` (`reference`): se pueden dejar o limpiar.
- **Mantener** `LICENSE.base-game`: el código portado es obra derivada de MIT y exige conservar ese aviso.
- Agregar a `LICENSE` una línea: "Los assets de `apps/client/public/assets` tienen sus propias licencias, ver CREDITS.txt".

Comandos para el árbol de trabajo:

```bash
git rm -r reference
git rm apps/client/public/assets/fantasy_house.webp
git rm -r tools/src/house
# bosses / TOMAS: solo si no se confirma la licencia
git rm apps/client/public/assets/{barbaro,arana,golem,demonio}.webp
git rm apps/client/public/assets/{fx.webp,fx.json}
git rm -r tools/src/boss tools/src/fx
# catálogos: despues de crear los propios (paso 3)
git rm apps/server/data/catalog/*.json
```

Si se sacan assets hay que quitar también las referencias en `packages/world`, `apps/client/src/main.ts` y `meta.json` (la casa, los bosses y los efectos) o el juego falla al cargar. Eso es cambio de código y quedó fuera de esta auditoría.

## 2. Historial de git

Qué hay en la historia que no debería salir a público (verificado con `git log --all --name-only`):

- `reference/server-csharp/**` (desde el primer commit `1e29c79`).
- Primer commit: cliente del base-game (`apps/client/src/{App.tsx,Config.ts,PhaserGame.tsx,Types.ts,constants,game,ui,utils}`, `apps/client/vite`), con nombres y clases de hechizos tipo Helbreath, y `tools/src/client-simulator.ts`.
- `apps/server/data/catalog/*.json`.
- Blobs de `fantasy_house.webp`, bosses 3D, `fx.webp`.
- Mensajes de commit con la línea `Claude-Session: https://claude.ai/code/session_...` (enlaces de sesión privados; opcional quitarlos).
- 23 ramas `worktree-agent-*` y `main`.
- No hay `.pak`/`.spr`/`.amd`/audio: nada de assets de Helbreath en la historia.

### Opción A (recomendada): repo nuevo y limpio

Pierde el historial pero es lo más seguro y simple. Se publica un solo commit inicial sin nada de lo anterior.

```bash
# desde el repo con los cambios del paso 1 ya commiteados: exportar solo los archivos versionados
mkdir ../frontera-limpio
git archive HEAD | tar -x -C ../frontera-limpio
cd ../frontera-limpio && git init -b main && git add -A && git commit -m "Version inicial"
# crear un repo NUEVO en GitHub (no reutilizar el actual) y empujar ahí
git remote add origin git@github.com:romanflopez/<nombre-nuevo>.git
git push -u origin main
```

Después, el repo viejo se deja privado (o se borra) en lugar de reescribirlo.

### Opción B: reescribir el historial con git filter-repo

Conserva los commits, pero cambia todos los hashes. Trabajar sobre un clon espejo:

```bash
pip install git-filter-repo
git clone --mirror https://github.com/romanflopez/frontera-de-naciones.git fdn-limpio.git
cd fdn-limpio.git

cat > ../quitar.txt <<'EOF'
reference/
apps/server/data/catalog/
apps/client/public/assets/fantasy_house.webp
apps/client/public/assets/barbaro.webp
apps/client/public/assets/arana.webp
apps/client/public/assets/golem.webp
apps/client/public/assets/demonio.webp
apps/client/public/assets/fx.webp
apps/client/public/assets/fx.json
apps/client/public/assets/hero_berserk.webp
apps/client/public/assets/hero_mage.webp
apps/client/public/assets/hero_warrior.webp
tools/src/client-simulator.ts
tools/src/house/
apps/client/src/App.tsx
apps/client/src/Config.ts
apps/client/src/PhaserGame.tsx
apps/client/src/Types.ts
apps/client/src/constants/
apps/client/src/game/
apps/client/src/ui/
apps/client/src/utils/
apps/client/vite/
EOF
git filter-repo --invert-paths --paths-from-file ../quitar.txt

# opcional: sacar las líneas Claude-Session de los mensajes
git filter-repo --message-callback '
import re
return re.sub(rb"\n*Claude-Session: \S+", b"", message)
'

# dejar solo main (borrar ramas de agentes)
for b in $(git for-each-ref --format='%(refname:short)' refs/heads | grep '^worktree-agent-'); do git branch -D "$b"; done

git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

Qué hacer con la copia remota después:

1. Crear un repo **nuevo** en GitHub y empujar `main` ahí (`git push --mirror` sólo si se limpiaron las ramas). Es más seguro que `push --force` al viejo porque GitHub conserva commits huérfanos accesibles por hash y por `refs/pull/*`.
2. Si igual se fuerza sobre el repo existente: `git push --force --all` y `git push --force --tags`; luego pedir a GitHub Support la purga de commits cacheados y de PR refs.
3. Cualquier clon o fork anterior conserva el material viejo. La limpieza evita nuevas descargas, no recupera las pasadas.

Verificación posterior (en el repo limpio):

```bash
git log --all --name-only --format= | sort -u | grep -Ei 'reference/|catalog/|fantasy_house|barbaro|arana|golem|demonio|fx\.(webp|json)|client-simulator'
git grep -iE 'helbreath|aresden|elvine|siementech|hbsh6' $(git rev-list --all) | head
git rev-list --all --count
```

Los tres deben dar vacío (o sólo `LICENSE.base-game`, que nombra a Siementech por la excepción de licencia, y el aviso en `CREDITS.txt`).

## 3. Reemplazos que hay que tener antes de borrar

- **Catálogos propios**: `apps/server/src/config.ts` lee `catalog/Items.json`, `Spells.json`, `Monsters.json` y `NPCs.json`. Hoy el cliente casi no usa lo que manda el server (`itemsDirectory`, `monstersList`, `npcDirectory`), pero hay que comprobar con `pnpm typecheck` y arrancando el server. Crear archivos mínimos con nombres e ids propios (los hechizos y mobs reales del juego están en `packages/world/src/mobs.ts` y `apps/server/src/systems/`).
- **Assets**: si se retiran bosses/casa/efectos, hay que tener sustitutos o quitar esas zonas del mapa.
- **Otros**: pantalla de créditos en el juego con el contenido de `CREDITS.txt`; autoalojar fuentes OFL.

## 4. Secretos en el historial

Revisado con búsqueda en `git log --all -p` (patrones: `postgres://`, `DATABASE_URL`, `password=`, `secret`, `api_key`, claves privadas `BEGIN ... PRIVATE`, `sk-`, `AKIA`, dominios de hosting y `.env`):

- **No se encontró ninguna credencial ni cadena de conexión real.** `DATABASE_URL` sólo se lee de `process.env` (`apps/server/src/index.ts`) y la documentación menciona Neon/Supabase/Render como ejemplos sin datos.
- Único hallazgo: la contraseña de prueba `test1234` en `tools/src/client-simulator.ts` (primer commit, ya borrado del árbol). No es un secreto real.
- `apps/server/data/accounts/` y `chars/` están en `.gitignore` y nunca se commitearon (no aparecen en ningún commit): no hay hashes de contraseñas de jugadores en la historia.
- `reference/server-csharp/appsettings*.json` y `launchSettings.json` sólo traen configuración de logging y localhost.

Recomendaciones igual:

1. Correr una herramienta dedicada antes de publicar (no estaba instalada acá): `gitleaks detect --log-opts="--all"` o `trufflehog git file://. --since-commit <primer commit>`.
2. Si alguna vez se pegó la `DATABASE_URL` real en un chat, issue, captura o log, **rotar** la contraseña de la base (Neon/Supabase/Render) y las variables de entorno del hosting, aunque no esté en git.
3. No hay `.env` versionado; agregar `.env*` al `.gitignore` por las dudas.
4. `apps/server/src/storage.ts` conecta a Postgres con `rejectUnauthorized: false` (no valida el certificado TLS). No es un tema de licencias, pero conviene arreglarlo antes de producción.

## 5. Orden sugerido

1. Hacer privado el repo (paso 0).
2. Decidir sobre bosses, casa, TOMAS e íconos de IA (decisiones del dueño en la auditoría).
3. Crear catálogos propios y quitar las referencias en el código.
4. Limpiar el árbol (paso 1) y actualizar README/LICENSE.
5. Repo nuevo (opción A) o `filter-repo` (opción B) y verificación.
6. Escaneo de secretos con herramienta dedicada.
7. Revisión legal antes de abrir el repo y antes de cobrar cosméticos.
