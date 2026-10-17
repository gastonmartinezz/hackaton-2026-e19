import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from './prefs';
import { buildUserContext } from './user-context';

const system = { language: 'es-AR', timeZone: 'America/Argentina/Cordoba', country: 'AR' };

describe('buildUserContext', () => {
  it('arma localidad, rango de edad, idioma y zona horaria', () => {
    const profile = { country: 'AR', region: 'Córdoba', city: 'Villa María', ageRange: '75-plus' as const };
    expect(buildUserContext(profile, system)).toEqual({
      location: { country: 'AR', region: 'Córdoba', city: 'Villa María' },
      ageRange: '75-plus',
      language: 'es-AR',
      timeZone: 'America/Argentina/Cordoba',
    });
  });

  it('no envía una dirección, un teléfono ni un correo escritos en la localidad', () => {
    const profile = { ...DEFAULT_PREFS.profile, region: 'tel 351 456 7890', city: 'Av. Colón 1234 piso 5' };
    const sent = JSON.stringify(buildUserContext(profile, system));
    expect(sent).not.toContain('7890');
    expect(sent).not.toContain('1234');
    expect(buildUserContext({ ...profile, city: 'ana@correo.com' }, system)?.location).toBeUndefined();
    expect(buildUserContext({ ...profile, city: '25 de Mayo' }, system)?.location).toEqual({ city: '25 de Mayo' });
  });

  it('descarta lo que el sistema entrega fuera del contrato y no envía nada si no hay datos', () => {
    expect(buildUserContext(DEFAULT_PREFS.profile, { language: 'es_AR.UTF-8', timeZone: '../x', country: null })).toBeUndefined();
  });
});
