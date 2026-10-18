// Worker de inferencia: carga Whisper una vez y transcribe de a una solicitud,
// fuera del event loop principal. Nunca registra ni devuelve el audio, y el
// texto solo viaja de vuelta al hilo principal.
import { parentPort, workerData } from 'node:worker_threads';
import { loadWhisper, type WhisperOptions } from './whisper-pipeline.js';

export type WorkerRequest = { type: 'transcribe'; id: number; pcm: Float32Array };
export type WorkerResponse =
  | { type: 'ready'; loadMs: number; warmupMs: number }
  | { type: 'loadError'; errorName: string; message: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; errorName: string };

const port = parentPort;
if (!port) throw new Error('whisper.worker solo corre como worker_thread');

const send = (message: WorkerResponse) => port.postMessage(message);

try {
  const startedAt = performance.now();
  const whisper = await loadWhisper(workerData as WhisperOptions);
  const loadMs = Math.round(performance.now() - startedAt);

  // Primera inferencia con un segundo de silencio: inicializa kernels y memoria antes de la primera persona.
  const warmupAt = performance.now();
  await whisper(new Float32Array(16_000));
  send({ type: 'ready', loadMs, warmupMs: Math.round(performance.now() - warmupAt) });

  port.on('message', async (request: WorkerRequest) => {
    try {
      send({ type: 'result', id: request.id, text: await whisper(request.pcm) });
    } catch (error) {
      send({ type: 'error', id: request.id, errorName: error instanceof Error ? error.name : 'Error' });
    }
  });
} catch (error) {
  // Errores de carga (descarga, archivo faltante): no contienen datos de personas.
  const { name, message } = error instanceof Error ? error : new Error(String(error));
  send({ type: 'loadError', errorName: name, message: message.slice(0, 300) });
}
