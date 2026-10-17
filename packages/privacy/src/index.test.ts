import { describe, expect, it } from 'vitest';
import { findLeaks, isDoubtfulLabel, minimizeIntent, redactText, sanitizeLabel, sanitizeOrigin, sanitizeTitle } from './index';

describe('redactText', () => {
  it('quita correos, teléfonos, documentos, tokens y URLs', () => {
    const out = redactText(
      'Escribí a ana.perez@correo.com o al +54 11 4567-8901, DNI 30.123.456, token abcd1234efgh5678ijkl, ver https://x.com/a?b=c',
      { maxLength: 500 },
    );
    expect(out).not.toMatch(/ana\.perez|4567|30\.123|abcd1234|x\.com/);
    expect(out).toContain('[correo]');
    expect(out).toContain('[número]');
    expect(out).toContain('[dato]');
    expect(out).toContain('[enlace]');
  });

  it('quita claves cortas y valores que siguen a palabras de credencial', () => {
    for (const secret of ['Mar2026x', 'ab12cd34', 'Secreto123']) {
      expect(redactText(`mi clave es ${secret}`)).not.toContain(secret);
      expect(redactText(`uso ${secret} para entrar`)).not.toContain(secret);
    }
    expect(redactText('clave: hunter')).toBe('clave: [dato]');
    expect(redactText('mi contraseña es gatito')).toBe('mi contraseña es [dato]');
    expect(redactText('token=xyz')).toBe('token=[dato]');
    // Un secreto puede tener espacios, puntos o guiones: se oculta el resto de la línea.
    expect(redactText('clave: uno dos tres, gracias')).toBe('clave: [dato]');
    expect(redactText('mi contraseña es mi perro firulais')).toBe('mi contraseña es [dato]');
    expect(redactText('clave: abc12.def34.ghi56')).toBe('clave: [dato]');
    expect(redactText('password: Abcdef.9x y nada más')).toBe('password: [dato]');
    // Hasta el fin de la línea, no del texto: lo que sigue en otra línea se conserva.
    expect(redactText('pin: 1234\nQuiero turno el martes', { maxLength: 500 })).toBe('pin: [dato] Quiero turno el martes');
    expect(redactText('clave: x y\r\nOtra línea\u2028Tercera', { maxLength: 500 })).toBe('clave: [dato] Otra línea Tercera');
    // Línea que termina en el separador: el valor está en la siguiente (y solo en esa).
    expect(redactText('clave:\nhunter2\nQuiero turno', { maxLength: 500 })).toBe('clave: [dato] Quiero turno');
    expect(redactText('mi contraseña es\n  gatito 123', { maxLength: 500 })).toBe('mi contraseña es [dato]');
    expect(redactText('Olvidé mi contraseña')).toBe('Olvidé mi contraseña');
  });

  it('conserva números cortos útiles y normaliza espacios', () => {
    expect(redactText('  Paso   2 de 3 \n')).toBe('Paso 2 de 3');
    expect(redactText('Horarios 2026')).toBe('Horarios 2026');
  });

  it('trunca al máximo indicado', () => {
    expect(redactText('a'.repeat(200), { maxLength: 10 })).toHaveLength(10);
  });
});

describe('sanitizeTitle', () => {
  it('descarta las partes personalizadas del título y conserva el resto', () => {
    expect(sanitizeTitle('Horarios - Hola, Marta')).toBe('Horarios');
    expect(sanitizeTitle('Mi cuenta | Sesión iniciada como marta | Banco')).toBe('Mi cuenta - Banco');
    expect(sanitizeTitle('Bienvenida Marta')).toBe('');
    expect(sanitizeTitle('Turnos · Hospital 30123456')).toBe('Turnos - Hospital [número]');
    // Desde la palabra de credencial en adelante no sale nada, con cualquier separador.
    expect(sanitizeTitle('Contraseña : hunter2 | Banco')).toBe('Contraseña');
    expect(sanitizeTitle('Mi clave es gatito - Banco')).toBe('Mi clave');
    expect(sanitizeTitle('Contraseña - gatito | Banco')).toBe('Contraseña');
    expect(sanitizeTitle('Clave fiscal : 1234abcd : Sección de ayuda')).toBe('Clave fiscal');
    expect(sanitizeTitle('mi contraseña es hola - mundo')).toBe('mi contraseña');
    expect(sanitizeTitle('Banco | Recuperar contraseña')).toBe('Banco - Recuperar contraseña');
    expect(sanitizeTitle('Pinterest - Inicio')).toBe('Pinterest - Inicio');
  });
});

describe('isDoubtfulLabel / sanitizeLabel', () => {
  it('omite saludos personalizados y etiquetas que son casi solo datos', () => {
    expect(sanitizeLabel('Hola, Marta Gómez')).toBe('');
    expect(sanitizeLabel('Sesión iniciada como marta')).toBe('');
    expect(sanitizeLabel('marta@correo.com')).toBe('');
    expect(isDoubtfulLabel('Buscar')).toBe(false);
    expect(sanitizeLabel('Llamar al 0800 222 3333')).toBe('Llamar al [número]');
  });
});

describe('sanitizeOrigin', () => {
  it('devuelve solo el origen y rechaza otros esquemas', () => {
    expect(sanitizeOrigin('https://user:pw@www.gob.ar:8443/turnos/123?dni=1#x')).toBe('https://www.gob.ar:8443');
    expect(sanitizeOrigin('file:///etc/passwd')).toBeNull();
    expect(sanitizeOrigin('javascript:alert(1)')).toBeNull();
    expect(sanitizeOrigin('no es url')).toBeNull();
  });
});

describe('minimizeIntent / findLeaks', () => {
  it('la intención también se minimiza', () => {
    const intent = minimizeIntent('Quiero renovar mi DNI 30123456, mi mail es juan@x.com');
    expect(findLeaks({ intent }, ['30123456', 'juan@x.com'])).toEqual([]);
  });
});
