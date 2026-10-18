export class QueueFullError extends Error {
  override readonly name = 'QueueFullError';
}

export class QueueAbortedError extends Error {
  override readonly name = 'QueueAbortedError';
}

interface Waiter {
  start: () => void;
  signal: AbortSignal;
  onAbort: () => void;
}

/**
 * Cola FIFO con concurrencia acotada y espera máxima.
 *
 * Si `signal` se aborta mientras la tarea espera, sale de la cola. Si se aborta
 * mientras corre, `run` rechaza enseguida pero el lugar recién se libera cuando
 * la tarea termina de verdad: así nunca hay más inferencias en paralelo que
 * `concurrency`, aunque la respuesta ya se haya enviado.
 */
export class TaskQueue {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueued: number,
  ) {}

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new QueueAbortedError('Abortada antes de empezar');
    await this.acquire(signal);
    if (signal.aborted) {
      this.release();
      throw new QueueAbortedError('Abortada antes de empezar');
    }

    let running: Promise<T>;
    try {
      running = task();
    } catch (error) {
      this.release();
      throw error;
    }
    running.then(
      () => this.release(),
      () => this.release(),
    );
    return raceAbort(running, signal);
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) return Promise.reject(new QueueFullError('Cola llena'));

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        start: () => {
          signal.removeEventListener('abort', waiter.onAbort);
          resolve();
        },
        onAbort: () => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(new QueueAbortedError('Abortada en la cola'));
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // El lugar pasa directo a la siguiente: `active` no cambia.
      next.start();
    } else {
      this.active--;
    }
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new QueueAbortedError('Abortada mientras corría'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new QueueAbortedError('Abortada mientras corría'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
