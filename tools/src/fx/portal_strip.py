"""Tira del portal animado de Frostwindz ("Pixel Art Animated Portal", itch.io) para los Portales de Frontera y los
vínculos entre mapas. Licencia: uso comercial y modificación sí, redistribución de los archivos no: la tira vive en
apps/client/public/assets/portal_priv.png con la misma situación temporal que fx_priv.* (ver .gitignore).

Uso: python3 tools/src/fx/portal_strip.py "<carpeta del pack>/Frames"
Salida: tira horizontal de 7 celdas de 128 px (cuadros de 64 px escalados x2 sin suavizado), con alfa.
El cliente la dibuja con alfa normal (no con 'lighter' como el atlas de efectos) para conservar el centro oscuro."""
import os, re, sys
from PIL import Image

src = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '../../../apps/client/public/assets/portal_priv.png')
files = sorted((f for f in os.listdir(src) if f.lower().endswith('.png')), key=lambda f: int(re.findall(r'\d+', f)[-1]))
ims = [Image.open(os.path.join(src, f)).convert('RGBA') for f in files]
C = ims[0].width * 2
strip = Image.new('RGBA', (C * len(ims), C), (0, 0, 0, 0))
for i, im in enumerate(ims): strip.paste(im.resize((C, C), Image.NEAREST), (i * C, 0))
strip.save(OUT, optimize=True)
print('ok', len(ims), 'cuadros de', C, 'px ->', os.path.relpath(OUT))
