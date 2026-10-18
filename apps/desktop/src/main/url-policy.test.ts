import { describe, expect, it } from 'vitest';
import { classifyUrl, parseAddressInput } from './url-policy';

describe('classifyUrl', () => {
  it('permite https y http (con aviso), deriva protocolos externos y bloquea el resto', () => {
    expect(classifyUrl('https://www.gub.uy/')).toMatchObject({ kind: 'allow', secure: true });
    expect(classifyUrl('http://ejemplo.org/')).toMatchObject({ kind: 'allow', secure: false });
    expect(classifyUrl('mailto:a@b.c')).toEqual({ kind: 'external', scheme: 'mailto' });
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'chrome://settings', 'nada']) {
      expect(classifyUrl(url)).toEqual({ kind: 'block' });
    }
  });
});

describe('parseAddressInput', () => {
  it('completa https y rechaza texto que no es dirección', () => {
    expect(parseAddressInput('www.gub.uy/tramites')).toBe('https://www.gub.uy/tramites');
    expect(parseAddressInput('https://x.org')).toBe('https://x.org');
    expect(parseAddressInput('quiero renovar la cédula')).toBeNull();
  });
});
