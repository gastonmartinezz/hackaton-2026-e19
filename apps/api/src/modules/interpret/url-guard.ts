import type { InterpretOutput } from '../ai/schemas.js';
import { describeRejection, type UrlCheck, type UrlRejection, type UrlVerifier } from '../urls/url-verifier.js';

export interface FailedUrl {
  url: string;
  reason: string;
}

/** Lo que se registra de una verificación: números, motivos y como mucho el dominio. Nunca la URL completa. */
export interface UrlGuardStats {
  checked: number;
  valid: number;
  invalid: Partial<Record<UrlRejection, number>>;
  rootFallbacks: number;
  dropped: number;
  converted: 'none' | 'redirect' | 'question';
  invalidDomains: string[];
}

export function urlsOf(output: InterpretOutput): string[] {
  if (output.type === 'redirect') return output.url ? [output.url] : [];
  if (output.type === 'options') return output.options.map((option) => option.url);
  return [];
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '(inválida)';
  }
}

/** Mensaje cuando ninguna URL resultó válida. Sale de design/textos.es.json (otras.pedir). */
export const NO_VALID_SITE_QUESTION = '¿No está lo que buscás? Contame qué querés hacer.';

/**
 * Verifica las URLs de una respuesta de interpret y arma lo que hace falta para
 * corregirla: qué URLs fallaron (para el reintento con Claude) y la versión
 * reparada (raíz del dominio si es válida, o sin esa URL).
 */
export class UrlGuard {
  constructor(private readonly verifier: UrlVerifier) {}

  async checkAll(output: InterpretOutput): Promise<Map<string, UrlCheck>> {
    const urls = [...new Set(urlsOf(output))];
    const results = await Promise.all(urls.map(async (url) => [url, await this.verifier.verify(url)] as const));
    return new Map(results);
  }

  /**
   * Verifica en segundo plano la raíz del dominio de las URLs que fallaron, mientras Claude responde el
   * reintento: el verificador guarda el resultado en caché y `repair` ya no espera esas consultas. Nunca falla.
   */
  prefetchRoots(failed: FailedUrl[]): Promise<void> {
    const roots = [...new Set(failed.map((f) => rootOf(f.url)).filter((root): root is string => Boolean(root)))];
    return Promise.allSettled(roots.map((root) => this.verifier.verify(root))).then(() => undefined);
  }

  failed(checks: Map<string, UrlCheck>): FailedUrl[] {
    return [...checks]
      .filter((entry): entry is [string, Extract<UrlCheck, { ok: false }>] => !entry[1].ok)
      .map(([url, check]) => ({ url, reason: describeRejection(check) }));
  }

  /**
   * Deja solo URLs verificadas. Una URL inválida se reemplaza por la raíz de su dominio
   * si esa raíz es válida; si no, se saca. Sin URLs válidas, la respuesta pasa a ser una pregunta.
   */
  async repair(output: InterpretOutput, checks: Map<string, UrlCheck>, stats: UrlGuardStats): Promise<InterpretOutput> {
    const fix = async (url: string): Promise<string | null> => {
      const check = checks.get(url) ?? (await this.verifier.verify(url));
      if (check.ok) return url;
      const root = rootOf(url);
      if (root && root !== url && (await this.verifier.verify(root)).ok) {
        stats.rootFallbacks++;
        return root;
      }
      stats.dropped++;
      return null;
    };

    if (output.type === 'redirect') {
      const url = output.url ? await fix(output.url) : null;
      if (url) return { ...output, url };
      stats.converted = 'question';
      return { ...output, type: 'question', url: null, options: [], message: NO_VALID_SITE_QUESTION };
    }

    if (output.type === 'options') {
      // Todas las opciones a la vez; el orden y el descarte de repetidas se aplican después.
      const fixed = await Promise.all(output.options.map((option) => fix(option.url)));
      const seen = new Set<string>();
      const options: InterpretOutput['options'] = [];
      for (const [i, option] of output.options.entries()) {
        const url = fixed[i];
        if (!url || seen.has(url)) continue;
        seen.add(url);
        options.push({ ...option, url });
      }
      if (options.length >= 2) return { ...output, options };
      if (options.length === 1) {
        const [only] = options as [InterpretOutput['options'][number]];
        stats.converted = 'redirect';
        return { ...output, type: 'redirect', url: only.url, options: [], message: `Te llevo a ${only.title}.` };
      }
      stats.converted = 'question';
      return { ...output, type: 'question', url: null, options: [], message: NO_VALID_SITE_QUESTION };
    }
    return output;
  }
}

export function emptyStats(): UrlGuardStats {
  return { checked: 0, valid: 0, invalid: {}, rootFallbacks: 0, dropped: 0, converted: 'none', invalidDomains: [] };
}

export function countChecks(checks: Map<string, UrlCheck>, stats: UrlGuardStats): void {
  for (const [url, check] of checks) {
    stats.checked++;
    if (check.ok) {
      stats.valid++;
    } else {
      stats.invalid[check.reason] = (stats.invalid[check.reason] ?? 0) + 1;
      stats.invalidDomains.push(domainOf(url));
    }
  }
}

function rootOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}
