/**
 * Preload de la interfaz propia. Expone solo `command` (validado en el proceso
 * principal contra una unión cerrada) y la suscripción al estado. Nunca expone
 * ipcRenderer ni APIs de Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { UI_COMMAND_CHANNEL, UI_STATE_CHANNEL, type AppState, type AsistenteBridge, type UiCommand } from '../shared/ipc';

const bridge: AsistenteBridge = {
  command: (command: UiCommand) => ipcRenderer.invoke(UI_COMMAND_CHANNEL, command),
  onState(listener) {
    const handler = (_event: IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on(UI_STATE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UI_STATE_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('asistente', bridge);
