import { describe, expect, it } from 'vitest';
import { SILENCE_DEFAULTS, SilenceDetector } from './silence';

/** Ruido de fondo de un micrófono real: fluctúa entre `low` y `high` (determinista). */
const noise = (t: number, low: number, high: number) => low + (high - low) * ((Math.sin(t / 137) + 1) / 2);

/** Mide cada 100 ms con `level(t)`; devuelve el primer veredicto que no sea `continue`. */
function run(detector: SilenceDetector, level: (t: number) => number, from: number, to: number) {
  for (let t = from; t <= to; t += 100) {
    const verdict = detector.push(level(t), t);
    if (verdict !== 'continue') return { verdict, at: t };
  }
  return { verdict: 'continue' as const, at: to };
}

describe('SilenceDetector (umbral adaptativo)', () => {
  it('con ruido de fondo alto (0,02–0,06, antes nunca cortaba) corta 5 s después de dejar de hablar', () => {
    const detector = new SilenceDetector();
    const room = (t: number) => noise(t, 0.02, 0.06);
    expect(run(detector, room, 0, 900).verdict).toBe('continue');
    expect(run(detector, () => 0.3, 1_000, 3_000).verdict).toBe('continue'); // habla 2 s
    const result = run(detector, room, 3_100, 12_000);
    expect(result.verdict).toBe('silence');
    expect(result.at).toBeGreaterThanOrEqual(3_000 + 5_000);
    expect(result.at).toBeLessThanOrEqual(3_000 + 5_400);
    // Piso calibrado por debajo del umbral, y el umbral por encima del ruido.
    expect(detector.stats.floor).toBeLessThan(0.06);
    expect(detector.stats.threshold).toBeGreaterThan(0.06);
    expect(detector.stats.peak).toBeGreaterThan(0.2);
  });

  it('con ruido alto y sin hablar: «no te escuché» (noSpeech) a los 5 s', () => {
    const detector = new SilenceDetector();
    const result = run(detector, (t) => noise(t, 0.02, 0.06), 0, 8_000);
    expect(result).toEqual({ verdict: 'noSpeech', at: 5_000 });
  });

  it('en una sala silenciosa detecta una voz baja', () => {
    const detector = new SilenceDetector();
    run(detector, () => 0.001, 0, 400);
    expect(run(detector, () => 0.05, 500, 2_000).verdict).toBe('continue');
    expect(detector.heardVoice).toBe(true);
    expect(run(detector, () => 0.001, 2_100, 8_000).verdict).toBe('silence');
  });

  it('una pausa de 3 s no corta; volver a hablar reinicia la cuenta', () => {
    const detector = new SilenceDetector();
    const room = (t: number) => noise(t, 0.02, 0.06);
    run(detector, room, 0, 400);
    run(detector, () => 0.3, 500, 1_500);
    expect(run(detector, room, 1_600, 4_500).verdict).toBe('continue');
    expect(run(detector, () => 0.3, 4_600, 5_500).verdict).toBe('continue');
    expect(run(detector, room, 5_600, 10_000).verdict).toBe('continue');
    expect(run(detector, room, 10_100, 11_000).verdict).toBe('silence');
  });

  it('corta antes de los 30 s aunque siga hablando', () => {
    const detector = new SilenceDetector();
    run(detector, () => 0.01, 0, 400);
    expect(run(detector, (t) => noise(t, 0.2, 0.4), 500, SILENCE_DEFAULTS.maxMs - 100).verdict).toBe('continue');
    expect(detector.push(0.3, SILENCE_DEFAULTS.maxMs)).toBe('limit');
    expect(SILENCE_DEFAULTS.maxMs).toBeLessThan(30_000);
  });
});
