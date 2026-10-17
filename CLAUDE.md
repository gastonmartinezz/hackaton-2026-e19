# Mostrame · Reglas para Claude Code (UI y marca)

Este archivo trae las reglas de diseño de Mostrame para quien implemente la interfaz. Si el repositorio ya tiene un `CLAUDE.md`, agregá este contenido como una sección más; no reemplaces lo que hay. La fuente completa de diseño está en `design/`. Para implementar pantallas, usá el skill `mostrame-ui` (`.claude/skills/mostrame-ui/SKILL.md`).

## 0. Antes de tocar código

- **Preguntá para quién trabajás:** Agustin (backend), Gaston (navegador y cliente) o la persona que integre la UI final. La especificación del producto (sección 0) asigna las áreas, y leer este archivo no autoriza a editar el área de otra persona.
- **Esta carpeta define solo presentación:** cómo se ve, cómo se lee y cómo se comporta la UI propia de Mostrame. No define contratos (PageSnapshot, GuideDecision), endpoints, prompts, extracción del DOM ni IPC.
- **No cambies contratos compartidos.** Si una pantalla necesita un dato que el contrato no trae, usá un mock dentro de tu área, marcalo como temporal y avisá con un ejemplo concreto.

## 1. Fuente de verdad (en este orden)

1. Lo que pida la persona del equipo en la sesión.
2. `design/handoff.md`: reglas de marca, interfaz, confianza, voz y journey (v1.5).
3. `design/pantallas/*.png`: las 33 pantallas vigentes. Cada pantalla tiene que verse así.
4. `design/tokens.css`: el único lugar de donde salen colores, tamaños, radios, sombras y tiempos.
5. `design/textos.es.json`: los textos finales.
6. `design/referencia/`: HTML y CSS de referencia que generan los PNG. **Es para consultar, no código de producción.** Copiá valores y estructura, no la arquitectura.

## 2. Reglas de marca (no negociables)

- El nombre es **Mostrame**: sin tilde y nunca «Muéstrame». El wordmark va en minúscula y la tagline es «Te muestro. Lo hacés vos.».
- **Solo modo claro.** No implementes tema oscuro.
- **La letra base es 1.2×:** `<html data-text-scale="1.2">`. Las preferencias permitidas son `1.2`, `1.45` y `1.75`.
- **Colores:**
  - Fondo crema `--color-bg` y texto en `--color-ink` o `--color-muted`.
  - Verde monte `--color-primary` para la acción principal (una por vista) y el foco.
  - Terracota `--color-accent` solo como firma (franja de 4 px de la tarjeta), en íconos o en texto de 24 px o más.
  - **Nunca escribas un color literal en un componente:** siempre `var(--color-…)`.
- **Tipografías:** Fraunces (SOFT 100, WONK 0) solo en wordmark y títulos; Atkinson Hyperlegible Next en todo lo demás. Se cargan locales desde `design/fonts/` (licencia OFL), sin CDN.
- **Íconos:** Lucide (`design/icons/`), trazo de 2 px, siempre con texto visible y `aria-hidden`. Sin emojis.
- **Logo:** solo los SVG de `design/brand/`. No lo redibujes, no lo recolorees y no lo deformes.
- **Prohibido:** degradés, glassmorphism, sombras de color, ilustraciones infantiles y diminutivos.

## 3. Reglas de interfaz

1. **Mostrame es el navegador.** La barra tiene logo, Inicio, Atrás, Recargar, el buscador en píldora, Ayuda y Tamaño de letra. Muestra el dominio con el subdominio en muted y el **dominio principal en negrita, que nunca se corta**.
2. **El inicio es un buscador, no un chat** (pantalla `01`).
   - Si la búsqueda alcanza, Mostrame abre el sitio directo, sin página de resultados.
   - Si falta un dato, muestra preguntas debajo del buscador (`02`, `03`): una por vez, con respuestas en botones grandes, el porqué, las respuestas ya dadas y «No estoy seguro».
3. **«No estoy seguro» → recomendación** (`10`): sitio más afín, sello, dirección, motivo, «Ir con ayuda» o «Solo abrir el sitio», y alternativas.
4. **El sitio ocupa todo el ancho.** La ayuda es una **tarjeta flotante** arriba a la derecha:
   - 400 px de ancho, 24 px del borde, franja superior terracota de 4 px y radio de 20 px.
   - **Nunca tapa el control resaltado.** Si lo taparía, se corre o se achica (`12`).
5. **Resaltado dentro de la página:**
   - Doble anillo `--hl-inner` (3 px) y `--hl-outer` (4 px), con el rótulo «Acá».
   - Va en un overlay con `pointer-events: none` y `aria-hidden`, sin envolver ni modificar el control del sitio.
   - El rótulo va arriba, a la derecha o abajo, según la regla de `design/handoff.md` §4.7.
   - **Nunca lleva instrucciones.**
6. **Comandos visuales permitidos:** `highlight`, `scrollIntoView`, `showInstruction` y `clearGuidance`. **Nunca implementes clics, escritura ni envío de formularios por la persona.**

## 4. Reglas de comportamiento y confianza

- **Una instrucción por vez**, con el nombre exacto del control entre « ». Sin «Paso X de Y»; «Ya hiciste» muestra solo los pasos pasados.
- **«Listo» (`09`, `C11`) solo con evidencia verificada**, citando el texto visible de la página. Sin evidencia se usa «¿Pudiste terminar?» (`16`): neutro, borde punteado, sin verde.
- **Privacidad:**
  - Nunca mostrar ni registrar valores de formularios, contraseñas, documentos ni tarjetas.
  - Al guiar a un campo, mostrar «Esto lo escribís vos. Mostrame no lo ve ni lo guarda.».
- **Antiestafa:**
  - Sello «Sitio oficial» solo con el campo `official` del backend; nunca por HTTPS.
  - El candado va en muted.
  - Antes de pagar, comprobar que la persona sigue en el dominio elegido (`C09`).
- **Acción irreversible** (`C10`): aviso en warning, total citado y «no hay apuro».
- **Errores sin culpa:** «Fue un problema de mi lado, no tuyo».

## 5. Accesibilidad (mínimo WCAG 2.2 AA; AAA en contraste de texto)

- Objetivos de 48 px como mínimo y 12 px entre objetivos.
- Foco visible siempre: `box-shadow: var(--focus-ring)` más `outline` transparente de respaldo.
- Una sola región `aria-live="polite"` para anunciar instrucciones; los errores usan `role="alert"`. **Al mostrar una instrucción nueva no se mueve el foco.**
- Opciones como `ul > li > button`, nunca `role` sobre `div`.
- Con `prefers-reduced-motion`, nada se anima y el resaltado queda fijo con anillo de 6 px.

## 6. Voz

Español rioplatense con voseo, un verbo por instrucción y frases cortas. **Tomá los textos de `design/textos.es.json`**; no inventes textos nuevos sin avisar.

**Palabras prohibidas:** fácil, simplemente, abuelos, adultos mayores, elemento, URL, sesión, «te equivocaste», «¡Perfecto!».

## 7. Definición de terminado (cada pantalla o componente)

- [ ] Se ve como su PNG en `design/pantallas/` a 1440×900 con letra 1.2×. Comparalo con una captura.
- [ ] Ningún color, tamaño ni radio escrito a mano: todo sale de `tokens.css`.
- [ ] Textos tomados de `textos.es.json`.
- [ ] Funciona con teclado, con foco visible y anuncios correctos.
- [ ] A 1.75× las acciones principales siguen visibles sin desplazar.
- [ ] No agrega acciones automáticas sobre el sitio ni muestra datos del trámite.
