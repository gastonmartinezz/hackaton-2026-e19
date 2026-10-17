/**
 * Protección de sitios en la interfaz propia del navegador (nunca dentro de la
 * página): indicador en la barra «Estás en», junto al dominio; panel anclado a
 * la barra; advertencia de riesgo alto y anuncios accesibles. Solo presenta
 * `AppState.siteCheck` (textos ya resueltos en el proceso principal) y envía
 * comandos. Estilos con los tokens de design/tokens.css (site-check.css).
 */
import { Button, Icon, type IconName } from '@asistente/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SiteCheckView } from '../../shared/ipc';
import type { SiteCheckAction, SiteCheckPanelCopy, SiteIndicatorKind } from '../../shared/site-check-copy';
import { send } from './useAppState';

/** Íconos Lucide de design/icons. El texto acompaña siempre. */
export const SITE_CHECK_ICONS: Record<Exclude<SiteIndicatorKind, 'none'>, IconName> = {
  checking: 'clock',
  official: 'shield-check',
  no_alerts: 'search',
  attention: 'triangle-alert',
  possible_scam: 'shield-alert',
  unverified: 'circle-help',
  local: 'circle-slash',
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

const CLOSE: SiteCheckAction = { id: 'close', label: 'Cerrar' };

/** Botón con ícono y texto, dentro de la píldora «Estás en», al lado del dominio. Abre y cierra el panel. */
export function SiteCheckIndicator({ view }: { view: SiteCheckView }) {
  if (view.indicator === 'none' || !view.label) return null;
  return (
    <button
      type="button"
      id={INDICATOR_ID}
      className="site-badge"
      data-state={view.indicator}
      data-tone={view.tone}
      aria-expanded={view.panelOpen}
      aria-controls={PANEL_ID}
      aria-label={`Revisión del sitio: ${view.label}. Ver detalles`}
      onClick={() => send({ type: 'siteCheckPanel', open: !view.panelOpen })}
    >
      <Icon name={SITE_CHECK_ICONS[view.indicator]} size="sm" />
      <span className="site-badge-label">{view.label}</span>
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
          <b>Comentario de la revisión automática:</b> {panel.explanation}
        </p>
      ) : null}
    </details>
  );
}

/**
 * ¿Entra el indicador en la píldora «Estás en» sin cortar el dominio principal?
 * Mide el dominio (que nunca se corta), el resto de la píldora y un indicador
 * de prueba invisible; el ancho de la píldora no depende de su contenido, así
 * que la decisión no oscila.
 */
export function useIndicatorFits(view: SiteCheckView, domain: string, scale: number): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const check = () => {
      const omni = document.querySelector<HTMLElement>('.omni');
      const main = omni?.querySelector('.dom b');
      const probe = document.querySelector('.site-badge-probe');
      if (!omni || !main || !probe) return;
      const style = getComputedStyle(omni);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      const where = omni.querySelector('.where');
      const others = where
        ? [...where.children]
            .filter((child) => !child.classList.contains('dom') && !child.classList.contains('k-estas'))
            .reduce((sum, child) => sum + child.getBoundingClientRect().width + gap, 0)
        : 0;
      const sub = omni.querySelector('.dom .sub') ? 32 : 0;
      const need = main.getBoundingClientRect().width + sub + others + probe.getBoundingClientRect().width + gap + padding;
      setFits(need <= omni.clientWidth);
    };
    check();
    const omni = document.querySelector('.omni');
    if (!omni || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(omni);
    window.addEventListener('resize', check);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [view.label, domain, scale]);
  return fits;
}

/** Copia invisible del indicador para medir cuánto ocupa. */
export function SiteCheckProbe({ view }: { view: SiteCheckView }) {
  if (view.indicator === 'none' || !view.label) return null;
  return (
    <span className="site-badge site-badge-probe" aria-hidden="true">
      <Icon name={SITE_CHECK_ICONS[view.indicator]} size="sm" />
      <span className="site-badge-label">{view.label}</span>
    </span>
  );
}

/**
 * Franja anclada debajo de la barra, alineada con la píldora «Estás en»: lleva
 * el indicador cuando no entra en la píldora y el panel cuando está abierto.
 * Mide su alto y lo informa: el proceso principal baja el sitio y la tarjeta
 * de ayuda para que nada la tape.
 */
export function SiteCheckUnderBar({ view, showIndicator }: { view: SiteCheckView; showIndicator: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(-1);
  const [left, setLeft] = useState(0);
  const open = view.panelOpen && view.panel !== null && view.indicator !== 'none';
  const visible = open || (showIndicator && view.indicator !== 'none');

  useLayoutEffect(() => {
    const element = ref.current;
    const report = (height: number) => {
      if (height === lastHeight.current) return;
      lastHeight.current = height;
      send({ type: 'siteCheckOverlay', height });
    };
    if (!visible || !element) {
      report(0);
      return;
    }
    // Alineada con la píldora de la barra.
    setLeft(Math.max(0, Math.round(document.querySelector('.omni')?.getBoundingClientRect().left ?? 0)));
    report(Math.ceil(element.getBoundingClientRect().height));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => report(Math.ceil(element.getBoundingClientRect().height)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) return null;
  return (
    <div ref={ref} className="site-check-band">
      <div className="site-check-stack" style={{ marginLeft: left }}>
        {showIndicator ? (
          <div className="site-check-strip" role="group" aria-label="Revisión del sitio">
            <SiteCheckIndicator view={view} />
          </div>
        ) : null}
        {open ? <SiteCheckPanel view={view} /> : null}
      </div>
    </div>
  );
}

/** Panel breve: título, una o dos frases, acción principal y «Ver por qué» cerrado. */
export function SiteCheckPanel({ view }: { view: SiteCheckView }) {
  const ref = useRef<HTMLElement>(null);
  const open = view.panelOpen && view.panel !== null && view.indicator !== 'none';

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
        if (event.key === 'Escape') runAction(CLOSE);
      }}
    >
      <div className="site-check-head">
        <Icon name={SITE_CHECK_ICONS[view.indicator]} />
        <h2 id="site-check-panel-title" className="title" tabIndex={-1}>
          {panel.title}
        </h2>
        <Button variant="quiet" className="icon-only" aria-label="Cerrar" onClick={() => runAction(CLOSE)}>
          <Icon name="x" />
        </Button>
      </div>
      {panel.body.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
      <div className="site-check-actions">
        <Button variant="primary" onClick={() => runAction(panel.primary)}>
          {panel.primary.label}
        </Button>
        {panel.secondary ? (
          <Button variant="secondary" onClick={() => runAction(panel.secondary!)}>
            {panel.secondary.label}
          </Button>
        ) : null}
      </div>
      <Details panel={panel} />
    </section>
  );
}

/**
 * Advertencia destacada de riesgo alto. Ocupa el área del sitio: mientras está
 * abierta, el proceso principal oculta la vista del sitio y la tarjeta de ayuda.
 */
export function SiteCheckWarning({ view }: { view: SiteCheckView }) {
  const area = useRef<HTMLElement>(null);
  const warning = view.warning;
  useEffect(() => {
    if (warning) area.current?.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
  }, [warning !== null]);
  if (!warning) return null;
  return (
    <section ref={area} className="site-check-warning" role="alertdialog" aria-labelledby="site-check-warning-title" aria-describedby="site-check-warning-body">
      <div className="site-check-dialog">
        <div className="site-check-head">
          <Icon name="shield-alert" size="lg" />
          <h2 id="site-check-warning-title" className="title">
            {warning.title}
          </h2>
        </div>
        <div id="site-check-warning-body">
          {warning.body.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
        <Button variant="primary" block icon="arrow-left" onClick={() => runAction(warning.primary)}>
          {warning.primary.label}
        </Button>
        <Details panel={warning} />
        <p className="muted">Si ya leíste la advertencia y querés seguir igual:</p>
        <Button variant="quiet" block onClick={() => runAction(warning.continueAction)}>
          {warning.continueAction.label}
        </Button>
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
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

/** Aviso en la tarjeta de ayuda cuando la guía pausa una indicación por riesgo alto. */
export function GuidePausedNotice() {
  return (
    <section className="status error" role="status">
      <div className="head">
        <Icon name="shield-alert" size="lg" />
        <h2 className="title">Pausé esta indicación</h2>
      </div>
      <p>Te pedía escribir datos o confirmar algo, y este sitio podría ser una estafa. No ingreses contraseñas ni códigos.</p>
      <div className="actions">
        <Button variant="primary" block icon="arrow-left" onClick={() => send({ type: 'siteCheckLeave' })}>
          Salir de este sitio
        </Button>
      </div>
    </section>
  );
}
