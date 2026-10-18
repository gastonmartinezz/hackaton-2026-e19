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
- **`POST /v1/options`** (`src/main/assistant.ts`): se envía un HTML sintético armado con el snapshot depurado (`snapshotToHtml`), con un `id="el-N"` por elemento y nunca el HTML real. Se envía también `metadata.page` (título depurado con `sanitizeTitle` e idioma). Si la guía tiene objetivo (el del chat o lo que la persona escribió en «¿No está lo que buscás?», depurado con `minimizeIntent`), se envía como `goal`. Cada opción trae su guía completa (`steps`).
- **Guía** (`@asistente/guidance`):
  - **Pasos reales:** se muestran uno tras otro sin llamar al backend.
  - **Paso teórico** (`element: null`): después de la acción se extrae la página y se llama a `POST /v1/next-step` con `expectedStep` y los `completedSteps`. `done: true` termina la tarea.
  - **Navegación:** los `#el-N` que quedaban en el plan pertenecen al documento anterior, así que se vuelven a pedir.
  - **Teórico otra vez:** si `next-step` devuelve otro paso teórico, se muestra solo la instrucción y se espera que la persona navegue o toque «Ya lo hice».

## Protección de sitios (`POST /v1/site-check`)

Spec: `proteccion-sitios-agentes.md`. Contrato: `packages/contracts/src/site-check.ts`. El estado del indicador sale siempre de `siteIndicatorState()` del contrato (cobertura mínima acordada con backend).

**Flujo** (`src/main/site-protection/coordinator.ts`):

1. `did-start-navigation` (frame principal, otro documento) o una redirección del servidor → `navigationId` nuevo. El estado anterior se borra al instante: queda «Revisando sitio…», el panel se cierra y las respuestas viejas se descartan.
2. **Fase dirección**: `contentVersion: 0`, sin `page`, con la URL depurada (`sanitizeUrl`: sin usuario/clave, secretos de path/query/fragmento como `[dato]`), hostname y dominio registrable aproximado (el backend lo recalcula).
3. `dom-ready` + 400 ms → el preload arma el `PageSummary` (`extractPageSummary` en `@asistente/page-analyzer`) y el principal lo vuelve a depurar (`resanitize.ts`) → **fase contenido** `contentVersion: 1`.
4. **Reanálisis** (versión +1): cambio de ruta SPA (`did-navigate-in-page`) o cambio de la huella de formularios/identidad que calcula el preload (`pageSignature`, solo un hash). Debounce 1,5 s, separación mínima 5 s, tope 6 por navegación. Un cambio de ruta pone «Revisando sitio…» salvo que haya un riesgo detectado.
5. **Respuestas**: se descartan las de otra navegación y las de una versión anterior a la última pedida (salvo que traigan un riesgo mayor que el mostrado: aviso temprano). Dentro de una navegación el riesgo no baja. Error, tiempo vencido (15 s), resumen imposible o contenido «pendiente» sin nada en curso (20 s) → «No pudimos verificarlo».
6. **Direcciones locales** (`localhost`, `127.0.0.0/8`, redes privadas, link-local, CGNAT, `::1`, `fc00::/7`, nombres sin punto, `.local`, `.internal`, `.test`, `.home.arpa`…) no se envían: «Página local, sin revisar». `about:`/`file:`/páginas internas no muestran indicador. Una IPv6 pública no entra en el `Hostname` del contrato: «No pudimos verificarlo» sin enviar.

**Qué se envía** (siempre sin valores de formularios, cookies, almacenamiento, tokens ni historial): título y marca declarada depurados; texto visible por bloque, redactado (`redactText`) y acotado a 4000 caracteres, sin saludos personalizados ni texto editable; formularios con tipo, etiqueta y `autocomplete` de cada campo, método y destino depurado; hasta 50 enlaces (primero los que van a otro sitio o muestran una dirección, cuyo texto queda solo como hostname); hostnames de scripts e iframes.

**Interfaz** (`src/renderer/src/SiteCheck.tsx` y `site-check.css` con los tokens de `design/tokens.css`; textos en `src/shared/site-check-copy.ts`, también agregados a `design/textos.es.json` bajo `proteccion.*`):

- Indicador dentro de la píldora «Estás en» de la barra (`TopBar.tsx`), al lado del dominio, sin mover Ayuda ni Tamaño de letra: botón con ícono Lucide + texto siempre («Revisando sitio…», «Sitio oficial», «Sin alertas detectadas», «Atención», «Posible estafa», «No pudimos verificarlo», «Página local, sin revisar»). Nunca «seguro». El candado (muted) solo aparece con HTTPS y significa conexión cifrada. El dominio principal tiene prioridad: con poco lugar se oculta «Estás en», la conexión no segura queda como ícono (el aviso completo está en la tarjeta; `useDomainFit`) y, si el indicador igual no entra, pasa a una franja justo debajo de la píldora (`useIndicatorFits`). Solo si el dominio tampoco entra así se recorta por el principio («…demo.gub.uy»), para que la terminación siempre se vea.
- «Sitio oficial» sale solo de la fuente de autoridad del contrato (`identity.basis`), nunca de la IA: `government_domain` («Es un sitio del [Estado uruguayo | Gobierno de Estados Unidos]: su dirección termina en .gub.uy, que solo pueden usar organismos públicos.», con la organización recibida y la terminación real del hostname: .gub.uy, .mil.uy, .gov o .mil), `financial_regulator` («La dirección pertenece a [organización], según el registro de instituciones del Banco Central del Uruguay.», con el registro de instituciones del BCU como fuente) u `official_catalog` («La dirección pertenece a [organización], según nuestra lista de sitios oficiales revisada.», p. ej. Antel, UTE, BROU). «Ver por qué» dice cómo lo sabemos según `basis`, la fuente real (`identity.source.name`, con el dominio de `source.url` como texto, sin enlace que saque de la tarea) y «Revisado el …» con `source.reviewedAt` (la fecha de la fuente, no la de la consulta; «17 de octubre de 2026», en UTC y con `es-UY`, o `es-AR` si el runtime no trae `es-UY`, que da el mismo formato).
- Panel al pulsarlo: franja anclada debajo de la barra, alineada con la píldora; la vista del sitio y la tarjeta de ayuda (vistas nativas, encima de la interfaz) bajan según el alto que mide el renderer (`siteCheckOverlay`), así la página no puede taparlo. Título, una o dos frases, acción principal, «Ver por qué» cerrado (motivos por `ReasonCode` en lenguaje simple, nota de revisión incompleta y, como complemento, la `explanation` de la IA). Escape cierra y devuelve el foco.
- Riesgo alto: advertencia en el área del sitio (la vista del sitio y la tarjeta flotante se ocultan mientras está abierta). «Salir de este sitio» vuelve a la entrada anterior del historial que no sea del mismo dominio ni de un host con «Posible estafa»/«Atención», o al inicio; si el aviso llegó antes de mostrar la página, detiene la carga. «Continuar de todos modos» está después de los detalles. No se repite en la misma navegación salvo que aparezcan motivos de fraude nuevos. La guía (`isSensitiveStep` de `@asistente/guidance`) pausa los pasos que piden datos o confirmar operaciones mientras dure el riesgo alto: la tarjeta muestra «Pausé esta indicación» con «Salir de este sitio» (sin achicarse ni mostrar la instrucción); los pasos de navegación siguen.
- Accesibilidad: foco visible, áreas de 44 px × escala, `aria-expanded`/`aria-controls`, `role="dialog"` y `alertdialog`, anuncio `aria-live` solo cuando cambia el estado de forma relevante (no en cada reanálisis). Respeta el tamaño de letra.
- Los resultados favorables no abren nada. No se interceptan ni bloquean envíos de formularios.

**Ver cada estado con el simulador** (`pnpm dev:desktop` sin `ASISTENTE_API_URL`): en desarrollo `*.example` y `*.mostrame-demo.gub.uy` resuelven al servidor de fixtures (`host-resolver-rules`, puerto 47321 si está libre). Escribí «protección» en el inicio o abrí `http://127.0.0.1:47321/proteccion.html` (ella misma se ve como página local), que enlaza:

| Dirección | Estado |
|---|---|
| `banco-demo.example/banco.html` | Sitio oficial por el registro de instituciones del BCU (`financial_regulator`, Banco de Demostración; fuente «Registro de instituciones del BCU, simulado», bcu.gub.uy) |
| `tramites.mostrame-demo.gub.uy/horarios.html` | Sitio oficial por la zona reservada al Estado (`.gub.uy`, Estado uruguayo) |
| `usina-uy.example/horarios.html` | Sitio oficial por la lista curada (`official_catalog`, empresa uruguaya de demostración) |
| `sin-alertas.example/horarios.html` | Sin alertas detectadas |
| `sin-alertas.example/cambiante.html` | Sin alertas → Atención al agregar un campo de contraseña; el botón de pago cambia la ruta (SPA) |
| `atencion.example/urgente.html` | Atención |
| `bancodemo-acceso.example/banco-falso.html` | Posible estafa por imitación, ya en la fase dirección |
| `premio-gratis.example/premio.html` | Posible estafa por malware (sin «parece imitar») |
| `falla.example/…` · `parcial.example/…` | No pudimos verificarlo (error del servicio · cobertura parcial) |
| `lenta.example/…` · `sin-respuesta.example/…` | Revisando 6 s y luego Sin alertas · vence el tiempo máximo |

Cualquier otro sitio con el simulador da «No pudimos verificarlo»: no consulta fuentes reales y nunca aprueba lo que no conoce.

**Limitaciones de acceso al contenido** (arquitectura actual):

- Solo se lee el documento principal y el shadow DOM abierto. Los iframes (sobre todo cross-origin) no se leen: solo se informa su host. El shadow DOM cerrado, el canvas y el contenido dibujado como imagen no se ven.
- El texto se acota a 4000 caracteres y 20 000 elementos recorridos; en páginas largas puede quedar afuera lo relevante.
- Lo que ve la persona puede diferir de lo que vería un escáner del backend (sesión, cookies, ubicación, A/B). El resumen describe lo observado en el navegador de la persona.
- Un cambio sin cambio de formularios ni identidad (p. ej. solo texto nuevo) no dispara reanálisis; tampoco más de 6 por navegación.
- Entre la carga y la respuesta de contenido hay un intervalo en el que la página es usable con «Revisando sitio…».
- La detección de datos personales en el texto es heurística (la misma de `@asistente/privacy`), y las URLs se depuran de forma conservadora (se ocultan todos los valores de la query).
- A 1,75× (y en ventanas angostas, cerca de 900 px) un dominio muy largo puede no entrar en la píldora aunque el indicador vaya en la franja: es un límite de la barra actual, no del indicador.

## Estructura

```text
src/main/        proceso principal: ventana, vista del sitio, políticas, IPC, cliente API, orquestador
  app.ts         composición, comandos validados de la UI, publicación del estado
  site-view.ts   navegación, ventanas nuevas, permisos, descargas y protocolos externos
  page-bridge.ts IPC con el preload de la página (valida emisor, frame y esquema)
  assistant.ts   efectos de la máquina de estados (@asistente/guidance)
  chat.ts        chat de la home: /v1/interpret (redirect, options, question)
  site-protection/  protección de sitios: coordinador, elegibilidad de direcciones, nueva depuración
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
