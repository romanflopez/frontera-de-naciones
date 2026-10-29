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
    return `${proto}://${location.hostname || 'localhost'}:1337/ws`;
}

export class Net {
    private ws: WebSocket | null = null;
    onMessage: (p: ServerPayload) => void = () => {};
    onClose: (reason: string) => void = () => {};

    get open(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

    connect(url: string, id: string, characterName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';
            let opened = false;
            ws.onopen = () => {
                opened = true;
                this.ws = ws;
                this.send({ $case: 'authenticateRequest', value: { id, characterName } });
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
