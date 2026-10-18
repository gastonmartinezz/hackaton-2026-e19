/**
 * Contrato IPC interno de la app de escritorio (no es contrato con el backend).
 * Interfaz propia ↔ proceso principal, y página externa (preload aislado) ↔
 * proceso principal. Todo mensaje entrante se valida acá con Zod.
 */
import { PageSnapshotSchema } from '@asistente/page-analyzer';
import { AgeRange, CountryCode } from '@hackaton/contracts';
import { z } from 'zod';

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** Respuesta fija del botón «No sé bien» (R11): el backend no insiste y recomienda. */
export const UNSURE_ANSWER = 'No sé bien';

/** Tamaño de letra de Guíame (@asistente/ui/tokens.css): 1.2 es la base del producto. */
export const TEXT_SCALES = [1.2, 1.45, 1.75] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
export const DEFAULT_TEXT_SCALE: TextScale = 1.2;

/** Modo voz guardado: `auto` se prende al dictar, `on` siempre, `off` nunca (ver main/voice-mode.ts). */
export const VOICE_MODES = ['auto', 'on', 'off'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

/** Cambiarla cuando cambie el texto de las condiciones: se vuelven a pedir. */
export const TERMS_VERSION = '2026-10-17';

/* ---------------------------- Interfaz propia ---------------------------- */

export const UI_COMMAND_CHANNEL = 'ui:command';
export const UI_STATE_CHANNEL = 'ui:state';
/** Dictado del buscador: WAV (shared/wav.ts) → texto para revisar. Solo desde la ventana. */
export const UI_TRANSCRIBE_CHANNEL = 'ui:transcribe';

/**
 * Resultado del dictado. `empty`: no se entendió nada; `busy`: el servidor pide
 * esperar (RATE_LIMITED o AI_UNAVAILABLE con `retryable: true`); `off`: el
 * servidor tiene la voz apagada (AI_UNAVAILABLE con `retryable: false`), no
 * se vuelve a ofrecer en esta ejecución; `failed`: cualquier otro problema
 * (la interfaz lo dice sin culpa).
 */
export type TranscribeErrorReason = 'busy' | 'off' | 'failed';
export type TranscribeResult = { status: 'ok'; text: string } | { status: 'empty' } | { status: 'error'; reason: TranscribeErrorReason };

/** Leer en voz alta: texto de Guíame → MP3. Desde la ventana o la tarjeta. */
export const UI_SPEAK_CHANNEL = 'ui:speak';
/** «Detener»: corta la descarga en curso (la reproducción la corta la interfaz). */
export const UI_SPEAK_STOP_CHANNEL = 'ui:speak-stop';
/**
 * Diagnóstico de la voz del sistema (respaldo): solo datos sin contenido, para
 * el log técnico del proceso principal.
 */
export const UI_SPEECH_DIAGNOSTIC_CHANNEL = 'ui:speech-diagnostic';
export const SpeechDiagnosticSchema = z.strictObject({
  voices: z.number().int().min(0).max(10_000),
  spanishVoices: z.number().int().min(0).max(10_000),
  waitMs: z.number().int().min(0).max(120_000),
  /** `lang` de la voz elegida (por ejemplo es-MX), o null. */
  chosenLang: z.string().regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/).max(20).nullable(),
  outcome: z.enum(['ok', 'noVoices', 'noSpanishVoice']),
  /** Eventos de la lectura: start, end, error (con su tipo). */
  event: z.enum(['none', 'start', 'end', 'error']),
  errorType: z.string().regex(/^[a-z-]{1,40}$/).nullable(),
});
export type SpeechDiagnostic = z.infer<typeof SpeechDiagnosticSchema>;

/** Del proceso principal a las vistas: otra vista empezó a leer o se detuvo todo; cortar lo que suena. */
export const UI_SPEECH_CUT_CHANNEL = 'ui:speech-cut';
/**
 * `busy`: el servidor pide esperar; `off`: voz apagada en el servidor (la
 * interfaz usa la voz del sistema); `stopped`: se cortó a pedido; `failed`:
 * cualquier otro problema.
 */
export type SpeakErrorReason = 'busy' | 'off' | 'stopped' | 'failed';
/** `ok`: el servidor aceptó y el audio empieza a llegar por UI_SPEAK_AUDIO_CHANNEL. */
export type SpeakResult = { status: 'ok' } | { status: 'error'; reason: SpeakErrorReason };
/** Del proceso principal a la vista que pidió la lectura: el MP3 en pedazos, en orden. */
export const UI_SPEAK_AUDIO_CHANNEL = 'ui:speak-audio';
export type SpeechAudioEvent = { type: 'chunk'; chunk: Uint8Array } | { type: 'end' } | { type: 'error'; reason: 'stopped' | 'failed' };
/** Pedido de lectura: `id` lo elige la vista para reconocer sus pedazos. */
export const SpeakRequestSchema = z.strictObject({ id: Id, text: z.string().min(1).max(2_000) });

export const UiCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  /** `guide: false`: se abre el destino sin la guía (una dirección escrita, directo). El inicio v2.2 solo tiene «Guíame» (con guía). */
  /** `dictated`: la búsqueda salió del dictado (prende el modo voz si la preferencia es `auto`). */
  z.strictObject({ type: z.literal('submitIntent'), text: z.string().trim().min(1).max(500), guide: z.boolean().optional(), dictated: z.literal(true).optional() }),
  z.strictObject({ type: z.literal('openCandidate'), candidateId: Id, guide: z.boolean().optional() }),
  z.strictObject({ type: z.literal('resetChat') }),
  z.strictObject({ type: z.literal('navigate'), input: z.string().trim().min(1).max(2048) }),
  /** Buscador de la barra: una dirección abre el sitio; cualquier otro texto vuelve al inicio con esa búsqueda. */
  z.strictObject({ type: z.literal('search'), text: z.string().trim().min(1).max(500) }),
  z.strictObject({ type: z.literal('back') }),
  z.strictObject({ type: z.literal('forward') }),
  z.strictObject({ type: z.literal('reload') }),
  z.strictObject({ type: z.literal('home') }),
  z.strictObject({ type: z.literal('analyzePage') }),
  z.strictObject({ type: z.literal('selectOption'), optionId: Id }),
  z.strictObject({ type: z.literal('repeat') }),
  z.strictObject({ type: z.literal('stepBack') }),
  z.strictObject({ type: z.literal('exitHelp') }),
  z.strictObject({ type: z.literal('confirmDone') }),
  /** «Todavía no» → «Creo que me falta un paso» (17): se vuelve a mirar la página. */
  z.strictObject({ type: z.literal('resumeGuide') }),
  /** Termina la ayuda sin el aviso «Saliste de la ayuda» (tarea terminada). */
  z.strictObject({ type: z.literal('finishHelp') }),
  z.strictObject({ type: z.literal('retry') }),
  z.strictObject({ type: z.literal('setTextScale'), scale: z.union(TEXT_SCALES.map((s) => z.literal(s))) }),
  /** Interruptor «Voz» de la barra: deja la preferencia en `on` u `off`. */
  z.strictObject({ type: z.literal('setVoiceMode'), mode: z.enum(['on', 'off']) }),
  z.strictObject({ type: z.literal('setAiForSite'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('resolveNotice'), noticeId: Id, action: z.enum(['openHere', 'openExternal', 'dismiss']) }),
  z.strictObject({ type: z.literal('openCurrentExternally') }),
  /** «¿No está lo que buscás?» (pantalla 11): se vuelve a mirar la página con ese pedido. */
  z.strictObject({ type: z.literal('askOnPage'), text: z.string().trim().min(1).max(500) }),
  /** Solo desde la tarjeta flotante: qué muestra y cuánto mide. */
  z.strictObject({ type: z.literal('cardLayout'), mode: z.enum(['none', 'card', 'pill', 'toast']), height: z.number().int().min(0).max(5000) }),
  /** Pantalla inicial: guardar los datos exige aceptar las condiciones. */
  z.strictObject({
    type: z.literal('saveProfile'),
    acceptTerms: z.literal(true),
    country: CountryCode.nullable(),
    region: z.string().trim().max(80),
    city: z.string().trim().max(80),
    ageRange: AgeRange.nullable(),
  }),
]);
export type UiCommand = z.infer<typeof UiCommandSchema>;

export type NoticeAction = 'openHere' | 'openExternal' | 'dismiss';

/** Qué muestra la tarjeta flotante: nada, la tarjeta, la barra achicada (12) o el aviso al salir (21). */
export type CardMode = 'none' | 'card' | 'pill' | 'toast';

export interface CardLayout {
  /** `compact`: la tarjeta taparía el control resaltado arriba y abajo; se achica. */
  placement: 'top' | 'bottom' | 'compact';
  /** Alto máximo de la tarjeta en px; el cuerpo se desplaza si no entra. */
  maxHeight: number;
}

export interface Notice {
  id: string;
  tone: 'info' | 'error';
  text: string;
  actions: NoticeAction[];
}

export interface CandidateView {
  id: string;
  title: string;
  domain: string;
  reason: string;
  secure: boolean;
}

export interface ChatMessage {
  id: string;
  from: 'user' | 'assistant';
  text: string;
}

/** clarifying: `question`; results: `options`; redirected: `redirect` (se abrió el sitio). */
export type ChatPhase = 'idle' | 'interpreting' | 'clarifying' | 'results' | 'redirected' | 'error';

export interface OptionView {
  id: string;
  title: string;
  description: string;
}

export interface AppState {
  mockBackend: boolean;
  /** Opciones y guía dentro de la página. */
  guideEnabled: boolean;
  layout: { topBarHeight: number; card: CardLayout };
  prefs: { textScale: number; aiEnabledForSite: boolean; voiceMode: VoiceMode };
  /** Modo voz activo ahora: Guíame lee solo lo que escribe apenas aparece. */
  voice: { active: boolean };
  /** Datos de la pantalla inicial. Sin condiciones aceptadas, la app muestra esa pantalla. */
  profile: {
    termsAccepted: boolean;
    country: string | null;
    /** País de la configuración del sistema, para proponerlo la primera vez. */
    suggestedCountry: string | null;
    region: string;
    city: string;
    ageRange: AgeRange | null;
  };
  nav: {
    visible: boolean;
    url: string;
    domain: string;
    secure: boolean;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    error: string | null;
  };
  chat: {
    phase: ChatPhase;
    messages: ChatMessage[];
    /** Lo que la persona buscó primero, tal como lo escribió (queda en el buscador). */
    query: string | null;
    /** Respuestas que ya dio a las preguntas (píldoras de «lo que ya me contaste»). */
    answered: string[];
    /** Pregunta pendiente con respuestas sugeridas, si el backend las mandó. */
    question: { text: string; answers: string[]; reason: string | null } | null;
    /** La última respuesta fue «No sé bien»: los sitios son una recomendación. */
    unsure: boolean;
    goal: string | null;
    candidates: CandidateView[];
    error: string | null;
  };
  guide: {
    phase: string;
    goal: string | null;
    primary: OptionView[];
    secondary: OptionView[];
    option: OptionView | null;
    instruction: string | null;
    /** Cambia cada vez que la instrucción debe volver a anunciarse (Repetir). */
    announceKey: number;
    /** Cambia con cada solicitud nueva del asistente: el modo voz lee una vez por aparición, no por texto. */
    contentKey: number;
    stepCount: number;
    message: string | null;
    targetVisible: boolean | null;
    /** El control señalado es un campo: la persona escribe ahí (08). */
    targetField: boolean;
    /** Cómo avanza el paso actual: `userConfirmation` pide «Listo, ya lo escribí». */
    waitFor: 'userInteraction' | 'navigation' | 'userConfirmation' | null;
    /** «Ya hiciste»: solo pasos pasados, en pasado. Nunca valores. */
    done: string[];
    /** Texto visible de la página que prueba que terminó (09). Sin él no se dice «Listo». */
    evidence: string | null;
    /** La persona salió de la ayuda en esta página (21). */
    exited: boolean;
    partialPage: boolean;
  };
  notices: Notice[];
}

/** API expuesta a la interfaz propia por el preload. Métodos específicos, sin ipcRenderer. */
export interface AsistenteBridge {
  command(command: UiCommand): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
  /** Pasa a texto un WAV PCM16 mono de 16 kHz. Nunca envía la búsqueda. */
  transcribe(wav: ArrayBuffer): Promise<TranscribeResult>;
  /** Lee en voz alta un texto de Guíame (nunca datos de la página). Devuelve el MP3. */
  /**
   * Lee en voz alta un texto de Guíame (nunca datos de la página). Los
   * pedazos del MP3 llegan a `onAudio` a medida que el servidor los manda.
   */
  speak(text: string, onAudio: (event: SpeechAudioEvent) => void): Promise<SpeakResult>;
  /** «Detener» (o «voy a leer con la voz del sistema»): corta la descarga y avisa a la otra vista. */
  stopSpeaking(): void;
  /** Otra vista empezó a leer o se detuvo todo: cortar lo que suena acá. */
  onSpeechCut(listener: () => void): () => void;
  /** Diagnóstico sin contenido de la voz del sistema (va al log técnico). */
  speechDiagnostic(data: SpeechDiagnostic): void;
}

/* ---------------------------- Página externa ---------------------------- */

export const PAGE_CHANNELS = {
  extract: 'page:extract',
  show: 'page:show',
  clear: 'page:clear',
  snapshot: 'page:snapshot',
  shown: 'page:shown',
  changed: 'page:changed',
  interaction: 'page:interaction',
  validation: 'page:validation',
} as const;

export const ExtractRequestSchema = z.strictObject({
  requestId: Id,
  pageId: Id,
  navigationId: Id,
  revision: z.number().int().nonnegative(),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

export const ShowRequestSchema = z.strictObject({
  requestId: Id,
  navigationId: Id,
  /** Selector CSS devuelto por el backend; se resuelve en el preload. */
  selector: z.string().min(1).max(300),
  scroll: z.boolean(),
});
export type ShowRequest = z.infer<typeof ShowRequestSchema>;

export const EXTRACT_NOTES = ['frames', 'canvas', 'truncated', 'closedShadowSuspected'] as const;

export const SnapshotMessageSchema = z.strictObject({
  requestId: Id,
  snapshot: PageSnapshotSchema,
  notes: z.array(z.enum(EXTRACT_NOTES)).max(EXTRACT_NOTES.length),
});

export const SHOW_RESULTS = ['shown', 'stale', 'notVisible'] as const;
export type ShowResult = (typeof SHOW_RESULTS)[number];

const Px = z.number().finite().min(-100_000).max(100_000);
/** Posición del control en la vista del sitio (después de desplazar), para que la tarjeta no lo tape. */
export const TargetRectSchema = z.strictObject({ x: Px, y: Px, width: Px.nonnegative(), height: Px.nonnegative() });
export type TargetRect = z.infer<typeof TargetRectSchema>;

export const ShownMessageSchema = z.strictObject({
  requestId: Id,
  result: z.enum(SHOW_RESULTS),
  elementId: Id.optional(),
  rect: TargetRectSchema.optional(),
  /** El control es un campo: la persona escribe ahí (pantalla 08). */
  field: z.boolean().optional(),
});

export const ChangedMessageSchema = z.strictObject({ structural: z.boolean(), targetPresent: z.boolean().nullable() });

export const InteractionMessageSchema = z.strictObject({ elementId: Id });

export const ValidationMessageSchema = z.strictObject({});
