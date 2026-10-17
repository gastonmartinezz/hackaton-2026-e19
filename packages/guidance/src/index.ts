/**
 * Estado y validación local de la guía (S07, S08 validación, S09 verificación).
 * Puro: sin DOM, sin red, sin Electron. El orquestador del proceso principal
 * despacha eventos y ejecuta los efectos según la fase resultante.
 *
 * Contrato v1.2: POST /v1/options devuelve opciones y el próximo paso en la
 * misma respuesta, con elementos identificados por selector CSS. El backend
 * guarda el historial en la sesión; el cliente solo envía el HTML nuevo.
 */
import type { Guide, GuideStep, OptionsResponse, PageOption } from '@hackaton/contracts';

export type Phase =
  | 'idle'
  | 'analyzing'
  | 'choosing'
  | 'guiding'
  | 'waitingForUser'
  | 'verifying'
  | 'completed'
  | 'unsupported'
  | 'error';

/** Resultado local del paso anterior. Nunca incluye valores. */
export type StepOutcome = 'none' | 'signalObserved' | 'userConfirmed' | 'validationError' | 'targetStale' | 'targetNotVisible';

export interface ActiveStep extends GuideStep {
  /** ID local del elemento al que se resolvió el selector, cuando se pudo mostrar. */
  targetElementId?: string | undefined;
}

export interface GuideState {
  phase: Phase;
  /** Objetivo escrito en el chat, solo para mostrar. */
  goal?: string | undefined;
  primary: PageOption[];
  secondary: PageOption[];
  option?: PageOption | undefined;
  /** Paso sugerido junto con las opciones; se usa si la persona elige esa opción. */
  suggested?: Guide | undefined;
  step?: ActiveStep | undefined;
  stepCount: number;
  lastOutcome: StepOutcome;
  message?: string | undefined;
  retry?: 'options' | 'next' | undefined;
}

export type GuideEvent =
  | { type: 'ANALYZE'; goal?: string | undefined }
  | { type: 'RESPONSE'; response: Pick<OptionsResponse, 'options' | 'guide'> }
  | { type: 'SELECT'; optionId: string }
  | { type: 'SHOWN'; elementId: string }
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

export const PRIMARY_OPTIONS = 3;

const NO_OPTIONS_MESSAGE = 'No encontré tareas claras en esta página. Podés seguir navegando o volver al inicio.';
const NO_STEP_MESSAGE = 'No encuentro cómo seguir desde esta página. Podés elegir otra tarea o abrirla en tu navegador.';
// guide: null después de al menos un paso. El contrato no distingue "terminado"
// de "sin paso posible"; se asume terminado y se le pide confirmación a la persona.
const DONE_MESSAGE = 'Parece que terminaste. Si no es lo que buscabas, tocá «Elegir otra tarea».';

export function transition(state: GuideState, event: GuideEvent): GuideState {
  switch (event.type) {
    case 'ANALYZE':
      return {
        ...initialState,
        phase: 'analyzing',
        goal: event.goal ?? state.goal,
      };

    case 'RESPONSE': {
      const options = uniqueOptions(event.response.options);
      if (state.phase === 'analyzing') {
        if (options.length === 0) return { ...state, phase: 'unsupported', message: NO_OPTIONS_MESSAGE };
        return {
          ...state,
          phase: 'choosing',
          ...split(options),
          suggested: event.response.guide ?? undefined,
          message: undefined,
        };
      }
      if (state.phase === 'guiding') {
        const refreshed = options.length > 0 ? split(options) : {};
        const { guide } = event.response;
        if (!guide) {
          return state.stepCount > 0
            ? { ...state, ...refreshed, phase: 'completed', step: undefined, message: DONE_MESSAGE }
            : { ...state, ...refreshed, phase: 'unsupported', step: undefined, message: NO_STEP_MESSAGE };
        }
        return { ...state, ...refreshed, phase: 'waitingForUser', step: { ...guide.step }, stepCount: state.stepCount + 1, message: undefined };
      }
      return state;
    }

    case 'SELECT': {
      if (state.phase !== 'choosing') return state;
      const option = [...state.primary, ...state.secondary].find((o) => o.id === event.optionId);
      if (!option) return state;
      const base = { ...state, option, step: undefined, stepCount: 0, lastOutcome: 'none' as const, message: undefined, suggested: undefined };
      if (state.suggested?.goal === option.id) {
        return { ...base, phase: 'waitingForUser', step: { ...state.suggested.step }, stepCount: 1 };
      }
      return { ...base, phase: 'guiding' };
    }

    case 'SHOWN':
      if (state.phase !== 'waitingForUser' || !state.step) return state;
      return { ...state, step: { ...state.step, targetElementId: event.elementId } };

    case 'OUTCOME':
      if (state.phase !== 'waitingForUser') return state;
      return { ...state, phase: 'verifying', lastOutcome: event.outcome };

    case 'REQUEST_NEXT':
      if (state.phase !== 'verifying') return state;
      return { ...state, phase: 'guiding' };

    case 'NAVIGATED': {
      if (state.phase === 'idle' || state.phase === 'completed') return state;
      if (state.option) {
        // Continuidad del objetivo: se pide el próximo paso con el HTML nuevo.
        const outcome: StepOutcome = state.step && state.step.waitFor !== 'userConfirmation' ? 'signalObserved' : 'targetStale';
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
        suggested: undefined,
        step: undefined,
        stepCount: 0,
        lastOutcome: 'none',
        message: undefined,
        retry: undefined,
      };

    case 'EXIT':
      return initialState;
  }
}

function uniqueOptions(options: readonly PageOption[]): PageOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function split(options: PageOption[]): Pick<GuideState, 'primary' | 'secondary'> {
  return { primary: options.slice(0, PRIMARY_OPTIONS), secondary: options.slice(PRIMARY_OPTIONS) };
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
 * esperara exactamente esa interacción sobre el elemento señalado.
 */
export function evaluateObservation(step: ActiveStep, observation: Observation): Exclude<StepOutcome, 'none'> | null {
  switch (observation.kind) {
    case 'validationError':
      return 'validationError';
    case 'userConfirmation':
      return 'userConfirmed';
    case 'navigation':
      return step.waitFor === 'userConfirmation' ? 'targetStale' : 'signalObserved';
    case 'pageChange':
      return observation.targetPresent ? null : 'targetStale';
    case 'interaction':
      return step.waitFor === 'userInteraction' && step.targetElementId !== undefined && observation.elementId === step.targetElementId
        ? 'signalObserved'
        : null;
  }
}
