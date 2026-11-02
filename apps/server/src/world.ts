/**
 * Un mundo de juego (un mapa). Port recortado de GameWorld.cs, Spawn.cs y Movement.cs.
 *
 * En el original cada mundo es un actor con su propio hilo y una cola de mensajes.
 * Node corre en un solo hilo, así que acá los mensajes se procesan apenas llegan y el
 * tick (cada 50 ms) solo dispara los temporizadores. Más adelante, si hace falta escalar,
 * cada mundo puede ir a su propio worker_thread sin cambiar esta lógica.
 */
import { PARTY_SHARE_RANGE, partyExpMult, partyMates } from './party.ts';
import { AOE_MAX_TARGETS, aoeMult, damageAfterDefense, FURY_MS, paralysisSecs, potionHp, potionHpSplit, potionMp, POTION_GCD_MS, POTION_GCD_SLACK_MS, POTION_HOT_EVERY_MS, progressFromEcon, PVP_SPELLS, rollSpellDamage, SKILLS, spellDmgKind, statsFromChar, UTIL_MP, WARCRY_DEF, WARCRY_MS, WARCRY_RADIUS, type DmgKind } from './systems/pvpCombat.ts';
import { HUBS, QUESTS, RECALL, TRAINING, WAYPOINT_RANGE, factionHome, recallBlockedReason, findLink, inMapRect, linkGateReason, portalGate, respawnTarget, trainingUnlocked, waypointTarget, type Link, type MapDef } from '@fdn/world';
import { applyParalysis, applySlow, applyWarcry, breakInvisibility, castDetectInvisible, castInvisibility, castRemover, expireTimed, hasWarcry, isSlowed, updateStatus } from './systems/statusSystem.ts';
import type { ClientMessage, ServerMessage } from '@fdn/proto';
import type { Catalogs, GameWorldConfig, Settings } from './config.ts';
import { adjacentCellsAt45, distance, findNearestFreeLocation, nextGridDirection } from './location.ts';
import type { Occupancy } from './map.ts';
import * as M from './messages.ts';
import { MobSim } from './mobs.ts';
import { MOB_TYPES, meleeIntervalSecs, type MobType, type WorldMap } from '@fdn/world';
import { Player, type PersistedPlayer, type Send } from './player.ts';
import type { Economy, EconCtx } from './economy.ts';
import { auctionHouse } from './auction.ts';
import { depotService } from './deposit.ts';
import { canPickup, GroundLoot, type GroundApi } from './ground.ts';

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

export class GameWorld {
    private readonly players = new Map<string, Player>();
    private readonly playersById = new Map<bigint, Player>();
    private timers: Timer[] = [];
    private mobSim?: MobSim;
    /** Dormido: sin jugadores, el registro dejó de llamar a tick(). Al despertar los mobs vuelven a empezar. */
    private hibernated = false;
    /** Lo setea el registro de mundos: saca al jugador de este mundo y lo manda a otro mapa (portal, respawn). */
    transferHook?: (sessionId: string, dest: { map: string; x: number; y: number }, why: 'respawn' | 'waypoint' | 'home' | 'recall') => void;
    /** Botín en el suelo de este mundo (solo en memoria). */
    private readonly loot = new GroundLoot();
    private lastGroundSync = 0;

    constructor(
        readonly config: GameWorldConfig,
        private readonly settings: Settings,
        private readonly catalogs: Catalogs,
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
                hurt: (p, raw, source) => this.damagePlayer(p, raw, 'phys', null, source), // los ataques de mobs son físicos (los mitiga la DF)
                stun: (p, secs) => { const s = paralysisSecs(secs, p.combat); return applyParalysis(p.status, Date.now(), s * 1000) ? s : 0; },
                pay: (p, c) => this.payMp(p, c),
                heal: (p, n) => { if (p.isDead) return; p.hp = Math.min(p.combat.maxHp, p.hp + n); this.sendVitals(p, false); this.announceVitals(p); },
                reward: (p, info) => {
                    if (!this.econ) return;
                    // party: cada compañero cerca (mismo mundo, vivo) recibe su propio botín y una parte de la exp (docs/PARTY_Y_ARENAS.md §1)
                    const near = partyMates(p.sessionId).map((sid) => this.players.get(sid)).filter((m): m is Player => !!m && (m === p || (m.hp > 0 && Math.hypot(m.posX - p.posX, m.posY - p.posY) <= PARTY_SHARE_RANGE)));
                    const mult = partyExpMult(near.length);
                    for (const m of near.length ? near : [p]) this.econ.reward(m, this.econCtx, info, mult);
                },
            });
        }
    }

    /** Clave del mundo: el id del mapa, más `#instancia` si es una instancia privada. */
    get id(): string { return this.config.id; }
    get mapId(): string { return this.config.map; }
    get playerCount(): number { return this.players.size; }
    get isHibernated(): boolean { return this.hibernated; }
    get mobCount(): number { return this.mobSim?.count ?? 0; }
    /** El simulador de mobs (tests y mediciones); undefined si el mundo duerme o no tiene mapa. */
    get mobs(): MobSim | undefined { return this.mobSim; }
    playerOf(sessionId: string): Player | undefined { return this.players.get(sessionId); }

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
        if (p.econ) { this.econ.persistVitals(p); if (!p.econSynced) { this.econ.snapshot(p); p.econSynced = true; } }
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
            if (pl.status.dirty) { pl.status.dirty = false; this.announceStatus(pl); }
            this.regenMana(pl, now);
        }
        if (this.mobSim) this.safe('mobs', () => this.mobSim!.update());
        if (now - this.lastGroundSync >= 400) this.safe('suelo', () => this.syncGround(now));
        this.checkPingTimeouts(now);
    }

    /** Vence lo viejo y manda a cada jugador solo las diferencias de lo que tiene a la vista (aparece / sale de rango / desaparece). */
    private syncGround(now = Date.now()): void {
        this.lastGroundSync = now;
        for (const g of this.loot.expired(now)) this.loot.take(g.id);
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
        return target.status.isInvisible && !viewer.status.hasDetectInvisible && this.factionOf(viewer) !== this.factionOf(target);
    }

    /** Estado visible de `p` (invisible, detectar, furia, grito de guerra, ralentizado) para `p` y los cercanos. */
    private statusMsg(p: Player): ServerMessage {
        const now = Date.now();
        return M.statusUpdate(p.playerId, p.status.isInvisible, p.status.hasDetectInvisible, p.pvp.fury(now), hasWarcry(p.status, now), isSlowed(p.status, now));
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
        this.completeJoin(p, true);
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
        this.completeJoin(p, false, false);
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
        p.playersInRange.clear(); p.groundSeen.clear(); p.world = null; p.lastDamager = null;
        this.cancelRecall(p, ''); // cruzar de mapa corta el recall (si es el propio recall, ya terminó)
        console.log(`[Mundo:${this.id}] Se fue ${p.characterName} (cruza de mapa). Jugadores: ${this.players.size}`);
        return p;
    }

    /** Port de Spawn.CompletePlayerJoin: estado inicial, protección al aparecer y visibilidad. */
    private completeJoin(p: Player, includeSpells: boolean, sendInitialState = true): void {
        const t = this.settings.timings;
        p.pingGraceUntil = Date.now() + PING_JOIN_GRACE_MS;
        p.groundSeen.clear(); // un socket nuevo no vio nada del suelo: se le manda de nuevo
        if (sendInitialState) p.send(M.initialState(p, this.catalogs, {
            includeSpells, pingIntervalMs: this.settings.ping.interval, arrowSpeed: t.arrowSpeed,
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
        for (const s of list) { if (s.status.isInvisible || hasWarcry(s.status, Date.now())) recipient.send(this.statusMsg(s)); recipient.send(M.playerVitals(s.playerId, Math.max(0, Math.round(s.hp)), s.combat.maxHp)); }
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
        this.completeJoin(p, true);
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
            switch (payload.$case) {
                case 'pingRequest':
                    p.send(M.pingResponse(payload.value.sequence, 0, this.players.size, p.pingVariance));
                    p.recordPing(Date.now());
                    break;
                case 'requestMovement':
                    if (payload.value.gameWorldId && payload.value.gameWorldId !== this.id) break;
                    this.handleRequestMovement(p, payload.value);
                    break;
                case 'changePlayerMovementSpeedRequest':
                    p.setMovementSpeedMs(payload.value.movementSpeedMs);
                    p.send(M.playerMovementStateChanged(p.playerId, p.runningMode, p.movementSpeedMs));
                    break;
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
                    // El server decide el daño: el cliente solo dice qué hechizo y sobre quién (ver systems/pvpCombat.ts).
                    const v = payload.value, num = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
                    const fx = /^[a-z]{0,16}$/.test(v.fx) ? v.fx : '';
                    const now = Date.now(), spell = /^[a-z0-9]{0,16}$/.test(v.spell) ? v.spell : '';
                    // los avisos de efecto van con tope de ritmo; los golpes con hechizo los limita cada hechizo (recarga y ritmo)
                    if (!spell) { if (now - p.lastPvpMs < 40) break; p.lastPvpMs = now; }
                    const x = num(v.x, 0, 200), y = num(v.y, 0, 200), r = num(v.r, 0, 6);
                    // Furia: la lleva el server
                    if (spell === 'furia') {
                        if (!p.isDead && now >= p.pvp.furyCdUntil && this.payMp(p, UTIL_MP.furia) && p.pvp.castFury(now)) {
                            this.broadcastNear(p, M.pvpHit(p.playerId, { fx: fx || 'flamme', x: p.posX, y: p.posY, targetId: 0n, dmg: 0, secs: 0, r: 0 }));
                            this.announceStatus(p); this.playerTimer(p, FURY_MS + 30, (w) => w.announceStatus(p));
                        }
                        break;
                    }
                    const sp = PVP_SPELLS[spell];
                    let dmg = 0, secs = 0;
                    if (sp && v.targetId) {
                        const tgt = this.playersById.get(v.targetId);
                        if (!tgt || tgt === p || tgt.disconnected) break;
                        const dTgt = Math.hypot(tgt.posX - p.posX, tgt.posY - p.posY);
                        if (dTgt > sp.range + 2.5) break;                                  // muy lejos del que lanza
                        if (sp.aoe && Math.hypot(tgt.posX - x, tgt.posY - y) > sp.aoe + 2) break; // fuera del área
                        if (p.isDead || !p.pvp.allow(spell, tgt.playerId, now, (c) => this.payMp(p, c))) break; // recarga, ritmo o sin maná
                        dmg = rollSpellDamage(spell, p.combat, p.pvp.fury(now));
                        if (v.secs > 0 && p.pvp.allowSecs(spell, tgt.playerId, now)) secs = sp.secs ?? 0;
                        this.changeStatus(p, () => breakInvisibility(p.status));
                        if (secs > 0) secs = paralysisSecs(secs, tgt.combat); // la RM (y la resistencia a parálisis) del que recibe acortan la duración
                        if (secs > 0 && !applyParalysis(tgt.status, now, secs * 1000)) { p.send(M.pvpHit(tgt.playerId, { fx: 'resist', x: tgt.posX, y: tgt.posY, targetId: 0n, dmg: 0, secs: 0, r: 0 })); secs = 0; if (dmg <= 0) break; }
                        if (!this.isEnemyPair(p, tgt)) break;                              // mismo bando o zona segura
                        if (dmg > 0) dmg = this.damagePlayer(tgt, dmg, spellDmgKind(spell), p);              // la vida del que recibe la lleva el server
                        if (dmg > 0 || secs > 0) p.send(M.pvpHit(p.playerId, { fx: '', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs, r: 0 })); // para que el que pega vea el número
                    } else if (v.targetId) break; // daño sin hechizo conocido: se descarta
                    this.broadcastNear(p, M.pvpHit(p.playerId, { fx, x, y, targetId: v.targetId, dmg, secs, r }));
                    break;
                }
                case 'blinkRequest': this.handleBlink(p, payload.value.x, payload.value.y); break;
                case 'skillRequest': this.handleSkill(p, payload.value.skill, payload.value.targetId, payload.value.mobId); break;
                case 'hpReport': this.acceptHpReport(p, payload.value.hp, payload.value); break;
                case 'potionRequest': this.usePotion(p, payload.value.kind); break;
                case 'econUpgradeRequest': this.econ?.upgrade(p, this.ctx, payload.value.npcId.slice(0, 64), payload.value.uid); break;
                case 'statAllocRequest': this.econ?.statAlloc(p, this.ctx, payload.value.action.slice(0, 8), payload.value.stat.slice(0, 8), payload.value.points); break;
                case 'econBuyRequest': this.econ?.buy(p, this.ctx, payload.value.npcId, payload.value.stockIndex); break;
                case 'econSellRequest': this.econ?.sell(p, this.ctx, payload.value.npcId, payload.value.uid); break;
                case 'econEquipRequest': this.econ?.equip(p, this.ctx, payload.value.uid); break;
                case 'econUnequipRequest': this.econ?.unequip(p, this.ctx, payload.value.slot); break;
                case 'econDropRequest': this.econ?.drop(p, this.ctx, payload.value.uid); break;
                case 'econSortRequest': this.econ?.sort(p, this.ctx); break;
                case 'pickupRequest': this.econ?.pickup(p, this.ctx, payload.value.id); break;
                case 'econQuestRequest': this.econ?.quest(p, this.ctx, payload.value.npcId, payload.value.action, payload.value.key); break;
                case 'auctionRequest': auctionHouse()?.handle(p, this.ctx, payload.value); break; // casa de subastas (docs/SUBASTAS.md)
                case 'depositRequest': depotService()?.handle(p, this.ctx, payload.value); break; // depósito por cuenta (docs/DEPOSITO.md)
                case 'respawnRequest': this.respawn(p); break;
                case 'invisibilityRequest': { if (p.isDead || !this.payMp(p, UTIL_MP.invisibilidad)) break; this.changeStatus(p, () => castInvisibility(p.status, Date.now())); break; }
                case 'detectInvisibleRequest': { if (p.isDead || !this.payMp(p, UTIL_MP.detectar)) break; this.changeStatus(p, () => castDetectInvisible(p.status, Date.now())); break; }
                case 'removerRequest': {
                    if (p.mp < UTIL_MP.remover || !castRemover(p.status, Date.now())) break;
                    this.payMp(p, UTIL_MP.remover);
                    const m = M.pvpHit(p.playerId, { fx: 'sphere', x: p.posX, y: p.posY, targetId: p.playerId, dmg: 0, secs: -1, r: 0 });
                    p.send(m); this.broadcastNear(p, m);
                    break;
                }
                case 'mobHitRequest': this.changeStatus(p, () => breakInvisibility(p.status)); this.mobSim?.hit(p, payload.value); break;
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
                case 'changePlayerAttackStunDurationRequest': p.attackStunDurationMs = clampInt(payload.value.attackStunDurationMs, 100, 2000); break;
                case 'changePlayerAttackSpeedRequest': p.attackSpeedMs = clampInt(payload.value.attackSpeedMs, 100, 2000); break;
                case 'changePlayerCastSpeedRequest': p.castSpeedMs = clampInt(payload.value.castSpeedMs, 200, 2000); break;
                case 'changePlayerAttackTypeRequest': p.attackType = clampInt(payload.value.attackType, 0, 3); break;
                case 'changePlayerAllowDashAttackRequest': p.allowDashAttack = payload.value.allowDashAttack; break;
                case 'changePlayerAttackRangeRequest': p.attackRangeCells = clampInt(payload.value.attackRangeCells, 1, 10); break;
                case 'changePlayerAttackDamageRequest': p.damage = clampInt(payload.value.attackDamage, 1, 100000); break;
                default:
                    // Combate, hechizos, items, mobs y NPCs llegan en los próximos cortes de la fase 1.
                    break;
            }
        });
    }

    // ---------- movimiento ----------
    /** Port de Movement.HandleRequestMovement (sin combate ni efectos de suelo todavía). */
    private handleRequestMovement(p: Player, req: { curX: number; curY: number; destX: number; destY: number; dashAttack: boolean }): void {
        if (p.isDead) return;
        const now = Date.now();
        if (p.spawnProtection) this.disableSpawnProtection(p);
        const deltaMs = p.getAndUpdateLastMovementRequestMs(now);
        if (p.isParalyzed(now)) { p.send(M.resetPosition(this.id, p.posX, p.posY)); return; }

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
        this.moveTo(p, p.posX, p.posY, req.destX, req.destY, req.dashAttack);
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
        if (p.combat.cls !== sp.cls) { this.skillDenied(p, id, `Esa habilidad es de ${sp.cls === 'mago' ? 'Mago' : 'Guerrero'}.`); return false; }
        if (p.isParalyzed(now)) { this.skillDenied(p, id, 'Estás paralizado.'); return false; }
        if (!p.pvp.skillReady(id, now)) { this.skillDenied(p, id, 'Todavía se está recargando.'); return false; }
        if (p.mp < sp.mp) { this.skillDenied(p, id, 'No te alcanza el maná.'); return false; }
        return true;
    }
    /** Cobra el maná, arranca la recarga y rompe la invisibilidad: se llama recién cuando la habilidad es válida. */
    private skillCommit(p: Player, id: string): void {
        this.payMp(p, SKILLS[id].mp); p.pvp.markSkill(id, Date.now());
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
     * Mago: Blink. Hasta 4 celdas hacia (x, y), atraviesa jugadores y mobs, pero no muros: la línea no puede cruzar celdas
     * bloqueadas, y el destino tiene que ser caminable, libre (sin jugador ni mob), sin portal y del mismo lado de la zona segura.
     */
    private handleBlink(p: Player, x: number, y: number): void {
        if (!this.skillGate(p, 'blink')) return;
        const sp = SKILLS.blink, fx = p.posX, fy = p.posY;
        if (!Number.isInteger(x) || !Number.isInteger(y)) return this.skillDenied(p, 'blink', '');
        const d = Math.hypot(x - fx, y - fy);
        if (d < 1 || d > sp.range) return this.skillDenied(p, 'blink', d < 1 ? '' : 'Está muy lejos para el Blink (máx. 4 celdas).');
        if (!this.cellWalkable(x, y) || !this.occupancy.isFreeAndNotTeleportCell(x, y) || this.isPortalCell(x, y) || this.mobSim?.near(x + 0.5, y + 0.5, 0.75).length)
            return this.skillDenied(p, 'blink', 'No podés aparecer ahí: la celda está ocupada o bloqueada.');
        if (this.cellSafe(x, y) !== this.cellSafe(fx, fy)) return this.skillDenied(p, 'blink', 'No podés cruzar la zona segura con el Blink.');
        // línea recta: ningún muro entre medio (las celdas con jugadores o mobs sí se atraviesan)
        const n = Math.ceil(Math.max(Math.abs(x - fx), Math.abs(y - fy)) * 2);
        for (let i = 1; i < n; i++) {
            const cx = Math.round(fx + ((x - fx) * i) / n), cy = Math.round(fy + ((y - fy) * i) / n);
            if (!this.cellWalkable(cx, cy)) return this.skillDenied(p, 'blink', 'Hay un muro en el camino.');
        }
        this.skillCommit(p, 'blink');
        this.jumpTo(p, x, y);
        // los cercanos al destino (y el propio jugador) reciben el efecto; los que solo veían el origen, también
        const m = M.skillEffect(p.playerId, 'blink', fx, fy, x, y, true);
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

    /** Guerrero: Carga / Tajo giratorio / Grito de guerra. */
    private handleSkill(p: Player, skill: string, targetId: bigint, mobId: number): void {
        if (skill !== 'carga' && skill !== 'giro' && skill !== 'grito') return;
        if (!this.skillGate(p, skill)) return;
        const sp = SKILLS[skill], now = Date.now();
        const rollDmg = () => rollSpellDamage(skill, p.combat, p.pvp.fury(now));
        const hitPlayer = (tgt: Player, slow: boolean) => {
            const dmg = this.damagePlayer(tgt, rollDmg(), 'phys', p);
            if (slow && sp.slow) { applySlow(tgt.status, now, sp.slow * 1000); this.announceStatus(tgt); }
            p.send(M.pvpHit(p.playerId, { fx: '', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs: 0, r: 0 })); // número para el que pega
            this.broadcastNear(p, M.pvpHit(p.playerId, { fx: 'crosswind', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs: 0, r: 0 }));
            return dmg;
        };
        if (skill === 'grito') {
            this.skillCommit(p, 'grito');
            const fac = this.factionOf(p);
            for (const o of [p, ...this.nearbyPlayers(p.posX, p.posY, p.sessionId)]) {
                if (o.disconnected || o.isDead || this.factionOf(o) !== fac || Math.hypot(o.posX - p.posX, o.posY - p.posY) > WARCRY_RADIUS) continue;
                applyWarcry(o.status, now, WARCRY_MS); this.announceStatus(o);
            }
            this.skillBroadcast(p, 'grito', p.posX, p.posY);
            return;
        }
        if (skill === 'giro') {
            this.skillCommit(p, 'giro');
            const cx = p.posX + 0.5, cy = p.posY + 0.5;
            for (const o of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) {
                if (!this.isEnemyPair(p, o) || o.isDead || Math.hypot(o.posX + 0.5 - cx, o.posY + 0.5 - cy) > sp.aoe!) continue;
                hitPlayer(o, false);
            }
            if (!this.cellSafe(p.posX, p.posY)) {
                const hits = (this.mobSim?.near(cx, cy, sp.aoe!) ?? []).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, AOE_MAX_TARGETS.giro); // los más cercanos, con tope y caída de daño
                hits.forEach((m, i) => this.mobSim!.skillHit(p, m.id, Math.max(1, Math.round(rollDmg() * aoeMult(i)))));
            }
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
                const len = this.pathLen(p.posX, p.posY, x, y, 9);
                if (len < 0) continue;
                const score = len + Math.hypot(x - p.posX, y - p.posY) * 0.01;
                if (score < best) { best = score; dest = { x, y }; }
            }
        }
        if (!dest) return this.skillDenied(p, 'carga', 'No hay camino hasta el objetivo.');
        const fx = p.posX, fy = p.posY;
        this.skillCommit(p, 'carga');
        if (dest.x !== fx || dest.y !== fy) this.jumpTo(p, dest.x, dest.y);
        if (tgt) hitPlayer(tgt, true); else this.mobSim!.skillHit(p, mobId, rollDmg(), sp.slow);
        this.skillBroadcast(p, 'carga', fx, fy);
    }

    /**
     * Teletransporte pedido por el cliente. Solo se acepta (a) cruzar un portal del mapa parado sobre él y con el progreso
     * del personaje que lo permite (misión/nivel/llave), o (b) ir al punto de aparición de la propia facción justo al entrar.
     * Con FDN_DEBUG_WARP=1 vale cualquier celda libre (solo para pruebas).
     */
    private handleTeleport(p: Player, reqX: number, reqY: number): void {
        if (p.isDead || (reqX === p.posX && reqY === p.posY)) return;
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
                p.send(M.sendMessage(`Portal bloqueado (${t.zone}): ${t.after ? `entregá «${t.after}» al Capitán` : 'todavía no'} o llegá al nivel ${t.lvl}.`));
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
        p.combat = statsFromChar(st);
        p.pvp.meleeGapMs = meleeIntervalSecs(p.combat.aspd) * 1000; // la velocidad de ataque la fija el equipo que guarda el server
        p.prog = progressFromEcon(st);
        if (login) { p.hp = p.combat.savedHp; p.mp = p.combat.savedMp; }
        else if (p.combat.lvl > prevLvl) { p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; }
        else { if (p.hp > p.combat.maxHp) p.hp = p.combat.maxHp; if (p.mp > p.combat.maxMp) p.mp = p.combat.maxMp; }
        this.sendVitals(p, true);
    }

    // ---------- vida, muerte y revivir (la vida la lleva el server) ----------
    private sendVitals(p: Player, announce: boolean): void {
        p.send(M.vitals(Math.max(0, Math.round(p.hp)), p.combat.maxHp, p.isDead, Math.max(0, Math.round(p.mp)), p.combat.maxMp));
        if (announce) this.announceVitals(p);
    }
    /** Avisa la vida a los cercanos (para la barra), a lo sumo cada 200 ms por jugador. */
    private announceVitals(p: Player, force = false): void {
        const now = Date.now(); if (!force && now - p.lastVitalsAt < 200) return; p.lastVitalsAt = now;
        this.broadcastNear(p, M.playerVitals(p.playerId, Math.max(0, Math.round(p.hp)), p.combat.maxHp));
    }
    private isEnemyPair(a: Player, b: Player): boolean {
        if (a === b || a.disconnected || b.disconnected) return false;
        const safe = (p: Player) => !!this.map?.safe[Math.floor(p.posY)]?.[Math.floor(p.posX)];
        if (safe(a) || safe(b)) return false;
        const mode = this.def?.pvp ?? 'faction';
        if (mode === 'off') return false; // ciudades, mazmorras y bosses: sin PvP (docs/MUNDO.md 5.0)
        if (mode === 'ffa') return true;
        const ffa = this.def?.ffaRect, arena = (p: Player) => !!ffa && inMapRect(ffa, p.posX, p.posY);
        return this.factionOf(a) !== this.factionOf(b) || (arena(a) && arena(b));
    }
    /** Le saca vida a un jugador: DF (físico) o RM (mágico) del server, daño × 100/(100+X); si llega a 0 muere. Devuelve el daño aplicado. */
    private damagePlayer(p: Player, raw: number, kind: DmgKind, killer: Player | null, source = ''): number {
        if (p.isDead || p.spawnProtection || p.godMode || raw <= 0) return 0;
        const dmg = damageAfterDefense(raw, hasWarcry(p.status, Date.now()) ? { ...p.combat, def: p.combat.def + WARCRY_DEF } : p.combat, kind); // el Grito de guerra suma a la defensa antes de la fórmula
        p.hp = Math.max(0, p.hp - dmg); p.meditating = false;
        if (dmg > 0) this.cancelRecall(p, 'Te pegaron: se cortó el regreso a la ciudad.');
        if (killer) p.lastDamager = { id: killer.playerId, name: killer.characterName, t: Date.now() };
        else if (source) p.lastDamager = { id: 0n, name: source, t: Date.now() };
        this.sendVitals(p, true);
        if (p.hp < 1) this.killPlayer(p);
        return dmg;
    }
    private killPlayer(p: Player): void {
        p.hp = 0; p.deadAt = Date.now(); p.potionEpoch++; this.econ?.onDeath(p); // corta la curación en el tiempo de pociones
        this.cancelRecall(p, '');
        this.changeStatus(p, () => breakInvisibility(p.status));
        p.status.isParalyzed = false;
        const k = p.lastDamager && Date.now() - p.lastDamager.t < 15000 ? p.lastDamager : null;
        const note = M.pvpKill(p.playerId, k?.id ?? 0n, p.characterName, k?.name ?? '');
        for (const o of this.players.values()) if (!o.disconnected) o.send(note);
        this.sendVitals(p, true);
        console.log(`[Mundo:${this.id}] ${p.characterName} murió${k ? ` (${k.name})` : ''}`);
    }
    private respawn(p: Player): void {
        if (!p.isDead || Date.now() - p.deadAt < 1800) return;
        p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; p.meditating = false; p.lastDamager = null; p.potionEpoch++;
        // cada mapa define dónde reaparecés (MapDef.respawn): el hogar de tu facción, la entrada de la mazmorra, la posta del claro...
        const fallback = this.config.spawn ?? { x: 6, y: 7 };
        const target = this.def ? respawnTarget(this.def, this.factionOf(p)) : { map: this.mapId, ...(HUBS[this.factionOf(p)] ?? fallback) };
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
            const up = Math.max(0, Math.min(want - p.hp, Math.ceil(max * 0.5 * dt) + 2, room));
            if (up > 0) { p.hp += up; p.healLog.push([now, up]); }
        }
        this.announceVitals(p);
    }

    // ---------- pociones (las cura el server) ----------
    /**
     * Poción de vida (kind 0) o de maná (kind 1). Delay global de 1,75 s entre cualquier poción (con 100 ms de margen por la red),
     * como mucho 5 por ventana de 10 s. Vida: 20 % al instante y el resto en 4 ticks de 0,5 s (2 s); maná: todo al instante.
     */
    private usePotion(p: Player, kind: number): void {
        if (p.isDead || p.disconnected || (kind !== 0 && kind !== 1)) return;
        const now = Date.now();
        if (now - p.lastPotionAt < POTION_GCD_MS - POTION_GCD_SLACK_MS) return;
        p.potionLog = p.potionLog.filter((t) => now - t < 10000);
        if (p.potionLog.length >= 5) return;
        const max = kind === 0 ? p.combat.maxHp : p.combat.maxMp;
        if ((kind === 0 ? p.hp : p.mp) >= max) return; // lleno: no se gasta el delay
        const pk = kind === 0 ? 'hp' : 'mp';
        if (this.econ) { // las pociones salen del inventario del server
            if (!this.econ.hasPotion(p, pk)) { p.send(M.sendMessage(`No tenés ${pk === 'hp' ? 'pociones de vida' : 'pociones de maná'}.`)); this.econ.snapshot(p); return; }
            this.econ.spendPotion(p, pk);
        }
        p.lastPotionAt = now; p.potionLog.push(now);
        this.econ?.snapshot(p);
        if (kind === 1) { p.mp = Math.min(max, p.mp + potionMp(max)); this.sendVitals(p, false); return; }
        const [first, ...ticks] = potionHpSplit(potionHp(max)), epoch = p.potionEpoch;
        const heal = (w: GameWorld, n: number) => { p.hp = Math.min(p.combat.maxHp, p.hp + n); w.sendVitals(p, false); w.announceVitals(p); };
        heal(this, first);
        // la curación en el tiempo sigue al jugador: si cruza de mapa, la termina el mundo donde esté
        ticks.forEach((n, i) => this.playerTimer(p, (i + 1) * POTION_HOT_EVERY_MS, (w) => { if (!p.disconnected && !p.isDead && p.potionEpoch === epoch) heal(w, n); }));
    }


    // ---------- maná (lo lleva el server) ----------
    /** Cobra maná si alcanza; si no, no hace nada. Cualquier lanzamiento corta la meditación. */
    private payMp(p: Player, cost: number): boolean {
        if (p.isDead || p.mp < cost) return false;
        if (cost > 0) { p.mp -= cost; p.meditating = false; this.sendVitals(p, false); }
        return true;
    }
    /** Regeneración con las reglas del server: ciudad 8/s, meditando quieto 8 % de la máxima por s (mín. 6), afuera 2/s. */
    private regenMana(p: Player, now: number): void {
        if (now < p.nextMpRegenAt) return;
        p.nextMpRegenAt = now + 1000;
        if (p.disconnected) return;
        if (p.meditating && (p.isDead || p.posX !== p.medX || p.posY !== p.medY)) p.meditating = false;
        const max = p.combat.maxMp; if (p.isDead || p.mp >= max) return;
        const inCity = !!this.map?.safe[Math.floor(p.posY)]?.[Math.floor(p.posX)];
        const add = p.meditating ? Math.max(6, Math.round(max * 0.08)) : inCity ? 8 : 2;
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
