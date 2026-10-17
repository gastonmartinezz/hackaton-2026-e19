import { z } from 'zod';
import { cacheKey, ProviderBudget, TtlCache, withTimeout } from './cache.js';
import { errorKind, ProviderHttpError, type Finding, type SourceResult } from './types.js';

export type Threat = 'phishing' | 'malware' | 'unwanted';

export interface ReputationVerdict {
  threats: Threat[];
  /** Vigencia que indica el proveedor; si no la indica, se usa la por defecto. */
  ttlMs?: number;
}

/**
 * Proveedor de reputación. Solo CONSULTA reportes existentes: ninguna implementación envía
 * URLs a escanear ni las publica. Recibe URLs ya depuradas (sin query, fragmento ni secretos).
 */
export interface ReputationProvider {
  readonly name: string;
  lookup(urls: string[], signal: AbortSignal): Promise<ReputationVerdict>;
}

const CLEAN_TTL_MS = 10 * 60_000;
const THREAT_TTL_MS = 30 * 60_000;

const parseDuration = (value: string | undefined) => {
  const seconds = value ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, THREAT_TTL_MS) : undefined;
};

const GOOGLE_THREATS: Record<string, Threat> = {
  SOCIAL_ENGINEERING: 'phishing',
  MALWARE: 'malware',
  UNWANTED_SOFTWARE: 'unwanted',
  POTENTIALLY_HARMFUL_APPLICATION: 'malware',
};

const SafeBrowsingResponse = z.object({
  matches: z.array(z.object({ threatType: z.string(), cacheDuration: z.string().optional() })).optional(),
});

/**
 * Google Safe Browsing Lookup API v4 (`threatMatches:find`). Gratuita y solo para uso no
 * comercial: para un servicio comercial corresponde Web Risk. La URL viaja en claro a Google.
 */
export class SafeBrowsingProvider implements ReputationProvider {
  readonly name = 'Google Safe Browsing';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async lookup(urls: string[], signal: AbortSignal): Promise<ReputationVerdict> {
    const response = await this.fetchImpl(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'mostrame', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: Object.keys(GOOGLE_THREATS),
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
      signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);
    const matches = SafeBrowsingResponse.parse(await response.json()).matches ?? [];
    const threats = [...new Set(matches.flatMap((m) => (GOOGLE_THREATS[m.threatType] ? [GOOGLE_THREATS[m.threatType]!] : [])))];
    const ttls = matches.map((m) => parseDuration(m.cacheDuration?.replace(/s$/, ''))).filter((t) => t !== undefined);
    return { threats, ttlMs: ttls.length ? Math.min(...ttls) : undefined };
  }
}

const WebRiskResponse = z.object({
  threat: z.object({ threatTypes: z.array(z.string()), expireTime: z.string().optional() }).optional(),
});

/** Google Cloud Web Risk (`uris.search`). Licencia comercial y facturación por consulta. */
export class WebRiskProvider implements ReputationProvider {
  readonly name = 'Google Web Risk';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async lookup(urls: string[], signal: AbortSignal): Promise<ReputationVerdict> {
    const results = await Promise.all(
      urls.map(async (uri) => {
        const params = new URLSearchParams({ uri, key: this.apiKey });
        for (const type of ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']) params.append('threatTypes', type);
        const response = await this.fetchImpl(`https://webrisk.googleapis.com/v1/uris:search?${params}`, { signal });
        if (!response.ok) throw new ProviderHttpError(response.status);
        return WebRiskResponse.parse(await response.json()).threat;
      }),
    );
    const threats = new Set<Threat>();
    const ttls: number[] = [];
    for (const threat of results) {
      if (!threat) continue;
      for (const type of threat.threatTypes) if (GOOGLE_THREATS[type]) threats.add(GOOGLE_THREATS[type]!);
      const expires = threat.expireTime ? Date.parse(threat.expireTime) - this.now() : Number.NaN;
      if (expires > 0) ttls.push(Math.min(expires, THREAT_TTL_MS));
    }
    return { threats: [...threats], ttlMs: ttls.length ? Math.min(...ttls) : undefined };
  }
}

/**
 * TEMPORAL: proveedor simulado para desarrollo y pruebas (REPUTATION_PROVIDER=mock).
 * Marca como amenaza los hosts con una etiqueta `phishing-demo` o `malware-demo`
 * (por ejemplo, https://phishing-demo.example.com/). No se permite en producción.
 */
export class MockReputationProvider implements ReputationProvider {
  readonly name = 'Reputación simulada';

  constructor(private readonly flagged: Record<string, Threat[]> = {}) {}

  async lookup(urls: string[]): Promise<ReputationVerdict> {
    const threats = new Set<Threat>();
    for (const url of urls) {
      const hostname = new URL(url).hostname;
      for (const threat of this.flagged[hostname] ?? []) threats.add(threat);
      const labels = hostname.split('.');
      if (labels.includes('phishing-demo')) threats.add('phishing');
      if (labels.includes('malware-demo')) threats.add('malware');
    }
    return { threats: [...threats] };
  }
}

export interface ReputationData {
  provider: string;
  threats: Threat[];
}

const LIMITATION = 'Solo consulta reportes existentes: un sitio nuevo puede no estar reportado todavía. La ausencia de reportes no aprueba el sitio.';

export class ReputationChecker {
  private readonly cache = new TtlCache<SourceResult<ReputationData>>();
  private readonly budget: ProviderBudget;

  constructor(
    private readonly provider: ReputationProvider | null,
    private readonly options: { timeoutMs: number; maxPerMinute: number; now?: () => number },
  ) {
    this.budget = new ProviderBudget(options.maxPerMinute, options.now);
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  /** `url` ya depurada. Se consulta la URL y la raíz del sitio. */
  check(url: URL): Promise<SourceResult<ReputationData>> {
    const provider = this.provider;
    const checkedAt = new Date((this.options.now ?? Date.now)()).toISOString();
    if (!provider) {
      return Promise.resolve({
        source: 'Sin proveedor',
        checkedAt,
        coverage: 'unavailable',
        ttlMs: 0,
        limitations: ['No hay un proveedor de reputación configurado (REPUTATION_PROVIDER).'],
        errors: ['not_configured'],
        data: null,
        findings: [],
      });
    }
    const urls = [...new Set([url.toString(), `${url.origin}/`])];
    return this.cache.getOrLoad(
      cacheKey('reputation', provider.name, ...urls),
      async () => {
        try {
          this.budget.take();
          const verdict = await withTimeout(this.options.timeoutMs, (signal) => provider.lookup(urls, signal));
          const findings: Finding[] = verdict.threats.map((threat) => ({
            code: threat === 'phishing' ? 'KNOWN_PHISHING' : 'KNOWN_MALWARE',
            source: provider.name,
            checkedAt,
            observedBy: 'external_scanner',
            detail: `Reportado por ${provider.name} como ${threat === 'phishing' ? 'phishing o ingeniería social' : threat === 'malware' ? 'software malicioso' : 'software no deseado'}`,
          }));
          const ttlMs = verdict.ttlMs ?? (findings.length ? THREAT_TTL_MS : CLEAN_TTL_MS);
          return { source: provider.name, checkedAt, coverage: 'complete', ttlMs, limitations: [LIMITATION], errors: [], data: { provider: provider.name, threats: verdict.threats }, findings };
        } catch (error) {
          return { source: provider.name, checkedAt, coverage: 'unavailable', ttlMs: 0, limitations: [LIMITATION], errors: [errorKind(error)], data: null, findings: [] };
        }
      },
      (result) => result.ttlMs,
    );
  }
}
