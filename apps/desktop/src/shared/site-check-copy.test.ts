import { ReasonCode, SiteCheckResponse, type SiteCheckReason } from '@hackaton/contracts';
import { describe, expect, it } from 'vitest';
import { announcementText, governmentSuffix, INDICATOR_LABELS, plainDate, REASON_TEXT, scamSummary, siteCheckCopy, type SiteIndicatorKind } from './site-check-copy';

describe('plainDate', () => {
  it('una fecha de revisión (medianoche UTC) se muestra el mismo día', () => {
    expect(plainDate('2026-10-17T00:00:00.000Z')).toBe('17 de octubre de 2026');
  });
});

const evidence = [{ source: 'test', checkedAt: '2026-10-17T22:00:00Z', observedBy: 'service' as const, detail: 'x' }];
const reason = (code: ReasonCode, category: SiteCheckReason['category'] = 'fraud'): SiteCheckReason => ({ code, category, evidence });
const COMPLETE = { reputation: 'complete', identity: 'complete', content: 'complete', registration: 'unavailable', connection: 'unavailable' } as const;
const response = (over: Partial<SiteCheckResponse> = {}) =>
  SiteCheckResponse.parse({
    navigationId: 'nav-1',
    contentVersion: 1,
    analysisId: 'a',
    status: 'complete',
    identity: { status: 'unknown' },
    risk: 'no_signals',
    reasons: [],
    coverage: COMPLETE,
    checkedAt: '2026-10-17T22:00:00Z',
    expiresAt: '2026-10-17T22:15:00Z',
    ...over,
  });

const KINDS = Object.keys(INDICATOR_LABELS) as Array<Exclude<SiteIndicatorKind, 'none'>>;

function allText(kind: Exclude<SiteIndicatorKind, 'none'>, r: SiteCheckResponse | null): string {
  const copy = siteCheckCopy(kind, r);
  const { panel } = copy;
  return [copy.label, panel.title, ...panel.body, panel.primary.label, panel.secondary?.label ?? '', ...panel.reasons, panel.coverageNote ?? ''].join(' | ');
}

describe('textos del indicador', () => {
  it('usa los textos exactos acordados', () => {
    expect(INDICATOR_LABELS).toMatchObject({
      checking: 'Revisando sitio…',
      official: 'Sitio oficial',
      no_alerts: 'Sin alertas detectadas',
      attention: 'Atención',
      possible_scam: 'Posible estafa',
      unverified: 'No pudimos verificarlo',
    });
  });

  it('nunca dice «seguro» ni usa porcentajes', () => {
    const everyReason = response({ risk: 'high', reasons: ReasonCode.options.map((c) => reason(c)) });
    for (const kind of KINDS) {
      for (const r of [null, response(), everyReason]) {
        const text = allText(kind, r);
        expect(text).not.toMatch(/segur[oa]s?|%/i);
      }
      if (kind !== 'checking') expect(announcementText(kind)).not.toMatch(/segur/i);
    }
    for (const text of Object.values(REASON_TEXT)) expect(text).not.toMatch(/segur|%/i);
  });

  it('cada estado tiene ícono, texto y una acción principal', () => {
    for (const kind of KINDS) {
      const copy = siteCheckCopy(kind);
      expect(copy.icon).toBe(kind);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.panel.primary.label.length).toBeGreaterThan(0);
      expect(copy.panel.body.length).toBeGreaterThanOrEqual(1);
      expect(copy.panel.body.length).toBeLessThanOrEqual(2);
    }
  });

  it('sin alertas lleva el descargo y no pudimos verificarlo ofrece reintentar', () => {
    expect(siteCheckCopy('no_alerts', response()).panel.body.join(' ')).toBe(
      'No encontramos señales de estafa en las comprobaciones realizadas. Esto no garantiza que el sitio sea confiable.',
    );
    expect(siteCheckCopy('unverified').panel).toMatchObject({
      body: ['No pudimos completar la revisión. Tené cuidado antes de ingresar datos personales.'],
      primary: { id: 'retry', label: 'Intentar de nuevo' },
    });
  });

  it('posible estafa: «parece imitar» solo con evidencia de suplantación', () => {
    const imitates = response({ risk: 'high', identity: { status: 'unknown', impersonatedOrganization: 'Banco Nación' }, reasons: [reason('LOOKALIKE_DOMAIN')] });
    expect(scamSummary(imitates)).toBe('Este sitio parece imitar a Banco Nación. No ingreses contraseñas ni códigos.');
    const copy = siteCheckCopy('possible_scam', imitates);
    expect(copy.panel.primary).toEqual({ id: 'leave', label: 'Salir de este sitio' });

    // Organización informada pero el motivo es otro: no se afirma suplantación.
    const malware = response({ risk: 'high', identity: { status: 'unknown', impersonatedOrganization: 'Banco Nación' }, reasons: [reason('KNOWN_MALWARE')] });
    expect(scamSummary(malware)).not.toContain('imitar');
    expect(scamSummary(malware)).toContain('dañar tu equipo');
    expect(scamSummary(response({ risk: 'high', reasons: [reason('KNOWN_PHISHING')] }))).toContain('robar datos');
    expect(scamSummary(response({ risk: 'high', reasons: [reason('SENSITIVE_DATA_REQUEST')] }))).toBe(
      'Encontramos señales de estafa en este sitio. No ingreses contraseñas ni códigos.',
    );
  });

  it('los detalles traen motivos en lenguaje simple, la nota de cobertura y la explicación como complemento', () => {
    const r = response({
      status: 'partial',
      risk: 'medium',
      reasons: [reason('NO_HTTPS', 'technical'), reason('URGENCY_OR_THREAT'), reason('URGENCY_OR_THREAT')],
      explanation: 'Texto de la IA',
    });
    const { panel } = siteCheckCopy('attention', r);
    // Primero la evidencia de fraude, sin repetir.
    expect(panel.reasons).toEqual([REASON_TEXT.URGENCY_OR_THREAT, REASON_TEXT.NO_HTTPS]);
    expect(panel.coverageNote).toMatch(/no está completa/);
    expect(panel.explanation).toBe('Texto de la IA');
    // La explicación nunca cambia título ni acciones.
    expect(panel.title).toBe('Atención');
  });
});

describe('nota de cobertura', () => {
  it('no se muestra por registro o conexión no disponibles (no son obligatorios)', () => {
    expect(siteCheckCopy('no_alerts', response()).panel.coverageNote).toBeNull();
    expect(siteCheckCopy('unverified', response({ status: 'partial', coverage: { ...COMPLETE, reputation: 'unavailable' } })).panel.coverageNote).not.toBeNull();
  });
});

describe('sitio oficial según la fuente de autoridad (identity.basis)', () => {
  const SOURCE = { name: 'Fuente de prueba', url: 'https://www.fuente.gob.ar/padron', reviewedAt: '2026-10-01T12:00:00Z' };
  const official = (
    basis: 'government_domain' | 'financial_regulator' | 'official_catalog',
    organization: string,
    source: { name: string; url?: string; reviewedAt: string } = SOURCE,
  ) => response({ identity: { status: 'verified_official', basis, organization, source }, checkedAt: '2026-10-17T22:00:00Z' });

  it('dominio del Estado argentino: nombra la terminación real de la dirección', () => {
    const r = official('government_domain', 'Estado argentino');
    expect(siteCheckCopy('official', r, 'www.argentina.gob.ar').panel.body).toEqual([
      'Es un sitio del Estado argentino: su dirección termina en .gob.ar, que solo pueden usar organismos públicos.',
    ]);
    expect(siteCheckCopy('official', r, 'www.ejercito.mil.ar').panel.body[0]).toContain('termina en .mil.ar');
    expect(siteCheckCopy('official', r, 'www.ejemplo.gov.ar').panel.body[0]).toContain('termina en .gov.ar');
    // Sin hostname no se inventa la terminación.
    expect(siteCheckCopy('official', r).panel.body[0]).toBe('Es un sitio del Estado argentino: su dirección usa una terminación que solo pueden usar organismos públicos.');
    expect(siteCheckCopy('official', r, 'www.argentina.gob.ar').panel.sources).toEqual([
      'Las direcciones terminadas en .gob.ar solo se entregan a organismos del Estado argentino.',
      'Fuente: Fuente de prueba (fuente.gob.ar).',
      // La fecha de revisión de la fuente, no la de la consulta (checkedAt).
      'Revisado el 1 de octubre de 2026.',
    ]);
    expect(announcementText('official', r)).toBe('Sitio oficial del Estado argentino.');
  });

  it('dominio del Gobierno de Estados Unidos', () => {
    const r = official('government_domain', 'Gobierno de Estados Unidos');
    expect(siteCheckCopy('official', r, 'www.usa.gov').panel.body).toEqual([
      'Es un sitio del Gobierno de Estados Unidos: su dirección termina en .gov, que solo pueden usar organismos públicos.',
    ]);
    expect(siteCheckCopy('official', r, 'www.army.mil').panel.body[0]).toContain('termina en .mil');
  });

  it('dominio del Estado uruguayo: sin asumir Argentina', () => {
    const r = official('government_domain', 'Estado uruguayo');
    const { panel } = siteCheckCopy('official', r, 'www.gub.uy');
    expect(panel.body).toEqual(['Es un sitio del Estado uruguayo: su dirección termina en .gub.uy, que solo pueden usar organismos públicos.']);
    expect(panel.sources[0]).toBe('Las direcciones terminadas en .gub.uy solo se entregan a organismos del Estado uruguayo.');
    expect([...panel.body, ...panel.sources].join(' ')).not.toMatch(/argentin|Banco Central/i);
    expect(announcementText('official', r)).toBe('Sitio oficial del Estado uruguayo.');
  });

  it('catálogo curado (sitios de Uruguay)', () => {
    // Sin url: la fuente va sin dominio.
    const r = official('official_catalog', 'UTE', { name: 'Sitio institucional de UTE', reviewedAt: '2026-10-10T12:00:00Z' });
    const { panel } = siteCheckCopy('official', r, 'portal.ute.com.uy');
    expect(panel.body).toEqual(['La dirección pertenece a UTE, según nuestra lista de sitios oficiales revisada.']);
    expect(panel.sources).toEqual([
      'Figura en nuestra lista de sitios oficiales revisada.',
      'Fuente: Sitio institucional de UTE.',
      'Revisado el 10 de octubre de 2026.',
    ]);
    expect(announcementText('official', r)).toBe('Sitio oficial de UTE.');
  });

  it('entidad del padrón del BCRA', () => {
    const r = official('financial_regulator', 'Banco de la Nación Argentina', {
      name: 'Padrón de entidades financieras del BCRA',
      url: 'https://www.bcra.gob.ar/SistemasFinancierosYdePagos/Entidades_financieras.asp',
      reviewedAt: '2026-10-15T12:00:00Z',
    });
    const { panel } = siteCheckCopy('official', r, 'www.bna.com.ar');
    expect(panel.body).toEqual(['La dirección pertenece a Banco de la Nación Argentina, según el registro de entidades del Banco Central.']);
    expect(panel.sources).toEqual([
      'Figura en el registro de entidades financieras del Banco Central.',
      'Fuente: Padrón de entidades financieras del BCRA (bcra.gob.ar).',
      'Revisado el 15 de octubre de 2026.',
    ]);
    expect(announcementText('official', r)).toBe('Sitio oficial de Banco de la Nación Argentina.');
  });

  it('ya no menciona un registro propio ni dice «seguro»; los demás estados no llevan fuente', () => {
    for (const r of [official('government_domain', 'Estado argentino'), official('financial_regulator', 'Banco X'), official('official_catalog', 'Antel')]) {
      const { panel } = siteCheckCopy('official', r, 'a.gob.ar');
      const text = [...panel.body, ...panel.sources].join(' ');
      expect(text).not.toMatch(/nuestro registro|segur/i);
    }
    expect(siteCheckCopy('no_alerts', response()).panel.sources).toEqual([]);
  });

  it('governmentSuffix reconoce solo zonas reservadas al Estado', () => {
    expect(governmentSuffix('tramites.mostrame-demo.gob.ar')).toBe('.gob.ar');
    expect(governmentSuffix('www.usa.gov')).toBe('.gov');
    expect(governmentSuffix('tramites.gub.uy')).toBe('.gub.uy');
    expect(governmentSuffix('gob.ar.evil.com')).toBeNull();
    expect(governmentSuffix('migob.ar')).toBeNull();
    expect(governmentSuffix(null)).toBeNull();
  });
});
