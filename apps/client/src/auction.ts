/**
 * Ventana de la casa de subastas (se abre hablando con el Subastador). Solo vista: el server valida todo
 * (distancia, propiedad, oro, lugar en la bolsa, límites) y manda el resultado en `econResult` más el estado
 * (`auctionSearchResult`, `auctionMyState`, `auctionHistory`, `inventoryState`). Ver docs/SUBASTAS.md.
 *
 * Composición: marco oscuro con filetes dorados y título arriba; pestañas grandes (Buscar, Publicar, Mis publicaciones,
 * Buzón, Historial); a la izquierda el item destacado (lo seleccionado) y una lista corta; a la derecha una tabla tipo
 * registro con filtros, saldo y paginado. En angosto la columna izquierda pasa arriba y la lista se oculta.
 * Teclado: flechas entre pestañas y entre filas (la selección sigue al foco), Enter va a la acción, Escape cierra.
 */
import { AH_HIST_KINDS, AH_HIST_LABEL, AH_MAX_LISTINGS, AH_PRICE_MAX, AH_PRICE_MIN, BAG_MAX, ahCommission, ahListingFee, ahSellerNet, itemLevel, RARITY_NAMES, type AhHistKind, type AttrId, type Base } from '@fdn/world';
import type { AuctionHistoryEntry, AuctionListing, AuctionMail, AuctionMyState, AuctionSearchResult, InvItem } from '@fdn/proto';
import { coinIcon } from './itemicons.ts';
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
type Tab = 'buscar' | 'publicar' | 'mias' | 'buzon' | 'historial';
const TABS: Tab[] = ['buscar', 'publicar', 'mias', 'buzon', 'historial'];
const PAGE = 20;
const DAY = 86_400_000;

// select con flecha propia (caja roja con triángulo dorado, como el resto del marco)
const ARROW = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28"><rect x="1" y="3" width="20" height="22" rx="2" fill="#5a0e17" stroke="#8a6a36"/><path d="M6 12h10l-5 6z" fill="#e6c27a"/></svg>')}")`;

const CSS = `
#ah{z-index:5;pointer-events:auto;top:calc(58px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);width:min(1010px,calc(100vw - 28px));height:min(650px,calc(100% - 70px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)));box-sizing:border-box;padding:52px 16px 18px;display:flex;flex-direction:column;gap:10px;font-family:var(--f-inter);font-size:12.5px;color:#d9ccaa;
  background:radial-gradient(ellipse at 50% 0,#241a12 0,#100c09 55%,#070605 100%);border:3px solid #3b2d1b;border-radius:6px;
  box-shadow:0 0 0 1px #050302,0 0 0 3px #1c140c,0 0 0 4px #8a6a36,0 0 0 6px #120c06,inset 0 0 0 1px #a58144aa,inset 0 0 70px #000,0 18px 50px #000d}
#ah::before{content:"";position:absolute;inset:8px;border:1px solid #5d472555;border-radius:3px;pointer-events:none}
#ah .fw-crest{top:-27px}
#ah .ah-head{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:min(380px,calc(100% - 120px));height:34px;display:flex;align-items:center;justify-content:center;background:linear-gradient(#8a1a28,#4c0c16 55%,#2e060c);border:2px solid #7a5c2c;border-radius:3px;box-shadow:inset 0 0 0 1px #000,inset 0 2px 6px #d0505088,0 2px 6px #000a}
#ah .ah-head h2{margin:0;font:700 18px/1 var(--f-cinzel);letter-spacing:.18em;color:#ecd39a;text-shadow:0 1px 0 #000,0 0 8px #c9954a66;white-space:nowrap}
#ah .ah-x{position:absolute;right:12px;top:10px;width:34px;height:34px;padding:0;display:grid;place-items:center;font:700 24px/1 var(--f-inter);color:#ffe9e2;background:linear-gradient(#d02a2a,#7a0c10);border:2px solid #b08a48;border-radius:3px;box-shadow:inset 0 0 0 1px #000,0 2px 5px #000a;z-index:3}
#ah .ah-x:hover{filter:brightness(1.25);border-color:#f0cf86}
#ah :focus-visible{outline:2px solid #ffd986;outline-offset:2px}
#ah .ah-tabs{display:flex;gap:8px;padding:7px 10px;background:linear-gradient(#2c1e14,#170f0a);border:1px solid #5d4725;border-radius:3px;box-shadow:inset 0 1px 0 #e0ae6033,inset 0 -1px 0 #000,inset 0 0 14px #000a}
#ah .ah-tabs button{flex:1 1 0;min-width:0;height:38px;padding:0 8px;font:700 12.5px/1 var(--f-cinzel);letter-spacing:.09em;text-transform:uppercase;color:#cfae6e;background:linear-gradient(#5a1019,#330a10 55%,#1e0508);border:2px solid #7a5c2c;border-radius:3px;box-shadow:inset 0 0 0 1px #000,inset 0 1px 0 #c0505055,0 2px 4px #000a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ah .ah-tabs button:hover{filter:brightness(1.2);border-color:#c9a25a}
#ah .ah-tabs button[aria-selected=true]{color:#fff1c8;background:linear-gradient(#b42a36,#6e1420 55%,#3c0810);border-color:#e8c57a;box-shadow:inset 0 0 0 1px #000,inset 0 2px 8px #ff8a7a66,0 0 12px #e0404055,0 2px 4px #000a;text-shadow:0 0 8px #ffcf7a88}
#ah .ah-tabs .s{display:none}
#ah .ah-tabs .n{font:700 12px/1 var(--f-inter);font-style:normal;letter-spacing:0}
#ah .ah-tabs [data-t=mias]{flex-grow:1.4}
#ah .ah-body{flex:1;min-height:0;display:grid;grid-template-columns:262px minmax(0,1fr);gap:12px}
#ah .ah-side{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#ah .ah-main{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
#ah .ah-cap{flex:none;height:26px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 10px;font:700 11.5px/1 var(--f-cinzel);letter-spacing:.14em;text-transform:uppercase;color:#e2c789;background:linear-gradient(90deg,#2a070c,#5c121b 30%,#5c121b 70%,#2a070c);border:1px solid #6a5028;border-radius:2px;box-shadow:inset 0 0 0 1px #000;white-space:nowrap;overflow:hidden}
#ah .ah-cap b{font:600 11px var(--f-inter);letter-spacing:0;color:#f3dfae}
#ah .ah-feat{flex:none;display:grid;gap:8px;padding:12px;background:radial-gradient(ellipse at 30% 0,#2c1f15,#100b08 70%);border:1px solid #5d4725;border-radius:3px;box-shadow:inset 0 0 22px #000}
#ah .ah-fh{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:center}
#ah .ah-big{width:72px;height:72px;box-sizing:border-box;padding:3px;display:grid;place-items:center;background:radial-gradient(circle,#1d1712,#060504);border:2px solid var(--rc,#6a5028);border-radius:3px;box-shadow:inset 0 0 0 1px #000,inset 0 0 14px #000,0 0 12px color-mix(in srgb,var(--rc,#6a5028) 35%,transparent)}
#ah .ah-big img{width:100%;height:100%;max-height:none;object-fit:contain;margin:0}
#ah .ah-big.empty{color:#5d4725;font:700 26px var(--f-cinzel)}
#ah .ah-fn{min-width:0;display:grid;gap:3px}
#ah .ah-fn b{font:700 14.5px/1.2 var(--f-cinzel);overflow-wrap:anywhere}
#ah .ah-sub{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#9c8a62}
#ah .ah-price{display:flex;align-items:center;gap:6px;font:700 25px/1 var(--f-inter);letter-spacing:-.01em;color:#f3c95c;text-shadow:0 0 12px #c9952a55,0 1px 0 #000;font-variant-numeric:tabular-nums}
#ah .ah-price.neg{color:#e8806a;text-shadow:0 1px 0 #000} #ah .ah-price.pos{color:#9fdc78;text-shadow:0 1px 0 #000}
#ah .ah-price .ah-coin{width:22px;height:22px}
#ah .ah-state{font-size:11.5px;color:#bfae86;line-height:1.35}
#ah .ah-state em{font-style:normal;color:#f0dca4}
#ah .ah-stats{margin:0;padding:6px 0 0;list-style:none;display:grid;gap:2px;border-top:1px solid #3a2d19;font-size:12px;color:#cdbf9c}
#ah .ah-stats .at{color:#8fb6f0}
#ah .ah-acts{display:flex;flex-wrap:wrap;gap:6px}
#ah .ah-acts .ahb{flex:1 1 auto}
#ah .ah-warn{font-size:11.5px;color:#e8a06a}
#ah .ah-coin{display:inline-block;width:15px;height:15px;object-fit:cover;transform:scale(1.5);clip-path:circle(32% at 50% 52%);vertical-align:-3px;flex:none}
#ah .ah-list{flex:1;min-height:96px;overflow:auto;display:grid;align-content:start;gap:4px;padding:5px;background:#0a0807;border:1px solid #3a2d19;border-radius:3px;box-shadow:inset 0 0 14px #000;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#ah .ah-li{display:flex;align-items:center;gap:8px;min-height:40px;padding:3px 8px 3px 3px;text-align:left;font:600 12px/1.15 var(--f-cinzel);background:linear-gradient(90deg,#211812,#120d0a);border:1px solid #3e301c;border-radius:2px;box-shadow:inset 0 0 0 1px #000}
#ah .ah-li:hover{border-color:#a98340;filter:brightness(1.15)}
#ah .ah-li.sel{border-color:#e0b765;background:linear-gradient(90deg,#3a2813,#16100b)}
#ah .ah-li .iico,#ah .ah-li .ah-gi{width:32px;height:32px;flex:none;margin:0;border:1px solid var(--rc,#4a3a22);border-radius:2px;background:#060504;box-sizing:border-box}
#ah .ah-li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ah .ah-li small{display:block;font:500 10px var(--f-inter);color:#9c8a62;text-transform:uppercase;letter-spacing:.05em}
#ah .ah-none{padding:14px 8px;text-align:center;color:#8d7a52;font-size:12px;line-height:1.4}
#ah .ah-bar{flex:none;display:flex;align-items:center;gap:10px}
#ah .ah-bar .ah-cap{flex:1;justify-content:flex-start}
#ah .ah-bal{flex:none;display:flex;align-items:center;gap:7px;height:26px;padding:0 12px;background:#070605;border:1px solid #6a5028;border-radius:2px;box-shadow:inset 0 0 8px #000;font:600 11px/1 var(--f-cinzel);letter-spacing:.1em;text-transform:uppercase;color:#bfa36a;white-space:nowrap}
#ah .ah-bal b{font:700 13.5px/1 var(--f-inter);letter-spacing:0;color:#f3c95c;font-variant-numeric:tabular-nums}
#ah .ah-filt{flex:none;display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px 8px;padding:7px 9px;background:linear-gradient(#1c140e,#0e0a08);border:1px solid #4d3b20;border-radius:3px;box-shadow:inset 0 0 10px #000}
#ah .ah-filt label{display:grid;gap:2px;font:600 9.5px/1.2 var(--f-inter);text-transform:uppercase;letter-spacing:.08em;color:#9c8a62}
#ah .ah-filt .grow{flex:1 1 150px}
#ah .ah-filt .end{margin-left:auto}
#ah #ahMore{display:none}
#ah .ah-filt .br{flex-basis:100%;height:0}
#ah .ah-filt .note{flex:1 1 220px;align-self:center;font-size:11.5px;color:#a8946a;line-height:1.35}
#ah .ah-filt .note b{color:#f0dca4;font-weight:600}
#ah input,#ah select{height:28px;box-sizing:border-box;min-width:0;width:100%;padding:0 8px;font:500 12px var(--f-inter);color:#ead9b0;background:#090706;border:1px solid #6a5028;border-radius:3px;box-shadow:inset 0 1px 4px #000}
#ah select{appearance:none;-webkit-appearance:none;padding-right:28px;background:#090706 ${ARROW} no-repeat right 2px center/22px 28px;cursor:pointer}
#ah select option{background:#120d0a;color:#ead9b0}
#ah input::placeholder{color:#6d5f44}
#ah input:focus,#ah select:focus{border-color:#e0b765;outline:none;box-shadow:inset 0 1px 4px #000,0 0 0 1px #e0b76588}
#ah .w-num{width:74px} #ah .w-sel{width:118px} #ah .w-sort{width:142px}
#ah .ahb{height:30px;padding:0 14px;font:700 12px/1 var(--f-cinzel);letter-spacing:.06em;text-transform:uppercase;color:#f3dfae;background:linear-gradient(#8a1a28,#4c0c16 55%,#2e060c);border:2px solid #a98340;border-radius:3px;box-shadow:inset 0 0 0 1px #000,inset 0 1px 3px #e0606066,0 1px 3px #000a;white-space:nowrap}
#ah .ahb:hover:not(:disabled){filter:brightness(1.25);border-color:#f0cf86}
#ah .ahb.sec{color:#d9c79a;background:linear-gradient(#241a13,#0b0908);border-width:1px;border-color:#6a5028}
#ah .ahb:disabled{opacity:.42;filter:grayscale(.7);cursor:default}
#ah .ah-tw{flex:1;min-height:0;overflow:auto;background:#0a0807;border:1px solid #4d3b20;border-radius:3px;box-shadow:inset 0 0 18px #000;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#ah table{width:100%;border-collapse:separate;border-spacing:0;table-layout:auto}
#ah th{position:sticky;top:0;z-index:1;padding:7px 10px;text-align:left;font:700 10.5px/1 var(--f-cinzel);letter-spacing:.12em;text-transform:uppercase;color:#c9a96a;background:linear-gradient(#2c1f15,#18110c);border-bottom:1px solid #6a5028;white-space:nowrap}
#ah td{padding:4px 10px;border-top:1px solid transparent;border-bottom:1px solid transparent;vertical-align:middle;white-space:nowrap}
#ah tbody tr{cursor:pointer}
#ah tbody tr:nth-child(even) td{background:#ffe9b808}
#ah tbody tr:nth-child(odd) td{background:#00000040}
#ah tbody tr:hover td{background:#3a281633}
#ah tbody tr[aria-selected=true] td{background:linear-gradient(#3a28165a,#2a1c0e5a);border-color:#a98340}
#ah tbody tr:focus-visible{outline:2px solid #ffd986;outline-offset:-2px}
#ah tbody tr:focus{outline-color:#ffd986}
#ah td.it{display:flex;align-items:center;gap:8px;min-width:0;white-space:normal}
#ah td.it .iico,#ah td.it .ah-gi{width:28px;height:28px;flex:none;margin:0;border:1px solid var(--rc,#3e301c);border-radius:2px;background:#060504;box-sizing:border-box}
#ah td.it b{font:600 12.5px/1.15 var(--f-cinzel)}
#ah td.it small{display:none;font-size:10px;color:#9c8a62;text-transform:uppercase;letter-spacing:.05em}
#ah td.it span{display:grid;gap:1px;min-width:0}
#ah td .mu{color:#9c8a62}
#ah td.num{text-align:right;font-weight:600;color:#f0c75e;font-variant-numeric:tabular-nums}
#ah th.num{text-align:right}
#ah td.pos{color:#9fdc78} #ah td.neg{color:#e8806a} #ah td.zero{color:#8d7a52;font-weight:500}
#ah td.soon{color:#e8a06a}
#ah td.dt{color:#bfae86;font-variant-numeric:tabular-nums}
#ah td.tx{white-space:normal;min-width:120px;color:#cdbf9c}
#ah td.tx b{font-weight:600;color:#e6d4a6}
#ah .ah-pg{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#a8946a}
#ah .ah-pg .ahb{height:28px;min-width:44px;padding:0 10px;font:700 18px/1 var(--f-inter)}
#ah .ah-pg .ahb.txt{font:700 12px/1 var(--f-cinzel)}
#ah .ah-pg span{text-align:center}
#ah .poor td.num{color:#a67c4a}
#ah .mine td.it b::after{content:" · tuya";font:500 10px var(--f-inter);color:#d6a445;text-transform:uppercase;letter-spacing:.06em}
#ah .fees{display:grid;grid-template-columns:1fr auto;gap:3px 10px;font-size:12px;color:#cdbf9c}
#ah .fees b{color:#f1e6c8;font-variant-numeric:tabular-nums;text-align:right}
#ah .fees .tot{color:#f3c95c;font-weight:700}
#ah .pform{display:grid;gap:7px}
#ah .pform label{display:grid;gap:3px;font:600 9.5px var(--f-inter);text-transform:uppercase;letter-spacing:.08em;color:#9c8a62}
#ah .pform input{height:32px;font:700 15px var(--f-inter);color:#f3c95c}
@media (max-width:860px){
  #ah{width:calc(100vw - 16px);top:calc(34px + env(safe-area-inset-top,0px));height:calc(100% - 42px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));padding:50px 10px 14px;gap:8px}
  #ah .ah-body{display:flex;flex-direction:column;overflow:auto;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
  #ah .ah-side{flex:none;overflow:visible}
  #ah .ah-main{flex:1 0 auto;min-height:360px}
  #ah .ah-side .ah-list,#ah .ah-side .ah-lcap{display:none}
  #ah .ah-tw{min-height:200px}
  #ah .ah-tabs .l{display:none} #ah .ah-tabs .s{display:inline} #ah .ah-tabs [data-t=mias]{flex-grow:1}
}
@media (max-width:600px){
  #ah .ah-head{width:calc(100% - 110px);height:30px;top:12px} #ah .ah-head h2{font-size:14px;letter-spacing:.12em}
  #ah .ah-x{right:8px;top:10px;width:32px;height:32px}
  #ah .fw-crest{display:none}
  #ah .ah-tabs{flex-wrap:wrap;gap:5px;padding:5px}
  #ah .ah-tabs button{flex:1 1 30%;height:32px;font-size:11px;letter-spacing:.04em;padding:0 4px}
  #ah .ah-feat{padding:9px;gap:6px}
  #ah .ah-fh{grid-template-columns:56px minmax(0,1fr);gap:10px}
  #ah .ah-big{width:56px;height:56px}
  #ah .ah-price{font-size:21px}
  #ah .ah-stats{font-size:11.5px}
  #ah .ah-bar .ah-cap{display:none}
  #ah .ah-bar{justify-content:flex-end}
  #ah .c-rar,#ah .c-who{display:none}
  #ah td.it small{display:block}
  #ah td,#ah th{padding-left:7px;padding-right:7px}
  #ah td.tx{min-width:0}
  #ah .w-num{width:62px} #ah .ah-filt .grow{flex-basis:100%}
  #ah #ahFeatCap{display:none}
  #ah .ah-filt .adv{display:none} #ah .ah-filt.open .adv{display:grid}
  #ah #ahMore{display:inline-block}
  #ah .ah-filt label:has(#ahSlot),#ah .ah-filt label:has(#ahSort){flex:1 1 40%} #ah .w-sel,#ah .w-sort{width:100%}
  #ah .ah-filt .ahb{flex:1 1 auto}
}
@media (prefers-reduced-motion:reduce){#ah *{transition:none!important}}
`;

const SLOT_OPTS: [string, string][] = [['', 'Todo'], ['arma', 'Arma'], ['armadura', 'Armadura'], ['cabeza', 'Cabeza'], ['anillo', 'Anillo']];
const SORT_OPTS: [string, string][] = [['price_asc', 'Precio: menor'], ['price_desc', 'Precio: mayor'], ['time_asc', 'Termina antes'], ['time_desc', 'Termina después']];
const RANGE_OPTS: [string, string][] = [['all', 'Todo'], ['today', 'Hoy'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días']];
const SLOT_NAME: Record<string, string> = { arma: 'Arma', armadura: 'Armadura', cabeza: 'Cabeza', anillo: 'Anillo' };

/** "1 d 3 h", "5 h 20 min", "12 min". */
export function timeLeft(ms: number): string {
    const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${mm} min`;
    return m ? `${mm} min` : 'menos de 1 min';
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** "Hoy 14:05", "Ayer 09:12", "03/11 18:40". */
export function fmtDate(t: number, now = Date.now()): string {
    const d = new Date(t), today = new Date(now); today.setHours(0, 0, 0, 0);
    const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    if (t >= today.getTime()) return `Hoy ${hm}`;
    if (t >= today.getTime() - DAY) return `Ayer ${hm}`;
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}${d.getFullYear() !== today.getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : ''} ${hm}`;
}

export function createAuctionUI<I extends AhItem>(d: AuctionDeps<I>): AuctionUI {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const COIN = coinIcon();
    const coin = (cls = 'ah-coin') => `<img class="${cls}" alt="" src="${COIN}">`;
    const el = document.createElement('div'); el.id = 'ah'; el.className = 'hud'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'ahTitle');
    const tabLabel: Record<Tab, [string, string]> = { buscar: ['Buscar', 'Buscar'], publicar: ['Publicar', 'Publicar'], mias: ['Mis publicaciones', 'Mías'], buzon: ['Buzón', 'Buzón'], historial: ['Historial', 'Historial'] };
    el.innerHTML = `<svg class="fw-crest" aria-hidden="true"><use href="#fwcrest"/></svg>
<svg class="fw-c tl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c tr" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c bl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c br" aria-hidden="true"><use href="#fwc"/></svg>
<header class="ah-head"><h2 id="ahTitle">CASA DE SUBASTAS</h2></header>
<button type="button" class="ah-x" id="ahClose" aria-label="Cerrar casa de subastas (Escape)">&times;</button>
<div class="ah-tabs" role="tablist" aria-label="Secciones" id="ahTabs">${TABS.map((t) => `<button type="button" role="tab" id="ahTab-${t}" data-t="${t}" aria-controls="ahBody"></button>`).join('')}</div>
<div class="ah-body" id="ahBody" role="tabpanel">
  <aside class="ah-side" aria-label="Detalle"><div class="ah-cap" id="ahFeatCap"></div><div class="ah-feat" id="ahFeat" aria-live="polite"></div><div class="ah-cap ah-lcap" id="ahListCap"></div><div class="ah-list" id="ahList"></div></aside>
  <section class="ah-main"><div class="ah-bar"><div class="ah-cap" id="ahMainCap"></div><div class="ah-bal" role="status" aria-label="Saldo de oro">Saldo: ${coin()}<b id="ahGold">0</b></div></div>
    <form class="ah-filt" id="ahFilt" autocomplete="off"></form>
    <div class="ah-tw" id="ahTw"></div>
    <div class="ah-pg" id="ahPg"></div></section>
</div>
<svg class="fw-gem" aria-hidden="true"><use href="#fwgem"/></svg>`;
    document.body.appendChild(el);
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    const qq = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T | null;

    let npc: { id: string; name: string } | null = null, tab: Tab = 'buscar';
    let results: AuctionSearchResult = { listings: [], page: 0, pages: 1, total: 0 }, resultsAt = 0;
    let mine: AuctionMyState = { listings: [], mail: [], maxListings: AH_MAX_LISTINGS }, mineAt = 0, mineWall = Date.now();
    let hist: AuctionHistoryEntry[] = [], histWall = Date.now(), histLoaded = false;
    const filt = { slot: '', rarity: 0, text: '', lvlMin: 0, lvlMax: 0, maxPrice: 0, sort: 'price_asc', page: 0 };
    /** Lo que se está escribiendo en los filtros (se aplica al buscar): un redibujo no lo pisa. */
    const draft = { text: '', lvlMin: '', lvlMax: '', maxPrice: '' };
    const hf = { kind: '' as '' | AhHistKind, range: 'all', page: 0 };
    const page = { publicar: 0, buzon: 0 };
    /** Selección por pestaña: id de publicación, uid de la bolsa, id del reclamo o de la entrada del historial. */
    const sel: Record<Tab, number> = { buscar: 0, publicar: 0, mias: 0, buzon: 0, historial: 0 };
    let price = '', moreOpen = false;

    const send = (action: string, extra: Record<string, unknown> = {}) => {
        if (!npc) return;
        d.send({ $case: 'auctionRequest', value: { npcId: npc.id, action, query: { ...filt }, ...extra } });
    };
    const left = (l: AuctionListing) => l.expiresInMs - (performance.now() - (mine.listings.includes(l) ? mineAt : resultsAt));
    const maxL = () => mine.maxListings || AH_MAX_LISTINGS;
    const rc = (it: I | null) => (it ? `--rc:${it.rar.c}` : '--rc:#8a6a36');
    const goldImg = () => `<img class="ah-gi" alt="" src="${COIN}" style="object-fit:cover;padding:3px">`;
    const money = (n: number) => `${d.fmt(n)} ${coin()}`;
    const signed = (n: number) => (n > 0 ? `+${d.fmt(n)}` : n < 0 ? `−${d.fmt(-n)}` : '—');
    const lvlTxt = (it: I) => `${it.rar.n} · Nv ${itemLevel(it.name)}`;
    const opt = (o: [string, string][], v: string) => o.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('');
    const mailWhen = (m: AuctionMail) => mineWall - m.ageMs;
    const histWhen = (h: AuctionHistoryEntry) => histWall - h.ageMs;
    const kindOf = (h: AuctionHistoryEntry) => (AH_HIST_KINDS.includes(h.kind as AhHistKind) ? (h.kind as AhHistKind) : 'claim');

    function stats(it: I): string {
        const base: string[] = [];
        if (it.dmg) base.push(`Daño ${it.dmg[0]}–${it.dmg[1]}`); if (it.def) base.push(`Defensa ${it.def}`); if (it.rm) base.push(`Res. mágica ${it.rm}`); if (it.mag) base.push(`+${it.mag} daño mágico`);
        const lines = [...(base.length ? [`<li>${base.join(' · ')}</li>`] : []), ...it.attrs.map((a) => `<li class="at">${d.attrText(a)}</li>`)];
        return lines.length ? `<ul class="ah-stats">${lines.join('')}</ul>` : '';
    }
    /** Cabecera del destacado: ícono grande, nombre en color de rareza y subtítulo. */
    const featHead = (it: I | null, title: string, sub: string) =>
        `<div class="ah-fh"><div class="ah-big${it ? '' : ' empty'}" style="${rc(it)}">${it ? d.icon(it) : `<img alt="" src="${COIN}" style="object-fit:cover;transform:scale(1.4);clip-path:circle(33% at 50% 52%)">`}</div><div class="ah-fn"><b style="color:${it ? it.rar.c : '#f3c95c'}">${title}</b><span class="ah-sub">${sub}</span></div></div>`;
    const featEmpty = (txt: string) => `<div class="ah-fh"><div class="ah-big empty" aria-hidden="true">?</div><div class="ah-state">${txt}</div></div>`;
    const itemCell = (it: I | null, name: string, sub: string) =>
        `<td class="it">${it ? d.icon(it).replace('<img', `<img style="${rc(it)}"`) : goldImg()}<span><b style="color:${it ? it.rar.c : '#f3c95c'}">${name}</b><small>${sub}</small></span></td>`;
    const pager = (pg: number, pages: number, total: number, noun: [string, string]) =>
        `<button type="button" class="ahb sec" id="ahPrev" ${pg <= 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button><span>Página ${pg + 1} de ${Math.max(1, pages)} · ${d.fmt(total)} ${total === 1 ? noun[0] : noun[1]}</span><button type="button" class="ahb sec" id="ahNext" ${pg + 1 >= pages ? 'disabled' : ''} aria-label="Página siguiente">›</button>`;
    const slice = <T,>(arr: T[], pg: number) => { const pages = Math.max(1, Math.ceil(arr.length / PAGE)), p = Math.min(pages - 1, Math.max(0, pg)); return { rows: arr.slice(p * PAGE, (p + 1) * PAGE), page: p, pages }; };
    /** Tabla tipo registro. rows: [clave de selección, clase, celdas] */
    const table = (label: string, head: [string, string][], rows: [number, string, string][], empty: string) =>
        rows.length ? `<table aria-label="${label}"><thead><tr>${head.map(([h, c]) => `<th scope="col" class="${c}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(([k, cls, cells]) => `<tr data-k="${k}" data-fk="r${k}" class="${cls}" tabindex="-1" aria-selected="${k === sel[tab]}">${cells}</tr>`).join('')}</tbody></table>` : `<div class="ah-none">${empty}</div>`;

    /** Lista de la izquierda fuera de Buscar: lo que espera en el buzón (items y oro). */
    function mailList(): string {
        const box = mine.mail;
        return box.length ? box.map((m) => { const it = m.item ? d.fromInv(m.item) : null; return `<button type="button" class="ah-li${tab === 'buzon' && sel.buzon === m.id ? ' sel' : ''}" data-mail="${m.id}" style="${rc(it)}">${it ? d.icon(it) : goldImg()}<span style="color:${it ? it.rar.c : '#f3c95c'}">${it ? d.esc(it.name) : `${d.fmt(m.gold)} de oro`}<small>${it ? lvlTxt(it) : 'Oro de una venta'}</small></span></button>`; }).join('')
            : `<div class="ah-none">Nada por retirar.</div>`;
    }

    // ---------- pestañas ----------
    function renderSearch(f: HTMLElement, tw: HTMLElement, pg: HTMLElement, feat: HTMLElement, list: HTMLElement) {
        const rarOpts = [['0', 'Toda rareza'], ...RARITY_NAMES.map((n, i) => [String(i + 1), n])] as [string, string][];
        q('#ahMainCap').innerHTML = `Resultados <b>${d.fmt(results.total)}</b>`;
        const advCount = [filt.rarity, filt.lvlMin, filt.lvlMax, filt.maxPrice].filter(Boolean).length;
        f.innerHTML = `<label class="grow">Nombre<input id="ahText" type="search" placeholder="Buscar por nombre…" maxlength="40" value="${d.esc(draft.text)}"></label>
<label>Tipo<select id="ahSlot" class="w-sel">${opt(SLOT_OPTS, filt.slot)}</select></label>
<label class="adv">Rareza<select id="ahRar" class="w-sel">${opt(rarOpts, String(filt.rarity))}</select></label>
<label>Orden<select id="ahSort" class="w-sort">${opt(SORT_OPTS, filt.sort)}</select></label>
<span class="br" aria-hidden="true"></span>
<label class="adv">Nv mín<input id="ahLmin" class="w-num" type="number" inputmode="numeric" min="1" max="60" placeholder="—" value="${d.esc(draft.lvlMin)}"></label>
<label class="adv">Nv máx<input id="ahLmax" class="w-num" type="number" inputmode="numeric" min="1" max="60" placeholder="—" value="${d.esc(draft.lvlMax)}"></label>
<label class="adv">Precio máx<input id="ahPmax" class="w-num" type="number" inputmode="numeric" min="1" placeholder="—" value="${d.esc(draft.maxPrice)}"></label>
<button type="button" class="ahb sec end" id="ahMore" aria-expanded="${moreOpen}" aria-controls="ahFilt">${moreOpen ? 'Menos filtros' : 'Más filtros'}${advCount ? ` (${advCount})` : ''}</button>
<button type="submit" class="ahb end" id="ahFind">Buscar</button>`;
        f.classList.toggle('open', moreOpen);
        q<HTMLButtonElement>('#ahMore').onclick = () => { moreOpen = !moreOpen; render(); };
        const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
        f.onsubmit = (e) => { e.preventDefault(); Object.assign(filt, { text: draft.text.trim(), lvlMin: num(draft.lvlMin), lvlMax: num(draft.lvlMax), maxPrice: num(draft.maxPrice), page: 0 }); send('search'); };
        const bindDraft = (id: string, k: keyof typeof draft) => { const i = q<HTMLInputElement>(id); i.oninput = () => { draft[k] = i.value; }; };
        bindDraft('#ahText', 'text'); bindDraft('#ahLmin', 'lvlMin'); bindDraft('#ahLmax', 'lvlMax'); bindDraft('#ahPmax', 'maxPrice');
        q<HTMLSelectElement>('#ahSlot').onchange = (e) => { filt.slot = (e.target as HTMLSelectElement).value; filt.page = 0; send('search'); };
        q<HTMLSelectElement>('#ahRar').onchange = (e) => { filt.rarity = Number((e.target as HTMLSelectElement).value) || 0; filt.page = 0; send('search'); };
        q<HTMLSelectElement>('#ahSort').onchange = (e) => { filt.sort = (e.target as HTMLSelectElement).value; filt.page = 0; send('search'); };

        if (!results.listings.some((l) => l.id === sel.buscar)) sel.buscar = results.listings[0]?.id ?? 0;
        tw.innerHTML = table('Publicaciones', [['Item', ''], ['Rareza / Nivel', 'c-rar'], ['Vendedor', 'c-who'], ['Tiempo restante', ''], ['Precio', 'num']],
            results.listings.map((l) => {
                const it = d.fromInv(l.item!), ms = left(l);
                return [l.id, `${l.mine ? 'mine' : ''}${!l.mine && d.gold() < l.price ? ' poor' : ''}`,
                    `${itemCell(it, d.esc(it.name), `${it.rar.n} · Nv ${l.lvl} · ${l.mine ? 'tuya' : d.esc(l.seller)}`)}<td class="c-rar"><span style="color:${it.rar.c}">${it.rar.n}</span> <span class="mu">· Nv ${l.lvl}</span></td><td class="c-who">${l.mine ? '<span class="mu">Vos</span>' : d.esc(l.seller)}</td><td class="${ms < 3_600_000 ? 'soon' : ''}">${timeLeft(ms)}</td><td class="num">${money(l.price)}</td>`];
            }), filt.text || filt.slot || filt.rarity || filt.lvlMin || filt.lvlMax || filt.maxPrice ? 'No hay publicaciones con esos filtros.' : 'Todavía no hay nada publicado. ¡Sé el primero!');
        pg.innerHTML = pager(results.page, results.pages, results.total, ['resultado', 'resultados']);
        q<HTMLButtonElement>('#ahPrev').onclick = () => { filt.page = Math.max(0, results.page - 1); send('search'); };
        q<HTMLButtonElement>('#ahNext').onclick = () => { filt.page = results.page + 1; send('search'); };

        q('#ahListCap').textContent = 'En esta página';
        list.innerHTML = results.listings.length ? results.listings.map((l) => { const it = d.fromInv(l.item!); return `<button type="button" class="ah-li${l.id === sel.buscar ? ' sel' : ''}" data-pick="${l.id}" style="${rc(it)}">${d.icon(it)}<span style="color:${it.rar.c}">${d.esc(it.name)}<small>${d.fmt(l.price)} oro</small></span></button>`; }).join('') : `<div class="ah-none">Sin resultados.</div>`;

        q('#ahFeatCap').textContent = 'Item seleccionado';
        const l = results.listings.find((x) => x.id === sel.buscar);
        if (!l) { feat.innerHTML = featEmpty('Elegí una publicación de la tabla para ver sus atributos y comprarla. La casa es una sola para Solmar y Vhar.'); return; }
        const it = d.fromInv(l.item!), poor = d.gold() < l.price, full = d.bag().length >= BAG_MAX;
        feat.innerHTML = featHead(it, d.esc(it.name), `${lvlTxt(it)} · ${SLOT_NAME[it.slot] ?? it.slot}`)
            + `<div class="ah-price">${d.fmt(l.price)} ${coin()}</div><div class="ah-state">${l.mine ? 'Publicación <em>tuya</em>' : `Vende <em>${d.esc(l.seller)}</em>`} · vence en <em>${timeLeft(left(l))}</em></div>${stats(it)}`
            + `<div class="ah-acts">${l.mine ? `<button type="button" class="ahb" id="ahCancel" data-primary>Retirar publicación</button>` : `<button type="button" class="ahb" id="ahBuy" data-primary ${poor ? 'disabled' : ''}>Comprar</button>`}</div>`
            + (!l.mine && poor ? `<div class="ah-warn">No te alcanza el oro (te faltan ${d.fmt(l.price - d.gold())}).</div>` : '') + (!l.mine && full ? `<div class="ah-warn">Tu bolsa está llena: hacé lugar antes de comprar.</div>` : '');
        const buy = qq<HTMLButtonElement>('#ahBuy'), cancel = qq<HTMLButtonElement>('#ahCancel');
        if (buy) buy.onclick = () => { if (d.gold() < l.price) { d.toast('No te alcanza el oro.'); return; } send('buy', { listingId: l.id }); };
        if (cancel) cancel.onclick = () => send('cancel', { listingId: l.id });
    }

    function renderPost(f: HTMLElement, tw: HTMLElement, pg: HTMLElement, feat: HTMLElement, list: HTMLElement) {
        const bag = d.bag(), n = mine.listings.length;
        q('#ahMainCap').innerHTML = `Tu bolsa <b>${bag.length} / ${BAG_MAX}</b>`;
        f.innerHTML = `<div class="note">Elegí un item y ponele precio. Dura <b>48 h</b>. Tasa de publicación <b>2 %</b> (mín. 1, no se devuelve) · comisión al vender <b>5 %</b> · activas <b>${n} / ${maxL()}</b>.</div>`;
        f.onsubmit = (e) => e.preventDefault();
        if (!bag.some((it) => it.id === sel.publicar)) sel.publicar = bag[0]?.id ?? 0;
        const s = slice(bag, page.publicar); page.publicar = s.page;
        tw.innerHTML = table('Items de tu bolsa', [['Item', ''], ['Rareza / Nivel', 'c-rar'], ['Tipo', 'c-who'], ['Atributos', '']],
            s.rows.map((it) => [it.id, '', `${itemCell(it, d.esc(it.name), lvlTxt(it))}<td class="c-rar"><span style="color:${it.rar.c}">${it.rar.n}</span> <span class="mu">· Nv ${itemLevel(it.name)}</span></td><td class="c-who">${SLOT_NAME[it.slot] ?? it.slot}</td><td class="mu">${it.attrs.length ? `${it.attrs.length} atributo${it.attrs.length > 1 ? 's' : ''}` : '—'}</td>`]),
            'La bolsa está vacía: solo se publican armas, armaduras, cascos y anillos de la bolsa.');
        pg.innerHTML = pager(s.page, s.pages, bag.length, ['item', 'items']);
        q<HTMLButtonElement>('#ahPrev').onclick = () => { page.publicar--; render(); };
        q<HTMLButtonElement>('#ahNext').onclick = () => { page.publicar++; render(); };

        q('#ahListCap').innerHTML = `En venta <b>${n} / ${maxL()}</b>`;
        list.innerHTML = n ? mine.listings.map((l) => { const it = d.fromInv(l.item!); return `<button type="button" class="ah-li" data-goto="mias:${l.id}" style="${rc(it)}">${d.icon(it)}<span style="color:${it.rar.c}">${d.esc(it.name)}<small>${d.fmt(l.price)} oro · ${timeLeft(left(l))}</small></span></button>`; }).join('') : `<div class="ah-none">No tenés publicaciones activas.</div>`;

        q('#ahFeatCap').textContent = 'Publicar';
        const it = bag.find((x) => x.id === sel.publicar);
        if (!it) { feat.innerHTML = featEmpty('Elegí un item de tu bolsa en la tabla para publicarlo.'); return; }
        feat.innerHTML = featHead(it, d.esc(it.name), `${lvlTxt(it)} · ${SLOT_NAME[it.slot] ?? it.slot}`) + stats(it)
            + `<form class="pform" id="ahPost"><label>Precio de compra (oro)<input id="ahPrice" type="number" inputmode="numeric" min="${AH_PRICE_MIN}" max="${AH_PRICE_MAX}" step="1" value="${d.esc(price)}" placeholder="Ej.: 1500"></label><div class="fees" id="ahFees" aria-live="polite"></div><div class="ah-acts"><button type="submit" class="ahb" id="ahPostBtn" data-primary>Publicar</button></div></form>`;
        const input = q<HTMLInputElement>('#ahPrice'), fees = q<HTMLElement>('#ahFees'), btn = q<HTMLButtonElement>('#ahPostBtn');
        const upd = () => {
            price = input.value; const p = Number(input.value), valid = Number.isInteger(p) && p >= AH_PRICE_MIN && p <= AH_PRICE_MAX;
            const why = !valid ? '' : d.gold() < ahListingFee(p) ? 'No te alcanza el oro para la tasa.' : n >= maxL() ? `Ya tenés ${maxL()} publicaciones activas.` : '';
            fees.innerHTML = valid ? `<span>Tasa ahora</span><b>−${d.fmt(ahListingFee(p))}</b><span>Comisión al vender</span><b>−${d.fmt(ahCommission(p))}</b><span class="tot">Recibís si se vende</span><b class="tot">${d.fmt(ahSellerNet(p))}</b>${why ? `<span class="ah-warn" style="grid-column:1/-1">${why}</span>` : ''}`
                : `<span>${input.value ? `Precio entre ${AH_PRICE_MIN} y ${d.fmt(AH_PRICE_MAX)}, sin decimales.` : 'Poné un precio.'}</span>`;
            btn.disabled = !valid || !!why;
        };
        input.oninput = upd; upd();
        q<HTMLFormElement>('#ahPost').onsubmit = (e) => {
            e.preventDefault(); const p = Number(input.value);
            if (!Number.isInteger(p) || p < AH_PRICE_MIN || p > AH_PRICE_MAX) { d.toast(`El precio tiene que ser un entero entre ${AH_PRICE_MIN} y ${d.fmt(AH_PRICE_MAX)}.`); return; }
            send('post', { uid: it.id, price: p });
        };
    }

    function renderMine(f: HTMLElement, tw: HTMLElement, pg: HTMLElement, feat: HTMLElement, list: HTMLElement) {
        const ls = mine.listings;
        q('#ahMainCap').innerHTML = `Mis publicaciones <b>${ls.length} / ${maxL()}</b>`;
        const total = ls.reduce((s, l) => s + ahSellerNet(l.price), 0);
        f.innerHTML = `<div class="note">Activas <b>${ls.length} / ${maxL()}</b> · si se vende todo recibís <b>${d.fmt(total)}</b> de oro. Retirar no devuelve la tasa; el item va al buzón.</div>`;
        f.onsubmit = (e) => e.preventDefault();
        if (!ls.some((l) => l.id === sel.mias)) sel.mias = ls[0]?.id ?? 0;
        tw.innerHTML = table('Mis publicaciones', [['Item', ''], ['Rareza / Nivel', 'c-rar'], ['Recibís', 'c-who num'], ['Tiempo restante', ''], ['Precio', 'num']],
            ls.map((l) => { const it = d.fromInv(l.item!), ms = left(l); return [l.id, '', `${itemCell(it, d.esc(it.name), `${lvlTxt(it)} · recibís ${d.fmt(ahSellerNet(l.price))}`)}<td class="c-rar"><span style="color:${it.rar.c}">${it.rar.n}</span> <span class="mu">· Nv ${l.lvl}</span></td><td class="c-who num pos">${d.fmt(ahSellerNet(l.price))}</td><td class="${ms < 3_600_000 ? 'soon' : ''}">${timeLeft(ms)}</td><td class="num">${money(l.price)}</td>`]; }),
            'No tenés publicaciones activas. Publicá algo desde la pestaña Publicar.');
        pg.innerHTML = `<span>${ls.length} publicaci${ls.length === 1 ? 'ón' : 'ones'} activa${ls.length === 1 ? '' : 's'}</span><button type="button" class="ahb sec txt" data-tab="publicar">Publicar otro item</button>`;

        q('#ahListCap').innerHTML = `Por retirar <b>${mine.mail.length}</b>`;
        list.innerHTML = mailList();
        q('#ahFeatCap').textContent = 'Publicación';
        const l = ls.find((x) => x.id === sel.mias);
        if (!l) { feat.innerHTML = featEmpty('Elegí una publicación para verla o retirarla.'); return; }
        const it = d.fromInv(l.item!);
        feat.innerHTML = featHead(it, d.esc(it.name), `${lvlTxt(it)} · ${SLOT_NAME[it.slot] ?? it.slot}`)
            + `<div class="ah-price">${d.fmt(l.price)} ${coin()}</div><div class="ah-state">Recibís <em>${d.fmt(ahSellerNet(l.price))}</em> si se vende (comisión ${d.fmt(ahCommission(l.price))}) · vence en <em>${timeLeft(left(l))}</em></div>${stats(it)}`
            + `<div class="ah-acts"><button type="button" class="ahb" id="ahCancel" data-primary>Retirar publicación</button></div>`;
        q<HTMLButtonElement>('#ahCancel').onclick = () => send('cancel', { listingId: l.id });
    }

    function renderMail(f: HTMLElement, tw: HTMLElement, pg: HTMLElement, feat: HTMLElement, list: HTMLElement) {
        const box = mine.mail, gold = box.reduce((s, m) => s + (m.gold || 0), 0), items = box.filter((m) => m.item).length, free = BAG_MAX - d.bag().length;
        q('#ahMainCap').innerHTML = `Buzón <b>${box.length}</b>`;
        f.innerHTML = `<div class="note">Por retirar: <b>${d.fmt(gold)}</b> de oro y <b>${items}</b> item${items === 1 ? '' : 's'}. Los items necesitan lugar en la bolsa (libres: <b>${Math.max(0, free)}</b>).</div><button type="button" class="ahb" id="ahClaimAll" ${box.length ? '' : 'disabled'}>Retirar todo</button>`;
        f.onsubmit = (e) => e.preventDefault();
        q<HTMLButtonElement>('#ahClaimAll').onclick = () => send('claim', { mailId: 0 });
        if (!box.some((m) => m.id === sel.buzon)) sel.buzon = box[0]?.id ?? 0;
        const s = slice(box, page.buzon); page.buzon = s.page;
        tw.innerHTML = table('Buzón', [['Item', ''], ['Rareza / Nivel', 'c-rar'], ['Transacción', 'c-who'], ['Fecha', ''], ['Monto', 'num']],
            s.rows.map((m) => { const it = m.item ? d.fromInv(m.item) : null; return [m.id, '', `${itemCell(it, it ? d.esc(it.name) : 'Oro', d.esc(m.text))}<td class="c-rar">${it ? `<span style="color:${it.rar.c}">${it.rar.n}</span> <span class="mu">· Nv ${itemLevel(it.name)}</span>` : '<span class="mu">—</span>'}</td><td class="c-who tx">${d.esc(m.text)}</td><td class="dt">${fmtDate(mailWhen(m))}</td>${it ? '<td class="num zero">item</td>' : `<td class="num pos">+${money(m.gold)}</td>`}`]; }),
            'El buzón está vacío. Acá llegan el oro de tus ventas y los items que retirás o que vencen.');
        pg.innerHTML = pager(s.page, s.pages, box.length, ['reclamo', 'reclamos']);
        q<HTMLButtonElement>('#ahPrev').onclick = () => { page.buzon--; render(); };
        q<HTMLButtonElement>('#ahNext').onclick = () => { page.buzon++; render(); };

        q('#ahListCap').innerHTML = `Items por retirar <b>${items}</b>`;
        list.innerHTML = items ? box.filter((m) => m.item).map((m) => { const it = d.fromInv(m.item!); return `<button type="button" class="ah-li${sel.buzon === m.id ? ' sel' : ''}" data-mail="${m.id}" style="${rc(it)}">${d.icon(it)}<span style="color:${it.rar.c}">${d.esc(it.name)}<small>${lvlTxt(it)}</small></span></button>`; }).join('') : `<div class="ah-none">Ningún item por retirar.</div>`;

        q('#ahFeatCap').textContent = 'Reclamo';
        const m = box.find((x) => x.id === sel.buzon);
        if (!m) { feat.innerHTML = featEmpty('Nada por retirar.'); return; }
        const it = m.item ? d.fromInv(m.item) : null;
        feat.innerHTML = (it ? featHead(it, d.esc(it.name), `${lvlTxt(it)} · ${SLOT_NAME[it.slot] ?? it.slot}`) : featHead(null, 'Oro', 'Venta en la casa'))
            + (it ? '' : `<div class="ah-price pos">+${d.fmt(m.gold)} ${coin()}</div>`) + `<div class="ah-state">${d.esc(m.text)} · <em>${fmtDate(mailWhen(m))}</em></div>${it ? stats(it) : ''}`
            + `<div class="ah-acts"><button type="button" class="ahb" id="ahClaim" data-primary ${it && free <= 0 ? 'disabled' : ''}>Retirar</button><button type="button" class="ahb sec" id="ahClaimAll2">Retirar todo</button></div>${it && free <= 0 ? `<div class="ah-warn">La bolsa está llena: hacé lugar para retirar el item.</div>` : ''}`;
        q<HTMLButtonElement>('#ahClaim').onclick = () => send('claim', { mailId: m.id });
        q<HTMLButtonElement>('#ahClaimAll2').onclick = () => send('claim', { mailId: 0 });
    }

    function histFiltered(): AuctionHistoryEntry[] {
        const now = Date.now(), today = new Date(now); today.setHours(0, 0, 0, 0);
        const from = hf.range === 'today' ? today.getTime() : hf.range === '7' ? now - 7 * DAY : hf.range === '30' ? now - 30 * DAY : -Infinity;
        return hist.filter((h) => (!hf.kind || kindOf(h) === hf.kind) && histWhen(h) >= from);
    }
    /** "Compra a Fulano", "Venta a Mengano (comisión 50)", etc. */
    function histText(h: AuctionHistoryEntry): string {
        const k = kindOf(h), who = h.other ? d.esc(h.other) : '';
        switch (k) {
            case 'buy': return `<b>Compra</b>${who ? ` a ${who}` : ''}`;
            case 'sell': return `<b>Venta</b>${who ? ` a ${who}` : ''}${h.fee ? ` <span class="mu">(comisión ${d.fmt(h.fee)})</span>` : ''}`;
            case 'post': return `<b>Publicación</b> a ${d.fmt(h.price)} <span class="mu">(tasa)</span>`;
            case 'cancel': return `<b>Retirada</b> <span class="mu">· al buzón</span>`;
            case 'expire': return `<b>Vencida</b> <span class="mu">· al buzón</span>`;
            default: return `<b>Retiro del buzón</b>`;
        }
    }
    function renderHistory(f: HTMLElement, tw: HTMLElement, pg: HTMLElement, feat: HTMLElement, list: HTMLElement) {
        const rows = histFiltered();
        q('#ahMainCap').innerHTML = `Registro <b>${rows.length}</b>`;
        const kOpts = [['', 'Todas'], ...AH_HIST_KINDS.map((k) => [k, AH_HIST_LABEL[k]])] as [string, string][];
        const net = rows.reduce((s, h) => s + h.amount, 0);
        f.innerHTML = `<label>Transacción<select id="ahHk" class="w-sort">${opt(kOpts, hf.kind)}</select></label><label>Fechas<select id="ahHr" class="w-sort">${opt(RANGE_OPTS, hf.range)}</select></label><div class="note">Balance del período: <b style="color:${net > 0 ? '#9fdc78' : net < 0 ? '#e8806a' : '#f0dca4'}">${signed(net)}</b> de oro. Se guardan tus últimas 200 transacciones.</div>`;
        f.onsubmit = (e) => e.preventDefault();
        q<HTMLSelectElement>('#ahHk').onchange = (e) => { hf.kind = (e.target as HTMLSelectElement).value as '' | AhHistKind; hf.page = 0; render(); };
        q<HTMLSelectElement>('#ahHr').onchange = (e) => { hf.range = (e.target as HTMLSelectElement).value; hf.page = 0; render(); };
        const s = slice(rows, hf.page); hf.page = s.page;
        if (!rows.some((h) => h.id === sel.historial)) sel.historial = s.rows[0]?.id ?? 0;
        tw.innerHTML = !histLoaded ? `<div class="ah-none">Cargando historial…</div>` : table('Historial de transacciones', [['Fecha', ''], ['Item', ''], ['Rareza / Nivel', 'c-rar'], ['Transacción', 'c-who'], ['Monto', 'num']],
            s.rows.map((h) => { const it = h.item ? d.fromInv(h.item) : null; return [h.id, '', `<td class="dt">${fmtDate(histWhen(h))}</td>${itemCell(it, it ? d.esc(it.name) : 'Oro', AH_HIST_LABEL[kindOf(h)] + (h.other ? ` · ${d.esc(h.other)}` : ''))}<td class="c-rar">${it ? `<span style="color:${it.rar.c}">${it.rar.n}</span> <span class="mu">· Nv ${itemLevel(it.name)}</span>` : '<span class="mu">—</span>'}</td><td class="c-who tx">${histText(h)}</td><td class="num ${h.amount > 0 ? 'pos' : h.amount < 0 ? 'neg' : 'zero'}">${h.amount ? `${signed(h.amount)} ${coin()}` : 'item'}</td>`]; }),
            hist.length ? 'No hay transacciones con esos filtros.' : 'Todavía no hiciste ninguna transacción en la casa de subastas.');
        pg.innerHTML = pager(s.page, s.pages, rows.length, ['transacción', 'transacciones']);
        q<HTMLButtonElement>('#ahPrev').onclick = () => { hf.page--; render(); };
        q<HTMLButtonElement>('#ahNext').onclick = () => { hf.page++; render(); };

        q('#ahListCap').innerHTML = `Por retirar <b>${mine.mail.length}</b>`;
        list.innerHTML = mailList();
        q('#ahFeatCap').textContent = 'Transacción';
        const h = hist.find((x) => x.id === sel.historial);
        if (!h) { feat.innerHTML = featEmpty('Elegí una transacción del registro para ver el detalle.'); return; }
        const it = h.item ? d.fromInv(h.item) : null, k = kindOf(h);
        const detail = k === 'buy' ? `Pagaste <em>${d.fmt(h.price)}</em>${h.other ? ` a <em>${d.esc(h.other)}</em>` : ''}.`
            : k === 'sell' ? `Vendido a <em>${d.esc(h.other || 'alguien')}</em> por <em>${d.fmt(h.price)}</em>; comisión <em>${d.fmt(h.fee)}</em>. El oro fue al buzón.`
                : k === 'post' ? `Publicado a <em>${d.fmt(h.price)}</em>; tasa <em>${d.fmt(h.fee)}</em> (no se devuelve).`
                    : k === 'cancel' ? `Retiraste la publicación (a ${d.fmt(h.price)}); el item fue al buzón.`
                        : k === 'expire' ? `Venció a las 48 h (a ${d.fmt(h.price)}); el item fue al buzón.`
                            : it ? 'Retiraste el item del buzón a la bolsa.' : 'Retiraste el oro del buzón.';
        feat.innerHTML = (it ? featHead(it, d.esc(it.name), `${lvlTxt(it)} · ${SLOT_NAME[it.slot] ?? it.slot}`) : featHead(null, 'Oro', AH_HIST_LABEL[k]))
            + (h.amount ? `<div class="ah-price ${h.amount > 0 ? 'pos' : 'neg'}">${signed(h.amount)} ${coin()}</div>` : '')
            + `<div class="ah-state"><em>${AH_HIST_LABEL[k]}</em> · ${fmtDate(histWhen(h))}<br>${detail}</div>${it ? stats(it) : ''}`;
    }

    // ---------- dibujo general ----------
    function render() {
        if (el.hidden) return;
        // conservar el foco (fila, pestaña, botón o campo) a través del redibujo
        const ae = document.activeElement as HTMLElement | null, inside = !!ae && el.contains(ae);
        const fk = inside ? ae!.dataset.fk || (ae!.id ? `#${ae!.id}` : '') : '';
        const caret = inside && ae instanceof HTMLInputElement && ae.type !== 'number' ? ae.selectionStart : null;
        q('#ahGold').textContent = d.fmt(d.gold());
        const counts: Partial<Record<Tab, number>> = { mias: mine.listings.length, buzon: mine.mail.length };
        el.querySelectorAll<HTMLElement>('#ahTabs [data-t]').forEach((b) => {
            const t = b.dataset.t as Tab, on = t === tab, c = counts[t], [lg, sh] = tabLabel[t];
            b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.dataset.fk = `t${t}`;
            const n = c ? ` <i class="n">(${c})</i>` : '';
            b.innerHTML = `<span class="l">${lg}${n}</span><span class="s">${sh}${n}</span>`;
        });
        q('#ahBody').setAttribute('aria-labelledby', `ahTab-${tab}`);
        const f = q<HTMLElement>('#ahFilt'), tw = q<HTMLElement>('#ahTw'), pg = q<HTMLElement>('#ahPg'), feat = q<HTMLElement>('#ahFeat'), list = q<HTMLElement>('#ahList');
        const scroll = tw.scrollTop;
        f.classList.remove('open');
        ({ buscar: renderSearch, publicar: renderPost, mias: renderMine, buzon: renderMail, historial: renderHistory })[tab](f, tw, pg, feat, list);
        tw.scrollTop = scroll;
        // la fila seleccionada (o la primera) es la que recibe Tab
        const rows = [...tw.querySelectorAll<HTMLElement>('tbody tr')];
        (rows.find((r) => r.getAttribute('aria-selected') === 'true') ?? rows[0])?.setAttribute('tabindex', '0');
        if (fk) {
            const t = (fk.startsWith('#') ? qq<HTMLElement>(fk) : qq<HTMLElement>(`[data-fk="${fk}"]`)) ?? (fk.startsWith('r') ? qq<HTMLElement>('tbody tr[tabindex="0"]') : null);
            if (t && !(t as HTMLButtonElement).disabled) { t.focus({ preventScroll: true }); if (caret != null && t instanceof HTMLInputElement) t.setSelectionRange(caret, caret); }
            else if (t instanceof HTMLButtonElement) q<HTMLElement>(`#ahTab-${tab}`).focus({ preventScroll: true });
        }
    }

    function setTab(t: Tab, focus = false) {
        tab = t; render();
        if (t === 'historial' && npc) send('history');
        if (focus) q<HTMLElement>(`#ahTab-${t}`).focus();
    }
    function select(k: number, focusRow = true) {
        sel[tab] = k; render();
        const r = qq<HTMLElement>(`tbody tr[data-k="${k}"]`);
        if (r) { if (focusRow) r.focus({ preventScroll: true }); r.scrollIntoView({ block: 'nearest' }); }
    }

    // pestañas: clic y flechas (patrón de tablist con foco itinerante)
    const tabsEl = q<HTMLElement>('#ahTabs');
    tabsEl.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]'); if (b) setTab(b.dataset.t as Tab); });
    tabsEl.addEventListener('keydown', (e) => {
        const i = TABS.indexOf(tab), n = TABS.length;
        const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
        if (j < 0) return;
        e.preventDefault(); setTab(TABS[j], true);
    });
    // tabla: clic o flechas seleccionan; Enter lleva a la acción principal del destacado
    const tw = q<HTMLElement>('#ahTw');
    tw.addEventListener('click', (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>('tr[data-k]'); if (r) select(Number(r.dataset.k)); });
    tw.addEventListener('keydown', (e) => {
        const r = (e.target as HTMLElement).closest<HTMLElement>('tr[data-k]'); if (!r) return;
        const rows = [...tw.querySelectorAll<HTMLElement>('tbody tr[data-k]')], i = rows.indexOf(r);
        let j = -1;
        if (e.key === 'ArrowDown') j = Math.min(rows.length - 1, i + 1); else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
        else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = rows.length - 1;
        else if (e.key === 'PageDown' || e.key === 'PageUp') { const b = qq<HTMLButtonElement>(e.key === 'PageDown' ? '#ahNext' : '#ahPrev'); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(Number(r.dataset.k), false); const p = qq<HTMLElement>('#ahFeat [data-primary]:not(:disabled), #ahFeat input'); p?.focus(); return; }
        if (j < 0) return;
        e.preventDefault(); select(Number(rows[j].dataset.k));
    });
    // lista de la izquierda
    q<HTMLElement>('#ahList').addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
        if (b.dataset.pick) select(Number(b.dataset.pick), false);
        else if (b.dataset.mail) { sel.buzon = Number(b.dataset.mail); setTab('buzon'); }
        else if (b.dataset.goto) { const [t, k] = b.dataset.goto.split(':'); sel[t as Tab] = Number(k); setTab(t as Tab); }
    });
    q<HTMLElement>('#ahPg').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (b) setTab(b.dataset.tab as Tab); });
    q<HTMLButtonElement>('#ahClose').onclick = () => ui.close();
    // que las teclas dentro de la ventana no muevan al personaje ni disparen atajos (Escape sí sigue: cierra)
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    // el tiempo restante se actualiza solo mientras la ventana está abierta
    setInterval(() => { if (!el.hidden && tab !== 'publicar' && !['INPUT', 'SELECT'].includes(document.activeElement?.tagName ?? '')) render(); }, 30000);

    const ui: AuctionUI = {
        open(n) {
            const was = !el.hidden;
            npc = n; el.hidden = false; el.setAttribute('aria-label', `Casa de subastas · ${n.name}`);
            sel.publicar = 0; price = ''; filt.page = 0;
            render(); send('open');
            if (!was) q<HTMLElement>(`#ahTab-${tab}`).focus({ preventScroll: true });
        },
        close() {
            if (el.hidden) return;
            const had = el.contains(document.activeElement);
            npc = null; el.hidden = true;
            if (had) (document.getElementById('cv') as HTMLElement | null)?.focus({ preventScroll: true });
        },
        get isOpen() { return !el.hidden; },
        onMessage(m) {
            if (m.$case === 'auctionSearchResult') { results = m.value; resultsAt = performance.now(); render(); return true; }
            if (m.$case === 'auctionMyState') {
                const before = mine.listings.length; mine = m.value; mineAt = performance.now(); mineWall = Date.now();
                if (tab === 'publicar' && mine.listings.length > before) { sel.publicar = 0; price = ''; } // se publicó: limpiar
                render(); return true;
            }
            if (m.$case === 'auctionHistory') { hist = m.value.entries; histWall = Date.now(); histLoaded = true; render(); return true; }
            return false;
        },
        refresh() { if (!el.hidden) render(); },
    };
    return ui;
}
