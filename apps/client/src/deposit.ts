/**
 * Ventana del depósito (se abre hablando con el Depositario). Solo vista: el server valida todo (rol y distancia
 * al NPC, propiedad, lugar en destino, montos, topes) y manda el resultado en `econResult` más el estado
 * (`depositState` y `inventoryState`). Ver docs/DEPOSITO.md.
 *
 * Dos grillas lado a lado (Bolsa | Depósito). Mover: arrastrar y soltar, doble clic, Shift+clic, o seleccionar y usar
 * el botón de abajo (también Shift+Enter con el teclado). Las flechas recorren la grilla y Escape cierra.
 */
import { BAG_MAX, DEPOT_SLOTS, DEPOT_STACKS, DEPOT_STACK_BY_ID, DEPOT_STACK_MAX, type AttrId, type Base, type DepotStackDef, type DepotStackId, type KeyId } from '@fdn/world';
import type { DepositState, InvItem } from '@fdn/proto';
import type { Net, ServerPayload } from './net.ts';
import { coinIcon, keyIcon, potionIcon, shardIcon } from './itemicons.ts';

type SendFn = Net['send'];
type Side = 'bag' | 'dep';

/** Lo mínimo que la ventana necesita de un item del cliente (el `Item` de main.ts cumple esto). */
export interface DepItem extends Base { id: number; rar: { n: string; c: string; k: number }; attrs: { id: AttrId; v: number }[] }
export interface DepositDeps<I extends DepItem> {
    send: SendFn;
    bag: () => I[];
    gold: () => number;
    pots: () => { hp: number; mp: number };
    keys: () => Record<KeyId, number>;
    shards: () => Record<KeyId, number>;
    fromInv: (v: InvItem) => I;
    icon: (it: I) => string;
    attrText: (a: { id: AttrId; v: number }) => string;
    esc: (s: string) => string;
    fmt: (n: number) => string;
    /** Pide cerrar (main.ts cierra la "tienda" actual y con eso esta ventana). */
    requestClose: () => void;
}
export interface DepositUI {
    open(npc: { id: string; name: string }): void;
    close(): void;
    readonly isOpen: boolean;
    /** Devuelve true si el mensaje era del depósito. */
    onMessage(m: ServerPayload): boolean;
    /** Resultado de una acción (econResult): se muestra en la ventana si está abierta. */
    onResult(ok: boolean, text: string): void;
    /** Cambió la bolsa, el oro o los consumibles: redibuja. */
    refresh(): void;
}

const CSS = `
#dep.fw{--W:760px;--H:664px;--cs:46px;left:50%;right:auto;top:calc(84px + env(safe-area-inset-top,0px));transform-origin:top center;transform:translateX(-50%) scale(var(--dep-scale,1));padding:52px 14px 18px}
#dep .fw-body{gap:8px}
#dep .dsub{display:flex;align-items:baseline;justify-content:center;gap:8px;margin-top:-4px;font:600 13px/1.2 var(--f-cinzel);color:#cdb98a;letter-spacing:.04em}
#dep .dsub small{font:400 11px var(--f-inter);color:#8d7a52;letter-spacing:.02em}
#dep .dcols{display:grid;grid-template-columns:auto auto;justify-content:space-between;gap:12px;min-height:0;flex:1}
#dep .dpan{display:flex;flex-direction:column;gap:6px;min-height:0;border-radius:4px;outline:2px dashed transparent;outline-offset:2px;transition:outline-color .12s}
#dep .dpan.over{outline-color:#e0b765}
#dep .dt{display:flex;align-items:center;gap:8px;height:24px;font:700 13px/1 var(--f-cinzel);letter-spacing:.12em;color:#ecd39a;text-transform:uppercase;text-shadow:0 1px 0 #000}
#dep .dt .cnt{font:600 12px/1 var(--f-inter);letter-spacing:0;color:#bfae86;font-variant-numeric:tabular-nums}
#dep .dt .cnt.full{color:#ff8a7a}
#dep .dt .fb{margin-left:auto;height:24px;font-size:11px;padding:0 8px}
#dep .dg{display:grid;grid-auto-rows:var(--cs);gap:4px;padding:6px;align-content:start;background:#0a0807;border:1px solid #3a2d19;border-radius:3px;box-shadow:inset 0 0 18px #000;overflow:auto;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#dep .dg.bagg{grid-template-columns:repeat(6,var(--cs))}
#dep .dg.depg{grid-template-columns:repeat(8,var(--cs));flex:none;height:calc(var(--cs) * 6 + 4px * 5 + 14px);box-sizing:border-box}
#dep .dg.bagg,#dep .dg.stk{flex:none}
#dep .dg.stk{grid-template-columns:repeat(6,var(--cs));min-height:calc(var(--cs) + 12px)}
#dep .dg.stk.depstk{grid-template-columns:repeat(8,var(--cs))}
#dep .cl{width:var(--cs);height:var(--cs);cursor:pointer}
#dep .cl.pend{opacity:.45;pointer-events:none}
#dep .cl:focus-visible{outline:2px solid #ffd986;outline-offset:-2px}
#dep .cl .iico{pointer-events:none}
#dep .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#8d7a52}
#dep .help{margin-top:auto;font-size:11px;line-height:1.4;color:#8d7a52}
#dep .help b{color:#bfae86;font-weight:600}
#dep .dsel{display:flex;align-items:center;gap:8px;min-height:40px;padding:4px 8px;background:linear-gradient(#14100c,#0a0807);border:1px solid #4d3b20;border-radius:3px;box-shadow:inset 0 0 12px #000;font-size:12.5px}
#dep .dsel .iico,#dep .dsel img{width:32px;height:32px;flex:none;border-radius:2px}
#dep .dsel .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 13px/1.2 var(--f-cinzel)}
#dep .dsel .nm small{display:block;font:400 10.5px var(--f-inter);color:#8d7a52;text-transform:uppercase;letter-spacing:.06em}
#dep .dsel .empty{flex:1;color:#8d7a52;font-size:12px}
#dep input.num{width:96px;height:30px;box-sizing:border-box;padding:0 8px;font:600 13px var(--f-inter);color:#f0dca4;text-align:right;background:#070605;border:1px solid #6a5028;border-radius:3px;box-shadow:inset 0 0 8px #000;font-variant-numeric:tabular-nums}
#dep input.num:focus{outline:2px solid #ffd986;outline-offset:1px}
#dep .act{height:30px;padding:0 10px;font:600 12px/1 var(--f-cinzel);color:#e6d4a6;background:linear-gradient(#3c0c14,#220509);border:1px solid #a98340;border-radius:3px;white-space:nowrap}
#dep .act:hover:not(:disabled){filter:brightness(1.3)}
#dep .act:disabled{opacity:.45;filter:grayscale(.6);cursor:default}
#dep .gbar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:6px 8px;background:linear-gradient(#14100c,#0a0807);border:1px solid #4d3b20;border-radius:3px;box-shadow:inset 0 0 12px #000}
#dep .gbar .gmid{display:flex;align-items:center;gap:6px}
#dep .gside{display:flex;align-items:center;gap:6px;min-width:0;font:600 13px/1 var(--f-inter);color:#f0dca4;font-variant-numeric:tabular-nums;white-space:nowrap}
#dep .gside.r{justify-content:flex-end}
#dep .gside button{all:unset;cursor:pointer;display:flex;align-items:center;gap:6px;min-width:0;padding:4px 6px;border-radius:3px}
#dep .gside button:hover,#dep .gside button:focus-visible{background:#1d160e;outline:1px solid #6a5028}
#dep .gside span{overflow:hidden;text-overflow:ellipsis}
#dep .gside small{font:400 10.5px var(--f-inter);color:#8d7a52;text-transform:uppercase;letter-spacing:.06em}
#dep .gico{width:22px;height:22px}
#dep .dmsg{min-height:16px;font-size:12px;text-align:center;color:#bfae86;transition:opacity .3s}
#dep .dmsg.err{color:#ff8a7a}
#dep .dmsg.ok{color:#9fd18b}
#deptip{position:fixed;z-index:30;width:220px;pointer-events:none}
#deptip>div{display:grid;gap:5px;padding:10px 12px;font-size:12.5px;color:#d9ccaa;background:linear-gradient(#1b1510,#0c0a08);border:2px solid #6a5028;border-radius:4px;box-shadow:0 0 0 1px #000,0 8px 24px #000c;font-family:var(--f-inter)}
#deptip .iname{font:700 15px/1.2 var(--f-cinzel)}
#deptip .sub{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#9c9170}
#deptip ul{margin:0;padding-left:16px}
#dep.narrow{--W:372px;--cs:36px}
#dep.narrow .dcols{grid-template-columns:1fr;grid-auto-rows:max-content;align-content:start;justify-content:stretch;overflow:auto;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#dep.narrow .dpan{min-height:auto}
#dep.narrow .dsub small{display:none}
#dep.narrow .help{display:none}
#dep.narrow .gbar{grid-template-columns:1fr 1fr}
#dep.narrow .gbar .gmid{grid-column:1 / -1;grid-row:2;justify-content:center}
#dep.narrow .gside.r{justify-content:flex-end}
`;

const STACK_ICON = (d: DepotStackDef): string => (d.kind === 'pot' ? potionIcon(d.ref as 'hp' | 'mp') : d.kind === 'key' ? keyIcon(d.ref) : shardIcon(d.ref));
const STACK_COL: Record<DepotStackDef['kind'], string> = { pot: '#8a3a34', key: '#c9a227', shard: '#6a4aa0' };
const stackRc = (d: DepotStackDef) => (d.id === 'pot_mp' ? '#345a8a' : STACK_COL[d.kind]);
const stackNameCol = (d: DepotStackDef) => (d.kind === 'pot' ? (d.ref === 'hp' ? '#e0524a' : '#4a8fe0') : d.kind === 'key' ? '#ffd24a' : '#b99cff');
/** "1.234.567" o "1234567" -> 1234567 (null si no es un entero positivo). */
export function parseAmount(s: string): number | null {
    const t = s.replace(/[.\s_]/g, '').trim();
    if (!/^\d{1,16}$/.test(t)) return null;
    const n = Number(t);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function createDepositUI<I extends DepItem>(d: DepositDeps<I>): DepositUI {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    const el = document.createElement('div'); el.id = 'dep'; el.className = 'hud fw'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Depósito');
    el.innerHTML = `<svg class="fw-crest" aria-hidden="true"><use href="#fwcrest"/></svg>
<svg class="fw-c tl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c tr" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c bl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c br" aria-hidden="true"><use href="#fwc"/></svg>
<header class="fw-head"><h2>DEPÓSITO</h2><button class="fw-x" id="depClose" type="button" aria-label="Cerrar Depósito">&times;</button></header>
<div class="fw-body">
  <div class="dsub"><span id="depNpc">Depositario</span><small>Lo guardado es de tu cuenta y se retira en cualquier Depositario.</small></div>
  <div class="dcols">
    <section class="dpan" data-side="bag" aria-label="Bolsa">
      <div class="dt">Bolsa <span class="cnt" id="depBagCnt"></span></div>
      <div class="dg bagg" id="depBag" role="grid" aria-label="Bolsa de equipo"></div>
      <div class="lbl">Consumibles y materiales</div>
      <div class="dg stk" id="depBagStk" role="grid" aria-label="Consumibles y materiales de la bolsa"></div>
      <div class="help"><b>Doble clic</b> o <b>Shift+clic</b> mueve al otro lado; también podés <b>arrastrar</b>. Teclado: flechas para recorrer, <b>Shift+Enter</b> mueve, <b>Esc</b> cierra.</div>
    </section>
    <section class="dpan" data-side="dep" aria-label="Depósito">
      <div class="dt">Depósito <span class="cnt" id="depCnt"></span><button type="button" class="fb" id="depSort" aria-label="Ordenar el depósito por tipo y rareza">Ordenar</button></div>
      <div class="dg depg" id="depGrid" role="grid" aria-label="Depósito de equipo"></div>
      <div class="lbl">Consumibles y materiales guardados</div>
      <div class="dg stk depstk" id="depStk" role="grid" aria-label="Consumibles y materiales del depósito"></div>
    </section>
  </div>
  <div class="dsel" id="depSel" aria-live="polite"></div>
  <div class="gbar" role="group" aria-label="Oro">
    <div class="gside"><button type="button" id="depGoldBag" title="Usar todo el oro que llevás"><img class="gico" alt="" src="${coinIcon()}"><span><small>Encima</small><br><b id="depGoldBagN">0</b></span></button></div>
    <div class="gmid"><input class="num" id="depGoldIn" type="text" inputmode="numeric" autocomplete="off" placeholder="Monto" aria-label="Monto de oro"><button type="button" class="act" id="depGoldPut">Depositar →</button><button type="button" class="act" id="depGoldTake">← Retirar</button></div>
    <div class="gside r"><button type="button" id="depGoldDep" title="Usar todo el oro del depósito"><span style="text-align:right"><small>En depósito</small><br><b id="depGoldDepN">0</b></span><img class="gico" alt="" src="${coinIcon()}"></button></div>
  </div>
  <div class="dmsg" id="depMsg" role="status" aria-live="polite"></div>
</div>
<svg class="fw-gem" aria-hidden="true"><use href="#fwgem"/></svg>`;
    document.body.appendChild(el);
    const tipEl = document.createElement('div'); tipEl.id = 'deptip'; tipEl.hidden = true; document.body.appendChild(tipEl);
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;

    let npc: { id: string; name: string } | null = null;
    let st: DepositState = { items: [], gold: 0, stacks: [], capacity: DEPOT_SLOTS, stackMax: DEPOT_STACK_MAX };
    let depItems: I[] = [];
    /** Selección: un item (por id) o un stack, de un lado. */
    let sel: { side: Side; kind: 'item'; id: number } | { side: Side; kind: 'stack'; id: DepotStackId } | null = null;
    /** Pedidos en vuelo (se atenúa la casilla hasta que llega el estado nuevo). */
    const pend = new Set<string>();
    let opSeq = (Math.floor(Math.random() * 0x3fffffff) + 1) >>> 0;
    let msgT: ReturnType<typeof setTimeout> | undefined;
    let qty = '';

    const send = (action: string, extra: Record<string, unknown> = {}) => {
        if (!npc) return;
        opSeq = (opSeq % 0xfffffffe) + 1;
        d.send({ $case: 'depositRequest', value: { npcId: npc.id, action, opId: opSeq, ...extra } });
    };
    const say = (text: string, kind: '' | 'ok' | 'err' = '') => {
        const m = q<HTMLElement>('#depMsg'); m.textContent = text; m.className = 'dmsg' + (kind ? ' ' + kind : '');
        clearTimeout(msgT); if (text) msgT = setTimeout(() => { m.textContent = ''; }, 4500);
    };

    // ---------- cantidades ----------
    const carried = (s: DepotStackDef): number => (s.kind === 'pot' ? d.pots()[s.ref as 'hp' | 'mp'] : (s.kind === 'key' ? d.keys() : d.shards())[s.ref as KeyId]) ?? 0;
    const stored = (id: DepotStackId): number => st.stacks.find((x) => x.id === id)?.qty ?? 0;
    /** Cuánto se puede mover de un stack de un lado al otro, como máximo. */
    const movable = (side: Side, s: DepotStackDef): number => (side === 'bag'
        ? Math.min(carried(s), Math.max(0, (st.stackMax || DEPOT_STACK_MAX) - stored(s.id)))
        : Math.min(stored(s.id), Math.max(0, s.carryMax - carried(s))));

    // ---------- acciones ----------
    function moveItem(side: Side, id: number) {
        const k = `${side}:i:${id}`; if (pend.has(k)) return;
        if (side === 'bag') {
            if (depItems.length >= (st.capacity || DEPOT_SLOTS)) { say(`El depósito está lleno (${st.capacity || DEPOT_SLOTS} / ${st.capacity || DEPOT_SLOTS}).`, 'err'); return; }
            pend.add(k); send('put', { uid: id });
        } else {
            if (d.bag().length >= BAG_MAX) { say(`La bolsa está llena (${BAG_MAX} / ${BAG_MAX}): hacé lugar antes de retirar.`, 'err'); return; }
            pend.add(k); send('take', { uid: id });
        }
        if (sel && sel.kind === 'item' && sel.id === id) sel = null;
        render();
    }
    function moveStack(side: Side, id: DepotStackId, amount?: number) {
        const s = DEPOT_STACK_BY_ID.get(id)!; const max = movable(side, s), n = amount ?? max;
        if (n <= 0 || max <= 0) {
            say(side === 'bag' ? (carried(s) ? `En el depósito no entran más de ${d.fmt(st.stackMax || DEPOT_STACK_MAX)} de ${s.name}.` : `No tenés ${s.name}.`)
                : (stored(s.id) ? `Solo podés llevar ${s.carryMax} de ${s.name}.` : `No hay ${s.name} en el depósito.`), 'err');
            return;
        }
        pend.add(`${side}:s:${id}`); send(side === 'bag' ? 'stack_in' : 'stack_out', { stack: id, amount: n }); render();
    }
    function moveGold(side: Side) {
        const inp = q<HTMLInputElement>('#depGoldIn'), n = parseAmount(inp.value);
        if (n === null) { say('Escribí un monto de oro entero mayor que 0.', 'err'); inp.focus(); return; }
        if (side === 'bag' && n > d.gold()) { say(`No tenés tanto oro: llevás ${d.fmt(d.gold())}.`, 'err'); return; }
        if (side === 'dep' && n > st.gold) { say(`No hay tanto oro en el depósito: hay ${d.fmt(st.gold)}.`, 'err'); return; }
        pend.add('gold'); send(side === 'bag' ? 'gold_in' : 'gold_out', { amount: n }); inp.value = ''; render();
    }

    // ---------- dibujo ----------
    const cellItem = (side: Side, it: I, i: number) => {
        const k = `${side}:i:${it.id}`, isSel = sel?.kind === 'item' && sel.side === side && sel.id === it.id;
        return `<button type="button" class="cl${isSel ? ' sel' : ''}${pend.has(k) ? ' pend' : ''}" draggable="true" data-side="${side}" data-item="${it.id}" data-k="${k}" data-i="${i}" data-r="${it.rar.k}" aria-label="${d.esc(it.name)}, ${it.rar.n}${isSel ? ', seleccionado' : ''}" style="--rc:${it.rar.k ? it.rar.c : '#6b5a3c'}">${d.icon(it)}</button>`;
    };
    const cellStack = (side: Side, s: DepotStackDef, n: number, i: number) => {
        const k = `${side}:s:${s.id}`, isSel = sel?.kind === 'stack' && sel.side === side && sel.id === s.id;
        return `<button type="button" class="cl${isSel ? ' sel' : ''}${pend.has(k) ? ' pend' : ''}" draggable="true" data-side="${side}" data-stack="${s.id}" data-k="${k}" data-i="${i}" aria-label="${d.esc(s.name)}, ${n}${isSel ? ', seleccionado' : ''}" style="--rc:${stackRc(s)}"><img class="iico" alt="" src="${STACK_ICON(s)}"><span class="q">${d.fmt(n)}</span></button>`;
    };
    const empties = (n: number) => Array.from({ length: Math.max(0, n) }, () => `<div class="cl e" aria-hidden="true"></div>`).join('');

    function renderSel() {
        const box = q<HTMLElement>('#depSel');
        if (!sel) { box.innerHTML = `<span class="empty">Tocá un item o un consumible para elegir qué mover.</span>`; return; }
        if (sel.kind === 'item') {
            const s = sel, it = (s.side === 'bag' ? d.bag() : depItems).find((x) => x.id === s.id);
            if (!it) { sel = null; renderSel(); return; }
            box.innerHTML = `${d.icon(it)}<span class="nm" style="color:${it.rar.c}">${d.esc(it.name)}<small>${it.rar.n} · ${it.slot} · ${s.side === 'bag' ? 'en la bolsa' : 'en el depósito'}</small></span><button type="button" class="act" id="depMove">${s.side === 'bag' ? 'Guardar en el depósito →' : '← Retirar a la bolsa'}</button>`;
            q<HTMLButtonElement>('#depMove').onclick = () => moveItem(s.side, s.id);
            return;
        }
        const s = sel, def = DEPOT_STACK_BY_ID.get(s.id)!, have = s.side === 'bag' ? carried(def) : stored(def.id), max = movable(s.side, def);
        if (!have) { sel = null; renderSel(); return; }
        box.innerHTML = `<img alt="" src="${STACK_ICON(def)}"><span class="nm" style="color:${stackNameCol(def)}">${d.esc(def.name)}<small>${s.side === 'bag' ? `llevás ${d.fmt(have)} (máx. ${def.carryMax})` : `guardadas ${d.fmt(have)}`}</small></span>
<input class="num" id="depQty" type="text" inputmode="numeric" autocomplete="off" aria-label="Cantidad" placeholder="Cant." value="${d.esc(qty || String(max || ''))}"><button type="button" class="act" id="depQtyMax" ${max ? '' : 'disabled'}>Máx.</button><button type="button" class="act" id="depMove" ${max ? '' : 'disabled'}>${s.side === 'bag' ? 'Guardar →' : '← Retirar'}</button>`;
        const inp = q<HTMLInputElement>('#depQty');
        inp.oninput = () => { qty = inp.value; };
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q<HTMLButtonElement>('#depMove').click(); } };
        q<HTMLButtonElement>('#depQtyMax').onclick = () => { qty = String(movable(s.side, def)); inp.value = qty; };
        q<HTMLButtonElement>('#depMove').onclick = () => {
            const n = parseAmount(inp.value);
            if (n === null) { say('Escribí una cantidad entera mayor que 0.', 'err'); inp.focus(); return; }
            const m = movable(s.side, def);
            if (n > m) { say(m ? `Podés mover hasta ${d.fmt(m)}.` : s.side === 'bag' ? `En el depósito no entran más de ${d.fmt(st.stackMax || DEPOT_STACK_MAX)}.` : `Solo podés llevar ${def.carryMax} de ${def.name}.`, 'err'); return; }
            qty = ''; moveStack(s.side, s.id, n);
        };
    }

    /** Marca la selección en las casillas existentes y redibuja solo la barra de abajo. */
    function markSel() {
        el.querySelectorAll<HTMLElement>('.cl[data-side]').forEach((c) => {
            const side = c.dataset.side as Side;
            const on = !!sel && sel.side === side && (sel.kind === 'item' ? c.dataset.item === String(sel.id) : c.dataset.stack === sel.id);
            c.classList.toggle('sel', on);
        });
        renderSel();
    }

    function render() {
        if (el.hidden) return;
        const active = document.activeElement as HTMLElement | null;
        const keepFocus = active && el.contains(active) && active.dataset.k ? active.dataset.k : '';
        const typing = active instanceof HTMLInputElement && el.contains(active) ? active.id : '';
        const bag = d.bag(), cap = st.capacity || DEPOT_SLOTS;
        q<HTMLElement>('#depNpc').textContent = npc?.name ?? 'Depositario';
        const bc = q<HTMLElement>('#depBagCnt'); bc.textContent = `${bag.length} / ${BAG_MAX}`; bc.classList.toggle('full', bag.length >= BAG_MAX);
        const dc = q<HTMLElement>('#depCnt'); dc.textContent = `${depItems.length} / ${cap}`; dc.classList.toggle('full', depItems.length >= cap);
        q<HTMLElement>('#depBag').innerHTML = bag.map((it, i) => cellItem('bag', it, i)).join('') + empties(BAG_MAX - bag.length);
        q<HTMLElement>('#depGrid').innerHTML = depItems.map((it, i) => cellItem('dep', it, i)).join('') + empties(cap - depItems.length);
        const bagSt = DEPOT_STACKS.filter((s) => carried(s) > 0), depSt = DEPOT_STACKS.filter((s) => stored(s.id) > 0);
        q<HTMLElement>('#depBagStk').innerHTML = bagSt.map((s, i) => cellStack('bag', s, carried(s), i)).join('') + empties(6 - bagSt.length);
        q<HTMLElement>('#depStk').innerHTML = depSt.map((s, i) => cellStack('dep', s, stored(s.id), i)).join('') + empties(8 - depSt.length);
        q<HTMLElement>('#depGoldBagN').textContent = d.fmt(d.gold());
        q<HTMLElement>('#depGoldDepN').textContent = d.fmt(st.gold);
        q<HTMLButtonElement>('#depGoldPut').disabled = pend.has('gold') || d.gold() <= 0;
        q<HTMLButtonElement>('#depGoldTake').disabled = pend.has('gold') || st.gold <= 0;
        q<HTMLButtonElement>('#depSort').disabled = depItems.length < 2;
        if (typing !== 'depQty') renderSel();
        if (keepFocus) { const f = el.querySelector<HTMLElement>(`[data-k="${keepFocus}"]`); if (f && !typing) f.focus({ preventScroll: true }); }
        if (!tipEl.hidden && tipFor) showTip(tipFor);
    }

    // ---------- tooltip (igual al de la bolsa) ----------
    let tipFor: HTMLElement | null = null;
    function tipHtml(c: HTMLElement): string {
        const side = c.dataset.side as Side;
        if (c.dataset.stack) {
            const s = DEPOT_STACK_BY_ID.get(c.dataset.stack as DepotStackId)!, n = side === 'bag' ? carried(s) : stored(s.id);
            const what = s.kind === 'pot' ? (s.ref === 'hp' ? 'Recupera 40% de la vida máxima: 20% al instante y el resto en 2 s.' : 'Recupera 50% del maná máximo.') : s.kind === 'key' ? 'Abre la escalera sellada del portal correspondiente.' : 'Con 3 esquirlas y oro el Capitán forja la llave.';
            return `<div><div class="iname" style="color:${stackNameCol(s)}">${d.esc(s.name)}</div><div class="sub">${s.kind === 'pot' ? 'Consumible' : 'Material'} · ×${d.fmt(n)}</div><div>${what}</div><div class="sub">${side === 'bag' ? `Encima: máx. ${s.carryMax}` : `En depósito: máx. ${d.fmt(st.stackMax || DEPOT_STACK_MAX)}`}</div></div>`;
        }
        const id = Number(c.dataset.item), it = (side === 'bag' ? d.bag() : depItems).find((x) => x.id === id); if (!it) return '';
        const base: string[] = [];
        if (it.dmg) base.push(`Daño ${it.dmg[0]}–${it.dmg[1]}`); if (it.def) base.push(`Defensa ${it.def}`); if (it.rm) base.push(`Res. mágica ${it.rm}`); if (it.mag) base.push(`+${it.mag} daño mágico`);
        return `<div style="border-color:${it.rar.k ? it.rar.c : '#6b5a3c'}"><div class="iname" style="color:${it.rar.c}">${d.esc(it.name)}</div><div class="sub">${it.rar.n} · ${it.slot}</div>
${base.length ? `<div>${base.join(' · ')}</div>` : ''}
${it.attrs.length ? `<ul>${it.attrs.map((a) => `<li style="color:#8fb6f0">${d.attrText(a)}</li>`).join('')}</ul>` : `<div class="sub">Sin atributos extra</div>`}
<div class="sub">${side === 'bag' ? 'Doble clic: guardar' : 'Doble clic: retirar'}</div></div>`;
    }
    function showTip(c: HTMLElement) {
        if (!c.isConnected) { const k = c.dataset.k; const n = k ? el.querySelector<HTMLElement>(`[data-k="${k}"]`) : null; if (!n) { hideTip(); return; } c = n; }
        const html = tipHtml(c); if (!html) { hideTip(); return; }
        tipFor = c; tipEl.innerHTML = html; tipEl.hidden = false;
        const r = c.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
        let x = r.right + 8, y = r.top;
        if (x + w > innerWidth - 8) x = r.left - w - 8;
        if (x < 8) x = Math.max(8, Math.min(innerWidth - w - 8, r.left));
        if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
        tipEl.style.left = `${Math.round(x)}px`; tipEl.style.top = `${Math.round(y)}px`;
    }
    function hideTip() { tipEl.hidden = true; tipFor = null; }

    // ---------- eventos (delegados: las grillas se redibujan enteras) ----------
    const cellOf = (t: EventTarget | null) => (t instanceof HTMLElement ? t.closest<HTMLElement>('.cl[data-side]') : null);
    const moveCell = (c: HTMLElement) => {
        const side = c.dataset.side as Side;
        if (c.dataset.item) moveItem(side, Number(c.dataset.item)); else if (c.dataset.stack) moveStack(side, c.dataset.stack as DepotStackId);
    };
    el.addEventListener('click', (e) => {
        const c = cellOf(e.target); if (!c) return;
        if (e.shiftKey) { moveCell(c); return; }
        const side = c.dataset.side as Side;
        if (c.dataset.item) { const id = Number(c.dataset.item); sel = sel?.kind === 'item' && sel.side === side && sel.id === id ? sel : { side, kind: 'item', id }; }
        else { const id = c.dataset.stack as DepotStackId; if (!(sel?.kind === 'stack' && sel.id === id && sel.side === side)) qty = ''; sel = { side, kind: 'stack', id }; }
        markSel(); // sin redibujar las grillas: así el doble clic cae sobre la misma casilla
    });
    el.addEventListener('dblclick', (e) => { const c = cellOf(e.target); if (c) { e.preventDefault(); moveCell(c); } });
    el.addEventListener('mouseover', (e) => { const c = cellOf(e.target); if (c && c !== tipFor) showTip(c); });
    el.addEventListener('mouseout', (e) => { const c = cellOf(e.target); if (c && !c.contains(e.relatedTarget as Node | null)) hideTip(); });
    el.addEventListener('focusin', (e) => { const c = cellOf(e.target); if (c) showTip(c); else hideTip(); });
    // arrastrar y soltar entre las dos grillas
    let drag: HTMLElement | null = null;
    el.addEventListener('dragstart', (e) => {
        const c = cellOf(e.target); if (!c || !e.dataTransfer) return;
        drag = c; hideTip(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.k ?? '');
    });
    el.addEventListener('dragend', () => { drag = null; el.querySelectorAll('.dpan.over').forEach((p) => p.classList.remove('over')); });
    el.querySelectorAll<HTMLElement>('.dpan').forEach((pan) => {
        pan.addEventListener('dragover', (e) => { if (drag && drag.dataset.side !== pan.dataset.side) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; pan.classList.add('over'); } });
        pan.addEventListener('dragleave', (e) => { if (!pan.contains(e.relatedTarget as Node | null)) pan.classList.remove('over'); });
        pan.addEventListener('drop', (e) => { e.preventDefault(); pan.classList.remove('over'); if (drag && drag.dataset.side !== pan.dataset.side) moveCell(drag); drag = null; });
    });
    // teclado: que nada llegue a los atajos del juego; flechas en la grilla, Shift+Enter mueve, Escape cierra
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.requestClose(); return; }
        e.stopPropagation();
        const c = cellOf(e.target); if (!c) return;
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); moveCell(c); return; }
        const grid = c.parentElement!, cells = [...grid.querySelectorAll<HTMLElement>('.cl[data-side]')], i = cells.indexOf(c);
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : e.key === 'ArrowUp' ? i - cols : -2;
        if (to === -2) return;
        e.preventDefault();
        if (to >= 0 && to < cells.length) cells[to].focus();
    });
    q<HTMLButtonElement>('#depClose').onclick = () => d.requestClose();
    q<HTMLButtonElement>('#depSort').onclick = () => send('sort');
    q<HTMLButtonElement>('#depGoldPut').onclick = () => moveGold('bag');
    q<HTMLButtonElement>('#depGoldTake').onclick = () => moveGold('dep');
    q<HTMLButtonElement>('#depGoldBag').onclick = () => { const i = q<HTMLInputElement>('#depGoldIn'); i.value = d.gold() > 0 ? String(Math.floor(d.gold())) : ''; i.focus(); };
    q<HTMLButtonElement>('#depGoldDep').onclick = () => { const i = q<HTMLInputElement>('#depGoldIn'); i.value = st.gold > 0 ? String(Math.floor(st.gold)) : ''; i.focus(); };
    q<HTMLInputElement>('#depGoldIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); moveGold(e.shiftKey ? 'dep' : 'bag'); } });

    // ---------- tamaño: dos columnas o apilado, y escala para que entre en pantallas chicas ----------
    function layout() {
        if (el.hidden) return;
        const narrow = innerWidth < 640; el.classList.toggle('narrow', narrow);
        const W = narrow ? 372 : 760, H = 664, top = el.getBoundingClientRect().top;
        const avail = innerHeight - Math.max(40, top) - 16;
        if (narrow) { // apilado: el ancho manda la escala y el alto se ajusta a la pantalla (las grillas se desplazan)
            const s = Math.max(0.6, Math.min(1, (innerWidth - 20) / (W + 20)));
            el.style.setProperty('--dep-scale', s.toFixed(3)); el.style.height = `${Math.floor(avail / s)}px`;
        } else {
            const s = Math.max(0.5, Math.min(1, (innerWidth - 20) / (W + 20), avail / H));
            el.style.setProperty('--dep-scale', s.toFixed(3)); el.style.height = '';
        }
    }
    addEventListener('resize', () => { layout(); hideTip(); });

    const ui: DepositUI = {
        open(n) {
            const again = npc?.id === n.id && !el.hidden;
            npc = n; el.hidden = false;
            if (!again) { sel = null; qty = ''; pend.clear(); say(''); q<HTMLInputElement>('#depGoldIn').value = ''; }
            layout(); render(); send('open');
            if (!again) requestAnimationFrame(() => el.querySelector<HTMLElement>('#depBag .cl[data-side], #depGrid .cl[data-side], #depGoldIn')?.focus({ preventScroll: true }));
        },
        close() {
            if (el.hidden) return;
            npc = null; el.hidden = true; hideTip(); pend.clear();
            if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        },
        get isOpen() { return !el.hidden; },
        onMessage(m) {
            if (m.$case !== 'depositState') return false;
            st = m.value; depItems = st.items.map(d.fromInv); pend.clear();
            if (sel?.kind === 'item' && sel.side === 'dep' && !depItems.some((x) => x.id === sel!.id)) sel = null;
            render(); return true;
        },
        onResult(ok, text) {
            if (el.hidden) return;
            if (!ok) pend.clear();
            if (text) say(text, ok ? 'ok' : 'err');
            render();
        },
        refresh() { if (!el.hidden) { if (sel?.kind === 'item' && sel.side === 'bag' && !d.bag().some((x) => x.id === sel!.id)) sel = null; render(); } },
    };
    return ui;
}
