/**
 * Chat funcional de la home (POST /v1/interpret). El objetivo es llegar a una
 * URL: `redirect` abre el sitio, `options` muestra varios sitios para elegir y
 * `question` pide más datos. Se envía el historial completo en cada llamada;
 * los mensajes de la persona se minimizan antes de salir del equipo.
 */
import { randomUUID } from 'node:crypto';
import { Limits, type ChatMessage as ApiMessage, type SiteOption, type UserContext } from '@hackaton/contracts';
import { minimizeIntent } from '@asistente/privacy';
import { UNSURE_ANSWER, type ChatMessage, type ChatPhase } from '../shared/ipc';
import { ApiFailure, isAbort, userMessage, type ApiClient, type ApiSession, type SessionTicket } from './api/client';
import { questionExtras } from './api/pending-contract';
import { log } from './log';

const MAX_MESSAGES = 30;
export { UNSURE_ANSWER };

export interface Candidate extends SiteOption {
  id: string;
}

export class Chat {
  phase: ChatPhase = 'idle';
  messages: ChatMessage[] = [];
  /** Primer pedido de la persona; acompaña la guía en el sitio. */
  goal: string | null = null;
  candidates: Candidate[] = [];
  error: string | null = null;
  /** Pregunta pendiente con sus respuestas sugeridas (pantallas 02 y 03). */
  question: { text: string; answers: string[]; reason: string | null } | null = null;

  #history: ApiMessage[] = [];
  #controller: AbortController | undefined;

  constructor(
    private readonly api: ApiClient,
    /** El chat inicia la sesión del backend; la guía la reutiliza. */
    private readonly session: ApiSession,
    private readonly onChange: () => void,
    /** `redirect`: la URL sale de la respuesta validada, nunca del renderer. */
    private readonly onRedirect: (url: string) => void,
    /** Localidad y demás datos de la persona; se leen en cada envío por si cambiaron. */
    private readonly userContext: () => UserContext | undefined = () => undefined,
  ) {}

  get busy(): boolean {
    return this.phase === 'interpreting';
  }

  async submit(text: string): Promise<void> {
    if (this.busy) return;
    const minimized = minimizeIntent(text, Limits.maxMessageLength);
    if (!minimized) return;
    this.#push('user', text.trim().slice(0, Limits.maxMessageLength));
    this.#history.push({ role: 'user', content: minimized });
    this.goal ??= minimized;
    this.candidates = [];
    this.question = null;
    this.error = null;

    const controller = new AbortController();
    this.#controller?.abort();
    this.#controller = controller;
    try {
      this.#set('interpreting');
      const ticket = this.session.begin();
      const response = await this.#interpret(ticket, controller.signal);
      ticket.commit(response.sessionId);
      log('chat.response', { type: `kind:${response.type}` });
      this.#push('assistant', response.message);
      this.#history.push({ role: 'assistant', content: response.message });
      switch (response.type) {
        case 'question':
          this.question = { text: response.message, ...questionExtras(response) };
          this.#set('clarifying');
          return;
        case 'options':
          this.candidates = response.options.map((option, i) => ({ ...option, id: `c-${i}` }));
          this.#set('results');
          return;
        case 'redirect':
          this.#set('redirected');
          this.onRedirect(response.url);
          return;
      }
    } catch (error) {
      if (isAbort(error)) return;
      this.error = userMessage(error);
      this.#set('error');
    }
  }

  async #interpret(ticket: SessionTicket, signal: AbortSignal) {
    const user = this.userContext();
    const body = { messages: this.#history.slice(-Limits.maxMessages), ...(user ? { user } : {}) };
    if (!ticket.id) return this.api.interpret(body, signal);
    try {
      return await this.api.interpret({ sessionId: ticket.id, ...body }, signal);
    } catch (error) {
      // Sesión vencida o servidor reiniciado: el historial va completo, se empieza otra.
      if (!(error instanceof ApiFailure) || error.code !== 'SESSION_NOT_FOUND') throw error;
      const retry = ticket.expire();
      const response = await this.api.interpret(retry.id ? { sessionId: retry.id, ...body } : body, signal);
      retry.commit(response.sessionId);
      return response;
    }
  }

  candidate(id: string): Candidate | undefined {
    return this.candidates.find((c) => c.id === id);
  }

  reset(): void {
    this.#controller?.abort();
    this.phase = 'idle';
    this.messages = [];
    this.goal = null;
    this.candidates = [];
    this.question = null;
    this.error = null;
    this.#history = [];
    this.session.reset();
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
