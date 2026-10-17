---
name: mostrame-ui
description: Implementar o revisar pantallas y componentes de la UI de Mostrame (navegador para personas de 50+) siguiendo su marca, tokens, textos y las 33 pantallas de referencia. Usar al crear, modificar o revisar cualquier vista, componente o texto visible de Mostrame.
---

# Mostrame UI

Seguí siempre `CLAUDE.md` (raíz). Este skill dice **cómo** trabajar una pantalla.

## Flujo de trabajo

1. **Ubicá la pantalla.** Buscá su código en la tabla de abajo y abrí el PNG de `design/pantallas/<código>.png`. Si lo que te piden no está en la tabla, ubicá en qué punto del journey entra (`design/handoff.md`, §7) y proponé un código antes de construir.
2. **Leé la referencia.** Abrí `design/referencia/app.html?s=<clave>` en un navegador. La función de esa clave en `app.html` y las clases de `app.css` muestran la estructura y los valores exactos. Es referencia, no código para copiar tal cual: adaptalo a los componentes y al framework del repositorio.
3. **Tokens primero.** Importá `design/tokens.css`, que reemplaza a `packages/ui/src/tokens.css`. Fijá `<html data-text-scale="1.2">`. No declares valores propios.
4. **Textos.** Sacalos de `design/textos.es.json` por clave. Si falta uno, agregalo al JSON con una clave nueva y avisá en el resumen.
5. **Construí solo la presentación.** Recibí los datos por props o estado (opciones, instrucción, evidencia, `official`, dominio) y no llames al backend desde los componentes de UI.
6. **Verificá.** Tomá una captura a 1440×900 y comparala con el PNG. Revisá la definición de terminado de `CLAUDE.md` §7.

## Componentes del sistema

| Componente | Dónde se ve | Clase de referencia |
|---|---|---|
| Barra del navegador | Todas | `.chrome`, `.omni`, `.btn-help` |
| Buscador de inicio | 01, C01 | `.search-home`, `.sbox`, `.sbtns`, `.sfoot` |
| Tarjeta de pregunta | 02, 03, C02, C03 | `.ask-page`, `.ask-card`, `.ask-opts`, `.ask-done` |
| Recomendación de sitios | 10, C04 | `.reco`, `.site-card`, `.badge`, `.shop-facts` |
| Tarjeta flotante de ayuda | 04 a 22, C05 a C11 | `.mm-card` (+ `tone-success / ask / error / warn`), `.mm-pill` |
| Opción de página | 05, 11, 17, C05 | `.option-list > li > .option` |
| Paso actual | 06, 08, 18, C06 a C10 | `.now`, `.instr`, `.ctl-name`, `.waiting`, `.mm-callout` |
| Estados | 09, 16, 19, 20, C11 | `.status.success / .ask / .error / .unsupported` |
| Resaltado | 06, 08, 13, 18, C06 a C10 | `.hl-ring`, `.hl-label` (`.side`, `.below`) |
| Aviso y diálogo | 21, 22 | `.mm-toast`, `.mm-scrim`, `.mm-dialog` |

## Pantallas (código, nombre y referencia)

| Código | Pantalla | Referencia |
|---|---|---|
| `01` | Inicio · buscador | `design/referencia/app.html?s=s_home` |
| `02` | Pregunta: ¿qué documento? | `design/referencia/app.html?s=s_q1` |
| `03` | Pregunta: ¿en qué país? | `design/referencia/app.html?s=s_q2` |
| `04` | Abriendo el sitio | `design/referencia/app.html?s=analizando` |
| `05` | Opciones de la página | `design/referencia/app.html?s=opciones` |
| `06` | Guía activa | `design/referencia/app.html?s=guia` |
| `07` | Verificando después del clic | `design/referencia/app.html?s=verificando` |
| `08` | Escribir un dato | `design/referencia/app.html?s=campo` |
| `09` | Tarea completada (con evidencia) | `design/referencia/app.html?s=completada` |
| `10` | «No estoy seguro»: sitio recomendado | `design/referencia/app.html?s=s_reco` |
| `11` | Ver otras opciones | `design/referencia/app.html?s=opcionesmas` |
| `12` | Guía · tarjeta achicada | `design/referencia/app.html?s=guiamin` |
| `13` | La página marcó un error | `design/referencia/app.html?s=errorpagina` |
| `14` | Pregunta en medio de la guía | `design/referencia/app.html?s=aclaracionguia` |
| `15` | Navegó por su cuenta | `design/referencia/app.html?s=pausada` |
| `16` | ¿Pudiste terminar? (sin evidencia) | `design/referencia/app.html?s=confirmar` |
| `17` | Respondió «Todavía no» | `design/referencia/app.html?s=todaviano` |
| `18` | Seguimos con el paso que faltaba | `design/referencia/app.html?s=todavianosigue` |
| `19` | Error de Mostrame | `design/referencia/app.html?s=error` |
| `20` | Página no soportada | `design/referencia/app.html?s=nosoportada` |
| `21` | Salió de la ayuda | `design/referencia/app.html?s=salir` |
| `22` | ¿Volver al inicio? | `design/referencia/app.html?s=inicioconfirmar` |
| `C01` | Búsqueda: «MacBook Air M1» | `design/referencia/app.html?s=s_home_b` |
| `C02` | Pregunta: ¿qué querés hacer? | `design/referencia/app.html?s=s_q1_b` |
| `C03` | Pregunta: ¿nueva o usada? | `design/referencia/app.html?s=s_q2_b` |
| `C04` | Tiendas recomendadas | `design/referencia/app.html?s=s_reco_b` |
| `C05` | Opciones en la página del producto | `design/referencia/app.html?s=c_opciones` |
| `C06` | Agregar al carrito | `design/referencia/app.html?s=c_carrito1` |
| `C07` | Revisar el carrito | `design/referencia/app.html?s=c_carrito2` |
| `C08` | Dirección de envío | `design/referencia/app.html?s=c_envio` |
| `C09` | Pago con tarjeta | `design/referencia/app.html?s=c_pago` |
| `C10` | Confirmar la compra | `design/referencia/app.html?s=c_confirmar` |
| `C11` | Compra confirmada (con evidencia) | `design/referencia/app.html?s=c_listo` |

Las pantallas 01 a 09 son el camino principal del trámite; 10 a 22 son sus desvíos; C01 a C11 son el recorrido de compra. Las transiciones de cada pantalla están en `design/handoff.md`, §7.

## Errores comunes a evitar

- Convertir el inicio en un chat. Es un buscador.
- Poner la ayuda en una columna lateral. Es una tarjeta flotante sobre el sitio.
- Mostrar «Listo» o colores de éxito sin evidencia de la página.
- Escribir instrucciones dentro de la página o hacer que el resaltado reciba clics.
- Usar colores, fuentes o radios fuera de los tokens, o agregar un modo oscuro.
- Inventar textos con tono infantil o técnico.
