import { findLeaks } from '@asistente/privacy';
import { PageSummary, SiteCheckLimits } from '@hackaton/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { extractPageSummary, pageSignature } from './index';

const SECRETS = ['marta.gomez@correo.com', '30123456', 'Secreto123!', 'Calle Falsa 742', 'tok_9f8e7d6c5b4a3210zz', 'Marta Gómez', '4111111111111111', 'sid=abc'];

beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://banco-demo.example/ingresar/30123456?token=tok_9f8e7d6c5b4a3210zz#marta.gomez@correo.com',
  );
  document.title = '';
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.cookie = 'sid=abc';
  localStorage.setItem('k', 'Secreto123!');
});

describe('extractPageSummary', () => {
  it('resume título, marca, formularios, enlaces y orígenes', () => {
    document.head.innerHTML = '<meta property="og:site_name" content="Banco de Demostración">';
    document.title = 'Banco Demo - Ingresar';
    document.body.innerHTML = `
      <h1>Ingresá a tu cuenta</h1>
      <p>Tu cuenta será <b>suspendida</b> hoy.</p>
      <form method="POST" action="https://recolector.example/guardar?u=marta.gomez@correo.com">
        <label for="u">Usuario</label><input id="u" autocomplete="username">
        <label>Clave <input type="password" autocomplete="current-password"></label>
        <input type="hidden" name="csrf" value="tok_9f8e7d6c5b4a3210zz">
        <button type="submit">Entrar</button>
      </form>
      <a href="https://otro.example/login">www.banco-demo.example</a>
      <a href="/ayuda">Ayuda</a>
      <a href="mailto:x@y.com">Escribinos</a>
      <script src="https://cdn.example/app.js"></script>
      <iframe src="https://tracker.example/pixel"></iframe>`;
    const summary = extractPageSummary(document);
    expect(PageSummary.safeParse(summary).success).toBe(true);
    expect(summary.title).toBe('Banco Demo - Ingresar');
    expect(summary.declaredBrand).toBe('Banco de Demostración');
    expect(summary.text).toContain('Ingresá a tu cuenta');
    expect(summary.text).toContain('Tu cuenta será suspendida hoy.');
    expect(summary.forms).toEqual([
      {
        method: 'post',
        action: 'https://recolector.example/guardar?u=[dato]',
        fields: [
          { type: 'text', label: 'Usuario', autocomplete: 'username' },
          { type: 'password', label: 'Clave', autocomplete: 'current-password' },
          { type: 'hidden' },
        ],
      },
    ]);
    // El enlace que lleva a otro sitio y muestra una dirección va primero, con solo el hostname.
    expect(summary.links[0]).toEqual({ text: 'www.banco-demo.example', href: 'https://otro.example/login' });
    expect(summary.links).toContainEqual({ text: 'Ayuda', href: 'https://banco-demo.example/ayuda' });
    expect(summary.links.some((l) => l.href.startsWith('mailto'))).toBe(false);
    expect(summary).not.toHaveProperty('scriptHosts');
    expect(summary).not.toHaveProperty('iframeHosts');
  });

  it('ningún valor de formulario, cookie, almacenamiento ni token sale', () => {
    document.body.innerHTML = `
      <p>Hola, Marta Gómez</p>
      <p>Tu clave: Secreto123!</p>
      <form>
        <label>Correo <input type="email" value="marta.gomez@correo.com"></label>
        <label>Tarjeta <input autocomplete="cc-number"></label>
        <label>Dirección <textarea>Calle Falsa 742</textarea></label>
        <label>DNI <select><option selected>30123456</option></select></label>
        <label><input type="checkbox" checked> Recordarme</label>
      </form>
      <div contenteditable="true">Calle Falsa 742</div>
      <a href="/cuenta/30123456?token=tok_9f8e7d6c5b4a3210zz">Mi cuenta</a>`;
    (document.querySelector('input[autocomplete=cc-number]') as HTMLInputElement).value = '4111111111111111';
    const summary = extractPageSummary(document);
    expect(PageSummary.safeParse(summary).success).toBe(true);
    expect(findLeaks(summary, SECRETS)).toEqual([]);
    expect(summary.text).toContain('Tu clave: [dato]');
    expect(summary.forms[0]!.fields.map((f) => f.type)).toEqual(['email', 'text', 'textarea', 'select', 'checkbox']);
    expect(JSON.stringify(summary)).not.toMatch(/"value"|checked|selected/);
  });

  it('respeta los topes del contrato', () => {
    const many = Array.from({ length: 80 }, (_, i) => `<a href="https://s${i}.example/">Enlace ${'x'.repeat(i % 5)}${String.fromCharCode(97 + (i % 26))}</a>`).join('');
    const forms = Array.from({ length: 15 }, () => '<form><input></form>').join('');
    document.body.innerHTML = `${'<p>texto largo de relleno para la página</p>'.repeat(300)}${many}${forms}<form><input type="password"></form>`;
    const summary = extractPageSummary(document);
    expect(PageSummary.safeParse(summary).success).toBe(true);
    expect(summary.text.length).toBeLessThanOrEqual(SiteCheckLimits.maxTextLength);
    expect(summary.links.length).toBeLessThanOrEqual(SiteCheckLimits.maxLinks);
    expect(summary.forms).toHaveLength(SiteCheckLimits.maxForms);
    // El formulario con contraseña no queda afuera por el tope.
    expect(summary.forms.some((f) => f.fields.some((field) => field.type === 'password'))).toBe(true);
  });

  it('agrupa campos sin formulario y omite los ocultos por estilo del texto', () => {
    document.body.innerHTML = '<p style="display:none">Oculto</p><div><input type="password" aria-label="Clave"></div>';
    const summary = extractPageSummary(document);
    expect(summary.text).not.toContain('Oculto');
    expect(summary.forms).toEqual([{ method: 'other', action: null, fields: [{ type: 'password', label: 'Clave' }] }]);
  });
});

describe('pageSignature', () => {
  it('cambia con formularios o identidad, no con texto escrito', () => {
    document.body.innerHTML = '<form><input id="a"></form>';
    const before = pageSignature(document);
    (document.getElementById('a') as HTMLInputElement).value = 'algo que escribe la persona';
    expect(pageSignature(document)).toBe(before);
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<input type="password">');
    const withPassword = pageSignature(document);
    expect(withPassword).not.toBe(before);
    document.title = 'Otro banco';
    expect(pageSignature(document)).not.toBe(withPassword);
  });
});
