/**
 * «Escuchar» / «Detener»: lee en voz alta un texto de Mostrame. El nombre
 * accesible cambia con el estado (sin aria-pressed, para no decir «Detener,
 * presionado»). No mueve el foco. Los errores van con role="alert", sin culpa.
 * Design/icons no trae un ícono de parlante: por ahora solo texto.
 */
import { Button } from '@asistente/ui';
import { SPEECH_TEXTS } from './speechText';
import { useReadAloud, type ReadAloudDeps } from './useReadAloud';

/** `auto`: modo voz activo, lee solo apenas aparece. `contentKey`: «Repetir» lo vuelve a leer. */
export function SpeakButton({ text, deps, auto = false, contentKey }: { text: string; deps?: ReadAloudDeps; auto?: boolean; contentKey?: string | number }) {
  const { state, active, toggle, available } = useReadAloud(text, deps, { auto, contentKey });
  if (!available) {
    // Se explica una sola vez, en el botón que se tocó; después el botón ya no se ofrece.
    return state.kind === 'unavailable' ? (
      <p className="speak-error" role="alert">
        {SPEECH_TEXTS.noVoice}
      </p>
    ) : null;
  }
  if (!text.trim()) return null;
  const error = state.kind === 'error' ? (state.reason === 'busy' ? SPEECH_TEXTS.busy : SPEECH_TEXTS.failed) : null;
  return (
    <div className="speak">
      <Button variant="quiet" className="speak-btn" data-active={active || undefined} onClick={toggle}>
        {active ? SPEECH_TEXTS.stop : SPEECH_TEXTS.listen}
      </Button>
      {error ? (
        <p className="speak-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
