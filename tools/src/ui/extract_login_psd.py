#!/usr/bin/env python3
"""Saca del PSD del lobby (rnm_6.psd, pack Craftpix "RPG MMO Game User Interface") las piezas que no
vienen sueltas en Textures/: el fondo desenfocado, el marco del logo (el "slot" donde va el logo del
juego), la filigrana que lo rodea, y de la pantalla de personajes su cabecera y el botón de borrar.

Igual que el resto del pack, los archivos NO se suben a git (licencia sin redistribución): quedan
en apps/client/public/assets/ui/craftpix/, que está en .gitignore.

Necesita psd-tools:  pip install psd-tools
Uso: python3 tools/src/ui/extract_login_psd.py "<carpeta del pack>/PSD Files/rnm_6.psd"
"""
import sys
from pathlib import Path

# (nombre de salida, ruta de capas dentro del PSD)
PIECES = [
    ("lg-bg.webp", ["BG"]),
    ("lg-logo-frame.png", ["1 - LOGIN", "LOGO", "logo frame"]),
    ("lg-logo-tribal.png", ["1 - LOGIN", "LOGO", "gt_COLOR"]),
    ("sel-header.png", ["2 - Character Select v2", "Side Bar", "Header", "h"]),
    ("sel-delete.png", ["2 - Character Select v2", "Side Bar", "Delete - On Hover"]),
]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    try:
        from psd_tools import PSDImage
        from psd_tools.psd.parse_limits import ParseLimits
    except ImportError:
        print("Falta psd-tools:  pip install psd-tools")
        return 1

    src = Path(sys.argv[1]).expanduser()
    if not src.is_file():
        print("no existe:", src)
        return 1
    dst = Path(__file__).resolve().parents[3] / "apps/client/public/assets/ui/craftpix"
    dst.mkdir(parents=True, exist_ok=True)

    # el PSD tiene más capas que el tope por defecto de psd-tools
    psd = PSDImage.open(src, parse_limits=ParseLimits(max_objects=None))
    for layer in psd:  # las pantallas que no son el login vienen apagadas en el PSD
        layer.visible = True
    for out, path in PIECES:
        node = psd
        for name in path:
            hits = [c for c in node if c.name == name]
            if not hits:
                print(f"falta la capa {' / '.join(path)} en el PSD")
                node = None
                break
            node = hits[0]
        if node is None:
            continue
        im = node.composite()
        if out.endswith(".webp"):
            im.convert("RGB").save(dst / out, quality=86, method=6)
        else:
            im.save(dst / out)
        print(out, im.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
