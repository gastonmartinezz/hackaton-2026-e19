/**
 * Defensa en profundidad: el resumen llega del preload ya depurado, pero el
 * preload corre junto a contenido no confiable. El proceso principal vuelve a
 * depurar cada campo antes de enviarlo.
 */
import { isPersonalizedText, redactText, sanitizeLabel, sanitizeLinkText, sanitizeTitle, sanitizeUrl } from '@asistente/privacy';
import { PageSummary, SiteCheckLimits } from '@hackaton/contracts';

export function resanitizeSummary(input: PageSummary): PageSummary {
  const lines = input.text
    .split('\n')
    .map((line) => redactText(line, { maxLength: 400 }))
    .filter((line) => line && !isPersonalizedText(line));
  let text = '';
  for (const line of lines) {
    if (text.length + line.length + 1 > SiteCheckLimits.maxTextLength) break;
    text = text ? `${text}\n${line}` : line;
  }
  const summary: PageSummary = {
    text,
    forms: input.forms.map((form) => ({
      method: form.method,
      action: form.action ? sanitizeUrl(form.action) : null,
      fields: form.fields.map((field) => {
        const label = field.label ? sanitizeLabel(field.label, 120) : '';
        return { type: field.type, ...(label ? { label } : {}), ...(field.autocomplete ? { autocomplete: field.autocomplete } : {}) };
      }),
    })),
    links: input.links.flatMap((link) => {
      const href = sanitizeUrl(link.href);
      const linkText = sanitizeLinkText(link.text, 200);
      return href && linkText ? [{ text: linkText, href }] : [];
    }),
  };
  const title = input.title ? sanitizeTitle(input.title, 200) : '';
  if (title) summary.title = title;
  if (input.language) summary.language = input.language;
  const brand = input.declaredBrand ? sanitizeLabel(input.declaredBrand, 120) : '';
  if (brand) summary.declaredBrand = brand;
  // Lo que no cumpla el contrato después de depurar no sale.
  return PageSummary.parse(summary);
}
