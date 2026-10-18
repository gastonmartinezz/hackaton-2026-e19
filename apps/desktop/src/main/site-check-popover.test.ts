import { describe, expect, it, vi } from 'vitest';
import { UiCommandSchema } from '../shared/ipc';

vi.mock('electron', () => ({ WebContentsView: class {} }));
const { placePopover, POPOVER_CARD_GAP, POPOVER_COMMANDS, POPOVER_SHADOW } = await import('./site-check-popover');

const WINDOW = { width: 1440, height: 900 };
const BAR = 76;

describe('placePopover: el panel flota debajo del indicador sin mover nada', () => {
  it('con el indicador en la píldora, cuelga del borde derecho de la píldora, debajo de la barra', () => {
    const { box } = placePopover(WINDOW, BAR, { left: 290, right: 912, inline: true }, { width: 520, height: 400 });
    expect(box).toEqual({ x: 912 - 520, y: BAR + POPOVER_SHADOW, width: 520, height: 400 });
    // La vista (con su halo) empieza en el borde de la barra: nunca tapa el indicador ni los controles.
    expect(box.y - POPOVER_SHADOW).toBeGreaterThanOrEqual(BAR);
  });

  it('se corre a la izquierda para no tapar la tarjeta de ayuda', () => {
    const card = { x: 896, y: 100, width: 520, height: 200 };
    const { box } = placePopover(WINDOW, BAR, { left: 290, right: 912, inline: true }, { width: 520, height: 400 }, { card });
    expect(box.x + box.width).toBe(card.x - POPOVER_CARD_GAP);
    // Una tarjeta abajo (no se cruzan en alto) no lo corre.
    const low = { ...card, y: 600 };
    expect(placePopover(WINDOW, BAR, { left: 290, right: 912, inline: true }, { width: 520, height: 400 }, { card: low }).box.x).toBe(912 - 520);
  });

  it('con el indicador afuera, flota debajo del borde izquierdo de la píldora; el panel se corre y el indicador no se mueve', () => {
    const anchor = { left: 312, right: 780, inline: false };
    const closed = placePopover(WINDOW, 85, anchor, { width: 260, height: 60 });
    expect(closed.box.x).toBe(312);
    expect(closed.chipOffset).toBe(0);

    const card = { x: 718, y: 109, width: 554, height: 270 };
    const open = placePopover(WINDOW, 85, anchor, { width: 652, height: 600 }, { card, panelOpen: true, panelWidth: 652 });
    expect(open.box.x).toBe(718 - POPOVER_CARD_GAP - 652);
    // El indicador queda en la misma posición de la pantalla.
    expect(open.box.x + open.chipOffset).toBe(312);
  });

  it('nunca se sale de la ventana y limita el alto: lo que no entra se desplaza por dentro', () => {
    const narrow = { width: 900, height: 600 };
    const { box, maxWidth, maxHeight } = placePopover(narrow, BAR, { left: 200, right: 300, inline: true }, { width: 2000, height: 2000 });
    expect(box.x).toBeGreaterThanOrEqual(POPOVER_SHADOW);
    expect(box.x + box.width).toBeLessThanOrEqual(narrow.width - POPOVER_SHADOW);
    expect(box.width).toBe(maxWidth);
    expect(box.height).toBe(maxHeight);
    expect(box.y + box.height).toBeLessThanOrEqual(narrow.height);
  });
});

describe('IPC del panel flotante', () => {
  it('el panel solo puede pedir lo suyo', () => {
    expect([...POPOVER_COMMANDS].sort()).toEqual(['ready', 'siteCheckContinue', 'siteCheckLeave', 'siteCheckPanel', 'siteCheckPopoverLayout', 'siteCheckRetry']);
    for (const type of ['navigate', 'home', 'submitIntent', 'siteCheckAnchor', 'cardLayout', 'setTextScale', 'resolveNotice'] as const) {
      expect(POPOVER_COMMANDS.has(type)).toBe(false);
    }
  });

  it('valida los mensajes nuevos con Zod', () => {
    expect(UiCommandSchema.safeParse({ type: 'siteCheckPopoverLayout', width: 520, height: 400 }).success).toBe(true);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckPopoverLayout', width: -1, height: 400 }).success).toBe(false);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckPopoverLayout', width: 1.5, height: 400 }).success).toBe(false);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckPopoverLayout', width: 520, height: 400, x: 3 }).success).toBe(false);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckAnchor', left: 290, right: 912, inline: true }).success).toBe(true);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckAnchor', left: 290, right: 912 }).success).toBe(false);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckAnchor', left: 290, right: 1e9, inline: false }).success).toBe(false);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckPanel', open: false, restoreFocus: true }).success).toBe(true);
    expect(UiCommandSchema.safeParse({ type: 'siteCheckPanel', open: false, restoreFocus: 'sí' }).success).toBe(false);
    // La franja que empujaba el sitio ya no existe.
    expect(UiCommandSchema.safeParse({ type: 'siteCheckOverlay', height: 120 }).success).toBe(false);
  });
});
