/**
 * Reproducción de lo que se lee en voz alta: el MP3 del servidor, que suena
 * mientras llega (MediaSource), o, si el servidor tiene la voz apagada, la voz
 * del sistema en español. Nada se guarda: el audio vive en memoria y se libera
 * al terminar.
 */

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

/** Voz del sistema en español: es-UY, después es-AR y después cualquier es-*. Null si no hay. */
export function pickSpanishVoice<T extends Pick<SpeechSynthesisVoice, 'lang' | 'localService'>>(voices: readonly T[]): T | null {
  const spanish = voices.filter((v) => lang(v) === 'es' || lang(v).startsWith('es-'));
  const rank = (v: T) => (lang(v) === 'es-uy' ? 0 : lang(v) === 'es-ar' ? 1 : 2) * 2 + (v.localService ? 0 : 1);
  return [...spanish].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Voces del sistema (en Chromium pueden llegar un rato después). */
async function systemVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return [];
  const now = speechSynthesis.getVoices();
  if (now.length > 0) return now;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1_000);
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(timer);
        resolve(speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}

/** ¿Hay una voz del sistema en español? */
export async function hasSystemVoice(): Promise<boolean> {
  return pickSpanishVoice(await systemVoices()) !== null;
}

/** Lee con la voz del sistema. Null si no hay voz en español. */
export async function systemSpeak(text: string): Promise<Playback | null> {
  const voice = pickSpanishVoice(await systemVoices());
  if (!voice) return null;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  let finish: (result: 'ended' | 'failed' | 'stopped') => void = () => {};
  const done = new Promise<'ended' | 'failed' | 'stopped'>((resolve) => (finish = resolve));
  utterance.addEventListener('end', () => finish('ended'));
  utterance.addEventListener('error', () => finish('failed'));
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  return {
    done,
    stop: () => {
      speechSynthesis.cancel();
      finish('stopped');
    },
  };
}
