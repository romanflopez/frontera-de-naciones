/**
 * Un mundo de juego (un mapa), basado en el server MIT de base (ver LICENSE.base-game).
 *
 * En el original cada mundo es un actor con su propio hilo y una cola de mensajes.
 * Node corre en un solo hilo, así que acá los mensajes se procesan apenas llegan y el
 * tick (cada 50 ms) solo dispara los temporizadores. Más adelante, si hace falta escalar,
 * cada mundo puede ir a su propio worker_thread sin cambiar esta lógica.
 */
import { PARTY_SHARE_RANGE, partyExpMult, partyMates } from './party.ts';
import { dailyOffers } from './dailyShop.ts';
/** Hasta dónde llega el botín personal de un élite o jefe de mundo para los que participaron (celdas desde donde murió). */
const BOSS_SHARE_RANGE = 30;
import { AOE_MAX_TARGETS, AURA_HEAL_FRAC, BURN_EVERY, BURN_TICKS, burnTickDmg, CAST_MULTI_HIT_MS, CAST_READY_MS, CAST_SLACK_MS, castMsOf, combatMpRegen, MEDITATE, pvpMpRegen, isCast, aoeMult, damageAfterDefense, FURY_MS, paralysisSecs, potionHp, potionHpSplit, potionLockMs, potionMp, POTION_GCD_SLACK_MS, POTION_HOT_EVERY_MS, POTION_LOCK_PVP_MS, PVP_COMBAT_MS, pvpCap, pvpScale, pvpVsCtrl, RECALL_PVP_LOCK_MS, INVIS_CD_MS, DETECT_CD_MS, SECOND_WIND, secondWindHeal, progressFromEcon, PVP_SPELLS, BLESS_DMG_TAKEN, BLESS_HEAL_TAKEN, POISON_HEAL_TAKEN, HEAL_THREAT, HEALER_SKILLS, STUN_SPELLS, healAmount, rollSpellDamage, SKILLS, spellDmgKind, statsFromChar, UTIL_MP, K8_SKILLS, skillMpCost, SHIELD_MS, BUFF, withBuffs, buffTakenMult, type DmgKind } from './systems/pvpCombat.ts';
import { HUBS, QUESTS, RECALL, TRAINING, trainingLockedMsg, trainingOfMap, WAYPOINT_RANGE, factionHome, recallBlockedReason, findLink, inMapRect, linkGateReason, portalGate, respawnTarget, trainingUnlocked, waypointTarget, type Link, type MapDef, checkSkill, skillDeniedText } from '@fdn/world';
import { applyParalysis, applySlow, applyBless, applyPoison, applyBuff, applyShield, absorbShield, activeBuffs, clearBuffs, hasBuff, shieldOf, breakInvisibility, castDetectInvisible, castInvisibility, castRemover, expireTimed, isBlessed, isPoisoned, isSlowed, updateStatus, clearBlessings } from './systems/statusSystem.ts';
import type { ClientMessage, ServerMessage } from '@fdn/proto';
import type { GameWorldConfig, Settings } from './config.ts';
import { adjacentCellsAt45, distance, findNearestFreeLocation, nextGridDirection } from './location.ts';
import type { Occupancy } from './map.ts';
import * as M from './messages.ts';
import { MobSim } from './mobs.ts';
import { PROJECTILES, projectileFlightMs, projectileHits } from '@fdn/world';
import { ARENA_RULES, MOB_TYPES, POISON_SECS, arenaHealMult, meleeIntervalSecs, type MobType, type WorldMap } from '@fdn/world';
import { Player, type PersistedPlayer, type Send } from './player.ts';
import type { Economy, EconCtx } from './economy.ts';
import { auctionHouse } from './auction.ts';
import { depotService } from './deposit.ts';
import { tradeService } from './trade.ts';
import { canPickup, GroundLoot, type GroundApi } from './ground.ts';
import { LootManager, rollLoot, splitLoot } from './systems/loot.ts';
import { DROPS } from './drops.ts';

interface Timer { at: number; fn: () => void }

/**
 * Cambio respecto del original: durante los primeros segundos después de entrar no se evalúa el ping,
 * porque el cliente se traba mientras arma el mapa y en una compu lenta eso alcanzaba para que lo echaran.
 */
const PING_JOIN_GRACE_MS = 15_000;

/** Paquetes que cortan el recall (volver a la ciudad): moverse, atacar, lanzar o usar otro portal. */
const RECALL_BREAKERS: Record<string, string> = {
    requestMovement: 'Te moviste', playerTeleportRequested: 'Te moviste', waypointRequest: 'Usaste el portal',
    pvpHitRequest: 'Atacaste', mobHitRequest: 'Atacaste', skillRequest: 'Usaste una habilidad', blinkRequest: 'Usaste una habilidad',
    invisibilityRequest: 'Lanzaste un hechizo', detectInvisibleRequest: 'Lanzaste un hechizo', removerRequest: 'Lanzaste un hechizo',
};

/** Paquetes que cortan el Segundo aliento (K6): lo mismo que el recall, más empezar a castear, tomar una poción o pedir el recall. */
const WIND_BREAKERS: Record<string, string> = {
    ...RECALL_BREAKERS, spellCastStartRequest: 'Empezaste a lanzar', potionRequest: 'Tomaste una poción', recallRequest: 'Pediste volver a la ciudad',
};

/** Efecto con el que se ve el impacto de cada proyectil. */
const IMPACT_FX: Record<string, string> = { proyectil: 'splash', bola: 'eruption' };

export class GameWorld {
    private readonly players = new Map<string, Player>();
    private readonly playersById = new Map<bigint, Player>();
    private timers: Timer[] = [];
    private mobSim?: MobSim;
    /** Dormido: sin jugadores, el registro dejó de llamar a tick(). Al despertar los mobs vuelven a empezar. */
    private hibernated = false;
    /** Lo setea el registro de mundos: saca al jugador de este mundo y lo manda a otro mapa (portal, respawn). */
    transferHook?: (sessionId: string, dest: { map: string; x: number; y: number }, why: 'respawn' | 'waypoint' | 'home' | 'recall') => void;
    /** Jefe de mundo (worldBoss.ts): avisa cuando muere, con el que dio el golpe final y cuántos pelearon. */
    worldBossHook?: (ev: { kind: 'died'; name: string; killer: string; fighters: number }) => void;
    /** Botín en el suelo de este mundo (solo en memoria). */
    private readonly loot = new GroundLoot();
    private lastGroundSync = 0;
    /** Botín de materiales / oro (systems/loot.ts); aparte de `loot`, que son los items de la economía. */
    private readonly floorLoot = new LootManager(Math.random().toString(36).slice(2, 7));

    constructor(
        readonly config: GameWorldConfig,
        private readonly settings: Settings,
        private readonly occupancy: Occupancy,
        private readonly map?: WorldMap,
        private readonly econ?: Economy,
        /** Datos del mapa (PvP, respawn, vínculos); sin él el mundo se comporta como un mapa suelto. */
        private readonly def?: MapDef,
    ) {
        this.initMobs();
    }

    private initMobs(): void {
        const map = this.map;
        if (map) {
            this.mobSim = new MobSim(map, {
                players: () => this.players.values(),
                playerById: (id) => this.playersById.get(id),
                nearby: (cx, cy) => this.nearbyPlayers(cx, cy),
                after: (ms, fn) => this.setTimeout(ms, fn),
                hurt: (p, raw, source, srcId, mobId) => { // los ataques de mobs son físicos (los mitiga la DF)
                    this.damagePlayer(p, raw, 'phys', null, source, '', srcId);
                    // Aura de represalia (K8): devuelve ⅓ del golpe al monstruo (en el tick siguiente, para no matarlo en medio de su propio ataque)
                    if (mobId !== undefined && !p.isDead && hasBuff(p.status, 'represalia', Date.now())) {
                        const back = Math.max(1, Math.round(raw * BUFF.represaliaReflect));
                        this.setTimeout(1, () => { if (!p.disconnected && p.world === this) this.mobSim?.skillHit(p, mobId, back, 0, 'represalia'); });
                    }
                },
                stun: (p, secs) => {
                    const ms = applyParalysis(p.status, Date.now(), paralysisSecs(secs, p.combat) * 1000, 'aturdir');
                    if (secs > 0 && ms <= 0) p.send(M.pvpHit(p.playerId, { fx: 'resist', x: p.posX, y: p.posY, targetId: 0n, dmg: 0, secs: 0, r: 0 })); // inmune: "Inmune" sobre uno
                    return ms / 1000;
                },
                held: (p) => p.isParalyzed(Date.now()),
                pay: (p, c) => this.payMp(p, c),
                heal: (p, n) => this.healPlayer(p, n), // robo de vida, Juicio y Castigo
                refundMp: (p, n) => this.refundMp(p, n), // Castigo
                poison: (p, secs) => this.poisonPlayer(p, secs), // mobs tóxicos
                slow: (p, secs) => { if (applySlow(p.status, Date.now(), secs * 1000) > 0) this.announceStatus(p); }, // jefes (Carga y desjarrete)
                push: (p, x, y) => { // terror y tirón: el server mueve al jugador (es autoritativo) a la celda libre más cercana
                    if (p.isDead) return;
                    const tx = Math.max(0, Math.round(x - 0.5)), ty = Math.max(0, Math.round(y - 0.5));
                    const f = this.occupancy.isFree(tx, ty) ? { x: tx, y: ty } : findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), tx, ty, 4);
                    if (f && (f.x !== p.posX || f.y !== p.posY)) { this.moveTo(p, p.posX, p.posY, f.x, f.y, false, true); p.send(M.playerTeleported(f.x, f.y)); }
                },
                dispel: (p) => { clearBuffs(p.status); if (p.status.statDirty) { p.status.statDirty = false; this.restat(p); } this.announceStatus(p); this.sendVitals(p, true); },
                worldBossDied: (info, fighters, killer) => {
                    // jefe de mundo: cobran todos los que pelearon (pegaron, curaron o tanquearon), cada uno con su botín propio, sin reparto de exp
                    if (this.econ) for (const f of fighters) this.econ.reward(f, this.econCtx, { ...info, zoneName: 'Jefe de mundo', origin: 'world', traits: 0, map: this.mapId }, 1);
                    this.worldBossHook?.({ kind: 'died', name: info.def.name, killer: killer?.characterName ?? '', fighters: fighters.length });
                },
                mobDied: (info) => {
                    if (!info.gm) this.dropLoot(info.type, info.def.name, info.def.lvl, info.x, info.y, info.killer);
                    if (!info.gm && info.def.boss && this.isDungeonRun) this.runCleared(info.def.name);
                },
                reward: (p, info) => {
                    if (!this.econ) return;
                    // party: cada compañero cerca (mismo mundo, vivo) recibe su propio botín y una parte de la exp (docs/PARTY_Y_ARENAS.md §1)
                    // quests en party [DM]: el compañero cerca que está muerto no cobra botín ni exp, pero el mob le cuenta para sus misiones
                    const inRange = this.partyInRange(p), near = inRange.filter((m) => m === p || m.hp > 0), dead = inRange.filter((m) => m !== p && m.hp <= 0);
                    const mult = partyExpMult(near.length), k = { ...info, map: this.mapId };
                    for (const m of near) this.econ.reward(m, this.econCtx, k, mult);
                    for (const m of dead) { const lvl0 = m.econ?.lvl; this.econ.questCredit(m, k); if (m.econ && m.econ.lvl !== lvl0) this.restat(m); }
                    // élites y jefes: botín personal también para los que participaron sin party (amenaza), si siguen vivos y en la zona
                    const got = new Set<Player>(near);
                    for (const id of info.participants ?? []) {
                        const q = this.playersById.get(id);
                        if (!q || got.has(q) || q.hp <= 0 || Math.hypot(q.posX + 0.5 - info.x, q.posY + 0.5 - info.y) > BOSS_SHARE_RANGE) continue;
                        got.add(q); this.econ.reward(q, this.econCtx, k, 1);
                    }
                },
            }, { noRespawn: this.isDungeonRun, elites: !!this.def?.temporary });
            if (this.partySize > 1 || this.isDungeonRun) this.mobSim.setPartyScale(this.partySize);
        }
    }

    /**
     * Corrida de mazmorra (docs/MAZMORRAS.md): una instancia (`mapa#id`) de un mapa temporal. Adentro nada reaparece, hay élites, los mobs se
     * escalan con la party y se tiene una sola vida: al reaparecer después de caer, volvés a la superficie y esa corrida se terminó para vos.
     */
    get isDungeonRun(): boolean { return this.id.includes('#') && !!this.def?.temporary && this.def.region !== 'arena'; }
    /** Jugadores con los que se escaló la instancia (1 por defecto). */
    private partySize = 1;
    /** Cuándo arrancó la corrida (ms, lo fija el registro; 0 = sin cronómetro). */
    runStart = 0;
    /**
     * Cronómetro de corrida: al caer el jefe, todos los del piso ven cuánto tardaron y queda en el log del server
     * (`[Corrida] …`), para medir en las pruebas si las mazmorras duran lo buscado (~25 min solo/dúo, ~30 en grupo).
     */
    runCleared(bossName: string, now = Date.now()): string | undefined {
        if (!this.runStart) return undefined;
        const secs = Math.max(0, Math.round((now - this.runStart) / 1000)), mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
        const who = this.partySize === 1 ? '1 jugador' : `${this.partySize} jugadores`;
        const text = `${bossName} cayó. Corrida de ${this.def?.name ?? this.mapId}: ${mm}:${ss} (${who}).`;
        for (const p of this.players.values()) p.send(M.sendMessage(text));
        console.log(`[Corrida] ${this.id} jefe=${bossName} duracion_s=${secs} jugadores=${this.partySize}`);
        return text;
    }
    /** El registro la fija al crear la corrida, con los que entraron juntos. Devuelve el escalado aplicado. */
    setPartyScale(n: number): { hp: number; dmg: number } | undefined {
        this.partySize = Math.max(1, Math.floor(n) || 1);
        return this.mobSim?.setPartyScale(this.partySize);
    }

    // ---------- arena 2v2 / 3v3 (apps/server/src/arena.ts manda; acá van las reglas dentro del mapa) ----------
    /**
     * Partida de arena de esta instancia: equipo de cada sesión, puesto de salida (la "jaula" de la preparación), fase y usos de
     * invisibilidad que quedan. Sin partida (un GM que entra a mirar) la arena es todos contra todos.
     */
    arena?: { teams: Map<string, 0 | 1>; cages: Map<string, { x: number; y: number }>; phase: 'prep' | 'fight' | 'end'; fightStart: number; invis: Map<string, number> };
    arenaSetup(teams: Map<string, 0 | 1>, cages: Map<string, { x: number; y: number }>): void {
        this.arena = { teams, cages, phase: 'prep', fightStart: 0, invis: new Map() };
    }
    /** Al llegar a la arena: sin buffs ni escudos (se sacan al entrar), vida y maná llenos y nada a medias (recall, Segundo aliento, pociones). */
    arenaPrepare(sessionId: string): void {
        const p = this.players.get(sessionId); if (!p || !this.arena) return;
        this.cancelRecall(p, ''); this.cancelWind(p, ''); p.cast = null; p.meditating = false; p.potionEpoch++; p.burnSeq++; p.renewSeq++;
        this.changeStatus(p, () => breakInvisibility(p.status));
        clearBuffs(p.status); p.status.statDirty = false; this.restat(p);
        p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; p.deadAt = 0; p.lastDamager = null;
        this.announceStatus(p); this.sendVitals(p, true); this.announceVitals(p, true);
        p.send(M.sendMessage(`Preparación: quedate en tu puesto. La pelea arranca en ${ARENA_RULES.prepMs / 1000} s.`));
    }
    arenaFight(now = Date.now()): void {
        if (!this.arena) return;
        this.arena.phase = 'fight'; this.arena.fightStart = now;
        for (const p of this.players.values()) if (p.spawnProtection) this.disableSpawnProtection(p);
    }
    /** Fin de la partida: nadie pega más y todos quedan vivos y llenos para volver. */
    arenaEnd(): void {
        if (!this.arena) return;
        this.arena.phase = 'end';
        for (const p of this.players.values()) {
            p.potionEpoch++; p.burnSeq++; p.renewSeq++;
            clearBuffs(p.status); p.status.statDirty = false; this.restat(p);
            p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; p.deadAt = 0; p.lastDamager = null;
            this.announceStatus(p); this.sendVitals(p, true); this.announceVitals(p, true);
        }
    }
    /** Multiplicador de curación y regeneración de vida en la arena (−20 % cada 3 min de pelea, piso 20 %); 1 afuera. */
    private healMult(now: number): number { return this.arena?.phase === 'fight' ? arenaHealMult(now - this.arena.fightStart) : 1; }
    /** Bando para ver invisibles y para curar: el equipo en una partida de arena, la nación en el resto. */
    private sideOf(p: Player): string { const t = this.arena?.teams.get(p.sessionId); return t === undefined ? this.factionOf(p) : `arena${t}`; }

    /** Clave del mundo: el id del mapa, más `#instancia` si es una instancia privada. */
    get id(): string { return this.config.id; }
    get mapId(): string { return this.config.map; }
    get playerCount(): number { return this.players.size; }
    get isHibernated(): boolean { return this.hibernated; }
    get mobCount(): number { return this.mobSim?.count ?? 0; }
    /** El simulador de mobs (tests y mediciones); undefined si el mundo duerme o no tiene mapa. */
    get mobs(): MobSim | undefined { return this.mobSim; }
    playerOf(sessionId: string): Player | undefined { return this.players.get(sessionId); }
    /** El jugador `id` de este mundo, si `p` lo ve (conectado y no oculto para él). Para Dar e Intercambiar: el rango lo valida `TradeService`. */
    tradePeer(p: Player, id: bigint): Player | undefined {
        const o = this.playersById.get(id);
        return o && o !== p && !o.disconnected && !this.hiddenFrom(p, o) ? o : undefined;
    }
    /** Sesiones que ven a este jugador (radio de visión, mismo mapa), incluida la suya. Para el chat de área. */
    viewersOf(sessionId: string): string[] {
        const p = this.players.get(sessionId); if (!p) return [];
        return [p.sessionId, ...this.nearbyPlayers(p.posX, p.posY, p.sessionId).filter((o) => !this.hiddenFrom(o, p)).map((o) => o.sessionId)];
    }

    /** ¿Hay un jefe de mundo vivo acá? Un mundo con jefe no hiberna aunque esté vacío. */
    get hasWorldBoss(): boolean { return !!this.mobSim?.worldBoss(); }
    /**
     * Jefe de mundo (docs/JEFE_DE_MUNDO.md): lo pone cerca de `at` o, si no se pasa, en el centro de una zona de mobs al azar del mapa.
     * Devuelve dónde quedó, o undefined si el mapa no tiene mobs o lugar.
     */
    spawnWorldBoss(type: MobType, at?: { x: number; y: number }): { x: number; y: number } | undefined {
        if (!this.mobSim || !this.map) return undefined;
        const zs = this.map.zones; if (!zs.length) return undefined;
        const z = at ? undefined : zs[Math.floor(Math.random() * zs.length)], c = at ?? { x: z!.x, y: z!.y };
        let zi = zs.findIndex((q) => q.type === type);
        if (zi < 0) { let bd = Infinity; zs.forEach((q, i) => { const d = Math.hypot(q.x - c.x, q.y - c.y); if (d < bd) { bd = d; zi = i; } }); }
        const r = this.mobSim.spawnWorldBoss(type, c.x, c.y, zi);
        return r && { x: Math.floor(r.x), y: Math.floor(r.y) };
    }
    /** Saca al jefe de mundo (se le terminó el tiempo). */
    removeWorldBoss(): boolean { return this.mobSim?.removeWorldBoss() ?? false; }

    /** Duerme el mundo vacío: se tiran los temporizadores y los mobs (al despertar nacen de nuevo con la vida llena). */
    hibernate(): void {
        if (this.hibernated) return;
        this.hibernated = true; this.timers = []; this.mobSim = undefined;
    }
    wake(): void {
        if (!this.hibernated) return;
        this.hibernated = false; this.initMobs();
    }

    dispose(): void { this.timers = []; this.mobSim = undefined; }

    /** Lo que la economía necesita del mundo: los NPC (para validar distancia) y recalcular stats. */
    private readonly groundApi: GroundApi = {
        get: (id) => this.loot.items.get(id),
        take: (id) => { const g = this.loot.take(id); if (g) this.syncGround(); return g; },
        add: (item, x, y, owners, freeInMs) => { const g = this.loot.add(item, x, y, owners, freeInMs); this.syncGround(); return g; },
        ownedCount: (key) => this.loot.ownedCount(key),
    };
    private readonly econCtx: EconCtx = { npcs: [], restat: (p) => this.restat(p), ground: this.groundApi };
    private get ctx(): EconCtx { (this.econCtx as { npcs: EconCtx['npcs'] }).npcs = this.map?.npcs ?? []; return this.econCtx; }

    /** Une la sesión con su cuenta: trae (o importa una sola vez) el estado económico y arma los stats desde el equipo del server. */
    bindAccount(sessionId: string, key: string): void {
        const p = this.players.get(sessionId); if (!p || !this.econ) return;
        p.accountKey = key;
        this.econ.attach(p, key);
        this.restat(p, true);
        if (p.econ) { this.econ.snapshot(p); p.econSynced = true; }
    }
    /** El cliente mandó su guardado: sirve para crear el personaje de una cuenta nueva (clase y bando); el resto ya no vale. */
    onClientSave(sessionId: string, raw: string): void {
        const p = this.players.get(sessionId); if (!p || !this.econ) return;
        if (process.env.FDN_DEBUG_TRUST_SAVE === '1') { if (this.econ.debugReplace(p, raw)) this.restat(p, true); this.econ.snapshot(p); return; }
        if (!p.econ && this.econ.createFromSave(p, raw)) { this.restat(p, true); p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; this.sendVitals(p, true); }
        if (p.econ) { this.econ.persistVitals(p); if (!p.econSynced) { this.econ.snapshot(p); p.econSynced = true; p.send(M.dailyShopState(dailyOffers(), this.econ.starSoldToday())); } }
    }
    /** Reconexión dentro de la gracia: mismo jugador, socket nuevo; se le manda de nuevo el estado. */
    resendEconomy(sessionId: string): void { const p = this.players.get(sessionId); if (p?.econ) { this.econ?.snapshot(p); p.econSynced = true; } }
    persistVitals(sessionId: string): void { const p = this.players.get(sessionId); if (p) this.econ?.persistVitals(p); }

    // ---------- temporizadores ----------
    private setTimeout(ms: number, fn: () => void): void { this.timers.push({ at: Date.now() + ms, fn }); }
    /** Temporizador del jugador: lo corre el mundo donde esté cuando venza (no el que lo creó), así no queda nada fantasma tras cambiar de mapa. */
    private playerTimer(p: Player, ms: number, fn: (w: GameWorld) => void): void { p.timers.push({ at: Date.now() + ms, fn }); }

    /** Un paso de simulación: lo llama el registro de mundos (un solo reloj para todos los mundos despiertos). */
    tick(): void {
        if (this.hibernated) return;
        const now = Date.now();
        if (this.timers.length) {
            const due = this.timers.filter((t) => t.at <= now);
            this.timers = this.timers.filter((t) => t.at > now);
            for (const t of due) this.safe('temporizador', t.fn);
        }
        for (const pl of this.players.values()) {
            if (pl.timers.length) {
                const due = pl.timers.filter((t) => t.at <= now);
                pl.timers = pl.timers.filter((t) => t.at > now);
                for (const t of due) this.safe('temporizador del jugador', () => t.fn(this));
            }
            this.changeStatus(pl, () => updateStatus(pl.status, now));
            expireTimed(pl.status, now);
            const ia = this.inArenaAt(pl); if (ia && !pl.wasInArena) clearBlessings(pl.status); pl.wasInArena = ia; // las bendiciones de 15 min no entran a la arena
            if (pl.status.statDirty) { pl.status.statDirty = false; this.restat(pl); } // K8: venció una bendición que tocaba los stats
            if (pl.status.vitalsDirty) this.flushShield(pl);
            if (pl.status.dirty) { pl.status.dirty = false; this.announceStatus(pl); }
            this.regenMana(pl, now);
            if (pl.windUntil && pl.isParalyzed(now)) this.cancelWind(pl, 'Te controlaron: se cortó el Segundo aliento.');
        }
        if (this.mobSim) this.safe('mobs', () => this.mobSim!.update());
        if (now - this.lastGroundSync >= 400) this.safe('suelo', () => this.syncGround(now));
        this.checkPingTimeouts(now);
    }

    /** Vence lo viejo y manda a cada jugador solo las diferencias de lo que tiene a la vista (aparece / sale de rango / desaparece). */
    private syncGround(now = Date.now()): void {
        this.lastGroundSync = now;
        for (const g of this.loot.expired(now)) this.loot.take(g.id);
        for (const { loot, viewers } of this.floorLoot.expire()) { const m = M.itemPickedUp(loot.lootId, '', loot.itemName, loot.amount); for (const sid of viewers) this.players.get(sid)?.send(m); }
        const { viewRadiusX: rx, viewRadiusY: ry } = this.settings.radius;
        for (const p of this.players.values()) {
            if (p.disconnected) continue;
            const key = p.accountKey;
            for (const g of this.loot.items.values()) {
                if (p.groundSeen.has(g.id) || Math.abs(g.x - p.posX) > rx || Math.abs(g.y - p.posY) > ry) continue;
                p.groundSeen.add(g.id);
                const free = canPickup(g, key, now);
                p.send(M.groundItemSpawned(g, !free, free ? 0 : g.freeAt - now, g.expiresAt - now));
            }
            for (const e of this.floorLoot.unseenNear(p.sessionId, p.posX, p.posY, rx, ry)) p.send(M.lootSpawn(e)); // los que llegan después también lo ven
            for (const id of [...p.groundSeen]) {
                const g = this.loot.items.get(id);
                if (!g || Math.abs(g.x - p.posX) > rx + 2 || Math.abs(g.y - p.posY) > ry + 2) { p.groundSeen.delete(id); p.send(M.groundItemRemoved(id)); }
            }
        }
    }

    private safe(what: string, fn: () => void): void {
        try { fn(); } catch (err) { console.error(`[Mundo:${this.id}] Error en ${what}:`, err); }
    }

    // ---------- consultas ----------
    /** Jugadores dentro del radio de visión alrededor de (cx, cy). */
    private nearbyPlayers(cx: number, cy: number, excludeSessionId?: string, excludeDisconnected = true): Player[] {
        const { viewRadiusX: rx, viewRadiusY: ry } = this.settings.radius;
        const out: Player[] = [];
        for (const p of this.players.values()) {
            if (p.sessionId === excludeSessionId) continue;
            if (excludeDisconnected && p.disconnected) continue;
            if (Math.abs(p.posX - cx) <= rx && Math.abs(p.posY - cy) <= ry) out.push(p);
        }
        return out;
    }

    private nearbyById(cx: number, cy: number, excludeSessionId: string): Map<bigint, Player> {
        return new Map(this.nearbyPlayers(cx, cy, excludeSessionId, false).map((p) => [p.playerId, p]));
    }

    private sendTo(p: Player, m: ServerMessage): void { if (!p.disconnected) p.send(m); }

    private broadcastNear(p: Player, m: ServerMessage): void {
        for (const other of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) if (!this.hiddenFrom(other, p)) other.send(m);
    }

    private factionOf(p: Player): string { return p.profile.split(';')[0]; }
    /** `target` es invisible para `viewer`: de otra facción y sin Detectar invisible. Los aliados se ven siempre. */
    private hiddenFrom(viewer: Player, target: Player): boolean {
        return target.status.isInvisible && !viewer.status.hasDetectInvisible && this.sideOf(viewer) !== this.sideOf(target);
    }

    /** Estado visible de `p` (invisible, detectar, furia, Bendición de poder, ralentizado, bendiciones y auras de K8) para `p` y los cercanos. */
    private statusMsg(p: Player): ServerMessage {
        const now = Date.now();
        return M.statusUpdate(p.playerId, p.status.isInvisible, p.status.hasDetectInvisible, p.pvp.fury(now), hasBuff(p.status, 'poder', now), isSlowed(p.status, now), isBlessed(p.status, now), isPoisoned(p.status, now), activeBuffs(p.status, now));
    }
    private announceStatus(p: Player): void { const m = this.statusMsg(p); p.send(m); this.broadcastNear(p, m); }

    /** Aplica un cambio de estado y avisa lo justo: a los que dejan de ver (o empiezan a ver) a `p` y a los que ven distinto por Detectar. */
    private changeStatus(p: Player, mutate: () => void): void {
        const inv = p.status.isInvisible, det = p.status.hasDetectInvisible;
        const seenBefore = new Map<string, boolean>(); const near = this.nearbyPlayers(p.posX, p.posY, p.sessionId);
        for (const o of near) seenBefore.set(o.sessionId, !this.hiddenFrom(o, p));
        const hiddenOthersBefore = new Set(near.filter((o) => this.hiddenFrom(p, o)).map((o) => o.sessionId));
        mutate();
        if (inv === p.status.isInvisible && det === p.status.hasDetectInvisible) return;
        p.send(this.statusMsg(p));
        for (const o of near) {
            if (o.disconnected) continue;
            const sees = !this.hiddenFrom(o, p);
            if (sees && !seenBefore.get(o.sessionId)) o.send(M.playersEnteredRange([p]));
            if (!sees && seenBefore.get(o.sessionId)) o.send(M.playersLeftRange([p.playerId]));
            if (sees) o.send(this.statusMsg(p));
            // lo que yo veo de los demás cambió por Detectar
            const hiddenNow = this.hiddenFrom(p, o);
            if (hiddenOthersBefore.has(o.sessionId) && !hiddenNow) { p.send(M.playersEnteredRange([o])); p.send(this.statusMsg(o)); }
            if (!hiddenOthersBefore.has(o.sessionId) && hiddenNow) p.send(M.playersLeftRange([o.playerId]));
        }
    }

    private spawnLocation(prefX?: number, prefY?: number): { x: number; y: number } {
        const occ = this.occupancy;
        const startX = prefX ?? (this.settings.spawnInMiddle ? Math.floor(occ.sizeX / 2) : Math.floor(Math.random() * occ.sizeX));
        const startY = prefY ?? (this.settings.spawnInMiddle ? Math.floor(occ.sizeY / 2) : Math.floor(Math.random() * occ.sizeY));
        const loc = findNearestFreeLocation((x, y) => occ.isFreeAndNotTeleportCell(x, y), startX, startY, Math.max(occ.sizeX, occ.sizeY));
        if (!loc) throw new Error(`El mundo '${this.id}' no encontró dónde hacer aparecer al jugador.`);
        return loc;
    }

    // ---------- entrada y salida ----------
    playerConnected(sessionId: string, characterName: string, send: Send, requestDisconnect: (r: string) => void, persisted?: PersistedPlayer): void {
        const usePersisted = persisted && (persisted.mapId ?? persisted.worldId) === this.mapId;
        const spawn = this.spawnLocation(usePersisted ? persisted.x : this.config.spawn?.x, usePersisted ? persisted.y : this.config.spawn?.y);
        const p = new Player(sessionId, send, requestDisconnect, this.settings);
        p.characterName = characterName;
        if (persisted) p.applyPersisted(persisted);
        p.setPosition(spawn.x, spawn.y);
        this.occupancy.setOccupied(spawn.x, spawn.y);
        this.players.set(sessionId, p);
        this.playersById.set(p.playerId, p);
        p.world = this;
        console.log(`[Mundo:${this.id}] Entró ${characterName} (#${p.playerId}) en (${spawn.x}, ${spawn.y}). Jugadores: ${this.players.size}`);
        this.completeJoin(p);
    }

    /**
     * Segunda fase de un cruce de mapa: mete en este mundo a un jugador que `detachPlayer` sacó de otro. Conserva todo su estado
     * (economía, vida, maná, estado, temporizadores); el cliente ya armó el mapa y manda el mundo nuevo, los vecinos, los mobs y el suelo.
     */
    attachPlayer(p: Player, x: number, y: number, direction?: number): { x: number; y: number } {
        const spawn = this.spawnLocation(x, y);
        if (direction !== undefined) p.facingDirection = direction;
        p.setPosition(spawn.x, spawn.y);
        this.occupancy.setOccupied(spawn.x, spawn.y);
        this.players.set(p.sessionId, p);
        this.playersById.set(p.playerId, p);
        p.world = this;
        p.resetConnectionState(); // el cliente se trabó armando el mapa: los pings y la cadencia de pasos empiezan de cero
        p.lastDamager = null;
        console.log(`[Mundo:${this.id}] Llegó ${p.characterName} (#${p.playerId}) a (${spawn.x}, ${spawn.y}). Jugadores: ${this.players.size}`);
        this.completeJoin(p, false);
        // llegar a pie a una zona de entrenamiento "de a pie" (los Campos de Sal) abre su portal para después (docs/CIUDADES.md §8)
        const zone = trainingOfMap(this.mapId);
        if (zone?.onFoot && p.econ && this.econ?.unlockZone(p, zone.id)) {
            p.prog = progressFromEcon(p.econ);
            p.send(M.sendMessage(`Portal desbloqueado: ${zone.zone}. Ya podés viajar ahí desde el Portal de Frontera de tu ciudad.`));
        }
        if (p.econ) this.sendVitals(p, false);
        return spawn;
    }

    /**
     * Primera fase de un cruce: saca al jugador de este mundo sin borrar su estado. Libera la celda, avisa a quienes lo veían y
     * le limpia lo que dependía de este mundo (a la vista, suelo visto). Queda fuera de todo mundo hasta `attachPlayer`.
     */
    detachPlayer(sessionId: string): Player | undefined {
        const p = this.players.get(sessionId);
        if (!p) return undefined;
        this.players.delete(sessionId);
        this.playersById.delete(p.playerId);
        this.occupancy.setFree(p.posX, p.posY);
        const left = M.playersLeftRange([p.playerId]);
        for (const o of this.players.values()) {
            if (!o.playersInRange.delete(p.playerId)) continue;
            this.sendTo(o, left);
        }
        p.playersInRange.clear(); p.groundSeen.clear(); this.floorLoot.forget(p.sessionId); p.world = null; p.lastDamager = null;
        this.cancelRecall(p, ''); // cruzar de mapa corta el recall (si es el propio recall, ya terminó)
        console.log(`[Mundo:${this.id}] Se fue ${p.characterName} (cruza de mapa). Jugadores: ${this.players.size}`);
        return p;
    }

    /** Port de Spawn.CompletePlayerJoin: estado inicial, protección al aparecer y visibilidad. */
    private completeJoin(p: Player, sendInitialState = true): void {
        const t = this.settings.timings;
        p.pingGraceUntil = Date.now() + PING_JOIN_GRACE_MS;
        p.groundSeen.clear(); this.floorLoot.forget(p.sessionId); // un socket nuevo no vio nada del suelo: se le manda de nuevo
        if (sendInitialState) p.send(M.initialState(p, {
            pingIntervalMs: this.settings.ping.interval, arrowSpeed: t.arrowSpeed,
            pickupMs: t.playerPickupAnimationTime, bowMs: t.playerBowAnimationTime,
        }));
        p.send(M.initialGameWorldState(this.config, p));

        if (t.spawnProtectionTime > 0) {
            p.spawnProtection = true;
            this.playerTimer(p, t.spawnProtectionTime * 1000, (w) => { if (p.spawnProtection && w.players.get(p.sessionId) === p) w.disableSpawnProtection(p); });
        }

        const nearby = this.nearbyById(p.posX, p.posY, p.sessionId);
        this.sendSnapshots(p, nearby.values());
        const joined = M.playersEnteredRange([p]);
        for (const other of nearby.values()) {
            if (other.disconnected) continue;
            other.send(joined);
            other.playersInRange.add(p.playerId);
        }
        if (t.spawnProtectionTime > 0) p.send(M.spawnProtectionEnabled(p.playerId));
        p.playersInRange.clear();
        for (const id of nearby.keys()) p.playersInRange.add(id);
    }

    private sendSnapshots(recipient: Player, sources: Iterable<Player>): void {
        const list = [...sources].filter((s) => !this.hiddenFrom(recipient, s));
        if (!list.length) return;
        recipient.send(M.playersEnteredRange(list));
        for (const s of list) { const now = Date.now(); if (s.status.isInvisible || activeBuffs(s.status, now).length || isBlessed(s.status, now)) recipient.send(this.statusMsg(s)); recipient.send(M.playerVitals(s.playerId, Math.max(0, Math.round(s.hp)), s.combat.maxHp, shieldOf(s.status, now))); }
        for (const s of list) if (s.disconnected) recipient.send(M.playerDisconnected(s.playerId));
    }

    private disableSpawnProtection(p: Player): void {
        p.spawnProtection = false;
        const m = M.spawnProtectionDisabled(p.playerId);
        p.send(m);
        this.broadcastNear(p, m);
    }

    /** Segundos de espera para salir: en zona segura es inmediato, en zona insegura hay que aguantar quieto. */
    logoutWait(sessionId: string): number {
        const p = this.players.get(sessionId);
        if (!p) return 0;
        return this.map?.safe[Math.floor(p.posY)]?.[Math.floor(p.posX)] ? 0 : 10;
    }

    /** Se cortó la conexión. Si queda en gracia, el personaje sigue en el mundo y se puede atacar. */
    playerDisconnected(sessionId: string, remainsActive: boolean): void {
        const p = this.players.get(sessionId);
        if (!p) return;
        if (!remainsActive) { this.removePlayer(sessionId); return; }
        p.disconnected = true;
        this.cancelRecall(p, '');
        p.resetConnectionState();
        p.send = () => {};
        this.broadcastNear(p, M.playerDisconnected(p.playerId));
        console.log(`[Mundo:${this.id}] ${p.characterName} se desconectó; queda en el mundo durante la gracia.`);
    }

    playerReconnected(sessionId: string, characterName: string, send: Send, requestDisconnect: (r: string) => void): boolean {
        const p = this.players.get(sessionId);
        if (!p) return false;
        p.disconnected = false;
        p.send = send;
        p.requestDisconnect = requestDisconnect;
        p.characterName = characterName;
        p.resetConnectionState();
        this.completeJoin(p);
        this.broadcastNear(p, M.playerReconnected(p.playerId));
        console.log(`[Mundo:${this.id}] ${characterName} volvió a conectarse.`);
        return true;
    }

    /** Saca al jugador del mundo y avisa a quienes lo veían. */
    removePlayer(sessionId: string): PersistedPlayer | undefined {
        const p = this.players.get(sessionId);
        if (!p) return undefined;
        const saved = p.toPersisted(this.mapId);
        this.players.delete(sessionId);
        this.floorLoot.forget(sessionId);
        p.world = null;
        this.playersById.delete(p.playerId);
        this.occupancy.setFree(p.posX, p.posY);
        const left = M.playersLeftRange([p.playerId]);
        for (const id of p.playersInRange) {
            const other = this.playersById.get(id);
            if (!other) continue;
            other.playersInRange.delete(p.playerId);
            this.sendTo(other, left);
        }
        console.log(`[Mundo:${this.id}] Salió ${p.characterName}. Jugadores: ${this.players.size}`);
        return saved;
    }

    snapshot(sessionId: string): PersistedPlayer | undefined {
        return this.players.get(sessionId)?.toPersisted(this.mapId);
    }

    // ---------- paquetes del cliente ----------
    handleClientPacket(sessionId: string, message: ClientMessage): void {
        const p = this.players.get(sessionId);
        if (!p) return;
        const payload = message.payload;
        if (!payload) return;
        this.safe(payload.$case, () => {
            if (p.recallUntil) {
                const why = RECALL_BREAKERS[payload.$case] ?? (payload.$case === 'hpReport' && Number(payload.value.mpSpent) > 0 ? 'Lanzaste un hechizo' : '');
                if (why) this.cancelRecall(p, `${why}: se cortó el regreso a la ciudad.`);
            }
            if (p.windUntil) {
                const why = WIND_BREAKERS[payload.$case] ?? '';
                if (why && !(payload.$case === 'skillRequest' && payload.value.skill === 'aliento')) this.cancelWind(p, `${why}: se cortó el Segundo aliento.`);
            }
            switch (payload.$case) {
                case 'pingRequest':
                    p.send(M.pingResponse(payload.value.sequence, 0, this.players.size, p.pingVariance));
                    p.recordPing(Date.now());
                    break;
                case 'requestMovement':
                    if (payload.value.gameWorldId && payload.value.gameWorldId !== this.id) break;
                    this.handleRequestMovement(p, payload.value);
                    break;
                case 'projectileLaunchRequest': this.handleProjectileLaunch(p, payload.value); break;
                case 'playerPositionRequest': this.handlePositionRequest(p, payload.value.x, payload.value.y); break;
                case 'spellCastStartRequest': this.startCast(p, payload.value.spell); break;
                case 'spellCastCancelRequest': if (p.cast && !p.cast.fired) p.cast = null; break;
                case 'playerMovementStateChangeRequest': {
                    p.setRunningMode(payload.value.runningMode);
                    const m = M.playerMovementStateChanged(p.playerId, p.runningMode, p.movementSpeedMs);
                    p.send(m);
                    this.broadcastNear(p, m);
                    break;
                }
                case 'playerAttackModeChangeRequest':
                    p.attackMode = payload.value.attackMode;
                    this.broadcastNear(p, M.playerAttackModeChanged(p.playerId, p.attackMode));
                    break;
                case 'changePlayerIdleDirectionRequest': {
                    const d = payload.value.direction;
                    if (d < 0 || d > 7) break;
                    p.facingDirection = d;
                    this.broadcastNear(p, M.playerIdleDirectionChanged(p.playerId, d));
                    break;
                }
                case 'pvpHitRequest': {
                    this.resolvePvpHit(p, payload.value);
                    break;
                }
                case 'blinkRequest': this.handleBlink(p, payload.value.x, payload.value.y, payload.value.skill === 'pasoluz' ? 'pasoluz' : 'blink'); break;
                case 'skillRequest': this.handleSkill(p, payload.value.skill, payload.value.targetId, payload.value.mobId); break;
                case 'hpReport': this.acceptHpReport(p, payload.value.hp, payload.value); break;
                case 'potionRequest': this.usePotion(p, payload.value.kind); break;
                case 'econUpgradeRequest': this.econ?.upgrade(p, this.ctx, payload.value.npcId.slice(0, 64), payload.value.uid); break;
                case 'econReforgeRequest': this.econ?.reforge(p, this.ctx, payload.value.npcId.slice(0, 64), payload.value.uid, payload.value.extra); break;
                case 'statAllocRequest': this.econ?.statAlloc(p, this.ctx, payload.value.action.slice(0, 8), payload.value.stat.slice(0, 8), payload.value.points); break;
                case 'econBuyRequest': this.econ?.buy(p, this.ctx, payload.value.npcId, payload.value.stockIndex); break;
                case 'econSellRequest': this.econ?.sell(p, this.ctx, payload.value.npcId, payload.value.uid); break;
                case 'econEquipRequest': this.econ?.equip(p, this.ctx, payload.value.uid); break;
                case 'econUnequipRequest': this.econ?.unequip(p, this.ctx, payload.value.slot); break;
                case 'econDropRequest': this.econ?.drop(p, this.ctx, payload.value.uid); break;
                case 'econSortRequest': this.econ?.sort(p, this.ctx); break;
                case 'pickupRequest': this.econ?.pickup(p, this.ctx, payload.value.id); break;
                case 'clientPickupItem': this.pickupLoot(p, payload.value.lootId.slice(0, 64)); break;
                case 'econQuestRequest': this.econ?.quest(p, this.ctx, payload.value.npcId, payload.value.action, payload.value.key); break;
                case 'auctionRequest': auctionHouse()?.handle(p, this.ctx, payload.value); break; // casa de subastas (docs/SUBASTAS.md)
                case 'depositRequest': depotService()?.handle(p, this.ctx, payload.value); break; // depósito por cuenta (docs/DEPOSITO.md)
                case 'tradeRequest': tradeService()?.handle(p, payload.value, (id) => this.tradePeer(p, id)); break; // Dar e Intercambiar (docs/INTERCAMBIO.md)
                case 'respawnRequest': this.respawn(p); break;
                case 'invisibilityRequest': { // K6: para escapar, no para emboscar. Recarga larga y se corta al atacar, castear o recibir daño.
                    const now = Date.now();
                    if (p.isDead || !this.kitOk(p, 'invisibilidad')) break;
                    if (now < p.invisCdUntil - 1000) { p.send(M.sendMessage(`La invisibilidad se está recargando (faltan ${Math.ceil((p.invisCdUntil - now) / 1000)} s).`)); break; }
                    const left = this.arena ? this.arena.invis.get(p.sessionId) ?? ARENA_RULES.invisUses : Infinity;
                    if (left <= 0) { p.send(M.sendMessage(`Ya usaste las ${ARENA_RULES.invisUses} invisibilidades de esta partida.`)); break; }
                    if (!this.payMp(p, UTIL_MP.invisibilidad)) break;
                    if (this.arena) { this.arena.invis.set(p.sessionId, left - 1); p.send(M.sendMessage(`Invisibilidad: te quedan ${left - 1} en esta partida.`)); }
                    p.invisCdUntil = now + INVIS_CD_MS; this.cancelWind(p, '');
                    this.changeStatus(p, () => castInvisibility(p.status, now)); break;
                }
                case 'detectInvisibleRequest': {
                    const now = Date.now();
                    if (p.isDead || !this.kitOk(p, 'detectar')) break;
                    if (now < p.detectCdUntil - 1000) { p.send(M.sendMessage(`Detectar invisible se está recargando (faltan ${Math.ceil((p.detectCdUntil - now) / 1000)} s).`)); break; }
                    if (!this.payMp(p, UTIL_MP.detectar)) break;
                    p.detectCdUntil = now + DETECT_CD_MS;
                    this.changeStatus(p, () => castDetectInvisible(p.status, now)); break;
                }
                case 'removerRequest': {
                    if (!this.kitOk(p, 'remover') || p.mp < UTIL_MP.remover || !castRemover(p.status, Date.now())) break;
                    this.payMp(p, UTIL_MP.remover);
                    const m = M.pvpHit(p.playerId, { fx: 'sphere', x: p.posX, y: p.posY, targetId: p.playerId, dmg: 0, secs: -1, r: 0 });
                    p.send(m); this.broadcastNear(p, m);
                    break;
                }
                case 'mobHitRequest': if (!this.kitOk(p, payload.value.spell ?? '') || !this.castOk(p, payload.value.spell ?? '', Date.now())) break; this.changeStatus(p, () => breakInvisibility(p.status)); this.mobSim?.hit(p, payload.value); break;
                case 'pveStatusRequest': this.mobSim?.status(p, payload.value); break;
                case 'changePlayerProfileRequest': {
                    const v = String(payload.value.profile ?? '').slice(0, 240);
                    if (!/^[\w;,.\- ]*$/.test(v)) break;
                    p.profile = v;
                    this.broadcastNear(p, M.playerProfileChanged(p));
                    break;
                }
                case 'changePlayerAppearanceRequest': {
                    const v = payload.value;
                    p.gender = clampInt(v.gender, 0, 1);
                    p.skinColor = clampInt(v.skinColor, 0, 2);
                    p.hairStyleIndex = clampInt(v.hairStyleIndex, 0, 7);
                    p.underwearColorIndex = clampInt(v.underwearColorIndex, 0, 7);
                    const m = M.playerAppearanceChanged(p);
                    p.send(m);
                    this.broadcastNear(p, m);
                    break;
                }
                case 'playerTeleportRequested':
                    this.handleTeleport(p, payload.value.x, payload.value.y);
                    break;
                case 'waypointRequest':
                    this.handleWaypoint(p, payload.value.id);
                    break;
                case 'recallRequest':
                    if (payload.value.cancel) this.cancelRecall(p, 'Cancelaste el regreso a la ciudad.');
                    else this.startRecall(p);
                    break;
                case 'changePlayerAttackTypeRequest': p.attackType = clampInt(payload.value.attackType, 0, 3); break;
                case 'changePlayerAllowDashAttackRequest': p.allowDashAttack = payload.value.allowDashAttack; break;
                default:
                    // Combate, hechizos, items, mobs y NPCs llegan en los próximos cortes de la fase 1.
                    break;
            }
        });
    }

    // ---------- movimiento ----------
    /** Port de Movement.HandleRequestMovement (sin combate ni efectos de suelo todavía). */
    /** Vuelve al jugador a la celda que el server conoce (y reinicia su posición decimal y su presupuesto). */
    private snapBack(p: Player, now: number): void {
        p.fx = p.posX + 0.5; p.fy = p.posY + 0.5; p.fCell = { x: p.posX, y: p.posY }; p.moveBudget.reset(now);
        p.send(M.resetPosition(this.id, p.posX, p.posY));
    }

    /**
     * Movimiento libre: el cliente manda su posición decimal. El server no aprueba paso por paso: valida que la velocidad
     * entre en un presupuesto (ver MoveBudget), que la celda nueva sea contigua y esté libre, y lo repite a los que lo ven.
     */
    private handlePositionRequest(p: Player, x: number, y: number): void {
        if (p.isDead || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const now = Date.now();
        if (p.spawnProtection) this.disableSpawnProtection(p);
        // si la posición del server cambió por otra vía (teletransporte, respawn, pedido por celdas), la decimal vuelve al centro
        if (p.fCell.x !== p.posX || p.fCell.y !== p.posY) { p.fx = p.posX + 0.5; p.fy = p.posY + 0.5; p.fCell = { x: p.posX, y: p.posY }; p.moveBudget.reset(now); }
        if (p.isParalyzed(now)) return this.snapBack(p, now);
        const nx = Math.floor(x), ny = Math.floor(y);
        if (!this.inCage(p, nx, ny)) return this.snapBack(p, now);
        const dist = Math.hypot(x - p.fx, y - p.fy);
        if (dist < 1e-4) return;
        if (!p.moveBudget.spend(dist, now, 1000 / p.movementSpeedMs)) {
            if (!p.registerSpeedViolation(now)) {
                const secs = this.settings.movementSpeedViolationsChecker.paralysisDuration;
                p.paralyzeFor(secs, now);
                p.send(M.playerParalyzed(secs));
                p.send(M.sendMessage(`Te movés demasiado rápido. Si estás tocando cosas que no deberías, frená: por ahora te quedás quieto ${secs} segundos.`));
            }
            return this.snapBack(p, now);
        }
        if (nx !== p.posX || ny !== p.posY) {
            if (distance(nx, ny, p.posX, p.posY) !== 1 || !this.occupancy.isFree(nx, ny)) return this.snapBack(p, now);
            this.moveTo(p, p.posX, p.posY, nx, ny, false);
        }
        // dirección que mira: hacia donde se movió (mismo criterio de 8 sectores que el cliente)
        const mx = x - p.fx, my = y - p.fy;
        if (Math.hypot(mx, my) > 0.01) p.facingDirection = (((Math.round(Math.atan2(my, mx) / (Math.PI / 4)) + 2) % 8) + 8) % 8;
        p.fx = x; p.fy = y; p.fCell = { x: p.posX, y: p.posY };
        if (p.cast && !p.cast.fired) p.cast = null; // moverse cancela el cast que no salió
        this.broadcastNear(p, M.playerPositionUpdate(p.playerId, x, y));
    }

    /** Resuelve un golpe de hechizo contra un jugador (daño, control, efectos). `launched`: viene de un proyectil que el server ya validó y cuyo cast ya se consumió. */
    private resolvePvpHit(p: Player, v: { fx: string; x: number; y: number; targetId: bigint; secs: number; r: number; spell: string }, launched = false): void {
        // El server decide el daño: el cliente solo dice qué hechizo y sobre quién (ver systems/pvpCombat.ts).
        const num = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
        const fx = /^[a-z]{0,16}$/.test(v.fx) ? v.fx : '';
        const now = Date.now(), spell = /^[a-z0-9]{0,16}$/.test(v.spell) ? v.spell : '';
        // los avisos de efecto van con tope de ritmo; los golpes con hechizo los limita cada hechizo (recarga y ritmo)
        if (!spell) { if (now - p.lastPvpMs < 40) return; p.lastPvpMs = now; }
        const x = num(v.x, 0, 200), y = num(v.y, 0, 200), r = num(v.r, 0, 6);
        if (spell && !this.kitOk(p, spell)) return; // habilidad de otra clase o de un nivel que no tiene
        // Furia: la lleva el server
        if (spell === 'furia') {
            if (!p.isDead && now >= p.pvp.furyCdUntil && this.payMp(p, UTIL_MP.furia) && p.pvp.castFury(now)) {
                this.broadcastNear(p, M.pvpHit(p.playerId, { fx: fx || 'flamme', x: p.posX, y: p.posY, targetId: 0n, dmg: 0, secs: 0, r: 0 }));
                this.announceStatus(p); this.playerTimer(p, FURY_MS + 30, (w) => w.announceStatus(p));
            }
            return;
        }
        const sp = PVP_SPELLS[spell];
        if (PROJECTILES[spell] && v.targetId && !launched) return;       // los proyectiles esquivables se piden con projectileLaunchRequest
        if (sp && !launched && !this.castOk(p, spell, now)) return; // hechizo sin cast terminado en el server: se descarta
        let dmg = 0, secs = 0;
        if (sp && v.targetId) {
            const tgt = this.playersById.get(v.targetId);
            if (!tgt || tgt === p || tgt.disconnected) return;
            const dTgt = Math.hypot(tgt.posX - p.posX, tgt.posY - p.posY);
            if (dTgt > sp.range + 2.5) return;                                  // muy lejos del que lanza
            if (sp.aoe && Math.hypot(tgt.posX - x, tgt.posY - y) > sp.aoe + 2) return; // fuera del área
            if (p.isDead || !p.pvp.allow(spell, tgt.playerId, now, (c) => this.payMp(p, c))) return; // recarga, ritmo o sin maná
            // K6: sin ventaja de abridor. Contra alguien que no estaba en combate PvP no valen Furia ni los bonus sobre controlado o quemado.
            const opener = !this.inPvp(tgt, now);
            dmg = rollSpellDamage(spell, p.combat, !opener && p.pvp.fury(now));
            if (!opener && sp.vsCtrl && tgt.isParalyzed(now)) dmg = Math.round(dmg * pvpVsCtrl(sp.vsCtrl)); // Esquirla, Juicio, Escudo contra un controlado (tope 1,2× en PvP)
            if (!opener && sp.vsBurn && tgt.burnUntil > now) dmg = Math.round(dmg * sp.vsBurn); // Bola de fuego sobre un quemado
            if (v.secs > 0 && p.pvp.allowSecs(spell, tgt.playerId, now)) secs = sp.secs ?? 0;
            this.changeStatus(p, () => breakInvisibility(p.status));
            if (secs > 0) secs = paralysisSecs(secs, tgt.combat); // la RM (y la resistencia a parálisis) del que recibe acortan la duración
            if (!this.isEnemyPair(p, tgt)) return;                              // mismo bando o zona segura (antes del CC: no gasta DR en aliados)
            if (secs > 0) { // DR por tipo de CC (15 s): full / 50 % / 25 % / inmune
                secs = applyParalysis(tgt.status, now, secs * 1000, STUN_SPELLS.has(spell) ? 'aturdir' : 'paralisis') / 1000;
                if (secs <= 0) { p.send(M.pvpHit(tgt.playerId, { fx: 'resist', x: tgt.posX, y: tgt.posY, targetId: 0n, dmg: 0, secs: 0, r: 0 })); if (dmg <= 0) return; }
            }
        // Tabla de ataque (docs/COMBATE.md): el escudo va último y no cambia si el golpe "entró". Un golpe que se comió entero
        // el escudo igual frena, quema, envenena y devuelve maná; lo que sale de la vida (robo de vida) usa solo lo que pasó.
        const shBefore = shieldOf(tgt.status, now);
        if (dmg > 0) dmg = this.damagePlayer(tgt, dmg, spellDmgKind(spell), p, '', spell === 'ataque' ? '' : spell);
        const landed = dmg > 0 || shieldOf(tgt.status, now) < shBefore;
            if (landed) { // efectos de K3: frenar, quemar, curarse
                if (sp.slow && applySlow(tgt.status, now, sp.slow * 1000) > 0) this.announceStatus(tgt);
                if (sp.burn) this.burnPlayer(tgt, p);
                if (sp.lifesteal && dmg > 0) this.healPlayer(p, Math.round(dmg * sp.lifesteal));
                if (sp.refund) this.refundMp(p, sp.refund);
                if (spellDmgKind(spell) === 'phys' && p.combat.poison > 0 && Math.random() * 100 < p.combat.poison) this.poisonPlayer(tgt, POISON_SECS); // chance de veneno del equipo, como contra los mobs
            }
            if (dmg > 0 || secs > 0) p.send(M.pvpHit(p.playerId, { fx: '', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs, r: 0 })); // para que el que pega vea el número
        } else if (v.targetId) return; // daño sin hechizo conocido: se descarta
        this.broadcastNear(p, M.pvpHit(p.playerId, { fx, x, y, targetId: v.targetId, dmg, secs, r }));
    }

    /** Posición decimal de un jugador (la del último pedido de posición, o el centro de su celda si no se movió desde que cambió de sitio). */
    private decPos(p: Player): { x: number; y: number } {
        return p.fCell.x === p.posX && p.fCell.y === p.posY ? { x: p.fx, y: p.fy } : { x: p.posX + 0.5, y: p.posY + 0.5 };
    }

    /**
     * Proyectil esquivable: el cliente dice a dónde apunta; el server valida el cast, calcula el vuelo con su propia distancia y
     * decide el impacto al llegar mirando dónde está el blanco en ese momento (ver @fdn/world projectiles).
     */
    private handleProjectileLaunch(p: Player, v: { spell: string; targetId: bigint; aimX: number; aimY: number }): void {
        const spell = /^[a-z0-9]{0,16}$/.test(v.spell) ? v.spell : '', ps = PROJECTILES[spell], sp = PVP_SPELLS[spell];
        if (!ps || !sp || p.isDead || !Number.isFinite(v.aimX) || !Number.isFinite(v.aimY) || !this.kitOk(p, spell)) return;
        const tgt = this.playersById.get(v.targetId);
        if (!tgt || tgt === p || tgt.disconnected || tgt.isDead || !this.isEnemyPair(p, tgt)) return;
        const from = this.decPos(p), aim = { x: v.aimX, y: v.aimY };
        if (Math.hypot(aim.x - from.x, aim.y - from.y) > sp.range + 3) return; // apuntó más lejos de lo que llega el hechizo
        if (!this.castOk(p, spell, Date.now())) return;                       // consume el cast, igual que un golpe directo
        const ms = projectileFlightMs(spell, from.x, from.y, aim.x, aim.y);
        this.broadcastNear(p, M.playerProjectile(p.playerId, spell, from.x, from.y, aim.x, aim.y, ms)); // el que lanza ya lo dibujó él
        this.playerTimer(p, ms, (w) => w.projectileImpact(p, tgt, spell, aim));
    }

    /** Llegó el proyectil: pega si el blanco sigue donde se apuntó; si no, erra (y igual cuesta maná y recarga). */
    private projectileImpact(p: Player, tgt: Player, spell: string, aim: { x: number; y: number }): void {
        if (p.isDead || this.players.get(p.sessionId) !== p || this.playersById.get(tgt.playerId) !== tgt || tgt.disconnected || tgt.isDead) return;
        const now = Date.now(), fx = IMPACT_FX[spell] ?? 'splash', tp = this.decPos(tgt);
        if (projectileHits(spell, aim.x, aim.y, tp.x, tp.y)) return this.resolvePvpHit(p, { fx, x: aim.x, y: aim.y, targetId: tgt.playerId, secs: 0, r: 0, spell }, true);
        p.pvp.allow(spell, tgt.playerId, now, (c) => this.payMp(p, c));
        this.broadcastNear(p, M.pvpHit(p.playerId, { fx, x: aim.x, y: aim.y, targetId: 0n, dmg: 0, secs: 0, r: 0 }));
    }

    private handleRequestMovement(p: Player, req: { curX: number; curY: number; destX: number; destY: number; dashAttack: boolean }): void {
        if (p.isDead) return;
        const now = Date.now();
        if (p.spawnProtection) this.disableSpawnProtection(p);
        const deltaMs = p.getAndUpdateLastMovementRequestMs(now);
        if (p.isParalyzed(now)) { p.send(M.resetPosition(this.id, p.posX, p.posY)); return; }
        if (!this.inCage(p, req.destX, req.destY)) { p.send(M.resetPosition(this.id, p.posX, p.posY)); return; }

        if (distance(req.curX, req.curY, p.posX, p.posY) > this.settings.maxCellsJumpDistance) {
            p.send(M.resetPosition(this.id, p.posX, p.posY));
            return;
        }
        // El destino tiene que estar a exactamente un paso de la celda que el server conoce.
        const serverToDest = distance(p.posX, p.posY, req.destX, req.destY);
        if (serverToDest === 0) return;
        if (serverToDest !== 1) { p.send(M.resetPosition(this.id, p.posX, p.posY)); return; }

        if (!this.occupancy.isFree(req.destX, req.destY)) {
            const curX = p.posX, curY = p.posY;
            if (this.settings.courseCorrection) {
                const [lx, ly, rx, ry] = adjacentCellsAt45(curX, curY, req.destX, req.destY);
                for (const [nx, ny] of [[lx, ly], [rx, ry]]) {
                    if (!this.occupancy.isFree(nx, ny)) continue;
                    this.moveTo(p, curX, curY, nx, ny, false);
                    p.send(M.positionCorrected(this.id, curX, curY, nx, ny));
                    return;
                }
            }
            p.send(M.resetPosition(this.id, p.posX, p.posY));
            return;
        }

        if (deltaMs > 0 && !p.checkMovementCadence(deltaMs, now)) {
            const secs = this.settings.movementSpeedViolationsChecker.paralysisDuration;
            p.paralyzeFor(secs, now);
            p.send(M.playerParalyzed(secs));
            p.send(M.sendMessage(`Te movés demasiado rápido. Si estás tocando cosas que no deberías, frená: por ahora te quedás quieto ${secs} segundos.`));
            return;
        }
        if (p.cast && !p.cast.fired) p.cast = null; // un paso cancela el cast
        this.moveTo(p, p.posX, p.posY, req.destX, req.destY, req.dashAttack);
    }

    // ---------- casteo (el cast time lo decide el server) ----------
    private startCast(p: Player, raw: string): void {
        const spell = /^[a-z0-9]{1,16}$/.test(raw ?? '') ? raw : '', now = Date.now();
        if (!isCast(spell)) return;
        if (!this.kitOk(p, spell)) { p.cast = null; p.send(M.spellCastFailed()); return; }
        if (p.isDead || p.isParalyzed(now) || !p.canCast) { p.cast = null; p.send(M.spellCastFailed()); return; }
        const ms = castMsOf(spell);
        this.changeStatus(p, () => breakInvisibility(p.status)); // K6: castear corta la invisibilidad
        p.cast = { spell, okAt: now + ms - CAST_SLACK_MS, until: now + ms + CAST_READY_MS, fired: false };
    }

    /** Kit de clase (paso K1): la habilidad tiene que ser de la clase del jugador y de un nivel que ya alcanzó. Si no, se avisa y se descarta. */
    private kitOk(p: Player, spell: string): boolean {
        const kit = checkSkill(p.combat.cls, p.combat.lvl, spell);
        if (kit.ok) return true;
        const now = Date.now();
        if (now - p.lastKitDeniedMs > 1500) { p.lastKitDeniedMs = now; p.send(M.sendMessage(skillDeniedText(kit))); }
        return false;
    }

    /** true si el golpe de `spell` sale de un cast que el server vio empezar y terminar. Los que no se castean (cuerpo a cuerpo) pasan siempre. */
    private castOk(p: Player, spell: string, now: number): boolean {
        if (!isCast(spell)) return true;
        const c = p.cast;
        if (!c || c.spell !== spell || now < c.okAt || now > c.until) return false;
        if (!c.fired) { c.fired = true; c.until = now + CAST_MULTI_HIT_MS; }
        const sp = PVP_SPELLS[spell];
        if (!sp?.aoe && !sp?.ticks) p.cast = null; // un solo objetivo: el cast se consume con el golpe
        return true;
    }

    private moveTo(p: Player, fromX: number, fromY: number, toX: number, toY: number, dashAttack: boolean, teleport = false): void {
        this.occupancy.setFree(fromX, fromY);
        this.occupancy.setOccupied(toX, toY);
        p.setPosition(toX, toY);
        const dir = nextGridDirection(fromX, fromY, toX, toY);
        if (dir >= 0 && !teleport) p.facingDirection = dir;
        this.syncVisibilityAfterMovement(p, fromX, fromY, toX, toY, dashAttack, teleport);
    }

    // ---------- habilidades de clase ----------
    private cellWalkable(x: number, y: number): boolean { return !!this.map && x >= 0 && y >= 0 && x < this.map.size && y < this.map.size && !this.map.blocked[y][x]; }
    private cellSafe(x: number, y: number): boolean { return !!this.map?.safe[y]?.[x]; }
    private isPortalCell(x: number, y: number): boolean { return !!this.map?.portals?.some((q) => q.x === x && q.y === y) || !!this.def?.links.some((l) => l.x === x && l.y === y); }
    /** Rechazo de una habilidad de clase: el que la pidió se entera (y su cliente devuelve la recarga). */
    private skillDenied(p: Player, skill: string, why: string): void {
        p.send(M.skillEffect(p.playerId, skill, p.posX, p.posY, p.posX, p.posY, false));
        if (why) p.send(M.sendMessage(why));
    }
    /** Chequeos comunes: vivo, no paralizado, clase correcta, recarga y maná alcanza (todavía no cobra). */
    private skillGate(p: Player, id: string): boolean {
        const sp = SKILLS[id], now = Date.now();
        if (!sp || !this.map) return false;
        if (p.isDead) { this.skillDenied(p, id, ''); return false; }
        const kit = checkSkill(p.combat.cls, p.combat.lvl, id);
        if (!kit.ok) { this.skillDenied(p, id, skillDeniedText(kit)); return false; }
        if (p.isParalyzed(now)) { this.skillDenied(p, id, 'Estás paralizado.'); return false; }
        if (!p.pvp.skillReady(id, now)) { this.skillDenied(p, id, 'Todavía se está recargando.'); return false; }
        if (p.mp < skillMpCost(id, this.inPvp(p, now))) { this.skillDenied(p, id, 'No te alcanza el maná.'); return false; }
        return true;
    }
    /** Cobra el maná, arranca la recarga y rompe la invisibilidad: se llama recién cuando la habilidad es válida. */
    private skillCommit(p: Player, id: string): void {
        const now = Date.now(); this.payMp(p, skillMpCost(id, this.inPvp(p, now))); p.pvp.markSkill(id, now);
        this.changeStatus(p, () => breakInvisibility(p.status));
    }
    /** Mueve al jugador de golpe (los cercanos lo ven aparecer en destino) y lo avisa a él. */
    private jumpTo(p: Player, x: number, y: number): void {
        const fx = p.posX, fy = p.posY;
        this.moveTo(p, fx, fy, x, y, false, true);
        p.send(M.playerTeleported(x, y));
    }
    private skillBroadcast(p: Player, id: string, fromX: number, fromY: number): void {
        const m = M.skillEffect(p.playerId, id, fromX, fromY, p.posX, p.posY, true);
        p.send(m); this.broadcastNear(p, m);
    }

    /**
     * Mago: Blink (7 tiles). Healer: Paso de luz (K8, 6 tiles, además se saca el frenado). Hacia (x, y), atraviesa jugadores y mobs,
     * pero no muros: la línea no puede cruzar celdas bloqueadas, y el destino tiene que ser caminable, libre (sin jugador ni mob),
     * sin portal y del mismo lado de la zona segura.
     */
    /** Preparación de arena: no se sale del puesto de salida. */
    private inCage(p: Player, x: number, y: number): boolean {
        const c = this.arena?.phase === 'prep' ? this.arena.cages.get(p.sessionId) : undefined;
        return !c || Math.hypot(x - c.x, y - c.y) <= ARENA_RULES.cageR;
    }
    private handleBlink(p: Player, x: number, y: number, skill: 'blink' | 'pasoluz' = 'blink'): void {
        if (!this.inCage(p, x, y)) return this.skillDenied(p, skill, 'Todavía no arrancó la pelea: quedate en tu puesto.');
        if (!this.skillGate(p, skill)) return;
        const sp = SKILLS[skill], fx = p.posX, fy = p.posY, name = skill === 'blink' ? 'el Blink' : 'el Paso de luz';
        if (!Number.isInteger(x) || !Number.isInteger(y)) return this.skillDenied(p, skill, '');
        const d = Math.hypot(x - fx, y - fy);
        if (d < 1 || d > sp.range) return this.skillDenied(p, skill, d < 1 ? '' : `Está muy lejos para ${name} (máx. ${Math.floor(sp.range)} tiles).`);
        if (!this.cellWalkable(x, y) || !this.occupancy.isFreeAndNotTeleportCell(x, y) || this.isPortalCell(x, y) || this.mobSim?.near(x + 0.5, y + 0.5, 0.75).length)
            return this.skillDenied(p, skill, 'No podés aparecer ahí: la celda está ocupada o bloqueada.');
        if (this.cellSafe(x, y) !== this.cellSafe(fx, fy)) return this.skillDenied(p, skill, `No podés cruzar la zona segura con ${name}.`);
        // línea recta: ningún muro entre medio (las celdas con jugadores o mobs sí se atraviesan)
        const n = Math.ceil(Math.max(Math.abs(x - fx), Math.abs(y - fy)) * 2);
        for (let i = 1; i < n; i++) {
            const cx = Math.round(fx + ((x - fx) * i) / n), cy = Math.round(fy + ((y - fy) * i) / n);
            if (!this.cellWalkable(cx, cy)) return this.skillDenied(p, skill, 'Hay un muro en el camino.');
        }
        this.skillCommit(p, skill);
        this.jumpTo(p, x, y);
        if (skill === 'pasoluz' && isSlowed(p.status, Date.now())) { p.status.slowEndTime = 0; this.announceStatus(p); } // Paso de luz: se saca el frenado
        // los cercanos al destino (y el propio jugador) reciben el efecto; los que solo veían el origen, también
        const m = M.skillEffect(p.playerId, skill, fx, fy, x, y, true);
        p.send(m); this.broadcastNear(p, m);
        const atDest = new Set(this.nearbyPlayers(x, y, p.sessionId));
        for (const o of this.nearbyPlayers(fx, fy, p.sessionId)) if (!atDest.has(o) && !this.hiddenFrom(o, p)) o.send(m);
    }

    /** Camino corto (BFS de 8 vecinos, sin cortar esquinas de muros) por celdas caminables; devuelve el largo o -1. */
    private pathLen(fx: number, fy: number, tx: number, ty: number, max: number): number {
        if (fx === tx && fy === ty) return 0;
        const seen = new Set<number>([fy * 1000 + fx]);
        let frontier: [number, number][] = [[fx, fy]];
        for (let len = 1; len <= max && frontier.length; len++) {
            const next: [number, number][] = [];
            for (const [cx, cy] of frontier) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = cx + dx, ny = cy + dy, k = ny * 1000 + nx;
                if (seen.has(k) || !this.cellWalkable(nx, ny)) continue;
                if (dx && dy && (!this.cellWalkable(cx + dx, cy) || !this.cellWalkable(cx, cy + dy))) continue;
                if (nx === tx && ny === ty) return len;
                seen.add(k); next.push([nx, ny]);
            }
            frontier = next;
        }
        return -1;
    }

    /** Paladin: Carga / Tajo giratorio / Grito de guerra. */
    private handleSkill(p: Player, skill: string, targetId: bigint, mobId: number): void {
        if (skill === 'aliento') return this.startWind(p);
        if (!['carga', 'giro', 'nova', 'mandato', 'aura'].includes(skill) && !(HEALER_SKILLS as readonly string[]).includes(skill) && !(K8_SKILLS as readonly string[]).includes(skill)) return;
        if (!this.skillGate(p, skill)) return;
        const sp = SKILLS[skill], now = Date.now();
        if ((K8_SKILLS as readonly string[]).includes(skill)) return this.k8Skill(p, skill, targetId, now);
        if (sp.cls === 'healer') return this.healerSkill(p, skill, targetId, mobId, now);
        const rollDmg = (tgt?: Player) => rollSpellDamage(skill, p.combat, p.pvp.fury(now) && (!tgt || this.inPvp(tgt, now))); // K6: la Furia no vale en el primer golpe
        const hitPlayer = (tgt: Player, control: boolean) => {
            const dmg = this.damagePlayer(tgt, rollDmg(tgt), 'phys', p, '', skill);
            if (control && sp.slow && applySlow(tgt.status, now, sp.slow * 1000) > 0) this.announceStatus(tgt);
            const secs = control && sp.stun ? applyParalysis(tgt.status, now, sp.stun * 1000, 'aturdir') / 1000 : 0; // Carga sagrada: aturde al llegar (con DR)
            p.send(M.pvpHit(p.playerId, { fx: '', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs, r: 0 })); // número para el que pega
            this.broadcastNear(p, M.pvpHit(p.playerId, { fx: 'crosswind', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs, r: 0 }));
            return dmg;
        };
        if (skill === 'mandato') { // provoca a los monstruos cercanos; a los jugadores no
            this.skillCommit(p, 'mandato');
            this.mobSim?.tauntNear(p, p.posX + 0.5, p.posY + 0.5, sp.aoe!, sp.taunt!);
            this.skillBroadcast(p, 'mandato', p.posX, p.posY);
            return;
        }
        if (skill === 'nova') { // daño y congelado alrededor del mago
            this.skillCommit(p, 'nova');
            const cx = p.posX + 0.5, cy = p.posY + 0.5;
            for (const o of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) {
                if (!this.isEnemyPair(p, o) || o.isDead || Math.hypot(o.posX + 0.5 - cx, o.posY + 0.5 - cy) > sp.aoe!) continue;
                const dmg = this.damagePlayer(o, rollDmg(o), 'magic', p, '', 'nova');
                const secs = applyParalysis(o.status, now, sp.freeze! * 1000, 'paralisis') / 1000;
                this.broadcastNear(p, M.pvpHit(p.playerId, { fx: 'blizz', x: o.posX, y: o.posY, targetId: o.playerId, dmg, secs, r: 0 }));
            }
            if (!this.cellSafe(p.posX, p.posY)) {
                const hits = (this.mobSim?.near(cx, cy, sp.aoe!) ?? []).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, AOE_MAX_TARGETS.nova);
                hits.forEach((m, i) => this.mobSim!.skillHit(p, m.id, Math.max(1, Math.round(rollDmg() * aoeMult(i))), 0, skill, sp.freeze));
            }
            this.skillBroadcast(p, 'nova', p.posX, p.posY);
            return;
        }
        if (skill === 'aura') { // 10 s de pulsos alrededor del paladín: pega a los enemigos cerca y lo cura
            this.skillCommit(p, 'aura');
            for (let k = 1; k <= (sp.pulses ?? 1); k++) this.playerTimer(p, k * (sp.every ?? 0.5) * 1000, () => {
                if (p.isDead || p.disconnected) return;
                const cx = p.posX + 0.5, cy = p.posY + 0.5, t = Date.now(); let dealt = 0;
                for (const o of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) {
                    if (!this.isEnemyPair(p, o) || o.isDead || Math.hypot(o.posX + 0.5 - cx, o.posY + 0.5 - cy) > sp.aoe!) continue;
                    dealt += this.damagePlayer(o, rollSpellDamage('aura', p.combat, p.pvp.fury(t) && this.inPvp(o, t)), 'phys', p, '', 'aura');
                }
                if (!this.cellSafe(p.posX, p.posY)) for (const m of (this.mobSim?.near(cx, cy, sp.aoe!) ?? []).slice(0, AOE_MAX_TARGETS.aura)) {
                    const d = rollSpellDamage('aura', p.combat, p.pvp.fury(t)); dealt += d; this.mobSim!.skillHit(p, m.id, d, 0, 'aura');
                }
                if (dealt > 0) this.healPlayer(p, Math.round(dealt * AURA_HEAL_FRAC));
            });
            this.skillBroadcast(p, 'aura', p.posX, p.posY);
            return;
        }
        if (skill === 'giro') {
            this.skillCommit(p, 'giro');
            const cx = p.posX + 0.5, cy = p.posY + 0.5;
            for (const o of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) {
                if (!this.isEnemyPair(p, o) || o.isDead || Math.hypot(o.posX + 0.5 - cx, o.posY + 0.5 - cy) > sp.aoe!) continue;
                hitPlayer(o, false);
            }
            const sweepMobs = () => {
                if (this.cellSafe(p.posX, p.posY) || p.isDead) return;
                const hits = (this.mobSim?.near(cx, cy, sp.aoe!) ?? []).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, AOE_MAX_TARGETS.giro); // los más cercanos, con tope y caída de daño
                hits.forEach((m, i) => this.mobSim!.skillHit(p, m.id, Math.max(1, Math.round(rollDmg() * aoeMult(i))), 0, skill));
            };
            sweepMobs();
            for (let k = 1; k < (sp.sweeps ?? 1); k++) this.playerTimer(p, 250 * k, () => { // Barrido: el segundo corte 0,25 s después, en el mismo lugar
                sweepMobs();
                for (const o of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) if (this.isEnemyPair(p, o) && !o.isDead && Math.hypot(o.posX + 0.5 - cx, o.posY + 0.5 - cy) <= sp.aoe!) hitPlayer(o, false);
            });
            this.skillBroadcast(p, 'giro', p.posX, p.posY);
            return;
        }
        // carga: contra un jugador enemigo o un mob, a no más de 6 celdas; termina en la celda libre más cercana pegada al blanco
        let tx: number, ty: number, tgt: Player | undefined;
        if (targetId) {
            tgt = this.playersById.get(targetId);
            if (!tgt || tgt === p || tgt.isDead || !this.isEnemyPair(p, tgt)) return this.skillDenied(p, 'carga', 'No podés cargar contra eso.');
            tx = tgt.posX; ty = tgt.posY;
        } else {
            const m = this.mobSim?.get(mobId);
            if (!m) return this.skillDenied(p, 'carga', 'Elegí un objetivo.');
            tx = Math.floor(m.x); ty = Math.floor(m.y);
        }
        if (this.cellSafe(p.posX, p.posY)) return this.skillDenied(p, 'carga', 'No en zona segura.');
        if (Math.hypot(tx - p.posX, ty - p.posY) > sp.range) return this.skillDenied(p, 'carga', 'Está muy lejos para la Carga.');
        let dest: { x: number; y: number } | null = Math.hypot(tx - p.posX, ty - p.posY) < 1.5 ? { x: p.posX, y: p.posY } : null;
        if (!dest) {
            let best = 1e9;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const x = tx + dx, y = ty + dy;
                if ((!dx && !dy) || !this.cellWalkable(x, y) || !this.occupancy.isFreeAndNotTeleportCell(x, y) || this.isPortalCell(x, y) || this.cellSafe(x, y)) continue;
                const len = this.pathLen(p.posX, p.posY, x, y, Math.ceil(sp.range) + 3);
                if (len < 0) continue;
                const score = len + Math.hypot(x - p.posX, y - p.posY) * 0.01;
                if (score < best) { best = score; dest = { x, y }; }
            }
        }
        if (!dest) return this.skillDenied(p, 'carga', 'No hay camino hasta el objetivo.');
        const fx = p.posX, fy = p.posY;
        this.skillCommit(p, 'carga');
        if (dest.x !== fx || dest.y !== fy) this.jumpTo(p, dest.x, dest.y);
        if (tgt) hitPlayer(tgt, true); else this.mobSim!.skillHit(p, mobId, rollDmg(), sp.slow, skill, sp.stun);
        this.skillBroadcast(p, 'carga', fx, fy);
    }

    /**
     * Teletransporte pedido por el cliente. Solo se acepta (a) cruzar un portal del mapa parado sobre él y con el progreso
     * del personaje que lo permite (misión/nivel/llave), o (b) ir al punto de aparición de la propia facción justo al entrar.
     * Con FDN_DEBUG_WARP=1 vale cualquier celda libre (solo para pruebas).
     */
    private handleTeleport(p: Player, reqX: number, reqY: number): void {
        if (p.isDead || (reqX === p.posX && reqY === p.posY) || this.arena) return;
        // al entrar (30 s): ir al hogar de la propia facción, que puede estar en otro mapa (Solmar vive en la Villa de Solmar)
        const home = factionHome(this.factionOf(p)), toHome = !!home && reqX === home.x && reqY === home.y && Date.now() - p.joinedAt < 30000;
        if (toHome && home.map !== this.mapId) { this.transferHook?.(p.sessionId, home, 'home'); return; }
        let x = reqX, y = reqY;
        if (process.env.FDN_DEBUG_WARP !== '1') {
            const portal = this.map?.portals?.find((q) => q.tx === reqX && q.ty === reqY && distance(p.posX, p.posY, q.x, q.y) <= 1);
            if (portal) {
                const why = portalGate(portal, p.prog);
                if (why) { p.send(M.sendMessage(why)); return; }
            } else {
                if (!toHome) { console.log(`[Mundo:${this.id}] ${p.characterName} pidió un teletransporte sin portal a (${reqX}, ${reqY}); lo ignoro`); return; }
            }
            // si alguien ocupa justo la celda de llegada, va a la libre más cercana
            const free = findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), reqX, reqY, 3);
            if (!free) return;
            x = free.x; y = free.y;
            if (portal?.key) { p.prog.keys[portal.key] = Math.max(0, (p.prog.keys[portal.key] ?? 0) - 1); this.econ?.consumeKey(p, portal.key); }
        } else if (!this.occupancy.isFree(x, y)) return;
        this.moveTo(p, p.posX, p.posY, x, y, false, true);
        p.send(M.playerTeleported(x, y));
    }

    /**
     * Valida un pedido de cruzar un vínculo entre mapas. Todo se decide acá: el cliente solo manda el id. Devuelve el vínculo si el
     * jugador puede cruzar ahora; si no, `why` es el aviso para mostrarle (o null si el pedido es basura y se ignora sin ruido).
     */
    checkLink(p: Player, portalId: string): { link: Link } | { why: string | null } {
        if (p.isDead || p.disconnected) return { why: null };
        const link = this.def ? findLink(this.def.id, portalId) : undefined;
        if (!link) { console.log(`[Mundo:${this.id}] ${p.characterName} pidió el portal '${portalId.slice(0, 40)}' que no existe en este mapa; lo ignoro`); return { why: null }; }
        if (distance(p.posX, p.posY, link.x, link.y) > 1) return { why: null }; // lejos del portal (o un pedido viejo)
        const why = linkGateReason(link, p.prog, (i) => QUESTS[i]?.name);
        if (why) return { why };
        return { link };
    }
    /** Descuenta la llave del requisito al cruzar (igual que las escaleras con llave del mapa original). */
    consumeLinkKey(p: Player, link: Link): void {
        const k = link.gate?.key; if (!k) return;
        p.prog.keys[k] = Math.max(0, (p.prog.keys[k] ?? 0) - 1); this.econ?.consumeKey(p, k);
    }

    /**
     * Viaje por el menú de waypoints (portal grande de la ciudad / waypoint de cada zona). Se acepta solo si el jugador está
     * a WAYPOINT_RANGE celdas o menos de algún waypoint y la zona pedida está abierta según el último guardado (misión/nivel/`u`).
     * `id` = 'city' (punto de aparición de su facción) o el id de una zona de entrenamiento.
     */
    private handleWaypoint(p: Player, id: string): void {
        if (p.isDead || !this.map) return;
        // solo el Portal de Frontera de la propia ciudad (las zonas no tienen portal: para volver está el recall)
        const fac = this.factionOf(p);
        if (!this.map.waypoints?.some((q) => q.kind === 'city' && q.faction === fac && distance(p.posX, p.posY, q.x, q.y) <= WAYPOINT_RANGE)) { p.send(M.sendMessage('Tenés que estar junto al Portal de Frontera de tu ciudad.')); return; }
        // el destino puede estar en otro mapa (las zonas siguen en el mapa original; la ciudad de Solmar es la villa)
        const dest = waypointTarget(id, this.factionOf(p));
        if (!dest) return;
        if (dest.step !== undefined) {
            const t = TRAINING[dest.step];
            if (!p.prog.unlocked.includes(t.id) && !trainingUnlocked(t.step, p.prog.qi, p.prog.lvl)) {
                p.send(M.sendMessage(trainingLockedMsg(t)));
                return;
            }
        }
        if (dest.map !== this.mapId) { this.transferHook?.(p.sessionId, dest, 'waypoint'); return; }
        const free = findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), dest.x, dest.y, 3);
        if (!free || (free.x === p.posX && free.y === p.posY)) return;
        this.moveTo(p, p.posX, p.posY, free.x, free.y, false, true);
        p.send(M.playerTeleported(free.x, free.y));
    }

    // ---------- volver a la ciudad (recall, tecla H): el server lleva el canal, lo corta y hace el viaje ----------
    /**
     * Empieza a canalizar el regreso al hogar de la facción (RECALL.channelMs). Se rechaza muerto, desconectado, paralizado, en
     * enfriamiento, en la arena o si ya estás en la plaza de tu ciudad. Mientras se cruza de mapa el jugador no está en ningún mundo,
     * así que el pedido ni llega acá (se ignora).
     */
    private startRecall(p: Player): void {
        const now = Date.now();
        const deny = (why: string) => p.send(M.recallState(false, RECALL.channelMs, 0, Math.max(0, p.recallCdUntil - now), why));
        if (p.recallUntil) { p.send(M.recallState(true, RECALL.channelMs, p.recallUntil - now, 0)); return; }
        if (p.isDead) return deny('No podés volver a la ciudad muerto.');
        if (p.disconnected || p.world !== this) return;
        if (now < p.recallCdUntil) return deny(`Todavía no podés volver a la ciudad (faltan ${Math.ceil((p.recallCdUntil - now) / 1000)} s).`);
        const arena = recallBlockedReason(this.def, p.posX, p.posY); if (arena) return deny(arena);
        if (now - p.pvpHurtAt < RECALL_PVP_LOCK_MS) return deny(`Te pegó un jugador: no podés volver a la ciudad por ${Math.ceil((RECALL_PVP_LOCK_MS - (now - p.pvpHurtAt)) / 1000)} s.`);
        if (p.isParalyzed(now)) return deny('Estás paralizado.');
        const home = factionHome(this.factionOf(p));
        if (!home) return deny('No tenés ciudad a la que volver.');
        if (home.map === this.mapId && Math.hypot(home.x - p.posX, home.y - p.posY) <= 6) return deny('Ya estás en tu ciudad.');
        p.recallUntil = now + RECALL.channelMs; const epoch = ++p.recallEpoch;
        p.meditating = false;
        p.send(M.recallState(true, RECALL.channelMs, RECALL.channelMs, 0));
        this.playerTimer(p, RECALL.channelMs, (w) => w.finishRecall(p, epoch));
    }
    /** Corta el recall en curso (sin enfriamiento). `why` = aviso para el jugador ('' = en silencio). */
    private cancelRecall(p: Player, why: string): void {
        if (!p.recallUntil) return;
        p.recallUntil = 0; p.recallEpoch++;
        p.send(M.recallState(false, RECALL.channelMs, 0, Math.max(0, p.recallCdUntil - Date.now()), why));
    }
    /** Fin del canal (lo corre el mundo donde esté el jugador): arranca el enfriamiento y lo lleva al hogar de su facción. */
    private finishRecall(p: Player, epoch: number): void {
        if (p.recallEpoch !== epoch || !p.recallUntil || p.world !== this) return;
        const now = Date.now();
        p.recallUntil = 0; p.recallEpoch++;
        if (p.isDead || p.disconnected) return;
        p.recallCdUntil = now + RECALL.cooldownMs;
        p.send(M.recallState(false, RECALL.channelMs, 0, RECALL.cooldownMs, ''));
        const home = factionHome(this.factionOf(p)); if (!home) return;
        if (home.map !== this.mapId) { this.transferHook?.(p.sessionId, home, 'recall'); return; }
        const free = findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), home.x, home.y, 6);
        if (!free || (free.x === p.posX && free.y === p.posY)) return;
        this.moveTo(p, p.posX, p.posY, free.x, free.y, false, true);
        p.send(M.playerTeleported(free.x, free.y));
    }

    /** Stats de combate del jugador a partir del personaje del server (equipo y nivel autoritativos). */
    /**
     * SOLO GM: comandos de /gm que actúan dentro de este mundo (el cruce de mapa lo hace index.ts). Devuelve las líneas a mostrarle.
     * El server decide quién es GM (FDN_GM); acá ya se asume autorizado.
     */
    gmCommand(sessionId: string, cmd: string, args: string[]): string[] {
        const p = this.players.get(sessionId); if (!p || !this.map) return ['No estás en un mundo.'];
        const num = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? parseInt(s, 10) : undefined);
        switch (cmd) {
            case 'vel': {
                const n = num(args[0]);
                p.setGmMoveMs(n === undefined ? null : Math.max(120, Math.min(800, n)));
                const m = M.playerMovementStateChanged(p.playerId, p.runningMode, p.movementSpeedMs);
                p.send(m); this.broadcastNear(p, m);
                return [`Velocidad: ${p.movementSpeedMs} ms por celda${p.gmMoveMs === null ? ' (la del juego)' : ''}.`];
            }
            case 'nivel': {
                const n = num(args[0]); if (n === undefined) return ['Uso: /gm nivel <1-60>'];
                if (!this.econ?.gmSet(p, { lvl: n })) return ['Tu personaje todavía no tiene economía.'];
                this.restat(p); p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; this.sendVitals(p, true); this.econ.snapshot(p);
                return [`Nivel ${p.combat.lvl}, vida y maná al máximo.`];
            }
            case 'oro': {
                const n = num(args[0]); if (n === undefined) return ['Uso: /gm oro <cantidad> (puede ser negativa)'];
                if (!this.econ?.gmSet(p, { gold: n })) return ['Tu personaje todavía no tiene economía.'];
                this.econ.snapshot(p); return [`Oro: ${n >= 0 ? '+' : ''}${n}.`];
            }
            case 'llaves': {
                const n = num(args[0]) ?? 20;
                if (!this.econ?.gmSet(p, { keys: n })) return ['Tu personaje todavía no tiene economía.'];
                this.restat(p); this.econ.snapshot(p); return [`Llaves de mazmorra: ${n} de cada una.`];
            }
            case 'bis': {
                const names = this.econ?.gmBis(p, p.combat.cls);
                if (!names) return ['El set completo todavía solo existe para el Mago (y hace falta tener economía).'];
                this.restat(p); p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; this.sendVitals(p, true); this.econ!.snapshot(p);
                return [`Equipado (+5, tiradas máximas): ${names.join(', ')}.`];
            }
            case 'espada': {
                const n = Math.max(1, Math.min(95, num(args[0]) ?? 45)); // 5 % base + n del arma
                p.gmCritUncap = true; // sin esto el tope de 35 % la dejaría en 35
                const name = this.econ?.gmSword(p, n);
                if (!name) return ['Tu personaje todavía no tiene economía.'];
                this.restat(p); this.econ!.snapshot(p);
                return [`${name} equipada: ${Math.min(100, 5 + n)} % de crítico (solo hasta que te desconectes; sin /gm espada el tope vuelve a 35 %).`];
            }
            case 'curar':
                p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; this.sendVitals(p, true); return ['Vida y maná al máximo.'];
            case 'dios':
                p.godMode = !p.godMode; return [p.godMode ? 'Modo dios: ON (no recibís daño).' : 'Modo dios: OFF.'];
            case 'pos': {
                const x = num(args[0]), y = num(args[1]);
                if (x === undefined || y === undefined) return [`Estás en ${this.mapId} (${p.posX}, ${p.posY}). Uso: /gm pos <x> <y> para moverte dentro del mapa.`];
                const free = findNearestFreeLocation((cx, cy) => this.cellWalkable(cx, cy) && this.occupancy.isFree(cx, cy), x, y, 6);
                if (!free) return ['No hay una celda libre cerca de ahí.'];
                this.moveTo(p, p.posX, p.posY, free.x, free.y, false, true); p.send(M.playerTeleported(free.x, free.y));
                return [`Teletransportado a (${free.x}, ${free.y}).`];
            }
            case 'mobs': return ['Tipos: ' + MOB_TYPES.join(', ')];
            case 'mob': {
                if (!this.mobSim) return ['Este mapa no tiene simulación de mobs.'];
                const type = args[0] as MobType;
                if (!MOB_TYPES.includes(type)) return ['Uso: /gm mob <tipo> [nivel] [cantidad]. Tipos con /gm mobs.'];
                const lvl = num(args[1]), n = Math.min(20, Math.max(1, num(args[2]) ?? 1));
                // el cliente dibuja el mob con una zona del mapa: la del mismo tipo si hay, si no la más cercana
                const zs = this.map.zones; let zi = zs.findIndex((z) => z.type === type);
                if (zi < 0) { let bd = Infinity; zs.forEach((z, i) => { const d = Math.hypot(z.x - p.posX, z.y - p.posY); if (d < bd) { bd = d; zi = i; } }); }
                if (zi < 0) return ['Este mapa no tiene zonas de mobs: no puedo dibujarlos en el cliente.'];
                const got = this.mobSim.summon(type, lvl && lvl > 0 ? Math.min(lvl, 60) : undefined, p.posX + 0.5, p.posY + 0.5, n, zi);
                return [`Invocados ${got} ${type}${lvl ? ' nivel ' + lvl : ''}. Con /gm limpiar los sacás.`];
            }
            case 'limpiar': return [`Mobs de GM sacados: ${this.mobSim?.clearGm() ?? 0}.`];
            default: return [];
        }
    }

    private restat(p: Player, login = false): void {
        const prevLvl = p.combat.lvl, st = p.econ;
        p.combat = withBuffs(statsFromChar(st, p.gmCritUncap), p.status, Date.now()); // K8: bendiciones activas encima
        p.pvp.meleeGapMs = meleeIntervalSecs(p.combat.aspd) * 1000; // la velocidad de ataque la fija el equipo que guarda el server
        p.prog = progressFromEcon(st);
        if (login) { p.hp = p.combat.savedHp; p.mp = p.combat.savedMp; }
        else if (p.combat.lvl > prevLvl && !p.isDead) { p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; } // subir de nivel muerto (encargo de la party) no te revive
        else { if (p.hp > p.combat.maxHp) p.hp = p.combat.maxHp; if (p.mp > p.combat.maxMp) p.mp = p.combat.maxMp; }
        this.sendVitals(p, true);
    }

    // ---------- vida, muerte y revivir (la vida la lleva el server) ----------
    private sendVitals(p: Player, announce: boolean): void {
        p.send(M.vitals(Math.max(0, Math.round(p.hp)), p.combat.maxHp, p.isDead, Math.max(0, Math.round(p.mp)), p.combat.maxMp, shieldOf(p.status, Date.now())));
        if (announce) this.announceVitals(p);
    }
    /** Avisa la vida a los cercanos (para la barra), a lo sumo cada 200 ms por jugador. */
    private announceVitals(p: Player, force = false): void {
        const now = Date.now(); if (!force && now - p.lastVitalsAt < 200) return; p.lastVitalsAt = now;
        this.broadcastNear(p, M.playerVitals(p.playerId, Math.max(0, Math.round(p.hp)), p.combat.maxHp, shieldOf(p.status, now)));
    }
    /** El escudo cambió (entró, absorbió o venció): el dueño y los cercanos lo ven en la barra. */
    private flushShield(p: Player): void {
        p.status.vitalsDirty = false; this.sendVitals(p, false); this.announceVitals(p, true);
    }
    private isEnemyPair(a: Player, b: Player): boolean {
        if (a === b || a.disconnected || b.disconnected) return false;
        if (this.arena) { // partida de arena: solo en la pelea y entre equipos distintos (puede ser la misma nación)
            const ta = this.arena.teams.get(a.sessionId), tb = this.arena.teams.get(b.sessionId);
            return this.arena.phase === 'fight' && ta !== undefined && tb !== undefined && ta !== tb;
        }
        const safe = (p: Player) => !!this.map?.safe[Math.floor(p.posY)]?.[Math.floor(p.posX)];
        if (safe(a) || safe(b)) return false;
        const mode = this.def?.pvp ?? 'faction';
        if (mode === 'off') return false; // ciudades, mazmorras y bosses: sin PvP (docs/MUNDO.md 5.0)
        if (mode === 'ffa') return true;
        const ffa = this.def?.ffaRect, arena = (p: Player) => !!ffa && inMapRect(ffa, p.posX, p.posY);
        return this.factionOf(a) !== this.factionOf(b) || (arena(a) && arena(b));
    }
    /** Le saca vida a un jugador: DF (físico) o RM (mágico) del server, daño × 100/(100+X); si llega a 0 muere. Devuelve el daño aplicado. */
    /** Tirada de botín de suelo al morir un mob: si cae algo, lo ven en el acto los jugadores cercanos. */
    private dropLoot(type: MobType, name: string, lvl: number, x: number, y: number, killer?: Player): void {
        const r = rollLoot(type, name, lvl); if (!r) return;
        // modo personal (drops.json): va directo a la bolsa de quien lo mató y de su party en rango, sin pasar por el piso
        if (DROPS.mode === 'personal' && killer && !killer.disconnected && this.econ) {
            const alive = this.partyInRange(killer).filter((m) => !m.isDead), mates = alive.length ? alive : [killer];
            const shares = splitLoot(r.itemId, r.amount, mates.length);
            for (const { i, amount } of shares) {
                const m = mates[i], lvl0 = m.econ?.lvl; this.econ.addLoot(m, r.itemId, amount);
                if (m.econ && m.econ.lvl !== lvl0) this.restat(m);
                m.send(M.sendMessage(r.itemId === 'gold' ? `Botín: ${amount} de oro.` : `Botín: ${r.itemName}${amount > 1 ? ` x${amount}` : ''}.`));
            }
            return;
        }
        // [DM] sin "ninjas": durante LOOT_OWNED_MS solo lo levanta la party del que lo mató (los que estaban cerca)
        const owners = killer && !killer.disconnected ? this.partyInRange(killer).map((m) => m.sessionId) : [];
        const e = this.floorLoot.spawn(x, y, r, owners), m = M.lootSpawn(e);
        for (const o of this.nearbyPlayers(e.x, e.y)) { this.floorLoot.markSeen(o.sessionId, e.lootId); o.send(m); }
    }
    /**
     * ClientPickupItem: vivo, a ≤ 1,5 celdas, que siga ahí y que no sea todavía de otra party. [DM] Lo que levanta alguien de una
     * party se reparte solo entre los compañeros vivos cerca del que lo levantó: el oro en partes iguales y el material, a uno al azar.
     */
    private pickupLoot(p: Player, lootId: string): void {
        if (p.isDead || !this.econ) return;
        const viewers = this.floorLoot.viewersOf(lootId);
        const r = this.floorLoot.pickup(lootId, p.posX, p.posY, p.sessionId);
        if (!r.ok) {
            if (r.reason === 'far') p.send(M.sendMessage('Estás muy lejos para levantarlo.'));
            else if (r.reason === 'locked') p.send(M.sendMessage('Ese botín es de la party que mató al monstruo. En unos segundos queda libre.'));
            return;
        }
        const e = r.loot, mates = this.partyInRange(p).filter((m) => !m.isDead);
        const shares = splitLoot(e.itemId, e.amount, mates.length);
        for (const { i, amount } of shares) {
            const m = mates[i], lvl0 = m.econ?.lvl; this.econ.addLoot(m, e.itemId, amount);
            if (m.econ && m.econ.lvl !== lvl0) this.restat(m); // un encargo del día cobrado al levantar puede subir de nivel
        }
        if (mates.length > 1) { // el aviso del reparto, a cada compañero que entró
            const text = e.itemId === 'gold'
                ? `Reparto de la party: ${e.amount} de oro entre ${mates.length} (${shares.map((x) => `${mates[x.i].characterName} ${x.amount}`).join(', ')}).`
                : `Reparto de la party: ${e.itemName} le tocó a ${mates[shares[0].i].characterName}.`;
            for (const m of mates) m.send(M.sendMessage(text));
        }
        // avisos de botín: a los que lo veían, a los cercanos y a la party solo si está cerca (en Dreadmyst llegaban desde cualquier distancia)
        const m = M.itemPickedUp(e.lootId, M.pid(p.playerId), e.itemName, e.amount, p.characterName), to = new Set([p.sessionId, ...viewers, ...this.nearbyPlayers(e.x, e.y).map((o) => o.sessionId), ...this.partyInRange(p).map((o) => o.sessionId)]);
        for (const sid of to) this.players.get(sid)?.send(m);
    }
    /** Número flotante (daño o cura) para el objetivo y todos los que lo ven. */
    private combatText(tgt: Player, amount: number, heal: boolean, sourceId: string, spell = ''): void {
        if (amount <= 0) return;
        const m = M.combatText(M.pid(tgt.playerId), sourceId, amount, heal, spell);
        tgt.send(m);
        for (const o of this.nearbyPlayers(tgt.posX, tgt.posY, tgt.sessionId)) if (!this.hiddenFrom(o, tgt)) o.send(m);
    }
    /**
     * Cura del server a un jugador (robo de vida, Juicio, Aura sagrada, curas del healer). La Bendición sagrada la sube un 30 %.
     * Si la tira otro (`by`, el healer), los monstruos que pelean con el curado le suman amenaza. Devuelve lo que curó de verdad.
     */
    private healPlayer(p: Player, n: number, by?: Player, spell = ''): number {
        if (p.isDead || n <= 0) return 0;
        const now = Date.now();
        if (isBlessed(p.status, now)) n = Math.round(n * BLESS_HEAL_TAKEN);
        if (isPoisoned(p.status, now)) n = Math.round(n * POISON_HEAL_TAKEN); // veneno: −30 %
        const am = this.healMult(now); if (am < 1) n = Math.round(n * am); // arena: −20 % cada 3 min de pelea
        const got = Math.min(p.combat.maxHp, p.hp + n) - p.hp; if (got <= 0) return 0;
        p.hp += got; this.sendVitals(p, false); this.announceVitals(p); this.combatText(p, got, true, M.pid((by ?? p).playerId), spell);
        if (by) this.mobSim?.healThreat(by, p, Math.round(got * HEAL_THREAT));
        return got;
    }
    /** Devuelve maná (Castigo que pega): nunca pasa del máximo. */
    private refundMp(p: Player, n: number): void {
        if (p.isDead || n <= 0 || p.mp >= p.combat.maxMp) return;
        p.mp = Math.min(p.combat.maxMp, p.mp + n); this.sendVitals(p, false);
    }

    // ---------- healer (K5) ----------
    /** Aliado al que el healer puede curar o bendecir: él mismo o alguien de su nación, vivo, que no sea su enemigo en este lugar (arena, todos contra todos). */
    private isAlly(p: Player, o: Player): boolean {
        if (o === p) return true;
        return !o.disconnected && !o.isDead && this.sideOf(o) === this.sideOf(p) && !this.isEnemyPair(p, o);
    }
    /** Objetivo aliado de una cura: `targetId` 0 (o el propio) es uno mismo. Valida nación, vida y alcance. */
    private allyTarget(p: Player, targetId: bigint, range: number): Player | string {
        if (!targetId || targetId === p.playerId) return p;
        const o = this.playersById.get(targetId);
        if (!o || this.hiddenFrom(p, o) || !this.isAlly(p, o)) return 'Solo podés curar a los de tu nación.';
        if (Math.hypot(o.posX - p.posX, o.posY - p.posY) > range + 1.5) return 'Está muy lejos.';
        return o;
    }
    // ---------- K8: habilidades de nivel 15 a 26 (kits-de-clase.md §2) ----------
    /** Aliados vivos y a la vista a `r` celdas de (x, y), incluido `p` si está en rango (bendiciones de grupo, saltos de la Esfera). */
    private alliesNear(p: Player, x: number, y: number, r: number): Player[] {
        const out: Player[] = [];
        for (const o of [p, ...this.nearbyPlayers(x, y, p.sessionId)]) if (this.isAlly(p, o) && (o === p || !this.hiddenFrom(p, o)) && Math.hypot(o.posX - x, o.posY - y) <= r) out.push(o);
        return out;
    }
    /** Está dentro de la arena (mapa todos contra todos o el recinto `ffaRect`). Las mazmorras no cuentan. */
    private inArenaAt(o: Player): boolean {
        const ffa = this.def?.ffaRect;
        return this.def?.pvp === 'ffa' || (!!ffa && inMapRect(ffa, o.posX, o.posY));
    }
    /** En mazmorras (instancias o mapas temporales) y arenas, Despertar solo vale dentro de los 10 s de la caída. */
    private reviveLimited(o: Player): boolean {
        const ffa = this.def?.ffaRect;
        return this.id.includes('#') || !!this.def?.temporary || this.def?.pvp === 'ffa' || (!!ffa && inMapRect(ffa, o.posX, o.posY));
    }
    /**
     * Escudo de maná, Escudo divino, Escudo guardián; Aura de represalia y Clarividencia; Bendición de poder (`grito`), Bendición de amparo,
     * Intelecto arcano y Bendición de grupo del healer (a los aliados a 14 celdas); Esfera celestial; Despertar. Paso de luz va por `handleBlink`.
     */
    private k8Skill(p: Player, skill: string, targetId: bigint, now: number): void {
        const sp = SKILLS[skill];
        if (sp.cast && !this.castOk(p, skill, now)) return this.skillDenied(p, skill, ''); // bendiciones de grupo (0,8 s) y Despertar (2,4 s) se castean
        if (sp.revive) { // Despertar: a un aliado caído
            if (this.arena) return this.skillDenied(p, skill, 'En la arena no se resucita.');
            const o = targetId ? this.playersById.get(targetId) : undefined;
            if (!o || o === p || o.disconnected || !o.isDead || this.factionOf(o) !== this.factionOf(p) || this.isEnemyPair(p, o)) return this.skillDenied(p, skill, 'Elegí a un aliado caído.');
            if (Math.hypot(o.posX - p.posX, o.posY - p.posY) > sp.range + 1.5) return this.skillDenied(p, skill, 'Está muy lejos.');
            if (this.reviveLimited(o) && now - o.deadAt > BUFF.reviveWindowMs) return this.skillDenied(p, skill, 'Pasaron más de 10 s: acá ya no se lo puede despertar.');
            this.skillCommit(p, skill);
            o.hp = Math.max(1, Math.round(o.combat.maxHp * sp.revive)); o.mp = Math.max(o.mp, Math.round(o.combat.maxMp * sp.revive));
            o.deadAt = 0; o.lastDamager = null; o.potionEpoch++;
            this.sendVitals(o, false); this.announceVitals(o, true);
            o.send(M.sendMessage(`${p.characterName} te despertó.`));
            this.skillBroadcast(p, skill, o.posX, o.posY);
            return;
        }
        if (sp.shield) { // propio (mago y paladín) o al aliado elegido (healer)
            const tgt = sp.range > 0 ? this.allyTarget(p, targetId, sp.range) : p;
            if (typeof tgt === 'string') return this.skillDenied(p, skill, tgt);
            this.skillCommit(p, skill);
            applyShield(tgt.status, now, tgt.combat.maxHp * sp.shield, tgt.combat.maxHp, SHIELD_MS); this.flushShield(tgt);
            this.skillBroadcast(p, skill, tgt.posX, tgt.posY);
            return;
        }
        if (sp.bounce) { // Esfera celestial: cura y salta al aliado más herido a ≤ 6 celdas (puede volver, pero no al mismo de recién)
            const first = this.allyTarget(p, targetId, sp.range);
            if (typeof first === 'string') return this.skillDenied(p, skill, first);
            this.skillCommit(p, skill);
            let cur = first;
            for (let i = 0; i < sp.bounce.n; i++) {
                this.healPlayer(cur, healAmount(sp.heal!, p.combat, cur.combat.maxHp), p, skill);
                this.broadcastNear(p, M.pvpHit(p.playerId, { fx: 'sphere', x: cur.posX, y: cur.posY, targetId: cur.playerId, dmg: 0, secs: 0, r: 0 }));
                const next = this.alliesNear(p, cur.posX, cur.posY, sp.bounce.jump).filter((o) => o !== cur).sort((a, b) => a.hp / a.combat.maxHp - b.hp / b.combat.maxHp)[0];
                if (!next) break;
                cur = next;
            }
            this.skillBroadcast(p, skill, first.posX, first.posY);
            return;
        }
        // bendiciones y auras: a uno mismo, o a los aliados alrededor si la habilidad tiene `aoe`
        this.skillCommit(p, skill);
        const ids = Array.isArray(sp.buff) ? sp.buff : [sp.buff!];
        const to = new Set<Player>(sp.aoe ? this.alliesNear(p, p.posX, p.posY, sp.aoe) : [p]);
        // bendiciones de grupo: toda la party de este mundo (aunque esté lejos o invisible), no solo los de las 14 celdas
        if (sp.party) for (const sid of partyMates(p.sessionId)) { const o = this.players.get(sid); if (o && this.isAlly(p, o)) to.add(o); }
        for (const o of to) {
            const ms = ((sp.buffSecsLong && !this.inArenaAt(o)) ? sp.buffSecsLong : (sp.buffSecs ?? 10)) * 1000; // 15 min afuera, la de Valdrys en la arena
            for (const id of ids) applyBuff(o.status, id, now, ms);
            if (o.status.statDirty) { o.status.statDirty = false; this.restat(o); }
            o.status.dirty = false; this.announceStatus(o);
        }
        this.skillBroadcast(p, skill, p.posX, p.posY);
    }
    /** Curación, Renovar, Bendición sagrada, Nova sagrada y Orbe sagrado. Castigo y Reprender van por pvpHitRequest y mobHitRequest. */
    private healerSkill(p: Player, skill: string, targetId: bigint, mobId: number, now: number): void {
        const sp = SKILLS[skill];
        if (sp.cast && !this.castOk(p, skill, now)) return this.skillDenied(p, skill, ''); // Curación y Orbe se castean (1,5 s) y el server lo cuenta
        const fx = (o: Player) => this.broadcastNear(p, M.pvpHit(p.playerId, { fx: skill === 'bendicion' ? 'spread' : 'sphere', x: o.posX, y: o.posY, targetId: o.playerId, dmg: 0, secs: 0, r: 0 }));
        if (skill === 'novasagrada') { // 1,2× a los enemigos cerca y se cura el 12 % de lo que hizo
            this.skillCommit(p, skill);
            const cx = p.posX + 0.5, cy = p.posY + 0.5, roll = (tgt?: Player) => rollSpellDamage(skill, p.combat, p.pvp.fury(now) && (!tgt || this.inPvp(tgt, now))); let dealt = 0; // K6: la Furia no vale en el primer golpe a un jugador
            for (const o of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) {
                if (!this.isEnemyPair(p, o) || o.isDead || Math.hypot(o.posX + 0.5 - cx, o.posY + 0.5 - cy) > sp.aoe!) continue;
                const d = this.damagePlayer(o, roll(o), 'magic', p, '', skill); dealt += d;
                this.broadcastNear(p, M.pvpHit(p.playerId, { fx: 'spread', x: o.posX, y: o.posY, targetId: o.playerId, dmg: d, secs: 0, r: 0 }));
            }
            if (!this.cellSafe(p.posX, p.posY)) {
                const hits = (this.mobSim?.near(cx, cy, sp.aoe!) ?? []).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, AOE_MAX_TARGETS.novasagrada);
                hits.forEach((m, i) => { const d = Math.max(1, Math.round(roll() * aoeMult(i))); dealt += d; this.mobSim!.skillHit(p, m.id, d, 0, skill); });
            }
            if (dealt > 0) this.healPlayer(p, Math.round(dealt * sp.selfHeal!), undefined, skill);
            this.skillBroadcast(p, skill, p.posX, p.posY);
            return;
        }
        if (skill === 'renovar') { // sobre un enemigo (jugador o monstruo): quemadura; sobre un aliado: cura en el tiempo
            const foe = targetId ? this.playersById.get(targetId) : undefined;
            if (mobId || (foe && foe !== p && !this.isAlly(p, foe))) {
                if (foe) {
                    if (foe.isDead || this.hiddenFrom(p, foe) || !this.isEnemyPair(p, foe)) return this.skillDenied(p, skill, 'No podés usar eso sobre ese objetivo.');
                    if (Math.hypot(foe.posX - p.posX, foe.posY - p.posY) > sp.range + 1.5) return this.skillDenied(p, skill, 'Está muy lejos.');
                    this.skillCommit(p, skill); this.burnPlayer(foe, p); fx(foe);
                } else {
                    const m = this.mobSim?.get(mobId);
                    if (!m) return this.skillDenied(p, skill, 'Elegí un objetivo.');
                    if (Math.hypot(m.x - p.posX - 0.5, m.y - p.posY - 0.5) > sp.range + 1.5) return this.skillDenied(p, skill, 'Está muy lejos.');
                    this.skillCommit(p, skill); this.mobSim!.burnMob(p, mobId);
                }
                this.skillBroadcast(p, skill, p.posX, p.posY);
                return;
            }
        }
        const tgt = this.allyTarget(p, targetId, sp.range);
        if (typeof tgt === 'string') return this.skillDenied(p, skill, tgt);
        if (skill === 'renovar' && now < tgt.renewUntil) return this.skillDenied(p, skill, 'Ya tiene Renovar: hay que esperar a que termine.');
        this.skillCommit(p, skill);
        if (skill === 'curacion') this.healPlayer(tgt, healAmount(sp.heal!, p.combat, tgt.combat.maxHp), p, skill);
        else if (skill === 'renovar') {
            const seq = ++tgt.renewSeq, hot = sp.hot!, per = healAmount(hot.frac, p.combat, tgt.combat.maxHp);
            tgt.renewUntil = now + hot.ticks * hot.every * 1000;
            for (let k = 1; k <= hot.ticks; k++) this.playerTimer(tgt, k * hot.every * 1000, (w) => {
                if (tgt.renewSeq !== seq || tgt.isDead || tgt.disconnected) return;
                const healer = w.playersById.get(p.playerId);
                w.healPlayer(tgt, per, healer && !healer.disconnected ? healer : undefined, skill);
            });
        } else if (skill === 'bendicion') { applyBless(tgt.status, now, sp.bless! * 1000); this.announceStatus(tgt); }
        else if (skill === 'orbe') { // al objetivo y a los aliados a 4 celdas de él
            const near = [tgt, ...this.nearbyPlayers(tgt.posX, tgt.posY, tgt.sessionId)].filter((o) => (o === tgt || Math.hypot(o.posX - tgt.posX, o.posY - tgt.posY) <= sp.aoe!) && this.isAlly(p, o) && !this.hiddenFrom(p, o));
            if (p !== tgt && !near.includes(p) && Math.hypot(p.posX - tgt.posX, p.posY - tgt.posY) <= sp.aoe!) near.push(p);
            for (const o of near) this.healPlayer(o, healAmount(sp.heal!, p.combat, o.combat.maxHp), p, skill);
        }
        fx(tgt);
        this.skillBroadcast(p, skill, tgt.posX, tgt.posY);
    }
    /** Quemadura sobre un jugador: 6 pulsos de ¼ del Daño base de quien la puso, uno cada 0,5 s. Una sola: la nueva reemplaza a la vieja. */
    private burnPlayer(tgt: Player, src: Player): void {
        const seq = ++tgt.burnSeq, dmg = burnTickDmg(src.combat);
        tgt.burnUntil = Date.now() + BURN_TICKS * BURN_EVERY * 1000;
        for (let k = 1; k <= BURN_TICKS; k++) this.playerTimer(tgt, k * BURN_EVERY * 1000, (w) => {
            if (tgt.burnSeq !== seq || tgt.isDead || tgt.disconnected) return;
            const got = w.damagePlayer(tgt, dmg, 'magic', src, '', 'quemadura');
            if (got > 0) w.broadcastNear(tgt, M.pvpHit(src.playerId, { fx: '', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg: got, secs: 0, r: 0 }));
        });
    }

    private damagePlayer(p: Player, raw: number, kind: DmgKind, killer: Player | null, source = '', spell = '', srcId = ''): number {
        if (p.isDead || p.spawnProtection || p.godMode || raw <= 0) return 0;
        const now = Date.now(), pvp = !!killer && killer !== p; // K6: las reglas de PvP valen solo contra jugadores
        if (isBlessed(p.status, now)) raw = Math.max(1, Math.round(raw * BLESS_DMG_TAKEN)); // Bendición sagrada: −20 % de daño recibido
        const tk = buffTakenMult(p.status, now); if (tk !== 1) raw = Math.max(1, Math.round(raw * tk)); // K8: Bendición de amparo y Aura de represalia
        if (pvp) raw = pvpScale(raw); // multiplicador PvP global, antes de la defensa
        let dmg = damageAfterDefense(raw, p.combat, kind);
        if (pvp) { dmg = pvpCap(dmg, p.combat.maxHp); p.pvpHurtAt = now; this.markPvp(p, now); this.markPvp(killer!, now); } // tope por golpe
        const before = dmg; dmg = absorbShield(p.status, now, dmg); // K8: el escudo se come el golpe antes que la vida
        if (before > dmg) { this.flushShield(p); if (dmg <= 0) { this.combatText(p, 0, false, killer ? M.pid(killer.playerId) : srcId, spell); return 0; } }
        p.hp = Math.max(0, p.hp - dmg); p.meditating = false;
        if (dmg > 0) {
            this.changeStatus(p, () => breakInvisibility(p.status)); // recibir daño corta la invisibilidad
            if (spell !== 'quemadura') this.cancelWind(p, 'Te pegaron: se cortó el Segundo aliento.'); // un golpe directo corta el Segundo aliento (la quemadura no)
        }
        this.combatText(p, dmg, false, killer ? M.pid(killer.playerId) : srcId, spell);
        if (dmg > 0) this.cancelRecall(p, 'Te pegaron: se cortó el regreso a la ciudad.');
        if (killer) p.lastDamager = { id: killer.playerId, name: killer.characterName, t: Date.now() };
        else if (source) p.lastDamager = { id: 0n, name: source, t: Date.now() };
        this.sendVitals(p, true);
        if (p.hp < 1) this.killPlayer(p);
        return dmg;
    }
    private killPlayer(p: Player): void {
        p.hp = 0; p.deadAt = Date.now(); p.potionEpoch++; if (!this.arena) this.econ?.onDeath(p); // en la arena morir no cuesta exp // corta la curación en el tiempo de pociones
        this.cancelRecall(p, ''); this.cancelWind(p, ''); p.potionReadyAt = 0; // al morir se libera el bloqueo de pociones (el cliente hace lo mismo)
        clearBuffs(p.status); if (p.status.statDirty) { p.status.statDirty = false; this.restat(p); } // K8: se pierden escudos y bendiciones
        this.changeStatus(p, () => breakInvisibility(p.status));
        p.status.isParalyzed = false;
        const k = p.lastDamager && Date.now() - p.lastDamager.t < 15000 ? p.lastDamager : null;
        const note = M.pvpKill(p.playerId, k?.id ?? 0n, p.characterName, k?.name ?? '');
        this.pvpQuestCredit(p, k?.id);
        for (const o of this.players.values()) if (!o.disconnected) o.send(note);
        this.sendVitals(p, true);
        console.log(`[Mundo:${this.id}] ${p.characterName} murió${k ? ` (${k.name})` : ''}`);
    }
    /**
     * Encargo "Defensa de la frontera": ganó una pelea contra la otra nación en un mapa de facción. No cuenta si la víctima
     * está más de 5 niveles por debajo (freno al farmeo de novatos). A cada rival se le cuenta una vez por día (dos cuentas
     * de naciones distintas no pueden pasarse kills para completarlo).
     */
    private pvpQuestCredit(victim: Player, killerId?: bigint): void {
        if (!killerId || this.def?.pvp !== 'faction') return;
        const killer = this.playersById.get(killerId); if (!killer || killer === victim || !killer.econ || !victim.econ) return;
        if (this.factionOf(killer) === this.factionOf(victim)) return;
        // quests en party [DM]: le cuenta a cada compañero cerca (vivo o muerto), con sus propias reglas (nivel y una vez por rival)
        for (const m of this.partyInRange(killer)) {
            if (m === victim || !m.econ || this.factionOf(m) === this.factionOf(victim) || victim.econ.lvl < m.econ.lvl - 5) continue;
            const lvl0 = m.econ.lvl; this.econ?.questPvp(m, victim.accountKey || victim.characterName);
            if (m.econ.lvl !== lvl0) this.restat(m);
        }
    }
    /** El jugador y sus compañeros de party en este mundo a PARTY_SHARE_RANGE celdas o menos (vivos o muertos). Él siempre va primero. */
    private partyInRange(p: Player): Player[] {
        const out = [p];
        for (const sid of partyMates(p.sessionId)) {
            const m = this.players.get(sid);
            if (m && m !== p && Math.hypot(m.posX - p.posX, m.posY - p.posY) <= PARTY_SHARE_RANGE) out.push(m);
        }
        return out;
    }
    private respawn(p: Player): void {
        if (!p.isDead || Date.now() - p.deadAt < 1800) return;
        if (this.arena) { p.send(M.sendMessage('Caíste: esperá el final de la partida. Al terminar volvés con la vida llena.')); return; }
        p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; p.meditating = false; p.lastDamager = null; p.potionEpoch++;
        // cada mapa define dónde reaparecés (MapDef.respawn): el hogar de tu facción, la entrada de la mazmorra, la posta del claro...
        const fallback = this.config.spawn ?? { x: 6, y: 7 };
        // una vida por corrida: caer en una mazmorra te saca a la superficie (el registro te marca y no podés volver a esta corrida)
        const run = this.isDungeonRun && this.def?.rest;
        if (run) p.send(M.sendMessage('Caíste: tu corrida terminó. Volvés a la superficie.'));
        const target = run ? { ...run } : this.def ? respawnTarget(this.def, this.factionOf(p)) : { map: this.mapId, ...(HUBS[this.factionOf(p)] ?? fallback) };
        if (target.map !== this.mapId) { this.sendVitals(p, true); this.transferHook?.(p.sessionId, target, 'respawn'); return; }
        const hub = target;
        let x = hub.x, y = hub.y;
        for (let r = 0; r < 6 && !this.occupancy.isFree(x, y); r++) { x = hub.x + ((r * 3) % 5) - 2; y = hub.y + 1 + (r % 3); }
        if (!this.occupancy.isFree(x, y)) { const f = findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), hub.x, hub.y, 6); if (f) { x = f.x; y = f.y; } }
        if (this.occupancy.isFree(x, y) && (x !== p.posX || y !== p.posY)) { this.moveTo(p, p.posX, p.posY, x, y, false, true); p.send(M.playerTeleported(x, y)); }
        this.sendVitals(p, true);
        this.announceVitals(p, true);
    }
    /**
     * El cliente informa su vida (curas de hechizo, regeneración, robo de vida): solo se acepta una suba razonable
     * (hasta ~50 % de la máxima por segundo, con 2 s de tope, y, además, como mucho 100 % de la máxima en cualquier ventana de 5 s).
     * Las pociones NO pasan por acá: las cura el server con `potionRequest` (delay global y curación en el tiempo).
     */
    private acceptHpReport(p: Player, reported: number, r?: { mpSpent?: number; mp?: number; meditating?: boolean }): void {
        if (p.isDead) return;
        if (r) this.acceptMpReport(p, r);
        const now = Date.now(), dt = Math.min(2, Math.max(0.05, (now - p.lastHpReportAt) / 1000)); p.lastHpReportAt = now;
        const max = p.combat.maxHp, want = Math.min(max, Math.max(0, Math.round(reported)));
        if (want > p.hp) {
            p.healLog = p.healLog.filter(([t]) => now - t < 5000);
            const room = max - p.healLog.reduce((a, [, n]) => a + n, 0);
            const am = this.healMult(now); // arena: la regeneración también baja con el tiempo de pelea
            const up = Math.floor(Math.max(0, Math.min(want - p.hp, Math.ceil(max * 0.5 * dt) + 2, room)) * am);
            if (up > 0) { p.hp += up; p.healLog.push([now, up]); }
        }
        this.announceVitals(p);
    }

    // ---------- pociones (las cura el server) ----------
    /**
     * Poción de vida (kind 0) o de maná (kind 1). Bloqueo compartido (K6): 1 min en PvE (Valdrys) y 10 s si estás en combate contra
     * jugadores, con pociones de la mitad (la pelea dura y se maneja el recurso, pero no se spamea). 100 ms de margen por la red.
     * Vida: 20 % al instante y el resto en 4 ticks de 0,5 s (2 s); maná: todo al instante.
     */
    private usePotion(p: Player, kind: number): void {
        if (p.isDead || p.disconnected || (kind !== 0 && kind !== 1)) return;
        if (this.arena) { p.send(M.sendMessage('En la arena no se usan pociones.')); return; }
        const now = Date.now();
        if (now < p.potionReadyAt - POTION_GCD_SLACK_MS) { this.sendPotionLock(p, now); return; }
        const max = kind === 0 ? p.combat.maxHp : p.combat.maxMp;
        if ((kind === 0 ? p.hp : p.mp) >= max) return; // lleno: no se gasta el bloqueo
        const pk = kind === 0 ? 'hp' : 'mp';
        if (this.econ) { // las pociones salen del inventario del server
            if (!this.econ.hasPotion(p, pk)) { p.send(M.sendMessage(`No tenés ${pk === 'hp' ? 'pociones de vida' : 'pociones de maná'}.`)); this.econ.snapshot(p); return; }
            this.econ.spendPotion(p, pk);
        }
        const pvp = this.inPvp(p, now);
        p.lastPotionAt = now; p.potionReadyAt = now + potionLockMs(pvp);
        this.econ?.snapshot(p);
        this.sendPotionLock(p, now);
        if (kind === 1) { p.mp = Math.min(max, p.mp + potionMp(max, pvp)); this.sendVitals(p, false); return; }
        const [first, ...ticks] = potionHpSplit(potionHp(max, pvp)), epoch = p.potionEpoch;
        const heal = (w: GameWorld, n: number) => { const got = Math.min(p.combat.maxHp, p.hp + n) - p.hp; p.hp += got; w.sendVitals(p, false); w.announceVitals(p); w.combatText(p, got, true, ''); };
        heal(this, first);
        // la curación en el tiempo sigue al jugador: si cruza de mapa, la termina el mundo donde esté
        ticks.forEach((n, i) => this.playerTimer(p, (i + 1) * POTION_HOT_EVERY_MS, (w) => { if (!p.disconnected && !p.isDead && p.potionEpoch === epoch) heal(w, n); }));
    }
    private sendPotionLock(p: Player, now: number): void {
        p.send(M.abilityState('pocion', { cooldownMs: p.potionReadyAt - now, cooldownTotalMs: p.potionReadyAt - p.lastPotionAt }));
    }

    // ---------- K6: combate contra jugadores ----------
    /** ¿Pegó o recibió daño de otro jugador en los últimos 10 s? */
    private inPvp(p: Player, now: number): boolean { return now < p.pvpCombatUntil; }
    /**
     * Marca a `p` en combate PvP. Al entrar, el bloqueo de pociones que venía del PvE (1 min) se acorta al de PvP (10 s desde la última),
     * así nadie arranca una pelea con el minuto entero encima. Nunca se alarga.
     */
    private markPvp(p: Player, now: number): void {
        const was = this.inPvp(p, now);
        p.pvpCombatUntil = now + PVP_COMBAT_MS;
        if (was) return;
        const short = p.lastPotionAt + POTION_LOCK_PVP_MS;
        if (p.potionReadyAt > short) { p.potionReadyAt = short; this.sendPotionLock(p, now); }
    }

    // ---------- Segundo aliento (común a todas las clases) ----------
    /** Casteo de 3 s quieto; lo cortan un golpe directo, un control, moverse o hacer otra cosa. Recarga de 3,5 min al terminar. */
    private startWind(p: Player): void {
        const now = Date.now();
        const deny = (why: string) => p.send(M.abilityState('aliento', { cooldownMs: p.windCdUntil - now, cooldownTotalMs: SECOND_WIND.cdMs, reason: why }));
        if (p.windUntil) { p.send(M.abilityState('aliento', { channeling: true, channelMs: SECOND_WIND.castMs, remainingMs: p.windUntil - now })); return; }
        if (p.isDead || p.disconnected || p.world !== this) return;
        if (!this.kitOk(p, 'aliento')) return;
        if (now < p.windCdUntil - 1000) return deny(`El Segundo aliento se está recargando (faltan ${Math.ceil((p.windCdUntil - now) / 1000)} s).`);
        if (p.isParalyzed(now)) return deny('Estás paralizado.');
        if (p.hp >= p.combat.maxHp && p.mp >= p.combat.maxMp) return deny('Ya tenés la vida y el maná llenos.');
        p.cast = null; p.meditating = false;
        this.changeStatus(p, () => breakInvisibility(p.status));
        p.windUntil = now + SECOND_WIND.castMs; const epoch = ++p.windEpoch;
        p.send(M.abilityState('aliento', { channeling: true, channelMs: SECOND_WIND.castMs, remainingMs: SECOND_WIND.castMs }));
        this.skillBroadcast(p, 'aliento', p.posX, p.posY);
        this.playerTimer(p, SECOND_WIND.castMs, (w) => w.finishWind(p, epoch));
    }
    /** Corta el Segundo aliento en curso (sin recarga). `why` = aviso para el jugador ('' = en silencio). */
    private cancelWind(p: Player, why: string): void {
        if (!p.windUntil) return;
        p.windUntil = 0; p.windEpoch++;
        p.send(M.abilityState('aliento', { cooldownMs: p.windCdUntil - Date.now(), cooldownTotalMs: SECOND_WIND.cdMs, reason: why }));
    }
    private finishWind(p: Player, epoch: number): void {
        if (p.windEpoch !== epoch || !p.windUntil || p.world !== this) return;
        const now = Date.now();
        p.windUntil = 0; p.windEpoch++;
        if (p.isDead || p.disconnected) return;
        p.windCdUntil = now + SECOND_WIND.cdMs;
        p.send(M.abilityState('aliento', { cooldownMs: SECOND_WIND.cdMs, cooldownTotalMs: SECOND_WIND.cdMs }));
        const h = secondWindHeal(p.combat.maxHp, p.combat.maxMp, this.isPoisoned(p));
        p.mp = Math.min(p.combat.maxMp, p.mp + h.mp);
        this.healPlayer(p, h.hp); this.sendVitals(p, false);
    }
    /** Veneno sobre jugadores (K5): −30 % de curación recibida (curas, robo de vida y Segundo aliento). */
    private isPoisoned(p: Player): boolean { return isPoisoned(p.status, Date.now()); }
    /** Envenena a un jugador `secs` segundos y avisa si recién empieza. */
    private poisonPlayer(p: Player, secs: number): void {
        if (p.isDead || secs <= 0) return;
        applyPoison(p.status, Date.now(), secs * 1000);
        if (p.status.dirty) { p.status.dirty = false; this.announceStatus(p); }
    }


    // ---------- maná (lo lleva el server) ----------
    /** Cobra maná si alcanza; si no, no hace nada. Cualquier lanzamiento corta la meditación. */
    private payMp(p: Player, cost: number): boolean {
        if (p.isDead || p.mp < cost) return false;
        if (cost > 0) { p.mp -= cost; p.meditating = false; this.sendVitals(p, false); }
        return true;
    }
    /** Regeneración con las reglas del server: ciudad 8/s, meditando quieto 8 % de la máxima por s (mín. 6), afuera 2 %/s (mín. 3, combatMpRegen, etapa 6b); en combate PvP 1 %/s con piso de 5 (pvpMpRegen). */
    private regenMana(p: Player, now: number): void {
        if (now < p.nextMpRegenAt) return;
        p.nextMpRegenAt = now + 1000;
        if (p.disconnected) return;
        if (p.meditating && (p.isDead || p.posX !== p.medX || p.posY !== p.medY)) p.meditating = false;
        const max = p.combat.maxMp; if (p.isDead || p.mp >= max) return;
        const inCity = !!this.map?.safe[Math.floor(p.posY)]?.[Math.floor(p.posX)];
        let add = p.meditating ? Math.max(MEDITATE.min, Math.round(max * MEDITATE.pct)) : inCity ? 8 : this.inPvp(p, now) ? pvpMpRegen(max) : combatMpRegen(max); // K7: piso de 5/s peleando contra jugadores
        if (hasBuff(p.status, 'espiritu', now)) add = Math.round(add * BUFF.espirituRegen); // Espíritu divino (K8)
        p.mp = Math.min(max, p.mp + add);
        this.sendVitals(p, false);
    }
    /**
     * Reporte de maná del cliente: lo gastado en hechizos que el server no cobra (curas, hechizos a mobs) solo resta.
     * El maná nunca sube por acá (las pociones van por `potionRequest` y la regeneración la calcula el server). Meditar solo vale quieto.
     */
    private acceptMpReport(p: Player, r: { mpSpent?: number; mp?: number; meditating?: boolean }): void {
        const max = p.combat.maxMp;
        let changed = false;
        const spent = Math.min(max, Math.max(0, Math.round(Number(r.mpSpent) || 0)));
        if (spent > 0) { p.mp = Math.max(0, p.mp - spent); changed = true; }
        const med = !!r.meditating && !p.isDead && p.mp < max;
        if (med && !p.meditating) { p.medX = p.posX; p.medY = p.posY; }
        p.meditating = med;
        if (changed) this.sendVitals(p, false);
    }

    /** Port de Movement.SyncPlayerVisibilityAfterMovement. */
    private syncVisibilityAfterMovement(moved: Player, curX: number, curY: number, destX: number, destY: number, dashAttack: boolean, teleport: boolean): void {
        const before = new Set<bigint>(this.nearbyById(curX, curY, moved.sessionId).keys());
        for (const id of moved.playersInRange) before.add(id);
        const now = this.nearbyById(destX, destY, moved.sessionId);

        const movedMsg = M.playerMoved(moved.playerId, curX, curY, destX, destY, moved.movementSpeedMs, moved.runningMode, dashAttack, teleport);
        for (const id of before) {
            const other = now.get(id);
            if (other && !other.disconnected && !this.hiddenFrom(other, moved)) other.send(movedMsg);
        }

        const newcomers = [...now.values()].filter((o) => !before.has(o.playerId));
        if (newcomers.length) {
            this.sendSnapshots(moved, newcomers);
            const entered = M.playersEnteredRange([moved]);
            for (const o of newcomers) {
                if (o.disconnected) continue;
                if (!this.hiddenFrom(o, moved)) o.send(entered);
                o.playersInRange.add(moved.playerId);
            }
        }

        const leftIds = [...before].filter((id) => !now.has(id));
        if (leftIds.length) {
            moved.send(M.playersLeftRange(leftIds));
            const leftMsg = M.playersLeftRange([moved.playerId]);
            for (const id of leftIds) {
                const o = this.playersById.get(id);
                if (!o || o.disconnected) continue;
                o.send(leftMsg);
                o.playersInRange.delete(moved.playerId);
            }
        }
        moved.playersInRange.clear();
        for (const id of now.keys()) moved.playersInRange.add(id);
    }

    // ---------- ping ----------
    private lastPingCheck = 0;
    private checkPingTimeouts(now: number): void {
        if (now - this.lastPingCheck < 1000) return;
        this.lastPingCheck = now;
        for (const p of this.players.values()) {
            if (p.disconnected || p.lastPingTimeMs <= 0) continue;
            if (p.pingGraceUntil) {
                if (now < p.pingGraceUntil) continue;
                p.pingGraceUntil = 0;
                p.clearPingSamples();
            }
            if (now - p.lastPingTimeMs > this.settings.ping.timeout) {
                p.requestDisconnect('Te desconectamos porque no llegó el ping a tiempo. Lo más probable es que la pestaña del juego se haya suspendido.');
            } else if (p.pingVariance > this.settings.ping.allowedVariance) {
                console.log(`[Mundo:${this.config.id}] Ping inestable de ${p.characterName}: varianza ${p.pingVariance} ms`);
                p.requestDisconnect('Te desconectamos por tener un ping muy inestable. Lo más probable es que la pestaña del juego se haya suspendido.');
            }
        }
    }
}

function clampInt(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(Number(v) || 0)));
}
