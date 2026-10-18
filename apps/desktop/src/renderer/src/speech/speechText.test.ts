import { describe, expect, it } from 'vitest';
import { clipForSpeech, joinSpeech, SPEAK_MAX_CHARS } from '../../../shared/speech';
import { guideSpeech, optionsSpeech, questionSpeech, recommendationSpeech, SPEECH_TEXTS, stepSpeechKey } from './speechText';

const guide = (over: Partial<Parameters<typeof guideSpeech>[0]>) => ({ phase: 'waitingForUser', instruction: null, targetField: false, evidence: null, ...over });

describe('clipForSpeech', () => {
  it('deja una sola línea sin espacios de más', () => {
    expect(clipForSpeech('  Hacé clic\n en   «Sacar\tturno».​ ')).toBe('Hacé clic en «Sacar turno».');
  });

  it('recorta a 600 caracteres sin cortar palabras', () => {
    const text = Array.from({ length: 200 }, (_, i) => `palabra${i}`).join(' ');
    const clipped = clipForSpeech(text);
    expect(clipped.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
    expect(text.startsWith(clipped)).toBe(true);
    expect(text[clipped.length]).toBe(' ');
  });

  it('un texto justo en el límite no se toca; una palabra sola demasiado larga se corta', () => {
    const exact = `${'a'.repeat(299)} ${'b'.repeat(300)}`;
    expect(clipForSpeech(exact)).toBe(exact);
    expect(clipForSpeech('x'.repeat(700))).toHaveLength(SPEAK_MAX_CHARS);
  });

  it('joinSpeech une frases, agrega el punto y descarta las vacías', () => {
    expect(joinSpeech('Hola', null, '  ', false, '¿Seguimos?')).toBe('Hola. ¿Seguimos?');
  });
});

describe('qué se lee', () => {
  it('la instrucción actual (06)', () => {
    expect(guideSpeech(guide({ instruction: 'Hacé clic en el botón «Sacar turno».' }))).toBe('Hacé clic en el botón «Sacar turno».');
  });

  it('en un campo (08) suma «Esto lo escribís vos…»', () => {
    expect(guideSpeech(guide({ instruction: 'Escribí tu número en «Documento»', targetField: true }))).toBe(
      `Escribí tu número en «Documento». ${SPEECH_TEXTS.fieldNote}`,
    );
  });

  it('«Listo» (09) se lee sin la cita de evidencia de la página', () => {
    const evidence = 'Reserva confirmada para Juan Pérez, CI 1.234.567-8';
    const text = guideSpeech(guide({ phase: 'completed', evidence }));
    expect(text).toBe('Listo.');
    expect(text).not.toContain('Juan');
    expect(text).not.toContain('1.234.567');
  });

  it('sin evidencia (16) lee «¿Pudiste terminar?»', () => {
    expect(guideSpeech(guide({ phase: 'completed' }))).toBe(SPEECH_TEXTS.didYouFinish);
  });

  it('en otras fases no hay nada que leer', () => {
    for (const phase of ['analyzing', 'choosing', 'verifying', 'error', 'idle']) expect(guideSpeech(guide({ phase, instruction: 'x' }))).toBe('');
    expect(guideSpeech(guide({ instruction: null }))).toBe('');
  });

  it('la pregunta del inicio (02) con sus respuestas, «No estoy seguro» y el porqué', () => {
    expect(questionSpeech({ text: '¿Qué documento querés renovar?', answers: ['Cédula', 'Pasaporte'], reason: 'Cada uno se hace en un sitio distinto.' })).toBe(
      '¿Qué documento querés renovar? Podés elegir: Cédula, Pasaporte o No estoy seguro. Cada uno se hace en un sitio distinto.',
    );
    expect(questionSpeech({ text: '¿En qué país?', answers: [], reason: null })).toBe('¿En qué país? Podés elegir: No estoy seguro.');
  });

  it('la recomendación (10): motivo y sitio, sin la dirección', () => {
    const text = recommendationSpeech('Este es el sitio que mejor se ajusta.', { title: 'Agenda de Identificación Civil', reason: 'Ahí se sacan los turnos.' });
    expect(text).toBe(
      'Este es el sitio que mejor se ajusta. Sitio recomendado: Agenda de Identificación Civil. Por qué te lo recomiendo: Ahí se sacan los turnos. Podés elegir «Ir con ayuda» o «Solo abrir el sitio».',
    );
    const withOthers = recommendationSpeech('Mirá.', { title: 'A', reason: 'R.' }, ['Sitio B', 'Sitio C']);
    expect(withOthers.endsWith('Otras opciones: Sitio B o Sitio C.')).toBe(true);
  });

  it('las opciones de la página (05)', () => {
    expect(optionsSpeech(['Completar: Pedir turno', 'Ir a «Confirmar turno»'])).toBe(
      '¿Qué querés hacer acá? Encontré estas opciones en esta página: Completar: Pedir turno o Ir a «Confirmar turno».',
    );
    expect(optionsSpeech([])).toBe('');
  });

  it('si hay opciones secundarias, nombra «ver otras opciones» como una opción más', () => {
    expect(optionsSpeech(['Buscar en este sitio', 'Ir a «Horarios»'], true)).toBe(
      '¿Qué querés hacer acá? Encontré estas opciones en esta página: Buscar en este sitio, Ir a «Horarios» o ver otras opciones.',
    );
  });

  it('modo voz: cada paso nuevo es contenido nuevo aunque repita el texto; «Repetir» también', () => {
    const step = { stepCount: 3, announceKey: 0, contentKey: 7 };
    expect(stepSpeechKey(step)).toBe(stepSpeechKey({ ...step }));
    expect(stepSpeechKey({ ...step, stepCount: 4 })).not.toBe(stepSpeechKey(step));
    expect(stepSpeechKey({ ...step, announceKey: 1 })).not.toBe(stepSpeechKey(step));
    // El mismo número de paso en un recorrido nuevo (otra solicitud) también es contenido nuevo.
    expect(stepSpeechKey({ ...step, contentKey: 12 })).not.toBe(stepSpeechKey(step));
  });

  it('lo que se arma nunca pasa de 600 caracteres', () => {
    const long = 'palabra '.repeat(200);
    expect(guideSpeech(guide({ instruction: long, targetField: true })).length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
    expect(questionSpeech({ text: long, answers: ['a', 'b'], reason: long }).length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
  });
});
