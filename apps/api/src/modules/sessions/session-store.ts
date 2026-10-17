import { randomBytes } from 'node:crypto';
import type { Guide, PageOption } from '@hackaton/contracts';

/** Lo que se guarda de cada llamada a /options. No se guarda el HTML. */
export interface SessionEntry {
  goal?: string;
  options: PageOption[];
  guide: Guide | null;
}

interface Session {
  owner: string;
  expiresAt: number;
  history: SessionEntry[];
}

const MAX_HISTORY = 10;

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
    this.sessions.set(id, { owner, expiresAt: this.now() + this.ttlMs, history: [] });
    return id;
  }

  /** Historial de la sesión, o undefined si no existe, venció o es de otro token. */
  history(id: string, owner: string): SessionEntry[] | undefined {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.expiresAt <= this.now()) return undefined;
    return session.history;
  }

  append(id: string, entry: SessionEntry): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.history.push(entry);
    if (session.history.length > MAX_HISTORY) session.history.shift();
    session.expiresAt = this.now() + this.ttlMs;
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
}
