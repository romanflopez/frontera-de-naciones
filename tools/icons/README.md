# Íconos (Craftpix)

Los íconos de habilidades, equipo, sets, consumibles y materiales salen de packs de Craftpix (línea "RPG Icons Asset Collection": los tres "100 Skill Icons" para habilidades, "RPG Equipment Icon Pack" y "100 RPG Game Icons" para ítems, más Dragon Loot, Hunting y Halloween para unas pocas piezas). Licencia de Craftpix: uso en el juego sí, redistribución de los archivos originales no; acá solo viven los PNG ya recortados, encuadrados y teñidos para ERIS.

- `manifest.json`: cada id del juego → `[pack, número, "#tinte"?]`. `spells` (ids de `kits.ts` + estados `st_*`), `items` (pociones, monedas, llaves de `quests.ts`, materiales, basura por mob, pergaminos), `looks` (los `look` de `uniques.ts`), `sets` (id de set → clase, banda y tinte) y `set_bases` (ícono base por clase, pieza y banda).
- `build_icons.py <carpeta con los packs descargados> <salida>`: genera `spells/` (128 px con el marco dorado de `assets/spells`), `items/`, `looks/` y `sets/<set>_<pieza>.png` (96 px, transparentes: el cliente les pone el marco de rareza).
- Destino en el cliente: `apps/client/public/assets/skills/` y `apps/client/public/assets/items/{misc,looks,sets}/`. Los usa `icons.ts` (`SKILL_ART`, `statusIcon`) e `itemicons.ts` (`itemIcon` con set y pieza, `potionIcon`, `coinIcon`, `miscIconUrl`).

Para cambiar un ícono: editar el número en el manifest, correr el script y copiar la carpeta. Para un set nuevo: agregar la línea en `sets` con su tinte; las bases por banda ya están.
