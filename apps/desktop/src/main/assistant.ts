/**
 * Orquestador local de la guía. Despacha eventos a la máquina de estados de
 * @asistente/guidance y ejecuta los efectos de cada fase: extraer, pedir
 * opciones (POST /v1/options) o pasos reales (POST /v1/next-step), mostrar y
 * verificar.
 *
 * La sesión del backend es la misma del chat (`ApiSession`). Una navegación o
 * un cambio de fase invalida el trabajo anterior por época.
 */
import { randomUUID } from 'node:crypto';
import type { Metadata, OptionsResponse } from '@hackaton/contracts';
import { snapshotToHtml, type PageSnapshot } from '@asistente/page-analyzer';
import {
  evaluateObservation,
  expectedStep,
  initialState,
  isSensitiveStep,
  transition,
  type GuideEvent,
  type GuideState,
  type Observation,
  type StepTarget,
} from '@asistente/guidance';
import { ApiFailure, isAbort, userMessage, type ApiClient, type ApiSession } from './api/client';
import { nextStepEvidence } from './api/pending-contract';
import { pastTense } from './done-steps';
import { log } from './log';
import type { TargetRect } from '../shared/ipc';
import type { ExtractedPage, ShownTarget } from './page-bridge';

export interface PagePort {
  extract(pageId: string, navigationId: string, revision: number): Promise<ExtractedPage>;
  show(navigationId: string, selector: string, scroll: boolean): Promise<ShownTarget>;
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
}

/** Máximo de pasos seguidos sin poder señalar el destino antes de abandonar. */
const MAX_UNSHOWN_STEPS = 3;
const MAX_STEPS = 60;
/** «Ya hiciste» muestra solo los últimos pasos para no empujar la instrucción actual. */
const MAX_DONE = 4;

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
  /**
   * La indicación actual está pausada: pide ingresar datos o confirmar algo y
   * la protección de sitios detectó riesgo alto en esta navegación.
   */
  paused = false;
  #riskHold = false;

  #pageId = shortId();
  #navigationSeq = 0;
  #navigationId = 'nav-0';
  #revision = 0;
  #snapshot: PageSnapshot | undefined;
  #epoch = 0;
  /** Cada #showStep toma un número; solo la última invocación aplica su resultado (pausa por riesgo, «Repetir»). */
  #showGeneration = 0;
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

  analyze(goal?: string): void {
    this.#dispatch({ type: 'ANALYZE', goal });
  }

  select(optionId: string): void {
    this.#dispatch({ type: 'SELECT', optionId });
  }

  confirmDone(): void {
    if (this.paused) return;
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
    if (this.state.phase !== 'waitingForUser' || !this.state.step) return;
    this.announceKey++;
    void this.#showStep(this.#epoch);
    this.deps.onChange();
  }

  /* ------------------------ Entradas desde la página ----------------------- */

  navigationStarted(): void {
    this.#pageReady = false;
    this.#invalidate();
    this.targetVisible = null;
    this.target = null;
  }

  navigated({ sameDocument, aiEnabled }: { sameDocument: boolean; aiEnabled: boolean }): void {
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

  interaction(elementId: string): void {
    this.#observe({ kind: 'interaction', elementId });
  }

  validationError(): void {
    this.#observe({ kind: 'validationError' });
  }

  /* -------------------------------- Interno -------------------------------- */

  #observe(observation: Observation): void {
    const { phase, step } = this.state;
    if (phase !== 'waitingForUser' || !step || this.paused) return;
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
        void this.#showStep(epoch);
        break;
    }
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
      const request = { html: snapshotToHtml(snapshot), ...metadataOf(snapshot) };
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
      this.#dispatch({ type: 'OPTIONS', options: response.options });
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
      this.evidence = response.done ? nextStepEvidence(response) : null;
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
    const { result, elementId, rect, field } = await this.deps.page.show(this.#navigationId, step.element, step.presentation === 'scrollAndHighlight');
    // Otra invocación posterior (por ejemplo, la pausa por riesgo alto) ya decidió qué mostrar.
    if (epoch !== this.#epoch || generation !== this.#showGeneration) return;
    // Sin ID local no se puede verificar la interacción: se trata como no señalado.
    const shown = result === 'shown' && elementId !== undefined;
    this.targetVisible = shown;
    this.target = shown ? { rect, field: field ?? false } : null;
    if (shown) {
      this.#unshown = 0;
      this.#dispatch({ type: 'SHOWN', elementId });
      this.deps.onChange();
      return;
    }
    // Selector que no encuentra nada o destino invisible: se pide un nuevo paso.
    if (++this.#unshown > MAX_UNSHOWN_STEPS) {
      this.#dispatch({ type: 'FAILED', message: 'No logro señalarte el lugar en esta página. Probá desplazarte o tocá «Reintentar».' });
      return;
    }
    this.#dispatch({ type: 'OUTCOME', outcome: result === 'stale' ? 'targetStale' : 'targetNotVisible' });
  }

  /** Rol del destino según el snapshot local (solo selectores `#el-N`). */
  #targetOf(selector: string | null): StepTarget | undefined {
    const id = selector?.match(/^#(el-\d+)$/)?.[1];
    const elements = this.#snapshot?.elements;
    const element = id ? elements?.find((e) => e.id === id) : undefined;
    if (!element) return undefined;
    const section = element.sectionId ? elements?.find((e) => e.id === element.sectionId) : undefined;
    return { role: element.role, inputType: element.inputType, inForm: section?.role === 'form' };
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

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}
