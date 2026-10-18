import { z } from 'zod';

/**
 * POST /v1/transcribe: voz a texto (Whisper local u OpenAI, según la configuración del servidor).
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
/**
 * Margen que el servidor acepta por encima de `TRANSCRIBE_MAX_BYTES` para WAV con chunks
 * extra (LIST, fact…) antes de `data`. La duración máxima la controla igual al leer el audio.
 */
export const TRANSCRIBE_HEADER_HEADROOM_BYTES = 4096;

/** Texto recortado. `""` si no se entendió nada (200, no es un error). */
export const TranscribeResponse = z.strictObject({
  text: z.string().max(1000),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponse>;
