/**
 * Estado del dictado del buscador. Tocar el micrófono empieza a escuchar;
 * tocarlo de nuevo (o 2,5 s de silencio, o 30 s) termina. El texto vuelve por
 * `onText` para que la persona lo revise: nunca se envía la búsqueda.
 *
 * - `blocked` (búsqueda en curso): no se puede empezar a escuchar y, si había
 *   una captura o una transcripción en curso, se cancela y se cierran las
 *   pistas del micrófono.
 * - Si el servidor tiene la voz apagada (`off`), el micrófono deja de
 *   ofrecerse por el resto de la ejecución de la app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscribeErrorReason, TranscribeResult } from '../../../shared/ipc';
import { MicError, VoiceCapture, type MicProblem } from './capture';

export type VoiceStatus =
  | { kind: 'idle' }
  /** Esperando el permiso o el micrófono. */
  | { kind: 'starting' }
  | { kind: 'listening' }
  | { kind: 'transcribing' }
  /** El texto ya está en el buscador. */
  | { kind: 'heard'; text: string }
  /** No se entendió nada (o fue demasiado corto). */
  | { kind: 'empty' }
  | { kind: 'error'; reason: TranscribeErrorReason }
  | { kind: 'mic'; problem: MicProblem };

export interface VoiceDeps {
  open(onAutoStop: () => void): Promise<Pick<VoiceCapture, 'finish' | 'close'>>;
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

export function useVoiceInput(onText: (text: string) => void, { blocked = false, deps = defaultDeps }: { blocked?: boolean; deps?: VoiceDeps } = {}) {
  const [status, setStatus] = useState<VoiceStatus>({ kind: 'idle' });
  const capture = useRef<Pick<VoiceCapture, 'finish' | 'close'> | null>(null);
  /** Cambia en cada intento: descarta resultados de intentos viejos o cancelados. */
  const attempt = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

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
      onTextRef.current(result.text);
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
      const opened = await deps.open(() => {
        if (id === attempt.current) void finish();
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

  /** Corta sin transcribir y vuelve al reposo (al enviar la búsqueda o al salir). */
  const cancel = useCallback(() => {
    attempt.current++;
    capture.current?.close();
    capture.current = null;
    setStatus({ kind: 'idle' });
  }, []);

  /** El botón del micrófono: empieza o termina. Mientras transcribe o con `blocked`, no hace nada. */
  const toggle = useCallback(() => {
    if (blocked || voiceAvailability.off) return;
    if (status.kind === 'listening') void finish();
    else if (status.kind === 'starting') cancel();
    else if (status.kind !== 'transcribing') void start();
  }, [blocked, status.kind, finish, start, cancel]);

  // Búsqueda en curso: se corta lo que hubiera (captura o transcripción).
  useEffect(() => {
    if (blocked) cancel();
  }, [blocked, cancel]);

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
