import { useEffect, useState } from 'react';
import type { AppState, UiCommand } from '../../shared/ipc';

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    const unsubscribe = window.asistente.onState(setState);
    void window.asistente.command({ type: 'ready' });
    return unsubscribe;
  }, []);
  // Los tamaños de design/tokens.css dependen de este atributo.
  useEffect(() => {
    if (state) document.documentElement.dataset.textScale = String(state.prefs.textScale);
  }, [state?.prefs.textScale]);
  return state;
}

export function send(command: UiCommand): void {
  void window.asistente.command(command);
}
