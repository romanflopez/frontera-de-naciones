import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChatBox } from './ChatBox';

/** Monta el ChatBox de forma síncrona (el juego busca #chatIn apenas arranca). */
export function mountChat(host: HTMLElement): void {
    const root = createRoot(host);
    flushSync(() => root.render(<ChatBox />));
}
