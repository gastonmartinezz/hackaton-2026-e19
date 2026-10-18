# Guíame v2.4 · Paquete de implementación

Export del 18 de octubre de 2026. Incluye las 51 pantallas, la hoja de componentes, el logo final, la tipografía Poppins, las reglas de uso y una propuesta de contrato de estados para backend.

## Qué cambió desde v1.8
- Estética azul y blanco con gradientes, Poppins y bordes curvos.
- Logo final: en la barra va «Guíame» en blanco con avioncito, sin ojos y sin contenedor (desde v2.2). El micrófono es una píldora azul con el texto «Hablar». El ícono celeste va en la tarjeta y en el inicio.
- Barra en gradiente celeste → azul. Tarjeta flotante de 520px con encabezado claro, halo azul y sombra profunda.
- Resaltado azul de marca (antes amarillo y negro) y apoyo «Te lo marqué con un borde azul.».
- Velo suave y parejo sobre el sitio para que la capa Guíame sea protagonista (sin gradiente desde v2.3).
- v2.3: las pantallas completas ya no tienen gradiente azul de fondo; inicio, preguntas y recomendación van sobre blanco con puntos. Barra y tarjeta flotante sin cambios.
- La acción principal es azul; el verde queda para «Sitio oficial» y «Listo».

## Contenido
| Ruta | Qué es |
|---|---|
| `CLAUDE.md` | Instrucciones para Claude Code. Dejalo en la raíz del repo o referencialo desde el `CLAUDE.md` existente. |
| `docs/01-reglas-de-uso.md` | Reglas R1–R14, incluida la de uso del logo. No negociables. |
| `docs/02-sistema-visual.md` | Marca, tipografía y componentes con medidas. |
| `docs/03-pantallas-y-flujos.md` | Tabla de pantallas: tipo de tarjeta, texto principal, dominio, sello, estado de «Ayuda» y contador. Recorridos y diagrama. |
| `docs/04-contrato-backend.md` | Propuesta de modelo de sesión, estados de tarjeta, eventos, reglas y privacidad. Tiene puntos **[DECIDIR]**. |
| `docs/05-pendientes.md` | Lo que falta diseñar, decidir o validar. |
| `docs/historial/` | Guion v1.7 y addendum (textos exactos). Sus valores visuales quedaron reemplazados. |
| `tokens/tokens.json`, `tokens/tokens.css` | Tokens y clases base: barra, tarjeta, botones, resaltado, velo y fondo. |
| `assets/fonts/` | Poppins 300–700 (TTF). |
| `assets/logo/` | Las versiones del logo. Cuál usar en cada fondo: R12. |
| `pantallas/*.dc.html` + `canvas.json` | Fuente de las pantallas (formato del lienzo de Claude Design). |
| `preview/index.html` | Galería navegable; `preview/<pantalla>.html` abre cada una a 1440×900, sin internet. |

## Cómo usarlo con Claude Code
1. Copiá esta carpeta al repo, por ejemplo en `design/guiame-v2.3/`, y agregá al `CLAUDE.md` raíz:
   `Antes de tocar la capa de ayuda, leé design/guiame-v2.3/CLAUDE.md.`
2. Pedidos que funcionan bien:
   - «Leé `design/guiame-v2.3/docs/04-contrato-backend.md` y proponé el esquema de `GuideSession` y los endpoints. Listá los [DECIDIR] que bloquean.»
   - «Implementá el estado `paso_escribir` siguiendo `preview/A-08-dato.html` y las reglas R5, R8 y R10. Incluí tests de que el valor del campo nunca sale del cliente.»
   - «Implementá la barra (R6, R7) y el resaltado (R8) con `tokens/tokens.css`.»
   - «Generá fixtures para los recorridos A y B a partir de `docs/03-pantallas-y-flujos.md`.»
3. Para ver una pantalla, abrí `preview/index.html` en el navegador.

## Para exportar PNG o PDF
Desde el lienzo de pantallas en Claude: Share › Export › PNG o PDF.
