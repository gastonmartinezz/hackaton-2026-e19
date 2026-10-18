/**
 * Datos de la persona que acompañan cada /v1/interpret para que Claude priorice
 * sitios de su localidad. Salen de la pantalla inicial (prefs) y del equipo
 * (idioma y zona horaria). Los textos libres pasan por el filtro de privacidad:
 * si alguien escribe su dirección o un teléfono, no sale del equipo.
 */
import { UserContext } from '@hackaton/contracts';
import { sanitizeLabel } from '@asistente/privacy';
import type { Profile } from './prefs';

export interface SystemInfo {
  /** Idioma preferido del sistema, por ejemplo "es-UY". */
  language: string | null;
  /** Zona horaria IANA del equipo. */
  timeZone: string | null;
  /** País de la configuración regional del sistema (ISO 3166-1), para sugerirlo. */
  country: string | null;
}

/**
 * Una localidad no lleva números ni palabras de dirección; una dirección, una
 * esquina o un código postal, sí. Los únicos números aceptados son los de
 * nombres de fecha ("25 de Mayo", "Partido de 9 de Julio").
 */
const DATE_NAME = /(?<![\p{L}\p{N}])\d{1,2} de \p{L}+/gu;
const ADDRESS_WORDS =
  /(?<![\p{L}\p{N}])(?:calle|avenida|avda|av|pasaje|pje|esquina|esq|piso|dpto|depto|nro|n[°º]|manzana|mz|lote|y)(?![\p{L}\p{N}])/iu;

export function buildUserContext(profile: Profile, system: SystemInfo): UserContext | undefined {
  const region = place(profile.region);
  const city = place(profile.city);
  const location = {
    ...(profile.country ? { country: profile.country } : {}),
    ...(region ? { region } : {}),
    ...(city ? { city } : {}),
  };
  const context: UserContext = {
    ...(Object.keys(location).length > 0 ? { location } : {}),
    ...(profile.ageRange ? { ageRange: profile.ageRange } : {}),
    ...valid('language', system.language),
    ...valid('timeZone', system.timeZone),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

/**
 * El nombre de una persona no se puede distinguir del de un lugar ("Florencio
 * Varela", "José C. Paz"): para eso está el aviso del campo en la pantalla.
 */
function place(raw: string): string {
  const label = sanitizeLabel(raw, 80);
  return /\d/.test(label.replace(DATE_NAME, '')) || ADDRESS_WORDS.test(label) ? '' : label;
}

/** Lo que entrega el sistema no se controla: si no cumple el contrato, no se envía. */
function valid(key: 'language' | 'timeZone', value: string | null) {
  return value && UserContext.shape[key].safeParse(value).success ? { [key]: value } : {};
}
