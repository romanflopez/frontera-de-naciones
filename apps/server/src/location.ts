/**
 * Utilidades de grilla. Port de Helpers/Location.cs.
 * Direcciones: 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SO, 6 O, 7 NO (igual que el cliente).
 */

/** Distancia de Chebyshev (cantidad de pasos en 8 direcciones). */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

/** Busca la celda libre más cercana recorriendo anillos alrededor del punto de inicio. */
export function findNearestFreeLocation(isFree: (x: number, y: number) => boolean, startX: number, startY: number, maxRadius = 50): { x: number; y: number } | null {
    if (isFree(startX, startY)) return { x: startX, y: startY };
    for (let r = 1; r <= maxRadius; r++) {
        for (let x = startX - r; x <= startX + r; x++) if (isFree(x, startY - r)) return { x, y: startY - r };
        for (let y = startY - r + 1; y <= startY + r; y++) if (isFree(startX + r, y)) return { x: startX + r, y };
        for (let x = startX + r - 1; x >= startX - r; x--) if (isFree(x, startY + r)) return { x, y: startY + r };
        for (let y = startY + r - 1; y >= startY - r + 1; y--) if (isFree(startX - r, y)) return { x: startX - r, y };
    }
    return null;
}

/** Las dos celdas a 45° del paso pedido, para la corrección de rumbo cuando el destino está ocupado. */
export function adjacentCellsAt45(curX: number, curY: number, destX: number, destY: number): [number, number, number, number] {
    const dx = Math.sign(destX - curX), dy = Math.sign(destY - curY);
    switch (`${dx},${dy}`) {
        case '1,0': return [curX + 1, curY - 1, curX + 1, curY + 1];
        case '-1,0': return [curX - 1, curY + 1, curX - 1, curY - 1];
        case '0,1': return [curX - 1, curY + 1, curX + 1, curY + 1];
        case '0,-1': return [curX + 1, curY - 1, curX - 1, curY - 1];
        case '1,-1': return [curX, curY - 1, curX + 1, curY];
        case '1,1': return [curX + 1, curY, curX, curY + 1];
        case '-1,1': return [curX, curY + 1, curX - 1, curY];
        case '-1,-1': return [curX - 1, curY, curX, curY - 1];
        default: throw new Error('El destino tiene que ser distinto de la celda actual.');
    }
}

/** Dirección de un paso de grilla, o -1 si origen y destino son la misma celda. */
export function nextGridDirection(sx: number, sy: number, dx: number, dy: number): number {
    const x = sx - dx, y = sy - dy;
    if (x === 0 && y === 0) return -1;
    if (x === 0) return y > 0 ? 0 : 4;
    if (y === 0) return x > 0 ? 6 : 2;
    if (x > 0 && y > 0) return 7;
    if (x < 0 && y > 0) return 1;
    if (x > 0 && y < 0) return 5;
    return 3;
}
