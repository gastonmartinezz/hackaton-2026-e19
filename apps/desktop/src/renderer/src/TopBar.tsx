/**
 * Barra del navegador (R6, R7). En el inicio y las preguntas: logo, Voz y
 * Tamaño de letra. Con un sitio abierto: además Inicio, Atrás, la píldora
 * «Estás en» con el dominio y Ayuda.
 * «Voz» no está en el diseño v2.2: pendiente de aprobación de diseño.
 */
import { Button, Icon, Logo } from '@asistente/ui';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { splitDomain } from '../../shared/domain';
import { TEXT_SCALES, type AppState } from '../../shared/ipc';
import { SiteCheckIndicator, SiteCheckProbe } from './SiteCheck';
import { send } from './useAppState';

const SCALE_NAMES: Record<number, string> = { 1.2: 'normal', 1.45: 'grande', 1.75: 'muy grande' };

/**
 * TEMPORAL — textos del interruptor del modo voz (no están en las pantallas
 * v2.2). Pendientes de aprobación de diseño.
 */
export const VOICE_TOGGLE_TEXTS = {
  label: 'Voz',
  /** Completa el nombre accesible: «Voz: leer en voz alta». El estado lo da aria-pressed. */
  description: ': leer en voz alta',
} as const;

export function TopBar({ state, indicatorInline = true }: { state: AppState; indicatorInline?: boolean }) {
  const { nav, prefs, guide } = state;
  const site = nav.visible;
  const helpOn = site && prefs.aiEnabledForSite && guide.phase !== 'idle';

  const nextScale = () => {
    const index = TEXT_SCALES.findIndex((s) => s === prefs.textScale);
    send({ type: 'setTextScale', scale: TEXT_SCALES[(index + 1) % TEXT_SCALES.length]! });
  };

  return (
    <header className="chrome" style={{ height: state.layout.topBarHeight }}>
      <button type="button" className="brand" aria-label="Guíame, ir al inicio" onClick={() => send({ type: 'home' })}>
        <Logo />
      </button>
      {site ? (
        <>
          <nav className="nav" aria-label="Navegación">
            <Button variant="chrome" className="icon-only" aria-label="Inicio" onClick={() => send({ type: 'home' })}>
              <Icon name="house" />
            </Button>
            <Button variant="chrome" className="icon-only" aria-label="Atrás" disabled={!nav.canGoBack} onClick={() => send({ type: 'back' })}>
              <Icon name="arrow-left" />
            </Button>
          </nav>
          <Omni state={state} indicatorInline={indicatorInline} />
          <Button variant="help" icon="navigation" aria-pressed={helpOn} onClick={() => send({ type: helpOn ? 'exitHelp' : 'analyzePage' })}>
            Ayuda
          </Button>
        </>
      ) : (
        <span className="spacer" />
      )}
      <VoiceToggle active={state.voice.active} />
      <Button variant="chrome" onClick={nextScale}>
        <span className="aa" aria-hidden="true">
          A<span>A</span>
        </span>
        <span className="lbl-long">Tamaño de letra</span>
        <span className="lbl-short">Letra</span>
        <span className="sr-only">: {SCALE_NAMES[prefs.textScale] ?? ''}</span>
      </Button>
    </header>
  );
}

/**
 * Interruptor del modo voz: prendido, Guíame lee solo lo que escribe. Tocarlo
 * deja la preferencia en «on» u «off»; apagarlo corta lo que esté sonando.
 */
export function VoiceToggle({ active }: { active: boolean }) {
  return (
    <Button variant="chrome" className="voice-toggle" aria-pressed={active} onClick={() => send({ type: 'setVoiceMode', mode: active ? 'off' : 'on' })}>
      {active ? <Icon name="check" /> : null}
      {VOICE_TOGGLE_TEXTS.label}
      <span className="sr-only">{VOICE_TOGGLE_TEXTS.description}</span>
    </Button>
  );
}

/**
 * Con un sitio abierto muestra «Estás en» y el dominio; al tocarlo se puede
 * escribir otra búsqueda. Una dirección abre el sitio; otro texto vuelve al inicio.
 * Sin candado (R6): el sello es el de Protección de sitios, nunca HTTPS.
 */
function Omni({ state, indicatorInline }: { state: AppState; indicatorInline: boolean }) {
  const { nav } = state;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const fit = useDomainFit(`${nav.domain}|${nav.secure}|${state.prefs.textScale}|${indicatorInline}|${editing}`);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    send({ type: 'search', text });
    setText('');
    setEditing(false);
  };

  if (!editing && nav.domain) {
    const { sub, main } = splitDomain(nav.domain);
    return (
      <div className="omni" ref={fit.ref} data-fit={fit.level} role="group" aria-label="Sitio abierto">
        <button type="button" className="where" onClick={() => setEditing(true)} aria-label={`Estás en ${nav.domain}. Buscar otra cosa`}>
          {nav.secure ? null : (
            <span className="insecure">
              <span className="insecure-icon">
                <Icon name="triangle-alert" size="sm" />
              </span>
              <span className="insecure-text">Conexión no segura</span>
            </span>
          )}
          <span className="k-estas">Estás en</span>
          <span className="dom">
            {sub ? <span className="sub">{sub}</span> : null}
            <b>{main}</b>
          </span>
        </button>
        {/*
          Sello (R6) de Protección de sitios: junto al dominio, en la interfaz del navegador (la página no puede taparlo).
          Si no entra sin cortar el dominio, va en la franja de abajo (SiteCheckUnderBar).
          TODO(contrato): «La tienda que elegiste» cuando el backend sepa qué tienda eligió la persona.
        */}
        {indicatorInline ? <SiteCheckIndicator view={state.siteCheck} /> : null}
        <SiteCheckProbe view={state.siteCheck} />
      </div>
    );
  }

  return (
    <form className="omni" role="search" onSubmit={submit}>
      <Icon name="search" size="sm" />
      <input
        aria-label="Buscá un sitio o contá qué querés hacer"
        placeholder="Buscá un sitio o contá qué querés hacer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text && setEditing(false)}
        onKeyDown={(e) => e.key === 'Escape' && (setText(''), setEditing(false))}
        autoFocus={editing}
        maxLength={500}
        autoComplete="off"
        spellCheck={false}
      />
    </form>
  );
}

/** Lo que se va sacando de la píldora, en orden, para que el dominio entre entero. */
const FIT_LEVELS = [undefined, 'sin-estas', 'icono'] as const;

/**
 * El dominio tiene prioridad sobre el resto de la píldora: si quedó recortado,
 * primero se oculta «Estás en» y después «Conexión no segura» queda solo con su
 * ícono. Se vuelve a medir desde el principio cuando cambia el ancho, el sitio
 * o el tamaño de letra. Recortarlo es el último recurso (ver guiame.css).
 */
function useDomainFit(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState(0);
  // Fuerza otra medición aunque el nivel ya sea 0 (React no vuelve a dibujar si el estado no cambia).
  const [, remeasure] = useState(0);
  useLayoutEffect(() => setLevel(0), [key]);
  useLayoutEffect(() => {
    const omni = ref.current;
    if (!omni || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setLevel(0);
      remeasure((n) => n + 1);
    });
    observer.observe(omni);
    return () => observer.disconnect();
    // La píldora con el dominio aparece y desaparece (al editar o sin sitio): se vuelve a observar.
  }, [key]);
  useLayoutEffect(() => {
    const main = ref.current?.querySelector('.dom b');
    if (main && main.scrollWidth > main.clientWidth && level < FIT_LEVELS.length - 1) setLevel(level + 1);
  });
  return { ref, level: FIT_LEVELS[level] };
}
