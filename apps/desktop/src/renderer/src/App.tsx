/**
 * UI de Mostrame (diseño de Emi, v1.5). Solo presenta el estado y envía
 * comandos: toda la lógica vive en el proceso principal.
 */
import { LoadingDots } from '@asistente/ui';
import { GuidePanel } from './GuidePanel';
import { Home } from './Home';
import { Notices } from './Notices';
import { TopBar } from './TopBar';
import { useAppState } from './useAppState';

export function App() {
  const state = useAppState();

  if (!state) {
    return (
      <p className="boot" role="status">
        <LoadingDots />
      </p>
    );
  }

  return (
    <div className="app">
      <TopBar state={state} />
      {state.nav.visible ? (
        <div className="browse">
          {/* La vista nativa del sitio ocupa el resto de la ventana. */}
          <aside className="panel" aria-label="Ayuda de Mostrame" style={{ width: state.layout.panelWidth }}>
            <Notices state={state} />
            {state.guideEnabled ? <GuidePanel state={state} /> : null}
          </aside>
        </div>
      ) : (
        <>
          <Notices state={state} />
          <Home state={state} />
        </>
      )}
    </div>
  );
}
