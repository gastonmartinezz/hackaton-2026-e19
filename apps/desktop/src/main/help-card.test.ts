import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ WebContentsView: class {} }));
const { placeCard } = await import('./help-card');

describe('placeCard', () => {
  const area = { x: 0, y: 75, width: 1440, height: 825 };
  const card = (target: { x: number; y: number; width: number; height: number } | null, height = 400) => placeCard(area, 440, height, target).placement;

  it('va arriba a la derecha si no tapa el control', () => {
    expect(card(null)).toBe('top');
    expect(card({ x: 40, y: 200, width: 120, height: 40 })).toBe('top');
  });

  it('cuenta el rótulo «Acá» al costado de un campo', () => {
    expect(placeCard(area, 440, 400, { x: 820, y: 100, width: 100, height: 30, field: true }).placement).toBe('bottom');
    expect(placeCard(area, 440, 400, { x: 820, y: 100, width: 100, height: 30 }).placement).toBe('top');
  });

  it('baja si arriba taparía el control, y se achica si tampoco entra abajo', () => {
    expect(card({ x: 1100, y: 100, width: 120, height: 40 })).toBe('bottom');
    expect(card({ x: 1100, y: 380, width: 120, height: 40 }, 700)).toBe('compact');
  });
});
