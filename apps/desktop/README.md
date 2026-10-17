# @asistente/desktop — cliente Electron (área de Gaston)

Navegador con el sitio real en una `WebContentsView` y un panel de ayuda al costado. Cubre S01, S02 y S03 del lado cliente, S04, S05 local, S07 a S09 del lado local, S11 (comportamiento de la UI de prueba) y el empaquetado técnico de S12.

## Uso

```sh
pnpm install
pnpm dev:desktop  # desde la raíz: abre la app en modo desarrollo (backend simulado local)

# Contra el backend (apps/api, con AI_PROVIDER=mock no llama a Claude):
pnpm dev          # en otra terminal: API en http://localhost:3000
ASISTENTE_API_URL=http://localhost:3000 \
ASISTENTE_API_TOKEN=dev-token-solo-para-desarrollo-local \
pnpm dev:desktop
pnpm test         # pruebas de todos los paquetes
pnpm typecheck
pnpm --filter @asistente/desktop package   # instalador sin firmar (release/)
```

| Variable | Efecto |
|---|---|
| `ASISTENTE_API_URL` | URL base del backend de Agustin. Exige HTTPS, salvo en localhost. Si no se define, la app usa el **backend simulado temporal** (`src/main/api/mock.ts`) y sirve las páginas de `tests/fixtures/pages` en 127.0.0.1 |
| `ASISTENTE_API_TOKEN` | Se envía como `Authorization: Bearer`. Obligatorio contra el backend real (uno de `API_ACCESS_TOKENS` de `apps/api/.env`) |

## Conexión con el backend (ver `docs/api.md`)

- **Sesión única** (`ApiSession`): la crea `POST /v1/interpret` y se reutiliza en `/v1/options` y `/v1/next-step`. Ante `SESSION_NOT_FOUND`, el chat reenvía el historial sin sesión. Si pasa durante la guía, se vuelve a analizar la página. «Inicio» la descarta.
- **`POST /v1/interpret`** (`src/main/chat.ts`): un solo input. `redirect` abre la página; `question` y `options` convierten la home en chat. Los mensajes de la persona se minimizan antes de salir del equipo.
- **`POST /v1/options`** (`src/main/assistant.ts`): se envía un HTML sintético armado con el snapshot depurado (`snapshotToHtml`), con un `id="el-N"` por elemento y nunca el HTML real. Se envía también `metadata.page` (título depurado con `sanitizeTitle` e idioma). Cada opción trae su guía completa (`steps`).
- **Guía** (`@asistente/guidance`):
  - **Pasos reales:** se muestran uno tras otro sin llamar al backend.
  - **Paso teórico** (`element: null`): después de la acción se extrae la página y se llama a `POST /v1/next-step` con `expectedStep` y los `completedSteps`. `done: true` termina la tarea.
  - **Navegación:** los `#el-N` que quedaban en el plan pertenecen al documento anterior, así que se vuelven a pedir.
  - **Teórico otra vez:** si `next-step` devuelve otro paso teórico, se muestra solo la instrucción y se espera que la persona navegue o toque «Ya lo hice».

## Estructura

```text
src/main/        proceso principal: ventana, vista del sitio, políticas, IPC, cliente API, orquestador
  app.ts         composición, comandos validados de la UI, publicación del estado
  site-view.ts   navegación, ventanas nuevas, permisos, descargas y protocolos externos
  page-bridge.ts IPC con el preload de la página (valida emisor, frame y esquema)
  assistant.ts   efectos de la máquina de estados (@asistente/guidance)
  chat.ts        chat de la home: /v1/interpret (redirect, options, question)
  api/           cliente HTTP, backend simulado TEMPORAL y servidor de fixtures
src/preload/ui.ts         puente mínimo para la interfaz propia (contextBridge)
src/preload/page/         extractor, resaltado y observador. No expone nada a la página
src/renderer/             UI básica de prueba (React). La reemplaza la UI final de Emi
src/shared/ipc.ts         contrato IPC interno (no es el contrato con el backend)
```

La lógica no depende de la UI. El renderer solo recibe `AppState` y envía `UiCommand`, así que se puede reemplazar sin tocar el proceso principal.

## Seguridad

- Las dos vistas corren con `sandbox`, `contextIsolation`, sin `nodeIntegration` y con `webSecurity`. El sandbox también está activo globalmente (`app.enableSandbox()`).
- Los mensajes IPC se validan con Zod y además por `sender` y `senderFrame`. Los mensajes del documento anterior se descartan mientras hay una navegación en curso.
- Política de navegación:
  - Se permite HTTPS. HTTP se permite con un aviso visible.
  - Se bloquean `javascript:`, `file:`, `data:` y los demás esquemas.
  - `mailto:`/`tel:` muestran un aviso.
  - Las ventanas nuevas no se abren solas: se ofrece abrirlas en la app o en el navegador del sistema.
  - Los permisos se deniegan con aviso y las descargas se cancelan con aviso.
- La URL para abrir un destino sale siempre del resultado guardado en el proceso principal, nunca del renderer.
- CSP estricta en la interfaz propia.

## Privacidad

- El snapshot se arma por lista de campos permitidos. Nunca se lee `.value`, la opción seleccionada ni el texto editable.
- Las etiquetas se depuran en el preload y otra vez en el proceso principal.
- Del sitio no se envía la URL ni el origen; solo el HTML sintético con rol, etiqueta depurada y estado de cada elemento.
- La intención escrita se minimiza antes de enviarla.
- Los logs registran eventos, códigos y cantidades. No registran URLs, etiquetas ni textos.

## Limitaciones conocidas

- Solo se analiza el documento principal y el shadow DOM abierto. Los iframes, el canvas y el shadow DOM cerrado marcan la extracción como `partial`.
- Un "cambio de página" cuenta si se agregan o quitan elementos. Una página con carruseles que cambian el DOM puede adelantar un paso que esperaba `pageChange`.
- La detección de datos personales en las etiquetas es heurística: correos, números largos, tokens, URLs y saludos personalizados.
- Faltan firma y notarización de instaladores, actualizaciones automáticas y pruebas Playwright contra Electron.
