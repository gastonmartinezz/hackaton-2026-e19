import { describe, expect, it } from 'vitest';
import { dictatedValue, matchListOption } from './dictation';

describe('dictatedValue', () => {
  it('texto: sin el punto final ni espacios de más', () => {
    expect(dictatedValue('  Juan  Pérez. ', 'text')).toBe('Juan Pérez');
    expect(dictatedValue('...', 'text')).toBeNull();
  });

  it('correo: «arroba», «punto» y sin espacios', () => {
    expect(dictatedValue('juan punto perez arroba gmail punto com.', 'email')).toBe('juan.perez@gmail.com');
    expect(dictatedValue('Juan.Perez@Gmail.com', 'email')).toBe('juan.perez@gmail.com');
    expect(dictatedValue('juan guion bajo perez arroba correo punto com punto uy', 'email')).toBe('juan_perez@correo.com.uy');
  });

  it('teléfono: solo números, con números dichos en palabras', () => {
    expect(dictatedValue('099 123 456.', 'tel')).toBe('099123456');
    expect(dictatedValue('cero nueve nueve, uno dos tres', 'tel')).toBe('099123');
    expect(dictatedValue('+598 99 123 456', 'tel')).toBe('+59899123456');
    expect(dictatedValue('no sé', 'tel')).toBeNull();
  });

  it('número', () => {
    expect(dictatedValue('2.500', 'number')).toBe('2500');
    expect(dictatedValue('tres', 'number')).toBe('3');
    expect(dictatedValue('ninguno', 'number')).toBeNull();
  });

  it('fecha: con palabras o con barras, en el formato del lugar para fechas', () => {
    expect(dictatedValue('3 de mayo de 1950', 'date')).toBe('1950-05-03');
    expect(dictatedValue('03/05/1950', 'date')).toBe('1950-05-03');
    expect(dictatedValue('31 de febrero de 1950', 'date')).toBeNull();
    expect(dictatedValue('el martes', 'date')).toBeNull();
  });
});

describe('matchListOption', () => {
  const options = ['Seleccione', 'Montevideo', 'Canelones', 'Cerro Largo', 'Maldonado'];

  it('reconoce la opción dicha tal cual o dentro de una frase', () => {
    expect(matchListOption('Canelones.', options)).toBe(2);
    expect(matchListOption('vivo en cerro largo', options)).toBe(3);
    expect(matchListOption('Maldonado', options)).toBe(4);
  });

  it('sin coincidencia clara, no elige', () => {
    expect(matchListOption('Rivera', options)).toBeNull();
    expect(matchListOption('', options)).toBeNull();
    expect(matchListOption('cerro', ['Cerro Largo', 'Cerro Chato'])).toBeNull();
  });
});
