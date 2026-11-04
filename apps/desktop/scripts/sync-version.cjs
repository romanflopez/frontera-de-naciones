/**
 * La versión del juego vive en apps/client/package.json (es la que el cliente compara con la mínima del server).
 * Antes de empaquetar, se copia al package.json de la app de escritorio, que es la que electron-updater mira para saber si hay algo nuevo.
 */
const fs = require('node:fs');
const path = require('node:path');

const client = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'package.json'), 'utf8'));
const file = path.join(__dirname, '..', 'package.json');
const desktop = JSON.parse(fs.readFileSync(file, 'utf8'));
if (desktop.version !== client.version) {
    desktop.version = client.version;
    fs.writeFileSync(file, JSON.stringify(desktop, null, 2) + '\n');
    console.log(`[desktop] versión de la app: ${client.version}`);
}
