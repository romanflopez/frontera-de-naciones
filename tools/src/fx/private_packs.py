"""Suma al atlas privado (fx_priv.webp + fx_priv.json, fuera de git por licencia) los efectos de los packs
"Pixel Art VFX" de Frostwindz. Cada efecto se recorta a lo que ocupa, se centra en la celda de 160 px y se
ubica según su modo:
  - 'pie':    la base del efecto queda en los pies (0,62 de la celda): auras, picos del piso, humo.
  - 'centro': el centro del efecto queda ~30 px arriba de los pies: impactos sobre el cuerpo.
Si un efecto tiene más de 14 cuadros, se saltean cuadros parejos. `tam` es el tamaño final en pantalla
respecto del original (1 = igual que en el pack).

Uso: python3 tools/src/fx/private_packs.py "<carpeta con los packs (Downloads)>"
Los efectos que ya están en el atlas (pilar, tajo, bendicion) se mantienen; los de esta lista se reemplazan."""
import sys, os, re, json
from PIL import Image

S, N = 160, 14
OUT = os.path.join(os.path.dirname(__file__), '../../../apps/client/public/assets')

# nombre (a-z, lo valida el server), carpeta de cuadros relativa a los packs, modo, tamaño en pantalla, fps[, brillo[, escala fija]]
# escala fija: para packs de alta resolución (los cuadros de 640 px del Magic Buff) el 'tamaño' relativo al original no sirve; se da la escala final de la celda directo
# brillo: se dibujan en aditivo, así que los efectos oscuros (vampiro, nigromante) casi no se ven sin levantarlos
EFECTOS = [
    ('chispa',     'Pixel Art VFX - Fire Explosions - FREE Version/VFX3/Frames',  'centro', 1.1, 16),  # Saeta ígnea (impacto)
    ('estallido',  'Pixel Art VFX - Fire Mage - FREE Version/VFX1/frames',        'centro', 1.5, 14),  # Bola de fuego (impacto)
    ('meteoro',    'Pixel Art VFX - Fire Mage - FREE Version/VFX2/frames',        'pie',    1.9, 16),  # Infierno
    ('aroigneo',   'Pixel Art VFX - Fire Mage - FREE Version/VFX3/frames',        'centro', 1.2, 16),  # Ignición
    ('explosion',  'Pixel Art VFX - Fire Explosions - FREE Version/VFX1/Frames',  'centro', 2.0, 14),  # golpe en área del jefe
    ('escarcha',   'Pixel Art VFX - Frost Knight - FREE Version/VFX2/frames',     'centro', 1.2, 16),  # Esquirla de hielo (impacto)
    ('picos',      'Pixel Art VFX - Frost Knight - FREE Version/VFX3/Frames',     'pie',    1.6, 14),  # Nova de escarcha
    ('cadenas',    'Pixel Art VFX - Frost Knight - FREE Version/VFX3/Frames',     'pie',    0.9, 14),  # Cadenas de hielo (picos chicos que lo atrapan)
    ('estrella',   'Pixel Art VFX - Starcaller - FREE Version/VFX 1/Frames',      'pie',    1.4, 14),  # Clarividencia
    ('fugaz',      'Pixel Art VFX - Starcaller - FREE Version/VFX 2/Frames',      'centro', 1.4, 16),  # Parpadeo (llegada)
    ('cupula',     'Pixel Art VFX - Starcaller - FREE Version/VFX 3/Frames',      'pie',    1.5, 14),  # Escudo de maná
    ('humo',       'Pixel Art VFX - Smoke&Dust - Free Version/VFX3/frames',       'pie',    1.3, 14),  # Invisibilidad
    ('polvo',      'Pixel Art VFX - Smoke&Dust - Free Version/VFX2/frames',       'pie',    1.8, 12),  # Barrido
    ('polvareda',  'Pixel Art VFX - Smoke&Dust - Free Version/VFX1/frames',       'pie',    1.3, 14),  # Carga sagrada (salida)
    ('aturde',     'Pixel Art VFX - Smoke&Dust - Free Version/VFX4/frames',       'centro', 1.1, 14),  # aturdimientos
    ('rafaga',     'Pixel Art VFX Impacts - FREE Version/VFX5/COLOR/Frames',      'centro', 1.6, 16),  # Carga sagrada (choque)
    ('tajobrutal', 'Pixel Art VFX Impacts - FREE Version/VFX6/B&W/Frames',        'centro', 1.6, 16),  # Golpe brutal
    ('impacto',    'Pixel Art VFX Impacts - FREE Version/VFX4/B&W/Frames',        'centro', 1.3, 18),  # golpe cuerpo a cuerpo
    ('critico',    'Pixel Art VFX Impacts - FREE Version/VFX3/COLOR/Frames',      'centro', 1.8, 16),  # crítico cuerpo a cuerpo
    ('provocar',   'Pixel Art VFX - Vampire - FREE Version/VFX4/Frames',          'pie',    1.8, 12, 2.2),  # Mandato
    ('represalia', 'Pixel Art VFX - Vampire - FREE Version/VFX1/Frames',          'centro', 1.5, 14, 2.2),  # Aura de represalia / furia de jefe
    ('invocar',    'Pixel Art VFX - Necromancer - FREE Version/VFX 1/Frames',     'pie',    1.8, 12, 2.2),  # adds de jefe
    ('charco',     'Pixel Art VFX Impacts - FREE Version/VFX2/COLOR/Frames',      'pie',    2.4, 12),  # charco de jefe (ácido)
    # pack "Magic Buff Effects for Top Down Games" de Craftpix (anillos en el piso): healer y bendiciones
    ('curar',      'craftpix-net-207889-magic-buff-effects-pack-for-top-down-games/Life Recovery/PNG',  'pie', 1.0, 14, 1.0, 1.8),  # Curación, Renovar, Orbe, Esfera
    ('mana',       'craftpix-net-207889-magic-buff-effects-pack-for-top-down-games/Mana Recovery/PNG',  'pie', 1.0, 14, 1.0, 1.8),  # Segundo aliento, Intelecto arcano
    ('revivir',    'craftpix-net-207889-magic-buff-effects-pack-for-top-down-games/Revival/PNG',        'pie', 1.0, 14, 1.0, 1.9),  # Despertar
    ('inmune',     'craftpix-net-207889-magic-buff-effects-pack-for-top-down-games/Immunity/PNG',       'pie', 1.0, 14, 1.0, 1.8),  # Bendición sagrada, Bendición de amparo
    ('poder',      'craftpix-net-207889-magic-buff-effects-pack-for-top-down-games/Strength Buff/PNG',  'pie', 1.0, 14, 1.0, 1.8),  # Bendición de poder, Bendición de grupo
    ('maldicion',  'craftpix-net-207889-magic-buff-effects-pack-for-top-down-games/Debuff/PNG',         'pie', 1.0, 14, 1.0, 1.7),  # veneno / debuffs (reservado)
    # pack "10 Magic Sprite Sheet Effects Pixel Art" de Craftpix (hojas de 72 px): lo sagrado
    ('solar',      'craftpix-671189-10-magic-sprite-sheet-effects-pixel-art/4 Sun strike/Sun-strike.png', 'pie',    1.7, 16),  # Castigo, Reprender (pilar chico) y Nova sagrada (grande)
    ('anillo',     'craftpix-671189-10-magic-sprite-sheet-effects-pixel-art/8 Shield/Shield.png',        'centro', 1.0, 14, 1.0, 1.35),  # Escudo divino, Escudo guardián
    ('solargrande', 'craftpix-671189-10-magic-sprite-sheet-effects-pixel-art/4 Sun strike/Sun-strike.png', 'pie',   2.6, 16),  # Nova sagrada
    ('bolafuego',  'craftpix-671189-10-magic-sprite-sheet-effects-pixel-art/10 Fire ball/Fire-ball.png', 'centro', 1.2, 16),  # proyectil de la Saeta (reservado)
]
LIFT = 30  # px de celda entre los pies y el centro de un impacto


def frames(d: str) -> list[Image.Image]:
    if os.path.isfile(d):  # hoja horizontal de celdas cuadradas (packs de sprite sheets)
        sh = Image.open(d).convert('RGBA'); c = sh.height; ims = [sh.crop((i * c, 0, (i + 1) * c, c)) for i in range(sh.width // c)]
        ims = [im for im in ims if im.getbbox()]
        if len(ims) > N: ims = [ims[round(i * (len(ims) - 1) / (N - 1))] for i in range(N)]
        return ims
    fs = sorted((f for f in os.listdir(d) if f.lower().endswith('.png')), key=lambda f: int(re.findall(r'\d+', f)[-1]))
    if len(fs) > N: fs = [fs[round(i * (len(fs) - 1) / (N - 1))] for i in range(N)]
    return [Image.open(os.path.join(d, f)).convert('RGBA') for f in fs]


def bake(ims: list[Image.Image], mode: str, gain: float = 1.0) -> tuple[list[Image.Image], float]:
    """Celdas de 160 px con el efecto ubicado; devuelve también el factor aplicado."""
    box = None
    for im in ims:
        b = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
        if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    x0, y0, x1, y1 = box
    w, h, foot = x1 - x0, y1 - y0, S * 0.62
    if mode == 'pie': f = min(1.6, (S - 8) / w, (foot - 4) / h)
    else: f = min(1.6, (S - 8) / w, (foot - LIFT - 4) / (h / 2), (S - foot + LIFT - 4) / (h / 2))
    out = []
    for im in ims:
        im = im.crop(box)
        if gain != 1:
            r, g, b, a = im.split(); r, g, b = (c.point(lambda v: min(255, round(v * gain))) for c in (r, g, b)); im = Image.merge('RGBA', (r, g, b, a))
        im = im.resize((max(1, round(w * f)), max(1, round(h * f))), Image.NEAREST if f >= 1 else Image.LANCZOS)
        ox = round((S - im.width) / 2)
        oy = round(foot - im.height) if mode == 'pie' else round(foot - LIFT - im.height / 2)
        flat = Image.new('RGBA', im.size, (0, 0, 0, 255)); flat.alpha_composite(im)  # se dibuja con 'lighter': negro = nada
        cell = Image.new('RGB', (S, S)); cell.paste(flat.convert('RGB'), (ox, oy), im)
        out.append(cell)
    return out, f


def main(base: str) -> None:
    jpath, ipath = os.path.join(OUT, 'fx_priv.json'), os.path.join(OUT, 'fx_priv.webp')
    meta = json.load(open(jpath)) if os.path.exists(jpath) else {'cell': S, 'frames': N, 'rows': {}}
    sheet = Image.open(ipath).convert('RGB') if os.path.exists(ipath) else Image.new('RGB', (S * N, 0))
    for name, rel, mode, size, fps, *rest in EFECTOS:
        if not os.path.exists(os.path.join(base, rel)):  # pack no descargado: se conserva lo que ya está en el atlas
            print(f'{name:11s} (sin carpeta, se deja como está)'); continue
        cells, f = bake(frames(os.path.join(base, rel)), mode, rest[0] if rest else 1.0)
        if len(rest) > 1: size = rest[1] * f  # escala fija
        row = meta['rows'][name]['row'] if name in meta['rows'] else sheet.height // S
        if (row + 1) * S > sheet.height:
            grown = Image.new('RGB', (S * N, (row + 1) * S)); grown.paste(sheet, (0, 0)); sheet = grown
        sheet.paste(Image.new('RGB', (S * N, S)), (0, row * S))  # los cuadros que sobran quedan negros (= invisibles)
        for i, c in enumerate(cells): sheet.paste(c, (i * S, row * S))
        meta['rows'][name] = {'row': row, 'fps': fps, 'scale': round(size / f, 3), 'n': len(cells)}
        print(f'{name:11s} fila {row:2d}  {len(cells):2d} cuadros  factor {f:.2f}  escala {size / f:.2f}')
    sheet.save(ipath, 'WEBP', lossless=True)
    json.dump(meta, open(jpath, 'w'))


if __name__ == '__main__':
    main(sys.argv[1])
