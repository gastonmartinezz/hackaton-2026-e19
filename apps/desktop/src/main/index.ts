/**
 * Proceso principal: arranque, endurecimiento global y elección del backend
 * (real por ASISTENTE_API_URL o simulado temporal).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { ApiClient } from './api/client';
import { startFixturesServer } from './api/fixtures-server';
import { HttpApiClient } from './api/http';
import { MockApiClient } from './api/mock';
import { AppController } from './app';
import { loadConfig } from './config';
import { log } from './log';
import { PrefsStore } from './prefs';

app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: AppController | undefined;
  let api: ApiClient | undefined;
  let closeFixtures: (() => void) | undefined;

  app.on('second-instance', () => {
    const win = controller?.window;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.whenReady().then(async () => {
    const config = loadConfig();
    if (config.useMockBackend) {
      const fixturesDir = join(app.getAppPath(), '../../tests/fixtures/pages');
      let fixturesOrigin: string | null = null;
      if (config.isDev && existsSync(fixturesDir)) {
        const server = await startFixturesServer(fixturesDir);
        fixturesOrigin = server.origin;
        closeFixtures = server.close;
      }
      api = new MockApiClient({ fixturesOrigin });
      log('app.backend', { mock: true });
    } else {
      api = new HttpApiClient({ baseUrl: config.apiBaseUrl!, token: config.apiToken });
      log('app.backend', { mock: false });
    }

    const prefs = new PrefsStore(app.getPath('userData'));
    await prefs.load();

    controller = new AppController({
      api,
      prefs,
      uiPreloadPath: join(import.meta.dirname, '../preload/ui.cjs'),
      pagePreloadPath: join(import.meta.dirname, '../preload/page.cjs'),
      rendererUrl: config.isDev ? (process.env.ELECTRON_RENDERER_URL ?? null) : null,
      rendererFile: join(import.meta.dirname, '../renderer/index.html'),
    });
    await controller.load();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', () => {
    closeFixtures?.();
    void api?.endSession();
  });
}
