import { TRANSCRIBE_MAX_SECONDS, TRANSCRIBE_SAMPLE_RATE } from '@hackaton/contracts';
import { AppError } from '../../lib/errors.js';

export const MIN_AUDIO_SECONDS = 0.3;

export interface DecodedWav {
  /** Muestras normalizadas a [-1, 1); se usan para detectar silencio. */
  samples: Float32Array;
  durationMs: number;
}

const PCM = 1;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = CHANNELS * (BITS_PER_SAMPLE / 8);

const invalid = () => new AppError('BAD_REQUEST', 'El audio no es un WAV válido');
const unsupported = () =>
  new AppError('BAD_REQUEST', `El audio tiene que ser PCM de 16 bits, mono, a ${TRANSCRIBE_SAMPLE_RATE} Hz`);

/**
 * Lee un WAV RIFF estricto: chunk `fmt ` PCM (1), mono, 16 000 Hz y 16 bits;
 * recorre los chunks hasta `data` e ignora los demás (LIST, fact…). Sin ffmpeg.
 * Los mensajes de error son genéricos: nunca incluyen bytes del audio.
 */
export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') {
    throw invalid();
  }

  let offset = 12;
  let hasFormat = false;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('latin1', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      if (size < 16 || body + size > buffer.length) throw invalid();
      const format = buffer.readUInt16LE(body);
      const channels = buffer.readUInt16LE(body + 2);
      const sampleRate = buffer.readUInt32LE(body + 4);
      const byteRate = buffer.readUInt32LE(body + 8);
      const blockAlign = buffer.readUInt16LE(body + 12);
      const bits = buffer.readUInt16LE(body + 14);
      if (
        format !== PCM ||
        channels !== CHANNELS ||
        sampleRate !== TRANSCRIBE_SAMPLE_RATE ||
        bits !== BITS_PER_SAMPLE ||
        blockAlign !== BLOCK_ALIGN ||
        byteRate !== TRANSCRIBE_SAMPLE_RATE * BLOCK_ALIGN
      ) {
        throw unsupported();
      }
      hasFormat = true;
    } else if (id === 'data') {
      // El formato tiene que llegar antes que las muestras.
      if (!hasFormat) throw invalid();
      // Truncado o con media muestra al final.
      if (body + size > buffer.length || size % BLOCK_ALIGN !== 0) throw invalid();
      return toFloat32(buffer, body, size / BLOCK_ALIGN);
    }

    // Los chunks de tamaño impar llevan un byte de relleno.
    offset = body + size + (size % 2);
  }
  throw invalid();
}

function toFloat32(buffer: Buffer, start: number, count: number): DecodedWav {
  const seconds = count / TRANSCRIBE_SAMPLE_RATE;
  if (seconds < MIN_AUDIO_SECONDS) throw new AppError('BAD_REQUEST', 'El audio es demasiado corto');
  if (seconds > TRANSCRIBE_MAX_SECONDS) {
    throw new AppError('PAYLOAD_TOO_LARGE', `El audio supera los ${TRANSCRIBE_MAX_SECONDS} segundos`);
  }

  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = buffer.readInt16LE(start + i * BLOCK_ALIGN) / 32768;
  return { samples, durationMs: Math.round(seconds * 1000) };
}
