/**
 * Responder con la voz qué opción se quiere (modo voz). Después de que
 * Mostrame termina de leer una lista de opciones, abre el micrófono, pasa lo
 * dicho a texto (/v1/transcribe) y lo compara en el cliente con las opciones
 * visibles (matchChoice). Al reconocerla, anuncia «Elegiste «…».» y ejecuta
 * exactamente lo mismo que tocar ese botón de Mostrame (nunca del sitio).
 *
 * - Solo con el modo voz activo y solo cuando termina la lectura (`trigger`):
 *   nunca se abre el micrófono sin modo voz.
 * - Mismo corte por silencio de 5 s. Si no dice nada, deja de escuchar sin
 *   error y las opciones quedan en pantalla.
 * - Si no hay coincidencia clara o hay empate, pregunta una vez «No te
 *   entendí. ¿Cuál querés?» y vuelve a escuchar; si vuelve a fallar, deja de
 *   escuchar y quedan los botones.
 * - Ni el audio ni lo transcripto se guardan ni se registran.
 */
import { Button, Icon, LoadingDots } from '@asistente/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscribeResult, VoiceDiagnostic } from '../../../shared/ipc';
import { useReadAloud, type ReadAloudDeps } from '../speech/useReadAloud';
import { VoiceCapture, type AutoStopReason } from './capture';
import { matchChoice, type ChoiceSpec } from './matchChoice';
import { VOICE_TEXTS } from './VoiceSearch';

/** Una opción que se puede elegir hablando: lo mismo que su botón. */
export interface VoiceChoice extends ChoiceSpec {
  run: () => void;
}

/**
 * TEMPORAL — textos de la respuesta por voz (no están en
 * design/textos.es.json). Pendientes de aprobación de diseño.
 */
export const ANSWER_TEXTS = {
  listening: 'Te escucho. Decí cuál querés.',
  retry: 'No te entendí. ¿Cuál querés?',
  chosen: (label: string) => `Elegiste «${label}».`,
} as const;

export interface VoiceAnswerDeps {
  open(onAutoStop: (reason: AutoStopReason) => void): Promise<Pick<VoiceCapture, 'finish' | 'close'>>;
  transcribe(wav: ArrayBuffer): Promise<TranscribeResult>;
  /** Para leer «Elegiste…» y «No te entendí…» (por defecto, la lectura de siempre). */
  read?: ReadAloudDeps;
}

const defaultDeps: VoiceAnswerDeps = {
  open: (onAutoStop) => VoiceCapture.open(onAutoStop, (data: VoiceDiagnostic) => window.asistente.voiceDiagnostic(data)),
  transcribe: (wav) => window.asistente.transcribe(wav),
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'transcribing' }
  /** Mostrame dice algo y después sigue: vuelve a escuchar o ejecuta la opción. */
  | { kind: 'prompt'; text: string; key: number; then: { listen: true } | { run: number } };

export function useVoiceAnswer(choices: VoiceChoice[], { active, trigger, deps = defaultDeps }: { active: boolean; trigger: number; deps?: VoiceAnswerDeps }) {
  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' });
  const phaseRef = useRef<Phase>(phase);
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const capture = useRef<Pick<VoiceCapture, 'finish' | 'close'> | null>(null);
  const attempt = useRef(0);
  /** Ya se preguntó «No te entendí» en esta ronda. */
  const retried = useRef(false);
  const promptKey = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  const stop = useCallback(() => {
    attempt.current++;
    capture.current?.close();
    capture.current = null;
    setPhase({ kind: 'idle' });
  }, [setPhase]);

  const say = useCallback(
    (text: string, then: { listen: true } | { run: number }) => setPhase({ kind: 'prompt', text, key: ++promptKey.current, then }),
    [setPhase],
  );

  const finish = useCallback(async () => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    const id = attempt.current;
    setPhase({ kind: 'transcribing' });
    const wav = await current.finish().catch(() => null);
    if (id !== attempt.current) return;
    // Muy corto o sin audio: como si no hubiera dicho nada.
    if (!wav) return setPhase({ kind: 'idle' });
    const result = await deps.transcribe(wav).catch((): TranscribeResult => ({ status: 'error', reason: 'failed' }));
    if (id !== attempt.current) return;
    if (result.status === 'error') return setPhase({ kind: 'idle' });
    const match = matchChoice(result.status === 'ok' ? result.text : '', choicesRef.current);
    if (match.kind === 'match') return say(ANSWER_TEXTS.chosen(choicesRef.current[match.index]!.label), { run: match.index });
    if (!retried.current) {
      retried.current = true;
      return say(ANSWER_TEXTS.retry, { listen: true });
    }
    setPhase({ kind: 'idle' });
  }, [deps, say, setPhase]);

  const listen = useCallback(async () => {
    // Nunca se abre el micrófono sin modo voz.
    if (!activeRef.current || choicesRef.current.length === 0) return;
    const id = ++attempt.current;
    setPhase({ kind: 'listening' });
    try {
      const opened = await deps.open((reason) => {
        if (id !== attempt.current) return;
        // No dijo nada: deja de escuchar sin error; las opciones quedan.
        if (reason === 'noSpeech') return stop();
        void finish();
      });
      if (id !== attempt.current || !activeRef.current) return opened.close();
      capture.current = opened;
    } catch {
      if (id === attempt.current) setPhase({ kind: 'idle' });
    }
  }, [deps, finish, stop, setPhase]);

  // Terminó la lectura de las opciones: escuchar la respuesta (una ronda nueva). Solo cuando cambia `trigger`.
  const listenRef = useRef(listen);
  listenRef.current = listen;
  useEffect(() => {
    if (trigger === 0 || !activeRef.current) return;
    retried.current = false;
    void listenRef.current();
  }, [trigger]);

  // Apagar el modo voz o salir de la vista corta el micrófono.
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(
    () => () => {
      attempt.current++;
      capture.current?.close();
      capture.current = null;
    },
    [],
  );

  /** Terminó de decir el aviso: vuelve a escuchar o hace lo mismo que el botón. */
  const promptDone = useCallback(() => {
    const current = phaseRef.current;
    if (current.kind !== 'prompt') return;
    if ('run' in current.then) {
      const choice = choicesRef.current[current.then.run];
      setPhase({ kind: 'idle' });
      choice?.run();
      return;
    }
    void listen();
  }, [listen, setPhase]);

  return { phase, stop, finish, promptDone };
}

/** Estado de la escucha y el botón «Terminar». Se monta en cada lista de opciones. */
export function VoiceAnswer({ choices, active, trigger, deps }: { choices: VoiceChoice[]; active: boolean; trigger: number; deps?: VoiceAnswerDeps }) {
  const { phase, finish, promptDone } = useVoiceAnswer(choices, { active, trigger, deps });
  const prompt = phase.kind === 'prompt' ? phase : null;
  // Los avisos se dicen en voz alta (modo voz) y, al terminar, se sigue.
  const reader = useReadAloud(prompt?.text ?? '', deps?.read, { auto: Boolean(prompt), contentKey: `respuesta:${prompt?.key ?? 0}`, onDone: promptDone });
  // Sin forma de leer en este equipo: se sigue sin esperar la voz.
  useEffect(() => {
    if (prompt && !reader.available) promptDone();
  }, [prompt, reader.available, promptDone]);
  if (!active) return null;
  const message =
    phase.kind === 'listening' ? ANSWER_TEXTS.listening : phase.kind === 'transcribing' ? VOICE_TEXTS.transcribing : prompt ? prompt.text : '';
  return (
    <div className="voice-answer">
      <p className="voice-status" aria-live="polite">
        {phase.kind === 'listening' ? <Icon name="mic" size="sm" /> : null}
        {phase.kind === 'transcribing' ? <LoadingDots /> : null}
        {message}
      </p>
      {phase.kind === 'listening' ? (
        <Button variant="secondary" icon="mic" className="voice-answer-stop" onClick={() => void finish()}>
          {VOICE_TEXTS.stop}
        </Button>
      ) : null}
    </div>
  );
}
