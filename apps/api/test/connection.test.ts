import { describe, expect, it } from 'vitest';
import { ConnectionInspector, type HopRequester } from '../src/modules/site-check/connection.js';
import { isBlockedAddress, type HostResolver } from '../src/modules/site-check/net-guard.js';
import { okHop, PUBLIC_IP, publicResolver, recordingRequester } from './site-check-helpers.js';

const inspector = (requester = recordingRequester(), resolver: HostResolver = publicResolver) =>
  new ConnectionInspector({ timeoutMs: 1000, maxPerMinute: 100, enabled: true, resolver, requester: requester.requester });

describe('direcciones bloqueadas (SSRF)', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '2001:db8::1',
    'no-es-una-ip',
  ])('%s está bloqueada', (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each([PUBLIC_IP, '8.8.8.8', '2800:3f0:4002:80a::200e'])('%s es pública', (address) => expect(isBlockedAddress(address)).toBe(false));
});

describe('inspect_connection', () => {
  it('recorre redirecciones sin query ni fragmento', async () => {
    const requester = recordingRequester({
      'https://sitio.com.uy/': { status: 301, location: 'https://www.sitio.com.uy/inicio?ref=1#x', tls: okHop.tls },
    });
    const result = await inspector(requester).inspect(new URL('https://sitio.com.uy/'));
    expect(result.coverage).toBe('complete');
    expect(requester.calls).toEqual(['https://sitio.com.uy/', 'https://www.sitio.com.uy/inicio']);
    expect(result.findings).toEqual([]);
  });

  it.each([
    ['localhost', 'http://localhost/'],
    ['IP privada literal', 'http://10.0.0.8/'],
    ['metadatos de nube', 'http://169.254.169.254/latest/meta-data'],
    ['IPv6 local', 'http://[::1]/'],
    ['puerto no estándar', 'https://sitio.com.uy:8443/'],
  ])('bloquea %s sin hacer la petición', async (_, url) => {
    const requester = recordingRequester();
    const result = await inspector(requester).inspect(new URL(url));
    expect(result.coverage).toBe('unavailable');
    expect(requester.calls).toEqual([]);
  });

  it('bloquea un host público cuyo DNS resuelve a una IP privada (también en respuestas mixtas)', async () => {
    const requester = recordingRequester();
    const resolver: HostResolver = async () => [
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    const result = await inspector(requester, resolver).inspect(new URL('https://rebinding.example.com/'));
    expect(result.coverage).toBe('unavailable');
    expect(requester.calls).toEqual([]);
  });

  it.each([
    ['IP privada', 'http://10.1.1.1/admin'],
    ['localhost', 'http://localhost:8080/'],
    ['link-local', 'http://169.254.169.254/'],
    ['IPv6 privada', 'http://[fd00::1]/'],
  ])('no sigue una redirección hacia %s', async (_, location) => {
    const requester = recordingRequester({ 'https://sitio.com.uy/': { status: 302, location, tls: okHop.tls } });
    const result = await inspector(requester).inspect(new URL('https://sitio.com.uy/'));
    expect(requester.calls).toEqual(['https://sitio.com.uy/']);
    expect(result.coverage).toBe('partial');
    // El destino bloqueado no se informa como redirección a otro dominio.
    expect(result.findings).toEqual([]);
  });

  it('no sigue una redirección a un host cuyo DNS apunta a la red interna', async () => {
    const requester = recordingRequester({ 'https://sitio.com.uy/': { status: 302, location: 'https://interno.example.com/', tls: okHop.tls } });
    const resolver: HostResolver = async (hostname) => [{ address: hostname === 'interno.example.com' ? '192.168.0.10' : PUBLIC_IP, family: 4 }];
    const result = await inspector(requester, resolver).inspect(new URL('https://sitio.com.uy/'));
    expect(requester.calls).toEqual(['https://sitio.com.uy/']);
    expect(result.coverage).toBe('partial');
    // El destino bloqueado nunca se visitó: no se informa como redirección a otro dominio.
    expect(result.findings.map((f) => f.code)).not.toContain('CROSS_DOMAIN_REDIRECT');
  });

  it('corta después del tope de redirecciones', async () => {
    let n = 0;
    const result = await new ConnectionInspector({
      timeoutMs: 1000,
      maxPerMinute: 100,
      enabled: true,
      resolver: publicResolver,
      requester: async () => ({ status: 302, location: `https://sitio.com.uy/${++n}`, tls: null }),
    }).inspect(new URL('https://sitio.com.uy/'));
    expect(result.coverage).toBe('partial');
    // El primer pedido y 5 redirecciones.
    expect(n).toBe(6);
  });

  it('informa redirección a otro dominio y certificado inválido como motivos técnicos', async () => {
    const requester = recordingRequester({
      'https://sitio.com.uy/': { status: 302, location: 'https://otro.example.net/', tls: { ...okHop.tls!, authorized: false, error: 'CERT_HAS_EXPIRED' } },
    });
    const result = await inspector(requester).inspect(new URL('https://sitio.com.uy/'));
    expect(result.findings.map((f) => f.code)).toEqual(['CERTIFICATE_PROBLEM', 'CROSS_DOMAIN_REDIRECT']);
  });

  it('revisa el certificado del destino al que lleva la redirección, no solo el del primer salto', async () => {
    const requester = recordingRequester({
      'http://sitio.com.uy/': { status: 301, location: 'https://destino.example.net/', tls: null },
      'https://destino.example.net/': { ...okHop, tls: { ...okHop.tls!, authorized: false, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' } },
    });
    const result = await inspector(requester).inspect(new URL('http://sitio.com.uy/'));
    expect(result.findings.map((f) => f.code)).toEqual(['CERTIFICATE_PROBLEM', 'CROSS_DOMAIN_REDIRECT']);
    expect(result.findings[0]!.detail).toContain('https://destino.example.net');
  });

  it('una redirección a un destino que no resuelve conserva lo observado en los saltos anteriores', async () => {
    const requester = recordingRequester({
      'https://sitio.com.uy/': { status: 302, location: 'https://caido.example.net/', tls: { ...okHop.tls!, authorized: false, error: 'CERT_HAS_EXPIRED' } },
    });
    const resolver: HostResolver = async (hostname) => {
      if (hostname === 'caido.example.net') throw new Error('ENOTFOUND');
      return [{ address: PUBLIC_IP, family: 4 }];
    };
    const result = await inspector(requester, resolver).inspect(new URL('https://sitio.com.uy/'));
    expect(result.coverage).toBe('partial');
    expect(result.findings.map((f) => f.code)).toEqual(['CERTIFICATE_PROBLEM']);
  });

  it('una redirección cuyo destino no responde conserva lo observado en los saltos anteriores', async () => {
    const requester: HopRequester = async (url) => {
      if (url.hostname === 'lento.example.net') throw new Error('ECONNRESET');
      return { status: 302, location: 'https://lento.example.net/', tls: okHop.tls };
    };
    const result = await new ConnectionInspector({ timeoutMs: 1000, maxPerMinute: 100, enabled: true, resolver: publicResolver, requester }).inspect(
      new URL('https://sitio.com.uy/'),
    );
    expect(result).toMatchObject({ coverage: 'partial', findings: [] });
  });

  it('una caída devuelve unavailable', async () => {
    const result = await new ConnectionInspector({
      timeoutMs: 1000,
      maxPerMinute: 100,
      enabled: true,
      resolver: publicResolver,
      requester: async () => {
        throw new Error('ECONNREFUSED');
      },
    }).inspect(new URL('https://sitio.com.uy/'));
    // Sin caché: conviene reintentar.
    expect(result).toMatchObject({ coverage: 'unavailable', ttlMs: 0 });
  });
});
