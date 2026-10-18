import { findLeaks } from '@asistente/privacy';
import { describe, expect, it } from 'vitest';
import { resanitizeSummary } from './resanitize';

describe('resanitizeSummary', () => {
  it('vuelve a depurar lo que llega del preload', () => {
    const out = resanitizeSummary({
      title: 'Hola, Marta - Banco',
      text: 'Hola, Marta Gómez\nTu clave: Secreto123!\nEscribinos a marta@correo.com',
      declaredBrand: 'Banco',
      forms: [{ method: 'post', action: 'https://x.com/a?cedula=30123456', fields: [{ type: 'text', label: 'Cédula 30123456' }] }],
      links: [{ text: 'www.banco.com/x?token=abc', href: 'https://evil.com/r/tok_9f8e7d6c5b4a3210zz#ana@correo.com' }],
      scriptHosts: ['cdn.example'],
      iframeHosts: [],
    });
    expect(findLeaks(out, ['Marta', 'Secreto123', 'marta@correo.com', '30123456', 'tok_9f8e7d6c5b4a3210zz', 'ana@correo.com', 'token=abc'])).toEqual([]);
    expect(out.title).toBe('Banco');
    expect(out.links[0]).toEqual({ text: 'www.banco.com', href: 'https://evil.com/r/[dato]#[dato]' });
  });
});
