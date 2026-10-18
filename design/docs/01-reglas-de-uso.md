# 01 · Reglas de uso (v2.4)

Estas reglas **no son negociables** al implementar. Vienen de validar el recorrido con personas de 50+ (Marta, 67, trámite; Jorge, 71, compra). Si una necesidad técnica choca con una regla, se para y se consulta a producto: no se resuelve en código.

Público: personas mayores que no se llevan bien con la tecnología. Cada decisión prioriza que entiendan **dónde están, qué tienen que hacer ahora y que no rompieron nada**.

## R1 · Una cosa por pantalla
Cada vista muestra una pregunta, una instrucción o un estado. Nunca dos.

## R2 · Una sola acción principal por vista
- Como mucho una acción principal (gradiente azul, texto blanco) y una alternativa.
- Lo demás va detrás de un enlace discreto («Ver otras opciones»).
- El verde queda solo para estados de éxito («Sitio oficial», «Listo»), nunca para botones.

## R3 · Texto mínimo
- Instrucción: 10 palabras o menos. Apoyo: una línea.
- Prohibido: «Tu objetivo», «AHORA», «Repetir», listas de más de 3 ítems, descripciones debajo de cada opción.
- El texto sale del guion (`docs/historial/`) y, ante cualquier duda, de **lo que dice la pantalla**. No se reescribe en código.

## R4 · Tarjeta flotante
- 520px de ancho, `top: 100px; right: 24px`, radio 28px, halo azul y sombra profunda, `z-index: 5`.
- **Encabezado claro** (gradiente `#EAF3FF → #FFFFFF`): ícono de Guíame, objetivo («Renovar la cédula») y «Achicar».
- **Cuerpo:** una instrucción de 32px, un apoyo de 22px y la línea «Vas bien: ya hiciste N pasos.».
- **Pie:** en pasos guiados lleva «Volver un paso» y «Salir de la ayuda», uno debajo del otro. En los demás estados, solo «Salir de la ayuda».
- **Nunca tapa el control resaltado:** el contenido útil del sitio vive en los primeros ~880px.

## R5 · Ningún salto mágico
- Cada clic o campo del sitio tiene su propio paso guiado.
- Si la página cambia entre dos pantallas, tiene que haber una instrucción que explique el clic que lo causó.
- El contador sube de a 1 y **cuenta solo acciones hechas en el sitio** (no respuestas a Guíame). Sin línea de progreso hasta que haya al menos 1 paso.
- Formularios con varios campos iguales: se guía el primero como patrón; los botones que cambian de página **siempre** tienen su paso.
- Los números de progreso válidos son **los de las pantallas** (`03-pantallas-y-flujos.md`).

## R6 · Barra del navegador
- 76px, gradiente celeste → azul (`#3A9BFF → #2B86FF → #1F74F0`), `z-index: 3`.
- **Logo:** `assets/logo/guiame-blanco.png` (solo «Guíame» en blanco con avioncito, **sin ojos**), 38px de alto, **sin contenedor**.
- En el inicio y en las preguntas previas: solo logo y «Tamaño de letra».
- Con un sitio abierto: logo, Inicio, Atrás, píldora «Estás en» con el dominio en negrita, sello, «Ayuda» y «Tamaño de letra».
- Sellos (píldora): «Sitio oficial» en verde, «La tienda que elegiste» en neutro, «No verificado» en ámbar. Sin sello cuando todavía no hay sitio. Sin candado.

## R7 · «Ayuda» de la barra
| Estado | Cuándo | Estilo |
|---|---|---|
| Abierta | Tarjeta visible o achicada | Borde 2px blanco, fondo blanco al 20%, texto blanco, `aria-pressed="true"` |
| En pausa | La persona navegó por su cuenta | Borde punteado blanco, texto «Ayuda (en pausa)» |
| Cerrada | Salió de la ayuda | Botón blanco con texto e ícono azul |

## R8 · Resaltado del control
- Anillo blanco de 3px + borde azul celeste de 4px (`#1F8BFF`) + halo suave. **Ya no se usa amarillo ni negro.**
- Rótulo «Acá» de 20px, gradiente azul y texto blanco.
- **Nunca tapa texto ni etiquetas.** El rótulo va arriba si no hay texto encima, abajo si lo hay, a la derecha en campos.
- En los campos rodea **la etiqueta y el campo** juntos.
- El control resaltado queda por encima del velo del sitio (`z-index: 2`).
- En la instrucción, el nombre del control va entre « » en un chip azul suave. El apoyo dice «Te lo marqué con un borde azul.».

## R9 · Protagonismo de la capa Guíame
- Con la tarjeta abierta o achicada, el sitio lleva un velo suave y parejo (`z-index: 1`, navy al 12%, **sin gradiente**). Lo único que sube por encima es el control resaltado.
- Sin tarjeta (pantalla 21) no hay velo.

## R10 · Confianza
- **«Listo» solo con evidencia**, citada textual en «La página dice». Sin evidencia → «¿Pudiste terminar?» (16).
- La privacidad se dice **en una línea** solo cuando hay que escribir o pagar: «Lo escribís vos. Yo no lo veo ni lo guardo.» Es una **promesa técnica**: ver `04-contrato-backend.md`, Privacidad.
- Antes de pagar, Guíame comprueba que la persona sigue en la tienda elegida («Seguís en TiendaMac, la tienda que elegiste.»). Si cambia el dominio → C15.
- Nunca usar «conexión cifrada».
- Las recomendaciones de sitio o tienda declaran que nadie paga por aparecer.

## R11 · Voz
Voseo rioplatense. «No sé bien» en lugar de «No estoy seguro». Sin tecnicismos ni festejos. Los errores propios se asumen: «Fue un problema mío, no tuyo.»

## R12 · Marca
- El nombre se escribe siempre **«Guíame»**.
- Uso del logo según el fondo (archivos en `assets/logo/`):

| Fondo | Versión |
|---|---|
| Azul o gradiente azul (barra, fondos oscuros) | `guiame-blanco.png` (barra) o `guiame-wordmark-blanco.png`. `guiame-blanco-ojos.png` ya no se usa en la barra. **Nunca** las versiones con contenedor celeste |
| Blanco o claro | `guiame-icono.png`, `guiame-pill-ojos.png`, `guiame-pill.png`, `guiame-wordmark-azul.png` |

- El ícono con contenedor celeste (`guiame-icono.png`) va solo sobre fondos claros: encabezado de la tarjeta (38px), inicio (78px), tarjeta achicada (40px).

## R13 · Sitios y datos de ejemplo
- Los sitios de las pantallas son ficticios («Sitio externo de ejemplo»). No se implementan: en producción es el sitio real.
- Fechas del guion: hoy es sábado 17 de octubre de 2026; turno miércoles 4 de noviembre de 2026, 10:30, Oficina Centro; pedido N.º 10482 llega el jueves 22 de octubre. Usarlos solo como fixtures.

## R14 · Accesibilidad
- Poppins en toda la capa Guíame (`assets/fonts/`, pesos 300–700). Cifras literales con `font-variant-numeric: tabular-nums`.
- Tamaños: instrucción 32px, base 21–24px, mínimo 20px (19px solo en sellos y rótulos).
- Contraste: texto ≥ 4.5:1; texto grande y controles ≥ 3:1 (texto blanco sobre la barra va en 22px semibold).
- Áreas táctiles ≥ 48px (barra 54px, botones 58–72px).
- Controles reales: `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` en botones de solo ícono; el logo lleva `alt="Guíame"`.
- «Tamaño de letra» escala toda la capa Guíame; los diseños están a 1.2×.
- Sin animaciones que distraigan; respetar `prefers-reduced-motion`.
- Las pantallas propias de Guíame tienen **fondo blanco con el patrón de puntos, sin gradiente azul** (v2.3). El patrón nunca va sobre el sitio.
- **Prohibido el gradiente de pantalla completa.** El gradiente queda solo en la barra, la tarjeta flotante, los botones principales, «Hablar» y el rótulo «Acá».
