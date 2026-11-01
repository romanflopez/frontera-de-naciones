// Los sets de armadura (Solmar y Vhar) están completos: ítems, tienda, hojas de piezas y meta.json coinciden.
// Correr: cd apps/server && npx tsx --test test/sets.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_BASES, SHOPS } from '@fdn/world';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'public', 'assets');
const meta = JSON.parse(readFileSync(join(ASSETS, 'meta.json'), 'utf8')).paper as { cw: number; ch: number; cols: number; anims: Record<string, unknown>; sets: Record<string, string[]>; pieces: Record<string, string>; helms: string[] };
const LOOKS = ['sol_malla', 'sol_placas', 'vhar_malla', 'vhar_placas'];
/** Tamaño de un .webp sin pérdida (VP8L): 14 bits de ancho y 14 de alto. */
function webpSize(file: string): [number, number] {
    const b = readFileSync(file); assert.equal(b.toString('ascii', 12, 16), 'VP8L', file);
    const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

test('cada set tiene 4 piezas de cuerpo + cabeza, del tamaño de la hoja base y registradas en meta.json', () => {
    const rows = Object.keys(meta.anims).length * 8;
    for (const look of LOOKS) {
        const parts = meta.sets[look]; assert.equal(parts?.length, 4, `${look} en meta.sets`);
        const all = [...parts, `${look}_helm`];
        assert.deepEqual(all.map((n) => meta.pieces[n]), ['feet', 'legs', 'hands', 'chest', 'head']);
        assert.ok(meta.helms.includes(`${look}_helm`));
        for (const n of all) {
            const f = join(ASSETS, 'paper', `${n}.webp`); assert.ok(existsSync(f), `falta ${n}.webp`);
            assert.deepEqual(webpSize(f), [meta.cw * meta.cols, meta.ch * rows], `${n}: tamaño de hoja`);
        }
    }
});

test('cada set tiene su armadura y su yelmo como ítems, con stats de su tipo, ícono y a la venta en el armadurero', () => {
    const stock = new Set(SHOPS.armadurero.stock.map((s) => s.base));
    for (const look of LOOKS) {
        const arm = ALL_BASES.find((b) => b.look === look), helm = ALL_BASES.find((b) => b.look === `${look}_helm`);
        assert.ok(arm && arm.slot === 'armadura' && helm && helm.slot === 'cabeza', `${look}: ítems`);
        assert.ok(stock.has(arm.name) && stock.has(helm.name), `${look}: en la tienda`);
        assert.ok((arm.def ?? 0) >= 22 && (arm.rm ?? 0) >= 8, `${look}: stats de malla o placas`);
        for (const f of [`${look}.png`, `${look}_helm.png`]) assert.ok(existsSync(join(ASSETS, 'icons', f)), `falta el ícono ${f}`);
    }
});

test('los nombres de los ítems son únicos (son la clave del guardado)', () => {
    const names = ALL_BASES.map((b) => b.name); assert.equal(new Set(names).size, names.length);
});
