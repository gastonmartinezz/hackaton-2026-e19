/**
 * Inicio: un buscador, no un chat.
 * - 01: ícono, «¿Qué querés hacer hoy?», el buscador con «Hablar» y «Guíame».
 *   Si la búsqueda alcanza, el proceso principal abre el sitio directo.
 * - 02/03: si falta un dato, una pregunta por vez debajo del buscador.
 * - 10: con varios sitios (o «No sé bien»), el más afín y alternativas.
 * - «Hablar» (01, 02, 03, 10): dictar. Lo entendido queda en el buscador y se
 *   busca solo, como «Guíame».
 */
import { BrandIcon, Button, Icon, LoadingDots } from '@asistente/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppState, CandidateView } from '../../shared/ipc';
import { SpeakButton } from './speech/SpeakButton';
import { questionSpeech, recommendationSpeech, SPEECH_TEXTS } from './speech/speechText';
import { send } from './useAppState';
import { MicButton, VoiceMessages } from './voice/VoiceSearch';
import { useVoiceInput } from './voice/useVoiceInput';

/** Igual que el máximo de `submitIntent`. */
const MAX_QUERY = 500;

export function Home({ state }: { state: AppState }) {
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
  const voice = useVoiceInput((heard) => setText(heard.slice(0, MAX_QUERY)), {
    blocked: busy,
    // Dictado (decisión de producto): lo entendido queda visible en el buscador y se busca
    // solo, por el mismo camino que «Guíame» (con ayuda). Con una pregunta abierta, lo
    // dicho es la respuesta, igual que si lo escribiera en el buscador.
    onSubmit: (heard) => send({ type: 'submitIntent', text: heard.slice(0, MAX_QUERY).trim(), guide: true, dictated: true }),
  });
  const voiceBusy = voice.status.kind === 'transcribing';

  // Con pregunta o recomendación, el buscador conserva lo que la persona buscó.
  useEffect(() => setText(mode === 'search' ? '' : (chat.query ?? '')), [mode, chat.query]);
  useEffect(() => {
    if (!busy && mode === 'search') inputRef.current?.focus();
  }, [busy, mode]);
  // Cada vista tiene su dictado: al pasar de una a otra se deja de escuchar.
  const { cancel: cancelVoice } = voice;
  useEffect(() => cancelVoice(), [mode, cancelVoice]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || busy || voiceBusy || (mode !== 'search' && value === chat.query)) return;
    // Búsqueda escrita: el dictado anterior (y su aviso) ya no corresponde.
    voice.cancel();
    send({ type: 'submitIntent', text: value, guide: true });
  };

  return (
    <main className="home g-ground" data-mode={mode === 'search' ? 'search' : 'ask'}>
      {mode === 'search' ? (
        <>
          <BrandIcon className="home-icon" />
          <h1>¿Qué querés hacer hoy?</h1>
        </>
      ) : null}
      <form className="sbox" role="search" onSubmit={submit}>
        <Icon name="search" />
        <input
          ref={inputRef}
          aria-label="Qué querés hacer"
          placeholder="Escribilo con tus palabras"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_QUERY}
          readOnly={busy || voiceBusy}
          autoComplete="off"
        />
        {/* Voz apagada en el servidor: «Hablar» no se ofrece más en esta ejecución. */}
        {voice.available ? <MicButton status={voice.status} onToggle={voice.toggle} blocked={busy} /> : null}
      </form>
      {mode === 'search' ? (
        <Button variant="primary" icon="navigation" className="home-go" disabled={busy} onClick={() => submit()}>
          Guíame
        </Button>
      ) : null}
      <VoiceMessages status={voice.status} />
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
  );
}

/** 02/03: una pregunta por vez, respuestas grandes, el porqué y «No sé bien». */
function Question({ state }: { state: AppState }) {
  const { question, answered } = state.chat;
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => firstRef.current?.focus(), [question?.text]);
  if (!question) return null;
  const answer = (text: string) => send({ type: 'submitIntent', text });

  return (
    <section className="ask-card" aria-labelledby="ask-q">
      <div className="ask-top">
        <Answered answered={answered} />
        {/* Cada respuesta de Guíame es contenido nuevo para el modo voz, aunque repita la pregunta. */}
        <SpeakButton text={questionSpeech(question)} auto={state.voice.active} contentKey={state.chat.messages.length} />
      </div>
      <h2 id="ask-q" aria-live="polite">
        {question.text}
      </h2>
      {question.reason ? <p className="ask-sub">{question.reason}</p> : null}
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
          <button type="button" className="unsure" ref={question.answers.length === 0 ? firstRef : undefined} onClick={() => answer(SPEECH_TEXTS.unsure)}>
            <Icon name="circle-help" />
            {SPEECH_TEXTS.unsure}
          </button>
        </li>
      </ul>
    </section>
  );
}

/** Píldoras con lo que la persona ya contestó («No sé bien» incluido). */
function Answered({ answered }: { answered: string[] }) {
  if (answered.length === 0) return null;
  return (
    <ul className="ask-done" aria-label="Lo que ya me contaste">
      {answered.map((a, i) => (
        <li key={`${i}-${a}`}>
          <Icon name="check" size="sm" />
          {a}
        </li>
      ))}
    </ul>
  );
}

/** 10/C04: el sitio más afín con «Ir con ayuda» o «Solo abrir el sitio», y alternativas. */
function Recommendation({ state }: { state: AppState }) {
  const { candidates, answered, messages } = state.chat;
  const [first, ...others] = candidates;
  if (!first) return null;
  const open = (candidate: CandidateView, guide: boolean) => send({ type: 'openCandidate', candidateId: candidate.id, guide });

  // TODO(contrato): sello «Sitio oficial» o «La tienda que elegiste» cuando el backend lo mande. Nunca por HTTPS.
  return (
    <section className="ask-card" aria-labelledby="reco-title">
      <div className="ask-top">
        <Answered answered={answered} />
        <SpeakButton text={recommendationSpeech(SPEECH_TEXTS.recommendTitle, first)} auto={state.voice.active} contentKey={messages.length} />
      </div>
      <h2 id="reco-title" aria-live="polite">
        {SPEECH_TEXTS.recommendTitle}
      </h2>
      <div className="site-line">
        <h3 className="site-name">{first.title}</h3>
        <span className="site-domain">{first.domain}</span>
      </div>
      <p className="site-reason">{first.reason}</p>
      <div className="site-actions">
        <Button variant="primary" icon="navigation" onClick={() => open(first, true)}>
          Ir con ayuda
        </Button>
        <Button variant="link" onClick={() => open(first, false)}>
          Solo abrir el sitio
        </Button>
      </div>
      {others.length > 0 ? (
        <div className="reco-others">
          <h3>Otras opciones</h3>
          <ul>
            {others.map((c) => (
              <li key={c.id} className="other-site">
                <div>
                  <h4 className="site-name">{c.title}</h4>
                  <span className="site-domain">{c.domain}</span>
                  <span className="site-reason">{c.reason}</span>
                </div>
                <Button variant="secondary" onClick={() => open(c, true)}>
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
