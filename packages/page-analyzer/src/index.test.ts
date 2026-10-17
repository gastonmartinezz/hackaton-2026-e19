import { PageSnapshotSchema } from '@asistente/contracts';
import { findLeaks } from '@asistente/privacy';
import { beforeEach, describe, expect, it } from 'vitest';
import { extractSnapshot } from './index';

const SECRETS = ['marta.gomez@correo.com', '30123456', 'Secreto123!', 'Calle Falsa 742', 'tok_9f8e7d6c5b4a3210zz', 'Marta Gómez'];

function extract() {
  return extractSnapshot(document, { pageId: 'p-1', navigationId: 'nav-1', revision: 1 });
}

beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://turnos.ejemplo.gob.ar/mi-cuenta/30123456?token=tok_9f8e7d6c5b4a3210zz#perfil');
  document.body.innerHTML = '';
});

describe('extractSnapshot', () => {
  it('extrae controles útiles con rol, etiqueta, tipo, estado y sección', () => {
    document.body.innerHTML = `
      <header><nav aria-label="Principal"><a href="/horarios">Horarios</a></nav></header>
      <main>
        <h1>Turnos</h1>
        <form aria-label="Pedir turno">
          <label for="dni">Número de documento</label><input id="dni" type="text">
          <label>Provincia <select><option>Córdoba</option></select></label>
          <button type="submit" disabled>Continuar</button>
        </form>
      </main>`;
    const { snapshot } = extract();
    expect(PageSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const byLabel = Object.fromEntries(snapshot.elements.map((e) => [e.label, e]));
    expect(byLabel['Horarios']).toMatchObject({ role: 'link', enabled: true });
    expect(byLabel['Turnos']).toMatchObject({ role: 'heading' });
    expect(byLabel['Número de documento']).toMatchObject({ role: 'textbox', inputType: 'text' });
    expect(byLabel['Provincia']).toMatchObject({ role: 'combobox', inputType: 'select' });
    const button = byLabel['Continuar']!;
    expect(button).toMatchObject({ role: 'button', enabled: false });
    const form = snapshot.elements.find((e) => e.role === 'form')!;
    expect(button.sectionId).toBe(form.id);
    expect(snapshot.origin).toBe('https://turnos.ejemplo.gob.ar');
  });

  it('no filtra valores, etiquetas personalizadas ni la URL completa', () => {
    document.body.innerHTML = `
      <p>Hola, Marta Gómez</p>
      <a href="/perfil">Hola, Marta Gómez</a>
      <a href="/salir">Cerrar sesión de marta.gomez@correo.com</a>
      <label>Correo <input type="email" value="marta.gomez@correo.com"></label>
      <label>Clave <input type="password" value="Secreto123!"></label>
      <label>Dirección <textarea>Calle Falsa 742</textarea></label>
      <label>DNI <select><option selected>30123456</option></select></label>
      <div role="textbox" contenteditable="true" aria-label="Notas">Calle Falsa 742</div>
      <button>Buscar</button>`;
    const input = document.querySelector('input[type=email]') as HTMLInputElement;
    input.value = 'marta.gomez@correo.com';
    const { snapshot } = extract();
    expect(findLeaks(snapshot, SECRETS)).toEqual([]);
    expect(snapshot.elements.map((e) => e.label)).toEqual(
      expect.arrayContaining(['Correo', 'Clave', 'Dirección', 'DNI', 'Notas', 'Buscar']),
    );
  });

  it('ignora elementos ocultos y marca extracción parcial con frames', () => {
    document.body.innerHTML = `
      <button style="display:none">Oculto</button>
      <div aria-hidden="true"><a href="/x">Decorativo</a></div>
      <button hidden>Escondido</button>
      <iframe title="Externo"></iframe>
      <a href="/visible">Visible</a>`;
    const { snapshot, notes } = extract();
    expect(snapshot.elements.map((e) => e.label)).toEqual(['Visible']);
    expect(snapshot.extraction).toBe('partial');
    expect(notes).toContain('frames');
  });

  it('entra en shadow DOM abierto y registra referencias locales', () => {
    const host = document.createElement('x-widget');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML = '<button>Dentro del shadow</button>';
    const { snapshot, registry } = extract();
    const el = snapshot.elements.find((e) => e.label === 'Dentro del shadow')!;
    expect(el).toBeDefined();
    const node = registry.resolve(el.id)!;
    expect(node.textContent).toBe('Dentro del shadow');
    expect(registry.idOf(node)).toBe(el.id);
    node.remove();
    expect(registry.resolve(el.id)).toBeUndefined();
  });

  it('limita la cantidad de elementos priorizando la región principal', () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/${i}">Enlace ${i}</a>`).join('');
    document.body.innerHTML = `<footer>${links}</footer><main><button>Importante</button></main>`;
    const { snapshot, notes } = extractSnapshot(document, { pageId: 'p', navigationId: 'n', revision: 0, maxElements: 5 });
    expect(snapshot.elements.length).toBeLessThanOrEqual(5);
    expect(snapshot.elements.some((e) => e.label === 'Importante')).toBe(true);
    expect(notes).toContain('truncated');
  });
});

describe('IDs estables', () => {
  it('conserva los IDs de nodos existentes dentro de la misma navegación', () => {
    document.body.innerHTML = '<a href="/a">Primero</a><a href="/b">Segundo</a>';
    const first = extractSnapshot(document, { pageId: 'p', navigationId: 'n1', revision: 0 });
    document.body.insertAdjacentHTML('afterbegin', '<button>Nuevo</button>');
    const second = extractSnapshot(document, { pageId: 'p', navigationId: 'n1', revision: 1, previous: first.registry });
    const ids = Object.fromEntries(second.snapshot.elements.map((e) => [e.label, e.id]));
    expect(ids).toEqual({ Nuevo: 'el-3', Primero: 'el-1', Segundo: 'el-2' });
    const other = extractSnapshot(document, { pageId: 'p', navigationId: 'n2', revision: 0, previous: second.registry });
    expect(other.snapshot.elements[0]!.id).toBe('el-1');
  });
});
