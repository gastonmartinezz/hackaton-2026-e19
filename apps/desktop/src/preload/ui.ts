/**
 * Preload de la interfaz propia. Expone solo `command` (validado en el proceso
 * principal contra una unión cerrada), la suscripción al estado, `transcribe`
 * (el dictado; el proceso principal valida el audio) y `speak`/`stopSpeaking`
 * (leer en voz alta). Nunca expone ipcRenderer ni APIs de Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  UI_COMMAND_CHANNEL,
  UI_SPEAK_AUDIO_CHANNEL,
  UI_SPEAK_CHANNEL,
  UI_SPEAK_STOP_CHANNEL,
  UI_SPEECH_CUT_CHANNEL,
  UI_SPEECH_DIAGNOSTIC_CHANNEL,
  UI_STATE_CHANNEL,
  UI_TRANSCRIBE_CHANNEL,
  type AppState,
  type AsistenteBridge,
  type SpeechAudioEvent,
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
  async speak(text, onAudio) {
    // La vista se suscribe a sus pedazos antes de pedir la lectura: no se pierde ninguno.
    const id = crypto.randomUUID().replace(/-/g, '');
    const handler = (_event: IpcRendererEvent, message: SpeechAudioEvent & { id: string }) => {
      if (message.id !== id) return;
      const { id: _id, ...audio } = message;
      if (audio.type !== 'chunk') ipcRenderer.removeListener(UI_SPEAK_AUDIO_CHANNEL, handler);
      onAudio(audio);
    };
    ipcRenderer.on(UI_SPEAK_AUDIO_CHANNEL, handler);
    const result = await ipcRenderer.invoke(UI_SPEAK_CHANNEL, { id, text });
    if (result?.status !== 'ok') ipcRenderer.removeListener(UI_SPEAK_AUDIO_CHANNEL, handler);
    return result;
  },
  stopSpeaking: () => ipcRenderer.send(UI_SPEAK_STOP_CHANNEL),
  onSpeechCut(listener) {
    const handler = () => listener();
    ipcRenderer.on(UI_SPEECH_CUT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UI_SPEECH_CUT_CHANNEL, handler);
  },
  speechDiagnostic: (data) => ipcRenderer.send(UI_SPEECH_DIAGNOSTIC_CHANNEL, data),
};

contextBridge.exposeInMainWorld('asistente', bridge);
