# Mostrame · Traspaso a Claude Design (v1.5)

Este documento reúne todo lo necesario para seguir diseñando Mostrame en Claude Design: el contexto del producto, las reglas de marca, el modelo de interfaz, el journey y las 33 pantallas vigentes. Si sos una IA que continúa el proyecto, leelo completo antes de diseñar. Ante cualquier duda, gana lo que dice este documento.

- Autoría: Emi (diseño, marca y UI final).
- Fecha: 17 de octubre de 2026.
- Mercados: Uruguay y Argentina.
- Estado: pantallas y journey **en revisión**. Los tokens y la especificación técnica para Gaston se cierran después de aprobar.

---

## 1. Qué es Mostrame

Mostrame es un **navegador de escritorio con IA y búsqueda inteligente** para personas de 50 años o más. La persona escribe lo que quiere hacer. Mostrame la lleva directo al sitio correcto y, sobre la página real, le muestra dónde hacer cada paso.

- **El asistente no hace clics, no escribe datos y no envía formularios.** Orienta y la persona actúa.
- **No es un chatbot.** El inicio es un buscador y la ayuda flota sobre el sitio.
- **El sitio original no se reconstruye ni se reemplaza.**

**Público:** hombres y mujeres de 50+, de nivel socioeconómico medio, medio-alto y alto. Necesitan la tecnología pero no se llevan bien con ella. Les cuestan las webs del Estado, los bancos y las compras, y tienen miedo de equivocarse, de caer en una estafa o de «romper algo».

**Intención de la experiencia:** que se sienta como alguien de confianza sentado al lado, sin apuro. Es cálida y sobria, nunca infantil ni condescendiente, y la persona siempre tiene el control.

## 2. Marca

| Elemento | Definición |
|---|---|
| Nombre | **Mostrame**. Siempre así: sin tilde, con mayúscula inicial en el texto corrido y en minúscula en el wordmark. Nunca «Muéstrame». |
| Tagline | **Te muestro. Lo hacés vos.** |
| Símbolo | Dos esquinas de un marco en verde monte que encuadran un punto terracota. Es el gesto de señalar «esto, acá», el mismo que hace el resaltado dentro de la página. |
| Wordmark | Fraunces suave (SOFT 100, WONK 0), peso 600, en minúscula, convertido a curvas. |
| Dirección visual | «Sobremesa»: fondo crema, verde monte y terracota como firma. |
| Propósito | Que nadie se sienta de más en internet. |
| Promesa | Te mostramos dónde está cada cosa; vos lo hacés, a tu ritmo, y nadie toca tus datos. |
| Personalidad | Paciente, clara, respetuosa y prudente. |

**Logo**
- Versiones: horizontal en color, monocromo negro, monocromo blanco, símbolo e ícono de app (símbolo crema sobre verde). Los archivos están en `brand/`.
- Margen libre igual al diámetro del punto.
- Tamaño mínimo: 16 px el símbolo y 24 px de alto el horizontal.
- No deformar, no recolorear y no agregar sombras.

## 3. Reglas visuales

**Modo y escala**
- **Solo modo claro.** El modo oscuro se descartó.
- **La letra base del producto es 1.2×.** Todas las pantallas se diseñan a 1.2×.
- La persona puede agrandar la letra a 1.45× y 1.75× desde «Tamaño de letra».
- **Ventana de referencia:** 1440 × 900.

### Color

| Token | Hex | Uso |
|---|---|---|
| bg | `#FBF7F0` | Fondo crema de toda la interfaz de Mostrame |
| surface | `#FFFFFF` | Tarjetas, campos y buscador |
| sunken | `#F3EDE2` | Barra del navegador, pies, zonas de espera |
| ink | `#1F2A24` | Texto principal (13.9:1, AAA) |
| muted | `#4A5550` | Texto secundario (7.3:1, AAA) |
| border | `#D9D0C2` | Solo divisores decorativos |
| border-strong | `#6E675C` | Borde de **todo lo que se puede clickear** (5.2:1) |
| primary | `#1E5A45` | Verde monte: acción principal (una por vista), foco, chips |
| primary-soft | `#E2EEE7` | Nombre del control en la instrucción, respuestas ya dadas |
| accent | `#A9461F` | Terracota, la firma: franja superior de las tarjetas, íconos, texto de 24 px o más. **Nunca texto chico** |
| accent-soft | `#F7E5DA` | Fondo de números y desvíos |
| success / soft | `#2F6B3A` / `#E3F0E4` | **Solo** «Listo» con evidencia y el sello «Sitio oficial» |
| warning / soft | `#8A5A00` / `#F8EDD5` | «No pudimos verificarlo», errores de la página, «Este botón hace la compra» |
| danger / soft | `#A3261B` / `#F9E2DF` | Errores de Mostrame |
| Resaltado | `#111111` + `#FFD23F` | Doble anillo y rótulo «Acá». Es el mismo en cualquier sitio y **nunca** se usa en la interfaz propia |

Reglas de color:
- El texto de párrafo va siempre en ink o muted. Los colores de estado se usan solo en títulos, íconos y bordes.
- Ningún estado se comunica solo con color: siempre lleva ícono más texto, y a veces también una forma (por ejemplo, el borde punteado de «¿Pudiste terminar?»).
- Evitar degradés, glassmorphism, emojis y sombras de colores.

### Tipografía

| Rol | Fuente | Tamaño a 1.2× |
|---|---|---|
| Wordmark y títulos de tarjeta | **Fraunces** (SOFT 100), peso 560 | Títulos 31 px; saludo 43 px |
| Instrucción del paso | **Atkinson Hyperlegible Next**, peso 650 | 28 px |
| Texto base, botones | Atkinson Hyperlegible Next, peso 400 a 650 | 24 px |
| Secundario | Atkinson Hyperlegible Next | 21.6 px |
| Mínimo absoluto | Atkinson Hyperlegible Next | 19 px |

Las dos fuentes son de Google Fonts con licencia OFL. Atkinson Hyperlegible Next está diseñada para baja visión.

### Forma y espacio

- Grilla de 4 px. Entre dos objetivos clickeables hay como mínimo 12 px.
- Radios: 14 px en controles y 20 px en tarjetas. Píldora solo en el buscador y los chips.
- Objetivos de 48 px como mínimo (58 px a 1.2×). El botón principal mide 56 px (67 px a 1.2×).
- **Foco visible siempre:** anillo de 3 px en primary, separado 3 px del control.

### Íconos

Lucide, de trazo de 2 px. Siempre van acompañados de texto. No se usan íconos solos, salvo en atrás, recargar e inicio de la barra, que llevan aria-label.

### Movimiento

- El movimiento guía la atención y nunca decora.
- El resaltado aparece en 280 ms; su halo respira 2 veces y se detiene.
- Con «reducir movimiento» activado, nada se anima.

## 4. Modelo de interfaz

1. **Mostrame es el navegador.** La barra superior tiene logo, Inicio, Atrás y Recargar, el buscador inteligente en píldora, el botón «Ayuda» (cuando hay un sitio abierto) y «Tamaño de letra». Con un sitio abierto, la barra muestra «Estás en» con el subdominio en muted y **el dominio principal en negrita, que nunca se corta**.
2. **El inicio es un buscador, no un chat.** Al centro va el logo grande, la tagline y la barra de búsqueda con micrófono, más los botones «Solo ir al sitio» y «Mostrame cómo». Al pie va una franja con «Uruguay», la promesa de privacidad y «Cómo funciona».
3. **Ir directo.** Si la búsqueda alcanza para elegir el sitio, Mostrame lo abre directo, **sin página de resultados**.
4. **Preguntar lo que falta.** Si falta un dato, aparece una tarjeta debajo del buscador:
   - Arriba dice «Para llevarte directo al sitio justo, necesito un dato».
   - **Una pregunta por vez**, con respuestas en botones grandes y la explicación «Te pregunto porque…».
   - Las respuestas ya dadas quedan visibles como píldoras.
   - Siempre está «No estoy seguro», con borde punteado.
   - Se puede responder otra cosa escribiendo en el buscador.
5. **«No estoy seguro».** Mostrame no insiste: recomienda el sitio más afín con nombre, dirección, sello y motivo, y ofrece «Ir con ayuda» o «Solo abrir el sitio», con alternativas debajo.
6. **El sitio ocupa todo el ancho.** La ayuda es una **tarjeta flotante** arriba a la derecha:
   - Ancho de 400 px, franja superior terracota de 4 px, sombra marcada y radio de 20 px.
   - Tiene encabezado (símbolo, «Mostrame» y «Achicar»), «Tu objetivo», cuerpo y pie con Repetir, Volver un paso y Salir de la ayuda.
   - **Nunca tapa el control resaltado.** Si lo taparía, se corre o se achica a una barra de una línea («Ahora: …» con el botón Abrir).
7. **El resaltado vive dentro de la página.** Es un doble anillo (3 px negro y 4 px amarillo) con el rótulo «Acá». Por defecto el rótulo va arriba a la izquierda; pasa a la derecha cuando el control es un campo y abajo si arriba hay texto. Nunca tapa otro control, nunca intercepta clics y **nunca lleva instrucciones**: la instrucción vive en la tarjeta.
8. **Comandos permitidos:** resaltar, desplazar hasta el elemento, mostrar instrucción y limpiar la guía. No diseñar nada que requiera que Mostrame haga clics o escriba.

## 5. Reglas de comportamiento y confianza

1. **Una instrucción por vez**, con el nombre exacto del control entre « ». Nunca «Paso X de Y» ni pantallas futuras. «Ya hiciste» muestra solo los pasos pasados.
2. **Solo dice «Listo» con evidencia**, citando el texto de la página («La página dice «…»»). Sin evidencia pregunta «¿Pudiste terminar?», con fondo neutro, borde punteado y sin festejo.
3. **Privacidad visible:**
   - Nunca pide ni muestra contraseñas, documentos, tarjetas ni datos del trámite.
   - Cuando hay que escribir algo, avisa: «Esto lo escribís vos. Mostrame no lo ve ni lo guarda.»
   - En el pago aclara: «Tu tarjeta va directo a la tienda. Mostrame no la ve.»
4. **Antiestafa:**
   - Sello «Sitio oficial» solo para dominios verificados. HTTPS no prueba que un sitio sea oficial: el candado va en muted.
   - Las alternativas avisan sus riesgos («Vendedor particular: no pudimos verificarlo»).
   - Antes de pagar, comprueba que la persona sigue en la tienda elegida.
   - «Ninguna tienda me paga por aparecer acá».
5. **Acciones irreversibles:** aviso en warning («Este botón hace la compra»), el total citado de la página y «no hay apuro».
6. **Errores sin culpa:** «Fue un problema de mi lado, no tuyo». Ante un error de la página: «No pasa nada, se arregla acá mismo».

## 6. Voz y microcopy

- Español rioplatense con voseo. Cálido, de igual a igual. Un verbo por instrucción y frases de hasta unas 12 palabras.
- **Se usa:** mostrar, acá, paso, a tu ritmo, con calma, lo hacés vos, hacé clic, ¿pudiste terminar?, de nuevo.
- **Se evita:** fácil, simplemente, abuelos, adultos mayores, tercera edad, diminutivos, «te equivocaste», «¡Perfecto!» sin evidencia, y tecnicismos como URL, pop-up, elemento o sesión.

Textos clave:

| Momento | Texto |
|---|---|
| Buscador | Buscá un sitio o contá qué querés hacer |
| Botones del inicio | Solo ir al sitio · Mostrame cómo |
| Pregunta | Para llevarte directo al sitio justo, necesito un dato. |
| Guía | Hacé clic en el botón «Sacar turno». · Te lo marqué en la página con un borde amarillo y negro. · Te espero. Cuando hagas clic, sigo con vos. |
| Verificando | Estoy fijándome si funcionó… |
| Listo | Listo: tu turno quedó reservado. · La página dice «…». |
| Sin evidencia | ¿Pudiste terminar? · Sí, terminé / Todavía no |
| Todavía no | Sigamos. ¿Qué pasó? · Creo que me falta un paso / La página me mostró un error / Quiero empezar de nuevo |
| Pausa | Pausé la ayuda. Entraste a otra página por tu cuenta. Está todo bien. |
| Salir | Saliste de la ayuda. La página sigue igual. |

## 7. Journey

**Recorrido A · Trámite: renovar la cédula en Uruguay**

```
01 Buscador «renovar documento»
 ├─ si la búsqueda alcanza ─────────────────────────────┐
 └─ 02 ¿Qué documento? → 03 ¿En qué país? ──────────────┤
       └─ «No estoy seguro» → 10 Sitio recomendado ─────┤
                                                        ▼
04 Abriendo el sitio → 05 Opciones (máx. 3) → 06 Guía activa → 07 Verificando
   → 08 Escribir un dato → 09 Listo (con evidencia)
```

Desvíos:

| Desde | Va a | Cuándo |
|---|---|---|
| 05 | 11 Ver otras opciones | «Ver otras opciones». Desde 11 elige otra opción, escribe lo que busca o vuelve a las 3 principales |
| 06 | 12 Tarjeta achicada | «Achicar», o la tarjeta taparía algo |
| 06 | 14 Pregunta en medio de la guía | La página tiene caminos distintos |
| 06 | 15 Navegó por su cuenta | La persona cambió de página; la ayuda queda en pausa |
| 07 | 13 La página marcó un error | Cita el error textual y guía la corrección |
| 07 | 16 ¿Pudiste terminar? | La página cambió pero no hay evidencia |
| 16 | 17 «Todavía no» | Desde 17: falta un paso → 18, error → 13, empezar de nuevo → 05 |
| 04 | 19 Error de Mostrame / 20 Página no soportada | Mostrame no puede leer la página |
| cualquiera | 21 Salió de la ayuda | «Salir de la ayuda» |
| 08 | 22 ¿Volver al inicio? | «Inicio» con datos escritos en la página |

**Recorrido B · Compra online: MacBook Air M1 nueva**

```
C01 Buscador «MacBook Air M1» → C02 ¿Qué querés hacer? → C03 ¿Nueva o usada?
→ C04 Tiendas recomendadas → C05 Opciones en la página del producto
→ C06 Agregar al carrito → C07 Revisar el carrito → C08 Dirección de envío
→ C09 Pago (comprueba la tienda) → C10 Confirmar compra (aviso) → C11 Compra confirmada
```

Los desvíos del recorrido A aplican igual en cada paso de la compra.

## 8. Inventario de pantallas (33)

Las imágenes están en `pantallas/`, con el nombre `<código>.png` (2160 × 1350, letra 1.2×).

| Código | Pantalla | Qué resuelve |
|---|---|---|
| 01 | Inicio · buscador | Mostrame se ve como un buscador. La persona escribe con sus palabras lo que quiere hacer. Si con eso alcanza para saber a qué sitio ir, lo abre directo, sin página de resultados. |
| 02 | Pregunta: ¿qué documento? | A «renovar documento» le falta un dato. Mostrame pregunta debajo del buscador, con respuestas grandes y el porqué. Siempre está «No estoy seguro». |
| 03 | Pregunta: ¿en qué país? | Una pregunta por vez. Arriba queda lo que ya respondió. Con este dato ya sabe a qué sitio llevarla. |
| 04 | Abriendo el sitio | Con los datos completos, Mostrame abre el sitio directo. El sitio ocupa todo el ancho y la tarjeta flotante avisa que está mirando la página. |
| 05 | Opciones de la página | Tarjeta flotante a la derecha, sin tapar contenido: hasta 3 cosas que se pueden hacer en esta página. |
| 06 | Guía activa | Una instrucción por vez en la tarjeta. El doble anillo y el rótulo «Acá» marcan el botón real. |
| 07 | Verificando después del clic | La página cambió. Mostrame comprueba que funcionó antes de dar el próximo paso. «Ya hiciste» suma el clic. |
| 08 | Escribir un dato | Guía hacia un campo con la promesa de privacidad a la vista. El rótulo va al costado para no tapar la etiqueta. La persona avisa con «Listo, ya lo escribí». |
| 09 | Tarea completada (con evidencia) | Verde, ícono de tilde y la evidencia citada. Solo se muestra cuando el verificador confirma. |
| 10 | «No estoy seguro»: sitio recomendado | Si la persona responde «No estoy seguro», Mostrame no insiste: recomienda el sitio más afín a lo que buscó, con alternativas, y deja el buscador para afinar. |
| 11 | Ver otras opciones | El resto de lo que se puede hacer en la página, más un campo para contar con sus palabras lo que busca. Siempre puede volver a las 3 principales. |
| 12 | Guía · tarjeta achicada | Si la tarjeta tapa algo, se achica a una barra de una línea. El resaltado sigue visible. |
| 13 | La página marcó un error | Cita el error textual de la página, tranquiliza y lleva al campo que hay que corregir. |
| 14 | Pregunta en medio de la guía | Cuando la página tiene caminos distintos, pregunta con respuestas sugeridas y explica por qué. |
| 15 | Navegó por su cuenta | La ayuda se pausa sin reproches y ofrece seguir donde estaban o salir. |
| 16 | ¿Pudiste terminar? (sin evidencia) | Fondo neutro, borde punteado y ninguna celebración. La persona confirma. |
| 17 | Respondió «Todavía no» | Mostrame pregunta qué pasó con 3 respuestas simples: falta un paso, apareció un error o empezar de nuevo. |
| 18 | Seguimos con el paso que faltaba | Mostrame mira la página de nuevo, explica qué falta y marca el botón. El rótulo va abajo para no tapar texto. |
| 19 | Error de Mostrame | No culpa a la persona. La página sigue funcionando. |
| 20 | Página no soportada | Explica por qué no puede ayudar, ofrece salidas y avisa que fuera de Mostrame se pierde la guía. |
| 21 | Salió de la ayuda | La tarjeta se cierra y queda un aviso discreto con «Volver a la ayuda». El botón Ayuda de la barra se ve apagado. |
| 22 | ¿Volver al inicio? | Confirmación antes de dejar una página donde puede haber datos escritos. |
| C01 | Búsqueda: «MacBook Air M1» | La persona escribe solo el nombre del producto en el buscador, como lo haría en Google. |
| C02 | Pregunta: ¿qué querés hacer? | Mostrame no asume que quiere comprar: pregunta si quiere comprarla, saber cuánto sale o aprender a usarla. |
| C03 | Pregunta: ¿nueva o usada? | La respuesta cambia qué tiendas conviene recomendar. Arriba queda lo que ya respondió. |
| C04 | Tiendas recomendadas | Con la necesidad clara, recomienda la tienda mejor valorada para comprarla nueva y con garantía: precio, garantía, envío y motivo. Las alternativas avisan sus riesgos. |
| C05 | Opciones en la página del producto | La tarjeta flotante ofrece comprarla, ver garantía y envío, o comparar. |
| C06 | Agregar al carrito | Confirma el color ya elegido antes de avanzar y marca «Agregar al carrito». |
| C07 | Revisar el carrito | Mostrame lee el carrito y confirma: 1 unidad, precio y envío. Después, «Finalizar compra». |
| C08 | Dirección de envío | La persona escribe su dirección. La privacidad está a la vista y ella avisa cuando terminó. |
| C09 | Pago con tarjeta | Antes de pagar, Mostrame comprueba que sigue en la tienda elegida. La tarjeta va directo a la tienda: Mostrame no la ve. |
| C10 | Confirmar la compra | Aviso explícito de que ese botón compra, con el total citado de la página y sin apuro. |
| C11 | Compra confirmada (con evidencia) | Solo con la confirmación visible de la tienda: número de pedido citado. |

## 9. Sitios de ejemplo

- **«Identificación Civil»** en `agenda.ejemplo.gub.uy`.
- **«TiendaMac Uruguay»** en `tiendamac.ejemplo.com.uy`.

Son **ficticios** y van rotulados «Sitio externo de ejemplo». No reproducir marcas ni interfaces de organismos o comercios reales.

## 10. Pendientes y decisiones abiertas

1. **Aprobar las pantallas y el journey.** Después se cierran los tokens (`tokens.css`) y la especificación para Gaston.
2. **Gaston:** definir si la tarjeta flotante va como vista nativa propia sobre el sitio (recomendado, porque la página no puede taparla ni imitarla) o inyectada en shadow DOM.
3. **Agustin:** sumar el campo `official` en los resultados de búsqueda, que sale del registro curado de dominios.
4. **Emi:** confirmar la política «Mostrame nunca te contacta por mensaje para pedir datos».
5. **Validar con 3 a 5 personas de 50+** los tamaños (letra 1.2×, botones) y los textos.

## 11. Cómo seguir en Claude Design

**Ya existen dos artefactos:**
- El Design System **«Mostrame»**, con tokens, componentes y logos.
- El lienzo **«Mostrame · Pantallas y estados»**, con las 33 pantallas de este documento en tres filas: camino principal, desvíos y compra.

Para seguir trabajando:
1. Abrí el lienzo y trabajá sobre esas pantallas. Para pantallas nuevas, usá el Design System «Mostrame».
2. Si arrancás un proyecto nuevo, adjuntá este documento y la carpeta `pantallas/`, y pegá el prompt de abajo.

**Prompt para retomar:**

> Sos el diseñador de Mostrame. Leé el documento «Mostrame · Traspaso a Claude Design (v1.5)» adjunto y respetá sus reglas de marca, interfaz, confianza y voz. Usá el Design System «Mostrame» (solo modo claro, letra 1.2×, ventana de 1440×900). Las 33 pantallas adjuntas son la referencia vigente. Antes de diseñar algo nuevo, ubicá en qué punto del journey (sección 7) entra y qué código le corresponde. No diseñes nada que requiera que Mostrame haga clics o escriba datos por la persona.
