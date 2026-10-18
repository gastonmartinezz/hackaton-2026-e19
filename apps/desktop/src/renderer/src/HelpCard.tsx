/**
 * Tarjeta flotante de ayuda (R4; pantallas 04 a 21). Vive en su propia vista
 * sobre el sitio (main/help-card.ts): mide lo que dibuja y lo informa con
 * `cardLayout` para que el proceso principal la ubique sin tapar el control.
 */
import { BrandIcon, Button, Icon, LoadingDots } from '@asistente/ui';
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AppState, CardMode, OptionView } from '../../shared/ipc';
import { Notices } from './Notices';
import { GuidePausedNotice } from './SiteCheck';
import { SpeakButton } from './speech/SpeakButton';
import { guideSpeech, optionsReadKey, optionsSpeech, SPEECH_TEXTS, stepSpeechKey } from './speech/speechText';
import { send, useAppState } from './useAppState';
import { FieldDictation } from './voice/FieldDictation';
import { VoiceAnswer, type VoiceChoice } from './voice/VoiceAnswer';

/** Mientras Guíame investiga el paso a paso de la opción elegida o de lo que pidió la persona. */
const RESEARCH_TEXTS = {
  title: (option: string) => `Estoy buscando cómo se hace «${option}»…`,
  support: 'Busco el paso a paso para guiarte. Puede tardar unos segundos.',
  request: (asked: string) => `Estoy buscando cómo hacer «${asked}» en este sitio…`,
} as const;

/** Margen transparente de la vista para el halo (CARD_SHADOW en main/help-card.ts). */
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
        <div className="hc-toast" role="status">
          <p className="txt">Saliste de la ayuda. La página sigue igual.</p>
          <Button variant="secondary" icon="navigation" onClick={() => send({ type: 'analyzePage' })}>
            Volver a la ayuda
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'pill') {
    return (
      <div className="card-host" ref={hostRef}>
        <div className="hc-pill" role="region" aria-label="Ayuda de Guíame, achicada">
          <span className="strip" aria-hidden="true">
            <BrandIcon />
          </span>
          <p className="txt">{withControlNames(guide.instruction ?? '')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setMinimized(false);
              setExpandedFor(guide.announceKey);
            }}
          >
            Ver la ayuda
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
      <aside className="hc" aria-label="Ayuda de Guíame" style={{ maxHeight: state.layout.card.maxHeight || undefined }}>
        <div className="hc-head">
          <BrandIcon />
          {/* El objetivo va en el encabezado, sin «Tu objetivo» (R3, R4). */}
          <span className="hc-goal">{guide.goal && guide.phase !== 'idle' ? guide.goal : 'Guíame'}</span>
          {guide.phase === 'waitingForUser' && !state.siteCheck.guidePaused ? (
            <Button variant="quiet" icon="minus" onClick={() => setMinimized(true)}>
              Achicar
            </Button>
          ) : null}
        </div>
        <div className="hc-body">
          <Notices state={state} />
          <PageProblems state={state} />
          {body.content}
        </div>
        {body.foot === 'none' ? null : (
          <nav className="hc-foot" aria-label="Controles de la ayuda">
            {body.foot === 'full' ? (
              <Button variant="secondary" block icon="arrow-left" onClick={() => send({ type: 'stepBack' })}>
                Volver un paso
              </Button>
            ) : null}
            <Button variant="secondary" block icon="log-out" onClick={() => send({ type: 'exitHelp' })}>
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
    // Indicación pausada por riesgo alto: la tarjeta completa explica por qué (nunca la píldora con la instrucción).
    if (state.siteCheck.guidePaused) return 'card';
    const forced = state.layout.card.placement === 'compact' && expandedFor !== guide.announceKey;
    if (minimized || forced) return 'pill';
  }
  return 'card';
}

interface Body {
  content: ReactNode;
  /** full: Volver un paso y Salir de la ayuda; exit: solo Salir; none: sin pie (R4). */
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
          <section className="hc-section" role="status">
            <LoadingDots />
            <h2 className="instr">{guide.request ? withControlNames(RESEARCH_TEXTS.request(guide.request)) : 'Estoy mirando la página…'}</h2>
            <p className="support">{guide.request ? RESEARCH_TEXTS.support : 'Esto lleva unos segundos.'}</p>
          </section>
        ),
      };

    case 'choosing':
      return { foot: 'exit', content: view.more ? <MoreOptions state={state} onBack={() => view.setMore(false)} /> : <Options state={state} visit={view.optionsVisit} onMore={() => view.setMore(true)} /> };

    case 'guiding':
    case 'verifying': {
      // Recién elegida la opción: Guíame investiga el paso a paso antes del primer paso.
      const researching = guide.phase === 'guiding' && guide.stepCount === 0 && guide.option !== null;
      return {
        foot: 'full',
        content: (
          <section className="hc-section" role="status">
            <LoadingDots />
            <h2 className="instr">{researching ? withControlNames(RESEARCH_TEXTS.title(guide.option!.title)) : 'Estoy fijándome si funcionó…'}</h2>
            <p className="support">{researching ? RESEARCH_TEXTS.support : 'Dame un segundo.'}</p>
            <Progress count={guide.done.length} />
          </section>
        ),
      };
    }

    case 'waitingForUser':
      if (state.siteCheck.guidePaused) return { foot: 'exit', content: <GuidePausedNotice /> };
      return { foot: 'full', content: <CurrentStep state={state} /> };

    case 'completed':
      return guide.evidence
        ? { foot: 'none', content: <Completed evidence={guide.evidence} speech={guideSpeech(guide)} auto={state.voice.active} contentKey={`listo:${guide.contentKey}`} /> }
        : { foot: 'exit', content: <DidYouFinish speech={guideSpeech(guide)} auto={state.voice.active} contentKey={`terminaste:${guide.contentKey}`} /> };

    case 'unsupported':
      return {
        foot: 'exit',
        content: (
          <section className="hc-section" role="status">
            <Icon name="circle-slash" size="lg" />
            <h2 className="hc-title">Acá no puedo guiarte</h2>
            <p className="support">{guide.message ?? 'Está hecha de una forma que no puedo leer. No es un error tuyo.'}</p>
            {nav.canGoBack ? (
              <Button variant="primary" block icon="arrow-left" onClick={() => send({ type: 'back' })}>
                Volver a la página anterior
              </Button>
            ) : null}
            <Button variant="secondary" block icon="external-link" onClick={() => send({ type: 'openCurrentExternally' })}>
              Abrir fuera de Guíame
            </Button>
            <p className="panel-note">Fuera de Guíame ya no te voy a poder guiar.</p>
          </section>
        ),
      };

    case 'error':
      return {
        foot: 'exit',
        content: (
          <>
            <section className="status error" role="alert">
              <Icon name="triangle-alert" size="lg" />
              <h2 className="hc-title">No pude leer esta página</h2>
              <p>Fue un problema mío, no tuyo. La página sigue funcionando.</p>
            </section>
            <Button variant="primary" block icon="refresh-cw" onClick={() => send({ type: 'retry' })}>
              Probar de nuevo
            </Button>
          </>
        ),
      };

    default:
      return { content: <p className="support">{guide.message}</p>, foot: 'exit' };
  }
}

/** 05: hasta 3 opciones de la página, sin descripciones (R3). */
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
      <div className="hc-section">
        <h2 className="hc-title">{SPEECH_TEXTS.optionsTitle}</h2>
        {/* Si lo que pidió no se puede hacer acá, se dice antes de mostrar las opciones de la página. */}
        <p className="support">{state.guide.message ?? 'Encontré estas opciones en esta página.'}</p>
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
      <ul className="option-list" aria-label="Opciones de esta página">
        {primary.map((o, i) => (
          <li key={o.id}>
            <OptionButton option={o} lead={<span className="num">{i + 1}</span>} />
          </li>
        ))}
      </ul>
      <Button variant="link" className="back-link" onClick={onMore}>
        Ver otras opciones
      </Button>
      {/* Si dice algo que no está entre las opciones, Guíame lo busca en el sitio (igual que «¿No está lo que buscás?»). */}
      <VoiceAnswer choices={choices} active={state.voice.active} trigger={readDone} onFreeText={(text) => send({ type: 'askOnPage', text })} />
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
      <Button variant="quiet" icon="arrow-left" className="back-link" onClick={onBack}>
        Volver a las 3 opciones
      </Button>
      <h2 className="hc-title">Otras cosas que se pueden hacer</h2>
      {secondary.length > 0 ? (
        <ul className="option-list" aria-label="Otras opciones de esta página">
          {secondary.map((o) => (
            <li key={o.id}>
              <OptionButton option={o} />
            </li>
          ))}
        </ul>
      ) : null}
      <form className="hc-section" onSubmit={submit}>
        <label htmlFor="ask-page" className="support">
          ¿No está lo que buscás? Contame qué querés hacer.
        </label>
        <div className="ask-row">
          <input id="ask-page" className="field" placeholder="Por ejemplo: cambiar la oficina" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <Button variant="secondary" icon="send" type="submit">
            Enviar
          </Button>
        </div>
      </form>
    </>
  );
}

function OptionButton({ option, lead }: { option: OptionView; lead?: ReactNode }) {
  return (
    <button type="button" className="option" onClick={() => send({ type: 'selectOption', optionId: option.id })}>
      {lead}
      <span className="t">{option.title}</span>
      <Icon name="chevron-right" />
    </button>
  );
}

/** 06 y 08: una instrucción por vez, con el nombre del control resaltado. */
function CurrentStep({ state }: { state: AppState }) {
  const { guide } = state;
  if (guide.ask?.mode === 'dictate') return <DictateStep state={state} />;
  const field = guide.targetField;
  // Un dato del formulario se pide en voz alta salvo que la persona haya apagado la voz.
  const askAloud = guide.ask !== null && state.prefs.voiceMode !== 'off';
  // En un campo no hay clic que observar sin leer lo escrito: la persona avisa.
  const confirm = field || guide.waitFor === 'userConfirmation';
  const support =
    guide.targetVisible === false
      ? 'No veo el lugar en pantalla. Probá desplazarte por la página.'
      : field
        ? null
        : guide.targetVisible
          ? 'Te lo marqué con un borde azul. Te espero.'
          : 'Te espero. Cuando hagas clic, sigo con vos.';
  return (
    <section className="hc-section" aria-label="Paso actual">
      {/* Única región que anuncia instrucciones; cambia la clave al volver a mostrarla. No mueve el foco. */}
      <div aria-live="polite" key={guide.announceKey}>
        <p className="instr">{withControlNames(guide.instruction ?? '')}</p>
      </div>
      {support ? <p className="support">{support}</p> : null}
      {/* Leer en voz alta (opcional, S11): solo si la persona lo pide o con el modo voz; se corta al cambiar de instrucción. */}
      <SpeakButton text={guideSpeech(guide)} auto={state.voice.active || askAloud} contentKey={stepSpeechKey(guide)} />
      {field ? (
        <p className="soft-box">
          <Icon name="lock" />
          <span>{SPEECH_TEXTS.fieldNote}</span>
        </p>
      ) : null}
      {confirm ? (
        <Button variant="primary" block icon="check" onClick={() => send({ type: 'confirmDone' })}>
          {field ? 'Ya lo escribí' : 'Ya lo hice'}
        </Button>
      ) : guide.targetVisible ? null : (
        <Button variant="secondary" block icon="check" onClick={() => send({ type: 'confirmDone' })}>
          Ya lo hice
        </Button>
      )}
      <Progress count={guide.done.length} />
    </section>
  );
}

/**
 * Un dato del formulario que se dicta: Guíame lee la pregunta, escucha la
 * respuesta y la escribe en la página; la persona la revisa. No tiene
 * pantalla en design/: reusa los componentes de la tarjeta. Nunca muestra ni lee el valor.
 */
function DictateStep({ state }: { state: AppState }) {
  const { guide } = state;
  const ask = guide.ask!;
  const auto = state.prefs.voiceMode !== 'off';
  const key = stepSpeechKey(guide);
  /** Terminó (o no se pudo) leer la pregunta: se escucha la respuesta. */
  const [questionRead, setQuestionRead] = useState(0);
  return (
    <section className="hc-section" aria-label="Paso actual">
      <div aria-live="polite" key={guide.announceKey}>
        <p className="instr">{withControlNames(guide.instruction ?? '')}</p>
      </div>
      <p className="support">{ask.question}</p>
      <SpeakButton text={ask.question} auto={auto && !ask.filled} contentKey={`pregunta:${key}`} onDone={() => setQuestionRead((n) => n + 1)} />
      <FieldDictation filled={ask.filled} auto={auto} trigger={questionRead} stepKey={key} />
      <Progress count={guide.done.length} />
    </section>
  );
}

/** «Vas bien: ya hiciste N pasos.» Solo acciones hechas en el sitio; sin línea con 0 (R5). */
function Progress({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="progress">
      <Icon name="check" size="sm" />
      Vas bien: ya hiciste {count} {count === 1 ? 'paso' : 'pasos'}.
    </p>
  );
}

/** 09: «Listo» solo con evidencia de la página, citada tal cual. */
function Completed({ evidence, speech, auto, contentKey }: { evidence: string; speech: string; auto: boolean; contentKey: string }) {
  return (
    <>
      <section className="status success" role="status">
        <div className="head">
          <Icon name="circle-check" size="lg" />
          {/* TODO(copy): la pantalla 09 dice «Listo: {resultado}.»; el backend todavía no manda el resultado. */}
          <h2 className="hc-title">Listo.</h2>
        </div>
        <figure className="quote">
          <figcaption>La página dice</figcaption>
          <blockquote>«{evidence}»</blockquote>
        </figure>
        <p>Lo hiciste vos.</p>
      </section>
      {/* Se lee «Listo.» sin la cita de la página. */}
      <SpeakButton text={speech} auto={auto} contentKey={contentKey} />
      <Button variant="primary" block onClick={() => send({ type: 'stepBack' })}>
        Hacer otra cosa
      </Button>
      <Button variant="link" className="back-link" onClick={() => send({ type: 'finishHelp' })}>
        Quedarme en esta página
      </Button>
    </>
  );
}

/** 16 y 17: sin evidencia no hay festejo; se pregunta y, si falta algo, se sigue. */
function DidYouFinish({ speech, auto, contentKey }: { speech: string; auto: boolean; contentKey: string }) {
  const [notYet, setNotYet] = useState(false);
  if (notYet) {
    const reasons = [
      { text: 'Me falta un paso', command: { type: 'resumeGuide' } },
      // TODO(13): todavía no se cita el error de la página; Guíame vuelve a mirarla.
      { text: 'La página mostró un error', command: { type: 'resumeGuide' } },
      { text: 'Quiero empezar de nuevo', command: { type: 'stepBack' } },
    ] as const;
    return (
      <section className="hc-section" role="status">
        <h2 className="hc-title">Sigamos. ¿Qué pasó?</h2>
        <ul className="option-list" aria-label="Qué pasó">
          {reasons.map((r) => (
            <li key={r.text}>
              <button type="button" className="option" onClick={() => send(r.command)}>
                <span className="t">{r.text}</span>
                <Icon name="chevron-right" />
              </button>
            </li>
          ))}
          <li>
            {/* Sin saber qué pasó, Guíame vuelve a mirar la página. */}
            <button type="button" className="option unsure" onClick={() => send({ type: 'resumeGuide' })}>
              <Icon name="circle-help" />
              <span className="t">{SPEECH_TEXTS.unsure}</span>
            </button>
          </li>
        </ul>
      </section>
    );
  }
  return (
    <>
      <section className="status ask" role="status">
        <h2 className="hc-title">¿Pudiste terminar?</h2>
        <p className="support">No vi una confirmación en la página.</p>
      </section>
      <SpeakButton text={speech} auto={auto} contentKey={contentKey} />
      <Button variant="secondary" block icon="check" onClick={() => send({ type: 'finishHelp' })}>
        Sí, terminé
      </Button>
      <Button variant="secondary" block icon="clock" onClick={() => setNotYet(true)}>
        Todavía no
      </Button>
    </>
  );
}

/** Errores de carga y páginas que solo se leen en parte. */
function PageProblems({ state }: { state: AppState }) {
  const { nav, guide } = state;
  return (
    <>
      {/* Con la guía pausada por riesgo alto, «Pausé esta indicación» ya pide no escribir datos: un solo aviso (R1). */}
      {nav.secure || state.siteCheck.guidePaused ? null : (
        <p className="callout" role="alert">
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
            <Button variant="secondary" icon="refresh-cw" onClick={() => send({ type: 'reload' })}>
              Probar de nuevo
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
