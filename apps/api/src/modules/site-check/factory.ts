import type { AppConfig } from '../../config/env.js';
import type { StructuredModel } from '../ai/model.js';
import { AuthorityService } from './authority.js';
import { BcuRegistry } from './bcu-registry.js';
import { ConnectionInspector, type HopRequester } from './connection.js';
import type { HostResolver } from './net-guard.js';
import { loadOfficialSources, type OfficialSources } from './official-sources.js';
import { RdapClient } from './rdap.js';
import { SiteCheckService } from './site-check.service.js';

const HOUR = 60 * 60_000;

/** Reemplazos para pruebas: ninguna prueba hace red real. */
export interface SiteCheckOverrides {
  /** fetch para RDAP y el registro del BCU. */
  fetchImpl?: typeof fetch;
  resolver?: HostResolver;
  requester?: HopRequester;
  /** Fuentes oficiales ya cargadas, o archivos de catálogo curado a cargar en lugar de los de `data/`. */
  officialSources?: OfficialSources;
  catalogFiles?: string[];
  now?: () => number;
}

export function createSiteCheckService(config: AppConfig, model: StructuredModel, overrides: SiteCheckOverrides = {}): { service: SiteCheckService; authority: AuthorityService } {
  const limits = { timeoutMs: config.SITE_CHECK_PROVIDER_TIMEOUT_MS, maxPerMinute: config.SITE_CHECK_PROVIDER_MAX_PER_MINUTE, now: overrides.now };
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
  const authority = new AuthorityService(sources, registry, config.SITE_CHECK_PROVIDER_TIMEOUT_MS);

  const service = new SiteCheckService({
    authority,
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
