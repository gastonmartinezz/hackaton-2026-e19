// TEMPORAL: MP3 corto y válido (silencio) para desarrollar y probar sin llamar a
// OpenAI (TTS_PROVIDER=mock). También sirve al front para integrar la reproducción.
// No se permite en producción.
import type { SpeechProvider } from './provider.js';

// Cuadro MPEG-1 Layer III, 128 kbit/s, 44,1 kHz, mono, sin CRC: 144 * 128000 / 44100 = 417 bytes.
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0xc0];
const FRAME_BYTES = 417;
const FRAMES = 20; // ≈ 0,5 s (1152 muestras por cuadro)

function silentMp3(): Buffer {
  const frame = Buffer.alloc(FRAME_BYTES);
  Buffer.from(FRAME_HEADER).copy(frame);
  // Side info y datos en cero: el decodificador produce silencio.
  return Buffer.concat(Array.from({ length: FRAMES }, () => frame));
}

export const MOCK_MP3 = silentMp3();

export class MockSpeechProvider implements SpeechProvider {
  async speak(): Promise<AsyncIterable<Uint8Array>> {
    // Dos partes, para ejercitar el streaming igual que con el proveedor real.
    const half = Math.floor(FRAMES / 2) * FRAME_BYTES;
    return chunks([MOCK_MP3.subarray(0, half), MOCK_MP3.subarray(half)]);
  }
}

async function* chunks(parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}
