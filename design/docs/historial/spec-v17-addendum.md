> **Historial.** Texto del guion v1.7 con el nombre actualizado a Guíame. Los valores visuales (colores, tipografías, radios, logos, resaltado amarillo) quedaron **reemplazados** por `../02-sistema-visual.md` y `../../tokens/`. Los números de progreso válidos son los de las pantallas.

# Addendum v1.7.1 · Correcciones tras validar el journey (manda sobre spec-v17.md)

## Reglas nuevas de continuidad
- **Ningún salto mágico.** Si la página del sitio cambia entre dos pantallas, tiene que haber una instrucción de Guíame que explique el clic que lo causó. Cada campo y cada botón del sitio que la persona usa tiene su propio paso guiado. Cuando un formulario tiene varios campos iguales, se muestra el primero como patrón (y se anota) pero los botones que cambian de página SIEMPRE tienen su paso.
- **Fechas reales.** Hoy es sábado 17 de octubre de 2026. El turno es **miércoles 4 de noviembre de 2026, 10:30, Oficina Centro**. Nunca «martes».
- **Progreso.** Cuenta solo acciones hechas en el sitio. Sin línea de progreso hasta que haya al menos 1 paso hecho.
- **Títulos.** Tarjeta de pregunta bajo el buscador: Fraunces 34px, line-height 1.2. Títulos dentro de la tarjeta flotante y bloques de estado: Fraunces 31px, line-height 1.15.

## Recorrido A · camino principal corregido (en orden)
01 Inicio (sin pie, sin «Solo abrir el sitio») → 02 → 03 («Sí, en Uruguay» / «No, en otro país» / «No sé bien») → 04 → 05 (apoyo «Para renovar, primero se saca un turno.») → 06 «Sacar turno» (sin progreso) → 07 Verificando (página «Reservar turno»: selector «Oficina» + lista «Turnos disponibles» con 3 opciones de radio: «Miércoles 4 de noviembre · 10:30», «Miércoles 4 de noviembre · 11:00», «Jueves 5 de noviembre · 9:00» + botón del sitio «Continuar»; progreso 1)
→ **07B** «Elegí una oficina en «Oficina».» apoyo «La que te quede más cerca.» (anillo etiqueta+selector; progreso 1)
→ **07C** «Elegí un horario en «Turnos disponibles».» apoyo «El que te quede cómodo.» (oficina ya muestra «Oficina Centro»; anillo rodea etiqueta+lista; progreso 2)
→ **07D** «Hacé clic en «Continuar».» (oficina y turno ya elegidos; progreso 3)
→ [13 si la página marca error de oficina] → 14 «¿El turno es para vos?» (página: dos botones grandes del sitio «Para mí» / «Para otra persona»; progreso 3)
→ **14B** «Hacé clic en «Para mí».» (anillo en ese botón; progreso 3)
→ 08 «Escribí tu número en «Número de documento».» apoyo «Solo números, sin puntos ni guión.» + privacidad + «Ya lo escribí» (progreso 4)
→ **08B** «Escribí tu fecha en «Fecha de nacimiento».» apoyo «Así: 05/03/1959.» + «Ya lo escribí» (documento ya escrito, mostrado como «•••••••8» en el campo; progreso 5)
→ **08C** «Hacé clic en «Continuar».» (progreso 6)
→ **08D** página «Revise su reserva» (resumen: Oficina Centro · Miércoles 4 de noviembre · 10:30) con botón del sitio «Confirmar reserva»; instrucción «Hacé clic en «Confirmar reserva».» apoyo «Con esto termina.» (progreso 7)
→ 09 Listo (cita «Su turno fue reservado.»; «Lo hiciste vos.»; principal «Ver qué tengo que llevar»; enlace «Buscar otra cosa»).

## Recorrido A · desvíos corregidos
- 10: motivo «Es el sitio oficial para renovar la cédula en Uruguay.»; principal «Ir con ayuda»; un solo enlace «Solo abrir el sitio». Sin «Ver otros sitios».
- 11: sin campo ni «Buscar»: solo «Volver a las 3 opciones» + título + 3 opciones.
- 12: barra achicada de 80px, texto en hasta 2 líneas (line-height 1.15); botón «Ver la ayuda».
- 13: sin cita; bloque aviso con título «La página marcó un error» + línea «No pasa nada.»; instrucción «Elegí una oficina en «Oficina».» La página muestra el turno ya elegido y el error en oficina.
- 16, 17, N-32: la página es «Revise su reserva» con el botón «Confirmar reserva» FUERA de la vista (la página está scrolleada arriba: se ve el título y el resumen, el botón queda abajo, fuera del viewport). Miga «Inicio › Agenda › Revise su reserva».
- 17: agregar cuarta opción «No sé bien» (dashed).
- 18: misma página scrolleada hasta «Confirmar reserva» (así se explica: «Te lo marqué más abajo.»); instrucción «Hacé clic en «Confirmar reserva».» apoyo «Faltaba confirmar. Te lo marqué más abajo.» progreso 7.
- 20: sin «Seguir sin ayuda».
- 22: apoyo «Si vas al inicio, se borra lo que escribiste acá.»; en el fondo copiado de 08, el botón «Ya lo escribí» de la tarjeta va en estilo secundario.
- N-25: instrucción «Escribí tu cédula en «Usuario o cédula».»; sin línea de apoyo; sin enlace «Olvidé mi contraseña» en la tarjeta. Entra cuando la página pide ingresar (antes de 07).
- N-26: apoyo «Te llegó por mensaje. No se lo des a nadie.»
- N-32: apoyo «Si no te llega nada, volvé y hacé clic en «Consultar mi turno».»; secundario «Buscar otra cosa».

## Recorrido B · continuidad
C05 → C06 «Agregar al carrito» → C07 «Finalizar compra» → C08 dirección («Calle y número»; los demás campos siguen el mismo patrón) → **C08B** «Hacé clic en «Continuar al pago».» → C09 tarjeta («Número de tarjeta»; los demás campos siguen el patrón) → **C09B** «Hacé clic en «Revisar pedido».» → C10 «Confirmar compra» → C11. Progreso: C06 sin progreso, C07 1, C08 2, C08B 3, C09 4, C09B 5, C10 6. Pedido llega «el jueves 22 de octubre» (jueves real).
