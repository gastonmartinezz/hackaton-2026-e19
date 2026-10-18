/**
 * Botón «Hablar» del buscador (01, 02, 03, 10) y sus mensajes. Solo
 * presentación: el estado sale de useVoiceInput.
 */
import { Icon, LoadingDots } from '@asistente/ui';
import type { VoiceStatus } from './useVoiceInput';

/**
 * «Hablar» y su nombre accesible salen de docs/02 (v2.2). El resto es
 * TEMPORAL: las pantallas no traen textos para el dictado (la 33, «escuchando»,
 * no está diseñada). Provisorios con voseo y las reglas de voz de CLAUDE.md §6;
 * pendientes de aprobación de diseño.
 */
export const VOICE_TEXTS = {
  speak: 'Hablar',
  /** Completa el nombre accesible: «Hablar: decirlo en voz alta» (WCAG 2.5.3). */
  speakDescription: ': decirlo en voz alta',
  stop: 'Terminar',
  starting: 'Preparando el micrófono…',
  listening: 'Te escucho. Cuando termines, tocá «Terminar» o quedate unos segundos en silencio.',
  transcribing: 'Estoy pasando lo que dijiste a texto…',
  heard: (text: string) => `Entendí: «${text}». Ahora busco dónde se hace.`,
  empty: 'No te escuché bien. Probá de nuevo más cerca del micrófono, o escribilo en el buscador.',
  failed: 'No pude pasar tu voz a texto. Fue un problema mío, no tuyo. Probá de nuevo o escribilo en el buscador.',
  busy: 'Estoy recibiendo muchos pedidos. Esperá un momento y probá de nuevo, o escribilo en el buscador.',
  off: 'Hablar no está disponible por ahora. Podés escribir lo que buscás en el buscador.',
  denied: 'No tengo permiso para usar el micrófono. Podés darlo en la configuración del equipo, o escribir en el buscador.',
  missing: 'No encuentro un micrófono en este equipo. Podés escribir lo que buscás en el buscador.',
  micFailed: 'No pude usar el micrófono. Fue un problema mío, no tuyo. Podés escribir lo que buscás en el buscador.',
} as const;

const listening = (status: VoiceStatus) => status.kind === 'listening' || status.kind === 'starting';

/**
 * Píldora «Hablar» dentro del buscador, con el texto siempre visible (v2.2).
 * Escuchando dice «Terminar». Mientras transcribe no se deshabilita (el foco no
 * se pierde): queda `aria-disabled` y no hace nada.
 */
export function MicButton({ status, onToggle, blocked = false }: { status: VoiceStatus; onToggle: () => void; blocked?: boolean }) {
  const pressed = listening(status);
  // Transcribiendo o con una búsqueda en curso: no se puede empezar a escuchar.
  const working = status.kind === 'transcribing' || blocked;
  return (
    <button
      type="button"
      className="mic"
      aria-pressed={pressed}
      // Con aria-label: un texto oculto aparte suma un espacio antes de «:» en el nombre que arma Chromium.
      aria-label={pressed ? undefined : `${VOICE_TEXTS.speak}${VOICE_TEXTS.speakDescription}`}
      aria-disabled={working || undefined}
      aria-describedby="voice-msg"
      onClick={() => {
        if (!working) onToggle();
      }}
    >
      <Icon name="mic" />
      {pressed ? (
        <span className="mic-label">{VOICE_TEXTS.stop}</span>
      ) : (
        <span className="mic-label">{VOICE_TEXTS.speak}</span>
      )}
    </button>
  );
}

/** Texto de estado para la región `aria-live="polite"`; null si no hay nada que decir. */
export function voiceMessage(status: VoiceStatus): string | null {
  switch (status.kind) {
    case 'starting':
      return VOICE_TEXTS.starting;
    case 'listening':
      return VOICE_TEXTS.listening;
    case 'transcribing':
      return VOICE_TEXTS.transcribing;
    case 'heard':
      return VOICE_TEXTS.heard(status.text);
    case 'empty':
      return VOICE_TEXTS.empty;
    default:
      return null;
  }
}

/** Errores: van aparte, con role="alert". */
export function voiceError(status: VoiceStatus): string | null {
  if (status.kind === 'error') return status.reason === 'busy' ? VOICE_TEXTS.busy : status.reason === 'off' ? VOICE_TEXTS.off : VOICE_TEXTS.failed;
  if (status.kind === 'mic') return status.problem === 'denied' ? VOICE_TEXTS.denied : status.problem === 'missing' ? VOICE_TEXTS.missing : VOICE_TEXTS.micFailed;
  return null;
}

/**
 * Mensajes del dictado debajo del buscador. La región polite está siempre
 * montada (vacía en reposo) para que los lectores de pantalla anuncien los
 * cambios sin mover el foco.
 */
export function VoiceMessages({ status }: { status: VoiceStatus }) {
  const message = voiceMessage(status);
  const error = voiceError(status);
  return (
    <>
      <p id="voice-msg" className="voice-status" aria-live="polite">
        {message && status.kind === 'transcribing' ? <LoadingDots /> : null}
        {message}
      </p>
      {error ? (
        <div className="home-error" role="alert">
          <Icon name="triangle-alert" />
          <p>{error}</p>
        </div>
      ) : null}
    </>
  );
}
