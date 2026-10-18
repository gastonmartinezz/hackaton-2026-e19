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
import type { AuthorityService, AuthorityView, OfficialMatch } from './authority.js';
import { withTimeout } from './cache.js';
import type { ConnectionData, ConnectionInspector } from './connection.js';
import { describeHost, type HostInfo } from './domain.js';
import { lookalikeSignals } from './lookalike.js';
import { analyzePage, compareBrand, type BrandComparison, type PageAnalysis } from './page-rules.js';
import type { RdapClient, RegistrationData } from './rdap.js';
import { sanitizePage, sanitizeUrl } from './sanitize.js';
import { errorKind, type Finding, type SourceResult } from './types.js';

const CONTENT_TTL_MS = 10 * 60_000;
/** Con alguna verificación incompleta, el resultado vence pronto para reintentar. */
const INCOMPLETE_TTL_MS = 60_000;
const IDENTITY_SOURCE = 'Fuentes de autoridad';
const AI_SOURCE = 'Análisis con IA';

export interface IdentityData {
  hostname: string;
  registrableDomain: string | null;
  /** Fuente de autoridad que hace oficial al host (zona de gobierno, registro del BCU o catálogo curado). */
  official: OfficialMatch | null;
  /** Versiones de las fuentes locales y estado del registro del BCU usado. */
  sources: { versions: string[]; registry: string; registryStatus: 'fresh' | 'stale' | 'unavailable' };
}

export interface SiteCheckDeps {
  authority: AuthorityService;
  rdap: RdapClient;
  connection: ConnectionInspector;
  /** null deshabilita la IA (SITE_CHECK_AI=false). */
  model: StructuredModel | null;
  aiTimeoutMs: number;
  now?: () => number;
}

/** Hosts locales, privados o internos: nunca llegan a proveedores. */
const internalResult = <T>(source: string, checkedAt: string): SourceResult<T> => ({
  source,
  checkedAt,
  coverage: 'not_applicable',
  ttlMs: 0,
  limitations: ['Las direcciones locales, privadas o internas no se analizan con servicios externos.'],
  errors: ['internal_host'],
  data: null,
  findings: [],
});

const IDENTITY_LIMITATIONS = [
  '«Oficial» solo sale de una autoridad: zonas de dominio reservadas al Estado, el registro de instituciones del Banco Central del Uruguay (BCU) o un catálogo curado con fuente por entrada. La IA, HTTPS, rankings o la antigüedad nunca lo otorgan.',
  'Que un sitio no figure en esas fuentes no significa que sea falso.',
  'Un sitio oficial comprometido sigue siendo oficial: por eso cualquier riesgo tiene prioridad.',
];

/**
 * Protección de sitios. Las validaciones esenciales corren siempre acá, en el servicio. La IA solo
 * identifica la organización declarada y los pedidos de la página; esa organización se contrasta
 * con las fuentes de autoridad. Nunca otorga identidad oficial ni baja el riesgo.
 */
export class SiteCheckService {
  constructor(private readonly deps: SiteCheckDeps) {}

  private nowIso(): string {
    return new Date((this.deps.now ?? Date.now)()).toISOString();
  }

  /** `lookup_official_identity`: fuentes de autoridad + señales de imitación del dominio. */
  async identity(hostname: string, view?: AuthorityView): Promise<SourceResult<IdentityData>> {
    const checkedAt = this.nowIso();
    const host = describeHost(hostname);
    if (host.internal) return internalResult(IDENTITY_SOURCE, checkedAt);
    const authority = view ?? (await this.deps.authority.view());
    const official = authority.official(host.hostname);
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
    const described = authority.describe();
    const coverage = authority.coverage(host.hostname);
    return {
      source: official ? official.source.name : IDENTITY_SOURCE,
      checkedAt,
      coverage,
      ttlMs: coverage === 'complete' ? CONTENT_TTL_MS : 0,
      limitations: [...IDENTITY_LIMITATIONS, described.registry],
      errors: authority.registry.status === 'fresh' || coverage === 'complete' ? [] : [`registry_${authority.registry.status}`],
      data: {
        hostname: host.hostname,
        registrableDomain: host.registrableDomain,
        official,
        sources: { versions: described.versions, registry: described.registry, registryStatus: authority.registry.status },
      },
      findings,
    };
  }

  /** `get_domain_registration`. Se consulta siempre el dominio registrable, nunca el host completo. */
  registration(hostname: string): Promise<SourceResult<RegistrationData>> {
    const host = describeHost(hostname);
    if (host.internal) return Promise.resolve(internalResult('RDAP', this.nowIso()));
    if (host.isIp || !host.registrableDomain) {
      return Promise.resolve({ ...internalResult<RegistrationData>('RDAP', this.nowIso()), limitations: ['Las direcciones IP no tienen registro de dominio.'], errors: [] });
    }
    return this.deps.rdap.lookup(host.registrableDomain);
  }

  /** `inspect_connection`. */
  connection(rawUrl: string): Promise<SourceResult<ConnectionData>> {
    const url = this.safeUrl(rawUrl);
    if (describeHost(url.hostname).internal) return Promise.resolve(internalResult('Inspección de conexión', this.nowIso()));
    return this.deps.connection.inspect(url);
  }

  /** `analyze_page_structure`. El resumen se vuelve a sanitizar antes de aplicar reglas. */
  async page(rawUrl: string, page: PageSummary, view?: AuthorityView): Promise<SourceResult<PageAnalysis>> {
    const url = this.safeUrl(rawUrl);
    const checkedAt = this.nowIso();
    const host = describeHost(url.hostname);
    const authority = view ?? (await this.deps.authority.view());
    const official = !host.internal && authority.official(host.hostname) !== null;
    const analysis = analyzePage(sanitizePage(page), url, host, authority, official, checkedAt);
    return {
      source: 'Reglas de contenido',
      checkedAt,
      coverage: 'complete',
      ttlMs: CONTENT_TTL_MS,
      limitations: ['Analiza el resumen que envió el navegador de la persona; no ve el código de la página ni lo que cambia después.'],
      errors: [],
      data: analysis,
      findings: analysis.findings,
    };
  }

  /** `compare_brand_identity`. */
  async brand(hostname: string, declaredBrand: string, view?: AuthorityView): Promise<SourceResult<BrandComparison>> {
    const checkedAt = this.nowIso();
    const host = describeHost(hostname);
    if (host.internal) return internalResult(IDENTITY_SOURCE, checkedAt);
    const authority = view ?? (await this.deps.authority.view());
    const comparison = compareBrand(declaredBrand, host, authority, checkedAt);
    return {
      source: IDENTITY_SOURCE,
      checkedAt,
      coverage: authority.registry.status === 'fresh' ? 'complete' : 'partial',
      ttlMs: CONTENT_TTL_MS,
      limitations: [
        'La marca declarada por el sitio nunca prueba su identidad; solo se usa para detectar imitaciones.',
        'Se reconocen organismos del Estado uruguayo, instituciones del registro del BCU y organizaciones de los catálogos curados.',
        authority.describe().registry,
      ],
      errors: [],
      data: comparison,
      findings: comparison.findings,
    };
  }

  /** POST /v1/site-check. */
  async check(request: SiteCheckRequest, log: FastifyBaseLogger): Promise<SiteCheckResponse> {
    const startedAt = performance.now();
    const checkedAt = this.nowIso();
    const url = this.safeUrl(request.url);
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
      this.registration(host.hostname),
      this.connection(url.toString()),
    ]);
    const identity = await this.identity(host.hostname, authority);
    const official = identity.data?.official ?? null;
    const findings: Finding[] = [...identity.findings, ...registration.findings, ...connection.findings];
    if (url.protocol === 'http:') {
      findings.push({ code: 'NO_HTTPS', source: 'Dirección', checkedAt, observedBy: 'user_browser', detail: 'La página no usa una conexión cifrada (https)' });
    }

    let page: SourceResult<PageAnalysis> | undefined;
    let explanation: string | undefined;
    let contentCoverage: CoverageLevel = 'pending';
    if (request.page) {
      const sanitized = sanitizePage(request.page);
      page = await this.page(url.toString(), sanitized, authority);
      contentCoverage = page.coverage;
      findings.push(...page.findings);
      if (sanitized.declaredBrand) findings.push(...compareBrand(sanitized.declaredBrand, host, authority, checkedAt).findings);
      let asksCredentials = page.data?.sensitiveKinds.includes('password') ?? false;

      if (this.deps.model) {
        // Lo que la IA recibe tiene que reflejar la cobertura real: sin identidad completa el riesgo es «unknown»
        // y el prompt le prohíbe tranquilizar.
        const preCoverage = { identity: identity.coverage, content: page.coverage, registration: registration.coverage, connection: connection.coverage };
        const preComplete = [preCoverage.identity, preCoverage.content].every(isEnough);
        const rulesRisk = computeRisk(new Set(findings.map((f) => f.code)), preComplete);
        const ai = await this.interpret(log, { host, risk: rulesRisk, coverage: preCoverage, official, findings, page: sanitized, analysis: page.data! });
        if (!ai) {
          // Sin la identificación de la IA el análisis de contenido queda incompleto: nunca favorable.
          contentCoverage = 'partial';
        } else {
          explanation = ai.explanation || undefined;
          if (ai.declaredOrganization) {
            const hint = { kind: ai.organizationKind, country: ai.country };
            const brand = compareBrand(ai.declaredOrganization, host, authority, checkedAt, { hint, source: AI_SOURCE, observedBy: 'service' });
            if (!findings.some((f) => f.code === 'BRAND_IMPERSONATION')) findings.push(...brand.findings);
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
      identity: identity.coverage,
      content: contentCoverage,
      registration: registration.coverage,
      connection: connection.coverage,
    };
    // Obligatorias para un estado favorable: identidad y contenido (ver siteIndicatorState).
    const mandatory: CoverageLevel[] = page ? [coverage.identity, coverage.content] : [coverage.identity];
    const mandatoryComplete = mandatory.every(isEnough);
    const risk: SiteRisk = computeRisk(new Set(findings.map((f) => f.code)), mandatoryComplete);

    const status = !page ? 'pending' : mandatoryComplete ? 'complete' : 'partial';
    const sources = [identity, registration, connection, ...(page ? [page] : [])];
    const incomplete = Object.values(coverage).some((level) => level === 'unavailable' || level === 'partial');
    const ttl = Math.min(...sources.filter((s) => s.ttlMs > 0).map((s) => s.ttlMs), CONTENT_TTL_MS, incomplete || !page ? INCOMPLETE_TTL_MS : Number.POSITIVE_INFINITY);
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

  private safeUrl(raw: string): URL {
    const url = sanitizeUrl(raw);
    if (!url) throw new AppError('BAD_REQUEST', 'URL inválida');
    return url;
  }
}
