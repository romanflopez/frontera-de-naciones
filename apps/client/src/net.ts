/**
 * Conexión con el server: WebSocket binario con los mensajes protobuf de @fdn/proto.
 */
import { ClientMessage, ServerMessage, type DeepPartial } from '@fdn/proto';

export type ServerPayload = NonNullable<ServerMessage['payload']>;
type ClientPayload = NonNullable<DeepPartial<ClientMessage>['payload']>;

/** Dirección del server: ?server=ws://... en la URL, VITE_SERVER_URL, o el mismo host en el puerto 1337. */
export function serverUrl(): string {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    const env = import.meta.env.VITE_SERVER_URL as string | undefined;
    if (env) return env;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname || 'localhost';
    // En local el server está en el puerto 1337; publicado (mismo host sirve cliente y WebSocket) va por el puerto de la página.
    const local = host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    return local ? `${proto}://${host}:1337/ws` : `${proto}://${location.host}/ws`;
}

/** Pedido sin sesión (recuperar la contraseña, D.17): abre una conexión, manda el mensaje, espera la respuesta y cierra. */
export function oneShot(url: string, payload: ClientPayload, kind: 'forgot' | 'reset'): Promise<{ ok: boolean; text: string }> {
    return new Promise((resolve) => {
        let done = false, ws: WebSocket;
        const finish = (r: { ok: boolean; text: string }) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(1000); } catch { /* ya cerrada */ } resolve(r); };
        const timer = setTimeout(() => finish({ ok: false, text: 'El server no respondió. Probá de nuevo en un rato.' }), 15000);
        try { ws = new WebSocket(url); } catch { clearTimeout(timer); resolve({ ok: false, text: 'No se pudo conectar con el server.' }); return; }
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => ws.send(new Uint8Array(ClientMessage.encode(ClientMessage.fromPartial({ payload })).finish()));
        ws.onmessage = (ev) => {
            if (!(ev.data instanceof ArrayBuffer)) return;
            try { const p = ServerMessage.decode(new Uint8Array(ev.data)).payload; if (p?.$case === 'passwordResetResult' && p.value.kind === kind) finish({ ok: p.value.ok, text: p.value.text }); } catch { /* mensaje que no es */ }
        };
        ws.onerror = () => finish({ ok: false, text: 'No se pudo conectar con el server.' });
        ws.onclose = () => finish({ ok: false, text: 'Se cortó la conexión con el server.' });
    });
}

export class Net {
    private ws: WebSocket | null = null;
    onMessage: (p: ServerPayload) => void = () => {};
    onClose: (reason: string) => void = () => {};

    get open(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

    connect(url: string, id: string, characterName: string, password = '', email = ''): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            let opened = false;
            ws.onopen = () => {
                opened = true;
                this.ws = ws;
                this.send({ $case: 'authenticateRequest', value: { id, characterName, password, email } });
                resolve();
            };
            ws.onmessage = (ev) => {
                if (!(ev.data instanceof ArrayBuffer)) return;
                let msg: ServerMessage;
                try { msg = ServerMessage.decode(new Uint8Array(ev.data)); } catch { return; }
                if (msg.payload) this.onMessage(msg.payload);
            };
            ws.onclose = (ev) => {
                this.ws = null;
                if (!opened) reject(new Error('No se pudo conectar con el server.'));
                else this.onClose(ev.reason || 'Se cortó la conexión con el server.');
            };
        });
    }

    send(payload: ClientPayload): void {
        if (!this.open) return;
        const bytes = ClientMessage.encode(ClientMessage.fromPartial({ payload })).finish();
        this.ws!.send(new Uint8Array(bytes));
    }

    close(): void { this.ws?.close(1000); }
}
