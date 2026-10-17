/**
 * Contrato IPC interno de la app de escritorio (no es contrato con el backend).
 * Interfaz propia ↔ proceso principal, y página externa (preload aislado) ↔
 * proceso principal. Todo mensaje entrante se valida acá con Zod.
 */
import { PageSnapshotSchema } from '@hackaton/contracts';
import { z } from 'zod';

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const TEXT_SCALES = [1, 1.25, 1.5, 1.75] as const;

/* ---------------------------- Interfaz propia ---------------------------- */

export const UI_COMMAND_CHANNEL = 'ui:command';
export const UI_STATE_CHANNEL = 'ui:state';

export const UiCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('submitIntent'), text: z.string().trim().min(1).max(500) }),
  z.strictObject({ type: z.literal('openCandidate'), candidateId: Id }),
  z.strictObject({ type: z.literal('resetChat') }),
  z.strictObject({ type: z.literal('navigate'), input: z.string().trim().min(1).max(2048) }),
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
  z.strictObject({ type: z.literal('retry') }),
  z.strictObject({ type: z.literal('setTextScale'), scale: z.union(TEXT_SCALES.map((s) => z.literal(s))) }),
  z.strictObject({ type: z.literal('setAiForSite'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('resolveNotice'), noticeId: Id, action: z.enum(['openHere', 'openExternal', 'dismiss']) }),
  z.strictObject({ type: z.literal('openCurrentExternally') }),
]);
export type UiCommand = z.infer<typeof UiCommandSchema>;

export type NoticeAction = 'openHere' | 'openExternal' | 'dismiss';

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
  description: string;
  reason?: string | undefined;
  recommended: boolean;
  verifiedOfficial: boolean;
  secure: boolean;
}

export interface ChatMessage {
  id: string;
  from: 'user' | 'assistant';
  text: string;
}

export type ChatPhase = 'idle' | 'interpreting' | 'clarifying' | 'searching' | 'results' | 'error';

export interface OptionView {
  id: string;
  title: string;
  description: string;
}

export interface AppState {
  mockBackend: boolean;
  layout: { topBarHeight: number; panelWidth: number };
  prefs: { textScale: number; aiEnabledForSite: boolean };
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
    stepCount: number;
    message: string | null;
    targetVisible: boolean | null;
    partialPage: boolean;
  };
  notices: Notice[];
}

/** API expuesta a la interfaz propia por el preload. Métodos específicos, sin ipcRenderer. */
export interface AsistenteBridge {
  command(command: UiCommand): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
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
  elementId: Id,
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

export const ShownMessageSchema = z.strictObject({ requestId: Id, result: z.enum(SHOW_RESULTS) });

export const ChangedMessageSchema = z.strictObject({ structural: z.boolean(), targetPresent: z.boolean().nullable() });

export const InteractionMessageSchema = z.strictObject({ elementId: Id });

export const ValidationMessageSchema = z.strictObject({});
