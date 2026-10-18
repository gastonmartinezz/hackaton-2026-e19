import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPTS } from '../src/modules/ai/prompts.js';

// Reglas de voz y de formularios que venían del PR #14 y siguen vigentes con Guíame v2.2.
describe('prompts', () => {
  it('interpret aplica la voz a lo que ve la persona y deja goal y reason internos', () => {
    for (const prompt of [SYSTEM_PROMPTS.interpret]) {
      expect(prompt).toContain('voseo');
      expect(prompt).toContain('Palabras prohibidas');
      expect(prompt).toContain('sin la dirección');
      expect(prompt).toContain('UNA pregunta simple');
      expect(prompt).toContain('neutros y precisos');
    }
  });

  it('options y nextStep: plantillas de instrucción, formularios campo por campo y sin contradicciones con el dictado ni el clic confirmado', () => {
    for (const prompt of [SYSTEM_PROMPTS.options, SYSTEM_PROMPTS.nextStep]) {
      expect(prompt).toContain('Hacé clic en «{control}».');
      expect(prompt).toContain('Un paso por cada lugar para escribir o elegir');
      expect(prompt).toContain('Si no se sabe cuáles son obligatorios');
      expect(prompt).toContain('campo de texto');
      expect(prompt).not.toContain('nunca pidas que te pasen el dato a vos');
      expect(prompt).not.toContain('que toca la persona, con waitFor');
    }
  });
});
