// Libro de hechizos (tecla P): pestaña Habilidades (lista con ícono, nombre, qué hace, costo y nivel) y pestaña
// Progresión (árbol de desbloqueo del kit por nivel). La pestaña Talentos de verdad (puntos y rangos) llega con el rebirth, después de la beta.
// Los textos salen de kits-de-clase.md; los números de maná, recarga y tecla vienen de la lista viva de hechizos del cliente.
import { skillLevel } from '@fdn/world';
import { spellIcon } from './icons.ts';

/** Qué hace cada habilidad, en una o dos frases (sin números que cambien con el balance: esos salen del hechizo). */
export const SKILL_DESC: Record<string, { kind: 'daño' | 'control' | 'cura' | 'defensa' | 'utilidad' | 'buff'; text: string }> = {
    ataque: { kind: 'daño', text: 'Golpe básico con el arma. Sin costo de maná.' },
    // Paladín
    golpe: { kind: 'daño', text: 'Golpe de arma cuerpo a cuerpo. Pega más con armas lentas y pesadas.' },
    juicio: { kind: 'daño', text: 'Golpe sagrado a corta distancia que te devuelve la mitad del daño como vida. Pega más fuerte a un enemigo aturdido y genera el triple de amenaza.' },
    giro: { kind: 'daño', text: 'Dos barridos que pegan a todos los enemigos alrededor. Triple de amenaza.' },
    escudo: { kind: 'control', text: 'Arrojás el escudo: daño alto y aturde unos segundos. La mayor amenaza del kit; corta el casteo de un jefe.' },
    mandato: { kind: 'control', text: 'Provocación: todos los monstruos cerca te atacan a vos durante unos segundos.' },
    aturdir: { kind: 'control', text: 'Martillo de justicia: daño leve, aturde y provoca al objetivo. Los jefes no se aturden, pero se les corta el casteo.' },
    aura: { kind: 'daño', text: 'Aura sagrada: pulsos de daño a los enemigos pegados a vos durante unos segundos, y te cura con cada pulso.' },
    escudodivino: { kind: 'defensa', text: 'Escudo divino: absorbe daño por un porcentaje grande de tu vida durante 10 s.' },
    carga: { kind: 'control', text: 'Carga sagrada: embestís a un enemigo lejano, le pegás y lo aturdís un instante. Tu forma de cerrar distancia en PvP.' },
    represalia: { kind: 'defensa', text: 'Aura de represalia: durante 10 s devolvés parte del daño a los monstruos y recibís menos daño.' },
    grito: { kind: 'buff', text: 'Bendición de poder: más daño para vos y los aliados cerca. Dura 15 min fuera de la arena.' },
    amparo: { kind: 'buff', text: 'Bendición de amparo: menos daño recibido para vos y los aliados cerca. Dura 15 min fuera de la arena.' },
    // Mago
    proyectil: { kind: 'daño', text: 'Saeta ígnea: tu proyectil básico de fuego. Más rápido o más fuerte según el bastón.' },
    esquirla: { kind: 'daño', text: 'Esquirla de hielo: daño y frena al objetivo. Pega el doble sobre un enemigo enraizado o congelado.' },
    paralisis: { kind: 'control', text: 'Cadenas de hielo: congela al objetivo varios segundos. Se rompe si lo golpean fuerte.' },
    nova: { kind: 'control', text: 'Nova de escarcha: daño y congela por un momento a todos los enemigos pegados a vos. Tu salida cuando te rodean.' },
    ignicion: { kind: 'daño', text: 'Ignición: daño instantáneo y quemadura que sigue haciendo daño unos segundos.' },
    bola: { kind: 'daño', text: 'Bola de fuego: tu golpe más fuerte, con casteo largo. Pega más sobre un enemigo que ya está quemado.' },
    lluvia: { kind: 'daño', text: 'Infierno: fuego en el piso que quema a todo lo que esté en el área.' },
    escudomana: { kind: 'defensa', text: 'Escudo de maná: absorbe daño por un tercio de tu vida durante 10 s.' },
    blink: { kind: 'utilidad', text: 'Parpadeo: te teletransportás unas celdas hacia donde apuntás. Rompe raíces, congelados y aturdidos. Tu escape.' },
    clarividencia: { kind: 'buff', text: 'Clarividencia: mucho más crítico de hechizos durante 10 s.' },
    remover: { kind: 'utilidad', text: 'Purga: te sacás aturdido, enraizado, congelado, frenado y silencio.' },
    intelecto: { kind: 'buff', text: 'Intelecto arcano: más Magia para vos y los aliados cerca. Dura 15 min fuera de la arena.' },
    // Healer
    castigo: { kind: 'daño', text: 'Castigo: proyectil sagrado que te cura parte del daño que hace. Pega más a un aturdido. Es lo que te deja farmear solo.' },
    curacion: { kind: 'cura', text: 'Curación: cura grande a un aliado (o a vos) con casteo. Tu cura principal.' },
    renovar: { kind: 'cura', text: 'Renovar: cura en el tiempo durante 12 s sobre un aliado; no se vuelve a aplicar hasta que termina. Sobre un enemigo, quemadura.' },
    bendicion: { kind: 'buff', text: 'Bendición sagrada: durante 10 s el objetivo recibe menos daño, más curación y es inmune a raíz, congelado, aturdido, empuje y tirón.' },
    novasagrada: { kind: 'daño', text: 'Nova sagrada: daño a todos los enemigos cerca y te cura parte del daño hecho.' },
    reprender: { kind: 'control', text: 'Reprender: daño leve y aturde al objetivo. Corta el casteo de un jefe en su ventana.' },
    orbe: { kind: 'cura', text: 'Orbe sagrado: cura al objetivo y a los aliados que tenga al lado.' },
    guardian: { kind: 'defensa', text: 'Escudo guardián: le ponés a un aliado un escudo por un buen porcentaje de su vida durante 10 s.' },
    pasoluz: { kind: 'utilidad', text: 'Paso de luz: te desplazás unas celdas hacia donde apuntás y te sacás el frenado. Tu escape.' },
    despertar: { kind: 'cura', text: 'Despertar: revivís a un aliado caído con la mitad de la vida. En dungeon o arena, solo dentro de los 10 s de la caída.' },
    esfera: { kind: 'cura', text: 'Esfera celestial: una cura que salta varias veces entre los aliados cercanos.' },
    grupo: { kind: 'buff', text: 'Bendición de grupo: más Vitalidad y Magia para vos y los aliados cerca. Dura 15 min fuera de la arena.' },
    // Comunes
    furia: { kind: 'buff', text: 'Furia: más daño durante 60 s. Recarga larga.' },
    aliento: { kind: 'cura', text: 'Segundo aliento: 3 s quieto y recuperás mucha vida y maná. Lo corta cualquier golpe directo, aturdido, empuje o tirón.' },
    invisibilidad: { kind: 'utilidad', text: 'Invisibilidad: dejás de verte para escapar de una pelea perdida. Se corta al atacar, castear o recibir daño; los mobs que ya te tenían no te pierden.' },
    detectar: { kind: 'utilidad', text: 'Detectar: revela a los invisibles cercanos. Recarga corta, para que siempre haya respuesta.' },
    recall: { kind: 'utilidad', text: 'Volver a la ciudad: tarda 8 s quieto y se corta si te pegan. Bloqueado 10 s después de recibir daño de un jugador.' },
};

/** Habilidades comunes a todas las clases: van al final de cada fila para que las del kit se lean primero. */
const COMMON = new Set(['ataque', 'furia', 'aliento', 'remover', 'invisibilidad', 'detectar', 'recall']);
const byKit = (a: BookSpell, b: BookSpell) => Number(COMMON.has(a.id)) - Number(COMMON.has(b.id));
const KIND_LABEL: Record<string, string> = { daño: 'Daño', control: 'Control', cura: 'Curación', defensa: 'Defensa', utilidad: 'Utilidad', buff: 'Bendición' };

/** Lo que el libro necesita de cada hechizo de la barra. */
export interface BookSpell { id: string; name: string; mp: number; cd: number; col: string; key: string; range: number; castT?: number; instant?: boolean }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmtCd = (cd: number) => (cd >= 60 ? `${Math.round(cd / 60)} min` : `${cd % 1 ? cd.toFixed(1) : cd} s`);

/** Pestaña Habilidades: una fila por hechizo, ordenadas por nivel de desbloqueo; las bloqueadas, apagadas y con el nivel que piden. */
export function bookListHtml(cls: string, lvl: number, spells: BookSpell[]): string {
    const rows = spells.map((s) => ({ s, nv: skillLevel(cls, s.id) ?? 1 })).sort((a, b) => a.nv - b.nv || byKit(a.s, b.s) || a.s.name.localeCompare(b.s.name));
    return rows.map(({ s, nv }) => {
        const d = SKILL_DESC[s.id], locked = nv > lvl;
        const meta = [s.mp > 0 ? `${s.mp} maná` : 'sin maná', s.cd > 0 ? `recarga ${fmtCd(s.cd)}` : '', s.castT ? `casteo ${s.castT} s` : s.instant ? 'instantáneo' : ''].filter(Boolean).join(' · ');
        return `<div class="bk-row${locked ? ' locked' : ''}" data-spell="${s.id}">
  <span class="bk-ic"><img alt="" src="${spellIcon(s.id, s.col)}"></span>
  <div class="bk-txt"><b>${esc(s.name)}</b><i>${d ? KIND_LABEL[d.kind] : ''}${meta ? ` · ${meta}` : ''}</i><p>${d ? esc(d.text) : ''}</p></div>
  <span class="bk-rk">${locked ? `Nv ${nv}` : s.key ? `Tecla ${esc(s.key.toUpperCase())}` : 'Nv ' + nv}</span>
</div>`;
    }).join('');
}

/** Pestaña Progresión: el árbol de desbloqueo del kit, una fila por nivel (1, 3, 5… 35), unidas por líneas; lo que ya tenés brilla. */
export function bookTreeHtml(cls: string, lvl: number, spells: BookSpell[]): string {
    const byLvl = new Map<number, BookSpell[]>();
    for (const s of spells) { const nv = skillLevel(cls, s.id) ?? 1; (byLvl.get(nv) ?? byLvl.set(nv, []).get(nv)!).push(s); }
    const levels = [...byLvl.keys()].sort((a, b) => a - b);
    const next = levels.find((n) => n > lvl);
    const rows = levels.map((nv) => {
        const open = nv <= lvl;
        const nodes = byLvl.get(nv)!.sort(byKit).map((s) => `<button type="button" class="bk-node${open ? ' on' : ''}${nv === next ? ' next' : ''}" data-spell="${s.id}" aria-label="${esc(s.name)}, nivel ${nv}"><img alt="" src="${spellIcon(s.id, s.col)}"><u>${open ? '1/1' : '0/1'}</u></button>`).join('');
        return `<div class="bk-tier${open ? ' on' : ''}"><span class="bk-lvl">Nv ${nv}</span><div class="bk-nodes">${nodes}</div></div>`;
    }).join('');
    const got = spells.filter((s) => (skillLevel(cls, s.id) ?? 1) <= lvl).length;
    return `<div class="bk-sum">${got} de ${spells.length} habilidades · ${next ? `la próxima en el nivel ${next}` : 'kit completo'}</div><div class="bk-tree">${rows}</div>
<div class="bk-note">Los talentos (puntos y rangos por habilidad) llegan con el rebirth, después de la beta: esta pestaña va a pasar a ser el árbol de talentos.</div>`;
}

/** Tooltip de un nodo o fila del libro. */
export function bookTipHtml(cls: string, s: BookSpell): string {
    const d = SKILL_DESC[s.id], nv = skillLevel(cls, s.id) ?? 1;
    return `<b>${esc(s.name)}</b><i>${d ? KIND_LABEL[d.kind] : ''} · nivel ${nv}${s.mp > 0 ? ` · ${s.mp} maná` : ''}${s.cd > 0 ? ` · recarga ${fmtCd(s.cd)}` : ''}</i><p>${d ? esc(d.text) : ''}</p>`;
}
