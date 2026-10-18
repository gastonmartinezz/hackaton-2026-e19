/**
 * Orquestador local de la guía. Despacha eventos a la máquina de estados de
 * @asistente/guidance y ejecuta los efectos de cada fase: extraer, pedir
 * opciones (POST /v1/options) o pasos reales (POST /v1/next-step), mostrar y
 * verificar.
 *
 * La sesión del backend es la misma del chat (`ApiSession`). Una navegación o
 * un cambio de fase invalida el trabajo anterior por época.
 *
 * Datos de formularios: si el paso pide un dato (`step.field`) y no es
 * sensible, Guíame lo pregunta y escribe lo que la persona dicta (`fill`); la
 * persona lo revisa y confirma. Si es sensible, solo pone el cursor en el
 * lugar. El valor nunca se guarda, nunca va al backend y nunca se registra.
 */
import { randomUUID } from 'node:crypto';
import { Limits, type GuideStep, type Metadata, type OptionsResponse } from '@hackaton/contracts';
import { snapshotToHtml, type PageSnapshot } from '@asistente/page-analyzer';
import {
  evaluateObservation,
  expectedStep,
  initialState,
  isSensitiveField,
  isSensitiveStep,
  type InteractionKind,
  transition,
  type GuideEvent,
  type GuideState,
  type Observation,
  type StepTarget,
} from '@asistente/guidance';
import { ApiFailure, isAbort, userMessage, type ApiClient, type ApiSession } from './api/client';
import { pastTense } from './done-steps';
import { log } from './log';
import type { FillResult, TargetRect } from '../shared/ipc';
import type { ExtractedPage, ShownTarget } from './page-bridge';

export interface PagePort {
  extract(pageId: string, navigationId: string, revision: number): Promise<ExtractedPage>;
  show(navigationId: string, selector: string, scroll: boolean): Promise<ShownTarget>;
  /** Escribe lo dictado en un lugar ya señalado (nunca en uno sensible). */
  fill(navigationId: string, elementId: string, value: string): Promise<FillResult>;
  /** Pone el cursor en el lugar para que la persona escriba. */
  focus(navigationId: string, elementId: string): void;
  clear(): void;
  cancelPending(): void;
}

export interface AssistantDeps {
  api: ApiClient;
  session: ApiSession;
  page: PagePort;
  onChange(): void;
  /** Espera antes de leer la página después de una interacción (el DOM cambia de forma asíncrona). */
  settleMs?: number;
  /** Cuánto se espera a que cargue una navegación que empezó después de un clic (NAVIGATION_WATCHDOG_MS). */
  navigationWatchdogMs?: number;
  /**
   * Espera después de un clic antes de mostrar (y leer en voz alta) el paso
   * siguiente: si el clic cambia de página, no se empieza a leer algo que la
   * navegación corta enseguida.
   */
  afterClickMs?: number;
}

/** Máximo de pasos seguidos sin poder señalar el destino antes de abandonar. */
const MAX_UNSHOWN_STEPS = 3;
const MAX_STEPS = 60;
/** «Ya hiciste» muestra solo los últimos pasos para no empujar la instrucción actual. */
const MAX_DONE = 4;
/**
 * Después de un clic que empezó a cambiar de página, cuánto se espera a que
 * cargue antes de dar la navegación por cancelada (por ejemplo, una descarga)
 * y mostrar el paso siguiente.
 */
const NAVIGATION_WATCHDOG_MS = 8000;

export class Assistant {
  state: GuideState = initialState;
  targetVisible: boolean | null = null;
  /** «Ya hiciste»: la opción elegida y los pasos hechos, en pasado. */
  done: string[] = [];
  /** Cita de la página que prueba que la tarea terminó; sin ella no se dice «Listo». */
  evidence: string | null = null;
  /** Dónde quedó el control señalado en la vista del sitio, y si es un campo. */
  target: { rect: TargetRect | undefined; field: boolean } | null = null;
  partialPage = false;
  announceKey = 0;
  /** Dato del formulario que pide el paso actual (sin el valor). */
  ask: { question: string; mode: 'dictate' | 'type'; filled: boolean } | null = null;
  /** Después de un clic: se espera un instante por si la página cambia antes de mostrar el paso siguiente. */
  settling = false;
  /**
   * La indicación actual está pausada: pide ingresar datos o confirmar algo y
   * la protección de sitios detectó riesgo alto en esta navegación.
   */
  paused = false;
  #riskHold = false;

  /** Cambia con cada solicitud nueva (otra página, otro paso, otro recorrido): identifica qué se está mostrando. */
  get epoch(): number {
    return this.#epoch;
  }

  #pageId = shortId();
  #navigationSeq = 0;
  #navigationId = 'nav-0';
  #revision = 0;
  #snapshot: PageSnapshot | undefined;
  #epoch = 0;
  /** Cada #showStep toma un número; solo la última invocación aplica su resultado (pausa por riesgo, «Repetir»). */
  #showGeneration = 0;
  /** Lo que hizo la persona mientras se esperaba después de un clic: se revisa contra el paso siguiente al mostrarlo. */
  #heldObservations: Observation[] = [];
  #watchdog: NodeJS.Timeout | undefined;
  #controller: AbortController | undefined;
  #pendingGoal: string | undefined;
  /** Sesión en la que se pidieron las opciones de la guía actual. */
  #guideSessionId: string | undefined;
  #unshown = 0;
  #pageReady = false;

  constructor(private readonly deps: AssistantDeps) {}

  /* ------------------------- Entradas desde la app ------------------------- */

  /** Se abrirá un destino elegido en el chat: al cargar, analizar con ese objetivo. */
  expectDestination(goal: string): void {
    this.#pendingGoal = goal;
  }

  /** `request`: lo que la persona pidió con sus palabras y no estaba entre las opciones (se investiga y se empieza solo). */
  analyze(goal?: string, request?: string): void {
    this.#dispatch({ type: 'ANALYZE', goal, request });
  }

  select(optionId: string): void {
    this.#dispatch({ type: 'SELECT', optionId });
  }

  confirmDone(): void {
    // Durante la espera después de un clic el paso actual todavía no se mostró: la confirmación era del anterior.
    if (this.paused || this.settling) return;
    this.#dispatch({ type: 'OUTCOME', outcome: 'userConfirmed' });
  }

  /** «Todavía no» después de terminar: se vuelve a mirar la página. */
  resume(): void {
    this.evidence = null;
    this.#dispatch({ type: 'RESUME' });
  }

  retry(): void {
    this.#dispatch({ type: 'RETRY' });
  }

  back(): void {
    this.#dispatch({ type: 'BACK' });
  }

  exit(): void {
    this.#pendingGoal = undefined;
    this.#dispatch({ type: 'EXIT' });
  }

  /**
   * Riesgo alto en la página (protección de sitios): se pausan las indicaciones
   * que invitan a ingresar datos o confirmar operaciones. Al levantarse, la
   * indicación actual se vuelve a mostrar.
   */
  setRiskHold(hold: boolean): void {
    if (this.#riskHold === hold) return;
    this.#riskHold = hold;
    if (this.state.phase !== 'waitingForUser' || !this.state.step) return;
    if (hold || this.paused) void this.#showStep(this.#epoch);
  }

  /** Vuelve a mostrar y anunciar la indicación actual. */
  repeat(): void {
    if (this.state.phase !== 'waitingForUser' || !this.state.step || this.settling) return;
    this.announceKey++;
    void this.#showStep(this.#epoch);
    this.deps.onChange();
  }

  /**
   * Escribe en la página lo que la persona dictó para el dato del paso actual.
   * Solo si el paso pide dictar (no sensible) y sigue siendo el mismo.
   */
  async fill(said: string): Promise<FillResult | 'notAllowed'> {
    const { phase, step } = this.state;
    const elementId = step?.targetElementId;
    if (phase !== 'waitingForUser' || !step || !elementId || this.ask?.mode !== 'dictate' || this.paused || this.settling) return 'notAllowed';
    const epoch = this.#epoch;
    const result = await this.deps.page.fill(this.#navigationId, elementId, said);
    // Mientras se escribía, la persona pudo elegir «Lo escribo yo»: no se marca como dictado.
    if (epoch !== this.#epoch || this.state.step !== step || this.ask?.mode !== 'dictate') return 'notAllowed';
    log('guide.field_dictated', { result: `code:${result}` });
    if (result === 'filled') {
      this.ask = { ...this.ask, filled: true };
      this.deps.onChange();
    } else if (result === 'refused') {
      // El preload vio un dato sensible: lo escribe la persona.
      this.typeMyself();
    }
    return result;
  }

  /** «Lo escribo yo» (o un dato sensible): se deja de dictar y el cursor queda en el lugar. */
  typeMyself(): void {
    const elementId = this.state.step?.targetElementId;
    if (this.state.phase !== 'waitingForUser' || !this.ask || !elementId) return;
    this.ask = { ...this.ask, mode: 'type', filled: false };
    this.deps.page.focus(this.#navigationId, elementId);
    this.deps.onChange();
  }

  /* ------------------------ Entradas desde la página ----------------------- */

  navigationStarted(): void {
    this.#pageReady = false;
    this.#invalidate();
    this.targetVisible = null;
    this.target = null;
    // Si la navegación no termina ni falla (una descarga cancelada), no se queda en «fijándome».
    if (this.settling) {
      clearTimeout(this.#watchdog);
      this.#watchdog = setTimeout(() => this.loadFailed(), this.deps.navigationWatchdogMs ?? NAVIGATION_WATCHDOG_MS);
    }
  }

  /**
   * La página no terminó de cargar (error o carga cancelada). Si el paso
   * siguiente estaba en espera por el clic, se muestra: no hubo cambio de página.
   */
  loadFailed(): void {
    clearTimeout(this.#watchdog);
    if (!this.settling || this.state.phase !== 'waitingForUser') return;
    this.settling = false;
    this.#pageReady = true;
    void this.#showStep(this.#invalidate());
  }

  navigated({ sameDocument, aiEnabled }: { sameDocument: boolean; aiEnabled: boolean }): void {
    clearTimeout(this.#watchdog);
    this.#navigationId = `nav-${++this.#navigationSeq}`;
    this.#revision = 0;
    this.#snapshot = undefined;
    this.#pageReady = true;
    this.partialPage = false;
    if (sameDocument) this.deps.page.clear();

    if (!aiEnabled) {
      this.#pendingGoal = undefined;
      this.#dispatch({ type: 'EXIT' });
      return;
    }
    if (this.#pendingGoal !== undefined) {
      const goal = this.#pendingGoal;
      this.#pendingGoal = undefined;
      this.#dispatch({ type: 'ANALYZE', goal });
      return;
    }
    this.#dispatch({ type: 'NAVIGATED' });
  }

  pageChanged({ structural, targetPresent }: { structural: boolean; targetPresent: boolean | null }): void {
    const { phase, step } = this.state;
    if (phase !== 'waitingForUser' || !step) return;
    // Cambios solo de atributos (animaciones, estilos) no cuentan como avance
    // salvo que el destino haya desaparecido.
    if (!structural && targetPresent !== false) return;
    this.#observe({ kind: 'pageChange', targetPresent: targetPresent ?? false });
  }

  interaction(elementId: string, event?: InteractionKind): void {
    this.#observe({ kind: 'interaction', elementId, event });
  }

  validationError(): void {
    this.#observe({ kind: 'validationError' });
  }

  /* -------------------------------- Interno -------------------------------- */

  #observe(observation: Observation): void {
    const { phase, step } = this.state;
    if (phase !== 'waitingForUser' || !step || this.paused) return;
    if (this.settling) {
      // El paso siguiente todavía no se mostró: lo que haga la persona se revisa cuando aparezca.
      this.#heldObservations.push(observation);
      return;
    }
    const outcome = evaluateObservation(step, observation);
    if (outcome) this.#dispatch({ type: 'OUTCOME', outcome });
  }

  #dispatch(event: GuideEvent): void {
    const previous = this.state;
    const next = transition(previous, event);
    if (next === previous) return;
    this.state = next;
    this.#trackDone(previous, next, event);
    if (event.type === 'SHOWN') return;
    log('guide.transition', { from: `phase:${previous.phase}`, to: `phase:${next.phase}`, steps: next.stepCount });

    const epoch = this.#invalidate();
    this.paused = false;
    this.settling = false;
    this.#heldObservations = [];
    this.ask = null;
    if (next.phase !== 'waitingForUser') {
      this.targetVisible = null;
      this.target = null;
      this.deps.page.clear();
    }
    if (next.phase === 'analyzing' || next.phase === 'idle') this.#unshown = 0;
    this.deps.onChange();

    switch (next.phase) {
      case 'analyzing':
        void this.#runOptions(epoch);
        break;
      case 'guiding':
        void this.#runNext(epoch);
        break;
      case 'verifying':
        void this.#runVerify(epoch);
        break;
      case 'waitingForUser':
        // Después de un clic, el paso siguiente se muestra (y se lee) solo si la página no cambió.
        if (event.type === 'OUTCOME' && event.outcome === 'signalObserved') void this.#settleThenShow(epoch);
        else void this.#showStep(epoch);
        break;
    }
  }

  async #settleThenShow(epoch: number): Promise<void> {
    this.settling = true;
    this.#heldObservations = [];
    this.deps.page.clear();
    this.deps.onChange();
    await new Promise((resolve) => setTimeout(resolve, this.deps.afterClickMs ?? 900));
    // Una navegación (o cualquier otro cambio) ya decidió qué sigue.
    if (epoch !== this.#epoch || !this.#pageReady) return;
    this.settling = false;
    await this.#showStep(epoch);
  }

  /** Lleva la lista de «Ya hiciste». Nunca incluye valores: solo instrucciones y títulos. */
  #trackDone(previous: GuideState, next: GuideState, event: GuideEvent): void {
    if (event.type === 'ANALYZE' || event.type === 'EXIT' || event.type === 'BACK' || next.phase === 'idle' || next.phase === 'analyzing') {
      this.done = [];
      this.evidence = null;
      return;
    }
    if (event.type === 'SELECT' && next.option) {
      this.done = [`Elegiste «${next.option.title}»`];
      return;
    }
    if (event.type !== 'OUTCOME' && event.type !== 'NAVIGATED') return;
    const progressed = next.lastOutcome === 'signalObserved' || next.lastOutcome === 'userConfirmed';
    const moved = next.phase !== 'waitingForUser' || next.step !== previous.step;
    if (previous.phase === 'waitingForUser' && previous.step && progressed && moved) {
      this.done = [...this.done, pastTense(previous.step.instruction)].slice(-MAX_DONE);
    }
  }

  /** Cancela solicitudes en curso y devuelve la nueva época. */
  #invalidate(): number {
    this.#controller?.abort();
    this.#controller = undefined;
    this.deps.page.cancelPending();
    return ++this.#epoch;
  }

  #signal(): AbortSignal {
    this.#controller = new AbortController();
    return this.#controller.signal;
  }

  async #extract(epoch: number): Promise<PageSnapshot | undefined> {
    if (!this.#pageReady) return undefined;
    const revision = ++this.#revision;
    const { snapshot, notes } = await this.deps.page.extract(this.#pageId, this.#navigationId, revision);
    if (epoch !== this.#epoch) return undefined;
    this.#snapshot = snapshot;
    this.partialPage = snapshot.extraction === 'partial';
    log('page.extracted', { elements: snapshot.elements.length, partial: this.partialPage, notes: notes.length });
    return snapshot;
  }

  async #runOptions(epoch: number): Promise<void> {
    try {
      const snapshot = await this.#extract(epoch);
      if (!snapshot || epoch !== this.#epoch) return;
      const asked = this.state.request;
      const request = { html: snapshotToHtml(snapshot), ...metadataOf(snapshot), ...goalOf(this.state.goal), ...(asked ? { request: asked } : {}) };
      const signal = this.#signal();
      const { session, api } = this.deps;
      let ticket = session.begin();
      let response: OptionsResponse;
      try {
        response = await api.options(ticket.id ? { ...request, sessionId: ticket.id } : request, signal);
      } catch (error) {
        // Sesión vencida o servidor reiniciado: se empieza otra.
        if (!(error instanceof ApiFailure) || error.code !== 'SESSION_NOT_FOUND') throw error;
        ticket = ticket.expire();
        response = await api.options(ticket.id ? { ...request, sessionId: ticket.id } : request, signal);
      }
      if (epoch !== this.#epoch) return;
      ticket.commit(response.sessionId);
      // Las opciones existen en esta sesión: /v1/next-step usa la misma, aunque
      // la compartida haya cambiado mientras tanto.
      this.#guideSessionId = response.sessionId;
      this.#dispatch({ type: 'OPTIONS', options: response.options, requested: response.requestedOptionId });
    } catch (error) {
      this.#fail(epoch, error);
    }
  }

  /** Paso teórico (o que no se pudo mostrar): pasos reales con el HTML actual. */
  async #runNext(epoch: number): Promise<void> {
    const sessionId = this.#guideSessionId;
    const ticket = this.deps.session.begin();
    try {
      const { option, step, completed, stepCount } = this.state;
      if (!option || !step) return;
      if (stepCount >= MAX_STEPS) {
        this.#dispatch({ type: 'FAILED', message: 'La guía se extendió demasiado. Podés volver a las opciones o al inicio.' });
        return;
      }
      if (!sessionId) {
        // Sin sesión el backend no conoce la opción elegida: se vuelve a analizar.
        this.#dispatch({ type: 'ANALYZE' });
        return;
      }
      const snapshot = this.#snapshot ?? (await this.#extract(epoch));
      if (!snapshot || epoch !== this.#epoch) return;
      const response = await this.deps.api.nextStep(
        { sessionId, optionId: option.id, expectedStep: expectedStep(step), completedSteps: completed, html: snapshotToHtml(snapshot), ...metadataOf(snapshot) },
        this.#signal(),
      );
      if (epoch !== this.#epoch) return;
      // El backend devuelve la sesión en cada respuesta: la siguiente llamada usa esa.
      this.#guideSessionId = response.sessionId;
      if (ticket.id === sessionId) ticket.commit(response.sessionId);
      this.evidence = response.done ? (response.evidence ?? null) : null;
      this.#dispatch({ type: 'NEXT', response });
    } catch (error) {
      if (epoch === this.#epoch && error instanceof ApiFailure && error.code === 'SESSION_NOT_FOUND') {
        // La sesión venció: la opción elegida ya no existe en el backend.
        log('guide.session_lost');
        this.#guideSessionId = undefined;
        if (ticket.id === sessionId) ticket.expire();
        // Se vuelve a analizar con la sesión vigente (la de otra solicitud, si la hay).
        this.#dispatch({ type: 'ANALYZE' });
        return;
      }
      this.#fail(epoch, error);
    }
  }

  async #runVerify(epoch: number): Promise<void> {
    try {
      // Después de una interacción la página suele cambiar un instante después.
      if (this.state.lastOutcome === 'signalObserved' || this.state.lastOutcome === 'userConfirmed') {
        await new Promise((resolve) => setTimeout(resolve, this.deps.settleMs ?? 600));
        if (epoch !== this.#epoch) return;
      }
      const snapshot = await this.#extract(epoch);
      if (!snapshot) return;
      this.#dispatch({ type: 'REQUEST_NEXT' });
    } catch (error) {
      this.#fail(epoch, error);
    }
  }

  async #showStep(epoch: number): Promise<void> {
    const step = this.state.step;
    if (!step) return;
    const generation = ++this.#showGeneration;
    this.ask = null;
    this.paused = this.#riskHold && isSensitiveStep(step, this.#targetOf(step.element));
    if (this.paused) {
      // No se señala ni se espera la acción: la persona decide desde el panel.
      this.targetVisible = null;
      this.target = null;
      this.deps.page.clear();
      log('guide.paused_for_risk');
      this.deps.onChange();
      return;
    }
    if (step.element === null) {
      // Paso teórico: solo la instrucción; se espera la acción de la persona.
      this.targetVisible = null;
      this.target = null;
      this.deps.page.clear();
      this.deps.onChange();
      return;
    }
    const { result, elementId, rect, field, fillable, sensitive } = await this.deps.page.show(this.#navigationId, step.element, step.presentation === 'scrollAndHighlight');
    // Otra invocación posterior (por ejemplo, la pausa por riesgo alto) ya decidió qué mostrar.
    if (epoch !== this.#epoch || generation !== this.#showGeneration) return;
    // Sin ID local no se puede verificar la interacción: se trata como no señalado.
    const shown = result === 'shown' && elementId !== undefined;
    this.targetVisible = shown;
    this.target = shown ? { rect, field: field ?? false } : null;
    if (shown) {
      this.#unshown = 0;
      this.#dispatch({ type: 'SHOWN', elementId, field });
      this.ask = this.#askFor(step, elementId, { fillable: fillable ?? false, sensitive: sensitive ?? false });
      this.deps.onChange();
      // Lo que la persona ya hizo sobre este control mientras se esperaba cuenta ahora.
      const held = this.#heldObservations.filter((o) => o.kind === 'interaction' || o.kind === 'validationError');
      this.#heldObservations = [];
      for (const observation of held) this.#observe(observation);
      return;
    }
    // Selector que no encuentra nada o destino invisible: se pide un nuevo paso.
    if (++this.#unshown > MAX_UNSHOWN_STEPS) {
      this.#dispatch({ type: 'FAILED', message: 'No logro señalarte el lugar en esta página. Probá desplazarte o tocá «Reintentar».' });
      return;
    }
    this.#dispatch({ type: 'OUTCOME', outcome: result === 'stale' ? 'targetStale' : 'targetNotVisible' });
  }

  /**
   * Cómo se pide el dato del paso: se dicta solo si el backend, el rótulo de la
   * página y los atributos del sitio coinciden en que no es sensible y Guíame
   * puede escribir en ese lugar. Si es sensible, se pone el cursor ahí.
   */
  #askFor(step: GuideStep, elementId: string, local: { fillable: boolean; sensitive: boolean }): Assistant['ask'] {
    if (!step.field) return null;
    const target = this.#targetOf(step.element);
    const sensitive = step.field.sensitive || local.sensitive || isSensitiveField({ label: target?.label, inputType: target?.inputType });
    if (sensitive) {
      this.deps.page.focus(this.#navigationId, elementId);
      return { question: step.field.question, mode: 'type', filled: false };
    }
    return local.fillable ? { question: step.field.question, mode: 'dictate', filled: false } : null;
  }

  /** Rol del destino según el snapshot local (solo selectores `#el-N`). */
  #targetOf(selector: string | null): (StepTarget & { label: string }) | undefined {
    const id = selector?.match(/^#(el-\d+)$/)?.[1];
    const elements = this.#snapshot?.elements;
    const element = id ? elements?.find((e) => e.id === id) : undefined;
    if (!element) return undefined;
    const section = element.sectionId ? elements?.find((e) => e.id === element.sectionId) : undefined;
    return { role: element.role, label: element.label, inputType: element.inputType, inForm: section?.role === 'form' };
  }

  #fail(epoch: number, error: unknown): void {
    if (epoch !== this.#epoch || isAbort(error)) return;
    const code = error instanceof ApiFailure ? error.code : 'internal';
    log('guide.failed', { code: `code:${code}` });
    this.#dispatch({ type: 'FAILED', message: userMessage(error) });
  }
}

function metadataOf(snapshot: PageSnapshot): { metadata?: Metadata } {
  const page = { ...(snapshot.title ? { title: snapshot.title } : {}), ...(snapshot.language ? { language: snapshot.language } : {}) };
  return Object.keys(page).length > 0 ? { metadata: { page } } : {};
}

/** Objetivo de la guía (del chat o de «¿No está lo que buscás?»). Vacío no se envía: el contrato exige texto. */
function goalOf(goal: string | undefined): { goal?: string } {
  const text = goal?.trim().slice(0, Limits.maxMessageLength).trim();
  return text ? { goal: text } : {};
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}
