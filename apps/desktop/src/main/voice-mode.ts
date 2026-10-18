/**
 * Modo voz: con el modo activo, Mostrame lee solo lo que escribe apenas
 * aparece. La preferencia se guarda entre sesiones:
 * - `auto` (por defecto): se prende al buscar dictando, para ese recorrido
 *   (hasta volver al Inicio).
 * - `on`: siempre prendido.
 * - `off`: apagado; dictar no lo prende.
 * Tocar el interruptor «Voz» deja la preferencia en `on` u `off`.
 */
import type { VoiceMode } from '../shared/ipc';

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
