export interface WavOptions {
  seconds?: number;
  sampleRate?: number;
  channels?: number;
  bits?: number;
  format?: number;
  /** Amplitud del tono de 440 Hz; 0 = silencio. */
  amplitude?: number;
  /** Chunks extra entre fmt y data (p. ej. LIST). */
  extraChunks?: Array<{ id: string; data: Buffer }>;
}

/** Arma un WAV RIFF en memoria para las pruebas (sin archivos ni modelos). */
export function buildWav({
  seconds = 1,
  sampleRate = 16_000,
  channels = 1,
  bits = 16,
  format = 1,
  amplitude = 0.3,
  extraChunks = [],
}: WavOptions = {}): Buffer {
  const bytesPerSample = bits / 8;
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * bytesPerSample);
  for (let i = 0; i < frames; i++) {
    const value = amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    for (let c = 0; c < channels; c++) {
      const offset = (i * channels + c) * bytesPerSample;
      if (bits === 16) data.writeInt16LE(Math.round(value * 32767), offset);
      else data.writeUInt8(Math.round(128 + value * 127), offset);
    }
  }

  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * bytesPerSample, 8);
  fmt.writeUInt16LE(channels * bytesPerSample, 12);
  fmt.writeUInt16LE(bits, 14);

  const chunks = [chunk('fmt ', fmt), ...extraChunks.map((extra) => chunk(extra.id, extra.data)), chunk('data', data)];
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, body]);
}

function chunk(id: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}
