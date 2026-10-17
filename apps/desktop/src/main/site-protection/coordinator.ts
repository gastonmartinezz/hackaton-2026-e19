/**
 * Coordinador de «Protección de sitios» en el proceso principal.
 *
 * Por cada navegación principal genera un `navigationId` nuevo, limpia al
 * instante el estado anterior y consulta POST /v1/site-check en dos fases:
 * dirección (`contentVersion: 0`, sin `page`) al empezar y contenido
 * (`contentVersion >= 1`, resumen sanitizado) después de la carga y ante
 * cambios relevantes (ruta SPA, formularios, identidad) con debounce y tope.
 *
 * El estado del indicador sale siempre de `siteIndicatorState()` del contrato.
 * Reglas propias del navegador:
 * - Direcciones locales/privadas no se envían (`local`).
 * - Error, tiempo vencido o resumen imposible → `unverified`.
 * - Respuestas de otra navegación se descartan. De la misma navegación solo se
 *   aplica la última versión pedida; una versión anterior se usa únicamente si
 *   trae un riesgo mayor que el mostrado (aviso temprano).
 * - Dentro de una navegación el riesgo no baja: una respuesta posterior más
 *   favorable no borra «Posible estafa» ni «Atención».
 */
import { randomUUID } from 'node:crypto';
import { siteIndicatorState, type PageSummary, type ReasonCode, type SiteCheckResponse } from '@hackaton/contracts';
import type { SiteIndicatorKind } from '../../shared/site-check-copy';
import { isAbort, type ApiClient } from '../api/client';
import { log } from '../log';
import { checkEligibility, type Eligibility } from './eligibility';

export interface SiteProtectionDeps {
  api: Pick<ApiClient, 'siteCheck'>;
  /** Resumen sanitizado de la página actual (preload + nueva depuración en el principal). */
  summarize(navigationId: string, contentVersion: number): Promise<PageSummary>;
  onChange(): void;
  /** Tiempo máximo por consulta. */
  requestTimeoutMs?: number;
  /** Espera después de la carga antes de leer la página. */
  settleMs?: number;
  /** Agrupa cambios seguidos de la página en un solo reanálisis. */
  debounceMs?: number;
  /** Separación mínima entre dos resúmenes de contenido. */
  minIntervalMs?: number;
  /** Reanálisis automáticos por navegación (sin contar la carga ni «Intentar de nuevo»). */
  maxReanalyses?: number;
  /** Si el contenido queda «pendiente» sin nada en curso, pasa a «No pudimos verificarlo». */
  stuckMs?: number;
}

export interface SiteProtectionSnapshot {
  navigationId: string | null;
  kind: SiteIndicatorKind;
  /** Respuesta que produjo el estado mostrado (null si no hubo). */
  response: SiteCheckResponse | null;
  /** Advertencia de riesgo alto abierta. */
  warningOpen: boolean;
  panelOpen: boolean;
  announcement: { id: number; kind: SiteIndicatorKind } | null;
}

type Target = Extract<Eligibility, { kind: 'eligible' }>;

interface NavState {
  id: string;
  target: Target | null;
  kind: SiteIndicatorKind;
  response: SiteCheckResponse | null;
  latestRequested: number;
  loaded: boolean;
  reanalyses: number;
  lastContentAt: number;
  controllers: Set<AbortController>;
  timers: Set<ReturnType<typeof setTimeout>>;
  debounce: ReturnType<typeof setTimeout> | undefined;
  stuck: ReturnType<typeof setTimeout> | undefined;
  warningOpen: boolean;
  /** Motivos de fraude ya vistos cuando la persona eligió continuar; null si no continuó. */
  acknowledged: Set<ReasonCode> | null;
  lastAnnounced: SiteIndicatorKind | null;
}

const SEVERITY: Partial<Record<SiteIndicatorKind, number>> = { possible_scam: 3, attention: 2 };
const severity = (kind: SiteIndicatorKind) => SEVERITY[kind] ?? 0;

export class SiteProtection {
  #nav: NavState | null = null;
  #panelOpen = false;
  #announcement: { id: number; kind: SiteIndicatorKind } | null = null;
  #announceSeq = 0;
  readonly #opts: Required<Omit<SiteProtectionDeps, 'api' | 'summarize' | 'onChange'>>;

  constructor(private readonly deps: SiteProtectionDeps) {
    this.#opts = {
      requestTimeoutMs: deps.requestTimeoutMs ?? 15_000,
      settleMs: deps.settleMs ?? 400,
      debounceMs: deps.debounceMs ?? 1500,
      minIntervalMs: deps.minIntervalMs ?? 5000,
      maxReanalyses: deps.maxReanalyses ?? 6,
      stuckMs: deps.stuckMs ?? 20_000,
    };
  }

  get snapshot(): SiteProtectionSnapshot {
    const nav = this.#nav;
    return {
      navigationId: nav?.id ?? null,
      kind: nav?.kind ?? 'none',
      response: nav?.response ?? null,
      warningOpen: nav?.warningOpen ?? false,
      panelOpen: this.#panelOpen && nav !== null && nav.kind !== 'none',
      announcement: this.#announcement,
    };
  }

  /** Sitio revisado en la navegación actual (no el de la página anterior, que puede seguir visible). */
  get target(): { hostname: string; registrableDomain: string } | null {
    const target = this.#nav?.target;
    return target ? { hostname: target.hostname, registrableDomain: target.registrableDomain } : null;
  }

  /** Riesgo alto en la navegación actual: la guía pausa las indicaciones sensibles. */
  get highRisk(): boolean {
    return this.#nav?.kind === 'possible_scam';
  }

  /* ------------------------------ Navegación ------------------------------ */

  /** Empieza una navegación principal (o una redirección a otro documento). */
  navigationStarted(url: string): void {
    this.#dispose();
    this.#panelOpen = false;
    const eligibility = checkEligibility(url);
    if (eligibility.kind === 'none') {
      this.#nav = null;
      this.deps.onChange();
      return;
    }
    const nav = this.#newNav(eligibility.kind === 'eligible' ? eligibility : null);
    this.#nav = nav;
    if (eligibility.kind === 'local') {
      nav.kind = 'local';
      log('site_check.skipped', { kind: 'kind:local' });
    } else if (eligibility.kind === 'unsupported') {
      nav.kind = 'unverified';
      log('site_check.skipped', { kind: 'kind:unsupported' });
    } else {
      void this.#request(nav, 0);
    }
    this.deps.onChange();
  }

  /** El documento nuevo cargó: después de un instante se envía el resumen. */
  pageLoaded(url: string): void {
    const nav = this.#nav;
    const eligibility = checkEligibility(url);
    const host = eligibility.kind === 'eligible' ? eligibility.hostname : null;
    // Sin navegación previa registrada (o con otro sitio): se empieza de cero.
    if (!nav || (nav.target?.hostname ?? null) !== host || (nav.kind === 'local') !== (eligibility.kind === 'local')) {
      this.navigationStarted(url);
    }
    const current = this.#nav;
    if (!current?.target || current.loaded) return;
    current.loaded = true;
    if (eligibility.kind === 'eligible') current.target = eligibility;
    this.#later(current, this.#opts.settleMs, () => void this.#sendContent(current));
  }

  /** Cambio de ruta dentro del mismo documento (SPA). */
  routeChanged(url: string): void {
    const nav = this.#nav;
    if (!nav?.target) return;
    const eligibility = checkEligibility(url);
    if (eligibility.kind !== 'eligible' || eligibility.hostname !== nav.target.hostname) {
      this.navigationStarted(url);
      return;
    }
    nav.target = eligibility;
    // Lo favorable de la ruta anterior no vale para la nueva; un riesgo detectado sí se mantiene.
    if (severity(nav.kind) === 0 && nav.kind !== 'checking') {
      nav.kind = 'checking';
      nav.response = null;
      this.deps.onChange();
    }
    this.#schedule(nav);
  }

  /** Cambió la estructura de formularios o la identidad declarada. */
  contentChanged(): void {
    const nav = this.#nav;
    if (nav?.target && nav.loaded) this.#schedule(nav);
  }

  /** La página no cargó: no hay nada que revisar ni mostrar. */
  loadFailed(): void {
    this.clear();
  }

  /** Inicio: sin sitio abierto. */
  clear(): void {
    this.#dispose();
    this.#nav = null;
    this.#panelOpen = false;
    this.deps.onChange();
  }

  /* ---------------------------- Acciones de la UI ---------------------------- */

  /** «Intentar de nuevo». No cuenta para el tope automático. */
  retry(): void {
    const nav = this.#nav;
    if (!nav?.target) return;
    if (severity(nav.kind) === 0) {
      nav.kind = 'checking';
      nav.response = null;
    }
    this.deps.onChange();
    if (nav.loaded) void this.#sendContent(nav);
    else void this.#request(nav, 0);
  }

  setPanelOpen(open: boolean): void {
    this.#panelOpen = open && this.#nav !== null;
    this.deps.onChange();
  }

  /** «Continuar de todos modos»: no se vuelve a interrumpir salvo que aparezcan motivos nuevos. */
  continueAnyway(): void {
    const nav = this.#nav;
    if (!nav?.warningOpen) return;
    nav.warningOpen = false;
    nav.acknowledged = fraudCodes(nav.response);
    log('site_check.continued');
    this.deps.onChange();
  }

  /* -------------------------------- Interno -------------------------------- */

  #newNav(target: Target | null): NavState {
    return {
      id: `nav-${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      target,
      kind: 'checking',
      response: null,
      latestRequested: -1,
      loaded: false,
      reanalyses: 0,
      lastContentAt: 0,
      controllers: new Set(),
      timers: new Set(),
      debounce: undefined,
      stuck: undefined,
      warningOpen: false,
      acknowledged: null,
      lastAnnounced: null,
    };
  }

  /** Cancela todo lo de la navegación anterior: sus respuestas ya no pueden aplicarse. */
  #dispose(): void {
    const nav = this.#nav;
    if (!nav) return;
    for (const controller of nav.controllers) controller.abort();
    for (const timer of nav.timers) clearTimeout(timer);
    if (nav.debounce) clearTimeout(nav.debounce);
    if (nav.stuck) clearTimeout(nav.stuck);
    nav.controllers.clear();
    nav.timers.clear();
  }

  #later(nav: NavState, ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      nav.timers.delete(timer);
      if (this.#nav === nav) run();
    }, ms);
    nav.timers.add(timer);
  }

  /** Reanálisis automático: debounce, separación mínima y tope por navegación. */
  #schedule(nav: NavState): void {
    if (!nav.loaded) return;
    if (nav.reanalyses >= this.#opts.maxReanalyses) {
      log('site_check.rate_limited', { count: nav.reanalyses });
      return;
    }
    if (nav.debounce) clearTimeout(nav.debounce);
    nav.debounce = setTimeout(() => {
      nav.debounce = undefined;
      if (this.#nav !== nav) return;
      const wait = nav.lastContentAt + this.#opts.minIntervalMs - Date.now();
      const fire = () => {
        if (this.#nav !== nav || nav.reanalyses >= this.#opts.maxReanalyses) return;
        nav.reanalyses++;
        void this.#sendContent(nav);
      };
      if (wait > 0) this.#later(nav, wait, fire);
      else fire();
    }, this.#opts.debounceMs);
  }

  async #sendContent(nav: NavState): Promise<void> {
    if (this.#nav !== nav || !nav.target) return;
    const version = Math.max(nav.latestRequested, 0) + 1;
    nav.latestRequested = version;
    nav.lastContentAt = Date.now();
    let page: PageSummary;
    try {
      page = await this.deps.summarize(nav.id, version);
    } catch {
      if (this.#nav !== nav || version !== nav.latestRequested) return;
      log('site_check.summary_failed', { version });
      this.#fail(nav, version);
      return;
    }
    await this.#request(nav, version, page);
  }

  async #request(nav: NavState, version: number, page?: PageSummary): Promise<void> {
    if (this.#nav !== nav || !nav.target) return;
    nav.latestRequested = Math.max(nav.latestRequested, version);
    if (nav.stuck) clearTimeout(nav.stuck);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#opts.requestTimeoutMs);
    nav.controllers.add(controller);
    const { url, hostname, registrableDomain } = nav.target;
    const started = Date.now();
    try {
      const response = await this.deps.api.siteCheck(
        { navigationId: nav.id, contentVersion: version, url, hostname, registrableDomain, ...(page ? { page } : {}) },
        controller.signal,
      );
      log('site_check.response', { version, ms: Date.now() - started, status: `code:${response.status}`, risk: `code:${response.risk}` });
      this.#apply(nav, version, response);
    } catch (error) {
      if (this.#nav !== nav) return;
      if (isAbort(error) && !timedOut) return;
      log('site_check.failed', { version, timeout: timedOut });
      this.#fail(nav, version);
    } finally {
      clearTimeout(timer);
      nav.controllers.delete(controller);
    }
  }

  #apply(nav: NavState, version: number, response: SiteCheckResponse): void {
    if (this.#nav !== nav || response.navigationId !== nav.id || response.contentVersion !== version) {
      log('site_check.discarded', { kind: 'kind:navigation', version });
      return;
    }
    const kind = siteIndicatorState(response);
    if (version !== nav.latestRequested && severity(kind) <= severity(nav.kind)) {
      log('site_check.discarded', { kind: 'kind:stale_version', version });
      return;
    }
    if (severity(kind) < severity(nav.kind)) {
      // El riesgo no baja dentro de la misma navegación.
      log('site_check.kept_risk', { version });
      return;
    }
    nav.kind = kind;
    nav.response = response;
    if (kind === 'checking' && version > 0 && version === nav.latestRequested) {
      // Contenido «pendiente» sin otra consulta prevista: no quedarse revisando para siempre.
      nav.stuck = setTimeout(() => {
        if (this.#nav === nav && nav.kind === 'checking') this.#fail(nav, nav.latestRequested);
      }, this.#opts.stuckMs);
    }
    this.#afterChange(nav);
  }

  #fail(nav: NavState, version: number): void {
    if (this.#nav !== nav || version !== nav.latestRequested) return;
    if (severity(nav.kind) > 0) {
      this.deps.onChange();
      return;
    }
    nav.kind = 'unverified';
    nav.response = null;
    this.#afterChange(nav);
  }

  #afterChange(nav: NavState): void {
    if (nav.kind === 'possible_scam') {
      const codes = fraudCodes(nav.response);
      const increased = nav.acknowledged !== null && [...codes].some((code) => !nav.acknowledged!.has(code));
      if (!nav.warningOpen && (nav.acknowledged === null || increased)) {
        nav.warningOpen = true;
        this.#panelOpen = false;
        log('site_check.warning', { reopened: increased });
      }
    }
    if (nav.kind !== 'checking' && nav.kind !== 'none' && nav.kind !== nav.lastAnnounced) {
      nav.lastAnnounced = nav.kind;
      this.#announcement = { id: ++this.#announceSeq, kind: nav.kind };
    }
    this.deps.onChange();
  }
}

function fraudCodes(response: SiteCheckResponse | null): Set<ReasonCode> {
  return new Set(response?.reasons.filter((r) => r.category === 'fraud').map((r) => r.code) ?? []);
}
