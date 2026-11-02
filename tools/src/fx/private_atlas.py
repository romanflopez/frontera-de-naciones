"""Atlas de efectos con licencia que NO permite publicarlos (p. ej. Frostwindz: se pueden usar en el juego,
pero no dejarlos descargables en un repo público). Genera apps/client/public/assets/fx_priv.webp + fx_priv.json,
que están en .gitignore: hay que generarlos en cada máquina o deploy que arme el cliente.
Si faltan, el cliente usa el efecto de reemplazo (FX_FALLBACK en main.ts).

Uso: python3 tools/src/fx/private_atlas.py <nombre> <dir con *_frame1.png..N> [fps] [escala] [factor] [ancla_y]
  - factor: escala de los cuadros antes de pegarlos en la celda de 160 px.
  - ancla_y: fila del cuadro original donde están los pies del efecto; se ubica a 0,62 de la celda,
    que es donde el cliente dibuja los pies del personaje.
Ejemplo (Furia): python3 tools/src/fx/private_atlas.py pilar "<Pixel Art VFX - Priest>/VFX 2/frames" 15 1.6 0.85 116"""
import sys, re, os, json
from PIL import Image
S, N = 160, 14
OUT = os.path.join(os.path.dirname(__file__), '../../../apps/client/public/assets')
name, src = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 15
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.6
factor = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
anchor = float(sys.argv[6]) if len(sys.argv) > 6 else None
jpath, ipath = os.path.join(OUT, 'fx_priv.json'), os.path.join(OUT, 'fx_priv.webp')
meta = json.load(open(jpath)) if os.path.exists(jpath) else {'cell': S, 'frames': N, 'rows': {}}
sheet = Image.open(ipath).convert('RGB') if os.path.exists(ipath) else Image.new('RGB', (S * N, 0))
files = sorted((f for f in os.listdir(src) if f.lower().endswith('.png')), key=lambda f: int(re.findall(r'\d+', f)[-1]))
if not files or len(files) > N: sys.exit(f'{len(files)} cuadros: tiene que haber entre 1 y {N}')
row = meta['rows'][name]['row'] if name in meta['rows'] else sheet.height // S
if (row + 1) * S > sheet.height:
    grown = Image.new('RGB', (S * N, (row + 1) * S)); grown.paste(sheet, (0, 0)); sheet = grown
sheet.paste(Image.new('RGB', (S * N, S)), (0, row * S))  # los cuadros que sobran quedan negros (= invisibles)
for i, f in enumerate(files):
    im = Image.open(os.path.join(src, f)).convert('RGBA')
    if factor != 1: im = im.resize((round(im.width * factor), round(im.height * factor)), Image.LANCZOS)
    ay = anchor * factor if anchor is not None else im.height
    ox, oy = round((S - im.width) / 2), round(S * 0.62 - ay)
    flat = Image.new('RGBA', im.size, (0, 0, 0, 255)); flat.alpha_composite(im)  # se dibuja con 'lighter': negro = nada
    cell = Image.new('RGB', (S, S)); cell.paste(flat.convert('RGB'), (ox, oy), im)
    sheet.paste(cell, (i * S, row * S))
meta['rows'][name] = {'row': row, 'fps': fps, 'scale': scale}
sheet.save(ipath, quality=90, method=6)
json.dump(meta, open(jpath, 'w'))
print('ok', name, 'fila', row, len(files), 'cuadros ->', os.path.relpath(ipath))
