import { randomBytes } from 'node:crypto';
import type { ChatMessage, GuideStep, Metadata, PageOption } from '@hackaton/contracts';

/** Cada llamada que se recuerda. No se guarda el HTML. */
export type SessionEntry =
  | { type: 'interpret'; response: 'redirect' | 'question' | 'options'; goal: string; reason: string; urls: string[] }
  | { type: 'options'; options: PageOption[] }
  | {
      type: 'nextStep';
      optionId: string;
      expectedStep: GuideStep;
      completedSteps: GuideStep[];
      steps: GuideStep[];
      done: boolean;
    };

/** Todo lo que Claude recibe como contexto del recorrido, desde interpret hasta la última llamada. */
export interface SessionContext {
  chat: ChatMessage[];
  metadata: Metadata;
  history: SessionEntry[];
}

interface Session extends SessionContext {
  owner: string;
  expiresAt: number;
}

const MAX_HISTORY = 50;

/**
 * Sesiones en memoria. Vencen tras SESSION_TTL_MINUTES sin uso y se pierden
 * si el servidor se reinicia.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  create(owner: string): string {
    const id = `s-${randomBytes(18).toString('base64url')}`;
    this.sessions.set(id, { owner, expiresAt: this.now() + this.ttlMs, chat: [], metadata: {}, history: [] });
    return id;
  }

  /** Copia del contexto, o undefined si no existe, venció o es de otro token. */
  context(id: string, owner: string): SessionContext | undefined {
    const session = this.find(id, owner);
    if (!session) return undefined;
    return { chat: [...session.chat], metadata: structuredClone(session.metadata), history: [...session.history] };
  }

  /** El front envía el chat completo en cada llamada: se reemplaza. */
  setChat(id: string, owner: string, chat: ChatMessage[]): void {
    const session = this.touch(id, owner);
    if (session) session.chat = chat;
  }

  mergeMetadata(id: string, owner: string, metadata: Metadata | undefined): void {
    const session = this.touch(id, owner);
    if (!session || !metadata?.page) return;
    session.metadata.page = { ...session.metadata.page, ...metadata.page };
  }

  append(id: string, owner: string, entry: SessionEntry): void {
    const session = this.touch(id, owner);
    if (!session) return;
    session.history.push(entry);
    if (session.history.length > MAX_HISTORY) session.history.shift();
  }

  sweep(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    this.sessions.clear();
  }

  private find(id: string, owner: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.expiresAt <= this.now()) return undefined;
    return session;
  }

  /** Renueva el vencimiento solo de una sesión vigente y del mismo dueño; nunca revive una vencida. */
  private touch(id: string, owner: string): Session | undefined {
    const session = this.find(id, owner);
    if (session) session.expiresAt = this.now() + this.ttlMs;
    return session;
  }
}
