// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, SiteCheckView, UiCommand } from '../../shared/ipc';
import { CONTINUE_ACTION, siteCheckCopy, type SiteIndicatorKind } from '../../shared/site-check-copy';
import {
  GuidePausedNotice,
  NO_SITE_CHECK,
  SiteCheckAnnouncer,
  SiteCheckIndicator,
  SiteCheckPanel,
  SiteCheckPopover,
  SiteCheckUnderBar,
  SiteCheckWarning,
} from './SiteCheck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let sent: UiCommand[];
let pushState: (state: AppState) => void;

beforeEach(() => {
  sent = [];
  pushState = () => {};
  window.asistente = {
    command: vi.fn(async (c: UiCommand) => void sent.push(c)),
    onState: (listener) => {
      pushState = listener;
      return () => {};
    },
    transcribe: vi.fn(),
    dictateField: vi.fn(),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
    onSpeechCut: () => () => {},
    speechDiagnostic: vi.fn(),
    voiceDiagnostic: vi.fn(),
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function view(kind: Exclude<SiteIndicatorKind, 'none'>, over: Partial<SiteCheckView> = {}): SiteCheckView {
  const copy = siteCheckCopy(kind);
  return { ...NO_SITE_CHECK, indicator: kind, label: copy.label, tone: copy.tone, panel: copy.panel, ...over };
}

const render = (node: React.ReactNode) => act(() => root.render(node));
const panelCommands = () => sent.filter((c) => c.type === 'siteCheckPanel');

describe('SiteCheckIndicator', () => {
  it('muestra ícono y texto, y abre el panel con teclado o clic', () => {
    render(<SiteCheckIndicator view={view('no_alerts')} />);
    const button = container.querySelector('button')!;
    expect(button.textContent).toContain('Sin alertas detectadas');
    expect(button.querySelector('.ic[aria-hidden="true"] svg')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    act(() => button.click());
    expect(sent).toEqual([{ type: 'siteCheckPanel', open: true }]);
  });

  it('en la barra no apunta a un panel de otra vista; en la vista flotante, sí', () => {
    render(<SiteCheckIndicator view={view('official', { panelOpen: true })} />);
    expect(container.querySelector('button')!.getAttribute('aria-controls')).toBeNull();
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    render(<SiteCheckIndicator view={view('official', { panelOpen: true })} controlsPanel />);
    expect(container.querySelector('button')!.getAttribute('aria-controls')).toBe('site-check-panel');
  });

  it('Escape sobre el indicador cierra el panel abierto', () => {
    render(<SiteCheckIndicator view={view('attention', { panelOpen: true })} />);
    act(() => container.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(panelCommands()).toEqual([{ type: 'siteCheckPanel', open: false, restoreFocus: true }]);
  });

  it('recupera el foco cuando el panel se cierra desde adentro (focusIndicator)', () => {
    render(<SiteCheckIndicator view={view('official', { focusIndicator: 3 })} />);
    const button = container.querySelector('button')!;
    expect(document.activeElement).not.toBe(button);
    render(<SiteCheckIndicator view={view('official', { focusIndicator: 4 })} />);
    expect(document.activeElement).toBe(button);
  });

  it('no se muestra sin sitio y nunca dice «seguro»', () => {
    render(<SiteCheckIndicator view={{ ...view('checking'), indicator: 'none', label: null }} />);
    expect(container.textContent).toBe('');
    for (const kind of ['checking', 'official', 'no_alerts', 'attention', 'possible_scam', 'unverified', 'local'] as const) {
      render(<SiteCheckIndicator view={view(kind)} />);
      expect(container.textContent).not.toMatch(/segur/i);
      expect(container.querySelector('.ic svg')).not.toBeNull();
    }
  });
});

describe('SiteCheckPanel', () => {
  it('diálogo no modal con nombre, bloque de estado, acción principal y detalles cerrados', () => {
    const v = view('unverified', { panelOpen: true });
    v.panel!.coverageNote = 'Algunas comprobaciones no estuvieron disponibles, así que la revisión no está completa.';
    render(<SiteCheckPanel view={v} />);
    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(panel.getAttribute('aria-labelledby')).toBe('site-check-panel-title');
    expect(container.querySelector('#site-check-panel-title')!.textContent).toContain('No pudimos verificarlo');
    expect(container.querySelector('#site-check-panel-body')!.textContent).toContain('No pudimos completar la revisión');
    // El foco entra al panel: al título, para que el lector lo anuncie.
    expect(document.activeElement).toBe(panel.querySelector('h2'));
    // Bloque de estado de docs/02 según el tono (aviso).
    expect(panel.querySelector('.status.warn')).not.toBeNull();
    const details = panel.querySelector('details')!;
    expect(details.open).toBe(false);
    // «Ver por qué» con chevron Lucide (sin el triángulo del navegador).
    expect(details.querySelector('summary')!.textContent?.trim()).toBe('Ver por qué');
    expect(details.querySelector('summary .ic[aria-hidden="true"] svg')).not.toBeNull();
    const primary = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Intentar de nuevo')!;
    expect(primary.className).toContain('btn-primary');
    act(() => primary.click());
    expect(sent).toContainEqual({ type: 'siteCheckRetry' });
  });

  it('Escape, «Cerrar» y «Entendido» cierran y devuelven el foco al indicador', () => {
    render(<SiteCheckPanel view={view('official', { panelOpen: true })} />);
    const panel = container.querySelector('[role="dialog"]')!;
    act(() => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const close = [...panel.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cerrar')!;
    // «Cerrar» tiene texto visible, ícono decorativo y objetivo de botón real.
    expect(close.tagName).toBe('BUTTON');
    expect(close.querySelector('.ic[aria-hidden="true"]')).not.toBeNull();
    act(() => close.click());
    const understood = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Entendido')!;
    act(() => understood.click());
    expect(panelCommands()).toEqual(Array(3).fill({ type: 'siteCheckPanel', open: false, restoreFocus: true }));
  });

  it('una sola acción principal; la secundaria es un botón secundario a lo ancho', () => {
    render(<SiteCheckPanel view={view('attention', { panelOpen: true })} />);
    const buttons = [...container.querySelectorAll('.site-check-actions button')];
    expect(buttons.filter((b) => b.className.includes('btn-primary'))).toHaveLength(1);
    expect(buttons.every((b) => b.className.includes('block'))).toBe(true);
  });

  it('«Ver por qué» de «Sitio oficial» muestra la fuente y la fecha, cerrado al abrir', () => {
    const v = view('official', { panelOpen: true });
    v.panel!.sources = ['Fuente: Registro de instituciones del BCU (bcu.gub.uy).', 'Revisado el 17 de octubre de 2026.'];
    render(<SiteCheckPanel view={v} />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Registro de instituciones del BCU');
    expect(details.textContent).toContain('Revisado el 17 de octubre de 2026.');
  });
});

/** Estado mínimo que mira la vista flotante. */
function appState(siteCheck: SiteCheckView, over: { indicatorInline?: boolean; visible?: boolean; chipOffset?: number } = {}): AppState {
  return {
    prefs: { textScale: 1.2 },
    nav: { visible: over.visible ?? true },
    layout: { siteCheck: { maxWidth: 1408, maxHeight: 784, indicatorInline: over.indicatorInline ?? true, chipOffset: over.chipOffset ?? 0 } },
    siteCheck,
  } as unknown as AppState;
}

describe('SiteCheckPopover (vista flotante sobre el sitio)', () => {
  it('con el panel cerrado y el indicador en la barra no dibuja nada e informa tamaño 0', () => {
    render(<SiteCheckPopover />);
    act(() => pushState(appState(view('official'))));
    expect(container.querySelector('.popover-host')).toBeNull();
    expect(sent).toContainEqual({ type: 'siteCheckPopoverLayout', width: 0, height: 0 });
    expect(sent.some((c) => (c.type as string) === 'siteCheckOverlay')).toBe(false);
  });

  it('con el panel abierto lo dibuja y vuelve a informar su tamaño', () => {
    render(<SiteCheckPopover />);
    act(() => pushState(appState(view('official', { panelOpen: true }))));
    expect(container.querySelector('.popover-host [role="dialog"]')).not.toBeNull();
    expect(container.querySelector('.popover-host .site-badge')).toBeNull();
    expect(sent.filter((c) => c.type === 'siteCheckPopoverLayout').length).toBeGreaterThan(0);
  });

  it('si el indicador no entra en la píldora, flota acá; el panel cuelga debajo', () => {
    render(<SiteCheckPopover />);
    act(() => pushState(appState(view('attention', { panelOpen: true }), { indicatorInline: false, chipOffset: 40 })));
    const strip = container.querySelector<HTMLElement>('.popover-host .site-check-strip')!;
    expect(strip.querySelector('#site-check-indicator')!.textContent).toContain('Atención');
    expect(strip.style.marginLeft).toBe('40px');
    expect(strip.querySelector('button')!.getAttribute('aria-controls')).toBe('site-check-panel');
    expect(container.querySelector('.popover-host [role="dialog"]')).not.toBeNull();
  });

  it('tocar el margen transparente (afuera del panel) lo cierra sin mover el foco', () => {
    render(<SiteCheckPopover />);
    act(() => pushState(appState(view('official', { panelOpen: true }))));
    act(() => container.querySelector('.popover-host')!.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(panelCommands()).toContainEqual({ type: 'siteCheckPanel', open: false });
    sent = [];
    act(() => container.querySelector('.site-check-panel p')!.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(panelCommands()).toEqual([]);
  });

  it('con la advertencia de riesgo alto no dibuja nada (va en la ventana)', () => {
    const scam = siteCheckCopy('possible_scam');
    render(<SiteCheckPopover />);
    act(() => pushState(appState(view('possible_scam', { panelOpen: true, warning: { ...scam.panel, continueAction: CONTINUE_ACTION } }), { indicatorInline: false })));
    expect(container.querySelector('.popover-host')).toBeNull();
  });
});

describe('SiteCheckUnderBar (solo con la advertencia abierta)', () => {
  it('lleva el indicador que no entra y el panel, sin pedir lugar al sitio', () => {
    render(<SiteCheckUnderBar view={view('attention', { panelOpen: true })} showIndicator />);
    const band = container.querySelector('.site-check-band')!;
    expect(band.querySelector('.site-badge')!.textContent).toContain('Atención');
    expect(band.querySelector('[role="dialog"]')).not.toBeNull();
    expect(sent.some((c) => (c.type as string) === 'siteCheckOverlay')).toBe(false);
  });

  it('cerrado y con el indicador en la píldora no ocupa lugar', () => {
    render(<SiteCheckUnderBar view={view('official')} showIndicator={false} />);
    expect(container.querySelector('.site-check-band')).toBeNull();
  });
});

describe('SiteCheckWarning', () => {
  it('advertencia con salida principal, «Ver por qué» y continuar después', () => {
    const scam = siteCheckCopy('possible_scam');
    render(<SiteCheckWarning view={view('possible_scam', { warning: { ...scam.panel, continueAction: CONTINUE_ACTION } })} />);
    const dialog = container.querySelector('[role="alertdialog"]')!;
    const buttons = [...dialog.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Salir de este sitio', 'Continuar de todos modos']);
    expect(document.activeElement).toBe(buttons[0]);
    act(() => buttons[0]!.click());
    act(() => buttons[1]!.click());
    expect(sent).toEqual([{ type: 'siteCheckLeave' }, { type: 'siteCheckContinue' }]);
  });
});

describe('GuidePausedNotice', () => {
  it('bloque de error con el ícono al lado del título y «Salir de este sitio»', () => {
    render(<GuidePausedNotice />);
    const block = container.querySelector('.status.error')!;
    expect(block.querySelector('.head .ic[aria-hidden="true"]')).not.toBeNull();
    expect(block.querySelector('.head h2')!.textContent).toBe('Pausé esta indicación');
    const leave = container.querySelector<HTMLButtonElement>('.btn-primary')!;
    act(() => leave.click());
    expect(sent).toEqual([{ type: 'siteCheckLeave' }]);
  });
});

describe('SiteCheckAnnouncer', () => {
  it('anuncia una vez por cambio relevante', () => {
    render(<SiteCheckAnnouncer view={view('official', { announcement: { id: 1, text: 'Sitio oficial de X.' } })} />);
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('Sitio oficial de X.');
    // Misma id (otra actualización del estado): no cambia el texto.
    render(<SiteCheckAnnouncer view={view('official', { announcement: { id: 1, text: 'Otro texto' } })} />);
    expect(live.textContent).toBe('Sitio oficial de X.');
    render(<SiteCheckAnnouncer view={view('attention', { announcement: { id: 2, text: 'Estado del sitio: Atención.' } })} />);
    expect(live.textContent).toBe('Estado del sitio: Atención.');
  });
});
