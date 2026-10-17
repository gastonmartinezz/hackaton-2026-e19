import { describe, expect, it } from 'vitest';
import { InterpretRequest, InterpretResponse, NextStepResponse, OptionsResponse } from '../src/index.js';

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
    const response = { sessionId: 's-abc', type: 'redirect', message: 'Te llevo.', url: 'https://www.argentina.gob.ar' };
    expect(InterpretResponse.safeParse(response).success).toBe(true);
  });

  it('rechaza URLs que no son http(s)', () => {
    const response = { sessionId: 's-abc', type: 'redirect', message: 'Te llevo.', url: 'javascript:alert(1)' };
    expect(InterpretResponse.safeParse(response).success).toBe(false);
  });
});

const step = (element: string | null) => ({
  element,
  instruction: 'Hacé clic en Turnos.',
  presentation: 'highlight',
  waitFor: 'userInteraction',
});

describe('OptionsResponse', () => {
  it('acepta opciones con pasos reales y teóricos', () => {
    const response = {
      sessionId: 's-abc',
      options: [{ id: 'turno', title: 'Sacar un turno', steps: [step('#el-3'), step(null)] }],
    };
    expect(OptionsResponse.safeParse(response).success).toBe(true);
  });

  it('exige al menos un paso por opción', () => {
    const response = { sessionId: 's-abc', options: [{ id: 'turno', title: 'Sacar un turno', steps: [] }] };
    expect(OptionsResponse.safeParse(response).success).toBe(false);
  });
});

describe('NextStepResponse', () => {
  it('acepta done sin pasos', () => {
    expect(NextStepResponse.safeParse({ sessionId: 's-abc', steps: [], done: true }).success).toBe(true);
  });
});
