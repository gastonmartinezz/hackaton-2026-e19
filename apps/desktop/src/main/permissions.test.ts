import { describe, expect, it } from 'vitest';
import { allowMicrophoneCheck, allowMicrophoneRequest, isOwnUiUrl } from './permissions';

const DEV = 'http://localhost:5173/';
const own = { permission: 'media', mediaTypes: ['audio'], fromOwnUi: true, isMainFrame: true, requestingUrl: 'http://localhost:5173/' };

describe('permisos de la interfaz propia', () => {
  it('permite el micrófono solo (audio) desde la ventana de Guíame', () => {
    expect(allowMicrophoneRequest(own, DEV)).toBe(true);
    expect(allowMicrophoneRequest({ ...own, requestingUrl: 'file:///app/out/renderer/index.html' }, null)).toBe(true);
  });

  it('rechaza video o audio + video', () => {
    expect(allowMicrophoneRequest({ ...own, mediaTypes: ['video'] }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, mediaTypes: ['audio', 'video'] }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, mediaTypes: [] }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, mediaTypes: undefined }, DEV)).toBe(false);
  });

  it('rechaza cualquier otro permiso', () => {
    for (const permission of ['geolocation', 'notifications', 'display-capture', 'clipboard-read', 'midi']) {
      expect(allowMicrophoneRequest({ ...own, permission }, DEV)).toBe(false);
    }
  });

  it('rechaza la vista del sitio, subframes y otros orígenes (la tarjeta, interfaz propia, sí puede)', () => {
    expect(allowMicrophoneRequest({ ...own, fromOwnUi: true, requestingUrl: 'http://localhost:5173/card.html' }, DEV)).toBe(true);
    // La vista del sitio no es interfaz propia (tiene su propia sesión, que rechaza todo).
    expect(allowMicrophoneRequest({ ...own, fromOwnUi: false, requestingUrl: 'https://sitio.example/' }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, fromOwnUi: false }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, isMainFrame: false }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, requestingUrl: 'https://sitio.example/' }, DEV)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, requestingUrl: 'https://sitio.example/' }, null)).toBe(false);
    expect(allowMicrophoneRequest({ ...own, requestingUrl: 'file:///x.html' }, DEV)).toBe(false);
  });

  it('la consulta de permiso sigue las mismas reglas', () => {
    const check = { permission: 'media', mediaType: 'audio', fromOwnUi: true, isMainFrame: true, requestingUrl: DEV };
    expect(allowMicrophoneCheck(check, DEV)).toBe(true);
    expect(allowMicrophoneCheck({ ...check, mediaType: 'video' }, DEV)).toBe(false);
    expect(allowMicrophoneCheck({ ...check, mediaType: 'unknown' }, DEV)).toBe(false);
    expect(allowMicrophoneCheck({ ...check, fromOwnUi: false }, DEV)).toBe(false);
    expect(allowMicrophoneCheck({ ...check, permission: 'notifications' }, DEV)).toBe(false);
  });

  it('isOwnUiUrl', () => {
    expect(isOwnUiUrl(undefined, DEV)).toBe(false);
    expect(isOwnUiUrl('no es una url', DEV)).toBe(false);
    expect(isOwnUiUrl('http://localhost:5174/', DEV)).toBe(false);
  });
});
