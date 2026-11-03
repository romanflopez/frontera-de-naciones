#!/usr/bin/env python3
"""Copia a apps/client/public/assets/ui/craftpix/ las texturas que usan craftpix.css y login-craftpix.css.

Tres piezas del login (fondo, marco del logo y filigrana) no están sueltas en Textures/: salen de
PSD Files/rnm_6.psd. Para extraerlas: python3 tools/src/ui/extract_login_psd.py "<pack>/PSD Files/rnm_6.psd"

Pack: "RPG MMO Game User Interface" de Craftpix (craftpix-net-745192). Su licencia permite usarlo
en el juego pero no redistribuir los archivos, así que NO se suben a git (están en .gitignore).
Si faltan, el cliente se ve como antes (el CSS tiene el diseño actual de fondo).

Uso: python3 tools/src/ui/install_craftpix.py "<carpeta del pack>/Textures"
"""
import shutil
import sys
from pathlib import Path

FILES = {
    "hdr-gradient.png": "Windows/Window/Header/Window_Header_Gradient.png",
    "hdr-tribal.png": "Windows/Window/Header/Window_Header_Tribals_Small_Fill.png",
    "slot.png": "Windows/Character/Equip Slot/Equip_Slot_Background.png",
    "tooltip-bg.png": "HUD/Tooltip/Tooltip_Background.png",
    "btn-sq.png": "Controls/Buttons/Square/Button_S1_Background.png",
    "lg-field.png": "Controls/Input Field/InputField_Background.png",
    "lg-check.png": "Controls/Toggles/Checkbox_Checkmark.png",
    "lg-btn-bg.png": "Controls/Buttons/Rectangular/Large/Button_RL_Background.png",
    "lg-btn-ov.png": "Controls/Buttons/Rectangular/Large/Button_RL_Overlay.png",
    "lg-btn-border.png": "Controls/Buttons/Rectangular/Large/Button_RL_Border.png",
    "lg-bar-border.png": "Lobby/Bottom Bar/BottomBar_Border.png",
    "lg-bar-tribal.png": "Lobby/Bottom Bar/Tribals/BottomBar_SideTribal_Fill.png",
    "icon-close.png": "Controls/Buttons/Square/Icons/Button_S1_Icon_Close.png",
}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    src = Path(sys.argv[1]).expanduser()
    dst = Path(__file__).resolve().parents[3] / "apps/client/public/assets/ui/craftpix"
    dst.mkdir(parents=True, exist_ok=True)
    missing = 0
    for out, rel in FILES.items():
        f = src / rel
        if f.is_file():
            shutil.copyfile(f, dst / out)
        else:
            print("falta:", f)
            missing += 1
    print(f"{len(FILES) - missing}/{len(FILES)} texturas en {dst}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
