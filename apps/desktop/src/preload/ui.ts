/**
 * Preload de la interfaz propia. Expone solo `command` (validado en el proceso
 * principal contra una unión cerrada), la suscripción al estado, `transcribe`
 * (el dictado; el proceso principal valida el audio) y `speak`/`stopSpeaking`
 * (leer en voz alta). Nunca expone ipcRenderer ni APIs de Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  UI_COMMAND_CHANNEL,
  UI_SPEAK_CHANNEL,
  UI_SPEAK_STOP_CHANNEL,
  UI_SPEECH_CUT_CHANNEL,
  UI_STATE_CHANNEL,
  UI_TRANSCRIBE_CHANNEL,
  type AppState,
  type AsistenteBridge,
  type UiCommand,
} from '../shared/ipc';

const bridge: AsistenteBridge = {
  command: (command: UiCommand) => ipcRenderer.invoke(UI_COMMAND_CHANNEL, command),
  onState(listener) {
    const handler = (_event: IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on(UI_STATE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UI_STATE_CHANNEL, handler);
  },
  transcribe: (wav: ArrayBuffer) => ipcRenderer.invoke(UI_TRANSCRIBE_CHANNEL, wav),
  speak: (text: string) => ipcRenderer.invoke(UI_SPEAK_CHANNEL, text),
  stopSpeaking: () => ipcRenderer.send(UI_SPEAK_STOP_CHANNEL),
  onSpeechCut(listener) {
    const handler = () => listener();
    ipcRenderer.on(UI_SPEECH_CUT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UI_SPEECH_CUT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('asistente', bridge);
