import type { GuideStep, PageOption } from '@asistente/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateObservation, initialState, transition, validateDecision, validateOptions, type GuideState } from './index';

const ctx = { requestId: 'req-1', navigationId: 'nav-1', revision: 2, elementIds: new Set(['el-1', 'el-2']) };
const corr = { schemaVersion: '1', requestId: 'req-1', navigationId: 'nav-1', revision: 2 } as const;
const option: PageOption = { id: 'o1', title: 'Ver horarios', description: '', evidenceElementIds: ['el-1'] };
const step: GuideStep = {
  ...corr,
  status: 'guide',
  instruction: 'Hacé clic en Horarios.',
  targetElementId: 'el-1',
  presentation: 'highlight',
  expectedSignal: 'pageChange',
};

function run(...events: Parameters<typeof transition>[1][]): GuideState {
  return events.reduce(transition, initialState);
}

describe('validateDecision', () => {
  it('acepta una decisión correlacionada con destino existente', () => {
    expect(validateDecision(step, ctx)).toEqual({ ok: true, value: step });
  });
  it.each([
    [{ ...step, requestId: 'otro' }, 'requestId'],
    [{ ...step, navigationId: 'nav-0' }, 'navigation'],
    [{ ...step, revision: 1 }, 'revision'],
    [{ ...step, targetElementId: 'el-99' }, 'unknownTarget'],
    [{ ...step, presentation: 'click' }, 'schema'],
    [{ ...step, evaluate: 'document.forms[0].submit()' }, 'schema'],
  ])('rechaza respuestas inválidas u obsoletas (%#)', (raw, reason) => {
    expect(validateDecision(raw, ctx)).toEqual({ ok: false, reason });
  });
});

describe('validateOptions', () => {
  it('descarta opciones sin evidencia en el snapshot y duplicadas', () => {
    const result = validateOptions(
      {
        ...corr,
        status: 'options',
        primary: [option, { ...option }, { ...option, id: 'o2', evidenceElementIds: ['el-1', 'el-404'] }],
        secondary: [],
      },
      ctx,
    );
    expect(result).toEqual({ ok: true, value: { status: 'options', primary: [option], secondary: [] } });
  });
  it('rechaza si ninguna opción tiene evidencia', () => {
    const raw = { ...corr, status: 'options', primary: [{ ...option, evidenceElementIds: ['el-9'] }], secondary: [] };
    expect(validateOptions(raw, ctx)).toEqual({ ok: false, reason: 'noEvidence' });
  });
});

describe('transition', () => {
  it('recorre analizar → elegir → guiar → esperar → verificar → guiar', () => {
    let s = run({ type: 'ANALYZE', goal: 'ver horarios' }, { type: 'OPTIONS', primary: [option], secondary: [] });
    expect(s.phase).toBe('choosing');
    s = transition(s, { type: 'SELECT', optionId: 'o1' });
    expect(s.phase).toBe('guiding');
    s = transition(s, { type: 'DECISION', decision: step });
    expect(s).toMatchObject({ phase: 'waitingForUser', stepCount: 1, step });
    s = transition(s, { type: 'OUTCOME', outcome: 'signalObserved' });
    expect(s.phase).toBe('verifying');
    s = transition(s, { type: 'REQUEST_NEXT' });
    expect(s.phase).toBe('guiding');
    s = transition(s, { type: 'DECISION', decision: { ...corr, status: 'completed', message: 'Listo.' } });
    expect(s).toMatchObject({ phase: 'completed', message: 'Listo.', goal: 'ver horarios' });
  });

  it('ignora decisiones que llegan fuera de fase (respuestas tardías)', () => {
    const s = run({ type: 'ANALYZE' }, { type: 'OPTIONS', primary: [option], secondary: [] });
    expect(transition(s, { type: 'DECISION', decision: step })).toBe(s);
  });

  it('una navegación durante la guía conserva el objetivo y pide verificar', () => {
    const s = run(
      { type: 'ANALYZE', goal: 'g' },
      { type: 'OPTIONS', primary: [option], secondary: [] },
      { type: 'SELECT', optionId: 'o1' },
      { type: 'DECISION', decision: step },
      { type: 'NAVIGATED' },
    );
    expect(s).toMatchObject({ phase: 'verifying', lastOutcome: 'signalObserved', option, goal: 'g' });
  });

  it('una navegación sin tarea elegida reanaliza la página', () => {
    const s = run({ type: 'ANALYZE', goal: 'g' }, { type: 'OPTIONS', primary: [option], secondary: [] }, { type: 'NAVIGATED' });
    expect(s).toMatchObject({ phase: 'analyzing', goal: 'g', primary: [] });
  });

  it('error y reintento vuelven al punto correcto', () => {
    let s = run({ type: 'ANALYZE' }, { type: 'FAILED', message: 'Sin conexión' });
    expect(s).toMatchObject({ phase: 'error', retry: 'options' });
    expect(transition(s, { type: 'RETRY' }).phase).toBe('analyzing');
    s = run({ type: 'ANALYZE' }, { type: 'OPTIONS', primary: [option], secondary: [] }, { type: 'SELECT', optionId: 'o1' }, { type: 'FAILED', message: 'x' });
    expect(transition(s, { type: 'RETRY' }).phase).toBe('verifying');
  });

  it('volver regresa a las opciones y salir limpia todo', () => {
    const s = run({ type: 'ANALYZE', goal: 'g' }, { type: 'OPTIONS', primary: [option], secondary: [] }, { type: 'SELECT', optionId: 'o1' }, { type: 'DECISION', decision: step });
    expect(transition(s, { type: 'BACK' })).toMatchObject({ phase: 'choosing', option: undefined, step: undefined });
    expect(transition(s, { type: 'EXIT' })).toEqual(initialState);
  });

  it('un error de validación no se presenta como completado', () => {
    const s = run({ type: 'ANALYZE' }, { type: 'OPTIONS', primary: [option], secondary: [] }, { type: 'SELECT', optionId: 'o1' }, { type: 'DECISION', decision: step }, { type: 'OUTCOME', outcome: 'validationError' });
    expect(s).toMatchObject({ phase: 'verifying', lastOutcome: 'validationError' });
  });
});

describe('evaluateObservation', () => {
  it('un clic no alcanza cuando se espera un cambio de página', () => {
    expect(evaluateObservation(step, { kind: 'interaction', elementId: 'el-1' })).toBeNull();
    expect(evaluateObservation(step, { kind: 'pageChange', targetPresent: true })).toBe('signalObserved');
  });
  it('interacción esperada solo cuenta sobre el destino', () => {
    const s = { ...step, expectedSignal: 'interaction' } as const;
    expect(evaluateObservation(s, { kind: 'interaction', elementId: 'el-2' })).toBeNull();
    expect(evaluateObservation(s, { kind: 'interaction', elementId: 'el-1' })).toBe('signalObserved');
    expect(evaluateObservation(s, { kind: 'pageChange', targetPresent: false })).toBe('targetStale');
  });
  it('errores de validación y confirmaciones se informan siempre', () => {
    expect(evaluateObservation(step, { kind: 'validationError' })).toBe('validationError');
    expect(evaluateObservation(step, { kind: 'userConfirmation' })).toBe('userConfirmed');
  });
});
