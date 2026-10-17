import type { InterpretRequest, InterpretResponse } from '@hackaton/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, type ApiClient } from './api/client';
import { interpretMock } from './api/mock';
import { Chat } from './chat';

function setup(...responses: Array<InterpretResponse | ApiFailure>) {
  const sent: InterpretRequest[] = [];
  const api: ApiClient = {
    isMock: true,
    interpret: vi.fn(async (request: InterpretRequest) => {
      sent.push(structuredClone(request));
      const next = responses.shift()!;
      if (next instanceof ApiFailure) throw next;
      return next;
    }),
    options: vi.fn(),
  };
  const onRedirect = vi.fn();
  const chat = new Chat(api, () => {}, onRedirect);
  return { chat, sent, onRedirect };
}

const sites = [
  { title: 'Turnos', url: 'https://turnos.gob.ar/', reason: 'Turnos para el documento.' },
  { title: 'Mi Argentina', url: 'https://mi.argentina.gob.ar/', reason: 'Trámites personales.' },
];

describe('Chat (/v1/interpret)', () => {
  it('question: muestra la pregunta y reenvía todo el historial con la respuesta', async () => {
    const { chat, sent } = setup(
      { type: 'question', message: '¿En qué país?' },
      { type: 'redirect', message: 'Te llevo.', url: 'https://turnos.gob.ar/' },
    );
    await chat.submit('Quiero renovar mi documento');
    expect(chat.phase).toBe('clarifying');
    expect(chat.messages.map((m) => [m.from, m.text])).toEqual([
      ['user', 'Quiero renovar mi documento'],
      ['assistant', '¿En qué país?'],
    ]);

    await chat.submit('Argentina');
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

  it('muestra un error simple y permite volver a intentar', async () => {
    const { chat } = setup(new ApiFailure('AI_UNAVAILABLE', true), { type: 'question', message: '¿Qué querés hacer?' });
    await chat.submit('hola');
    expect(chat.phase).toBe('error');
    expect(chat.error).toMatch(/no pudo responder/);
    await chat.submit('hola de nuevo');
    expect(chat.phase).toBe('clarifying');
  });

  it('reset borra la conversación', async () => {
    const { chat, sent } = setup({ type: 'question', message: '¿Qué?' }, { type: 'question', message: '¿Qué?' });
    await chat.submit('algo');
    chat.reset();
    expect(chat.messages).toEqual([]);
    await chat.submit('otra cosa');
    expect(sent[1]!.messages).toHaveLength(1);
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
