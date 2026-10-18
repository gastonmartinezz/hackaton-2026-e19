import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { decodeWav } from '../src/modules/transcribe/wav.js';
import { buildWav } from './wav-helpers.js';

function errorOf(buffer: Buffer): AppError {
  try {
    decodeWav(buffer);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('Se esperaba un error');
}

describe('decodeWav', () => {
  it('lee un WAV PCM 16 bits mono a 16 kHz y normaliza las muestras', () => {
    const { samples, durationMs } = decodeWav(buildWav({ seconds: 1.5 }));
    expect(durationMs).toBe(1500);
    expect(samples).toHaveLength(24_000);
    expect(Math.max(...samples)).toBeGreaterThan(0.29);
    expect(Math.max(...samples)).toBeLessThan(0.31);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-1);
  });

  it('salta chunks desconocidos (también de tamaño impar) hasta data', () => {
    const extraChunks = [
      { id: 'LIST', data: Buffer.from('INFOISFT', 'latin1') },
      { id: 'junk', data: Buffer.from([1, 2, 3]) },
    ];
    expect(decodeWav(buildWav({ seconds: 1, extraChunks })).durationMs).toBe(1000);
  });

  it.each([
    ['estéreo', { channels: 2 }],
    ['44,1 kHz', { sampleRate: 44_100 }],
    ['8 bits', { bits: 8 }],
    ['float (formato 3)', { format: 3 }],
  ])('rechaza %s con BAD_REQUEST', (_, options) => {
    const error = errorOf(buildWav(options));
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toMatch(/16 bits, mono/);
  });

  it.each([
    ['vacío', Buffer.alloc(0)],
    ['sin cabecera RIFF', Buffer.from('hola, esto no es audio')],
    ['un MP3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)])],
    ['truncado', buildWav({ seconds: 1 }).subarray(0, 20_000)],
    ['sin chunk data', buildWav({ seconds: 1 }).subarray(0, 36)],
  ])('rechaza un WAV %s', (_, buffer) => {
    expect(errorOf(buffer).code).toBe('BAD_REQUEST');
  });

  it('rechaza data antes que fmt', () => {
    const wav = buildWav({ seconds: 1 });
    const fmt = wav.subarray(12, 36);
    const data = wav.subarray(36);
    const reordered = Buffer.concat([wav.subarray(0, 12), data, fmt]);
    expect(errorOf(reordered).code).toBe('BAD_REQUEST');
  });

  it('rechaza audio de menos de 0,3 s', () => {
    expect(errorOf(buildWav({ seconds: 0.29 }))).toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/corto/) });
    expect(decodeWav(buildWav({ seconds: 0.3 })).durationMs).toBe(300);
  });

  it('rechaza audio de más de 30 s con PAYLOAD_TOO_LARGE', () => {
    expect(decodeWav(buildWav({ seconds: 30 })).durationMs).toBe(30_000);
    expect(errorOf(buildWav({ seconds: 30.1 })).code).toBe('PAYLOAD_TOO_LARGE');
  });
});
