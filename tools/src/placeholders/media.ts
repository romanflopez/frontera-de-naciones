/**
 * Audio e imágenes provisorias.
 *
 * El cliente pide archivos .mp3, pero el navegador detecta el formato por el contenido,
 * así que escribimos WAV (mucho más simple de generar) con la extensión que espera.
 */
import { createCanvas } from '@napi-rs/canvas';

const RATE = 22050;

function wav(samples: Float32Array): Uint8Array {
    const data = samples.length * 2;
    const out = new Uint8Array(44 + data);
    const v = new DataView(out.buffer);
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, data, true);
    for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
    return out;
}

function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** Efecto corto: un "bip" con caída, con tono y largo derivados del nombre. */
export function soundEffect(name: string): Uint8Array {
    const h = hash(name);
    const dur = 0.06 + (h % 7) * 0.02;
    const f0 = 180 + (h % 600), f1 = f0 * (0.5 + ((h >> 8) % 100) / 100);
    const n = Math.round(dur * RATE), s = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / n, f = f0 + (f1 - f0) * t;
        phase += (2 * Math.PI * f) / RATE;
        const noise = (h & 1) ? (Math.random() * 2 - 1) * 0.3 : 0;
        s[i] = (Math.sin(phase) * 0.7 + noise) * Math.pow(1 - t, 2) * 0.35;
    }
    return wav(s);
}

/** Música: un segundo de silencio (el cliente la reproduce en loop). */
export function silence(seconds = 1): Uint8Array {
    return wav(new Float32Array(Math.round(seconds * RATE)));
}

/** Fondo de carga o login: degradado oscuro con el nombre provisorio. */
export function backgroundJpeg(width: number, height: number, subtitle: string): Uint8Array {
    const c = createCanvas(width, height), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(width / 2, height * 0.45, 40, width / 2, height / 2, Math.max(width, height) * 0.7);
    g.addColorStop(0, '#2a2418'); g.addColorStop(1, '#0b0c0a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d6a445'; ctx.font = `bold ${Math.round(height * 0.07)}px serif`;
    ctx.fillText('Frontera de Naciones', width / 2, height * 0.45);
    ctx.fillStyle = '#9c9683'; ctx.font = `${Math.round(height * 0.025)}px sans-serif`;
    ctx.fillText(subtitle, width / 2, height * 0.52);
    return c.toBuffer('image/jpeg', 85);
}
