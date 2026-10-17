// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { isRelevantChange, observePage } from './observer';

describe('observePage', () => {
  it('agrupa cambios y distingue los estructurales de los de atributos', async () => {
    document.body.innerHTML = '<div id="spinner" class="a"></div>';
    const onChange = vi.fn();
    const stop = observePage(document, { onChange, onInteraction() {}, onValidationError() {} }, { debounceMs: 10, maxWaitMs: 50 });
    const spinner = document.getElementById('spinner')!;
    spinner.className = 'b';
    spinner.style.opacity = '0.5';
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenLastCalledWith(false);

    document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenLastCalledWith(true);
    stop();
  });
});

describe('isRelevantChange', () => {
  it('sin destino resaltado, solo informa cambios estructurales', () => {
    expect(isRelevantChange(false, null)).toBe(false);
    expect(isRelevantChange(true, null)).toBe(true);
    expect(isRelevantChange(false, true)).toBe(true);
    expect(isRelevantChange(false, false)).toBe(true);
  });
});
