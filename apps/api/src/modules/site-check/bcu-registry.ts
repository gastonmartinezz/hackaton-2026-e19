import { readFileSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { z } from 'zod';
import { BudgetExceededError, withTimeout } from './cache.js';
import { describeHost } from './domain.js';
import { DATA_DIR, normalizeName } from './official-sources.js';
import { errorKind, ProviderHttpError } from './types.js';

/**
 * Registro de instituciones del Banco Central del Uruguay, descargado del regulador.
 *
 * El BCU no publica una API: el registro sale de dos partes de su sitio (verificadas el 18/10/2026).
 * - Superintendencia de Servicios Financieros: listas HTML por tipo de institución
 *   (`Servicios-Financieros-SSF/Paginas/<lista>.aspx`) con el número de cada una (`nroinst`), y su
 *   ficha (`InformacionInstitucion.aspx?nroinst=N`) con razón social, estado y página web
 *   (el enlace cuyo id termina en `HplPaginaWeb`).
 * - Registro del Sistema de Pagos (billeteras, cobranzas, procesadores): POST a `BCUListasHandler.ashx`
 *   con la lista «Datos Generales» y la vista «Publicar» devuelve el listado en JSON (DataTables) con la
 *   página de cada entidad. Esa página no trae el sitio web en el HTML: lo carga con otro POST a la misma
 *   lista con la vista propia de la entidad (`d.viewName = '06'` en Prex).
 * Todo se valida con Zod y cualquier cambio de formato hace fallar la descarga (identidad `unavailable`),
 * nunca una aprobación. El sitio publicado autoriza su dominio registrable y sus subdominios.
 * Para no castigar al BCU: una descarga completa son unos 240 pedidos (unos 50 MB: las fichas traen el
 * HTML entero del portal), 2 en paralelo, con tope de pedidos, una vez por día y con espera creciente
 * entre intentos fallidos.
 *
 * www.bcu.gub.uy no envía la cadena intermedia de su certificado: se agregan los intermedios de
 * `data/bcu-intermediates.pem` (con su origen y vencimiento, hoy el 02/05/2027) solo para ese host.
 */

export const BCU_HOST = 'www.bcu.gub.uy';
export const BCU_SOURCE_NAME = 'Registro de instituciones del BCU';
const ORIGIN = `https://${BCU_HOST}`;
const SSF_PAGES = `${ORIGIN}/Servicios-Financieros-SSF/Paginas/`;
export const BCU_LISTS_HANDLER = `${ORIGIN}/_layouts/15/BCU.Portal2016/BCUListasHandler.ashx`;
const PAYMENTS_SITE = `${ORIGIN}/Sistema-de-Pagos/`;
const PAYMENTS_PAGES = `${PAYMENTS_SITE}Paginas/`;
const PAYMENTS_LIST = 'Datos Generales';

export const bcuFichaUrl = (nroinst: string) => `${SSF_PAGES}InformacionInstitucion.aspx?nroinst=${nroinst}`;

/**
 * Listas de la SSF con instituciones que atienden a personas: las mismas de las que salieron las
 * entradas financieras del catálogo. Quedan afuera los emisores de valores (empresas que cotizan), los
 * intermediarios de valores, las calificadoras, la bolsa, las instituciones financieras externas, los
 * proveedores de activos virtuales y los representantes de entidades extranjeras.
 */
export const SSF_LISTS = [
  { page: 'bancos_Instituciones_Lst.aspx', kind: 'Banco' },
  { page: 'casas_Financieras_Lst.aspx', kind: 'Casa financiera' },
  { page: 'coo_Int_Fin_Lst.aspx', kind: 'Cooperativa de intermediación financiera' },
  { page: 'emp_admin_cred.aspx', kind: 'Empresa administradora de crédito' },
  { page: 'EntidadesOtorCreMayActivi.aspx', kind: 'Entidad otorgante de crédito de mayor actividad' },
  { page: 'emp_Serv_Fin_Lst.aspx', kind: 'Empresa de servicios financieros' },
  { page: 'casas_cambio.aspx', kind: 'Casa de cambio' },
  { page: 'emp_Trans_Fondos_Lst.aspx', kind: 'Empresa de transferencia de fondos' },
  { page: 'emp_Adm_Plat_Prestamos_Lst.aspx', kind: 'Plataforma de préstamos' },
  { page: 'emp_Admin_ahorro_prev_Lst.aspx', kind: 'Administradora de grupos de ahorro previo' },
  { page: 'afaps.aspx', kind: 'Administradora de fondos de ahorro previsional (AFAP)' },
  { page: 'empresas_Seguros.aspx', kind: 'Empresa de seguros' },
] as const;

// Sitios que no identifican a una institución: autorizarlos aprobaría a cualquiera que publique ahí.
const SHARED_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'google.com', 'wa.me', 'whatsapp.com',
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'gub.uy', 'bcu.gub.uy',
]);

const SsfListItem = z.object({ nroinst: z.string().regex(/^\d{1,6}$/), name: z.string().trim().min(1).max(200) });

const SsfFicha = z.object({
  name: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(60),
  tradeName: z.string().trim().max(200),
  website: z.string().trim().max(500),
});

const DataTable = z.object({
  recordsTotal: z.number().int().nonnegative(),
  data: z.array(z.record(z.string(), z.unknown())),
  columnTypes: z.array(z.string()),
});

const PaymentItem = z.object({
  tradeName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  kind: z.string().trim().max(600),
  page: z.string().startsWith(PAYMENTS_PAGES).max(300),
});

export interface BcuInstitution {
  /** `ssf-<nroinst>` o `sp-<página>`. */
  id: string;
  /** Razón social publicada por el BCU. */
  name: string;
  /** Nombre de fantasía o comercial («OCA Card», «Prex»), si lo publica. */
  tradeName: string | null;
  /** Tipo de institución o categorías del Sistema de Pagos. */
  kind: string;
  /** Sitio web tal como lo publica el BCU (a veces, varios separados por comas). */
  website: string;
  /** Dominios registrables (eTLD+1) de los sitios publicados: autorizan ese dominio y sus subdominios. */
  domains: string[];
  /** Ficha de la institución en el BCU (evidencia). */
  sourceUrl: string;
}

export interface RegistrySnapshot {
  institutions: BcuInstitution[];
  /** Instituciones sin sitio web utilizable o que no están activas. */
  skipped: Array<{ id: string; name: string; reason: string }>;
  fetchedAt: string;
}

export interface RegistryState {
  /** fresh: copia vigente. stale: copia vieja usable solo para detectar imitaciones. unavailable: sin copia. */
  status: 'fresh' | 'stale' | 'unavailable';
  snapshot: RegistrySnapshot | null;
  error: string | null;
}

export interface BcuRegistryOptions {
  enabled: boolean;
  /** Reemplazo para pruebas. Por defecto, `bcuFetch` (solo www.bcu.gub.uy, con los intermedios). */
  fetchImpl?: typeof fetch;
  /** Tiempo máximo por petición al BCU. */
  requestTimeoutMs: number;
  /** Se intenta refrescar después de este tiempo. */
  refreshAfterMs: number;
  /** Hasta acá la copia sigue vigente aunque el refresco falle. */
  validForMs: number;
  /** Hasta acá la copia vieja se usa para detectar imitaciones, nunca para aprobar. */
  usableForMs: number;
  /** Espera después del primer intento fallido; se duplica con cada falla seguida, hasta 6 h. */
  retryAfterMs?: number;
  /** Peticiones simultáneas al BCU. */
  concurrency?: number;
  /** Tope de peticiones por descarga completa (hoy son unas 240). */
  maxRequests?: number;
  now?: () => number;
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
let agent: https.Agent | undefined;

/** Agente solo para www.bcu.gub.uy: los CA de Node más los intermedios que el servidor no envía. */
function bcuAgent(): https.Agent {
  agent ??= new https.Agent({ ca: [...rootCertificates, readFileSync(join(DATA_DIR, 'bcu-intermediates.pem'), 'utf8')], keepAlive: true, maxSockets: 4 });
  return agent;
}

/**
 * fetch mínimo para el BCU con node:https: solo https://www.bcu.gub.uy, sin seguir redirecciones,
 * sin cookies y con tope de tamaño. La verificación del certificado queda siempre activa.
 */
export const bcuFetch = ((input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== 'https:' || url.hostname !== BCU_HOST) {
      reject(new Error('Destino no permitido para el registro del BCU'));
      return;
    }
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const request = https.request(
      url,
      {
        method: init?.method ?? 'GET',
        agent: bcuAgent(),
        headers: { 'user-agent': 'MostrameSiteCheck/1.0', ...(init?.headers as Record<string, string> | undefined) },
        signal: init?.signal ?? undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('Respuesta del BCU demasiado grande'));
          else chunks.push(chunk);
        });
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502 })));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(body);
  })) as typeof fetch;

/** Normaliza un sitio web publicado. Devuelve el motivo si no es utilizable. */
export function parseWebsite(raw: string | null | undefined): { website: string; domain: string } | { reason: string } {
  const website = (raw ?? '').trim();
  if (!website) return { reason: 'sin sitio web' };
  if (/\s/.test(website)) return { reason: 'sitio web con espacios' };
  let url: URL;
  try {
    // El BCU a veces publica el esquema dos veces («http://https://avenida.com.uy»).
    url = new URL(/^https?:\/\//i.test(website) ? website.replace(/^(https?:\/\/)+(?=https?:\/\/)/i, '') : `https://${website}`);
  } catch {
    return { reason: 'sitio web inválido' };
  }
  const host = describeHost(url.hostname);
  if (host.internal || host.isIp || !host.registrableDomain) return { reason: 'sitio web no público' };
  if (SHARED_DOMAINS.has(host.registrableDomain)) return { reason: 'sitio web en una plataforma compartida' };
  // Un sitio publicado en un subdominio que no es www (una casa de cambio dentro del dominio de un casino:
  // balumacambio.enjoypuntadeleste.com.uy) autoriza solo ese host y los que cuelgan de él, nunca el dominio
  // registrable entero. La ruta no cambia el alcance: con host propio, `/home` o `/uy` es solo la portada.
  const scoped = host.hostname !== host.registrableDomain && host.hostname !== `www.${host.registrableDomain}`;
  return { website, domain: scoped ? host.hostname : host.registrableDomain };
}

/** Uno o varios sitios separados por comas o punto y coma. Si alguno no es utilizable, se informa el primer motivo. */
export function parseWebsites(raw: string | null | undefined): { domains: string[] } | { reason: string } {
  const parts = (raw ?? '').split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { reason: 'sin sitio web' };
  const domains: string[] = [];
  for (const part of parts) {
    const site = parseWebsite(part);
    if ('reason' in site) return site;
    if (!domains.includes(site.domain)) domains.push(site.domain);
  }
  return { domains };
}

const decodeHtml = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Instituciones de una lista de la SSF (tabla `grdInstituciones`, o `grdInstitucionesGrp` cuando está
 * agrupada, como la de bancos). Sin esa tabla, el formato cambió.
 */
export function parseSsfList(html: string): Array<z.infer<typeof SsfListItem>> {
  const table = /<table\b[^>]*\bid="[^"]*grdInstituciones(?:Grp)?"[^>]*>[\s\S]*?<\/table>/.exec(html)?.[0];
  if (!table) throw new Error('Lista de la SSF sin tabla de instituciones');
  const items = [...table.matchAll(/InformacionInstitucion\.aspx\?nroinst=(\d+)"[^>]*>([^<]*)</g)].map(([, nroinst, name]) =>
    SsfListItem.parse({ nroinst, name: decodeHtml(name ?? '') }),
  );
  return [...new Map(items.map((item) => [item.nroinst, item])).values()];
}

/** Razón social, estado, nombre de fantasía y página web de una ficha de la SSF. */
export function parseSsfFicha(html: string): z.infer<typeof SsfFicha> {
  const text = (id: string) => {
    const match = new RegExp(`<(?:span|a)\\b[^>]*\\bid="[^"]*_${id}"[^>]*>([^<]*)<`).exec(html);
    return match ? decodeHtml(match[1]!) : undefined;
  };
  const link = /<a\b[^>]*\bid="[^"]*_HplPaginaWeb"[^>]*>/.exec(html)?.[0];
  const href = link ? /\bhref="([^"]*)"/.exec(link)?.[1] : undefined;
  return SsfFicha.parse({
    name: text('lblRazonSocial'),
    status: text('lblEstado'),
    tradeName: text('lblNombreFantasia') ?? '',
    // Se usa el texto que muestra el BCU: el href a veces trae el esquema repetido («http://https://…»).
    website: text('HplPaginaWeb') || (href && !href.startsWith('mailto:') ? decodeHtml(href) : ''),
  });
}

/** Valor de una celda URL de DataTables: el href del enlace o la URL de la fila. */
function urlCell(row: Record<string, unknown>, columnTypes: string[]): string {
  const index = columnTypes.indexOf('URL');
  const cell = index >= 0 ? row[String(index)] : undefined;
  const href = typeof cell === 'string' ? /\bhref="([^"]*)"/.exec(cell)?.[1] : undefined;
  if (href) return decodeHtml(href);
  const attr = (row.DT_RowAttr as Record<string, unknown> | undefined)?.['data-href'];
  return typeof attr === 'string' ? attr : '';
}

/** Listado del Sistema de Pagos (vista «Publicar»). Si no vienen todas las filas, falla. */
export function parsePaymentsList(json: unknown): Array<z.infer<typeof PaymentItem>> {
  const table = DataTable.parse(json);
  if (table.data.length !== table.recordsTotal) throw new Error('Listado del Sistema de Pagos incompleto');
  return table.data.map((row) =>
    PaymentItem.parse({ tradeName: decodeHtml(String(row['0'] ?? '')), name: decodeHtml(String(row['1'] ?? '')), kind: decodeHtml(String(row['2'] ?? '')), page: urlCell(row, table.columnTypes) }),
  );
}

/** Vista propia de la entidad en su página del Sistema de Pagos (`d.viewName`). */
export function parsePaymentsView(html: string): string {
  const view = new RegExp(`d\\.listName\\s*=\\s*'${PAYMENTS_LIST}';\\s*d\\.viewName\\s*=\\s*'([A-Za-z0-9 _-]{1,40})'`).exec(html)?.[1];
  if (!view) throw new Error('Página del Sistema de Pagos sin vista de datos generales');
  return view;
}

const HOST_LIKE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

/**
 * Textos y sitio web de la vista de una entidad del Sistema de Pagos. El orden de las columnas cambia
 * entre vistas: el sitio sale del atributo de la fila, de un enlace o de una celda con forma de dirección.
 */
export function parsePaymentsDetail(json: unknown): { texts: string[]; website: string } {
  const table = DataTable.parse(json);
  if (table.data.length !== 1) throw new Error('Vista del Sistema de Pagos sin una única fila');
  const row = table.data[0]!;
  const cells = Object.entries(row)
    .filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'string')
    .map(([, value]) => value as string);
  const attr = (row.DT_RowAttr as Record<string, unknown> | undefined)?.['data-href'];
  const href = cells.map((cell) => /\bhref="([^"]*)"/.exec(cell)?.[1]).find(Boolean);
  const texts = cells.filter((cell) => !cell.includes('<')).map(decodeHtml);
  const website = typeof attr === 'string' && attr ? attr : href ? decodeHtml(href) : (texts.find((t) => HOST_LIKE.test(t)) ?? '');
  return { texts, website: z.string().max(500).parse(website) };
}

/** La vista corresponde a la entidad: alguna celda tiene su razón social (sin puntos ni tildes). */
const hasName = (texts: string[], name: string) => {
  const target = normalizeName(name).replace(/\./g, '');
  return texts.some((text) => {
    const value = normalizeName(text).replace(/\./g, '');
    return value.length >= 3 && (value === target || value.includes(target) || target.includes(value));
  });
};

const listBody = (viewName: string, length = 500) =>
  new URLSearchParams({ draw: '1', start: '0', length: String(length), siteUrl: PAYMENTS_SITE, listName: PAYMENTS_LIST, viewName }).toString();

export class BcuRegistry {
  private snapshot: RegistrySnapshot | null = null;
  private fetchedAtMs = 0;
  private inflight: Promise<void> | null = null;
  private lastFailureMs = Number.NEGATIVE_INFINITY;
  private failures = 0;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  /** Vista de cada página del Sistema de Pagos: en los refrescos evita volver a bajar la página. */
  private readonly views = new Map<string, string>();

  constructor(private readonly options: BcuRegistryOptions) {}

  private get now() {
    return (this.options.now ?? Date.now)();
  }

  /**
   * Inicia la descarga sin esperar (al arrancar el servidor) y revisa cada hora si toca refrescar,
   * para que la copia no venza en un servidor sin consultas. `refreshIfNeeded` decide si corresponde.
   */
  warmUp(): void {
    // Con SITE_CHECK_BCU_REGISTRY=false no se descarga nada ni se programa el refresco.
    if (!this.options.enabled) return;
    void this.refreshIfNeeded();
    this.timer ??= setInterval(() => void this.refreshIfNeeded(), 60 * 60_000).unref();
  }

  /**
   * Estado actual. Si no hay copia vigente espera la descarga hasta `waitMs`; nunca bloquea más.
   */
  async state(waitMs: number): Promise<RegistryState> {
    if (!this.options.enabled) return { status: 'unavailable', snapshot: null, error: 'disabled' };
    const pending = this.refreshIfNeeded();
    if (this.status() !== 'fresh' && pending) {
      await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, waitMs).unref())]);
    }
    const status = this.status();
    return { status, snapshot: status === 'unavailable' ? null : this.snapshot, error: status === 'fresh' ? null : (this.lastError ?? 'loading') };
  }

  private status(): RegistryState['status'] {
    if (!this.snapshot) return 'unavailable';
    const age = this.now - this.fetchedAtMs;
    if (age <= this.options.validForMs) return 'fresh';
    if (age <= this.options.usableForMs) return 'stale';
    return 'unavailable';
  }

  private refreshIfNeeded(): Promise<void> | null {
    if (!this.options.enabled) return null;
    if (this.inflight) return this.inflight;
    const due = !this.snapshot || this.now - this.fetchedAtMs >= this.options.refreshAfterMs;
    // Con el BCU caído no se insiste: 5 min, 10, 20… hasta 6 h entre intentos.
    const wait = this.failures > 0 ? Math.min((this.options.retryAfterMs ?? 5 * 60_000) * 2 ** (this.failures - 1), 6 * 60 * 60_000) : 0;
    if (!due || this.now - this.lastFailureMs < wait) return null;
    this.inflight = this.download()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.fetchedAtMs = Date.parse(snapshot.fetchedAt);
        this.failures = 0;
        this.lastError = null;
      })
      .catch((error: unknown) => {
        this.lastFailureMs = this.now;
        this.failures++;
        this.lastError = errorKind(error);
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async download(): Promise<RegistrySnapshot> {
    const fetchedAt = new Date(this.now).toISOString();
    let requests = 0;
    const request = async (url: string, body?: string): Promise<Response> => {
      // Tope por descarga: un cambio en el sitio del BCU no puede multiplicar los pedidos.
      if (++requests > (this.options.maxRequests ?? 400)) throw new BudgetExceededError();
      const response = await withTimeout(this.options.requestTimeoutMs, (signal) =>
        (this.options.fetchImpl ?? bcuFetch)(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? { accept: 'text/html' } : { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          ...(body === undefined ? {} : { body }),
          credentials: 'omit',
          redirect: 'manual',
          signal,
        }),
      );
      if (!response.ok) throw new ProviderHttpError(response.status);
      return response;
    };
    const text = async (url: string) => (await request(url)).text();
    const json = async (url: string, body: string) => (await request(url, body)).json() as Promise<unknown>;

    // Listados: si falta alguno, la copia no está completa y se conserva la anterior.
    const ssf = new Map<string, { nroinst: string; name: string; kind: string }>();
    for (const list of SSF_LISTS) {
      for (const item of parseSsfList(await text(`${SSF_PAGES}${list.page}`))) {
        if (!ssf.has(item.nroinst)) ssf.set(item.nroinst, { ...item, kind: list.kind });
      }
    }
    const payments = parsePaymentsList(await json(BCU_LISTS_HANDLER, listBody('Publicar')));
    if (ssf.size === 0 || payments.length === 0) throw new Error('Registro del BCU vacío');

    const previous = new Map(this.snapshot?.institutions.map((i) => [i.id, i]));
    const institutions: BcuInstitution[] = [];
    const skipped: RegistrySnapshot['skipped'] = [];
    const add = (id: string, name: string, tradeName: string | null, kind: string, website: string, sourceUrl: string) => {
      const sites = parseWebsites(website);
      if ('reason' in sites) skipped.push({ id, name, reason: sites.reason });
      else institutions.push({ id, name, tradeName: tradeName || null, kind, website: website.trim(), domains: sites.domains, sourceUrl });
    };

    const tasks: Array<{ id: string; run: () => Promise<void> }> = [
      ...[...ssf.values()].map((item) => ({
        id: `ssf-${item.nroinst}`,
        run: async () => {
          const url = bcuFichaUrl(item.nroinst);
          const ficha = parseSsfFicha(await text(url));
          if (!/^activ[ao]$/.test(normalizeName(ficha.status))) skipped.push({ id: `ssf-${item.nroinst}`, name: ficha.name, reason: `estado: ${ficha.status}` });
          else add(`ssf-${item.nroinst}`, ficha.name, ficha.tradeName, item.kind, ficha.website, url);
        },
      })),
      ...payments.map((item) => {
        const slug = new URL(item.page).pathname.split('/').pop()!.replace(/\.aspx$/i, '');
        const id = `sp-${normalizeName(decodeURIComponent(slug)).replace(/[\s.]+/g, '-')}`;
        return {
          id,
          run: async () => {
            // La vista conocida ahorra la página; si ya no corresponde a la entidad, se vuelve a leer.
            let view = this.views.get(item.page);
            let detail = view ? parsePaymentsDetail(await json(BCU_LISTS_HANDLER, listBody(view, 10))) : null;
            if (!detail || !hasName(detail.texts, item.name)) {
              view = parsePaymentsView(await text(item.page));
              detail = parsePaymentsDetail(await json(BCU_LISTS_HANDLER, listBody(view, 10)));
            }
            this.views.set(item.page, view!);
            if (!hasName(detail.texts, item.name)) skipped.push({ id, name: item.name, reason: 'la vista no corresponde a la entidad' });
            else add(id, item.name, item.tradeName, item.kind, detail.website, item.page);
          },
        };
      }),
    ];

    let failed = 0;
    const worker = async () => {
      for (let task = tasks.shift(); task; task = tasks.shift()) {
        try {
          await task.run();
        } catch (error) {
          // Sin presupuesto de pedidos no se sigue: la descarga entera falla.
          if (error instanceof BudgetExceededError) throw error;
          // Una ficha caída: se conserva la copia anterior de esa institución, si existe.
          failed++;
          const old = previous.get(task.id);
          if (old) institutions.push(old);
        }
      }
    };
    const total = tasks.length;
    await Promise.all(Array.from({ length: this.options.concurrency ?? 2 }, worker));
    // Con demasiadas fichas caídas la copia no es confiable.
    if (failed > Math.max(2, total * 0.1)) throw new Error(`Faltan ${failed} fichas del registro del BCU`);

    institutions.sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
    return { institutions, skipped, fetchedAt };
  }
}
