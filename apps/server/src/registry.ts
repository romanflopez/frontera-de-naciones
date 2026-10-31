/**
 * Registro de mundos (Fase 1 de docs/MUNDO.md): crea un `GameWorld` por (mapa, instancia) a pedido, corre un solo reloj para
 * todos los mundos despiertos, hiberna los que quedan vacíos y hace el cruce de jugadores entre mundos en dos fases:
 *   1. beginTransfer: saca al jugador del mundo A (queda fuera de todo mundo, no se lo puede atacar), guarda el personaje con
 *      el destino y le manda MapTransfer;
 *   2. completeTransfer (cuando llega MapReady, o por tiempo): lo mete en B, que le manda el estado inicial.
 * La clave de un mundo es `mapId` (mundo compartido) o `mapId#instanceId` (instancia privada: todavía no se usa, pero el registro
 * ya la soporta, incluida la baja de instancias vacías).
 */
import { getMapDef, mapHash, type Link, type WorldMap } from '@fdn/world';
import type { Catalogs, GameWorldConfig, Settings } from './config.ts';
import type { Economy } from './economy.ts';
import { occupancyFromGrid } from './map.ts';
import * as M from './messages.ts';
import type { PersistedPlayer, Player } from './player.ts';
import { GameWorld } from './world.ts';

export interface RegistryOptions {
    settings: Settings;
    catalogs: Catalogs;
    economy?: Economy;
    /** Un mundo sin jugadores se duerme tras este tiempo (ms). */
    hibernateAfterMs?: number;
    /** Una instancia privada vacía se destruye tras este tiempo (ms). */
    instanceTtlMs?: number;
    /** Si MapReady no llega en este tiempo, se mete al jugador igual (ms). */
    transferTimeoutMs?: number;
}

/** Lo mínimo que el registro necesita de una sesión. `worldId` es la clave del mundo donde está (o a donde va) y el registro la actualiza. */
export interface TransferSession { sessionId: string; worldId: string }
export interface TransferDest { map: string; x: number; y: number; instanceId?: string; direction?: number }

interface Pending { player: Player; session: TransferSession; map: string; key: string; x: number; y: number; direction?: number; hash: string; since: number }

export const DEFAULT_HIBERNATE_MS = 15_000;
export const DEFAULT_INSTANCE_TTL_MS = 120_000;
export const DEFAULT_TRANSFER_TIMEOUT_MS = 20_000;

export const worldKey = (mapId: string, instanceId = ''): string => (instanceId ? `${mapId}#${instanceId}` : mapId);

export class WorldRegistry {
    private readonly worlds = new Map<string, GameWorld>();
    private readonly maps = new Map<string, WorldMap>();
    private readonly emptySince = new Map<string, number>();
    private readonly pending = new Map<string, Pending>();
    private handle?: NodeJS.Timeout;
    private lastSweep = 0;
    private readonly hibernateAfterMs: number;
    private readonly instanceTtlMs: number;
    private readonly transferTimeoutMs: number;

    constructor(private readonly o: RegistryOptions) {
        this.hibernateAfterMs = o.hibernateAfterMs ?? DEFAULT_HIBERNATE_MS;
        this.instanceTtlMs = o.instanceTtlMs ?? DEFAULT_INSTANCE_TTL_MS;
        this.transferTimeoutMs = o.transferTimeoutMs ?? DEFAULT_TRANSFER_TIMEOUT_MS;
    }

    // ---------- mundos ----------
    /** Mapa armado una sola vez por id (los mundos de un mismo mapa lo comparten; nadie lo modifica). */
    mapOf(mapId: string): WorldMap {
        let m = this.maps.get(mapId);
        if (!m) { const d = getMapDef(mapId); if (!d) throw new Error(`mapa desconocido: ${mapId}`); m = d.build(); this.maps.set(mapId, m); }
        return m;
    }
    hashOf(mapId: string): string { return mapHash(this.mapOf(mapId)); }

    /** El mundo existente con esa clave, o undefined. */
    get(key: string): GameWorld | undefined { return this.worlds.get(key); }
    get size(): number { return this.worlds.size; }
    keys(): string[] { return [...this.worlds.keys()]; }
    all(): IterableIterator<GameWorld> { return this.worlds.values(); }

    /** El mundo de (mapa, instancia): lo crea la primera vez y lo despierta si estaba dormido. */
    ensure(mapId: string, instanceId = ''): GameWorld {
        const def = getMapDef(mapId); if (!def) throw new Error(`mapa desconocido: ${mapId}`);
        const key = worldKey(def.id, instanceId);
        let w = this.worlds.get(key);
        if (!w) {
            const map = this.mapOf(def.id);
            const config: GameWorldConfig = { id: key, name: instanceId ? `${def.name} (instancia ${instanceId})` : def.name, map: def.id, music: def.music, spawn: { ...def.spawn } };
            w = new GameWorld(config, this.o.settings, this.o.catalogs, occupancyFromGrid(map.blocked), map, this.o.economy, def);
            w.transferHook = (sessionId, dest) => this.transferFromWorld(sessionId, dest);
            this.worlds.set(key, w);
            console.log(`[Registro] Mundo '${key}' creado (${map.size}x${map.size}, ${w.mobCount} mobs). Mundos: ${this.worlds.size}`);
        }
        this.emptySince.delete(key);
        if (w.isHibernated) { w.wake(); console.log(`[Registro] Mundo '${key}' despertó.`); }
        return w;
    }

    /** Un solo reloj para todos los mundos despiertos; los dormidos no cuestan nada. */
    start(): void {
        if (this.handle) return;
        this.handle = setInterval(() => this.tickAll(), this.o.settings.tickInterval);
        this.handle.unref();
    }
    tickAll(now = Date.now()): void {
        for (const w of this.worlds.values()) if (!w.isHibernated) w.tick();
        if (now - this.lastSweep >= 1000) { this.lastSweep = now; this.sweep(now); }
    }

    /** Duerme los mundos vacíos hace tiempo, da de baja las instancias vacías vencidas y mete a los que esperan MapReady hace demasiado. */
    sweep(now = Date.now()): void {
        for (const [key, w] of [...this.worlds]) {
            if (w.playerCount > 0 || this.pendingInto(key)) { this.emptySince.delete(key); continue; }
            const since = this.emptySince.get(key);
            if (since === undefined) { this.emptySince.set(key, now); continue; }
            if (key.includes('#') && now - since >= this.instanceTtlMs) { w.dispose(); this.worlds.delete(key); this.emptySince.delete(key); console.log(`[Registro] Instancia '${key}' dada de baja.`); continue; }
            if (!w.isHibernated && now - since >= this.hibernateAfterMs) { w.hibernate(); console.log(`[Registro] Mundo '${key}' hibernó (vacío).`); }
        }
        for (const pd of [...this.pending.values()]) if (now - pd.since >= this.transferTimeoutMs) {
            console.log(`[Registro] ${pd.player.characterName}: no llegó MapReady a tiempo; lo meto igual en '${pd.key}'.`);
            this.attach(pd);
        }
    }
    private pendingInto(key: string): boolean { for (const p of this.pending.values()) if (p.key === key) return true; return false; }

    dispose(): void {
        if (this.handle) clearInterval(this.handle);
        this.handle = undefined;
        for (const w of this.worlds.values()) w.dispose();
    }

    // ---------- cruce entre mundos ----------
    pendingOf(sessionId: string): { map: string; key: string; x: number; y: number } | undefined {
        const p = this.pending.get(sessionId); return p && { map: p.map, key: p.key, x: p.x, y: p.y };
    }

    /**
     * Fase 1. Saca al jugador de su mundo y lo deja esperando MapReady. `save` guarda el personaje con el destino (si el server se
     * cae a mitad de camino, al volver aparece en el mapa nuevo). Devuelve false si no se pudo (no está en un mundo, ya cruza, destino malo).
     */
    beginTransfer(s: TransferSession, dest: TransferDest, save?: (state: PersistedPlayer) => void): boolean {
        if (this.pending.has(s.sessionId)) return false;
        const def = getMapDef(dest.map); if (!def) return false;
        const src = this.worlds.get(s.worldId);
        if (!src?.playerOf(s.sessionId)) return false;
        const map = this.mapOf(def.id);
        if (!(dest.x >= 0 && dest.y >= 0 && dest.x < map.size && dest.y < map.size) || map.blocked[dest.y][dest.x]) return false;
        const key = worldKey(def.id, dest.instanceId);
        const w = this.ensure(def.id, dest.instanceId); // se crea (o despierta) mientras el cliente arma el mapa
        const p = src.detachPlayer(s.sessionId)!;
        this.o.economy?.persistVitals(p);
        s.worldId = key;
        save?.(p.toPersisted(def.id, { x: dest.x, y: dest.y }));
        const pd: Pending = { player: p, session: s, map: def.id, key, x: dest.x, y: dest.y, direction: dest.direction, hash: mapHash(map), since: Date.now() };
        this.pending.set(s.sessionId, pd);
        void w;
        p.send(M.mapTransfer({ mapId: def.id, name: def.name, x: dest.x, y: dest.y, direction: dest.direction ?? p.facingDirection, hash: pd.hash, music: def.music ?? '', gameWorldId: key, lvl: def.lvl }));
        return true;
    }

    /** Fase 2: llegó MapReady. Si el hash no coincide, el cliente armó un mapa distinto (desactualizado) y se lo desconecta. */
    completeTransfer(sessionId: string, mapId: string, hash: string): boolean {
        const pd = this.pending.get(sessionId); if (!pd) return false;
        if (mapId !== pd.map) return false;
        if (hash !== pd.hash) {
            console.log(`[Registro] ${pd.player.characterName}: hash de '${mapId}' distinto (${hash} != ${pd.hash}); cliente desactualizado.`);
            this.attach(pd);
            pd.player.requestDisconnect('Tu juego está desactualizado y armó un mapa distinto al del server. Recargá la página.');
            return false;
        }
        this.attach(pd);
        return true;
    }

    /** Termina ya un cruce pendiente (la conexión se cortó o el server se apaga): el jugador queda en el mundo nuevo. */
    flushPending(sessionId: string): boolean {
        const pd = this.pending.get(sessionId); if (!pd) return false;
        this.attach(pd); return true;
    }
    flushAllPending(): void { for (const pd of [...this.pending.values()]) this.attach(pd); }

    private attach(pd: Pending): void {
        this.pending.delete(pd.session.sessionId);
        const w = this.ensure(pd.map, pd.key.includes('#') ? pd.key.split('#')[1] : '');
        w.attachPlayer(pd.player, pd.x, pd.y, pd.direction);
    }

    /**
     * Pedido de cruzar un vínculo. Devuelve el aviso a mostrarle al jugador si no puede cruzar, o null (cruzó o se ignoró el pedido).
     * El cliente solo manda el id: distancia, requisitos, vida y "ya estoy cruzando" se validan acá.
     */
    handlePortal(s: TransferSession, portalId: string, save?: (state: PersistedPlayer) => void): string | null {
        if (this.pending.has(s.sessionId)) return null;
        const w = this.worlds.get(s.worldId), p = w?.playerOf(s.sessionId);
        if (!w || !p) return null;
        const r = w.checkLink(p, portalId);
        if (!('link' in r)) { if (r.why) p.send(M.sendMessage(r.why)); return r.why; }
        const link: Link = r.link;
        if (!this.beginTransfer(s, { map: link.to.map, x: link.to.x, y: link.to.y }, save)) return null;
        w.consumeLinkKey(p, link); // la llave se descuenta al cruzar, como las escaleras con llave del mapa original
        return null;
    }

    /** Respawn/teletransporte iniciado por el propio mundo (muerte con punto de reaparición en otro mapa). */
    private transferFromWorld(sessionId: string, dest: TransferDest): void {
        const s = this.sessionHook?.(sessionId); if (!s) return;
        this.beginTransfer(s.session, dest, s.save);
    }
    /** index.ts lo setea: resuelve la sesión (y cómo guardarla) a partir de su id. */
    sessionHook?: (sessionId: string) => { session: TransferSession; save?: (state: PersistedPlayer) => void } | undefined;
}
