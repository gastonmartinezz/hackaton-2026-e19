# Cómo usar este export en Claude Code (Guíame v2.2)

1. Copiá a la **raíz del repositorio**:
   - `design/`
   - `.claude/skills/guiame-ui/` (es una carpeta oculta: si no la ves, mostrá los archivos ocultos)
   - `CLAUDE.md`. Si el repositorio ya tiene uno, pegá este contenido como una sección más al final.
2. Abrí Claude Code en el repositorio. Va a leer `CLAUDE.md` automáticamente, y el skill `guiame-ui` se activa al pedir trabajo de UI. También lo podés invocar escribiendo `/guiame-ui`.
3. Para ver las pantallas, abrí `design/preview/index.html` en el navegador (funciona sin internet). Los PNG de `design/png/` son las mismas pantallas a 1440×900, para comparar capturas.

## Qué hay adentro

| Ruta | Qué es |
|---|---|
| `CLAUDE.md` | Reglas para Claude Code: producto, privacidad, marca, voz, accesibilidad y definición de terminado. |
| `.claude/skills/guiame-ui/SKILL.md` | Cómo trabajar una pantalla, componentes y tabla de las 51 pantallas. |
| `design/docs/01-reglas-de-uso.md` | Reglas R1–R14 (no negociables). |
| `design/docs/02-sistema-visual.md` | Marca, tipografía, componentes con medidas y botón «Hablar». |
| `design/docs/03-pantallas-y-flujos.md` | Tabla de pantallas con textos, sellos y contadores; recorridos. |
| `design/docs/04-contrato-backend.md` | Propuesta de estados, eventos y privacidad, con puntos [DECIDIR]. |
| `design/docs/05-pendientes.md` | Lo que falta diseñar o decidir. |
| `design/docs/historial/` | Guion v1.7 y cambios de v2.2. |
| `design/tokens/` | `tokens.css` (variables y clases `.g-*`) y `tokens.json`. |
| `design/assets/` | Poppins y logos (en la barra: `guiame-blanco.png`, sin ojos). |
| `design/png/` | 53 capturas de referencia a 1440×900. |
| `design/preview/` | Pantallas en HTML estático y galería `index.html`. |
| `design/pantallas/` | Fuente de las pantallas (lienzo de Claude Design) + `canvas.json`. |

## Primeros pedidos sugeridos

> Trabajo para Gastón. Usando el skill guiame-ui, implementá la barra del navegador (R6, R7) y el buscador de inicio A-01 con el botón «Hablar», usando design/tokens/tokens.css, y compará con design/png/A-01-inicio.png.

> Trabajo para Gastón. Implementá el resaltado (R8) como overlay con pointer-events none, y el estado paso_escribir siguiendo design/png/A-08-dato.png. Incluí tests de que el valor del campo nunca sale del cliente.

> Trabajo para Agustín. Leé design/docs/04-contrato-backend.md y proponé el esquema de GuideSession y los endpoints. Listá los [DECIDIR] que bloquean.
