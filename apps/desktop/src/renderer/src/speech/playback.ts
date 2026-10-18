/**
 * Reproducción de lo que se lee en voz alta: el MP3 del servidor o, si el
 * servidor tiene la voz apagada, la voz del sistema en español. Nada se
 * guarda: el MP3 vive en un Blob en memoria y se libera al terminar.
 */

export interface Playback {
  /** Termina sola (`ended`), por un error (`failed`) o al detenerla (`stopped`). */
  readonly done: Promise<'ended' | 'failed' | 'stopped'>;
  stop(): void;
}

/** Reproduce un MP3 ya descargado. TEMPORAL: falta reproducir mientras llega (MediaSource). */
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
