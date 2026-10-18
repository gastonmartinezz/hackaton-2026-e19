import { availableParallelism } from 'node:os';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { FastifyBaseLogger } from 'fastify';
import type { SttConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import type { TranscriptionAudio, TranscriptionProvider } from './provider.js';
import type { WhisperOptions } from './whisper-pipeline.js';
import type { WorkerRequest, WorkerResponse } from './whisper.worker.js';

type SlotState = 'loading' | 'ready' | 'failed';

interface Job {
  id: number;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  /** Corta un worker que sigue ocupado mucho después del timeout. */
  killTimer?: NodeJS.Timeout;
}

interface Slot {
  index: number;
  state: SlotState;
  worker?: Worker;
  job?: Job;
  restartTimer?: NodeJS.Timeout;
  failures: number;
}

const RESTART_BASE_MS = 5_000;
const RESTART_MAX_MS = 5 * 60_000;

// En desarrollo (tsx) este archivo es .ts y el worker también; compilado, ambos son .js.
const WORKER_EXT = extname(fileURLToPath(import.meta.url));
const WORKER_URL = new URL(`./whisper.worker${WORKER_EXT}`, import.meta.url);

function startWorker(workerData: WhisperOptions): Worker {
  if (WORKER_EXT === '.ts') {
    // Solo en desarrollo: el loader que tsx pasa por --import no llega a tiempo para el
    // archivo de entrada de un worker, así que se registra a mano antes de importarlo.
    const tsx = import.meta.resolve('tsx/esm/api');
    const code = `import(${JSON.stringify(tsx)}).then((api) => { api.register(); return import(${JSON.stringify(WORKER_URL.href)}); })`;
    return new Worker(code, { eval: true, workerData });
  }
  return new Worker(WORKER_URL, { workerData });
}

/**
 * Whisper en este servidor: un worker_thread por inferencia concurrente
 * (STT_CONCURRENCY), cada uno con su copia del modelo. La carga empieza al
 * construir el proveedor y no bloquea el arranque; mientras tanto el estado es
 * `loading`. Si un worker se cae o no carga, se reinicia con espera creciente.
 */
export class LocalWhisperProvider implements TranscriptionProvider {
  private readonly slots: Slot[];
  private readonly options: WhisperOptions;
  private nextJobId = 1;
  private closed = false;

  constructor(
    private readonly config: SttConfig & { STT_CONCURRENCY: number },
    private readonly log: FastifyBaseLogger,
  ) {
    const threads = config.STT_THREADS || Math.max(1, Math.floor(availableParallelism() / config.STT_CONCURRENCY));
    this.options = {
      model: config.STT_MODEL,
      dtype: config.STT_DTYPE,
      cacheDir: config.STT_MODEL_DIR,
      threads,
      allowRemote: true,
    };
    this.slots = Array.from({ length: config.STT_CONCURRENCY }, (_, index) => ({ index, state: 'loading', failures: 0 }));
    for (const slot of this.slots) this.spawn(slot);
  }

  get status(): SlotState {
    if (this.slots.some((slot) => slot.state === 'ready')) return 'ready';
    if (this.slots.some((slot) => slot.state === 'loading')) return 'loading';
    return 'failed';
  }

  transcribe({ pcm }: TranscriptionAudio, signal: AbortSignal): Promise<string> {
    const slot = this.slots.find((candidate) => candidate.state === 'ready' && !candidate.job);
    if (!slot?.worker) return Promise.reject(new AppError('AI_UNAVAILABLE', 'No hay un modelo de voz libre'));
    const worker = slot.worker;

    return new Promise<string>((resolve, reject) => {
      const job: Job = { id: this.nextJobId++, resolve, reject };
      slot.job = job;

      // El worker no se puede interrumpir a mitad de una inferencia. Si pasó otro
      // timeout completo desde el aborto, se lo da por colgado y se lo reinicia.
      const onAbort = () => {
        job.killTimer = setTimeout(() => {
          if (slot.job !== job) return;
          this.log.warn({ stt: 'worker', slot: slot.index }, 'stt worker hung; restarting');
          this.fail(slot, new AppError('TIMEOUT', 'La transcripción tardó demasiado'));
          void worker.terminate();
        }, this.config.STT_TIMEOUT_MS);
        job.killTimer.unref();
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      const settle = () => {
        signal.removeEventListener('abort', onAbort);
        clearTimeout(job.killTimer);
      };
      job.resolve = (text) => {
        settle();
        resolve(text);
      };
      job.reject = (error) => {
        settle();
        reject(error);
      };

      // Se transfiere el buffer: no se copia el audio entre hilos.
      const request: WorkerRequest = { type: 'transcribe', id: job.id, pcm };
      worker.postMessage(request, [pcm.buffer as ArrayBuffer]);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      this.slots.map(async (slot) => {
        clearTimeout(slot.restartTimer);
        this.fail(slot, new AppError('AI_UNAVAILABLE', 'El servidor se está cerrando'));
        await slot.worker?.terminate();
      }),
    );
  }

  private spawn(slot: Slot): void {
    if (this.closed) return;
    slot.state = 'loading';
    const startedAt = performance.now();
    const worker = startWorker(this.options);
    slot.worker = worker;

    worker.on('message', (message: WorkerResponse) => {
      switch (message.type) {
        case 'ready':
          slot.state = 'ready';
          slot.failures = 0;
          this.log.info(
            {
              stt: 'ready',
              slot: slot.index,
              model: this.options.model,
              dtype: this.options.dtype,
              threads: this.options.threads,
              loadMs: message.loadMs,
              warmupMs: message.warmupMs,
              totalMs: Math.round(performance.now() - startedAt),
            },
            'stt model ready',
          );
          return;
        case 'loadError':
          this.log.error(
            { stt: 'loadError', slot: slot.index, model: this.options.model, errorName: message.errorName, reason: message.message },
            'stt model failed to load',
          );
          void worker.terminate();
          return;
        case 'result':
          if (slot.job?.id === message.id) this.finish(slot).resolve(message.text);
          return;
        case 'error':
          if (slot.job?.id === message.id) {
            this.log.error({ stt: 'inferenceError', slot: slot.index, errorName: message.errorName }, 'stt inference failed');
            this.finish(slot).reject(new AppError('INTERNAL', 'Falló la transcripción'));
          }
          return;
      }
    });
    worker.on('error', (error) => {
      // Con una transcripción en curso solo se registra el tipo de error, por si el mensaje arrastrara contenido.
      const reason = slot.job ? undefined : error.message.slice(0, 300);
      this.log.error({ stt: 'workerError', slot: slot.index, errorName: error.name, reason }, 'stt worker crashed');
    });
    worker.on('exit', () => {
      if (slot.worker !== worker) return;
      slot.worker = undefined;
      this.fail(slot, new AppError('AI_UNAVAILABLE', 'El modelo de voz se reinició'));
      if (this.closed) return;
      slot.failures++;
      const delay = Math.min(RESTART_BASE_MS * 2 ** (slot.failures - 1), RESTART_MAX_MS);
      slot.restartTimer = setTimeout(() => this.spawn(slot), delay);
      slot.restartTimer.unref();
    });
  }

  private finish(slot: Slot): Job {
    const job = slot.job!;
    slot.job = undefined;
    return job;
  }

  private fail(slot: Slot, error: AppError): void {
    slot.state = 'failed';
    if (slot.job) this.finish(slot).reject(error);
  }
}
