import type { GuideStep, PageOption } from '@hackaton/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateObservation, initialState, transition, type GuideState } from './index';

const option: PageOption = { id: 'horarios', title: 'Ver horarios', initialElement: '#el-1' };
const other: PageOption = { id: 'turno', title: 'Pedir turno', initialElement: '#el-2' };
const step: GuideStep = {
  element: '#el-1',
  instruction: 'Hacé clic en Horarios.',
  presentation: 'highlight',
  waitFor: 'userInteraction',
};

function run(...events: Parameters<typeof transition>[1][]): GuideState {
  return events.reduce(transition, initialState);
}

const analyzed = (guide: { goal: string; step: GuideStep } | null = null) =>
  run({ type: 'ANALYZE', goal: 'ver horarios' }, { type: 'RESPONSE', response: { options: [option, other, option], guide } });

describe('transition', () => {
  it('muestra las opciones sin duplicados y conserva el objetivo del chat', () => {
    const state = analyzed();
    expect(state).toMatchObject({ phase: 'choosing', goal: 'ver horarios', primary: [option, other], secondary: [] });
  });

  it('separa las opciones principales de las secundarias', () => {
    const options = Array.from({ length: 5 }, (_, i) => ({ ...option, id: `o${i}` }));
    const state = run({ type: 'ANALYZE' }, { type: 'RESPONSE', response: { options, guide: null } });
    expect(state.primary).toHaveLength(3);
    expect(state.secondary).toHaveLength(2);
  });

  it('sin opciones, la página no tiene ayuda', () => {
    const state = run({ type: 'ANALYZE' }, { type: 'RESPONSE', response: { options: [], guide: null } });
    expect(state.phase).toBe('unsupported');
  });

  it('usa el paso sugerido si la persona elige esa opción, sin pedir otro', () => {
    const state = transition(analyzed({ goal: 'horarios', step }), { type: 'SELECT', optionId: 'horarios' });
    expect(state).toMatchObject({ phase: 'waitingForUser', option, step, stepCount: 1 });
  });

  it('pide el paso al servidor si eligió otra opción', () => {
    const state = transition(analyzed({ goal: 'horarios', step }), { type: 'SELECT', optionId: 'turno' });
    expect(state).toMatchObject({ phase: 'guiding', option: other, stepCount: 0 });
    expect(state.suggested).toBeUndefined();
  });

  it('ignora opciones inexistentes', () => {
    const state = analyzed();
    expect(transition(state, { type: 'SELECT', optionId: 'nada' })).toBe(state);
  });

  it('recorre guía, verificación y siguiente paso', () => {
    let state = transition(analyzed(), { type: 'SELECT', optionId: 'horarios' });
    state = transition(state, { type: 'RESPONSE', response: { options: [], guide: { goal: 'horarios', step } } });
    expect(state).toMatchObject({ phase: 'waitingForUser', stepCount: 1, primary: [option, other] });
    state = transition(state, { type: 'SHOWN', elementId: 'el-1' });
    expect(state.step?.targetElementId).toBe('el-1');
    state = transition(state, { type: 'OUTCOME', outcome: 'signalObserved' });
    expect(state).toMatchObject({ phase: 'verifying', lastOutcome: 'signalObserved' });
    state = transition(state, { type: 'REQUEST_NEXT' });
    expect(state.phase).toBe('guiding');
    state = transition(state, { type: 'RESPONSE', response: { options: [], guide: null } });
    expect(state.phase).toBe('completed');
  });

  it('sin paso posible antes de empezar, no puede ayudar', () => {
    let state = transition(analyzed(), { type: 'SELECT', optionId: 'turno' });
    state = transition(state, { type: 'RESPONSE', response: { options: [], guide: null } });
    expect(state.phase).toBe('unsupported');
  });

  it('una navegación durante la guía pide el siguiente paso; sin opción, reanaliza', () => {
    let state = transition(analyzed({ goal: 'horarios', step: { ...step, waitFor: 'navigation' } }), { type: 'SELECT', optionId: 'horarios' });
    state = transition(state, { type: 'NAVIGATED' });
    expect(state).toMatchObject({ phase: 'verifying', lastOutcome: 'signalObserved' });
    expect(transition(analyzed(), { type: 'NAVIGATED' }).phase).toBe('analyzing');
  });

  it('reintenta según dónde falló y vuelve a las opciones', () => {
    const failedOptions = transition(run({ type: 'ANALYZE' }), { type: 'FAILED', message: 'x' });
    expect(transition(failedOptions, { type: 'RETRY' }).phase).toBe('analyzing');

    const guiding = transition(analyzed(), { type: 'SELECT', optionId: 'turno' });
    const failedNext = transition(guiding, { type: 'FAILED', message: 'x' });
    expect(transition(failedNext, { type: 'RETRY' }).phase).toBe('verifying');
    expect(transition(failedNext, { type: 'BACK' })).toMatchObject({ phase: 'choosing', option: undefined });
  });

  it('ignora respuestas que llegan fuera de fase', () => {
    const state = analyzed();
    expect(transition(state, { type: 'RESPONSE', response: { options: [], guide: { goal: 'x', step } } })).toBe(state);
    expect(transition(initialState, { type: 'EXIT' })).toEqual(initialState);
  });
});

describe('evaluateObservation', () => {
  const shown = { ...step, targetElementId: 'el-1' };

  it('solo la interacción con el elemento señalado completa un paso de interacción', () => {
    expect(evaluateObservation(shown, { kind: 'interaction', elementId: 'el-1' })).toBe('signalObserved');
    expect(evaluateObservation(shown, { kind: 'interaction', elementId: 'el-2' })).toBeNull();
    expect(evaluateObservation(step, { kind: 'interaction', elementId: 'el-1' })).toBeNull();
    expect(evaluateObservation({ ...shown, waitFor: 'navigation' }, { kind: 'interaction', elementId: 'el-1' })).toBeNull();
  });

  it('navegación, cambios de página, errores y confirmación', () => {
    expect(evaluateObservation({ ...shown, waitFor: 'navigation' }, { kind: 'navigation' })).toBe('signalObserved');
    expect(evaluateObservation({ ...shown, waitFor: 'userConfirmation' }, { kind: 'navigation' })).toBe('targetStale');
    expect(evaluateObservation(shown, { kind: 'pageChange', targetPresent: true })).toBeNull();
    expect(evaluateObservation(shown, { kind: 'pageChange', targetPresent: false })).toBe('targetStale');
    expect(evaluateObservation(shown, { kind: 'validationError' })).toBe('validationError');
    expect(evaluateObservation(shown, { kind: 'userConfirmation' })).toBe('userConfirmed');
  });
});
