/**
 * UI básica de prueba (Gaston). Permite recorrer todos los flujos; la UI final
 * de Emi la reemplaza. Solo presenta el estado y envía comandos: toda la lógica
 * vive en el proceso principal.
 */
import { Button, LoadingMessage, Notice, TextField } from '@asistente/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState, OptionView } from '../../shared/ipc';
import { send, useAppState } from './useAppState';

export function App() {
  const state = useAppState();

  useEffect(() => {
    if (state) document.documentElement.style.setProperty('--text-scale', String(state.prefs.textScale));
  }, [state?.prefs.textScale]);

  if (!state) return <LoadingMessage>Abriendo…</LoadingMessage>;

  if (!state.nav.visible) {
    return (
      <>
        <Notices state={state} />
        <Home state={state} />
      </>
    );
  }

  return (
    <div
      className="browser"
      style={{ gridTemplateRows: `${state.layout.topBarHeight}px 1fr`, gridTemplateColumns: `${state.layout.panelWidth}px 1fr` }}
    >
      <TopBar state={state} />
      <aside className="panel" aria-label="Ayuda">
        <Notices state={state} />
        <PageStatus state={state} />
        {state.guideEnabled ? <GuidePanel state={state} /> : null}
      </aside>
      {/* La vista nativa del sitio ocupa esta área. */}
      <div aria-hidden="true" />
    </div>
  );
}

/* ---------------------------------- Inicio ---------------------------------- */

/**
 * Un solo input. Al enviar se espera un `redirect` (abre la página). Si llega
 * una pregunta u opciones, el input baja y la pantalla pasa a ser un chat.
 */
function Home({ state }: { state: AppState }) {
  const { chat } = state;
  const [text, setText] = useState('');
  const busy = chat.phase === 'interpreting';
  const isChat = chat.messages.some((m) => m.from === 'assistant');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy, isChat]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    send({ type: 'submitIntent', text });
    setText('');
  };

  return (
    <main className="home" data-mode={isChat ? 'chat' : 'search'}>
      {isChat ? (
        <ol className="messages" role="log" aria-live="polite" aria-label="Conversación">
          {chat.messages.map((m) => (
            <li key={m.id} className="message" data-from={m.from}>
              {m.text}
            </li>
          ))}
          {chat.phase === 'results'
            ? chat.candidates.map((c) => (
                <li key={c.id} className="message" data-from="assistant">
                  <button type="button" className="candidate" onClick={() => send({ type: 'openCandidate', candidateId: c.id })}>
                    {c.title} — {c.domain}
                  </button>
                  <p>{c.reason}</p>
                </li>
              ))
            : null}
          {busy ? (
            <li className="message" data-from="assistant" aria-busy="true">
              …
            </li>
          ) : null}
        </ol>
      ) : null}

      <form className="search" onSubmit={submit}>
        <input
          ref={inputRef}
          aria-label="¿Qué querés hacer?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {busy && !isChat ? '…' : 'Enviar'}
        </button>
      </form>
      {chat.phase === 'error' && chat.error ? <p role="alert">{chat.error}</p> : null}
    </main>
  );
}

function AddressForm({ label, initial = '' }: { label: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <form
      className="address"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) send({ type: 'navigate', input: value });
      }}
    >
      <TextField label={label} value={value} onChange={(e) => setValue(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} />
      <Button type="submit">Ir</Button>
    </form>
  );
}

/* ------------------------------- Navegación ------------------------------- */

function TopBar({ state }: { state: AppState }) {
  const { nav } = state;
  return (
    <nav className="topbar" aria-label="Navegación">
      <Button variant="primary" onClick={() => send({ type: 'home' })}>
        Inicio
      </Button>
      <Button onClick={() => send({ type: 'back' })} disabled={!nav.canGoBack}>
        Atrás
      </Button>
      <Button onClick={() => send({ type: 'forward' })} disabled={!nav.canGoForward}>
        Adelante
      </Button>
      <Button onClick={() => send({ type: 'reload' })}>{nav.loading ? 'Cargando…' : 'Recargar'}</Button>
      <div className="site-identity">
        <strong>{nav.domain || '—'}</strong>
        <span className={nav.secure ? 'secure' : 'insecure'}>{nav.secure ? 'Conexión segura' : 'Conexión NO segura'}</span>
      </div>
      <AddressForm label="Dirección" initial={nav.url} />
    </nav>
  );
}

function PageStatus({ state }: { state: AppState }) {
  const { nav, guide } = state;
  return (
    <>
      {nav.error ? (
        <Notice tone="error" urgent title="La página no cargó">
          <p>{nav.error}</p>
          <Button onClick={() => send({ type: 'reload' })}>Probar de nuevo</Button>
        </Notice>
      ) : null}
      {!nav.secure ? (
        <Notice tone="error" title="Conexión no segura">
          No escribas datos personales en esta página.
        </Notice>
      ) : null}
      {guide.partialPage && guide.phase !== 'idle' ? (
        <Notice tone="info">Parte de esta página no se puede analizar; algunas indicaciones pueden faltar.</Notice>
      ) : null}
    </>
  );
}

function Notices({ state }: { state: AppState }) {
  if (state.notices.length === 0) return null;
  const labels = { openHere: 'Abrir acá', openExternal: 'Abrir en mi navegador', dismiss: 'Cerrar aviso' } as const;
  return (
    <section className="notices" aria-label="Avisos">
      {state.notices.map((n) => (
        <Notice key={n.id} tone={n.tone} urgent={n.tone === 'error'}>
          <p>{n.text}</p>
          <div className="row">
            {n.actions.map((action) => (
              <Button key={action} onClick={() => send({ type: 'resolveNotice', noticeId: n.id, action })}>
                {labels[action]}
              </Button>
            ))}
          </div>
        </Notice>
      ))}
    </section>
  );
}

/* ---------------------------------- Guía ---------------------------------- */

function GuidePanel({ state }: { state: AppState }) {
  const { guide, prefs } = state;

  if (!prefs.aiEnabledForSite) {
    return (
      <section className="guide">
        <p>La ayuda está desactivada en este sitio. Podés usar la página normalmente.</p>
      </section>
    );
  }

  const active = guide.phase !== 'idle';
  return (
    <section className="guide" aria-labelledby="guide-title">
      <h2 id="guide-title">{guide.option ? guide.option.title : 'Ayuda en esta página'}</h2>
      {guide.goal ? <p className="goal">Tu objetivo: {guide.goal}</p> : null}
      <GuideBody state={state} />
      {active ? (
        <div className="controls" role="group" aria-label="Controles de la ayuda">
          <Button onClick={() => send({ type: 'repeat' })} disabled={guide.phase !== 'waitingForUser'}>
            Repetir
          </Button>
          <Button onClick={() => send({ type: 'stepBack' })} disabled={guide.phase === 'analyzing'}>
            Volver
          </Button>
          <Button onClick={() => send({ type: 'exitHelp' })}>Salir de la ayuda</Button>
        </div>
      ) : null}
    </section>
  );
}

function GuideBody({ state }: { state: AppState }) {
  const { guide } = state;

  switch (guide.phase) {
    case 'idle':
      return (
        <Button variant="primary" onClick={() => send({ type: 'analyzePage' })}>
          Ayudame en esta página
        </Button>
      );
    case 'analyzing':
      return <LoadingMessage>Estoy mirando la página…</LoadingMessage>;
    case 'guiding':
      return <LoadingMessage>Buscando el próximo paso…</LoadingMessage>;
    case 'verifying':
      return <LoadingMessage>Revisando lo que pasó…</LoadingMessage>;
    case 'choosing':
      return <OptionList primary={guide.primary} secondary={guide.secondary} />;
    case 'waitingForUser':
      return (
        <div className="step">
          <p className="step-count">Paso {guide.stepCount}</p>
          {/* key cambia con Repetir para que el lector de pantalla vuelva a anunciarlo. */}
          <div aria-live="assertive" key={guide.announceKey}>
            <p className="instruction">
              {guide.instruction}
            </p>
          </div>
          {guide.targetVisible === false ? <p>No veo el lugar en pantalla. Probá desplazarte por la página.</p> : null}
          <Button variant="primary" onClick={() => send({ type: 'confirmDone' })}>
            Ya lo hice
          </Button>
        </div>
      );
    case 'completed':
      return (
        <Notice tone="success" title="Listo">
          <p>{guide.message}</p>
          <div className="row">
            <Button onClick={() => send({ type: 'stepBack' })}>Elegir otra tarea</Button>
            <Button onClick={() => send({ type: 'exitHelp' })}>Terminar</Button>
          </div>
        </Notice>
      );
    case 'needsClarification':
      return (
        <div>
          <p className="instruction" aria-live="polite">
            {guide.message}
          </p>
          {guide.option ? (
            <Button variant="primary" onClick={() => send({ type: 'confirmDone' })}>
              Ya lo hice
            </Button>
          ) : (
            <OptionList primary={guide.primary} secondary={guide.secondary} />
          )}
        </div>
      );
    case 'unsupported':
      return (
        <Notice tone="info" title="No puedo ayudarte en esta página">
          <p>{guide.message}</p>
          <Button onClick={() => send({ type: 'openCurrentExternally' })}>Abrir en mi navegador</Button>
        </Notice>
      );
    case 'error':
      return (
        <Notice tone="error" urgent title="No pude continuar">
          <p>{guide.message}</p>
          <Button variant="primary" onClick={() => send({ type: 'retry' })}>
            Reintentar
          </Button>
        </Notice>
      );
    default:
      return null;
  }
}

function OptionList({ primary, secondary }: { primary: OptionView[]; secondary: OptionView[] }) {
  if (primary.length + secondary.length === 0) return null;
  return (
    <div className="options">
      <p>¿Qué querés hacer?</p>
      <ul>
        {primary.map((o) => (
          <OptionItem key={o.id} option={o} primary />
        ))}
      </ul>
      {secondary.length > 0 ? (
        <details>
          <summary>Más opciones</summary>
          <ul>
            {secondary.map((o) => (
              <OptionItem key={o.id} option={o} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function OptionItem({ option, primary = false }: { option: OptionView; primary?: boolean }) {
  return (
    <li className="option">
      <Button variant={primary ? 'primary' : 'secondary'} onClick={() => send({ type: 'selectOption', optionId: option.id })}>
        {option.title}
      </Button>
      {option.description ? <p className="option-description">{option.description}</p> : null}
    </li>
  );
}
