/**
 * Controlador de la ventana: compone la interfaz propia, la vista del sitio, el
 * chat y el asistente; valida los comandos de la interfaz y publica el estado.
 */
import { randomUUID } from 'node:crypto';
import { sanitizeOrigin } from '@asistente/privacy';
import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import {
  UI_COMMAND_CHANNEL,
  UI_STATE_CHANNEL,
  UiCommandSchema,
  type AppState,
  type Notice,
  type NoticeAction,
  type UiCommand,
} from '../shared/ipc';
import { ApiSession, type ApiClient } from './api/client';
import { Assistant } from './assistant';
import { Chat } from './chat';
import { log } from './log';
import { PageBridge } from './page-bridge';
import type { PrefsStore } from './prefs';
import { SiteView } from './site-view';
import { classifyUrl, isLoopback, parseAddressInput } from './url-policy';

/** Igual que --chrome-h y --card-w de design/tokens.css, más el margen de la tarjeta. */
const chromeHeight = (scale: number) => Math.round(72 + (scale - 1) * 16);
const cardWidth = (scale: number) => Math.round(400 + (scale - 1) * 200);
const CARD_GAP = 24;
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
  #siteVisible = false;
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
    this.#bridge = new PageBridge(this.#site);
    const session = new ApiSession();
    this.#chat = new Chat(
      options.api,
      session,
      () => this.#publish(),
      (url) => this.#openDestination(url),
    );
    this.#assistant = new Assistant({ api: options.api, session, page: this.#bridge, onChange: () => this.#publish() });
    this.#wireSite();

    ipcMain.handle(UI_COMMAND_CHANNEL, (event, raw: unknown) => this.#onCommand(event, raw));
    this.window.on('resize', () => this.#layout());
    this.window.once('ready-to-show', () => this.window.show());
    this.window.on('closed', () => {
      ipcMain.removeHandler(UI_COMMAND_CHANNEL);
      this.#bridge.dispose();
    });
  }

  async load(): Promise<void> {
    if (this.options.rendererUrl) await this.window.loadURL(this.options.rendererUrl);
    else await this.window.loadFile(this.options.rendererFile);
    this.#layout();
    this.#publish();
  }

  /* --------------------------------- Estado -------------------------------- */

  #layoutSizes() {
    const scale = this.options.prefs.value.textScale;
    const [width] = this.window.getContentSize();
    return {
      topBarHeight: chromeHeight(scale),
      panelWidth: Math.min(cardWidth(scale) + CARD_GAP * 2, Math.round((width ?? 1280) * 0.5)),
    };
  }

  #layout(): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    const { topBarHeight, panelWidth } = this.#layoutSizes();
    this.#site.view.setBounds({ x: panelWidth, y: topBarHeight, width: Math.max(0, width - panelWidth), height: Math.max(0, height - topBarHeight) });
    this.#site.view.setVisible(this.#siteVisible);
  }

  #guideAllowed(): boolean {
    return GUIDE_ENABLED && this.options.prefs.isAiEnabled(this.#origin());
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
      layout: this.#layoutSizes(),
      prefs: { textScale: this.options.prefs.value.textScale, aiEnabledForSite: this.options.prefs.isAiEnabled(this.#origin()) },
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
        stepCount: guide.stepCount,
        message: guide.message ?? null,
        targetVisible: this.#assistant.targetVisible,
        partialPage: this.#assistant.partialPage,
      },
      notices: this.#notices.map(({ url: _url, ...notice }) => notice),
    };
  }

  /** Agrupa cambios en una sola publicación por vuelta del event loop. */
  #publish(): void {
    if (this.#publishScheduled) return;
    this.#publishScheduled = true;
    setImmediate(() => {
      this.#publishScheduled = false;
      if (this.window.isDestroyed()) return;
      this.window.webContents.send(UI_STATE_CHANNEL, this.#state());
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
    site.on('navigationStarted', () => this.#assistant.navigationStarted());
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
  #openDestination(url: string): void {
    this.#assistant.expectDestination(this.#chat.goal ?? '');
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
    wc.session.setPermissionRequestHandler((_c, _p, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
  }

  async #onCommand(event: IpcMainInvokeEvent, raw: unknown): Promise<void> {
    if (event.sender !== this.window.webContents || event.senderFrame !== event.sender.mainFrame) return;
    const parsed = UiCommandSchema.safeParse(raw);
    if (!parsed.success) {
      log('ui.invalid_command');
      return;
    }
    await this.#run(parsed.data);
  }

  async #run(command: UiCommand): Promise<void> {
    switch (command.type) {
      case 'ready':
        this.#publish();
        return;
      case 'submitIntent':
        await this.#chat.submit(command.text);
        return;
      case 'resetChat':
        // Empezar de nuevo descarta la sesión: la guía no puede seguir con la anterior.
        this.#assistant.exit();
        this.#chat.reset();
        return;
      case 'openCandidate': {
        // La URL sale del resultado recibido, nunca del renderer.
        const candidate = this.#chat.candidate(command.candidateId);
        if (!candidate) return;
        this.#openDestination(candidate.url);
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
        this.#assistant.exit();
        this.#chat.reset();
        this.#siteVisible = false;
        this.#site.clear();
        this.#notices = [];
        this.#layout();
        this.#publish();
        return;
      case 'analyzePage':
        if (this.#siteVisible && this.#guideAllowed()) this.#assistant.analyze(this.#chat.goal ?? undefined);
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
        this.#assistant.exit();
        return;
      case 'confirmDone':
        this.#assistant.confirmDone();
        return;
      case 'retry':
        this.#assistant.retry();
        return;
      // TODO(UI final): setAiForSite no tiene control en la UI de Mostrame todavía.
      case 'setTextScale':
        await this.options.prefs.update({ textScale: command.scale });
        this.#layout();
        this.#publish();
        return;
      case 'setAiForSite': {
        const origin = this.#origin();
        if (!origin) return;
        await this.options.prefs.setAiEnabled(origin, command.enabled);
        if (command.enabled && GUIDE_ENABLED) this.#assistant.analyze(this.#chat.goal ?? undefined);
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

async function openExternally(url: string): Promise<void> {
  const verdict = classifyUrl(url);
  if (verdict.kind === 'allow') await shell.openExternal(verdict.url.toString());
}
