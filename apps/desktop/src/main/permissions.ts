/**
 * Permisos de la interfaz propia de Mostrame. Todo se rechaza salvo el
 * micrófono para el dictado del buscador: solo audio (nunca cámara ni
 * pantalla), solo desde el documento principal de la ventana de Mostrame y
 * solo con su propio origen. La vista del sitio tiene su propia sesión y
 * sigue rechazando todo (site-view.ts); la tarjeta flotante tampoco lo pide.
 */

export interface OwnUiPermissionRequest {
  permission: string;
  /** `details.mediaTypes` de Electron (solo para `media`). */
  mediaTypes?: readonly string[] | undefined;
  /** La solicitud viene del webContents de la ventana (no de la tarjeta ni del sitio). */
  fromWindow: boolean;
  isMainFrame: boolean;
  requestingUrl: string | undefined;
}

export interface OwnUiPermissionCheck {
  permission: string;
  /** `details.mediaType` de Electron. */
  mediaType?: string | undefined;
  fromWindow: boolean;
  isMainFrame: boolean;
  requestingUrl: string | undefined;
}

/** Solicitud de permiso: solo micrófono, solo para la interfaz propia. */
export function allowMicrophoneRequest(request: OwnUiPermissionRequest, rendererUrl: string | null): boolean {
  return (
    request.permission === 'media' &&
    request.mediaTypes?.length === 1 &&
    request.mediaTypes[0] === 'audio' &&
    request.fromWindow &&
    request.isMainFrame &&
    isOwnUiUrl(request.requestingUrl, rendererUrl)
  );
}

/** Consulta de permiso (la que hace Chromium antes de pedirlo): mismas reglas. */
export function allowMicrophoneCheck(check: OwnUiPermissionCheck, rendererUrl: string | null): boolean {
  return check.permission === 'media' && check.mediaType === 'audio' && check.fromWindow && check.isMainFrame && isOwnUiUrl(check.requestingUrl, rendererUrl);
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
