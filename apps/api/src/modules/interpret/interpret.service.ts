import { InterpretResponse, type InterpretRequest } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel, WebSearchOptions } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { InterpretOutput } from '../ai/schemas.js';
import type { SessionStore } from '../sessions/session-store.js';
import { countChecks, emptyStats, type FailedUrl, type UrlGuard } from './url-guard.js';

export interface InterpretServiceOptions {
  /** Le da a Claude la búsqueda web del servidor para elegir entre resultados reales (INTERPRET_WEB_SEARCH). */
  webSearch: boolean;
  webSearchMaxUses: number;
}

const silentLog = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

export class InterpretService {
  constructor(
    private readonly model: StructuredModel,
    private readonly sessions: SessionStore,
    private readonly guard: UrlGuard,
    private readonly options: InterpretServiceOptions = { webSearch: false, webSearchMaxUses: 3 },
  ) {}

  async interpret(request: InterpretRequest, owner: string, log: FastifyBaseLogger = silentLog): Promise<InterpretResponse> {
    const sessionId = request.sessionId ?? this.sessions.create(owner);
    const context = this.sessions.context(sessionId, owner);
    if (!context) throw new AppError('SESSION_NOT_FOUND', 'Sesión inexistente o vencida');

    const input = { messages: request.messages, user: request.user ?? null, history: context.history };
    const ask = (failedUrls?: FailedUrl[]) =>
      this.model.generate({
        task: 'interpret',
        system: this.options.webSearch ? SYSTEM_PROMPTS.interpretWithSearch : SYSTEM_PROMPTS.interpret,
        input: failedUrls ? { ...input, failedUrls } : input,
        schema: InterpretOutput,
        ...(this.options.webSearch ? { webSearch: this.webSearch(request) } : {}),
      });

    // Ninguna URL llega a la persona sin comprobar que exista (S03).
    const stats = emptyStats();
    let output = await ask();
    let checks = await this.guard.checkAll(output);
    countChecks(checks, stats);
    const firstPass = { checked: stats.checked, valid: stats.valid };

    let retried = false;
    const failed = this.guard.failed(checks);
    if (failed.length > 0) {
      // Un reintento diciéndole a Claude qué URL falló y por qué. Si el reintento falla, se repara lo que había.
      retried = true;
      try {
        const second = await ask(failed);
        const secondChecks = await this.guard.checkAll(second);
        countChecks(secondChecks, stats);
        output = second;
        checks = secondChecks;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        log.warn({ task: 'interpret', code: error.code }, 'interpret url retry failed');
      }
    }
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

  /** Ubicación aproximada para la búsqueda. Sin país: la API no acepta todos los códigos (UY da 400). */
  private webSearch(request: InterpretRequest): WebSearchOptions {
    const location = request.user?.location;
    return {
      maxUses: this.options.webSearchMaxUses,
      userLocation: {
        ...(location?.city ? { city: location.city } : {}),
        ...(location?.region ? { region: location.region } : {}),
        ...(request.user?.timeZone ? { timezone: request.user.timeZone } : {}),
      },
    };
  }
}
