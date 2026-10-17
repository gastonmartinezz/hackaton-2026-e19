import { z } from 'zod';

export const ErrorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'SESSION_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_INVALID_RESPONSE',
  'AI_REFUSED',
  'TIMEOUT',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Formato estable de error para todos los endpoints. */
export const ApiError = z.strictObject({
  error: z.strictObject({
    code: ErrorCode,
    /** Mensaje técnico breve; el front decide el texto mostrado. */
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
    details: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
