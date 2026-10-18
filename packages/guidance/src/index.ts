/**
 * Estado y validación local de la guía (S07, S08 validación, S09 verificación).
 * Puro: sin DOM, sin red, sin Electron. El orquestador del proceso principal
 * despacha eventos y ejecuta los efectos según la fase resultante.
 *
 * Contrato: POST /v1/options devuelve cada opción con un primer borrador de
 * pasos (`steps`). Al elegirla, la guía siempre empieza por POST /v1/next-step:
 * el backend investiga cómo se hace la tarea y devuelve los pasos reales de la
 * página. Cada vez que se terminan los pasos recibidos, hay una navegación o
 * aparece un paso teórico (`element: null`), se vuelve a informar el avance a
 * /v1/next-step hasta que responde `done`. La guía nunca da la tarea por
 * terminada por su cuenta. Fases con efectos:
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
  /** El destino es un lugar para escribir o elegir: avanza cuando la persona termina (evento `change`), no con el clic. */
  targetField?: boolean | undefined;
}

export interface GuideState {
  phase: Phase;
  /** Objetivo escrito en el chat, solo para mostrar. */
  goal?: string | undefined;
  /**
   * Lo que la persona pidió con sus palabras en la página (no estaba entre las
   * opciones). Va a /v1/options; la primera opción que vuelve es esa tarea y
   * se empieza sola.
   */
  request?: string | undefined;
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
  | { type: 'ANALYZE'; goal?: string | undefined; request?: string | undefined }
  /** `requested`: la opción que hace lo que pidió la persona (solo si hubo pedido y el backend la encontró). */
  | { type: 'OPTIONS'; options: PageOption[]; requested?: string | undefined; unclear?: boolean | undefined }
  | { type: 'SELECT'; optionId: string }
  | { type: 'SHOWN'; elementId: string; field?: boolean | undefined }
  | { type: 'OUTCOME'; outcome: Exclude<StepOutcome, 'none'> }
  | { type: 'REQUEST_NEXT' }
  | { type: 'NEXT'; response: Pick<NextStepResponse, 'steps' | 'done'> }
  | { type: 'NAVIGATED' }
  | { type: 'FAILED'; message: string }
  | { type: 'RETRY' }
  | { type: 'BACK' }
  /** «Todavía no» después de terminar: se vuelve a mirar la página para ver qué falta. */
  | { type: 'RESUME' }
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
const NO_REQUEST_MESSAGE = 'No encontré cómo hacer eso en este sitio. Podés elegir otra opción o volver al inicio.';
const UNCLEAR_REQUEST_MESSAGE = 'No te entendí. Elegí una opción o decímelo de otra forma.';
const NO_STEP_MESSAGE = 'No encuentro cómo seguir desde esta página. Podés elegir otra tarea o abrirla en tu navegador.';
const DONE_MESSAGE = 'Listo, terminaste. Si no es lo que buscabas, tocá «Elegir otra tarea».';

export function transition(state: GuideState, event: GuideEvent): GuideState {
  switch (event.type) {
    case 'ANALYZE':
      return { ...initialState, phase: 'analyzing', goal: event.goal ?? state.goal, request: event.request };

    case 'OPTIONS': {
      if (state.phase !== 'analyzing') return state;
      const options = uniqueOptions(event.options);
      if (options.length === 0) return { ...state, phase: 'unsupported', request: undefined, message: state.request ? NO_REQUEST_MESSAGE : NO_OPTIONS_MESSAGE };
      const requested = state.request ? options.find((o) => o.id === event.requested) : undefined;
      // Ninguna opción hace lo pedido: se muestran las de la página, sin empezar ninguna sola.
      const message = !state.request || requested ? undefined : event.unclear ? UNCLEAR_REQUEST_MESSAGE : NO_REQUEST_MESSAGE;
      const choosing: GuideState = { ...state, phase: 'choosing', options, request: undefined, message };
      // La persona ya dijo qué quería y el backend encontró esa tarea: se empieza sola.
      return requested ? transition(choosing, { type: 'SELECT', optionId: requested.id }) : choosing;
    }

    case 'SELECT': {
      if (state.phase !== 'choosing') return state;
      const option = state.options.find((o) => o.id === event.optionId);
      if (!option) return state;
      // El borrador de /v1/options es solo el punto de partida: el backend
      // investiga el paso a paso de la opción y devuelve los pasos reales.
      const [first, ...plan] = option.steps;
      return { ...state, phase: 'guiding', option, step: first, plan, completed: [], planStale: false, stepCount: 0, lastOutcome: 'none', message: undefined };
    }

    case 'SHOWN':
      if (state.phase !== 'waitingForUser' || !state.step) return state;
      return { ...state, step: { ...state.step, targetElementId: event.elementId, targetField: event.field } };

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
      // Se conserva el último paso: si la persona dice «Todavía no», se vuelve a pedir desde ahí.
      if (done) return { ...base, phase: 'completed', plan: [], message: DONE_MESSAGE };
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
      // Un paso que nunca se llegó a señalar (la página cambió antes) no cuenta como hecho.
      const unshown = state.step.element !== null && state.step.targetElementId === undefined;
      if (state.step.waitFor === 'userConfirmation' || unshown) return { ...stale, phase: 'verifying', lastOutcome: 'targetStale' };
      return transition(stale, { type: 'OUTCOME', outcome: 'signalObserved' });
    }

    case 'FAILED': {
      if (state.phase === 'idle') return state;
      return { ...state, phase: 'error', message: event.message, retry: state.option ? 'next' : 'options' };
    }

    case 'RETRY':
      if (state.phase !== 'error') return state;
      if (state.retry === 'next' && state.option && state.step) return { ...state, phase: 'verifying', message: undefined, retry: undefined };
      // Si falló un pedido propio, se vuelve a pedir lo mismo.
      return transition(state, { type: 'ANALYZE', request: state.request });

    case 'BACK':
      if (state.phase === 'idle') return state;
      if (state.options.length === 0) return transition(state, { type: 'ANALYZE' });
      return { ...initialState, phase: 'choosing', goal: state.goal, options: state.options };

    case 'RESUME':
      if (state.phase !== 'completed' || !state.option || !state.step) return state;
      return { ...state, phase: 'verifying', planStale: true, message: undefined };

    case 'EXIT':
      return initialState;
  }
}

/** Pasa al siguiente paso del plan, o pide /v1/next-step si es teórico, quedó viejo o se terminó. */
function advance(state: GuideState): GuideState {
  const [next, ...plan] = state.plan;
  // Plan agotado: se informa el avance y el backend dice qué sigue o si terminó.
  if (!next) return { ...state, phase: 'verifying' };
  if (next.element === null || state.planStale) return { ...state, phase: 'verifying', step: next, plan };
  return { ...state, phase: 'waitingForUser', step: next, plan, stepCount: state.stepCount + 1 };
}

function withoutTarget({ targetElementId: _, targetField: __, ...step }: ActiveStep): GuideStep {
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

export type InteractionKind = 'click' | 'change' | 'input' | 'submit';

export type Observation =
  /** `event`: qué hizo la persona sobre el control (el tipo de evento, nunca el contenido). */
  | { kind: 'interaction'; elementId: string; event?: InteractionKind | undefined }
  | { kind: 'navigation' }
  | { kind: 'pageChange'; targetPresent: boolean }
  | { kind: 'validationError' }
  | { kind: 'userConfirmation' };

/**
 * Traduce una observación local en resultado del paso, o null si todavía no hay
 * evidencia suficiente. Un clic por sí solo no demuestra éxito salvo que el paso
 * esperara exactamente esa interacción sobre el elemento señalado. En un lugar
 * para escribir o elegir, el paso avanza cuando la persona termina (`change`:
 * salió del lugar después de escribir, o eligió de la lista), nunca con el clic
 * para entrar. Un paso teórico (sin elemento) solo avanza con navegación o
 * confirmación.
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
    case 'interaction': {
      if (step.targetElementId === undefined || observation.elementId !== step.targetElementId) return null;
      if (step.targetField) return observation.event === 'change' ? 'signalObserved' : null;
      return step.waitFor === 'userInteraction' ? 'signalObserved' : null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pausa por riesgo alto (protección de sitios)                        */
/* ------------------------------------------------------------------ */

/** Lo que se sabe localmente del elemento destino de un paso (del snapshot). */
export interface StepTarget {
  role: string;
  inputType?: string | undefined;
  /** El elemento está dentro de un formulario (un botón ahí envía o confirma). */
  inForm?: boolean | undefined;
}

/** Roles donde la persona ingresa o elige datos. */
const DATA_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'listbox', 'checkbox', 'radio', 'switch', 'slider']);

/** Verbos y datos que invitan a ingresar información o confirmar una operación (sin tildes). */
const SENSITIVE_INSTRUCTION =
  /\b(escrib|complet|ingres|introduc|anot|carg|pone|tipe|confirm|acept|autoriz|valid|firm|pag(?:ar|a|as|o|os|ue|ues|uen)\b|abon|transfer|envi|compr|suscrib|registr|inici(?:a|ar|e)? ?sesion|clave|contrasen|codigo|token|pin\b|tarjeta|cvv|cbu|cvu|alias|dni|documento|password|sign in|log ?in|pay|submit|enter)/;

/** Lo que se sabe de un lugar para escribir, sin su contenido. */
export interface FieldTraits {
  label?: string | undefined;
  inputType?: string | undefined;
  /** Atributos del sitio (autocomplete, name, id, placeholder): nunca el valor. */
  autocomplete?: string | undefined;
  name?: string | undefined;
}

const SENSITIVE_AUTOCOMPLETE = /\b(cc-[a-z-]+|one-time-code|current-password|new-password)\b/;

/** Claves, códigos, tarjeta, datos bancarios y documento (sin tildes, en minúsculas). */
const SENSITIVE_FIELD =
  /\b(clave\w*|contrasen\w*|password|passwd|pwd|pin|otp|token|cod(igo)? (de )?(verificacion|seguridad|acceso|confirmacion|validacion)|cod(igo)? (sms|enviado|recibido)|security code|verification code|tarjeta\w*|cvv2?|cvc|cvn|csc|vencimiento|expiracion|expiry|expiration|card|cuenta bancaria|numero de cuenta|nro de cuenta|cbu|cvu|iban|swift|cedula\w*|documento\w*|dni|ci|c i|pasaporte|passport|ssn)\b/;

function plainWords(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Indica si un lugar para escribir pide un dato sensible: claves, PIN, códigos,
 * tarjeta, datos bancarios o documento. Ahí Guíame nunca pide el dato por voz
 * ni lo escribe: solo pone el cursor y la persona lo escribe.
 */
export function isSensitiveField(field: FieldTraits): boolean {
  if (field.inputType?.toLowerCase() === 'password') return true;
  if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete.toLowerCase())) return true;
  return [field.label, field.name].some((text) => text !== undefined && SENSITIVE_FIELD.test(plainWords(text)));
}

/**
 * Acciones que no se deshacen: pagar, comprar, transferir, firmar, dar de
 * baja, eliminar o cancelar, suscribirse, donar. Sin tildes, en minúsculas.
 */
const IRREVERSIBLE_ACTION =
  /\b(pag(?:ar|a|as|o|os|ue|ues|uen|alo)?|abon\w*|compr\w*|transfer\w*|firm\w*|dar de baja|darme de baja|baja de|elimin\w*|borr\w*|cancel\w*|anul\w*|suscrib\w*|don(?:ar|a|acion)|checkout|pay|buy|purchase|delete|remove|unsubscribe|sign up)\b/;

/**
 * Barrera local para tocar un botón por la persona: aunque la IA lo haya
 * marcado como seguro (`safeToClick`), nunca se toca uno cuya instrucción o
 * rótulo hable de pagar, comprar, transferir, firmar, dar de baja o borrar.
 */
export function isIrreversibleAction(...texts: Array<string | undefined>): boolean {
  return texts.some((text) => text !== undefined && IRREVERSIBLE_ACTION.test(plainWords(text)));
}

/**
 * Indica si un paso invita a ingresar datos o confirmar una operación. Ante un
 * posible sitio de estafa estas indicaciones se pausan; las de navegación
 * («Hacé clic en Inicio») siguen. Conservador: ante la duda, pausa.
 */
export function isSensitiveStep(step: Pick<GuideStep, 'instruction'>, target?: StepTarget): boolean {
  if (target && (DATA_ROLES.has(target.role) || (target.role === 'button' && target.inForm))) return true;
  const text = step.instruction.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return SENSITIVE_INSTRUCTION.test(text);
}
