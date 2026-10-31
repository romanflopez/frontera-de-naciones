/**
 * Estado de un jugador dentro de un mundo. Port recortado de GameWorldPlayer.cs:
 * posición, apariencia, velocidad, controles anti-trampa de movimiento y ping.
 */
import { DEFAULT_STATS, PvpLimiter, type CombatStats } from './systems/pvpCombat.ts';
import { createDefaultStatus } from './systems/statusSystem.ts';
import type { ServerMessage } from '@fdn/proto';
import type { Settings } from './config.ts';
import type { Econ } from './economy.ts';
import type { GameWorld } from './world.ts';

export type Send = (message: ServerMessage) => void;

/** Lo que guardamos de un personaje entre sesiones. */
export interface PersistedPlayer {
    /** Mapa donde estaba (id de MapDef). `worldId` queda igual por compatibilidad con guardados viejos, que solo lo tienen a él. */
    mapId?: string;
    worldId: string;
    x: number;
    y: number;
    direction: number;
    gender: number;
    skinColor: number;
    hairStyleIndex: number;
    underwearColorIndex: number;
    movementSpeedMs: number;
    runningMode: boolean;
    attackMode: boolean;
}

let nextPlayerId = 1n;

/** Temporizador que sigue al jugador (no al mundo): sobrevive a un cambio de mapa y corre en el mundo donde esté en ese momento. */
export interface PlayerTimer { at: number; fn: (world: GameWorld) => void }

/** Límite deslizante: cuántas infracciones se perdonan dentro de la ventana. */
class SlidingWindow {
    private hits: number[] = [];
    constructor(private readonly limit: number, private readonly windowMs: number) {}
    tryAcquire(now: number): boolean {
        this.hits = this.hits.filter((t) => now - t < this.windowMs);
        if (this.hits.length >= this.limit) return false;
        this.hits.push(now);
        return true;
    }
}

export class Player {
    readonly playerId = nextPlayerId++;
    posX = 0;
    posY = 0;
    facingDirection = 4;
    characterName = '';
    /** Bando;clase;piezas visibles, lo manda el cliente (solo se retransmite a los demás). */
    profile = '';
    lastPvpMs = 0;
    /** Stats de combate sacados del último guardado validado, y límites del PvP. */
    combat: CombatStats = { ...DEFAULT_STATS };
    /** Progreso del último guardado validado, para decidir si un portal deja pasar (misiones entregadas, nivel, llaves, portales abiertos). */
    prog: { qi: number; lvl: number; keys: Record<string, number>; unlocked: string[] } = { qi: 0, lvl: 1, keys: {}, unlocked: [] };
    /** Clave de la cuenta y estado económico autoritativo (oro, bolsa, equipo, nivel). */
    accountKey = '';
    econ?: Econ;
    /** Ya se mandó la foto del inventario en esta sesión. */
    econSynced = false;
    joinedAt = Date.now();
    /** Mundo donde está ahora (null mientras cruza de un mapa a otro). */
    world: GameWorld | null = null;
    /** Temporizadores atados al jugador (pociones en el tiempo, avisos, protección al aparecer). */
    timers: PlayerTimer[] = [];
    pvp = new PvpLimiter();
    status = createDefaultStatus();
    disconnected = false;

    hp = 1000;
    /** Hora de la muerte y último que le pegó (para el aviso de muerte). */
    deadAt = 0;
    lastDamager: { id: bigint; name: string; t: number } | null = null;
    lastVitalsAt = 0;
    lastHpReportAt = 0;
    /** Maná que lleva el server, regeneración, tope de subas por pociones y meditación (solo vale quieto y sin recibir daño). */
    mp = 0;
    nextMpRegenAt = 0;
    lastMpReportAt = 0;
    /** Pociones: último consumo (delay global), consumos de los últimos segundos (tope por ventana) y época (corta la curación en el tiempo al morir/revivir). */
    lastPotionAt = 0;
    potionLog: number[] = [];
    potionEpoch = 0;
    /** Subas de vida aceptadas por reporte del cliente (curas, regeneración) en la ventana reciente: [hora, cantidad]. */
    healLog: [number, number][] = [];
    meditating = false;
    medX = 0; medY = 0;
    /** Volver a la ciudad (recall): fin del canal en curso (0 = no canaliza), fin del enfriamiento y época (invalida el temporizador al cortar). */
    recallUntil = 0;
    recallCdUntil = 0;
    recallEpoch = 0;
    maxHp = 1000;
    gender = 0;
    skinColor = 0;
    hairStyleIndex = 0;
    underwearColorIndex = 0;
    spawnProtection = false;
    runningMode = true;
    attackMode = true;
    attackStunDurationMs = 500;
    attackRangeCells = 3;
    damage = 100;
    attackSpeedMs = 600;
    castSpeedMs = 1200;
    /** 0 sin interrumpir, 1 interrumpe, 2 aturde, 3 empuja (como AttackType del original). */
    attackType = 2;
    allowDashAttack = true;

    /** Ids de jugadores que este jugador tiene "a la vista". */
    readonly playersInRange = new Set<bigint>();
    /** Ids de items del suelo que este jugador tiene a la vista (para mandar solo las diferencias). */
    readonly groundSeen = new Set<number>();

    /** 380 ms por celda: el ritmo del prototipo (unas 2,6 celdas por segundo). */
    private baseMovementSpeedMs = 270;
    private lastMovementRequestMs = 0;
    private paralysisUntil = 0;
    private violations: SlidingWindow;
    private lastPingMs = 0;
    /** Hasta cuándo no se evalúa el ping: el cliente se traba un rato mientras arma el mapa al entrar. */
    pingGraceUntil = 0;
    private pingDeltas: number[] = [];
    pingVariance = 0;

    constructor(
        readonly sessionId: string,
        public send: Send,
        public requestDisconnect: (reason: string) => void,
        private readonly settings: Settings,
    ) {
        const v = settings.movementSpeedViolationsChecker;
        this.violations = new SlidingWindow(v.limit, v.window * 1000);
    }

    get isDead(): boolean { return this.hp < 1; }
    get baseMovementMs(): number { return this.baseMovementSpeedMs; }
    /** Milisegundos por celda, igual que el cliente: caminar es el doble que correr. */
    get movementSpeedMs(): number {
        const ms = this.runningMode ? this.baseMovementSpeedMs : this.baseMovementSpeedMs * 2;
        return Math.min(1000, Math.max(100, ms));
    }

    setPosition(x: number, y: number): void { this.posX = x; this.posY = y; }

    setMovementSpeedMs(ms: number): void {
        const clamped = Math.min(500, Math.max(100, Math.round(ms)));
        if (clamped === this.baseMovementSpeedMs) return;
        this.baseMovementSpeedMs = clamped;
        this.lastMovementRequestMs = 0;
    }

    setRunningMode(value: boolean): void {
        if (value === this.runningMode) return;
        this.runningMode = value;
        this.lastMovementRequestMs = 0;
    }

    // ---------- anti-trampa de movimiento ----------
    private cappedPingVariance(): number {
        return Math.min(Math.max(0, this.pingVariance), this.settings.movementSpeedViolationsChecker.maxPingVariance);
    }

    private minRequiredMs(baseMs: number): number {
        return Math.max(0, baseMs - baseMs * this.settings.timings.antiHackTimingLagFactor - this.cappedPingVariance());
    }

    getAndUpdateLastMovementRequestMs(now: number): number {
        const delta = this.lastMovementRequestMs === 0 ? 0 : now - this.lastMovementRequestMs;
        this.lastMovementRequestMs = now;
        return delta;
    }

    /** false cuando el jugador se mueve demasiado rápido muchas veces seguidas. */
    checkMovementCadence(deltaMs: number, now: number): boolean {
        if (deltaMs >= this.minRequiredMs(this.movementSpeedMs)) return true;
        return this.violations.tryAcquire(now);
    }

    paralyzeFor(seconds: number, now: number): void {
        this.paralysisUntil = now + seconds * 1000;
        const v = this.settings.movementSpeedViolationsChecker;
        this.violations = new SlidingWindow(v.limit, v.window * 1000);
    }

    isParalyzed(now: number): boolean { return now < this.paralysisUntil || this.status.isParalyzed; }

    // ---------- ping ----------
    recordPing(now: number): void {
        if (this.lastPingMs > 0) {
            this.pingDeltas.push(Math.abs(now - this.lastPingMs - this.settings.ping.interval));
            if (this.pingDeltas.length > this.settings.ping.varianceSampleSize) this.pingDeltas.shift();
            this.pingVariance = Math.max(...this.pingDeltas);
        }
        this.lastPingMs = now;
    }

    get lastPingTimeMs(): number { return this.lastPingMs; }

    /** Descarta las muestras de ping (al terminar la gracia de entrada). */
    clearPingSamples(): void {
        this.pingDeltas = [];
        this.pingVariance = 0;
    }

    resetConnectionState(): void {
        this.lastPingMs = 0;
        this.pingDeltas = [];
        this.pingVariance = 0;
        this.lastMovementRequestMs = 0;
    }

    // ---------- persistencia ----------
    toPersisted(mapId: string, at?: { x: number; y: number }): PersistedPlayer {
        return {
            mapId, worldId: mapId, x: at?.x ?? this.posX, y: at?.y ?? this.posY, direction: this.facingDirection,
            gender: this.gender, skinColor: this.skinColor, hairStyleIndex: this.hairStyleIndex, underwearColorIndex: this.underwearColorIndex,
            movementSpeedMs: this.baseMovementSpeedMs, runningMode: this.runningMode, attackMode: this.attackMode,
        };
    }

    applyPersisted(p: PersistedPlayer): void {
        this.facingDirection = p.direction ?? 4;
        this.gender = p.gender ?? 0;
        this.skinColor = p.skinColor ?? 0;
        this.hairStyleIndex = p.hairStyleIndex ?? 0;
        this.underwearColorIndex = p.underwearColorIndex ?? 0;
        this.baseMovementSpeedMs = p.movementSpeedMs ?? 270;
        this.runningMode = p.runningMode ?? true;
        this.attackMode = p.attackMode ?? true;
    }
}
