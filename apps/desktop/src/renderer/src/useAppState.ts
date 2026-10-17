import { useEffect, useState } from 'react';
import type { AppState, UiCommand } from '../../shared/ipc';

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    const unsubscribe = window.asistente.onState(setState);
    void window.asistente.command({ type: 'ready' });
    return unsubscribe;
  }, []);
  return state;
}

export function send(command: UiCommand): void {
  void window.asistente.command(command);
}
