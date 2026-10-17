/**
 * Protección de sitios en la interfaz propia del navegador (nunca dentro de la
 * página): indicador junto al dominio, panel anclado a la barra, advertencia de
 * riesgo alto y anuncios accesibles. Solo presenta `AppState.siteCheck` (textos
 * ya resueltos en el proceso principal) y envía comandos.
 */
import { Button, Icon, type IconName } from '@asistente/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SiteCheckView } from '../../shared/ipc';
import type { SiteCheckAction, SiteCheckPanelCopy, SiteIndicatorKind } from '../../shared/site-check-copy';
import { send } from './useAppState';

export const SITE_CHECK_ICONS: Record<Exclude<SiteIndicatorKind, 'none'>, IconName> = {
  checking: 'clock',
  official: 'badgeCheck',
  no_alerts: 'searchCheck',
  attention: 'triangleAlert',
  possible_scam: 'octagonAlert',
  unverified: 'circleHelp',
  local: 'monitor',
};

const PANEL_ID = 'site-check-panel';
const INDICATOR_ID = 'site-check-indicator';

function runAction(action: SiteCheckAction): void {
  switch (action.id) {
    case 'close':
      send({ type: 'siteCheckPanel', open: false });
      document.getElementById(INDICATOR_ID)?.focus();
      return;
    case 'leave':
      send({ type: 'siteCheckLeave' });
      return;
    case 'retry':
      send({ type: 'siteCheckRetry' });
      return;
    case 'continue':
      send({ type: 'siteCheckContinue' });
      return;
  }
}

/** Botón con ícono y texto junto al dominio. Abre y cierra el panel. */
export function SiteCheckIndicator({ view }: { view: SiteCheckView }) {
  if (view.indicator === 'none' || !view.label) return null;
  return (
    <button
      type="button"
      id={INDICATOR_ID}
      className="site-check-indicator"
      data-state={view.indicator}
      data-tone={view.tone}
      aria-expanded={view.panelOpen}
      aria-controls={PANEL_ID}
      aria-label={`Revisión del sitio: ${view.label}. Ver detalles`}
      onClick={() => send({ type: 'siteCheckPanel', open: !view.panelOpen })}
    >
      <Icon name={SITE_CHECK_ICONS[view.indicator]} />
      <span>{view.label}</span>
      <Icon name="chevronDown" size="1em" className="site-check-chevron" />
    </button>
  );
}

/** Motivos, cobertura y comentario de la IA: cerrados al abrir («Ver por qué»). */
function Details({ panel }: { panel: SiteCheckPanelCopy }) {
  if (panel.reasons.length === 0 && !panel.coverageNote && !panel.explanation) return null;
  return (
    <details className="site-check-details">
      <summary>Ver por qué</summary>
      {panel.reasons.length > 0 ? (
        <ul>
          {panel.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {panel.coverageNote ? <p>{panel.coverageNote}</p> : null}
      {panel.explanation ? (
        <p className="site-check-ai">
          <span className="site-check-ai-label">Comentario de la revisión automática:</span> {panel.explanation}
        </p>
      ) : null}
    </details>
  );
}

/**
 * Panel breve anclado a la barra. Ocupa una franja debajo de la barra y el
 * proceso principal baja la vista del sitio según su alto, así la página no lo tapa.
 */
export function SiteCheckPanel({ view }: { view: SiteCheckView }) {
  const ref = useRef<HTMLElement>(null);
  const lastHeight = useRef(-1);
  const open = view.panelOpen && view.panel !== null && view.indicator !== 'none';

  useLayoutEffect(() => {
    const element = ref.current;
    const report = (height: number) => {
      if (height === lastHeight.current) return;
      lastHeight.current = height;
      send({ type: 'siteCheckOverlay', height });
    };
    if (!open || !element) {
      report(0);
      return;
    }
    report(Math.ceil(element.getBoundingClientRect().height));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => report(Math.ceil(element.getBoundingClientRect().height)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [open, view.indicator]);

  if (!open || !view.panel || view.indicator === 'none') return null;
  const { panel } = view;
  return (
    <section
      ref={ref}
      id={PANEL_ID}
      className="site-check-panel"
      data-tone={view.tone}
      role="dialog"
      aria-modal="false"
      aria-labelledby="site-check-panel-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') runAction({ id: 'close', label: '' });
      }}
    >
      <div className="site-check-panel-body">
        <h2 id="site-check-panel-title" tabIndex={-1}>
          <Icon name={SITE_CHECK_ICONS[view.indicator]} /> {panel.title}
        </h2>
        {panel.body.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        <div className="row">
          <Button variant="primary" onClick={() => runAction(panel.primary)}>
            {panel.primary.label}
          </Button>
          {panel.secondary ? <Button onClick={() => runAction(panel.secondary!)}>{panel.secondary.label}</Button> : null}
        </div>
        <Details panel={panel} />
      </div>
      <button type="button" className="site-check-close" aria-label="Cerrar" onClick={() => runAction({ id: 'close', label: '' })}>
        <Icon name="x" />
      </button>
    </section>
  );
}

/** Advertencia destacada de riesgo alto. Ocupa el área del sitio (la vista se oculta mientras tanto). */
export function SiteCheckWarning({ view }: { view: SiteCheckView }) {
  const primary = useRef<HTMLButtonElement>(null);
  const warning = view.warning;
  useEffect(() => {
    if (warning) primary.current?.focus();
  }, [warning !== null]);
  if (!warning) return null;
  return (
    <section className="site-check-warning" role="alertdialog" aria-labelledby="site-check-warning-title" aria-describedby="site-check-warning-body">
      <div className="site-check-warning-card">
        <h2 id="site-check-warning-title">
          <Icon name="octagonAlert" size="1.5em" /> {warning.title}
        </h2>
        <div id="site-check-warning-body">
          {warning.body.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
        <div className="row">
          <Button ref={primary} variant="primary" onClick={() => runAction(warning.primary)}>
            {warning.primary.label}
          </Button>
        </div>
        <Details panel={warning} />
        <p className="site-check-continue-hint">Si ya leíste la advertencia y querés seguir igual:</p>
        <Button onClick={() => runAction(warning.continueAction)}>{warning.continueAction.label}</Button>
      </div>
    </section>
  );
}

/** Anuncio para lectores de pantalla: solo cuando el estado cambia de forma relevante. */
export function SiteCheckAnnouncer({ view }: { view: SiteCheckView }) {
  const [text, setText] = useState('');
  const last = useRef<number | null>(null);
  const id = view.announcement?.id ?? null;
  useEffect(() => {
    if (id === null || id === last.current) return;
    last.current = id;
    // La advertencia de riesgo alto se anuncia sola (alertdialog): no se repite acá.
    setText(view.warning ? '' : (view.announcement?.text ?? ''));
  }, [id]);
  return (
    <div className="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
