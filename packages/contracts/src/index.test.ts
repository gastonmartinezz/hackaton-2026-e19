import { describe, expect, it } from 'vitest';
import { GuideDecisionSchema, PageSnapshotSchema } from './index';

describe('GuideDecision', () => {
  it('acepta el ejemplo de la especificación', () => {
    const ok = GuideDecisionSchema.safeParse({
      schemaVersion: '1',
      requestId: 'req-8',
      navigationId: 'nav-3',
      revision: 7,
      status: 'guide',
      instruction: 'Hacé clic acá para consultar los horarios.',
      targetElementId: 'el-12',
      presentation: 'scrollAndHighlight',
      expectedSignal: 'pageChange',
    });
    expect(ok.success).toBe(true);
  });

  it('rechaza acciones fuera del contrato y campos extra', () => {
    const base = { schemaVersion: '1', requestId: 'r', navigationId: 'n', revision: 0 };
    expect(GuideDecisionSchema.safeParse({ ...base, status: 'click', targetElementId: 'el-1' }).success).toBe(false);
    expect(
      GuideDecisionSchema.safeParse({
        ...base,
        status: 'guide',
        instruction: 'x',
        targetElementId: 'el-1',
        presentation: 'highlight',
        expectedSignal: 'interaction',
        script: 'alert(1)',
      }).success,
    ).toBe(false);
    expect(
      GuideDecisionSchema.safeParse({ ...base, status: 'completed', message: 'ok', targetElementId: 'el-1' }).success,
    ).toBe(false);
  });
});

describe('PageSnapshot', () => {
  it('solo admite origen, sin path ni query', () => {
    const snap = {
      schemaVersion: '1',
      pageId: 'p',
      navigationId: 'n',
      revision: 0,
      extraction: 'complete',
      elements: [],
    };
    expect(PageSnapshotSchema.safeParse({ ...snap, origin: 'https://ejemplo.gob.ar' }).success).toBe(true);
    expect(PageSnapshotSchema.safeParse({ ...snap, origin: 'https://ejemplo.gob.ar/turnos?dni=1' }).success).toBe(false);
  });
});
