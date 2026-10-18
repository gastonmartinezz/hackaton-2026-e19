import { z } from 'zod';
import { cacheKey, ProviderBudget, TtlCache, withTimeout } from './cache.js';
import { ProviderHttpError, unavailable, type SourceResult } from './types.js';

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_TTL_MS = 24 * 60 * 60_000;
const DOMAIN_TTL_MS = 24 * 60 * 60_000;
/** Menos de esta antigüedad cuenta como registro reciente (solo señal de apoyo). */
const RECENT_MS = 30 * 24 * 60 * 60_000;

const Bootstrap = z.object({ services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])) });

const RdapDomain = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string().optional() })).optional(),
});

/**
 * Registro de dominios por RDAP. El servidor de cada TLD sale del bootstrap oficial de IANA:
 * nunca se consulta un servidor elegido por la solicitud. Solo se envía el dominio registrable.
 * La antigüedad es solo una señal de apoyo: un dominio antiguo no garantiza que el sitio sea confiable.
 * `.uy` no publica RDAP: para dominios uruguayos la cobertura queda `unavailable`.
 */
export class RdapClient {
  private readonly cache = new TtlCache<SourceResult>();
  private bootstrap: { services: Map<string, string>; expiresAt: number } | undefined;
  private readonly budget: ProviderBudget;

  constructor(
    private readonly options: { timeoutMs: number; maxPerMinute: number; enabled: boolean; fetchImpl?: typeof fetch; now?: () => number },
  ) {
    this.budget = new ProviderBudget(options.maxPerMinute, options.now);
  }

  private get now() {
    return (this.options.now ?? Date.now)();
  }

  lookup(domain: string): Promise<SourceResult> {
    const checkedAt = new Date(this.now).toISOString();
    // SITE_CHECK_RDAP=false
    if (!this.options.enabled) return Promise.resolve({ ...unavailable(), disabled: true });
    return this.cache.getOrLoad(
      cacheKey('rdap', domain),
      async () => {
        try {
          const tld = domain.slice(domain.lastIndexOf('.') + 1);
          const base = (await withTimeout(this.options.timeoutMs, (signal) => this.services(signal))).get(tld);
          // El TLD no publica RDAP en el bootstrap de IANA (.uy, por ejemplo): no se consulta afuera ni se gasta
          // cupo, y la respuesta se guarda tanto como el bootstrap.
          if (!base) return { ...unavailable(), ttlMs: BOOTSTRAP_TTL_MS };
          this.budget.take();
          return await withTimeout(this.options.timeoutMs, (signal) => this.query(domain, base, checkedAt, signal));
        } catch {
          return unavailable();
        }
      },
      (result) => result.ttlMs,
    );
  }

  private async query(domain: string, base: string, checkedAt: string, signal: AbortSignal): Promise<SourceResult> {
    const server = new URL(base).hostname;
    const response = await this.fetch(`${base}domain/${encodeURIComponent(domain)}`, signal);
    if (response.status === 404) return { ...unavailable(), coverage: 'partial' };
    if (!response.ok) throw new ProviderHttpError(response.status);
    const body = RdapDomain.parse(await response.json());

    const registeredAt = body.events?.find((e) => e.eventAction === 'registration')?.eventDate ?? null;

    const registeredMs = registeredAt ? Date.parse(registeredAt) : Number.NaN;
    const recent = Number.isFinite(registeredMs) && this.now - registeredMs < RECENT_MS;
    return {
      // Sin fecha de alta, el registro queda parcial.
      coverage: registeredAt ? 'complete' : 'partial',
      ttlMs: DOMAIN_TTL_MS,
      findings: recent
        ? [{ code: 'RECENTLY_REGISTERED', source: `RDAP (${server})`, checkedAt, observedBy: 'service', detail: `Dominio registrado el ${registeredAt!.slice(0, 10)}` }]
        : [],
    };
  }

  /** Mapa TLD → URL base HTTPS, del bootstrap de IANA (en caché 24 h). */
  private async services(signal: AbortSignal): Promise<Map<string, string>> {
    if (this.bootstrap && this.bootstrap.expiresAt > this.now) return this.bootstrap.services;
    const response = await this.fetch(BOOTSTRAP_URL, signal);
    if (!response.ok) throw new ProviderHttpError(response.status);
    const services = new Map<string, string>();
    for (const [tlds, urls] of Bootstrap.parse(await response.json()).services) {
      const https = urls.find((url) => url.startsWith('https://'));
      if (!https) continue;
      for (const tld of tlds) services.set(tld.toLowerCase(), https.endsWith('/') ? https : `${https}/`);
    }
    this.bootstrap = { services, expiresAt: this.now + BOOTSTRAP_TTL_MS };
    return services;
  }

  private fetch(url: string, signal: AbortSignal) {
    // Sin cookies ni credenciales; RDAP es público.
    return (this.options.fetchImpl ?? fetch)(url, { headers: { accept: 'application/rdap+json, application/json' }, redirect: 'follow', credentials: 'omit', signal });
  }
}
