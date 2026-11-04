"""
Generador de edificios de ciudad para ERIS: modelo 3D -> PNG isométrico con la misma grilla que el cliente.

Convenciones (las mismas que tools/src/town/render.ts):
  - Coordenadas de juego (gx, gy, gz): x crece hacia abajo-derecha de la pantalla, y hacia abajo-izquierda, z hacia arriba.
    En Blender eso es (x, -y, z). Todas las funciones de este archivo reciben coordenadas de JUEGO.
  - La celda mide 96x48 lógicos. Se renderiza en HD (192x96 por celda) y se baja a la mitad para el cliente actual.
  - El PNG mide (fw+fh)*96 de ancho en HD. El ancla es la esquina SUR de la huella (abajo del PNG), en x = fw*96.
    El .json guarda la medida lógica (la mitad): {w, h, ax, ay, fw, fh}, el mismo formato que `meta.json -> buildings`.
  - Cámara ortográfica con elevación de 30°: es lo que da una celda de 2:1 EXACTO (ancho/alto = 1/sin(elev)).
    Con 26,565° (= atan(1/2), que es el ángulo de las líneas en pantalla, no el de la cámara) el rombo sale 2,238:1.
    Esa confusión está en iso3d/render.py y su README; verificado midiendo el rombo renderizado (ver verificar_ancla).

Uso:  python3 -I tools/src/iso3d/city.py <salida_dir> [nombre_edificio ...]
Requiere:  pip install bpy pillow numpy
"""
import bpy, bmesh, math, json, os, sys
import numpy as np
from mathutils import Vector

ELEV = math.radians(30)
CELDA_HD = 192.0                       # ancho de una celda en px (HD)
PXU = CELDA_HD / math.sqrt(2)          # px por unidad de mundo; 1 unidad = 1 lado de celda
Z_PX = math.cos(ELEV) * PXU            # px de pantalla por unidad de altura


# ------------------------------------------------------------------ escena
def escena_limpia(motor='CYCLES', muestras=48):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    esc = bpy.context.scene
    esc.render.engine = motor
    esc.render.film_transparent = True
    esc.render.image_settings.file_format = 'PNG'
    esc.render.image_settings.color_mode = 'RGBA'
    esc.view_settings.view_transform = 'Standard'
    if motor == 'CYCLES':
        esc.cycles.device = 'CPU'
        esc.cycles.samples = muestras
        esc.cycles.use_denoising = True
        esc.cycles.max_bounces = 4
    else:
        esc.display.shading.light = 'FLAT'
        esc.display.shading.color_type = 'SINGLE'
    return esc


def camara(esc, fw, fh, zmax):
    """Cámara ortográfica 2:1 con la esquina sur de la huella en (fw*96, abajo del PNG)."""
    W = int((fw + fh) * 96)
    H = int(math.ceil((fw + fh) * 48 + zmax * Z_PX)) + 6
    esc.render.resolution_x, esc.render.resolution_y, esc.render.resolution_percentage = W, H, 100
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.collection.objects.link(cam)
    esc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.ortho_scale = W / PXU
    cam.data.clip_start, cam.data.clip_end = 0.1, 200
    cam.rotation_euler = (math.pi / 2 - ELEV, 0, math.radians(45))   # mira hacia (-x, +y) de Blender, es decir hacia +x+y... ver doc
    bpy.context.view_layer.update()
    m = cam.matrix_world.to_3x3()
    r, u, back = m @ Vector((1, 0, 0)), m @ Vector((0, 1, 0)), m @ Vector((0, 0, 1))
    S = Vector((fw, -fh, 0))                                   # esquina sur de la huella
    dx = fw * 96 - W / 2
    T = S - (dx / PXU) * r + (H / 2 / PXU) * u                 # punto del mundo que cae en el centro del PNG
    cam.location = T + back * 60
    return W, H


def sol(energia=4.0, color=(1.0, 0.95, 0.85), dir_hacia_sol=(-0.2, -0.8, 1.0), suave=0.08):
    """Luz principal desde la izquierda de la pantalla (cara izquierda iluminada, derecha en sombra), como Flare."""
    bpy.ops.object.light_add(type='SUN')
    s = bpy.context.object
    s.data.energy, s.data.color, s.data.angle = energia, color, suave
    d = Vector(dir_hacia_sol).normalized()
    s.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return s


def ambiente(color=(0.55, 0.62, 0.75), fuerza=0.9):
    mundo = bpy.data.worlds.new('mundo')
    mundo.use_nodes = True
    bg = mundo.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = fuerza
    bpy.context.scene.world = mundo


# ------------------------------------------------------------------ materiales
def _nodo(nt, tipo, **kw):
    n = nt.nodes.new(tipo)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def material(nombre, base, base2=None, rugosidad=0.85, textura='plano', escala=4.0, nieve=False, emision=None):
    """Material procedural. textura: 'plano' | 'piedra' (bloques) | 'tablas' | 'tejas' | 'adoquin'.
    nieve=True mezcla blanco en las caras que miran hacia arriba (techos, bordes), con borde irregular."""
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    salida = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    pr = _nodo(nt, 'ShaderNodeBsdfPrincipled')
    pr.inputs['Roughness'].default_value = rugosidad
    coord = _nodo(nt, 'ShaderNodeTexCoord')
    b2 = base2 or tuple(max(0, c * 0.7) for c in base)
    color = None

    if textura == 'piedra':
        # bloques: celdas más anchas que altas (se achata la z), con junta fina
        mp = _nodo(nt, 'ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0, 1.0, 2.6)
        nt.links.new(coord.outputs['Object'], mp.inputs['Vector'])
        vo = _nodo(nt, 'ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1')
        vo.inputs['Scale'].default_value = escala
        ed = _nodo(nt, 'ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='DISTANCE_TO_EDGE')
        ed.inputs['Scale'].default_value = escala
        nt.links.new(mp.outputs['Vector'], vo.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], ed.inputs['Vector'])
        sep = _nodo(nt, 'ShaderNodeSeparateColor')
        nt.links.new(vo.outputs['Color'], sep.inputs['Color'])
        mix = _nodo(nt, 'ShaderNodeMix', data_type='RGBA')
        mix.inputs['A'].default_value = (*b2, 1)
        mix.inputs['B'].default_value = (*base, 1)
        nt.links.new(sep.outputs['Red'], mix.inputs['Factor'])
        junta = _nodo(nt, 'ShaderNodeMapRange')
        junta.inputs['From Min'].default_value, junta.inputs['From Max'].default_value = 0.0, 0.045
        nt.links.new(ed.outputs['Distance'], junta.inputs['Value'])
        osc = _nodo(nt, 'ShaderNodeMix', data_type='RGBA')
        osc.inputs['A'].default_value = (0.06, 0.055, 0.05, 1)
        nt.links.new(junta.outputs['Result'], osc.inputs['Factor'])
        nt.links.new(mix.outputs['Result'], osc.inputs['B'])
        color = osc.outputs['Result']
    elif textura in ('tablas', 'tejas'):
        w = _nodo(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', wave_profile='SAW' if textura == 'tejas' else 'SIN')
        w.inputs['Scale'].default_value = escala
        w.inputs['Distortion'].default_value = 1.2 if textura == 'tablas' else 0.6
        w.inputs['Detail'].default_value = 3
        nt.links.new(coord.outputs['Object'], w.inputs['Vector'])
        mix = _nodo(nt, 'ShaderNodeMix', data_type='RGBA')
        mix.inputs['A'].default_value = (*b2, 1)
        mix.inputs['B'].default_value = (*base, 1)
        nt.links.new(w.outputs['Fac'], mix.inputs['Factor'])
        color = mix.outputs['Result']
    elif textura == 'adoquin':
        vo = _nodo(nt, 'ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1')
        vo.inputs['Scale'].default_value = escala
        ed = _nodo(nt, 'ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='DISTANCE_TO_EDGE')
        ed.inputs['Scale'].default_value = escala
        nt.links.new(coord.outputs['Object'], vo.inputs['Vector'])
        nt.links.new(coord.outputs['Object'], ed.inputs['Vector'])
        sep = _nodo(nt, 'ShaderNodeSeparateColor')
        nt.links.new(vo.outputs['Color'], sep.inputs['Color'])
        mix = _nodo(nt, 'ShaderNodeMix', data_type='RGBA')
        mix.inputs['A'].default_value = (*b2, 1)
        mix.inputs['B'].default_value = (*base, 1)
        nt.links.new(sep.outputs['Red'], mix.inputs['Factor'])
        color = mix.outputs['Result']
    else:
        ru = _nodo(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
        ru.inputs['Scale'].default_value = 6.0
        ru.inputs['Detail'].default_value = 6.0
        nt.links.new(coord.outputs['Object'], ru.inputs['Vector'])
        mix = _nodo(nt, 'ShaderNodeMix', data_type='RGBA')
        mix.inputs['A'].default_value = (*b2, 1)
        mix.inputs['B'].default_value = (*base, 1)
        mix.inputs['Factor'].default_value = 0.5
        nt.links.new(ru.outputs['Fac'], mix.inputs['Factor'])
        color = mix.outputs['Result']

    if nieve:
        geo = _nodo(nt, 'ShaderNodeNewGeometry')
        sepn = _nodo(nt, 'ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Normal'], sepn.inputs['Vector'])
        ruido = _nodo(nt, 'ShaderNodeTexNoise', noise_dimensions='3D')
        ruido.inputs['Scale'].default_value = 9.0
        nt.links.new(coord.outputs['Object'], ruido.inputs['Vector'])
        suma = _nodo(nt, 'ShaderNodeMath', operation='ADD')
        nt.links.new(sepn.outputs['Z'], suma.inputs[0])
        sr = _nodo(nt, 'ShaderNodeMath', operation='MULTIPLY')
        sr.inputs[1].default_value = 0.25
        nt.links.new(ruido.outputs['Fac'], sr.inputs[0])
        nt.links.new(sr.outputs['Value'], suma.inputs[1])
        umbral = _nodo(nt, 'ShaderNodeMapRange')
        umbral.inputs['From Min'].default_value, umbral.inputs['From Max'].default_value = 0.93, 1.03
        nt.links.new(suma.outputs['Value'], umbral.inputs['Value'])
        mn = _nodo(nt, 'ShaderNodeMix', data_type='RGBA')
        mn.inputs['B'].default_value = (0.92, 0.95, 1.0, 1)
        nt.links.new(umbral.outputs['Result'], mn.inputs['Factor'])
        nt.links.new(color, mn.inputs['A'])
        color = mn.outputs['Result']

    nt.links.new(color, pr.inputs['Base Color'])
    if emision:
        pr.inputs['Emission Color'].default_value = (*emision[:3], 1)
        pr.inputs['Emission Strength'].default_value = emision[3]
    nt.links.new(pr.outputs['BSDF'], salida.inputs['Surface'])
    return m


# ------------------------------------------------------------------ geometría (coordenadas de juego)
def _objeto(nombre, verts, caras, mat):
    me = bpy.data.meshes.new(nombre)
    me.from_pydata([(x, -y, z) for x, y, z in verts], [], caras)
    me.update()
    ob = bpy.data.objects.new(nombre, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = False
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    return ob


def caja(x0, y0, x1, y1, z0, z1, mat, nombre='caja'):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _objeto(nombre, v, f, mat)


def techo_dos_aguas(x0, y0, x1, y1, z0, alto, mat, cumbrera='x', alero=0.18, nombre='techo'):
    """Techo a dos aguas. cumbrera='x': la cumbrera corre a lo largo de x. Con alero que sobresale."""
    a = alero
    X0, Y0, X1, Y1 = x0 - a, y0 - a, x1 + a, y1 + a
    if cumbrera == 'x':
        ym = (Y0 + Y1) / 2
        v = [(X0, Y0, z0), (X1, Y0, z0), (X1, Y1, z0), (X0, Y1, z0), (X0, ym, z0 + alto), (X1, ym, z0 + alto)]
        f = [(0, 1, 5, 4), (3, 4, 5, 2), (0, 4, 3), (1, 2, 5)]
    else:
        xm = (X0 + X1) / 2
        v = [(X0, Y0, z0), (X1, Y0, z0), (X1, Y1, z0), (X0, Y1, z0), (xm, Y0, z0 + alto), (xm, Y1, z0 + alto)]
        f = [(0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (3, 5, 2)]
    return _objeto(nombre, v, f, mat)


def techo_piramide(x0, y0, x1, y1, z0, alto, mat, alero=0.18, nombre='techo'):
    a = alero
    X0, Y0, X1, Y1 = x0 - a, y0 - a, x1 + a, y1 + a
    c = ((X0 + X1) / 2, (Y0 + Y1) / 2, z0 + alto)
    v = [(X0, Y0, z0), (X1, Y0, z0), (X1, Y1, z0), (X0, Y1, z0), c]
    f = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
    return _objeto(nombre, v, f, mat)


def sombra_suelo(fw, fh):
    """Plano que solo recibe la sombra del edificio (sale como sombra translúcida sobre el PNG transparente)."""
    ob = caja(0, 0, fw, fh, -0.02, 0, bpy.data.materials.new('sombra'), 'suelo')
    ob.is_shadow_catcher = True
    return ob


# ------------------------------------------------------------------ render y salida
def renderizar(esc, ruta):
    esc.render.filepath = ruta
    bpy.ops.render.render(write_still=True)


def guardar(nombre, fw, fh, hd_png, salida):
    """Deja <nombre>.png (HD), <nombre>_1x.png (lógico, mitad) y <nombre>.json con el formato de meta.json->buildings."""
    from PIL import Image
    im = Image.open(hd_png)
    W, H = im.size
    if os.environ.get('LOGICO'):          # ya se renderizó a la resolución del cliente (resolution_percentage = 50)
        im.save(os.path.join(salida, f'{nombre}_1x.png'))
        meta = {'w': W, 'h': H, 'ax': fw * 48, 'ay': H, 'fw': fw, 'fh': fh}
    else:
        lg = im.resize((W // 2, H // 2), Image.LANCZOS)
        lg.save(os.path.join(salida, f'{nombre}_1x.png'))
        meta = {'w': W // 2, 'h': H // 2, 'ax': fw * 48, 'ay': H // 2, 'fw': fw, 'fh': fh}
    json.dump(meta, open(os.path.join(salida, f'{nombre}.json'), 'w'))
    return meta


def verificar_ancla(fw, fh, zmax=2.0):
    """Renderiza una losa plana que cubre exactamente la huella y comprueba por píxeles que el rombo toca los bordes del PNG
    donde el formato lo promete: izquierda x=0, derecha x=W-1, esquina sur en (fw*96, H-1): el ancla está en la última fila,
    el margen de 6 px queda arriba."""
    esc = escena_limpia('BLENDER_WORKBENCH')
    caja(0, 0, fw, fh, 0, 0.001, bpy.data.materials.new('m'), 'losa')
    W, H = camara(esc, fw, fh, zmax)
    esc.display.shading.single_color = (1, 1, 1)
    ruta = '/tmp/ancla.png'
    renderizar(esc, ruta)
    img = bpy.data.images.load(ruta)
    px = np.array(img.pixels[:]).reshape(H, W, 4)[::-1]            # fila 0 arriba
    ys, xs = np.nonzero(px[:, :, 3] > 0.5)
    sur_y = ys.max()
    sur_x = int(np.mean(xs[ys == sur_y]))
    ok = abs(xs.min() - 0) <= 1 and abs(xs.max() - (W - 1)) <= 1 and abs(sur_x - fw * 96) <= 2 and abs(sur_y - (H - 1)) <= 2
    print(f'ancla {fw}x{fh}: izq={xs.min()} der={xs.max()} (W={W}) sur=({sur_x},{sur_y}) esperado=({fw*96},{H-1}) ancho/alto del rombo={(xs.max()-xs.min()+1)/(ys.max()-ys.min()+1):.3f} -> {"OK" if ok else "MAL"}')
    return ok


if __name__ == '__main__':
    salida = sys.argv[1] if len(sys.argv) > 1 else '/tmp/city_out'
    os.makedirs(salida, exist_ok=True)
    for fw, fh in [(5, 4), (7, 5), (3, 3), (6, 9)]:
        assert verificar_ancla(fw, fh), 'la cámara no calza con la grilla'
