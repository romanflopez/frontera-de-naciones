#!/usr/bin/env python3
"""Saca de los PSD del pack Craftpix "RPG MMO Game User Interface" las piezas que no vienen sueltas
en Textures/: el fondo desenfocado y la filigrana del lobby, la cabecera y el botón de borrar de la
pantalla de personajes, y el adorno de las notificaciones del HUD.

Igual que el resto del pack, los archivos NO se suben a git (licencia sin redistribución): quedan
en apps/client/public/assets/ui/craftpix/, que está en .gitignore.

Necesita psd-tools:  pip install psd-tools
Uso: python3 tools/src/ui/extract_psd.py "<carpeta del pack>/PSD Files"
"""
import sys
from pathlib import Path

# archivo del pack -> [(nombre de salida, ruta de capas dentro del PSD)]
PIECES = {
    "rnm_6.psd": [
        ("lg-bg.webp", ["BG"]),
        ("lg-logo-tribal.png", ["1 - LOGIN", "LOGO", "gt_COLOR"]),
        ("sel-header.png", ["2 - Character Select v2", "Side Bar", "Header", "h"]),
        ("sel-delete.png", ["2 - Character Select v2", "Side Bar", "Delete - On Hover"]),
    ],
    "rnm_6_hud.psd": [
        ("notif-top.png", ["Notification 2", "top"]),
    ],
}


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

    carpeta = Path(sys.argv[1]).expanduser()
    if not carpeta.is_dir():
        print("no existe la carpeta:", carpeta)
        return 1
    dst = Path(__file__).resolve().parents[3] / "apps/client/public/assets/ui/craftpix"
    dst.mkdir(parents=True, exist_ok=True)

    for archivo, piezas in PIECES.items():
        ruta = carpeta / archivo
        if not ruta.is_file():
            print("falta:", ruta)
            continue
        # los PSD tienen más capas que el tope por defecto de psd-tools
        psd = PSDImage.open(ruta, parse_limits=ParseLimits(max_objects=None))
        for layer in psd:  # las pantallas que no son la primera vienen apagadas
            layer.visible = True
        for out, path in piezas:
            node = psd
            for name in path:
                hits = [c for c in node if c.name == name]
                if not hits:
                    print(f"falta la capa {' / '.join(path)} en {archivo}")
                    node = None
                    break
                node = hits[0]
            if node is None:
                continue
            im = node.composite(force=True)
            if out.endswith(".webp"):
                im.convert("RGB").save(dst / out, quality=86, method=6)
            else:
                im.save(dst / out)
            print(out, im.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
