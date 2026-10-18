/**
 * Controlador de la ventana: compone la interfaz propia, la vista del sitio, el
 * chat y el asistente; valida los comandos de la interfaz y publica el estado.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Limits } from '@hackaton/contracts';
import { minimizeIntent, sanitizeOrigin } from '@asistente/privacy';
import { BrowserWindow, ipcMain, shell, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  TERMS_VERSION,
  UI_COMMAND_CHANNEL,
  SpeakRequestSchema,
  UI_SPEAK_AUDIO_CHANNEL,
  UI_SPEAK_CHANNEL,
  UI_SPEAK_STOP_CHANNEL,
  UI_SPEECH_DIAGNOSTIC_CHANNEL,
  SpeechDiagnosticSchema,
  UI_STATE_CHANNEL,
  UI_TRANSCRIBE_CHANNEL,
  UiCommandSchema,
  type AppState,
  type CardLayout,
  type Notice,
  type NoticeAction,
  type SpeakResult,
  type TranscribeResult,
  type UiCommand,
} from '../shared/ipc';
import { ApiSession, type ApiClient } from './api/client';
import { Assistant } from './assistant';
import { Chat, UNSURE_ANSWER } from './chat';
import { HelpCardView } from './help-card';
import { log } from './log';
import { PageBridge } from './page-bridge';
import { allowMicrophoneCheck, allowMicrophoneRequest } from './permissions';
import type { PrefsStore } from './prefs';
import { SiteView } from './site-view';
import { SpeechHub } from './speech';
import { classifyUrl, isLoopback, parseAddressInput } from './url-policy';
import { buildUserContext, type SystemInfo } from './user-context';
import { Transcriber } from './voice';
import { changeVoiceMode, isDictatedSearch, VOICE_MODE_TEXTS, VoiceModeState } from './voice-mode';

/** Igual que --chrome-h y --card-w de design/tokens.css, y el ancho de la tarjeta achicada. */
const chromeHeight = (scale: number) => Math.round(72 + (scale - 1) * 16);
const cardWidth = (scale: number) => Math.round(400 + (scale - 1) * 200);
const pillWidth = (scale: number) => Math.round(560 + (scale - 1) * 200);
/** Opciones y guía dentro de la página (POST /v1/options y /v1/next-step). */
const GUIDE_ENABLED = true;
const PRIMARY_OPTIONS = 3;
const MAX_NOTICES = 3;

const PERMISSION_NAMES: Record<string, string> = {
  geolocation: 'tu ubicación',
  media: 'la cámara o el micrófono',
  notifications: 'mostrar notificaciones',
  'clipboard-read': 'leer el portapapeles',
  midi: 'dispositivos MIDI',
  fullscreen: 'pantalla completa',
};

export interface AppControllerOptions {
  api: ApiClient;
  prefs: PrefsStore;
  system: SystemInfo;
  uiPreloadPath: string;
  pagePreloadPath: string;
  rendererUrl: string | null;
  rendererFile: string;
}

export class AppController {
  readonly window: BrowserWindow;
  readonly #site: SiteView;
  readonly #bridge: PageBridge;
  readonly #assistant: Assistant;
  readonly #chat: Chat;
  readonly #card: HelpCardView;
  readonly #transcriber: Transcriber;
  readonly #speech: SpeechHub;
  /** Modo voz: lectura automática de lo que escribe Mostrame. */
  readonly #voiceMode: VoiceModeState;
  #cardLayout: CardLayout = { placement: 'top', maxHeight: 0 };
  #siteVisible = false;
  /** La persona tocó «Salir de la ayuda» en esta página (pantalla 21). */
  #helpExited = false;
  /** «Mostrame cómo» (true) o «Solo ir al sitio» (false) para el próximo destino. */
  #wantGuide = true;
  #notices: Array<Notice & { url?: string | undefined }> = [];
  #publishScheduled = false;

  constructor(private readonly options: AppControllerOptions) {
    this.window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      title: 'Mostrame',
      show: false,
      // --color-bg de design/tokens.css: evita un destello blanco al abrir.
      backgroundColor: '#FBF7F0',
      webPreferences: {
        preload: options.uiPreloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        spellcheck: true,
      },
    });
    this.#hardenUi();

    this.#site = new SiteView(options.pagePreloadPath);
    this.window.contentView.addChildView(this.#site.view);
    this.#site.view.setVisible(false);
    // La tarjeta va después del sitio: queda encima.
    this.#card = new HelpCardView(options.uiPreloadPath);
    this.window.contentView.addChildView(this.#card.view);
    this.#bridge = new PageBridge(this.#site);
    const session = new ApiSession();
    this.#chat = new Chat(
      options.api,
      session,
      () => this.#publish(),
      (url) => this.#openDestination(url),
      () => buildUserContext(options.prefs.value.profile, options.system),
    );
    this.#assistant = new Assistant({ api: options.api, session, page: this.#bridge, onChange: () => this.#publish() });
    this.#transcriber = new Transcriber(options.api);
    // Una sola lectura en toda la app: el hub avisa a la ventana y a la tarjeta.
    this.#speech = new SpeechHub(options.api, () => [this.window.webContents, this.#card.contents]);
    this.#voiceMode = new VoiceModeState(options.prefs.value.voiceMode);
    this.#wireSite();

    ipcMain.handle(UI_COMMAND_CHANNEL, (event, raw: unknown) => this.#onCommand(event, raw));
    ipcMain.handle(UI_TRANSCRIBE_CHANNEL, (event, raw: unknown) => this.#onTranscribe(event, raw));
    ipcMain.handle(UI_SPEAK_CHANNEL, (event, raw: unknown) => this.#onSpeak(event, raw));
    const stopSpeaking = (event: IpcMainEvent) => {
      if (this.#isOwnUi(event)) this.#speech.stop(event.sender);
    };
    ipcMain.on(UI_SPEAK_STOP_CHANNEL, stopSpeaking);
    // Diagnóstico de la voz del sistema: solo cantidades, idioma de la voz y eventos.
    const speechDiagnostic = (event: IpcMainEvent, raw: unknown) => {
      const data = SpeechDiagnosticSchema.safeParse(raw);
      if (!this.#isOwnUi(event) || !data.success) return;
      const d = data.data;
      log('speech.system', {
        voices: d.voices,
        spanishVoices: d.spanishVoices,
        waitMs: d.waitMs,
        chosen: d.chosenLang ? `kind:${d.chosenLang}` : null,
        outcome: `code:${d.outcome}`,
        utterance: `code:${d.event}`,
        errorType: d.errorType ? `code:${d.errorType}` : null,
      });
    };
    ipcMain.on(UI_SPEECH_DIAGNOSTIC_CHANNEL, speechDiagnostic);
    this.window.on('resize', () => this.#layout());
    this.window.once('ready-to-show', () => this.window.show());
    this.window.on('closed', () => {
      ipcMain.removeHandler(UI_COMMAND_CHANNEL);
      ipcMain.removeHandler(UI_TRANSCRIBE_CHANNEL);
      ipcMain.removeHandler(UI_SPEAK_CHANNEL);
      ipcMain.removeListener(UI_SPEAK_STOP_CHANNEL, stopSpeaking);
      ipcMain.removeListener(UI_SPEECH_DIAGNOSTIC_CHANNEL, speechDiagnostic);
      this.#transcriber.cancel();
      this.#speech.stopAll();
      this.#bridge.dispose();
    });
  }

  async load(): Promise<void> {
    const { rendererUrl, rendererFile } = this.options;
    if (rendererUrl) {
      await this.window.loadURL(rendererUrl);
      await this.#card.contents.loadURL(`${rendererUrl.replace(/\/$/, '')}/card.html`);
    } else {
      await this.window.loadFile(rendererFile);
      await this.#card.contents.loadFile(join(dirname(rendererFile), 'card.html'));
    }
    this.#layout();
    this.#publish();
  }

  /* --------------------------------- Estado -------------------------------- */

  /** El sitio ocupa todo el ancho debajo de la barra; la tarjeta flota encima. */
  #layout(): void {
    const scale = this.options.prefs.value.textScale;
    const [width = 0, height = 0] = this.window.getContentSize();
    const top = chromeHeight(scale);
    const area = { x: 0, y: top, width, height: Math.max(0, height - top) };
    this.#site.view.setBounds(area);
    this.#site.view.setVisible(this.#siteVisible);
    const layout = this.#card.layout(
      area,
      { cardWidth: cardWidth(scale), pillWidth: pillWidth(scale) },
      this.#assistant.target?.rect ? { ...this.#assistant.target.rect, field: this.#assistant.target.field } : null,
      this.#siteVisible,
    );
    if (layout.placement !== this.#cardLayout.placement || layout.maxHeight !== this.#cardLayout.maxHeight) {
      this.#cardLayout = layout;
      this.#publish();
    }
  }

  #guideAllowed(): boolean {
    return GUIDE_ENABLED && this.#termsAccepted() && this.options.prefs.isAiEnabled(this.#origin());
  }

  /** Sin condiciones aceptadas no se consulta a la IA. */
  #termsAccepted(): boolean {
    return this.options.prefs.value.termsAccepted === TERMS_VERSION;
  }

  #origin(): string | null {
    return this.#siteVisible ? sanitizeOrigin(this.#site.url) : null;
  }

  #state(): AppState {
    const url = this.#siteVisible ? this.#site.url : '';
    const verdict = url ? classifyUrl(url) : null;
    const parsed = verdict?.kind === 'allow' ? verdict.url : null;
    const guide = this.#assistant.state;
    const history = this.#site.contents.navigationHistory;
    const toView = (o: { id: string; title: string }) => ({ id: o.id, title: o.title, description: '' });
    return {
      mockBackend: this.options.api.isMock,
      guideEnabled: GUIDE_ENABLED,
      layout: { topBarHeight: chromeHeight(this.options.prefs.value.textScale), card: this.#cardLayout },
      prefs: {
        textScale: this.options.prefs.value.textScale,
        aiEnabledForSite: this.options.prefs.isAiEnabled(this.#origin()),
        voiceMode: this.#voiceMode.preference,
      },
      voice: { active: this.#voiceMode.active },
      profile: {
        ...this.options.prefs.value.profile,
        termsAccepted: this.#termsAccepted(),
        suggestedCountry: this.options.system.country,
      },
      nav: {
        visible: this.#siteVisible,
        url: url === 'about:blank' ? '' : url,
        domain: parsed?.hostname ?? '',
        secure: parsed ? parsed.protocol === 'https:' || isLoopback(parsed) : true,
        loading: this.#site.loading,
        canGoBack: this.#siteVisible && history.canGoBack(),
        canGoForward: this.#siteVisible && history.canGoForward(),
        error: this.#site.error,
      },
      chat: {
        phase: this.#chat.phase,
        messages: this.#chat.messages,
        ...this.#chatProgress(),
        question: this.#chat.phase === 'clarifying' ? this.#chat.question : null,
        goal: this.#chat.goal,
        error: this.#chat.error,
        candidates: this.#chat.candidates.map((c) => {
          const u = new URL(c.url);
          return { id: c.id, title: c.title, domain: u.hostname, reason: c.reason, secure: u.protocol === 'https:' || isLoopback(u) };
        }),
      },
      guide: {
        phase: guide.phase,
        goal: guide.goal ?? null,
        primary: guide.options.slice(0, PRIMARY_OPTIONS).map(toView),
        secondary: guide.options.slice(PRIMARY_OPTIONS).map(toView),
        option: guide.option ? toView(guide.option) : null,
        instruction: guide.phase === 'waitingForUser' ? (guide.step?.instruction ?? null) : null,
        announceKey: this.#assistant.announceKey,
        contentKey: this.#assistant.epoch,
        stepCount: guide.stepCount,
        message: guide.message ?? null,
        targetVisible: this.#assistant.targetVisible,
        targetField: this.#assistant.target?.field ?? false,
        waitFor: guide.phase === 'waitingForUser' ? (guide.step?.waitFor ?? null) : null,
        exited: this.#helpExited && guide.phase === 'idle',
        done: this.#assistant.done,
        evidence: guide.phase === 'completed' ? this.#assistant.evidence : null,
        partialPage: this.#assistant.partialPage,
      },
      notices: this.#notices.map(({ url: _url, ...notice }) => notice),
    };
  }

  #chatProgress() {
    const [first, ...rest] = this.#chat.messages.filter((m) => m.from === 'user').map((m) => m.text);
    return { query: first ?? null, answered: rest.filter((t) => t !== UNSURE_ANSWER), unsure: rest.at(-1) === UNSURE_ANSWER };
  }

  /** Agrupa cambios en una sola publicación por vuelta del event loop. */
  #publish(): void {
    if (this.#publishScheduled) return;
    this.#publishScheduled = true;
    setImmediate(() => {
      this.#publishScheduled = false;
      if (this.window.isDestroyed()) return;
      // El control señalado puede haber cambiado: se reubica la tarjeta.
      this.#layout();
      const state = this.#state();
      this.window.webContents.send(UI_STATE_CHANNEL, state);
      if (!this.#card.contents.isDestroyed()) this.#card.contents.send(UI_STATE_CHANNEL, state);
    });
  }

  #notify(text: string, tone: Notice['tone'], actions: NoticeAction[] = ['dismiss'], url?: string): void {
    this.#notices = [
      ...this.#notices.filter((n) => n.text !== text),
      { id: randomUUID().replace(/-/g, '').slice(0, 16), tone, text, actions, url },
    ].slice(-MAX_NOTICES);
    this.#publish();
  }

  /* ------------------------------ Vista del sitio ------------------------------ */

  #wireSite(): void {
    const site = this.#site;
    site.on('navigationStarted', () => {
      this.#helpExited = false;
      this.#assistant.navigationStarted();
    });
    site.on('navigated', ({ sameDocument }) => {
      this.#assistant.navigated({ sameDocument, aiEnabled: this.#guideAllowed() });
    });
    site.on('stateChanged', () => this.#publish());
    site.on('popup', ({ url }) => {
      const domain = new URL(url).hostname;
      this.#notify(`La página quiere abrir otra ventana (${domain}).`, 'info', ['openHere', 'openExternal', 'dismiss'], url);
    });
    site.on('externalProtocol', ({ scheme }) => {
      const what = scheme === 'mailto' ? 'tu programa de correo' : scheme === 'tel' ? 'una llamada' : 'otra aplicación';
      this.#notify(`La página quiere abrir ${what}. Desde acá no está disponible.`, 'info');
    });
    site.on('blocked', () => this.#notify('Esa dirección no se puede abrir en esta app por seguridad.', 'error'));
    site.on('download', () =>
      this.#notify('La página quiere descargar un archivo. Las descargas no están disponibles acá; podés abrirla en tu navegador.', 'info', ['openExternal', 'dismiss'], site.url),
    );
    site.on('permissionDenied', ({ permission }) =>
      this.#notify(
        `La página pidió acceso a ${PERMISSION_NAMES[permission] ?? 'una función del equipo'}. Por seguridad no está disponible acá; si lo necesitás, abrila en tu navegador.`,
        'info',
        ['openExternal', 'dismiss'],
        site.url,
      ),
    );

    this.#bridge.on('changed', (message) => this.#assistant.pageChanged(message));
    this.#bridge.on('interaction', ({ elementId }) => this.#assistant.interaction(elementId));
    this.#bridge.on('validationError', () => this.#assistant.validationError());
  }

  /** Destino elegido en el chat: al cargar, la guía analiza la página con ese objetivo. */
  #openDestination(url: string, guide = this.#wantGuide): void {
    if (guide) this.#assistant.expectDestination(this.#chat.goal ?? '');
    this.#showSite(url);
  }

  #showSite(url: string): void {
    if (!this.#site.navigate(url)) return;
    this.#siteVisible = true;
    this.#layout();
    this.#publish();
  }

  /* ------------------------------ Interfaz propia ------------------------------ */

  #hardenUi(): void {
    const wc = this.window.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.on('will-attach-webview', (event) => event.preventDefault());
    // Todo se rechaza salvo el micrófono para el dictado del buscador, y solo
    // para esta ventana (la tarjeta comparte la sesión; el sitio tiene la suya).
    const rendererUrl = this.options.rendererUrl;
    wc.session.setPermissionRequestHandler((contents, permission, callback, details) => {
      const allowed = allowMicrophoneRequest(
        {
          permission,
          mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
          fromWindow: contents === wc,
          isMainFrame: details.isMainFrame,
          requestingUrl: details.requestingUrl,
        },
        rendererUrl,
      );
      if (!allowed) return callback(false);
      void systemMicrophoneAccess().then(callback, () => callback(false));
    });
    wc.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
      allowMicrophoneCheck(
        { permission, mediaType: details.mediaType, fromWindow: contents === wc, isMainFrame: details.isMainFrame, requestingUrl: details.requestingUrl },
        rendererUrl,
      ),
    );
  }

  /** La ventana o la tarjeta, desde su documento principal. */
  #isOwnUi(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return (event.sender === this.window.webContents || event.sender === this.#card.contents) && event.senderFrame === event.sender.mainFrame;
  }

  /** Leer en voz alta: desde la ventana o la tarjeta, con condiciones aceptadas. */
  async #onSpeak(event: IpcMainInvokeEvent, raw: unknown): Promise<SpeakResult> {
    const request = SpeakRequestSchema.safeParse(raw);
    if (!this.#isOwnUi(event) || !this.#termsAccepted() || !request.success) return { status: 'error', reason: 'failed' };
    const { id, text } = request.data;
    const sender = event.sender;
    // Los pedazos van solo a la vista que pidió la lectura, con su id.
    return this.#speech.speak(sender, text, (audio) => {
      if (!sender.isDestroyed()) sender.send(UI_SPEAK_AUDIO_CHANNEL, { id, ...audio });
    });
  }

  /** Dictado del buscador: solo desde la ventana (no la tarjeta) y con condiciones aceptadas. */
  async #onTranscribe(event: IpcMainInvokeEvent, raw: unknown): Promise<TranscribeResult> {
    if (event.sender !== this.window.webContents || event.senderFrame !== event.sender.mainFrame || !this.#termsAccepted()) {
      return { status: 'error', reason: 'failed' };
    }
    // El modo voz se prende recién cuando la búsqueda dictada se envía (submitIntent con `dictated`).
    return this.#transcriber.transcribe(raw);
  }

  async #onCommand(event: IpcMainInvokeEvent, raw: unknown): Promise<void> {
    const fromCard = event.sender === this.#card.contents;
    if ((event.sender !== this.window.webContents && !fromCard) || event.senderFrame !== event.sender.mainFrame) return;
    const parsed = UiCommandSchema.safeParse(raw);
    if (!parsed.success) {
      log('ui.invalid_command');
      return;
    }
    if (parsed.data.type === 'cardLayout') {
      if (fromCard && this.#card.report(parsed.data)) this.#layout();
      return;
    }
    await this.#run(parsed.data);
  }

  async #run(command: UiCommand): Promise<void> {
    switch (command.type) {
      case 'ready':
        this.#publish();
        return;
      case 'submitIntent': {
        if (!this.#termsAccepted()) return;
        // Buscar dictando prende el modo voz para este recorrido (si la preferencia es `auto`).
        if (isDictatedSearch(command, this.#chat.busy) && this.#voiceMode.dictated()) this.#publish();
        if (command.guide !== undefined) this.#wantGuide = command.guide;
        // «Solo ir al sitio» con una dirección escrita: se abre directo.
        const url = command.guide === false ? parseAddressInput(command.text) : null;
        if (url) this.#showSite(url);
        else await this.#chat.submit(command.text);
        return;
      }
      case 'saveProfile': {
        const { country, region, city, ageRange } = command;
        await this.options.prefs.update({ termsAccepted: TERMS_VERSION, profile: { country, region, city, ageRange } });
        this.#publish();
        return;
      }
      case 'resetChat':
        // Empezar de nuevo descarta la sesión: la guía no puede seguir con la anterior.
        this.#assistant.exit();
        this.#chat.reset();
        return;
      case 'openCandidate': {
        // La URL sale del resultado recibido, nunca del renderer.
        const candidate = this.#chat.candidate(command.candidateId);
        if (!candidate) return;
        this.#openDestination(candidate.url, command.guide ?? this.#wantGuide);
        return;
      }
      case 'navigate': {
        const url = parseAddressInput(command.input);
        if (!url) {
          this.#notify('Eso no parece una dirección web. Para pedir ayuda, usá «Inicio».', 'info');
          return;
        }
        this.#showSite(url);
        return;
      }
      case 'search': {
        const url = parseAddressInput(command.text);
        if (url) {
          this.#showSite(url);
          return;
        }
        // No es una dirección: es un pedido. Se empieza de nuevo desde el inicio.
        if (!this.#termsAccepted()) return;
        await this.#run({ type: 'home' });
        await this.#chat.submit(command.text);
        return;
      }
      case 'back':
        this.#site.back();
        return;
      case 'forward':
        this.#site.forward();
        return;
      case 'reload':
        this.#site.reload();
        return;
      case 'home':
        this.#speech.stopAll();
        this.#voiceMode.newJourney();
        this.#assistant.exit();
        this.#chat.reset();
        this.#wantGuide = true;
        this.#siteVisible = false;
        this.#helpExited = false;
        this.#site.clear();
        this.#notices = [];
        this.#layout();
        this.#publish();
        return;
      case 'analyzePage':
        this.#helpExited = false;
        if (this.#siteVisible && this.#guideAllowed()) this.#assistant.analyze(this.#chat.goal ?? undefined);
        this.#publish();
        return;
      case 'askOnPage': {
        const goal = minimizeIntent(command.text, Limits.maxMessageLength);
        if (goal && this.#siteVisible && this.#guideAllowed()) this.#assistant.analyze(goal);
        return;
      }
      case 'cardLayout':
        return;
      case 'selectOption':
        this.#assistant.select(command.optionId);
        return;
      case 'repeat':
        this.#assistant.repeat();
        return;
      case 'stepBack':
        this.#assistant.back();
        return;
      case 'exitHelp':
        this.#speech.stopAll();
        this.#helpExited = this.#assistant.state.phase !== 'idle';
        this.#assistant.exit();
        this.#publish();
        return;
      case 'confirmDone':
        this.#assistant.confirmDone();
        return;
      case 'resumeGuide':
        this.#assistant.resume();
        return;
      case 'finishHelp':
        this.#assistant.exit();
        return;
      case 'retry':
        this.#assistant.retry();
        return;
      // TODO(UI final): setAiForSite no tiene control en la UI de Mostrame todavía.
      case 'setVoiceMode': {
        // Primero se guarda; si falla, no cambia nada y se avisa en la interfaz (el comando llega con `void`).
        const saved = await changeVoiceMode(this.#voiceMode, command.mode, {
          save: (mode) => this.options.prefs.update({ voiceMode: mode }),
          stopAll: () => this.#speech.stopAll(),
          publish: () => this.#publish(),
          failed: () => {
            log('prefs.error', { kind: 'kind:voiceMode' });
            this.#notify(VOICE_MODE_TEXTS.saveFailed, 'error');
          },
        });
        // Se guardó: el aviso de un intento anterior ya no corresponde.
        if (saved) this.#notices = this.#notices.filter((n) => n.text !== VOICE_MODE_TEXTS.saveFailed);
        return;
      }
      case 'setTextScale':
        await this.options.prefs.update({ textScale: command.scale });
        this.#layout();
        this.#publish();
        return;
      case 'setAiForSite': {
        const origin = this.#origin();
        if (!origin) return;
        await this.options.prefs.setAiEnabled(origin, command.enabled);
        if (this.#guideAllowed()) this.#assistant.analyze(this.#chat.goal ?? undefined);
        else this.#assistant.exit();
        this.#publish();
        return;
      }
      case 'resolveNotice': {
        const notice = this.#notices.find((n) => n.id === command.noticeId);
        if (!notice || !notice.actions.includes(command.action)) return;
        this.#notices = this.#notices.filter((n) => n.id !== notice.id);
        if (command.action === 'openHere' && notice.url) this.#showSite(notice.url);
        if (command.action === 'openExternal' && notice.url) await openExternally(notice.url);
        this.#publish();
        return;
      }
      case 'openCurrentExternally':
        if (this.#siteVisible) await openExternally(this.#site.url);
        return;
    }
  }
}

/** macOS pide permiso del sistema para el micrófono; en Windows y Linux decide Chromium. */
async function systemMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone');
  return false;
}

async function openExternally(url: string): Promise<void> {
  const verdict = classifyUrl(url);
  if (verdict.kind === 'allow') await shell.openExternal(verdict.url.toString());
}
