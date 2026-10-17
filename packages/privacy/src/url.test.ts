import { describe, expect, it } from 'vitest';
import { findLeaks, sanitizeLinkText, sanitizeUrl } from './index';

describe('sanitizeUrl', () => {
  it('solo acepta http(s) y descarta usuario y contraseña', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeUrl('no es una url')).toBeNull();
    expect(sanitizeUrl('https://ana:secreto@banco.com/')).toBe('https://banco.com/');
  });

  it('conserva direcciones comunes', () => {
    expect(sanitizeUrl('https://es.wikipedia.org/wiki/Buenos_Aires')).toBe('https://es.wikipedia.org/wiki/Buenos_Aires');
    expect(sanitizeUrl('https://www.argentina.gob.ar/como-sacar-turno-en-la-biblioteca#horarios')).toBe(
      'https://www.argentina.gob.ar/como-sacar-turno-en-la-biblioteca#horarios',
    );
  });

  it('oculta secretos en el path', () => {
    const secrets = ['ana.perez@correo.com', '30123456', 'eyJhbGciOiJIUzI1NiJ9', 'a1b2c3d4e5', 'Zm9vYmFyYmF6cXV4cXV1eHF1dXg'];
    const out = sanitizeUrl(`https://x.com/reset/${secrets.join('/')}/fin`)!;
    expect(findLeaks(out, secrets)).toEqual([]);
    expect(out).toMatch(/^https:\/\/x\.com\/reset\/(\[dato\]\/){5}fin$/);
  });

  it('oculta los valores de la query y conserva solo el origen de un destino anidado', () => {
    const out = sanitizeUrl('https://x.com/login?user=ana&token=abc123&lang=es&next=https://evil.com/a?b=c&flag')!;
    expect(findLeaks(out, ['ana', 'abc123', '/a?b=c'])).toEqual([]);
    expect(out).toContain('user=[dato]');
    expect(out).toContain('token=[dato]');
    expect(out).toContain(`next=${encodeURIComponent('https://evil.com')}`);
    expect(out).toContain('&flag');
  });

  it('oculta claves de query que parecen secretos', () => {
    expect(sanitizeUrl('https://x.com/?a1b2c3d4e5f6=1')).toBe('https://x.com/?[dato]=[dato]');
  });

  it('oculta secretos en el fragmento', () => {
    expect(sanitizeUrl('https://x.com/cb#access_token=abc&expires_in=3600')).toBe('https://x.com/cb#[dato]');
    expect(sanitizeUrl('https://x.com/#ana@correo.com')).toBe('https://x.com/#[dato]');
    expect(sanitizeUrl('https://x.com/app#/cuenta/12345678?pin=1234')).toBe('https://x.com/app#/cuenta/[dato]?pin=[dato]');
  });

  it('resuelve direcciones relativas contra una base', () => {
    expect(sanitizeUrl('/ingresar?dni=30123456', 'https://banco.com/inicio')).toBe('https://banco.com/ingresar?dni=[dato]');
  });

  it('limita el largo', () => {
    const out = sanitizeUrl(`https://x.com/a?${'k=v&'.repeat(1000)}`)!;
    expect(out.length).toBeLessThanOrEqual(2048);
  });
});

describe('sanitizeLinkText', () => {
  it('un texto que es una dirección queda solo como hostname', () => {
    expect(sanitizeLinkText('www.banco.com.ar/ingresar?dni=30123456')).toBe('www.banco.com.ar');
    expect(sanitizeLinkText('https://Banco.com/x')).toBe('banco.com');
  });

  it('cualquier otro texto se depura como etiqueta', () => {
    expect(sanitizeLinkText('Ingresar a tu cuenta')).toBe('Ingresar a tu cuenta');
    expect(sanitizeLinkText('Escribí a ana@correo.com')).not.toContain('ana@');
  });
});
