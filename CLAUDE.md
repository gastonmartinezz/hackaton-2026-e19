# Guíame · Reglas para Claude Code (v2.4)

Guíame es un **navegador de escritorio con IA** que acompaña, paso a paso, a personas de 50+ (Uruguay y Argentina) mientras usan sitios web reales: sacar un turno, comprar algo. **Guíame muestra; la persona hace.** Solo actúa por ella cuando ella lo confirma: escribe un dato no sensible que le dictó o toca un botón que la IA marcó como seguro (§2). Nunca paga, compra ni borra nada por ella.

Si el repositorio ya tiene un `CLAUDE.md`, agregá este contenido como una sección más; no reemplaces lo que hay. Todo el diseño está en `design/`. Para implementar o revisar pantallas, usá el skill `guiame-ui` (`.claude/skills/guiame-ui/SKILL.md`).

> Las rutas que aparecen dentro de `design/docs/` (`preview/`, `tokens/`, `assets/`, `pantallas/`) son relativas a `design/`.

## 0. Antes de tocar código

- **Preguntá para quién trabajás:** Agustín (backend), Gastón (navegador y cliente) o la persona que integre la UI. Leer este archivo no autoriza a editar el área de otra persona.
- **`design/` define presentación y comportamiento visible.** El contrato de datos de `design/docs/04-contrato-backend.md` es una **propuesta**: no lo cambies por tu cuenta. Si una pantalla necesita un dato que no existe, usá un mock dentro de tu área, marcalo `TODO(contrato)` y avisá con un ejemplo concreto.
- **Puntos [DECIDIR]** de `docs/04`: no los resuelvas solo; proponé opciones.

## 1. Fuente de verdad (en este orden)

1. Lo que pida la persona del equipo en la sesión.
2. `design/preview/<pantalla>.html` y su captura `design/png/<pantalla>.png` (generada desde el preview a 1440×900): **cómo se ve**. Si un documento y una pantalla no coinciden, manda la pantalla.
3. `design/docs/03-pantallas-y-flujos.md`: textos, sello, estado de «Ayuda» y números de progreso de cada pantalla.
4. `design/docs/01-reglas-de-uso.md`: reglas R1–R14, no negociables.
5. `design/docs/04-contrato-backend.md`: estados de tarjeta, eventos, privacidad (propuesta).
6. `design/docs/02-sistema-visual.md` + `design/tokens/`: medidas y valores.
7. `design/docs/historial/`: guion v1.7 (textos de detalle; sus valores visuales quedaron reemplazados) y los cambios de cada versión (`v2.2-cambios.md` a `v2.4-cambios.md`).

`design/pantallas/*.dc.html` es la fuente de las pantallas en formato de lienzo de Claude Design. **Es referencia, no código de producción**: copiá valores y estructura, no la arquitectura ni los estilos inline.

## 2. Reglas de producto (no negociables)

- **Nunca actúes por la persona sin que lo confirme.** Los comandos sobre el sitio son visuales (`highlight`, `scrollIntoView`, `showInstruction`, `clearGuidance`) más tres excepciones: escribir un dato dictado, poner el cursor en un dato sensible y tocar un botón seguro. Prohibido cualquier acción automática sin confirmación.
- **Tocar un botón por la persona** (decisión de Agustín, 18/10/2026):
  - La tarjeta ofrece «Tocá «{control}» por mí» (o se responde «sí» con el modo voz) solo si se cumplen todas estas condiciones:
    - la IA marcó el paso con `safeToClick` (avanzar sin consecuencias: «Continuar», «Siguiente», «Confirmar» un paso intermedio, abrir una sección);
    - el control es un botón o enlace habilitado;
    - el paso no pide un dato;
    - la página no tiene riesgo alto.
  - Barrera local (`isIrreversibleAction`): aunque la IA lo marque, Guíame nunca toca un control que hable de pagar, comprar, transferir, firmar, dar de baja, eliminar, cancelar, suscribirse o donar. Esos los toca siempre la persona.
  - El clic llega al sitio como uno de la persona y la guía avanza por el camino de siempre.
- **Datos de formularios dictados** (decisión de Agustín, 18/10/2026):
  - **Dato no sensible** (nombre, correo, teléfono, dirección, fechas, opción de una lista): Guíame pregunta el dato en voz alta y la persona lo dice. Guíame lo escribe en el lugar señalado (`fill`) y le pide revisarlo con «Está bien, seguir», «Decirlo de nuevo» o «Lo escribo yo». El paso avanza recién con esa confirmación.
  - **Dato sensible** (contraseña o clave, PIN, códigos de verificación, tarjeta, CVV, vencimiento, datos bancarios, cédula o documento): nunca se pide por voz ni se escribe. Guíame solo pone el cursor en el lugar (`focus`) y muestra «Lo escribís vos. Yo no lo veo ni lo guardo.».
  - Alcanza con que una de tres fuentes diga que el dato es sensible: el backend (`field.sensitive`), el rótulo (`isSensitiveField`) o los atributos del sitio (`type=password`, `autocomplete=cc-*`/`one-time-code`, nombre).
  - Escribir un dato nunca envía el formulario. El botón final lo toca la persona, o Guíame si es seguro y ella lo confirma (ver «Tocar un botón»).
- **La guía llega hasta el final.** Al elegir una opción, o al pedir algo que no estaba entre las opciones, el backend investiga en internet el paso a paso de esa tarea en el sitio. Después, `/v1/next-step` avanza hasta que la página confirma que terminó. La guía nunca da la tarea por terminada por su cuenta.
- **El inicio es un buscador, no un chat** (A-01, B-C01). Si la búsqueda alcanza, se abre el sitio directo; si falta un dato, aparece **una pregunta por vez** debajo del buscador (A-02, A-03, B-C02, B-C03) con respuestas en botones y «No sé bien».
- **Inicio v2.4:** sin botón «Guíame». La búsqueda se envía con Enter o con la píldora del buscador, que dice «Hablar» y pasa a «Enviar» cuando la persona escribe (decisión de Agustín). Debajo van hasta tres accesos del historial («Lo que hiciste antes»), nombrados por lo que se hace. El texto sale de la tarea que se hizo con ayuda en ese sitio, guardada solo en el equipo junto al origen; sin tarea, el dominio. Falta un ícono por acceso y queda [DECIDIR] cuánto tiempo se guarda.
- **El sitio ocupa todo el ancho.** La ayuda es una **tarjeta flotante** a la derecha (R4), nunca una columna lateral. Nunca tapa el control resaltado.
- **Un estado de tarjeta por respuesta (R1)** y **una sola acción principal por vista (R2)**.
- **Contador (R5):** solo acciones confirmadas en el sitio, de a 1. Responder a Guíame no suma. Sin línea de progreso con 0.
- **«Listo» solo con evidencia literal** de la página (`evidencia.texto_literal`). Sin evidencia → «¿Pudiste terminar?» (A-16).
- **Pago:** verificá `dominio_actual == sitio_elegido.dominio` antes de cualquier paso de pago; si no coincide → C15. Antes de un botón irreversible, el aviso de C10 con el total citado.
- **Sellos de la barra** solo desde el backend (`oficial`, `tienda_elegida`, `no_verificado`); nunca por HTTPS. Sin candado. Nunca «conexión cifrada».
  - Hoy los da Protección de sitios (`AppState.siteCheck`, ver `docs/proteccion-sitios.md`): «Sitio oficial» solo cuando `siteIndicatorState()` del contrato devuelve `official` (identidad verificada por una fuente de autoridad), nunca por la IA.

## 3. Privacidad (requisito duro, con tests)

- Nunca envíes, guardes ni loguees valores de campos que escribe la persona: documento, fecha de nacimiento, contraseña, códigos, dirección, tarjeta. Solo `{campo, completo: true|false}`.
- **Excepción, el dictado de datos no sensibles (§2):** el audio pasa solo por `/v1/transcribe`, y el texto va del proceso principal directo al campo. Nunca llega a Claude, al estado de la interfaz, a la tarjeta (no se muestra ni se lee en voz alta) ni a los logs.
- Enmascará los valores de inputs **antes** de mandar DOM o capturas al modelo (incluidos `type=password`, `autocomplete=cc-*`, `one-time-code`).
- Nada de DOM ni capturas con valores en logs o telemetría.
- **Cada cambio que toque el lector de página o los eventos lleva un test** que verifique que el valor del campo no sale del cliente.

## 4. Marca

- El nombre es siempre **«Guíame»**, con tilde.
- Azul y blanco, **Poppins** (local, `design/assets/fonts/`, pesos 300–700), bordes curvos. Solo modo claro.
- **Sin gradiente de pantalla completa** (v2.3). El gradiente queda solo en la barra, la tarjeta flotante, los botones principales, «Hablar» y el rótulo «Acá». Las pantallas propias van sobre blanco con puntos (`.g-ground`) y el velo del sitio es parejo, navy al 12% (`.g-site-veil`).
- **Logo de la barra:** `design/assets/logo/guiame-blanco.png`, «Guíame» en blanco con avioncito, **sin ojos**, 38px de alto y **sin contenedor**. `guiame-blanco-ojos.png` ya no va en la barra. Las versiones con contenedor celeste (`guiame-icono.png`, `guiame-pill*.png`) van solo sobre fondo claro (R12). No redibujes, recolorees ni deformes los logos.
- **Micrófono:** píldora azul con gradiente, ícono blanco y texto visible **«Hablar»** (clase `.g-voice`, `.g-voice--home` en el inicio). Nombre accesible «Hablar: decirlo en voz alta». Con algo escrito, la misma píldora dice «Enviar» y envía la búsqueda. El estado «escuchando» (pantalla 33) **no está diseñado**: no lo inventes.
- **Resaltado (R8):** anillo blanco + azul `#1F8BFF` + rótulo «Acá» azul. Nunca amarillo ni negro. En un overlay con `pointer-events: none` y `aria-hidden`, por encima del velo (`z-index: 2`), sin envolver ni modificar el control del sitio. Nunca tapa texto ni etiquetas y nunca lleva instrucciones.
- Verde solo para «Sitio oficial» y «Listo», nunca en botones.
- Íconos Lucide en línea, trazo 2, `aria-hidden="true"`, siempre con texto visible. Sin emojis.

## 5. Tokens y estilos

- Importá `design/tokens/tokens.css`. Valores en `tokens.json`. Clases base: `.g-bar`, `.g-bar__logo`, `.g-card`, `.g-card__head`, `.g-primary`, `.g-secondary`, `.g-voice`, `.g-highlight`, `.g-highlight__label`, `.g-site-veil`, `.g-ground`.
- **Nunca escribas un color, radio o sombra literal en un componente** si existe el token; si falta, agregalo a `tokens.css` y avisá.
- Las zonas en `font-family: Arial` de las pantallas son **sitios externos ficticios**: no se implementan. Lo que se implementa es la capa Guíame: barra, tarjeta flotante, resaltado, velo y pantallas propias (inicio, pregunta, recomendación).

## 6. Voz

- Voseo rioplatense, un verbo por instrucción, frases cortas. Instrucción ≤ 10 palabras; apoyo de una línea.
- Las instrucciones salen de **plantillas fijas**: «Hacé clic en «{control}».», «Escribí {qué} en «{control}».», «Elegí {qué} en «{control}».». El nombre del control va entre « » en un chip azul suave.
- **No cambies textos.** Tomalos de las pantallas y de `docs/03`. Si falta una cadena, marcala `TODO(copy)` y preguntá.
- «No sé bien», nunca «No estoy seguro». Errores propios: «Fue un problema mío, no tuyo.»
- **Prohibido:** «Tu objetivo», «AHORA», «Paso X de Y», fácil, simplemente, abuelos, adultos mayores, URL, sesión, «te equivocaste», «¡Perfecto!», festejos y tecnicismos.

## 7. Accesibilidad (WCAG 2.2 AA como mínimo)

- Controles reales: `<button>`, `<a href>`, `<input>` + `<label>`. Opciones como `ul > li > button`.
- Áreas táctiles ≥ 48px (barra 54px, botones 58–72px). Contraste de texto ≥ 4.5:1.
- El nombre accesible incluye el texto visible (2.5.3). El logo lleva `alt="Guíame"`.
- Foco siempre visible. Una sola región `aria-live="polite"` para la instrucción nueva; errores con `role="alert"`. Mostrar una instrucción nueva **no mueve el foco**. La única excepción es un dato sensible: el cursor va a ese lugar del sitio para que la persona lo escriba (§2).
- «Tamaño de letra» escala toda la capa Guíame; los diseños están a 1.2×.
- Respetá `prefers-reduced-motion`. Cifras con `font-variant-numeric: tabular-nums`.

## 8. Casos sin diseño

23 primera vez · 24 no se encuentra un sitio · 27 venció el ingreso · 28 algo tapa la página · 29 comprobante · 30 retomar otro día · 31 pedir ayuda a alguien · 33 micrófono escuchando · C13 verificación del banco · C14 cambio a la página de cobro. Respaldo: `error_guiame` (A-19) o `no_soportada` (A-20), con `TODO(diseño)`.

## 9. Definición de terminado (cada pantalla o componente)

- [ ] Captura a 1440×900 comparada con `design/png/<pantalla>.png`: mismo layout, textos y jerarquía.
- [ ] Sin colores, radios ni sombras escritos a mano si hay token.
- [ ] Textos idénticos a la pantalla; ningún texto inventado sin `TODO(copy)`.
- [ ] Funciona con teclado, con foco visible y anuncios correctos.
- [ ] No agrega acciones sobre el sitio sin confirmación de la persona (solo las de §2: dato dictado, cursor en dato sensible, botón seguro).
- [ ] No envía ni registra valores de campos (test incluido si toca datos).

## Datos de ejemplo (solo fixtures de tests)

Hoy: sábado 17 de octubre de 2026. Turno: miércoles 4 de noviembre de 2026, 10:30, Oficina Centro. Pedido N.º 10482, llega el jueves 22 de octubre. Sitios: `agenda.ejemplo.gub.uy` (oficial), `tiendamac.ejemplo.com.uy` (tienda elegida), `tiendamac-ofertas.ejemplo.shop` (no verificado).
