/**
 * Mobs del mundo: el server los simula (IA, vida, daño, respawn) y los jugadores solo los ven.
 * Port de la lógica que antes corría en cada navegador (apps/client/src/main.ts): mismos números.
 */
import type { ClientMessage, ServerMessage } from '@fdn/proto';
import { MOB_AGGRO, MOB_ASSIST, MOB_TYPES, mobDef, zoneRespawnSecs, type MobDef, type MobType, type WorldMap, type Zone } from '@fdn/world';
import * as M from './messages.ts';
import type { Player } from './player.ts';

type Pkt<K extends string> = Extract<NonNullable<ClientMessage['payload']>, { $case: K }>['value'];

/** Lo que el simulador necesita del mundo. */
export interface MobHost {
    players(): Iterable<Player>;
    playerById(id: bigint): Player | undefined;
    nearby(cx: number, cy: number): Player[];
    after(ms: number, fn: () => void): void;
    /** Le saca vida al jugador en el server (defensa incluida) y avisa. */
    hurt(p: Player, raw: number, source: string): void;
    /** Paraliza al jugador (si no es inmune): devuelve los segundos que quedó. */
    stun(p: Player, secs: number): number;
    /** Botín y exp del golpe final: lo decide y lo aplica el server (economía autoritativa). */
    reward(killer: Player, info: { mobId: number; type: MobType; def: MobDef; zoneName: string; origin: 'loose' | 'pit' | 'dungeon'; x: number; y: number; shard?: 'cripta' | 'foso' }): void;
}

interface SimMob {
    id: number; type: MobType; def: MobDef; typeIdx: number; zone: Zone; zoneIdx: number;
    x: number; y: number; hp: number; hpMax: number;
    state: 'idle' | 'chase' | 'return'; target: bigint | null; lastAttacker: bigint | null;
    wx: number; wy: number; wait: number; nextAtk: number; nextSp: number; busy: number;
    par: number; imm: number; slow: number; poison: number; poisonTick: number; moving: boolean; dead: boolean;
    /** Invocado con /gm mob: no reaparece al morir. */
    gm?: boolean;
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
            const d = mobDef(z.type, z), T = this.now(), id = this.nextId++;
            this.mobs.set(id, {
                id, type: z.type, def: d, typeIdx: MOB_TYPES.indexOf(z.type), zone: z, zoneIdx: zi, x: x + 0.5, y: y + 0.5, hp: d.hp, hpMax: d.hp,
                state: 'idle', target: null, lastAttacker: null, wx: x + 0.5, wy: y + 0.5, wait: Math.random() * 2, nextAtk: 0, nextSp: T + 4, busy: 0,
                par: 0, imm: 0, slow: 0, poison: 0, poisonTick: 0, moving: false, dead: false,
            });
        }
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
                par: 0, imm: 0, slow: 0, poison: 0, poisonTick: 0, moving: false, dead: false, gm: true,
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
        if (target) m.target = target.playerId;
        if (m.state === 'chase') return;
        m.state = 'chase';
        const T = this.now(), assist = Math.min(MOB_ASSIST, (m.zone.aggro ?? MOB_AGGRO) * 0.7);
        for (const o of this.mobs.values()) if (o !== m && o.state === 'idle' && o.zone === m.zone && Math.hypot(o.x - m.x, o.y - m.y) < assist) { o.state = 'chase'; o.target = m.target; o.nextAtk = T + 0.4 + Math.random() * 0.6; }
    }

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
            if (m.state === 'idle' && m.poison <= T) {
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
                if (m.hp <= 0) { this.kill(m, killer ?? null); continue; }
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
                let tgt = m.target != null ? this.host.playerById(m.target) : undefined;
                if (!this.eligible(tgt)) { tgt = this.nearestPlayer(m, 6) ?? undefined; m.target = tgt ? tgt.playerId : null; }
                if (!tgt || Math.hypot(m.x - home.x, m.y - home.y) > 17) { m.state = 'return'; m.target = null; continue; }
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
                    const dmg = rint(d.dmg[0], d.dmg[1]), tid = tgt.playerId;
                    this.host.after(200, () => {
                        const p = this.host.playerById(tid);
                        if (!this.mobs.has(m.id) || m.par > this.now() || !this.eligible(p)) return;
                        if (Math.hypot(m.x - (p.posX + 0.5), m.y - (p.posY + 0.5)) < 1.8) { p.send(M.mobHitPlayer(m.id, dmg, 0)); this.host.hurt(p, dmg, d.name); }
                    });
                }
            } else if (m.state === 'return') {
                if (this.step(m, home.x, home.y, d.spd * 1.3, dt) || Math.hypot(m.x - home.x, m.y - home.y) < 0.5) { m.state = 'idle'; m.hp = m.hpMax; }
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
        const dmg = rint(d.dmg[0], d.dmg[1]), tid = tgt.playerId;
        this.host.after(travel, () => {
            const p = this.host.playerById(tid);
            if (!this.mobs.has(m.id) || !this.eligible(p)) return;
            if (Math.hypot(px - (p.posX + 0.5), py - (p.posY + 0.5)) < 1.0) { p.send(M.mobHitPlayer(m.id, dmg, 0)); this.host.hurt(p, dmg, d.name); }
        });
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
                p.send(M.mobHitPlayer(m.id, dmg, stun)); if (dmg > 0) this.host.hurt(p, dmg, m.def.name);
            }
        });
    }

    private broadcastNear(m: { x: number; y: number }, msg: ServerMessage) { for (const p of this.host.nearby(m.x, m.y)) p.send(msg); }

    private kill(m: SimMob, killer: Player | null) {
        m.dead = true; this.mobs.delete(m.id);
        if (killer) this.host.reward(killer, { mobId: m.id, type: m.type, def: m.def, zoneName: m.zone.name, origin: m.zone.tier === 'dungeon' ? 'dungeon' : m.zone.name.startsWith('Merodeadores') ? 'loose' : 'pit', x: m.x, y: m.y, shard: m.zone.drops?.shard }); // una sola vez: el mob ya salió del mapa
        this.broadcastNear(m, M.mobDied(m.id, killer ? killer.playerId : 0n, m.x, m.y, m.typeIdx, m.zoneIdx));
        if (!m.gm) this.host.after(zoneRespawnSecs(m.type, m.zone) * 1000, () => this.spawn(m.zone, m.zoneIdx));
    }

    private sendSnapshots() {
        const T = this.now();
        for (const p of this.host.players()) {
            if (p.disconnected) continue;
            const list = [];
            for (const m of this.mobs.values()) {
                if (Math.abs(m.x - p.posX) > VIEW_X || Math.abs(m.y - p.posY) > VIEW_Y) continue;
                list.push({ id: m.id, type: m.typeIdx, zone: m.zoneIdx, x: m.x, y: m.y, hp: Math.max(0, Math.round(m.hp)), par: Math.max(0, m.par - T), imm: Math.max(0, m.imm - T), poison: m.poison > T, moving: m.moving });
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
    skillHit(p: Player, id: number, dmg: number, slowSecs = 0): void {
        const m = this.mobs.get(id); if (!m || m.dead) return;
        const T = this.now();
        if (slowSecs > 0) m.slow = T + slowSecs;
        m.lastAttacker = p.playerId; m.hp -= dmg;
        if (m.par > T && dmg >= m.hpMax * 0.45) m.par = 0;
        this.broadcastNear(m, M.mobDamaged(m.id, p.playerId, dmg, false, Math.max(0, m.hp)));
        if (m.state === 'idle' || m.target == null) this.aggro(m, p);
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

    hit(p: Player, v: Pkt<'mobHitRequest'>) {
        const b = this.bud(p);
        const nowMs = Date.now(); b.tokens = Math.min(40, b.tokens + ((nowMs - b.t) / 1000) * 20); b.t = nowMs;
        if (b.dead || p.disconnected || b.tokens < 1) return;
        const m = this.mobs.get(v.mobId); if (!m || m.dead) return;
        const range = v.melee ? 4.5 : 11.5;
        if (Math.hypot(p.posX + 0.5 - m.x, p.posY + 0.5 - m.y) > range) return;
        b.tokens -= 1;
        const T = this.now();
        const dmg = clamp(Math.round(v.dmg) || 0, 0, 120 + p.combat.lvl * 20);
        const parSecs = clamp(Number(v.parSecs) || 0, 0, 5), poisonSecs = clamp(Number(v.poisonSecs) || 0, 0, 5);
        if (dmg <= 0 && parSecs <= 0 && poisonSecs <= 0) return;
        if (parSecs > 0 && m.imm <= T) { m.par = T + parSecs; m.imm = T + parSecs + 8; m.moving = false; }
        if (poisonSecs > 0) m.poison = T + poisonSecs;
        m.lastAttacker = p.playerId;
        if (dmg > 0) {
            m.hp -= dmg;
            if (m.par > T && dmg >= m.hpMax * 0.45) m.par = 0; // un golpe fuerte rompe la parálisis
            this.broadcastNear(m, M.mobDamaged(m.id, p.playerId, dmg, !!v.crit, Math.max(0, m.hp)));
        }
        if (m.state === 'idle' || m.target == null) this.aggro(m, p);
        if (m.hp <= 0) this.kill(m, p);
    }
}
