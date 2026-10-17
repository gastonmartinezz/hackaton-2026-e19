# @asistente/contracts — PROPUESTA pendiente de acuerdo

Este paquete es compartido entre Agustin y Gaston (sección 0, "Contratos compartidos y coordinación"). La versión actual la redactó Gaston y **no está acordada todavía**. Mientras Agustin no la apruebe, los dos lados la tratan como borrador. Cualquier cambio incompatible se documenta antes con un ejemplo de entrada y salida.

## Tomado de la sección 6 de la especificación

- `PageSnapshot`, `PageOption` y `GuideDecision`, con los mismos campos.
- Lo único agregado son los límites de tamaño y el formato de los IDs (`[A-Za-z0-9_-]`, hasta 64 caracteres), porque la spec pide "esquemas runtime equivalentes, versionados y con límites de tamaño".

## Propuesta nueva (para revisar con Agustin)

| Tema | Propuesta |
|---|---|
| `POST /v1/intents/interpret` | `{ intent, clarifications[] }` → `goal` o `needsClarification` |
| `POST /v1/destinations/search` | `{ goal, location? }` → `candidates[]` + `recommendedId` |
| `POST /v1/pages/options` | `{ goal?, snapshot }` → `options` (máximo 3 primarias + 5 secundarias) o `needsClarification`/`unsupported` |
| `POST /v1/guidance/next` | `{ goal, option?, snapshot, previousStep?, stepCount }` → `GuideDecision` |
| `previousStep.outcome` | Resultado local del paso anterior, sin valores: `signalObserved`, `validationError`, `targetStale`, etc. |
| Errores | `{ error: { code, message, retryable }, requestId? }` |
| Sesión | Cabecera `x-session-id`. El cliente genera un UUID y lo borra con `DELETE /v1/sessions/:id` |
| Autenticación | Por definir por Agustin. El cliente envía `Authorization: Bearer` solo si se configura `ASISTENTE_API_TOKEN` |
| `verifiedOfficial` | Indica que el servidor contrastó el dominio contra el registro curado. El cliente muestra la incertidumbre cuando es `false` |
