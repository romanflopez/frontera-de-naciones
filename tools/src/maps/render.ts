/**
 * Vista completa de un mapa (tiles + props + zonas + vínculos) a PNG, para revisar mapas sin abrir el juego.
 * Uso: pnpm --filter @fdn/tools maps:render [id…] [--scale 0.25] [--out tools/out/maps]
 */
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS, buildMap } from '../../../packages/world/src/maps';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const A = join(root, 'apps', 'client', 'public', 'assets');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const scale = Number(opt('--scale', '0.25'));
const out = join(root, opt('--out', 'tools/out/maps'));
const noOverlay = args.includes('--clean'); if (noOverlay) args.splice(args.indexOf('--clean'), 1);
mkdirSync(out, { recursive: true });
const TW = 96, TH = 48;

const meta = JSON.parse(readFileSync(join(A, 'meta.json'), 'utf8'));
// `p` = [sx, sy, sw, sh, ox, oy, dw, dh]: recorte en el atlas y destino en geometría. Difieren cuando el atlas está a escala nativa
// (meta `s`, ver tools/src/flare/mapatlas.ts): el arte tiene más píxeles pero ocupa la misma celda.
const EXT: Record<number, { im: Image; p: number[] }> = {};
for (const k of ['dungeon', 'terrain', 'town', ...Object.keys(meta).filter((g) => g.startsWith('flare_'))]) {
    const m = meta[k]; if (!m) continue;
    const im = await loadImage(join(A, `${k}.webp`));
    const s = (m.s as number) || 1;
    for (const [id, p] of Object.entries(m.pos as Record<string, number[]>)) EXT[Number(id)] = { im, p: s === 1 ? [...p, p[2], p[3]] : [p[0], p[1], p[2], p[3], p[4] / s, p[5] / s, p[2] / s, p[3] / s] };
}
const worldIm = await loadImage(join(A, 'world.webp'));
const WORLD = meta.world as Record<string, number[]>;
const BUILD = (meta.buildings ?? {}) as Record<string, number[]>;
const bimg: Record<string, Image | null> = {};

const ids = args.length ? args : Object.keys(MAPS).filter((k) => !MAPS[k].debugOnly);
for (const id of ids) {
    const def = MAPS[id]; if (!def) { console.warn('no existe', id); continue; }
    const m = buildMap(id), N = m.size;
    const W = N * TW, H = N * TH + 300;
    const cv = createCanvas(Math.ceil(W * scale), Math.ceil(H * scale)), ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d100e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.scale(scale, scale); ctx.translate(W / 2, 200);
    const iso = (x: number, y: number) => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 });
    const draw = (tid: number, x: number, y: number) => {
        const e = EXT[tid]; if (e) { const q = e.p; ctx.drawImage(e.im, q[0], q[1], q[2], q[3], Math.round(x - q[4]), Math.round(y - q[5]), q[6], q[7]); return true; }
        const w = WORLD[tid]; if (!w) return false; ctx.drawImage(worldIm, w[0], w[1], w[2], w[3], x - w[4], y - w[5], w[2], w[3]); return true;
    };
    let missing = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const t = m.tiles[y][x]; if (t && !draw(t, iso(x + 0.5, y + 0.5).x, iso(x + 0.5, y + 0.5).y)) missing++; }
    for (const d of m.decals) { const p = iso(d.x, d.y); draw(d.id, p.x, p.y); }
    const objs: { d: number; f: () => void }[] = [];
    for (const o of m.props) objs.push({ d: (o as { d?: number }).d ?? o.x + o.y, f: () => { const p = iso(o.x, o.y); if (!draw(o.id, p.x, p.y)) missing++; } });
    for (const b of m.buildings) {
        const M = BUILD[b.id] as unknown as { w: number; h: number; ax: number; ay: number } | undefined; if (!M) continue;
        if (!(b.id in bimg)) bimg[b.id] = await loadImage(join(A, `${b.id}.webp`)).catch(() => null);
        const im = bimg[b.id]; if (!im) continue;
        objs.push({ d: b.x + b.w + b.y + b.h - 1.75, f: () => { const p = iso(b.x + b.w, b.y + b.h); ctx.drawImage(im, p.x - M.ax, p.y - M.ay); } });
    }
    objs.sort((a, b) => a.d - b.d); for (const o of objs) o.f();
    if (!noOverlay) {
        ctx.lineWidth = 6;
        for (const z of m.zones) { const p = iso(z.x, z.y); ctx.strokeStyle = 'rgba(255,60,60,.8)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, z.r * TW * 0.7, z.r * TH * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 60px sans-serif'; ctx.fillText(`${z.type} ${z.lvl ?? ''}`, p.x - 120, p.y); }
        for (const l of def.links) { const p = iso(l.x + 0.5, l.y + 0.5); ctx.fillStyle = '#4af'; ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 56px sans-serif'; ctx.fillText(`→${l.to.map}`, p.x + 40, p.y); }
        const s = iso(def.spawn.x + 0.5, def.spawn.y + 0.5); ctx.fillStyle = '#4f4'; ctx.beginPath(); ctx.arc(s.x, s.y, 50, 0, 7); ctx.fill();
    }
    writeFileSync(join(out, `${id}.png`), cv.toBuffer('image/png'));
    console.log(id, N, `faltan ${missing}`);
}
