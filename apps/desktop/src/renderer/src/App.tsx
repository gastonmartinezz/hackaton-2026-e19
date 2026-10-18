/**
 * Ventana de Mostrame (diseño de Emi, v1.5): la barra y el inicio. Con un sitio
 * abierto, el sitio ocupa el resto y la ayuda flota encima en su propia vista
 * (card.html). Solo presenta el estado y envía comandos.
 */
import { LoadingDots } from '@asistente/ui';
import { useState } from 'react';
import type { SiteCheckView } from '../../shared/ipc';
import { Home } from './Home';
import { Notices } from './Notices';
import { Setup } from './Setup';
import { SiteCheckAnnouncer, SiteCheckUnderBar, SiteCheckWarning, useIndicatorFits } from './SiteCheck';
import { TopBar } from './TopBar';
import { useAppState } from './useAppState';

const NO_SITE_CHECK: SiteCheckView = {
  indicator: 'none',
  label: null,
  tone: 'neutral',
  panel: null,
  panelOpen: false,
  warning: null,
  announcement: null,
  guidePaused: false,
};

export function App() {
  const state = useAppState();
  const [editingProfile, setEditingProfile] = useState(false);
  const indicatorFits = useIndicatorFits(state?.siteCheck ?? NO_SITE_CHECK, state?.nav.domain ?? '', state?.prefs.textScale ?? 0);

  if (!state) {
    return (
      <p className="boot" role="status">
        <LoadingDots />
      </p>
    );
  }

  return (
    <div className="app">
      <TopBar state={state} indicatorInline={indicatorFits} />
      {/*
        Con un sitio abierto, la vista nativa ocupa el resto y los avisos van en la tarjeta.
        El panel de protección queda anclado debajo de la barra (el sitio baja) y la
        advertencia de riesgo alto ocupa el lugar del sitio (que se oculta).
      */}
      {state.nav.visible ? (
        <>
          <SiteCheckUnderBar view={state.siteCheck} showIndicator={!indicatorFits} />
          <SiteCheckWarning view={state.siteCheck} />
        </>
      ) : !state.profile.termsAccepted ? (
        <Setup state={state} />
      ) : editingProfile ? (
        <Setup state={state} onDone={() => setEditingProfile(false)} />
      ) : (
        <>
          <Notices state={state} />
          <Home state={state} onEditProfile={() => setEditingProfile(true)} />
        </>
      )}
      <SiteCheckAnnouncer view={state.siteCheck} />
    </div>
  );
}
