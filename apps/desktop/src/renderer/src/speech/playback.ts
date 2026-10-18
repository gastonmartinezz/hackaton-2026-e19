/**
 * Reproducción de lo que se lee en voz alta: el MP3 del servidor, que suena
 * mientras llega (MediaSource), o, si el servidor tiene la voz apagada, la voz
 * del sistema en español. Nada se guarda: el audio vive en memoria y se libera
 * al terminar.
 */
import type { SpeechDiagnostic } from '../../../shared/ipc';

export interface Playback {
  /** Termina sola (`ended`), por un error (`failed`) o al detenerla (`stopped`). */
  readonly done: Promise<'ended' | 'failed' | 'stopped'>;
  stop(): void;
}

/** MP3 que llega en pedazos: se reproduce mientras llega. */
export interface Mp3Stream {
  push(chunk: Uint8Array): void;
  /** Ya llegó todo. */
  end(): void;
  /** La descarga falló: se corta. */
  fail(): void;
  readonly playback: Playback;
  /** `progressive`: empieza a sonar con los primeros datos; `buffered`: espera a tener todo. */
  readonly mode: 'progressive' | 'buffered';
}

const MP3 = 'audio/mpeg';

/**
 * Abre la reproducción progresiva con MediaSource (`audio/mpeg`). Si este
 * Chromium no la soporta, junta los pedazos y reproduce al final.
 */
export function openMp3Stream(): Mp3Stream {
  const progressive = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MP3);
  return progressive ? mediaSourceStream() : bufferedStream();
}

function mediaSourceStream(): Mp3Stream {
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const element = new Audio();
  const queue: Uint8Array[] = [];
  let buffer: SourceBuffer | null = null;
  let complete = false;
  let closed = false;
  let finish: (result: 'ended' | 'failed' | 'stopped') => void = () => {};
  const done = new Promise<'ended' | 'failed' | 'stopped'>((resolve) => (finish = resolve));

  const close = (result: 'ended' | 'failed' | 'stopped') => {
    if (closed) return;
    closed = true;
    queue.length = 0;
    element.pause();
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(url);
    finish(result);
  };
  /** Agrega el próximo pedazo cuando el buffer está libre; al final, cierra el stream. */
  const pump = () => {
    if (closed || !buffer || buffer.updating) return;
    const next = queue.shift();
    if (next) {
      try {
        buffer.appendBuffer(new Uint8Array(next));
      } catch {
        close('failed');
      }
      return;
    }
    if (complete && source.readyState === 'open') {
      try {
        source.endOfStream();
      } catch {
        // Ya estaba cerrado.
      }
    }
  };

  source.addEventListener(
    'sourceopen',
    () => {
      if (closed) return;
      try {
        buffer = source.addSourceBuffer(MP3);
      } catch {
        return close('failed');
      }
      buffer.addEventListener('updateend', pump);
      buffer.addEventListener('error', () => close('failed'));
      pump();
    },
    { once: true },
  );
  element.addEventListener('ended', () => close('ended'), { once: true });
  element.addEventListener('error', () => close('failed'), { once: true });
  element.src = url;
  // Empieza a sonar en cuanto hay datos suficientes.
  element.play().catch(() => close('failed'));

  return {
    mode: 'progressive',
    playback: { done, stop: () => close('stopped') },
    push(chunk) {
      if (closed) return;
      queue.push(chunk);
      pump();
    },
    end() {
      complete = true;
      pump();
    },
    fail: () => close('failed'),
  };
}

/** Respaldo sin MediaSource: junta todo y reproduce al final. */
function bufferedStream(): Mp3Stream {
  const chunks: Uint8Array[] = [];
  let inner: Playback | null = null;
  let closed = false;
  let finish: (result: 'ended' | 'failed' | 'stopped') => void = () => {};
  const done = new Promise<'ended' | 'failed' | 'stopped'>((resolve) => (finish = resolve));
  const close = (result: 'ended' | 'failed' | 'stopped') => {
    if (closed) return;
    closed = true;
    chunks.length = 0;
    finish(result);
  };
  return {
    mode: 'buffered',
    playback: {
      done,
      stop: () => {
        inner?.stop();
        close('stopped');
      },
    },
    push(chunk) {
      if (!closed) chunks.push(chunk);
    },
    end() {
      if (closed) return;
      const audio = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.byteLength;
      }
      inner = playMp3(audio);
      void inner.done.then(close);
    },
    fail: () => close('failed'),
  };
}

/** Reproduce un MP3 ya descargado (respaldo cuando no hay MediaSource). */
export function playMp3(audio: Uint8Array): Playback {
  const url = URL.createObjectURL(new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }));
  const element = new Audio(url);
  let finish: (result: 'ended' | 'failed' | 'stopped') => void = () => {};
  const done = new Promise<'ended' | 'failed' | 'stopped'>((resolve) => (finish = resolve));
  let closed = false;
  const close = (result: 'ended' | 'failed' | 'stopped') => {
    if (closed) return;
    closed = true;
    element.pause();
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(url);
    finish(result);
  };
  element.addEventListener('ended', () => close('ended'), { once: true });
  element.addEventListener('error', () => close('failed'), { once: true });
  element.play().catch(() => close('failed'));
  return { done, stop: () => close('stopped') };
}

/** Normaliza `es_AR` → `es-ar`. */
const lang = (voice: Pick<SpeechSynthesisVoice, 'lang'>) => voice.lang.replace('_', '-').toLowerCase();

/** Variantes de voz que no corresponden para leer indicaciones (y podrían sonar a burla). */
const NOVELTY_VOICES = /grandma|grandpa|abuel|rocko|shelley|sandy|flo\b|eddy|reed|bad news|bells|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|bahh|boing/i;

/**
 * Voz del sistema en español: cualquier `es-*` sirve. Se prefiere es-UY, después
 * es-AR, después otras de Latinoamérica (es-419, es-MX, es-US…) y por último
 * es-ES; dentro de cada grupo, las voces locales y las clásicas (en macOS,
 * «Paulina» o «Mónica») antes que las variantes. Null si no hay ninguna.
 */
export function pickSpanishVoice<T extends Pick<SpeechSynthesisVoice, 'lang' | 'localService' | 'name'>>(voices: readonly T[]): T | null {
  const spanish = voices.filter((v) => lang(v) === 'es' || lang(v).startsWith('es-'));
  const region = (v: T) => (lang(v) === 'es-uy' ? 0 : lang(v) === 'es-ar' ? 1 : lang(v) === 'es-es' ? 3 : 2);
  const rank = (v: T) => region(v) * 4 + (NOVELTY_VOICES.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return [...spanish].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Cuánto se espera a que el sistema cargue sus voces (en un arranque en frío puede tardar). */
export const VOICES_TIMEOUT_MS = 5_000;

/**
 * Voces del sistema. En Chromium la lista llega un rato después de la primera
 * consulta, y el primer `voiceschanged` puede llegar con la lista todavía
 * vacía: se espera hasta tener voces (o hasta el tope), mirando en cada aviso
 * y cada 100 ms.
 */
export async function systemVoices(timeoutMs = VOICES_TIMEOUT_MS): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return [];
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return now;
  return new Promise((resolve) => {
    const check = () => {
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) return;
      done(voices);
    };
    const poll = setInterval(check, 100);
    const timer = setTimeout(() => done(speechSynthesis.getVoices()), timeoutMs);
    const done = (voices: SpeechSynthesisVoice[]) => {
      clearInterval(poll);
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', check);
      resolve(voices);
    };
    speechSynthesis.addEventListener('voiceschanged', check);
  });
}

/** Pide la lista de voces apenas se puede, para que esté lista cuando haga falta. */
export function warmUpVoices(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
}

/** Por qué no se pudo leer con la voz del sistema. */
export type SystemSpeechProblem = 'noSpanishVoice' | 'noVoices';

/** Lectura con la voz del sistema que está sonando (o en cola) en esta vista. */
let speaking: SpeechSynthesisUtterance | null = null;

/** Una lectura que ya no hace falta: no suena y detenerla no hace nada. */
const notWanted = (): Playback => ({ done: Promise.resolve('stopped'), stop: () => {} });

/**
 * Lee con la voz del sistema. `noSpanishVoice`: el sistema tiene voces pero
 * ninguna en español (no va a haber); `noVoices`: no llegaron las voces (puede
 * ser momentáneo).
 *
 * `stillWanted`: se consulta al terminar de esperar las voces. Si la lectura ya
 * no hace falta (se detuvo, la cortó otra o la vista se cerró), no suena ni
 * llama a `speechSynthesis.cancel()`: una lectura vieja nunca corta a una más
 * nueva.
 */
export async function systemSpeak(
  text: string,
  voicesTimeoutMs = VOICES_TIMEOUT_MS,
  report: (data: SpeechDiagnostic) => void = () => {},
  stillWanted: () => boolean = () => true,
): Promise<Playback | SystemSpeechProblem> {
  const started = performance.now();
  const voices = await systemVoices(voicesTimeoutMs);
  if (!stillWanted()) return notWanted();
  const spanishVoices = voices.filter((v) => lang(v) === 'es' || lang(v).startsWith('es-')).length;
  const voice = pickSpanishVoice(voices);
  // Diagnóstico sin contenido: cuántas voces, cuántas en español, cuánto se esperó y cuál se eligió.
  const base = { voices: voices.length, spanishVoices, waitMs: Math.round(performance.now() - started), chosenLang: voice?.lang ?? null } as const;
  if (voices.length === 0) {
    report({ ...base, outcome: 'noVoices', event: 'none', errorType: null });
    return 'noVoices';
  }
  if (!voice) {
    report({ ...base, outcome: 'noSpanishVoice', event: 'none', errorType: null });
    return 'noSpanishVoice';
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  let finish: (result: 'ended' | 'failed' | 'stopped') => void = () => {};
  const done = new Promise<'ended' | 'failed' | 'stopped'>((resolve) => (finish = resolve));
  const event = (name: 'start' | 'end' | 'error', errorType: string | null = null) => report({ ...base, outcome: 'ok', event: name, errorType });
  const release = () => {
    if (speaking === utterance) speaking = null;
  };
  utterance.addEventListener('start', () => event('start'));
  utterance.addEventListener('end', () => {
    release();
    event('end');
    finish('ended');
  });
  utterance.addEventListener('error', (e) => {
    release();
    const type = (e as SpeechSynthesisErrorEvent).error;
    // `interrupted`/`canceled` son «Detener» u otra lectura: no es una falla.
    if (type !== 'interrupted' && type !== 'canceled') event('error', /^[a-z-]{1,40}$/.test(type) ? type : 'other');
    finish(type === 'interrupted' || type === 'canceled' ? 'stopped' : 'failed');
  });
  speechSynthesis.cancel();
  speaking = utterance;
  speechSynthesis.speak(utterance);
  return {
    done,
    stop: () => {
      // Solo se calla si esta lectura sigue sonando: si ya terminó o la reemplazó otra, no se toca la nueva.
      if (speaking === utterance) {
        speaking = null;
        speechSynthesis.cancel();
      }
      finish('stopped');
    },
  };
}
