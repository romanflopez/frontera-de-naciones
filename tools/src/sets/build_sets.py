#!/usr/bin/env python3
"""
Genera los sets de armadura de ERIS repintando las piezas base de Flare (apps/client/public/assets/paper) con la paleta,
los ribetes y los agregados (emblema, tabardo, alas, cuernos, cresta) de cada set. Mantiene la forma, las 8 direcciones y todas
las animaciones de la pieza base: cada agregado se calcula cuadro por cuadro a partir de la caja de la pieza, así sigue el movimiento.

  python3 tools/src/sets/build_sets.py [sets...] [--out DIR] [--fast] [--register-only]
  (los comandos de uso diario están en el package.json raíz: assets:sets, sets:dev y sets:preview)

Necesita numpy, scipy y Pillow. No toca los assets base: escribe <look>_boots|greaves|gloves|cuirass|helm.webp en --out.
Rehace los mismos archivos cada vez (determinista).
"""
from __future__ import annotations
import argparse, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.environ.get('FDN_ASSETS') or os.path.normpath(os.path.join(HERE, '..', '..', '..', 'apps', 'client', 'public', 'assets'))
META = json.load(open(os.path.join(ASSETS, 'meta.json')))['paper']
CW, CH, COLS = META['cw'], META['ch'], META['cols']
SS = 4  # sobremuestreo de los agregados

def hexc(h: str) -> np.ndarray:
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)

def ramp(l: np.ndarray, stops: list[tuple[float, str]]) -> np.ndarray:
    l = np.clip(l, 0, 1); out = np.zeros(l.shape + (3,))
    for c in range(3): out[..., c] = np.interp(l, [s[0] for s in stops], [hexc(s[1])[c] for s in stops])
    return out

# ---------- los 4 sets ----------
# base: qué molde de Flare se repinta ('chain' o 'plate'); metal/cloth/trim: rampas de color (de oscuro a claro).
SETS = {
    'sol_malla': dict(
        base='chain',
        metal=[(0, '#1c2440'), (.3, '#5f6d8e'), (.6, '#aebad0'), (.85, '#e3e8f1'), (1, '#fbfcff')],
        cloth=[(0, '#0d1634'), (.45, '#1d3270'), (.8, '#3a5bab'), (1, '#6c90d6')],
        trim=[(0, '#7a4a0c'), (.5, '#d9a030'), (1, '#ffe39a')],
        accent='#38c3ee', cloth_lum=0.05, emblem='gem', head='wings', tabard=None, cape=True),
    'sol_placas': dict(
        base='plate',
        metal=[(0, '#1c2440'), (.3, '#66749a'), (.6, '#b8c3d8'), (.85, '#e9edf5'), (1, '#ffffff')],
        cloth=[(0, '#0d1634'), (.45, '#1d3270'), (.8, '#3a5bab'), (1, '#6c90d6')],
        trim=[(0, '#7a4a0c'), (.5, '#e0a736'), (1, '#ffe9a8')],
        accent='#f2b83a', emblem='sun', head='crest', tabard=('#f4f1e6', '#1f3678'), cape=False),
    'vhar_malla': dict(
        base='chain',
        metal=[(0, '#100b0d'), (.3, '#43363a'), (.6, '#85746d'), (.85, '#c2b0a1'), (1, '#e9dfd2')],
        cloth=[(0, '#150b0c'), (.45, '#3b1613'), (.8, '#7e251b'), (1, '#c13a2a')],
        trim=[(0, '#3a2d2c'), (.5, '#9a867a'), (1, '#e4d6c6')],
        accent='#e8472f', cloth_lum=0.05, metal_gain=0.62, emblem='diamond', head='horns', tabard=None, cape=False),
    'vhar_placas': dict(
        base='plate',
        metal=[(0, '#100b0d'), (.3, '#46393d'), (.6, '#8a7872'), (.85, '#c8b6a5'), (1, '#ede4d8')],
        cloth=[(0, '#150b0c'), (.45, '#3b1613'), (.8, '#7e251b'), (1, '#c13a2a')],
        trim=[(0, '#3a2d2c'), (.5, '#a08c80'), (1, '#e8dccd')],
        accent='#ef4a30', metal_gain=0.62, emblem='star', head='spikes', tabard=('#16100f', '#8f261c'), cape=False),
}
PIECES = {  # pieza lógica -> (nombre en el molde base, sufijo del set)
    'chain': dict(feet='chain_boots', legs='chain_greaves', hands='chain_gloves', chest='chain_cuirass', head='chain_coif'),
    'plate': dict(feet='plate_boots', legs='plate_greaves', hands='plate_gauntlets', chest='plate_cuirass', head='plate_helm'),
}
SUFFIX = dict(feet='boots', legs='greaves', hands='gloves', chest='cuirass', head='helm')

# vista de cada dirección (según el cuerpo base): f = de frente, b = de espaldas, s = de costado (l/r = hacia dónde mira)
VIEW = {0: ('s', 'l'), 1: ('b', 'r'), 2: ('b', 'c'), 3: ('s', 'r'), 4: ('f', 'r'), 5: ('f', 'c'), 6: ('f', 'c'), 7: ('f', 'l')}

# ---------- repintado por zonas ----------
def load_sheet(name: str) -> np.ndarray:
    return np.array(Image.open(os.path.join(ASSETS, 'paper', f'{name}.webp')).convert('RGBA')).astype(float)

def erode(m: np.ndarray, it=1): return ndi.binary_erosion(m, iterations=it, border_value=0)

def restyle(name: str, cfg: dict) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Devuelve la hoja repintada (float RGBA) y las máscaras útiles (sólido, metal, tela, borde)."""
    im = load_sheet(name); rgb, al = im[..., :3], im[..., 3]
    solid = al >= 200
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255
    warm = (rgb[..., 0] - rgb[..., 2]) > 16   # cuero/tela marrón del molde
    cloth = solid & (warm | (lum < cfg.get('cloth_lum', 0.11)))
    metal = solid & ~cloth
    ls = ndi.gaussian_filter(ndi.median_filter(lum, size=3), 0.8)
    # metal: se estira el rango del sprite (es oscuro) y se cuantiza suave en 5 tonos para un aspecto pintado
    mv = ls[metal]; lo, hi = (np.percentile(mv, 4), np.percentile(mv, 96)) if mv.size else (0.05, 0.6)
    lm = np.clip((ls - lo) / max(1e-3, hi - lo), 0, 1) ** 0.85 * cfg.get('metal_gain', 1.0)
    lm = 0.55 * lm + 0.45 * (np.floor(lm * 5) / 5 + 0.1)
    cv_ = ls[cloth]; chi = np.percentile(cv_, 96) if cv_.size else 0.2
    lc = np.clip(ls / max(0.08, chi), 0, 1) ** 0.9
    lc = 0.6 * lc + 0.4 * (np.floor(lc * 4) / 4 + 0.12)
    out = np.where(metal[..., None], ramp(lm, cfg['metal']), ramp(lc, cfg['cloth']))
    # ribete: borde exterior del metal con el color de ribete; borde de la tela, tinta oscura
    edge = solid & ~erode(solid)
    trim_c = ramp(np.clip(0.35 + lum * 1.3, 0, 1), cfg['trim'])
    ink = ramp(lc * 0.45, cfg['cloth'])
    out = np.where((edge & metal)[..., None], trim_c, out)
    out = np.where((edge & cloth)[..., None], ink, out)
    # filos internos del metal (donde el molde marca una placa): ribete más claro
    gx, gy = ndi.sobel(ls, axis=1), ndi.sobel(ls, axis=0); grad = np.hypot(gx, gy)
    inner = metal & erode(metal) & (grad > 0.22) & (ls > 0.30)
    out = np.where(inner[..., None], 0.55 * out + 0.45 * ramp(np.clip(0.55 + lum, 0, 1), cfg['trim']), out)
    # lo que no es sólido (sombra del piso, bordes suaves) queda como estaba
    res = np.where(solid[..., None], out, rgb)
    sheet = np.dstack([res, al])
    return sheet, dict(solid=solid, metal=metal, cloth=cloth, edge=edge)

# ---------- agregados ----------
def cell_view(sheet: np.ndarray, r: int, c: int) -> np.ndarray:
    return sheet[r * CH:(r + 1) * CH, c * CW:(c + 1) * CW]

def bbox(mask: np.ndarray):
    ys, xs = np.where(mask)
    if len(xs) == 0: return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

class Canvas:
    """Capa de dibujo sobremuestreada de una celda; se baja y se compone sobre la hoja."""
    def __init__(self): self.im = Image.new('RGBA', (CW * SS, CH * SS), (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.im)
    def poly(self, pts, fill, outline=None):
        P = [(x * SS, y * SS) for x, y in pts]
        if outline: self.d.polygon(P, fill=outline); self._shrink(P, fill)
        else: self.d.polygon(P, fill=fill)
    def _shrink(self, P, fill):
        # relleno ligeramente más chico que el contorno (borde de ~0.7 px)
        cx = sum(p[0] for p in P) / len(P); cy = sum(p[1] for p in P) / len(P); k = 0.80
        self.d.polygon([(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in P], fill=fill)
    def ellipse(self, cx, cy, rx, ry, fill, outline=None):
        b = [(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS]
        if outline: self.d.ellipse(b, fill=outline); self.d.ellipse([(cx - rx * .75) * SS, (cy - ry * .75) * SS, (cx + rx * .75) * SS, (cy + ry * .75) * SS], fill=fill)
        else: self.d.ellipse(b, fill=fill)
    def line(self, a, b, w, fill): self.d.line([(a[0] * SS, a[1] * SS), (b[0] * SS, b[1] * SS)], fill=fill, width=max(1, int(w * SS)))
    def down(self) -> Image.Image:
        return self.im.resize((CW, CH), Image.LANCZOS)

def rgba(h: str, a=255): c = hexc(h); return (int(c[0]), int(c[1]), int(c[2]), a)

def blit(sheet: np.ndarray, r: int, c: int, layer: Image.Image, clip: np.ndarray | None = None):
    """Compone `layer` (RGBA CWxCH) sobre la celda; si hay `clip`, solo dentro de esa máscara (la pieza)."""
    L = np.array(layer).astype(float); a = L[..., 3:4] / 255
    if clip is not None: a = a * clip[..., None]
    cell = cell_view(sheet, r, c)
    cell[..., :3] = cell[..., :3] * (1 - a) + L[..., :3] * a
    cell[..., 3:4] = np.maximum(cell[..., 3:4], a * 255)

def emblem(cv: Canvas, kind: str, cx: float, cy: float, s: float, cfg: dict, k: float):
    """Emblema del pecho. s = tamaño en px de celda, k = qué tan de frente se ve (achata el ancho)."""
    acc = rgba(cfg['accent']); dark = rgba(cfg['trim'][0][1])
    sx = max(0.35, k)
    if kind == 'sun':
        for i in range(8):
            a = i * math.pi / 4; p0 = (cx + math.cos(a) * s * 0.55 * sx, cy + math.sin(a) * s * 0.55)
            p1 = (cx + math.cos(a - .28) * s * 1.0 * sx, cy + math.sin(a - .28) * s * 1.0); p2 = (cx + math.cos(a + .28) * s * 1.0 * sx, cy + math.sin(a + .28) * s * 1.0)
            cv.poly([p1, p0, p2], rgba('#ffd86a'), rgba('#7a4a0c'))
        cv.ellipse(cx, cy, s * 0.5 * sx, s * 0.5, rgba('#ffe9a8'), rgba('#9a6a14'))
    elif kind == 'gem':
        cv.poly([(cx, cy - s * .8), (cx + s * .55 * sx, cy), (cx, cy + s * .8), (cx - s * .55 * sx, cy)], acc, rgba('#7a4a0c'))
        cv.ellipse(cx - s * .1 * sx, cy - s * .25, s * .13, s * .13, rgba('#e6fbff'))
    elif kind == 'diamond':
        cv.poly([(cx, cy - s * .85), (cx + s * .5 * sx, cy), (cx, cy + s * .85), (cx - s * .5 * sx, cy)], acc, rgba('#1a0d0b'))
        cv.ellipse(cx, cy, s * .14, s * .2, rgba('#ffc9a0'))
    elif kind == 'star':
        pts = []
        for i in range(8):
            a = -math.pi / 2 + i * math.pi / 4; rr = s * (0.95 if i % 2 == 0 else 0.38)
            pts.append((cx + math.cos(a) * rr * sx, cy + math.sin(a) * rr))
        cv.poly(pts, acc, rgba('#1a0d0b'))
        cv.ellipse(cx, cy, s * .16 * sx, s * .16, rgba('#ffd0a0'))

def add_chest(sheet, masks, cfg, parts_meta):
    solid = masks['solid']
    for r in range(48):
        d = r % 8; kind, side = VIEW[d]
        for c in range(COLS):
            m = cell_view(solid, r, c)
            bb = bbox(m)
            if bb is None: continue
            x0, y0, x1, y1 = bb; w, h = x1 - x0, y1 - y0
            if w < 8 or h < 6: continue
            cv = Canvas()
            if cfg['cape'] and kind in 'fb':   # capa/bufanda azul sobre los hombros
                yy = y0 + h * 0.30
                cv.poly([(x0 + w * .05, y0 + h * .02), (x1 - w * .05, y0 + h * .02), (x1 + w * .02, yy), (x0 - w * .02, yy)], rgba(cfg['cloth'][2][1], 235), rgba(cfg['cloth'][0][1]))
            if kind in 'fb' and cfg['emblem']:
                k = 1.0 if side == 'c' else 0.8
                off = {'r': 0.10, 'l': -0.10, 'c': 0}[side] * w
                emblem(cv, cfg['emblem'], (x0 + x1) / 2 + off, y0 + h * 0.46, max(2.6, w * 0.17), cfg, k)
            elif kind == 's' and cfg['emblem'] in ('sun', 'star'):
                pass
            blit(sheet, r, c, cv.down(), clip=m.astype(float))

def add_legs(sheet, masks, cfg):
    if not cfg['tabard']: return
    cA, cB = rgba(cfg['tabard'][0]), rgba(cfg['tabard'][1]); solid = masks['solid']
    for r in range(48):
        d = r % 8; kind, side = VIEW[d]
        if kind == 's': continue
        for c in range(COLS):
            m = cell_view(solid, r, c); bb = bbox(m)
            if bb is None: continue
            x0, y0, x1, y1 = bb; w, h = x1 - x0, y1 - y0
            if w < 8 or h < 8: continue
            cv = Canvas(); cx = (x0 + x1) / 2 + {'r': .06, 'l': -.06, 'c': 0}[side] * w
            tw = w * 0.30; top = y0 + h * 0.05; bot = y0 + h * 0.62
            cv.poly([(cx - tw / 2, top), (cx + tw / 2, top), (cx + tw / 2 * .9, bot), (cx, bot + h * .06), (cx - tw / 2 * .9, bot)], cA, cB)
            cv.line((cx, top + 1), (cx, bot - 1), 0.6, rgba(cfg['accent'], 190))
            blit(sheet, r, c, cv.down(), clip=m.astype(float))

def add_head(sheet, masks, cfg):
    kind_h = cfg['head']; solid = masks['solid']
    gold = rgba(cfg['trim'][1][1]); goldL = rgba(cfg['trim'][2][1]); goldD = rgba(cfg['trim'][0][1]); ink = rgba('#0a0a14')
    acc = rgba(cfg['accent'])
    for r in range(48):
        d = r % 8; kind, side = VIEW[d]
        for c in range(COLS):
            m = cell_view(solid, r, c); bb = bbox(m)
            if bb is None: continue
            x0, y0, x1, y1 = bb; w, h = x1 - x0, y1 - y0
            if w < 5 or h < 5: continue
            cx = (x0 + x1) / 2; cv = Canvas(); glow = None
            sg_list = (-1, 1) if kind in 'fb' else ((1,) if side == 'l' else (-1,))
            if kind_h == 'wings':
                for sg in sg_list:
                    front = kind in 'fb'
                    ax = cx + sg * w * (0.50 if front else 0.22); ay0 = y0 + h * (0.30 if front else 0.34)
                    # ala: 4 plumas casi paralelas, la de arriba la más larga, que salen escalonadas de la sien hacia arriba y afuera
                    feathers = [(-74, 1.00, .0), (-62, 1.18, -.10), (-50, 1.16, -.20), (-38, .95, -.30)] if front else [(-92, 1.0, .0), (-80, 1.2, -.10), (-68, 1.2, -.20), (-56, 1.0, -.30)]
                    for i, (ang, ln, dyb) in enumerate(feathers):
                        a = math.radians(ang); dx, dy = -math.sin(a) * sg, -math.cos(a)
                        bx, by = ax, ay0 + dyb * h
                        L = w * ln * 0.80; tip = (bx + dx * L, by + dy * L); nx, ny = -dy, dx; ww = w * 0.13
                        cv.poly([(bx + nx * ww, by + ny * ww), (bx - nx * ww, by - ny * ww), (tip[0] - nx * ww * .25, tip[1] - ny * ww * .25)], goldL if i % 2 == 0 else gold, goldD)
                if kind == 'f':
                    cv.poly([(cx, y0 + h * .10), (cx + w * .11, y0 + h * .28), (cx, y0 + h * .44), (cx - w * .11, y0 + h * .28)], acc, goldD)
            elif kind_h == 'horns':
                for sg in sg_list:
                    ax = cx + sg * w * (0.34 if kind in 'fb' else 0.18); ay = y0 + h * 0.30
                    sc = 1.0 if kind in 'fb' else 1.2
                    pts = [(ax, ay + h * .05), (ax + sg * w * .50 * sc, ay - h * .18), (ax + sg * w * .62 * sc, ay - h * .80 * sc), (ax + sg * w * .40 * sc, ay - h * .36), (ax + sg * w * .12, ay - h * .02)]
                    cv.poly(pts, rgba('#2a2123'), rgba('#c0ae9f'))
            elif kind_h == 'crest':
                if kind in 'fb':
                    cv.poly([(cx - w * .26, y0 + h * .34), (cx - w * .20, y0 - h * .12), (cx - w * .06, y0 - h * .36), (cx + w * .06, y0 - h * .36), (cx + w * .20, y0 - h * .12), (cx + w * .26, y0 + h * .34)], rgba(cfg['cloth'][2][1]), goldD)
                    cv.line((cx - w * .13, y0 - h * .02), (cx - w * .13, y0 + h * .30), 0.9, gold); cv.line((cx + w * .13, y0 - h * .02), (cx + w * .13, y0 + h * .30), 0.9, gold)
                else:
                    pts = [(cx - w * .42, y0 + h * .30), (cx - w * .30, y0 + h * .02), (cx, y0 - h * .12), (cx + w * .30, y0 + h * .02), (cx + w * .42, y0 + h * .30)]
                    for a, b in zip(pts, pts[1:]): cv.line(a, b, 1.5, goldD)
                    for a, b in zip(pts, pts[1:]): cv.line(a, b, 0.9, gold)
            elif kind_h == 'spikes':
                n = 3 if kind in 'fb' else 2
                for i in range(n):
                    t = (i - (n - 1) / 2) / max(1, (n - 1) / 2) if n > 1 else 0
                    bx = cx + t * w * .34; hh = h * (.62 if abs(t) < .5 else .42)
                    cv.poly([(bx - w * .09, y0 + h * .18), (bx, y0 - hh * .75), (bx + w * .09, y0 + h * .18)], rgba('#2a2123'), rgba('#c0ae9f'))
                if kind == 'f':
                    sy = y0 + h * .56; sx0 = cx - w * .30; sx1 = cx + w * .30
                    glow = Canvas(); glow.poly([(sx0, sy - .7), (sx1, sy - .7), (sx1, sy + .7), (sx0, sy + .7)], acc)
            # el agregado se dibuja detrás o encima del casco según la vista: alas/cuernos/cresta salen por arriba y los lados
            layer = cv.down()
            blit(sheet, r, c, layer)
            if glow is not None:
                g = glow.down(); gb = g.filter(ImageFilter.GaussianBlur(1.0))
                blit(sheet, r, c, gb); blit(sheet, r, c, g, clip=m.astype(float))
            # acento del casco (gema de frente / ranura): ya incluido arriba

def build(look: str, out_dir: str, fast: bool = False) -> dict[str, Image.Image]:
    cfg = SETS[look]; pcs = PIECES[cfg['base']]; made = {}
    for part, base_name in pcs.items():
        sheet, masks = restyle(base_name, cfg)
        if part == 'chest': add_chest(sheet, masks, cfg, None)
        elif part == 'legs': add_legs(sheet, masks, cfg)
        elif part == 'head': add_head(sheet, masks, cfg)
        res = Image.fromarray(np.clip(sheet, 0, 255).astype(np.uint8), 'RGBA')
        name = f'{look}_{SUFFIX[part]}'
        if out_dir:
            os.makedirs(out_dir, exist_ok=True); res.save(os.path.join(out_dir, f'{name}.webp'), lossless=True, quality=50 if fast else 100, method=0 if fast else 6)
        made[part] = res
    return made

def register_meta(looks: list[str]) -> None:
    """Agrega los sets a meta.json (paper.sets, paper.pieces, paper.helms) sin tocar el resto. Idempotente.
    `pnpm assets:flare` regenera meta.json de cero: por eso `assets:sets` corre después y vuelve a registrarlos."""
    path = os.path.join(ASSETS, 'meta.json'); meta = json.load(open(path)); paper = meta['paper']
    for look in looks:
        names = {part: f'{look}_{SUFFIX[part]}' for part in SUFFIX}
        paper['sets'][look] = [names['feet'], names['legs'], names['hands'], names['chest']]
        for part in ('feet', 'legs', 'hands', 'chest', 'head'): paper['pieces'][names[part]] = part
        if names['head'] not in paper['helms']: paper['helms'].append(names['head'])
    json.dump(meta, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('sets', nargs='*', help='sets a generar (por defecto todos)'); ap.add_argument('--out', default=os.path.join(ASSETS, 'paper')); ap.add_argument('--only', default=''); ap.add_argument('--preview', default=''); ap.add_argument('--register-only', action='store_true', help='solo registrar en meta.json (las hojas ya están hechas)'); ap.add_argument('--fast', action='store_true', help='guarda sin comprimir bien (20 veces más rápido, archivos de ~2 MB): para probar. El final se genera sin --fast')
    a = ap.parse_args(); only = a.sets or [s for s in a.only.split(',') if s] or list(SETS)
    bad = [n for n in only if n not in SETS]
    if bad: raise SystemExit(f'Set desconocido: {", ".join(bad)}. Disponibles: {", ".join(SETS)}')
    if not a.register_only:
        for look in only:
            build(look, a.out, a.fast); print('ok', look, '(rápido, sin comprimir)' if a.fast else '')
    register_meta(only); print('meta.json actualizado con', ', '.join(only))

if __name__ == '__main__':
    main()
