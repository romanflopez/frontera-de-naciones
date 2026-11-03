/**
 * Avisos grandes en el medio de la pantalla, con el diseño del pack Craftpix: la notificación con
 * título y texto, y el cartel de subir de nivel. Se apilan en #notif y se van solos.
 * No tocan el chat: lo que llega acá también sigue yendo al registro.
 */

let host: HTMLElement | null = null;
const donde = () => (host ??= document.getElementById('notif'));

/** Lo muestra, lo deja `ms` y lo saca. Varios avisos se apilan en el orden en que llegan. */
function mostrar(el: HTMLElement, ms: number) {
    const h = donde();
    if (!h) return;
    h.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
        el.classList.remove('in');
        setTimeout(() => el.remove(), 400); // lo que tarda el fundido de salida
    }, ms);
}

/** Aviso con título y texto (misión lista, encargo cumplido, jefe de mundo…). */
export function notify(titulo: string, texto: string, ms = 5200) {
    const el = document.createElement('div');
    el.className = 'nt';
    const h = document.createElement('h2');
    h.textContent = titulo;
    const p = document.createElement('p');
    p.textContent = texto;
    el.append(h, p);
    mostrar(el, ms);
}

/** Cartel de subir de nivel. */
export function levelCard(lvl: number, ms = 3600) {
    const el = document.createElement('div');
    el.className = 'nt lv';
    const s = document.createElement('span');
    s.textContent = 'Subiste a';
    const b = document.createElement('b');
    b.textContent = `Nivel ${lvl}`;
    el.append(s, b);
    mostrar(el, ms);
}
