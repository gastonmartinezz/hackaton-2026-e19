/**
 * Estado del dictado del buscador. Tocar el micrófono empieza a escuchar;
 * tocarlo de nuevo («Terminar»), 5 s seguidos de silencio o 30 s terminan.
 * Si la persona no habló nada en los primeros 5 s, corta con «no te escuché»
 * sin mandar audio. El texto vuelve por `onText` (queda visible en el
 * buscador) y, si hay texto, se envía solo por `onSubmit` (decisión de
 * producto: el dictado busca sin otro toque). Con texto vacío no se envía.
 *
 * - `blocked` (búsqueda en curso): no se puede empezar a escuchar y, si había
 *   una captura o una transcripción en curso, se cancela y se cierran las
 *   pistas del micrófono.
 * - Si el servidor tiene la voz apagada (`off`), el micrófono deja de
 *   ofrecerse por el resto de la ejecución de la app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscribeErrorReason, TranscribeResult } from '../../../shared/ipc';
import { MicError, VoiceCapture, type AutoStopReason, type MicProblem } from './capture';

export type VoiceStatus =
  | { kind: 'idle' }
  /** Esperando el permiso o el micrófono. */
  | { kind: 'starting' }
  | { kind: 'listening' }
  | { kind: 'transcribing' }
  /** El texto ya está en el buscador y se mandó a buscar (solo si de verdad se envió). */
  | { kind: 'heard'; text: string }
  /** No se entendió nada (o fue demasiado corto). */
  | { kind: 'empty' }
  | { kind: 'error'; reason: TranscribeErrorReason }
  | { kind: 'mic'; problem: MicProblem };

export interface VoiceDeps {
  open(onAutoStop: (reason: AutoStopReason) => void): Promise<Pick<VoiceCapture, 'finish' | 'close'>>;
  transcribe(wav: ArrayBuffer): Promise<TranscribeResult>;
}

/**
 * La voz está apagada en el servidor. Vive en el módulo (no en el componente)
 * para que dure toda la ejecución aunque el inicio se desmonte al abrir un sitio.
 */
export const voiceAvailability = { off: false };

const defaultDeps: VoiceDeps = {
  open: (onAutoStop) => VoiceCapture.open(onAutoStop),
  transcribe: (wav) => window.asistente.transcribe(wav),
};

export interface VoiceInputOptions {
  /** Búsqueda en curso: no se escucha y se corta lo que hubiera. */
  blocked?: boolean;
  /** Envío automático del texto dictado (no se llama con texto vacío ni con `blocked`). */
  onSubmit?: (text: string) => void;
  deps?: VoiceDeps;
}

export function useVoiceInput(onText: (text: string) => void, { blocked = false, onSubmit, deps = defaultDeps }: VoiceInputOptions = {}) {
  const [status, setStatus] = useState<VoiceStatus>({ kind: 'idle' });
  const capture = useRef<Pick<VoiceCapture, 'finish' | 'close'> | null>(null);
  /** Cambia en cada intento: descarta resultados de intentos viejos o cancelados. */
  const attempt = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const finish = useCallback(async () => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    const id = attempt.current;
    setStatus({ kind: 'transcribing' });
    let wav: ArrayBuffer | null;
    try {
      wav = await current.finish();
    } catch {
      current.close();
      if (id === attempt.current) setStatus({ kind: 'error', reason: 'failed' });
      return;
    }
    if (id !== attempt.current) return;
    if (!wav) {
      setStatus({ kind: 'empty' });
      return;
    }
    const result = await deps.transcribe(wav).catch((): TranscribeResult => ({ status: 'error', reason: 'failed' }));
    if (id !== attempt.current) return;
    if (result.status === 'ok') {
      // Solo espacios: es como no haber entendido nada.
      if (!result.text.trim()) return setStatus({ kind: 'empty' });
      // Empezó otra búsqueda mientras transcribía: el dictado se descarta, como al cancelarlo.
      if (blockedRef.current) return cancel();
      onTextRef.current(result.text);
      const submit = onSubmitRef.current;
      if (!submit) return setStatus({ kind: 'idle' });
      // Se busca solo, por el mismo camino que «Guíame». «Entendí…» sale solo si se envió.
      submit(result.text);
      setStatus({ kind: 'heard', text: result.text });
    } else if (result.status === 'empty') setStatus({ kind: 'empty' });
    else {
      if (result.reason === 'off') voiceAvailability.off = true;
      setStatus({ kind: 'error', reason: result.reason });
    }
  }, [deps]);

  const start = useCallback(async () => {
    const id = ++attempt.current;
    setStatus({ kind: 'starting' });
    try {
      const opened = await deps.open((reason) => {
        if (id !== attempt.current) return;
        if (reason === 'noSpeech') return quiet();
        void finish();
      });
      if (id !== attempt.current) {
        opened.close();
        return;
      }
      capture.current = opened;
      setStatus({ kind: 'listening' });
    } catch (error) {
      if (id === attempt.current) setStatus({ kind: 'mic', problem: error instanceof MicError ? error.problem : 'failed' });
    }
  }, [deps, finish]);

  /** No habló nada en los primeros 5 s: «no te escuché», sin mandar audio. */
  const quiet = useCallback(() => {
    attempt.current++;
    capture.current?.close();
    capture.current = null;
    setStatus({ kind: 'empty' });
  }, []);

  /** Corta sin transcribir y vuelve al reposo (al salir del buscador). */
  const cancel = useCallback(() => {
    attempt.current++;
    capture.current?.close();
    capture.current = null;
    setStatus({ kind: 'idle' });
  }, []);

  const statusRef = useRef(status);
  statusRef.current = status;
  /**
   * Corta solo si está escuchando o transcribiendo (al empezar una búsqueda).
   * El aviso «Entendí…» de la búsqueda dictada queda para que se lea.
   */
  const cancelActive = useCallback(() => {
    if (['starting', 'listening', 'transcribing'].includes(statusRef.current.kind)) cancel();
  }, [cancel]);

  /** El botón del micrófono: empieza o termina. Mientras transcribe o con `blocked`, no hace nada. */
  const toggle = useCallback(() => {
    if (blocked || voiceAvailability.off) return;
    if (status.kind === 'listening') void finish();
    else if (status.kind === 'starting') cancel();
    else if (status.kind !== 'transcribing') void start();
  }, [blocked, status.kind, finish, start, cancel]);

  // Búsqueda en curso: se corta lo que hubiera (captura o transcripción).
  useEffect(() => {
    if (blocked) cancelActive();
  }, [blocked, cancelActive]);

  // Al desmontar se cierran las pistas del micrófono.
  useEffect(
    () => () => {
      attempt.current++;
      capture.current?.close();
      capture.current = null;
    },
    [],
  );

  return { status, toggle, cancel, available: !voiceAvailability.off };
}
