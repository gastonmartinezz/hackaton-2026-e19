/**
 * Modo voz: con el modo activo, Guíame lee solo lo que escribe apenas
 * aparece. La preferencia se guarda entre sesiones:
 * - `auto` (por defecto): se prende al buscar dictando, para ese recorrido
 *   (hasta volver al Inicio).
 * - `on`: siempre prendido.
 * - `off`: apagado; dictar no lo prende.
 * Tocar el interruptor «Voz» deja la preferencia en `on` u `off`.
 */
import type { UiCommand, VoiceMode } from '../shared/ipc';

/**
 * TEMPORAL — texto del aviso si no se pudo guardar el interruptor «Voz» (no
 * está en las pantallas v2.2). Pendiente de aprobación de diseño.
 */
export const VOICE_MODE_TEXTS = {
  saveFailed: 'No pude cambiar «Voz». Fue un problema mío, no tuyo. Probá de nuevo.',
} as const;

export class VoiceModeState {
  /** En `auto`: la persona buscó dictando en este recorrido. */
  #dictatedThisJourney = false;

  constructor(private mode: VoiceMode) {}

  get preference(): VoiceMode {
    return this.mode;
  }

  get active(): boolean {
    return this.mode === 'on' || (this.mode === 'auto' && this.#dictatedThisJourney);
  }

  /** Una búsqueda dictada con texto. Devuelve true si cambió el estado. */
  dictated(): boolean {
    if (this.mode !== 'auto' || this.#dictatedThisJourney) return false;
    this.#dictatedThisJourney = true;
    return true;
  }

  /** Inicio: termina el recorrido. */
  newJourney(): void {
    this.#dictatedThisJourney = false;
  }

  /** El interruptor «Voz»: queda `on` u `off` para las próximas sesiones. */
  set(mode: 'on' | 'off'): void {
    this.mode = mode;
    this.#dictatedThisJourney = false;
  }
}

export interface VoiceModeEffects {
  /** Guarda la preferencia (preferences.json). */
  save(mode: 'on' | 'off'): Promise<void>;
  /** Corta lo que esté sonando en todas las vistas. */
  stopAll(): void;
  publish(): void;
  /** No se pudo guardar: se avisa en la interfaz (sin culpa) y el interruptor queda como estaba. */
  failed(): void;
}

/**
 * Interruptor «Voz»: primero se guarda y recién después se aplica, se corta
 * el audio (al apagar) y se publica. Si guardar falla, el estado no cambia y
 * se avisa con `failed`. Devuelve si se guardó.
 */
export async function changeVoiceMode(state: VoiceModeState, mode: 'on' | 'off', effects: VoiceModeEffects): Promise<boolean> {
  try {
    await effects.save(mode);
  } catch {
    effects.failed();
    return false;
  }
  state.set(mode);
  if (mode === 'off') effects.stopAll();
  effects.publish();
  return true;
}

/**
 * ¿Es una búsqueda dictada que de verdad se envía? Solo eso prende el modo
 * voz en `auto` (no una transcripción que la vista descartó). Con otra
 * búsqueda en curso (`chatBusy`) el envío se ignora, así que tampoco cuenta.
 */
export function isDictatedSearch(command: UiCommand, chatBusy = false): boolean {
  return !chatBusy && command.type === 'submitIntent' && command.dictated === true && command.text.trim() !== '';
}
