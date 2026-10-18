/**
 * Permisos de la interfaz propia de Guíame. Todo se rechaza salvo el
 * micrófono: el dictado del buscador (ventana) y responder con la voz qué
 * opción se quiere (ventana o tarjeta flotante). Solo audio (nunca cámara ni
 * pantalla), solo desde el documento principal de la interfaz propia y solo
 * con su propio origen. La vista del sitio tiene su propia sesión y sigue
 * rechazando todo (site-view.ts).
 */

export interface OwnUiPermissionRequest {
  permission: string;
  /** `details.mediaTypes` de Electron (solo para `media`). */
  mediaTypes?: readonly string[] | undefined;
  /** La solicitud viene de la interfaz propia: la ventana o la tarjeta (nunca la vista del sitio). */
  fromOwnUi: boolean;
  isMainFrame: boolean;
  requestingUrl: string | undefined;
}

export interface OwnUiPermissionCheck {
  permission: string;
  /** `details.mediaType` de Electron. */
  mediaType?: string | undefined;
  fromOwnUi: boolean;
  isMainFrame: boolean;
  requestingUrl: string | undefined;
}

/** Solicitud de permiso: solo micrófono, solo para la interfaz propia. */
export function allowMicrophoneRequest(request: OwnUiPermissionRequest, rendererUrl: string | null): boolean {
  return (
    request.permission === 'media' &&
    request.mediaTypes?.length === 1 &&
    request.mediaTypes[0] === 'audio' &&
    request.fromOwnUi &&
    request.isMainFrame &&
    isOwnUiUrl(request.requestingUrl, rendererUrl)
  );
}

/** Consulta de permiso (la que hace Chromium antes de pedirlo): mismas reglas. */
export function allowMicrophoneCheck(check: OwnUiPermissionCheck, rendererUrl: string | null): boolean {
  return check.permission === 'media' && check.mediaType === 'audio' && check.fromOwnUi && check.isMainFrame && isOwnUiUrl(check.requestingUrl, rendererUrl);
}

/**
 * La interfaz propia se carga desde el servidor de desarrollo de electron-vite
 * (`rendererUrl`) o desde los archivos empaquetados (`file:`).
 */
export function isOwnUiUrl(url: string | undefined, rendererUrl: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return rendererUrl ? parsed.origin === new URL(rendererUrl).origin : parsed.protocol === 'file:';
  } catch {
    return false;
  }
}
