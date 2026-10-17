import { z } from 'zod';

export const Limits = {
  maxMessages: 20,
  maxMessageLength: 1000,
  maxHtmlLength: 200_000,
  maxSelectorLength: 300,
  maxSteps: 15,
} as const;

/** Solo http(s): bloquea javascript:, file: y otros esquemas. */
export const WebUrl = z.url({ protocol: /^https?$/ });

export const ShortText = (max: number) => z.string().trim().min(1).max(max);

/** Sesión creada por el backend en /v1/interpret o /v1/options. */
export const SessionId = z.string().min(1).max(64);
