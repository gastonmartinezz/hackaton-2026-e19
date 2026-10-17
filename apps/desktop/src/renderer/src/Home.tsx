/**
 * Inicio (01): un buscador, no un chat. Si la búsqueda alcanza, el proceso
 * principal abre el sitio directo.
 */
import { BrandSymbol, Button, Icon, LoadingDots, Logo } from '@asistente/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState } from '../../shared/ipc';
import { send } from './useAppState';

export function Home({ state }: { state: AppState }) {
  const { chat } = state;
  const [text, setText] = useState('');
  const busy = chat.phase === 'interpreting';
  const inputRef = useRef<HTMLInputElement>(null);
  const reply = chat.messages.findLast((m) => m.from === 'assistant');

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    send({ type: 'submitIntent', text });
    setText('');
  };

  return (
    <>
    <main className="search-home" data-mode={reply ? 'ask' : 'search'}>
      <Logo className="wordmark" />
      {reply ? null : <p className="tag">Te muestro. Lo hacés vos.</p>}
      <form className="sbox" role="search" onSubmit={submit}>
        <Icon name="search" />
        <input
          ref={inputRef}
          aria-label="Buscá un sitio o contá qué querés hacer"
          placeholder="Buscá un sitio o contá qué querés hacer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          disabled={busy}
          autoComplete="off"
        />
      </form>
      {reply ? null : (
        <div className="sbtns">
          <Button variant="primary" icon="sparkles" disabled={busy || !text.trim()} onClick={() => submit()}>
            Mostrame cómo
          </Button>
        </div>
      )}
      {busy ? (
        <p className="home-status" role="status">
          <LoadingDots />
          Estoy buscando dónde se hace…
        </p>
      ) : null}
      {reply && !busy ? (
        <section className="ask-card" aria-live="polite">
          <p className="lead2">
            <BrandSymbol />
            {reply.text}
          </p>
          {chat.phase === 'results' ? (
            <ul className="others">
              {chat.candidates.map((c) => (
                <li key={c.id} className="site-card compact">
                  <h3 className="name">{c.title}</h3>
                  <div className="domain">
                    <span className="k">Dirección:</span>
                    <b>{c.domain}</b>
                  </div>
                  <p className="reason">{c.reason}</p>
                  <div className="site-actions">
                    <Button variant="secondary" onClick={() => send({ type: 'openCandidate', candidateId: c.id })}>
                      Abrir
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {chat.phase === 'error' && chat.error ? (
        <div className="home-error" role="alert">
          <Icon name="triangle-alert" />
          <p>{chat.error}</p>
        </div>
      ) : null}
    </main>
    <footer className="sfoot">
      <span>Uruguay</span>
      <span className="priv">
        <Icon name="lock" />
        Nunca te voy a pedir contraseñas, números de documento ni datos de tu tarjeta.
      </span>
      {/* TODO(diseño): «Cómo funciona» no tiene pantalla todavía. */}
      <span>Cómo funciona</span>
    </footer>
    </>
  );
}
