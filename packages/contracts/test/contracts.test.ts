import { describe, expect, it } from 'vitest';
import {
  InterpretRequest,
  InterpretResponse,
  NextStepResponse,
  OptionsResponse,
  SPEAK_MAX_CHARS,
  SpeakRequest,
  TRANSCRIBE_MAX_BYTES,
  TranscribeResponse,
} from '../src/index.js';

describe('InterpretRequest', () => {
  it('exige que el último mensaje sea del usuario', () => {
    const messages = [
      { role: 'user', content: 'Quiero renovar la cédula' },
      { role: 'assistant', content: '¿En qué país?' },
    ];
    expect(InterpretRequest.safeParse({ messages }).success).toBe(false);
    expect(InterpretRequest.safeParse({ messages: [...messages, { role: 'user', content: 'Uruguay' }] }).success).toBe(true);
  });
});

describe('InterpretRequest.user', () => {
  const messages = [{ role: 'user', content: 'Quiero sacar un turno' }];

  it('acepta localidad, rango de edad, idioma y zona horaria', () => {
    const user = {
      location: { country: 'UY', region: 'Montevideo', city: 'Montevideo' },
      ageRange: '75-plus',
      language: 'es-UY',
      timeZone: 'America/Montevideo',
    };
    expect(InterpretRequest.safeParse({ messages, user }).success).toBe(true);
    expect(InterpretRequest.safeParse({ messages, user: {} }).success).toBe(true);
  });

  it.each([
    ['país que no es ISO', { location: { country: 'Uruguay' } }],
    ['edad exacta', { age: 70 }],
    ['rango inexistente', { ageRange: '70' }],
    ['campo desconocido', { location: { address: 'Calle 1' } }],
    ['zona horaria inválida', { timeZone: '../etc' }],
  ])('rechaza %s', (_, user) => {
    expect(InterpretRequest.safeParse({ messages, user }).success).toBe(false);
  });
});

describe('InterpretResponse', () => {
  it('acepta redirect con URL https', () => {
    const response = { sessionId: 's-abc', type: 'redirect', message: 'Te llevo.', url: 'https://www.gub.uy' };
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

describe('TranscribeResponse', () => {
  it('acepta texto vacío y rechaza campos de más o texto demasiado largo', () => {
    expect(TranscribeResponse.safeParse({ text: '' }).success).toBe(true);
    expect(TranscribeResponse.safeParse({ text: 'quiero renovar la cédula' }).success).toBe(true);
    expect(TranscribeResponse.safeParse({ text: 'hola', extra: 1 }).success).toBe(false);
    expect(TranscribeResponse.safeParse({ text: 'a'.repeat(1001) }).success).toBe(false);
  });

  it('fija el tope de bytes en 30 s de PCM de 16 bits mono a 16 kHz', () => {
    expect(TRANSCRIBE_MAX_BYTES).toBe(960_044);
  });
});

describe('SpeakRequest', () => {
  it('recorta el texto y exige entre 1 y SPEAK_MAX_CHARS caracteres', () => {
    expect(SpeakRequest.parse({ text: '  Tocá «Iniciar trámite».  ' })).toEqual({ text: 'Tocá «Iniciar trámite».' });
    expect(SpeakRequest.safeParse({ text: '   ' }).success).toBe(false);
    expect(SpeakRequest.safeParse({ text: 'a'.repeat(SPEAK_MAX_CHARS) }).success).toBe(true);
    expect(SpeakRequest.safeParse({ text: 'a'.repeat(SPEAK_MAX_CHARS + 1) }).success).toBe(false);
  });

  it('rechaza campos de más', () => {
    expect(SpeakRequest.safeParse({ text: 'Hola', voice: 'marin' }).success).toBe(false);
  });
});
