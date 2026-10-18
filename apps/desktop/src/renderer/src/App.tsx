/**
 * Ventana de Guíame (diseño v2.2): la barra y el inicio. Con un sitio abierto,
 * el sitio ocupa el resto; la ayuda (card.html) y el panel de Protección de
 * sitios (site-check.html) flotan encima en sus propias vistas. Solo presenta
 * el estado y envía comandos.
 */
import { LoadingDots } from '@asistente/ui';
import { useState } from 'react';
import { Home } from './Home';
import { Notices } from './Notices';
import { Setup } from './Setup';
import {
  NO_SITE_CHECK,
  SiteCheckAnnouncer,
  SiteCheckUnderBar,
  SiteCheckWarning,
  useDismissOnOutsidePointer,
  useIndicatorFit,
  useSiteCheckAnchor,
} from './SiteCheck';
import { TopBar } from './TopBar';
import { useAppState } from './useAppState';

export function App() {
  const state = useAppState();
  const [editingProfile, setEditingProfile] = useState(false);
  const siteCheck = state?.siteCheck ?? NO_SITE_CHECK;
  const fit = useIndicatorFit(siteCheck, state?.nav.domain ?? '', state?.prefs.textScale ?? 0);
  // El panel flotante se ancla a la píldora «Estás en»; tocar otra cosa de la barra lo cierra.
  useSiteCheckAnchor(fit.inline);
  useDismissOnOutsidePointer(siteCheck.panelOpen, '#site-check-indicator, .site-check-band');

  if (!state) {
    return (
      <p className="boot" role="status">
        <LoadingDots />
      </p>
    );
  }

  return (
    <div className="app">
      <TopBar state={state} fit={fit} />
      {/*
        Con un sitio abierto, la vista nativa ocupa el resto y los avisos van en la tarjeta.
        El panel de protección flota encima (site-check.html), sin mover el sitio. La
        advertencia de riesgo alto ocupa el lugar del sitio (que se oculta): mientras está
        abierta, el indicador que no entra en la píldora y el panel van acá, sobre ella.
      */}
      {state.nav.visible ? (
        siteCheck.warning ? (
          <>
            <SiteCheckUnderBar view={siteCheck} showIndicator={!fit.inline} />
            <SiteCheckWarning view={siteCheck} />
          </>
        ) : null
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
      <SiteCheckAnnouncer view={siteCheck} />
    </div>
  );
}
