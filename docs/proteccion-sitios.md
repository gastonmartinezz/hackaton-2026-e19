# Protección de sitios: qué se valida hoy

Estado al 18/10/2026. Describe lo que hace el código en `main`, incluido lo que **no** está activo. El contrato del endpoint está en [`api.md`](api.md) y el servidor MCP en [`mcp.md`](mcp.md).

## Resumen

- El navegador revisa cada sitio que se abre y muestra el resultado junto al dominio, en la barra «Estás en…»: «Revisando sitio…», «Sitio oficial», «Sin alertas detectadas», «Atención», «Posible estafa» o «No pudimos verificarlo».
- Las verificaciones las hace el backend (`POST /v1/site-check`), con reglas propias, fuentes de Uruguay (zonas `gub.uy` y `mil.uy`, el registro del Banco Central del Uruguay y un catálogo verificado) y algunas fuentes externas.
- La IA (Claude) solo complementa el análisis: nunca decide «Sitio oficial» ni baja el riesgo.
- **Sin una clave de reputación configurada, ningún sitio puede quedar como «Sin alertas detectadas».** Los sitios que no son oficiales muestran «No pudimos verificarlo». Ver [Limitaciones](#limitaciones-conocidas).

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
| «Sitio oficial»: zonas reservadas al Estado | `zones` del catálogo de Uruguay y `government-zones.json` | ✅ `.gub.uy` (Estado uruguayo) y `.mil.uy` (Fuerzas Armadas), que solo se registran vía AGESIC según nic.uy. También `.gov` y `.mil` de EE. UU. |
| «Sitio oficial»: instituciones financieras | **Registro de instituciones del Banco Central del Uruguay (BCU)**, descargado automáticamente al arrancar y cada 24 h | ✅ 161 instituciones con sitio web: bancos, financieras, administradoras de crédito, cooperativas, casas de cambio, AFAP, aseguradoras y entidades del Sistema de Pagos (billeteras, cobranzas) |
| «Sitio oficial»: otras organizaciones de Uruguay | Catálogo `official-sites.uy.json` (revisado el 17/10/2026) | ✅ 153 entradas con fuente (BCU, `gub.uy` o MSP) y fecha: Antel, UTE, OSE, ANCAP, Correo, Claro, Tigo, Abitab, Redpagos, Mercado Libre, mutualistas, organismos fuera de `gub.uy`. También aporta dominios que el BCU no publica, como `brou.com.uy`. **Se actualiza a mano.** |
| Imitación de organismos del Estado uruguayo | Nombres de organismos (`claims` en `government-zones.json`) + marca declarada + IA | ✅ Una página que dice ser el BPS, la DGI, la DNIC, una intendencia, etc., en un dominio que no es suyo, se marca como imitación |
| Dominios parecidos a uno oficial | Reglas propias, comparando contra el BCU, el catálogo y las zonas | ✅ Caracteres que se ven iguales, una letra de diferencia, dominio oficial metido dentro de otro, marca + palabra como «login» o «seguro». Para instituciones que se llaman como palabras comunes (Correo, Verde, Pronto, Visa…) solo se aplican las dos primeras reglas, para no alarmar en sitios inocentes (`data/common-words.json`). |
| Antigüedad y registro del dominio | RDAP (registro público de dominios) | ⚠️ Funciona para `.com`, `.net`, `.org` y otros. **`.uy` no publica RDAP.** Es una señal de apoyo: su falta no cambia el resultado. |
| Certificado y redirecciones | Conexión directa al sitio | ✅ Revisa el certificado de cada salto de redirección (hasta 5) y bloquea el acceso a redes internas. Son motivos técnicos: nunca dan «Posible estafa» por sí solos. |
| Contenido de la página | Reglas propias | ✅ Pedidos de datos sensibles (tarjeta, cuenta bancaria, claves de BPS o DGI, códigos), formularios que envían a otro dominio o sin cifrar, enlaces cuyo texto no coincide con el destino, urgencia o amenazas |

### Cómo se decide el resultado

- **«Sitio oficial»** solo sale de las zonas del Estado, del registro del BCU o del catálogo de Uruguay, y siempre con su fuente y fecha («Ver por qué»). Nunca sale de la IA, del HTTPS ni de la apariencia.
- **Si un dominio está en el BCU y en el catálogo**, se muestra el nombre corto del catálogo («Banco República (BROU)») con el BCU como fuente.
- **Un dominio que el catálogo descartó** (no responde, redirige a otro o no se pudo verificar) no se aprueba aunque el BCU lo publique.
- **El riesgo tiene prioridad sobre lo oficial.** Un sitio `.gub.uy` comprometido igual muestra «Posible estafa».
- **Para «Sitio oficial» o «Sin alertas detectadas»** tienen que estar completas la reputación, la identidad y el contenido. Si alguna falta o falla, el resultado es «No pudimos verificarlo», nunca una aprobación (regla `siteIndicatorState()` del contrato).
- **El registro y la conexión no son obligatorios:** si faltan, no aprueban ni reprueban.

### Registro del BCU

- Se arma leyendo el portal del BCU: 12 listas de la Superintendencia de Servicios Financieros, con una ficha por institución, más el registro del Sistema de Pagos. No es una API documentada. Detalle técnico en [`api.md`](api.md#registro-de-instituciones-del-bcu).
- Se descarga al arrancar (unos 70 s y 50 MB) y se refresca cada 24 h. Si falla, reintenta con esperas crecientes, de 5 min hasta 6 h.
- **Si no se puede descargar:**
  - la copia anterior sirve 48 h;
  - hasta 7 días detecta imitaciones pero no aprueba;
  - después, o sin copia, las instituciones financieras que no están en el catálogo quedan «No pudimos verificarlo».
- El sitio del BCU no envía su cadena de certificados completa. Los dos certificados intermedios que faltan están guardados en el repositorio y se usan solo para ese sitio. Vencen en mayo y junio de 2027.

### El papel de la IA (Claude)

- Recibe lo que ya verificó el servicio, con la cobertura real, y el resumen de la página, marcado como contenido no confiable porque puede traer instrucciones dirigidas a ella.
- Identifica qué organización dice ser la página y si pide claves, pagos o códigos.
- Escribe una explicación que se muestra en «Ver por qué».
- **Puede** subir el riesgo a «Atención».
- **No puede** bajar el riesgo ni dar «Sitio oficial». Si su explicación dice que el sitio es oficial o seguro, se descarta.
- Tiene un tiempo máximo de 8 s. Si falla, el contenido queda como revisado parcialmente.

### Caché

Los resultados se guardan por fuente: reputación 10 min (30 min si hay amenaza), conexión 1 h, registro 24 h, contenido 10 min y registro del BCU 24 h. Si alguna fuente falla o la página todavía no cargó, el resultado vence al minuto. Los resultados con fallas no se guardan.

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
2. **Arranque sin BCU.** Durante los primeros ~70 s después de arrancar el servidor, las instituciones financieras que no están en el catálogo quedan «No pudimos verificarlo».
3. **El BCU es la fuente de los dominios financieros.** Si publica un dominio que vence y otro lo registra, sigue saliendo oficial hasta que el BCU actualice la ficha, salvo que el catálogo lo haya descartado. `.uy` no tiene RDAP para notarlo.
4. **Nombres en mayúsculas.** Si el BCU no publica un nombre de fantasía y la institución no está en el catálogo, el nombre puede aparecer en mayúsculas («CAMBIO FAGALDE»).
5. **El resto del catálogo se actualiza a mano** (Antel, UTE, mutualistas, organismos fuera de `gub.uy`).
6. **Palabras comunes: menos falsas alarmas, algunas imitaciones sin detectar.** Para no marcar sitios inocentes como `correo.miempresa.com.uy`, las instituciones que se llaman como palabras comunes solo se detectan si el dominio oficial completo aparece dentro de otro o si se imitan sus letras. Desde la dirección sola **ya no se detectan** `correo-uy.com` ni `visa-login.com`. Se detectan por el contenido si la página nombra a la organización completa («Correo Uruguayo») o con la IA. Algunas falsas alarmas siguen, por ejemplo `claro.blog.com`.
7. **Páginas muy largas:** si una página supera los 20.000 elementos, el resumen se corta y aun así figura como revisado por completo (issue #21).
8. **Lo que ve el servidor puede diferir de lo que ve la persona:** la revisión de conexión y certificado se hace desde el servidor, no con la sesión de la persona.
9. **Contenido que no se puede leer:** iframes de otros dominios, shadow DOM cerrado y canvas.
