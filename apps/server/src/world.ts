/**
 * Un mundo de juego (un mapa). Port recortado de GameWorld.cs, Spawn.cs y Movement.cs.
 *
 * En el original cada mundo es un actor con su propio hilo y una cola de mensajes.
 * Node corre en un solo hilo, así que acá los mensajes se procesan apenas llegan y el
 * tick (cada 50 ms) solo dispara los temporizadores. Más adelante, si hace falta escalar,
 * cada mundo puede ir a su propio worker_thread sin cambiar esta lógica.
 */
import type { ClientMessage, ServerMessage } from '@fdn/proto';
import type { Catalogs, GameWorldConfig, Settings } from './config.ts';
import { adjacentCellsAt45, distance, findNearestFreeLocation, nextGridDirection } from './location.ts';
import type { Occupancy } from './map.ts';
import * as M from './messages.ts';
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

    constructor(
        readonly config: GameWorldConfig,
        private readonly settings: Settings,
        private readonly catalogs: Catalogs,
        private readonly occupancy: Occupancy,
    ) {
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
        for (const other of this.nearbyPlayers(p.posX, p.posY, p.sessionId)) other.send(m);
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
        const list = [...sources];
        if (!list.length) return;
        recipient.send(M.playersEnteredRange(list));
        for (const s of list) if (s.disconnected) recipient.send(M.playerDisconnected(s.playerId));
    }

    private disableSpawnProtection(p: Player): void {
        p.spawnProtection = false;
        const m = M.spawnProtectionDisabled(p.playerId);
        p.send(m);
        this.broadcastNear(p, m);
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

    private handleTeleport(p: Player, x: number, y: number): void {
        if (p.isDead || (x === p.posX && y === p.posY) || !this.occupancy.isFree(x, y)) return;
        this.moveTo(p, p.posX, p.posY, x, y, false, true);
        p.send(M.playerTeleported(x, y));
    }

    /** Port de Movement.SyncPlayerVisibilityAfterMovement. */
    private syncVisibilityAfterMovement(moved: Player, curX: number, curY: number, destX: number, destY: number, dashAttack: boolean, teleport: boolean): void {
        const before = new Set<bigint>(this.nearbyById(curX, curY, moved.sessionId).keys());
        for (const id of moved.playersInRange) before.add(id);
        const now = this.nearbyById(destX, destY, moved.sessionId);

        const movedMsg = M.playerMoved(moved.playerId, curX, curY, destX, destY, moved.movementSpeedMs, moved.runningMode, dashAttack, teleport);
        for (const id of before) {
            const other = now.get(id);
            if (other && !other.disconnected) other.send(movedMsg);
        }

        const newcomers = [...now.values()].filter((o) => !before.has(o.playerId));
        if (newcomers.length) {
            this.sendSnapshots(moved, newcomers);
            const entered = M.playersEnteredRange([moved]);
            for (const o of newcomers) {
                if (o.disconnected) continue;
                o.send(entered);
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
