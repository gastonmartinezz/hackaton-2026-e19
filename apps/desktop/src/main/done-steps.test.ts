import { describe, expect, it } from 'vitest';
import { pastTense } from './done-steps';

describe('pastTense', () => {
  it('pasa a pasado los imperativos de voseo', () => {
    expect(pastTense('Hacé clic en el botón «Sacar turno».')).toBe('Hiciste clic en el botón «Sacar turno»');
    expect(pastTense('Elegí una oficina en la lista «Oficina».')).toBe('Elegiste una oficina en la lista «Oficina»');
    expect(pastTense('Completá «Nombre y apellido».')).toBe('Completaste «Nombre y apellido»');
    expect(pastTense('Escribí tu número de cédula.')).toBe('Escribiste tu número de cédula');
    expect(pastTense('Desplazate hasta abajo.')).toBe('Te desplazaste hasta abajo');
  });

  it('sin un verbo conocido deja el texto como vino', () => {
    expect(pastTense('El botón «Continuar».')).toBe('El botón «Continuar»');
  });
});
