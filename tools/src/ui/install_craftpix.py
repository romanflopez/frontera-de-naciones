#!/usr/bin/env python3
"""Copia a apps/client/public/assets/ui/craftpix/ las texturas que usan craftpix.css y login-craftpix.css.

Tres piezas del login (fondo, marco del logo y filigrana) no están sueltas en Textures/: salen de
PSD Files/rnm_6.psd. Para extraerlas: python3 tools/src/ui/extract_psd.py "<pack>/PSD Files"

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
    "ab-globe-bg.png": "HUD/Action Bar/Globes/ActionBar_Globe_Background.png",
    "ab-globe-red.png": "HUD/Action Bar/Globes/ActionBar_Globe_Fill_Red.png",
    "ab-globe-blue.png": "HUD/Action Bar/Globes/ActionBar_Globe_Fill_Blue.png",
    "ab-globe-empty.png": "HUD/Action Bar/Globes/ActionBar_Globe_Fill_Empty.png",
    "ab-slot.png": "HUD/Action Bar/Slots/ActionBar_MainSlot_Background.png",
    "ab-xp-bg.png": "HUD/Action Bar/Experience Bar/XPBar_Background.png",
    "ab-xp-fill.png": "HUD/Action Bar/Experience Bar/XPBar_Fill.png",
    "ab-tribal.png": "HUD/Action Bar/ActionBar_Tribals.png",
    "icon-close.png": "Controls/Buttons/Square/Icons/Button_S1_Icon_Close.png",
    # marco de objetivo y foco, diálogo con retrato y burbuja de NPC (hud-craftpix.css, quests-craftpix.css)
    "np-bg.png": "HUD/Nameplate/Nameplate_Background.png",
    "np-bar.png": "HUD/Nameplate/Nameplate_Bar_Primary.png",
    "np-lvl.png": "HUD/Nameplate/Nameplate_LevelFrame.png",
    "np-skull.png": "HUD/Unit Frames/Main/Level/UnitFrame_Main_Level_Skull.png",
    "np-elite.png": "HUD/Unit Frames/Main/UnitFrame_Main_Elite.png",
    "av-bg.png": "HUD/Unit Frames/Main/Avatar/UnitFrame_Main_Avatar_Background.png",
    "av-ov.png": "HUD/Unit Frames/Main/Avatar/UnitFrame_Main_Avatar_Overlay.png",
    "bubble-bg.png": "Mobile/NPC Bubble/Bubble_Background.png",
    "bubble-arrow.png": "Mobile/NPC Bubble/Arrow.png",
    # ventana Personaje (char-craftpix.css)
    "win-bg.png": "Windows/Window/Window_Background.png",
    "win-hdr-bg.png": "Windows/Window/Header/Window_Header_Background.png",
    "win-hdr-arrow.png": "Windows/Window/Header/Window_Header_Border_Center.png",
    "win-hdr-line.png": "Windows/Window/Header/Window_Header_Border_Side.png",
    "win-hdr-tribal.png": "Windows/Window/Header/Window_Header_Tribals_Fill.png",
    "ch-silhouette.png": "Windows/Character/Character_Example.png",
    "ch-rc-left.png": "Windows/Character/Rotation Controls/Character_RC_Left.png",
    "ch-rc-mid.png": "Windows/Character/Rotation Controls/Character_RC_Middle.png",
    "sep-v.png": "Miscellaneous/Separators/Seprator_Vertical.png",
    "sep-h.png": "Miscellaneous/Separators/Seprator_Horizontal.png",
    "ch-slot-cabeza.png": "Windows/Character/Equip Slot/Icons/Helmet.png",
    "ch-slot-armadura.png": "Windows/Character/Equip Slot/Icons/Chest.png",
    "ch-slot-guantes.png": "Windows/Character/Equip Slot/Icons/Gloves.png",
    "ch-slot-botas.png": "Windows/Character/Equip Slot/Icons/Boots.png",
    "ch-slot-amuleto.png": "Windows/Character/Equip Slot/Icons/Necklace.png",
    "ch-slot-anillo.png": "Windows/Character/Equip Slot/Icons/Ring.png",
    "ch-slot-arma.png": "Windows/Character/Equip Slot/Icons/MainWeapon.png",
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
