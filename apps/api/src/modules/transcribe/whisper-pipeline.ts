// Carga de Whisper con transformers.js (ONNX Runtime en CPU). La usan el worker
// de inferencia y el script que descarga el modelo al construir la imagen.
import { env, LogLevel, pipeline } from '@huggingface/transformers';

export interface WhisperOptions {
  model: string;
  dtype: 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4';
  cacheDir: string;
  /** Hilos de ONNX Runtime; 0 deja el valor por defecto de la librería. */
  threads: number;
  /** false: solo archivos ya descargados en cacheDir. */
  allowRemote: boolean;
}

export type Whisper = (pcm: Float32Array) => Promise<string>;

export async function loadWhisper(options: WhisperOptions): Promise<Whisper> {
  env.cacheDir = options.cacheDir;
  env.allowRemoteModels = options.allowRemote;
  env.logLevel = LogLevel.ERROR;

  const transcriber = await pipeline('automatic-speech-recognition', options.model, {
    device: 'cpu',
    dtype: options.dtype,
    session_options: {
      // 3 = solo errores: ONNX Runtime no imprime avisos por cada sesión.
      logSeverityLevel: 3,
      ...(options.threads > 0 ? { intraOpNumThreads: options.threads, interOpNumThreads: 1 } : {}),
    },
  });

  return async (pcm) => {
    const output = await transcriber(pcm, { language: 'spanish', task: 'transcribe' });
    const first = Array.isArray(output) ? output[0] : output;
    return first?.text ?? '';
  };
}
