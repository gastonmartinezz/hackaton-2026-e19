/**
 * Ayuda dentro del sitio. Provisorio: muestra cada fase de la guía con los
 * componentes de Mostrame; la tarjeta flotante del diseño la reemplaza.
 */
import { Button, LoadingDots } from '@asistente/ui';
import type { AppState, OptionView } from '../../shared/ipc';
import { send } from './useAppState';

export function GuidePanel({ state }: { state: AppState }) {
  const { guide, prefs, nav } = state;

  if (!prefs.aiEnabledForSite) return <p>La ayuda está desactivada en este sitio. Podés usar la página normalmente.</p>;

  return (
    <section className="mm-section" aria-label="Ayuda">
      {nav.error ? (
        <div className="notice" data-tone="error" role="alert">
          <p>{nav.error}</p>
          <Button onClick={() => send({ type: 'reload' })}>Intentar de nuevo</Button>
        </div>
      ) : null}
      {guide.goal ? (
        <p className="mm-goal">
          Tu objetivo: <b>{guide.goal}</b>
        </p>
      ) : null}
      <GuideBody state={state} />
      {guide.phase !== 'idle' ? (
        <div className="mm-card-foot">
          <Button icon="rotate-ccw" onClick={() => send({ type: 'repeat' })} disabled={guide.phase !== 'waitingForUser'}>
            Repetir
          </Button>
          <Button icon="arrow-left" onClick={() => send({ type: 'stepBack' })} disabled={guide.phase === 'analyzing'}>
            Volver un paso
          </Button>
          <Button icon="log-out" onClick={() => send({ type: 'exitHelp' })}>
            Salir de la ayuda
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function GuideBody({ state }: { state: AppState }) {
  const { guide } = state;
  const waiting = (text: string) => (
    <p className="home-status" role="status">
      <LoadingDots />
      {text}
    </p>
  );
  switch (guide.phase) {
    case 'idle':
      return (
        <Button variant="primary" icon="sparkles" onClick={() => send({ type: 'analyzePage' })}>
          Mostrame cómo
        </Button>
      );
    case 'analyzing':
      return waiting('Estoy mirando la página…');
    case 'guiding':
    case 'verifying':
      return waiting('Estoy fijándome si funcionó…');
    case 'choosing':
      return <Options primary={guide.primary} />;
    case 'waitingForUser':
      return (
        <div className="mm-section">
          <p className="instr" aria-live="polite" key={guide.announceKey}>
            {guide.instruction}
          </p>
          <Button variant="primary" onClick={() => send({ type: 'confirmDone' })}>
            Ya lo hice
          </Button>
        </div>
      );
    case 'completed':
    case 'needsClarification':
    case 'unsupported':
      return <p>{guide.message}</p>;
    case 'error':
      return (
        <div className="mm-section" role="alert">
          <p>{guide.message}</p>
          <Button variant="primary" icon="refresh-cw" onClick={() => send({ type: 'retry' })}>
            Intentar de nuevo
          </Button>
        </div>
      );
    default:
      return null;
  }
}

function Options({ primary }: { primary: OptionView[] }) {
  return (
    <ul className="option-list" aria-label="Opciones de esta página">
      {primary.map((o, i) => (
        <li key={o.id}>
          <button type="button" className="option" onClick={() => send({ type: 'selectOption', optionId: o.id })}>
            <span className="num">{i + 1}</span>
            <span className="t">{o.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
