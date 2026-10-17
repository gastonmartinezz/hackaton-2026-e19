/**
 * Chat funcional de la home (S02, S03 lado cliente): intención, aclaraciones,
 * búsqueda de destinos y continuidad del objetivo. Consume el backend; no llama
 * a Claude ni guarda claves. La intención se minimiza antes de enviarse.
 */
import { randomUUID } from 'node:crypto';
import { LIMITS, SCHEMA_VERSION, type DestinationCandidate } from '@hackaton/contracts';
import { minimizeIntent } from '@asistente/privacy';
import type { ChatMessage, ChatPhase } from '../shared/ipc';
import { isAbort, userMessage, type ApiClient } from './api/client';
import { log } from './log';

const MAX_MESSAGES = 30;

export class Chat {
  phase: ChatPhase = 'idle';
  messages: ChatMessage[] = [];
  goal: string | null = null;
  candidates: DestinationCandidate[] = [];
  recommendedId: string | null = null;
  error: string | null = null;

  #intent: string | null = null;
  #question: string | null = null;
  #clarifications: Array<{ question: string; answer: string }> = [];
  #controller: AbortController | undefined;

  constructor(
    private readonly api: ApiClient,
    private readonly onChange: () => void,
  ) {}

  get busy(): boolean {
    return this.phase === 'interpreting' || this.phase === 'searching';
  }

  async submit(text: string): Promise<void> {
    if (this.busy) return;
    const minimized = minimizeIntent(text, LIMITS.intentLength);
    if (!minimized) return;
    this.#push('user', text.trim().slice(0, LIMITS.intentLength));

    if (this.phase === 'clarifying' && this.#question && this.#intent) {
      this.#clarifications.push({ question: this.#question, answer: minimized });
    } else {
      this.#intent = minimized;
      this.#clarifications = [];
      this.goal = null;
      this.candidates = [];
      this.recommendedId = null;
    }
    this.#question = null;
    this.error = null;

    const controller = new AbortController();
    this.#controller?.abort();
    this.#controller = controller;
    try {
      this.#set('interpreting');
      const interpreted = await this.api.interpretIntent(
        {
          schemaVersion: SCHEMA_VERSION,
          requestId: shortId(),
          intent: this.#intent!,
          clarifications: this.#clarifications,
        },
        controller.signal,
      );
      if (interpreted.status === 'needsClarification' && this.#clarifications.length < LIMITS.clarifications) {
        this.#question = interpreted.question;
        this.#push('assistant', interpreted.question);
        this.#set('clarifying');
        return;
      }
      this.goal = interpreted.status === 'goal' ? interpreted.goal : [this.#intent, ...this.#clarifications.map((c) => c.answer)].join(' — ');
      this.#push('assistant', `Busco sitios para: ${this.goal}`);
      this.#set('searching');

      const found = await this.api.searchDestinations(
        { schemaVersion: SCHEMA_VERSION, requestId: shortId(), goal: this.goal },
        controller.signal,
      );
      this.candidates = found.candidates;
      this.recommendedId = found.candidates.some((c) => c.id === found.recommendedId) ? found.recommendedId : null;
      log('chat.results', { candidates: found.candidates.length, recommended: this.recommendedId !== null });
      this.#push(
        'assistant',
        found.candidates.length > 0
          ? 'Encontré estas opciones. Antes de abrir, mirá el nombre y la dirección del sitio.'
          : 'No encontré sitios para eso. Probá contarlo con otras palabras.',
      );
      this.#set('results');
    } catch (error) {
      if (isAbort(error)) return;
      this.error = userMessage(error);
      this.#set('error');
    }
  }

  candidate(id: string): DestinationCandidate | undefined {
    return this.candidates.find((c) => c.id === id);
  }

  reset(): void {
    this.#controller?.abort();
    this.phase = 'idle';
    this.messages = [];
    this.goal = null;
    this.candidates = [];
    this.recommendedId = null;
    this.error = null;
    this.#intent = null;
    this.#question = null;
    this.#clarifications = [];
    this.onChange();
  }

  #set(phase: ChatPhase): void {
    this.phase = phase;
    this.onChange();
  }

  #push(from: ChatMessage['from'], text: string): void {
    this.messages = [...this.messages, { id: shortId(), from, text }].slice(-MAX_MESSAGES);
  }
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}
