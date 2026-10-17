import type { AppConfig } from '../../config/env.js';
import type { StructuredModel } from '../ai/model.js';
import { OfficialCatalog } from './catalog.js';
import { ConnectionInspector, type HopRequester } from './connection.js';
import type { HostResolver } from './net-guard.js';
import { RdapClient } from './rdap.js';
import { MockReputationProvider, ReputationChecker, SafeBrowsingProvider, WebRiskProvider, type ReputationProvider } from './reputation.js';
import { SiteCheckService } from './site-check.service.js';

/** Reemplazos para pruebas: ninguna prueba hace red real. */
export interface SiteCheckOverrides {
  reputationProvider?: ReputationProvider | null;
  /** fetch para RDAP y proveedores de reputación. */
  fetchImpl?: typeof fetch;
  resolver?: HostResolver;
  requester?: HopRequester;
  catalog?: OfficialCatalog;
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

export function createSiteCheckService(config: AppConfig, model: StructuredModel, overrides: SiteCheckOverrides = {}): SiteCheckService {
  const limits = { timeoutMs: config.SITE_CHECK_PROVIDER_TIMEOUT_MS, maxPerMinute: config.SITE_CHECK_PROVIDER_MAX_PER_MINUTE, now: overrides.now };
  const provider = overrides.reputationProvider !== undefined ? overrides.reputationProvider : reputationProvider(config, overrides.fetchImpl);
  return new SiteCheckService({
    catalog: overrides.catalog ?? new OfficialCatalog(),
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
}
