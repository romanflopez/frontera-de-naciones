"""
Piloto C2 del rediseño de ciudades (docs/CIUDADES.md): herrería, casa y tramo de muralla con portón, en las dos naciones.
Todo está armado con cajas y techos simples más materiales procedurales de city.py (arte propio, sin packs).

Uso:  python3 -I tools/src/iso3d/city_piloto.py <salida_dir> [solmar|vhar] [herreria|casa|muralla]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import city as C

# ------------------------------------------------------------------ paletas por nación
def paleta(nacion):
    m = C.material
    if nacion == 'solmar':
        return dict(
            zocalo=m('zocalo', (0.62, 0.52, 0.38), (0.45, 0.37, 0.27), textura='piedra', escala=2.6),
            piedra=m('piedra', (0.66, 0.58, 0.44), (0.5, 0.42, 0.31), textura='piedra', escala=2.0),
            muro=m('muro', (0.70, 0.60, 0.44), (0.60, 0.50, 0.36), textura='plano', rugosidad=0.95),
            techo=m('techo', (0.44, 0.14, 0.09), (0.30, 0.09, 0.06), textura='tejas', escala=7.0),
            madera=m('madera', (0.42, 0.27, 0.14), (0.30, 0.18, 0.09), textura='tablas', escala=9.0),
            metal=m('metal', (0.55, 0.38, 0.16), None, rugosidad=0.4),
            oscuro=m('oscuro', (0.06, 0.045, 0.04), None, rugosidad=1.0),
            vidrio=m('vidrio', (0.12, 0.2, 0.28), None, rugosidad=0.2),
            tela=m('tela', (0.12, 0.30, 0.62), (0.85, 0.7, 0.25), textura='tablas', escala=6.0),
            luz=None,
            ambiente=dict(color=(0.62, 0.68, 0.80), fuerza=0.75),
            sol=dict(energia=2.9, color=(1.0, 0.94, 0.82)),
        )
    return dict(
        zocalo=m('zocalo', (0.22, 0.23, 0.27), (0.13, 0.14, 0.17), textura='piedra', escala=3.2, nieve=True),
        piedra=m('piedra', (0.34, 0.32, 0.34), (0.26, 0.24, 0.27), textura='piedra', escala=2.0),
        muro=m('muro', (0.34, 0.32, 0.34), (0.26, 0.24, 0.27), textura='piedra', escala=2.0),
        techo=m('techo', (0.13, 0.14, 0.19), (0.08, 0.09, 0.12), textura='tejas', escala=7.0, nieve=True),
        madera=m('madera', (0.19, 0.12, 0.08), (0.11, 0.07, 0.05), textura='tablas', escala=9.0),
        metal=m('metal', (0.10, 0.10, 0.12), None, rugosidad=0.35),
        oscuro=m('oscuro', (0.03, 0.025, 0.03), None, rugosidad=1.0),
        vidrio=m('vidrio', (0.35, 0.12, 0.03), None, rugosidad=0.3, emision=(1.0, 0.42, 0.08, 1.6)),
        tela=m('tela', (0.55, 0.05, 0.05), (0.08, 0.08, 0.08), textura='tablas', escala=6.0),
        luz=(1.0, 0.55, 0.2),
        ambiente=dict(color=(0.55, 0.68, 0.95), fuerza=0.85),
        sol=dict(energia=2.6, color=(0.82, 0.90, 1.0)),
    )


def ventana(p, cara, pos, z0=0.95, z1=1.55, ancho=0.4, borde=0.06):
    """Ventana pegada a una cara visible: cara '+y' (pared izquierda en pantalla) o '+x' (pared derecha)."""
    x1, y1 = p['_x1'], p['_y1']
    if cara == '+y':
        C.caja(pos - ancho / 2 - borde, y1 - 0.01, pos + ancho / 2 + borde, y1 + 0.07, z0 - borde, z1 + borde, p['madera'], 'marco')
        C.caja(pos - ancho / 2, y1 + 0.05, pos + ancho / 2, y1 + 0.09, z0, z1, p['vidrio'], 'vidrio')
    else:
        C.caja(x1 - 0.01, pos - ancho / 2 - borde, x1 + 0.07, pos + ancho / 2 + borde, z0 - borde, z1 + borde, p['madera'], 'marco')
        C.caja(x1 + 0.05, pos - ancho / 2, x1 + 0.09, pos + ancho / 2, z0, z1, p['vidrio'], 'vidrio')


def puerta(p, cara, pos, ancho=0.9, alto=1.5):
    x1, y1 = p['_x1'], p['_y1']
    if cara == '+y':
        C.caja(pos - ancho / 2 - 0.1, y1 - 0.01, pos + ancho / 2 + 0.1, y1 + 0.1, 0, alto + 0.1, p['madera'], 'marco_puerta')
        C.caja(pos - ancho / 2, y1 + 0.08, pos + ancho / 2, y1 + 0.13, 0, alto, p['oscuro'], 'puerta')
    else:
        C.caja(x1 - 0.01, pos - ancho / 2 - 0.1, x1 + 0.1, pos + ancho / 2 + 0.1, 0, alto + 0.1, p['madera'], 'marco_puerta')
        C.caja(x1 + 0.08, pos - ancho / 2, x1 + 0.13, pos + ancho / 2, 0, alto, p['oscuro'], 'puerta')


# ------------------------------------------------------------------ edificios
def herreria(p, fw=7, fh=5):
    x0, y0, x1, y1 = 0.45, 0.45, fw - 0.45, fh - 0.45
    p['_x1'], p['_y1'] = x1, y1
    h_muro = 1.9
    C.caja(x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, 0, 0.55, p['zocalo'], 'zocalo')
    C.caja(x0, y0, x1, y1, 0.55, h_muro, p['muro'], 'muro')
    C.techo_dos_aguas(x0, y0, x1, y1, h_muro, 1.35, p['techo'], cumbrera='x', alero=0.28)
    # chimenea de piedra al fondo (lejos de cámara) y fragua abierta en la cara +x
    C.caja(1.2, 1.0, 1.8, 1.6, h_muro, h_muro + 1.9, p['zocalo'], 'chimenea')
    C.caja(1.16, 0.96, 1.84, 1.64, h_muro + 1.9, h_muro + 2.05, p['zocalo'], 'remate')
    C.caja(x1 - 0.02, 1.2, x1 + 0.7, 3.8, 0, 0.9, p['zocalo'], 'fragua')           # cuerpo de la fragua pegado a la pared
    C.caja(x1 + 0.12, 1.5, x1 + 0.62, 3.5, 0.9, 1.0, p['oscuro'], 'brasas')
    C.caja(x1 + 0.3, 1.5, x1 + 0.4, 3.5, 1.0, 1.0, p['oscuro'], 'x')
    # puerta grande y ventanas en la cara +y (la que mira a la calle)
    puerta(p, '+y', 3.5, ancho=1.3, alto=1.6)
    ventana(p, '+y', 1.6); ventana(p, '+y', 5.4)
    ventana(p, '+x', 4.1, z0=1.1, z1=1.6)
    # yunque, barril y toldo de la entrada
    C.caja(2.0, y1 + 0.15, 2.5, y1 + 0.5, 0.35, 0.6, p['metal'], 'yunque')
    C.caja(2.05, y1 + 0.2, 2.45, y1 + 0.45, 0, 0.35, p['madera'], 'tocon')
    C.caja(4.6, y1 + 0.12, 5.1, y1 + 0.55, 0, 0.7, p['madera'], 'barril')
    C.caja(2.6, y1 + 0.1, 4.4, y1 + 0.5, 1.9, 1.95, p['tela'], 'toldo')
    return 2.6


def casa(p, fw=4, fh=3):
    x0, y0, x1, y1 = 0.3, 0.3, fw - 0.3, fh - 0.3
    p['_x1'], p['_y1'] = x1, y1
    h_muro = 1.95
    C.caja(x0 - 0.06, y0 - 0.06, x1 + 0.06, y1 + 0.06, 0, 0.4, p['zocalo'], 'zocalo')
    C.caja(x0, y0, x1, y1, 0.4, h_muro, p['muro'], 'muro')
    C.techo_dos_aguas(x0, y0, x1, y1, h_muro, 0.95, p['techo'], cumbrera='y', alero=0.24)
    puerta(p, '+y', 1.2, ancho=0.7, alto=1.45)
    ventana(p, '+y', 2.6, z0=1.0, z1=1.55)
    ventana(p, '+x', 1.5, z0=1.0, z1=1.55)
    return 2.9


def muralla(p, fw=6, fh=2):
    """Tramo de muralla de 6 celdas con portón al centro. La pared corre a lo largo de x; el paso va a lo largo de y."""
    y0, y1 = 0.3, fh - 0.3
    p['_x1'], p['_y1'] = fw, y1
    alto, gx0, gx1 = 2.8, 2.2, 3.8
    for a, b in ((0, gx0), (gx1, fw)):
        C.caja(a, y0, b, y1, 0, alto, p['piedra'], 'lienzo')
        n = int((b - a) / 0.7)
        for i in range(n):
            if i % 2 == 0:
                C.caja(a + i * 0.7 + 0.05, y0, a + i * 0.7 + 0.55, y1, alto, alto + 0.32, p['piedra'], 'merlon')
    C.caja(gx0 - 0.1, y0 - 0.05, gx1 + 0.1, y1 + 0.05, 2.0, alto + 0.25, p['zocalo'], 'dintel')        # dintel sobre el portón
    C.caja(gx0, y0 + 0.25, gx1, y0 + 0.4, 0, 2.0, p['oscuro'], 'hoja')                              # hoja del portón, al fondo del paso
    C.caja(gx0, y1 - 0.3, gx0 + 0.12, y1 - 0.18, 0, 2.0, p['madera'], 'marco_i')
    C.caja(gx1 - 0.12, y1 - 0.3, gx1, y1 - 0.18, 0, 2.0, p['madera'], 'marco_d')
    # estandarte colgado del dintel
    C.caja(2.85, y1 + 0.02, 3.15, y1 + 0.06, 1.0, 1.9, p['tela'], 'estandarte')
    return 3.3


PILOTO = {'herreria': (herreria, 7, 5), 'casa': (casa, 4, 3), 'muralla': (muralla, 6, 2)}


def hacer(nacion, nombre, salida, muestras=48):
    fn, fw, fh = PILOTO[nombre]
    esc = C.escena_limpia('CYCLES', muestras)
    p = paleta(nacion)
    zmax = fn(p, fw, fh)
    W, H = C.camara(esc, fw, fh, zmax + 0.6)
    C.sombra_suelo(fw, fh)
    C.ambiente(**p['ambiente'])
    C.sol(**p['sol'])
    ruta = os.path.join(salida, f'{nacion}_{nombre}.png')
    C.renderizar(esc, ruta)
    return C.guardar(f'{nacion}_{nombre}', fw, fh, ruta, salida)


if __name__ == '__main__':
    salida = sys.argv[1]
    os.makedirs(salida, exist_ok=True)
    naciones = [sys.argv[2]] if len(sys.argv) > 2 else ['solmar', 'vhar']
    nombres = [sys.argv[3]] if len(sys.argv) > 3 else list(PILOTO)
    for n in naciones:
        for b in nombres:
            print(n, b, hacer(n, b, salida))
