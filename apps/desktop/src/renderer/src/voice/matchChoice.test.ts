import { describe, expect, it } from 'vitest';
import { matchChoice, normalizeSpoken, type ChoiceSpec } from './matchChoice';

const page: ChoiceSpec[] = [
  { label: 'Completar: Pedir turno' },
  { label: 'Ir a «Confirmar turno»' },
  { label: 'Buscar en este sitio' },
  { label: 'Ver otras opciones', kind: 'more' },
];
const question: ChoiceSpec[] = [{ label: 'Cédula de identidad' }, { label: 'Pasaporte' }, { label: 'No estoy seguro', kind: 'unsure' }];
const reco: ChoiceSpec[] = [
  { label: 'Ir con ayuda', aliases: ['Agenda de Identificación Civil'] },
  { label: 'Solo abrir el sitio' },
  { label: 'Ministerio del Interior' },
];

const index = (said: string, choices: ChoiceSpec[]) => {
  const result = matchChoice(said, choices);
  return result.kind === 'match' ? result.index : result.kind;
};

describe('matchChoice', () => {
  it('normaliza: minúsculas, sin tildes ni signos', () => {
    expect(normalizeSpoken('¡La Cédula, por favor!')).toBe('la cedula por favor');
  });

  it('ordinales y números: «la primera», «la 2», «opción dos», «la última»', () => {
    expect(index('la primera', page)).toBe(0);
    expect(index('La 2.', page)).toBe(1);
    expect(index('opción dos', page)).toBe(1);
    expect(index('la tercera por favor', page)).toBe(2);
    // En el orden en que se leyeron: «la última» y «la cuarta» son «Ver otras opciones».
    expect(index('la última', page)).toBe(3);
    expect(index('la cuarta', page)).toBe(3);
    expect(index('la quinta', page)).toBe('none');
  });

  it('dos respuestas más «No estoy seguro»: «la tercera» y «la última» eligen «No estoy seguro»', () => {
    expect(index('la tercera', question)).toBe(2);
    expect(index('la última', question)).toBe(2);
    expect(index('la segunda', question)).toBe(1);
  });

  it('una opción que no se leyó (unnumbered) no cuenta para los números, pero se elige por su nombre', () => {
    const notRead: ChoiceSpec[] = [{ label: 'Buscar' }, { label: 'Horarios' }, { label: 'Ver otras opciones', kind: 'more', unnumbered: true }];
    expect(index('la última', notRead)).toBe(1);
    expect(index('la tercera', notRead)).toBe('none');
    expect(index('ver otras', notRead)).toBe(2);
  });

  it('«otras» / «ver otras» → «Ver otras opciones»', () => {
    expect(index('ver otras', page)).toBe(3);
    expect(index('quiero otras opciones', page)).toBe(3);
  });

  it('«no sé» / «no estoy seguro» → «No estoy seguro»', () => {
    expect(index('no sé', question)).toBe(2);
    expect(index('No estoy segura.', question)).toBe(2);
  });

  it('palabras en común con el título', () => {
    expect(index('pasaporte', question)).toBe(1);
    expect(index('quiero la cédula', question)).toBe(0);
    expect(index('confirmar el turno', page)).toBe(1);
    expect(index('buscar', page)).toBe(2);
  });

  it('recomendación: las dos acciones, el título del sitio y las alternativas', () => {
    expect(index('ir con ayuda', reco)).toBe(0);
    expect(index('solo abrir el sitio', reco)).toBe(1);
    expect(index('la agenda de identificación', reco)).toBe(0);
    expect(index('el ministerio', reco)).toBe(2);
  });

  it('empate: dos opciones igual de probables', () => {
    // «turno» está en las dos primeras con la misma proporción.
    expect(matchChoice('turno', [{ label: 'Pedir turno' }, { label: 'Cancelar turno' }])).toEqual({ kind: 'tie' });
  });

  it('nada claro: none', () => {
    expect(matchChoice('mañana llueve', page)).toEqual({ kind: 'none' });
    expect(matchChoice('', page)).toEqual({ kind: 'none' });
    expect(matchChoice('eh', page)).toEqual({ kind: 'none' });
  });
});
