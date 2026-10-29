/**
 * Escritor del formato .spr que lee el cliente (ver apps/client/src/game/assets/HBSprite.ts).
 *
 * Estructura (little endian):
 *   int16  cantidad de hojas
 *   por hoja: int16 frames, int32 largo del PNG, int32 ancho, int32 alto, byte reservado,
 *             y por frame: int16 x, y, ancho, alto, pivotX, pivotY
 *   por hoja: int32 reservado + bytes del PNG
 *
 * El pivote es el desplazamiento desde el punto de apoyo (los pies) hasta la esquina
 * superior izquierda del frame, así que normalmente es negativo.
 */

export interface SprFrame {
    x: number;
    y: number;
    width: number;
    height: number;
    pivotX: number;
    pivotY: number;
}

export interface SprSheet {
    png: Uint8Array;
    width: number;
    height: number;
    frames: SprFrame[];
}

export function encodeSpr(sheets: SprSheet[]): Uint8Array {
    if (sheets.length > 0x7fff) throw new Error('Demasiadas hojas para un .spr');
    let size = 2;
    for (const s of sheets) size += 2 + 4 + 4 + 4 + 1 + s.frames.length * 12 + 4 + s.png.length;

    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let o = 0;
    view.setInt16(o, sheets.length, true); o += 2;

    for (const s of sheets) {
        if (s.frames.length > 0x7fff) throw new Error('Demasiados frames en una hoja');
        view.setInt16(o, s.frames.length, true); o += 2;
        view.setInt32(o, s.png.length, true); o += 4;
        view.setInt32(o, s.width, true); o += 4;
        view.setInt32(o, s.height, true); o += 4;
        view.setUint8(o, 0); o += 1;
        for (const f of s.frames) {
            view.setInt16(o, f.x, true); o += 2;
            view.setInt16(o, f.y, true); o += 2;
            view.setInt16(o, f.width, true); o += 2;
            view.setInt16(o, f.height, true); o += 2;
            view.setInt16(o, f.pivotX, true); o += 2;
            view.setInt16(o, f.pivotY, true); o += 2;
        }
    }

    for (const s of sheets) {
        view.setInt32(o, 0, true); o += 4;
        out.set(s.png, o); o += s.png.length;
    }
    return out;
}

/** Lector mínimo, para verificar lo que escribimos. */
export function decodeSprHeader(buf: Uint8Array): { sheets: { frames: SprFrame[]; pngLength: number }[] } {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 0;
    const count = view.getInt16(o, true); o += 2;
    const sheets: { frames: SprFrame[]; pngLength: number }[] = [];
    for (let i = 0; i < count; i++) {
        const n = view.getInt16(o, true); o += 2;
        const pngLength = view.getInt32(o, true); o += 4;
        o += 9;
        const frames: SprFrame[] = [];
        for (let f = 0; f < n; f++) {
            frames.push({
                x: view.getInt16(o, true), y: view.getInt16(o + 2, true),
                width: view.getInt16(o + 4, true), height: view.getInt16(o + 6, true),
                pivotX: view.getInt16(o + 8, true), pivotY: view.getInt16(o + 10, true),
            });
            o += 12;
        }
        sheets.push({ frames, pngLength });
    }
    return { sheets };
}
