import { randomUUID } from 'node:crypto';
import {
  SiteCheckResponse,
  type CoverageLevel,
  type PageSummary,
  type SiteCheckRequest,
  type SiteCheckCoverage,
  type SiteRisk,
} from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StructuredModel } from '../ai/model.js';
import { SYSTEM_PROMPTS } from '../ai/prompts.js';
import { SiteCheckOutput } from '../ai/schemas.js';
import { buildReasons, CATEGORY, computeRisk, isEnough } from './aggregate.js';
import type { AuthorityService, OfficialMatch } from './authority.js';
import { withTimeout } from './cache.js';
import type { ConnectionInspector } from './connection.js';
import { describeHost, type HostInfo } from './domain.js';
import { lookalikeSignals } from './lookalike.js';
import { analyzePage, compareBrand, type PageAnalysis } from './page-rules.js';
import type { RdapClient } from './rdap.js';
import { sanitizePage, sanitizeUrl } from './sanitize.js';
import { errorKind, type Finding, type SourceResult } from './types.js';

const CONTENT_TTL_MS = 10 * 60_000;
/** Con alguna verificación incompleta, el resultado vence pronto para reintentar. */
const INCOMPLETE_TTL_MS = 60_000;
const IDENTITY_SOURCE = 'Fuentes de autoridad';
const AI_SOURCE = 'Análisis con IA';

export interface SiteCheckDeps {
  authority: AuthorityService;
  rdap: RdapClient;
  connection: ConnectionInspector;
  /** null deshabilita la IA (SITE_CHECK_AI=false). */
  model: StructuredModel | null;
  aiTimeoutMs: number;
  now?: () => number;
}

/**
 * Protección de sitios. Las validaciones esenciales corren siempre acá, en el servicio. La IA solo
 * identifica la organización declarada y los pedidos de la página; esa organización se contrasta
 * con las fuentes de autoridad. Nunca otorga identidad oficial ni baja el riesgo.
 *
 * «Oficial» solo sale de una autoridad: zonas reservadas al Estado uruguayo, el registro de
 * instituciones del BCU o el catálogo curado. Que un sitio no figure ahí no significa que sea falso,
 * y un sitio oficial comprometido sigue siendo oficial: por eso cualquier riesgo tiene prioridad.
 */
export class SiteCheckService {
  constructor(private readonly deps: SiteCheckDeps) {}

  /** POST /v1/site-check. */
  async check(request: SiteCheckRequest, log: FastifyBaseLogger): Promise<SiteCheckResponse> {
    const startedAt = performance.now();
    const checkedAt = new Date((this.deps.now ?? Date.now)()).toISOString();
    const url = sanitizeUrl(request.url);
    if (!url) throw new AppError('BAD_REQUEST', 'URL inválida');
    const host = describeHost(url.hostname);
    const phase = request.page ? 'content' : 'address';
    const base = { navigationId: request.navigationId, contentVersion: request.contentVersion, analysisId: `sc-${randomUUID()}`, checkedAt };

    // Hosts locales, privados o internos: sin proveedores externos ni IA.
    if (host.internal) {
      return this.finish(log, phase, startedAt, {
        ...base,
        status: 'unavailable',
        identity: { status: 'unknown' },
        risk: 'unknown',
        reasons: [],
        coverage: { identity: 'not_applicable', content: 'not_applicable', registration: 'not_applicable', connection: 'not_applicable' },
        expiresAt: new Date(Date.parse(checkedAt) + INCOMPLETE_TTL_MS).toISOString(),
      });
    }

    const [authority, registration, connection] = await Promise.all([
      this.deps.authority.view(),
      this.registration(host),
      // La URL ya está depurada (sin query, fragmento ni secretos).
      this.deps.connection.inspect(url),
    ]);

    // Identidad: fuentes de autoridad y, si el host no es oficial, señales de imitación del dominio.
    const official = authority.official(host.hostname);
    const identityCoverage = authority.coverage(host.hostname);
    const findings: Finding[] = official
      ? []
      : lookalikeSignals(host, authority.references(), authority.zoneReferences()).map((signal) => ({
          code: signal.code,
          source: IDENTITY_SOURCE,
          checkedAt,
          observedBy: 'service',
          detail: signal.detail.slice(0, 300),
          ...(signal.organization ? { impersonatedOrganization: signal.organization.slice(0, 120) } : {}),
        }));
    findings.push(...registration.findings, ...connection.findings);
    if (url.protocol === 'http:') {
      findings.push({ code: 'NO_HTTPS', source: 'Dirección', checkedAt, observedBy: 'user_browser', detail: 'La página no usa una conexión cifrada (https)' });
    }

    let explanation: string | undefined;
    let contentCoverage: CoverageLevel = 'pending';
    if (request.page) {
      // El backend vuelve a depurar el resumen una sola vez: lo mismo llega a las reglas y a la IA. Una segunda
      // pasada sobre el texto ya unido ocultaría todo lo que sigue a «Contraseña:», amenazas incluidas.
      const sanitized = sanitizePage(request.page);
      const analysis = analyzePage(sanitized, url, host, authority, official !== null, checkedAt);
      contentCoverage = 'complete';
      findings.push(...analysis.findings);
      if (!official && sanitized.declaredBrand) findings.push(...compareBrand(sanitized.declaredBrand, host, authority, checkedAt));
      let asksCredentials = analysis.sensitiveKinds.includes('password');

      if (this.deps.model) {
        // Lo que la IA recibe tiene que reflejar la cobertura real: sin identidad completa el riesgo es «unknown»
        // y el prompt le prohíbe tranquilizar.
        const preCoverage = { identity: identityCoverage, content: contentCoverage, registration: registration.coverage, connection: connection.coverage };
        const preComplete = [preCoverage.identity, preCoverage.content].every(isEnough);
        const rulesRisk = computeRisk(new Set(findings.map((f) => f.code)), preComplete);
        const ai = await this.interpret(log, { host, risk: rulesRisk, coverage: preCoverage, official, findings, page: sanitized, analysis });
        if (!ai) {
          // Sin la identificación de la IA el análisis de contenido queda incompleto: nunca favorable.
          contentCoverage = 'partial';
        } else {
          explanation = ai.explanation || undefined;
          if (!official && ai.declaredOrganization && !findings.some((f) => f.code === 'BRAND_IMPERSONATION')) {
            const hint = { kind: ai.organizationKind, country: ai.country };
            findings.push(...compareBrand(ai.declaredOrganization, host, authority, checkedAt, { hint, source: AI_SOURCE, observedBy: 'service' }));
          }
          if (!official && (ai.requests.payment || ai.requests.verificationCodes) && !findings.some((f) => f.code === 'SENSITIVE_DATA_REQUEST')) {
            const what = [ai.requests.payment ? 'pagos o datos de tarjeta' : '', ai.requests.verificationCodes ? 'códigos de verificación' : ''].filter(Boolean).join(' y ');
            findings.push({ code: 'SENSITIVE_DATA_REQUEST', source: AI_SOURCE, checkedAt, observedBy: 'service', detail: `La página pide ${what}` });
          }
          asksCredentials ||= ai.requests.credentials;
        }
      }

      // Una contraseña cuenta como pedido sensible cuando el sitio, sin identidad oficial, ya muestra otra señal de fraude.
      const fraud = findings.some((f) => CATEGORY[f.code] === 'fraud');
      if (!official && fraud && asksCredentials && !findings.some((f) => f.code === 'SENSITIVE_DATA_REQUEST')) {
        findings.push({ code: 'SENSITIVE_DATA_REQUEST', source: 'Reglas de contenido', checkedAt, observedBy: 'user_browser', detail: 'Pide una contraseña o clave en un sitio con otras señales de estafa' });
      }
    }

    const coverage: SiteCheckCoverage = {
      identity: identityCoverage,
      content: contentCoverage,
      registration: registration.coverage,
      connection: connection.coverage,
    };
    // Obligatorias para un estado favorable: identidad y contenido (ver siteIndicatorState).
    const mandatory: CoverageLevel[] = request.page ? [coverage.identity, coverage.content] : [coverage.identity];
    const mandatoryComplete = mandatory.every(isEnough);
    const risk: SiteRisk = computeRisk(new Set(findings.map((f) => f.code)), mandatoryComplete);

    const status = !request.page ? 'pending' : mandatoryComplete ? 'complete' : 'partial';
    // Vence con la fuente externa más corta, como mucho a los 10 min, y al minuto si una comprobación obligatoria quedó
    // incompleta, falta el contenido o el registro o la conexión fallaron de forma pasajera (sin caché: conviene
    // reintentar). Que `.uy` no tenga RDAP es permanente (se guarda en caché) y no acorta nada.
    // `not_applicable` (IP directa, sin dominio registrable) y una fuente apagada a propósito no son fallas.
    const transientFailure = [registration, connection].some(
      (s) => (s.coverage === 'unavailable' || s.coverage === 'partial') && s.ttlMs === 0 && !s.errors.includes('disabled'),
    );
    const incomplete = !mandatoryComplete || transientFailure;
    const sourceTtls = [registration, connection].filter((s) => s.ttlMs > 0).map((s) => s.ttlMs);
    const ttl = Math.min(...sourceTtls, CONTENT_TTL_MS, incomplete || !request.page ? INCOMPLETE_TTL_MS : Number.POSITIVE_INFINITY);
    const impersonated = findings.find((f) => f.impersonatedOrganization)?.impersonatedOrganization;

    return this.finish(log, phase, startedAt, {
      ...base,
      status,
      identity: official
        ? { status: 'verified_official', basis: official.basis, organization: official.organization, source: official.source }
        : { status: 'unknown', ...(impersonated ? { impersonatedOrganization: impersonated } : {}) },
      risk,
      reasons: buildReasons(findings),
      coverage,
      ...(explanation ? { explanation } : {}),
      expiresAt: new Date(Date.parse(checkedAt) + ttl).toISOString(),
    });
  }

  /** Se consulta siempre el dominio registrable, nunca el host completo. Una IP no tiene registro de dominio. */
  private registration(host: HostInfo): Promise<SourceResult> {
    if (host.isIp || !host.registrableDomain) {
      return Promise.resolve({ coverage: 'not_applicable', ttlMs: 0, errors: [], findings: [] });
    }
    return this.deps.rdap.lookup(host.registrableDomain);
  }

  /** Valida contra el contrato y registra solo datos técnicos: nunca URLs, dominios ni contenido. */
  private finish(log: FastifyBaseLogger, phase: string, startedAt: number, candidate: SiteCheckResponse): SiteCheckResponse {
    const response = SiteCheckResponse.parse(candidate);
    log.info(
      {
        siteCheck: {
          phase,
          status: response.status,
          risk: response.risk,
          identity: response.identity.status,
          basis: response.identity.basis,
          reasons: response.reasons.map((r) => r.code),
          coverage: response.coverage,
          latencyMs: Math.round(performance.now() - startedAt),
        },
      },
      'site check',
    );
    return response;
  }

  /** La IA identifica organización declarada y pedidos, y redacta una explicación. null si falla. */
  private async interpret(
    log: FastifyBaseLogger,
    context: { host: HostInfo; risk: SiteRisk; coverage: SiteCheckCoverage; official: OfficialMatch | null; findings: Finding[]; page: PageSummary; analysis: PageAnalysis },
  ): Promise<SiteCheckOutput | null> {
    const model = this.deps.model!;
    const input = {
      site: { hostname: context.host.hostname, registrableDomain: context.host.registrableDomain },
      identity: context.official ? { status: 'verified_official', basis: context.official.basis, organization: context.official.organization } : { status: 'unknown' },
      risk: context.risk,
      coverage: context.coverage,
      reasons: context.findings.map((f) => ({ code: f.code, category: CATEGORY[f.code], detail: f.detail })),
      // Contenido no confiable: va dentro del bloque <datos> y el prompt advierte sobre instrucciones.
      page: {
        title: context.page.title,
        declaredBrand: context.page.declaredBrand,
        text: context.page.text,
        forms: context.analysis.forms,
        links: context.page.links.map((l) => ({ text: l.text, domain: describeHost(new URL(l.href).hostname).registrableDomain })),
      },
    };
    try {
      const output = await withTimeout(this.deps.aiTimeoutMs, (signal) =>
        model.generate({ task: 'siteCheck', system: SYSTEM_PROMPTS.siteCheck, input, schema: SiteCheckOutput, signal }),
      );
      const parsed = SiteCheckOutput.parse(output);
      const explanation = parsed.explanation.replace(/\s+/g, ' ').trim().slice(0, 400);
      // Defensa adicional: la IA no puede declarar oficialidad ni seguridad.
      const claimsTrust = /\b(es|parece) (un )?sitio (oficial|seguro|confiable|leg[ií]timo)\b|\bes (seguro|confiable)\b/i.test(explanation);
      const declared = parsed.declaredOrganization?.replace(/\s+/g, ' ').trim().slice(0, 120) || null;
      return { ...parsed, explanation: claimsTrust ? '' : explanation, declaredOrganization: declared };
    } catch (error) {
      log.warn({ errorName: errorKind(error) }, 'site check ai failed');
      return null;
    }
  }
}
