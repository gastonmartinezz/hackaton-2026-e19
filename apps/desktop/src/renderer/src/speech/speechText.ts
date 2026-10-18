/**
 * Qué se lee en voz alta en cada vista. Solo texto escrito por Mostrame: la
 * instrucción, la pregunta, el motivo. Nunca valores de formularios ni citas
 * textuales de la página (la evidencia de «Listo» se omite: puede traer datos
 * personales). Todo se recorta a 600 caracteres sin cortar palabras.
 */
import { joinSpeech } from '../../../shared/speech';
import type { AppState, CandidateView } from '../../../shared/ipc';

/**
 * TEMPORAL — design/textos.es.json no trae textos para leer en voz alta.
 * Provisorios con voseo y las reglas de voz de CLAUDE.md §6; pendientes de
 * aprobación de diseño. Los que repiten un texto visible lo copian tal cual.
 */
export const SPEECH_TEXTS = {
  listen: 'Escuchar',
  stop: 'Detener',
  failed: 'No pude leerlo en voz alta. Fue un problema de mi lado, no tuyo.',
  busy: 'Ahora no puedo leerlo en voz alta. Esperá un momento y probá de nuevo.',
  /** No hay ninguna forma de leer en este equipo (se muestra una vez, después el botón no aparece). */
  noVoice: 'En este equipo no hay una voz en español para leer en voz alta.',
  /** Antes de enumerar las respuestas de una pregunta del inicio. */
  choices: 'Podés elegir',
  /** Visibles en la tarjeta o el inicio (se copian para leerlos igual). */
  fieldNote: 'Esto lo escribís vos. Mostrame no lo ve ni lo guarda.',
  completed: 'Listo.',
  didYouFinish: '¿Pudiste terminar? La página cambió, pero no sé si terminaste. Fijate si la página lo confirma.',
  unsure: 'No estoy seguro',
  recommended: 'Sitio recomendado',
  why: 'Por qué te lo recomiendo',
} as const;

/** Tarjeta flotante: la instrucción actual (06, 08), «Listo» sin la cita (09) o «¿Pudiste terminar?» (16). */
export function guideSpeech(guide: Pick<AppState['guide'], 'phase' | 'instruction' | 'targetField' | 'evidence'>): string {
  switch (guide.phase) {
    case 'waitingForUser':
      return guide.instruction ? joinSpeech(guide.instruction, guide.targetField && SPEECH_TEXTS.fieldNote) : '';
    case 'completed':
      // La evidencia es una cita textual de la página: no se manda a leer.
      return guide.evidence ? joinSpeech(SPEECH_TEXTS.completed) : joinSpeech(SPEECH_TEXTS.didYouFinish);
    default:
      return '';
  }
}

/** Inicio (02, 03): la pregunta, las respuestas sugeridas y el porqué. */
export function questionSpeech(question: { text: string; answers: string[]; reason: string | null }): string {
  const options = [...question.answers, SPEECH_TEXTS.unsure];
  const list = options.length > 1 ? `${options.slice(0, -1).join(', ')} o ${options.at(-1)}` : options[0];
  return joinSpeech(question.text, `${SPEECH_TEXTS.choices}: ${list}`, question.reason);
}

/** Inicio (10): por qué, el sitio recomendado y su motivo (sin la dirección). */
export function recommendationSpeech(intro: string, candidate: Pick<CandidateView, 'title' | 'reason'>): string {
  return joinSpeech(intro, `${SPEECH_TEXTS.recommended}: ${candidate.title}`, `${SPEECH_TEXTS.why}: ${candidate.reason}`);
}
