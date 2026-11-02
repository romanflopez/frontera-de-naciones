/** /gm bis: el set completo del mago (mejores ítems existentes, tiradas máximas y +5). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '@fdn/proto';
import { loadCatalogs, loadSettings } from '../src/config.ts';
import { Economy } from '../src/economy.ts';
import type { AccountRecord, Storage } from '../src/storage.ts';
import { WorldRegistry, type TransferSession } from '../src/registry.ts';
import type { PersistedPlayer } from '../src/player.ts';

const settings = loadSettings(), catalogs = loadCatalogs();
class Mem implements Storage { m = new Map<string, AccountRecord>(); get(k: string) { return this.m.get(k); } put(k: string, r: AccountRecord) { this.m.set(k, r); } flush() {} }
function join(cls: string) {
    const mem = new Mem(), eco = new Economy(mem), reg = new WorldRegistry({ settings, catalogs, economy: eco });
    const w = reg.ensure('solmar_legacy'), log: ServerMessage[] = [];
    const session: TransferSession = { sessionId: 's-1', worldId: w.id };
    const persisted = { mapId: w.mapId, worldId: w.mapId, x: 11, y: 11, direction: 4, gender: 0, skinColor: 0, hairStyleIndex: 0, underwearColorIndex: 0, movementSpeedMs: 270, runningMode: true } as unknown as PersistedPlayer;
    w.playerConnected(session.sessionId, 'a', (m) => log.push(m), () => {}, persisted);
    mem.put('acc-a', { name: 'a', salt: '', hash: '', created: 0, lastLogin: 0 }); w.bindAccount('s-1', 'acc-a');
    w.onClientSave('s-1', JSON.stringify({ cls, faction: 'solmar' }));
    return { w, p: w.playerOf('s-1')! };
}

test('/gm bis: el mago queda con el mejor set, +5, y sube su Magia, maná y resistencia', () => {
    const { w, p } = join('mago');
    const before = { mag: p.combat.mag, mp: p.combat.maxMp, rm: p.combat.rm };
    const out = w.gmCommand('s-1', 'bis', []);
    assert.match(out[0], /Báculo del camposanto/);
    const eq = p.econ!.eq;
    assert.deepEqual([eq.arma?.n, eq.armadura?.n, eq.cabeza?.n, eq.anillo?.n], ['Báculo del camposanto', 'Mortaja bordada', 'Capuchón de duelo', 'Anillo opaco']);
    for (const s of ['arma', 'armadura', 'cabeza', 'anillo'] as const) assert.equal(eq[s]!.up, 5, s);
    assert.ok(p.combat.mag > before.mag + 40, `Magia ${before.mag} -> ${p.combat.mag}`);
    assert.ok(p.combat.maxMp > before.mp + 50 && p.combat.rm > before.rm, 'más maná y RM');
    assert.equal(p.mp, p.combat.maxMp, 'maná al máximo');
});

test('/gm bis: lo que llevaba puesto vuelve a la bolsa y se puede repetir sin duplicar slots', () => {
    const { w, p } = join('mago');
    const bag0 = p.econ!.bag.length;
    w.gmCommand('s-1', 'bis', []); assert.equal(p.econ!.bag.length, bag0 + 2, 'vuelven el báculo y la túnica iniciales');
    w.gmCommand('s-1', 'bis', []); assert.equal(Object.values(p.econ!.eq).filter(Boolean).length, 4);
});

test('/gm bis: por ahora solo existe para el mago', () => {
    const { w, p } = join('guerrero');
    const eq0 = JSON.stringify(p.econ!.eq);
    assert.match(w.gmCommand('s-1', 'bis', [])[0], /solo existe para el Mago/);
    assert.equal(JSON.stringify(p.econ!.eq), eq0, 'no toca nada');
});
