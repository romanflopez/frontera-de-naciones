/**
 * Genera THIRD_PARTY_NOTICES.txt con las licencias de las dependencias que se distribuyen (producción).
 * Varias de esas licencias (MIT, ISC, Apache-2.0, BSD) obligan a conservar el aviso de copyright al distribuir el software,
 * cosa que hasta ahora no se hacía. Esto lo resuelve de forma automática para que no se desactualice.
 *
 * Uso: pnpm legal:notices   (escribe apps/client/public/THIRD_PARTY_NOTICES.txt)
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const salida = join(root, 'apps', 'client', 'public', 'THIRD_PARTY_NOTICES.txt');

const datos = JSON.parse(execSync('pnpm licenses list --json --prod', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

/** Busca el texto de la licencia en el paquete instalado, si lo trae. */
function textoLicencia(paths) {
    for (const p of paths ?? []) {
        for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license', 'LICENSE-MIT']) {
            const f = join(p, n);
            if (existsSync(f)) return readFileSync(f, 'utf8').trim();
        }
    }
    return null;
}

const bloques = [];
let total = 0;
for (const [licencia, paquetes] of Object.entries(datos).sort(([a], [b]) => a.localeCompare(b))) {
    for (const p of paquetes.sort((a, b) => a.name.localeCompare(b.name))) {
        total++;
        const texto = textoLicencia(p.paths);
        const autor = p.author ? `Autor: ${p.author}\n` : '';
        const home = p.homepage ? `${p.homepage}\n` : '';
        bloques.push(`${'='.repeat(78)}\n${p.name} ${p.versions?.join(', ') ?? ''}\nLicencia: ${licencia}\n${autor}${home}\n${texto ?? '(el paquete no incluye el texto de la licencia; ver su repositorio)'}`);
    }
}

const cabecera = `Avisos de terceros — ERIS
Generado por tools/src/legal/notices.mjs (pnpm legal:notices). No editar a mano.

Este archivo lista las dependencias de software que se distribuyen con el juego y conserva sus avisos de copyright, como exigen
sus licencias. Los créditos del ARTE y las fuentes van aparte, en assets/CREDITS.txt y assets/CREDITS-CC0.txt.

Paquetes: ${total}. Licencias presentes: ${Object.keys(datos).sort().join(', ')}.
Fecha de generación: ${new Date().toISOString().slice(0, 10)}

`;

writeFileSync(salida, cabecera + bloques.join('\n\n') + '\n');
console.log(`THIRD_PARTY_NOTICES.txt: ${total} paquetes`);
