import { z } from 'zod';
import { Limits, ShortText, WebUrl } from './common.js';

export const ChatMessage = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: ShortText(Limits.maxMessageLength),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** El front envía el historial completo; el último mensaje es el de la persona. */
export const InterpretRequest = z.strictObject({
  messages: z
    .array(ChatMessage)
    .min(1)
    .max(Limits.maxMessages)
    .refine((messages) => messages.at(-1)?.role === 'user', { message: 'El último mensaje debe ser del usuario' }),
});
export type InterpretRequest = z.infer<typeof InterpretRequest>;

export const SiteOption = z.strictObject({
  title: ShortText(120),
  url: WebUrl,
  reason: ShortText(300),
});
export type SiteOption = z.infer<typeof SiteOption>;

export const InterpretResponse = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('redirect'), message: ShortText(500), url: WebUrl }),
  z.strictObject({ type: z.literal('question'), message: ShortText(500) }),
  z.strictObject({ type: z.literal('options'), message: ShortText(500), options: z.array(SiteOption).min(2).max(5) }),
]);
export type InterpretResponse = z.infer<typeof InterpretResponse>;
