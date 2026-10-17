import type { GuideStep, PageOption } from '@hackaton/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateObservation, expectedStep, initialState, isSensitiveStep, transition, type GuideEvent, type GuideState } from './index';

const real = (id: string, waitFor: GuideStep['waitFor'] = 'userInteraction'): GuideStep => ({
  element: `#${id}`,
  instruction: `Usá ${id}.`,
  presentation: 'highlight',
  waitFor,
});
const theoretical: GuideStep = { element: null, instruction: 'Elegí la especialidad.', presentation: 'highlight', waitFor: 'userInteraction' };

const turno: PageOption = { id: 'turno', title: 'Sacar un turno', steps: [real('el-3'), theoretical] };
const buscar: PageOption = { id: 'buscar', title: 'Buscar', steps: [real('el-1'), real('el-2')] };

function run(...events: GuideEvent[]): GuideState {
  return events.reduce(transition, initialState);
}
const choosing = () => run({ type: 'ANALYZE', goal: 'turno' }, { type: 'OPTIONS', options: [turno, buscar, turno] });
const done: GuideEvent = { type: 'OUTCOME', outcome: 'signalObserved' };

describe('transition', () => {
  it('muestra las opciones sin duplicados y conserva el objetivo del chat', () => {
    expect(choosing()).toMatchObject({ phase: 'choosing', goal: 'turno', options: [turno, buscar] });
  });

  it('sin opciones, la página no tiene ayuda', () => {
    expect(run({ type: 'ANALYZE' }, { type: 'OPTIONS', options: [] }).phase).toBe('unsupported');
  });

  it('recorre una guía de pasos reales sin pedir nada al servidor', () => {
    let state = transition(choosing(), { type: 'SELECT', optionId: 'buscar' });
    expect(state).toMatchObject({ phase: 'waitingForUser', step: real('el-1'), stepCount: 1 });
    state = transition(state, done);
    expect(state).toMatchObject({ phase: 'waitingForUser', step: real('el-2'), stepCount: 2, completed: [real('el-1')] });
    state = transition(state, done);
    expect(state.phase).toBe('completed');
  });

  it('ante un paso teórico extrae la página y pide /v1/next-step con lo completado', () => {
    let state = transition(choosing(), { type: 'SELECT', optionId: 'turno' });
    state = transition(state, { type: 'SHOWN', elementId: 'el-3' });
    state = transition(state, done);
    expect(state).toMatchObject({ phase: 'verifying', step: theoretical, completed: [real('el-3')] });
    expect(expectedStep(state.step!)).toEqual(theoretical);
    state = transition(state, { type: 'REQUEST_NEXT' });
    expect(state.phase).toBe('guiding');

    state = transition(state, { type: 'NEXT', response: { steps: [real('el-9'), real('el-10')], done: false } });
    expect(state).toMatchObject({ phase: 'waitingForUser', step: real('el-9'), plan: [real('el-10')], completed: [], stepCount: 2 });

    state = transition(transition(state, done), done);
    expect(state.phase).toBe('completed');
  });

  it('done: true termina la tarea; sin pasos ni done, no puede seguir', () => {
    const guiding = run({ type: 'ANALYZE' }, { type: 'OPTIONS', options: [{ ...turno, steps: [theoretical] }] }, { type: 'SELECT', optionId: 'turno' });
    expect(guiding.phase).toBe('guiding');
    expect(transition(guiding, { type: 'NEXT', response: { steps: [], done: true } }).phase).toBe('completed');
    expect(transition(guiding, { type: 'NEXT', response: { steps: [], done: false } }).phase).toBe('unsupported');
  });

  it('un paso que sigue siendo teórico se muestra y espera la acción antes de volver a pedir', () => {
    const guiding = run({ type: 'ANALYZE' }, { type: 'OPTIONS', options: [{ ...turno, steps: [theoretical] }] }, { type: 'SELECT', optionId: 'turno' });
    let state = transition(guiding, { type: 'NEXT', response: { steps: [theoretical], done: false } });
    expect(state).toMatchObject({ phase: 'waitingForUser', step: theoretical });
    expect(evaluateObservation(state.step!, { kind: 'pageChange', targetPresent: false })).toBeNull();
    state = transition(state, { type: 'OUTCOME', outcome: 'userConfirmed' });
    expect(state).toMatchObject({ phase: 'verifying', step: theoretical });
  });

  it('un paso real que no se puede mostrar se vuelve a pedir con el HTML actual', () => {
    let state = transition(choosing(), { type: 'SELECT', optionId: 'buscar' });
    state = transition(state, { type: 'OUTCOME', outcome: 'targetStale' });
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-1'), completed: [] });
  });

  it('después de una navegación, los pasos reales que quedaban se vuelven a pedir', () => {
    let state = transition(choosing(), { type: 'SELECT', optionId: 'buscar' });
    state = transition(state, { type: 'NAVIGATED' });
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-2'), planStale: true, completed: [real('el-1')] });
    state = transition(transition(state, { type: 'REQUEST_NEXT' }), { type: 'NEXT', response: { steps: [real('el-5')], done: false } });
    expect(state).toMatchObject({ phase: 'waitingForUser', planStale: false });
  });

  it('sin opción elegida, una navegación reanaliza', () => {
    expect(transition(choosing(), { type: 'NAVIGATED' }).phase).toBe('analyzing');
  });

  it('reintenta según dónde falló y vuelve a las opciones', () => {
    const failedOptions = transition(run({ type: 'ANALYZE' }), { type: 'FAILED', message: 'x' });
    expect(transition(failedOptions, { type: 'RETRY' }).phase).toBe('analyzing');

    const guiding = run({ type: 'ANALYZE' }, { type: 'OPTIONS', options: [turno] }, { type: 'SELECT', optionId: 'turno' }, done, { type: 'REQUEST_NEXT' });
    const failedNext = transition(guiding, { type: 'FAILED', message: 'x' });
    expect(transition(failedNext, { type: 'RETRY' })).toMatchObject({ phase: 'verifying', step: theoretical });
    const back = transition(failedNext, { type: 'BACK' });
    expect(back).toMatchObject({ phase: 'choosing', options: [turno] });
    expect(back.option).toBeUndefined();
  });

  it('ignora eventos fuera de fase', () => {
    const state = choosing();
    expect(transition(state, { type: 'NEXT', response: { steps: [], done: true } })).toBe(state);
    expect(transition(state, { type: 'SELECT', optionId: 'nada' })).toBe(state);
    expect(transition(initialState, { type: 'EXIT' })).toEqual(initialState);
  });
});

describe('evaluateObservation', () => {
  const shown = { ...real('el-1'), targetElementId: 'el-1' };

  it('solo la interacción con el elemento señalado completa un paso de interacción', () => {
    expect(evaluateObservation(shown, { kind: 'interaction', elementId: 'el-1' })).toBe('signalObserved');
    expect(evaluateObservation(shown, { kind: 'interaction', elementId: 'el-2' })).toBeNull();
    expect(evaluateObservation(real('el-1'), { kind: 'interaction', elementId: 'el-1' })).toBeNull();
    expect(evaluateObservation({ ...shown, waitFor: 'navigation' }, { kind: 'interaction', elementId: 'el-1' })).toBeNull();
  });

  it('navegación, cambios de página, errores y confirmación', () => {
    expect(evaluateObservation({ ...shown, waitFor: 'navigation' }, { kind: 'navigation' })).toBe('signalObserved');
    expect(evaluateObservation({ ...shown, waitFor: 'userConfirmation' }, { kind: 'navigation' })).toBe('targetStale');
    expect(evaluateObservation(theoretical, { kind: 'navigation' })).toBe('signalObserved');
    expect(evaluateObservation(shown, { kind: 'pageChange', targetPresent: true })).toBeNull();
    expect(evaluateObservation(shown, { kind: 'pageChange', targetPresent: false })).toBe('targetStale');
    expect(evaluateObservation(shown, { kind: 'validationError' })).toBe('validationError');
    expect(evaluateObservation(shown, { kind: 'userConfirmation' })).toBe('userConfirmed');
  });
});

describe('isSensitiveStep', () => {
  const s = (instruction: string) => ({ instruction });
  it('pausa indicaciones que piden datos o confirmar operaciones', () => {
    expect(isSensitiveStep(s('Escribí tu número de documento.'))).toBe(true);
    expect(isSensitiveStep(s('Ingresá tu clave.'))).toBe(true);
    expect(isSensitiveStep(s('Hacé clic en «Confirmar transferencia».'))).toBe(true);
    expect(isSensitiveStep(s('Tocá «Pagar».'))).toBe(true);
    expect(isSensitiveStep(s('Iniciá sesión con tu usuario.'))).toBe(true);
    expect(isSensitiveStep(s('Hacé clic en «Siguiente».'), { role: 'button', inForm: true })).toBe(true);
    expect(isSensitiveStep(s('Elegí una opción.'), { role: 'combobox' })).toBe(true);
  });

  it('deja seguir las de navegación', () => {
    expect(isSensitiveStep(s('Hacé clic en «Horarios».'), { role: 'link' })).toBe(false);
    expect(isSensitiveStep(s('Revisá la página que se abrió.'))).toBe(false);
  });
});
