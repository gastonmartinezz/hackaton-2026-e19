import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanTask, forgetHost, MAX_SHOWN_SITES, MAX_STORED_SITES, MAX_TASK_LENGTH, recordVisit, topSites, type FrequentSite } from './frequent-sites';
import { PrefsStore } from './prefs';

const site = (origin: string, visits: number, lastVisit = 0): FrequentSite => ({ origin, visits, lastVisit });

describe('Sitios frecuentes', () => {
  it('cada entrada suma una visita y actualiza la última', () => {
    let sites = recordVisit([], 'https://agenda.ejemplo.gub.uy', 1);
    sites = recordVisit(sites, 'https://agenda.ejemplo.gub.uy', 2);
    expect(sites).toEqual([site('https://agenda.ejemplo.gub.uy', 2, 2)]);
  });

  it('ofrece primero los más visitados y, si empatan, el más reciente', () => {
    const sites = [
      site('https://a.ejemplo.com.uy', 1, 9),
      site('https://b.ejemplo.com.uy', 5, 1),
      site('https://c.ejemplo.com.uy', 3, 2),
      site('https://d.ejemplo.com.uy', 3, 8),
      site('https://e.ejemplo.com.uy', 2, 1),
    ];
    expect(topSites(sites).map((s) => s.origin)).toEqual(['https://b.ejemplo.com.uy', 'https://d.ejemplo.com.uy', 'https://c.ejemplo.com.uy']);
    expect(topSites(sites)).toHaveLength(MAX_SHOWN_SITES);
  });

  it('al pasarse del máximo olvida el menos usado, nunca el que se acaba de abrir', () => {
    const sites = Array.from({ length: MAX_STORED_SITES }, (_, i) => site(`https://s${i}.ejemplo.com.uy`, i + 2, i));
    const next = recordVisit(sites, 'https://nuevo.ejemplo.com.uy', 100);
    expect(next).toHaveLength(MAX_STORED_SITES);
    expect(next.map((s) => s.origin)).toContain('https://nuevo.ejemplo.com.uy');
    expect(next.map((s) => s.origin)).not.toContain('https://s0.ejemplo.com.uy');
  });

  it('guarda la tarea hecha con ayuda y la conserva en las visitas sin tarea', () => {
    let sites = recordVisit([], 'https://agenda.ejemplo.gub.uy', 1, 'renovar la cédula');
    expect(sites[0]!.task).toBe('Renovar la cédula');
    sites = recordVisit(sites, 'https://agenda.ejemplo.gub.uy', 2);
    expect(sites[0]).toMatchObject({ visits: 2, task: 'Renovar la cédula' });
    sites = recordVisit(sites, 'https://agenda.ejemplo.gub.uy', 3, 'Cambiar mi turno');
    expect(sites[0]!.task).toBe('Cambiar mi turno');
    // Sin tarea nunca se agrega el campo.
    expect(recordVisit([], 'https://b.ejemplo.com.uy', 1, '  ')[0]).not.toHaveProperty('task');
  });

  it('la tarea queda en una línea y recortada', () => {
    expect(cleanTask('  pagar\n la   tarjeta ')).toBe('Pagar la tarjeta');
    expect(cleanTask(null)).toBeNull();
    const long = cleanTask('a'.repeat(200))!;
    expect(long).toHaveLength(MAX_TASK_LENGTH);
    expect(long.endsWith('…')).toBe(true);
  });

  it('olvida un host con cualquier puerto o protocolo', () => {
    const sites = [site('https://tiendamac-ofertas.ejemplo.shop', 4), site('http://tiendamac-ofertas.ejemplo.shop:8080', 1), site('https://tiendamac.ejemplo.com.uy', 2)];
    expect(forgetHost(sites, 'tiendamac-ofertas.ejemplo.shop')).toEqual([site('https://tiendamac.ejemplo.com.uy', 2)]);
  });
});

describe('Sitios frecuentes · privacidad', () => {
  it('las preferencias solo aceptan orígenes: una dirección con ruta o búsqueda no se guarda', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prefs-'));
    const file = join(dir, 'preferences.json');
    const withPath = { version: 1, textScale: 1.45, frequentSites: [site('https://agenda.ejemplo.gub.uy/turno?cedula=12345678', 3)] };
    await writeFile(file, JSON.stringify(withPath));
    const store = new PrefsStore(dir);
    // La lista dañada se descarta sin perder el resto de las preferencias.
    expect(await store.load()).toMatchObject({ textScale: 1.45, frequentSites: [] });

    await store.update((current) => ({ frequentSites: recordVisit(current.frequentSites, 'https://agenda.ejemplo.gub.uy', 1) }));
    const saved = await readFile(file, 'utf8');
    expect(JSON.parse(saved).frequentSites).toEqual([site('https://agenda.ejemplo.gub.uy', 1, 1)]);
    expect(saved).not.toContain('12345678');
    await rm(dir, { recursive: true });
  });
});
