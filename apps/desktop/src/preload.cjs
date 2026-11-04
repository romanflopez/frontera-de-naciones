/**
 * Puente entre la ventana del juego y el proceso principal. Es lo único que el cliente web ve de Electron (`window.erisDesktop`);
 * la ventana sigue con contextIsolation y sin Node.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erisDesktop', {
    /** Versión de la app instalada. */
    version: ipcRenderer.sendSync('eris:version'),
    /** Recibe cada cambio del estado de la actualización ({ state, version?, percent?, error? }). */
    onUpdate: (cb) => { ipcRenderer.on('eris:update', (_e, s) => cb(s)); },
    getUpdate: () => ipcRenderer.invoke('eris:update-state'),
    checkUpdates: () => ipcRenderer.invoke('eris:update-check'),
    installUpdate: () => ipcRenderer.invoke('eris:update-install'),
});
