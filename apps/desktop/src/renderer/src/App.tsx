/**
 * Ventana de Mostrame (diseño de Emi, v1.5): la barra y el inicio. Con un sitio
 * abierto, el sitio ocupa el resto y la ayuda flota encima en su propia vista
 * (card.html). Solo presenta el estado y envía comandos.
 */
import { LoadingDots } from '@asistente/ui';
import { useState } from 'react';
import { Home } from './Home';
import { Notices } from './Notices';
import { Setup } from './Setup';
import { TopBar } from './TopBar';
import { useAppState } from './useAppState';

export function App() {
  const state = useAppState();
  const [editingProfile, setEditingProfile] = useState(false);

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
      {/* Con un sitio abierto, la vista nativa ocupa el resto y los avisos van en la tarjeta. */}
      {state.nav.visible ? null : !state.profile.termsAccepted ? (
        <Setup state={state} />
      ) : editingProfile ? (
        <Setup state={state} onDone={() => setEditingProfile(false)} />
      ) : (
        <>
          <Notices state={state} />
          <Home state={state} onEditProfile={() => setEditingProfile(true)} />
        </>
      )}
    </div>
  );
}
