/**
 * Captura del micrófono para el dictado. El audio vive solo en memoria: se
 * graba, se pasa a WAV 16 kHz mono y se entrega al proceso principal. Las
 * pistas del micrófono se cierran siempre al terminar, al cancelar o ante un
 * error.
 */
import { downmix, encodeWav, fitDuration, rms, WAV_SAMPLE_RATE } from '../../../shared/wav';
import { SilenceDetector, type SilenceVerdict } from './silence';

/** Por qué cortó solo: habló y se quedó en silencio, nunca habló, o llegó a 30 s. */
export type AutoStopReason = Exclude<SilenceVerdict, 'continue'>;

/** Por qué no se pudo abrir el micrófono. */
export type MicProblem = 'denied' | 'missing' | 'failed';

export class MicError extends Error {
  constructor(readonly problem: MicProblem) {
    super(problem);
    this.name = 'MicError';
  }
}

export function micProblem(error: unknown): MicProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'missing';
  return 'failed';
}

const POLL_MS = 100;

export class VoiceCapture {
  readonly #stream: MediaStream;
  readonly #recorder: MediaRecorder;
  readonly #context: AudioContext;
  readonly #chunks: Blob[] = [];
  readonly #timer: ReturnType<typeof setInterval>;
  #closed = false;

  /** Pide el micrófono (solo audio) y empieza a grabar. `onAutoStop`: 5 s de silencio, sin habla o 30 s. */
  static async open(onAutoStop: (reason: AutoStopReason) => void): Promise<VoiceCapture> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new MicError('missing');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch (error) {
      throw new MicError(micProblem(error));
    }
    try {
      return new VoiceCapture(stream, onAutoStop);
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw new MicError(micProblem(error));
    }
  }

  private constructor(stream: MediaStream, onAutoStop: (reason: AutoStopReason) => void) {
    this.#stream = stream;
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    this.#recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.#recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
    this.#context = new AudioContext();
    const analyser = this.#context.createAnalyser();
    analyser.fftSize = 2048;
    this.#context.createMediaStreamSource(stream).connect(analyser);
    const frame = new Float32Array(analyser.fftSize);
    const detector = new SilenceDetector();
    this.#timer = setInterval(() => {
      analyser.getFloatTimeDomainData(frame);
      const verdict = detector.push(rms(frame), performance.now());
      if (verdict !== 'continue') {
        clearInterval(this.#timer);
        onAutoStop(verdict);
      }
    }, POLL_MS);
    this.#recorder.start();
  }

  /** Termina de grabar y devuelve el WAV, o null si fue demasiado corto. */
  async finish(): Promise<ArrayBuffer | null> {
    if (this.#closed) return null;
    const stopped = new Promise<void>((resolve) => this.#recorder.addEventListener('stop', () => resolve(), { once: true }));
    if (this.#recorder.state !== 'inactive') this.#recorder.stop();
    else return (this.close(), null);
    await stopped;
    const blob = new Blob(this.#chunks, { type: this.#recorder.mimeType });
    this.close();
    return blobToWav(blob);
  }

  /** Corta sin guardar nada. Se puede llamar más de una vez. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#timer);
    if (this.#recorder.state !== 'inactive') {
      try {
        this.#recorder.stop();
      } catch {
        // Ya estaba detenido.
      }
    }
    for (const track of this.#stream.getTracks()) track.stop();
    void this.#context.close().catch(() => undefined);
    this.#chunks.length = 0;
  }
}

/**
 * Decodifica lo grabado directamente a 16 kHz (el contexto sin conexión
 * remuestrea al decodificar), lo pasa a mono y lo codifica en WAV PCM16.
 */
async function blobToWav(blob: Blob): Promise<ArrayBuffer | null> {
  if (blob.size === 0) return null;
  const context = new OfflineAudioContext(1, 1, WAV_SAMPLE_RATE);
  let decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (decoded.sampleRate !== WAV_SAMPLE_RATE) decoded = await resample(decoded);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const samples = fitDuration(downmix(channels));
  return samples ? encodeWav(samples, WAV_SAMPLE_RATE) : null;
}

/** Respaldo: remuestrea renderizando en un contexto sin conexión de 16 kHz mono. */
async function resample(buffer: AudioBuffer): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * WAV_SAMPLE_RATE)), WAV_SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return context.startRendering();
}
