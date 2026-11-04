# Mobs propios desde 3D (sin comprar packs)

`render.py` genera un spritesheet isométrico de **8 direcciones** a partir de un modelo 3D animado, con el mismo layout que
`tools/src/flare/atlas.ts` (fila = animación × 8 + dirección, columna = cuadro). Es el método con el que están hechos los bichos
de Flare y los packs comerciales de personajes; lo que se compra en esos packs son los **modelos**, no la técnica.

## Lo que hay que acertar sí o sí

La proyección de ERIS es **2:1** (el tile mide 192×96). Con cámara **ortográfica** el rombo de una celda mide ancho/alto = 1/sin(elevación),
así que la elevación tiene que ser de **30°** (medido renderizando un rombo: 26,565° da 2,238:1 y 30° da 2,000:1). Los 26,565° = `atan(1/2)`
son el ángulo de las *líneas* en pantalla, no el de la cámara; ese era el error de la versión anterior de este archivo. El modelo rota 45° por dirección.
Para edificios y otras piezas con huella en la grilla, ver `city.py` (misma cámara, con el ancla verificada).

## Cómo usarlo

```
pip install bpy          # Blender como módulo de Python, no hace falta instalar Blender aparte
python3 tools/src/iso3d/render.py
```

Tal cual está, renderiza un muñeco de cubos de prueba. Para un mob de verdad:

1. Conseguir un modelo **animado** con licencia clara. Gratis y CC0: Quaternius (tiene packs de monstruos ya animados),
   Kenney, Kay Lousberg. Para humanoides, Mixamo (de Adobe) da cientos de animaciones gratis sobre cualquier modelo riggeado.
2. Importarlo con `bpy.ops.import_scene.gltf(filepath=...)` en vez del muñeco de cubos.
3. Listar sus acciones en `ANIMS` con la cantidad de cuadros de cada una.
4. Ajustar `cam.data.ortho_scale` hasta que el bicho ocupe lo que tiene que ocupar en la celda de 128 px.

## Por qué conviene

- **Licencia limpia:** con modelos CC0 no hay nada que pedir ni que anotar, que es justo lo que nos complicó con los packs
  comprados (ver `docs/LICENCIAS_AUDITORIA.md`).
- **Cualquier criatura:** no estamos limitados a humanoides bípedos como en el Character Creator.
- **La resolución que queramos:** el render sale a cualquier tamaño, así que el pase a HD no obliga a rehacer nada.
- **Estilo consistente:** mismo setup de cámara y luz para todos los mobs.

## Lo que no resuelve

El cuello de botella pasa a ser el **modelo**, no la herramienta. Un modelo CC0 animado se ve como se ve; si no hay uno que sirva
para lo que querés, hay que modelar y animar, que es otro oficio. Para humanoides, Mixamo tapa casi todo el hueco.
