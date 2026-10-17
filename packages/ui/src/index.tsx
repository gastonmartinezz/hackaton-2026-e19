/**
 * Componentes funcionales básicos de prueba (Gaston). Reemplazables por la UI
 * final de Emi sin tocar la lógica: reciben datos y callbacks, nada más.
 */
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

export { Icon, type IconName } from './icons';

export function Button({
  variant = 'secondary',
  type = 'button',
  ...props
}: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' }) {
  return <button {...props} type={type} className="ui-button" data-variant={variant} />;
}

export function TextField({
  label,
  hint,
  ...props
}: ComponentPropsWithRef<'input'> & { label: string; hint?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <input {...props} id={id} aria-describedby={hint ? hintId : undefined} />
      {hint ? (
        <span id={hintId} className="ui-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
  urgent = false,
}: {
  tone?: 'neutral' | 'info' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
  /** Usa role="alert" (interrumpe al lector de pantalla). Solo para errores. */
  urgent?: boolean;
}) {
  return (
    <div className="ui-notice" data-tone={tone} role={urgent ? 'alert' : undefined}>
      {title ? <p className="ui-notice-title">{title}</p> : null}
      {children}
    </div>
  );
}

export function LoadingMessage({ children }: { children: ReactNode }) {
  return (
    <p className="ui-loading" role="status">
      {children}
    </p>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ui-visually-hidden">{children}</span>;
}
