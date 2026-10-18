/**
 * Tarjeta flotante de ayuda (pantallas 04 a 21). Vive en su propia vista sobre
 * el sitio (main/help-card.ts): mide lo que dibuja y lo informa con
 * `cardLayout` para que el proceso principal la ubique sin tapar el control.
 */
import { BrandSymbol, Button, Icon, LoadingDots } from '@asistente/ui';
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AppState, CardMode, OptionView } from '../../shared/ipc';
import { Notices } from './Notices';
import { SpeakButton } from './speech/SpeakButton';
import { guideSpeech, optionsReadKey, optionsSpeech, stepSpeechKey } from './speech/speechText';
import { VoiceAnswer, type VoiceChoice } from './voice/VoiceAnswer';
import { send, useAppState } from './useAppState';

/** Margen transparente de la vista para la sombra (CARD_SHADOW en main/help-card.ts). */
const SHADOW = 16;

export function HelpCard() {
  const state = useAppState();
  const [minimized, setMinimized] = useState(false);
  /** Instrucción para la que la persona abrió la tarjeta aunque tapara el control. */
  const [expandedFor, setExpandedFor] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  /** Cuántas veces se volvió de «Ver otras opciones»: cada vuelta es una aparición nueva para el modo voz. */
  const [optionsVisit, setOptionsVisit] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);

  const mode: CardMode = state ? cardMode(state, minimized, expandedFor) : 'none';

  // Informa el alto real para que la vista mida lo mismo que la tarjeta.
  useLayoutEffect(() => {
    const host = hostRef.current;
    let last = '';
    const report = () => {
      const height = host ? Math.max(0, Math.ceil(host.getBoundingClientRect().height) - SHADOW * 2) : 0;
      const key = `${mode}:${height}`;
      if (key === last) return;
      last = key;
      send({ type: 'cardLayout', mode, height: mode === 'none' ? 0 : height });
    };
    report();
    if (!host) return;
    const observer = new ResizeObserver(report);
    observer.observe(host);
    return () => observer.disconnect();
  }, [mode]);

  if (!state || mode === 'none') return null;
  const { guide } = state;

  if (mode === 'toast') {
    return (
      <div className="card-host" ref={hostRef}>
        <div className="mm-toast" role="status">
          <Icon name="log-out" />
          <span className="txt">Saliste de la ayuda. La página sigue igual.</span>
          <Button variant="secondary" icon="sparkles" onClick={() => send({ type: 'analyzePage' })}>
            Volver a la ayuda
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'pill') {
    return (
      <div className="card-host" ref={hostRef}>
        <div className="mm-pill" role="region" aria-label="Ayuda de Mostrame, achicada">
          <BrandSymbol />
          <span className="txt">
            <b>Ahora:</b> {guide.instruction}
          </span>
          <Button
            variant="primary"
            icon="chevron-up"
            onClick={() => {
              setMinimized(false);
              setExpandedFor(guide.announceKey);
            }}
          >
            Abrir
          </Button>
        </div>
      </div>
    );
  }

  const body = cardBody(state, {
    more,
    setMore: (value) => {
      if (more && !value) setOptionsVisit((n) => n + 1);
      setMore(value);
    },
    optionsVisit,
  });
  return (
    <div className="card-host" ref={hostRef}>
      <aside
        className={`mm-card ${body.tone ? `tone-${body.tone}` : ''}`}
        aria-label="Ayuda de Mostrame"
        style={{ maxHeight: state.layout.card.maxHeight || undefined }}
      >
        <div className="mm-card-head">
          <span className="who">
            <BrandSymbol />
            Mostrame
          </span>
          <span className="spacer" />
          {guide.phase === 'waitingForUser' ? (
            <Button variant="quiet" icon="minus" onClick={() => setMinimized(true)}>
              Achicar
            </Button>
          ) : null}
        </div>
        {guide.goal && guide.phase !== 'idle' ? (
          <p className="mm-goal">
            Tu objetivo: <b>{guide.goal}</b>
          </p>
        ) : null}
        <div className="mm-card-body">
          <Notices state={state} />
          <PageProblems state={state} />
          {body.content}
        </div>
        {body.foot === 'none' ? null : (
          <nav className="mm-card-foot" aria-label="Controles de la ayuda">
            {body.foot === 'full' ? (
              <>
                <Button icon="rotate-ccw" disabled={guide.phase !== 'waitingForUser'} onClick={() => send({ type: 'repeat' })}>
                  Repetir
                </Button>
                <Button icon="arrow-left" onClick={() => send({ type: 'stepBack' })}>
                  Volver un paso
                </Button>
              </>
            ) : null}
            <Button icon="log-out" onClick={() => send({ type: 'exitHelp' })}>
              Salir de la ayuda
            </Button>
          </nav>
        )}
      </aside>
    </div>
  );
}

function cardMode(state: AppState, minimized: boolean, expandedFor: number | null): CardMode {
  const { nav, guide, prefs, notices } = state;
  if (!nav.visible) return 'none';
  if (guide.phase === 'idle') {
    if (notices.length > 0 || nav.error || !nav.secure) return 'card';
    return guide.exited ? 'toast' : 'none';
  }
  if (!prefs.aiEnabledForSite) return 'none';
  if (guide.phase === 'waitingForUser') {
    const forced = state.layout.card.placement === 'compact' && expandedFor !== guide.announceKey;
    if (minimized || forced) return 'pill';
  }
  return 'card';
}

interface Body {
  content: ReactNode;
  tone?: 'success' | 'error' | 'ask' | 'warn';
  /** full: Repetir, Volver un paso y Salir; exit: solo Salir; none: sin pie. */
  foot: 'full' | 'exit' | 'none';
}

function cardBody(state: AppState, view: { more: boolean; setMore: (v: boolean) => void; optionsVisit: number }): Body {
  const { guide, nav } = state;
  switch (guide.phase) {
    case 'idle':
      return { content: null, foot: 'none' };

    case 'analyzing':
      return {
        foot: 'exit',
        content: (
          <section className="mm-section" role="status">
            <LoadingDots />
            <h2 className="title">Estoy mirando la página…</h2>
            <p className="lead-s">Busco qué se puede hacer acá. Mientras tanto, podés leerla con calma.</p>
          </section>
        ),
      };

    case 'choosing':
      return { foot: 'exit', content: view.more ? <MoreOptions state={state} onBack={() => view.setMore(false)} /> : <Options state={state} visit={view.optionsVisit} onMore={() => view.setMore(true)} /> };

    case 'guiding':
    case 'verifying':
      return {
        foot: 'full',
        content: (
          <section className="mm-section" role="status">
            <LoadingDots />
            <h2 className="title">Estoy fijándome si funcionó…</h2>
            <p className="lead-s">La página cambió después de tu clic. Ya te digo qué sigue.</p>
            <DoneList done={guide.done} />
          </section>
        ),
      };

    case 'waitingForUser':
      return { foot: 'full', content: <CurrentStep state={state} /> };

    case 'completed':
      return guide.evidence
        ? { tone: 'success', foot: 'none', content: <Completed evidence={guide.evidence} speech={guideSpeech(guide)} auto={state.voice.active} contentKey={`listo:${guide.contentKey}`} /> }
        : { tone: 'ask', foot: 'none', content: <DidYouFinish speech={guideSpeech(guide)} auto={state.voice.active} contentKey={`terminaste:${guide.contentKey}`} /> };

    case 'unsupported':
      return {
        foot: 'none',
        content: (
          <section className="status unsupported" role="status">
            <div className="head">
              <Icon name="circle-slash" size="lg" />
              <h2 className="title">En esta página no puedo ayudarte.</h2>
            </div>
            <p>{guide.message ?? 'Está hecha de una forma que no puedo leer. No es un error tuyo.'}</p>
            <div className="actions">
              {nav.canGoBack ? (
                <Button variant="primary" block icon="arrow-left" onClick={() => send({ type: 'back' })}>
                  Volver a la página anterior
                </Button>
              ) : null}
              <Button variant="secondary" block icon="external-link" onClick={() => send({ type: 'openCurrentExternally' })}>
                Abrir fuera de Mostrame
              </Button>
            </div>
            <p className="muted tip">Fuera de Mostrame ya no te voy a poder guiar.</p>
          </section>
        ),
      };

    case 'error':
      return {
        tone: 'error',
        foot: 'none',
        content: (
          <section className="status error" role="alert">
            <div className="head">
              <Icon name="triangle-alert" size="lg" />
              <h2 className="title">No pude leer esta página.</h2>
            </div>
            <p>Fue un problema de mi lado, no tuyo. La página funciona igual y podés seguir usándola.</p>
            <div className="actions">
              <Button variant="primary" block icon="refresh-cw" onClick={() => send({ type: 'retry' })}>
                Intentar de nuevo
              </Button>
              <Button variant="secondary" block onClick={() => send({ type: 'exitHelp' })}>
                Seguir sin ayuda
              </Button>
            </div>
          </section>
        ),
      };

    default:
      return { content: <p>{guide.message}</p>, foot: 'exit' };
  }
}

/** 05: hasta 3 opciones de la página. */
function Options({ state, visit, onMore }: { state: AppState; visit: number; onMore: () => void }) {
  const { primary, secondary } = state.guide;
  // Modo voz: al terminar de leer las opciones, se puede contestar hablando.
  const [readDone, setReadDone] = useState(0);
  const choices: VoiceChoice[] = [
    ...primary.map((o) => ({ label: o.title, run: () => send({ type: 'selectOption', optionId: o.id }) })),
    // Se nombra al leer solo si hay secundarias; si no, se puede elegir por su nombre pero no por número.
    { label: 'Ver otras opciones', kind: 'more', unnumbered: secondary.length === 0, run: onMore },
  ];
  return (
    <>
      <div>
        <div className="speak-row">
          <h2 className="title">¿Qué querés hacer acá?</h2>
          <SpeakButton
            text={optionsSpeech(
              primary.map((o) => o.title),
              secondary.length > 0,
            )}
            auto={state.voice.active}
            contentKey={optionsReadKey(state.guide.contentKey, visit)}
            onDone={(outcome) => outcome === 'ended' && setReadDone((n) => n + 1)}
          />
        </div>
        <p className="lead-s">Encontré estas opciones en esta página.</p>
      </div>
      <ul className="option-list" aria-label="Opciones de esta página">
        {primary.map((o, i) => (
          <li key={o.id}>
            <OptionButton option={o} lead={<span className="num">{i + 1}</span>} />
          </li>
        ))}
      </ul>
      <button type="button" className="linkish" onClick={onMore}>
        Ver otras opciones
      </button>
      <VoiceAnswer choices={choices} active={state.voice.active} trigger={readDone} />
      <p className="panel-note">
        <Icon name="lock" />
        <span>Mostrame no recibe lo que escribís en la página.</span>
      </p>
    </>
  );
}

/** 11: el resto de las opciones y un campo para contar con sus palabras lo que busca. */
function MoreOptions({ state, onBack }: { state: AppState; onBack: () => void }) {
  const { secondary } = state.guide;
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    send({ type: 'askOnPage', text });
    setText('');
    onBack();
  };
  return (
    <>
      <h2 className="title">Otras cosas que podés hacer acá</h2>
      {secondary.length > 0 ? (
        <ul className="mm-sec-list" aria-label="Otras opciones de esta página">
          {secondary.map((o) => (
            <li key={o.id}>
              <OptionButton option={o} lead={<Icon name="arrow-right" />} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mm-divider" />
      <form className="mm-section" onSubmit={submit}>
        <label htmlFor="ask-page" className="lead-s">
          ¿No está lo que buscás? Contame qué querés hacer.
        </label>
        <div className="mm-ask-row">
          <input id="ask-page" className="field" placeholder="Por ejemplo: cambiar la oficina" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <Button variant="primary" icon="send" type="submit">
            Enviar
          </Button>
        </div>
      </form>
      <button type="button" className="linkish" onClick={onBack}>
        <Icon name="arrow-left" size="sm" />
        Volver a las 3 principales
      </button>
    </>
  );
}

function OptionButton({ option, lead }: { option: OptionView; lead: ReactNode }) {
  return (
    <button type="button" className="option" onClick={() => send({ type: 'selectOption', optionId: option.id })}>
      {lead}
      <span>
        <span className="t">{option.title}</span>
        {option.description ? <span className="d">{option.description}</span> : null}
      </span>
      <Icon name="chevron-right" />
    </button>
  );
}

/** 06 y 08: una instrucción por vez, con el nombre del control resaltado. */
function CurrentStep({ state }: { state: AppState }) {
  const { guide } = state;
  const field = guide.targetField;
  // En un campo no hay clic que observar sin leer lo escrito: la persona avisa.
  const confirm = field || guide.waitFor === 'userConfirmation';
  return (
    <section className="mm-section" aria-label="Paso actual">
      <div className="now-row">
        <p className="now">
          <Icon name="arrow-right" />
          Ahora
        </p>
        {/* Leer en voz alta (opcional, S11): solo si la persona lo pide; se corta al cambiar de instrucción. */}
        <SpeakButton text={guideSpeech(guide)} auto={state.voice.active} contentKey={stepSpeechKey(guide)} />
      </div>
      {/* Única región que anuncia instrucciones; Repetir cambia la clave y se vuelve a anunciar. No mueve el foco. */}
      <div aria-live="polite" key={guide.announceKey}>
        <p className="instr">{withControlNames(guide.instruction ?? '')}</p>
      </div>
      {field ? (
        <p className="mm-callout">
          <Icon name="lock" />
          <span>
            <b>Esto lo escribís vos.</b> Mostrame no lo ve ni lo guarda.
          </span>
        </p>
      ) : guide.targetVisible ? (
        <p className="help">Te lo marqué en la página con un borde amarillo y negro.</p>
      ) : null}
      {guide.targetVisible === false ? <p className="help">No veo el lugar en pantalla. Probá desplazarte por la página.</p> : null}
      {confirm ? (
        <Button variant="primary" block icon="check" onClick={() => send({ type: 'confirmDone' })}>
          {field ? 'Listo, ya lo escribí' : 'Ya lo hice'}
        </Button>
      ) : (
        <>
          <p className="waiting">
            <span className="pulse" aria-hidden="true" />
            <span>Te espero. Cuando hagas clic, sigo con vos.</span>
          </p>
          {guide.targetVisible ? null : (
            <Button variant="secondary" block onClick={() => send({ type: 'confirmDone' })}>
              Ya lo hice
            </Button>
          )}
        </>
      )}
      <DoneList done={guide.done} />
    </section>
  );
}

/** «Ya hiciste»: solo los pasos pasados (nunca «Paso X de Y» ni lo que falta). */
function DoneList({ done }: { done: string[] }) {
  if (done.length === 0) return null;
  return (
    <section className="done-list" aria-label="Ya hiciste">
      <h3>Ya hiciste</h3>
      <ul>
        {done.map((item, i) => (
          <li key={`${i}-${item}`}>
            <Icon name="check" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 09: «Listo» solo con evidencia de la página, citada tal cual. */
function Completed({ evidence, speech, auto, contentKey }: { evidence: string; speech: string; auto: boolean; contentKey: string }) {
  return (
    <section className="status success" role="status">
      <div className="head">
        <Icon name="circle-check" size="lg" />
        {/* TODO(textos): «completada.titulo» pide «Listo: {resultado}.»; el backend todavía no manda el resultado. */}
        <h2 className="title">Listo.</h2>
        {/* Se lee «Listo.» sin la cita de la página. */}
        <SpeakButton text={speech} auto={auto} contentKey={contentKey} />
      </div>
      <p className="evidence">
        <Icon name="check" size="sm" />
        <span>La página dice «{evidence}».</span>
      </p>
      <div className="actions">
        <Button variant="primary" block onClick={() => send({ type: 'stepBack' })}>
          Hacer otra cosa
        </Button>
        <Button variant="secondary" block onClick={() => send({ type: 'finishHelp' })}>
          Quedarme en esta página
        </Button>
      </div>
    </section>
  );
}

/** 16 y 17: sin evidencia no hay festejo; se pregunta y, si falta algo, se sigue. */
function DidYouFinish({ speech, auto, contentKey }: { speech: string; auto: boolean; contentKey: string }) {
  const [notYet, setNotYet] = useState(false);
  if (notYet) {
    const reasons = [
      { icon: 'arrow-right', text: 'Creo que me falta un paso', command: { type: 'resumeGuide' } },
      // TODO(13): todavía no se cita el error de la página; Mostrame vuelve a mirarla.
      { icon: 'triangle-alert', text: 'La página me mostró un error', command: { type: 'resumeGuide' } },
      { icon: 'rotate-ccw', text: 'Quiero empezar de nuevo', command: { type: 'stepBack' } },
    ] as const;
    return (
      <section className="mm-section" role="status">
        <h2 className="title">Sigamos. ¿Qué pasó?</h2>
        <p className="lead-s">Elegí lo que más se parece. Con eso te digo el próximo paso.</p>
        <ul className="mm-sec-list" aria-label="Qué pasó">
          {reasons.map((r) => (
            <li key={r.text}>
              <button type="button" className="option" onClick={() => send(r.command)}>
                <Icon name={r.icon} />
                <span className="t">{r.text}</span>
                <Icon name="chevron-right" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="status ask" role="status">
      <div className="head">
        <Icon name="circle-help" size="lg" />
        <h2 className="title">¿Pudiste terminar?</h2>
        <SpeakButton text={speech} auto={auto} contentKey={contentKey} />
      </div>
      <p>La página cambió, pero no sé si terminaste. Fijate si la página lo confirma.</p>
      <div className="actions">
        <Button variant="primary" block onClick={() => send({ type: 'finishHelp' })}>
          Sí, terminé
        </Button>
        <Button variant="secondary" block onClick={() => setNotYet(true)}>
          Todavía no
        </Button>
      </div>
    </section>
  );
}

/** Errores de carga y páginas que solo se leen en parte. */
function PageProblems({ state }: { state: AppState }) {
  const { nav, guide } = state;
  return (
    <>
      {nav.secure ? null : (
        <p className="mm-callout warn" role="alert">
          <Icon name="shield-alert" />
          <span>
            <b>Conexión no segura.</b> No escribas datos personales en esta página.
          </span>
        </p>
      )}
      {nav.error ? (
        <div className="notice" data-tone="error" role="alert">
          <p>{nav.error}</p>
          <div className="row">
            <Button icon="refresh-cw" onClick={() => send({ type: 'reload' })}>
              Intentar de nuevo
            </Button>
          </div>
        </div>
      ) : null}
      {guide.partialPage && guide.phase !== 'idle' ? (
        <p className="panel-note">
          <Icon name="circle-help" />
          <span>Parte de esta página no se puede leer; puede faltar alguna indicación.</span>
        </p>
      ) : null}
    </>
  );
}

/** Marca los nombres de control entre « » como en el diseño («Sacar turno»). */
function withControlNames(text: string): ReactNode {
  return text.split(/(«[^»]+»)/g).map((part, i) =>
    part.startsWith('«') && part.endsWith('»') ? (
      <span key={i} className="ctl-name">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
