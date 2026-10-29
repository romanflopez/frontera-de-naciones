/**
 * Guardado del progreso en la cuenta: el juego arma un snapshot y esto lo manda al server
 * cuando cambia (con tope de frecuencia), cada tanto aunque no cambie, y al cerrar la pestaña.
 * El server valida todo y lo guarda; al entrar manda de vuelta lo guardado (CharacterLoaded).
 */
export interface SavedItem { n: string; r: number; a: { id: string; v: number }[] }
export interface CharSave {
    v: number; faction: string; cls: string; lvl: number; exp: number; gold: number; hp: number; mp: number;
    bag: SavedItem[]; eq: Record<string, SavedItem | null>;
    q: { i: number; st: 'new' | 'active' | 'ready'; prog: number; keys: Record<string, number>; shards: Record<string, number> };
    pots: { hp: number; mp: number };
}

export function parseSave(data: string): CharSave | null {
    try { const o = JSON.parse(data) as CharSave; return o && o.v === 1 && typeof o.cls === 'string' ? o : null; } catch { return null; }
}

export class Saver {
    private last = '';
    private lastSentAt = 0;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly build: () => CharSave, private readonly send: (json: string) => void) {}

    start(): void {
        this.stop();
        this.last = JSON.stringify(this.build());
        this.timer = setInterval(() => this.tick(false), 3000);
        addEventListener('pagehide', this.onHide);
        document.addEventListener('visibilitychange', this.onVis);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer); this.timer = null;
        removeEventListener('pagehide', this.onHide);
        document.removeEventListener('visibilitychange', this.onVis);
    }

    private onHide = () => this.tick(true);
    private onVis = () => { if (document.visibilityState === 'hidden') this.tick(true); };

    /** Manda si algo cambió (cada 3 s como mucho) o si pasaron 20 s; `force` ignora el tope. */
    tick(force: boolean): void {
        const json = JSON.stringify(this.build()), now = Date.now();
        if (!force && json === this.last && now - this.lastSentAt < 20000) return;
        this.last = json; this.lastSentAt = now;
        this.send(json);
    }
}
