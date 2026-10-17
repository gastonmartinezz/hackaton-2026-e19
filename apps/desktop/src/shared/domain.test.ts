import { describe, expect, it } from 'vitest';
import { splitDomain } from './domain';

describe('splitDomain', () => {
  it('separa subdominio y dominio principal', () => {
    expect(splitDomain('agenda.ejemplo.gub.uy')).toEqual({ sub: 'agenda.', main: 'ejemplo.gub.uy' });
    expect(splitDomain('www.tiendamac.ejemplo.com.uy')).toEqual({ sub: 'www.tiendamac.', main: 'ejemplo.com.uy' });
    expect(splitDomain('www.argentina.gob.ar')).toEqual({ sub: 'www.', main: 'argentina.gob.ar' });
    expect(splitDomain('mail.google.com')).toEqual({ sub: 'mail.', main: 'google.com' });
    expect(splitDomain('example.com')).toEqual({ sub: '', main: 'example.com' });
  });

  it('no divide direcciones IP ni nombres locales', () => {
    expect(splitDomain('127.0.0.1')).toEqual({ sub: '', main: '127.0.0.1' });
    expect(splitDomain('localhost')).toEqual({ sub: '', main: 'localhost' });
  });
});
