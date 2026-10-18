---
name: guiame-ui
description: Implementar o revisar pantallas, componentes y textos de la capa de ayuda de Guíame (navegador con IA para personas de 50+) siguiendo su marca, tokens y las 51 pantallas de referencia v2.2. Usar al crear, modificar o revisar cualquier vista, componente o texto visible de Guíame.
---

# Guíame UI (v2.2)

Seguí siempre `CLAUDE.md` (raíz). Este skill dice **cómo** trabajar una pantalla.

## Flujo de trabajo

1. **Ubicá la pantalla.** Buscá su archivo en la tabla de abajo y mirá `design/png/<archivo>.png` (leelo como imagen). Si lo que te piden no está en la tabla, ubicá en qué punto del recorrido entra (`design/docs/03-pantallas-y-flujos.md`, «Recorridos») y proponé un nombre antes de construir. Si está en «Casos sin diseño» de `CLAUDE.md`, no lo diseñes: usá el respaldo y avisá.
2. **Leé la referencia.** Abrí `design/preview/<archivo>.html` (HTML estático, sin internet) o la fuente `design/pantallas/<archivo>.dc.html`. Sacá estructura, medidas y textos exactos. **No copies los estilos inline:** traducilos a los tokens y a los componentes del repositorio.
3. **Ubicá el estado de tarjeta.** En `design/docs/04-contrato-backend.md` §3, buscá el `tipo` de la tarjeta (columna «Tipo» de la tabla) y qué datos necesita. El componente recibe esos datos por props o estado; **no llama al backend**.
4. **Tokens primero.** Importá `design/tokens/tokens.css` y usá sus clases base (`.g-bar`, `.g-card`, `.g-primary`, `.g-secondary`, `.g-voice`, `.g-highlight`, `.g-site-veil`, `.g-ground`). No declares valores propios si hay token.
5. **Textos.** Copialos literal de la pantalla y de la columna «Texto principal» de `docs/03`. Si falta uno, `TODO(copy)` y avisá en el resumen.
6. **Verificá.** Tomá una captura a 1440×900 de tu implementación, comparala con `design/png/<archivo>.png` y repasá la definición de terminado de `CLAUDE.md` §9. En el resumen, decí qué diferencias quedan y por qué.

## Componentes del sistema

| Componente | Dónde se ve | Referencia |
|---|---|---|
| Barra del navegador | Todas | `.g-bar`, `.g-bar__logo` (`guiame-blanco.png`, sin ojos) · R6, R7 |
| Buscador de inicio + «Hablar» | A-01, B-C01 | `.g-ground`, `.g-voice--home`, `.g-primary` |
| Tarjeta de pregunta | A-02, A-03, A-17, B-C02, B-C03 | 880px centrada; `.g-voice` en el campo · `docs/02` |
| Recomendación de sitio | A-10, B-C04 | 880px; sello, motivo, «Ir con ayuda» + «Solo abrir el sitio» |
| Tarjeta flotante | A-04 a A-22, N-*, B-C04B a B-C11 | `.g-card`, `.g-card__head` · R4 |
| Tarjeta achicada | A-12 | 520×80 · `docs/02` |
| Resaltado + «Acá» | pasos `paso_clic`, `paso_elegir`, `paso_escribir` | `.g-highlight`, `.g-highlight__label` · R8 |
| Velo del sitio | Con tarjeta abierta o achicada | `.g-site-veil` · R9 |
| Bloques de estado | A-09, A-13, A-16, A-19, A-20, B-C10 a C15 | `docs/02` › «Bloques de estado» |
| Cita «La página dice» | A-09, B-C07, B-C11 | `docs/02` |
| Diálogo | A-22 | scrim + diálogo 640px |
| Hoja de componentes | — | `design/png/Componentes.png` |

## Pantallas

| Archivo | Pantalla | Tipo de tarjeta | Recorrido |
|---|---|---|---|
| `A-01-inicio` | 01 Inicio | inicio | Recorrido A · camino principal |
| `A-02-que-documento` | 02 ¿Qué documento? | pregunta | Recorrido A · camino principal |
| `A-03-pais` | 03 ¿Es en Uruguay? | pregunta | Recorrido A · camino principal |
| `A-04-abriendo` | 04 Abriendo el sitio | espera | Recorrido A · camino principal |
| `A-05-opciones` | 05 ¿Qué querés hacer acá? | opciones | Recorrido A · camino principal |
| `A-06-guia` | 06 Sacar turno | paso_clic | Recorrido A · camino principal |
| `A-07-verificando` | 07 Verificando | espera | Recorrido A · camino principal |
| `A-07B-oficina` | 07B Oficina | paso_elegir | Recorrido A · camino principal |
| `A-07C-horario` | 07C Horario | paso_elegir | Recorrido A · camino principal |
| `A-07D-continuar` | 07D Continuar | paso_clic | Recorrido A · camino principal |
| `A-14-pregunta-guia` | 14 Para mí | pregunta + paso_clic | Recorrido A · camino principal |
| `A-08-dato` | 08 Número de documento | paso_escribir | Recorrido A · camino principal |
| `A-08B-nacimiento` | 08B Fecha de nacimiento | paso_escribir | Recorrido A · camino principal |
| `A-08C-continuar` | 08C Continuar | paso_clic | Recorrido A · camino principal |
| `A-08D-confirmar` | 08D Confirmar reserva | paso_clic | Recorrido A · camino principal |
| `A-09-listo` | 09 Listo | estado_exito | Recorrido A · camino principal |
| `A-10-no-se-bien` | 10 No sé bien | recomendacion | Recorrido A · desvíos |
| `A-11-otras-opciones` | 11 Otras opciones | opciones | Recorrido A · desvíos |
| `A-12-achicada` | 12 Tarjeta achicada | tarjeta achicada | Recorrido A · desvíos |
| `A-13-error-pagina` | 13 Error de la página | estado_aviso + paso_elegir | Recorrido A · desvíos |
| `A-15-pausa` | 15 Pausa | pausa | Recorrido A · desvíos |
| `A-16-pudiste` | 16 ¿Pudiste terminar? | pudiste_terminar | Recorrido A · desvíos |
| `A-17-todavia-no` | 17 Todavía no | pregunta | Recorrido A · desvíos |
| `A-18-paso-faltante` | 18 Paso que faltaba | paso_clic | Recorrido A · desvíos |
| `N-32-cierre` | 32 Cierre sin evidencia | cierre sin evidencia | Recorrido A · desvíos |
| `A-19-error-mostrame` | 19 Error de Guíame | error_guiame | Recorrido A · desvíos |
| `A-20-no-soportada` | 20 No soportada | no_soportada | Recorrido A · desvíos |
| `A-21-salio` | 21 Salió de la ayuda | ayuda cerrada | Recorrido A · desvíos |
| `A-22-volver-inicio` | 22 ¿Volver al inicio? | diálogo | Recorrido A · desvíos |
| `N-25-iniciar-sesion` | 25 Usuario | paso_escribir | Ingreso con usuario |
| `N-25B-contrasena` | 25B Contraseña | paso_escribir | Ingreso con usuario |
| `N-25C-ingresar` | 25C Ingresar | paso_clic | Ingreso con usuario |
| `N-26-codigo` | 26 Código | paso_escribir | Ingreso con usuario |
| `N-26B-verificar` | 26B Verificar | paso_clic | Ingreso con usuario |
| `B-C01-busqueda` | C01 Búsqueda | inicio | Recorrido B · compra |
| `B-C02-que-hacer` | C02 ¿Qué querés hacer? | pregunta | Recorrido B · compra |
| `B-C03-nueva-usada` | C03 ¿Nueva o usada? | pregunta | Recorrido B · compra |
| `B-C04-tiendas` | C04 Tienda recomendada | recomendacion | Recorrido B · compra |
| `B-C04B-abriendo` | C04B Abriendo la tienda | espera | Recorrido B · compra |
| `B-C05-opciones-producto` | C05 ¿Es esta? | opciones | Recorrido B · compra |
| `B-C06-carrito` | C06 Agregar al carrito | paso_clic | Recorrido B · compra |
| `B-C07-revisar-carrito` | C07 Revisar carrito | paso_clic + cita | Recorrido B · compra |
| `B-C08-direccion` | C08 Dirección | paso_escribir | Recorrido B · compra |
| `B-C08B-continuar-pago` | C08B Continuar al pago | paso_clic | Recorrido B · compra |
| `B-C09-pago` | C09 Número de tarjeta | paso_escribir + verificación de tienda | Recorrido B · compra |
| `B-C09C-codigo` | C09C Código de seguridad | paso_escribir | Recorrido B · compra |
| `B-C09B-revisar-pedido` | C09B Revisar pedido | paso_clic | Recorrido B · compra |
| `B-C10-confirmar` | C10 Confirmar compra | estado_aviso + paso_clic | Recorrido B · compra |
| `B-C11-confirmada` | C11 Compra confirmada | estado_exito | Recorrido B · compra |
| `N-C12-pago-rechazado` | C12 Pago rechazado | estado_aviso + opciones | Recorrido B · desvíos |
| `N-C15-sitio-dudoso` | C15 Sitio no verificado | estado_aviso (sitio no verificado) | Recorrido B · desvíos |

`Main.png` es una auditoría v1.6 (antecedente): no se implementa. Las transiciones están en `docs/03`, «Recorridos».

## Errores comunes a evitar

- Convertir el inicio en un chat. Es un buscador con una pregunta por vez.
- Poner la ayuda en una columna lateral. Es una tarjeta flotante sobre el sitio.
- Hacer clic o enviar por la persona. Solo se resalta, se desplaza y se instruye. La única escritura permitida es la de un dato no sensible que la persona dictó y confirma (ver `CLAUDE.md` §2).
- Usar el logo con ojos o con contenedor celeste en la barra.
- Achicar el micrófono a un ícono suelto: lleva el texto visible «Hablar».
- Mostrar «Listo» o verde sin evidencia literal de la página.
- Sumar al contador respuestas a Guíame, o agrupar dos clics en una instrucción.
- Resaltado amarillo o negro, o un resaltado que recibe clics o tapa la etiqueta.
- Implementar los sitios ficticios en Arial como si fueran parte del producto.
- Mandar al modelo DOM o capturas con valores de campos sin enmascarar.
