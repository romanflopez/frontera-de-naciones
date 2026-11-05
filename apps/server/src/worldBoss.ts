/**
 * Jefe de mundo del MVP (docs/JEFE_DE_MUNDO.md): uno solo, una vez por día. Sale a una hora al azar dentro de la ventana del día (hora de
 * Argentina) para que no lo campeen, en uno de los mapas abiertos de su tier, también al azar. Se anuncia en el chat de todos al aparecer,
 * cuando le quedan 10 minutos y al morir o irse. Vive en memoria: si el server se reinicia, se vuelve a sortear la hora de ese día.
 */
import { MAPS, MOBS, WORLD_BOSS, nationOfMap } from '@fdn/world';
import type { GameWorld } from './world.ts';

const H = 3_600_000, DAY = 24 * H, ART = 3 * H; // Argentina = UTC-3, sin horario de verano
/** Día calendario de Argentina. */
export const artDay = (now: number): number => Math.floor((now - ART) / DAY);
/** Mapas donde puede salir: los abiertos compartidos (ni mazmorras ni mapas de leveo de una nación) del rango del jefe. */
export const worldBossMaps = (): string[] => Object.values(MAPS).filter((d) => !!d.lvl && d.lvl[0] >= WORLD_BOSS.lvl[0] && d.lvl[1] <= WORLD_BOSS.lvl[1] && !d.temporary && !nationOfMap(d.id)).map((d) => d.id);

export interface WorldBossDeps {
    ensure(mapId: string): GameWorld;
    get(mapId: string): GameWorld | undefined;
    announce(text: string): void;
    rnd?(): number;
}

export class WorldBossService {
    day = -1;
    /** Cuándo sale hoy (ms); Infinity si hoy ya no sale. */
    at = Infinity;
    state: 'waiting' | 'alive' | 'done' = 'done';
    mapId = '';
    until = 0;
    private warned = false;
    constructor(private readonly d: WorldBossDeps) {}
    private rnd(): number { return this.d.rnd ? this.d.rnd() : Math.random(); }
    private get name(): string { return MOBS[WORLD_BOSS.type].name; }

    /** Sortea la hora del día `day`. Si el server arrancó con la ventana empezada, sortea entre ahora y el cierre; si ya cerró, hoy no sale. */
    private roll(day: number, now: number): void {
        const from = day * DAY + ART + WORLD_BOSS.fromHour * H, to = day * DAY + ART + WORLD_BOSS.toHour * H;
        const start = Math.max(from, now);
        this.day = day; this.state = 'waiting'; this.warned = false;
        this.at = start < to ? start + this.rnd() * (to - start) : Infinity;
    }

    tick(now = Date.now()): void {
        const day = artDay(now);
        if (day !== this.day && this.state !== 'alive') this.roll(day, now);
        if (this.state === 'waiting' && now >= this.at) this.spawn(now);
        if (this.state !== 'alive') return;
        const w = this.d.get(this.mapId);
        if (!w?.hasWorldBoss) { this.state = 'done'; return; } // murió (el aviso lo da el hook) o el mundo se cayó
        if (!this.warned && this.until - now <= 10 * 60_000) { this.warned = true; this.d.announce(`Al ${this.name} le quedan 10 minutos en ${MAPS[this.mapId].name}.`); }
        if (now >= this.until) {
            w.removeWorldBoss(); this.state = 'done';
            this.d.announce(`El ${this.name} se hundió en la tierra de ${MAPS[this.mapId].name}. Mañana vuelve a salir.`);
        }
    }

    /**
     * Lo hace salir ahora: en `mapId` (si no, uno al azar de su tier) y cerca de `at` (si no, en una zona de mobs al azar).
     * Devuelve el texto del anuncio o un error. Lo usan el reloj y el GM (/gm jefemundo).
     */
    spawn(now = Date.now(), mapId?: string, at?: { x: number; y: number }): string {
        if (this.state === 'alive' && this.d.get(this.mapId)?.hasWorldBoss) return `Ya hay un ${this.name} vivo en ${MAPS[this.mapId].name}.`;
        const maps = worldBossMaps(), id = mapId ?? maps[Math.floor(this.rnd() * maps.length)];
        if (!id || !MAPS[id]) { this.state = 'done'; return 'No hay mapa para el jefe de mundo.'; }
        const w = this.d.ensure(id), pos = w.spawnWorldBoss(WORLD_BOSS.type, at);
        if (!pos) { this.state = 'done'; return `No encontré lugar para el ${this.name} en ${MAPS[id].name}.`; }
        w.worldBossHook = (ev) => {
            this.state = 'done';
            const who = !ev.killer ? 'Los aventureros' : ev.fighters > 1 ? `${ev.killer} y ${ev.fighters - 1} más` : ev.killer;
            this.d.announce(`¡${who} ${ev.fighters > 1 || !ev.killer ? 'derribaron' : 'derribó'} al ${ev.name}!`);
        };
        this.state = 'alive'; this.mapId = id; this.until = now + WORLD_BOSS.lifeMin * 60_000; this.warned = false;
        const [t0, t1] = WORLD_BOSS.lvl;
        const text = `¡El ${this.name} (nivel ${MOBS[WORLD_BOSS.type].lvl}, para ${t0}-${t1}) despertó en ${MAPS[id].name}! Se va en ${WORLD_BOSS.lifeMin} minutos.`;
        this.d.announce(text);
        return text;
    }

    /** Para el GM: estado y próxima salida. */
    status(now = Date.now()): string {
        if (this.state === 'alive') return `${this.name} vivo en ${MAPS[this.mapId].name}; se va en ${Math.ceil((this.until - now) / 60_000)} min.`;
        if (this.state === 'waiting' && Number.isFinite(this.at)) return `Hoy sale en ${Math.ceil((this.at - now) / 60_000)} min (en un mapa al azar de nivel ${WORLD_BOSS.lvl[0]}-${WORLD_BOSS.lvl[1]}).`;
        return 'Hoy ya no sale: mañana se sortea otra hora.';
    }
}
