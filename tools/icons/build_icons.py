#!/usr/bin/env python3
"""Genera los íconos de ERIS desde los packs de Craftpix (ver manifest.json).
Uso: python3 build_icons.py <carpeta con los packs> [salida]
Salida: spells/<id>.png (128 px, marco dorado) e items/<id>.png (96 px, transparente, objeto al 80 %)."""
import json, sys, os, colorsys
from PIL import Image, ImageDraw, ImageChops

root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manifest.json')))
os.makedirs(os.path.join(out, 'spells'), exist_ok=True); os.makedirs(os.path.join(out, 'items'), exist_ok=True)

def src(pack, n): return os.path.join(root, M['packs'][pack].replace('{n}', str(n)))

def frame(size=128, r=11):
    """Marco del juego: borde oscuro, filete dorado, línea interior oscura (como assets/spells)."""
    f = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(f)
    d.rounded_rectangle((1, 1, size - 2, size - 2), r, outline=(33, 17, 11, 255), width=2)
    d.rounded_rectangle((3, 3, size - 4, size - 4), r - 2, outline=(164, 109, 48, 255), width=2)
    d.rounded_rectangle((3, 3, size - 4, size - 4), r - 2, outline=(214, 164, 69, 255), width=1)
    d.rounded_rectangle((5, 5, size - 6, size - 6), r - 4, outline=(36, 9, 9, 255), width=1)
    return f

def mask(size=128, r=11):
    m = Image.new('L', (size, size), 0); ImageDraw.Draw(m).rounded_rectangle((1, 1, size - 2, size - 2), r, fill=255); return m

def spell(pack, n, dst, size=128):
    im = Image.open(src(pack, n)).convert('RGBA')
    # el icono trae un borde propio de ~3 %: lo recortamos para que entre nuestro marco
    w, h = im.size; c = int(w * 0.035); im = im.crop((c, c, w - c, h - c)).resize((size, size), Image.LANCZOS)
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0)); base.paste(im, (0, 0), mask(size)); base.alpha_composite(frame(size))
    base.save(dst)

def tint(im, hexcol, strength=0.75):
    """Recolorea conservando luz y sombra (hue/sat del color, luminosidad del original)."""
    r, g, b = int(hexcol[1:3], 16) / 255, int(hexcol[3:5], 16) / 255, int(hexcol[5:7], 16) / 255
    th, ts, tv = colorsys.rgb_to_hsv(r, g, b)
    px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            pr, pg, pb, pa = px[x, y]
            if pa == 0: continue
            hh, ss, vv = colorsys.rgb_to_hsv(pr / 255, pg / 255, pb / 255)
            nh = th; ns = ss * (1 - strength) + ts * strength; nv = vv * (0.55 + 0.9 * tv) if tv < 0.5 else vv
            nr, ng, nb = colorsys.hsv_to_rgb(nh, min(1, ns), min(1, nv))
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), pa)
    return im

def item(pack, n, dst, size=96, fill=0.95, col=None, strength=0.75):
    im = Image.open(src(pack, n)).convert('RGBA')
    bbox = im.getbbox(); im = im.crop(bbox) if bbox else im
    if col: im = tint(im, col, strength)
    w, h = im.size; k = (size * fill) / max(w, h); im = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0)); base.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    base.save(dst)

n_s = n_i = 0
for sid, v in M['spells'].items():
    if sid.startswith('_'): continue
    spell(v[0], v[1], os.path.join(out, 'spells', sid + '.png')); n_s += 1
for iid, v in M['items'].items():
    if iid.startswith('_'): continue
    item(v[0], v[1], os.path.join(out, 'items', iid + '.png'), col=v[2] if len(v) > 2 else None); n_i += 1
os.makedirs(os.path.join(out, 'looks'), exist_ok=True); os.makedirs(os.path.join(out, 'sets'), exist_ok=True)
n_l = n_set = 0
for lk, v in M.get('looks', {}).items():
    item(v[0], v[1], os.path.join(out, 'looks', lk + '.png'), col=v[2] if len(v) > 2 else None); n_l += 1
for sid, (cls, tier, col) in M.get('sets', {}).items():
    for piece, bases in M['set_bases'][cls].items():
        item('equip', bases[tier - 1], os.path.join(out, 'sets', f'{sid}_{piece}.png'), col=col, strength=0.6); n_set += 1
print(f'{n_s} hechizos, {n_i} ítems, {n_l} looks y {n_set} piezas de set en {out}')
