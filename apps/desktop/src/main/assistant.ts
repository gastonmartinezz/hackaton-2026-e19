/**
 * Orquestador local de la guía. Despacha eventos a la máquina de estados de
 * @asistente/guidance y ejecuta los efectos de cada fase: extraer, pedir
 * opciones o siguiente paso, validar, mostrar y verificar.
 *
 * Toda respuesta se correlaciona por requestId, navigationId y revision; una
 * navigación o un cambio de fase invalida el trabajo anterior.
 */
import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION, type PageSnapshot } from '@hackaton/contracts';
import {
  evaluateObservation,
  hasEvidence,
  initialState,
  transition,
  validateDecision,
  validateOptions,
  type GuideEvent,
  type GuideState,
  type Observation,
} from '@asistente/guidance';
import { ApiFailure, isAbort, userMessage, type ApiClient } from './api/client';
import { log } from './log';
import type { ExtractedPage } from './page-bridge';
import type { ShowResult } from '../shared/ipc';

export interface PagePort {
  extract(pageId: string, navigationId: string, revision: number): Promise<ExtractedPage>;
  show(navigationId: string, elementId: string, scroll: boolean): Promise<ShowResult>;
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
    if (phase === 'waitingForUser' && step) {
      // Cambios solo de atributos (animaciones, estilos) no cuentan como avance
      // salvo que el destino haya desaparecido.
      if (!structural && targetPresent !== false) return;
      this.#observe({ kind: 'pageChange', targetPresent: targetPresent ?? false });
    } else if (phase === 'choosing' && structural) {
      void this.#refreshOptions(this.#epoch);
    }
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
    log('guide.transition', { from: `phase:${previous.phase}`, to: `phase:${next.phase}`, steps: next.stepCount });

    const epoch = this.#invalidate();
    if (next.phase !== 'waitingForUser') {
      this.targetVisible = null;
      this.deps.page.clear();
    }
    if (next.phase === 'analyzing' || next.phase === 'idle') this.#unshown = 0;
    this.deps.onChange();

    switch (next.phase) {
      case 'analyzing':
        void this.#runAnalysis(epoch);
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

  async #runAnalysis(epoch: number): Promise<void> {
    try {
      const snapshot = await this.#extract(epoch);
      if (!snapshot) return;
      const requestId = shortId();
      const raw = await this.deps.api.pageOptions(
        { schemaVersion: SCHEMA_VERSION, requestId, goal: this.state.goal, snapshot },
        this.#signal(),
      );
      if (epoch !== this.#epoch) return;
      const result = validateOptions(raw, this.#context(requestId, snapshot));
      if (!result.ok) throw new ApiFailure('invalid_response', false, result.reason);
      const value = result.value;
      if (value.status === 'options') this.#dispatch({ type: 'OPTIONS', primary: value.primary, secondary: value.secondary });
      else this.#dispatch({ type: 'OPTIONS_MESSAGE', status: value.status, message: value.message });
    } catch (error) {
      this.#fail(epoch, error);
    }
  }

  /** Página dinámica en fase de elección: conservar opciones mientras sigan válidas. */
  async #refreshOptions(epoch: number): Promise<void> {
    try {
      const snapshot = await this.#extract(epoch);
      if (!snapshot || epoch !== this.#epoch) return;
      const ids = new Set(snapshot.elements.map((e) => e.id));
      const all = [...this.state.primary, ...this.state.secondary];
      if (all.length > 0 && all.every((option) => !hasEvidence(option, ids))) {
        this.#dispatch({ type: 'ANALYZE' });
      } else {
        this.deps.onChange();
      }
    } catch {
      // Sin cambios: se conservan las opciones.
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

  async #runNext(epoch: number): Promise<void> {
    try {
      const snapshot = this.#snapshot ?? (await this.#extract(epoch));
      if (!snapshot || epoch !== this.#epoch) return;
      const { goal, option, previousStep, step, lastOutcome, stepCount } = this.state;
      if (stepCount >= MAX_STEPS) {
        this.#dispatch({ type: 'FAILED', message: 'La guía se extendió demasiado. Podés volver a las opciones o al inicio.' });
        return;
      }
      const last = step ?? previousStep;
      const requestId = shortId();
      const raw = await this.deps.api.guidanceNext(
        {
          schemaVersion: SCHEMA_VERSION,
          requestId,
          goal: goal ?? option?.title ?? 'Usar esta página',
          option: option ? { id: option.id, title: option.title } : undefined,
          snapshot,
          previousStep: last ? { instruction: last.instruction, expectedSignal: last.expectedSignal, outcome: lastOutcome } : undefined,
          stepCount,
        },
        this.#signal(),
      );
      if (epoch !== this.#epoch) return;
      const result = validateDecision(raw, this.#context(requestId, snapshot));
      if (!result.ok) throw new ApiFailure('invalid_response', false, result.reason);
      this.#dispatch({ type: 'DECISION', decision: result.value });
    } catch (error) {
      this.#fail(epoch, error);
    }
  }

  async #showStep(epoch: number): Promise<void> {
    const step = this.state.step;
    if (!step) return;
    const result = await this.deps.page.show(step.navigationId, step.targetElementId, step.presentation === 'scrollAndHighlight');
    if (epoch !== this.#epoch) return;
    this.targetVisible = result === 'shown';
    if (result === 'shown') {
      this.#unshown = 0;
      this.deps.onChange();
      return;
    }
    // Referencia obsoleta o invisible: se retira la indicación y se pide un nuevo análisis.
    if (++this.#unshown > MAX_UNSHOWN_STEPS) {
      this.#dispatch({ type: 'FAILED', message: 'No logro señalarte el lugar en esta página. Probá desplazarte o tocá «Reintentar».' });
      return;
    }
    this.#dispatch({ type: 'OUTCOME', outcome: result === 'stale' ? 'targetStale' : 'targetNotVisible' });
  }

  #context(requestId: string, snapshot: PageSnapshot) {
    return {
      requestId,
      navigationId: snapshot.navigationId,
      revision: snapshot.revision,
      elementIds: new Set(snapshot.elements.map((e) => e.id)),
    };
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
