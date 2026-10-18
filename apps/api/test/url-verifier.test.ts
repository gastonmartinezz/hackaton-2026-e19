import { describe, expect, it } from 'vitest';
import { isBlockedAddress, UrlVerifier } from '../src/modules/urls/url-verifier.js';
import { fakeVerifier } from './helpers.js';

describe('isBlockedAddress', () => {
  it.each([
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'no-es-una-ip',
  ])('bloquea %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.215.14', '190.64.0.10', '2800:a4::1'])('permite la dirección pública %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('UrlVerifier', () => {
  it('acepta una página https que responde 200', async () => {
    const verifier = fakeVerifier();
    await expect(verifier.verify('https://www.gub.uy/tramites/cedula-identidad')).resolves.toEqual({ ok: true });
    expect(verifier.requests).toEqual(['HEAD https://www.gub.uy/tramites/cedula-identidad']);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)', 'scheme'],
    ['file:', 'file:///etc/passwd', 'scheme'],
    ['data:', 'data:text/html,hola', 'scheme'],
    ['http: (solo https mientras no haya una razón visible)', 'http://www.bps.gub.uy/', 'scheme'],
    ['ftp:', 'ftp://ftp.example.com/', 'scheme'],
    ['credenciales', 'https://usuario:clave@www.bps.gub.uy/', 'credentials'],
    ['puerto raro', 'https://www.bps.gub.uy:8443/', 'port'],
    ['IPv4 literal', 'https://127.0.0.1/', 'ip_literal'],
    ['IPv4 en decimal', 'https://2130706433/', 'ip_literal'],
    ['IPv4 en hexadecimal', 'https://0x7f.0.0.1/', 'ip_literal'],
    ['IPv6 literal', 'https://[::1]/', 'ip_literal'],
    ['localhost', 'https://localhost/', 'local_name'],
    ['nombre sin dominio', 'https://intranet/', 'local_name'],
    ['.local', 'https://impresora.local/', 'local_name'],
    ['texto que no es URL', 'no es una url', 'invalid_url'],
  ])('rechaza %s sin conectarse', async (_, url, reason) => {
    const verifier = fakeVerifier();
    await expect(verifier.verify(url)).resolves.toMatchObject({ ok: false, reason });
    expect(verifier.requests).toEqual([]);
  });

  it('acepta el puerto 443 explícito (la URL lo normaliza)', async () => {
    await expect(fakeVerifier().verify('https://www.ute.com.uy:443/')).resolves.toEqual({ ok: true });
  });

  it.each([
    ['una IP privada', ['10.0.0.5']],
    ['loopback', ['127.0.0.1']],
    ['link-local (metadatos de la nube)', ['169.254.169.254']],
    ['IPv6 local', ['fd12::1']],
    ['IPv4 mapeada en IPv6', ['::ffff:192.168.0.10']],
    ['una pública y una privada', ['93.184.215.14', '10.0.0.5']],
  ])('rechaza un nombre que resuelve a %s', async (_, addresses) => {
    const verifier = fakeVerifier({ dns: { 'interno.ejemplo.uy': addresses } });
    await expect(verifier.verify('https://interno.ejemplo.uy/')).resolves.toEqual({ ok: false, reason: 'private_address' });
    expect(verifier.requests).toEqual([]);
  });

  it('rechaza un dominio que no existe', async () => {
    const verifier = fakeVerifier({ dns: { 'agenda.bps.gub.uy': [] } });
    await expect(verifier.verify('https://agenda.bps.gub.uy/')).resolves.toEqual({ ok: false, reason: 'dns' });
  });

  it('valida cada redirección: no sigue una que lleva a una red privada', async () => {
    const verifier = fakeVerifier({
      sites: { 'https://www.ejemplo.uy/ir': { status: 302, location: 'https://trampa.ejemplo.uy/admin' } },
      dns: { 'trampa.ejemplo.uy': ['127.0.0.1'] },
    });
    await expect(verifier.verify('https://www.ejemplo.uy/ir')).resolves.toEqual({ ok: false, reason: 'private_address' });
    expect(verifier.requests).toEqual(['HEAD https://www.ejemplo.uy/ir']);
  });

  it('no sigue una redirección a http ni a una IP literal', async () => {
    const verifier = fakeVerifier({
      sites: {
        'https://a.ejemplo.uy/': { status: 301, location: 'http://a.ejemplo.uy/' },
        'https://b.ejemplo.uy/': { status: 302, location: 'https://192.168.0.1/' },
      },
    });
    await expect(verifier.verify('https://a.ejemplo.uy/')).resolves.toMatchObject({ reason: 'scheme' });
    await expect(verifier.verify('https://b.ejemplo.uy/')).resolves.toMatchObject({ reason: 'ip_literal' });
  });

  it('sigue redirecciones relativas válidas hasta un 2xx', async () => {
    const verifier = fakeVerifier({
      sites: {
        'https://www.bps.gub.uy/': { status: 301, location: '/inicio' },
        'https://www.bps.gub.uy/inicio': { status: 200 },
      },
    });
    await expect(verifier.verify('https://www.bps.gub.uy/')).resolves.toEqual({ ok: true });
  });

  it('corta las redirecciones en bucle o de más', async () => {
    const loop = fakeVerifier({
      sites: {
        'https://a.ejemplo.uy/': { status: 302, location: 'https://b.ejemplo.uy/' },
        'https://b.ejemplo.uy/': { status: 302, location: 'https://a.ejemplo.uy/' },
      },
    });
    await expect(loop.verify('https://a.ejemplo.uy/')).resolves.toMatchObject({ reason: 'redirect_loop' });

    const chain = fakeVerifier({
      sites: Object.fromEntries(
        [1, 2, 3, 4, 5].map((n) => [`https://r.ejemplo.uy/${n}`, { status: 302, location: `https://r.ejemplo.uy/${n + 1}` }]),
      ),
    });
    await expect(chain.verify('https://r.ejemplo.uy/1')).resolves.toMatchObject({ reason: 'redirect_loop' });
  });

  it('rechaza un 404 y prueba GET cuando el sitio no acepta HEAD', async () => {
    const verifier = fakeVerifier({
      sites: {
        'https://www.bps.gub.uy/agendarse': { status: 404 },
        'https://www.ose.com.uy/': (method) => ({ status: method === 'HEAD' ? 405 : 200 }),
      },
    });
    await expect(verifier.verify('https://www.bps.gub.uy/agendarse')).resolves.toEqual({
      ok: false,
      reason: 'http_status',
      status: 404,
    });
    await expect(verifier.verify('https://www.ose.com.uy/')).resolves.toEqual({ ok: true });
    expect(verifier.requests).toContain('GET https://www.ose.com.uy/');
  });

  it('corta por timeout', async () => {
    const verifier = new UrlVerifier(
      { timeoutMs: 20, maxRedirects: 3, cacheTtlMs: 0, allowHttp: false },
      {
        resolve: async () => ['93.184.215.14'],
        request: (_url, _method, signal) =>
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        now: Date.now,
      },
    );
    await expect(verifier.verify('https://lento.ejemplo.uy/')).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('no se queda esperando a un DNS colgado: respeta el timeout y libera la URL', async () => {
    let lookups = 0;
    const verifier = new UrlVerifier(
      { timeoutMs: 30, maxRedirects: 3, cacheTtlMs: 0, allowHttp: false },
      {
        // Un servidor de nombres que nunca responde (ni siquiera mira la señal).
        resolve: () => {
          lookups++;
          return new Promise<string[]>(() => undefined);
        },
        request: async () => ({ status: 200 }),
        now: Date.now,
      },
    );
    const startedAt = performance.now();
    await expect(verifier.verify('https://colgado.ejemplo.uy/')).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(performance.now() - startedAt).toBeLessThan(1000);
    // La entrada en curso se limpió: la siguiente verificación de la misma URL vuelve a consultar y también termina.
    await expect(verifier.verify('https://colgado.ejemplo.uy/')).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(lookups).toBe(2);
  });

  it('pasa la señal de cancelación a la consulta DNS', async () => {
    let received: AbortSignal | undefined;
    const verifier = new UrlVerifier(
      { timeoutMs: 1000, maxRedirects: 3, cacheTtlMs: 0, allowHttp: false },
      {
        resolve: async (_hostname, signal) => {
          received = signal;
          return ['93.184.215.14'];
        },
        request: async () => ({ status: 200 }),
        now: Date.now,
      },
    );
    await verifier.verify('https://www.ute.com.uy/');
    expect(received).toBeInstanceOf(AbortSignal);
  });

  it('recuerda los resultados un rato y los negativos menos', async () => {
    let now = 0;
    const verifier = fakeVerifier({ sites: { 'https://www.ute.com.uy/no-existe': { status: 404 } }, now: () => now });

    await verifier.verify('https://www.ute.com.uy/');
    await verifier.verify('https://www.ute.com.uy/');
    await verifier.verify('https://www.ute.com.uy/no-existe');
    await verifier.verify('https://www.ute.com.uy/no-existe');
    expect(verifier.requests).toHaveLength(3); // 1 HEAD válida + HEAD y GET de la 404

    now = 20_000; // pasó la cuarta parte del TTL (60 s): el negativo vence, el positivo no
    await verifier.verify('https://www.ute.com.uy/');
    await verifier.verify('https://www.ute.com.uy/no-existe');
    expect(verifier.requests).toHaveLength(5);
  });
});
