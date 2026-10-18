/**
 * Audio del dictado (POST /v1/transcribe): WAV RIFF, PCM entero de 16 bits
 * little-endian, mono, 16 000 Hz, entre 0,3 s y 30 s. Funciones puras: la
 * interfaz codifica con `encodeWav` y el proceso principal revisa con
 * `isTranscribableWav` antes de mandarlo. Frecuencia, duración y tamaño
 * máximos salen del contrato (@hackaton/contracts).
 */
import { TRANSCRIBE_MAX_BYTES, TRANSCRIBE_MAX_SECONDS, TRANSCRIBE_SAMPLE_RATE } from '@hackaton/contracts';

export const WAV_SAMPLE_RATE = TRANSCRIBE_SAMPLE_RATE;
/** Cabecera canónica: la única que produce `encodeWav`. */
export const WAV_HEADER_BYTES = 44;
/** El contrato no exporta el mínimo: 0,3 s, acordado con el backend. */
export const WAV_MIN_SECONDS = 0.3;
export const WAV_MAX_SECONDS = TRANSCRIBE_MAX_SECONDS;
export const WAV_MIN_SAMPLES = Math.round(WAV_MIN_SECONDS * WAV_SAMPLE_RATE);
export const WAV_MAX_SAMPLES = WAV_MAX_SECONDS * WAV_SAMPLE_RATE;
/** 9 644 bytes. */
export const WAV_MIN_BYTES = WAV_HEADER_BYTES + WAV_MIN_SAMPLES * 2;
/** 960 044 bytes: TRANSCRIBE_MAX_BYTES (cabecera canónica + 30 s). */
export const WAV_MAX_BYTES = TRANSCRIBE_MAX_BYTES;

/** Pasa muestras en [-1, 1] a PCM16; lo que se sale del rango se recorta (y NaN es silencio). */
export function toPcm16(sample: number): number {
  const s = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/** Codifica muestras mono en un WAV PCM16 little-endian. */
export function encodeWav(samples: ArrayLike<number>, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM entero
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por muestra
  view.setUint16(34, 16, true); // bits por muestra
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(WAV_HEADER_BYTES + i * 2, toPcm16(samples[i]!), true);
  return buffer;
}

/** Promedia los canales en uno solo (mono). */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const channel of channels) {
    for (let i = 0; i < out.length; i++) out[i]! += (channel[i] ?? 0) / channels.length;
  }
  return out;
}

/** Recorta al máximo que acepta el servidor; null si es más corto que el mínimo. */
export function fitDuration(samples: Float32Array): Float32Array | null {
  if (samples.length < WAV_MIN_SAMPLES) return null;
  return samples.length > WAV_MAX_SAMPLES ? samples.subarray(0, WAV_MAX_SAMPLES) : samples;
}

/** Energía (RMS) de un bloque de muestras. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/**
 * Revisa que el cuerpo sea exactamente el formato acordado (el que produce
 * `encodeWav`) y que su duración esté dentro de los límites.
 */
export function isTranscribableWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < WAV_MIN_BYTES || bytes.byteLength > WAV_MAX_BYTES || bytes.byteLength % 2 !== 0) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, text: string) => [...text].every((c, i) => view.getUint8(offset + i) === c.charCodeAt(0));
  const dataBytes = bytes.byteLength - WAV_HEADER_BYTES;
  return (
    ascii(0, 'RIFF') &&
    view.getUint32(4, true) === 36 + dataBytes &&
    ascii(8, 'WAVE') &&
    ascii(12, 'fmt ') &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === WAV_SAMPLE_RATE &&
    view.getUint32(28, true) === WAV_SAMPLE_RATE * 2 &&
    view.getUint16(32, true) === 2 &&
    view.getUint16(34, true) === 16 &&
    ascii(36, 'data') &&
    view.getUint32(40, true) === dataBytes
  );
}

/** Muestras PCM16 de un WAV válido, en [-1, 1] (para el simulador). */
export function wavSamples(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.max(0, (bytes.byteLength - WAV_HEADER_BYTES) >> 1);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(WAV_HEADER_BYTES + i * 2, true) / 0x8000;
  return out;
}
