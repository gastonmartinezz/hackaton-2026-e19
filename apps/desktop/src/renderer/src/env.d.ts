import type { AsistenteBridge } from '../../shared/ipc';

declare global {
  interface Window {
    asistente: AsistenteBridge;
  }
}
