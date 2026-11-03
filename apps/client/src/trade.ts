/**
 * Dar e Intercambiar entre jugadores (cliente). Solo vista: el server valida todo (rango, nación, propiedad de los items,
 * lugar en las bolsas, topes) y manda el estado en `tradeState` / `tradeInvite` y el resultado en `econResult`.
 * Ver docs/INTERCAMBIO.md.
 *
 * - Menú de jugador (clic derecho sobre un aliado, o clic en su fila de la party): Dar un item, Dar oro, Intercambiar.
 * - Cartel de invitación: Aceptar / Rechazar (vence a los 30 s).
 * - Ventana de intercambio: tu oferta | la oferta del otro, tu bolsa abajo (clic en un item = agregarlo a tu oferta; clic en la oferta = sacarlo),
 *   oro, y Confirmar. Cualquier cambio quita las confirmaciones; lo que el otro agregó después de tu última confirmación se marca "Nuevo".
 */
import type { InvItem, TradeInvite, TradeState } from '@fdn/proto';
import type { Net, ServerPayload } from './net.ts';
import { coinIcon } from './itemicons.ts';
import { parseAmount, type DepItem } from './deposit.ts';

export interface TradeDeps<I extends DepItem> {
    send: Net['send'];
    bag: () => I[];
    gold: () => number;
    fromInv: (v: InvItem) => I;
    icon: (it: I) => string;
    attrText: (a: { id: I['attrs'][number]['id']; v: number }) => string;
    esc: (s: string) => string;
    fmt: (n: number) => string;
    toast: (t: string) => void;
}
export interface TradeTarget { id: bigint; name: string }
export interface TradeUI {
    readonly isOpen: boolean;
    /** Mensajes del protocolo; devuelve true si era de Dar / Intercambiar. */
    onMessage(m: ServerPayload): boolean;
    /** Menú Dar / Intercambiar sobre un jugador, en la posición de pantalla dada. */
    menuFor(t: TradeTarget, x: number, y: number): void;
    /** Cambió la bolsa o el oro: redibuja lo que esté abierto. */
    refresh(): void;
    close(): void;
}

const CSS = `
#trade.fw{--W:660px;--H:600px;--cs:44px;left:50%;right:auto;top:calc(84px + env(safe-area-inset-top,0px));transform-origin:top center;transform:translateX(-50%) scale(var(--win-scale,1));padding:52px 14px 18px}
#trade .fw-body{gap:8px}
#trade .tcols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
#trade .tpan{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid #3a2d19;border-radius:4px;background:#0a0807;box-shadow:inset 0 0 18px #000}
#trade .tpan.ok{border-color:#6c9a4c;box-shadow:inset 0 0 18px #000,0 0 8px #6c9a4c66}
#trade .tt{display:flex;align-items:center;justify-content:space-between;font:700 13px/1 var(--f-cinzel);letter-spacing:.1em;color:#ecd39a;text-transform:uppercase}
#trade .tt small{font:600 11px var(--f-inter);letter-spacing:0;text-transform:none;color:#8d7a52}
#trade .tt small.ok{color:#9fd18b}
#trade .tg{display:grid;grid-template-columns:repeat(4,var(--cs));gap:4px;justify-content:center}
#trade .tg.bag{grid-template-columns:repeat(9,var(--cs));max-height:calc(var(--cs) * 2 + 12px);overflow:auto;padding:4px;background:#0a0807;border:1px solid #3a2d19;border-radius:3px;box-shadow:inset 0 0 14px #000;scrollbar-width:thin;scrollbar-color:#5d4725 #0a0807}
#trade .cl{width:var(--cs);height:var(--cs);cursor:pointer}
#trade .cl.e{cursor:default}
#trade .cl.theirs{cursor:default}
#trade .cl .nw{position:absolute;left:0;top:0;padding:1px 3px;font:700 9px/1 var(--f-inter);color:#101;background:#ffd24a;border-bottom-right-radius:3px}
#trade .tgold{display:flex;align-items:center;gap:6px;font:600 13px var(--f-inter);color:#f0dca4;font-variant-numeric:tabular-nums}
#trade .tgold img{width:20px;height:20px}
#trade input.num{width:110px;height:28px;box-sizing:border-box;padding:0 8px;font:600 13px var(--f-inter);color:#f0dca4;text-align:right;background:#070605;border:1px solid #6a5028;border-radius:3px;box-shadow:inset 0 0 8px #000}
#trade .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#8d7a52}
#trade .act{height:30px;padding:0 12px;font:600 12px/1 var(--f-cinzel);color:#e6d4a6;background:linear-gradient(#3c0c14,#220509);border:1px solid #a98340;border-radius:3px;white-space:nowrap;cursor:pointer}
#trade .act:hover:not(:disabled){filter:brightness(1.3)}
#trade .act:disabled{opacity:.45;cursor:default}
#trade .act.go{background:linear-gradient(#2f5a2a,#17300f);border-color:#6c9a4c}
#trade .tbar{display:flex;justify-content:space-between;align-items:center;gap:8px}
#trade .tmsg{min-height:16px;font-size:12px;text-align:center;color:#bfae86}
#trade .tmsg.err{color:#ff8a7a}
#trade .help{font-size:11px;line-height:1.4;color:#8d7a52}
#give.fw{--W:420px;--H:430px;--cs:40px;left:50%;right:auto;top:calc(110px + env(safe-area-inset-top,0px));transform-origin:top center;transform:translateX(-50%) scale(var(--win-scale,1));padding:52px 14px 18px}
#give .tg.bag{display:grid;grid-template-columns:repeat(7,var(--cs));gap:4px;justify-content:center;max-height:calc(var(--cs) * 3 + 16px);overflow:auto;padding:4px;background:#0a0807;border:1px solid #3a2d19;border-radius:3px}
#give .cl{width:var(--cs);height:var(--cs);cursor:pointer}
#give .cl.sel{outline:2px solid #ffd986;outline-offset:-2px}
#give .row{display:flex;align-items:center;gap:8px;justify-content:center}
#give input.num{width:120px;height:28px;box-sizing:border-box;padding:0 8px;font:600 13px var(--f-inter);color:#f0dca4;text-align:right;background:#070605;border:1px solid #6a5028;border-radius:3px}
#give .act{height:30px;padding:0 12px;font:600 12px/1 var(--f-cinzel);color:#e6d4a6;background:linear-gradient(#3c0c14,#220509);border:1px solid #a98340;border-radius:3px;cursor:pointer}
#give .act:disabled{opacity:.45;cursor:default}
#give .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#8d7a52;text-align:center}
#give .tmsg{min-height:16px;font-size:12px;text-align:center;color:#ff8a7a}
#tradeInvite{top:150px;right:max(20px,env(safe-area-inset-right,0px));width:250px;background:var(--panel);border:1px solid rgba(214,164,69,.55);border-radius:4px;padding:10px 12px;font-size:13px;color:var(--text);pointer-events:auto;z-index:6}
#tradeInvite p{margin:0 0 8px}
#tradeInvite b{color:var(--brass)}
#tradeInvite .pib{display:flex;gap:8px}
#tradeInvite button{flex:1;padding:5px 0;border-radius:3px;font:inherit;font-size:12px;cursor:pointer;color:#f2ead2}
#tradeInvite .ok{background:#2f5a2a;border:1px solid #6c9a4c}
#tradeInvite .no{background:#5a2420;border:1px solid #93463c}
#tradeInvite .pit{height:3px;background:rgba(255,255,255,.08);margin-top:8px}
#tradeInvite .pit i{display:block;height:100%;width:100%;background:var(--brass);transition:width linear}
#tradeMenu{position:fixed;z-index:30;min-width:170px;padding:4px;background:linear-gradient(#1b1510,#0c0a08);border:2px solid #6a5028;border-radius:4px;box-shadow:0 0 0 1px #000,0 8px 24px #000c;font-family:var(--f-inter)}
#tradeMenu .mh{padding:4px 8px 6px;font:700 12px var(--f-cinzel);color:#ecd39a;border-bottom:1px solid #3a2d19;margin-bottom:3px}
#tradeMenu button{display:block;width:100%;text-align:left;padding:6px 8px;font:600 12.5px var(--f-inter);color:#e6d4a6;background:none;border:0;border-radius:3px;cursor:pointer}
#tradeMenu button:hover,#tradeMenu button:focus-visible{background:#2a1d10;outline:none}
`;

const FRAME = (id: string, title: string) => `<svg class="fw-crest" aria-hidden="true"><use href="#fwcrest"/></svg>
<svg class="fw-c tl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c tr" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c bl" aria-hidden="true"><use href="#fwc"/></svg><svg class="fw-c br" aria-hidden="true"><use href="#fwc"/></svg>
<header class="fw-head"><h2>${title}</h2><button class="fw-x" id="${id}Close" type="button" aria-label="Cerrar">&times;</button></header>`;

export function createTradeUI<I extends DepItem>(d: TradeDeps<I>): TradeUI {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    let opSeq = 0;
    const tx = (action: string, extra: Record<string, unknown> = {}) => { opSeq = (opSeq % 0xfffffffe) + 1; d.send({ $case: 'tradeRequest', value: { action, targetId: 0n, uid: 0, amount: 0, opId: opSeq, ...extra } } as Parameters<Net['send']>[0]); };

    // ---------- ventana de intercambio ----------
    const win = document.createElement('div'); win.id = 'trade'; win.className = 'hud fw'; win.hidden = true; win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', 'Intercambio');
    win.innerHTML = `${FRAME('trade', 'INTERCAMBIO')}<div class="fw-body">
  <div class="tcols">
    <section class="tpan" id="tMine"><div class="tt"><span>Tu oferta</span><small id="tMineSt"></small></div><div class="tg" id="tMineG"></div>
      <div class="tgold"><img alt="" src="${coinIcon()}"><input class="num" id="tGoldIn" inputmode="numeric" placeholder="Oro" aria-label="Oro que ofrecés"><button type="button" class="act" id="tGoldSet">Fijar</button></div></section>
    <section class="tpan" id="tTheirs"><div class="tt"><span id="tPartner">Oferta del otro</span><small id="tTheirsSt"></small></div><div class="tg" id="tTheirsG"></div>
      <div class="tgold"><img alt="" src="${coinIcon()}"><b id="tTheirsGold">0</b></div></section>
  </div>
  <div class="lbl">Tu bolsa — clic en un item para ofrecerlo</div>
  <div class="tg bag" id="tBag"></div>
  <div class="tmsg" id="tMsg"></div>
  <div class="tbar"><div class="help">Cualquier cambio quita las confirmaciones. Lo que el otro agrega después de que confirmaste aparece como <b>Nuevo</b>.</div>
    <div style="display:flex;gap:8px"><button type="button" class="act go" id="tConfirm">Confirmar</button><button type="button" class="act" id="tCancel">Cancelar</button></div></div>
</div><svg class="fw-gem" aria-hidden="true"><use href="#fwgem"/></svg>`;
    document.body.appendChild(win);
    const w = <T extends HTMLElement>(sel: string) => win.querySelector<T>(sel)!;

    let st: TradeState | null = null; let mine: I[] = [], theirs: I[] = [];
    const cell = (it: I, cls: string, extra = '') => `<button type="button" class="cl ${cls}" data-id="${it.id}" data-r="${it.rar.k}" title="${d.esc(`${it.name} · ${it.rar.n}${it.attrs.length ? '\n' + it.attrs.map(d.attrText).join('\n') : ''}`)}" aria-label="${d.esc(it.name)}, ${it.rar.n}" style="--rc:${it.rar.k ? it.rar.c : '#6b5a3c'}">${d.icon(it)}${extra}</button>`;
    const empties = (n: number) => Array.from({ length: Math.max(0, n) }, () => '<div class="cl e" aria-hidden="true"></div>').join('');
    const say = (text: string, err = false) => { const m = w<HTMLElement>('#tMsg'); m.textContent = text; m.className = 'tmsg' + (err ? ' err' : ''); };

    function render(): void {
        if (!st || !st.open) return;
        const newSet = new Set(st.theirsNew);
        w<HTMLElement>('#tPartner').textContent = st.partner || 'Oferta del otro';
        const slots = 8;
        w<HTMLElement>('#tMineG').innerHTML = mine.map((it) => cell(it, 'mine')).join('') + empties(slots - mine.length);
        w<HTMLElement>('#tTheirsG').innerHTML = theirs.map((it) => cell(it, 'theirs', newSet.has(it.id) ? '<span class="nw">Nuevo</span>' : '')).join('') + empties(slots - theirs.length);
        w<HTMLElement>('#tTheirsGold').textContent = d.fmt(st.theirGold);
        const input = w<HTMLInputElement>('#tGoldIn'); if (document.activeElement !== input) input.value = st.myGold ? String(st.myGold) : '';
        w<HTMLElement>('#tMine').classList.toggle('ok', st.myConfirmed); w<HTMLElement>('#tTheirs').classList.toggle('ok', st.theirConfirmed);
        const lab = (el: string, okv: boolean) => { const s = w<HTMLElement>(el); s.textContent = okv ? 'Confirmó ✓' : 'Sin confirmar'; s.className = okv ? 'ok' : ''; };
        lab('#tMineSt', st.myConfirmed); lab('#tTheirsSt', st.theirConfirmed);
        const inOffer = new Set(mine.map((x) => x.id));
        w<HTMLElement>('#tBag').innerHTML = d.bag().filter((it) => !inOffer.has(it.id)).map((it) => cell(it, 'b')).join('');
        w<HTMLButtonElement>('#tConfirm').disabled = st.myConfirmed || (!mine.length && !theirs.length && !st.myGold && !st.theirGold);
        w<HTMLButtonElement>('#tConfirm').textContent = st.myConfirmed ? 'Esperando…' : 'Confirmar';
    }
    const clear = () => { st = null; mine = []; theirs = []; win.hidden = true; say(''); };
    const hideWin = () => { if (!win.hidden) tx('cancel'); clear(); };

    w<HTMLElement>('#tradeClose').onclick = hideWin; w<HTMLElement>('#tCancel').onclick = hideWin;
    w<HTMLElement>('#tConfirm').onclick = () => tx('confirm');
    const setGold = () => {
        const raw = w<HTMLInputElement>('#tGoldIn').value.trim();
        if (!raw || raw === '0') { tx('gold', { amount: 0 }); return; }
        const n = parseAmount(raw);
        if (n === null) { say('Escribí un monto de oro entero.', true); return; }
        if (n > d.gold()) { say(`No tenés tanto oro: llevás ${d.fmt(d.gold())}.`, true); return; }
        tx('gold', { amount: n });
    };
    w<HTMLElement>('#tGoldSet').onclick = setGold;
    w<HTMLInputElement>('#tGoldIn').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setGold(); } e.stopPropagation(); };
    win.addEventListener('click', (e) => {
        const c = (e.target as HTMLElement).closest<HTMLElement>('.cl[data-id]'); if (!c) return;
        const id = Number(c.dataset.id);
        if (c.classList.contains('b')) { if (mine.length >= 8) { say('Solo entran 8 items por lado.', true); return; } tx('add', { uid: id }); }
        else if (c.classList.contains('mine')) tx('remove', { uid: id });
    });
    win.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hideWin(); } });

    // ---------- Dar (elegir item u oro) ----------
    const giveEl = document.createElement('div'); giveEl.id = 'give'; giveEl.className = 'hud fw'; giveEl.hidden = true; giveEl.setAttribute('role', 'dialog'); giveEl.setAttribute('aria-label', 'Dar');
    giveEl.innerHTML = `${FRAME('give', 'DAR')}<div class="fw-body">
  <div class="lbl" id="gTo"></div>
  <div class="lbl">Un item de tu bolsa</div><div class="tg bag" id="gBag"></div>
  <div class="row"><button type="button" class="act" id="gItem" disabled>Dar el item elegido</button></div>
  <div class="lbl">o una cantidad de oro</div>
  <div class="row"><input class="num" id="gGold" inputmode="numeric" placeholder="Oro" aria-label="Oro para dar"><button type="button" class="act" id="gGoldGo">Dar oro</button></div>
  <div class="tmsg" id="gMsg"></div>
  <div class="lbl" style="text-transform:none;letter-spacing:0">La otra persona tiene que aceptar. Dar tiene tope diario; para cambiar cosas usá Intercambiar.</div>
</div><svg class="fw-gem" aria-hidden="true"><use href="#fwgem"/></svg>`;
    document.body.appendChild(giveEl);
    const g = <T extends HTMLElement>(sel: string) => giveEl.querySelector<T>(sel)!;
    let giveTo: TradeTarget | null = null; let giveSel = 0;
    function renderGive(): void {
        if (giveEl.hidden || !giveTo) return;
        g<HTMLElement>('#gTo').textContent = `Para: ${giveTo.name}`;
        const bag = d.bag(); if (giveSel && !bag.some((x) => x.id === giveSel)) giveSel = 0;
        g<HTMLElement>('#gBag').innerHTML = bag.map((it) => cell(it, giveSel === it.id ? 'sel' : '')).join('') || '<div class="lbl">La bolsa está vacía.</div>';
        g<HTMLButtonElement>('#gItem').disabled = !giveSel;
    }
    const closeGive = () => { giveEl.hidden = true; giveTo = null; giveSel = 0; g<HTMLElement>('#gMsg').textContent = ''; };
    g<HTMLElement>('#giveClose').onclick = closeGive;
    giveEl.addEventListener('click', (e) => { const c = (e.target as HTMLElement).closest<HTMLElement>('.cl[data-id]'); if (c) { giveSel = Number(c.dataset.id); renderGive(); } });
    g<HTMLElement>('#gItem').onclick = () => { if (giveTo && giveSel) { tx('give', { targetId: giveTo.id, uid: giveSel }); closeGive(); } };
    const giveGold = () => {
        if (!giveTo) return; const n = parseAmount(g<HTMLInputElement>('#gGold').value), m = g<HTMLElement>('#gMsg');
        if (n === null) { m.textContent = 'Escribí un monto de oro entero mayor que 0.'; return; }
        if (n > d.gold()) { m.textContent = `No tenés tanto oro: llevás ${d.fmt(d.gold())}.`; return; }
        tx('give', { targetId: giveTo.id, amount: n }); g<HTMLInputElement>('#gGold').value = ''; closeGive();
    };
    g<HTMLElement>('#gGoldGo').onclick = giveGold;
    g<HTMLInputElement>('#gGold').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); giveGold(); } e.stopPropagation(); };
    giveEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeGive(); } });

    // ---------- invitación ----------
    const inv = document.createElement('div'); inv.id = 'tradeInvite'; inv.className = 'hud'; inv.hidden = true; inv.setAttribute('role', 'alertdialog'); inv.setAttribute('aria-label', 'Invitación de intercambio');
    document.body.appendChild(inv);
    let invTimer = 0;
    const hideInvite = () => { clearTimeout(invTimer); inv.hidden = true; };
    function showInvite(v: TradeInvite): void {
        if (!v.kind) { hideInvite(); return; }
        const ms = Math.max(1000, Math.min(30_000, Number(v.expiresMs) - Date.now() || 30_000));
        const what = v.kind === 'give' ? (v.item ? `darte <b>${d.esc(v.item.base)}</b>${v.item.up ? ` +${v.item.up}` : ''}` : `darte <b>${d.fmt(v.gold)}</b> de oro`) : 'intercambiar con vos';
        inv.innerHTML = `<p><b>${d.esc(v.fromName)}</b> quiere ${what}.</p><div class="pib"><button type="button" class="ok">Aceptar</button><button type="button" class="no">Rechazar</button></div><div class="pit"><i></i></div>`;
        const bar = inv.querySelector<HTMLElement>('.pit i')!; bar.style.transitionDuration = ms + 'ms';
        inv.querySelector<HTMLElement>('.ok')!.onclick = () => { tx('accept'); hideInvite(); };
        inv.querySelector<HTMLElement>('.no')!.onclick = () => { tx('decline'); hideInvite(); };
        inv.hidden = false; void bar.offsetWidth; bar.style.width = '0%';
        clearTimeout(invTimer); invTimer = window.setTimeout(hideInvite, ms);
    }

    // ---------- menú sobre un jugador ----------
    const menu = document.createElement('div'); menu.id = 'tradeMenu'; menu.hidden = true; document.body.appendChild(menu);
    const hideMenu = () => { menu.hidden = true; };
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target as Node)) hideMenu(); }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
    function menuFor(t: TradeTarget, x: number, y: number): void {
        menu.innerHTML = `<div class="mh">${d.esc(t.name)}</div><button type="button" data-a="ex">Intercambiar</button><button type="button" data-a="gi">Dar un item…</button><button type="button" data-a="go">Dar oro…</button>`;
        menu.onclick = (e) => {
            const a = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.a; if (!a) return;
            hideMenu();
            if (a === 'ex') tx('offer', { targetId: t.id });
            else { giveTo = t; giveSel = 0; giveEl.hidden = false; renderGive(); g<HTMLInputElement>('#gGold').focus(); }
        };
        menu.hidden = false;
        menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
    }

    return {
        get isOpen() { return !win.hidden; },
        onMessage(m) {
            if (m.$case === 'tradeState') {
                const s = m.value;
                if (!s.open) { const was = !win.hidden; clear(); if (was && s.reason) d.toast(s.reason); return true; }
                st = s; mine = s.mine.map(d.fromInv); theirs = s.theirs.map(d.fromInv);
                if (win.hidden) { win.hidden = false; hideInvite(); closeGive(); }
                render(); return true;
            }
            if (m.$case === 'tradeInvite') { showInvite(m.value); return true; }
            return false;
        },
        menuFor,
        refresh() { if (!win.hidden) render(); renderGive(); },
        close() { hideMenu(); hideInvite(); closeGive(); clear(); },
    };
}
