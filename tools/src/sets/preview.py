#!/usr/bin/env python3
"""
Vista previa de los sets de armadura: arma las piezas en memoria (no toca assets/) y dibuja al personaje con cada set puesto,
en las 8 direcciones y en varias animaciones, ampliado. Sirve para ver cómo quedan antes de meterlos al juego.

  python3 tools/src/sets/preview.py [sets...] [--anims stance,run,swing,die] [--scale 2] [--out DIR] [--built]

Sin nombres, muestra todos los sets de build_sets.py. Con --built usa las hojas ya generadas en assets/paper (más rápido).
Escribe un PNG por set y uno con todos en tools/out/sets-preview/.
"""
from __future__ import annotations
import argparse, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_sets as B
from PIL import Image, ImageDraw, ImageFont

CW, CH, META = B.CW, B.CH, B.META
FRAME = {'stance': 0, 'run': 2, 'swing': 1, 'hit': 0, 'die': 5, 'cast': 1}   # cuadro que se muestra de cada animación

def load(name: str) -> Image.Image: return Image.open(os.path.join(B.ASSETS, 'paper', f'{name}.webp')).convert('RGBA')

def render(pieces: dict[str, Image.Image], d: int, anim: str) -> Image.Image:
    out = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); row = META['anims'][anim]['row'] + d; f = FRAME[anim]
    typ = {'feet': 'feet', 'legs': 'legs', 'hands': 'hands', 'chest': 'chest', 'head0': 'head', 'head': 'head'}
    for t in META['order'][str(d)]:
        for key in ('feet', 'legs', 'hands', 'chest', 'head0', 'head'):
            if typ[key] == t and key in pieces: out.alpha_composite(pieces[key].crop((f * CW, row * CH, (f + 1) * CW, (row + 1) * CH)))
    return out

def sheet(rows: list[tuple[str, dict[str, Image.Image]]], anims: list[str], scale: int) -> Image.Image:
    cells, box = {}, [999, 999, 0, 0]
    for name, pieces in rows:
        for an in anims:
            for d in range(8):
                fr = render(pieces, d, an); cells[(name, an, d)] = fr; b = fr.getbbox()
                if b: box = [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
    box = [box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4]; w, h = box[2] - box[0], box[3] - box[1]; HD = 40
    lines = [(n, a) for n, _ in rows for a in anims]
    img = Image.new('RGB', (8 * w * scale, len(lines) * (h * scale + HD)), (70, 74, 92)); dr = ImageDraw.Draw(img)
    try: font = ImageFont.truetype('DejaVuSans-Bold.ttf', 22)
    except OSError: font = ImageFont.load_default()
    for r, (name, an) in enumerate(lines):
        y0 = r * (h * scale + HD); dr.text((6, y0 + 8), f'{name} · {an}', fill=(255, 255, 255), font=font)
        for d in range(8):
            fr = cells[(name, an, d)].crop(box).resize((w * scale, h * scale), Image.NEAREST); img.paste(fr, (d * w * scale, y0 + HD), fr)
            if r == 0: dr.text((d * w * scale + 4, y0 + 8), str(d), fill=(255, 230, 120), font=font)
    return img

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('sets', nargs='*'); ap.add_argument('--anims', default='stance,run,swing,die'); ap.add_argument('--scale', type=int, default=2)
    ap.add_argument('--out', default=os.path.join(B.ASSETS, '..', '..', '..', '..', 'tools', 'out', 'sets-preview')); ap.add_argument('--built', action='store_true')
    a = ap.parse_args(); names = a.sets or list(B.SETS); anims = [x for x in a.anims.split(',') if x in FRAME]
    bad = [n for n in names if n not in B.SETS]
    if bad: sys.exit(f'Set desconocido: {", ".join(bad)}. Disponibles: {", ".join(B.SETS)}')
    os.makedirs(a.out, exist_ok=True); head0 = load('head_short'); rows = []
    for n in names:
        t = time.time()
        if a.built: made = {k: load(f'{n}_{B.SUFFIX[k]}') for k in ('feet', 'legs', 'hands', 'chest', 'head')}
        else: made = B.build(n, '', True)
        rows.append((n, {**made, 'head0': head0})); print(f'{n}: listo ({time.time() - t:.0f} s)')
        path = os.path.join(a.out, f'{n}.png'); sheet([rows[-1]], anims, a.scale).save(path); print('  ->', os.path.normpath(path))
    if len(rows) > 1:
        path = os.path.join(a.out, 'todos.png'); sheet(rows, anims, a.scale).save(path); print('->', os.path.normpath(path))

if __name__ == '__main__':
    main()
