import { describe, expect, it } from 'vitest';
import { InterpretRequest, InterpretResponse, OptionsResponse } from '../src/index.js';

describe('InterpretRequest', () => {
  it('exige que el último mensaje sea del usuario', () => {
    const messages = [
      { role: 'user', content: 'Quiero renovar mi documento' },
      { role: 'assistant', content: '¿En qué país?' },
    ];
    expect(InterpretRequest.safeParse({ messages }).success).toBe(false);
    expect(InterpretRequest.safeParse({ messages: [...messages, { role: 'user', content: 'Argentina' }] }).success).toBe(true);
  });
});

describe('InterpretResponse', () => {
  it('acepta redirect con URL https', () => {
    const response = { type: 'redirect', message: 'Te llevo.', url: 'https://www.argentina.gob.ar' };
    expect(InterpretResponse.safeParse(response).success).toBe(true);
  });

  it('rechaza URLs que no son http(s)', () => {
    const response = { type: 'redirect', message: 'Te llevo.', url: 'javascript:alert(1)' };
    expect(InterpretResponse.safeParse(response).success).toBe(false);
  });
});

describe('OptionsResponse', () => {
  it('acepta el ejemplo acordado', () => {
    const response = {
      sessionId: 's-abc',
      options: [{ id: 'search', title: 'Buscar un producto', initialElement: '#search' }],
      guide: {
        goal: 'search',
        step: {
          element: '#search',
          presentation: 'highlight',
          instruction: 'Escribí acá el producto que estás buscando.',
          waitFor: 'userInteraction',
        },
      },
    };
    expect(OptionsResponse.safeParse(response).success).toBe(true);
  });
});
