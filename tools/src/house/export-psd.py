"""
Exporta la capa de la casa ("24 - hous" > "house") del PSD "Fantasy House" a un PNG con alfa.
El PSD no va al repo (26 MB); este PNG tampoco: es la entrada de atlas.ts.

Uso: python3 -I tools/src/house/export-psd.py <Fantasy House.psd> <salida.png>
Requiere: pip install psd-tools
"""
import sys
from psd_tools import PSDImage

src, dst = sys.argv[1], sys.argv[2]
psd = PSDImage.open(src)
layer = next(c for g in psd if g.name.startswith('24') for c in g if c.name == 'house')
layer.composite().save(dst)
print(f'{layer.name}: {layer.size} -> {dst}')
