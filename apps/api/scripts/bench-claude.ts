// Benchmark de Claude por tarea con URLs reales: latencia de punta a punta (verificación
// de URLs y reintentos incluidos), validez de las URLs antes y después del verificador,
// costo y corrección. Casos uruguayos sin datos personales. Llama a la API real y a los
// sitios (gasta dinero):
//
//   BENCH_ENV_FILE=apps/api/.env pnpm --filter @hackaton/api bench:claude [repeticiones] [interpret|nextStep] [sin-busqueda]
//
// Lee ANTHROPIC_API_KEY del entorno o de BENCH_ENV_FILE y nunca la imprime. Usa los servicios
// reales (InterpretService con el verificador de URLs, NextStepService).
import { existsSync } from 'node:fs';
import type { GuideStep, InterpretRequest, PageOption } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../src/config/env.js';
import { AnthropicModel } from '../src/modules/ai/anthropic-model.js';
import type { AiTask } from '../src/modules/ai/model.js';
import { InterpretService } from '../src/modules/interpret/interpret.service.js';
import { domainOf, UrlGuard } from '../src/modules/interpret/url-guard.js';
import { NextStepService } from '../src/modules/next-step/next-step.service.js';
import { ProcedureResearcher } from '../src/modules/procedure/procedure.service.js';
import { SessionStore } from '../src/modules/sessions/session-store.js';
import { UrlVerifier } from '../src/modules/urls/url-verifier.js';

const envFile = process.env.BENCH_ENV_FILE;
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY (en el entorno o en BENCH_ENV_FILE).');
  process.exit(1);
}
const REPS = Number(process.argv[2] ?? 2);
const ONLY = process.argv[3] as AiTask | undefined;
const NO_SEARCH = process.argv[4] === 'sin-busqueda';
const CONCURRENCY = 4;
const OWNER = 'bench';

/** USD por millón de tokens (tabla del skill claude-api, 2026-10). Escritura de caché = 1,25 × entrada. */
const OPUS = { input: 4, output: 20, cacheRead: 0.2 };
/** USD por búsqueda web (USD 10 cada 1000 búsquedas). */
const WEB_SEARCH_USD = 0.01;

interface ClaudeMetric {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearches: number;
}
interface UrlMetric {
  type: string;
  firstPassChecked: number;
  firstPassValid: number;
  invalidDomains: string[];
  retried: boolean;
  rootFallbacks: number;
  converted: string;
}

/** Logger que junta solo las métricas numéricas de 'claude call' e 'interpret urls'. */
function metricsLogger(claude: ClaudeMetric[], urls: UrlMetric[]): FastifyBaseLogger {
  const logger = {
    info: (fields: unknown, msg: string) => {
      if (msg === 'claude call') claude.push(fields as ClaudeMetric);
      if (msg === 'interpret urls') urls.push(fields as UrlMetric);
    },
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return logger as unknown as FastifyBaseLogger;
}

const cost = (m: ClaudeMetric) =>
  (m.inputTokens * OPUS.input + m.cacheCreationInputTokens * OPUS.input * 1.25 + m.cacheReadInputTokens * OPUS.cacheRead + m.outputTokens * OPUS.output) /
    1_000_000 +
  m.webSearches * WEB_SEARCH_USD;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
    }),
  );
}

// --- interpret: lo que escribiría una persona en Uruguay. `hosts` sirve solo para puntuar.
const user = { location: { country: 'UY', region: 'Montevideo', city: 'Montevideo' }, language: 'es-UY', timeZone: 'America/Montevideo' };
const interpretCases = [
  { name: 'cédula', text: 'Quiero renovar la cédula de identidad', hosts: [/(^|\.)gub\.uy$/] },
  { name: 'pasaporte', text: 'Quiero sacar el pasaporte', hosts: [/(^|\.)gub\.uy$/] },
  { name: 'BPS jubilación', text: 'Quiero iniciar el trámite de jubilación en el BPS', hosts: [/(^|\.)bps\.gub\.uy$/] },
  { name: 'factura UTE', text: 'Necesito pagar la factura de la luz de UTE', hosts: [/(^|\.)ute\.com\.uy$/] },
  { name: 'factura OSE', text: 'Quiero pagar la factura del agua de OSE', hosts: [/(^|\.)ose\.com\.uy$/] },
  { name: 'Antel', text: 'Quiero ver mi factura de Antel', hosts: [/(^|\.)antel\.com\.uy$/] },
  { name: 'contribución', text: 'Quiero pagar la contribución inmobiliaria en Montevideo', hosts: [/(^|\.)montevideo\.gub\.uy$/] },
  { name: 'ambiguo', text: 'Quiero sacar un turno', hosts: [] as RegExp[] },
];

// --- nextStep: la persona tocó «Iniciar trámite» y la página nueva trae el formulario.
const step = (element: string | null, instruction: string): GuideStep => ({ element, instruction, presentation: 'highlight', waitFor: 'userInteraction' });
const option: PageOption = {
  id: 'renew-id',
  title: 'Renovar la cédula de identidad',
  steps: [step('#el-2', 'Tocá «Iniciar trámite».'), step(null, 'Elegí la oficina y el día.')],
};
const nextStepCases = [
  {
    name: 'agenda',
    html:
      '<h1 id="el-1">Agenda de cédula de identidad</h1><label id="el-4" for="el-5">Oficina</label>' +
      '<select id="el-5"><option>Montevideo - Centro</option><option>Canelones</option></select>' +
      '<label id="el-6">Fecha</label><input id="el-7" type="date"><button id="el-8">Continuar</button>',
    ids: ['#el-1', '#el-4', '#el-5', '#el-6', '#el-7', '#el-8'],
    done: false,
  },
  {
    name: 'confirmación',
    html:
      '<h1 id="el-1">Agenda confirmada</h1><p id="el-2">Tu reserva quedó registrada. Te enviamos la confirmación por correo.</p>' +
      '<a id="el-3" href="/">Volver al inicio</a>',
    ids: ['#el-1', '#el-2', '#el-3'],
    done: true,
  },
];

interface Variant {
  task: AiTask;
  label: string;
  effort: 'medium' | 'high';
  webSearch: boolean;
}
const variants: Variant[] = [
  { task: 'interpret', label: 'Opus 5.5 medium', effort: 'medium', webSearch: false },
  { task: 'interpret', label: 'Opus 5.5 high', effort: 'high', webSearch: false },
  { task: 'interpret', label: 'Opus 5.5 medium + búsqueda', effort: 'medium', webSearch: true },
  { task: 'interpret', label: 'Opus 5.5 high + búsqueda', effort: 'high', webSearch: true },
  { task: 'nextStep', label: 'Opus 5.5 medium', effort: 'medium', webSearch: false },
  { task: 'nextStep', label: 'Opus 5.5 high', effort: 'high', webSearch: false },
];

function configFor(variant: Variant) {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'development',
    API_ACCESS_TOKENS: 'token-de-benchmark-con-longitud-suficiente',
    AI_PROVIDER: 'anthropic',
    CLAUDE_MODEL: 'claude-opus-5-5',
    CLAUDE_MODEL_INTERPRET: 'claude-opus-5-5',
    CLAUDE_MODEL_NEXT_STEP: 'claude-opus-5-5',
    CLAUDE_EFFORT_INTERPRET: variant.effort,
    CLAUDE_EFFORT_NEXT_STEP: variant.effort,
    INTERPRET_WEB_SEARCH: variant.webSearch ? 'on' : 'off',
  });
}

async function runInterpret(variant: Variant) {
  const config = configFor(variant);
  const claude: ClaudeMetric[] = [];
  const urls: UrlMetric[] = [];
  const log = metricsLogger(claude, urls);
  const model = new AnthropicModel(config, log);
  const sessions = new SessionStore(60 * 60_000);
  // Sin caché de verificación entre llamadas, para medir el costo real de comprobar cada URL.
  const verifierOptions = { timeoutMs: config.URL_CHECK_TIMEOUT_MS, maxRedirects: config.URL_CHECK_MAX_REDIRECTS, cacheTtlMs: 0, allowHttp: false };
  const service = new InterpretService(model, sessions, new UrlGuard(new UrlVerifier(verifierOptions)), {
    webSearch: variant.webSearch,
    webSearchMaxUses: config.INTERPRET_WEB_SEARCH_MAX_USES,
  });
  // Un verificador aparte confirma que lo que se devolvió existe.
  const audit = new UrlVerifier(verifierOptions);

  const latencies: number[] = [];
  const types: Record<string, number> = {};
  const failures: string[] = [];
  let ok = 0;
  let errors = 0;
  let finalUrls = 0;
  let finalValid = 0;

  const jobs = interpretCases.flatMap((testCase) => Array.from({ length: REPS }, () => testCase));
  await pool(jobs, CONCURRENCY, async (testCase) => {
    const startedAt = performance.now();
    try {
      const request: InterpretRequest = { messages: [{ role: 'user', content: testCase.text }], user };
      const result = await service.interpret(request, OWNER, log);
      latencies.push(performance.now() - startedAt);
      types[result.type] = (types[result.type] ?? 0) + 1;
      const returned = result.type === 'redirect' ? [result.url] : result.type === 'options' ? result.options.map((o) => o.url) : [];
      for (const url of returned) {
        finalUrls++;
        if ((await audit.verify(url)).ok) finalValid++;
      }
      const good =
        testCase.hosts.length === 0
          ? result.type !== 'redirect'
          : returned.length > 0 && returned.some((url) => testCase.hosts.some((host) => host.test(domainOf(url))));
      if (good) ok++;
      else failures.push(`${testCase.name}: ${result.type}${returned.length ? ` ${returned.map(domainOf).join(',')}` : ''}`);
    } catch (error) {
      errors++;
      failures.push(`${testCase.name}: ${(error as { code?: string }).code ?? (error as Error).name}`);
    }
  });
  sessions.close();

  const firstChecked = urls.reduce((sum, u) => sum + u.firstPassChecked, 0);
  const firstValid = urls.reduce((sum, u) => sum + u.firstPassValid, 0);
  const pct = (a: number, b: number) => (b === 0 ? '-' : `${Math.round((100 * a) / b)}%`);
  return {
    task: variant.task,
    variant: variant.label,
    requests: jobs.length,
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    urlsValidFirst: `${pct(firstValid, firstChecked)} (${firstValid}/${firstChecked})`,
    urlsValidFinal: `${pct(finalValid, finalUrls)} (${finalValid}/${finalUrls})`,
    retries: urls.filter((u) => u.retried).length,
    rootFallbacks: urls.reduce((sum, u) => sum + u.rootFallbacks, 0),
    toQuestion: urls.filter((u) => u.converted === 'question').length,
    claudeCalls: claude.length,
    webSearches: claude.reduce((sum, m) => sum + (m.webSearches ?? 0), 0),
    usdPerRequest: Number((claude.reduce((sum, m) => sum + cost(m), 0) / jobs.length).toFixed(4)),
    correct: `${ok}/${jobs.length}`,
    types: Object.entries(types)
      .map(([type, count]) => `${type}:${count}`)
      .join(' '),
    errors,
    invalidFirstDomains: [...new Set(urls.flatMap((u) => u.invalidDomains))].join(','),
    failures,
  };
}

async function runNextStep(variant: Variant) {
  const config = configFor(variant);
  const claude: ClaudeMetric[] = [];
  const log = metricsLogger(claude, []);
  const model = new AnthropicModel(config, log);
  const sessions = new SessionStore(60 * 60_000);
  const service = new NextStepService(model, sessions, new ProcedureResearcher(model));
  const latencies: number[] = [];
  const failures: string[] = [];
  let ok = 0;
  let errors = 0;

  const jobs = nextStepCases.flatMap((testCase) => Array.from({ length: Math.max(REPS, 3) }, () => testCase));
  await pool(jobs, CONCURRENCY, async (testCase) => {
    const sessionId = sessions.create(OWNER);
    sessions.setChat(sessionId, OWNER, [{ role: 'user', content: 'Quiero renovar la cédula de identidad' }]);
    sessions.append(sessionId, OWNER, { type: 'options', options: [option] });
    const startedAt = performance.now();
    try {
      const result = await service.next(
        {
          sessionId,
          optionId: option.id,
          expectedStep: option.steps[1]!,
          completedSteps: [option.steps[0]!],
          html: testCase.html,
          metadata: { page: { title: 'Cédula de identidad - gub.uy', language: 'es' } },
        },
        OWNER,
      );
      latencies.push(performance.now() - startedAt);
      const idsOk = result.steps.every((s) => s.element === null || testCase.ids.includes(s.element));
      const doneOk = result.done === testCase.done && (testCase.done || result.steps.length > 0);
      if (idsOk && doneOk) ok++;
      else failures.push(`${testCase.name}: done=${result.done} steps=${result.steps.length} idsOk=${idsOk}`);
    } catch (error) {
      errors++;
      failures.push(`${testCase.name}: ${(error as { code?: string }).code ?? 'error'}`);
    }
  });
  sessions.close();
  return {
    task: variant.task,
    variant: variant.label,
    requests: jobs.length,
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    usdPerRequest: Number((claude.reduce((sum, m) => sum + cost(m), 0) / jobs.length).toFixed(4)),
    correct: `${ok}/${jobs.length}`,
    errors,
    failures,
  };
}

const results: Array<Record<string, unknown> & { failures: string[] }> = [];
for (const variant of variants.filter((v) => (!ONLY || v.task === ONLY) && !(NO_SEARCH && v.webSearch))) {
  process.stderr.write(`${variant.task} · ${variant.label}…\n`);
  results.push(variant.task === 'interpret' ? await runInterpret(variant) : await runNextStep(variant));
}
console.table(results.map(({ failures: _failures, ...row }) => row));
for (const result of results) {
  if (result.failures.length) console.log(`${result.task} · ${result.variant}: ${result.failures.join('; ')}`);
}
console.log(JSON.stringify(results));
