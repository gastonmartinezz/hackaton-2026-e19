# Protección de sitios en Mostrame

> **Nota histórica (octubre de 2026).** Este es el encargo original. El servidor MCP privado se quitó porque la IA no llama herramientas: el servicio hace todas las verificaciones y le pasa los resultados. El estado actual está en [`docs/proteccion-sitios.md`](docs/proteccion-sitios.md) y el contrato en [`docs/api.md`](docs/api.md#protección-de-sitios-post-v1site-check).

## Objetivo del producto

Incorporar al navegador existente una funcionalidad que analice automáticamente la página actual para detectar señales de estafa, phishing o suplantación. Debe explicar los hallazgos y ofrecer acciones claras para personas mayores.

Integrar el indicador dentro de la barra «Estás en…», junto al dominio, conservando los controles Ayuda y Tamaño de letra y el panel de acompañamiento existentes. El indicador pertenece a la interfaz del navegador, fuera del contenido web.

La primera versión advierte sobre riesgos; no promete detectar todas las amenazas ni bloquear todos los envíos de formularios.

## Flujo general

1. Al navegar, el navegador inicia la revisión de la dirección.
2. El backend consulta reputación y coincidencia con un catálogo de dominios oficiales.
3. Cuando carga la página, el navegador extrae y sanitiza un resumen de su contenido.
4. El backend aplica reglas sobre formularios, enlaces e identidad declarada.
5. La IA interpreta la evidencia y puede ampliarla mediante herramientas MCP privadas.
6. El backend valida el resultado estructurado.
7. El navegador muestra el estado y, si corresponde, una advertencia con una acción concreta.

La comunicación del navegador es con la API HTTPS del backend. El MCP es una interfaz privada de herramientas para el componente de IA. Las claves de proveedores permanecen en el servidor.

## Agente backend

### Encargo

Incorporar al backend existente el servicio de análisis y un servidor MCP privado. Antes de implementar, revisar la arquitectura y reutilizar autenticación, configuración, proveedores de IA, logging y convenciones existentes.

Las validaciones esenciales deben ejecutarse siempre desde el servicio. La IA puede ampliar la investigación, pero no decidir omitir comprobaciones básicas ni declarar por sí sola que un sitio es oficial.

### Información recibida

| Dato | Alcance |
| --- | --- |
| Identificador de navegación | Vincular cada respuesta con la página analizada. |
| Versión del contenido | Diferenciar análisis de una página que cambia. |
| URL, hostname y dominio registrable | Depurados de secretos y datos personales antes del envío. |
| Título y texto visible | Contenido acotado. |
| Marca u organización declarada | Declaración del sitio, no prueba de identidad. |
| Formularios | Tipos de campos, método y destino, sin valores ingresados. |
| Enlaces relevantes | Texto y destino. |
| Scripts e iframes | Dominios de origen, sin enviar todo el código. |

No recopilar cookies, contraseñas, tokens, almacenamiento local, valores de formularios ni historial. No incluir capturas de pantalla en esta versión. Sanitizar en el navegador antes de transmitir y volver a validar en el backend. Considerar secretos tanto en path como en query y fragmento de las URLs.

### Validaciones

- Reputación de URL y dominio en fuentes de amenazas.
- Coincidencia exacta y con alcance controlado frente a un catálogo de dominios oficiales.
- Dominios similares, caracteres engañosos y subdominios confusos.
- Datos de registro disponibles mediante RDAP.
- HTTPS, certificado y redirecciones cuando sea posible inspeccionarlos.
- Datos sensibles solicitados y destinos de formularios.
- Diferencias entre texto de enlaces y sus destinos reales.
- Combinaciones de suplantación, urgencia, amenazas y pedidos sospechosos.

La antigüedad del dominio, HTTPS y la ausencia de reportes no determinan por sí solos un resultado favorable. Separar evidencia de fraude de debilidades de configuración técnica.

### Herramientas MCP

| Tool | Responsabilidad |
| --- | --- |
| `check_url_reputation` | Consultar reportes existentes de phishing y malware. |
| `lookup_official_identity` | Consultar organización, dominios autorizados, alcance, fuente y fecha de revisión del catálogo. |
| `get_domain_registration` | Obtener datos disponibles de registro mediante RDAP. |
| `inspect_connection` | Revisar TLS y redirecciones mediante un servicio controlado. |
| `analyze_page_structure` | Aplicar reglas al resumen de formularios, enlaces e iframes recibido. |
| `compare_brand_identity` | Contrastar la identidad declarada con la evidencia del catálogo. |

Cada herramienta devolverá datos estructurados, fuente, fecha, limitaciones y errores. No exponer ejecución de código ni peticiones HTTP arbitrarias. Las herramientas estarán autenticadas y limitadas al análisis autorizado.

La selección de proveedores debe contemplar licencia comercial, cobertura, privacidad, costo y disponibilidad. Distinguir consultar reportes existentes de enviar una URL a un escaneo nuevo. No publicar automáticamente URLs ni contenido en servicios externos.

### Regla de identidad oficial

La marca «Sitio oficial» solo puede surgir de un catálogo mantenido y verificable, con organización, dominios autorizados, alcance de subdominios, fuente y fecha de revisión.

No usar coincidencias por sufijo de texto sin verificar límites de dominio. No inferir oficialidad por apariencia, HTTPS o decisión de la IA. Las advertencias de riesgo tienen prioridad sobre la marca oficial.

### Seguridad y operación

- Tratar el contenido web como entrada no confiable, incluidas instrucciones dirigidas a la IA.
- Impedir al escáner acceder a localhost, redes privadas y servicios internos; controlar DNS y cada redirección.
- Excluir páginas internas y de desarrollo del análisis externo.
- No entregar cookies ni credenciales del usuario a escáneres.
- Mantener claves de proveedores en el backend y evitar secretos en logs.
- Implementar caché con vencimiento, límites de uso y tiempos máximos.
- Registrar fuente, fecha y alcance de la evidencia.
- Devolver cobertura parcial o indisponibilidad ante fallos; nunca convertirlos en aprobación.
- Distinguir el contenido observado por el usuario del observado por un escáner externo: puede variar por sesión o ubicación.

### Criterios de aceptación

- Un dominio parecido al oficial no obtiene la marca.
- Una amenaza tiene prioridad sobre la identidad oficial.
- Un fallo externo produce un resultado incompleto.
- Ningún valor ingresado en formularios llega al servicio.
- Cada respuesta corresponde a su navegación y versión de contenido.

## Contrato compartido

Definir el contrato antes de implementar ambos lados. El siguiente ejemplo expresa la estructura propuesta, no un endpoint existente:

```json
{
  "navigationId": "nav-123",
  "contentVersion": 1,
  "analysisId": "analysis-456",
  "status": "complete",
  "identity": {
    "status": "verified_official",
    "organization": "Organización"
  },
  "risk": "no_signals",
  "reasonCodes": [],
  "coverage": {
    "reputation": "complete",
    "identity": "complete",
    "content": "complete"
  },
  "checkedAt": "2026-10-17T22:00:00Z",
  "expiresAt": "2026-10-17T22:15:00Z"
}
```

- `status`: `pending`, `complete`, `partial`, `unavailable`.
- `identity.status`: `verified_official`, `unknown`.
- `risk`: `high`, `medium`, `no_signals`, `unknown`.
- Cada verificación de `coverage`: `complete`, `partial`, `unavailable`, `not_applicable`.
- Los motivos tendrán códigos estables y evidencia asociada.
- Los tiempos del ejemplo son ilustrativos; definir vencimientos según la fuente y el tipo de análisis.

El frontend usará mensajes revisados para el público objetivo. La IA puede aportar una explicación complementaria, pero no controlar acciones ni etiquetas de identidad.

## Agente frontend / navegador

### Encargo

Integrar «Protección de sitios» en la interfaz actual de Mostrame, reutilizando componentes, tipografía, tamaños y sistema de ayuda.

Antes de implementar, identificar cómo el navegador observa navegaciones, accede al contenido y se comunica con el backend. Usar las capacidades de la arquitectura existente.

### Indicador en la barra

Agregar el estado dentro de «Estás en…», junto al dominio, sin desplazar Ayuda ni Tamaño de letra. Combinar ícono y texto. No depender solo del color ni de pasar el mouse.

| Condición | Texto visible |
| --- | --- |
| Análisis pendiente | Revisando sitio… |
| Identidad oficial verificada, cobertura suficiente y sin alertas | Sitio oficial |
| Sin identidad verificada, cobertura suficiente y sin señales detectadas | Sin alertas detectadas |
| Riesgo medio | Atención |
| Riesgo alto | Posible estafa |
| Análisis insuficiente o fallido | No pudimos verificarlo |

Prioridad: riesgo alto, riesgo medio, información insuficiente y finalmente estados favorables. Un resultado parcial no debe mostrarse como revisión completa. Backend y frontend deben acordar qué cobertura mínima permite cada estado.

No mostrar «Sitio seguro». El candado representa únicamente una conexión cifrada y no debe ser una aprobación fija. Las direcciones locales, como `127.0.0.1`, se tratan como desarrollo y no se envían a proveedores externos.

### Panel al pulsar el indicador

Abrir un panel breve anclado a la barra con título claro, una o dos frases, una acción principal y detalles secundarios cerrados inicialmente.

**Sitio oficial**

> La dirección pertenece a [organización], según nuestro registro de sitios oficiales.

**Sin alertas detectadas**

> No encontramos señales de estafa en las comprobaciones realizadas. Esto no garantiza que el sitio sea confiable.

**Posible estafa**

> Este sitio parece imitar a [organización]. No ingreses contraseñas ni códigos.

- Acción principal: **Salir de este sitio**.
- Acción secundaria: **Ver por qué**.
- Usar una explicación acorde al motivo real; no afirmar suplantación si la evidencia corresponde a otra amenaza.

**No pudimos verificarlo**

> No pudimos completar la revisión. Tené cuidado antes de ingresar datos personales.

- Acción: **Intentar de nuevo**.

### Comportamiento automático

- Iniciar la revisión de dirección en cada navegación principal.
- Enviar el resumen sanitizado después de la carga.
- Reanalizar cambios relevantes de ruta, formularios o identidad, con límites de frecuencia.
- Limpiar inmediatamente el estado de la página anterior.
- Descartar respuestas de otra navegación o versión de contenido.
- Mostrar el estado pendiente mientras se analiza.
- No interceptar ni prometer bloquear todos los envíos de formularios en esta versión.

### Coordinación con el asistente

Ante riesgo alto, mostrar una advertencia destacada del navegador y pausar las indicaciones del asistente que inviten a ingresar datos o confirmar operaciones.

La acción principal debe volver a una página anterior válida o al inicio. Una opción secundaria permitirá continuar después de leer la advertencia. No repetir la interrupción continuamente en la misma navegación, salvo que aumente el riesgo.

Los resultados favorables no abren ventanas ni interrumpen la tarea. El estado permanece disponible en la barra.

### Accesibilidad

- Ícono acompañado de texto; el color nunca es la única señal.
- Área de interacción cómoda y foco visible.
- Uso completo mediante teclado y lector de pantalla.
- Respeto por el tamaño de letra elegido.
- Mensajes breves, sin porcentajes de seguridad ni terminología técnica innecesaria.
- Anuncios accesibles de cambios relevantes sin repetir mensajes en cada actualización.
- Validar comprensión y acciones con personas mayores.

### Criterios de aceptación

- El contenido web no puede modificar ni cubrir el indicador del navegador.
- El estado se entiende sin distinguir colores.
- Se respeta el tamaño de letra y la navegación por teclado.
- La marca oficial nunca depende de una decisión del modelo.
- No persisten resultados anteriores después de navegar.
- Las alertas de riesgo alto coordinan su estado con el asistente.
- Los estados de carga, error y cobertura parcial tienen una presentación clara.

## Coordinación y entrega

1. Revisar la arquitectura existente de ambos proyectos.
2. Acordar contrato, códigos de motivos, cobertura mínima y eventos de navegación.
3. Frontend implementa los estados con respuestas simuladas mientras backend implementa el servicio.
4. Integrar y verificar navegación, cambios de contenido, errores y respuestas fuera de orden.
5. Probar dominios oficiales, similares, páginas legítimas sin catálogo y amenazas conocidas.
6. Validar comprensión con el público objetivo.

Entregar la funcionalidad integrada, configuración de proveedores, documentación del contrato y MCP, y evidencia de las verificaciones realizadas. Documentar también las limitaciones de acceso al contenido de la arquitectura actual.

## Resultado esperado

Mostrame revisa la página automáticamente, muestra una marca oficial solo cuando puede acreditar su identidad y advierte con una explicación breve y una salida clara cuando encuentra riesgo.
