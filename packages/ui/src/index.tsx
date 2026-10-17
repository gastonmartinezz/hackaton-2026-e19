/// <reference path="./assets.d.ts" />
/**
 * Componentes de presentación de Mostrame (diseño de Emi, v1.5). Reciben datos
 * y callbacks, nada más: no conocen el estado de la app ni llaman al backend.
 * Estilos en mostrame.css; valores en design/tokens.css.
 */
import { useId, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode } from 'react';
import logoUrl from '../../../design/brand/mostrame-logo.svg?url';
import symbolUrl from '../../../design/brand/mostrame-simbolo.svg?url';
import { ICONS, type IconName } from './icons';

export { ICONS, type IconName } from './icons';

/** Ícono decorativo: siempre acompaña un texto visible o un aria-label del control. */
export function Icon({ name, size = 'md' }: { name: IconName; size?: 'sm' | 'md' | 'lg' }) {
  return <span className="ic" data-size={size} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}

/** Logo horizontal. Solo los SVG de design/brand, sin recolorear ni deformar. */
export function Logo({ className }: { className?: string }) {
  return <img className={className} src={logoUrl} alt="Mostrame" />;
}

/** Símbolo decorativo (el nombre ya figura en el texto de al lado). */
export function BrandSymbol({ className }: { className?: string }) {
  return <img className={className} src={symbolUrl} alt="" />;
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'chrome' | 'help';

export function Button({
  variant = 'quiet',
  icon,
  block = false,
  type = 'button',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: IconName; block?: boolean }) {
  return (
    <button {...props} type={type} className={['btn', `btn-${variant}`, block ? 'block' : '', className ?? ''].join(' ').trim()}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

/** Campo con etiqueta visible y ayuda opcional. */
export function TextField({ label, hint, className, ...props }: ComponentPropsWithRef<'input'> & { label: string; hint?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} className={['field', className ?? ''].join(' ').trim()} aria-describedby={hint ? hintId : undefined} />
      {hint ? (
        <span id={hintId} className="ui-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Tres puntos de espera. El texto que acompaña lleva el anuncio (role="status"). */
export function LoadingDots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
