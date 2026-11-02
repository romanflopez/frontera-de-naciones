/**
 * Mobs del mundo: el server los simula (IA, vida, daño, respawn) y los jugadores solo los ven.
 * Port de la lógica que antes corría en cada navegador (apps/client/src/main.ts): mismos números.
 */
import type { ClientMessage, ServerMessage } from '@fdn/proto';
import { MOB_AGGRO, MOB_ASSIST, MOB_TYPES, mobDef, zoneRespawnSecs, type MobDef, type MobType, type WorldMap, type Zone } from '@fdn/world';
import * as M from './messages.ts';
import type { Player } from './player.ts';
import { BURN_EVERY, BURN_TICKS, PVP_SPELLS, aoeMult, burnTickDmg, rollSpellDamage, spellDmgKind, threatOf } from './systems/pvpCombat.ts';
import { ANTI_DAMAGE_MULT, CRIT_MULT, EXPLOSION_MULT, EXPLOSION_RADIUS, FLEE_HP_FRAC, FLEE_SECS, FLEE_SPEED_MULT, MUTANT_CHANCE, POISON_SECS, SKILL_CHANCE, SKILL_TRAITS, TOXIC_FRACTION, TOXIC_TICKS, TRAIT_ANTI_MAGIC, TRAIT_ANTI_PHYS, TRAIT_EXPLOSIVE, TRAIT_MUTANT, TRAIT_TOXIC, TRAIT_WILD, fleeChance, traitDmgMult, traitHpMult } from '@fdn/world';

type Pkt<K extends string> = Extract<NonNullable<ClientMessage['payload']>, { $case: K }>['value'];

/** Lo que el simulador necesita del mundo. */
export interface MobHost {
    players(): Iterable<Player>;
    playerById(id: bigint): Player | undefined;
    nearby(cx: number, cy: number): Player[];
    after(ms: number, fn: () => void): void;
    /** Le saca vida al jugador en el server (defensa incluida) y avisa. */
    hurt(p: Player, raw: number, source: string, srcId?: string): void;
    /** Paraliza al jugador (si no es inmune): devuelve los segundos que quedó. */
    stun(p: Player, secs: number): number;
    /** Botín y exp del golpe final: lo decide y lo aplica el server (economía autoritativa). */
    /** Cobra maná en el server si alcanza (devuelve false si no). */
    pay(p: Player, cost: number): boolean;
    /** Cura al jugador en el server (robo de vida) y avisa. */
    heal(p: Player, n: number): void;
    reward(killer: Player, info: { mobId: number; type: MobType; def: MobDef; zoneName: string; origin: 'loose' | 'pit' | 'dungeon'; x: number; y: number; shard?: 'cripta' | 'foso'; /** rasgos del mob (mobTraits.ts): multiplican la exp y el botín */ traits: number }): void;
    /** Murió un mob con dueño del golpe final: el mundo tira el botín de suelo (systems/loot.ts). Opcional (tests). */
    mobDied?(info: { type: MobType; def: MobDef; x: number; y: number; gm: boolean }): void;
}

interface SimMob {
    id: number; type: MobType; def: MobDef; typeIdx: number; zone: Zone; zoneIdx: number;
    x: number; y: number; hp: number; hpMax: number;
    state: 'idle' | 'chase' | 'return' | 'flee'; target: bigint | null; lastAttacker: bigint | null;
    wx: number; wy: number; wait: number; nextAtk: number; nextSp: number; busy: number;
    par: number; imm: number; slow: number; poison: number; poisonTick: number; moving: boolean; dead: boolean;
    /** Rasgos (mobTraits.ts), multiplicador de daño y huida: ya intentó huir / hasta cuándo corre. */
    traits: number; fled: boolean; fleeUntil: number;
    /** Invocado con /gm mob: no reaparece al morir. */
    gm?: boolean;
    /** Amenaza por jugador (K4): el mob persigue al que más amenaza le generó, salvo que esté provocado. */
    threat: Map<bigint, number>; tauntBy: bigint | null; tauntUntil: number;
    /** Quemadura: hasta cuándo, próximo pulso, daño por pulso y quién la puso. */
    burn: number; burnTick: number; burnDmg: number; burnBy: bigint | null;
}

interface Budget { tokens: number; t: number; dead: boolean; lvl: number }

const rint = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const SNAP_EVERY = 0.1;
/** Un poco más que el radio de visión del mundo, para que no "aparezcan" mobs en el borde. */
const VIEW_X = 20, VIEW_Y = 13;
/** Un mob quieto sin ningún jugador a menos de esta distancia (en caja) no se simula: nadie lo ve y no puede aggrear. */
const SLEEP_DIST = 26;

export class MobSim {
    private readonly mobs = new Map<number, SimMob>();
    private nextId = 1;
    private lastUpdate = Date.now();
    private snapT = 0;
    private readonly N: number;
    /** Presupuesto de golpes por jugador (evita ráfagas falsas): se recarga con el tiempo. */
    private readonly budget = new WeakMap<Player, Budget>();
    /** Celdas donde puede nacer un mob de cada zona (caminables, fuera de la zona segura, dentro del cuadrado ±r): se calculan una vez. */
    private readonly spawnCells: Int32Array[] = [];

    constructor(private readonly map: WorldMap, private readonly host: MobHost) {
        this.N = map.size;
        map.zones.forEach((z, zi) => {
            const cells: number[] = [];
            for (let y = Math.max(0, Math.floor(z.y - z.r)); y <= Math.min(this.N - 1, Math.floor(z.y + z.r)); y++)
                for (let x = Math.max(0, Math.floor(z.x - z.r)); x <= Math.min(this.N - 1, Math.floor(z.x + z.r)); x++)
                    if (this.walk(x, y) && !map.safe[y]?.[x]) cells.push(y * this.N + x);
            this.spawnCells[zi] = Int32Array.from(cells);
        });
        map.zones.forEach((z, zi) => { for (let i = 0; i < z.n; i++) this.spawn(z, zi); });
    }

    get count(): number { return this.mobs.size; }
    /** Mobs que se simularon en el último update (los quietos lejos de todo jugador duermen). */
    awake = 0;
    /** Cantidad de mobs vivos de cada zona (por índice en map.zones): para los tests y las mediciones. */
    countByZone(): number[] { const out = this.map.zones.map(() => 0); for (const m of this.mobs.values()) if (!m.dead) out[m.zoneIdx]++; return out; }
    /** Mobs vivos con posición (tests). */
    list(): { id: number; zoneIdx: number; x: number; y: number; hp: number }[] { return [...this.mobs.values()].filter((m) => !m.dead).map((m) => ({ id: m.id, zoneIdx: m.zoneIdx, x: m.x, y: m.y, hp: m.hp })); }

    private walk(x: number, y: number) { return x >= 0 && y >= 0 && x < this.N && y < this.N && !this.map.blocked[y][x]; }
    private isSafe(gx: number, gy: number) { const x = Math.floor(gx), y = Math.floor(gy); return x >= 0 && y >= 0 && x < this.N && y < this.N && this.map.safe[y][x]; }
    private now() { return Date.now() / 1000; }

    private spawn(z: Zone, zi: number) {
        const cells = this.spawnCells[zi]; if (!cells?.length) return;
        // celda al azar entre las válidas; en los pits densos se prueba un par de veces para no nacer encima de otro mob
        let x = 0, y = 0;
        for (let i = 0; i < 6; i++) {
            const c = cells[Math.floor(Math.random() * cells.length)]; x = c % this.N; y = Math.floor(c / this.N);
            let crowded = false;
            if (i < 5) for (const o of this.mobs.values()) if (o.zoneIdx === zi && Math.abs(o.x - x - 0.5) < 0.9 && Math.abs(o.y - y - 0.5) < 0.9) { crowded = true; break; }
            if (!crowded) break;
        }
        {
            const d = mobDef(z.type, z), T = this.now(), id = this.nextId++, traits = this.rollTraits(z, d);
            const hpMax = Math.round(d.hp * traitHpMult(traits));
            this.mobs.set(id, {
                id, type: z.type, def: d, typeIdx: MOB_TYPES.indexOf(z.type), zone: z, zoneIdx: zi, x: x + 0.5, y: y + 0.5, hp: hpMax, hpMax,
                state: 'idle', target: null, lastAttacker: null, wx: x + 0.5, wy: y + 0.5, wait: Math.random() * 2, nextAtk: 0, nextSp: T + 4, busy: 0,
                par: 0, imm: 0, slow: 0, poison: 0, poisonTick: 0, moving: false, dead: false, traits, fled: false, fleeUntil: 0,
                threat: new Map(), tauntBy: null, tauntUntil: 0, burn: 0, burnTick: 0, burnDmg: 0, burnBy: null,
            });
        }
    }

    /** Rasgos al nacer: los jefes no tienen; los mobs sueltos son salvajes (+25 % de exp); en pozos y mazmorras puede salir un mutante y/o una habilidad. */
    private rollTraits(z: Zone, d: MobDef): number {
        if (d.boss) return 0;
        let t = 0;
        if (z.name.startsWith('Merodeadores')) t |= TRAIT_WILD;
        else {
            if (Math.random() < MUTANT_CHANCE) t |= TRAIT_MUTANT;
            if (Math.random() < SKILL_CHANCE) t |= SKILL_TRAITS[Math.floor(Math.random() * SKILL_TRAITS.length)];
        }
        return t;
    }

    /**
     * SOLO GM (/gm mob): invoca `n` mobs de `type` alrededor de (cx, cy), sin reaparición. `zoneIdx` es la zona del mapa que el cliente usa
     * para dibujarlos (escala y sprite); devuelve cuántos pudo poner.
     */
    summon(type: MobType, lvl: number | undefined, cx: number, cy: number, n: number, zoneIdx: number): number {
        const zone: Zone = { type, x: cx, y: cy, r: 4, n: 0, name: 'GM', lvl };
        let done = 0;
        for (let k = 0; k < n; k++) for (let i = 0; i < 60; i++) {
            const x = Math.floor(cx + (Math.random() * 2 - 1) * (2 + i / 8)), y = Math.floor(cy + (Math.random() * 2 - 1) * (2 + i / 8));
            if (!this.walk(x, y) || this.map.safe[y]?.[x] || (x === Math.floor(cx) && y === Math.floor(cy))) continue;
            const d = mobDef(type, zone), T = this.now(), id = this.nextId++;
            this.mobs.set(id, {
                id, type, def: d, typeIdx: MOB_TYPES.indexOf(type), zone, zoneIdx, x: x + 0.5, y: y + 0.5, hp: d.hp, hpMax: d.hp,
                state: 'idle', target: null, lastAttacker: null, wx: x + 0.5, wy: y + 0.5, wait: 0, nextAtk: 0, nextSp: T + 4, busy: 0,
                par: 0, imm: 0, slow: 0, poison: 0, poisonTick: 0, moving: false, dead: false, gm: true, traits: 0, fled: false, fleeUntil: 0,
                threat: new Map(), tauntBy: null, tauntUntil: 0, burn: 0, burnTick: 0, burnDmg: 0, burnBy: null,
            });
            done++; break;
        }
        return done;
    }

    /** SOLO GM (/gm limpiar): saca los mobs invocados con /gm mob. */
    clearGm(): number {
        let n = 0;
        for (const [id, m] of this.mobs) if (m.gm) { this.mobs.delete(id); n++; }
        return n;
    }

    private eligible(p: Player | undefined): p is Player {
        if (!p || p.disconnected) return false;
        if (this.budget.get(p)?.dead || p.isDead || p.status.isInvisible) return false;
        return !this.isSafe(p.posX + 0.5, p.posY + 0.5);
    }

    private step(m: SimMob, tx: number, ty: number, spd: number, dt: number): boolean {
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy); if (d < 0.02) return true;
        const s = Math.min(d, spd * (m.slow > this.now() ? 0.5 : 1) * dt), nx = m.x + (dx / d) * s, ny = m.y + (dy / d) * s;
        const ok = (x: number, y: number) => this.walk(Math.floor(x), Math.floor(y)) && !this.isSafe(x, y);
        if (ok(nx, ny)) { m.x = nx; m.y = ny; } else if (ok(nx, m.y)) m.x = nx; else if (ok(m.x, ny)) m.y = ny;
        m.moving = true; return false;
    }

    private aggro(m: SimMob, target: Player | null) {
        if (m.state === 'flee') return; // huyendo: no se contagia ni vuelve a pelear hasta terminar
        if (target) m.target = target.playerId;
        if (m.state === 'chase') return;
        m.state = 'chase';
        const T = this.now(), assist = Math.min(MOB_ASSIST, (m.zone.aggro ?? MOB_AGGRO) * 0.7);
        for (const o of this.mobs.values()) if (o !== m && o.state === 'idle' && o.zone === m.zone && Math.hypot(o.x - m.x, o.y - m.y) < assist) { o.state = 'chase'; o.target = m.target; o.nextAtk = T + 0.4 + Math.random() * 0.6; }
    }

    // ---------- amenaza y provocación (K4) ----------
    private addThreat(m: SimMob, p: Player, amount: number) { if (amount > 0) m.threat.set(p.playerId, (m.threat.get(p.playerId) ?? 0) + amount); }
    /** Provoca a `m`: durante `secs` ataca a `p` aunque otro tenga más amenaza. */
    private taunt(m: SimMob, p: Player, secs: number) {
        const T = this.now();
        m.tauntBy = p.playerId; m.tauntUntil = T + secs; m.target = p.playerId;
        this.addThreat(m, p, 1); // queda en la tabla aunque no le haya pegado
        if (m.state === 'idle' || m.state === 'return') { m.state = 'idle'; this.aggro(m, p); }
    }
    /** Mandato: provoca a todos los monstruos vivos a `r` celdas de (x, y). Devuelve cuántos. */
    tauntNear(p: Player, x: number, y: number, r: number, secs: number): number {
        let n = 0;
        for (const m of this.mobs.values()) if (!m.dead && m.state !== 'flee' && Math.hypot(m.x - x, m.y - y) <= r) { this.taunt(m, p, secs); n++; }
        return n;
    }
    /** A quién persigue: el que lo provocó (si sigue elegible) o el de más amenaza; si no hay, el de antes. */
    private pickTarget(m: SimMob, T: number): Player | undefined {
        if (m.tauntBy != null && m.tauntUntil > T) { const t = this.host.playerById(m.tauntBy); if (this.eligible(t)) return t; }
        let best: Player | undefined, bt = -1;
        for (const [id, v] of m.threat) { const p = this.host.playerById(id); if (!this.eligible(p)) continue; if (v > bt) { bt = v; best = p; } }
        return best ?? (m.target != null ? this.host.playerById(m.target) : undefined);
    }
    private clearThreat(m: SimMob) { m.threat.clear(); m.tauntBy = null; m.tauntUntil = 0; }
    /** Amenaza que lleva `p` sobre el mob `id` (para tests y depuración). */
    threatOn(id: number, p: Player): number { return this.mobs.get(id)?.threat.get(p.playerId) ?? 0; }
    targetOf(id: number): bigint | null { return this.mobs.get(id)?.target ?? null; }

    private nearestPlayer(m: SimMob, maxD: number): Player | null {
        let best: Player | null = null, bd = maxD;
        for (const p of this.host.players()) { if (!this.eligible(p)) continue; const d = Math.hypot(p.posX + 0.5 - m.x, p.posY + 0.5 - m.y); if (d <= bd) { bd = d; best = p; } }
        return best;
    }

    update(): void {
        const nowMs = Date.now(), dt = Math.min(0.25, (nowMs - this.lastUpdate) / 1000); this.lastUpdate = nowMs;
        const T = nowMs / 1000;
        // posiciones de los jugadores conectados (para dormir a los mobs quietos lejos de todos) y lista de los que persiguen (empuje)
        const pxs: number[] = [], pys: number[] = [];
        for (const p of this.host.players()) if (!p.disconnected) { pxs.push(p.posX); pys.push(p.posY); }
        const chasing: SimMob[] = [];
        for (const m of this.mobs.values()) if (m.state === 'chase' && !m.dead) chasing.push(m);
        this.awake = 0;
        for (const m of [...this.mobs.values()]) {
            if (m.dead) continue;
            if (m.state === 'idle' && m.poison <= T && m.burn <= T) {
                let near = false;
                for (let i = 0; i < pxs.length; i++) if (Math.abs(pxs[i] - m.x) < SLEEP_DIST && Math.abs(pys[i] - m.y) < SLEEP_DIST) { near = true; break; }
                if (!near) { m.moving = false; continue; }
            }
            this.awake++;
            m.moving = false;
            if (m.poison > T && T >= m.poisonTick) {
                m.poisonTick = T + 1; m.hp -= 3;
                const killer = m.lastAttacker != null ? this.host.playerById(m.lastAttacker) : undefined;
                this.broadcastNear(m, M.mobDamaged(m.id, m.lastAttacker ?? 0n, 3, false, Math.max(0, m.hp)));
                this.broadcastNear(m, M.combatText(M.mid(m.id), m.lastAttacker != null ? M.pid(m.lastAttacker) : '', 3, false, ''));
                if (m.hp <= 0) { this.kill(m, killer ?? null); continue; }
            }
            if (m.burn > T && T >= m.burnTick) { // quemadura: ¼ del Daño base dos veces por segundo
                m.burnTick = T + BURN_EVERY; m.hp -= m.burnDmg;
                const by = m.burnBy != null ? this.host.playerById(m.burnBy) : undefined;
                this.broadcastNear(m, M.mobDamaged(m.id, m.burnBy ?? 0n, m.burnDmg, false, Math.max(0, m.hp)));
                this.broadcastNear(m, M.combatText(M.mid(m.id), m.burnBy != null ? M.pid(m.burnBy) : '', m.burnDmg, false, 'quemadura'));
                if (by) this.addThreat(m, by, m.burnDmg);
                if (m.hp <= 0) { this.kill(m, by ?? null); continue; }
            }
            if (m.par > T) continue;
            const d = m.def, home = { x: m.zone.x + 0.5, y: m.zone.y + 0.5 };
            if (m.state === 'idle') {
                const near = this.nearestPlayer(m, m.zone.aggro ?? MOB_AGGRO);
                if (near) this.aggro(m, near);
                else {
                    m.wait -= dt;
                    if (m.wait <= 0) {
                        if (this.step(m, m.wx, m.wy, d.spd * 0.45, dt)) {
                            m.wait = 1.5 + Math.random() * 3;
                            m.wx = clamp(m.zone.x + (Math.random() * 2 - 1) * m.zone.r, 1, this.N - 2);
                            m.wy = clamp(m.zone.y + (Math.random() * 2 - 1) * m.zone.r, 1, this.N - 2);
                        } else m.wait = 0;
                    }
                }
            } else if (m.state === 'chase') {
                let tgt = this.pickTarget(m, T);
                if (!this.eligible(tgt)) { tgt = this.nearestPlayer(m, 6) ?? undefined; }
                m.target = tgt ? tgt.playerId : null;
                if (!tgt || Math.hypot(m.x - home.x, m.y - home.y) > 17) { m.state = 'return'; m.target = null; this.clearThreat(m); continue; }
                const px = tgt.posX + 0.5, py = tgt.posY + 0.5, dp = Math.hypot(m.x - px, m.y - py);
                if (T < m.busy) continue; // cargando la habilidad: se queda quieto
                const sp = d.boss?.special;
                if (sp && T >= m.nextSp && dp <= sp.range) { this.special(m, T); continue; }
                const rg = d.ranged;
                const los = rg ? this.clearShot(m.x, m.y, px, py) : false;
                if (rg) {
                    // a distancia: acercarse hasta tener tiro (a rango y con línea libre), quedarse, y retroceder si lo pisan
                    if (dp > rg.range * 0.95 || !los) this.step(m, px, py, d.spd, dt);
                    else if (dp < rg.keep * 0.6) this.step(m, m.x + (m.x - px), m.y + (m.y - py), d.spd * 0.8, dt);
                } else if (dp > 1.1) this.step(m, px, py, d.spd, dt);
                for (const o of chasing) {
                    if (o === m || o.state !== 'chase') continue;
                    const sx = m.x - o.x, sy = m.y - o.y, sd = Math.hypot(sx, sy);
                    if (sd > 0.01 && sd < 0.85) {
                        const k = (0.85 - sd) * dt * 3, nx = m.x + (sx / sd) * k, ny = m.y + (sy / sd) * k;
                        if (this.walk(Math.floor(nx), Math.floor(ny)) && !this.isSafe(nx, ny)) { m.x = nx; m.y = ny; }
                    }
                }
                if (rg) {
                    if (los && dp <= rg.range && T >= m.nextAtk) this.shoot(m, tgt, px, py, dp, T);
                } else if (dp <= 1.5 && T >= m.nextAtk) {
                    m.nextAtk = T + d.atk;
                    this.broadcastNear(m, M.mobAttack(m.id, px, py));
                    const dmg = Math.round(rint(d.dmg[0], d.dmg[1]) * traitDmgMult(m.traits)), tid = tgt.playerId;
                    this.host.after(200, () => {
                        const p = this.host.playerById(tid);
                        if (!this.mobs.has(m.id) || m.par > this.now() || !this.eligible(p)) return;
                        if (Math.hypot(m.x - (p.posX + 0.5), m.y - (p.posY + 0.5)) < 1.8) { p.send(M.mobHitPlayer(m.id, dmg, 0)); this.host.hurt(p, dmg, d.name, M.mid(m.id)); this.toxic(m, p, dmg); }
                    });
                }
            } else if (m.state === 'flee') {
                // corre en dirección contraria a quien lo atacó (o al jugador más cercano); al terminar vuelve a casa y se cura
                const from = (m.lastAttacker != null ? this.host.playerById(m.lastAttacker) : undefined) ?? this.nearestPlayer(m, 12);
                if (T >= m.fleeUntil || !from || Math.hypot(m.x - home.x, m.y - home.y) > 17) { m.state = 'return'; m.target = null; continue; }
                const fx = from.posX + 0.5, fy = from.posY + 0.5;
                this.step(m, m.x + (m.x - fx), m.y + (m.y - fy), d.spd * FLEE_SPEED_MULT, dt);
            } else if (m.state === 'return') {
                if (this.step(m, home.x, home.y, d.spd * 1.3, dt) || Math.hypot(m.x - home.x, m.y - home.y) < 0.5) { m.state = 'idle'; m.hp = m.hpMax; this.clearThreat(m); m.burn = 0; }
            }
        }
        this.snapT += dt;
        if (this.snapT >= SNAP_EVERY) { this.snapT = 0; this.sendSnapshots(); }
    }

    /** ¿Hay línea libre entre (x0, y0) y (x1, y1)? Muestrea cada 0,25 celdas y corta con la primera celda bloqueada (los extremos no cuentan). */
    clearShot(x0: number, y0: number, x1: number, y1: number): boolean {
        const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.25);
        for (let i = 1; i < n; i++) { const k = i / n; if (!this.walk(Math.floor(x0 + (x1 - x0) * k), Math.floor(y0 + (y1 - y0) * k))) return false; }
        return true;
    }

    /**
     * Disparo de un mob a distancia: avisa a los cercanos (animación + proyectil visual) y el daño llega cuando el proyectil llega, con las
     * mismas reglas de defensa que el cuerpo a cuerpo (`host.hurt`). Pega solo si el jugador sigue a menos de 1 celda del punto apuntado.
     */
    private shoot(m: SimMob, tgt: Player, px: number, py: number, dp: number, T: number) {
        const rg = m.def.ranged!, d = m.def;
        m.nextAtk = T + d.atk;
        const travel = Math.max(120, Math.round((dp / rg.speed) * 1000));
        this.broadcastNear(m, M.mobAttack(m.id, px, py));
        this.broadcastNear(m, M.mobProjectile(m.id, m.x, m.y, px, py, travel, rg.kind));
        const dmg = Math.round(rint(d.dmg[0], d.dmg[1]) * traitDmgMult(m.traits)), tid = tgt.playerId;
        this.host.after(travel, () => {
            const p = this.host.playerById(tid);
            if (!this.mobs.has(m.id) || !this.eligible(p)) return;
            if (Math.hypot(px - (p.posX + 0.5), py - (p.posY + 0.5)) < 1.0) { p.send(M.mobHitPlayer(m.id, dmg, 0)); this.host.hurt(p, dmg, d.name, M.mid(m.id)); this.toxic(m, p, dmg); }
        });
    }

    /** Tóxico: el golpe deja un sangrado (3 ticks de 1 s) que pega TOXIC_FRACTION del golpe cada vez. */
    private toxic(m: SimMob, p: Player, dmg: number) {
        if (!(m.traits & TRAIT_TOXIC)) return;
        const tick = Math.max(1, Math.round(dmg * TOXIC_FRACTION)), tid = p.playerId;
        for (let i = 1; i <= TOXIC_TICKS; i++) this.host.after(i * 1000, () => { const q = this.host.playerById(tid); if (this.eligible(q)) { q.send(M.mobHitPlayer(m.id, tick, 0)); this.host.hurt(q, tick, m.def.name, M.mid(m.id)); } });
    }

    /** Huida: al caer por debajo de FLEE_HP_FRAC de vida, un mob cobarde (según su tipo) corre unos segundos; los jefes y los paralizados no huyen. */
    private checkFlee(m: SimMob) {
        if (m.fled || m.state === 'flee' || m.dead || m.def.boss || m.hp <= 0 || m.hp > m.hpMax * FLEE_HP_FRAC) return;
        const T = this.now(); if (m.par > T) return; // paralizado no huye (se vuelve a evaluar con el próximo golpe)
        m.fled = true;
        if (Math.random() < fleeChance(m.type)) { m.state = 'flee'; m.fleeUntil = T + FLEE_SECS; m.target = null; }
    }

    /** Habilidad de boss: aviso, 0,8 s de carga y recién ahí pega a quien esté dentro del radio. */
    private special(m: SimMob, T: number) {
        const sp = m.def.boss!.special;
        m.nextSp = T + sp.every; m.busy = T + 1.1; m.nextAtk = Math.max(m.nextAtk, T + 1.4);
        this.broadcastNear(m, M.mobSpecialEvent(m.id, 0, m.x, m.y));
        this.host.after(800, () => {
            if (!this.mobs.has(m.id) || m.par > this.now()) return;
            this.broadcastNear(m, M.mobSpecialEvent(m.id, 1, m.x, m.y));
            for (const p of this.host.nearby(m.x, m.y)) {
                if (!this.eligible(p) || Math.hypot(m.x - (p.posX + 0.5), m.y - (p.posY + 0.5)) > sp.r) continue;
                const dmg = sp.dmg ? rint(sp.dmg[0], sp.dmg[1]) : 0, stun = sp.stun ? this.host.stun(p, sp.stun) : 0;
                p.send(M.mobHitPlayer(m.id, dmg, stun)); if (dmg > 0) this.host.hurt(p, dmg, m.def.name, M.mid(m.id));
            }
        });
    }

    private broadcastNear(m: { x: number; y: number }, msg: ServerMessage) { for (const p of this.host.nearby(m.x, m.y)) p.send(msg); }

    private kill(m: SimMob, killer: Player | null) {
        m.dead = true; this.mobs.delete(m.id);
        if (killer) this.host.reward(killer, { mobId: m.id, type: m.type, def: m.def, zoneName: m.zone.name, origin: m.zone.tier === 'dungeon' ? 'dungeon' : m.zone.name.startsWith('Merodeadores') ? 'loose' : 'pit', x: m.x, y: m.y, shard: m.zone.drops?.shard, traits: m.traits }); // una sola vez: el mob ya salió del mapa
        if (m.traits & TRAIT_EXPLOSIVE) { // explosivo: al morir pega a todos los jugadores cercanos (aunque no sea el que lo mató)
            const dmg = Math.round(((m.def.dmg[0] + m.def.dmg[1]) / 2) * EXPLOSION_MULT * traitDmgMult(m.traits));
            for (const q of this.host.nearby(m.x, m.y)) if (this.eligible(q) && Math.hypot(m.x - (q.posX + 0.5), m.y - (q.posY + 0.5)) <= EXPLOSION_RADIUS) { q.send(M.mobHitPlayer(m.id, dmg, 0)); this.host.hurt(q, dmg, `${m.def.name} (explosión)`, M.mid(m.id)); }
        }
        this.broadcastNear(m, M.mobDied(m.id, killer ? killer.playerId : 0n, m.x, m.y, m.typeIdx, m.zoneIdx));
        if (killer) this.host.mobDied?.({ type: m.type, def: m.def, x: m.x, y: m.y, gm: !!m.gm }); // después del mobDied: el cliente ya sacó al mob cuando aparece el botín
        if (!m.gm) this.host.after(zoneRespawnSecs(m.type, m.zone) * 1000, () => this.spawn(m.zone, m.zoneIdx));
    }

    private sendSnapshots() {
        const T = this.now();
        for (const p of this.host.players()) {
            if (p.disconnected) continue;
            const list = [];
            for (const m of this.mobs.values()) {
                if (Math.abs(m.x - p.posX) > VIEW_X || Math.abs(m.y - p.posY) > VIEW_Y) continue;
                list.push({ id: m.id, type: m.typeIdx, zone: m.zoneIdx, x: m.x, y: m.y, hp: Math.max(0, Math.round(m.hp)), par: Math.max(0, m.par - T), imm: Math.max(0, m.imm - T), poison: m.poison > T, moving: m.moving, traits: m.traits });
            }
            p.send(M.mobsSnapshot(list));
        }
    }

    // ---------- habilidades de clase del server (carga, giro) ----------
    /** Mobs vivos a menos de `r` celdas del centro de (cx, cy), fuera de la zona segura. */
    near(cx: number, cy: number, r: number): { id: number; x: number; y: number }[] {
        const out = [];
        for (const m of this.mobs.values()) if (!m.dead && Math.hypot(m.x - cx, m.y - cy) <= r && !this.isSafe(m.x, m.y)) out.push({ id: m.id, x: m.x, y: m.y });
        return out;
    }
    get(id: number): { id: number; x: number; y: number } | undefined { const m = this.mobs.get(id); return m && !m.dead && !this.isSafe(m.x, m.y) ? { id: m.id, x: m.x, y: m.y } : undefined; }
    /** Daño ya calculado por el server (sin tope del cliente) + ralentización opcional. */
    skillHit(p: Player, id: number, dmg: number, slowSecs = 0, skill = '', stunSecs = 0): void {
        const m = this.mobs.get(id); if (!m || m.dead) return;
        const T = this.now();
        if (slowSecs > 0) m.slow = T + slowSecs;
        if (stunSecs > 0 && m.imm <= T) { m.par = T + stunSecs; m.imm = T + stunSecs + 8; m.moving = false; } // aturdido (corta la carga de un jefe)
        if (m.traits & TRAIT_ANTI_PHYS) dmg = Math.max(1, Math.round(dmg * ANTI_DAMAGE_MULT)); // las habilidades de guerrero son físicas
        m.lastAttacker = p.playerId; m.hp -= dmg; this.addThreat(m, p, dmg * threatOf(skill));
        if (m.par > T && dmg >= m.hpMax * 0.45) m.par = 0;
        this.broadcastNear(m, M.mobDamaged(m.id, p.playerId, dmg, false, Math.max(0, m.hp)));
        this.broadcastNear(m, M.combatText(M.mid(m.id), M.pid(p.playerId), dmg, false, skill));
        this.checkFlee(m);
        if (m.state !== 'flee' && (m.state === 'idle' || m.target == null)) this.aggro(m, p);
        if (m.hp <= 0) this.kill(m, p);
    }

    // ---------- paquetes del cliente ----------
    private bud(p: Player): Budget {
        let b = this.budget.get(p);
        if (!b) { b = { tokens: 40, t: Date.now(), dead: false, lvl: 1 }; this.budget.set(p, b); }
        return b;
    }

    status(p: Player, v: Pkt<'pveStatusRequest'>) {
        const b = this.bud(p);
        b.dead = !!v.dead; b.lvl = p.combat.lvl; // el nivel es el del server, no el que diga el cliente
    }

    /**
     * Golpe de un jugador a un mob. Desde el paso 1.3 el cliente solo dice QUÉ hechizo usó y sobre quién: el daño, el crítico,
     * el veneno, el robo de vida, la recarga y el maná los calcula el server con el equipo y los stats que él guarda.
     */
    hit(p: Player, v: Pkt<'mobHitRequest'>) {
        const b = this.bud(p);
        const nowMs = Date.now(); b.tokens = Math.min(40, b.tokens + ((nowMs - b.t) / 1000) * 20); b.t = nowMs;
        if (b.dead || p.disconnected || b.tokens < 1) return;
        const m = this.mobs.get(v.mobId); if (!m || m.dead) return;
        const spell = /^[a-z0-9]{1,16}$/.test(v.spell ?? '') ? v.spell : '', sp = PVP_SPELLS[spell];
        if (!sp) return; // sin hechizo conocido no hay golpe
        if (Math.hypot(p.posX + 0.5 - m.x, p.posY + 0.5 - m.y) > sp.range + (sp.aoe ?? 0) + 2.5) return;
        b.tokens -= 1;
        const T = this.now();
        const wantsSecs = (Number(v.parSecs) || 0) > 0;
        if (!p.pvp.allow(spell, BigInt(m.id), nowMs, (c) => this.host.pay(p, c))) return; // recarga, ritmo de ataque o sin maná
        let dmg = sp.dmg ? rollSpellDamage(spell, p.combat, p.pvp.fury(nowMs)) : 0, crit = false;
        if (dmg > 0 && sp.aoe) { // área: tope de objetivos por lanzamiento y menos daño por cada uno extra (el cliente manda los más cercanos al centro primero)
            const slot = p.pvp.aoeSlot(spell, nowMs); if (slot < 0) return;
            dmg = Math.max(1, Math.round(dmg * aoeMult(slot)));
        }
        if (dmg > 0 && sp.vsCtrl && m.par > T) dmg = Math.round(dmg * sp.vsCtrl);   // Esquirla, Juicio, Escudo: más contra congelados o aturdidos
        if (dmg > 0 && sp.vsBurn && m.burn > T) dmg = Math.round(dmg * sp.vsBurn);   // Bola de fuego sobre un quemado
        const phys = spellDmgKind(spell) === 'phys';
        if (dmg > 0 && ((phys && m.traits & TRAIT_ANTI_PHYS) || (!phys && m.traits & TRAIT_ANTI_MAGIC))) dmg = Math.max(1, Math.round(dmg * ANTI_DAMAGE_MULT)); // anti-físico / anti-mágico
        if (dmg > 0 && spell === 'ataque' && Math.random() * 100 < p.combat.crit) { crit = true; dmg = Math.round(dmg * CRIT_MULT); }
        const parSecs = wantsSecs && sp.secs && p.pvp.allowSecs(spell, BigInt(m.id), nowMs) ? sp.secs : 0;
        const poisonSecs = dmg > 0 && phys && p.combat.poison > 0 && Math.random() * 100 < p.combat.poison ? POISON_SECS : 0;
        if (dmg <= 0 && parSecs <= 0) return;
        if (parSecs > 0 && m.imm <= T) { m.par = T + parSecs; m.imm = T + parSecs + 8; m.moving = false; }
        if (dmg > 0 && sp.slow) m.slow = T + sp.slow;                                  // Esquirla: frena
        if (dmg > 0 && sp.burn) { m.burn = T + BURN_TICKS * BURN_EVERY + 0.05; m.burnTick = T + BURN_EVERY; m.burnDmg = burnTickDmg(p.combat); m.burnBy = p.playerId; } // una sola por mob: la nueva reemplaza
        if (sp.taunt) this.taunt(m, p, sp.taunt);                                       // Martillo: provoca
        if (poisonSecs > 0) m.poison = T + poisonSecs;
        m.lastAttacker = p.playerId;
        if (dmg > 0) {
            const dealt = Math.min(dmg, Math.max(0, m.hp));
            m.hp -= dmg;
            if (m.par > T && dmg >= m.hpMax * 0.45) m.par = 0; // un golpe fuerte rompe la parálisis
            this.broadcastNear(m, M.mobDamaged(m.id, p.playerId, dmg, crit, Math.max(0, m.hp)));
            this.broadcastNear(m, M.combatText(M.mid(m.id), M.pid(p.playerId), dmg, false, spell === 'ataque' ? '' : spell));
            if (phys && p.combat.leech > 0 && dealt > 0) this.host.heal(p, Math.max(1, Math.round((dealt * p.combat.leech) / 100))); // robo de vida: de lo que de verdad quitó
            if (sp.lifesteal && dealt > 0) this.host.heal(p, Math.max(1, Math.round(dealt * sp.lifesteal)));      // Juicio: se cura la mitad del daño
            this.addThreat(m, p, dmg * threatOf(spell));
        }
        this.checkFlee(m);
        if (m.state !== 'flee' && (m.state === 'idle' || m.target == null)) this.aggro(m, p);
        if (m.hp <= 0) this.kill(m, p);
    }
}
