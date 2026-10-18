# 04 · Contrato de estados y datos (propuesta para backend)

> **Estado: propuesta.** Las pantallas definen *qué ve la persona*; este documento traduce eso en los estados, eventos y datos que el sistema tiene que producir para que cada pantalla sea posible. Los nombres de campos son sugeridos. Lo que está marcado **[DECIDIR]** no lo resuelven las pantallas y lo tiene que cerrar el equipo.

## 1. Piezas del sistema (vista lógica)
| Pieza | Responsabilidad | Pantallas |
|---|---|---|
| **Intención** | Pasar el pedido libre («renovar documento», voz o texto) a un objetivo y a las preguntas necesarias | 01, 02, 03, 10, C01–C04 |
| **Directorio de sitios** | Recomendar sitio o tienda y clasificar dominios | 10, C04, barra (sellos), C15 |
| **Lector de página** | Entender la página actual: qué opciones hay, qué control sigue, errores, evidencia de éxito | 04, 05, 07, 13, 16, 19, 20, 25 |
| **Motor de pasos** | Generar un paso a la vez, contar pasos hechos, volver un paso | 06–08D, 14, 18, 25–26B, C05–C10 |
| **Verificador** | Confirmar que el paso se hizo (cambio de página, campo completo, selección) | 07, 07D, 08C, C08B, C09B |
| **Sesión de ayuda** | Estado de la ayuda (abierta/achicada/pausa/cerrada), objetivo, sitio elegido | barra, 12, 15, 21, 22 |

## 2. Modelo de sesión
```jsonc
GuideSession {
  id: string,
  objetivo: { clave: "renovar_cedula" | "comprar_producto" | ..., texto: "Renovar la cédula" },
  respuestas: [{ pregunta: "documento", valor: "cedula", rotulo: "Cédula de identidad" }],
  sitio_elegido: { nombre, dominio, tipo: "oficial" | "tienda" },   // fijado en 10 / C04
  ayuda: "abierta" | "achicada" | "pausa" | "cerrada",
  pasos_hechos: number,        // R5: solo acciones en el sitio, sube de a 1
  historial_pasos: Paso[],     // para «Volver un paso»
  tarjeta: TarjetaEstado       // lo que se muestra ahora
}
```

### Sello de la barra (por cada navegación)
```jsonc
Sello = "oficial" | "tienda_elegida" | "no_verificado" | null   // null = sin sitio todavía
```
- `oficial`: el dominio pertenece al directorio oficial. **[DECIDIR]** fuente del directorio (lista curada, registro gubernamental).
- `tienda_elegida`: el dominio coincide exactamente con `sitio_elegido.dominio`.
- `no_verificado`: cualquier otro dominio. Si además el objetivo está en compra → pantalla C15.

## 3. Estados de la tarjeta
Cada respuesta del backend devuelve **un** `TarjetaEstado` (R1). El cliente lo dibuja con los componentes de `02-sistema-visual.md`.

| `tipo` | Pantallas | Datos que necesita |
|---|---|---|
| `pregunta` | 02, 03, 14, 17, C02, C03 | `titulo`, `porque`, `respuestas[] {id, texto, icono}`, incluye «No sé bien» |
| `recomendacion` | 10, C04 | `sitio {nombre, dominio, sello}`, `motivo`, `datos[]` (precio, garantía, envío), `accion_principal`, `enlace` |
| `espera` | 04, 07, C04B | `instruccion` («Estoy mirando la página…»), `apoyo` |
| `opciones` | 05, 11, C05 | `titulo`, `opciones[] {id, texto, numero?}`, `enlace_mas?` |
| `paso_clic` | 06, 07D, 08C, 08D, 18, 25C, 26B, C06–C10 | `control {etiqueta, selector, posicion_rotulo}`, `instruccion`, `apoyo`, `pasos_hechos` |
| `paso_elegir` | 07B, 07C | ídem + el anillo rodea etiqueta + control |
| `paso_escribir` | 08, 08B, 25, 25B, 26, C08, C09, C09C | ídem + `privacidad: true` + acción principal «Ya lo escribí» |
| `estado_exito` | 09, C11 | `titulo`, `evidencia {texto_literal}` (**obligatorio**), `accion_principal` |
| `estado_aviso` | 13, C10, C12, C15 | `titulo`, `evidencia?`, `apoyo`, siguiente paso u opciones |
| `pudiste_terminar` | 16 → 17 / 32 | sin evidencia, dos botones del mismo peso |
| `error_guiame` | 19 | error propio; acción «Probar de nuevo» |
| `no_soportada` | 20 | la página no se puede leer (mapa, PDF, captcha…); «Volver a la página anterior» |
| `pausa` | 15 | «Volver a donde estábamos» |

### Paso guiado
```jsonc
Paso {
  tipo: "clic" | "elegir" | "escribir",
  control: {
    etiqueta: "Sacar turno",          // texto visible del control, va entre « » en la instrucción
    selector: string,                 // cómo encontrarlo en el DOM del sitio
    posicion_rotulo: "arriba" | "abajo" | "derecha"   // R8: nunca sobre texto ni etiquetas
  },
  instruccion: "Hacé clic en «Sacar turno».",   // plantilla del guion + etiqueta
  apoyo: "Te lo marqué con un borde azul. Te espero.",
  cuenta_como_paso: true             // R5
}
```
- La instrucción sale de **plantillas fijas** del guion: «Hacé clic en «{control}».», «Escribí {qué} en «{control}».», «Elegí {qué} en «{control}».». No se genera texto libre para la instrucción. **[DECIDIR]** si el apoyo puede ser generado o también va de catálogo.
- Si el control está fuera de la vista, el cliente desplaza la página hasta él y el apoyo lo dice («Te lo marqué más abajo.», pantalla 18).

## 4. Eventos (cliente → backend)
| Evento | Disparo | Efecto |
|---|---|---|
| `intencion` | Buscador o voz en 01 / C01 | Devuelve `pregunta` o `recomendacion` |
| `respuesta` | Botón de respuesta | Siguiente pregunta, recomendación o paso |
| `no_se_bien` | «No sé bien» | 10 (recomendación) o la pregunta reformulada |
| `abrir_con_ayuda` | «Ir con ayuda» | Fija `sitio_elegido`, navega, tarjeta `espera` |
| `pagina_cargada` | Navegación terminada | Lector de página → nuevo estado |
| `accion_en_sitio` | Clic, cambio o envío en el control esperado | `pasos_hechos += 1`, tarjeta `espera` → verificación |
| `ya_lo_escribi` | Botón en `paso_escribir` | Verifica que el campo **no está vacío** (no lee el valor) |
| `volver_un_paso` | Pie de la tarjeta | Vuelve al paso anterior del historial |
| `navegacion_propia` | La persona fue a otra página que no era el paso | `ayuda = pausa` → 15 |
| `achicar` / `ver_ayuda` | Encabezado / tarjeta achicada | Solo cliente: `achicada` ↔ `abierta` |
| `salir_de_la_ayuda` | Pie | `ayuda = cerrada` → 21 |
| `ir_al_inicio` | Botón Inicio con datos escritos | Diálogo 22 antes de descartar |
| `reportar_fin` | «Sí, terminé» / «Todavía no» en 16 | 32 o 17 |

## 5. Reglas que el backend tiene que garantizar
1. **«Listo» solo con evidencia (R10).** `estado_exito` exige `evidencia.texto_literal` copiado tal cual de la página («Su turno fue reservado.», «Pedido N.º 10482»). Sin evidencia → `pudiste_terminar`.
2. **El contador (R5)** cuenta solo `accion_en_sitio` confirmadas. Responder preguntas de Guíame no suma. No hay línea de progreso con 0.
3. **Un paso por control (R5).** Nunca agrupar dos clics en una instrucción. Un cambio de página sin paso previo es un bug.
4. **Antes de pagar**, verificar que `dominio_actual == sitio_elegido.dominio`. Si no → C15 y no se muestra ningún paso de pago.
5. **Botones irreversibles** (comprar, confirmar reserva): siempre van precedidos del aviso de C10 («Este botón hace la compra») con la cita del total.
6. **Errores de la página** (13, C12): se citan literal y se dice «No pasa nada». Errores propios (19): se asumen («Fue un problema mío, no tuyo.»).

## 6. Privacidad (promesa de producto, requisito duro)
La tarjeta dice «Lo escribís vos. Yo no lo veo ni lo guardo.» y «Tu tarjeta va directo a la tienda». Para que sea verdad:
- El cliente **no envía** al backend el valor de ningún campo que la persona escribe (documento, fecha de nacimiento, contraseña, códigos, dirección, tarjeta). Solo envía `{campo: "Número de documento", completo: true}`.
- El lector de página **enmascara** los valores de inputs antes de mandar el DOM o la captura (incluidos `type=password`, `autocomplete=cc-*`, `one-time-code`).
- No se guardan capturas ni DOM con valores en logs ni en telemetría.
- **[DECIDIR]** dónde corre el lector de página (en el dispositivo o en el servidor) y la retención de datos de sesión.

## 7. Casos sin diseñar (no implementar sin diseño)
23 primera vez · 24 no se encuentra un sitio · 27 venció el ingreso · 28 algo tapa la página · 29 comprobante · 30 retomar otro día · 31 pedir ayuda a alguien · 33 micrófono · C13 verificación del banco · C14 cambio a la página de cobro · camino «No tengo usuario» · entrada a C15 desde la navegación. Mientras no existan, el comportamiento de respaldo es `error_guiame` (19) o `no_soportada` (20).
