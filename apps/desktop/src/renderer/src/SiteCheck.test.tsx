// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteCheckView, UiCommand } from '../../shared/ipc';
import { CONTINUE_ACTION, siteCheckCopy, type SiteIndicatorKind } from '../../shared/site-check-copy';
import { SiteCheckAnnouncer, SiteCheckIndicator, SiteCheckPanel, SiteCheckUnderBar, SiteCheckWarning } from './SiteCheck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let sent: UiCommand[];

beforeEach(() => {
  sent = [];
  window.asistente = { command: vi.fn(async (c: UiCommand) => void sent.push(c)), onState: () => () => {} };
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
  return { indicator: kind, label: copy.label, tone: copy.tone, panel: copy.panel, panelOpen: false, warning: null, announcement: null, guidePaused: false, ...over };
}

const render = (node: React.ReactNode) => act(() => root.render(node));

describe('SiteCheckIndicator', () => {
  it('muestra ícono y texto, y abre el panel con teclado o clic', () => {
    render(<SiteCheckIndicator view={view('no_alerts')} />);
    const button = container.querySelector('button')!;
    expect(button.textContent).toContain('Sin alertas detectadas');
    expect(button.querySelector('.ic[aria-hidden="true"] svg')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('site-check-panel');
    act(() => button.click());
    expect(sent).toEqual([{ type: 'siteCheckPanel', open: true }]);
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
  it('título, frases, acción principal y detalles cerrados; Escape cierra', () => {
    const v = view('unverified', { panelOpen: true });
    v.panel!.coverageNote = 'Algunas comprobaciones no estuvieron disponibles, así que la revisión no está completa.';
    render(<SiteCheckPanel view={v} />);
    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('site-check-panel-title');
    expect(panel.querySelector('h2')!.textContent).toContain('No pudimos verificarlo');
    expect(document.activeElement).toBe(panel.querySelector('h2'));
    const details = panel.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Ver por qué');
    const primary = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Intentar de nuevo')!;
    act(() => primary.click());
    expect(sent).toContainEqual({ type: 'siteCheckRetry' });
    act(() => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(sent).toContainEqual({ type: 'siteCheckPanel', open: false });
  });

  it('cerrado y con el indicador en la píldora, la franja no ocupa lugar y avisa alto 0', () => {
    render(<SiteCheckUnderBar view={view('official')} showIndicator={false} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.site-check-band')).toBeNull();
    expect(sent).toContainEqual({ type: 'siteCheckOverlay', height: 0 });
  });

  it('si el indicador no entra en la píldora, va en la franja de abajo junto al panel', () => {
    render(<SiteCheckUnderBar view={view('attention', { panelOpen: true })} showIndicator />);
    const band = container.querySelector('.site-check-band')!;
    expect(band.querySelector('.site-badge')!.textContent).toContain('Atención');
    expect(band.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('Ver por qué de «Sitio oficial»', () => {
  it('muestra la fuente y la fecha dentro de los detalles cerrados', () => {
    const v = view('official', { panelOpen: true });
    v.panel!.sources = ['Fuente: Registro de instituciones del BCU (bcu.gub.uy).', 'Revisado el 17 de octubre de 2026.'];
    render(<SiteCheckPanel view={v} />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Registro de instituciones del BCU');
    expect(details.textContent).toContain('Revisado el 17 de octubre de 2026.');
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
