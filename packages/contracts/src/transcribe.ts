import { z } from 'zod';

/**
 * POST /v1/transcribe: voz a texto con Whisper en el servidor propio.
 *
 * El cuerpo es binario (no JSON), con `Content-Type: audio/wav`:
 * WAV RIFF con PCM entero de 16 bits little-endian, mono, 16 000 Hz,
 * de entre 0,3 s y 30 s. El texto devuelto lo usa el cliente en /v1/interpret.
 */
export const TRANSCRIBE_CONTENT_TYPE = 'audio/wav';
export const TRANSCRIBE_SAMPLE_RATE = 16000;
export const TRANSCRIBE_MAX_SECONDS = 30;
/** Cabecera WAV canónica (44 bytes) + 30 s de PCM de 16 bits mono a 16 kHz. */
export const TRANSCRIBE_MAX_BYTES = 44 + TRANSCRIBE_SAMPLE_RATE * 2 * TRANSCRIBE_MAX_SECONDS;

/** Texto recortado. `""` si no se entendió nada (200, no es un error). */
export const TranscribeResponse = z.strictObject({
  text: z.string().max(1000),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponse>;
