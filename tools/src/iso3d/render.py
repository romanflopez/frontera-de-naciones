"""
Generador de spritesheets isométricos de 8 direcciones a partir de un modelo 3D. Es el mismo método con el que se hicieron los
bichos de Flare y los packs comerciales de personajes: no hace falta comprar un "character creator", hace falta un modelo animado.
Es el mismo método con el que se hicieron los bichos de Flare y los packs de SmallScaleInt.

Clave para que calce con ERIS: la proyección del juego es 2:1 (tile 192x96). Con cámara ortográfica el rombo de una celda mide
ancho/alto = 1/sin(elevación), así que 2:1 exacto pide elevación de 30° (medido: 26,565° da 2,238:1 y 30° da 2,000:1; los 26,565°
= atan(1/2) son el ángulo de las LÍNEAS en pantalla, no el de la cámara). El modelo rota 45° por dirección.
El spritesheet sale con el mismo layout que usa tools/src/flare/atlas.ts: fila = animación*8 + dirección, columna = cuadro.
"""
import bpy, math, os
from mathutils import Vector

SALIDA = '/home/claude/render_iso'
CELDA = 128
DIRS = 8
os.makedirs(SALIDA, exist_ok=True)

# ---------- escena limpia ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
esc = bpy.context.scene
esc.render.engine = 'BLENDER_WORKBENCH'
esc.render.resolution_x = CELDA
esc.render.resolution_y = CELDA
esc.render.film_transparent = True
esc.render.image_settings.file_format = 'PNG'
esc.render.image_settings.color_mode = 'RGBA'
esc.display.shading.light = 'STUDIO'
esc.display.shading.show_shadows = True
esc.display.shading.color_type = 'OBJECT'

# ---------- bicho de prueba ----------
# Esto es un muñeco de cubos armado por código, solo para verificar el pipeline. Para un mob de verdad se reemplaza por
# bpy.ops.import_scene.gltf(filepath=...) con un modelo CC0 ya animado (Quaternius, Kenney, Kay Lousberg) o con uno propio
# animado en Mixamo, y se listan sus acciones en ANIMS en vez de las dos de acá abajo.
raiz = bpy.data.objects.new('raiz', None)
bpy.context.collection.objects.link(raiz)

def pieza(nombre, tam, pos, color, padre):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object
    o.name = nombre
    o.scale = tam
    o.color = (*color, 1)
    o.parent = padre
    return o

PIEDRA = (.42, .40, .38)
PIEDRA_O = (.30, .29, .27)
cuerpo = pieza('cuerpo', (1.1, .8, 1.3), (0, 0, 1.6), PIEDRA, raiz)
cabeza = pieza('cabeza', (.62, .58, .55), (0, 0, 2.55), PIEDRA_O, raiz)
brazoI = pieza('brazoI', (.42, .42, 1.15), (-.95, 0, 1.55), PIEDRA_O, raiz)
brazoD = pieza('brazoD', (.42, .42, 1.15), (.95, 0, 1.55), PIEDRA_O, raiz)
piernaI = pieza('piernaI', (.45, .45, .95), (-.4, 0, .5), PIEDRA, raiz)
piernaD = pieza('piernaD', (.45, .45, .95), (.4, 0, .5), PIEDRA, raiz)

# ---------- animaciones: cuadros clave sobre las piezas ----------
def limpiar():
    for o in (cuerpo, cabeza, brazoI, brazoD, piernaI, piernaD):
        o.animation_data_clear()

def key(o, f, loc=None, rot=None):
    if loc is not None:
        o.location = loc; o.keyframe_insert('location', frame=f)
    if rot is not None:
        o.rotation_euler = rot; o.keyframe_insert('rotation_euler', frame=f)

def anim_idle(n=8):
    """Respiración: el cuerpo sube y baja, los brazos acompañan."""
    limpiar()
    for i, (dz, br) in enumerate([(0, 0), (.07, .09), (0, 0), (-.05, -.07)]):
        f = 1 + i * (n // 4)
        key(cuerpo, f, loc=(0, 0, 1.6 + dz))
        key(cabeza, f, loc=(0, 0, 2.55 + dz * 1.2))
        key(brazoI, f, loc=(-.95, 0, 1.55 + dz), rot=(br, 0, 0))
        key(brazoD, f, loc=(.95, 0, 1.55 + dz), rot=(-br, 0, 0))
    key(cuerpo, n + 1, loc=(0, 0, 1.6))
    return n

def anim_golpe(n=10):
    """Ataque: carga hacia atrás y descarga el brazo derecho hacia adelante."""
    limpiar()
    pasos = [(0, 0, 0), (-.9, .2, -.1), (-1.2, .35, -.15), (1.5, -.3, .25), (.6, -.1, .1), (0, 0, 0)]
    for i, (rb, rc, dz) in enumerate(pasos):
        f = 1 + round(i * (n - 1) / (len(pasos) - 1))
        key(brazoD, f, loc=(.95, 0, 1.55), rot=(rb, 0, 0))
        key(cuerpo, f, loc=(0, 0, 1.6 + dz), rot=(rc, 0, 0))
        key(cabeza, f, loc=(0, 0, 2.55 + dz), rot=(rc, 0, 0))
    return n

# ---------- cámara isométrica 2:1 ----------
ELEV = math.radians(30)          # 30°: da la celda 2:1 exacta de 192x96 (ver tools/src/iso3d/city.py, verificar_ancla)
bpy.ops.object.camera_add()
cam = bpy.context.object
esc.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 5.2       # cuánto mundo entra en la celda de 128 px
d = 14
cam.location = (0, -d * math.cos(ELEV), d * math.sin(ELEV) + 1.4)
cam.rotation_euler = (math.pi / 2 - ELEV, 0, 0)

bpy.ops.object.light_add(type='SUN', location=(4, -6, 10))
bpy.context.object.data.energy = 3

# ---------- render: cada animación, cada dirección, cada cuadro ----------
ANIMS = [('idle', anim_idle), ('golpe', anim_golpe)]
hecho = []
for ai, (nombre, armar) in enumerate(ANIMS):
    n = armar()
    for d8 in range(DIRS):
        raiz.rotation_euler = (0, 0, math.radians(d8 * 45))
        for f in range(1, n + 1):
            esc.frame_set(f)
            esc.render.filepath = f'{SALIDA}/{nombre}_{d8}_{f:02d}.png'
            bpy.ops.render.render(write_still=True)
        hecho.append((nombre, d8, n))
print('RENDER_OK', len(hecho), 'tiras;', ANIMS[0][0], 'y', ANIMS[1][0])
