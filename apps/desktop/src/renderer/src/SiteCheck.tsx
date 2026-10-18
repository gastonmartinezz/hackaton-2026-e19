/**
 * Protección de sitios en la interfaz propia del navegador (nunca dentro de la
 * página): indicador en la barra «Estás en», junto al dominio; panel que flota
 * sobre el sitio, anclado debajo del indicador, en su propia vista
 * (site-check.html, main/site-check-popover.ts); advertencia de riesgo alto y
 * anuncios accesibles. Solo presenta `AppState.siteCheck` (textos ya resueltos
 * en el proceso principal) y envía comandos. Es el sello de la barra del diseño
 * v2.2 (R6). Estilos con los tokens de @asistente/ui/tokens.css (site-check.css).
 */
import { BrandIcon, Button, Icon, type IconName } from '@asistente/ui';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SiteCheckView } from '../../shared/ipc';
import type { SiteCheckAction, SiteCheckPanelCopy, SiteCheckTone, SiteIndicatorKind } from '../../shared/site-check-copy';
import { send, useAppState } from './useAppState';

type SiteCheckKind = Exclude<SiteIndicatorKind, 'none'>;

/**
 * Un ícono Lucide distinto por estado (@asistente/ui). Los escudos forman una
 * familia: con tilde es oficial, vacío es «revisado, sin alertas», con
 * pregunta es «no pudimos verificarlo» y con cruz es posible estafa. El
 * triángulo de atención es el mismo del sello «No verificado» del diseño. El
 * texto acompaña siempre: el estado nunca depende solo del ícono o del color.
 */
export const SITE_CHECK_ICONS: Record<SiteCheckKind, IconName> = {
  checking: 'loader-circle',
  official: 'shield-check',
  no_alerts: 'shield',
  attention: 'triangle-alert',
  possible_scam: 'shield-x',
  unverified: 'shield-question-mark',
  local: 'monitor',
};

/**
 * Ícono del estado (decorativo, aria-hidden). «Revisando…» gira, salvo con
 * movimiento reducido: ahí queda fijo (site-check.css).
 */
export function SiteCheckIcon({ kind, size }: { kind: SiteCheckKind; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className="site-check-icon" data-state={kind}>
      <Icon name={SITE_CHECK_ICONS[kind]} size={size} />
    </span>
  );
}

/** Contenido del sello: ícono protagonista en su medalla y el texto corto del estado. */
function BadgeContent({ kind, label }: { kind: SiteCheckKind; label: string }) {
  return (
    <>
      <span className="site-badge-icon">
        <SiteCheckIcon kind={kind} />
      </span>
      <span className="site-badge-label">{label}</span>
    </>
  );
}

/** Bloque de estado de docs/02 para cada tono: éxito, aviso, error o neutro. */
const STATUS_BLOCK: Record<SiteCheckTone, string> = {
  positive: 'success',
  warning: 'warn',
  danger: 'error',
  neutral: 'neutral',
};

const PANEL_ID = 'site-check-panel';
const INDICATOR_ID = 'site-check-indicator';
/** Margen transparente de la vista flotante para el halo (POPOVER_SHADOW en main/site-check-popover.ts). */
const SHADOW = 16;

export const NO_SITE_CHECK: SiteCheckView = {
  indicator: 'none',
  label: null,
  tone: 'neutral',
  panel: null,
  panelOpen: false,
  warning: null,
  announcement: null,
  guidePaused: false,
  focusIndicator: 0,
};

/** Escape, «Cerrar» o «Entendido»: se cierra y el foco vuelve al indicador. */
function closePanel(): void {
  send({ type: 'siteCheckPanel', open: false, restoreFocus: true });
  // Si el indicador está en este mismo documento, el foco vuelve ya; si no, lo pide el proceso principal.
  document.getElementById(INDICATOR_ID)?.focus({ preventScroll: true });
}

function runAction(action: SiteCheckAction): void {
  switch (action.id) {
    case 'close':
      closePanel();
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

function isPanelOpen(view: SiteCheckView): boolean {
  return view.panelOpen && view.panel !== null && view.indicator !== 'none';
}

/**
 * Botón con ícono y texto, dentro de la píldora «Estás en», al lado del dominio
 * (o flotando debajo de ella si no entra). Abre y cierra el panel. Cuando el
 * panel se cierra desde adentro, el foco vuelve acá (`focusIndicator`).
 */
export function SiteCheckIndicator({ view, controlsPanel = false }: { view: SiteCheckView; controlsPanel?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const focusKey = useRef(view.focusIndicator);
  useEffect(() => {
    if (view.focusIndicator === focusKey.current) return;
    focusKey.current = view.focusIndicator;
    ref.current?.focus({ preventScroll: true });
  }, [view.focusIndicator]);

  if (view.indicator === 'none' || !view.label) return null;
  const open = isPanelOpen(view);
  return (
    <button
      ref={ref}
      type="button"
      id={INDICATOR_ID}
      className="site-badge"
      data-state={view.indicator}
      data-tone={view.tone}
      aria-haspopup="dialog"
      aria-expanded={open}
      // El panel vive en otra vista cuando el indicador está en la barra: solo se referencia en el mismo documento.
      aria-controls={controlsPanel && open ? PANEL_ID : undefined}
      aria-label={`Revisión del sitio: ${view.label}. Ver detalles`}
      onClick={() => send({ type: 'siteCheckPanel', open: !view.panelOpen })}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          closePanel();
        }
      }}
    >
      <BadgeContent kind={view.indicator} label={view.label} />
    </button>
  );
}

/** Fuente de la oficialidad, motivos, cobertura y comentario de la IA: cerrados al abrir («Ver por qué»). */
function Details({ panel }: { panel: SiteCheckPanelCopy }) {
  if (panel.sources.length === 0 && panel.reasons.length === 0 && !panel.coverageNote && !panel.explanation) return null;
  return (
    <details
      className="site-check-details"
      // Al abrir, los motivos quedan a la vista aunque el panel tenga que desplazarse por dentro
      // (solo se desplaza el cuerpo del panel, nunca la vista entera).
      onToggle={(event) => {
        const details = event.currentTarget;
        const scroller = details.closest('.hc-body');
        if (!details.open || !scroller) return;
        const d = details.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        if (d.bottom > s.bottom) scroller.scrollTop += Math.min(d.bottom - s.bottom, d.top - s.top);
      }}
    >
      {/* Enlace discreto con chevron Lucide (sin el triángulo del navegador). */}
      <summary>
        <Icon name="chevron-right" size="sm" />
        <span>Ver por qué</span>
      </summary>
      <div className="site-check-why">
        {panel.sources.map((line) => (
          <p key={line}>{line}</p>
        ))}
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
      </div>
    </details>
  );
}

/* --------------------------- ¿Entra el indicador? --------------------------- */

/**
 * ¿Entra el indicador en la píldora «Estás en» sin cortar el dominio principal?
 * Mide el dominio completo (aunque esté recortado), el resto de la píldora y un indicador
 * de prueba invisible; el ancho de la píldora no depende de su contenido, así
 * que la decisión no oscila.
 */
export function useIndicatorFits(view: SiteCheckView, domain: string, scale: number): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const check = () => {
      const omni = document.querySelector<HTMLElement>('.omni');
      const main = omni?.querySelector<HTMLElement>('.dom b');
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
      // Ancho completo del dominio aunque esté achicado con «…»: así la decisión no oscila.
      const need = main.scrollWidth + sub + others + probe.getBoundingClientRect().width + gap + padding;
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
    <span className="site-badge site-badge-probe" data-state={view.indicator} data-tone={view.tone} aria-hidden="true">
      <BadgeContent kind={view.indicator} label={view.label} />
    </span>
  );
}

/* ------------------------------ Panel flotante ------------------------------ */

/**
 * Informa al proceso principal dónde está la píldora «Estás en» (ancla del
 * panel flotante) y si el sello entra en ella. Solo manda cuando cambia.
 */
export function useSiteCheckAnchor(inline: boolean): void {
  const last = useRef('');
  useLayoutEffect(() => {
    const report = () => {
      const omni = document.querySelector('.omni');
      if (!omni) return;
      const rect = omni.getBoundingClientRect();
      const left = Math.max(0, Math.round(rect.left));
      const right = Math.max(0, Math.round(rect.right));
      const key = `${left}:${right}:${inline}`;
      if (key === last.current) return;
      last.current = key;
      send({ type: 'siteCheckAnchor', left, right, inline });
    };
    report();
    window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  });
}

/**
 * Con el panel abierto, tocar cualquier otra cosa de la barra lo cierra (el
 * indicador ya lo alterna). El foco queda donde tocó la persona.
 */
export function useDismissOnOutsidePointer(open: boolean, inside: string): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(inside)) return;
      send({ type: 'siteCheckPanel', open: false });
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, inside]);
}

/**
 * Vista flotante (site-check.html): el panel, y el indicador cuando no entra en
 * la píldora. Mide lo que dibuja y lo informa: el proceso principal la ubica
 * debajo del indicador, encima del sitio y de la tarjeta, sin moverlos.
 */
export function SiteCheckPopover() {
  const state = useAppState();
  const hostRef = useRef<HTMLDivElement>(null);
  const view = state?.siteCheck ?? NO_SITE_CHECK;
  const layout = state?.layout.siteCheck;
  // Con la advertencia de riesgo alto, el indicador y el panel van en la ventana.
  const site = Boolean(state?.nav.visible) && view.warning === null;
  const chip = site && layout !== undefined && !layout.indicatorInline && view.indicator !== 'none' && view.label !== null;
  const open = site && isPanelOpen(view);
  const shown = chip || open;

  useLayoutEffect(() => {
    const host = hostRef.current;
    let last = '';
    const report = () => {
      const rect = shown ? host?.getBoundingClientRect() : undefined;
      const width = rect ? Math.max(0, Math.ceil(rect.width) - SHADOW * 2) : 0;
      const height = rect ? Math.max(0, Math.ceil(rect.height) - SHADOW * 2) : 0;
      const key = `${width}:${height}`;
      if (key === last) return;
      last = key;
      send({ type: 'siteCheckPopoverLayout', width, height });
    };
    report();
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(host);
    return () => observer.disconnect();
  }, [shown, chip, open, view.indicator, view.label, layout?.maxWidth, layout?.maxHeight, layout?.chipOffset, state?.prefs.textScale]);

  // El margen transparente del halo también es «afuera».
  useDismissOnOutsidePointer(open, '.site-check-panel, .site-badge');

  if (!state || !shown) return null;
  return (
    <div
      ref={hostRef}
      className="popover-host"
      style={{ ['--popover-max-w' as string]: `${layout?.maxWidth ?? 0}px`, ['--popover-max-h' as string]: `${layout?.maxHeight ?? 0}px` }}
    >
      {chip ? (
        // Si el panel se corre a la izquierda para no tapar la tarjeta, el indicador queda donde estaba.
        <div className="site-check-strip" role="group" aria-label="Revisión del sitio" style={{ marginLeft: layout?.chipOffset ?? 0 }}>
          <SiteCheckIndicator view={view} controlsPanel />
        </div>
      ) : null}
      {open ? <SiteCheckPanel view={view} /> : null}
    </div>
  );
}

/**
 * Con la advertencia de riesgo alto abierta (el sitio está oculto), el
 * indicador que no entra en la píldora y el panel van en la ventana, justo
 * debajo de la barra y alineados con la píldora. No hay página que empujar.
 */
export function SiteCheckUnderBar({ view, showIndicator }: { view: SiteCheckView; showIndicator: boolean }) {
  const [left, setLeft] = useState(0);
  const open = isPanelOpen(view);
  const visible = open || (showIndicator && view.indicator !== 'none');

  useLayoutEffect(() => {
    if (visible) setLeft(Math.max(0, Math.round(document.querySelector('.omni')?.getBoundingClientRect().left ?? 0)));
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="site-check-band">
      <div className="site-check-stack" style={{ marginLeft: left }}>
        {showIndicator ? (
          <div className="site-check-strip" role="group" aria-label="Revisión del sitio">
            <SiteCheckIndicator view={view} controlsPanel />
          </div>
        ) : null}
        {open ? <SiteCheckPanel view={view} /> : null}
      </div>
    </div>
  );
}

/**
 * Panel breve con el lenguaje de la tarjeta flotante: encabezado de Guíame con
 * «Cerrar», bloque de estado (título y una o dos frases), acción principal y
 * «Ver por qué» cerrado. Diálogo no modal: Escape o «Cerrar» lo cierran y el
 * foco vuelve al indicador.
 */
export function SiteCheckPanel({ view }: { view: SiteCheckView }) {
  const ref = useRef<HTMLElement>(null);
  const open = isPanelOpen(view);

  useEffect(() => {
    // Sin desplazar la vista flotante mientras todavía se está ajustando a su contenido.
    if (open) ref.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [open, view.indicator]);

  if (!open || !view.panel || view.indicator === 'none') return null;
  const { panel } = view;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closePanel();
  };
  return (
    <section
      ref={ref}
      id={PANEL_ID}
      className="hc site-check-panel"
      data-tone={view.tone}
      role="dialog"
      aria-modal="false"
      aria-labelledby="site-check-panel-title"
      aria-describedby="site-check-panel-body"
      onKeyDown={onKeyDown}
    >
      <div className="hc-head">
        <BrandIcon />
        <span className="hc-goal">Guíame</span>
        <Button variant="quiet" icon="x" onClick={closePanel}>
          Cerrar
        </Button>
      </div>
      <div className="hc-body">
        <div className={`status ${STATUS_BLOCK[view.tone]}`}>
          <div className="head">
            <SiteCheckIcon kind={view.indicator} size="lg" />
            <h2 id="site-check-panel-title" className="hc-title" tabIndex={-1}>
              {panel.title}
            </h2>
          </div>
          <div id="site-check-panel-body" className="site-check-body">
            {panel.body.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        </div>
        <div className="site-check-actions">
          <Button variant="primary" block onClick={() => runAction(panel.primary)}>
            {panel.primary.label}
          </Button>
          {panel.secondary ? (
            <Button variant="secondary" block onClick={() => runAction(panel.secondary!)}>
              {panel.secondary.label}
            </Button>
          ) : null}
        </div>
        <Details panel={panel} />
      </div>
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
          <SiteCheckIcon kind="possible_scam" size="lg" />
          <h2 id="site-check-warning-title" className="hc-title">
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
        <Button variant="link" onClick={() => runAction(warning.continueAction)}>
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
    <>
      <section className="status error site-check-paused" role="status">
        <div className="head">
          <SiteCheckIcon kind="possible_scam" size="lg" />
          <h2 className="hc-title">Pausé esta indicación</h2>
        </div>
        <p>Te pedía escribir datos o confirmar algo, y este sitio podría ser una estafa. No ingreses contraseñas ni códigos.</p>
      </section>
      <Button variant="primary" block icon="arrow-left" onClick={() => send({ type: 'siteCheckLeave' })}>
        Salir de este sitio
      </Button>
    </>
  );
}
