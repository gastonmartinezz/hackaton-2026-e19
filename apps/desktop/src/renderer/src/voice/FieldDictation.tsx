/**
 * Dictar un dato del formulario (pedido del equipo, 18/10/2026). Guíame lee la
 * pregunta del dato y, al terminar, escucha la respuesta. El audio va al
 * proceso principal (`dictateField`), que lo pasa a texto y lo escribe en el
 * lugar señalado: el texto nunca vuelve a esta vista, nunca se muestra ni se
 * lee en voz alta. Después, la persona lo revisa en la página y elige «Está
 * bien», «Decirlo de nuevo» o «Lo escribo yo».
 *
 * - Escucha sola solo si `auto` (la preferencia de voz no es «nunca»); si no,
 *   la persona toca «Hablar».
 * - Si no se entendió, pregunta una vez de nuevo y después deja los botones.
 * - Los datos sensibles no llegan acá: ahí la tarjeta pone el cursor en el lugar.
 */
import { Button, Icon, LoadingDots } from '@asistente/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictateFieldResult, VoiceDiagnostic } from '../../../shared/ipc';
import { send } from '../useAppState';
import { useReadAloud, type ReadAloudDeps } from '../speech/useReadAloud';
import { VoiceCapture, type AutoStopReason } from './capture';
import { VoiceAnswer, type VoiceAnswerDeps, type VoiceChoice } from './VoiceAnswer';
import { VOICE_TEXTS } from './VoiceSearch';

/**
 * TODO(copy): textos del dictado de datos. No están en design/ (el dictado de
 * datos no tiene pantalla). Pendientes de aprobación de diseño.
 */
export const DICTATE_TEXTS = {
  listening: 'Te escucho. Decime el dato.',
  retry: 'No te entendí. ¿Me lo decís de nuevo?',
  noMatch: 'No pude usar eso para este lugar. ¿Me lo decís de otra forma?',
  failed: 'No pude escucharte. Fue un problema mío, no tuyo. Probá de nuevo o escribilo vos.',
  filled: 'Lo escribí en la página. Fijate que esté bien.',
  ok: 'Está bien, seguir',
  again: 'Decirlo de nuevo',
  myself: 'Lo escribo yo',
} as const;

export interface FieldDictationDeps {
  open(onAutoStop: (reason: AutoStopReason) => void): Promise<Pick<VoiceCapture, 'finish' | 'close'>>;
  dictate(wav: ArrayBuffer): Promise<DictateFieldResult>;
  /** Para leer los avisos (por defecto, la lectura de siempre). */
  read?: ReadAloudDeps;
}

const defaultDeps: FieldDictationDeps = {
  open: (onAutoStop) => VoiceCapture.open(onAutoStop, (data: VoiceDiagnostic) => window.asistente.voiceDiagnostic(data)),
  dictate: (wav) => window.asistente.dictateField(wav),
};

type Phase =
  | { kind: 'idle'; note?: string | undefined }
  | { kind: 'listening' }
  | { kind: 'writing' }
  /** Guíame dice algo y después vuelve a escuchar. */
  | { kind: 'prompt'; text: string; key: number };

/**
 * `trigger`: cambia cuando termina de leerse la pregunta (escuchar sola).
 * `filled`: el dato ya quedó escrito (lo dice el proceso principal).
 */
export function FieldDictation({
  filled,
  auto,
  trigger,
  stepKey,
  deps = defaultDeps,
  voiceAnswerDeps,
}: {
  filled: boolean;
  auto: boolean;
  trigger: number;
  stepKey: string;
  deps?: FieldDictationDeps;
  /** Solo para pruebas: el micrófono de la confirmación por voz. */
  voiceAnswerDeps?: VoiceAnswerDeps;
}) {
  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' });
  const phaseRef = useRef(phase);
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  /** «Decirlo de nuevo»: se vuelve a dictar aunque ya haya un dato escrito. */
  const [again, setAgain] = useState(false);
  const capture = useRef<Pick<VoiceCapture, 'finish' | 'close'> | null>(null);
  const attempt = useRef(0);
  const retried = useRef(false);
  const promptKey = useRef(0);
  /** Cuántas veces terminó de leerse «Lo escribí…»: para escuchar la confirmación. */
  const [confirmRead, setConfirmRead] = useState(0);

  const stop = useCallback(() => {
    attempt.current++;
    capture.current?.close();
    capture.current = null;
  }, []);

  const finish = useCallback(async () => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    const id = attempt.current;
    setPhase({ kind: 'writing' });
    const wav = await current.finish().catch(() => null);
    if (id !== attempt.current) return;
    if (!wav) return setPhase({ kind: 'idle' });
    const result = await deps.dictate(wav).catch((): DictateFieldResult => ({ status: 'error', reason: 'failed' }));
    if (id !== attempt.current) return;
    switch (result.status) {
      case 'filled':
        setAgain(false);
        return setPhase({ kind: 'idle' });
      case 'empty':
      case 'noMatch':
        if (retried.current) return setPhase({ kind: 'idle', note: result.status === 'noMatch' ? DICTATE_TEXTS.noMatch : DICTATE_TEXTS.retry });
        retried.current = true;
        return setPhase({ kind: 'prompt', text: result.status === 'noMatch' ? DICTATE_TEXTS.noMatch : DICTATE_TEXTS.retry, key: ++promptKey.current });
      case 'notAllowed':
        return setPhase({ kind: 'idle' });
      case 'error':
        return setPhase({ kind: 'idle', note: result.reason === 'off' ? VOICE_TEXTS.off : result.reason === 'busy' ? VOICE_TEXTS.busy : DICTATE_TEXTS.failed });
    }
  }, [deps, setPhase]);

  const listen = useCallback(async () => {
    const id = ++attempt.current;
    capture.current?.close();
    capture.current = null;
    setPhase({ kind: 'listening' });
    try {
      const opened = await deps.open((reason) => {
        if (id !== attempt.current) return;
        // No dijo nada: deja de escuchar sin error; quedan los botones.
        if (reason === 'noSpeech') {
          stop();
          return setPhase({ kind: 'idle' });
        }
        void finish();
      });
      if (id !== attempt.current) return opened.close();
      capture.current = opened;
    } catch {
      if (id === attempt.current) setPhase({ kind: 'idle', note: DICTATE_TEXTS.failed });
    }
  }, [deps, finish, stop, setPhase]);

  // Terminó de leerse la pregunta: escuchar sola (una ronda nueva).
  const listenRef = useRef(listen);
  listenRef.current = listen;
  useEffect(() => {
    if (trigger === 0 || !auto || filled) return;
    retried.current = false;
    void listenRef.current();
  }, [trigger, auto, filled]);

  // Otro paso: se corta lo que hubiera.
  useEffect(() => {
    stop();
    retried.current = false;
    setAgain(false);
    setPhase({ kind: 'idle' });
  }, [stepKey, stop, setPhase]);
  useEffect(() => () => stop(), [stop]);

  // Los avisos («No te entendí…») se dicen y después se vuelve a escuchar.
  const prompt = phase.kind === 'prompt' ? phase : null;
  const promptDone = useCallback(() => {
    if (phaseRef.current.kind === 'prompt') void listenRef.current();
  }, []);
  const reader = useReadAloud(prompt?.text ?? '', deps.read, { auto: Boolean(prompt), contentKey: `dato:${stepKey}:${prompt?.key ?? 0}`, onDone: promptDone });
  useEffect(() => {
    if (prompt && !reader.available) promptDone();
  }, [prompt, reader.available, promptDone]);

  // «Lo escribí…» se lee una vez por dato escrito; después se puede contestar hablando.
  const confirmKey = `escrito:${stepKey}:${filled && !again ? 1 : 0}`;
  useReadAloud(filled && !again ? DICTATE_TEXTS.filled : '', deps.read, {
    auto: auto && filled && !again,
    contentKey: confirmKey,
    onDone: (outcome) => outcome === 'ended' && setConfirmRead((n) => n + 1),
  });

  const sayAgain = () => {
    retried.current = false;
    setAgain(true);
    void listen();
  };

  if (filled && !again && phase.kind === 'idle') {
    const choices: VoiceChoice[] = [
      { label: DICTATE_TEXTS.ok, kind: 'yes', aliases: ['Está bien', 'Seguir'], run: () => send({ type: 'confirmDone' }) },
      { label: DICTATE_TEXTS.again, run: sayAgain },
      { label: DICTATE_TEXTS.myself, aliases: ['Lo escribo', 'Yo lo escribo'], run: () => send({ type: 'typeMyself' }) },
    ];
    return (
      <>
        <p className="soft-box">
          <Icon name="check" />
          <span>{DICTATE_TEXTS.filled}</span>
        </p>
        <Button variant="primary" block icon="check" onClick={() => send({ type: 'confirmDone' })}>
          {DICTATE_TEXTS.ok}
        </Button>
        <Button variant="secondary" block icon="mic" onClick={sayAgain}>
          {DICTATE_TEXTS.again}
        </Button>
        <Button variant="link" className="back-link" onClick={() => send({ type: 'typeMyself' })}>
          {DICTATE_TEXTS.myself}
        </Button>
        {/* Sin otra región aria-live: la de la tarjeta es la de la instrucción. */}
        <VoiceAnswer choices={choices} active={auto} trigger={confirmRead} onMessage={() => undefined} {...(voiceAnswerDeps ? { deps: voiceAnswerDeps } : {})} />
      </>
    );
  }

  const status =
    phase.kind === 'listening' ? DICTATE_TEXTS.listening : phase.kind === 'writing' ? VOICE_TEXTS.transcribing : phase.kind === 'prompt' ? phase.text : (phase.note ?? '');
  return (
    <>
      {/* La instrucción ya tiene la única región aria-live de la tarjeta: acá solo los errores se anuncian (role="alert"). */}
      {status ? (
        <p className="voice-status" role={phase.kind === 'idle' && phase.note ? 'alert' : undefined}>
          {phase.kind === 'listening' ? <Icon name="mic" size="sm" /> : null}
          {phase.kind === 'writing' ? <LoadingDots /> : null}
          {status}
        </p>
      ) : null}
      {phase.kind === 'listening' ? (
        <Button variant="primary" block icon="mic" onClick={() => void finish()}>
          {VOICE_TEXTS.stop}
        </Button>
      ) : phase.kind === 'idle' ? (
        <Button variant="primary" block icon="mic" aria-label={`${VOICE_TEXTS.speak}${VOICE_TEXTS.speakDescription}`} onClick={() => void listen()}>
          {VOICE_TEXTS.speak}
        </Button>
      ) : null}
      <Button variant="link" className="back-link" onClick={() => send({ type: 'typeMyself' })}>
        {DICTATE_TEXTS.myself}
      </Button>
    </>
  );
}
