import { describe, expect, it } from 'vitest';
import { SILENCE_DEFAULTS, SilenceDetector } from './silence';

/** Mide cada 100 ms entre `from` y `to` con el mismo nivel; devuelve el primer veredicto que no sea `continue`. */
function run(detector: SilenceDetector, level: number, from: number, to: number) {
  for (let t = from; t <= to; t += 100) {
    const verdict = detector.push(level, t);
    if (verdict !== 'continue') return { verdict, at: t };
  }
  return { verdict: 'continue' as const, at: to };
}

describe('SilenceDetector', () => {
  it('corta después de 5 s seguidos sin hablar', () => {
    expect(SILENCE_DEFAULTS.silenceMs).toBe(5_000);
    const detector = new SilenceDetector();
    expect(run(detector, 0.2, 0, 1_000).verdict).toBe('continue');
    expect(run(detector, 0.001, 1_100, 5_900).verdict).toBe('continue');
    expect(detector.push(0.001, 6_000)).toBe('silence');
  });

  it('una pausa de 3 s no corta; volver a hablar reinicia la cuenta', () => {
    const detector = new SilenceDetector();
    detector.push(0.2, 0);
    expect(run(detector, 0.001, 100, 3_000).verdict).toBe('continue');
    expect(detector.push(0.2, 3_100)).toBe('continue');
    expect(run(detector, 0.001, 3_200, 8_000).verdict).toBe('continue');
    expect(detector.push(0.001, 8_100)).toBe('silence');
  });

  it('sin habla desde el principio corta a los 5 s como «no te escuché» (noSpeech)', () => {
    const detector = new SilenceDetector();
    expect(run(detector, 0, 0, 4_900).verdict).toBe('continue');
    expect(detector.push(0, 5_000)).toBe('noSpeech');
    expect(detector.heardVoice).toBe(false);
  });

  it('el ruido de fondo por debajo del umbral cuenta como silencio', () => {
    const detector = new SilenceDetector();
    expect(run(detector, SILENCE_DEFAULTS.threshold / 2, 0, 6_000)).toEqual({ verdict: 'noSpeech', at: 5_000 });
  });

  it('corta antes de los 30 s aunque siga hablando', () => {
    const detector = new SilenceDetector();
    detector.push(0.2, 1_000);
    expect(detector.push(0.2, 1_000 + SILENCE_DEFAULTS.maxMs - 1)).toBe('continue');
    expect(detector.push(0.2, 1_000 + SILENCE_DEFAULTS.maxMs)).toBe('limit');
    expect(SILENCE_DEFAULTS.maxMs).toBeLessThan(30_000);
  });
});
