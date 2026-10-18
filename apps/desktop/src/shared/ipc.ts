/**
 * Contrato IPC interno de la app de escritorio (no es contrato con el backend).
 * Interfaz propia ↔ proceso principal, y página externa (preload aislado) ↔
 * proceso principal. Todo mensaje entrante se valida acá con Zod.
 */
import { PageSnapshotSchema } from '@asistente/page-analyzer';
import { AgeRange, ContentVersion, CountryCode, PageSummary } from '@hackaton/contracts';
import { z } from 'zod';
import type { SiteCheckAction, SiteCheckPanelCopy, SiteCheckTone, SiteIndicatorKind } from './site-check-copy';

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
/** Coordenada entera en px de la ventana. */
const PxInt = z.number().int().min(0).max(20_000);

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
 * Dictado de un dato del formulario (solo desde la tarjeta): WAV → texto →
 * Guíame lo escribe en el lugar señalado. El texto nunca vuelve a la interfaz.
 */
export const UI_DICTATE_FIELD_CHANNEL = 'ui:dictate-field';

/**
 * Resultado del dictado de un dato. `filled`: quedó escrito en la página;
 * `empty`: no se entendió nada; `noMatch`: lo dicho no sirve para ese lugar
 * (una fecha que no se entiende, una opción que no está en la lista);
 * `notAllowed`: el paso ya no pide dictar (cambió, es sensible o la guía está
 * pausada); `error`: la transcripción falló.
 */
export type DictateFieldResult =
  | { status: 'filled' | 'empty' | 'noMatch' | 'notAllowed' }
  | { status: 'error'; reason: TranscribeErrorReason };

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

/**
 * Diagnóstico del micrófono (dictado o respuesta por voz): solo números del
 * detector de silencio y por qué cortó. Nunca audio ni texto.
 */
export const UI_VOICE_DIAGNOSTIC_CHANNEL = 'ui:voice-diagnostic';
const Level = z.number().finite().min(0).max(10);
export const VoiceDiagnosticSchema = z.strictObject({
  floor: Level,
  threshold: Level,
  peak: Level,
  durationMs: z.number().int().min(0).max(120_000),
  /** silence: 5 s sin hablar; noSpeech: nunca habló; limit: 30 s; manual: «Terminar»; cancel: se cortó sin transcribir. */
  reason: z.enum(['silence', 'noSpeech', 'limit', 'manual', 'cancel']),
});
export type VoiceDiagnostic = z.infer<typeof VoiceDiagnosticSchema>;
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
  /** Opción rápida del inicio: uno de los sitios que más abre (el proceso principal lo busca en su lista). */
  z.strictObject({ type: z.literal('openFrequentSite'), origin: z.string().min(1).max(300) }),
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
  /** «Lo escribo yo»: el dato se deja de dictar y el cursor queda en el lugar. */
  z.strictObject({ type: z.literal('typeMyself') }),
  /** La persona confirma que Guíame toque por ella el botón señalado (solo si `offerClick`). */
  z.strictObject({ type: z.literal('clickForMe') }),
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
  // Protección de sitios.
  /** Abre o cierra el panel. `restoreFocus`: al cerrar, el foco vuelve al indicador (Escape, «Cerrar», «Entendido»). */
  z.strictObject({ type: z.literal('siteCheckPanel'), open: z.boolean(), restoreFocus: z.boolean().optional() }),
  z.strictObject({ type: z.literal('siteCheckRetry') }),
  z.strictObject({ type: z.literal('siteCheckLeave') }),
  z.strictObject({ type: z.literal('siteCheckContinue') }),
  /**
   * Solo desde la ventana: bordes de la píldora «Estás en» (px de la ventana) y si
   * el indicador entra en ella. El panel flotante se ancla ahí.
   */
  z.strictObject({ type: z.literal('siteCheckAnchor'), left: PxInt, right: PxInt, inline: z.boolean() }),
  /** Solo desde el panel flotante (site-check.html): cuánto mide lo que dibuja, sin el margen del halo. */
  z.strictObject({ type: z.literal('siteCheckPopoverLayout'), width: z.number().int().min(0).max(5000), height: z.number().int().min(0).max(5000) }),
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

/** Panel flotante de Protección de sitios (vista propia sobre el sitio, anclada debajo del indicador). */
export interface SiteCheckLayout {
  /** Ancho y alto máximos del contenido en px: lo que no entra se desplaza por dentro. */
  maxWidth: number;
  maxHeight: number;
  /** El indicador entra en la píldora «Estás en». Si no, va en la vista flotante, debajo de la píldora. */
  indicatorInline: boolean;
  /**
   * Con el indicador fuera de la píldora y el panel abierto, el panel se corre a
   * la izquierda para no tapar la tarjeta: el indicador se corre esto a la
   * derecha dentro de la vista, así no se mueve en la pantalla.
   */
  chipOffset: number;
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
  layout: { topBarHeight: number; card: CardLayout; siteCheck: SiteCheckLayout };
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
    /** HTTPS o página local: no amerita el aviso de conexión. */
    secure: boolean;
    /** Solo HTTPS. El candado significa conexión cifrada, nunca aprobación del sitio. */
    encrypted: boolean;
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
    /** Mientras se buscan las opciones: lo que la persona pidió con sus palabras (no estaba entre las opciones). */
    request: string | null;
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
    /**
     * El paso pide un dato del formulario. `dictate`: Guíame lo pregunta, la
     * persona lo dice y Guíame lo escribe (`filled`: ya quedó escrito, falta que
     * lo revise). `type`: dato sensible; el cursor queda en el lugar y lo
     * escribe la persona. Nunca trae el valor.
     */
    ask: { question: string; mode: 'dictate' | 'type'; filled: boolean } | null;
    /**
     * Guíame puede tocar por la persona el botón señalado si ella lo confirma:
     * la IA lo marcó seguro (`safeToClick`), no es una acción irreversible y la
     * página no tiene riesgo alto.
     */
    offerClick: boolean;
    /** «Ya hiciste»: solo pasos pasados, en pasado. Nunca valores. */
    done: string[];
    /** Texto visible de la página que prueba que terminó (09). Sin él no se dice «Listo». */
    evidence: string | null;
    /** La persona salió de la ayuda en esta página (21). */
    exited: boolean;
    partialPage: boolean;
  };
  notices: Notice[];
  siteCheck: SiteCheckView;
  /** Opciones rápidas del inicio: los sitios que más abre, el más usado primero. */
  frequentSites: FrequentSiteView[];
}

export interface FrequentSiteView {
  /** Lo que se manda en `openFrequentSite`. */
  origin: string;
  /** Host sin «www.», para mostrar. */
  domain: string;
}

/** Protección de sitios: estado del indicador, panel y advertencia (textos ya resueltos). */
export interface SiteCheckView {
  indicator: SiteIndicatorKind;
  /** Texto visible junto al ícono; null si no hay sitio. */
  label: string | null;
  tone: SiteCheckTone;
  panel: SiteCheckPanelCopy | null;
  panelOpen: boolean;
  /** Advertencia de riesgo alto: ocupa el área del sitio (la vista del sitio se oculta). */
  warning: (SiteCheckPanelCopy & { continueAction: SiteCheckAction }) | null;
  /** Cambia solo ante cambios relevantes (no en cada actualización). */
  announcement: { id: number; text: string } | null;
  /** La guía pausó las indicaciones que piden datos o confirmar operaciones. */
  guidePaused: boolean;
  /** Cambia cada vez que el foco tiene que volver al indicador (se cerró el panel desde adentro). */
  focusIndicator: number;
}

/** API expuesta a la interfaz propia por el preload. Métodos específicos, sin ipcRenderer. */
export interface AsistenteBridge {
  command(command: UiCommand): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
  /** Pasa a texto un WAV PCM16 mono de 16 kHz. Nunca envía la búsqueda. */
  transcribe(wav: ArrayBuffer): Promise<TranscribeResult>;
  /** Dicta el dato que pide el paso actual: Guíame lo escribe en la página. El texto no vuelve. */
  dictateField(wav: ArrayBuffer): Promise<DictateFieldResult>;
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
  /** Diagnóstico sin contenido del micrófono (va al log técnico). */
  voiceDiagnostic(data: VoiceDiagnostic): void;
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
  summarize: 'page:summarize',
  summary: 'page:summary',
  signature: 'page:signature',
  fill: 'page:fill',
  filled: 'page:filled',
  focus: 'page:focus',
  click: 'page:click',
  clicked: 'page:clicked',
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
  /** Guíame puede escribir ahí lo dictado (texto, correo, teléfono, número, fecha o lista). */
  fillable: z.boolean().optional(),
  /** Según los atributos del sitio, pide un dato sensible (clave, código, tarjeta, documento). */
  sensitive: z.boolean().optional(),
  /** Es un botón o enlace habilitado que Guíame podría tocar si la persona lo confirma. */
  clickable: z.boolean().optional(),
});

export const ChangedMessageSchema = z.strictObject({ structural: z.boolean(), targetPresent: z.boolean().nullable() });

/** `event`: qué hizo la persona (clic, terminó de escribir…), nunca el contenido. */
export const InteractionMessageSchema = z.strictObject({ elementId: Id, event: z.enum(['click', 'change', 'input', 'submit']) });

/** Escribir lo dictado en un lugar ya señalado. El valor nunca se registra. */
export const FillRequestSchema = z.strictObject({
  requestId: Id,
  navigationId: Id,
  elementId: Id,
  value: z.string().min(1).max(500),
});
export const FILL_RESULTS = ['filled', 'noMatch', 'refused', 'stale'] as const;
export type FillResult = (typeof FILL_RESULTS)[number];
export const FilledMessageSchema = z.strictObject({ requestId: Id, result: z.enum(FILL_RESULTS) });

/** Tocar el botón o enlace señalado, después de que la persona lo confirmó. */
export const ClickRequestSchema = z.strictObject({ requestId: Id, navigationId: Id, elementId: Id });
export const CLICK_RESULTS = ['clicked', 'refused', 'stale'] as const;
export type ClickResult = (typeof CLICK_RESULTS)[number];
export const ClickedMessageSchema = z.strictObject({ requestId: Id, result: z.enum(CLICK_RESULTS) });

/** Poner el cursor en un lugar para que la persona escriba un dato sensible. */
export const FocusRequestSchema = z.strictObject({ navigationId: Id, elementId: Id });

export const ValidationMessageSchema = z.strictObject({});

/* ------------------------- Protección de sitios ------------------------- */

export const SummarizeRequestSchema = z.strictObject({ requestId: Id, navigationId: Id, contentVersion: ContentVersion });

export const SummaryMessageSchema = z.strictObject({
  requestId: Id,
  navigationId: Id,
  contentVersion: ContentVersion,
  summary: PageSummary,
});

/** Huella de formularios e identidad (hash): avisa que conviene reanalizar. Sin contenido. */
export const SignatureMessageSchema = z.strictObject({ signature: z.string().min(1).max(32).regex(/^[a-z0-9]+$/) });
