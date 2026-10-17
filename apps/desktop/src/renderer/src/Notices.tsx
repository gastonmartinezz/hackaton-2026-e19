import { Button } from '@asistente/ui';
import type { AppState } from '../../shared/ipc';
import { send } from './useAppState';

const LABELS = { openHere: 'Abrir acá', openExternal: 'Abrir en mi navegador', dismiss: 'Cerrar aviso' } as const;

/** Avisos de la app: ventanas nuevas, permisos, descargas y direcciones bloqueadas. */
export function Notices({ state }: { state: AppState }) {
  if (state.notices.length === 0) return null;
  return (
    <section className="notices" aria-label="Avisos">
      {state.notices.map((n) => (
        <div key={n.id} className="notice" data-tone={n.tone} role={n.tone === 'error' ? 'alert' : undefined}>
          <p>{n.text}</p>
          <div className="row">
            {n.actions.map((action) => (
              <Button key={action} variant="quiet" onClick={() => send({ type: 'resolveNotice', noticeId: n.id, action })}>
                {LABELS[action]}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
