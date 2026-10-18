import { createHash } from 'node:crypto';

/** Clave de caché sin datos legibles: hash de la URL o el dominio. */
export const cacheKey = (...parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('base64url');

interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
}

/**
 * Caché en memoria con vencimiento por entrada y deduplicación de consultas simultáneas:
 * dos navegaciones al mismo sitio comparten la misma consulta al proveedor.
 * Guarda solo resultados de fuentes (reputación, RDAP, conexión), nunca respuestas completas
 * ni contenido de páginas: cada respuesta se arma para su navegación y versión.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** `ttlFor` decide el vencimiento según el resultado (por ejemplo, más corto si falló). */
  getOrLoad(key: string, load: () => Promise<T>, ttlFor: (value: T) => number): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const value = load();
    // Mientras está en curso, se comparte; si falla, no queda en caché.
    const entry: Entry<T> = { value, expiresAt: Number.POSITIVE_INFINITY };
    this.set(key, entry);
    const drop = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
    value.then((result) => {
      const ttl = ttlFor(result);
      if (ttl > 0) entry.expiresAt = this.now() + ttl;
      else drop();
    }, drop);
    return value;
  }

  private set(key: string, entry: Entry<T>): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, entry);
  }
}

export class BudgetExceededError extends Error {
  constructor() {
    super('Límite de consultas al proveedor alcanzado');
    this.name = 'BudgetExceededError';
  }
}

/** Tope de consultas por minuto a un proveedor (ventana deslizante). */
export class ProviderBudget {
  private calls: number[] = [];

  constructor(
    private readonly maxPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): void {
    const now = this.now();
    this.calls = this.calls.filter((t) => t > now - 60_000);
    if (this.calls.length >= this.maxPerMinute) throw new BudgetExceededError();
    this.calls.push(now);
  }
}

/** Ejecuta con un tiempo máximo; la señal permite cortar la petición subyacente. */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Tiempo de espera agotado');
      error.name = 'TimeoutError';
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
