/**
 * Leer en voz alta un texto de Mostrame. Nunca suena solo: siempre lo inicia
 * la persona, y se puede detener. Si el texto cambia (otra instrucción) o el
 * componente se desmonta (se cierra la tarjeta o se sale de la ayuda), se corta.
 *
 * Con la voz apagada en el servidor (`off`) se usa la voz del sistema en
 * español; si tampoco hay, el botón deja de ofrecerse.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeakResult } from '../../../shared/ipc';
import { playMp3, systemSpeak, type Playback } from './playback';

export type ReadAloudState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'playing' } | { kind: 'error'; reason: 'busy' | 'failed' };

export interface ReadAloudDeps {
  speak(text: string): Promise<SpeakResult>;
  stopSpeaking(): void;
  playMp3(audio: Uint8Array): Playback;
  systemSpeak(text: string): Promise<Playback | null>;
}

const defaultDeps: ReadAloudDeps = {
  speak: (text) => window.asistente.speak(text),
  stopSpeaking: () => window.asistente.stopSpeaking(),
  playMp3,
  systemSpeak,
};

/**
 * De dónde sale la voz en esta ejecución: el servidor, el sistema (la del
 * servidor está apagada) o ninguna (tampoco hay voz del sistema en español).
 */
export const speechSource: { mode: 'server' | 'system' | 'none' } = { mode: 'server' };

export function useReadAloud(text: string, deps: ReadAloudDeps = defaultDeps) {
  const [state, setState] = useState<ReadAloudState>({ kind: 'idle' });
  const [, setSourceVersion] = useState(0);
  const playback = useRef<Playback | null>(null);
  const attempt = useRef(0);
  /** Hay una descarga en curso en el proceso principal. */
  const pending = useRef(false);

  /** Corta la descarga y lo que esté sonando. */
  const cut = useCallback(() => {
    attempt.current++;
    playback.current?.stop();
    playback.current = null;
    if (pending.current) deps.stopSpeaking();
    pending.current = false;
  }, [deps]);

  const stop = useCallback(() => {
    cut();
    setState({ kind: 'idle' });
  }, [cut]);

  const play = useCallback((id: number, started: Playback) => {
    if (id !== attempt.current) {
      started.stop();
      return;
    }
    playback.current = started;
    setState({ kind: 'playing' });
    void started.done.then((result) => {
      if (id !== attempt.current) return;
      playback.current = null;
      setState(result === 'failed' ? { kind: 'error', reason: 'failed' } : { kind: 'idle' });
    });
  }, []);

  const readWithSystem = useCallback(
    async (id: number, value: string) => {
      const started = await deps.systemSpeak(value);
      if (id !== attempt.current) return started?.stop();
      if (!started) {
        speechSource.mode = 'none';
        setSourceVersion((v) => v + 1);
        setState({ kind: 'idle' });
        return;
      }
      play(id, started);
    },
    [deps, play],
  );

  const start = useCallback(async () => {
    const value = text.trim();
    if (!value || speechSource.mode === 'none') return;
    const id = ++attempt.current;
    setState({ kind: 'loading' });
    if (speechSource.mode === 'system') return readWithSystem(id, value);
    pending.current = true;
    const result = await deps.speak(value).catch((): SpeakResult => ({ status: 'error', reason: 'failed' }));
    if (id !== attempt.current) return;
    pending.current = false;
    if (result.status === 'ok') return play(id, deps.playMp3(result.audio));
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
  }, [text, deps, play, readWithSystem]);

  const active = state.kind === 'loading' || state.kind === 'playing';
  /** Escuchar o detener. */
  const toggle = useCallback(() => {
    if (active) stop();
    else void start();
  }, [active, start, stop]);

  // Otra instrucción, o la vista se cierra: se corta lo que estaba sonando.
  useEffect(
    () => () => {
      cut();
      setState({ kind: 'idle' });
    },
    [text, cut],
  );

  return { state, active, toggle, stop, available: speechSource.mode !== 'none' };
}
