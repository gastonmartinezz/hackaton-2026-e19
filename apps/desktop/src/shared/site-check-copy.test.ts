import { ReasonCode, SiteCheckResponse, type SiteCheckReason } from '@hackaton/contracts';
import { describe, expect, it } from 'vitest';
import { announcementText, INDICATOR_LABELS, REASON_TEXT, scamSummary, siteCheckCopy, type SiteIndicatorKind } from './site-check-copy';

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

  it('sitio oficial nombra la organización del catálogo; sin alertas lleva el descargo', () => {
    expect(siteCheckCopy('official', response({ identity: { status: 'verified_official', organization: 'Banco Nación' } })).panel.body).toEqual([
      'La dirección pertenece a Banco Nación, según nuestro registro de sitios oficiales.',
    ]);
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
