/**
 * Lámina de control del kit de ciudad: arma una habitación y un edificio con las piezas de town.webp y las dibuja igual que el
 * cliente (pisos, después objetos ordenados por profundidad). Sirve para revisar anclas sin levantar el juego.
 * Uso: npx tsx src/town/scene.ts <salida.png>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { townCoping, townPillar, townTile, townWall, TOWN_PROPS, CRATES_WOOD, townStairs, FOAM } from '../../../packages/world/src/town.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const A = join(root, 'apps', 'client', 'public', 'assets');
const meta = JSON.parse(readFileSync(join(A, 'meta.json'), 'utf8'));
const town = await loadImage(readFileSync(join(A, 'town.webp')));
const terr = await loadImage(readFileSync(join(A, 'terrain.webp')));
const W = 1400, H = 900, cv = createCanvas(W, H), g = cv.getContext('2d');
g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
const iso = (x: number, y: number) => ({ x: W / 2 + (x - y) * 48, y: 120 + (x + y) * 24 });
const draw = (id: number, x: number, y: number) => {
    const [im, p] = id >= 3000 ? [town, meta.town.pos[id]] : [terr, meta.terrain.pos[id]];
    if (!p) return; const c = iso(x, y); g.drawImage(im, p[0], p[1], p[2], p[3], Math.round(c.x - p[4]), Math.round(c.y - p[5]), p[2], p[3]);
};
const props: { id: number; x: number; y: number; d: number }[] = [];
const prop = (id: number, x: number, y: number, d = x + y) => props.push({ id, x: x + 0.5, y: y + 0.5, d });
// habitación 8x6 en (2..9, 2..7): paredes atrás altas, adelante muretes, puerta al sur en x = 5
for (let y = 2; y <= 7; y++) for (let x = 2; x <= 9; x++) draw(1265, x + 0.5, y + 0.5);
for (let x = 2; x <= 9; x++) prop(townWall('cal', x % 3 ? 'ventana' : 'liso', '\\'), x, 2, x + 2 - 0.6);
for (let y = 2; y <= 7; y++) prop(townWall('cal', y % 2 ? 'ventana2' : 'liso', '/'), 2, y, 2 + y - 0.6);
for (let x = 2; x <= 9; x++) if (x !== 5) prop(townCoping('murete', '\\'), x, 8, x + 8 - 0.4);
for (let y = 2; y <= 7; y++) prop(townCoping('murete', '/'), 10, y, 10 + y - 0.4);
prop(townPillar('cal'), 2, 2, 3.5);
prop(CRATES_WOOD[0], 8, 3); prop(TOWN_PROPS.farol, 4, 4); prop(townStairs('piedra', '/'), 7, 6); prop(TOWN_PROPS.alfombra, 5, 5, 0);
// agua con espuma
for (let y = 9; y <= 13; y++) for (let x = -6; x <= 1; x++) draw(y >= 11 ? townTile('water', 1) : townTile('terrain2', 17), x + 0.5, y + 0.5);
for (let x = -6; x <= 1; x++) draw(FOAM.ne, x + 0.5, 11.5);
prop(TOWN_PROPS.bote, -3, 12); prop(TOWN_PROPS.poste, 0, 10);
props.sort((a, b) => a.d - b.d).forEach((p) => draw(p.id, p.x, p.y));
// edificio: huella 6x5 en (13..18, 1..5)
const bm = meta.buildings.sm_tienda, bim = await loadImage(readFileSync(join(A, 'sm_tienda.webp')));
for (let y = 0; y < 8; y++) for (let x = 11; x < 21; x++) draw(1218, x + 0.5, y + 0.5);
const bp = iso(13 + bm.fw, 1 + bm.fh); g.drawImage(bim, bp.x - bm.ax, bp.y - bm.ay);
g.strokeStyle = 'rgba(255,0,0,.6)'; const q = [iso(13, 1), iso(13 + bm.fw, 1), iso(13 + bm.fw, 1 + bm.fh), iso(13, 1 + bm.fh)]; g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.stroke();
writeFileSync(process.argv[2], cv.toBuffer('image/png'));
