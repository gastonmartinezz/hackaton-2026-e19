/**
 * Leer en voz alta un texto de Guíame. Nunca suena solo: siempre lo inicia
 * la persona, y se puede detener. Si el texto cambia (otra instrucción) o el
 * componente se desmonta (se cierra la tarjeta o se sale de la ayuda), se corta.
 *
 * Una sola lectura en toda la app: al empezar una lectura se cortan las demás
 * de esta vista (bus local) y el proceso principal avisa a la otra vista
 * (ventana o tarjeta) con `onCut`, que vuelve a «Escuchar». Vale también para
 * la voz del sistema.
 *
 * Con la voz apagada en el servidor (`off`) se usa la voz del sistema en
 * español; si tampoco hay, el botón deja de ofrecerse (después de avisarlo).
 *
 * Modo voz (`auto`): lee solo cada contenido nuevo apenas aparece, una sola
 * vez (no en cada render); un contenido nuevo corta el anterior y apagar el
 * modo corta lo que suena. Con el modo apagado, solo «Escuchar» manual.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeakResult, SpeechAudioEvent } from '../../../shared/ipc';
import { openMp3Stream, systemSpeak, VOICES_TIMEOUT_MS, warmUpVoices, type Mp3Stream, type Playback, type SystemSpeechProblem } from './playback';

export type ReadAloudState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'playing' }
  | { kind: 'error'; reason: 'busy' | 'failed' }
  /** No hay ninguna forma de leer en este equipo: se explica una vez y el botón se oculta. */
  | { kind: 'unavailable' };

export interface ReadAloudDeps {
  /** Pide la lectura; los pedazos del MP3 llegan a `onAudio` mientras el servidor los manda. */
  speak(text: string, onAudio: (event: SpeechAudioEvent) => void): Promise<SpeakResult>;
  /** «Detener» o «voy a leer con la voz del sistema»: el proceso principal corta su descarga y avisa a la otra vista. */
  stopSpeaking(): void;
  /** Aviso del proceso principal: otra vista empezó a leer o se detuvo todo. */
  onCut(listener: () => void): () => void;
  /** Reproducción que empieza con los primeros datos. */
  openMp3Stream(): Mp3Stream;
  /** `stillWanted`: false si la lectura dejó de hacer falta mientras esperaba las voces (no suena). */
  systemSpeak(text: string, stillWanted: () => boolean): Promise<Playback | SystemSpeechProblem>;
  /** Pide las voces del sistema temprano, para no esperarlas al tocar «Escuchar». */
  warmUpVoices(): void;
}

const defaultDeps: ReadAloudDeps = {
  speak: (text, onAudio) => window.asistente.speak(text, onAudio),
  stopSpeaking: () => window.asistente.stopSpeaking(),
  onCut: (listener) => window.asistente.onSpeechCut(listener),
  openMp3Stream,
  systemSpeak: (text, stillWanted) => systemSpeak(text, VOICES_TIMEOUT_MS, (data) => window.asistente.speechDiagnostic(data), stillWanted),
  warmUpVoices,
};

/**
 * De dónde sale la voz en esta ejecución: el servidor, el sistema (la del
 * servidor está apagada) o ninguna (tampoco hay voz del sistema en español).
 */
export const speechSource: { mode: 'server' | 'system' | 'none' } = { mode: 'server' };

/** Último contenido leído solo en esta vista: cada contenido se lee una vez. */
export const autoRead = { last: '' };

/** Lecturas de esta vista: al empezar una, se callan las otras. */
const localReaders = new Set<() => void>();

export interface ReadAloudOptions {
  /** Modo voz activo: leer solo apenas aparece. */
  auto?: boolean;
  /** Distingue el mismo texto mostrado de nuevo (por ejemplo «Repetir»). */
  contentKey?: string | number;
}

export function useReadAloud(text: string, deps: ReadAloudDeps = defaultDeps, { auto = false, contentKey = '' }: ReadAloudOptions = {}) {
  const [state, setState] = useState<ReadAloudState>({ kind: 'idle' });
  const [, setSourceVersion] = useState(0);
  const playback = useRef<Playback | null>(null);
  const attempt = useRef(0);
  /**
   * Lectura automática en curso: qué contenido y con qué intento. El contenido
   * se marca como leído recién cuando empieza a sonar (`play`); si falla o se
   * corta antes (sin voces, ocupado, la vista se cierra mientras espera), no.
   */
  const autoAttempt = useRef<{ key: string; id: number } | null>(null);
  /** Hay una descarga en curso en el proceso principal (hasta el último pedazo). */
  const pending = useRef(false);
  /** Esperando las voces del sistema (hasta 5 s): todavía no suena, pero ya hay una lectura en curso. */
  const waiting = useRef(false);

  /** Corta lo que esté sonando, descargando o esperando voces en esta lectura, sin avisar a nadie. */
  const silence = useCallback(() => {
    attempt.current++;
    playback.current?.stop();
    playback.current = null;
    pending.current = false;
    waiting.current = false;
  }, []);

  /** La cortó otra lectura (de esta vista o de la otra): vuelve a «Escuchar». */
  const cutFromOutside = useCallback(() => {
    if (!playback.current && !pending.current && !waiting.current) return;
    silence();
    setState({ kind: 'idle' });
  }, [silence]);

  /** «Detener»: corta acá y el proceso principal corta la descarga y avisa a la otra vista. */
  const stop = useCallback(() => {
    silence();
    deps.stopSpeaking();
    setState({ kind: 'idle' });
  }, [silence, deps]);

  const play = useCallback((id: number, started: Playback) => {
    if (id !== attempt.current) {
      started.stop();
      return;
    }
    playback.current = started;
    // Empezó a sonar de verdad: recién ahora ese contenido cuenta como leído.
    const key = autoAttempt.current?.id === id ? autoAttempt.current.key : null;
    if (key !== null) autoRead.last = key;
    setState({ kind: 'playing' });
    void started.done.then((result) => {
      // Si falló mientras sonaba (la descarga o el audio), se puede volver a leer cuando reaparezca.
      if (result === 'failed' && key !== null && autoRead.last === key) autoRead.last = '';
      if (id !== attempt.current) return;
      playback.current = null;
      // Terminó de sonar: no queda nada por descargar ni por cortar.
      pending.current = false;
      setState(result === 'failed' ? { kind: 'error', reason: 'failed' } : { kind: 'idle' });
    });
  }, []);

  const readWithSystem = useCallback(
    async (id: number, value: string) => {
      // La voz del sistema no pasa por el proceso principal: se le avisa para que corte la otra vista.
      deps.stopSpeaking();
      // Mientras espera las voces se puede cortar (otra lectura, «Detener», apagar el modo voz).
      waiting.current = true;
      const started = await deps.systemSpeak(value, () => id === attempt.current);
      if (typeof started === 'object' && id !== attempt.current) return started.stop();
      if (id !== attempt.current) return;
      waiting.current = false;
      if (started === 'noSpanishVoice') {
        // Hay voces pero ninguna en español: no va a haber forma de leer en esta ejecución.
        speechSource.mode = 'none';
        setSourceVersion((v) => v + 1);
        return setState({ kind: 'unavailable' });
      }
      // Las voces no llegaron a tiempo: puede ser momentáneo, el botón queda.
      if (started === 'noVoices') return setState({ kind: 'error', reason: 'failed' });
      play(id, started);
    },
    [deps, play],
  );

  const start = useCallback(async () => {
    const value = text.trim();
    if (!value || speechSource.mode === 'none') return;
    for (const other of localReaders) if (other !== cutFromOutside) other();
    // También la lectura propia en curso (por ejemplo «Repetir» con el mismo texto): nunca dos voces.
    if (playback.current || pending.current || waiting.current) silence();
    const id = ++attempt.current;
    setState({ kind: 'loading' });
    if (speechSource.mode === 'system') return readWithSystem(id, value);
    // El audio suena mientras llega: la reproducción se abre antes de pedirlo.
    const stream = deps.openMp3Stream();
    pending.current = true;
    const onAudio = (event: SpeechAudioEvent) => {
      if (id !== attempt.current) return;
      if (event.type === 'chunk') return stream.push(event.chunk);
      pending.current = false;
      if (event.type === 'end') stream.end();
      // `stopped` lo cortó esta vista o la otra: ya se manejó acá o llega el aviso.
      else if (event.reason === 'failed') stream.fail();
    };
    const result = await deps.speak(value, onAudio).catch((): SpeakResult => ({ status: 'error', reason: 'failed' }));
    if (id !== attempt.current) return stream.playback.stop();
    if (result.status === 'ok') return play(id, stream.playback);
    pending.current = false;
    stream.playback.stop();
    switch (result.reason) {
      case 'off':
        // Voz apagada en el servidor: la persona pidió escuchar, se lee con la del sistema.
        speechSource.mode = 'system';
        return readWithSystem(id, value);
      case 'stopped':
        return setState({ kind: 'idle' });
      default:
        return setState({ kind: 'error', reason: result.reason });
    }
  }, [text, deps, play, readWithSystem, cutFromOutside]);

  const active = state.kind === 'loading' || state.kind === 'playing';
  /** Escuchar o detener. */
  const toggle = useCallback(() => {
    if (active) stop();
    else void start();
  }, [active, start, stop]);

  // Modo voz: cada contenido nuevo se lee una vez, apenas aparece.
  useEffect(() => {
    if (!auto || !text.trim() || speechSource.mode === 'none') return;
    const key = `${contentKey}|${text}`;
    // Ya sonó, o ya se está intentando leer en esta vista.
    if (autoRead.last === key) return;
    if (autoAttempt.current?.key === key && autoAttempt.current.id === attempt.current) return;
    void start();
    autoAttempt.current = { key, id: attempt.current };
  }, [auto, text, contentKey, start]);

  // Apagar el modo voz corta lo que esté sonando.
  const wasAuto = useRef(auto);
  useEffect(() => {
    if (wasAuto.current && !auto) {
      autoRead.last = '';
      cutFromOutside();
    }
    wasAuto.current = auto;
  }, [auto, cutFromOutside]);

  // Las voces del sistema tardan en cargar: se piden al mostrar el botón.
  useEffect(() => deps.warmUpVoices(), [deps]);

  // Una sola lectura: avisos de la otra vista y de otras lecturas de esta.
  useEffect(() => {
    localReaders.add(cutFromOutside);
    const unsubscribe = deps.onCut(cutFromOutside);
    return () => {
      localReaders.delete(cutFromOutside);
      unsubscribe();
    };
  }, [deps, cutFromOutside]);

  // Otra instrucción, o la vista se cierra: se corta lo que estaba sonando.
  useEffect(
    () => () => {
      if (pending.current) deps.stopSpeaking();
      silence();
      setState({ kind: 'idle' });
    },
    [text, deps, silence],
  );

  return { state, active, toggle, stop, available: speechSource.mode !== 'none' };
}
