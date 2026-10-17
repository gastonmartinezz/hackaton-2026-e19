import { describe, expect, it } from 'vitest';
import { computeRisk } from '../src/modules/site-check/aggregate.js';
import { OfficialCatalog } from '../src/modules/site-check/catalog.js';
import { describeHost, editDistance, hostMatches } from '../src/modules/site-check/domain.js';
import { redactText, sanitizeUrl } from '../src/modules/site-check/sanitize.js';

const catalog = new OfficialCatalog();
const signals = (hostname: string) => catalog.domainSignals(describeHost(hostname)).map((s) => [s.code, s.entry?.id]);

describe('catálogo de sitios oficiales', () => {
  it('coincide por límites de dominio, nunca por sufijo de texto', () => {
    expect(catalog.match('www.argentina.gob.ar')?.id).toBe('argentina-gob-ar');
    expect(catalog.match('argentina.gob.ar')?.id).toBe('argentina-gob-ar');
    expect(catalog.match('argentina.gob.ar.evil.com')).toBeUndefined();
    expect(catalog.match('evilargentina.gob.ar')).toBeUndefined();
    expect(catalog.match('afip.gob.ar')?.id).toBe('arca');
  });

  it('respeta el alcance exact', () => {
    expect(hostMatches('www.x.com.ar', 'x.com.ar', 'exact')).toBe(false);
    expect(hostMatches('x.com.ar', 'x.com.ar', 'exact')).toBe(true);
    expect(hostMatches('a.x.com.ar', 'x.com.ar', 'subdomains')).toBe(true);
  });

  it('cada entrada tiene fuente y fecha de revisión', () => {
    for (const entry of catalog.entries) {
      expect(entry.source.url).toMatch(/^https:\/\//);
      expect(entry.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('dominios parecidos', () => {
  it.each([
    ['anses.com.ar', 'LOOKALIKE_DOMAIN', 'anses'], // misma etiqueta, otra terminación
    ['anses-turnos.com', 'LOOKALIKE_DOMAIN', 'anses'], // contiene la etiqueta
    ['ansses.com', 'LOOKALIKE_DOMAIN', 'anses'], // distancia de edición 1
    ['bancoprovincla.com.ar', 'LOOKALIKE_DOMAIN', 'banco-provincia'],
    ['bna-seguridad.com', 'LOOKALIKE_DOMAIN', 'banco-nacion'],
    ['www-argentina-gob-ar.web.app', 'LOOKALIKE_DOMAIN', 'argentina-gob-ar'], // sufijo privado de la PSL
    ['argentina.gob.ar.evil.com', 'MISLEADING_SUBDOMAIN', 'argentina-gob-ar'],
    ['anses.login-seguro.com', 'MISLEADING_SUBDOMAIN', 'anses'],
    ['xn--mi-6kc7d.org.ar', 'CONFUSABLE_CHARACTERS', 'pami'], // "раmi" con letras cirílicas
  ])('%s → %s', (hostname, code, entry) => {
    expect(signals(hostname)).toContainEqual([code, entry]);
  });

  it('no marca dominios oficiales ni sitios sin relación', () => {
    expect(signals('www.anses.gob.ar')).toEqual([]);
    expect(signals('www.aerolineas.com.ar')).toEqual([]);
    expect(signals('www.marcas.com.ar')).toEqual([]); // "arca" corta solo cuenta como palabra separada
    expect(signals('www.mercadolibre.com.ar')).toEqual([]);
  });

  it('detecta mezcla de alfabetos aunque no imite al catálogo', () => {
    expect(signals('xn--pypal-4ve.com').map(([code]) => code)).toContain('CONFUSABLE_CHARACTERS');
  });

  it('distancia de edición con transposiciones', () => {
    expect(editDistance('anses', 'asnes')).toBe(1);
    expect(editDistance('anses', 'anses')).toBe(0);
  });
});

describe('hosts internos', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '[::1]', 'intranet', 'servidor.local', 'algo.internal', 'nas.corp'])(
    '%s es interno',
    (hostname) => expect(describeHost(hostname).internal).toBe(true),
  );

  it.each(['www.argentina.gob.ar', 'example.com', 'usuario.github.io', '8.8.8.8'])('%s es público', (hostname) => {
    expect(describeHost(hostname).internal).toBe(false);
  });
});

describe('sanitización en el backend', () => {
  it('quita credenciales, query, fragmento y segmentos secretos del path', () => {
    const url = sanitizeUrl('https://user:pass@sitio.com.ar/reset/a1b2c3d4e5f6g7h8i9j0/ana@mail.com/12345678?token=abc#frag');
    expect(url?.toString()).toBe('https://sitio.com.ar/reset/redactado/redactado/redactado');
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('redacta correos, números largos y tokens del texto; las URLs quedan como hostname', () => {
    const text = redactText('Escribí a ana@mail.com, tu CBU 0110599520000001234567 y token abc123def456. Ver https://banco.com/x?dni=1', 200);
    expect(text).not.toMatch(/ana@mail|0110599520000001234567|abc123def456|dni=/);
    expect(text).toContain('banco.com');
  });
});

describe('riesgo determinístico', () => {
  it('una señal fuerte alcanza para riesgo alto', () => {
    expect(computeRisk(new Set(['KNOWN_PHISHING']), true)).toBe('high');
    expect(computeRisk(new Set(['LOOKALIKE_DOMAIN']), false)).toBe('high');
  });

  it('las debilidades técnicas nunca dan riesgo alto por sí solas', () => {
    expect(computeRisk(new Set(['NO_HTTPS', 'CERTIFICATE_PROBLEM', 'CROSS_DOMAIN_REDIRECT']), true)).toBe('no_signals');
    expect(computeRisk(new Set(['INSECURE_FORM_ACTION', 'NO_HTTPS']), true)).toBe('medium');
  });

  it('el registro reciente es solo apoyo: medio solo, alto combinado', () => {
    expect(computeRisk(new Set(['RECENTLY_REGISTERED']), true)).toBe('medium');
    expect(computeRisk(new Set(['RECENTLY_REGISTERED', 'BRAND_IMPERSONATION']), true)).toBe('high');
  });

  it('sin motivos y con cobertura incompleta el riesgo es desconocido', () => {
    expect(computeRisk(new Set(), false)).toBe('unknown');
    expect(computeRisk(new Set(), true)).toBe('no_signals');
  });
});
