"""Hornea efectos Effekseer (TOMAS, Miradin, CC-BY-SA) a un atlas de cuadros con fondo negro (se dibujan con 'lighter').
Uso: python3 tools/src/fx/bake.py <dir con effekseer.js, effekseer.wasm, bake.html y carpetas Fire/Water/...> <salida: apps/client/public/assets>
Requiere: playwright (chromium) y Pillow. El dir debe servirse en http://localhost:8765 (python3 -m http.server 8765)."""
import sys, io, json, base64
from PIL import Image
from playwright.sync_api import sync_playwright
S = 160  # tamaño de cada cuadro
# nombre: (ruta, frames, paso, cam, at, fov, escala_en_pantalla, y_ancla)
EFX = {
  'eruption':  ('Fire/Eruption.efkefc',        14, 3, [0, 11, 14], [0, 1.5, 0], 40, 2.2),
  'sphere':    ('Water/Blue Sphere.efkefc',    14, 4, [0, 7, 9],   [0, 1.2, 0], 40, 1.5),
  'cyclone':   ('Wind/Cyclone.efkefc',         14, 4, [0, 7, 9],   [0, 1.2, 0], 40, 1.9),
  'windblade': ('Wind/Wind Blade.efkefc',      14, 3, [0, 7, 9],   [0, 1.2, 0], 40, 2.2),
  'rocklance': ('Earth/Rock Lance.efkefc',     14, 3, [0, 5, 6],   [0, 0.8, 0], 40, 1.9),
  'cataclysm': ('Earth/Grand Cataclysm.efkefc',  14, 6, [0, 11, 14], [0, 1.0, 0], 40, 2.8),
  'tidal':     ('Water/Tidal Wave.efkefc',       14, 4, [0, 9, 11],  [0, 0.6, 0], 40, 2.6),
  'spread':    ('Water/Spread.efkefc',          14, 4, [0, 9, 11],  [0, 1.6, 0], 40, 1.7),
  'stop':      ('Ailment/Stop Flow.efkefc',    14, 4, [0, 7, 9],   [0, 1.0, 0], 40, 1.5),
}
src, out = sys.argv[1], sys.argv[2]
N = 14
sheet = Image.new('RGB', (S * N, S * len(EFX)))
meta = {'cell': S, 'frames': N, 'rows': {}}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(); pg.goto('http://localhost:8765/bake.html')
    for row, (name, (path, fr, step, cam, at, fov, sc)) in enumerate(EFX.items()):
        r = pg.evaluate("([p,o])=>window.bake(p,o)", [path, {'frames': fr, 'step': step, 'size': S, 'cam': cam, 'at': at, 'fov': fov}])
        for i, u in enumerate(r['0']):
            sheet.paste(Image.open(io.BytesIO(base64.b64decode(u.split(',')[1]))).convert('RGB'), (i * S, row * S))
        meta['rows'][name] = {'row': row, 'fps': 20, 'scale': sc}
    b.close()
sheet.save(out + '/fx.webp', quality=80, method=6)
json.dump(meta, open(out + '/fx.json', 'w'))
print('ok', sheet.size)
