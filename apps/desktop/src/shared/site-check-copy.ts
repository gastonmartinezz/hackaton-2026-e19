/**
 * Textos revisados de «Protección de sitios» para personas mayores. El estado
 * del indicador sale de `siteIndicatorState()` del contrato (más los estados
 * propios del navegador: página local o sin sitio). La explicación de la IA solo
 * se muestra como complemento dentro de los detalles: nunca decide etiquetas,
 * títulos ni acciones.
 *
 * Reglas: ícono + texto siempre; nunca «seguro»; sin porcentajes ni jerga; el
 * candado solo significa conexión cifrada.
 */
import type { ReasonCode, SiteCheckResponse, SiteIndicatorState } from '@hackaton/contracts';

/** Estados del indicador: los del contrato más `local` (no se envía) y `none` (sin sitio). */
export type SiteIndicatorKind = SiteIndicatorState | 'local' | 'none';

export type SiteCheckTone = 'neutral' | 'positive' | 'warning' | 'danger';

export type SiteCheckActionId = 'close' | 'leave' | 'retry' | 'continue';

export interface SiteCheckAction {
  id: SiteCheckActionId;
  label: string;
}

export interface SiteCheckPanelCopy {
  title: string;
  /** Una o dos frases. */
  body: string[];
  primary: SiteCheckAction;
  secondary: SiteCheckAction | null;
  /** «Ver por qué»: motivos en lenguaje simple, cerrados al abrir. */
  reasons: string[];
  /** Aviso de revisión incompleta, dentro de los detalles. */
  coverageNote: string | null;
  /** Complemento de la IA (nunca etiqueta ni acción). */
  explanation: string | null;
}

export interface SiteCheckCopy {
  label: string;
  /** Nombre del ícono; el texto acompaña siempre. */
  icon: Exclude<SiteIndicatorKind, 'none'>;
  tone: SiteCheckTone;
  panel: SiteCheckPanelCopy;
}

export const INDICATOR_LABELS: Record<Exclude<SiteIndicatorKind, 'none'>, string> = {
  checking: 'Revisando sitio…',
  official: 'Sitio oficial',
  no_alerts: 'Sin alertas detectadas',
  attention: 'Atención',
  possible_scam: 'Posible estafa',
  unverified: 'No pudimos verificarlo',
  local: 'Página local, sin revisar',
};

const TONES: Record<Exclude<SiteIndicatorKind, 'none'>, SiteCheckTone> = {
  checking: 'neutral',
  official: 'positive',
  no_alerts: 'neutral',
  attention: 'warning',
  possible_scam: 'danger',
  unverified: 'warning',
  local: 'neutral',
};

/** Frase simple por motivo. Sin porcentajes ni términos técnicos. */
export const REASON_TEXT: Record<ReasonCode, string> = {
  KNOWN_PHISHING: 'Figura en listas de sitios que intentan robar datos.',
  KNOWN_MALWARE: 'Figura en listas de sitios que pueden dañar tu equipo.',
  LOOKALIKE_DOMAIN: 'La dirección se parece a la de un sitio conocido, pero no es la misma.',
  CONFUSABLE_CHARACTERS: 'La dirección usa letras que se confunden con otras.',
  MISLEADING_SUBDOMAIN: 'La dirección incluye el nombre de otro sitio para confundir.',
  BRAND_IMPERSONATION: 'La página usa el nombre o la imagen de otra organización.',
  SENSITIVE_DATA_REQUEST: 'La página pide datos delicados, como contraseñas, códigos o números de tarjeta.',
  FORM_SENDS_TO_OTHER_DOMAIN: 'Lo que escribas en esta página se enviaría a otro sitio.',
  LINK_TEXT_MISMATCH: 'Algunos enlaces muestran una dirección pero llevan a otra.',
  URGENCY_OR_THREAT: 'La página te apura o te amenaza para que actúes rápido.',
  RECENTLY_REGISTERED: 'La dirección se creó hace muy poco tiempo.',
  NO_HTTPS: 'La conexión con este sitio no está cifrada.',
  CERTIFICATE_PROBLEM: 'La conexión con este sitio tiene un problema de certificado.',
  CROSS_DOMAIN_REDIRECT: 'Te llevó a un sitio distinto del que abriste.',
  INSECURE_FORM_ACTION: 'Un formulario de esta página enviaría datos sin cifrar.',
};

/** Motivos que justifican decir «parece imitar a…». */
const IMPERSONATION: ReadonlySet<ReasonCode> = new Set(['BRAND_IMPERSONATION', 'LOOKALIKE_DOMAIN', 'CONFUSABLE_CHARACTERS', 'MISLEADING_SUBDOMAIN']);

const CLOSE: SiteCheckAction = { id: 'close', label: 'Entendido' };
const LEAVE: SiteCheckAction = { id: 'leave', label: 'Salir de este sitio' };
const RETRY: SiteCheckAction = { id: 'retry', label: 'Intentar de nuevo' };
export const CONTINUE_ACTION: SiteCheckAction = { id: 'continue', label: 'Continuar de todos modos' };

const NO_DATA = 'No ingreses contraseñas ni códigos.';

export function reasonPhrases(response: SiteCheckResponse | null): string[] {
  if (!response) return [];
  const ordered = [...response.reasons].sort((a, b) => Number(a.category === 'technical') - Number(b.category === 'technical'));
  const codes = [...new Set(ordered.map((r) => r.code))];
  const imitated = response.identity.impersonatedOrganization;
  return codes.map((code) =>
    code === 'BRAND_IMPERSONATION' && imitated ? `La página usa el nombre de ${imitated}, pero la dirección no es de ${imitated}.` : REASON_TEXT[code],
  );
}

/** Frase principal de «Posible estafa», acorde al motivo real. */
export function scamSummary(response: SiteCheckResponse | null): string {
  const codes = new Set(response?.reasons.map((r) => r.code) ?? []);
  const imitated = response?.identity.impersonatedOrganization;
  if (imitated && [...codes].some((c) => IMPERSONATION.has(c))) return `Este sitio parece imitar a ${imitated}. ${NO_DATA}`;
  if (codes.has('KNOWN_PHISHING')) return `Este sitio figura en listas de sitios que intentan robar datos. ${NO_DATA}`;
  if (codes.has('KNOWN_MALWARE')) return 'Este sitio figura en listas de sitios que pueden dañar tu equipo. No descargues nada ni ingreses datos.';
  if (codes.has('LOOKALIKE_DOMAIN') || codes.has('CONFUSABLE_CHARACTERS') || codes.has('MISLEADING_SUBDOMAIN')) {
    return `La dirección se parece a la de otro sitio, pero no es la misma. ${NO_DATA}`;
  }
  return `Encontramos señales de estafa en este sitio. ${NO_DATA}`;
}

function coverageNote(response: SiteCheckResponse | null): string | null {
  if (!response) return null;
  const levels = Object.values(response.coverage);
  const incomplete = response.status === 'partial' || response.status === 'unavailable' || levels.some((l) => l === 'partial' || l === 'unavailable');
  return incomplete ? 'Algunas comprobaciones no estuvieron disponibles, así que la revisión no está completa.' : null;
}

/** Textos del indicador y del panel para un estado. `response` es la respuesta que lo produjo, si la hay. */
export function siteCheckCopy(kind: Exclude<SiteIndicatorKind, 'none'>, response: SiteCheckResponse | null = null): SiteCheckCopy {
  const label = INDICATOR_LABELS[kind];
  const details = {
    reasons: reasonPhrases(response),
    coverageNote: coverageNote(response),
    explanation: response?.explanation ?? null,
  };
  const panel = ((): SiteCheckPanelCopy => {
    switch (kind) {
      case 'checking':
        return {
          title: label,
          body: ['Estamos revisando esta página. Mientras tanto, esperá antes de ingresar datos personales.'],
          primary: CLOSE,
          secondary: null,
          ...details,
          reasons: [],
        };
      case 'official':
        return {
          title: label,
          body: [`La dirección pertenece a ${response?.identity.organization ?? 'una organización registrada'}, según nuestro registro de sitios oficiales.`],
          primary: CLOSE,
          secondary: null,
          ...details,
        };
      case 'no_alerts':
        return {
          title: label,
          body: ['No encontramos señales de estafa en las comprobaciones realizadas.', 'Esto no garantiza que el sitio sea confiable.'],
          primary: CLOSE,
          secondary: null,
          ...details,
        };
      case 'attention':
        return {
          title: label,
          body: ['Encontramos algo que conviene revisar antes de seguir.', 'Si tenés dudas, no ingreses datos personales ni contraseñas.'],
          primary: CLOSE,
          secondary: LEAVE,
          ...details,
        };
      case 'possible_scam':
        return { title: label, body: [scamSummary(response)], primary: LEAVE, secondary: null, ...details };
      case 'unverified':
        return {
          title: label,
          body: ['No pudimos completar la revisión. Tené cuidado antes de ingresar datos personales.'],
          primary: RETRY,
          secondary: null,
          ...details,
        };
      case 'local':
        return {
          title: label,
          body: ['Esta página está en tu equipo o en una red privada, como las páginas de prueba. No la enviamos a revisar.'],
          primary: CLOSE,
          secondary: null,
          reasons: [],
          coverageNote: null,
          explanation: null,
        };
    }
  })();
  return { label, icon: kind, tone: TONES[kind], panel };
}

/** Texto para el anuncio accesible de un cambio de estado relevante. */
export function announcementText(kind: Exclude<SiteIndicatorKind, 'none' | 'checking'>, response: SiteCheckResponse | null = null): string {
  if (kind === 'possible_scam') return `Posible estafa. ${scamSummary(response)}`;
  if (kind === 'official' && response?.identity.organization) return `Sitio oficial de ${response.identity.organization}.`;
  return `Estado del sitio: ${INDICATOR_LABELS[kind]}.`;
}
