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

/** Íconos Lucide de @asistente/ui. El texto acompaña siempre. */
export const SITE_CHECK_ICONS: Record<Exclude<SiteIndicatorKind, 'none'>, IconName> = {
  checking: 'clock',
  official: 'shield-check',
  no_alerts: 'search',
  attention: 'triangle-alert',
  possible_scam: 'shield-alert',
  unverified: 'circle-help',
  local: 'circle-slash',
};

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
      <Icon name={SITE_CHECK_ICONS[view.indicator]} size="sm" />
      <span className="site-badge-label">{view.label}</span>
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
 * Cuánto se compacta la píldora «Estás en» para que el sello quepa al lado del
 * dominio: 0 nada; 1 sin «Estás en»; 2 además la conexión no segura queda solo
 * con su ícono (el texto sigue para lectores de pantalla y el aviso completo está
 * en la tarjeta); 3 además el texto del sello pasa a dos líneas (solo si en dos
 * líneas entra en el alto de la píldora). Recién después se acorta el subdominio
 * (`sub`: «t…» y, si hace falta, oculto; el nombre accesible lleva siempre el
 * dominio completo). `inline: false`: ni así entra y el sello flota debajo de la
 * píldora; como último recurso para no cortar el dominio principal se oculta
 * también el ícono de conexión no segura (4). `overflow`: ni el dominio
 * principal solo entra (dominio muy largo a 1,75× en ventanas angostas): se
 * recorta con un desvanecido dentro de la píldora, sin dibujarse encima de «Ayuda».
 */
export interface IndicatorFit {
  compact: CompactLevel;
  inline: boolean;
  sub: SubdomainFit;
  overflow: boolean;
}
export type CompactLevel = 0 | 1 | 2 | 3 | 4;
export type SubdomainFit = 'full' | 'short' | 'none';

/** Medidas en px de la píldora y de cada pieza en su tamaño natural (0 si no está). */
export interface OmniMeasure {
  /** Ancho interior de la píldora, con su relleno. */
  available: number;
  padding: number;
  /** Separación entre la zona del dominio y el sello, y entre piezas de esa zona. */
  omniGap: number;
  whereGap: number;
  estas: number;
  insecureText: number;
  insecureIcon: number;
  sub: number;
  /** Lo mínimo que ocupa el subdominio acortado («t…»). */
  subMin: number;
  main: number;
  badge: number;
  badgeTwoLines: number;
  /** El sello en dos líneas entra en el alto de la píldora (a 1,75× no entra). */
  twoLinesFit: boolean;
}

/** Sin compactar: todo a la vista y el sello en la píldora. */
export const FIT_ALL: IndicatorFit = { compact: 0, inline: true, sub: 'full', overflow: false };

const SUB_LEVELS: readonly SubdomainFit[] = ['full', 'short', 'none'];

export function chooseIndicatorFit(m: OmniMeasure): IndicatorFit {
  const subWidth = { full: m.sub, short: Math.min(m.sub, m.subMin), none: 0 };
  const fits = (compact: CompactLevel, inline: boolean, sub: SubdomainFit) => {
    const items: number[] = [];
    if (m.insecureText > 0 && compact < 4) items.push(compact >= 2 ? m.insecureIcon : m.insecureText);
    if (compact < 1 && m.estas > 0) items.push(m.estas);
    items.push(m.main + subWidth[sub]);
    let need = m.padding + items.reduce((a, b) => a + b, 0) + m.whereGap * (items.length - 1);
    if (inline && m.badge > 0) need += m.omniGap + (compact >= 3 ? m.badgeTwoLines : m.badge);
    return need <= m.available + 0.5;
  };
  // Si no hay subdominio, acortarlo no cambia nada: se prueba una sola vez.
  const subs = m.sub > 0 ? SUB_LEVELS : SUB_LEVELS.slice(0, 1);
  const inlineLevels: CompactLevel[] = m.twoLinesFit ? [0, 1, 2, 3] : [0, 1, 2];
  for (const sub of subs) {
    for (const compact of inlineLevels) if (fits(compact, true, sub)) return { compact, inline: true, sub, overflow: false };
  }
  for (const sub of subs) {
    for (const compact of [0, 1, 2] as const) if (fits(compact, false, sub)) return { compact, inline: false, sub, overflow: false };
  }
  if (m.insecureText > 0) {
    for (const sub of subs) if (fits(4, false, sub)) return { compact: 4, inline: false, sub, overflow: false };
  }
  return { compact: m.insecureText > 0 ? 4 : 2, inline: false, sub: subs.at(-1)!, overflow: true };
}

const sameFit = (a: IndicatorFit, b: IndicatorFit) => a.compact === b.compact && a.inline === b.inline && a.sub === b.sub && a.overflow === b.overflow;

const width = (element: Element | null | undefined) => element?.getBoundingClientRect().width ?? 0;

/** Lee las medidas de la píldora real y de su copia invisible (OmniProbe). Null si no hay dominio a la vista. */
function measureOmni(): OmniMeasure | null {
  const omni = document.querySelector<HTMLElement>('.omni');
  const main = omni?.querySelector('.where .dom b');
  const probe = omni?.querySelector('.omni-probe');
  if (!omni || !main || !probe) return null;
  const style = getComputedStyle(omni);
  const where = omni.querySelector('.where');
  const sub = probe.querySelector<HTMLElement>('[data-probe="sub"]');
  const twoLines = probe.querySelector('[data-probe="badge-two-lines"]');
  return {
    available: omni.clientWidth,
    padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
    omniGap: parseFloat(style.columnGap) || 0,
    whereGap: where ? parseFloat(getComputedStyle(where).columnGap) || 0 : 0,
    estas: width(probe.querySelector('[data-probe="estas"]')),
    insecureText: width(probe.querySelector('[data-probe="insecure-text"]')),
    insecureIcon: width(probe.querySelector('[data-probe="insecure-icon"]')),
    sub: width(sub),
    subMin: sub ? parseFloat(getComputedStyle(sub).minWidth) || 0 : 0,
    main: width(main),
    badge: width(probe.querySelector('[data-probe="badge"]')),
    badgeTwoLines: width(twoLines),
    twoLinesFit: (twoLines?.getBoundingClientRect().height ?? Infinity) <= omni.clientHeight - 4,
  };
}

/**
 * Decide la compactación de la píldora y si el sello entra en ella. El ancho de
 * la píldora no depende de su contenido (container-type) y las medidas salen de
 * una copia invisible que no se compacta: la decisión no oscila.
 */
export function useIndicatorFit(view: SiteCheckView, domain: string, scale: number): IndicatorFit {
  const [fit, setFit] = useState<IndicatorFit>(FIT_ALL);
  useLayoutEffect(() => {
    const check = () => {
      const m = measureOmni();
      if (!m) return;
      const next = chooseIndicatorFit(m);
      setFit((prev) => (sameFit(prev, next) ? prev : next));
    };
    check();
    const omni = document.querySelector('.omni');
    const observer = omni && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    if (omni) observer?.observe(omni);
    window.addEventListener('resize', check);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [view.label, view.indicator, domain, scale]);
  return fit;
}

/**
 * Copia invisible de las piezas que se compactan, en su tamaño natural: «Estás
 * en», el subdominio, la conexión no segura (texto e ícono) y el sello en una y
 * dos líneas.
 */
export function OmniProbe({ view, insecure, sub }: { view: SiteCheckView; insecure: boolean; sub: string }) {
  const badge = view.indicator !== 'none' && view.label ? view.indicator : null;
  return (
    <span className="omni-probe" aria-hidden="true">
      <span className="k-estas" data-probe="estas">
        Estás en
      </span>
      {sub ? (
        <span className="sub" data-probe="sub">
          {sub}
        </span>
      ) : null}
      {insecure ? (
        <>
          <span className="insecure" data-probe="insecure-text">
            Conexión no segura
          </span>
          <span className="insecure" data-probe="insecure-icon">
            <Icon name="triangle-alert" size="sm" />
          </span>
        </>
      ) : null}
      {badge ? (
        <>
          <span className="site-badge" data-probe="badge">
            <Icon name={SITE_CHECK_ICONS[badge]} size="sm" />
            <span className="site-badge-label">{view.label}</span>
          </span>
          <span className="site-badge site-badge--two-lines" data-probe="badge-two-lines">
            <Icon name={SITE_CHECK_ICONS[badge]} size="sm" />
            <span className="site-badge-label">{view.label}</span>
          </span>
        </>
      ) : null}
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
            <Icon name={SITE_CHECK_ICONS[view.indicator]} size="lg" />
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
          <Icon name="shield-alert" size="lg" />
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
          <Icon name="shield-alert" size="lg" />
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
