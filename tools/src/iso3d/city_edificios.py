"""
Set completo de edificios del rediseño de ciudades (docs/CIUDADES.md, C3-C4): los 8 edificios con función, 3 casas, torre de
muralla, tramos de muralla, portones y fuente, en las dos naciones (Solmar y Vhar nevada). Todo con cajas, techos y materiales
procedurales de city.py: arte propio, sin packs.

La puerta de cada edificio sale de su especificación (`door = (lado, i)`, igual que `TownBuilding.door` en packages/world/src/town.ts):
  'S' -> cara +y, la puerta da a la celda (x + i, y + h);   'E' -> cara +x, la puerta da a (x + w, y + i).

Uso:
  python3 -I tools/src/iso3d/city_edificios.py <salida_dir> <solmar|vhar> [nombre ...]      render HD + 1x + json
  python3 -I tools/src/iso3d/city_edificios.py --exportar <salida_dir> <solmar|vhar>        webp + meta.json del cliente
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import city as C
from city_piloto import paleta as paleta_base, ventana, puerta

PREFIJO = {'solmar': 'sm2_', 'vhar': 'vh2_'}


# ------------------------------------------------------------------ paletas (pulido tras el piloto)
def paleta(nacion):
    p = paleta_base(nacion)
    m = C.material
    if nacion == 'solmar':
        p['techo'] = m('techo', (0.40, 0.12, 0.07), (0.27, 0.075, 0.045), textura='tejas', escala=7.0)
        p['techo2'] = m('techo2', (0.16, 0.28, 0.42), (0.10, 0.19, 0.30), textura='tejas', escala=7.0)      # azul, para la torre
        p['agua'] = m('agua', (0.10, 0.35, 0.55), None, rugosidad=0.1)
        p['oro'] = m('oro', (0.75, 0.55, 0.12), None, rugosidad=0.3)
        p['tela2'] = m('tela2', (0.80, 0.68, 0.20), (0.15, 0.30, 0.65), textura='tablas', escala=6.0)
    else:
        p['techo'] = m('techo', (0.11, 0.115, 0.15), (0.06, 0.065, 0.09), textura='tejas', escala=7.0, nieve=True)
        p['techo2'] = m('techo2', (0.45, 0.05, 0.05), (0.25, 0.03, 0.03), textura='tejas', escala=7.0, nieve=True)   # rojo, para la torre
        p['agua'] = m('agua', (0.25, 0.45, 0.65), None, rugosidad=0.05)
        p['oro'] = m('oro', (0.45, 0.45, 0.50), None, rugosidad=0.35)
        p['tela2'] = m('tela2', (0.08, 0.08, 0.09), (0.55, 0.05, 0.05), textura='tablas', escala=6.0)
    return p


# ------------------------------------------------------------------ piezas comunes
M_EDIF = 0.4          # margen entre la huella y el muro: deja lugar para zócalo, alero y la sombra
PISO_H = 1.95


def cuerpo(p, fw, fh, pisos=1, mat='muro', margen=M_EDIF):
    x0, y0, x1, y1 = margen, margen, fw - margen, fh - margen
    p['_x1'], p['_y1'] = x1, y1
    h = PISO_H * pisos
    C.caja(x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, 0, 0.5, p['zocalo'], 'zocalo')
    C.caja(x0, y0, x1, y1, 0.5, h, p[mat], 'muro')
    for k in range(1, pisos):
        C.caja(x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, k * PISO_H - 0.07, k * PISO_H + 0.07, p['zocalo'], 'cornisa')
    return x0, y0, x1, y1, h


def entrada(p, door, ancho=0.95, alto=1.55):
    lado, i = door
    puerta(p, '+y' if lado == 'S' else '+x', i + 0.5, ancho=ancho, alto=alto)


def ventanas(p, fw, fh, door, pisos=1, ancho=0.42):
    """Ventanas repartidas en las dos caras que se ven; en planta baja se saltea la zona de la puerta."""
    lado, i = door
    for cara, L in (('+y', fw), ('+x', fh)):
        a, b = M_EDIF + 0.6, L - M_EDIF - 0.6
        n = max(1, int((b - a) / 1.7) + 1)
        for k in range(n):
            pos = a + (b - a) * (k + 0.5) / n
            for piso in range(pisos):
                if piso == 0 and ((cara == '+y' and lado == 'S') or (cara == '+x' and lado == 'E')) and abs(pos - (i + 0.5)) < 0.95:
                    continue
                z0 = 1.0 + piso * PISO_H
                ventana(p, cara, pos, z0=z0, z1=z0 + 0.55, ancho=ancho)


def merlones(p, x0, y0, x1, y1, z, mat='piedra', paso=0.8, ancho=0.45, alto=0.32):
    """Almenas en el borde de una terraza rectangular."""
    k = 0
    x = x0
    while x + ancho <= x1 + 1e-6:
        if k % 2 == 0:
            C.caja(x, y0, x + ancho, y0 + 0.25, z, z + alto, p[mat], 'merlon')
            C.caja(x, y1 - 0.25, x + ancho, y1, z, z + alto, p[mat], 'merlon')
        x += paso * 0.5
        k += 1
    k = 0
    y = y0
    while y + ancho <= y1 + 1e-6:
        if k % 2 == 0:
            C.caja(x0, y, x0 + 0.25, y + ancho, z, z + alto, p[mat], 'merlon')
            C.caja(x1 - 0.25, y, x1, y + ancho, z, z + alto, p[mat], 'merlon')
        y += paso * 0.5
        k += 1


def asta(p, x, y, z0, alto=1.4, mat='tela'):
    C.caja(x - 0.03, y - 0.03, x + 0.03, y + 0.03, z0, z0 + alto, p['madera'], 'asta')
    C.caja(x, y - 0.5, x + 0.04, y, z0 + alto - 0.5, z0 + alto, p[mat], 'bandera')


# ------------------------------------------------------------------ edificios con función
def ayuntamiento(p, fw=9, fh=6, door=('S', 4)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 2)
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.5, p['techo'], cumbrera='x', alero=0.3)
    # pórtico central sobre la puerta con frontón y reloj
    cx = door[1] + 0.5
    C.caja(cx - 1.6, y1, cx + 1.6, y1 + 0.55, 0, 2.7, p['zocalo'], 'portico')
    C.techo_dos_aguas(cx - 1.6, y1, cx + 1.6, y1 + 0.55, 2.7, 0.7, p['techo'], cumbrera='y', alero=0.1, nombre='frontón')
    C.caja(cx - 0.25, y1 + 0.5, cx + 0.25, y1 + 0.58, 3.0, 3.5, p['oro'], 'reloj')
    ventanas(p, fw, fh, door, 2)
    p['_y1'] = y1 + 0.55          # la puerta va al frente del pórtico, no tapada por él
    entrada(p, door, ancho=1.2, alto=1.7)
    asta(p, cx, y1 + 0.3, 3.4, alto=1.5)
    return 5.2


def templo(p, fw=7, fh=7, door=('S', 3)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1, margen=0.5)
    h = PISO_H * 1.4
    C.caja(x0, y0, x1, y1, 1.95, h, p['muro'], 'muro_alto')
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.7, p['techo'], cumbrera='y', alero=0.3)
    # campanario en la esquina trasera (lejos de cámara) con aguja
    tx0, ty0, tx1, ty1 = fw - 2.7, 0.33, fw - 0.33, 2.7
    C.caja(tx0, ty0, tx1, ty1, 0, 4.4, p['muro'], 'campanario')
    C.caja(tx0 + 0.45, ty0 - 0.02, tx1 - 0.45, ty0 + 0.1, 3.2, 4.0, p['oscuro'], 'arco_campana')
    C.techo_piramide(tx0, ty0, tx1, ty1, 4.4, 2.2, p['techo2'], alero=0.15)
    C.caja(tx0 + 0.95, ty0 + 0.95, tx0 + 1.15, ty0 + 1.15, 6.5, 7.1, p['oro'], 'cruz_v')
    C.caja(tx0 + 0.8, ty0 + 0.98, tx0 + 1.3, ty0 + 1.12, 6.8, 6.95, p['oro'], 'cruz_h')
    # vitral redondo sobre la puerta
    C.caja(door[1] + 0.5 - 0.35, y1 + 0.02, door[1] + 0.5 + 0.35, y1 + 0.1, 2.2, 3.0, p['vidrio'], 'vitral')
    ventanas(p, fw, fh, door, 1)
    entrada(p, door, ancho=1.1, alto=1.7)
    return 7.3


def joyeria(p, fw=5, fh=5, door=('E', 2)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1)
    C.techo_piramide(x0, y0, x1, y1, h, 1.5, p['techo'], alero=0.3)
    ventanas(p, fw, fh, door, 1)
    entrada(p, door)
    # toldo y vitrina sobre la cara de la puerta (+x)
    C.caja(x1 + 0.02, door[1] + 0.5 - 1.1, x1 + 0.6, door[1] + 0.5 + 1.1, 1.75, 1.82, p['tela'], 'toldo')
    C.caja(x1 + 0.1, door[1] + 0.5 + 0.75, x1 + 0.5, door[1] + 0.5 + 1.15, 0, 0.8, p['madera'], 'vitrina')
    C.caja(x1 + 0.12, door[1] + 0.5 + 0.77, x1 + 0.48, door[1] + 0.5 + 1.13, 0.8, 0.9, p['oro'], 'joya')
    return 3.6


def tienda(p, fw=6, fh=5, door=('E', 2)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1)
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.2, p['techo'], cumbrera='y', alero=0.3)
    ventanas(p, fw, fh, door, 1)
    entrada(p, door, ancho=1.0)
    C.caja(x1 + 0.02, door[1] + 0.5 - 1.5, x1 + 0.8, door[1] + 0.5 + 1.5, 1.8, 1.86, p['tela'], 'toldo')
    for dy in (-1.2, 1.2):
        C.caja(x1 + 0.7, door[1] + 0.5 + dy - 0.04, x1 + 0.76, door[1] + 0.5 + dy + 0.04, 0, 1.8, p['madera'], 'poste')
    C.caja(x1 + 0.2, door[1] + 0.5 + 1.2, x1 + 0.65, door[1] + 0.5 + 1.8, 0, 0.7, p['madera'], 'cajon')
    C.caja(x1 + 0.2, door[1] + 0.5 - 1.8, x1 + 0.6, door[1] + 0.5 - 1.3, 0, 0.55, p['madera'], 'barril')
    return 3.3


def herreria(p, fw=7, fh=5, door=('S', 3)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1)
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.35, p['techo'], cumbrera='x', alero=0.28)
    C.caja(1.1, 0.9, 1.7, 1.5, h, h + 1.9, p['zocalo'], 'chimenea')
    C.caja(1.06, 0.86, 1.74, 1.54, h + 1.9, h + 2.05, p['zocalo'], 'remate')
    entrada(p, door, ancho=1.3, alto=1.6)
    ventanas(p, fw, fh, door, 1)
    # fragua abierta contra la cara +x: horno de piedra con brasas
    C.caja(x1 - 0.02, 1.4, x1 + 0.75, 3.4, 0, 1.0, p['zocalo'], 'horno')
    C.caja(x1 + 0.15, 1.7, x1 + 0.65, 3.1, 1.0, 1.08, p['vidrio'], 'brasas')
    # yunque sobre tocón, barril y toldo de entrada
    ex = door[1] + 0.5
    C.caja(ex - 1.5, y1 + 0.15, ex - 1.0, y1 + 0.5, 0.35, 0.6, p['metal'], 'yunque')
    C.caja(ex - 1.45, y1 + 0.2, ex - 1.05, y1 + 0.45, 0, 0.35, p['madera'], 'tocon')
    C.caja(ex + 1.1, y1 + 0.12, ex + 1.6, y1 + 0.55, 0, 0.7, p['madera'], 'barril')
    C.caja(ex - 0.9, y1 + 0.02, ex + 0.9, y1 + 0.55, 1.95, 2.0, p['tela'], 'toldo')
    return 3.4


def deposito(p, fw=6, fh=5, door=('S', 2)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1, mat='zocalo')
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.0, p['techo'], cumbrera='x', alero=0.28)
    ex = door[1] + 0.5
    entrada(p, door, ancho=1.4, alto=1.7)
    ventanas(p, fw, fh, door, 1, ancho=0.3)
    # cajas apiladas junto a la puerta y un fardo
    C.caja(ex + 1.0, y1 + 0.1, ex + 1.6, y1 + 0.7, 0, 0.6, p['madera'], 'caja_a')
    C.caja(ex + 1.05, y1 + 0.15, ex + 1.55, y1 + 0.65, 0.6, 1.1, p['madera'], 'caja_b')
    C.caja(ex - 1.8, y1 + 0.1, ex - 1.2, y1 + 0.6, 0, 0.45, p['madera'], 'caja_c')
    return 3.2


def cuartel(p, fw=8, fh=6, door=('E', 3)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1, mat='zocalo')
    # terraza con almenas y torreta en la esquina del fondo
    C.caja(x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, h, h + 0.12, p['zocalo'], 'losa')
    merlones(p, x0, y0, x1, y1, h + 0.12, mat='zocalo')
    C.caja(x0 + 0.1, y0 + 0.1, x0 + 2.4, y0 + 2.4, h, h + 1.6, p['zocalo'], 'torreta')
    merlones(p, x0 + 0.1, y0 + 0.1, x0 + 2.4, y0 + 2.4, h + 1.6, mat='zocalo')
    entrada(p, door, ancho=1.2, alto=1.7)
    ventanas(p, fw, fh, door, 1, ancho=0.3)
    asta(p, fw - 0.9, 1.0, h + 0.12, alto=1.8, mat='tela')
    # escudo sobre la puerta
    C.caja(x1 + 0.02, door[1] + 0.5 - 0.3, x1 + 0.1, door[1] + 0.5 + 0.3, 2.0, 2.6, p['tela'], 'escudo')
    return 4.4


def torre_magica(p, fw=4, fh=4, door=('S', 2)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 3, mat='muro', margen=0.45)
    C.techo_piramide(x0 - 0.1, y0 - 0.1, x1 + 0.1, y1 + 0.1, h, 2.4, p['techo2'], alero=0.25)
    C.caja(fw / 2 - 0.08, fh / 2 - 0.08, fw / 2 + 0.08, fh / 2 + 0.08, h + 2.3, h + 3.0, p['oro'], 'aguja')
    entrada(p, door, ancho=0.9, alto=1.5)
    ventanas(p, fw, fh, door, 3, ancho=0.35)
    # balcón con baranda en el segundo piso
    C.caja(x0 - 0.3, y1 - 0.05, x1 + 0.3, y1 + 0.35, PISO_H, PISO_H + 0.1, p['zocalo'], 'balcon')
    return 8.6


# ------------------------------------------------------------------ casas de relleno
def casa_a(p, fw=4, fh=3, door=('S', 1)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1, margen=0.3)
    C.techo_dos_aguas(x0, y0, x1, y1, h, 0.95, p['techo'], cumbrera='y', alero=0.24)
    entrada(p, door, ancho=0.7, alto=1.45)
    ventanas(p, fw, fh, door, 1)
    return 3.0


def casa_b(p, fw=4, fh=4, door=('E', 1)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 2, margen=0.3)
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.1, p['techo'], cumbrera='x', alero=0.24)
    entrada(p, door, ancho=0.75, alto=1.5)
    ventanas(p, fw, fh, door, 2, ancho=0.38)
    return 5.2


def casa_c(p, fw=5, fh=4, door=('S', 2)):
    x0, y0, x1, y1, h = cuerpo(p, fw, fh, 1, margen=0.3)
    C.techo_dos_aguas(x0, y0, x1, y1, h, 1.1, p['techo'], cumbrera='x', alero=0.26)
    C.caja(fw - 1.4, 0.7, fw - 0.9, 1.2, h, h + 1.5, p['zocalo'], 'chimenea')
    entrada(p, door, ancho=0.8, alto=1.5)
    ventanas(p, fw, fh, door, 1)
    C.caja(door[1] + 0.5 - 0.8, y1 + 0.04, door[1] + 0.5 + 0.8, y1 + 0.5, 1.75, 1.8, p['tela'], 'toldo')
    return 3.6


# ------------------------------------------------------------------ murallas, portones, torres y fuente
ALTO_MURO = 2.9


def torre_muralla(p, fw=3, fh=3, door=None):
    p['_x1'], p['_y1'] = fw - 0.2, fh - 0.2
    C.caja(0.2, 0.2, fw - 0.2, fh - 0.2, 0, 3.8, p['piedra'], 'torre')
    C.caja(0.12, 0.12, fw - 0.12, fh - 0.12, 3.8, 3.95, p['zocalo'], 'losa')
    merlones(p, 0.12, 0.12, fw - 0.12, fh - 0.12, 3.95, mat='piedra')
    C.techo_piramide(0.85, 0.85, fw - 0.85, fh - 0.85, 3.95, 1.0, p['techo2'], alero=0.05)
    ventana(p, '+y', fw / 2, z0=2.2, z1=3.0, ancho=0.3)
    ventana(p, '+x', fh / 2, z0=2.2, z1=3.0, ancho=0.3)
    asta(p, fw / 2, fh / 2, 4.9, alto=1.3)
    return 6.3


def muralla_x(p, fw=4, fh=1, door=None):
    """Tramo de muralla de 4 celdas a lo largo de x, de 1 de grosor."""
    p['_x1'], p['_y1'] = fw, fh - 0.15
    C.caja(0, 0.15, fw, fh - 0.15, 0, ALTO_MURO, p['piedra'], 'lienzo')
    C.caja(0.02, 0.1, fw - 0.02, fh - 0.1, 0, 0.35, p['zocalo'], 'base')
    C.caja(0.02, 0.1, fw - 0.02, fh - 0.1, ALTO_MURO - 0.1, ALTO_MURO + 0.05, p['zocalo'], 'cornisa')
    for i in range(0, int(fw / 0.8)):
        if i % 2 == 0:
            C.caja(i * 0.8 + 0.05, 0.1, i * 0.8 + 0.5, fh - 0.1, ALTO_MURO + 0.05, ALTO_MURO + 0.4, p['piedra'], 'merlon')
    return ALTO_MURO + 0.5


def muralla_y(p, fw=1, fh=4, door=None):
    p['_x1'], p['_y1'] = fw - 0.15, fh
    C.caja(0.15, 0, fw - 0.15, fh, 0, ALTO_MURO, p['piedra'], 'lienzo')
    C.caja(0.1, 0.02, fw - 0.1, fh - 0.02, 0, 0.35, p['zocalo'], 'base')
    C.caja(0.1, 0.02, fw - 0.1, fh - 0.02, ALTO_MURO - 0.1, ALTO_MURO + 0.05, p['zocalo'], 'cornisa')
    for i in range(0, int(fh / 0.8)):
        if i % 2 == 0:
            C.caja(0.1, i * 0.8 + 0.05, fw - 0.1, i * 0.8 + 0.5, ALTO_MURO + 0.05, ALTO_MURO + 0.4, p['piedra'], 'merlon')
    return ALTO_MURO + 0.5


def porton_x(p, fw=4, fh=1, door=None):
    """Portón en una muralla que corre a lo largo de x: el paso va a lo largo de y y se ve en la cara +y. Paso de 2 celdas centrado."""
    p['_x1'], p['_y1'] = fw, fh - 0.15
    g0, g1 = fw / 2 - 1.0, fw / 2 + 1.0
    for a, b in ((0, g0), (g1, fw)):
        C.caja(a, 0.15, b, fh - 0.15, 0, ALTO_MURO, p['piedra'], 'lienzo')
        C.caja(a + 0.02, 0.1, b - 0.02, fh - 0.1, 0, 0.35, p['zocalo'], 'base')
        C.caja(a + 0.02, 0.1, b - 0.02, fh - 0.1, ALTO_MURO - 0.1, ALTO_MURO + 0.05, p['zocalo'], 'cornisa')
    C.caja(g0 - 0.15, 0.05, g1 + 0.15, fh - 0.05, 2.1, ALTO_MURO + 0.3, p['zocalo'], 'dintel')
    for i in range(0, int(fw / 0.8)):
        x = i * 0.8 + 0.05
        if i % 2 == 0 and (x + 0.45 < g0 - 0.1 or x > g1 + 0.1):
            C.caja(x, 0.1, x + 0.45, fh - 0.1, ALTO_MURO + 0.05, ALTO_MURO + 0.4, p['piedra'], 'merlon')
    C.caja(g0 + 0.1, 0.25, g1 - 0.1, 0.4, 0, 2.1, p['metal'], 'reja')
    C.caja(g0 - 0.04, fh - 0.3, g0 + 0.1, fh - 0.15, 0, 2.1, p['madera'], 'jamba')
    C.caja(g1 - 0.1, fh - 0.3, g1 + 0.04, fh - 0.15, 0, 2.1, p['madera'], 'jamba')
    C.caja(fw / 2 - 0.3, fh - 0.12, fw / 2 + 0.3, fh - 0.06, 1.0, 1.9, p['tela'], 'estandarte')
    return ALTO_MURO + 0.7


def porton_y(p, fw=1, fh=4, door=None):
    """Portón en una muralla que corre a lo largo de y: el paso va a lo largo de x y se ve en la cara +x."""
    p['_x1'], p['_y1'] = fw - 0.15, fh
    g0, g1 = fh / 2 - 1.0, fh / 2 + 1.0
    for a, b in ((0, g0), (g1, fh)):
        C.caja(0.15, a, fw - 0.15, b, 0, ALTO_MURO, p['piedra'], 'lienzo')
        C.caja(0.1, a + 0.02, fw - 0.1, b - 0.02, 0, 0.35, p['zocalo'], 'base')
        C.caja(0.1, a + 0.02, fw - 0.1, b - 0.02, ALTO_MURO - 0.1, ALTO_MURO + 0.05, p['zocalo'], 'cornisa')
    C.caja(0.05, g0 - 0.15, fw - 0.05, g1 + 0.15, 2.1, ALTO_MURO + 0.3, p['zocalo'], 'dintel')
    for i in range(0, int(fh / 0.8)):
        y = i * 0.8 + 0.05
        if i % 2 == 0 and (y + 0.45 < g0 - 0.1 or y > g1 + 0.1):
            C.caja(0.1, y, fw - 0.1, y + 0.45, ALTO_MURO + 0.05, ALTO_MURO + 0.4, p['piedra'], 'merlon')
    C.caja(0.25, g0 + 0.1, 0.4, g1 - 0.1, 0, 2.1, p['metal'], 'reja')
    C.caja(fw - 0.3, g0 - 0.04, fw - 0.15, g0 + 0.1, 0, 2.1, p['madera'], 'jamba')
    C.caja(fw - 0.3, g1 - 0.1, fw - 0.15, g1 + 0.04, 0, 2.1, p['madera'], 'jamba')
    C.caja(fw - 0.12, fh / 2 - 0.3, fw - 0.06, fh / 2 + 0.3, 1.0, 1.9, p['tela'], 'estandarte')
    return ALTO_MURO + 0.7


def fuente(p, fw=3, fh=3, door=None):
    """Fuente octogonal con pilar central, para el medio de la plaza."""
    p['_x1'], p['_y1'] = fw, fh
    c = fw / 2
    r = 1.25
    n = 8
    # cuenca: prisma octogonal hecho con cajas rotadas aproximadas por un anillo de 8 tramos
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        x0, y0 = c + r * math.cos(a0), c + r * math.sin(a0)
        x1, y1 = c + r * math.cos(a1), c + r * math.sin(a1)
        C._objeto('borde', [(x0, y0, 0), (x1, y1, 0), (x1, y1, 0.55), (x0, y0, 0.55),
                            (c + (r - 0.22) * math.cos(a0), c + (r - 0.22) * math.sin(a0), 0), (c + (r - 0.22) * math.cos(a1), c + (r - 0.22) * math.sin(a1), 0),
                            (c + (r - 0.22) * math.cos(a1), c + (r - 0.22) * math.sin(a1), 0.55), (c + (r - 0.22) * math.cos(a0), c + (r - 0.22) * math.sin(a0), 0.55)],
                  [(0, 1, 2, 3), (7, 6, 5, 4), (3, 2, 6, 7), (0, 4, 5, 1), (1, 5, 6, 2), (0, 3, 7, 4)], p['zocalo'])
    pts = [(c + (r - 0.2) * math.cos(2 * math.pi * k / n), c + (r - 0.2) * math.sin(2 * math.pi * k / n), 0.38) for k in range(n)]
    C._objeto('agua', pts, [tuple(range(n))], p['agua'])
    C.caja(c - 0.22, c - 0.22, c + 0.22, c + 0.22, 0, 1.3, p['zocalo'], 'pilar')
    C.caja(c - 0.6, c - 0.6, c + 0.6, c + 0.6, 1.25, 1.4, p['zocalo'], 'plato')
    C.caja(c - 0.1, c - 0.1, c + 0.1, c + 0.1, 1.4, 1.9, p['oro'], 'surtidor')
    return 2.3


# id -> (fw, fh, puerta, constructor). La puerta es la misma para las dos naciones.
EDIFICIOS = {
    'ayuntamiento': (9, 6, ('S', 4), ayuntamiento),
    'templo': (7, 7, ('S', 3), templo),
    'joyeria': (5, 5, ('E', 2), joyeria),
    'tienda': (6, 5, ('E', 2), tienda),
    'herreria': (7, 5, ('S', 3), herreria),
    'deposito': (6, 5, ('S', 2), deposito),
    'cuartel': (8, 6, ('E', 3), cuartel),
    'torre': (4, 4, ('S', 2), torre_magica),
    'casa_a': (4, 3, ('S', 1), casa_a),
    'casa_b': (4, 4, ('E', 1), casa_b),
    'casa_c': (5, 4, ('S', 2), casa_c),
    'torre_muralla': (3, 3, None, torre_muralla),
    'muralla_x': (4, 1, None, muralla_x),
    'muralla_y': (1, 4, None, muralla_y),
    'porton_x': (4, 1, None, porton_x),
    'porton_y': (1, 4, None, porton_y),
    'fuente': (3, 3, None, fuente),
}


def hacer(nacion, nombre, salida, muestras=int(os.environ.get('MUESTRAS', 48))):
    fw, fh, door, fn = EDIFICIOS[nombre]
    esc = C.escena_limpia('CYCLES', muestras)
    p = paleta(nacion)
    zmax = fn(p, fw, fh, door) if door else fn(p, fw, fh)
    W, H = C.camara(esc, fw, fh, zmax + 0.6)
    if os.environ.get('LOGICO'):
        esc.render.resolution_percentage = 50       # sale directo a 96x48 por celda, 4 veces menos píxeles
    if not os.environ.get('SIN_SUELO'):
        C.sombra_suelo(fw, fh)
    C.ambiente(**p['ambiente'])
    C.sol(**p['sol'])
    ruta = os.path.join(salida, f'{PREFIJO[nacion]}{nombre}{os.environ.get("SUFIJO", "")}.png')
    C.renderizar(esc, ruta)
    return C.guardar(f'{PREFIJO[nacion]}{nombre}{os.environ.get("SUFIJO", "")}', fw, fh, ruta, salida)


def exportar(salida, nacion):
    """Pasa los sprites lógicos a webp del cliente y suma sus medidas a meta.json (formato de `meta.json -> buildings`)."""
    from PIL import Image
    raiz = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
    A = os.path.join(raiz, 'apps', 'client', 'public', 'assets')
    mp = os.path.join(A, 'meta.json')
    meta = json.load(open(mp, encoding='utf8'))
    meta.setdefault('buildings', {})
    n = 0
    for nombre in EDIFICIOS:
        pid = f'{PREFIJO[nacion]}{nombre}'
        j, im = os.path.join(salida, f'{pid}.json'), os.path.join(salida, f'{pid}_1x.png')
        if not (os.path.exists(j) and os.path.exists(im)):
            continue
        Image.open(im).save(os.path.join(A, f'{pid}.webp'), 'WEBP', quality=92, method=6)
        meta['buildings'][pid] = json.load(open(j))
        n += 1
    json.dump(meta, open(mp, 'w', encoding='utf8'), separators=(',', ':'), ensure_ascii=False)
    print(f'exportados {n} edificios de {nacion}')


if __name__ == '__main__':
    if sys.argv[1] == '--exportar':
        exportar(sys.argv[2], sys.argv[3])
    else:
        salida, nacion = sys.argv[1], sys.argv[2]
        os.makedirs(salida, exist_ok=True)
        nombres = sys.argv[3:] or list(EDIFICIOS)
        for nombre in nombres:
            if os.environ.get('SALTEAR') and os.path.exists(os.path.join(salida, f'{PREFIJO[nacion]}{nombre}.json')):
                continue
            print(nacion, nombre, hacer(nacion, nombre, salida), flush=True)
