/**
 * Tienda de contribución (D.10, DISEÑO.md §5b): EK, contribución gastable y los títulos que se compran. Solo vista: el server valida
 * todo (compra, puesto) y manda el estado en `inventoryState` después de cada cambio. Se abre con la tecla N.
 */
import { CONTRIB_SHOP, CONTRIB_PER_KILL } from '@fdn/world';
import type { Net } from './net.ts';

export interface ContribState { ek: number; contrib: number; titles: string[]; title: string }
export interface ContribDeps { send: Net['send']; esc: (s: string) => string }
export interface ContribUI { toggle(): void; close(): void; readonly isOpen: boolean; onState(s: ContribState): void }

const CSS = `
#ctb{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:25;width:min(420px,94vw);max-height:86vh;overflow:auto;padding:14px 16px;color:#d9ccaa;background:linear-gradient(#1b1510,#0c0a08);border:2px solid #6a5028;border-radius:4px;box-shadow:0 0 0 1px #000,0 12px 40px #000c;font-family:var(--f-cinzel,serif)}
#ctb h2{margin:0 0 4px;font:700 17px/1.2 var(--f-cinzel,serif);color:#e5c27a;display:flex;justify-content:space-between;align-items:center}
#ctb h2 button{background:none;border:0;color:#9c9170;font-size:20px;cursor:pointer}
#ctb .sub{font-size:11px;color:#9c9170;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
#ctb .nums{display:flex;gap:18px;margin:8px 0 12px;font-size:13px}
#ctb .nums b{color:#ffd24a;font-size:18px;display:block}
#ctb .row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #3a2f1c;font-size:13px}
#ctb .row small{display:block;color:#9c9170;font-size:11px}
#ctb .row button{font:600 12px var(--f-cinzel,serif);padding:5px 10px;color:#1b1510;background:#c9a227;border:0;border-radius:3px;cursor:pointer}
#ctb .row button[disabled]{background:#4a4030;color:#7a6f55;cursor:default}
#ctb .row button.alt{background:#3a5a3a;color:#d9ccaa}
#ctb .help{margin-top:10px;font-size:11px;color:#9c9170;line-height:1.4}
`;

export function createContribUI(d: ContribDeps): ContribUI {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const el = document.createElement('div'); el.id = 'ctb'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Tienda de contribución');
    document.body.appendChild(el);
    let st: ContribState = { ek: 0, contrib: 0, titles: [], title: '' };
    const req = (action: string, id = '') => d.send({ $case: 'contribRequest', value: { action, id } });
    const render = () => {
        const rows = CONTRIB_SHOP.map((it) => {
            const owned = st.titles.includes(it.id), worn = st.title === it.id, can = st.contrib >= it.cost;
            const btn = worn ? `<button type="button" class="alt" data-a="unequip">Sacar</button>` : owned ? `<button type="button" class="alt" data-a="equip" data-id="${it.id}">Poner</button>` : `<button type="button" data-a="buy" data-id="${it.id}" ${can ? '' : 'disabled'}>Comprar · ${it.cost}</button>`;
            return `<div class="row"><div><b>${d.esc(it.name)}</b>${worn ? ' ✓' : ''}<small>${d.esc(it.desc)}</small></div>${btn}</div>`;
        }).join('');
        el.innerHTML = `<h2>Tienda de contribución <button type="button" data-a="close" aria-label="Cerrar">×</button></h2>
            <div class="sub">Lo que ganás peleando por tu nación</div>
            <div class="nums"><div><b>${st.ek}</b>EK (kills)</div><div><b>${st.contrib}</b>Contribución</div></div>${rows}
            <div class="help">Cada kill válido a un jugador de la otra nación en zona roja suma 1 EK y ${CONTRIB_PER_KILL} de contribución. El mismo jugador cuenta una vez cada 4 horas. Acá se compran cosas visuales: nunca poder.</div>`;
    };
    el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button'); if (!b) return;
        const a = b.dataset.a; if (a === 'close') { ui.close(); return; }
        if (a) req(a, b.dataset.id ?? '');
    });
    const ui: ContribUI = {
        get isOpen() { return !el.hidden; },
        toggle() { el.hidden = !el.hidden; if (!el.hidden) render(); },
        close() { el.hidden = true; },
        onState(s) { st = s; if (!el.hidden) render(); },
    };
    return ui;
}
