import { z } from 'zod';

/**
 * POST /v1/speak: texto a voz. Cuerpo JSON `SpeakRequest`; la respuesta 200 es
 * binaria (`Content-Type: audio/mpeg`, MP3) y llega en streaming: el cliente
 * puede empezar a reproducir antes de que termine. Los errores usan `ApiError`.
 */
export const SPEAK_CONTENT_TYPE = 'audio/mpeg';
export const SPEAK_MAX_CHARS = 600;

export const SpeakRequest = z.strictObject({
  text: z.string().trim().min(1).max(SPEAK_MAX_CHARS),
});
export type SpeakRequest = z.infer<typeof SpeakRequest>;
