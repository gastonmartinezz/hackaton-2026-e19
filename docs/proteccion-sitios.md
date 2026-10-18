# Protección de sitios: qué se valida hoy

Estado al 18/10/2026 (después del merge del #15). Describe lo que hace el código en `main`, incluido lo que **no** está activo. El contrato del endpoint está en [`api.md`](api.md) y el servidor MCP en [`mcp.md`](mcp.md).

## Resumen

- El navegador revisa cada sitio que se abre y muestra el resultado junto al dominio, en la barra «Estás en…»: «Revisando sitio…», «Sitio oficial», «Sin alertas detectadas», «Atención», «Posible estafa» o «No pudimos verificarlo».
- Las verificaciones las hace el backend (`POST /v1/site-check`) con reglas propias, archivos de datos verificados y algunas fuentes externas.
- La IA (Claude) solo complementa el análisis: nunca decide «Sitio oficial» ni baja el riesgo.
- **Sin una clave de reputación configurada, ningún sitio puede quedar como «Sin alertas detectadas».** Los sitios que no son oficiales muestran «No pudimos verificarlo». Ver [Reputación](#reputación-phishing-y-malware).

## Cuándo se ejecuta

| Momento | Qué se envía | Qué se revisa |
|---|---|---|
| Al empezar cada navegación | Solo la dirección, depurada (`contentVersion: 0`) | Reputación, sitio oficial, dominios parecidos, registro y conexión. Si ya hay riesgo, la advertencia aparece antes de que cargue la página. |
| 400 ms después de que carga la página | Resumen depurado de la página (`contentVersion ≥ 1`) | Todo lo anterior, más las reglas de contenido y la IA |
| Cambios en la página (otra ruta del mismo sitio, formularios nuevos o la marca declarada) | Nuevo resumen | Igual que el anterior. Espera 1,5 s, deja 5 s entre revisiones y hace como máximo 6 por navegación. |
| «Intentar de nuevo» | Nuevo resumen | Igual. No cuenta para el máximo. |

- **Direcciones locales o de redes privadas** (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, nombres internos, incluso escritos en octal o hexadecimal): **nunca se envían**.
- **Respuestas que no corresponden:** el navegador descarta las que llegan de otra navegación o de una versión vieja de la página, y limpia el estado al navegar.
- **Tiempos máximos:** si no hay respuesta en 15 s, o si queda «pendiente» más de 20 s, se muestra «No pudimos verificarlo».

### Qué sale del equipo

- **Sí:** la dirección sin datos personales (se ocultan los secretos del path, la query y el fragmento), el título, el texto visible (hasta 4.000 caracteres y ya depurado), los tipos de campo de los formularios, los enlaces (texto y destino) y los dominios de scripts e iframes.
- **Nunca:** cookies, valores de formularios, contraseñas, tokens ni historial.
- **El backend vuelve a depurar todo** antes de usarlo.

## Qué se valida y con qué fuente

| Validación | Fuente | Estado hoy |
|---|---|---|
| Sitio reportado como phishing o malware | Google Safe Browsing o Web Risk (API) | ❌ **No activa.** Falta configurar una clave. |
| «Sitio oficial»: zonas reservadas al Estado | Archivo `government-zones.json` + catálogo de Uruguay | ✅ `.gub.uy` y `.mil.uy` (solo se registran vía AGESIC), `.gob.ar`, `.gov.ar` y `.mil.ar` (Argentina), `.gov` y `.mil` (EE. UU.) |
| «Sitio oficial»: organizaciones de Uruguay | Archivo `official-sites.uy.json` (revisado el 17/10/2026) | ✅ 153 entradas: bancos y financieras del BCU (44), organismos fuera de `gub.uy` (31), salud (40), seguros (11), pagos (19), telecomunicaciones (3: Antel, Claro, Tigo), servicios (4: UTE, OSE, ANCAP, ADME) y Correo. Cada entrada tiene fuente (BCU, `gub.uy` o MSP) y fecha. **Se actualiza a mano.** |
| «Sitio oficial»: bancos de Argentina | Padrón del BCRA (API pública sin documentar, descarga cada 24 h) | ✅ Activo, pero solo cubre bancos argentinos |
| Dominios parecidos a uno oficial | Reglas propias, comparando contra el catálogo, las zonas y el padrón | ✅ Caracteres que se ven iguales, una letra de diferencia, dominio oficial metido dentro de otro, marca + palabra como «login» o «seguro» |
| Antigüedad y registro del dominio | RDAP (registro público de dominios) | ⚠️ Funciona para `.com`, `.net`, `.org` y otros. **`.uy` no publica RDAP**, y el de `.ar` suele no responder. Es una señal de apoyo: su falta no cambia el resultado. |
| Certificado y redirecciones | Conexión directa al sitio | ✅ Revisa cada salto de redirección (hasta 5) y bloquea el acceso a redes internas. Son motivos técnicos: nunca dan «Posible estafa» por sí solos. |
| Contenido de la página | Reglas propias | ✅ Pedidos de datos sensibles (clave, tarjeta, códigos), formularios que envían a otro dominio o sin cifrar, enlaces cuyo texto no coincide con el destino, urgencia o amenazas |
| Organización que dice ser la página | Marca declarada por la página + la IA | ⚠️ Ver la [limitación sobre organismos de Uruguay](#limitaciones-conocidas) |

### Cómo se decide el resultado

- **«Sitio oficial»** solo sale de las zonas del Estado, del catálogo de Uruguay o del padrón del BCRA, y siempre con su fuente y fecha («Ver por qué»). Nunca sale de la IA, del HTTPS ni de la apariencia.
- **El riesgo tiene prioridad sobre lo oficial.** Un sitio `.gub.uy` comprometido igual muestra «Posible estafa».
- **Para «Sitio oficial» o «Sin alertas detectadas»** tienen que estar completas la reputación, la identidad y el contenido. Si alguna falta o falla, el resultado es «No pudimos verificarlo», nunca una aprobación (regla `siteIndicatorState()` del contrato).
- **El registro y la conexión no son obligatorios:** si faltan, no aprueban ni reprueban.

### El papel de la IA (Claude)

- Recibe lo que ya verificó el servicio y el resumen de la página, marcado como contenido no confiable porque puede traer instrucciones dirigidas a ella.
- Identifica qué organización dice ser la página y si pide claves, pagos o códigos.
- Escribe una explicación que se muestra en «Ver por qué».
- **Puede** subir el riesgo a «Atención».
- **No puede** bajar el riesgo ni dar «Sitio oficial». Si su explicación dice que el sitio es oficial o seguro, se descarta.
- Tiene un tiempo máximo de 8 s. Si falla, el contenido queda como revisado parcialmente.

### Caché

Los resultados se guardan por fuente: reputación 10 min (30 min si hay amenaza), conexión 1 h, registro 24 h, contenido 10 min. Si alguna fuente falla o la página todavía no cargó, el resultado vence al minuto. Los resultados con fallas no se guardan.

## Servidor MCP

Existe un servidor MCP privado con 6 herramientas (`check_url_reputation`, `lookup_official_identity`, `get_domain_registration`, `inspect_connection`, `analyze_page_structure` y `compare_brand_identity`). Usan los mismos servicios que el endpoint. **Hoy no lo usa nadie:**

- está apagado salvo que se configure `MCP_ACCESS_TOKENS`;
- la IA del análisis no llama a herramientas: el servicio hace todas las verificaciones y le pasa los resultados.

Detalle en [`mcp.md`](mcp.md).

## Limitaciones conocidas

1. **Sin reputación activa.** Sin clave de Google Safe Browsing o Web Risk no se consulta ninguna lista de phishing, y ningún sitio no oficial puede quedar como «Sin alertas detectadas».
   - **Safe Browsing:** gratis y sin tarjeta, pero solo para uso no comercial.
   - **Web Risk:** comercial, gratis hasta 100.000 consultas por mes, y exige activar la facturación.
   - Se configuran con `REPUTATION_PROVIDER` y la clave correspondiente.
2. **No se detectan las imitaciones de organismos uruguayos dentro de `gub.uy`.** Una página en un dominio comercial que dice ser el **BPS** o la **DGI** y pide la clave **no se marca** («sin señales»).
   - **Por qué:** la lista de nombres de organismos de gobierno para detectar imitaciones (`claims` en `government-zones.json`) solo tiene organismos argentinos.
   - **Lo que sí se detecta:**
     - imitaciones de entidades del catálogo, como Antel o el BROU;
     - dominios parecidos, como `bps-gub-uy.com`;
     - el pedido de clave, que sigue figurando como dato sensible.
3. **Componentes de Argentina activos sin uso para Uruguay:** el padrón del BCRA (que se descarga al arrancar y cada 24 h), las zonas `.gob.ar` y los organismos argentinos.
4. **El catálogo de Uruguay se actualiza a mano.** El BCU publica un registro de instituciones que permitiría automatizar la parte financiera.
5. **Páginas muy largas:** si una página supera los 20.000 elementos, el resumen se corta y aun así figura como revisado por completo (issue #21).
6. **Marcas cortas o palabras comunes en subdominios:** `bna.sitio-falso.com` no se detecta por la regla de subdominio. A la vez, marcas del catálogo que son palabras comunes (Verde, Pronto, Universal) podrían dar una falsa alarma como subdominio de otro sitio (issue #21).
7. **Lo que ve el servidor puede diferir de lo que ve la persona:** la revisión de conexión y certificado se hace desde el servidor, no con la sesión de la persona.
8. **Contenido que no se puede leer:** iframes de otros dominios, shadow DOM cerrado y canvas.
