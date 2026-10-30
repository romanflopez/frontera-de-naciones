/**
 * Ventana de la casa de subastas (se abre hablando con el Subastador). Solo vista: el server valida todo
 * (distancia, propiedad, oro, lugar en la bolsa, límites) y manda el resultado en `econResult` más el estado
 * (`auctionSearchResult`, `auctionMyState`, `inventoryState`). Ver docs/SUBASTAS.md.
 */
import { AH_MAX_LISTINGS, BAG_MAX, AH_PRICE_MAX, AH_PRICE_MIN, ahCommission, ahListingFee, ahSellerNet, itemLevel, RARITY_NAMES, type AttrId, type Base } from '@fdn/world';
import type { AuctionListing, AuctionMail, AuctionMyState, AuctionSearchResult, InvItem } from '@fdn/proto';
import type { Net, ServerPayload } from './net.ts';

type SendFn = Net['send'];

/** Lo mínimo que la ventana necesita de un item del cliente (el `Item` de main.ts cumple esto). */
export interface AhItem extends Base { id: number; rar: { n: string; c: string; k: number }; attrs: { id: AttrId; v: number }[] }
export interface AuctionDeps<I extends AhItem> {
    send: SendFn;
    bag: () => I[];
    gold: () => number;
    fromInv: (v: InvItem) => I;
    icon: (it: I) => string;
    attrText: (a: { id: AttrId; v: number }) => string;
    esc: (s: string) => string;
    fmt: (n: number) => string;
    toast: (t: string) => void;
}
export interface AuctionUI {
    open(npc: { id: string; name: string }): void;
    close(): void;
    readonly isOpen: boolean;
    /** Devuelve true si el mensaje era de la subasta. */
    onMessage(m: ServerPayload): boolean;
    /** Cambió la bolsa o el oro: redibuja. */
    refresh(): void;
}
type Tab = 'buscar' | 'publicar' | 'mias' | 'buzon';

const CSS = `
#ah{top:calc(84px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);width:min(620px,calc(100vw - 24px));max-height:calc(100% - 200px);padding:12px;display:grid;grid-template-rows:auto auto 1fr;gap:8px;overflow:hidden;box-sizing:border-box}
#ah h2{margin:0;font-family:var(--f-display);font-size:15px;color:var(--brass);letter-spacing:.04em;display:flex;align-items:center;gap:8px}
#ah h2 small{font-family:var(--f-body);color:var(--text);font-variant-numeric:tabular-nums}
#ah h2 small.role{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
#ah h2 #ahGold{margin-left:auto}
#ah h2 button{padding:0 8px;line-height:22px;font-size:16px}
#ah .tabs{grid-template-columns:repeat(4,1fr)}
#ah .tabs b{display:inline-block;min-width:14px;margin-left:4px;padding:1px 4px;border-radius:8px;background:var(--brass);color:#1a1204;font:700 10px/1.2 var(--f-inter)}
#ahBody{display:grid;grid-template-columns:1fr 220px;gap:8px;min-height:0;overflow:hidden}
#ahMain{display:grid;align-content:start;gap:6px;min-height:0;overflow:auto;padding-right:2px;scrollbar-width:thin}
#ahSide{min-height:0;overflow:auto}
#ah .ahf{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
#ah .ahf input,#ah .ahf select,#ah .ahp input{min-width:0;height:28px;box-sizing:border-box;padding:0 6px;font:12px var(--f-body);color:var(--text);background:#0d100e;border:1px solid var(--line);border-radius:3px}
#ah .ahf .wide{grid-column:span 3}
#ah .ahf .half{grid-column:span 2}
#ah .ahf button{grid-column:span 2;height:28px}
#ah .srow{width:100%;box-sizing:border-box}
#ah .srow.sel{outline:2px solid var(--brass);outline-offset:-2px}
#ah .srow.mine{border-left:3px solid var(--brass)}
#ah .pager{display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px;color:var(--muted)}
#ah .pager button{height:26px;padding:0 10px}
#ah .empty{padding:14px 6px;text-align:center;color:var(--muted);font-size:12.5px}
#ah .note{font-size:11.5px;color:var(--muted);line-height:1.35}
#ah .ahp{display:grid;gap:6px;margin-top:6px}
#ah .ahp label{display:grid;gap:3px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
#ah .ahp .fees{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-size:12px;color:#cdbf9c}
#ah .ahp .fees b{color:#f1e6c8;font-variant-numeric:tabular-nums;text-align:right}
#ah .rowbtns{display:flex;gap:6px;margin-top:4px}
#ah .rowbtns button{flex:1;padding:6px 8px;height:auto;font:600 12px/1 var(--f-cinzel);color:#e6d4a6;background:linear-gradient(#3c0c14,#220509);border:1px solid #a98340;border-radius:3px}
#ah .rowbtns button:disabled{opacity:.45;filter:grayscale(.6)}
#ah .ahtip{display:grid;gap:5px;padding:10px 12px;font-size:12.5px;color:#d9ccaa;background:linear-gradient(#1b1510,#0c0a08);border:2px solid #6a5028;border-radius:4px;box-shadow:0 0 0 1px #000,0 8px 24px #000c}
#ah .ahtip .iname{font:700 15px/1.2 var(--f-cinzel)}
#ah .ahtip .sub{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#9c9170}
#ah .ahtip ul{margin:0;padding-left:16px}
#ah .mail{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#181c19;border:1px solid #2b312c;border-radius:3px;font-size:12.5px}
#ah .mail .iico{width:30px;height:30px;flex:none;margin:0}
#ah .mail span{flex:1;line-height:1.25} #ah .mail small{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
#ah .mail .coin{width:30px;height:30px;flex:none;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffe58a,#c9a227 60%,#7a5a10);color:#3a2a05;font:700 13px var(--f-cinzel)}
@media (max-width:560px){#ah h2 small.role{display:none} #ahBody{grid-template-columns:1fr;overflow:auto} #ahMain{overflow:visible} #ah .ahf{grid-template-columns:repeat(4,1fr)} #ah .ahf .wide{grid-column:span 4} #ah .ahf .half{grid-column:span 2}}
`;

const SLOT_OPTS: [string, string][] = [['', 'Todo'], ['arma', 'Arma'], ['armadura', 'Armadura'], ['cabeza', 'Cabeza'], ['anillo', 'Anillo']];
const SORT_OPTS: [string, string][] = [['price_asc', 'Precio: menor'], ['price_desc', 'Precio: mayor'], ['time_asc', 'Termina antes'], ['time_desc', 'Termina después']];

/** "1 d 3 h", "5 h 20 min", "12 min". */
export function timeLeft(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${mm} min`;
    return m ? `${mm} min` : 'menos de 1 min';
}

export function createAuctionUI<I extends AhItem>(d: AuctionDeps<I>): AuctionUI {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const el = document.createElement('div'); el.id = 'ah'; el.className = 'hud box'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Casa de subastas');
    el.innerHTML = `<h2><span id="ahName">Subastador</span> <small class="role">Casa de subastas</small><small id="ahGold"></small><button type="button" id="ahClose" aria-label="Cerrar">×</button></h2>
<div class="tabs" role="tablist" id="ahTabs"><button type="button" role="tab" data-t="buscar">Buscar</button><button type="button" role="tab" data-t="publicar">Publicar</button><button type="button" role="tab" data-t="mias">Mis publicaciones</button><button type="button" role="tab" data-t="buzon">Buzón</button></div>
<div id="ahBody"><div id="ahMain"></div><div id="ahSide"></div></div>`;
    document.body.appendChild(el);
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    // que lo que se escribe en los filtros no dispare atajos del juego
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.stopPropagation(); });

    let npc: { id: string; name: string } | null = null, tab: Tab = 'buscar';
    let results: AuctionSearchResult = { listings: [], page: 0, pages: 1, total: 0 }, resultsAt = 0;
    let mine: AuctionMyState = { listings: [], mail: [], maxListings: AH_MAX_LISTINGS }, mineAt = 0;
    const filt = { slot: '', rarity: 0, text: '', lvlMin: 0, lvlMax: 0, maxPrice: 0, sort: 'price_asc', page: 0 };
    let selListing = 0, selBag = -1, price = '';

    const send = (action: string, extra: Record<string, unknown> = {}) => {
        if (!npc) return;
        d.send({ $case: 'auctionRequest', value: { npcId: npc.id, action, query: { ...filt }, ...extra } });
    };
    const left = (l: AuctionListing) => l.expiresInMs - (performance.now() - (mine.listings.includes(l) ? mineAt : resultsAt));

    function tip(it: I, extra = ''): string {
        const base: string[] = [];
        if (it.dmg) base.push(`Daño ${it.dmg[0]}–${it.dmg[1]}`); if (it.def) base.push(`Defensa ${it.def}`); if (it.rm) base.push(`Res. mágica ${it.rm}`); if (it.mag) base.push(`+${it.mag} daño mágico`);
        return `<div class="ahtip" style="border-color:${it.rar.k ? it.rar.c : '#6b5a3c'}"><div class="iname" style="color:${it.rar.c}">${d.esc(it.name)}</div><div class="sub">${it.rar.n} · ${it.slot} · Nv ${itemLevel(it.name)}</div>
${base.length ? `<div>${base.join(' · ')}</div>` : ''}
${it.attrs.length ? `<ul>${it.attrs.map((a) => `<li style="color:#8fb6f0">${d.attrText(a)}</li>`).join('')}</ul>` : `<div class="sub">Sin atributos extra</div>`}${extra}</div>`;
    }
    const row = (it: I, right: string, data: string, cls = '', sub = '') =>
        `<button type="button" class="srow${cls}" ${data}>${d.icon(it)}<span style="color:${it.rar.c}">${d.esc(it.name)}<small>${sub || `${it.rar.n} · ${it.slot} · Nv ${itemLevel(it.name)}`}</small></span><em>${right}</em></button>`;

    function renderSearch(main: HTMLElement, side: HTMLElement) {
        const opt = (o: [string, string][], v: string) => o.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('');
        const rarOpts = [['0', 'Toda rareza'], ...RARITY_NAMES.map((n, i) => [String(i + 1), n])] as [string, string][];
        main.innerHTML = `<form class="ahf" id="ahForm" autocomplete="off">
<input class="wide" id="ahText" type="search" placeholder="Nombre del item" aria-label="Nombre del item" maxlength="40" value="${d.esc(filt.text)}">
<select class="half" id="ahSlot" aria-label="Tipo">${opt(SLOT_OPTS, filt.slot)}</select>
<select id="ahRar" aria-label="Rareza">${opt(rarOpts, String(filt.rarity))}</select>
<input id="ahLmin" type="number" min="1" max="60" placeholder="Nv mín" aria-label="Nivel mínimo" value="${filt.lvlMin || ''}">
<input id="ahLmax" type="number" min="1" max="60" placeholder="Nv máx" aria-label="Nivel máximo" value="${filt.lvlMax || ''}">
<input class="half" id="ahPmax" type="number" min="1" placeholder="Precio máx." aria-label="Precio máximo" value="${filt.maxPrice || ''}">
<select class="half" id="ahSort" aria-label="Orden">${opt(SORT_OPTS, filt.sort)}</select>
<button type="submit">Buscar</button></form>
${results.listings.length ? results.listings.map((l) => { const it = d.fromInv(l.item!); return row(it, `${d.fmt(l.price)} oro`, `data-l="${l.id}"`, (l.id === selListing ? ' sel' : '') + (l.mine ? ' mine' : '') + (d.gold() < l.price && !l.mine ? ' poor' : ''), `${it.rar.n} · Nv ${l.lvl} · ${l.mine ? 'tuya' : d.esc(l.seller)} · ${timeLeft(left(l))}`); }).join('') : `<div class="empty">No hay publicaciones con esos filtros.</div>`}
<div class="pager"><button type="button" id="ahPrev" ${results.page <= 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button><span>Página ${results.page + 1} de ${results.pages} · ${results.total} resultado${results.total === 1 ? '' : 's'}</span><button type="button" id="ahNext" ${results.page + 1 >= results.pages ? 'disabled' : ''} aria-label="Página siguiente">›</button></div>`;
        const num = (id: string) => Math.max(0, Math.floor(Number(q<HTMLInputElement>(id).value) || 0));
        q<HTMLFormElement>('#ahForm').onsubmit = (e) => {
            e.preventDefault();
            Object.assign(filt, { text: q<HTMLInputElement>('#ahText').value.trim(), slot: q<HTMLSelectElement>('#ahSlot').value, rarity: Number(q<HTMLSelectElement>('#ahRar').value) || 0, lvlMin: num('#ahLmin'), lvlMax: num('#ahLmax'), maxPrice: num('#ahPmax'), sort: q<HTMLSelectElement>('#ahSort').value, page: 0 });
            send('search');
        };
        q<HTMLSelectElement>('#ahSort').onchange = () => { filt.sort = q<HTMLSelectElement>('#ahSort').value; filt.page = 0; send('search'); };
        q<HTMLButtonElement>('#ahPrev').onclick = () => { filt.page = Math.max(0, results.page - 1); send('search'); };
        q<HTMLButtonElement>('#ahNext').onclick = () => { filt.page = results.page + 1; send('search'); };
        main.querySelectorAll<HTMLElement>('[data-l]').forEach((b) => (b.onclick = () => { selListing = Number(b.dataset.l); render(); }));
        const l = results.listings.find((x) => x.id === selListing);
        if (!l) { side.innerHTML = `<div class="note">Tocá una publicación para ver sus atributos y comprarla. La casa es una sola para Solmar y Vhar.</div>`; return; }
        const it = d.fromInv(l.item!), poor = d.gold() < l.price, full = d.bag().length >= BAG_MAX;
        side.innerHTML = tip(it, `<div class="sub">${l.mine ? 'Publicación tuya' : `Vende: ${d.esc(l.seller)}`} · vence en ${timeLeft(left(l))}</div><div class="rowbtns">${l.mine ? `<button type="button" id="ahCancel">Retirar</button>` : `<button type="button" id="ahBuy" ${poor ? 'disabled' : ''}>Comprar · ${d.fmt(l.price)} oro</button>`}</div>${!l.mine && poor ? `<div class="note">No te alcanza el oro.</div>` : ''}${!l.mine && full ? `<div class="note">Tu bolsa está llena: hacé lugar antes de comprar.</div>` : ''}`);
        const buy = el.querySelector<HTMLButtonElement>('#ahBuy'), cancel = el.querySelector<HTMLButtonElement>('#ahCancel');
        if (buy) buy.onclick = () => { if (d.gold() < l.price) { d.toast('No te alcanza el oro.'); return; } send('buy', { listingId: l.id }); };
        if (cancel) cancel.onclick = () => send('cancel', { listingId: l.id });
    }

    function renderPost(main: HTMLElement, side: HTMLElement) {
        const bag = d.bag();
        main.innerHTML = `<div class="note">Elegí un item de la bolsa y ponele precio. La publicación dura 48 h. Tasa de publicación: 2 % (mínimo 1, no se devuelve). Comisión al vender: 5 %. Publicaciones activas: ${mine.listings.length} / ${mine.maxListings || AH_MAX_LISTINGS}.</div>`
            + (bag.length ? bag.map((it, i) => row(it, '', `data-b="${i}"`, i === selBag ? ' sel' : '')).join('') : `<div class="empty">La bolsa está vacía.</div>`);
        main.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => (b.onclick = () => { selBag = Number(b.dataset.b); render(); }));
        const it = bag[selBag];
        if (!it) { side.innerHTML = `<div class="note">Tocá un item de tu bolsa para publicarlo.</div>`; return; }
        side.innerHTML = tip(it, `<form class="ahp" id="ahPost"><label>Precio (oro)<input id="ahPrice" type="number" inputmode="numeric" min="${AH_PRICE_MIN}" max="${AH_PRICE_MAX}" step="1" value="${d.esc(price)}" placeholder="Precio de compra"></label><div class="fees" id="ahFees"></div><div class="rowbtns"><button type="submit" id="ahPostBtn">Publicar</button></div></form>`);
        const input = q<HTMLInputElement>('#ahPrice'), fees = q<HTMLElement>('#ahFees'), btn = q<HTMLButtonElement>('#ahPostBtn');
        const upd = () => {
            price = input.value; const p = Number(input.value), valid = Number.isInteger(p) && p >= AH_PRICE_MIN && p <= AH_PRICE_MAX;
            fees.innerHTML = valid ? `<span>Tasa ahora</span><b>${d.fmt(ahListingFee(p))}</b><span>Comisión al vender</span><b>${d.fmt(ahCommission(p))}</b><span>Recibís si se vende</span><b>${d.fmt(ahSellerNet(p))}</b>`
                : `<span>${input.value ? `Precio entre ${AH_PRICE_MIN} y ${d.fmt(AH_PRICE_MAX)}, sin decimales.` : 'Poné un precio.'}</span>`;
            btn.disabled = !valid || d.gold() < ahListingFee(p) || mine.listings.length >= (mine.maxListings || AH_MAX_LISTINGS);
        };
        input.oninput = upd; upd();
        q<HTMLFormElement>('#ahPost').onsubmit = (e) => {
            e.preventDefault(); const p = Number(input.value);
            if (!Number.isInteger(p) || p < AH_PRICE_MIN || p > AH_PRICE_MAX) { d.toast(`El precio tiene que ser un entero entre ${AH_PRICE_MIN} y ${d.fmt(AH_PRICE_MAX)}.`); return; }
            send('post', { uid: it.id, price: p });
        };
    }

    function renderMine(main: HTMLElement, side: HTMLElement) {
        main.innerHTML = `<div class="note">Publicaciones activas: ${mine.listings.length} / ${mine.maxListings || AH_MAX_LISTINGS}. Retirar no devuelve la tasa; el item va al buzón.</div>`
            + (mine.listings.length ? mine.listings.map((l) => { const it = d.fromInv(l.item!); return row(it, `${d.fmt(l.price)} oro`, `data-m="${l.id}"`, l.id === selListing ? ' sel' : '', `${it.rar.n} · vence en ${timeLeft(left(l))}`); }).join('') : `<div class="empty">No tenés publicaciones activas.</div>`);
        main.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => (b.onclick = () => { selListing = Number(b.dataset.m); render(); }));
        const l = mine.listings.find((x) => x.id === selListing);
        if (!l) { side.innerHTML = `<div class="note">Tocá una publicación para verla o retirarla.</div>`; return; }
        side.innerHTML = tip(d.fromInv(l.item!), `<div class="sub">${d.fmt(l.price)} oro · recibís ${d.fmt(ahSellerNet(l.price))} · vence en ${timeLeft(left(l))}</div><div class="rowbtns"><button type="button" id="ahCancel">Retirar</button></div>`);
        q<HTMLButtonElement>('#ahCancel').onclick = () => send('cancel', { listingId: l.id });
    }

    function renderMail(main: HTMLElement, side: HTMLElement) {
        const total = mine.mail.reduce((s, m) => s + (m.gold || 0), 0), items = mine.mail.filter((m) => m.item).length;
        const ago = (ms: number) => (ms < 60000 ? 'recién' : `hace ${timeLeft(ms)}`);
        main.innerHTML = mine.mail.length ? mine.mail.map((m: AuctionMail) => {
            const it = m.item ? d.fromInv(m.item) : null;
            return `<div class="mail">${it ? d.icon(it) : '<i class="coin" aria-hidden="true">$</i>'}<span>${it ? `<b style="color:${it.rar.c}">${d.esc(it.name)}</b>` : `<b style="color:var(--brass)">${d.fmt(m.gold)} oro</b>`}<small>${d.esc(m.text)} · ${ago(m.ageMs)}</small></span><button type="button" data-c="${m.id}">Retirar</button></div>`;
        }).join('') : `<div class="empty">El buzón está vacío. Acá llegan el oro de tus ventas y los items que retirás o que vencen.</div>`;
        main.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => (b.onclick = () => send('claim', { mailId: Number(b.dataset.c) })));
        side.innerHTML = `<div class="ahtip"><div class="iname" style="color:var(--brass)">Buzón</div><div>${d.fmt(total)} oro por retirar</div><div>${items} item${items === 1 ? '' : 's'} por retirar</div><div class="sub">Los items necesitan lugar en la bolsa (${d.bag().length} / ${BAG_MAX}).</div><div class="rowbtns"><button type="button" id="ahClaimAll" ${mine.mail.length ? '' : 'disabled'}>Retirar todo</button></div></div>`;
        q<HTMLButtonElement>('#ahClaimAll').onclick = () => send('claim', { mailId: 0 });
    }

    function render() {
        if (el.hidden) return;
        q<HTMLElement>('#ahGold').textContent = d.fmt(d.gold()) + ' oro';
        el.querySelectorAll<HTMLElement>('#ahTabs [data-t]').forEach((b) => {
            b.setAttribute('aria-selected', String(b.dataset.t === tab));
            if (b.dataset.t === 'buzon') b.innerHTML = `Buzón${mine.mail.length ? `<b>${mine.mail.length}</b>` : ''}`;
            if (b.dataset.t === 'mias') b.innerHTML = `Mis publicaciones${mine.listings.length ? `<b>${mine.listings.length}</b>` : ''}`;
        });
        const main = q<HTMLElement>('#ahMain'), side = q<HTMLElement>('#ahSide');
        // no pisar lo que se está escribiendo en el precio
        const focusPrice = document.activeElement?.id === 'ahPrice';
        if (tab === 'buscar') renderSearch(main, side);
        else if (tab === 'publicar') renderPost(main, side);
        else if (tab === 'mias') renderMine(main, side);
        else renderMail(main, side);
        if (focusPrice) { const i = el.querySelector<HTMLInputElement>('#ahPrice'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    }

    el.querySelectorAll<HTMLElement>('#ahTabs [data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t as Tab; selListing = 0; render(); }));
    q<HTMLButtonElement>('#ahClose').onclick = () => ui.close();
    // el tiempo restante se actualiza solo mientras la ventana está abierta
    setInterval(() => { if (!el.hidden && (tab === 'buscar' || tab === 'mias') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') render(); }, 30000);

    const ui: AuctionUI = {
        open(n) {
            npc = n; el.hidden = false; q<HTMLElement>('#ahName').textContent = n.name;
            selBag = -1; selListing = 0; price = ''; filt.page = 0;
            render(); send('open');
        },
        close() { npc = null; el.hidden = true; },
        get isOpen() { return !el.hidden; },
        onMessage(m) {
            if (m.$case === 'auctionSearchResult') { results = m.value; resultsAt = performance.now(); if (!results.listings.some((l) => l.id === selListing) && tab === 'buscar') selListing = 0; render(); return true; }
            if (m.$case === 'auctionMyState') {
                const before = mine.listings.length; mine = m.value; mineAt = performance.now();
                if (tab === 'publicar' && mine.listings.length > before) { selBag = -1; price = ''; } // se publicó: limpiar la selección
                render(); return true;
            }
            return false;
        },
        refresh() { if (!el.hidden) { if (selBag >= d.bag().length) selBag = -1; render(); } },
    };
    return ui;
}
