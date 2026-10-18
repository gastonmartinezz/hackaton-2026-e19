/**
 * Controlador de la ventana: compone la interfaz propia, la vista del sitio, el
 * chat y el asistente; valida los comandos de la interfaz y publica el estado.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Limits } from '@hackaton/contracts';
import { minimizeIntent, sanitizeOrigin } from '@asistente/privacy';
import { BrowserWindow, ipcMain, shell, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  TERMS_VERSION,
  UI_COMMAND_CHANNEL,
  SpeakRequestSchema,
  UI_SPEAK_AUDIO_CHANNEL,
  UI_SPEAK_CHANNEL,
  UI_SPEAK_STOP_CHANNEL,
  UI_SPEECH_DIAGNOSTIC_CHANNEL,
  SpeechDiagnosticSchema,
  UI_VOICE_DIAGNOSTIC_CHANNEL,
  VoiceDiagnosticSchema,
  UI_STATE_CHANNEL,
  UI_TRANSCRIBE_CHANNEL,
  UI_DICTATE_FIELD_CHANNEL,
  UiCommandSchema,
  type AppState,
  type CardLayout,
  type Notice,
  type NoticeAction,
  type SpeakResult,
  type DictateFieldResult,
  type TranscribeResult,
  type SiteCheckLayout,
  type SiteCheckView,
  type UiCommand,
} from '../shared/ipc';
import { announcementText, CONTINUE_ACTION, siteCheckCopy } from '../shared/site-check-copy';
import { ApiSession, type ApiClient } from './api/client';
import { Assistant } from './assistant';
import { Chat, UNSURE_ANSWER } from './chat';
import { forgetHost, labelSite, recordVisit, topSites } from './frequent-sites';
import { HelpCardView } from './help-card';
import { log } from './log';
import { PageBridge } from './page-bridge';
import { allowMicrophoneCheck, allowMicrophoneRequest } from './permissions';
import type { PrefsStore } from './prefs';
import { POPOVER_COMMANDS, SiteCheckPopoverView, type PopoverAnchor } from './site-check-popover';
import { SiteProtection } from './site-protection/coordinator';
import { checkEligibility } from './site-protection/eligibility';
import { SiteView } from './site-view';
import { SpeechHub } from './speech';
import { classifyUrl, isLoopback, parseAddressInput } from './url-policy';
import { buildUserContext, type SystemInfo } from './user-context';
import { Transcriber } from './voice';
import { changeVoiceMode, isDictatedSearch, VOICE_MODE_TEXTS, VoiceModeState } from './voice-mode';

/**
 * Igual que --h-bar y --card-w de @asistente/ui/tokens.css (R4, R6): 76 y 520 a 1.2×. La achicada (12) y el
 * panel de Protección de sitios (--site-panel-w de renderer/src/site-check.css) miden lo mismo.
 */
const chromeHeight = (scale: number) => Math.round(76 + (scale - 1.2) * 16);
const cardWidth = (scale: number) => Math.round(520 + (scale - 1.2) * 240);
const pillWidth = cardWidth;
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
  /** Contenido de la ventana: se guarda porque `window.webContents` tira error una vez cerrada. */
  readonly #ui: WebContents;
  readonly #site: SiteView;
  readonly #bridge: PageBridge;
  readonly #assistant: Assistant;
  readonly #chat: Chat;
  readonly #card: HelpCardView;
  readonly #transcriber: Transcriber;
  readonly #speech: SpeechHub;
  /** Modo voz: lectura automática de lo que escribe Guíame. */
  readonly #voiceMode: VoiceModeState;
  #cardLayout: CardLayout = { placement: 'top', maxHeight: 0 };
  #siteVisible = false;
  /** La persona tocó «Salir de la ayuda» en esta página (pantalla 21). */
  #helpExited = false;
  /** «Guíame» o «Ir con ayuda» (true), o «Solo abrir el sitio» (false), para el próximo destino. */
  #wantGuide = true;
  readonly #protection: SiteProtection;
  /** Panel de Protección de sitios: vista propia que flota sobre el sitio, debajo del indicador. */
  readonly #popover: SiteCheckPopoverView;
  /** Píldora «Estás en» (la mide la ventana): ancla del panel. */
  #anchor: PopoverAnchor = { left: 0, right: 0, inline: true };
  #popoverLayout: SiteCheckLayout = { maxWidth: 0, maxHeight: 0, indicatorInline: true, chipOffset: 0 };
  /** El panel se abrió: cuando su vista se muestre, recibe el foco. */
  #focusPopover = false;
  /** Cambia cada vez que el foco tiene que volver al indicador. */
  #focusIndicator = 0;
  /** Hosts con «Posible estafa» o «Atención» en esta sesión: «Salir de este sitio» no vuelve a ellos. */
  readonly #riskyHosts = new Set<string>();
  /** Último sitio contado como visita: andar por sus páginas no suma; volver a entrar desde el inicio, sí. */
  #visitedOrigin: string | null = null;
  /** Tarea del destino que se está abriendo desde una búsqueda con ayuda, hasta contar la visita. */
  #pendingTask: { origin: string; task: string } | null = null;
  /** Lo último que se le dijo a la página sobre el velo (R9). */
  #veiled = false;
  #notices: Array<Notice & { url?: string | undefined }> = [];
  #publishScheduled = false;

  constructor(private readonly options: AppControllerOptions) {
    this.window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      title: 'Guíame',
      show: false,
      // --g-surface de design/tokens/tokens.css: evita un destello al abrir.
      backgroundColor: '#FFFFFF',
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
    this.#ui = this.window.webContents;
    this.#hardenUi();

    this.#site = new SiteView(options.pagePreloadPath);
    this.window.contentView.addChildView(this.#site.view);
    this.#site.view.setVisible(false);
    // La tarjeta va después del sitio: queda encima. El panel de protección, encima de los dos.
    this.#card = new HelpCardView(options.uiPreloadPath);
    this.window.contentView.addChildView(this.#card.view);
    this.#popover = new SiteCheckPopoverView(options.uiPreloadPath);
    this.window.contentView.addChildView(this.#popover.view);
    this.#bridge = new PageBridge(this.#site);
    const session = new ApiSession();
    this.#chat = new Chat(
      options.api,
      session,
      () => this.#publish(),
      (url) => this.#openDestination(url, this.#wantGuide, this.#chat.goal),
      () => buildUserContext(options.prefs.value.profile, options.system),
    );
    this.#assistant = new Assistant({ api: options.api, session, page: this.#bridge, onChange: () => this.#publish() });
    this.#transcriber = new Transcriber(options.api);
    // Una sola lectura en toda la app: el hub avisa a la ventana y a la tarjeta.
    this.#speech = new SpeechHub(options.api, () => [this.#ui, this.#card.contents]);
    this.#voiceMode = new VoiceModeState(options.prefs.value.voiceMode);
    this.#protection = new SiteProtection({
      api: options.api,
      summarize: (navigationId, contentVersion) => this.#bridge.summarize(navigationId, contentVersion),
      onChange: () => this.#onProtectionChange(),
    });
    this.#wireSite();

    ipcMain.handle(UI_COMMAND_CHANNEL, (event, raw: unknown) => this.#onCommand(event, raw));
    ipcMain.handle(UI_TRANSCRIBE_CHANNEL, (event, raw: unknown) => this.#onTranscribe(event, raw));
    ipcMain.handle(UI_DICTATE_FIELD_CHANNEL, (event, raw: unknown) => this.#onDictateField(event, raw));
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
    // Diagnóstico del micrófono: piso de ruido, umbral, pico de voz, duración y por qué cortó.
    const voiceDiagnostic = (event: IpcMainEvent, raw: unknown) => {
      const data = VoiceDiagnosticSchema.safeParse(raw);
      if (!this.#isOwnUi(event) || !data.success) return;
      const round = (n: number) => Math.round(n * 10_000) / 10_000;
      const d = data.data;
      log('voice.capture', { floor: round(d.floor), threshold: round(d.threshold), peak: round(d.peak), durationMs: d.durationMs, reason: `code:${d.reason}` });
    };
    ipcMain.on(UI_VOICE_DIAGNOSTIC_CHANNEL, voiceDiagnostic);
    this.window.on('resize', () => this.#layout());
    this.window.once('ready-to-show', () => this.window.show());
    this.window.on('closed', () => {
      ipcMain.removeHandler(UI_COMMAND_CHANNEL);
      ipcMain.removeHandler(UI_TRANSCRIBE_CHANNEL);
      ipcMain.removeHandler(UI_DICTATE_FIELD_CHANNEL);
      ipcMain.removeHandler(UI_SPEAK_CHANNEL);
      ipcMain.removeListener(UI_SPEAK_STOP_CHANNEL, stopSpeaking);
      ipcMain.removeListener(UI_SPEECH_DIAGNOSTIC_CHANNEL, speechDiagnostic);
      ipcMain.removeListener(UI_VOICE_DIAGNOSTIC_CHANNEL, voiceDiagnostic);
      this.#transcriber.cancel();
      this.#speech.stopAll();
      this.#bridge.dispose();
      // Lo que esté en curso ya no tiene dónde mostrarse. Las vistas del sitio, de
      // la tarjeta y del panel de protección no se cierran solas con la ventana.
      this.#chat.reset();
      this.#assistant.exit();
      this.#protection.clear();
      for (const contents of [this.#card.contents, this.#popover.contents, this.#site.contents]) if (!contents.isDestroyed()) contents.close();
    });
  }

  async load(): Promise<void> {
    const { rendererUrl, rendererFile } = this.options;
    if (rendererUrl) {
      const base = rendererUrl.replace(/\/$/, '');
      await this.window.loadURL(rendererUrl);
      await this.#card.contents.loadURL(`${base}/card.html`);
      await this.#popover.contents.loadURL(`${base}/site-check.html`);
    } else {
      await this.window.loadFile(rendererFile);
      await this.#card.contents.loadFile(join(dirname(rendererFile), 'card.html'));
      await this.#popover.contents.loadFile(join(dirname(rendererFile), 'site-check.html'));
    }
    this.#layout();
    this.#publish();
  }

  /* --------------------------------- Estado -------------------------------- */

  /**
   * El sitio ocupa todo el ancho debajo de la barra; la tarjeta flota encima.
   * Protección de sitios: el panel flota encima de los dos, anclado debajo del
   * indicador, sin mover nada; la advertencia de riesgo alto oculta el sitio y
   * la tarjeta. Las vistas nativas quedan encima de la interfaz propia y el
   * panel empieza debajo de la barra: así el contenido web nunca tapa el
   * indicador, el panel ni los avisos.
   */
  #layout(): void {
    if (this.window.isDestroyed()) return;
    const scale = this.options.prefs.value.textScale;
    const [width = 0, height = 0] = this.window.getContentSize();
    const protection = this.#protection.snapshot;
    const top = chromeHeight(scale);
    const area = { x: 0, y: top, width, height: Math.max(0, height - top) };
    const siteShown = this.#siteVisible && !protection.warningOpen;
    this.#site.view.setBounds(area);
    this.#site.view.setVisible(siteShown);
    const layout = this.#card.layout(
      area,
      { cardWidth: cardWidth(scale), pillWidth: pillWidth(scale) },
      this.#assistant.target?.rect ? { ...this.#assistant.target.rect, field: this.#assistant.target.field } : null,
      siteShown,
    );
    if (layout.placement !== this.#cardLayout.placement || layout.maxHeight !== this.#cardLayout.maxHeight) {
      this.#cardLayout = layout;
      this.#publish();
    }
    this.#syncVeil();
    // Con la advertencia abierta, el indicador y el panel van en la ventana (el sitio está oculto).
    const hasIndicator = this.#siteVisible && protection.kind !== 'none';
    const popoverShown = siteShown && hasIndicator && (protection.panelOpen || !this.#anchor.inline);
    const placed = this.#popover.layout({ width, height }, top, this.#anchor, popoverShown, {
      card: this.#card.box,
      panelOpen: protection.panelOpen,
      panelWidth: cardWidth(scale),
    });
    const popover: SiteCheckLayout = { ...placed, indicatorInline: this.#anchor.inline };
    const last = this.#popoverLayout;
    if (
      popover.maxWidth !== last.maxWidth ||
      popover.maxHeight !== last.maxHeight ||
      popover.indicatorInline !== last.indicatorInline ||
      popover.chipOffset !== last.chipOffset
    ) {
      this.#popoverLayout = popover;
      this.#publish();
    }
    if (this.#focusPopover && protection.panelOpen && this.#popover.visible) {
      this.#focusPopover = false;
      this.#popover.contents.focus();
    }
  }

  #onProtectionChange(): void {
    const highRisk = this.#protection.highRisk;
    const host = this.#protection.target?.hostname;
    const kind = this.#protection.snapshot.kind;
    if (host && (kind === 'possible_scam' || kind === 'attention')) {
      this.#riskyHosts.add(host);
      // Un sitio riesgoso no se ofrece como opción rápida.
      this.#forgetSite(host);
    }
    this.#assistant.setRiskHold(highRisk);
    this.#layout();
    this.#publish();
  }

  #siteCheckView(): SiteCheckView {
    const snap = this.#protection.snapshot;
    const kind = this.#siteVisible ? snap.kind : 'none';
    if (kind === 'none') {
      return {
        indicator: 'none',
        label: null,
        tone: 'neutral',
        panel: null,
        panelOpen: false,
        warning: null,
        announcement: null,
        guidePaused: false,
        focusIndicator: this.#focusIndicator,
      };
    }
    const hostname = this.#protection.target?.hostname ?? null;
    const copy = siteCheckCopy(kind, snap.response, hostname);
    const announced = snap.announcement?.kind;
    return {
      indicator: kind,
      label: copy.label,
      tone: copy.tone,
      panel: copy.panel,
      panelOpen: snap.panelOpen,
      warning: snap.warningOpen ? { ...siteCheckCopy('possible_scam', snap.response, hostname).panel, continueAction: CONTINUE_ACTION } : null,
      announcement:
        snap.announcement && announced && announced !== 'none' && announced !== 'checking'
          ? { id: snap.announcement.id, text: announcementText(announced, snap.response) }
          : null,
      guidePaused: this.#assistant.paused,
      focusIndicator: this.#focusIndicator,
    };
  }

  /** «Salir de este sitio»: la página anterior válida (otro sitio, sin riesgo alto) o el inicio. */
  #leaveSite(): void {
    const riskyDomain = this.#protection.target?.registrableDomain ?? null;
    const acceptable = (url: string) => {
      const target = checkEligibility(url);
      if (target.kind === 'none') return false;
      if (target.kind !== 'eligible') return true;
      return !this.#riskyHosts.has(target.hostname) && target.registrableDomain !== riskyDomain;
    };
    // Aviso temprano (fase dirección): la página riesgosa todavía no se mostró.
    if (this.#site.loading) {
      this.#site.contents.stop();
      this.#site.navigating = false;
      const committed = this.#site.url;
      if (committed !== 'about:blank' && acceptable(committed)) {
        log('site_check.leave', { back: false, stayed: true });
        this.#protection.navigationStarted(committed);
        this.#protection.pageLoaded(committed);
        return;
      }
    }
    const index = this.#site.findBack(acceptable);
    log('site_check.leave', { back: index >= 0 });
    if (index >= 0) this.#site.goToIndex(index);
    else void this.#run({ type: 'home' });
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
    const showing = !this.#assistant.settling;
    const history = this.#site.contents.navigationHistory;
    const toView = (o: { id: string; title: string }) => ({ id: o.id, title: o.title, description: '' });
    return {
      mockBackend: this.options.api.isMock,
      guideEnabled: GUIDE_ENABLED,
      layout: { topBarHeight: chromeHeight(this.options.prefs.value.textScale), card: this.#cardLayout, siteCheck: this.#popoverLayout },
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
        encrypted: parsed?.protocol === 'https:',
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
        // Después de un clic se espera un instante antes del paso siguiente: se muestra como «fijándome».
        phase: showing ? guide.phase : 'verifying',
        goal: guide.goal ?? null,
        request: guide.phase === 'analyzing' ? (guide.request ?? null) : null,
        primary: guide.options.slice(0, PRIMARY_OPTIONS).map(toView),
        secondary: guide.options.slice(PRIMARY_OPTIONS).map(toView),
        option: guide.option ? toView(guide.option) : null,
        instruction: showing && guide.phase === 'waitingForUser' ? (guide.step?.instruction ?? null) : null,
        announceKey: this.#assistant.announceKey,
        contentKey: this.#assistant.epoch,
        stepCount: guide.stepCount,
        message: guide.message ?? null,
        targetVisible: this.#assistant.targetVisible,
        targetField: this.#assistant.target?.field ?? false,
        waitFor: showing && guide.phase === 'waitingForUser' ? (guide.step?.waitFor ?? null) : null,
        ask: showing && guide.phase === 'waitingForUser' ? this.#assistant.ask : null,
        exited: this.#helpExited && guide.phase === 'idle',
        done: this.#assistant.done,
        evidence: guide.phase === 'completed' ? this.#assistant.evidence : null,
        partialPage: this.#assistant.partialPage,
      },
      notices: this.#notices.map(({ url: _url, ...notice }) => notice),
      siteCheck: this.#siteCheckView(),
      frequentSites: topSites(this.options.prefs.value.frequentSites).map(({ origin, task }) => ({
        origin,
        domain: new URL(origin).hostname.replace(/^www\./, ''),
        task: task ?? null,
      })),
    };
  }

  #chatProgress() {
    const [first, ...rest] = this.#chat.messages.filter((m) => m.from === 'user').map((m) => m.text);
    // «No sé bien» también queda como respuesta dada (10).
    return { query: first ?? null, answered: rest, unsure: rest.at(-1) === UNSURE_ANSWER };
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
      this.#ui.send(UI_STATE_CHANNEL, state);
      if (!this.#card.contents.isDestroyed()) this.#card.contents.send(UI_STATE_CHANNEL, state);
      if (!this.#popover.contents.isDestroyed()) this.#popover.contents.send(UI_STATE_CHANNEL, state);
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
    site.on('navigationStarted', ({ url }) => {
      this.#helpExited = false;
      this.#bridge.cancelSummaries();
      this.#protection.navigationStarted(url);
      this.#assistant.navigationStarted();
    });
    site.on('navigationRedirected', ({ url }) => this.#protection.navigationStarted(url));
    site.on('navigated', ({ url, sameDocument }) => {
      if (sameDocument) this.#protection.routeChanged(url);
      else {
        this.#protection.pageLoaded(url);
        this.#countVisit(url);
        // Página nueva: su capa todavía no tiene el velo.
        this.#syncVeil(true);
      }
      this.#assistant.navigated({ sameDocument, aiEnabled: this.#guideAllowed() });
    });
    site.on('loadFailed', () => {
      this.#protection.loadFailed();
      this.#assistant.loadFailed();
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
    this.#bridge.on('interaction', ({ elementId, event }) => this.#assistant.interaction(elementId, event));
    this.#bridge.on('validationError', () => this.#assistant.validationError());
    this.#bridge.on('signature', () => this.#protection.contentChanged());

    // Tocar el sitio o la tarjeta cierra el panel de protección (clic afuera). El foco queda donde tocó la persona.
    const closePanelOnClick = (_event: Electron.Event, input: Electron.InputEvent) => {
      if (input.type === 'mouseDown' && this.#protection.snapshot.panelOpen) this.#protection.setPanelOpen(false);
    };
    site.contents.on('input-event', closePanelOnClick);
    this.#card.contents.on('input-event', closePanelOnClick);
  }

  /** Velo sobre el sitio (R9) mientras la tarjeta está abierta o achicada. `force`: volver a mandarlo (página nueva). */
  #syncVeil(force = false): void {
    const on = this.#card.veiled;
    if (on === this.#veiled && !force) return;
    this.#veiled = on;
    this.#bridge.veil(on);
  }

  /** Suma una visita al sitio si es otro que el anterior. Solo sitios públicos; se guarda el origen, nunca la dirección completa. */
  #countVisit(url: string): void {
    const target = checkEligibility(url);
    const origin = target.kind === 'eligible' ? sanitizeOrigin(target.url) : null;
    // La tarea vale solo para la primera página que carga después de abrir el destino: aunque esta
    // visita no se cuente, no queda guardada para una visita posterior.
    const task = origin && this.#pendingTask?.origin === origin ? this.#pendingTask.task : null;
    this.#pendingTask = null;
    if (!origin || this.#riskyHosts.has(new URL(origin).hostname)) return;
    if (origin === this.#visitedOrigin) {
      // Ya estaba en ese sitio: no suma otra visita, pero la tarea nueva sí queda.
      if (task) this.options.prefs.update((current) => ({ frequentSites: labelSite(current.frequentSites, origin, task) })).then(
        () => this.#publish(),
        () => log('prefs.error', { kind: 'kind:frequentSites' }),
      );
      return;
    }
    this.#visitedOrigin = origin;
    this.options.prefs.update((current) => ({ frequentSites: recordVisit(current.frequentSites, origin, Date.now(), task) })).then(
      () => this.#publish(),
      () => log('prefs.error', { kind: 'kind:frequentSites' }),
    );
  }

  #forgetSite(hostname: string): void {
    if (!this.options.prefs.value.frequentSites.some((s) => new URL(s.origin).hostname === hostname)) return;
    this.options.prefs.update((current) => ({ frequentSites: forgetHost(current.frequentSites, hostname) })).then(
      () => this.#publish(),
      () => log('prefs.error', { kind: 'kind:frequentSites' }),
    );
  }

  /** Destino elegido en el chat: al cargar, la guía analiza la página con ese objetivo. */
  /**
   * `task`: lo que se va a hacer en ese sitio, para el acceso del historial. Solo
   * se pasa al abrir un destino de una búsqueda con ayuda; un acceso del
   * historial conserva el que tenía.
   */
  #openDestination(url: string, guide = this.#wantGuide, task: string | null = null): void {
    if (guide) this.#assistant.expectDestination(this.#chat.goal ?? '');
    const target = checkEligibility(url);
    const origin = target.kind === 'eligible' ? sanitizeOrigin(target.url) : null;
    this.#pendingTask = guide && task && origin ? { origin, task } : null;
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
    const wc = this.#ui;
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
          // La ventana (dictado) o la tarjeta (responder con la voz en 05); nunca el sitio.
          fromOwnUi: contents === wc || contents === this.#card.contents,
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
        { permission, mediaType: details.mediaType, fromOwnUi: contents === wc || contents === this.#card.contents, isMainFrame: details.isMainFrame, requestingUrl: details.requestingUrl },
        rendererUrl,
      ),
    );
  }

  /** La ventana o la tarjeta, desde su documento principal. */
  #isOwnUi(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return (event.sender === this.#ui || event.sender === this.#card.contents) && event.senderFrame === event.sender.mainFrame;
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
    // Desde la ventana (dictado) o la tarjeta (responder con la voz qué opción se quiere).
    if (!this.#isOwnUi(event) || !this.#termsAccepted()) return { status: 'error', reason: 'failed' };
    // El modo voz se prende recién cuando la búsqueda dictada se envía (submitIntent con `dictated`).
    return this.#transcriber.transcribe(raw);
  }

  /**
   * Dictado de un dato del formulario: solo desde la tarjeta. El texto va de la
   * transcripción directo a la página; nunca vuelve a la interfaz, nunca va a
   * Claude y nunca se registra.
   */
  async #onDictateField(event: IpcMainInvokeEvent, raw: unknown): Promise<DictateFieldResult> {
    if (event.sender !== this.#card.contents || event.senderFrame !== event.sender.mainFrame || !this.#termsAccepted()) return { status: 'notAllowed' };
    if (this.#assistant.ask?.mode !== 'dictate') return { status: 'notAllowed' };
    const heard = await this.#transcriber.transcribe(raw);
    if (heard.status !== 'ok') return heard;
    const result = await this.#assistant.fill(heard.text);
    return { status: result === 'filled' || result === 'noMatch' ? result : 'notAllowed' };
  }

  async #onCommand(event: IpcMainInvokeEvent, raw: unknown): Promise<void> {
    const fromWindow = event.sender === this.#ui;
    const fromCard = event.sender === this.#card.contents;
    const fromPopover = event.sender === this.#popover.contents;
    if ((!fromWindow && !fromCard && !fromPopover) || event.senderFrame !== event.sender.mainFrame) return;
    const parsed = UiCommandSchema.safeParse(raw);
    if (!parsed.success) {
      log('ui.invalid_command');
      return;
    }
    const command = parsed.data;
    // El panel de protección solo puede pedir lo suyo.
    if (fromPopover && !POPOVER_COMMANDS.has(command.type)) {
      log('ui.invalid_command');
      return;
    }
    switch (command.type) {
      case 'cardLayout':
        if (fromCard && this.#card.report(command)) this.#layout();
        return;
      case 'siteCheckPopoverLayout':
        if (fromPopover && this.#popover.report(command)) this.#layout();
        return;
      case 'siteCheckAnchor': {
        const { left, right, inline } = command;
        if (!fromWindow || (left === this.#anchor.left && right === this.#anchor.right && inline === this.#anchor.inline)) return;
        this.#anchor = { left, right, inline };
        this.#layout();
        this.#publish();
        return;
      }
    }
    await this.#run(command);
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
        // Sin guía y con una dirección escrita: se abre directo.
        const url = command.guide === false ? parseAddressInput(command.text) : null;
        if (url) this.#showSite(url);
        else await this.#chat.submit(command.text);
        return;
      }
      case 'saveProfile': {
        const { country, region, city, ageRange } = command;
        const { termsAccepted, profile } = this.options.prefs.value;
        try {
          await this.options.prefs.update({ termsAccepted: TERMS_VERSION, profile: { country, region, city, ageRange } });
        } catch {
          // Lo que no quedó en disco tampoco vale en memoria: sin guardar no hay
          // condiciones aceptadas. La pantalla recibe el error y no se cierra.
          await this.options.prefs.update({ termsAccepted, profile }).catch(() => undefined);
          log('prefs.save_failed');
          throw new Error('PREFS_SAVE_FAILED');
        } finally {
          this.#publish();
        }
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
        this.#openDestination(candidate.url, command.guide ?? this.#wantGuide, this.#chat.goal);
        return;
      }
      case 'openFrequentSite': {
        // Solo un origen de la lista guardada, nunca uno que mande el renderer. Se abre con ayuda, como «Guíame».
        if (!topSites(this.options.prefs.value.frequentSites).some((s) => s.origin === command.origin)) return;
        this.#openDestination(`${command.origin}/`, true);
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
        this.#visitedOrigin = null;
        this.#protection.clear();
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
        // Lo que pidió no estaba entre las opciones: el backend investiga cómo se hace acá y la guía empieza sola.
        const goal = minimizeIntent(command.text, Limits.maxMessageLength);
        if (goal && this.#siteVisible && this.#guideAllowed()) this.#assistant.analyze(goal, goal);
        return;
      }
      case 'cardLayout':
      case 'siteCheckPopoverLayout':
      case 'siteCheckAnchor':
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
      case 'typeMyself':
        this.#assistant.typeMyself();
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
      // TODO(UI final): setAiForSite no tiene control en la UI de Guíame todavía.
      case 'setVoiceMode': {
        // Primero se guarda; si falla, no cambia nada y se avisa en la interfaz (el comando llega con `void`).
        await changeVoiceMode(this.#voiceMode, command.mode, {
          save: (mode) => this.options.prefs.update({ voiceMode: mode }),
          stopAll: () => this.#speech.stopAll(),
          publish: () => {
            // Se guardó: el aviso de un intento anterior ya no corresponde, y se va en la misma publicación.
            this.#notices = this.#notices.filter((n) => n.text !== VOICE_MODE_TEXTS.saveFailed);
            this.#publish();
          },
          failed: () => {
            log('prefs.error', { kind: 'kind:voiceMode' });
            this.#notify(VOICE_MODE_TEXTS.saveFailed, 'error');
          },
        });
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
      case 'siteCheckPanel':
        this.#protection.setPanelOpen(command.open);
        if (command.open) {
          // Al abrir, el foco entra al panel apenas su vista se muestra (#layout). Con la advertencia
          // abierta, el panel está en la ventana y toma el foco ahí.
          this.#focusPopover = !this.#protection.snapshot.warningOpen;
        } else if (command.restoreFocus) {
          // Escape, «Cerrar» o «Entendido»: el foco vuelve al indicador, en la barra o en la vista flotante.
          this.#focusPopover = false;
          this.#focusIndicator += 1;
          (this.#anchor.inline ? this.#ui : this.#popover.contents).focus();
          this.#publish();
        }
        return;
      case 'siteCheckRetry':
        this.#protection.retry();
        return;
      case 'siteCheckContinue':
        this.#protection.continueAnyway();
        return;
      case 'siteCheckLeave':
        this.#protection.setPanelOpen(false);
        this.#leaveSite();
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
