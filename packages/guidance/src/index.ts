/**
 * Estado y validación local de la guía (S07, S08 validación, S09 verificación).
 * Puro: sin DOM, sin red, sin Electron. El orquestador del proceso principal
 * despacha eventos y ejecuta los efectos según la fase resultante.
 *
 * Contrato: POST /v1/options devuelve cada opción con su guía completa
 * (`steps`). Un paso con `element: null` es teórico: su elemento aparece
 * después de una acción, y se resuelve con POST /v1/next-step usando el HTML
 * nuevo. Fases con efectos:
 *   analyzing → pedir opciones · verifying → extraer la página · guiding →
 *   pedir /v1/next-step · waitingForUser → mostrar el paso.
 */
import type { GuideStep, NextStepResponse, PageOption } from '@hackaton/contracts';

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

/** Resultado local del paso actual. Nunca incluye valores. */
export type StepOutcome = 'none' | 'signalObserved' | 'userConfirmed' | 'validationError' | 'targetStale' | 'targetNotVisible';

export interface ActiveStep extends GuideStep {
  /** ID local del elemento al que se resolvió el selector, cuando se pudo mostrar. */
  targetElementId?: string | undefined;
}

export interface GuideState {
  phase: Phase;
  /** Objetivo escrito en el chat, solo para mostrar. */
  goal?: string | undefined;
  options: PageOption[];
  option?: PageOption | undefined;
  /** Paso actual. En guiding/verifying es el paso que se va a pedir a /v1/next-step. */
  step?: ActiveStep | undefined;
  /** Pasos que siguen al actual. */
  plan: GuideStep[];
  /** Pasos reales completados desde la última llamada a /v1/next-step. */
  completed: GuideStep[];
  /**
   * Hubo una navegación desde que se recibieron los pasos: los `#el-N` del plan
   * pertenecen al documento anterior y hay que volver a pedirlos.
   */
  planStale: boolean;
  stepCount: number;
  lastOutcome: StepOutcome;
  message?: string | undefined;
  retry?: 'options' | 'next' | undefined;
}

export type GuideEvent =
  | { type: 'ANALYZE'; goal?: string | undefined }
  | { type: 'OPTIONS'; options: PageOption[] }
  | { type: 'SELECT'; optionId: string }
  | { type: 'SHOWN'; elementId: string }
  | { type: 'OUTCOME'; outcome: Exclude<StepOutcome, 'none'> }
  | { type: 'REQUEST_NEXT' }
  | { type: 'NEXT'; response: Pick<NextStepResponse, 'steps' | 'done'> }
  | { type: 'NAVIGATED' }
  | { type: 'FAILED'; message: string }
  | { type: 'RETRY' }
  | { type: 'BACK' }
  | { type: 'EXIT' };

export const initialState: GuideState = {
  phase: 'idle',
  options: [],
  plan: [],
  completed: [],
  planStale: false,
  stepCount: 0,
  lastOutcome: 'none',
};

/** Fases en las que hay una solicitud al servidor en curso. */
export const PENDING_PHASES: ReadonlySet<Phase> = new Set(['analyzing', 'guiding']);

const NO_OPTIONS_MESSAGE = 'No encontré tareas claras en esta página. Podés seguir navegando o volver al inicio.';
const NO_STEP_MESSAGE = 'No encuentro cómo seguir desde esta página. Podés elegir otra tarea o abrirla en tu navegador.';
const DONE_MESSAGE = 'Listo, terminaste. Si no es lo que buscabas, tocá «Elegir otra tarea».';

export function transition(state: GuideState, event: GuideEvent): GuideState {
  switch (event.type) {
    case 'ANALYZE':
      return { ...initialState, phase: 'analyzing', goal: event.goal ?? state.goal };

    case 'OPTIONS': {
      if (state.phase !== 'analyzing') return state;
      const options = uniqueOptions(event.options);
      if (options.length === 0) return { ...state, phase: 'unsupported', message: NO_OPTIONS_MESSAGE };
      return { ...state, phase: 'choosing', options, message: undefined };
    }

    case 'SELECT': {
      if (state.phase !== 'choosing') return state;
      const option = state.options.find((o) => o.id === event.optionId);
      if (!option) return state;
      const [first, ...plan] = option.steps;
      const base: GuideState = { ...state, option, plan, completed: [], planStale: false, stepCount: 0, lastOutcome: 'none', message: undefined };
      // Paso teórico al empezar: se resuelve con el HTML actual.
      return first!.element === null ? { ...base, phase: 'guiding', step: first } : { ...base, phase: 'waitingForUser', step: first, stepCount: 1 };
    }

    case 'SHOWN':
      if (state.phase !== 'waitingForUser' || !state.step) return state;
      return { ...state, step: { ...state.step, targetElementId: event.elementId } };

    case 'OUTCOME': {
      if (state.phase !== 'waitingForUser' || !state.step) return state;
      const progressed = event.outcome === 'signalObserved' || event.outcome === 'userConfirmed';
      // Un paso real que no se pudo mostrar o falló se vuelve a pedir con el HTML actual.
      if (!progressed || state.step.element === null) return { ...state, phase: 'verifying', lastOutcome: event.outcome };
      return advance({ ...state, lastOutcome: event.outcome, completed: [...state.completed, withoutTarget(state.step)] });
    }

    case 'REQUEST_NEXT':
      if (state.phase !== 'verifying') return state;
      return { ...state, phase: 'guiding' };

    case 'NEXT': {
      if (state.phase !== 'guiding') return state;
      const { steps, done } = event.response;
      const base = { ...state, completed: [], planStale: false, message: undefined };
      if (done) return { ...base, phase: 'completed', step: undefined, plan: [], message: DONE_MESSAGE };
      const [first, ...plan] = steps;
      if (!first) return { ...base, phase: 'unsupported', step: undefined, plan: [], message: NO_STEP_MESSAGE };
      // Aun si sigue siendo teórico, se muestra la instrucción y se espera la acción
      // de la persona antes de volver a pedir (evita llamadas en bucle).
      return { ...base, phase: 'waitingForUser', step: first, plan, stepCount: state.stepCount + 1 };
    }

    case 'NAVIGATED': {
      if (state.phase === 'idle' || state.phase === 'completed') return state;
      if (!state.option) return transition(state, { type: 'ANALYZE' });
      const stale = { ...state, planStale: true };
      if (state.phase !== 'waitingForUser' || !state.step) return stale;
      if (state.step.waitFor === 'userConfirmation') return { ...stale, phase: 'verifying', lastOutcome: 'targetStale' };
      return transition(stale, { type: 'OUTCOME', outcome: 'signalObserved' });
    }

    case 'FAILED': {
      if (state.phase === 'idle') return state;
      return { ...state, phase: 'error', message: event.message, retry: state.option ? 'next' : 'options' };
    }

    case 'RETRY':
      if (state.phase !== 'error') return state;
      if (state.retry === 'next' && state.option && state.step) return { ...state, phase: 'verifying', message: undefined, retry: undefined };
      return transition(state, { type: 'ANALYZE' });

    case 'BACK':
      if (state.phase === 'idle') return state;
      if (state.options.length === 0) return transition(state, { type: 'ANALYZE' });
      return { ...initialState, phase: 'choosing', goal: state.goal, options: state.options };

    case 'EXIT':
      return initialState;
  }
}

/** Pasa al siguiente paso del plan, o pide /v1/next-step si es teórico o quedó viejo. */
function advance(state: GuideState): GuideState {
  const [next, ...plan] = state.plan;
  if (!next) {
    // Plan agotado. Si hubo navegación la tarea puede seguir: se le pregunta al backend.
    if (state.planStale && state.step) return { ...state, phase: 'verifying' };
    return { ...state, phase: 'completed', step: undefined, message: DONE_MESSAGE };
  }
  if (next.element === null || state.planStale) return { ...state, phase: 'verifying', step: next, plan };
  return { ...state, phase: 'waitingForUser', step: next, plan, stepCount: state.stepCount + 1 };
}

function withoutTarget({ targetElementId: _, ...step }: ActiveStep): GuideStep {
  return step;
}

/** Paso tal como lo espera el backend en `expectedStep`. */
export function expectedStep(step: ActiveStep): GuideStep {
  return withoutTarget(step);
}

function uniqueOptions(options: readonly PageOption[]): PageOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id) || option.steps.length === 0) return false;
    seen.add(option.id);
    return true;
  });
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
 * esperara exactamente esa interacción sobre el elemento señalado. Un paso
 * teórico (sin elemento) solo avanza con navegación o confirmación.
 */
export function evaluateObservation(step: ActiveStep, observation: Observation): Exclude<StepOutcome, 'none'> | null {
  switch (observation.kind) {
    case 'validationError':
      return 'validationError';
    case 'userConfirmation':
      return 'userConfirmed';
    case 'navigation':
      return step.waitFor === 'userConfirmation' && step.element !== null ? 'targetStale' : 'signalObserved';
    case 'pageChange':
      if (step.element === null) return null;
      return observation.targetPresent ? null : 'targetStale';
    case 'interaction':
      return step.waitFor === 'userInteraction' && step.targetElementId !== undefined && observation.elementId === step.targetElementId
        ? 'signalObserved'
        : null;
  }
}
