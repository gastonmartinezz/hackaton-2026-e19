import { z } from 'zod';
import { Limits, SessionId, ShortText, WebUrl } from './common.js';

export const ChatMessage = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: ShortText(Limits.maxMessageLength),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Se envía el rango, nunca la edad exacta. */
export const AgeRange = z.enum(['under-50', '50-64', '65-74', '75-plus']);
export type AgeRange = z.infer<typeof AgeRange>;

/** ISO 3166-1 alfa-2, por ejemplo "UY". */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/);

/**
 * Datos de la persona que dan contexto a Claude, sobre todo para priorizar sitios
 * de su localidad. Los carga la persona en la app (o salen del equipo, como el
 * idioma y la zona horaria). Todo es opcional.
 */
export const UserContext = z.strictObject({
  location: z
    .strictObject({
      country: CountryCode.optional(),
      /** Provincia, estado o departamento. */
      region: ShortText(80).optional(),
      /** Ciudad, localidad o partido. Nunca la dirección. */
      city: ShortText(80).optional(),
    })
    .optional(),
  ageRange: AgeRange.optional(),
  /** Idioma preferido del sistema (BCP 47), por ejemplo "es-UY". */
  language: z.string().max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/).optional(),
  /** Zona horaria IANA, por ejemplo "America/Montevideo". */
  timeZone: z.string().max(64).regex(/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/).optional(),
});
export type UserContext = z.infer<typeof UserContext>;

/** El front envía el historial completo; el último mensaje es el de la persona. */
export const InterpretRequest = z.strictObject({
  /** Ausente en el primer mensaje; el backend crea la sesión y la devuelve. */
  sessionId: SessionId.optional(),
  messages: z
    .array(ChatMessage)
    .min(1)
    .max(Limits.maxMessages)
    .refine((messages) => messages.at(-1)?.role === 'user', { message: 'El último mensaje debe ser del usuario' }),
  /** Se manda en cada llamada; si cambia, vale el último. */
  user: UserContext.optional(),
});
export type InterpretRequest = z.infer<typeof InterpretRequest>;

export const SiteOption = z.strictObject({
  title: ShortText(120),
  url: WebUrl,
  reason: ShortText(300),
});
export type SiteOption = z.infer<typeof SiteOption>;

export const InterpretResponse = z.discriminatedUnion('type', [
  z.strictObject({ sessionId: SessionId, type: z.literal('redirect'), message: ShortText(500), url: WebUrl }),
  z.strictObject({
    sessionId: SessionId,
    type: z.literal('question'),
    message: ShortText(500),
    /** Respuestas posibles para mostrar como botones (sin «No sé bien», que agrega el front). */
    answers: z.array(ShortText(60)).min(2).max(4).optional(),
    /** Por qué se pregunta, en una frase que ve la persona. */
    reason: ShortText(200).optional(),
  }),
  z.strictObject({
    sessionId: SessionId,
    type: z.literal('options'),
    message: ShortText(500),
    options: z.array(SiteOption).min(2).max(5),
  }),
]);
export type InterpretResponse = z.infer<typeof InterpretResponse>;
