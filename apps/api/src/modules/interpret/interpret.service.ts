import { InterpretResponse, type ErrorCode, type InterpretRequest } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { InterpretOutput } from '../ai/schemas.js';
import type { SessionStore } from '../sessions/session-store.js';
import { countChecks, emptyStats, type FailedUrl, type UrlGuard } from './url-guard.js';

/** Errores del reintento que permiten seguir con la primera respuesta (reparada). El resto se propaga. */
const RECOVERABLE_RETRY_ERRORS: ReadonlySet<ErrorCode> = new Set(['AI_UNAVAILABLE', 'TIMEOUT', 'RATE_LIMITED', 'AI_INVALID_RESPONSE']);

const silentLog ={ info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

export class InterpretService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
    private readonly guard: UrlGuard,
  ) {}

  async interpret(request: InterpretRequest, owner: string, log: FastifyBaseLogger = silentLog): Promise<InterpretResponse> {
    const sessionId = request.sessionId ?? this.sessions.create(owner);
    const context = this.sessions.context(sessionId, owner);
    if (!context) throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');

    const input = { messages: request.messages, user: request.user ?? null, history: context.history };
    const ask = (failedUrls?: FailedUrl[]) =>
      this.model.generate({
        task: 'interpret',
        system: SYSTEM_PROMPTS.interpret,
        input: failedUrls ? { ...input, failedUrls } : input,
        schema: InterpretOutput,
      });

    // Ninguna URL llega a la persona sin comprobar que exista (S03).
    const stats = emptyStats();
    let output = await ask();
    let checks = await this.guard.checkAll(output);
    countChecks(checks, stats);
    const firstPass = { checked: stats.checked, valid: stats.valid };

    let retried = false;
    const failed = this.guard.failed(checks);
    let warmRoots: Promise<void> | undefined;
    if (failed.length > 0) {
      // En paralelo con el reintento: la raíz de cada dominio que falló, por si hay que repararla.
      warmRoots = this.guard.prefetchRoots(failed);
      // Un reintento diciéndole a Claude qué URL falló y por qué.
      let second: InterpretOutput | undefined;
      try {
        second = await ask(failed);
      } catch (error) {
        // Solo los fallos pasajeros caen en el respaldo; un error de configuración o un rechazo se propagan.
        if (!(error instanceof AppError) || !RECOVERABLE_RETRY_ERRORS.has(error.code)) throw error;
        log.warn({ task: 'interpret', code: error.code }, 'interpret url retry failed');
      }
      if (second) {
        const secondChecks = await this.guard.checkAll(second);
        countChecks(secondChecks, stats);
        output = second;
        checks = secondChecks;
        retried = true;
      }
    }
    // Siempre, se haya usado o no el reintento: lo que siga inválido pasa a la raíz del dominio o se saca.
    await warmRoots;
    output = await this.guard.repair(output, checks, stats);

    log.info(
      {
        task: 'interpret',
        type: output.type,
        firstPassChecked: firstPass.checked,
        firstPassValid: firstPass.valid,
        checked: stats.checked,
        valid: stats.valid,
        invalid: stats.invalid,
        // Solo el dominio, nunca la ruta ni los parámetros.
        invalidDomains: stats.invalidDomains,
        retried,
        rootFallbacks: stats.rootFallbacks,
        dropped: stats.dropped,
        converted: stats.converted,
      },
      'interpret urls',
    );

    // goal y reason quedan en la sesión; no se devuelven al front.
    const candidate =
      output.type === 'redirect'
        ? { sessionId, type: 'redirect', message: output.message, url: output.url }
        : output.type === 'options'
          ? { sessionId, type: 'options', message: output.message, options: output.options }
          : { sessionId, type: 'question', message: output.message };

    // Se valida contra el contrato: por ejemplo, rechaza URLs que no son http(s).
    const parsed = InterpretResponse.safeParse(candidate);
    if (!parsed.success) throw new AppError('AI_INVALID_RESPONSE', 'Respuesta de Claude incoherente con el contrato');

    this.sessions.setChat(sessionId, owner, request.messages);
    this.sessions.append(sessionId, owner, {
      type: 'interpret',
      response: output.type,
      goal: output.goal,
      reason: output.reason,
      urls: parsed.data.type === 'redirect' ? [parsed.data.url] : parsed.data.type === 'options' ? parsed.data.options.map((o) => o.url) : [],
    });
    return parsed.data;
  }
}
