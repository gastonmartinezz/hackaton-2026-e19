import { describe, expect, it } from 'vitest';
import {
  downmix,
  encodeWav,
  fitDuration,
  isTranscribableWav,
  rms,
  toPcm16,
  WAV_MAX_BYTES,
  WAV_MAX_SAMPLES,
  WAV_MIN_BYTES,
  WAV_MIN_SAMPLES,
  wavSamples,
} from './wav';

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

describe('encodeWav', () => {
  it('escribe la cabecera RIFF exacta de PCM16 mono a 16 kHz', () => {
    const buffer = encodeWav(new Float32Array(10));
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    expect(bytes.byteLength).toBe(44 + 20);
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 20);
    expect(ascii(bytes, 8, 12)).toBe('WAVE');
    expect(ascii(bytes, 12, 16)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 40)).toBe('data');
    expect(view.getUint32(40, true)).toBe(20);
  });

  it('codifica little-endian y recorta lo que se sale de [-1, 1]', () => {
    const view = new DataView(encodeWav([0, 1, -1, 0.5, 2, -3, Number.NaN]));
    const at = (i: number) => view.getInt16(44 + i * 2, true);
    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([0, 32767, -32768, 16384, 32767, -32768, 0]);
    expect(new Uint8Array(view.buffer)[46]).toBe(0xff); // 32767 = 0x7fff: byte bajo primero
    expect(toPcm16(-0.5)).toBe(-16384);
  });

  it('la duración máxima da exactamente 960 044 bytes', () => {
    expect(WAV_MAX_BYTES).toBe(960_044);
    expect(encodeWav(new Float32Array(WAV_MAX_SAMPLES)).byteLength).toBe(WAV_MAX_BYTES);
  });

  it('wavSamples recupera las muestras', () => {
    const samples = wavSamples(new Uint8Array(encodeWav([0.25, -0.25])));
    expect(samples[0]).toBeCloseTo(0.25, 3);
    expect(samples[1]).toBeCloseTo(-0.25, 3);
  });
});

describe('isTranscribableWav', () => {
  const valid = () => new Uint8Array(encodeWav(new Float32Array(WAV_MIN_SAMPLES)));

  it('acepta lo que produce encodeWav entre 0,3 s y 30 s', () => {
    expect(valid().byteLength).toBe(WAV_MIN_BYTES);
    expect(isTranscribableWav(valid())).toBe(true);
    expect(isTranscribableWav(new Uint8Array(encodeWav(new Float32Array(WAV_MAX_SAMPLES))))).toBe(true);
  });

  it('rechaza audios muy cortos o muy largos', () => {
    expect(isTranscribableWav(new Uint8Array(encodeWav(new Float32Array(WAV_MIN_SAMPLES - 1))))).toBe(false);
    expect(isTranscribableWav(new Uint8Array(encodeWav(new Float32Array(WAV_MAX_SAMPLES + 1))))).toBe(false);
  });

  it('rechaza otra frecuencia, otros canales o una cabecera que no coincide', () => {
    expect(isTranscribableWav(new Uint8Array(encodeWav(new Float32Array(WAV_MIN_SAMPLES), 44_100)))).toBe(false);
    const stereo = valid();
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(isTranscribableWav(stereo)).toBe(false);
    const notRiff = valid();
    notRiff[0] = 0;
    expect(isTranscribableWav(notRiff)).toBe(false);
    const badSize = valid();
    new DataView(badSize.buffer).setUint32(40, 2, true);
    expect(isTranscribableWav(badSize)).toBe(false);
    expect(isTranscribableWav(new Uint8Array(WAV_MIN_BYTES))).toBe(false);
  });
});

describe('remuestreo: lógica pura', () => {
  it('downmix promedia los canales', () => {
    const mono = downmix([new Float32Array([1, 0, -1]), new Float32Array([0, 0, 1])]);
    expect([...mono]).toEqual([0.5, 0, 0]);
    expect(downmix([])).toHaveLength(0);
    const single = new Float32Array([0.1]);
    expect(downmix([single])).toBe(single);
  });

  it('fitDuration descarta lo muy corto y recorta a 30 s', () => {
    expect(fitDuration(new Float32Array(WAV_MIN_SAMPLES - 1))).toBeNull();
    expect(fitDuration(new Float32Array(WAV_MIN_SAMPLES))).toHaveLength(WAV_MIN_SAMPLES);
    expect(fitDuration(new Float32Array(WAV_MAX_SAMPLES + 500))).toHaveLength(WAV_MAX_SAMPLES);
  });

  it('rms mide la energía', () => {
    expect(rms([])).toBe(0);
    expect(rms([0.5, -0.5])).toBeCloseTo(0.5);
  });
});
