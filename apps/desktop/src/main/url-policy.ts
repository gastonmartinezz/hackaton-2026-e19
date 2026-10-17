/**
 * Esquemas de navegación permitidos (S03, sección 8). Inicialmente HTTPS; HTTP
 * se permite con aviso visible. javascript:, file:, data: y protocolos externos
 * se bloquean.
 */
export type NavigationVerdict =
  | { kind: 'allow'; url: URL; secure: boolean }
  | { kind: 'external'; scheme: string }
  | { kind: 'block' };

const EXTERNAL_SCHEMES = new Set(['mailto:', 'tel:', 'sms:', 'whatsapp:', 'maps:', 'geo:']);

export function classifyUrl(raw: string): NavigationVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'block' };
  }
  if (url.protocol === 'https:') return { kind: 'allow', url, secure: true };
  if (url.protocol === 'http:') return { kind: 'allow', url, secure: false };
  if (EXTERNAL_SCHEMES.has(url.protocol)) return { kind: 'external', scheme: url.protocol.slice(0, -1) };
  return { kind: 'block' };
}

/** Interpreta lo escrito en la barra de dirección. Devuelve null si no parece una dirección. */
export function parseAddressInput(input: string): string | null {
  const text = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  if (/^[^\s/]+\.[^\s/]{2,}(?:[/?#]\S*)?$/.test(text)) return `https://${text}`;
  return null;
}

export function isLoopback(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
