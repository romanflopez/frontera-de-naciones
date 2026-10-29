/**
 * Mapa: lectura de .amd para saber qué celdas están bloqueadas, y el registro de ocupación
 * (celdas bloqueadas por el mapa + celdas ocupadas por entidades).
 * Port de Map.cs y GameWorldOccupancyTracker.cs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, type WorldLocationConfig } from './config.ts';

const HEADER_SIZE = 256;
const BLOCKED_FLAG = 0x80;

export class Occupancy {
    private readonly occupied: Uint8Array;
    private readonly teleport: Uint8Array;
    private count = 0;

    constructor(readonly sizeX: number, readonly sizeY: number, blocked: Iterable<[number, number]>, teleportCells: Iterable<[number, number]> = []) {
        if (sizeX <= 0 || sizeY <= 0) throw new Error('El mapa tiene que tener tamaño mayor a cero.');
        this.occupied = new Uint8Array(sizeX * sizeY);
        this.teleport = new Uint8Array(sizeX * sizeY);
        for (const [x, y] of blocked) this.setOccupied(x, y);
        for (const [x, y] of teleportCells) { const i = this.index(x, y); if (i >= 0) this.teleport[i] = 1; }
    }

    get occupiedCount(): number { return this.count; }

    private index(x: number, y: number): number {
        return x >= 0 && y >= 0 && x < this.sizeX && y < this.sizeY ? y * this.sizeX + x : -1;
    }

    setOccupied(x: number, y: number): void {
        const i = this.index(x, y);
        if (i >= 0 && !this.occupied[i]) { this.occupied[i] = 1; this.count++; }
    }

    setFree(x: number, y: number): void {
        const i = this.index(x, y);
        if (i >= 0 && this.occupied[i]) { this.occupied[i] = 0; this.count--; }
    }

    isFree(x: number, y: number): boolean {
        const i = this.index(x, y);
        return i >= 0 && !this.occupied[i];
    }

    isFreeAndNotTeleportCell(x: number, y: number): boolean {
        const i = this.index(x, y);
        return i >= 0 && !this.occupied[i] && !this.teleport[i];
    }
}

/** Lee el .amd y devuelve el registro de ocupación con las celdas bloqueadas marcadas. */
export function loadOccupancy(mapName: string, teleportCells: WorldLocationConfig[] = []): Occupancy {
    const path = join(DATA_DIR, 'maps', `${mapName}.amd`);
    const bytes = readFileSync(path);
    if (bytes.length < HEADER_SIZE) throw new Error(`El mapa '${path}' es demasiado chico para tener cabecera.`);

    const header = bytes.subarray(0, HEADER_SIZE).toString('ascii').replace(/\0/g, ' ');
    const tokens = header.split(/\s+/).filter(Boolean);
    const value = (name: string) => {
        const i = tokens.indexOf(name);
        return i >= 0 && tokens[i + 1] === '=' ? Number.parseInt(tokens[i + 2], 10) : 0;
    };
    const sizeX = value('MAPSIZEX'), sizeY = value('MAPSIZEY'), tileSize = value('TILESIZE');
    if (sizeX <= 0 || sizeY <= 0 || tileSize <= 0) throw new Error(`Dimensiones inválidas en '${path}': ${sizeX}x${sizeY}, tileSize=${tileSize}`);
    if (bytes.length < HEADER_SIZE + sizeX * sizeY * tileSize) throw new Error(`El mapa '${path}' está cortado.`);

    const blocked: [number, number][] = [];
    let offset = HEADER_SIZE;
    for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
            if (bytes[offset + 8] & BLOCKED_FLAG) blocked.push([x, y]);
            offset += tileSize;
        }
    }
    return new Occupancy(sizeX, sizeY, blocked, teleportCells.map((c) => [c.x, c.y] as [number, number]));
}
