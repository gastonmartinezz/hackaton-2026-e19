import type { GuideStep, PageOption } from '@hackaton/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateObservation, expectedStep, initialState, isIrreversibleAction, isSensitiveField, isSensitiveStep, transition, type GuideEvent, type GuideState } from './index';

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
/** Elige la opción y recibe de /v1/next-step los pasos reales (el plan de la opción, salvo que se indique otro). */
const started = (optionId: string, steps?: GuideStep[]) => {
  const selected = transition(choosing(), { type: 'SELECT', optionId });
  return transition(selected, { type: 'NEXT', response: { steps: steps ?? selected.option!.steps, done: false } });
};

describe('transition', () => {
  it('muestra las opciones sin duplicados y conserva el objetivo del chat', () => {
    expect(choosing()).toMatchObject({ phase: 'choosing', goal: 'turno', options: [turno, buscar] });
  });

  it('con un pedido propio, la opción que lo hace empieza sola; «Volver un paso» muestra las opciones', () => {
    let state = run({ type: 'ANALYZE', goal: 'turno', request: 'Cambiar mi dirección' });
    expect(state).toMatchObject({ phase: 'analyzing', request: 'Cambiar mi dirección' });
    state = transition(state, { type: 'OPTIONS', options: [buscar, turno], requested: 'buscar' });
    expect(state).toMatchObject({ phase: 'guiding', option: buscar, step: real('el-1'), request: undefined });
    expect(transition(state, { type: 'BACK' })).toMatchObject({ phase: 'choosing', options: [buscar, turno] });
    // Si ninguna opción hace lo pedido, se muestran las de la página y no empieza ninguna sola.
    const unmatched = transition(run({ type: 'ANALYZE', request: 'Pagar una multa' }), { type: 'OPTIONS', options: [buscar, turno] });
    expect(unmatched).toMatchObject({ phase: 'choosing', message: expect.stringMatching(/cómo hacer eso/) });
    expect(unmatched.option).toBeUndefined();
    // Si no era un pedido (pidió repetir, ruido), se dice que no se entendió.
    const unclear = transition(run({ type: 'ANALYZE', request: 'eh' }), { type: 'OPTIONS', options: [buscar, turno], unclear: true });
    expect(unclear).toMatchObject({ phase: 'choosing', message: expect.stringMatching(/No te entendí/) });
    const none = transition(run({ type: 'ANALYZE', request: 'Algo imposible' }), { type: 'OPTIONS', options: [] });
    expect(none).toMatchObject({ phase: 'unsupported', message: expect.stringMatching(/cómo hacer eso/) });
  });

  it('sin opciones, la página no tiene ayuda', () => {
    expect(run({ type: 'ANALYZE' }, { type: 'OPTIONS', options: [] }).phase).toBe('unsupported');
  });

  it('al elegir una opción pide los pasos reales a /v1/next-step con el primer paso del borrador', () => {
    const state = transition(choosing(), { type: 'SELECT', optionId: 'buscar' });
    expect(state).toMatchObject({ phase: 'guiding', step: real('el-1'), plan: [real('el-2')], stepCount: 0, completed: [] });
    expect(expectedStep(state.step!)).toEqual(real('el-1'));
  });

  it('recorre los pasos recibidos y, al terminarlos, informa el avance en vez de darlo por terminado', () => {
    let state = started('buscar');
    expect(state).toMatchObject({ phase: 'waitingForUser', step: real('el-1'), stepCount: 1 });
    state = transition(state, done);
    expect(state).toMatchObject({ phase: 'waitingForUser', step: real('el-2'), stepCount: 2, completed: [real('el-1')] });
    state = transition(state, done);
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-2'), completed: [real('el-1'), real('el-2')] });
    state = transition(transition(state, { type: 'REQUEST_NEXT' }), { type: 'NEXT', response: { steps: [], done: true } });
    expect(state.phase).toBe('completed');
  });

  it('ante un paso teórico extrae la página y pide /v1/next-step con lo completado', () => {
    let state = started('turno');
    state = transition(state, { type: 'SHOWN', elementId: 'el-3' });
    state = transition(state, done);
    expect(state).toMatchObject({ phase: 'verifying', step: theoretical, completed: [real('el-3')] });
    expect(expectedStep(state.step!)).toEqual(theoretical);
    state = transition(state, { type: 'REQUEST_NEXT' });
    expect(state.phase).toBe('guiding');

    state = transition(state, { type: 'NEXT', response: { steps: [real('el-9'), real('el-10')], done: false } });
    expect(state).toMatchObject({ phase: 'waitingForUser', step: real('el-9'), plan: [real('el-10')], completed: [], stepCount: 2 });

    state = transition(transition(state, done), done);
    expect(state).toMatchObject({ phase: 'verifying', completed: [real('el-9'), real('el-10')] });
  });

  it('«Todavía no» después de terminar vuelve a mirar la página desde el último paso', () => {
    let state = started('buscar');
    state = transition(transition(state, done), done);
    state = transition(transition(state, { type: 'REQUEST_NEXT' }), { type: 'NEXT', response: { steps: [], done: true } });
    expect(state).toMatchObject({ phase: 'completed', step: real('el-2') });
    state = transition(state, { type: 'RESUME' });
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-2'), planStale: true });
    expect(transition(initialState, { type: 'RESUME' })).toBe(initialState);
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
    let state = started('buscar');
    state = transition(state, { type: 'OUTCOME', outcome: 'targetStale' });
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-1'), completed: [] });
  });

  it('después de una navegación, los pasos reales que quedaban se vuelven a pedir', () => {
    let state = transition(started('buscar'), { type: 'SHOWN', elementId: 'el-1' });
    state = transition(state, { type: 'NAVIGATED' });
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-2'), planStale: true, completed: [real('el-1')] });
    state = transition(transition(state, { type: 'REQUEST_NEXT' }), { type: 'NEXT', response: { steps: [real('el-5')], done: false } });
    expect(state).toMatchObject({ phase: 'waitingForUser', planStale: false });
  });

  it('un paso que no se llegó a señalar no cuenta como hecho si la página cambia', () => {
    let state = started('buscar');
    state = transition(state, { type: 'NAVIGATED' });
    expect(state).toMatchObject({ phase: 'verifying', step: real('el-1'), completed: [], lastOutcome: 'targetStale' });
  });

  it('sin opción elegida, una navegación reanaliza', () => {
    expect(transition(choosing(), { type: 'NAVIGATED' }).phase).toBe('analyzing');
  });

  it('reintenta según dónde falló y vuelve a las opciones', () => {
    const failedOptions = transition(run({ type: 'ANALYZE' }), { type: 'FAILED', message: 'x' });
    expect(transition(failedOptions, { type: 'RETRY' }).phase).toBe('analyzing');

    const guiding = run({ type: 'ANALYZE' }, { type: 'OPTIONS', options: [turno] }, { type: 'SELECT', optionId: 'turno' });
    const failedNext = transition(guiding, { type: 'FAILED', message: 'x' });
    expect(transition(failedNext, { type: 'RETRY' })).toMatchObject({ phase: 'verifying', step: real('el-3') });
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

  it('en un lugar para escribir o elegir, avanza al terminar (change) y no con el clic para entrar', () => {
    const field = { ...real('el-1', 'userConfirmation'), targetElementId: 'el-1', targetField: true };
    expect(evaluateObservation(field, { kind: 'interaction', elementId: 'el-1', event: 'click' })).toBeNull();
    expect(evaluateObservation(field, { kind: 'interaction', elementId: 'el-1', event: 'input' })).toBeNull();
    expect(evaluateObservation(field, { kind: 'interaction', elementId: 'el-1', event: 'change' })).toBe('signalObserved');
    expect(evaluateObservation(field, { kind: 'interaction', elementId: 'el-2', event: 'change' })).toBeNull();
    // Aunque el backend haya pedido userInteraction, el clic en el campo no alcanza.
    expect(evaluateObservation({ ...field, waitFor: 'userInteraction' }, { kind: 'interaction', elementId: 'el-1', event: 'click' })).toBeNull();
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
    expect(isSensitiveStep(s('Iniciar sesión con tu usuario.'))).toBe(true);
    expect(isSensitiveStep(s('Iniciá sesión.'))).toBe(true);
    expect(isSensitiveStep(s('Inicie sesión para continuar.'))).toBe(true);
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

describe('isSensitiveField', () => {
  it('claves, códigos, tarjeta, datos bancarios y documento son sensibles', () => {
    expect(isSensitiveField({ label: 'Usuario', inputType: 'password' })).toBe(true);
    expect(isSensitiveField({ label: 'Contraseña' })).toBe(true);
    expect(isSensitiveField({ label: 'Cédula de identidad' })).toBe(true);
    expect(isSensitiveField({ label: 'C.I.' })).toBe(true);
    expect(isSensitiveField({ label: 'Número de documento' })).toBe(true);
    expect(isSensitiveField({ label: 'Código de verificación' })).toBe(true);
    expect(isSensitiveField({ label: 'Número de tarjeta' })).toBe(true);
    expect(isSensitiveField({ label: 'CVV' })).toBe(true);
    expect(isSensitiveField({ label: 'Dato', autocomplete: 'cc-number' })).toBe(true);
    expect(isSensitiveField({ label: 'Dato', autocomplete: 'one-time-code' })).toBe(true);
    expect(isSensitiveField({ label: 'Dato', name: 'nroDocumento' })).toBe(true);
    expect(isSensitiveField({ label: 'PIN' })).toBe(true);
    // Abreviaturas y variantes en inglés del código de la tarjeta.
    for (const label of ['Cód. de seguridad', 'Cod seguridad', 'Security code', 'CVN', 'CSC', 'Expiry date', 'Card number'])
      expect(isSensitiveField({ label })).toBe(true);
  });

  it('nombre, correo, teléfono, dirección y fechas se pueden dictar', () => {
    for (const label of ['Nombre completo', 'Correo electrónico', 'Teléfono', 'Dirección', 'Fecha de nacimiento', 'Código postal', 'Departamento', 'Pinar'])
      expect(isSensitiveField({ label, inputType: 'text' })).toBe(false);
  });
});

describe('isIrreversibleAction', () => {
  it('pagar, comprar, transferir, firmar, dar de baja o borrar nunca se tocan por la persona', () => {
    for (const text of ['Hacé clic en «Pagar».', 'Confirmar compra', 'Comprar ahora', 'Transferir', 'Firmar el trámite', 'Dar de baja el servicio', 'Eliminar cuenta', 'Cancelar la suscripción', 'Suscribirme', 'Pay now'])
      expect(isIrreversibleAction(text)).toBe(true);
  });

  it('continuar, seguir, confirmar un paso o abrir una sección sí se pueden tocar', () => {
    for (const text of ['Hacé clic en «Continuar».', 'Siguiente', 'Confirmar turno', 'Aceptar', 'Ir a «Agenda»', 'Buscar', 'Pagina siguiente', 'Página de pagos frecuentes'])
      expect(isIrreversibleAction(text)).toBe(text.includes('pagos'));
  });
});
