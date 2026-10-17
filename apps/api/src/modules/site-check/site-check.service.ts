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
import { withTimeout } from './cache.js';
import type { OfficialCatalog } from './catalog.js';
import type { ConnectionData, ConnectionInspector } from './connection.js';
import { describeHost, type HostInfo } from './domain.js';
import { analyzePage, compareBrand, type BrandComparison, type PageAnalysis } from './page-rules.js';
import type { RdapClient, RegistrationData } from './rdap.js';
import type { ReputationChecker, ReputationData } from './reputation.js';
import { sanitizePage, sanitizeUrl } from './sanitize.js';
import { errorKind, type Finding, type SourceResult } from './types.js';

const CONTENT_TTL_MS = 10 * 60_000;
/** Con alguna verificación incompleta, el resultado vence pronto para reintentar. */
const INCOMPLETE_TTL_MS = 60_000;
const CATALOG_SOURCE = 'Registro de sitios oficiales';

export interface IdentityData {
  hostname: string;
  registrableDomain: string | null;
  official: { organization: string; domain: string; scope: 'exact' | 'subdomains'; source: string; sourceUrl: string; reviewedAt: string } | null;
  catalogVersion: string;
}

export interface SiteCheckDeps {
  catalog: OfficialCatalog;
  reputation: ReputationChecker;
  rdap: RdapClient;
  connection: ConnectionInspector;
  /** null deshabilita la explicación de la IA (SITE_CHECK_AI=false). */
  model: StructuredModel | null;
  aiTimeoutMs: number;
  now?: () => number;
}

/** Error de la solicitud que no debe llegar a proveedores (host interno, URL inválida). */
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

/**
 * Protección de sitios. Las validaciones esenciales corren siempre acá, en el servicio: la IA
 * solo agrega una explicación y, como mucho, un motivo de riesgo medio. Nunca decide identidad
 * oficial ni baja el riesgo. Cada método de verificación es también una tool MCP.
 */
export class SiteCheckService {
  constructor(private readonly deps: SiteCheckDeps) {}

  private nowIso(): string {
    return new Date((this.deps.now ?? Date.now)()).toISOString();
  }

  /** `lookup_official_identity`: catálogo + señales de imitación del dominio. */
  identity(hostname: string): SourceResult<IdentityData> {
    const checkedAt = this.nowIso();
    const host = describeHost(hostname);
    if (host.internal) return internalResult(CATALOG_SOURCE, checkedAt);
    const { catalog } = this.deps;
    const entry = catalog.match(host.hostname);
    const domain = entry?.domains.find((d) => host.hostname === d.domain || (d.scope === 'subdomains' && host.hostname.endsWith(`.${d.domain}`)));
    const findings: Finding[] = catalog.domainSignals(host).map((signal) => ({
      code: signal.code,
      source: CATALOG_SOURCE,
      checkedAt,
      observedBy: 'service',
      detail: signal.detail,
      ...(signal.entry ? { impersonatedOrganization: signal.entry.organization } : {}),
    }));
    return {
      source: `${CATALOG_SOURCE} v${catalog.version}`,
      checkedAt,
      coverage: 'complete',
      ttlMs: CONTENT_TTL_MS,
      limitations: [
        'Solo reconoce las organizaciones incluidas en el registro. Que un sitio no esté no significa que sea falso.',
        `Revisión del registro: ${catalog.reviewedAt}.`,
      ],
      errors: [],
      data: {
        hostname: host.hostname,
        registrableDomain: host.registrableDomain,
        official:
          entry && domain
            ? { organization: entry.organization, domain: domain.domain, scope: domain.scope, source: entry.source.name, sourceUrl: entry.source.url, reviewedAt: entry.reviewedAt }
            : null,
        catalogVersion: catalog.version,
      },
      findings,
    };
  }

  /** `check_url_reputation`. */
  reputation(rawUrl: string): Promise<SourceResult<ReputationData>> {
    const url = this.safeUrl(rawUrl);
    if (describeHost(url.hostname).internal) return Promise.resolve(internalResult('Reputación', this.nowIso()));
    return this.deps.reputation.check(url);
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
  page(rawUrl: string, page: PageSummary): SourceResult<PageAnalysis> {
    const url = this.safeUrl(rawUrl);
    const checkedAt = this.nowIso();
    const host = describeHost(url.hostname);
    const official = host.internal ? undefined : this.deps.catalog.match(host.hostname);
    const analysis = analyzePage(sanitizePage(page), url, host, this.deps.catalog, official, checkedAt);
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
  brand(hostname: string, declaredBrand: string): SourceResult<BrandComparison> {
    const checkedAt = this.nowIso();
    const host = describeHost(hostname);
    if (host.internal) return internalResult(CATALOG_SOURCE, checkedAt);
    const comparison = compareBrand(declaredBrand, host, this.deps.catalog, checkedAt);
    return {
      source: `${CATALOG_SOURCE} v${this.deps.catalog.version}`,
      checkedAt,
      coverage: 'complete',
      ttlMs: CONTENT_TTL_MS,
      limitations: ['La marca declarada por el sitio nunca prueba su identidad; solo se usa para detectar imitaciones.'],
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
        coverage: { reputation: 'not_applicable', identity: 'not_applicable', content: 'not_applicable', registration: 'not_applicable', connection: 'not_applicable' },
        expiresAt: new Date(Date.parse(checkedAt) + INCOMPLETE_TTL_MS).toISOString(),
      });
    }

    const identity = this.identity(host.hostname);
    const [reputation, registration, connection] = await Promise.all([this.deps.reputation.check(url), this.registration(host.hostname), this.connection(url.toString())]);
    const official = identity.data?.official ?? null;
    const findings: Finding[] = [...identity.findings, ...reputation.findings, ...registration.findings, ...connection.findings];
    if (url.protocol === 'http:') {
      findings.push({ code: 'NO_HTTPS', source: 'Dirección', checkedAt, observedBy: 'user_browser', detail: 'La página no usa una conexión cifrada (https)' });
    }

    let page: SourceResult<PageAnalysis> | undefined;
    let sanitized: PageSummary | undefined;
    if (request.page) {
      sanitized = sanitizePage(request.page);
      page = this.page(url.toString(), sanitized);
      findings.push(...page.findings);
      if (sanitized.declaredBrand) findings.push(...this.brand(host.hostname, sanitized.declaredBrand).findings);
      // Una contraseña cuenta como pedido sensible cuando el sitio, fuera del catálogo, ya muestra otra señal de fraude.
      const fraud = findings.some((f) => CATEGORY[f.code] === 'fraud');
      if (!official && fraud && page.data?.sensitiveKinds.includes('password') && !findings.some((f) => f.code === 'SENSITIVE_DATA_REQUEST')) {
        findings.push({ code: 'SENSITIVE_DATA_REQUEST', source: 'Reglas de contenido', checkedAt, observedBy: 'user_browser', detail: 'Pide una contraseña en un sitio con otras señales de estafa' });
      }
    }

    const coverage: SiteCheckCoverage = {
      reputation: reputation.coverage,
      identity: identity.coverage,
      content: page ? page.coverage : 'pending',
      registration: registration.coverage,
      connection: connection.coverage,
    };
    // Obligatorias para un estado favorable: reputación, identidad y contenido (ver siteIndicatorState).
    const mandatory: CoverageLevel[] = page ? [coverage.reputation, coverage.identity, coverage.content] : [coverage.reputation, coverage.identity];
    const mandatoryComplete = mandatory.every(isEnough);
    let risk = computeRisk(new Set(findings.map((f) => f.code)), mandatoryComplete);

    let explanation: string | undefined;
    if (page && sanitized && this.deps.model) {
      const ai = await this.explain(log, { host, risk, identity: official?.organization ?? null, findings, coverage, page: sanitized, analysis: page.data! });
      explanation = ai?.explanation;
      // La IA solo puede subir a riesgo medio con un motivo concreto; nunca bajar.
      if (ai?.concern && (risk === 'no_signals' || risk === 'unknown')) {
        findings.push({ code: ai.concern.code, source: 'Análisis con IA', checkedAt, observedBy: 'service', detail: ai.concern.detail });
        risk = 'medium';
      }
    }

    const status = !page ? 'pending' : mandatoryComplete ? 'complete' : 'partial';
    const sources = [reputation, identity, registration, connection, ...(page ? [page] : [])];
    const incomplete = Object.values(coverage).some((level) => level === 'unavailable' || level === 'partial');
    const ttl = Math.min(...sources.filter((s) => s.ttlMs > 0).map((s) => s.ttlMs), CONTENT_TTL_MS, incomplete || !page ? INCOMPLETE_TTL_MS : Number.POSITIVE_INFINITY);
    const impersonated = findings.find((f) => f.impersonatedOrganization)?.impersonatedOrganization;

    return this.finish(log, phase, startedAt, {
      ...base,
      status,
      identity: {
        status: official ? 'verified_official' : 'unknown',
        ...(official ? { organization: official.organization } : {}),
        ...(impersonated && !official ? { impersonatedOrganization: impersonated } : {}),
      },
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
          reasons: response.reasons.map((r) => r.code),
          coverage: response.coverage,
          latencyMs: Math.round(performance.now() - startedAt),
        },
      },
      'site check',
    );
    return response;
  }

  private async explain(
    log: FastifyBaseLogger,
    context: { host: HostInfo; risk: SiteRisk; identity: string | null; findings: Finding[]; coverage: SiteCheckCoverage; page: PageSummary; analysis: PageAnalysis },
  ): Promise<SiteCheckOutput | null> {
    const model = this.deps.model!;
    const input = {
      site: { hostname: context.host.hostname, registrableDomain: context.host.registrableDomain },
      identity: context.identity ? { status: 'verified_official', organization: context.identity } : { status: 'unknown' },
      risk: context.risk,
      reasons: context.findings.map((f) => ({ code: f.code, category: CATEGORY[f.code], detail: f.detail })),
      coverage: context.coverage,
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
      return {
        explanation: explanation && !claimsTrust ? explanation : '',
        concern: parsed.concern ? { code: parsed.concern.code, detail: parsed.concern.detail.slice(0, 300) || 'Pedido sospechoso en la página' } : null,
      };
    } catch (error) {
      // Sin explicación no cambia el resultado: las reglas ya decidieron.
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
