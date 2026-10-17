/**
 * Estado y validación local de la guía (S07, S08 validación, S09 verificación).
 * Puro: sin DOM, sin red, sin Electron. El orquestador del proceso principal
 * despacha eventos y ejecuta los efectos según la fase resultante.
 */
import {
  GuideDecisionSchema,
  PageOptionsResponseSchema,
  STEP_OUTCOMES,
  type GuideDecision,
  type GuideStep,
  type PageOption,
} from '@hackaton/contracts';

export type Phase =
  | 'idle'
  | 'analyzing'
  | 'choosing'
  | 'guiding'
  | 'waitingForUser'
  | 'verifying'
  | 'completed'
  | 'needsClarification'
  | 'unsupported'
  | 'error';

export type StepOutcome = (typeof STEP_OUTCOMES)[number];

export interface GuideState {
  phase: Phase;
  goal?: string | undefined;
  primary: PageOption[];
  secondary: PageOption[];
  option?: PageOption | undefined;
  step?: GuideStep | undefined;
  /** Paso mostrado antes del actual; se informa al servidor como contexto mínimo. */
  previousStep?: GuideStep | undefined;
  stepCount: number;
  lastOutcome: StepOutcome;
  message?: string | undefined;
  retry?: 'options' | 'next' | undefined;
}

export type GuideEvent =
  | { type: 'ANALYZE'; goal?: string | undefined }
  | { type: 'OPTIONS'; primary: PageOption[]; secondary: PageOption[] }
  | { type: 'OPTIONS_MESSAGE'; status: 'needsClarification' | 'unsupported'; message: string }
  | { type: 'SELECT'; optionId: string }
  | { type: 'DECISION'; decision: GuideDecision }
  | { type: 'OUTCOME'; outcome: Exclude<StepOutcome, 'none'> }
  | { type: 'REQUEST_NEXT' }
  | { type: 'NAVIGATED' }
  | { type: 'FAILED'; message: string }
  | { type: 'RETRY' }
  | { type: 'BACK' }
  | { type: 'EXIT' };

export const initialState: GuideState = {
  phase: 'idle',
  primary: [],
  secondary: [],
  stepCount: 0,
  lastOutcome: 'none',
};

/** Fases en las que hay una solicitud al servidor en curso. */
export const PENDING_PHASES: ReadonlySet<Phase> = new Set(['analyzing', 'guiding']);

const NO_OPTIONS_MESSAGE = 'No encontré tareas claras en esta página. Podés seguir navegando o volver al inicio.';

export function transition(state: GuideState, event: GuideEvent): GuideState {
  switch (event.type) {
    case 'ANALYZE':
      return {
        ...initialState,
        phase: 'analyzing',
        goal: event.goal ?? state.goal,
      };

    case 'OPTIONS': {
      if (state.phase !== 'analyzing') return state;
      if (event.primary.length + event.secondary.length === 0) {
        return { ...state, phase: 'unsupported', message: NO_OPTIONS_MESSAGE };
      }
      return { ...state, phase: 'choosing', primary: event.primary, secondary: event.secondary, message: undefined };
    }

    case 'OPTIONS_MESSAGE':
      if (state.phase !== 'analyzing') return state;
      return { ...state, phase: event.status, message: event.message };

    case 'SELECT': {
      if (state.phase !== 'choosing' && !(state.phase === 'needsClarification' && !state.option)) return state;
      const option = [...state.primary, ...state.secondary].find((o) => o.id === event.optionId);
      if (!option) return state;
      return { ...state, phase: 'guiding', option, step: undefined, previousStep: undefined, stepCount: 0, lastOutcome: 'none', message: undefined };
    }

    case 'DECISION': {
      if (state.phase !== 'guiding') return state;
      const { decision } = event;
      if (decision.status === 'guide') {
        return {
          ...state,
          phase: 'waitingForUser',
          previousStep: state.step ?? state.previousStep,
          step: decision,
          stepCount: state.stepCount + 1,
          message: undefined,
        };
      }
      return { ...state, phase: decision.status, message: decision.message, previousStep: state.step ?? state.previousStep, step: undefined };
    }

    case 'OUTCOME': {
      const canVerify =
        state.phase === 'waitingForUser' ||
        (state.phase === 'needsClarification' && state.option !== undefined && event.outcome === 'userConfirmed');
      if (!canVerify) return state;
      return { ...state, phase: 'verifying', lastOutcome: event.outcome };
    }

    case 'REQUEST_NEXT':
      if (state.phase !== 'verifying') return state;
      return { ...state, phase: 'guiding' };

    case 'NAVIGATED': {
      if (state.phase === 'idle' || state.phase === 'completed') return state;
      if (state.option) {
        // Continuidad del objetivo: las referencias viejas ya no valen.
        const outcome: StepOutcome =
          state.step && state.step.expectedSignal !== 'userConfirmation' ? 'signalObserved' : 'targetStale';
        return { ...state, phase: 'verifying', lastOutcome: state.step ? outcome : state.lastOutcome };
      }
      return transition(state, { type: 'ANALYZE' });
    }

    case 'FAILED': {
      if (state.phase === 'idle') return state;
      const retry = state.option ? 'next' : 'options';
      return { ...state, phase: 'error', message: event.message, retry };
    }

    case 'RETRY':
      if (state.phase !== 'error') return state;
      if (state.retry === 'next' && state.option) return { ...state, phase: 'verifying', message: undefined, retry: undefined };
      return transition(state, { type: 'ANALYZE' });

    case 'BACK':
      if (state.phase === 'idle') return state;
      if (state.primary.length + state.secondary.length === 0) return transition(state, { type: 'ANALYZE' });
      return {
        ...state,
        phase: 'choosing',
        option: undefined,
        step: undefined,
        previousStep: undefined,
        stepCount: 0,
        lastOutcome: 'none',
        message: undefined,
        retry: undefined,
      };

    case 'EXIT':
      return initialState;
  }
}

/* ------------------------------------------------------------------ */
/* Validación de respuestas del servidor                               */
/* ------------------------------------------------------------------ */

export interface ResponseContext {
  requestId: string;
  navigationId: string;
  revision: number;
  /** IDs presentes en el snapshot enviado con la solicitud. */
  elementIds: ReadonlySet<string>;
}

export type Rejection = 'schema' | 'requestId' | 'navigation' | 'revision' | 'unknownTarget' | 'noEvidence';

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: Rejection };

function checkCorrelation(
  value: { requestId: string; navigationId: string; revision: number },
  ctx: ResponseContext,
): Rejection | null {
  if (value.requestId !== ctx.requestId) return 'requestId';
  if (value.navigationId !== ctx.navigationId) return 'navigation';
  if (value.revision !== ctx.revision) return 'revision';
  return null;
}

/**
 * JSON válido no implica decisión correcta: además del esquema se comprueba la
 * correlación y que el destino exista en el snapshot de la solicitud.
 */
export function validateDecision(raw: unknown, ctx: ResponseContext): Validated<GuideDecision> {
  const parsed = GuideDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  const rejection = checkCorrelation(parsed.data, ctx);
  if (rejection) return { ok: false, reason: rejection };
  if (parsed.data.status === 'guide' && !ctx.elementIds.has(parsed.data.targetElementId)) {
    return { ok: false, reason: 'unknownTarget' };
  }
  return { ok: true, value: parsed.data };
}

export type ValidatedOptions =
  | { status: 'options'; primary: PageOption[]; secondary: PageOption[] }
  | { status: 'needsClarification' | 'unsupported'; message: string };

/** Descarta opciones cuya evidencia no esté completa en el snapshot actual. */
export function validateOptions(raw: unknown, ctx: ResponseContext): Validated<ValidatedOptions> {
  const parsed = PageOptionsResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  const rejection = checkCorrelation(parsed.data, ctx);
  if (rejection) return { ok: false, reason: rejection };
  if (parsed.data.status !== 'options') {
    return { ok: true, value: { status: parsed.data.status, message: parsed.data.message } };
  }
  const seen = new Set<string>();
  const keep = (options: PageOption[]) =>
    options.filter((option) => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return hasEvidence(option, ctx.elementIds);
    });
  const primary = keep(parsed.data.primary);
  const secondary = keep(parsed.data.secondary);
  if (primary.length + secondary.length === 0 && parsed.data.primary.length + parsed.data.secondary.length > 0) {
    return { ok: false, reason: 'noEvidence' };
  }
  return { ok: true, value: { status: 'options', primary, secondary } };
}

export function hasEvidence(option: PageOption, elementIds: ReadonlySet<string>): boolean {
  return option.evidenceElementIds.every((id) => elementIds.has(id));
}

/* ------------------------------------------------------------------ */
/* Verificación de señales observadas (S09)                            */
/* ------------------------------------------------------------------ */

export type Observation =
  | { kind: 'interaction'; elementId: string }
  | { kind: 'navigation' }
  | { kind: 'pageChange'; targetPresent: boolean }
  | { kind: 'validationError' }
  | { kind: 'userConfirmation' };

/**
 * Traduce una observación local en resultado del paso, o null si todavía no hay
 * evidencia suficiente. Un clic por sí solo no demuestra éxito salvo que el paso
 * esperara exactamente esa interacción.
 */
export function evaluateObservation(step: GuideStep, observation: Observation): Exclude<StepOutcome, 'none'> | null {
  switch (observation.kind) {
    case 'validationError':
      return 'validationError';
    case 'userConfirmation':
      return 'userConfirmed';
    case 'navigation':
      return step.expectedSignal === 'userConfirmation' ? 'targetStale' : 'signalObserved';
    case 'pageChange':
      if (step.expectedSignal === 'pageChange') return 'signalObserved';
      return observation.targetPresent ? null : 'targetStale';
    case 'interaction':
      return step.expectedSignal === 'interaction' && observation.elementId === step.targetElementId
        ? 'signalObserved'
        : null;
  }
}
