/**
 * Simulación del arranque (niveles 1-3): cuánto aguanta un Mago / Guerrero contra goblins comunes y de élite, cuánto tarda en
 * matarlos y cuánto cuesta subir al nivel 2. Resultados en docs/COMBATE.md ("Arranque del nivel 1-3").
 *
 * Usa el MobSim REAL del server (IA, velocidad, ataques, respawn de apps/server/src/mobs.ts) y las fórmulas reales de
 * pvpCombat.ts (vida/maná por nivel, DF, pociones, GCD). El jugador es un bot que imita al cliente: mismas fórmulas de daño
 * y tiempos de lanzamiento (0,7 s) que apps/client/src/main.ts. El reloj es virtual (Date.now parchado), así que 400 combates
 * corren en segundos y son reproducibles con una semilla.
 *
 *   cd apps/server && npx tsx scripts/sim-arranque.ts [corridas=300]
 */
import { MOBS, buildMap, expToLevel, mobDef, type MobType } from '@fdn/world';
import type { WorldMap } from '@fdn/world';
import { damageAfterDefense, potionHp, potionHpSplit, potionMp, statsFromChar, type CombatStats } from '../src/systems/pvpCombat.ts';
import { MobSim } from '../src/mobs.ts';

void buildMap;
// ---------- reloj y azar reproducibles ----------
let vt = 1_000_000;
Date.now = () => vt;
let seed = 12345;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Math.random = rnd;
const rint = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const DT = 0.05, CAST_T = 0.7, RELEASE_S = 0.2 /* tiempo humano entre "listo" y soltar el hechizo */, STEP = 3.7 /* celdas/s */;

type Cls = 'mago' | 'guerrero';
type Policy = 'basico' | 'avanzado' | 'quieto';
interface Sc { cls: Cls; lvl: number; mob: MobType; n: number; policy: Policy }
interface Res { win: boolean; t: number; tDeath: number; hpLeft: number; hpPots: number; mpPots: number; kills: number[]; firstContact: number }

const KIT: Record<Cls, { arma: string; armadura: string }> = { guerrero: { arma: 'Espada corta', armadura: 'Coraza de cuero' }, mago: { arma: 'Báculo de fresno', armadura: 'Túnica de mago' } };
const MELEE: Record<Cls, [number, number]> = { guerrero: [5, 9], mago: [2, 4] };
/** Variantes para probar propuestas de balance SIN tocar el juego: SIM_MAGE_HP=20 (vida base extra del mago), SIM_ELITE_DMG=4,7 (daño del goblin de élite). */
const MAGE_HP = Number(process.env.SIM_MAGE_HP) || 0;
if (process.env.SIM_ELITE_DMG) { const [a, b] = process.env.SIM_ELITE_DMG.split(',').map(Number); MOBS.goblin_elite.dmg = [a, b]; }
const combatOf = (cls: Cls, lvl: number): CombatStats => { const c = statsFromChar({ lvl, cls, eq: { arma: { n: KIT[cls].arma }, armadura: { n: KIT[cls].armadura } } }); if (cls === 'mago') c.maxHp += MAGE_HP; return c; };

/** Mapa mínimo, todo caminable, sin zona segura; las zonas se arman por escenario. */
function flatMap(zones: WorldMap['zones']): WorldMap {
    const N = 64, blocked = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)), safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    return { size: N, tiles: [], blocked, safe, props: [], decals: [], zones, buildings: [], npcs: [], spawn: { x: 2, y: 2 }, fire: { x: 2, y: 2 } } as unknown as WorldMap;
}

interface Pl { playerId: bigint; posX: number; posY: number; disconnected: boolean; isDead: boolean; status: { isInvisible: boolean }; combat: CombatStats; hp: number; mp: number; send: () => void }

/** Un jugador-bot dentro de un MobSim real. `grind` = zona con respawn hasta juntar `killsGoal`. */
class Sim {
    sim: MobSim; pl: Pl; timers: { at: number; fn: () => void }[] = [];
    t0 = vt; pots = { hp: 3, mp: 3 }; potAt = -1e9; potEpoch = 0; lowSince = -1;
    kills: number[] = []; exp = 0; hpPotsUsed = 0; mpPotsUsed = 0; firstContact = -1; dmgTaken = 0;
    // acción actual del bot
    act: { kind: 'cast' | 'melee' | 'bola'; start: number; fireAt: number; mobId: number; ready: boolean } | null = null;
    nextMelee = 0; giroCd = 0; regenAt = 0;
    constructor(readonly sc: Sc, zones: WorldMap['zones'], px: number, py: number) {
        const c = combatOf(sc.cls, sc.lvl);
        this.pl = { playerId: 1n, posX: px, posY: py, disconnected: false, isDead: false, status: { isInvisible: false }, combat: c, hp: c.maxHp, mp: c.maxMp, send() { } };
        const host = {
            players: () => [this.pl], playerById: (id: bigint) => (id === 1n ? this.pl : undefined), nearby: () => [this.pl],
            after: (ms: number, fn: () => void) => this.timers.push({ at: vt + ms, fn }),
            hurt: (p: Pl, raw: number) => {
                if (p.isDead) return;
                const d = damageAfterDefense(raw, p.combat, 'phys'); p.hp = Math.max(0, p.hp - d); this.dmgTaken += d;
                if (this.firstContact < 0) this.firstContact = (vt - this.t0) / 1000;
                if (p.hp <= 0) { p.isDead = true; this.potEpoch++; }
            },
            stun: () => 0,
            reward: (_k: unknown, info: { def: { exp: number } }) => { this.kills.push((vt - this.t0) / 1000); this.exp += info.def.exp; if (rnd() < 0.14) { if (rnd() < 0.6) this.pots.hp = Math.min(99, this.pots.hp + 1); else this.pots.mp = Math.min(99, this.pots.mp + 1); } },
        };
        this.sim = new MobSim(flatMap(zones), host as never);
    }
    get mobs(): { id: number; x: number; y: number; hp: number; hpMax: number; state: string }[] { return [...((this.sim as unknown as { mobs: Map<number, never> }).mobs.values())]; }
    get alive() { return this.mobs.filter((m) => m.hp > 0); }
    dist(m: { x: number; y: number }) { return Math.hypot(this.pl.posX + 0.5 - m.x, this.pl.posY + 0.5 - m.y); }
    nearest(range = 99) { let b: ReturnType<Sim['alive']['at']> = undefined, bd = range; for (const m of this.alive) { const d = this.dist(m); if (d <= bd) { bd = d; b = m; } } return b; }
    hit(mobId: number, dmg: number, melee: boolean) { this.sim.hit(this.pl as never, { mobId, dmg, melee, crit: false, parSecs: 0, poisonSecs: 0 } as never); }

    usePotion(kind: 'hp' | 'mp') {
        const p = this.pl, c = p.combat, now = vt;
        if (now - this.potAt < 1650 || this.pots[kind] <= 0) return false;
        if (kind === 'hp' ? p.hp >= c.maxHp : p.mp >= c.maxMp) return false;
        this.pots[kind]--; this.potAt = now;
        if (kind === 'mp') { p.mp = Math.min(c.maxMp, p.mp + potionMp(c.maxMp)); this.mpPotsUsed++; return true; }
        this.hpPotsUsed++;
        const [first, ...ticks] = potionHpSplit(potionHp(c.maxHp)), ep = this.potEpoch;
        p.hp = Math.min(c.maxHp, p.hp + first);
        ticks.forEach((n, i) => this.timers.push({ at: now + (i + 1) * 500, fn: () => { if (!p.isDead && this.potEpoch === ep) p.hp = Math.min(c.maxHp, p.hp + n); } }));
        return true;
    }

    /** Un paso de 50 ms: temporizadores, mobs, regeneración y la decisión del bot. */
    step(opts: { move: boolean }) {
        vt += DT * 1000;
        const due = this.timers.filter((x) => x.at <= vt); this.timers = this.timers.filter((x) => x.at > vt); due.forEach((x) => x.fn());
        this.sim.update();
        const p = this.pl, c = p.combat, sc = this.sc;
        if (p.isDead) return;
        if (vt >= this.regenAt) { this.regenAt = vt + 1000; p.hp = Math.min(c.maxHp, p.hp + 1); p.mp = Math.min(c.maxMp, p.mp + 2); }
        if (sc.policy === 'quieto') return; // no hace nada (jugador distraído o con lag): sirve para medir cuánto tarda en morir
        // pociones: vida < 40 % con 0,5 s de reacción; maná del mago casi vacío
        if (p.hp < c.maxHp * 0.4) { if (this.lowSince < 0) this.lowSince = vt; if (vt - this.lowSince >= 500) this.usePotion('hp'); } else this.lowSince = -1;
        if (sc.cls === 'mago' && p.mp < 8 && this.alive.length) this.usePotion('mp');
        const tgt = this.nearest(), T = vt / 1000;
        if (this.act) {
            if (this.act.kind !== 'melee' && T >= this.act.fireAt) this.fire(); else if (this.act.kind === 'melee' && T >= this.act.fireAt) this.fire();
            return;
        }
        if (!tgt) return;
        const d = this.dist(tgt);
        const walk = (to: { x: number; y: number }, stop: number) => { if (!opts.move) return; const dd = this.dist(to); if (dd <= stop) return; const k = Math.min(STEP * DT, dd - stop) / dd; p.posX += (to.x - (p.posX + 0.5)) * k; p.posY += (to.y - (p.posY + 0.5)) * k; };
        if (sc.cls === 'mago') {
            const cluster = this.alive.filter((m) => Math.hypot(m.x - tgt.x, m.y - tgt.y) <= 1.9).length;
            if (d > 7.5) { walk(tgt, 7); return; }
            if (sc.policy === 'avanzado' && cluster >= 2 && p.mp >= 25) { this.act = { kind: 'bola', start: T, fireAt: T + CAST_T + RELEASE_S, mobId: tgt.id, ready: false }; return; }
            if (p.mp >= 8) { this.act = { kind: 'cast', start: T, fireAt: T + CAST_T + RELEASE_S, mobId: tgt.id, ready: false }; return; }
            if (d <= 1.9 && T >= this.nextMelee) { this.nextMelee = T + 0.85; this.act = { kind: 'melee', start: T, fireAt: T + 0.18, mobId: tgt.id, ready: false }; }
            return;
        }
        // guerrero
        if (d > 1.6) { walk(tgt, 1.2); return; }
        const adj = this.alive.filter((m) => this.dist(m) <= 1.9).length;
        if (sc.policy === 'avanzado' && adj >= 2 && p.mp >= 8 && T >= this.giroCd) { // giro: instantáneo, daño de área (lo calcula el server)
            this.giroCd = T + 4; p.mp -= 8;
            for (const m of this.alive) if (this.dist(m) <= 1.9) this.hit(m.id, rint(16, 22) + 2 * sc.lvl + rint(4, 8), true);
            return;
        }
        if (sc.policy === 'avanzado' && p.mp >= 10) { this.act = { kind: 'cast', start: T, fireAt: T + CAST_T + RELEASE_S, mobId: tgt.id, ready: false }; return; }
        if (T >= this.nextMelee) { this.nextMelee = T + 0.85; this.act = { kind: 'melee', start: T, fireAt: T + 0.18, mobId: tgt.id, ready: false }; }
    }
    fire() {
        const a = this.act!, p = this.pl, sc = this.sc, c = p.combat; this.act = null;
        const m = this.mobs.find((x) => x.id === a.mobId && x.hp > 0); if (!m) return;
        if (a.kind === 'melee') {
            if (this.dist(m) >= 1.9) return;
            let d = rint(...MELEE[sc.cls]) + sc.lvl + rint(c.wdmg[0], c.wdmg[1]); if (rnd() < 0.05) d = Math.round(d * 1.8);
            this.hit(m.id, d, true); return;
        }
        if (sc.cls === 'guerrero') { // golpe brutal
            if (p.mp < 10 || this.dist(m) > 1.9) return; p.mp -= 10;
            this.hit(m.id, rint(14, 20) + 2 * sc.lvl + rint(c.wdmg[0], c.wdmg[1]), true); return;
        }
        const cost = a.kind === 'bola' ? 25 : 8; if (p.mp < cost) return; p.mp -= cost;
        const travel = this.dist(m) / (a.kind === 'bola' ? 8 : 11);
        this.timers.push({
            at: vt + travel * 1000, fn: () => {
                if (a.kind === 'bola') { const dmg = rint(18, 26) + 2 * sc.lvl + c.mag; const tx = m.x, ty = m.y; for (const o of this.alive) if (Math.hypot(o.x - tx, o.y - ty) <= 1.9) this.hit(o.id, Math.round(dmg * (0.85 + rnd() * 0.3)), false); return; }
                const live = this.mobs.find((x) => x.id === m.id && x.hp > 0); if (live) this.hit(live.id, rint(12, 18) + 2 * sc.lvl + c.mag, false);
            },
        });
    }
}

/** Un combate: `n` mobs ya agrupados a ~6 celdas del jugador. Gana si los mata a todos; pierde si muere (tope 90 s). */
function fight(sc: Sc): Res {
    const zone = { type: sc.mob, x: 30, y: 30, r: 1.0, n: sc.n, name: 'prueba' };
    const s = new Sim(sc, [zone], 24, 30);
    const t0 = vt; s.t0 = t0;
    if (sc.policy === 'quieto') (s.sim as unknown as { aggro(m: unknown, p: unknown): void }).aggro(s.mobs[0], s.pl); // alguien los despertó
    for (let i = 0; i < 90 / DT; i++) {
        s.step({ move: true });
        if (s.pl.isDead) return { win: false, t: (vt - t0) / 1000, tDeath: s.firstContact >= 0 ? (vt - t0) / 1000 - s.firstContact : 0, hpLeft: 0, hpPots: s.hpPotsUsed, mpPots: s.mpPotsUsed, kills: s.kills, firstContact: s.firstContact };
        if (s.kills.length >= sc.n) return { win: true, t: (vt - t0) / 1000, tDeath: 0, hpLeft: s.pl.hp / s.pl.combat.maxHp, hpPots: s.hpPotsUsed, mpPots: s.mpPotsUsed, kills: s.kills, firstContact: s.firstContact };
    }
    return { win: false, t: 90, tDeath: 90, hpLeft: s.pl.hp / s.pl.combat.maxHp, hpPots: s.hpPotsUsed, mpPots: s.mpPotsUsed, kills: s.kills, firstContact: s.firstContact };
}

const med = (a: number[]) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (n: number) => (Number.isNaN(n) ? '-' : n.toFixed(1));

/** Grindeo: la zona real (n mobs, respawn 22 s) hasta juntar la exp del nivel. Descansa hasta 85 % de vida antes de la próxima tanda. */
function grind(cls: Cls, mob: MobType, zoneN: number, policy: Policy, goalExp: number): { secs: number; deaths: number; kills: number; hpPots: number; capped: boolean } {
    const zone = { type: mob, x: 30, y: 30, r: 2.5, n: zoneN, name: 'zona' };
    const s = new Sim({ cls, lvl: 1, mob, n: zoneN, policy }, [zone], 24, 30);
    const t0 = vt; let deaths = 0, penalty = 0;
    for (let i = 0; i < 3 * 3600 / DT && s.exp < goalExp; i++) {
        s.step({ move: true });
        const p = s.pl;
        if (p.isDead) { // muere: vuelve de la ciudad (45 s de viaje), pierde el 5 % de la exp del nivel
            deaths++; penalty += 45; s.exp = Math.max(0, s.exp - Math.round(goalExp * 0.05));
            p.isDead = false; p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; p.posX = 24; p.posY = 30; s.act = null; s.timers = []; s.potEpoch++;
            continue;
        }
        if (!s.alive.some((m) => m.state === 'chase') && p.hp < p.combat.maxHp * 0.85 && s.act === null) { // descansar sin avanzar: acelera el reloj (la regeneración del cliente es 1 vida y 2 maná por s)
            const need = (p.combat.maxHp * 0.85 - p.hp); penalty += need; p.hp = Math.ceil(p.combat.maxHp * 0.85); p.mp = Math.min(p.combat.maxMp, p.mp + 2 * need);
        }
    }
    return { secs: (vt - t0) / 1000 + penalty, deaths, kills: s.kills.length, hpPots: s.hpPotsUsed, capped: s.exp < goalExp };
}

const RUNS = Number(process.argv[2]) || 300;
const out: string[] = [];
const log = (s = '') => { out.push(s); console.log(s); };
const NAMES: Partial<Record<MobType, string>> = { goblin: 'goblin', goblin_elite: 'élite' };

log(`Combates simulados: ${RUNS} por celda. Mobs agrupados a ~6 celdas, el jugador no huye ni usa Blink/parálisis. Pociones: vida a <40 %, 3+3 iniciales.`);
for (const policy of ['basico', 'avanzado'] as Policy[]) {
    log(`\n### Política ${policy === 'basico' ? 'básica (mago: Proyectil; guerrero: ataque cuerpo a cuerpo)' : 'avanzada (mago: Proyectil + Bola de fuego en grupos; guerrero: Golpe brutal + Giro)'}`);
    log('| Clase | Nv | Mob | Cant. | Gana | T medio combate (s) | T hasta morir desde el contacto (s, mediana) | Vida que queda al ganar | Pociones vida | Mató antes de morir |');
    log('|---|---|---|---|---|---|---|---|---|---|');
    for (const cls of ['mago', 'guerrero'] as Cls[]) for (const lvl of [1, 2, 3]) for (const mob of ['goblin', 'goblin_elite'] as MobType[]) for (const n of [1, 2, 4, 6]) {
        const rs: Res[] = []; for (let i = 0; i < RUNS; i++) rs.push(fight({ cls, lvl, mob, n, policy }));
        const wins = rs.filter((r) => r.win), losses = rs.filter((r) => !r.win);
        log(`| ${cls} | ${lvl} | ${NAMES[mob]} | ${n} | ${Math.round((wins.length / RUNS) * 100)} % | ${f1(avg(wins.map((r) => r.t)))} | ${f1(med(losses.map((r) => r.tDeath)))} | ${wins.length ? Math.round(avg(wins.map((r) => r.hpLeft)) * 100) + ' %' : '-'} | ${f1(avg(rs.map((r) => r.hpPots)))} | ${f1(avg(losses.map((r) => r.kills.length)))} |`);
    }
}

log('\n### Jugador quieto (sin atacar ni tomar pociones): segundos desde el primer golpe recibido hasta morir (mediana)');
log('| Clase | Nv | Mob | 1 | 2 | 4 | 6 |');
log('|---|---|---|---|---|---|---|');
for (const cls of ['mago', 'guerrero'] as Cls[]) for (const lvl of [1, 2, 3]) for (const mob of ['goblin', 'goblin_elite'] as MobType[]) {
    const cells = [1, 2, 4, 6].map((n) => { const rs: Res[] = []; for (let i = 0; i < RUNS; i++) rs.push(fight({ cls, lvl, mob, n, policy: 'quieto' })); return f1(med(rs.filter((r) => !r.win).map((r) => r.tDeath))); });
    log(`| ${cls} | ${lvl} | ${NAMES[mob]} | ${cells.join(' | ')} |`);
}

log('\n### Tiempo por kill (1 mob, jugador nuevo, sin interferencias)');
log('| Clase | Nv | Mob | Política | Segundos hasta matar (media) |');
log('|---|---|---|---|---|');
for (const cls of ['mago', 'guerrero'] as Cls[]) for (const lvl of [1, 2, 3]) for (const mob of ['goblin', 'goblin_elite'] as MobType[]) for (const policy of ['basico', 'avanzado'] as Policy[]) {
    const ts: number[] = []; for (let i = 0; i < RUNS; i++) { const r = fight({ cls, lvl, mob, n: 1, policy }); if (r.win) ts.push(r.t); }
    log(`| ${cls} | ${lvl} | ${NAMES[mob]} | ${policy} | ${f1(avg(ts))} |`);
}

const need = (l: number) => expToLevel(l);
log(`\n### Subir al nivel 2 desde el nivel 1 (exp necesaria ${need(1)}; goblin da ${MOBS.goblin.exp}, élite ${MOBS.goblin_elite.exp})`);
log(`Kills: ${Math.ceil(need(1) / MOBS.goblin.exp)} goblins o ${Math.ceil(need(1) / MOBS.goblin_elite.exp)} élites. Tiempo con la zona real (3 mobs, respawn ${22} s), descanso a 85 % de vida, 45 s de penalidad por muerte.`);
log('| Clase | Mob | Política | Minutos (media) | Muertes (media) | Kills |');
log('|---|---|---|---|---|---|');
const GR = Math.max(10, Math.round(RUNS / 15));
for (const cls of ['mago', 'guerrero'] as Cls[]) for (const mob of ['goblin', 'goblin_elite'] as MobType[]) for (const policy of ['basico', 'avanzado'] as Policy[]) {
    const rs = Array.from({ length: GR }, () => grind(cls, mob, 3, policy, need(1)));
    log(`| ${cls} | ${NAMES[mob]} | ${policy} | ${f1(avg(rs.map((r) => r.secs)) / 60)} | ${f1(avg(rs.map((r) => r.deaths)))} | ${f1(avg(rs.map((r) => r.kills)))} |`);
}
void mobDef;
if (process.env.SIM_OUT) (await import('node:fs')).writeFileSync(process.env.SIM_OUT, out.join('\n') + '\n');
process.exit(0);
