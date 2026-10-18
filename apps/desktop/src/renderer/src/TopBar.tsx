/**
 * Barra del navegador (todas las pantallas): logo, Inicio, Atrás, Recargar, el
 * buscador en píldora, Ayuda (con un sitio abierto) y Tamaño de letra.
 */
import { Button, Icon, Logo } from '@asistente/ui';
import { useState, type FormEvent } from 'react';
import { splitDomain } from '../../shared/domain';
import { TEXT_SCALES, type AppState } from '../../shared/ipc';
import { SiteCheckIndicator, SiteCheckProbe } from './SiteCheck';
import { send } from './useAppState';

const SCALE_NAMES: Record<number, string> = { 1.2: 'normal', 1.45: 'grande', 1.75: 'muy grande' };

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
      <button type="button" className="brand" aria-label="Mostrame, ir al inicio" onClick={() => send({ type: 'home' })}>
        <Logo />
      </button>
      <nav className="nav" aria-label="Navegación">
        <Button variant="chrome" className="icon-only" aria-label="Inicio" onClick={() => send({ type: 'home' })}>
          <Icon name="house" />
        </Button>
        <Button variant="chrome" className="icon-only" aria-label="Página anterior" disabled={!nav.canGoBack} onClick={() => send({ type: 'back' })}>
          <Icon name="arrow-left" />
        </Button>
        <Button variant="chrome" className="icon-only" aria-label="Volver a cargar la página" disabled={!site} onClick={() => send({ type: 'reload' })}>
          <Icon name="rotate-cw" />
        </Button>
      </nav>
      <Omni state={state} indicatorInline={indicatorInline} />
      {site ? (
        <Button variant="help" icon="sparkles" aria-pressed={helpOn} onClick={() => send({ type: helpOn ? 'exitHelp' : 'analyzePage' })}>
          Ayuda
        </Button>
      ) : null}
      <Button variant="chrome" onClick={nextScale}>
        <Icon name="a-large-small" />
        <span className="lbl-long">Tamaño de letra</span>
        <span className="lbl-short">Letra</span>
        <span className="sr-only">: {SCALE_NAMES[prefs.textScale] ?? ''}</span>
      </Button>
    </header>
  );
}

/**
 * Con un sitio abierto muestra «Estás en» y el dominio; al tocarlo se puede
 * escribir otra búsqueda. Una dirección abre el sitio; otro texto vuelve al inicio.
 */
function Omni({ state, indicatorInline }: { state: AppState; indicatorInline: boolean }) {
  const { nav } = state;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    send({ type: 'search', text });
    setText('');
    setEditing(false);
  };

  if (nav.visible && !editing && nav.domain) {
    const { sub, main } = splitDomain(nav.domain);
    return (
      <div className="omni" role="group" aria-label="Sitio abierto">
        <button type="button" className="where" onClick={() => setEditing(true)} aria-label={`Estás en ${nav.domain}. Buscar otra cosa`}>
          {/* El candado (muted) solo indica conexión cifrada; nunca aprueba el sitio. */}
          {nav.encrypted ? (
            <Icon name="lock" size="sm" />
          ) : !nav.secure ? (
            <span className="insecure">
              <span className="insecure-icon">
                <Icon name="triangle-alert" size="sm" />
              </span>
              <span className="insecure-text">Conexión no segura</span>
            </span>
          ) : null}
          <span className="k-estas">Estás en</span>
          <span className="dom">
            {sub ? <span className="sub">{sub}</span> : null}
            <b>{main}</b>
          </span>
        </button>
        {/*
          Protección de sitios: junto al dominio, en la interfaz del navegador (la página no puede taparlo).
          Si no entra sin cortar el dominio, va en la franja de abajo (SiteCheckUnderBar).
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
