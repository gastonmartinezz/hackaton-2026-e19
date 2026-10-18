import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from './prefs';
import { buildUserContext } from './user-context';

const system = { language: 'es-UY', timeZone: 'America/Montevideo', country: 'UY' };

describe('buildUserContext', () => {
  it('arma localidad, rango de edad, idioma y zona horaria', () => {
    const profile = { country: 'UY', region: 'Maldonado', city: 'San Carlos', ageRange: '75-plus' as const };
    expect(buildUserContext(profile, system)).toEqual({
      location: { country: 'UY', region: 'Maldonado', city: 'San Carlos' },
      ageRange: '75-plus',
      language: 'es-UY',
      timeZone: 'America/Montevideo',
    });
  });

  it('no envía una dirección, un teléfono ni un correo escritos en la localidad', () => {
    const profile = { ...DEFAULT_PREFS.profile, region: 'tel 4222 7890', city: 'Av. Artigas 1234 piso 5' };
    const sent = JSON.stringify(buildUserContext(profile, system));
    expect(sent).not.toContain('7890');
    expect(sent).not.toContain('1234');
    expect(buildUserContext({ ...profile, city: 'ana@correo.com' }, system)?.location).toBeUndefined();
    expect(buildUserContext({ ...profile, city: '25 de Mayo' }, system)?.location).toEqual({ city: '25 de Mayo' });
  });

  it.each(['Mitre 74, piso 2', 'int. 4304', 'Rivadavia y Alem', 'Av. San Martín', 'calle Sarmiento', 'Villa 31', 'Mz B lote 4'])(
    'descarta lo que parece una dirección: %s',
    (city) => {
      expect(buildUserContext({ ...DEFAULT_PREFS.profile, city }, system)?.location).toBeUndefined();
    },
  );

  it.each(['Partido de 9 de Julio', 'Entre Ríos', 'Florencio Varela', 'Montevideo', 'José C. Paz'])('conserva la localidad %s', (city) => {
    expect(buildUserContext({ ...DEFAULT_PREFS.profile, city }, system)?.location).toEqual({ city });
  });

  it('descarta lo que el sistema entrega fuera del contrato y no envía nada si no hay datos', () => {
    expect(buildUserContext(DEFAULT_PREFS.profile, { language: 'es_UY.UTF-8', timeZone: '../x', country: null })).toBeUndefined();
  });
});
