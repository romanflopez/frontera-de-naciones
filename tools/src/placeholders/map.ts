/**
 * Mapa provisorio "campamento" y sus tiles, en los formatos que leen cliente y server.
 *
 * .amd: cabecera ASCII de 256 bytes ("MAPSIZEX = W MAPSIZEY = H TILESIZE = 10") y 10 bytes por celda:
 *   int16 sprite de piso, int16 frame de piso, int16 sprite de objeto, int16 frame de objeto,
 *   uint8 flags (0x80 bloqueada, 0x40 teleport, 0x20 cultivo), uint8 reservado.
 *
 * Índices globales de tiles (cada pack .spr arranca en un índice):
 *   0   fdn-ground      piso (hoja 0 pasto, 1 tierra, 2 piedra, 3 pasto oscuro)
 *   50  fdn-objects     objetos (hoja 0 rocas, 1 cerco, 2 fogata, 3 cajones)
 *   100 fdn-trees       árboles (el cliente trata 100–145 como árboles)
 *   150 fdn-treeshadows sombras de árboles (índice del árbol + 50)
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { encodeSpr, type SprSheet, type SprFrame } from './spr.ts';
import { circle, line, shade } from './figure.ts';

export const TILE = 32;
export const MAP_SIZE = 100;

export const TILE_PACKS = [
    { file: 'fdn-ground.spr', start: 0 },
    { file: 'fdn-objects.spr', start: 50 },
    { file: 'fdn-trees.spr', start: 100 },
    { file: 'fdn-treeshadows.spr', start: 150 },
] as const;

const GROUND = { grass: 0, dirt: 1, stone: 2, darkGrass: 3 } as const;
const OBJ = { rock: 50, fence: 51, fire: 52, crate: 53, tree: 100 } as const;

// ---------- azar con semilla, así el mapa sale igual siempre ----------
function rng(seed: number) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- tiles de piso ----------
function groundSheet(kind: number): SprSheet {
    const frames = 8;
    const c = createCanvas(TILE * frames, TILE), ctx = c.getContext('2d');
    const r = rng(100 + kind);
    const base = ['#4a6332', '#7a5f3d', '#6d6b62', '#3a4f2a'][kind];
    const out: SprFrame[] = [];
    for (let f = 0; f < frames; f++) {
        const ox = f * TILE;
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.08); ctx.fillRect(ox, 0, TILE, TILE);
        if (kind === GROUND.stone) {
            ctx.strokeStyle = shade(base, -0.35); ctx.lineWidth = 1;
            const off = f % 2 ? 8 : 0;
            for (let y = 0; y < TILE; y += 8) {
                line(ctx, ox, y + 0.5, ox + TILE, y + 0.5);
                for (let x = ((y / 8) % 2 ? 8 : 0) + off; x < TILE; x += 16) line(ctx, ox + x + 0.5, y, ox + x + 0.5, y + 8);
            }
            for (let i = 0; i < 6; i++) { ctx.fillStyle = shade(base, (r() - 0.3) * 0.25); ctx.fillRect(ox + r() * 30, r() * 30, 3, 2); }
        } else {
            for (let i = 0; i < 40; i++) {
                const x = ox + r() * TILE, y = r() * TILE;
                ctx.fillStyle = shade(base, (r() - 0.5) * 0.45);
                if (kind === GROUND.dirt) ctx.fillRect(x, y, 2, 1);
                else { ctx.fillRect(x, y, 1, 3); }
            }
            if (kind !== GROUND.dirt && r() < 0.5) { ctx.fillStyle = r() < 0.5 ? '#c9b65a' : '#b9a3d9'; circle(ctx, ox + 4 + r() * 24, 4 + r() * 24, 1.2); }
        }
        out.push({ x: ox, y: 0, width: TILE, height: TILE, pivotX: 0, pivotY: 0 });
    }
    return { png: c.toBuffer('image/png'), width: c.width, height: c.height, frames: out };
}

// ---------- objetos ----------
/** Dibuja `n` objetos en celdas de w×h; el punto (bx, by) de la celda cae en el centro-abajo de la celda del mapa. */
function objectSheet(n: number, w: number, h: number, bx: number, by: number, draw: (ctx: SKRSContext2D, ox: number, i: number) => void): SprSheet {
    const c = createCanvas(w * n, h), ctx = c.getContext('2d');
    const frames: SprFrame[] = [];
    for (let i = 0; i < n; i++) {
        ctx.save(); draw(ctx, i * w, i); ctx.restore();
        frames.push({ x: i * w, y: 0, width: w, height: h, pivotX: TILE / 2 - bx, pivotY: TILE - 4 - by });
    }
    return { png: c.toBuffer('image/png'), width: c.width, height: c.height, frames };
}

function rocks(): SprSheet {
    return objectSheet(4, 48, 40, 24, 36, (ctx, ox, i) => {
        const r = rng(7 + i);
        ctx.translate(ox + 24, 36);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(4, 0, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
        const pts = Array.from({ length: 7 }, (_, k) => { const a = Math.PI + (k / 6) * Math.PI; const rad = 12 + r() * 6; return [Math.cos(a) * rad, Math.sin(a) * rad * (0.9 + i * 0.1)]; });
        ctx.fillStyle = shade('#7d7a70', (r() - 0.5) * 0.2); ctx.beginPath(); ctx.moveTo(-16, 0); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(16, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(-4, -10, 7, 4, -0.4, 0, Math.PI * 2); ctx.fill();
    });
}
function fence(): SprSheet {
    return objectSheet(2, 40, 48, 20, 44, (ctx, ox, i) => {
        ctx.translate(ox + 20, 44);
        ctx.fillStyle = '#5a3b22'; ctx.fillRect(-3, -30, 6, 30);
        ctx.fillStyle = '#7a5532';
        if (i === 0) { ctx.fillRect(-18, -24, 36, 5); ctx.fillRect(-18, -12, 36, 5); } else { ctx.fillRect(-3, -30, 6, 4); }
    });
}
function campfire(): SprSheet {
    return objectSheet(1, 48, 48, 24, 40, (ctx, ox) => {
        ctx.translate(ox + 24, 40);
        ctx.fillStyle = '#4a4a46'; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; circle(ctx, Math.cos(a) * 12, Math.sin(a) * 5, 3.5); }
        ctx.strokeStyle = '#5a3b22'; ctx.lineWidth = 4; line(ctx, -10, 2, 8, -14); line(ctx, 10, 2, -8, -14);
        const g = ctx.createRadialGradient(0, -10, 1, 0, -10, 14); g.addColorStop(0, '#fff3c0'); g.addColorStop(0.4, '#ff9a3a'); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; circle(ctx, 0, -10, 14);
    });
}
function crates(): SprSheet {
    return objectSheet(2, 40, 44, 20, 40, (ctx, ox, i) => {
        ctx.translate(ox + 20, 40);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-14, -4, 30, 6);
        ctx.fillStyle = '#8a6238'; ctx.fillRect(-14, -26, 28, 26);
        ctx.strokeStyle = '#4a321c'; ctx.lineWidth = 2; ctx.strokeRect(-14, -26, 28, 26); line(ctx, -14, -26, 14, 0);
        if (i === 1) { ctx.fillStyle = '#c9a15a'; circle(ctx, 0, -32, 6); }
    });
}

function tree(ctx: SKRSContext2D, ox: number, i: number) {
    const r = rng(40 + i);
    ctx.translate(ox + 48, 118);
    ctx.fillStyle = '#4a3422'; ctx.fillRect(-5, -40, 10, 40);
    const greens = [['#24401f', '#2e5226', '#3a6530'], ['#2a3d24', '#355030', '#43633b'], ['#1f3a2a', '#2a4d38', '#365f46'], ['#3a4a1f', '#4a5e27', '#5c7330']][i % 4];
    const blobs = [[0, -60, 30], [-18, -48, 20], [18, -50, 22], [0, -84, 22]];
    greens.forEach((g, k) => { ctx.fillStyle = g; blobs.forEach(([x, y, rad]) => circle(ctx, x + (r() - 0.5) * 6 - k * 2, y - k * 3, rad - k * 5)); });
}
function trees(): SprSheet { return objectSheet(4, 96, 128, 48, 118, tree); }
function treeShadows(): SprSheet {
    return objectSheet(4, 96, 128, 48, 118, (ctx, ox) => {
        ctx.translate(ox + 48, 118);
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(22, -4, 34, 11, -0.15, 0, Math.PI * 2); ctx.fill();
    });
}

export function buildTilePacks(): Record<string, Uint8Array> {
    return {
        'fdn-ground.spr': encodeSpr([0, 1, 2, 3].map(groundSheet)),
        'fdn-objects.spr': encodeSpr([rocks(), fence(), campfire(), crates()]),
        'fdn-trees.spr': encodeSpr([trees()]),
        'fdn-treeshadows.spr': encodeSpr([treeShadows()]),
    };
}

// ---------- el mapa ----------
interface Cell { g: number; gf: number; o: number; of: number; blocked: boolean }

export function buildCampMap(): Uint8Array {
    const N = MAP_SIZE, r = rng(2026);
    const cells: Cell[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ g: GROUND.grass, gf: Math.floor(r() * 8), o: 0, of: 0, blocked: false })));
    const at = (x: number, y: number) => cells[y]?.[x];
    const cx = 50, cy = 50;

    // manchas de pasto oscuro
    for (let k = 0; k < 18; k++) {
        const px = Math.floor(r() * N), py = Math.floor(r() * N), rad = 3 + r() * 5;
        for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) if (x * x + y * y < rad * rad) { const c = at(px + x, py + y); if (c) c.g = GROUND.darkGrass; }
    }
    // caminos de tierra desde el campamento hacia los cuatro lados
    const path = (x0: number, y0: number, x1: number, y1: number) => {
        let x = x0, y = y0;
        while (x !== x1 || y !== y1) {
            for (let w = -1; w <= 1; w++) { const c = at(x + (y0 === y1 ? 0 : w), y + (y0 === y1 ? w : 0)); if (c) { c.g = GROUND.dirt; c.gf = Math.floor(r() * 8); } }
            if (x !== x1 && (r() < 0.75 || y === y1)) x += Math.sign(x1 - x); else if (y !== y1) y += Math.sign(y1 - y);
        }
    };
    path(cx, cy, 96, 46); path(cx, cy, 4, 55); path(cx, cy, 53, 96); path(cx, cy, 47, 4);
    // plaza de piedra
    for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) { const c = at(x, y)!; c.g = GROUND.stone; c.gf = Math.floor(r() * 8); }
    // cerco con cuatro entradas
    for (let i = -9; i <= 9; i++) {
        for (const [x, y] of [[cx + i, cy - 9], [cx + i, cy + 9], [cx - 9, cy + i], [cx + 9, cy + i]]) {
            if (Math.abs(i) <= 1) continue;
            const c = at(x, y)!; c.o = OBJ.fence; c.of = 0; c.blocked = true;
        }
    }
    // fogata y cajones
    Object.assign(at(cx, cy)!, { o: OBJ.fire, of: 0, blocked: true });
    for (const [x, y, f] of [[cx - 5, cy - 5, 0], [cx - 4, cy - 5, 1], [cx + 5, cy + 4, 0], [cx + 5, cy - 5, 1]]) Object.assign(at(x, y)!, { o: OBJ.crate, of: f, blocked: true });

    // borde de árboles
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const edge = x < 2 || y < 2 || x >= N - 2 || y >= N - 2;
        if (edge) Object.assign(cells[y][x], { o: OBJ.tree, of: Math.floor(r() * 4), blocked: true });
    }
    // árboles y rocas sueltos, lejos del campamento y de los caminos
    for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
        const c = cells[y][x];
        if (c.blocked || c.g === GROUND.dirt || c.g === GROUND.stone) continue;
        if (Math.abs(x - cx) < 12 && Math.abs(y - cy) < 12) continue;
        const v = r();
        if (v < 0.035) Object.assign(c, { o: OBJ.tree, of: Math.floor(r() * 4), blocked: true });
        else if (v < 0.045) Object.assign(c, { o: OBJ.rock, of: Math.floor(r() * 4), blocked: true });
    }

    // escribir .amd
    const TS = 10, header = 256;
    const out = new Uint8Array(header + N * N * TS);
    const text = `MAPSIZEX = ${N} MAPSIZEY = ${N} TILESIZE = ${TS}`;
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    const v = new DataView(out.buffer);
    let o = header;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const c = cells[y][x];
        v.setInt16(o, c.g, true); v.setInt16(o + 2, c.gf, true); v.setInt16(o + 4, c.o, true); v.setInt16(o + 6, c.of, true);
        v.setUint8(o + 8, c.blocked ? 0x80 : 0); v.setUint8(o + 9, 0);
        o += TS;
    }
    return out;
}
