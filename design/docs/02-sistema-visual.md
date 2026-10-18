# 02 · Sistema visual y componentes (v2.2)

Valores exactos en `tokens/tokens.json` y `tokens/tokens.css`. Referencia visual: `preview/Componentes.html` y `preview/A-06-guia.html`. **Si este documento y una pantalla no coinciden, manda la pantalla.**

## Dirección
Azul y blanco con gradientes, moderno y minimalista, bordes curvos. La capa de Guíame (barra celeste-azul, tarjeta con halo, resaltado azul) es la protagonista sobre el sitio, que queda levemente atenuado.

## Marca
- Nombre: **Guíame**.
- Logos en `assets/logo/` (PNG transparentes):
  - `guiame-blanco.png`: «Guíame» blanco con avioncito, sin ojos. **Logo de la barra** (v2.2).
  - `guiame-blanco-ojos.png`: la misma versión con ojos. Ya no va en la barra; se conserva como recurso.
  - `guiame-icono.png`: ícono cuadrado celeste con avioncito y ojos. Solo sobre fondos claros.
  - `guiame-pill-ojos.png` / `guiame-pill.png`: wordmark dentro de píldora celeste. Solo sobre fondos claros.
  - `guiame-wordmark-azul.png` / `guiame-wordmark-blanco.png`: wordmark solo, para fondo claro u oscuro.
- Ícono de «Ayuda» y del botón «Guíame»: flecha de navegación (el avioncito del logo) en trazo, Lucide `navigation` equivalente.

## Tipografía: Poppins
| Uso | Tamaño / interlineado / peso |
|---|---|
| Título de inicio | 48 / 1.15 / 600 |
| Título de tarjeta de pregunta | 34 / 1.2 / 600, tracking −0.025em |
| Título en tarjeta flotante y bloques de estado | 31 / 1.15 / 600, tracking −0.025em |
| Instrucción | 32 / 1.3 / 600 |
| Objetivo en el encabezado de la tarjeta | 22 / 600 |
| Apoyo | 22 / 1.45 / 400, `#47557A` |
| Respuestas | 24 / 600 |
| Botón principal / secundario | 22 / 21, 600 |
| Progreso | 20, `#47557A`, tilde azul |

Los sitios de ejemplo usan Arial a propósito: representan un sitio ajeno.

## Componentes
### Barra del navegador
76px, gradiente `#3A9BFF → #2B86FF → #1F74F0`, sombra azul, `z-index: 3`. Controles de 54px.
- Logo blanco sin ojos (`guiame-blanco.png`), 38px de alto, sin contenedor.
- Inicio y Atrás: íconos blancos.
- Píldora de dominio: blanca, radio 999, texto navy, dominio en negrita; sello a la derecha.
- Sellos (píldora, 19px/600): Oficial `#E0F2E7`/`#13693D` · Tienda elegida `#F2F5FF` con borde `#7A8CC9` · No verificado `#FFF0CC`/`#7A4D00`.
- «Ayuda»: tres estados (R7). «Tamaño de letra»: texto blanco con «AA».

### Tarjeta flotante
`.g-card` en `tokens.css`. 520px, blanca, radio 28, halo azul de 10px y sombra profunda.
- Encabezado claro: padding 16/16/16/24, gradiente `#EAF3FF → #FFFFFF`, borde inferior `#DCE4FA`; ícono 38px + objetivo 22/600 navy + «Achicar» con ícono azul.
- Cuerpo: padding 28, gap 16. Instrucción + apoyo + uno opcional de: caja de espera o privacidad (`#F2F5FF`, radio 24), bloque de estado, cita, acción principal. Al final, progreso.
- Pie: fondo `#F2F5FF`, botones secundarios a lo ancho de 58px, gap 12.

### Tarjeta achicada (12)
520×80, mismo halo; franja izquierda clara de 76px con el ícono, instrucción en 2 líneas y botón «Ver la ayuda».

### Tarjeta de pregunta (02, 03, C02, C03) y recomendación (10, C04)
880px centrada bajo el buscador, blanca, borde `#DCE4FA`, radio 28, halo suave. Píldoras de respuestas dadas en `#E6EDFF`. Respuestas de 72px, borde 2px `#7A8CC9`, radio 18, ícono azul. «No sé bien» con borde punteado.

### Pantallas propias
`.g-ground`: gradiente blanco → celeste → azul vivo abajo, con cuadrícula de puntos al 10% cada 32px. Inicio: ícono 78px + título 48px + buscador con borde azul + botón principal «Guíame».

### Bloques de estado
Ícono 40px + título 31px + párrafo navy. Éxito `#E0F2E7`/`#13693D` · Aviso `#FFF0CC`/`#7A4D00` · Error de Guíame: blanco, borde 2px `#B42318`, título navy · ¿Pudiste terminar?: blanco, borde punteado `#7A8CC9`.

### Cita «La página dice»
Blanca, borde 2px `#DCE4FA`, radio 18. Rótulo 20px secundario; cita 22px entre « ».

### Botones
| Tipo | Medidas |
|---|---|
| Principal | 64px, gradiente azul, texto blanco 22/600, radio 18, sombra azul |
| Secundario | 58px, blanco, borde 2px `#7A8CC9`, 21/600, con ícono |
| Respuesta | 72px, borde 2px `#7A8CC9`, 24/600, ícono 28px azul |
| Opción en tarjeta | 64px, insignia numerada `#E6EDFF` con número azul, chevron |
| «No sé bien» | Como respuesta, borde punteado |
| Enlace discreto | 21px, `#1D4ED8`, subrayado |

### Resaltado
`.g-highlight` + `.g-highlight__label` en `tokens.css`. Anillo blanco + borde `#1F8BFF` + halo; rótulo «Acá» en gradiente azul con texto blanco. Ver R8.

### Velo del sitio
`.g-site-veil`: primer hijo del contenedor del sitio, `z-index: 1`, gradiente de navy al 8% (izquierda) a azul al 30% (derecha, hacia la tarjeta).

### Diálogo (22)
Scrim `rgba(11,27,63,0.45)` (`z-index: 6`) y diálogo de 640px (`z-index: 7`) con radio 28 y halo azul. Principal «Quedarme acá», secundario «Sí, ir al inicio».

## Iconografía
Lucide en línea, stroke 2, extremos redondeados, `aria-hidden="true"`. Sin emojis.

## Botón de voz «Hablar» (v2.2)

Va dentro del buscador y de los campos de respuesta (A-01, A-02, A-03, A-10, B-C01 a B-C04, Main). Se destaca como acción secundaria fuerte, porque hablar es la forma más cómoda de pedir algo para muchas personas.

- Píldora del mismo alto que el campo (56px en el inicio, 52px en el resto), padding `0 22px 0 18px`.
- Fondo `linear-gradient(135deg, #3B74FF 0%, #1D4ED8 55%, #1638B8 100%)`, texto e ícono blancos.
- Halo `0 0 0 4px #DCE6FF` y sombra `0 10px 22px -10px rgba(22,56,184,0.75)`.
- Ícono de micrófono blanco (trazo 2.25) y **texto visible «Hablar»** (20px en el inicio, 19px en el resto, peso 600).
- Nombre accesible: «Hablar: decirlo en voz alta» (incluye el texto visible, WCAG 2.5.3).
- No reemplaza al botón principal «Guíame»: sigue habiendo una sola acción principal por vista, debajo del campo.
