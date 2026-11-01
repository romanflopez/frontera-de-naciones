import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOBS, MOB_TYPES, mobDef, mobHpCurve, mobExpCurve, type MobType } from '@fdn/world';

const assets = fileURLToPath(new URL('../../client/public/assets/', import.meta.url));
const meta = JSON.parse(readFileSync(assets + 'meta.json', 'utf8')) as Record<string, { cw: number; ch: number; cols: number; anims: Record<string, { row: number; n: number }> }>;

test('el protocolo manda el índice del tipo: los 13 originales no se reordenan y los nuevos van al final', () => {
    assert.deepEqual(MOB_TYPES.slice(0, 13), ['goblin', 'zombie', 'skeleton', 'barbaro', 'goblin_elite', 'antlion', 'skeleton_mage', 'fire_ant', 'wyvern', 'minotaur', 'arana', 'golem', 'demonio']);
    assert.deepEqual(MOB_TYPES.slice(13), ['hobgoblin', 'hobgoblin_archer', 'skeleton_archer', 'zombie_dark', 'cursed_grave', 'ice_ant', 'antlion_small', 'wyvern_fire', 'wyvern_ice', 'goblin_jefe', 'antlion_reina', 'caballero_cripta', 'mago_mayor', 'wyvern_aire']);
    assert.equal(new Set(MOB_TYPES).size, MOB_TYPES.length, 'sin tipos repetidos');
});

test('todo tipo tiene definición coherente', () => {
    for (const t of MOB_TYPES) {
        const d = MOBS[t];
        assert.ok(d, t);
        assert.ok(d.name && d.lvl >= 1 && d.hp > 0 && d.exp > 0 && d.spd > 0 && d.hitR > 0 && d.head > 0 && d.atk > 0, t);
        assert.ok(d.dmg[0] > 0 && d.dmg[1] >= d.dmg[0], t);
    }
});

test('los tipos nuevos siguen las curvas de ZONAS.md (vida y exp a ±25 %, salvo la cría, que es más débil a propósito)', () => {
    for (const t of MOB_TYPES.slice(13) as MobType[]) {
        if (MOBS[t].boss) continue;
        const d = MOBS[t], weak = t === 'antlion_small' || t === 'hobgoblin_archer';
        const lo = weak ? 0.55 : 0.75, hi = 1.25;
        assert.ok(d.hp / mobHpCurve(d.lvl) >= lo && d.hp / mobHpCurve(d.lvl) <= hi, `${t} vida ${d.hp} vs curva ${Math.round(mobHpCurve(d.lvl))}`);
        assert.ok(d.exp / mobExpCurve(d.lvl) >= lo && d.exp / mobExpCurve(d.lvl) <= hi + 0.1, `${t} exp ${d.exp} vs curva ${Math.round(mobExpCurve(d.lvl))}`);
    }
});

test('un tipo nuevo se reescala a otro nivel de zona como los demás (y no es jefe)', () => {
    for (const t of MOB_TYPES.slice(13) as MobType[]) {
        if (MOBS[t].boss) continue;
        assert.equal(MOBS[t].boss, undefined, t);
        const d = mobDef(t, { lvl: 10 });
        assert.equal(d.lvl, 10);
        assert.ok(Math.abs(d.hp - mobHpCurve(10) * (MOBS[t].hp / mobHpCurve(MOBS[t].lvl))) < 2, `${t} vida reescalada ${d.hp}`);
    }
});

test('todo tipo tiene su atlas y su meta con las 5 animaciones del cliente en 8 direcciones', () => {
    for (const t0 of MOB_TYPES) {
        const t = MOBS[t0].sprite ?? t0;
        assert.ok(existsSync(assets + t + '.webp'), `falta apps/client/public/assets/${t}.webp`);
        const m = meta[t];
        assert.ok(m, `falta ${t} en meta.json`);
        for (const a of ['stance', 'run', 'swing', 'hit', 'die']) {
            assert.ok(m.anims[a] && m.anims[a].n >= 1 && m.anims[a].n <= m.cols, `${t}: animación ${a}`);
        }
        const rows = Math.max(...Object.values(m.anims).map((a) => a.row)) + 8;
        assert.ok(rows >= 40, `${t}: filas`);
    }
});
