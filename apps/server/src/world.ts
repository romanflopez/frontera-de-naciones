/**
 * Un mundo de juego (un mapa). Port recortado de GameWorld.cs, Spawn.cs y Movement.cs.
 *
 * En el original cada mundo es un actor con su propio hilo y una cola de mensajes.
 * Node corre en un solo hilo, así que acá los mensajes se procesan apenas llegan y el
 * tick (cada 50 ms) solo dispara los temporizadores. Más adelante, si hace falta escalar,
 * cada mundo puede ir a su propio worker_thread sin cambiar esta lógica.
 */
import { damageAfterDefense, FURY_MS, potionMp, progressFromCharacter, PVP_SPELLS, rollSpellDamage, statsFromCharacter, UTIL_MP } from './systems/pvpCombat.ts';
import { HUBS, TRAINING, WAYPOINT_RANGE, portalGate, trainingUnlocked, waypointDest } from '@fdn/world';
import { applyParalysis, breakInvisibility, castDetectInvisible, castInvisibility, castRemover, updateStatus } from './systems/statusSystem.ts';
import type { ClientMessage, ServerMessage } from '@fdn/proto';
import type { Catalogs, GameWorldConfig, Settings } from './config.ts';
import { adjacentCellsAt45, distance, findNearestFreeLocation, nextGridDirection } from './location.ts';
import type { Occupancy } from './map.ts';
import * as M from './messages.ts';
import { MobSim } from './mobs.ts';
import type { WorldMap } from '@fdn/world';
import { Player, type PersistedPlayer, type Send } from './player.ts';

interface Timer { at: number; fn: () => void }

/**
 * Cambio respecto del original: durante los primeros segundos después de entrar no se evalúa el ping,
 * porque el cliente se traba mientras arma el mapa y en una compu lenta eso alcanzaba para que lo echaran.
 */
const PING_JOIN_GRACE_MS = 15_000;

export class GameWorld {
    private readonly players = new Map<string, Player>();
    private readonly playersById = new Map<bigint, Player>();
    private timers: Timer[] = [];
    private readonly tickHandle: NodeJS.Timeout;
    private mobSim?: MobSim;

    constructor(
        readonly config: GameWorldConfig,
        private readonly settings: Settings,
        private readonly catalogs: Catalogs,
        private readonly occupancy: Occupancy,
        private readonly map?: WorldMap,
    ) {
        if (map) {
            this.mobSim = new MobSim(map, {
                players: () => this.players.values(),
                playerById: (id) => this.playersById.get(id),
                nearby: (cx, cy) => this.nearbyPlayers(cx, cy),
                after: (ms, fn) => this.setTimeout(ms, fn),
                hurt: (p, raw, source) => this.damagePlayer(p, raw, '', null, source),
                stun: (p, secs) => (applyParalysis(p.status, Date.now(), secs * 1000) ? secs : 0),
            });
        }
        this.tickHandle = setInterval(() => this.tick(), settings.tickInterval);
        this.tickHandle.unref();
    }

    get id(): string { return this.config.id; }
    get playerCount(): number { return this.players.size; }

    dispose(): void { clearInterval(this.tickHandle); }

    // ---------- temporizadores ----------
    private setTimeout(ms: number, fn: () => void): void { this.timers.push({ at: Date.now() + ms, fn }); }

    private tick(): void {
        const now = Date.now();
        if (this.timers.length) {
            const due = this.timers.filter((t) => t.at <= now);
            this.timers = this.timers.filter((t) => t.at > now);
            for (const t of due) this.safe('temporizador', t.fn);
        }
        for (const pl of this.players.values()) {
            this.changeStatus(pl, () => updateStatus(pl.status, now));
            this.regenMana(pl, now);
        }
        if (this.mobSim) this.safe('mobs', () => this.mobSim!.update());
        this.checkPingTimeouts(now);
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

    /** Aplica un cambio de estado y avisa lo justo: a los que dejan de ver (o empiezan a ver) a `p` y a los que ven distinto por Detectar. */
    private changeStatus(p: Player, mutate: () => void): void {
        const inv = p.status.isInvisible, det = p.status.hasDetectInvisible;
        const seenBefore = new Map<string, boolean>(); const near = this.nearbyPlayers(p.posX, p.posY, p.sessionId);
        for (const o of near) seenBefore.set(o.sessionId, !this.hiddenFrom(o, p));
        const hiddenOthersBefore = new Set(near.filter((o) => this.hiddenFrom(p, o)).map((o) => o.sessionId));
        mutate();
        if (inv === p.status.isInvisible && det === p.status.hasDetectInvisible) return;
        p.send(M.statusUpdate(p.playerId, p.status.isInvisible, p.status.hasDetectInvisible));
        for (const o of near) {
            if (o.disconnected) continue;
            const sees = !this.hiddenFrom(o, p);
            if (sees && !seenBefore.get(o.sessionId)) o.send(M.playersEnteredRange([p]));
            if (!sees && seenBefore.get(o.sessionId)) o.send(M.playersLeftRange([p.playerId]));
            if (sees) o.send(M.statusUpdate(p.playerId, p.status.isInvisible, p.status.hasDetectInvisible));
            // lo que yo veo de los demás cambió por Detectar
            const hiddenNow = this.hiddenFrom(p, o);
            if (hiddenOthersBefore.has(o.sessionId) && !hiddenNow) { p.send(M.playersEnteredRange([o])); p.send(M.statusUpdate(o.playerId, o.status.isInvisible, o.status.hasDetectInvisible)); }
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
        const usePersisted = persisted && persisted.worldId === this.id;
        const spawn = this.spawnLocation(usePersisted ? persisted.x : this.config.spawn?.x, usePersisted ? persisted.y : this.config.spawn?.y);
        const p = new Player(sessionId, send, requestDisconnect, this.settings);
        p.characterName = characterName;
        if (persisted) p.applyPersisted(persisted);
        p.setPosition(spawn.x, spawn.y);
        this.occupancy.setOccupied(spawn.x, spawn.y);
        this.players.set(sessionId, p);
        this.playersById.set(p.playerId, p);
        console.log(`[Mundo:${this.id}] Entró ${characterName} (#${p.playerId}) en (${spawn.x}, ${spawn.y}). Jugadores: ${this.players.size}`);
        this.completeJoin(p, true);
    }

    /** Port de Spawn.CompletePlayerJoin: estado inicial, protección al aparecer y visibilidad. */
    private completeJoin(p: Player, includeSpells: boolean): void {
        const t = this.settings.timings;
        p.pingGraceUntil = Date.now() + PING_JOIN_GRACE_MS;
        p.send(M.initialState(p, this.catalogs, {
            includeSpells, pingIntervalMs: this.settings.ping.interval, arrowSpeed: t.arrowSpeed,
            pickupMs: t.playerPickupAnimationTime, bowMs: t.playerBowAnimationTime,
        }));
        p.send(M.initialGameWorldState(this.config, p));

        if (t.spawnProtectionTime > 0) {
            p.spawnProtection = true;
            const sessionId = p.sessionId;
            this.setTimeout(t.spawnProtectionTime * 1000, () => {
                const again = this.players.get(sessionId);
                if (again?.spawnProtection) this.disableSpawnProtection(again);
            });
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
        for (const s of list) { if (s.status.isInvisible) recipient.send(M.statusUpdate(s.playerId, true, s.status.hasDetectInvisible)); recipient.send(M.playerVitals(s.playerId, Math.max(0, Math.round(s.hp)), s.combat.maxHp)); }
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
        const saved = p.toPersisted(this.id);
        this.players.delete(sessionId);
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
        return this.players.get(sessionId)?.toPersisted(this.id);
    }

    // ---------- paquetes del cliente ----------
    handleClientPacket(sessionId: string, message: ClientMessage): void {
        const p = this.players.get(sessionId);
        if (!p) return;
        const payload = message.payload;
        if (!payload) return;
        this.safe(payload.$case, () => {
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
                            const fury = (on: boolean) => { const m = M.statusUpdate(p.playerId, p.status.isInvisible, p.status.hasDetectInvisible, on); p.send(m); this.broadcastNear(p, m); };
                            fury(true); this.setTimeout(FURY_MS, () => fury(false));
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
                        if (secs > 0 && !applyParalysis(tgt.status, now, secs * 1000)) { p.send(M.pvpHit(tgt.playerId, { fx: 'resist', x: tgt.posX, y: tgt.posY, targetId: 0n, dmg: 0, secs: 0, r: 0 })); secs = 0; if (dmg <= 0) break; }
                        if (!this.isEnemyPair(p, tgt)) break;                              // mismo bando o zona segura
                        if (dmg > 0) dmg = this.damagePlayer(tgt, dmg, sp.kind ?? fx, p);              // la vida del que recibe la lleva el server
                        if (dmg > 0 || secs > 0) p.send(M.pvpHit(p.playerId, { fx: '', x: tgt.posX, y: tgt.posY, targetId: tgt.playerId, dmg, secs, r: 0 })); // para que el que pega vea el número
                    } else if (v.targetId) break; // daño sin hechizo conocido: se descarta
                    this.broadcastNear(p, M.pvpHit(p.playerId, { fx, x, y, targetId: v.targetId, dmg, secs, r }));
                    break;
                }
                case 'hpReport': this.acceptHpReport(p, payload.value.hp, payload.value); break;
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

    /**
     * Teletransporte pedido por el cliente. Solo se acepta (a) cruzar un portal del mapa parado sobre él y con el progreso
     * del personaje que lo permite (misión/nivel/llave), o (b) ir al punto de aparición de la propia facción justo al entrar.
     * Con FDN_DEBUG_WARP=1 vale cualquier celda libre (solo para pruebas).
     */
    private handleTeleport(p: Player, reqX: number, reqY: number): void {
        if (p.isDead || (reqX === p.posX && reqY === p.posY)) return;
        let x = reqX, y = reqY;
        if (process.env.FDN_DEBUG_WARP !== '1') {
            const portal = this.map?.portals?.find((q) => q.tx === reqX && q.ty === reqY && distance(p.posX, p.posY, q.x, q.y) <= 1);
            if (portal) {
                const why = portalGate(portal, p.prog);
                if (why) { p.send(M.sendMessage(why)); return; }
            } else {
                const hub = HUBS[this.factionOf(p)];
                const toHub = !!hub && reqX === hub.x && reqY === hub.y && Date.now() - p.joinedAt < 30000;
                if (!toHub) { console.log(`[Mundo:${this.id}] ${p.characterName} pidió un teletransporte sin portal a (${reqX}, ${reqY}); lo ignoro`); return; }
            }
            // si alguien ocupa justo la celda de llegada, va a la libre más cercana
            const free = findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), reqX, reqY, 3);
            if (!free) return;
            x = free.x; y = free.y;
            if (portal?.key) p.prog.keys[portal.key] = Math.max(0, (p.prog.keys[portal.key] ?? 0) - 1);
        } else if (!this.occupancy.isFree(x, y)) return;
        this.moveTo(p, p.posX, p.posY, x, y, false, true);
        p.send(M.playerTeleported(x, y));
    }

    /**
     * Viaje por el menú de waypoints (portal grande de la ciudad / waypoint de cada zona). Se acepta solo si el jugador está
     * a WAYPOINT_RANGE celdas o menos de algún waypoint y la zona pedida está abierta según el último guardado (misión/nivel/`u`).
     * `id` = 'city' (punto de aparición de su facción) o el id de una zona de entrenamiento.
     */
    private handleWaypoint(p: Player, id: string): void {
        if (p.isDead || !this.map) return;
        if (!this.map.waypoints?.some((q) => distance(p.posX, p.posY, q.x, q.y) <= WAYPOINT_RANGE)) { p.send(M.sendMessage('Tenés que estar junto a un portal.')); return; }
        const dest = waypointDest(this.map, id, this.factionOf(p));
        if (!dest) return;
        if (dest.step !== undefined) {
            const t = TRAINING[dest.step];
            if (!p.prog.unlocked.includes(t.id) && !trainingUnlocked(t.step, p.prog.qi, p.prog.lvl)) {
                p.send(M.sendMessage(`Portal bloqueado (${t.zone}): ${t.after ? `entregá «${t.after}» al Capitán` : 'todavía no'} o llegá al nivel ${t.lvl}.`));
                return;
            }
        }
        const free = findNearestFreeLocation((cx, cy) => this.occupancy.isFree(cx, cy), dest.x, dest.y, 3);
        if (!free || (free.x === p.posX && free.y === p.posY)) return;
        this.moveTo(p, p.posX, p.posY, free.x, free.y, false, true);
        p.send(M.playerTeleported(free.x, free.y));
    }

    /** Stats de combate del jugador a partir del personaje guardado (ya validado). */
    setCombatStats(sessionId: string, characterJson: string | undefined, login = false): void {
        const p = this.players.get(sessionId); if (!p) return;
        const prevMax = p.combat.maxHp, prevLvl = p.combat.lvl;
        p.combat = statsFromCharacter(characterJson);
        p.prog = progressFromCharacter(characterJson);
        if (login) { p.hp = p.combat.savedHp; p.mp = p.combat.savedMp; p.potionBudget = potionMp(p.combat.maxMp); }
        else if (p.combat.lvl > prevLvl) { p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; }
        else { if (p.hp > p.combat.maxHp) p.hp = p.combat.maxHp; if (p.mp > p.combat.maxMp) p.mp = p.combat.maxMp; }
        void prevMax;
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
        const arena = (p: Player) => p.posX >= 46 && p.posX < 61 && p.posY >= 26 && p.posY < 39;
        return this.factionOf(a) !== this.factionOf(b) || (arena(a) && arena(b));
    }
    /** Le saca vida a un jugador: resistencias y defensa del server; si llega a 0 muere. Devuelve el daño aplicado. */
    private damagePlayer(p: Player, raw: number, fx: string, killer: Player | null, source = ''): number {
        if (p.isDead || p.spawnProtection || raw <= 0) return 0;
        const dmg = damageAfterDefense(raw, p.combat, fx);
        p.hp = Math.max(0, p.hp - dmg); p.meditating = false;
        if (killer) p.lastDamager = { id: killer.playerId, name: killer.characterName, t: Date.now() };
        else if (source) p.lastDamager = { id: 0n, name: source, t: Date.now() };
        this.sendVitals(p, true);
        if (p.hp < 1) this.killPlayer(p);
        return dmg;
    }
    private killPlayer(p: Player): void {
        p.hp = 0; p.deadAt = Date.now();
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
        p.hp = p.combat.maxHp; p.mp = p.combat.maxMp; p.meditating = false; p.lastDamager = null;
        const hub = HUBS[this.factionOf(p)] ?? this.config.spawn ?? { x: 6, y: 7 };
        let x = hub.x, y = hub.y;
        for (let r = 0; r < 6 && !this.occupancy.isFree(x, y); r++) { x = hub.x + ((r * 3) % 5) - 2; y = hub.y + 1 + (r % 3); }
        if (this.occupancy.isFree(x, y) && (x !== p.posX || y !== p.posY)) { this.moveTo(p, p.posX, p.posY, x, y, false, true); p.send(M.playerTeleported(x, y)); }
        this.sendVitals(p, true);
        this.announceVitals(p, true);
    }
    /** El cliente informa su vida (curas, pociones, regeneración): solo se acepta una suba razonable (hasta ~50 % de la vida máxima por segundo). */
    private acceptHpReport(p: Player, reported: number, r?: { mpSpent?: number; mp?: number; meditating?: boolean }): void {
        if (p.isDead) return;
        if (r) this.acceptMpReport(p, r);
        const now = Date.now(), dt = Math.min(5, Math.max(0.05, (now - p.lastHpReportAt) / 1000)); p.lastHpReportAt = now;
        const max = p.combat.maxHp, want = Math.min(max, Math.max(0, Math.round(reported)));
        if (want > p.hp) p.hp = Math.min(want, p.hp + Math.ceil(max * 0.5 * dt) + 2);
        this.announceVitals(p);
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
     * Reporte de maná del cliente: lo gastado en hechizos que el server no cobra (curas, hechizos a mobs) solo resta;
     * una suba (poción) se acepta con un tope: una poción cada ~3 s como mucho. Meditar solo vale quieto.
     */
    private acceptMpReport(p: Player, r: { mpSpent?: number; mp?: number; meditating?: boolean }): void {
        const now = Date.now(), max = p.combat.maxMp, pot = potionMp(max);
        let changed = false;
        const spent = Math.min(max, Math.max(0, Math.round(Number(r.mpSpent) || 0)));
        if (spent > 0) { p.mp = Math.max(0, p.mp - spent); changed = true; }
        // el tope de pociones se recarga con el tiempo (una poción cada 3 s, sin reserva extra)
        const dt = Math.min(10, Math.max(0, (now - (p.lastMpReportAt || now)) / 1000)); p.lastMpReportAt = now;
        p.potionBudget = Math.min(pot, p.potionBudget + (pot / 3) * dt);
        const want = Math.min(max, Math.max(0, Math.round(Number(r.mp) || 0)));
        if (want > p.mp && p.potionBudget >= 1) {
            const up = Math.min(want - p.mp, Math.floor(p.potionBudget));
            p.mp += up; p.potionBudget -= up; changed = true;
        }
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
