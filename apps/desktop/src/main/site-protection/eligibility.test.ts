import { describe, expect, it } from 'vitest';
import { checkEligibility, isLocalHostname, registrableDomain } from './eligibility';

describe('checkEligibility', () => {
  it('no envía direcciones locales, privadas, internas ni de prueba', () => {
    for (const url of [
      'http://127.0.0.1:4321/a.html',
      'http://127.8.8.8/',
      'http://localhost:3000/',
      'http://api.localhost/',
      'http://10.0.0.1/',
      'http://172.20.1.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://intranet/',
      'http://impresora.local/',
      'http://nas.home.arpa/',
      'http://app.test/',
    ]) {
      expect(checkEligibility(url).kind, url).toBe('local');
    }
  });

  it('no hay sitio que revisar en páginas internas', () => {
    for (const url of ['about:blank', 'chrome://settings', 'file:///tmp/a.html', 'data:text/html,hola', 'no-url']) {
      expect(checkEligibility(url).kind).toBe('none');
    }
  });

  it('las direcciones públicas se envían depuradas', () => {
    expect(checkEligibility('https://Usuario:clave@WWW.Banco.com.ar./cuenta/30123456?token=abc#x')).toEqual({
      kind: 'eligible',
      url: 'https://www.banco.com.ar/cuenta/[dato]?token=[dato]#x',
      hostname: 'www.banco.com.ar',
      registrableDomain: 'banco.com.ar',
    });
    expect(checkEligibility('http://203.0.113.5/login')).toMatchObject({ kind: 'eligible', hostname: '203.0.113.5', registrableDomain: '203.0.113.5' });
    // Los nombres de demostración del simulador (.example) son públicos para la regla.
    expect(checkEligibility('http://banco-demo.example:47321/banco.html').kind).toBe('eligible');
  });

  it('IPv6 pública: el contrato no la representa, no se envía', () => {
    expect(checkEligibility('http://[2001:db8::1]/').kind).toBe('unsupported');
  });
});

describe('registrableDomain', () => {
  it('aproxima eTLD+1', () => {
    expect(registrableDomain('www.argentina.gob.ar')).toBe('argentina.gob.ar');
    expect(registrableDomain('login.banco.com')).toBe('banco.com');
    expect(registrableDomain('a.b.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('banco.com')).toBe('banco.com');
  });

  it('isLocalHostname distingue nombres públicos', () => {
    expect(isLocalHostname('es.wikipedia.org')).toBe(false);
    expect(isLocalHostname('8.8.8.8')).toBe(false);
  });
});
