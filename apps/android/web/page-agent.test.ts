import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// CLAUDE.md §3: el valor de un campo nunca sale del cliente. Acá «salir» es
// cruzar el puente hacia Kotlin, que después lo manda a la API.
const sent: string[] = [];

beforeAll(async () => {
  window.GuiameAndroid = { postMessage: (json) => sent.push(json) };
  await import('./page-agent');
});

beforeEach(() => {
  sent.length = 0;
});

type Agent = (channel: string, json: string) => void;
const agent = () => (window as unknown as { __guiameAgent: Agent }).__guiameAgent;

function extract(): { channel: string; payload: { html: string } } {
  agent()('page:extract', JSON.stringify({ requestId: 'r1', pageId: 'p1', navigationId: 'n1', revision: 1 }));
  const message = sent.map((json) => JSON.parse(json)).find((m) => m.channel === 'page:snapshot');
  expect(message).toBeDefined();
  return message;
}

describe('agente de página de Android', () => {
  it('no manda por el puente lo que la persona escribió en los campos', () => {
    document.body.innerHTML = `
      <form>
        <label>Nombre <input id="n"></label>
        <label>Contraseña <input id="p" type="password"></label>
        <label>Tarjeta <input id="c" autocomplete="cc-number"></label>
        <button>Continuar</button>
      </form>`;
    (document.querySelector('#n') as HTMLInputElement).value = 'Marta Gómez';
    (document.querySelector('#p') as HTMLInputElement).value = 'clave-secreta-123';
    (document.querySelector('#c') as HTMLInputElement).value = '4111111111111111';

    const message = extract();
    expect(message.payload.html).toContain('Continuar');
    const everything = sent.join('\n');
    for (const secret of ['Marta Gómez', 'clave-secreta-123', '4111111111111111']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('la página no puede reemplazar el receptor de comandos', () => {
    const before = agent();
    expect(() => {
      (window as unknown as { __guiameAgent: unknown }).__guiameAgent = () => {};
    }).toThrow();
    expect(agent()).toBe(before);
  });

  it('ignora comandos desconocidos o mal formados', () => {
    agent()('page:nada', '{}');
    agent()('page:extract', 'no es json');
    agent()('page:extract', JSON.stringify({ requestId: 'r1' }));
    expect(sent.filter((json) => JSON.parse(json).channel === 'page:snapshot')).toHaveLength(0);
  });
});
