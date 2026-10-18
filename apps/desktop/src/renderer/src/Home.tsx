/**
 * Inicio: un buscador, no un chat.
 * - 01: buscador con «Solo ir al sitio» y «Mostrame cómo». Si la búsqueda
 *   alcanza, el proceso principal abre el sitio directo.
 * - 02/03: si falta un dato, una pregunta por vez debajo del buscador.
 * - 10: con varios sitios (o «No estoy seguro»), el más afín y alternativas.
 * - Micrófono (01): dictar la búsqueda. El texto vuelve al buscador para que
 *   la persona lo revise; nunca se envía solo.
 */
import { BrandSymbol, Button, Icon, LoadingDots, Logo } from '@asistente/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState, CandidateView } from '../../shared/ipc';
import { SpeakButton } from './speech/SpeakButton';
import { questionSpeech, recommendationSpeech } from './speech/speechText';
import { send } from './useAppState';
import { MicButton, VoiceMessages } from './voice/VoiceSearch';
import { useVoiceInput } from './voice/useVoiceInput';

/** Igual que el máximo de `submitIntent`. */
const MAX_QUERY = 500;

const UNSURE = 'No estoy seguro';

export function Home({ state, onEditProfile }: { state: AppState; onEditProfile: () => void }) {
  const { chat } = state;
  const busy = chat.phase === 'interpreting';
  // Mientras responde, la pantalla no salta al buscador vacío: queda como estaba.
  const lastMode = useRef<'search' | 'ask' | 'reco'>('search');
  const mode = chat.phase === 'clarifying' ? 'ask' : chat.phase === 'results' ? 'reco' : busy || (chat.phase === 'error' && chat.query) ? lastMode.current : 'search';
  lastMode.current = mode;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // El texto dictado reemplaza lo escrito; el foco queda donde estaba. Con una
  // búsqueda en curso no se puede escuchar y se corta lo que hubiera.
  const voice = useVoiceInput((heard) => setText(heard.slice(0, MAX_QUERY)), { blocked: busy });
  const voiceBusy = voice.status.kind === 'transcribing';

  // Con pregunta o recomendación, el buscador conserva lo que la persona buscó.
  useEffect(() => setText(mode === 'search' ? '' : (chat.query ?? '')), [mode, chat.query]);
  useEffect(() => {
    if (!busy && mode === 'search') inputRef.current?.focus();
  }, [busy, mode]);
  // El micrófono es del buscador de inicio: fuera de 01 se deja de escuchar.
  const { cancel: cancelVoice } = voice;
  useEffect(() => {
    if (mode !== 'search') cancelVoice();
  }, [mode, cancelVoice]);

  const submit = (guide: boolean, event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || busy || voiceBusy || (mode !== 'search' && value === chat.query)) return;
    cancelVoice();
    send({ type: 'submitIntent', text: value, guide });
  };

  return (
    <>
      <main className="search-home" data-mode={mode === 'search' ? 'search' : 'ask'}>
        <Logo className="wordmark" />
        {mode === 'search' ? <p className="tag">Te muestro. Lo hacés vos.</p> : null}
        <form className="sbox" role="search" onSubmit={(e) => submit(true, e)}>
          <Icon name="search" />
          <input
            ref={inputRef}
            aria-label="Buscá un sitio o contá qué querés hacer"
            placeholder="Buscá un sitio o contá qué querés hacer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_QUERY}
            readOnly={busy || voiceBusy}
            autoComplete="off"
          />
          {/* Voz apagada en el servidor: el micrófono no se ofrece más en esta ejecución. */}
          {mode === 'search' && voice.available ? <MicButton status={voice.status} onToggle={voice.toggle} blocked={busy} /> : null}
          {mode === 'reco' ? (
            <Button variant="primary" icon="sparkles" type="submit" className="go">
              Mostrame cómo
            </Button>
          ) : null}
        </form>
        {mode === 'search' ? (
          <div className="sbtns">
            <Button variant="quiet" disabled={busy} onClick={() => submit(false)}>
              Solo ir al sitio
            </Button>
            <Button variant="primary" icon="sparkles" disabled={busy} onClick={() => submit(true)}>
              Mostrame cómo
            </Button>
          </div>
        ) : null}
        {mode === 'search' ? <VoiceMessages status={voice.status} /> : null}
        {busy ? (
          <p className="home-status" role="status">
            <LoadingDots />
            Estoy buscando dónde se hace…
          </p>
        ) : null}
        {mode === 'ask' && chat.question && !busy ? <Question state={state} /> : null}
        {mode === 'reco' && !busy ? <Recommendation state={state} /> : null}
        {chat.phase === 'error' && chat.error ? (
          <div className="home-error" role="alert">
            <Icon name="triangle-alert" />
            <p>{chat.error}</p>
          </div>
        ) : null}
      </main>
      <footer className="sfoot">
        <button type="button" className="linkish where-am-i" onClick={onEditProfile}>
          {placeName(state)}
        </button>
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

/** 02/03: una pregunta por vez, respuestas grandes, el porqué y «No estoy seguro». */
function Question({ state }: { state: AppState }) {
  const { question, answered } = state.chat;
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => firstRef.current?.focus(), [question?.text]);
  if (!question) return null;
  const answer = (text: string) => send({ type: 'submitIntent', text });

  return (
    <section className="ask-card" aria-labelledby="ask-q">
      <div className="speak-row">
        <p className="lead2">
          <BrandSymbol />
          Para llevarte directo al sitio justo, necesito un dato.
        </p>
        <SpeakButton text={questionSpeech(question)} />
      </div>
      {answered.length > 0 ? (
        <ul className="ask-done" aria-label="Lo que ya me contaste">
          {answered.map((a, i) => (
            <li key={`${i}-${a}`}>
              <Icon name="check" size="sm" />
              {a}
            </li>
          ))}
        </ul>
      ) : null}
      <h2 id="ask-q" aria-live="polite">
        {question.text}
      </h2>
      <ul className="ask-opts" aria-label="Elegí una respuesta">
        {question.answers.map((a, i) => (
          <li key={a}>
            <button type="button" ref={i === 0 ? firstRef : undefined} onClick={() => answer(a)}>
              <Icon name="arrow-right" />
              {a}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="unsure" ref={question.answers.length === 0 ? firstRef : undefined} onClick={() => answer(UNSURE)}>
            <Icon name="circle-help" />
            No estoy seguro
          </button>
        </li>
      </ul>
      <div className="ask-foot">
        {question.reason ? (
          <p className="why">
            <Icon name="circle-help" size="sm" />
            <span>{question.reason}</span>
          </p>
        ) : null}
        <span className="muted">¿Otra respuesta? Escribila en el buscador.</span>
      </div>
    </section>
  );
}

/** 10/C04: el sitio más afín con «Ir con ayuda» o «Solo abrir el sitio», y alternativas. */
function Recommendation({ state }: { state: AppState }) {
  const { candidates, unsure, messages } = state.chat;
  const [first, ...others] = candidates;
  const intro = unsure
    ? 'No pasa nada si no estás seguro. Por lo que buscaste, este es el sitio que mejor se ajusta. Si no es, contame un poco más en el buscador.'
    : (messages.findLast((m) => m.from === 'assistant')?.text ?? '');
  if (!first) return null;

  return (
    <div className="reco-main">
      <div className="speak-row">
        <p className="reco-why" aria-live="polite">
          <BrandSymbol />
          <span>{intro}</span>
        </p>
        <SpeakButton text={recommendationSpeech(intro, first)} />
      </div>
      <SiteCard candidate={first} recommended />
      {others.length > 0 ? (
        <>
          <h3 className="section-title">Otras opciones</h3>
          <ul className="others">
            {others.map((c) => (
              <li key={c.id}>
                <SiteCard candidate={c} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="why">
        <Icon name="search" size="sm" />
        <span>¿No es esto? Contame un poco más en el buscador y te llevo directo.</span>
      </p>
    </div>
  );
}

function SiteCard({ candidate: c, recommended = false }: { candidate: CandidateView; recommended?: boolean }) {
  const open = (guide: boolean) => send({ type: 'openCandidate', candidateId: c.id, guide });
  const Title = recommended ? 'h2' : 'h4';
  // Sin el campo `official` del backend no se muestra el sello «Sitio oficial» (CLAUDE.md §4).
  return (
    <article className={recommended ? 'site-card recommended' : 'site-card compact'} aria-label={recommended ? 'Sitio recomendado' : undefined}>
      <Title className="name">{c.title}</Title>
      <div className="domain">
        <span className="k">Dirección:</span>
        {c.secure ? <Icon name="lock" size="sm" /> : null}
        <b>{c.domain}</b>
      </div>
      <p className="reason">
        {recommended ? <span className="k">Por qué te lo recomiendo: </span> : null}
        {c.reason}
      </p>
      <div className="site-actions">
        {recommended ? (
          <>
            <Button variant="primary" icon="sparkles" onClick={() => open(true)}>
              Ir con ayuda
            </Button>
            <Button variant="secondary" onClick={() => open(false)}>
              Solo abrir el sitio
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => open(true)}>
            Abrir
          </Button>
        )}
      </div>
    </article>
  );
}

/** País (y ciudad) de «Mis datos»; abre la pantalla para cambiarlos. */
function placeName({ profile }: AppState): string {
  const country = profile.country ? new Intl.DisplayNames(['es'], { type: 'region' }).of(profile.country) : null;
  const place = [profile.city, country].filter(Boolean).join(', ');
  return place ? `${place} · Mis datos` : 'Mis datos';
}
