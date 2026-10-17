/**
 * Orquestador local de la guía. Despacha eventos a la máquina de estados de
 * @asistente/guidance y ejecuta los efectos de cada fase: extraer, pedir
 * opciones o siguiente paso a POST /v1/options, mostrar y verificar.
 *
 * El backend guarda el historial en una sesión (`sessionId`). Una navegación o
 * un cambio de fase invalida el trabajo anterior por época.
 */
import { randomUUID } from 'node:crypto';
import type { OptionsResponse } from '@hackaton/contracts';
import { snapshotToHtml, type PageSnapshot } from '@asistente/page-analyzer';
import { evaluateObservation, initialState, transition, type GuideEvent, type GuideState, type Observation } from '@asistente/guidance';
import { ApiFailure, isAbort, userMessage, type ApiClient } from './api/client';
import { log } from './log';
import type { ExtractedPage, ShownTarget } from './page-bridge';

export interface PagePort {
  extract(pageId: string, navigationId: string, revision: number): Promise<ExtractedPage>;
  show(navigationId: string, selector: string, scroll: boolean): Promise<ShownTarget>;
  clear(): void;
  cancelPending(): void;
}

export interface AssistantDeps {
  api: ApiClient;
  page: PagePort;
  onChange(): void;
}

/** Máximo de pasos seguidos sin poder señalar el destino antes de abandonar. */
const MAX_UNSHOWN_STEPS = 3;
const MAX_STEPS = 60;

export class Assistant {
  state: GuideState = initialState;
  targetVisible: boolean | null = null;
  partialPage = false;
  announceKey = 0;

  #pageId = shortId();
  #navigationSeq = 0;
  #navigationId = 'nav-0';
  #revision = 0;
  #snapshot: PageSnapshot | undefined;
  #epoch = 0;
  #controller: AbortController | undefined;
  #pendingGoal: string | undefined;
  #sessionId: string | undefined;
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
    this.#dispatch({ type: 'OUTCOME', outcome: 'userConfirmed' });
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
    if (phase !== 'waitingForUser' || !step) return;
    const outcome = evaluateObservation(step, observation);
    if (outcome) this.#dispatch({ type: 'OUTCOME', outcome });
  }

  #dispatch(event: GuideEvent): void {
    const previous = this.state;
    const next = transition(previous, event);
    if (next === previous) return;
    this.state = next;
    if (event.type === 'SHOWN') return;
    log('guide.transition', { from: `phase:${previous.phase}`, to: `phase:${next.phase}`, steps: next.stepCount });

    const epoch = this.#invalidate();
    if (next.phase !== 'waitingForUser') {
      this.targetVisible = null;
      this.deps.page.clear();
    }
    if (next.phase === 'analyzing' || next.phase === 'idle') {
      this.#unshown = 0;
      // Página nueva sin tarea elegida: el backend crea otra sesión.
      this.#sessionId = undefined;
    }
    this.deps.onChange();

    switch (next.phase) {
      case 'analyzing':
      case 'guiding':
        void this.#request(epoch);
        break;
      case 'verifying':
        void this.#runVerify(epoch);
        break;
      case 'waitingForUser':
        void this.#showStep(epoch);
        break;
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

  /** Opciones (fase analyzing) o próximo paso (fase guiding): mismo endpoint. */
  async #request(epoch: number): Promise<void> {
    try {
      const snapshot = this.state.phase === 'guiding' && this.#snapshot ? this.#snapshot : await this.#extract(epoch);
      if (!snapshot || epoch !== this.#epoch) return;
      if (this.state.stepCount >= MAX_STEPS) {
        this.#dispatch({ type: 'FAILED', message: 'La guía se extendió demasiado. Podés volver a las opciones o al inicio.' });
        return;
      }
      const response = await this.#callOptions(snapshotToHtml(snapshot), this.state.option?.id);
      if (epoch !== this.#epoch) return;
      this.#sessionId = response.sessionId;
      this.#dispatch({ type: 'RESPONSE', response });
    } catch (error) {
      this.#fail(epoch, error);
    }
  }

  async #callOptions(html: string, goal: string | undefined): Promise<OptionsResponse> {
    const signal = this.#signal();
    const request = { html, ...(goal ? { goal } : {}) };
    if (!this.#sessionId) return this.deps.api.options(request, signal);
    try {
      return await this.deps.api.options({ ...request, sessionId: this.#sessionId }, signal);
    } catch (error) {
      // Sesión vencida o reiniciada en el servidor: se empieza otra con el mismo objetivo.
      if (!(error instanceof ApiFailure) || error.code !== 'SESSION_NOT_FOUND') throw error;
      this.#sessionId = undefined;
      return this.deps.api.options(request, signal);
    }
  }

  async #runVerify(epoch: number): Promise<void> {
    try {
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
    const { result, elementId } = await this.deps.page.show(this.#navigationId, step.element, step.presentation === 'scrollAndHighlight');
    if (epoch !== this.#epoch) return;
    // Sin ID local no se puede verificar la interacción: se trata como no señalado.
    const shown = result === 'shown' && elementId !== undefined;
    this.targetVisible = shown;
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

  #fail(epoch: number, error: unknown): void {
    if (epoch !== this.#epoch || isAbort(error)) return;
    const code = error instanceof ApiFailure ? error.code : 'internal';
    log('guide.failed', { code: `code:${code}` });
    this.#dispatch({ type: 'FAILED', message: userMessage(error) });
  }
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}
