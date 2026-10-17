import { describe, expect, it } from 'vitest';
import { SILENCE_DEFAULTS, SilenceDetector } from './silence';

describe('SilenceDetector', () => {
  it('no corta por silencio si la persona todavía no habló', () => {
    const detector = new SilenceDetector();
    for (let t = 0; t < 10_000; t += 100) expect(detector.push(0, t)).toBe('continue');
    expect(detector.heardVoice).toBe(false);
  });

  it('corta tras 2,5 s de silencio después de hablar', () => {
    const detector = new SilenceDetector();
    expect(detector.push(0.2, 0)).toBe('continue');
    expect(detector.push(0.2, 1_000)).toBe('continue');
    expect(detector.push(0.001, 2_000)).toBe('continue');
    expect(detector.push(0.001, 3_400)).toBe('continue');
    expect(detector.push(0.001, 3_500)).toBe('silence');
  });

  it('una pausa corta no corta', () => {
    const detector = new SilenceDetector();
    detector.push(0.2, 0);
    detector.push(0, 2_000);
    expect(detector.push(0.2, 2_400)).toBe('continue');
    expect(detector.push(0, 4_800)).toBe('continue');
  });

  it('corta antes de los 30 s aunque siga hablando', () => {
    const detector = new SilenceDetector();
    detector.push(0.2, 1_000);
    expect(detector.push(0.2, 1_000 + SILENCE_DEFAULTS.maxMs - 1)).toBe('continue');
    expect(detector.push(0.2, 1_000 + SILENCE_DEFAULTS.maxMs)).toBe('limit');
    expect(SILENCE_DEFAULTS.maxMs).toBeLessThan(30_000);
  });
});
