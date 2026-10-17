/**
 * Contratos compartidos cliente ↔ servidor.
 *
 * PROPUESTA v1 — redactada desde el lado de Gaston a partir de la sección 6 de la
 * especificación. Pendiente de acuerdo explícito con Agustin (sección 0, regla 3).
 * Ver README.md de este paquete para lo que está tomado literal de la spec y lo
 * que es propuesta nueva.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '1' as const;

export const LIMITS = {
  idLength: 64,
  roleLength: 40,
  labelLength: 120,
  inputTypeLength: 20,
  originLength: 200,
  elements: 300,
  primaryOptions: 3,
  secondaryOptions: 5,
  evidencePerOption: 10,
  optionTitleLength: 80,
  optionDescriptionLength: 200,
  instructionLength: 300,
  messageLength: 500,
  intentLength: 500,
  clarifications: 3,
  candidates: 8,
  urlLength: 2048,
  /** Tamaño máximo del cuerpo JSON de cualquier solicitud del cliente. */
  requestBytes: 96 * 1024,
} as const;

const Id = z
  .string()
  .min(1)
  .max(LIMITS.idLength)
  .regex(/^[A-Za-z0-9_-]+$/);

const SchemaVersion = z.literal(SCHEMA_VERSION);

/* ------------------------------------------------------------------ */
/* Sección 6 de la especificación                                      */
/* ------------------------------------------------------------------ */

export const PageElementSchema = z.strictObject({
  id: Id,
  role: z.string().min(1).max(LIMITS.roleLength),
  /** Etiqueta depurada; nunca el value del control. */
  label: z.string().max(LIMITS.labelLength),
  inputType: z.string().max(LIMITS.inputTypeLength).optional(),
  enabled: z.boolean(),
  sectionId: Id.optional(),
});
export type PageElement = z.infer<typeof PageElementSchema>;

export const PageSnapshotSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  pageId: Id,
  navigationId: Id,
  revision: z.number().int().nonnegative(),
  /** Solo origen (esquema + host + puerto). Nunca path, query ni fragmento. */
  origin: z.string().max(LIMITS.originLength).regex(/^https?:\/\/[^/?#]+$/),
  extraction: z.enum(['complete', 'partial']),
  elements: z.array(PageElementSchema).max(LIMITS.elements),
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

export const PageOptionSchema = z.strictObject({
  id: Id,
  title: z.string().min(1).max(LIMITS.optionTitleLength),
  description: z.string().max(LIMITS.optionDescriptionLength),
  evidenceElementIds: z.array(Id).min(1).max(LIMITS.evidencePerOption),
});
export type PageOption = z.infer<typeof PageOptionSchema>;

const Correlation = {
  schemaVersion: SchemaVersion,
  requestId: Id,
  navigationId: Id,
  revision: z.number().int().nonnegative(),
};

export const GUIDE_PRESENTATIONS = ['highlight', 'scrollAndHighlight'] as const;
export const EXPECTED_SIGNALS = ['interaction', 'navigation', 'pageChange', 'userConfirmation'] as const;

export const GuideStepSchema = z.strictObject({
  ...Correlation,
  status: z.literal('guide'),
  instruction: z.string().min(1).max(LIMITS.instructionLength),
  targetElementId: Id,
  presentation: z.enum(GUIDE_PRESENTATIONS),
  expectedSignal: z.enum(EXPECTED_SIGNALS),
});

export const GuideMessageSchema = z.strictObject({
  ...Correlation,
  status: z.enum(['needsClarification', 'unsupported', 'completed']),
  message: z.string().min(1).max(LIMITS.messageLength),
});

export const GuideDecisionSchema = z.discriminatedUnion('status', [
  GuideStepSchema,
  GuideMessageSchema.extend({ status: z.literal('needsClarification') }),
  GuideMessageSchema.extend({ status: z.literal('unsupported') }),
  GuideMessageSchema.extend({ status: z.literal('completed') }),
]);
export type GuideDecision = z.infer<typeof GuideDecisionSchema>;
export type GuideStep = z.infer<typeof GuideStepSchema>;
export type ExpectedSignal = (typeof EXPECTED_SIGNALS)[number];

/* ------------------------------------------------------------------ */
/* Sección 7: cuerpos de los endpoints. PROPUESTA NUEVA (no en la spec) */
/* ------------------------------------------------------------------ */

const Text = (max: number) => z.string().min(1).max(max);

/** POST /v1/intents/interpret */
export const InterpretIntentRequestSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  requestId: Id,
  /** Intención ya minimizada en el dispositivo. */
  intent: Text(LIMITS.intentLength),
  clarifications: z
    .array(z.strictObject({ question: Text(LIMITS.messageLength), answer: Text(LIMITS.intentLength) }))
    .max(LIMITS.clarifications)
    .default([]),
});
export type InterpretIntentRequest = z.input<typeof InterpretIntentRequestSchema>;

export const InterpretIntentResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    schemaVersion: SchemaVersion,
    requestId: Id,
    status: z.literal('goal'),
    /** Objetivo en lenguaje simple, mostrado al usuario y usado en pasos siguientes. */
    goal: Text(LIMITS.intentLength),
  }),
  z.strictObject({
    schemaVersion: SchemaVersion,
    requestId: Id,
    status: z.literal('needsClarification'),
    question: Text(LIMITS.messageLength),
  }),
]);
export type InterpretIntentResponse = z.infer<typeof InterpretIntentResponseSchema>;

/** POST /v1/destinations/search */
export const DestinationSearchRequestSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  requestId: Id,
  goal: Text(LIMITS.intentLength),
  /** Ubicación indicada voluntariamente por el usuario (p. ej. país). */
  location: z.string().max(80).optional(),
});
export type DestinationSearchRequest = z.input<typeof DestinationSearchRequestSchema>;

export const DestinationCandidateSchema = z.strictObject({
  id: Id,
  title: Text(200),
  url: z.url({ protocol: /^https?$/ }).max(LIMITS.urlLength),
  description: z.string().max(LIMITS.messageLength),
  /** Motivo de la recomendación, si el servidor lo explica. */
  reason: z.string().max(LIMITS.messageLength).optional(),
  /** El servidor contrastó el dominio contra el registro curado. */
  verifiedOfficial: z.boolean().default(false),
});
export type DestinationCandidate = z.infer<typeof DestinationCandidateSchema>;

export const DestinationSearchResponseSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  requestId: Id,
  candidates: z.array(DestinationCandidateSchema).max(LIMITS.candidates),
  /** Debe ser el id de un candidato de la lista; el cliente lo comprueba. */
  recommendedId: Id.nullable(),
});
export type DestinationSearchResponse = z.infer<typeof DestinationSearchResponseSchema>;

/** POST /v1/pages/options */
export const PageOptionsRequestSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  requestId: Id,
  goal: z.string().max(LIMITS.intentLength).optional(),
  snapshot: PageSnapshotSchema,
});
export type PageOptionsRequest = z.input<typeof PageOptionsRequestSchema>;

export const PageOptionsResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...Correlation,
    status: z.literal('options'),
    primary: z.array(PageOptionSchema).max(LIMITS.primaryOptions),
    secondary: z.array(PageOptionSchema).max(LIMITS.secondaryOptions),
  }),
  z.strictObject({
    ...Correlation,
    status: z.enum(['needsClarification', 'unsupported']),
    message: Text(LIMITS.messageLength),
  }),
]);
export type PageOptionsResponse = z.infer<typeof PageOptionsResponseSchema>;

/** Resultado local del paso anterior. Nunca incluye valores. */
export const STEP_OUTCOMES = [
  'none',
  'signalObserved',
  'userConfirmed',
  'validationError',
  'targetStale',
  'targetNotVisible',
] as const;

/** POST /v1/guidance/next */
export const GuidanceNextRequestSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  requestId: Id,
  goal: Text(LIMITS.intentLength),
  option: PageOptionSchema.pick({ id: true, title: true }).optional(),
  snapshot: PageSnapshotSchema,
  previousStep: z
    .strictObject({
      instruction: z.string().max(LIMITS.instructionLength),
      expectedSignal: z.enum(EXPECTED_SIGNALS),
      outcome: z.enum(STEP_OUTCOMES),
    })
    .optional(),
  stepCount: z.number().int().nonnegative().max(200),
});
export type GuidanceNextRequest = z.input<typeof GuidanceNextRequestSchema>;

/** Formato de error estable. */
export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'rate_limited',
  'payload_too_large',
  'provider_unavailable',
  'provider_refused',
  'timeout',
  'internal',
] as const;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(API_ERROR_CODES),
    message: z.string().max(LIMITS.messageLength),
    retryable: z.boolean(),
  }),
  requestId: Id.optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Cabeceras propuestas. El mecanismo de autenticación lo define Agustin. */
export const HEADERS = {
  session: 'x-session-id',
  schemaVersion: 'x-schema-version',
} as const;
