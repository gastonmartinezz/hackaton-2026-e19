import type { AppConfig } from '../../config/env.js';
import type { StructuredModel } from '../ai/model.js';
import { AuthorityService, loadPopularDomains } from './authority.js';
import { BcuRegistry } from './bcu-registry.js';
import { ConnectionInspector, type HopRequester } from './connection.js';
import type { HostResolver } from './net-guard.js';
import { loadOfficialSources, type OfficialSources } from './official-sources.js';
import { RdapClient } from './rdap.js';
import { MockReputationProvider, ReputationChecker, SafeBrowsingProvider, WebRiskProvider, type ReputationProvider } from './reputation.js';
import { SiteCheckService } from './site-check.service.js';

const HOUR = 60 * 60_000;

/** Reemplazos para pruebas: ninguna prueba hace red real. */
export interface SiteCheckOverrides {
  reputationProvider?: ReputationProvider | null;
  /** fetch para RDAP, registro del BCU y proveedores de reputación. */
  fetchImpl?: typeof fetch;
  resolver?: HostResolver;
  requester?: HopRequester;
  /** Fuentes oficiales ya cargadas, o archivos de catálogo curado a cargar en lugar de los de `data/`. */
  officialSources?: OfficialSources;
  catalogFiles?: string[];
  now?: () => number;
}

function reputationProvider(config: AppConfig, fetchImpl?: typeof fetch): ReputationProvider | null {
  switch (config.REPUTATION_PROVIDER) {
    case 'mock':
      return new MockReputationProvider();
    case 'safe_browsing':
      return new SafeBrowsingProvider(config.GOOGLE_SAFE_BROWSING_API_KEY!, fetchImpl);
    case 'web_risk':
      return new WebRiskProvider(config.GOOGLE_WEB_RISK_API_KEY!, fetchImpl);
    default:
      return null;
  }
}

export function createSiteCheckService(config: AppConfig, model: StructuredModel, overrides: SiteCheckOverrides = {}): { service: SiteCheckService; authority: AuthorityService } {
  const limits = { timeoutMs: config.SITE_CHECK_PROVIDER_TIMEOUT_MS, maxPerMinute: config.SITE_CHECK_PROVIDER_MAX_PER_MINUTE, now: overrides.now };
  const provider = overrides.reputationProvider !== undefined ? overrides.reputationProvider : reputationProvider(config, overrides.fetchImpl);
  // Un archivo de fuentes inválido detiene el arranque.
  const sources = overrides.officialSources ?? loadOfficialSources(overrides.catalogFiles ? { catalogFiles: overrides.catalogFiles } : {});
  // Sin fetch de prueba usa bcuFetch: solo www.bcu.gub.uy, con los intermedios de su certificado.
  const registry = new BcuRegistry({
    enabled: config.SITE_CHECK_BCU_REGISTRY,
    fetchImpl: overrides.fetchImpl,
    requestTimeoutMs: config.SITE_CHECK_BCU_TIMEOUT_MS,
    refreshAfterMs: 24 * HOUR,
    validForMs: 48 * HOUR,
    usableForMs: 7 * 24 * HOUR,
    now: overrides.now,
  });
  const popular = config.SITE_CHECK_POPULAR_DOMAINS_FILE ? loadPopularDomains(config.SITE_CHECK_POPULAR_DOMAINS_FILE, config.SITE_CHECK_POPULAR_DOMAINS_LIMIT) : [];
  const authority = new AuthorityService(sources, registry, popular, config.SITE_CHECK_PROVIDER_TIMEOUT_MS);

  const service = new SiteCheckService({
    authority,
    reputation: new ReputationChecker(provider, limits),
    rdap: new RdapClient({ ...limits, enabled: config.SITE_CHECK_RDAP, fetchImpl: overrides.fetchImpl }),
    connection: new ConnectionInspector({
      ...limits,
      timeoutMs: config.SITE_CHECK_CONNECTION_TIMEOUT_MS,
      enabled: config.SITE_CHECK_CONNECTION,
      resolver: overrides.resolver,
      requester: overrides.requester,
    }),
    model: config.SITE_CHECK_AI ? model : null,
    aiTimeoutMs: config.SITE_CHECK_AI_TIMEOUT_MS,
    now: overrides.now,
  });
  return { service, authority };
}
