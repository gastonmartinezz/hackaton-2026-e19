import type { InterpretRequest, InterpretResponse, UserContext } from '@hackaton/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, ApiSession, type ApiClient } from './api/client';
import { interpretMock } from './api/mock';
import { questionExtras } from './api/pending-contract';
import { Chat, UNSURE_ANSWER } from './chat';

type Reply = DistributiveOmit<InterpretResponse, 'sessionId'> | ApiFailure;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function setup(...responses: Reply[]) {
  return setupWith(() => undefined, ...responses);
}

function setupWith(userContext: () => UserContext | undefined, ...responses: Reply[]) {
  const sent: InterpretRequest[] = [];
  const api: ApiClient = {
    isMock: true,
    interpret: vi.fn(async (request: InterpretRequest) => {
      sent.push(structuredClone(request));
      const next = responses.shift()!;
      if (next instanceof ApiFailure) throw next;
      return { ...next, sessionId: request.sessionId ?? `s-${sent.length}` };
    }),
    options: vi.fn(),
    nextStep: vi.fn(),
  };
  const onRedirect = vi.fn();
  const session = new ApiSession();
  const chat = new Chat(api, session, () => {}, onRedirect, userContext);
  return { chat, sent, onRedirect, session };
}

const sites = [
  { title: 'Turnos', url: 'https://turnos.gob.ar/', reason: 'Turnos para el documento.' },
  { title: 'Mi Argentina', url: 'https://mi.argentina.gob.ar/', reason: 'Trámites personales.' },
];

describe('Chat (/v1/interpret)', () => {
  it('question: muestra la pregunta y reenvía todo el historial y la sesión con la respuesta', async () => {
    const { chat, sent, session } = setup(
      { type: 'question', message: '¿En qué país?' },
      { type: 'redirect', message: 'Te llevo.', url: 'https://turnos.gob.ar/' },
    );
    await chat.submit('Quiero renovar mi documento');
    expect(chat.phase).toBe('clarifying');
    expect(chat.messages.map((m) => [m.from, m.text])).toEqual([
      ['user', 'Quiero renovar mi documento'],
      ['assistant', '¿En qué país?'],
    ]);

    expect(sent[0]!.sessionId).toBeUndefined();
    expect(session.id).toBe('s-1');

    await chat.submit('Argentina');
    expect(sent[1]!.sessionId).toBe('s-1');
    expect(sent[1]!.messages).toEqual([
      { role: 'user', content: 'Quiero renovar mi documento' },
      { role: 'assistant', content: '¿En qué país?' },
      { role: 'user', content: 'Argentina' },
    ]);
  });

  it('redirect: abre la URL de la respuesta', async () => {
    const { chat, onRedirect } = setup({ type: 'redirect', message: 'Te llevo al sitio de turnos.', url: 'https://turnos.gob.ar/' });
    await chat.submit('sacar turno para el dni');
    expect(chat.phase).toBe('redirected');
    expect(onRedirect).toHaveBeenCalledWith('https://turnos.gob.ar/');
    expect(chat.goal).toBe('sacar turno para el dni');
  });

  it('options: guarda los sitios para elegir, sin abrir ninguno', async () => {
    const { chat, onRedirect } = setup({ type: 'options', message: 'Encontré estas opciones:', options: sites });
    await chat.submit('trámites del documento');
    expect(chat.phase).toBe('results');
    expect(chat.candidates.map((c) => c.id)).toEqual(['c-0', 'c-1']);
    expect(chat.candidate('c-1')?.url).toBe('https://mi.argentina.gob.ar/');
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it('minimiza datos personales antes de enviarlos, pero los muestra como se escribieron', async () => {
    const { chat, sent } = setup({ type: 'question', message: '¿Algo más?' });
    await chat.submit('mi dni es 30123456 y mi mail marta@correo.com');
    expect(chat.messages[0]!.text).toContain('30123456');
    expect(JSON.stringify(sent)).not.toContain('30123456');
    expect(JSON.stringify(sent)).not.toContain('marta@correo.com');
  });

  it('envía los datos de la persona en cada llamada, también al reintentar por sesión vencida', async () => {
    let user: UserContext = { location: { country: 'AR', city: 'Rosario' } };
    const { chat, sent } = setupWith(
      () => user,
      { type: 'question', message: '¿Qué trámite?' },
      new ApiFailure('SESSION_NOT_FOUND', false),
      { type: 'redirect', message: 'Vamos.', url: 'https://www.rosario.gob.ar/' },
    );
    await chat.submit('pagar la tasa municipal');
    user = { location: { country: 'AR', city: 'Funes' }, ageRange: '65-74' };
    await chat.submit('la del auto');
    expect(sent.map((r) => r.user)).toEqual([{ location: { country: 'AR', city: 'Rosario' } }, user, user]);
  });

  it('sin datos de la persona no envía el campo', async () => {
    const { chat, sent } = setup({ type: 'question', message: '¿Qué?' });
    await chat.submit('algo');
    expect(sent[0]).not.toHaveProperty('user');
  });

  it('muestra un error simple y permite volver a intentar', async () => {
    const { chat } = setup(new ApiFailure('AI_UNAVAILABLE', true), { type: 'question', message: '¿Qué querés hacer?' });
    await chat.submit('hola');
    expect(chat.phase).toBe('error');
    expect(chat.error).toMatch(/no pudo responder/);
    await chat.submit('hola de nuevo');
    expect(chat.phase).toBe('clarifying');
  });

  it('reset borra la conversación y la sesión', async () => {
    const { chat, sent, session } = setup({ type: 'question', message: '¿Qué?' }, { type: 'question', message: '¿Qué?' });
    await chat.submit('algo');
    chat.reset();
    expect(chat.messages).toEqual([]);
    expect(session.id).toBeUndefined();
    await chat.submit('otra cosa');
    expect(sent[1]!.messages).toHaveLength(1);
    expect(sent[1]!.sessionId).toBeUndefined();
  });

  it('si la sesión venció pero otra solicitud ya guardó una vigente, reintenta con esa', async () => {
    const session = new ApiSession();
    session.begin().commit('s-vieja');
    const sent: InterpretRequest[] = [];
    const api: ApiClient = {
      isMock: true,
      interpret: vi.fn(async (request: InterpretRequest) => {
        sent.push(structuredClone(request));
        if (request.sessionId === 's-vieja') {
          // Mientras tanto, la guía renovó la sesión compartida.
          session.reset();
          session.begin().commit('s-guia');
          throw new ApiFailure('SESSION_NOT_FOUND', false);
        }
        return { sessionId: request.sessionId ?? 's-nueva', type: 'question' as const, message: '¿Qué?' };
      }),
      options: vi.fn(),
      nextStep: vi.fn(),
    };
    await new Chat(api, session, () => {}, vi.fn()).submit('turno');
    expect(sent.map((r) => r.sessionId)).toEqual(['s-vieja', 's-guia']);
    expect(session.id).toBe('s-guia');
  });

  it('si la sesión venció, reenvía el historial sin sessionId y guarda la nueva', async () => {
    const { chat, sent, session } = setup(
      { type: 'question', message: '¿Qué?' },
      new ApiFailure('SESSION_NOT_FOUND', false),
      { type: 'redirect', message: 'Vamos.', url: 'https://turnos.gob.ar/' },
    );
    await chat.submit('turno');
    await chat.submit('para el dni');
    expect(chat.phase).toBe('redirected');
    expect(sent.map((r) => r.sessionId)).toEqual([undefined, 's-1', undefined]);
    expect(sent[2]!.messages).toHaveLength(3);
    expect(session.id).toBe('s-3');
  });
});

describe('interpretMock (backend simulado del cliente)', () => {
  const fixtures = [
    { title: 'Biblioteca de prueba — Horarios', url: 'http://127.0.0.1:1/horarios.html', reason: 'Tiene una sección de horarios y contacto.' },
    { title: 'Catálogo de prueba — Buscador', url: 'http://127.0.0.1:1/buscar.html', reason: 'Permite buscar dentro del sitio.' },
    { title: 'Turnos de prueba — Formulario', url: 'http://127.0.0.1:1/formulario.html', reason: 'Tiene un formulario para pedir turno.' },
  ];
  const ask = (...texts: string[]) => interpretMock({ messages: texts.map((content) => ({ role: 'user' as const, content })) }, fixtures);

  it('cubre las tres respuestas', () => {
    expect(ask('hola').type).toBe('question');
    expect(ask('quiero ver los horarios')).toMatchObject({ type: 'redirect', url: 'http://127.0.0.1:1/horarios.html' });
    expect(ask('mostrame opciones')).toMatchObject({ type: 'options' });
  });
});

describe('Chat · respuestas sugeridas (TEMPORAL, campos pendientes del contrato)', () => {
  it('guarda la pregunta con sus respuestas y su motivo, e ignora formas inválidas', () => {
    expect(questionExtras({ answers: ['Cédula', 'Pasaporte'], reason: 'Cada documento va a un sitio distinto.' })).toEqual({
      answers: ['Cédula', 'Pasaporte'],
      reason: 'Cada documento va a un sitio distinto.',
    });
    expect(questionExtras({ answers: ['Una sola'] })).toEqual({ answers: [], reason: null });
    expect(questionExtras({})).toEqual({ answers: [], reason: null });
  });

  it('el mock no insiste después de «No estoy seguro»', () => {
    const sites = [
      { title: 'A', url: 'https://a.example', reason: 'a' },
      { title: 'B', url: 'https://b.example', reason: 'b' },
    ];
    const messages = ['hola', UNSURE_ANSWER].map((content) => ({ role: 'user' as const, content }));
    expect(interpretMock({ messages }, sites).type).toBe('options');
  });
});
