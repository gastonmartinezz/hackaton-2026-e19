/**
 * Vista del sitio externo (S01). WebContentsView con sandbox, sin Node y con
 * sesión persistente propia (cookies locales). Aplica políticas explícitas de
 * navegación, ventanas nuevas, permisos, descargas y protocolos externos.
 */
import { EventEmitter } from 'node:events';
import { session as electronSession, WebContentsView, type Session } from 'electron';
import { log } from './log';
import { classifyUrl } from './url-policy';

export const SITE_PARTITION = 'persist:sitios';

export interface SiteViewEvents {
  /** Empezó una navegación de documento nuevo en el frame principal. */
  navigationStarted: [];
  /** El documento nuevo está listo (o hubo navegación dentro de la misma página). */
  navigated: [{ url: string; sameDocument: boolean }];
  stateChanged: [];
  popup: [{ url: string }];
  externalProtocol: [{ scheme: string }];
  blocked: [];
  download: [];
  permissionDenied: [{ permission: string }];
}

export class SiteView extends EventEmitter<SiteViewEvents> {
  readonly view: WebContentsView;
  readonly session: Session;
  loading = false;
  error: string | null = null;
  /** Hay una navegación de documento en curso: se ignoran mensajes del documento viejo. */
  navigating = false;

  constructor(preloadPath: string) {
    super();
    this.session = electronSession.fromPartition(SITE_PARTITION);
    this.#configureSession();
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        partition: SITE_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
      },
    });
    this.#configureContents();
  }

  get contents() {
    return this.view.webContents;
  }

  get url(): string {
    return this.contents.getURL();
  }

  navigate(url: string): boolean {
    const verdict = classifyUrl(url);
    if (verdict.kind !== 'allow') {
      if (verdict.kind === 'external') this.emit('externalProtocol', { scheme: verdict.scheme });
      else this.emit('blocked');
      return false;
    }
    this.error = null;
    void this.contents.loadURL(verdict.url.toString()).catch(() => {
      // El error se informa por did-fail-load.
    });
    return true;
  }

  back(): void {
    if (this.contents.navigationHistory.canGoBack()) this.contents.navigationHistory.goBack();
  }

  forward(): void {
    if (this.contents.navigationHistory.canGoForward()) this.contents.navigationHistory.goForward();
  }

  reload(): void {
    this.error = null;
    this.contents.reload();
  }

  clear(): void {
    this.error = null;
    void this.contents.loadURL('about:blank');
    this.contents.navigationHistory.clear();
  }

  #configureSession(): void {
    const s = this.session;
    // Permisos denegados por defecto; se avisa para que no sea un bloqueo silencioso.
    s.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(false);
      this.emit('permissionDenied', { permission });
    });
    s.setPermissionCheckHandler(() => false);
    s.setDevicePermissionHandler(() => false);
    s.on('will-download', (event, item) => {
      event.preventDefault();
      item.cancel();
      this.emit('download');
    });
  }

  #configureContents(): void {
    const wc = this.contents;

    wc.setWindowOpenHandler(({ url }) => {
      const verdict = classifyUrl(url);
      if (verdict.kind === 'allow') this.emit('popup', { url: verdict.url.toString() });
      else if (verdict.kind === 'external') this.emit('externalProtocol', { scheme: verdict.scheme });
      return { action: 'deny' };
    });

    const guard = (event: { preventDefault(): void; url: string; isMainFrame: boolean }) => {
      if (event.url === 'about:blank') return;
      const verdict = classifyUrl(event.url);
      if (verdict.kind === 'allow') return;
      event.preventDefault();
      if (verdict.kind === 'external' && event.isMainFrame) this.emit('externalProtocol', { scheme: verdict.scheme });
      else if (event.isMainFrame) this.emit('blocked');
    };
    wc.on('will-frame-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-attach-webview', (event) => event.preventDefault());

    wc.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (!isMainFrame || isSameDocument) return;
      this.navigating = true;
      this.emit('navigationStarted');
    });
    wc.on('did-start-loading', () => {
      this.loading = true;
      this.emit('stateChanged');
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      this.emit('stateChanged');
    });
    wc.on('dom-ready', () => {
      this.navigating = false;
      if (wc.getURL() !== 'about:blank') this.emit('navigated', { url: wc.getURL(), sameDocument: false });
      this.emit('stateChanged');
    });
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.emit('navigated', { url, sameDocument: true });
      this.emit('stateChanged');
    });
    wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      // -3 = navegación abortada (reemplazada por otra); no es un error para mostrar.
      if (!isMainFrame || code === -3) return;
      this.navigating = false;
      this.error = code <= -200 && code > -300
        ? 'El sitio tiene un problema de seguridad en su certificado y no se abrió.'
        : 'No se pudo abrir la página. Revisá la conexión o probá de nuevo.';
      log('site.load_failed', { code });
      this.emit('stateChanged');
    });
    wc.on('render-process-gone', (_event, details) => {
      this.error = 'La página dejó de responder. Probá recargarla.';
      log('site.crashed', { code: `code:${details.reason}` });
      this.emit('stateChanged');
    });
  }
}
