# Navegador asistido para personas mayores

Documento de producto y arquitectura para orientar el desarrollo con IA.
Versión 1.4 · 17 de octubre de 2026

## 0. Responsabilidades y límites de trabajo

Esta sección gobierna la división del trabajo. Cada IA debe recibir este documento y el nombre de la persona a quien asiste. Leer el contexto completo no autoriza a modificar las áreas de otra persona. Si no se indica para quién trabaja la IA, debe solicitar ese dato antes de editar código.

### Agustin — backend, Claude y despliegue del servidor

Responsable de Node.js y TypeScript en el servidor; endpoints; integración con Claude; prompts e instrucciones de respuesta; generación y validación del JSON; interpretación de intenciones; integración del buscador y selección de destinos desde el backend; gestión de secretos, límites, logs y errores del servidor; infraestructura y despliegue de todo lo necesario para el backend.

Entregables: API documentada, esquemas versionados, ejemplos de solicitudes y respuestas, respuestas simuladas, configuración por entorno, pruebas del servidor e instrucciones de despliegue. Debe proporcionar a Gaston URL base, requisitos de autenticación y formato de errores, sin compartir secretos en el código del cliente.

Fuera de su área: extracción del DOM, filtrado previo al envío desde el dispositivo, IPC de Electron, overlays, navegación local, implementación visual del chat y diseño final. Puede proponer cambios en estas áreas y acordarlos con Gaston, pero no implementarlos unilateralmente.

### Gaston — navegador, análisis local e integración funcional

Responsable de la aplicación Electron; interpretación estructural de la página actual; extracción de controles y referencias; eliminación y minimización de información antes de enviarla; conexión con el backend de Agustin; recepción y validación local del JSON; sistema que transforma instrucciones permitidas en indicaciones visuales; observación de cambios y continuidad de la guía.

También implementa el chat funcional de la home: entrada de intención, mensajes, aclaraciones, opciones de sitios, estados de carga y errores, apertura del destino y continuidad del objetivo. El chat consume el backend de Agustin; no llama directamente a Claude ni guarda sus claves.

Entregables: navegador funcional con UI básica de prueba, extractor, filtro local de privacidad, cliente API, ejecutor visual, máquina de estados local y pruebas del cliente. La UI básica debe permitir probar todos los flujos y poder reemplazarse sin reescribir la lógica.

Fuera de su área: backend productivo, prompts de Claude, despliegue del servidor, marca y diseño definitivo. Puede usar mocks del backend ajustados al contrato; no crear una implementación paralela del servidor o una identidad visual definitiva.

### Emi — UI final, marca y negocio

Responsable de diseño de experiencia y UI final, identidad de marca, lenguaje visual y modelo de negocio. Otras responsabilidades de producto o negocio se definirán explícitamente; “mucho más” no constituye una asignación técnica automática.

Su trabajo de UI se desarrolla fuera del repositorio técnico en esta etapa. Reemplazará la UI básica utilizada por Gaston para probar funcionalidades. Este documento no prescribe la herramienta o formato de sus entregables.

Entregables esperados para la integración: pantallas, componentes, estados de interacción, reglas de accesibilidad, recursos de marca y especificaciones visuales. Se debe contemplar carga, error, aclaración, guía activa, tarea completada y página no soportada, además del estado ideal.

Fuera de su área: extracción, API, integración con Claude, contratos técnicos y lógica del navegador. La IA de Agustin o Gaston no debe generar un diseño final, marca, precios o modelo de negocio en su nombre.

La persona que incorporará la UI final al repositorio queda por definir. Gaston prepara la separación entre lógica y presentación; esto no le asigna automáticamente toda la implementación del diseño de Emi.

### Matriz de responsabilidad por sistema

| Sistema | Responsable de implementación | Límite o coordinación |
|---|---|---|
| S01 Navegador y sesiones | Gaston | Emi define la experiencia visual final |
| S02 Inicio por intención | Gaston: chat y flujo local; Agustin: interpretación en servidor | Emi diseña la experiencia final |
| S03 Búsqueda y destino | Agustin: búsqueda y selección; Gaston: presentación funcional y apertura | Respuestas y errores mediante contrato |
| S04 Extracción local | Gaston | Agustin consume el snapshot; no extrae DOM remoto |
| S05 Privacidad | Gaston: filtro antes del envío; Agustin: tratamiento, retención y logs del servidor | El filtrado en servidor no reemplaza el filtrado local |
| S06 Opciones de página | Agustin: Claude y JSON; Gaston: evidencia local y presentación | IDs y revisión acordados |
| S07 Planificador de guía | Agustin: decisión del siguiente paso; Gaston: estado y validación local | División inicial, ampliable por acuerdo explícito |
| S08 Ejecutor visual | Gaston | Agustin define con Gaston las instrucciones admitidas; Emi diseña su apariencia final |
| S09 Observador y verificación | Gaston: observación y comprobación local; Agustin: nueva decisión si se solicita | No transmitir valores al verificar |
| S10 Orquestación de Claude | Agustin | Gaston consume API y mocks |
| S11 Accesibilidad y experiencia | Emi: diseño; Gaston: comportamiento accesible de la UI de prueba | Integración de UI final por asignar |
| S12 Operación y distribución | Agustin: backend; Gaston: empaquetado técnico del cliente | Publicación, firma y distribución final del cliente por confirmar |

### Frontera acordada para JSON y apartado visual

La división inicial es: Agustin produce el significado de la respuesta y la siguiente indicación en el servidor; Gaston valida y ejecuta esa indicación visualmente en el dispositivo. Ambos acuerdan el contrato. Emi define la apariencia final. La posibilidad de dividir más trabajo entre Gaston y Agustin no autoriza a una IA a reasignarlo por su cuenta.

Ejemplo: Agustin devuelve “resaltar el-12” con una instrucción. Gaston comprueba que el-12 exista en la revisión actual y muestra la ayuda. Emi define el aspecto del resaltado, el panel y los mensajes dentro de la experiencia final.

### Contratos compartidos y coordinación

Agustin y Gaston acuerdan conjuntamente PageSnapshot, PageOption, GuideDecision, endpoints, errores, versiones, IDs y señales de avance. Agustin mantiene los esquemas de API publicados; Gaston mantiene el extractor y las validaciones locales compatibles. Esa distribución de mantenimiento no permite cambiar unilateralmente el contrato.

Antes de un cambio incompatible, documentar la propuesta, ejemplo de entrada/salida y efecto en ambos lados. Hasta acordarlo, conservar la versión vigente y trabajar con adaptadores o mocks en el área propia. Cada persona prueba su lado; las pruebas del recorrido completo se coordinan entre Agustin y Gaston.

### Reglas obligatorias para las IA del equipo

1. Declarar al comenzar el alcance correspondiente a Agustin, Gaston o Emi y editar solo sus áreas asignadas.
2. No refactorizar, completar ni corregir archivos de otra área como efecto secundario. Informar la dependencia con un ejemplo reproducible o una propuesta concreta.
3. No modificar contratos compartidos sin acuerdo explícito de Agustin y Gaston. Una tarea local no autoriza cambios incompatibles para la otra parte.
4. Ante una dependencia faltante, crear un mock compatible dentro del área propia e identificarlo como temporal. No implementar el trabajo de otra persona para desbloquearse.
5. Mantener separados lógica funcional, componentes básicos de prueba y diseño final. No anticipar decisiones de marca o negocio de Emi.
6. Las tareas compartidas deben asignar una parte concreta a cada responsable antes de comenzar. “Compartido” no significa permiso para editar todo.
7. Las instrucciones explícitas posteriores del equipo pueden cambiar estas asignaciones; registrar el cambio en este documento.

### Registro de cambios

**v1.5 · 17/10/2026 · decidido por Agustin.** Integración de la UI de Mostrame (diseño de Emi, v1.5):

- Agustin integra la UI del diseño de Emi en `apps/desktop` y `packages/ui`, incluido el proceso principal y el IPC interno cuando la UI lo necesita (regla 7). La fuente de diseño vive en `design/` y las reglas de UI en `CLAUDE.md`.
- No es la UI final: le da vida al diseño para probar los flujos.
- El trabajo de front va en ramas hijas de `initial-ui`, una por funcionalidad. Los cambios de backend que pide la UI van en ramas propias contra `main`.

**v1.4 · 17/10/2026 · acordado por Agustin.** La sesión cubre todo el recorrido:

- La sesión empieza en `POST /v1/interpret`, que recibe `sessionId` opcional y lo devuelve en todas sus respuestas. El front lo manda en todas las llamadas siguientes.
- En `interpret`, Claude también indica el objetivo entendido y el motivo de su decisión. Se guardan en la sesión y no vuelven al front.
- `POST /v1/options` y `POST /v1/next-step` aceptan `metadata` opcional con datos de la página (`page.title`, `page.language`), que se acumula en la sesión.
- `POST /v1/next-step` recibe `completedSteps`: los pasos que la persona completó desde la última llamada.
- Claude recibe en cada llamada el recorrido completo: chat, decisiones de `interpret`, metadato, opciones y pasos.

**v1.3 · 17/10/2026 · acordado por Agustin.** Se divide la guía en dos endpoints:

- `POST /v1/options` devuelve las opciones de la página, cada una con su guía completa (`steps`). Acepta `goal` opcional (lo que la persona quiere hacer en esta página) y no devuelve `guide`.
- Un paso con `element: null` es teórico: el elemento todavía no existe porque aparece después de una acción de la persona.
- Nuevo `POST /v1/next-step`: el front envía la opción elegida, el paso teórico esperado y el HTML posterior a la acción. Recibe los pasos reales y `done` (true cuando la tarea terminó).
- `element` es el id de un elemento del HTML enviado por el front (por ejemplo `#el-3`).

**v1.2 · 17/10/2026 · acordado por Agustin.** Se simplifica la API a tres endpoints (secciones 6 y 7):

- `POST /v1/interpret`: chat de la home. El front envía el historial completo y Claude responde `redirect` (URL directa), `question` (pregunta) u `options` (varios sitios). No hay buscador ni adaptador SearchProvider en esta etapa: Claude propone las URLs.
- `POST /v1/options`: el front envía fragmentos de HTML elegidos con sus propias reglas. Claude devuelve opciones y el próximo paso, con elementos identificados por selector CSS. Reemplaza a `pages/options` y `guidance/next`: el próximo paso se pide al mismo endpoint, con sesión.
- Sesiones en el backend: las crea `/v1/options`, guardan opciones y pasos anteriores (no el HTML), viven en memoria y vencen a los 30 minutos sin uso.
- Se eliminan `POST /v1/destinations/search`, `POST /v1/guidance/next`, `DELETE /v1/sessions/:id` y los tipos `PageSnapshot`, `PageOption` y `GuideDecision` de la versión anterior.
- El formato de lo que el front extrae de la página lo define el front. El backend recibe HTML.
- Despliegue del backend en Tenki en lugar de un contenedor Docker.

Las secciones 3, 5 y 9 a 12 (en particular S03, S04, S06, S07, S10 y el stack) todavía describen el diseño anterior. Donde contradigan las secciones 6 y 7, valen estas últimas hasta que se revisen.

## 1. Propósito

Crear una aplicación de escritorio que permita a personas mayores encontrar dónde realizar una tarea y recibir instrucciones visuales para completarla en la página real.

El recorrido principal es: expresar una intención → encontrar un sitio → abrirlo → elegir o confirmar una tarea → recibir ayuda paso a paso.

La aplicación mantiene el sitio original funcionando en Chromium. No reconstruye páginas, no genera interfaces alternativas para cada sitio y no reemplaza la lógica del sitio. El asistente interpreta controles disponibles y orienta al usuario, quien realiza las acciones.

## 2. Decisiones y límites

- Backend: Node.js y TypeScript.
- Inteligencia artificial: Claude mediante la API de Anthropic.
- Aplicación de escritorio recomendada: Electron con Chromium integrado, sin fork.
- Las instrucciones de Claude son datos estructurados validados; nunca código ejecutable.
- La guía avanza un paso por vez según el estado observado de la página.
- Los valores de formularios permanecen en el dispositivo.
- La compatibilidad inicial se limita a tareas y sitios evaluados. No se promete cobertura universal.
- El MVP guía al usuario; no hace clics, no escribe datos y no envía formularios automáticamente.
- El buscador encuentra destinos. Chromium carga y ejecuta las páginas. Son componentes separados.

Las tecnologías adicionales de este documento son propuestas de implementación, no requisitos previamente confirmados por el usuario.

## 3. Stack propuesto

| Capa | Tecnología | Función |
|---|---|---|
| Escritorio | Electron, TypeScript | Ventana, navegación y acceso controlado a capacidades nativas |
| Página externa | WebContentsView | Ejecutar el sitio real separado de la interfaz propia |
| Interfaz propia | React, TypeScript, Vite | Inicio, panel de ayuda y preferencias |
| Estilos | CSS y variables de diseño | Componentes predecibles, contraste, escala tipográfica y foco |
| Estado de la guía | Máquina de estados explícita en TypeScript | Transiciones verificables; XState es opcional |
| Backend HTTP | Node.js LTS, TypeScript, Fastify | Orquestar IA, búsqueda, validación y límites de uso |
| Contratos | Zod y JSON Schema | Validación de API, IPC y respuestas de Claude |
| Cliente de IA | SDK oficial de Anthropic para TypeScript | Invocar Claude desde el servidor |
| Búsqueda | Adaptador SearchProvider | Consultar una API de búsqueda, proveedor por elegir |
| Preferencias locales | Archivo JSON versionado en userData | Tamaño de texto, idioma y ajustes; sin secretos |
| Datos remotos | Sin base obligatoria en el MVP | Sesiones efímeras con vencimiento; PostgreSQL si luego se necesitan cuentas |
| Logs | Pino con redacción | Eventos técnicos sin contenido de navegación |
| Pruebas | Vitest y Playwright | Contratos, extractor, estados e integración con páginas de prueba |
| Monorepo | pnpm workspaces | Compartir tipos y separar responsabilidades |
| Distribución | Electron Forge y CI | Empaquetar y preparar instaladores firmados |
| Despliegue backend | Contenedor Docker y HTTPS | Secretos del servidor y operación reproducible |

Usar versiones estables compatibles y fijarlas en el lockfile al iniciar la implementación. Configurar el modelo mediante CLAUDE_MODEL; elegir un modelo disponible con salida estructurada y evaluarlo con tareas reales, sin fijar aquí un nombre que pueda quedar obsoleto.

## 4. Arquitectura y fronteras de confianza

Flujo de datos:

Usuario → interfaz propia → IPC validado → proceso principal Electron → backend HTTPS → Claude o proveedor de búsqueda.

Página externa → extractor local → filtro de privacidad → snapshot reducido → backend → JSON validado → validador local → guía visual.

El proceso principal administra navegación, permisos y vistas. La interfaz propia no tiene acceso irrestricto a Node.js. El contenido externo no puede invocar APIs privilegiadas. Un preload mínimo y aislado extrae información y recibe únicamente comandos autorizados para mostrar ayuda. Todo mensaje se valida también por emisor, vista y frame.

El backend no abre sesiones del usuario ni recibe cookies. No se usa un navegador remoto para navegar por cuenta de la persona. Las claves de Anthropic y del buscador permanecen en el servidor, nunca en el instalador.

WebContentsView es una vista nativa: no debe asumirse que un elemento HTML del panel puede superponerse sobre ella. Para el MVP, mantener el panel al costado e insertar el resaltado dentro de la página mediante un overlay de estilos encapsulados. La página puede interferir con ese overlay; nunca usarlo como superficie de seguridad o confirmación de identidad.

## 5. Sistemas a incorporar

### S01. Navegador y sesiones

Gestiona una pestaña inicial, URL, atrás, adelante, recarga, carga y errores. Mantiene cookies localmente mediante la sesión de Electron. Incluye un acceso permanente a Inicio y la posibilidad de cerrar la ayuda.

Controla ventanas nuevas, permisos y descargas explícitamente. En el MVP, los casos no soportados muestran una salida comprensible, incluida la opción de abrir en el navegador del sistema. No deben bloquearse inicios de sesión legítimos silenciosamente.

### S02. Inicio por intención

Input principal: “¿Qué querés hacer hoy?”. Claude identifica objetivo, contexto mínimo faltante y necesidad de aclaración. No pide contraseñas, números de documento ni datos del trámite.

Ejemplo: “Quiero renovar mi documento” → preguntar país si falta → buscar el organismo correspondiente.

La voz es una ampliación posterior. El MVP utiliza texto y no depende de un proveedor de reconocimiento de voz.

### S03. Búsqueda y elección del destino

El backend convierte la intención en una consulta y llama a SearchProvider. Normaliza resultados con identificador, título, URL y descripción. Claude selecciona o explica candidatos existentes mediante sus identificadores; no inventa URLs.

La política de ranking prioriza sitios oficiales cuando corresponda, pertinencia geográfica y correspondencia con el objetivo. Estar primero o tener HTTPS no demuestra que un sitio sea oficial. Los destinos sensibles se contrastan con un registro curado de dominios o se presentan con incertidumbre explícita. No seleccionar anuncios como recomendación principal.

El usuario ve nombre, dominio y motivo de la recomendación antes de abrir. La navegación permite solo esquemas autorizados, inicialmente HTTPS y HTTP cuando exista una razón visible. Bloquear javascript:, file: y protocolos externos sin manejo específico. El backend no descarga URLs arbitrarias en el MVP; si se agrega esa función, debe prevenir SSRF y validar redirecciones y redes privadas.

### S04. Extracción local de la página

Extrae controles visibles y útiles: botones, enlaces, inputs, selects, textareas, encabezados y landmarks. Obtiene rol, tipo, etiqueta accesible depurada, estado habilitado y relación con sección o formulario.

Utiliza DOM y semántica accesible. No implica que todas las páginas estén correctamente etiquetadas. Asigna IDs temporales vinculados localmente a nodos; los selectores y referencias reales no los genera Claude.

Cada snapshot lleva pageId, navigationId, revision y versión del esquema. La geometría se calcula localmente al mostrar la indicación. El extractor limita cantidad de elementos y tamaño de texto, prioriza regiones relevantes y comunica cuando la extracción es parcial.

Comenzar con documento principal y shadow DOM abierto. Detectar frames y otros casos no soportados. El shadow DOM cerrado y canvas pueden no exponer controles útiles. La extracción en subframes requiere instrumentación, permisos y validación por frame; no se promete acceso universal.

### S05. Privacidad y minimización

Construye una representación por lista de campos permitidos; nunca envía HTML completo y luego intenta quitar secretos. Excluye values, contraseñas, texto ingresado, cookies, tokens, almacenamiento web, contenido de archivos y capturas de pantalla.

Etiquetas, títulos y URLs también pueden contener datos personales. Depurar correos, teléfonos, identificadores y texto personalizado. No enviar query strings ni fragmentos; los paths también pueden ser sensibles. Preferir origen y una categoría de página, con rutas depuradas solo cuando sean necesarias.

Las detecciones de privacidad son imperfectas: adoptar una política conservadora, omitir contenido dudoso y permitir desactivar la IA por sitio. No afirmar anonimato absoluto. No enviar cada pulsación; el objetivo ingresado por el usuario también debe pasar por minimización.

El estado “campo completado” se evalúa localmente y no necesita incluir el valor ni enviarse al servidor. No transmitir opciones seleccionadas ni estados que revelen datos sensibles por defecto.

No persistir snapshots ni prompts de producción por defecto. Borrar sesiones remotas por vencimiento. Revisar las condiciones de tratamiento y retención de Anthropic y del buscador antes de producción; la política local no elimina la retención del proveedor.

### S06. Interpretación de opciones

Claude recibe snapshot depurado y objetivo opcional. Devuelve hasta tres tareas principales y un conjunto secundario acotado. Cada opción debe tener evidencia en controles existentes. Si no puede inferir el propósito, devuelve una pregunta o estado unsupported.

La interfaz conserva las opciones estables mientras sigan siendo válidas. No reorganizar todo después de cada pequeña mutación.

### S07. Planificador de guía

Al seleccionar una tarea, propone únicamente el próximo paso observable. No describe pantallas futuras como si ya existieran. Cada instrucción apunta a una referencia existente y permite repetir, volver o salir.

Comandos visuales permitidos: highlight, scrollIntoView, showInstruction y clearGuidance. La IA no dispone de click, fill, submit, evaluate ni ejecución de scripts.

Estados: idle, analyzing, choosing, guiding, waitingForUser, verifying, completed, needsClarification, unsupported y error. Pausar o cancelar invalida respuestas pendientes.

### S08. Ejecutor visual local

Valida esquema, sesión, revisión y elemento antes de aplicar una instrucción. Resuelve el nodo desde el registro local, comprueba visibilidad y recalcula posición durante scroll y resize.

Muestra borde de alto contraste y texto breve en el panel. No tapa el control ni intercepta sus clics. Mantiene foco de teclado, respeta reducción de movimiento y no usa solo color para comunicar. Ante referencia obsoleta, retira la indicación y pide un nuevo análisis.

### S09. Observador y verificación

Combina eventos de navegación, interacción y MutationObserver acotado. Usa debounce y agrupación de cambios para evitar una llamada a Claude por mutación.

Un clic no demuestra éxito. Verifica señales observables: navegación esperada, aparición de controles, cambio de etapa o error de validación. Los eventos de formularios solo activan comprobaciones locales; sus datos no se registran.

Tras una navegación, cancela solicitudes anteriores e invalida referencias. Descarta respuestas tardías por navigationId, revision y requestId. En tareas ambiguas pregunta si el usuario terminó. No declara una compra o trámite completado sin evidencia suficiente.

### S10. Orquestación de Claude

Funciones separadas: interpretar intención, evaluar candidatos de búsqueda, identificar opciones y decidir siguiente paso. Compartir contratos, pero usar instrucciones y esquemas específicos para cada función.

Utilizar salida estructurada cuando el modelo elegido la soporte y validar siempre con Zod. JSON válido no implica una decisión correcta. Comprobar referencias, acciones permitidas y coherencia con el estado local.

Manejar timeout, rechazo, límite de tokens y errores del proveedor. Reintentos limitados con backoff para fallos transitorios; no repetir indefinidamente respuestas inválidas. Una nueva navegación cancela el trabajo viejo. Añadir límites de tokens, tamaño y frecuencia por sesión.

Contenido de páginas y resultados de búsqueda se trata como datos no confiables: nunca puede cambiar políticas, solicitar secretos ni habilitar herramientas. La defensa incluye restricciones de código y permisos; no depende solo de un prompt.

### S11. Accesibilidad y experiencia

Texto grande ajustable, lenguaje simple en español, botones con etiquetas explícitas, navegación completa por teclado y estructura accesible para lectores de pantalla. Tres opciones principales como máximo al inicio.

Controles permanentes: Repetir, Volver, Salir de la ayuda e Inicio. Mostrar progreso comprensible sin prometer cantidad fija de pasos. Si el usuario navega por su cuenta, actualizar o pausar la guía sin forzarlo a volver.

La lectura en voz alta es opcional posterior y debe poder detenerse. Validar el diseño con personas mayores; no basta con aumentar la tipografía.

### S12. Operación y distribución

Backend con límites de uso y autenticación de sesión apropiada para una app distribuida; una clave fija embebida no es autenticación segura. Para piloto privado se puede usar invitación, dejando la gestión pública de cuentas para otra etapa.

Logs de latencia, códigos de error, versión de contratos y cantidades de elementos. Excluir URLs completas, etiquetas, intenciones y mensajes de formularios. Cualquier diagnóstico con contenido requiere una política y consentimiento específicos.

Firmar instaladores y actualizaciones. Mantener Electron actualizado, revisar dependencias y probar sitios prioritarios antes de distribuir nuevas versiones. Separar configuración de desarrollo y producción.

## 6. Contratos de referencia

Los contratos se implementan con Zod en `packages/contracts` y se exportan como JSON Schema. Las claves van en inglés. Cualquier cambio se acuerda entre front y backend.

```ts
// POST /v1/interpret
type InterpretRequest = {
  sessionId?: string; // ausente en el primer mensaje; el backend crea la sesión
  // Historial completo del chat; el último mensaje es de la persona.
  messages: Array<{ role: 'user' | 'assistant'; content: string }>; // máx. 20, 1000 caracteres c/u
};

type InterpretResponse = { sessionId: string } & (
  | { type: 'redirect'; message: string; url: string } // url http(s)
  | { type: 'question'; message: string }
  | { type: 'options'; message: string; options: Array<{ title: string; url: string; reason: string }> } // 2 a 5
);

// Datos de la página que conoce el front; se acumulan en la sesión.
type Metadata = { page?: { title?: string; language?: string } };

// POST /v1/options
type OptionsRequest = {
  sessionId?: string; // la de interpret; si falta (página sin chat), se crea una
  html: string; // fragmentos armados por el front; máx. 200.000 caracteres
  metadata?: Metadata;
  goal?: string; // lo que la persona quiere hacer en esta página (chat o «¿No está lo que buscás?»); máx. 1.000 caracteres
};

type GuideStep = {
  element: string | null; // "#el-3" (id del HTML enviado) o null si el paso es teórico
  instruction: string;
  presentation: 'highlight' | 'scrollAndHighlight';
  waitFor: 'userInteraction' | 'navigation' | 'userConfirmation';
};

type OptionsResponse = {
  sessionId: string;
  options: Array<{ id: string; title: string; steps: GuideStep[] }>; // 1 a 15 pasos
};

// POST /v1/next-step
type NextStepRequest = {
  sessionId: string;
  optionId: string; // opción devuelta antes por /v1/options en esta sesión
  expectedStep: GuideStep; // el paso teórico que se esperaba
  completedSteps: GuideStep[]; // pasos completados desde la última llamada (puede ser [])
  html: string; // fragmentos después de la acción de la persona
  metadata?: Metadata;
};

type NextStepResponse = {
  sessionId: string;
  steps: GuideStep[];
  done: boolean; // true cuando la tarea terminó
};

type ApiError = {
  error: { code: string; message: string; requestId: string; retryable: boolean; details?: Array<{ path: string; message: string }> };
};
```

Ejemplo de respuesta de `/v1/options`:

```json
{
  "sessionId": "s-abc",
  "options": [
    {
      "id": "turno",
      "title": "Sacar un turno",
      "steps": [
        { "element": "#el-3", "instruction": "Hacé clic en Turnos.", "presentation": "highlight", "waitFor": "userInteraction" },
        { "element": null, "instruction": "Elegí la especialidad.", "presentation": "highlight", "waitFor": "userInteraction" }
      ]
    }
  ]
}
```

## 7. API

| Endpoint | Entrada | Salida |
|---|---|---|
| GET /health | — | `{ status: "ok" }`, sin autenticación |
| POST /v1/interpret | Historial del chat y `sessionId` opcional | `redirect`, `question` u `options`, con `sessionId` |
| POST /v1/options | `sessionId`, HTML, `metadata` y `goal` opcionales | Opciones con su guía (`steps`), con `sessionId` |
| POST /v1/next-step | `sessionId`, `optionId`, paso teórico esperado, `completedSteps`, HTML nuevo y `metadata` opcional | Pasos reales y `done` |

La sesión empieza en `/v1/interpret` y acumula todo el recorrido: chat, objetivo y motivo de la decisión de Claude (no vuelven al front), metadato de la página, opciones y pasos completados. Claude recibe ese recorrido completo en cada llamada. Vive en memoria y vence a los 30 minutos sin uso.

Todas las rutas salvo `/health` requieren `Authorization: Bearer <token>`. Hay un límite de solicitudes por token, el error tiene un formato único y existe un modo mock para desarrollar sin Claude. El detalle para el front está en `docs/api.md` del repositorio del backend.

Flujo:

1. **Home:** el objetivo de `/v1/interpret` es siempre llegar a una URL. El front envía el chat; la primera respuesta trae el `sessionId` que se usa en todo el recorrido. Con `redirect` (una URL), la abre. Con `options` (más de una URL posible), muestra los sitios para elegir. Con `question` (todavía no se llega a una URL), muestra la pregunta y vuelve a llamar con el historial, hasta obtener `redirect` u `options`.
2. **Página abierta:** el front envía el `sessionId`, los fragmentos de HTML y el metadato de la página a `/v1/options`. El backend devuelve las opciones, cada una con su guía. Si todos los pasos de la opción elegida son reales, el front guía de punta a punta sin volver a llamar.
3. **Paso teórico:** cuando la guía llega a un paso con `element: null`, el front espera la acción de la persona y llama a `/v1/next-step` con el `sessionId`, la opción, el paso esperado, los pasos completados y el HTML nuevo. Recibe los pasos reales; si aparece otro paso teórico, repite. `done: true` indica que la tarea terminó.

Qué queda del lado del front:

- Guardar el `sessionId` de la primera respuesta de `/v1/interpret` y mandarlo en todas las llamadas siguientes; empezar una sesión nueva si recibe `SESSION_NOT_FOUND`.
- Guardar el historial del chat y enviarlo completo en cada llamada a `/v1/interpret`.
- Armar los fragmentos de HTML, con un id por elemento y sin datos sensibles.
- Enviar el metadato de la página (título, idioma) al cargarla.
- Recorrer los pasos y llamar a `/v1/next-step` ante un paso teórico, informando los pasos completados.
- Ubicar `element` en la página (si hace falta, subiendo al elemento padre) y manejar el caso en que no se encuentra: el backend no lo verifica.
- La representación visual (`presentation`, `instruction`) y la espera (`waitFor`).
- Mostrar los errores y reintentar solo cuando `retryable` es `true`.

## 8. Seguridad del navegador

- nodeIntegration: false, contextIsolation: true, sandbox: true y webSecurity: true para contenido externo.
- No exponer ipcRenderer ni APIs de Electron completas mediante contextBridge.
- IPC con métodos específicos, argumentos validados y comprobación de emisor y frame.
- Denegar permisos por defecto y gestionar explícitamente solicitudes legítimas.
- CSP estricta para la interfaz propia; no desactivar protecciones de sitios para facilitar la integración.
- No ignorar errores de certificados ni ejecutar código generado por Claude.
- Gestionar protocolos externos, ventanas emergentes y descargas con políticas explícitas.
- Tratar la web como contenido hostil incluso cuando el dominio sea conocido.

## 9. Organización del repositorio

La estructura es propuesta; no implica que ya exista un repositorio. Propiedad inicial: apps/api pertenece a Agustin; apps/desktop, page-analyzer, privacy local y guidance local pertenecen a Gaston. packages/contracts es compartido bajo el procedimiento de acuerdo anterior. packages/ui contiene únicamente componentes funcionales básicos de prueba de Gaston: los entregables de UI final de Emi permanecen fuera del repositorio en esta etapa. En tests y docs, cada persona modifica únicamente archivos de su sistema; las pruebas conjuntas requieren coordinación. No reestructurar el repositorio de otra persona para imponer este esquema.

```text
apps/
  desktop/
    src/main/          # ventanas, sesiones, navegación e IPC
    src/preload/       # puente mínimo y aislado
    src/renderer/      # inicio, opciones y panel de guía
  api/
    src/modules/
      intents/
      search/
      options/
      guidance/
      ai/
packages/
  contracts/           # tipos, Zod y JSON Schema
  page-analyzer/       # extracción y referencias locales
  privacy/             # minimización y redacción
  guidance/            # estados y validación de pasos
  ui/                  # componentes propios accesibles
tests/
  fixtures/            # páginas controladas con casos de error
  integration/
docs/
```

## 10. Alcance del MVP

Incluir una ventana y una pestaña; inicio por intención; una integración de búsqueda; recomendaciones con dominio visible; extracción del documento principal; opciones de página; selección de tarea; guía visual; observación de cambios; cancelación; preferencias de texto; manejo de errores y filtros de privacidad.

Evaluar tres tareas en sitios seleccionados: encontrar información u horarios, buscar dentro de un sitio y avanzar por un formulario de prueba sin transmitir valores. Usar páginas controladas para verificar errores, referencias obsoletas y navegación dinámica, además de sitios reales permitidos.

Excluir inicialmente automatización de compras o trámites, voz, sincronización de cuentas, múltiples pestañas, interpretación por capturas, soporte universal de frames y canvas, extensiones de terceros y reconstrucción visual de páginas.

## 11. Plan de implementación

1. Crear monorepo y contratos. Separar procesos, configurar seguridad y mostrar un sitio real con navegación básica.
2. Implementar extractor y resaltado sin IA. Probar el circuito con decisiones JSON simuladas y referencias locales.
3. Incorporar filtro de privacidad y comprobar los payloads salientes con datos ficticios sensibles.
4. Conectar Claude para opciones y un paso de guía. Añadir validación, cancelación y respuestas obsoletas.
5. Implementar observador y máquina de estados para completar tareas de varios pasos.
6. Añadir inicio por intención, adaptador de búsqueda y selección del destino.
7. Evaluar con personas mayores, corregir fricciones y preparar instalador del piloto.

Cada etapa debe producir un flujo utilizable y verificable antes de ampliar el alcance. Agustin implementa las partes de servidor y Gaston las del cliente según la matriz de responsabilidades. Emi trabaja en paralelo en diseño, marca y negocio; la UI básica habilita las pruebas sin esperar al diseño final. Este plan no reasigna responsabilidades.

## 12. Criterios de aceptación

- Una intención ambigua produce una aclaración antes de elegir un destino.
- Toda recomendación apunta a un resultado real recibido del buscador.
- Una opción de página tiene evidencia en elementos del snapshot actual.
- Una instrucción inválida, desconocida u obsoleta no modifica la página.
- El asistente puede resaltar un control real sin bloquear su interacción.
- Una navegación o cambio relevante actualiza o invalida la guía correctamente.
- Un clic fallido o un error de validación no se presenta como tarea completada.
- Datos ficticios en inputs, etiquetas personalizadas y URLs de prueba no aparecen en payloads ni logs.
- Un intento de prompt injection no habilita acciones fuera del contrato.
- Un fallo de Claude o búsqueda deja la navegación manual disponible y permite reintentar.
- Las tareas principales se pueden recorrer con teclado y lector de pantalla.
- Se registran tasa de tarea completada, ayuda requerida, indicaciones incorrectas, latencia y costo por tarea, sin capturar contenido personal.

No fijar objetivos de rendimiento o precisión sin medición inicial. Definir umbrales de aceptación del piloto antes de ampliar a sitios nuevos.

## 13. Instrucciones para la IA que implemente

Aplicar primero la sección 0 de responsabilidades. El alcance técnico descrito en las demás secciones es contexto del producto completo, no autorización para implementar áreas ajenas. Usar este documento como especificación inicial. Mantener la distinción entre decisiones confirmadas y tecnologías propuestas. No sustituir Electron por un iframe web: muchos sitios restringen su inclusión y una web convencional no tiene acceso libre al DOM de otros orígenes.

No implementar un agente autónomo que complete tareas en nombre del usuario. Implementar un asistente visual con capacidades limitadas. No enviar DOM completo, values, cookies ni capturas a Claude. No confiar en el JSON solo porque cumpla el esquema.

Implementar primero el puente y la guía con respuestas simuladas. Mantener proveedores de IA y búsqueda detrás de interfaces. Añadir pruebas significativas para privacidad, aislamiento, referencias obsoletas y transiciones. Documentar las limitaciones reales de cada sitio soportado.

Decisiones pendientes antes de producción: sistema operativo prioritario, proveedor de búsqueda, modelo Claude y presupuesto, alojamiento y región de datos, tratamiento de datos por proveedores, identidad y distribución de la aplicación, política de historial, sitios iniciales y proceso de actualización.

## 14. Referencias técnicas

- Electron: integración de contenido web y WebContentsView: https://www.electronjs.org/docs/latest/tutorial/web-embeds
- Electron: APIs de webContents: https://www.electronjs.org/docs/latest/api/web-contents
- Electron: recomendaciones de seguridad: https://www.electronjs.org/docs/latest/tutorial/security/
- Claude: salidas estructuradas y restricciones de esquema: https://platform.claude.com/docs/en/build-with-claude/structured-outputs

Las referencias fundamentan capacidades técnicas; las decisiones de producto y arquitectura de este documento son propuestas para esta plataforma.
