# Guíame para Android (spike)

Prueba de concepto: ¿se puede guiar a la persona dentro de un sitio real en un teléfono Android, reutilizando lo que ya hace la app de escritorio? Responsable: Gastón (navegador y cliente).

## Cómo está armado

| Parte | Escritorio (Electron) | Android (este spike) |
|---|---|---|
| Vista del sitio | `WebContentsView` | `WebView` |
| Código dentro de la página | preload `apps/desktop/src/preload/page` | `web/page-agent.ts` → `app/src/main/assets/page-agent.js`, **con los mismos módulos** (extracción, resaltado «Acá», dictado, clic, observador) |
| Comunicación | `ipcRenderer` | `GuiameAndroid.postMessage` (página → app) y `evaluateJavascript` (app → página) |
| Lógica de la guía | `src/main/assistant.ts` | `GuiameViewModel.kt` (versión reducida) |
| Tarjeta y barra | React (`packages/ui`) | Jetpack Compose, con los valores de `design/tokens` |
| API | la misma | la misma (`/v1/interpret`, `/v1/options`, `/v1/next-step`) |

En teléfono, la tarjeta flotante queda **fija abajo** y el sitio ocupa el espacio de arriba. Así nunca tapa el control resaltado. Se puede achicar para ver más del sitio.

**Tamaño de letra:** el botón «Letra» escala toda la capa Guíame (de 1× a 2×) y, con `textZoom`, también el texto del sitio. Al abrir la app arranca con la letra del teléfono (mínimo 1.2×, como los diseños). Los botones crecen con el texto en vez de cortarlo.

### Qué hay en el spike

- Inicio con buscador, preguntas con respuestas en botones y «No sé bien», y elección de sitio.
- Sitio abierto: opciones de la página, resaltado del control y avance con `/v1/next-step` hasta «Listo» o «¿Pudiste terminar?».
- Dato sensible: solo pone el cursor y muestra «Lo escribís vos. Yo no lo veo ni lo guardo.».
- Test de privacidad (`web/page-agent.test.ts`): los valores de los campos no cruzan el puente.

### Qué no hay todavía

Voz («Hablar» y dictado), «Tocá … por mí», Protección de sitios y sellos, historial del inicio, diálogo de pago (C10/C15), velo del sitio y diseño de teléfono. Los textos que no salen de `design/` están marcados `TODO(copy)`.

### Riesgos

- **Sin mundo aislado.** En escritorio el preload corre aparte de la página. En Android el agente corre **en el mismo contexto que la página**, así que un sitio podría ver el puente y mandar mensajes falsos. Mitigaciones del spike: el receptor de comandos no se puede reemplazar, Kotlin solo acepta canales conocidos y de tamaño limitado, y ninguna acción sobre el sitio sale de un mensaje de la página. Para producción hay que revisarlo con cuidado.
- **Política de Google Play:** una app que inyecta código y lee páginas de terceros necesita una política de privacidad clara y la declaración de seguridad de datos.

## Cómo probarlo sin un teléfono Android

Se usa el **emulador de Android Studio**, un teléfono virtual que corre en la Mac.

### 1. Instalar Android Studio (una sola vez)

```sh
brew install --cask android-studio
```

O se baja de <https://developer.android.com/studio>. Al abrirlo por primera vez, el asistente instala el SDK y el emulador: aceptá las opciones por defecto (**Standard**).

### 2. Crear el teléfono virtual (una sola vez)

En Android Studio: **More Actions → Virtual Device Manager → Create device** (o el ícono de teléfono a la derecha si ya tenés un proyecto abierto).

1. Elegí **Pixel 8** (o cualquier teléfono).
2. Imagen del sistema: **API 35** con **Google APIs**. En una Mac con chip Apple usá la versión **arm64**.
3. **Finish** y ▶ para encenderlo.

### 3. Compilar el agente de página

Desde la raíz del repo:

```sh
pnpm install
pnpm --filter @asistente/android build   # genera app/src/main/assets/page-agent.js
```

Hay que repetirlo cada vez que cambia `web/page-agent.ts` o los módulos de escritorio que usa. Si falta el archivo, Android Studio avisa con este mismo comando.

### 4. Levantar la API

```sh
cp apps/api/.env.example apps/api/.env   # solo la primera vez
pnpm dev:api
```

Dentro del emulador, **`10.0.2.2` es la Mac**: la app usa `http://10.0.2.2:3000` y el token de desarrollo de `.env.example`. Con `AI_PROVIDER=mock` las respuestas son simuladas. Para guiar en sitios reales, poné `AI_PROVIDER=anthropic` y `ANTHROPIC_API_KEY` en `apps/api/.env`.

Para usar otra API (por ejemplo la de Railway), creá `apps/android/local.properties` (no se sube a git):

```properties
guiame.apiUrl=https://tu-api.up.railway.app
guiame.apiToken=el-token
```

### 5. Abrir y correr la app

1. Android Studio → **Open** → elegí la carpeta `apps/android`.
2. Esperá la sincronización de Gradle. La primera vez baja dependencias y tarda unos minutos.
3. Con el emulador encendido, tocá ▶ **Run 'app'**.

### 6. Probar con letra grande

- Dentro de la app: botón **Letra** en la barra.
- En el teléfono virtual: **Configuración → Pantalla → Tamaño de fuente** al máximo (o `adb shell settings put system font_scale 2.0`). La app toma esa letra al abrirse.

### Si más adelante querés un teléfono real

Activá **Opciones de desarrollador → Depuración USB** en el teléfono, conectalo por USB y aparece en Android Studio junto al emulador. Para la API usá la de Railway (ver paso 4), porque `10.0.2.2` solo existe en el emulador.

## Comandos

```sh
pnpm --filter @asistente/android build      # agente de página
pnpm --filter @asistente/android test       # tests del agente (privacidad)
pnpm --filter @asistente/android typecheck
```
