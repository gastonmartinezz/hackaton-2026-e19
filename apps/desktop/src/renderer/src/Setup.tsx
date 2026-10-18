/**
 * Pantalla inicial: condiciones de uso y datos opcionales (localidad y edad)
 * para que el asistente muestre páginas de la zona de la persona. Aparece la
 * primera vez y cuando cambian las condiciones. No tiene pantalla en v2.2: usa
 * el fondo y la tarjeta de las pantallas propias.
 */
import { Button, TextField } from '@asistente/ui';
import type { AgeRange } from '@hackaton/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import type { AppState } from '../../shared/ipc';
import { send } from './useAppState';

const COUNTRIES = ['AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'US', 'UY', 'VE'];

const AGE_RANGES: Array<[AgeRange, string]> = [
  ['under-50', 'Menos de 50 años'],
  ['50-64', 'Entre 50 y 64 años'],
  ['65-74', 'Entre 65 y 74 años'],
  ['75-plus', '75 años o más'],
];

export function Setup({ state, onDone }: { state: AppState; onDone?: () => void }) {
  const { profile } = state;
  const [country, setCountry] = useState(profile.country ?? (profile.termsAccepted ? '' : (profile.suggestedCountry ?? '')));
  const [region, setRegion] = useState(profile.region);
  const [city, setCity] = useState(profile.city);
  const [ageRange, setAgeRange] = useState<AgeRange | ''>(profile.ageRange ?? '');
  const [accepted, setAccepted] = useState(profile.termsAccepted);

  const countries = useMemo(() => {
    const names = new Intl.DisplayNames(['es'], { type: 'region' });
    const codes = new Set(COUNTRIES);
    if (profile.suggestedCountry) codes.add(profile.suggestedCountry);
    if (profile.country) codes.add(profile.country);
    return [...codes].map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [profile.suggestedCountry, profile.country]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!accepted) return;
    send({ type: 'saveProfile', acceptTerms: true, country: country || null, region, city, ageRange: ageRange || null });
    onDone?.();
  };

  return (
    <main className="setup g-ground">
      <form onSubmit={submit}>
        <h1>{profile.termsAccepted ? 'Mis datos' : 'Antes de empezar'}</h1>
        <p>
          Contanos dónde vivís para mostrarte páginas de tu zona. Todos los datos son opcionales y quedan guardados en esta computadora.
        </p>

        <fieldset>
          <legend>¿Dónde vivís?</legend>
          <div className="ui-field">
            <label htmlFor="setup-country">País</label>
            <select id="setup-country" className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Prefiero no decirlo</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <TextField label="Provincia o estado" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} autoComplete="off" />
          <TextField
            label="Ciudad o localidad"
            hint="Solo la ciudad o el barrio. No escribas tu dirección."
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={80}
            autoComplete="off"
          />
        </fieldset>

        <fieldset>
          <legend>¿Cuántos años tenés?</legend>
          <p className="setup-hint">Nos ayuda a elegir mejor, por ejemplo, páginas para jubilados. Nunca se envía la edad exacta.</p>
          <div className="ui-field">
            <label htmlFor="setup-age">Edad</label>
            <select id="setup-age" className="field" value={ageRange} onChange={(e) => setAgeRange(e.target.value as AgeRange | '')}>
              <option value="">Prefiero no decirlo</option>
              {AGE_RANGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <Terms />

        <label className="toggle">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          Leí y acepto las condiciones de uso
        </label>

        <div className="row">
          <Button type="submit" variant="primary" disabled={!accepted}>
            {profile.termsAccepted ? 'Guardar' : 'Guardar y empezar'}
          </Button>
          {onDone ? (
            <Button variant="link" onClick={onDone}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </form>
    </main>
  );
}

function Terms() {
  return (
    <section className="terms" aria-labelledby="terms-title" tabIndex={0}>
      <h2 id="terms-title">Condiciones de uso</h2>
      <ol>
        <li>
          El asistente usa inteligencia artificial para sugerirte páginas y guiarte dentro de ellas. Puede equivocarse: revisá siempre lo que te
          propone antes de seguir.
        </li>
        <li>Las páginas que abrís son de terceros. No somos responsables de su contenido, de su seguridad ni de lo que pase en ellas.</li>
        <li>
          Vos decidís qué hacer en cada página. Lo que escribas, envíes, compres o pagues es tu responsabilidad: el asistente solo sugiere y no
          actúa por vos.
        </li>
        <li>Las sugerencias no son asesoramiento legal, médico ni financiero.</li>
        <li>
          Para responderte, se envía al servidor del asistente lo que escribís en el chat (sin números largos, correos ni claves), los datos de
          esta pantalla, el idioma y la zona horaria de la computadora, y partes de las páginas en las que pedís ayuda.
        </li>
        <li>Nunca escribas contraseñas, números de tarjeta ni datos bancarios en el chat.</li>
        <li>Podés cambiar tus datos cuando quieras desde «Mis datos».</li>
      </ol>
    </section>
  );
}
