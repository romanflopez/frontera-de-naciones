/**
 * Render de control de un mapa entero (o un recorte) sin levantar el juego: pisos, decals y objetos ordenados por profundidad,
 * edificios en tiras (como el cliente), NPC como marcas y vínculos como rombos. Sirve para iterar el armado de los mapas.
 * Uso: npx tsx src/town/render.ts <mapId[,mapId...]> <salida.png> [escala=0.25] [x0 y0 x1 y1]
 *      Con varios mapas, cada uno va a <salida>_<mapId>.png.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { buildMap, getMapDef } from '../../../packages/world/src/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const A = join(root, 'apps', 'client', 'public', 'assets');
const [mapArg, outArg, scaleArg, ...rect] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(join(A, 'meta.json'), 'utf8'));
const atlases: { im: Image; pos: Record<string, number[]> }[] = [];
atlases.push({ im: await loadImage(readFileSync(join(A, 'world.webp'))), pos: meta.world });
for (const k of ['dungeon', 'terrain', 'town']) atlases.push({ im: await loadImage(readFileSync(join(A, `${k}.webp`))), pos: meta[k].pos });
const find = (id: number) => { for (const a of atlases) { const p = a.pos[id]; if (p) return { im: a.im, p }; } return null; };
async function renderMap(mapId: string, outFile: string) {
const def = getMapDef(mapId); if (!def) { console.error('mapa desconocido'); process.exit(1); }
const m = buildMap(mapId), K = Number(scaleArg ?? 0.25);
const [rx0, ry0, rx1, ry1] = rect.length === 4 ? rect.map(Number) : [0, 0, m.size - 1, m.size - 1];
const bimg = new Map<string, Image>();
for (const b of m.buildings) if (!bimg.has(b.id) && existsSync(join(A, `${b.id}.webp`))) bimg.set(b.id, await loadImage(readFileSync(join(A, `${b.id}.webp`))));
const iso = (x: number, y: number) => ({ x: (x - y) * 48, y: (x + y) * 24 });
const corners = [iso(rx0, ry0), iso(rx1 + 1, ry0), iso(rx0, ry1 + 1), iso(rx1 + 1, ry1 + 1)];
const minX = Math.min(...corners.map((c) => c.x)) - 60, maxX = Math.max(...corners.map((c) => c.x)) + 60;
const minY = Math.min(...corners.map((c) => c.y)) - 420, maxY = Math.max(...corners.map((c) => c.y)) + 40;
const cv = createCanvas(Math.ceil((maxX - minX) * K), Math.ceil((maxY - minY) * K)), g = cv.getContext('2d');
g.fillStyle = '#0d100e'; g.fillRect(0, 0, cv.width, cv.height);
g.setTransform(K, 0, 0, K, -minX * K, -minY * K);
const inR = (x: number, y: number) => x >= rx0 - 1 && x <= rx1 + 1 && y >= ry0 - 1 && y <= ry1 + 1;
const draw = (id: number, x: number, y: number) => { const e = find(id); if (!e) return; const q = e.p, c = iso(x, y); g.drawImage(e.im, q[0], q[1], q[2], q[3], Math.round(c.x - q[4]), Math.round(c.y - q[5]), q[2], q[3]); };
for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) draw(m.tiles[y][x], x + 0.5, y + 0.5);
for (const d of m.decals) if (inR(d.x, d.y)) draw(d.id, d.x, d.y);
const objs: { d: number; f: () => void }[] = [];
for (const o of m.props) if (inR(o.x, o.y)) objs.push({ d: o.d ?? o.x + o.y, f: () => draw(o.id, o.x, o.y) });
for (const b of m.buildings) {
    const M = meta.buildings[b.id], im = bimg.get(b.id); if (!M || !im) continue;
    const p = iso(b.x + b.w, b.y + b.h), left = iso(b.x, b.y + b.h).x, x0 = p.x - M.ax;
    // tiras de media celda: cada una con la profundidad de la celda de la huella más cercana a cámara en esa columna
    for (let k = 0; k < b.w + b.h; k++) {
        const D = k < b.w ? b.x + k + b.y + b.h - 1 : b.x + b.w - 1 + b.y + b.h - 1 - (k - b.w);
        let sx0 = left + k * 48 - x0, sx1 = sx0 + 48;
        if (k === 0) sx0 = 0; if (k === b.w + b.h - 1) sx1 = M.w;
        objs.push({ d: D + 0.25, f: () => g.drawImage(im, sx0, 0, sx1 - sx0, M.h, x0 + sx0, p.y - M.ay, sx1 - sx0, M.h) });
    }
}
for (const n of m.npcs) objs.push({ d: n.x + n.y + 1, f: () => { const c = iso(n.x + 0.5, n.y + 0.5); g.fillStyle = '#ffd24a'; g.fillRect(c.x - 6, c.y - 60, 12, 60); g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(n.name, c.x - 40, c.y - 66); } });
objs.sort((a, b) => a.d - b.d).forEach((o) => o.f());
for (const l of def.links) { const c = iso(l.x + 0.5, l.y + 0.5); g.strokeStyle = '#ff40ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(c.x, c.y - 24); g.lineTo(c.x + 48, c.y); g.lineTo(c.x, c.y + 24); g.lineTo(c.x - 48, c.y); g.closePath(); g.stroke(); }
for (const w of m.waypoints ?? []) { const c = iso(w.x + 0.5, w.y + 0.5); g.strokeStyle = '#40e0ff'; g.lineWidth = 4; g.beginPath(); g.ellipse(c.x, c.y, 60, 30, 0, 0, Math.PI * 2); g.stroke(); }
writeFileSync(outFile, cv.toBuffer('image/png'));
console.log(`${mapId}: ${m.size}x${m.size}, ${m.props.length} props, ${m.buildings.length} edificios -> ${cv.width}x${cv.height}`);
}
const ids = mapArg.split(',');
for (const id of ids) await renderMap(id, ids.length > 1 ? outArg.replace(/\.png$/, `_${id}.png`) : outArg);
