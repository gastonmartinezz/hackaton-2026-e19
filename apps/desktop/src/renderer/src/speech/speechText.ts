/**
 * Qué se lee en voz alta en cada vista. Solo texto escrito por Guíame: la
 * instrucción, la pregunta, el motivo. Nunca valores de formularios ni citas
 * textuales de la página (la evidencia de «Listo» se omite: puede traer datos
 * personales). Todo se recorta a 600 caracteres sin cortar palabras.
 */
import { joinSpeech } from '../../../shared/speech';
import { UNSURE_ANSWER, type AppState, type CandidateView } from '../../../shared/ipc';

/**
 * TEMPORAL — las pantallas v2.2 no traen «Escuchar» ni textos para leer en voz
 * alta. Provisorios con voseo y las reglas de voz de CLAUDE.md §6; pendientes
 * de aprobación de diseño. Los que repiten un texto visible lo copian tal cual
 * de la pantalla (docs/03).
 */
export const SPEECH_TEXTS = {
  listen: 'Escuchar',
  stop: 'Detener',
  failed: 'No pude leerlo en voz alta. Fue un problema mío, no tuyo.',
  busy: 'Ahora no puedo leerlo en voz alta. Esperá un momento y probá de nuevo.',
  /** No hay ninguna forma de leer en este equipo (se muestra una vez, después el botón no aparece). */
  noVoice: 'En este equipo no hay una voz en español para leer en voz alta.',
  /** Antes de enumerar las respuestas de una pregunta del inicio. */
  choices: 'Podés elegir',
  /** Visibles en la tarjeta o el inicio (se copian para leerlos igual). */
  /** Privacidad al escribir (R10, 08). */
  fieldNote: 'Lo escribís vos. Yo no lo veo ni lo guardo.',
  /** Guíame puede tocar el botón señalado si la persona lo confirma. */
  clickOffer: 'Si querés, lo toco yo.',
  completed: 'Listo.',
  didYouFinish: '¿Pudiste terminar? No vi una confirmación en la página.',
  /** Respuesta de duda (R11): también es lo que se le manda al asistente. */
  unsure: UNSURE_ANSWER,
  optionsTitle: '¿Qué querés hacer acá?',
  /** Visible como «Encontré estas opciones en esta página.»; acá se le suma la lista. */
  optionsLead: 'Encontré estas opciones en esta página',
  /** Título de la recomendación (10). */
  recommendTitle: 'Te recomiendo este sitio',
  /** TEMPORAL: el botón visible «Ver otras opciones», nombrado como una opción más al final de la lista. */
  moreOptions: 'ver otras opciones',
  /** TEMPORAL: las dos acciones del sitio recomendado (los botones visibles). */
  recoActions: 'Podés elegir «Ir con ayuda» o «Solo abrir el sitio»',
  /** Título visible de las alternativas en la recomendación. */
  otherOptions: 'Otras opciones',
} as const;

/** «a, b o c». */
export function listSpeech(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} o ${items.at(-1)}` : (items[0] ?? '');
}

/** Tarjeta flotante: la instrucción actual (06, 08), «Listo» sin la cita (09) o «¿Pudiste terminar?» (16). */
export function guideSpeech(guide: Pick<AppState['guide'], 'phase' | 'instruction' | 'targetField' | 'evidence'> & { offerClick?: boolean }): string {
  switch (guide.phase) {
    case 'waitingForUser':
      return guide.instruction ? joinSpeech(guide.instruction, guide.targetField && SPEECH_TEXTS.fieldNote, guide.offerClick && SPEECH_TEXTS.clickOffer) : '';
    case 'completed':
      // La evidencia es una cita textual de la página: no se manda a leer.
      return guide.evidence ? joinSpeech(SPEECH_TEXTS.completed) : joinSpeech(SPEECH_TEXTS.didYouFinish);
    default:
      return '';
  }
}

/**
 * Modo voz: qué cuenta como una instrucción nueva. Cambia con cada paso (aunque
 * repita el texto, como «Siguiente» en un formulario de varias páginas) y con
 * «Repetir»; no cambia al volver a dibujar el mismo paso.
 */
export function stepSpeechKey(guide: Pick<AppState['guide'], 'stepCount' | 'announceKey' | 'contentKey'>): string {
  return `${guide.contentKey}:${guide.stepCount}:${guide.announceKey}`;
}

/**
 * Modo voz: clave de lectura de las opciones (05). Cambia con cada aparición
 * de la lista de opciones y con cada vuelta de «Ver otras opciones» (`visit`),
 * así volver a las opciones las lee de nuevo y vuelve a escuchar.
 */
export function optionsReadKey(contentKey: AppState['guide']['contentKey'], visit: number): string {
  return `opciones:${contentKey}:${visit}`;
}

/** Tarjeta (05): la pregunta y las opciones de la página; si hay más, «… o ver otras opciones». */
export function optionsSpeech(titles: string[], hasMore = false): string {
  if (titles.length === 0) return '';
  const items = hasMore ? [...titles, SPEECH_TEXTS.moreOptions] : titles;
  return joinSpeech(SPEECH_TEXTS.optionsTitle, `${SPEECH_TEXTS.optionsLead}: ${listSpeech(items)}`);
}

/** Inicio (02, 03): la pregunta, las respuestas sugeridas y el porqué. */
export function questionSpeech(question: { text: string; answers: string[]; reason: string | null }): string {
  return joinSpeech(question.text, `${SPEECH_TEXTS.choices}: ${listSpeech([...question.answers, SPEECH_TEXTS.unsure])}`, question.reason);
}

/**
 * Inicio (10): el título, el sitio recomendado y su motivo (sin la dirección),
 * las dos acciones y, si hay, las otras opciones.
 */
export function recommendationSpeech(intro: string, candidate: Pick<CandidateView, 'title' | 'reason'>, others: string[] = []): string {
  return joinSpeech(
    intro,
    candidate.title,
    candidate.reason,
    SPEECH_TEXTS.recoActions,
    others.length > 0 && `${SPEECH_TEXTS.otherOptions}: ${listSpeech(others)}`,
  );
}
