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

/** Puerto preferido de las páginas de prueba (direcciones de demostración estables). */
const FIXTURES_PORT = 47_321;

app.enableSandbox();

const config = loadConfig();
if (config.useMockBackend && config.isDev) {
  // Protección de sitios: las páginas de demostración usan nombres reservados
  // `*.example` (nunca resuelven en internet) que en desarrollo apuntan al
  // servidor local de fixtures. Así el backend simulado ve un hostname público
  // y se puede ver cada estado del indicador. Solo con el backend simulado.
  // `*.mostrame-demo.gob.ar` y `*.mostrame-demo.gub.uy` muestran «Sitio oficial» del Estado con su terminación real.
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.example 127.0.0.1, MAP *.mostrame-demo.gob.ar 127.0.0.1, MAP *.mostrame-demo.gub.uy 127.0.0.1');
}

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
    if (config.useMockBackend) {
      const fixturesDir = join(app.getAppPath(), '../../tests/fixtures/pages');
      let fixturesOrigin: string | null = null;
      if (config.isDev && existsSync(fixturesDir)) {
        const server = await startFixturesServer(fixturesDir, FIXTURES_PORT);
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
      system: {
        language: app.getPreferredSystemLanguages()[0] ?? app.getLocale(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        country: /^[A-Z]{2}$/.test(app.getLocaleCountryCode()) ? app.getLocaleCountryCode() : null,
      },
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
  });
}
