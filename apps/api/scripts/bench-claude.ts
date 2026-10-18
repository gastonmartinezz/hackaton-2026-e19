// Benchmark chico de latencia, costo y corrección de Claude por tarea, con entradas
// de prueba uruguayas sin datos personales. Llama a la API real (gasta dinero):
//
//   BENCH_ENV_FILE=apps/api/.env pnpm --filter @hackaton/api bench:claude [repeticiones]
//
// Lee ANTHROPIC_API_KEY del entorno o de BENCH_ENV_FILE y nunca la imprime. Usa los
// servicios reales (InterpretService, NextStepService) con los prompts y esquemas de
// producción; solo cambia CLAUDE_MODEL_* y CLAUDE_EFFORT_* por variante.
import { existsSync } from 'node:fs';
import type { GuideStep, PageOption } from '@hackaton/contracts';
import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../src/config/env.js';
import { AnthropicModel } from '../src/modules/ai/anthropic-model.js';
import type { AiTask } from '../src/modules/ai/model.js';
import { InterpretService } from '../src/modules/interpret/interpret.service.js';
import { NextStepService } from '../src/modules/next-step/next-step.service.js';
import { SessionStore } from '../src/modules/sessions/session-store.js';

const envFile = process.env.BENCH_ENV_FILE;
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY (en el entorno o en BENCH_ENV_FILE).');
  process.exit(1);
}
const REPS = Number(process.argv[2] ?? 3);
const OWNER = 'bench';

/** USD por millón de tokens (tabla del skill claude-api, 2026-10). Escritura de caché = 1,25 × entrada. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  // Sin precio de lectura de caché publicado en la tabla: se estima en 0,1 × entrada.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

interface Metric {
  model: string;
  servedBy: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Logger que solo junta las métricas numéricas de 'claude call'. */
function metricsLogger(sink: Metric[]): FastifyBaseLogger {
  const logger = {
    info: (fields: Metric, msg: string) => msg === 'claude call' && sink.push(fields),
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return logger as unknown as FastifyBaseLogger;
}

const host = (url: string) => new URL(url).hostname;

// --- Casos de interpret: lo que escribiría una persona en Uruguay. Sin datos personales.
const location = { location: { country: 'UY', region: 'Montevideo', city: 'Montevideo' }, language: 'es-UY', timeZone: 'America/Montevideo' };
const interpretCases = [
  { name: 'cédula', text: 'Quiero renovar la cédula de identidad', hosts: [/(^|\.)gub\.uy$/] },
  { name: 'factura UTE', text: 'Necesito pagar la factura de la luz de UTE', hosts: [/(^|\.)ute\.com\.uy$/, /(^|\.)gub\.uy$/] },
  { name: 'historia laboral BPS', text: 'Quiero ver mi historia laboral en el BPS', hosts: [/(^|\.)bps\.gub\.uy$/] },
  { name: 'ambiguo', text: 'Quiero sacar un turno', hosts: [] as RegExp[] },
];

type InterpretResult = Awaited<ReturnType<InterpretService['interpret']>>;
function interpretOk(result: InterpretResult, hosts: RegExp[]): boolean {
  // Sin un organismo claro, lo correcto es preguntar (o ofrecer opciones).
  if (hosts.length === 0) return result.type === 'question' || result.type === 'options';
  const urls = result.type === 'redirect' ? [result.url] : result.type === 'options' ? result.options.map((o) => o.url) : [];
  // Una pregunta razonable también vale (p. ej. si es primera vez o renovación).
  if (result.type === 'question') return true;
  return urls.some((url) => hosts.some((pattern) => pattern.test(host(url))));
}

// --- Casos de nextStep: la persona tocó «Iniciar trámite» y la página nueva trae el formulario.
const step = (element: string | null, instruction: string): GuideStep => ({
  element,
  instruction,
  presentation: 'highlight',
  waitFor: 'userInteraction',
});
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
  model: string;
  effort: 'low' | 'medium';
}
const variants: Variant[] = [
  { task: 'interpret', label: 'Opus 5.5 medium (actual)', model: 'claude-opus-5-5', effort: 'medium' },
  { task: 'interpret', label: 'Opus 5.5 low', model: 'claude-opus-5-5', effort: 'low' },
  { task: 'interpret', label: 'Sonnet 5.5 low', model: 'claude-sonnet-5-5', effort: 'low' },
  { task: 'interpret', label: 'Haiku 5.5 (medium, su default)', model: 'claude-haiku-5-5', effort: 'medium' },
  { task: 'nextStep', label: 'Opus 5.5 medium (actual)', model: 'claude-opus-5-5', effort: 'medium' },
  { task: 'nextStep', label: 'Opus 5.5 low', model: 'claude-opus-5-5', effort: 'low' },
  { task: 'nextStep', label: 'Sonnet 5.5 low', model: 'claude-sonnet-5-5', effort: 'low' },
];

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function cost(metric: Metric): number {
  const price = PRICES[metric.servedBy] ?? PRICES[metric.model];
  if (!price) return 0;
  return (
    (metric.inputTokens * price.input +
      metric.cacheCreationInputTokens * price.input * 1.25 +
      metric.cacheReadInputTokens * price.cacheRead +
      metric.outputTokens * price.output) /
    1_000_000
  );
}

async function runVariant(variant: Variant) {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'development',
    API_ACCESS_TOKENS: 'token-de-benchmark-con-longitud-suficiente',
    AI_PROVIDER: 'anthropic',
    CLAUDE_MODEL_INTERPRET: variant.model,
    CLAUDE_EFFORT_INTERPRET: variant.effort,
    CLAUDE_MODEL_NEXT_STEP: variant.model,
    CLAUDE_EFFORT_NEXT_STEP: variant.effort,
  });
  const metrics: Metric[] = [];
  const model = new AnthropicModel(config, metricsLogger(metrics));
  const sessions = new SessionStore(60 * 60_000);
  let ok = 0;
  let total = 0;
  let errors = 0;
  const failures: string[] = [];

  for (let rep = 0; rep < REPS; rep++) {
    if (variant.task === 'interpret') {
      const service = new InterpretService(model, sessions);
      for (const testCase of interpretCases) {
        total++;
        try {
          const result = await service.interpret({ messages: [{ role: 'user', content: testCase.text }], user: location }, OWNER);
          if (interpretOk(result, testCase.hosts)) ok++;
          else failures.push(`${testCase.name}: ${result.type}${result.type === 'redirect' ? ` ${host(result.url)}` : ''}`);
        } catch (error) {
          errors++;
          failures.push(`${testCase.name}: ${(error as { code?: string }).code ?? 'error'}`);
        }
      }
    } else {
      const service = new NextStepService(model, sessions);
      for (const testCase of nextStepCases) {
        total++;
        const sessionId = sessions.create(OWNER);
        sessions.setChat(sessionId, OWNER, [{ role: 'user', content: 'Quiero renovar la cédula de identidad' }]);
        sessions.append(sessionId, OWNER, { type: 'options', options: [option] });
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
          const idsOk = result.steps.every((s) => s.element === null || testCase.ids.includes(s.element));
          const doneOk = result.done === testCase.done && (testCase.done || result.steps.length > 0);
          if (idsOk && doneOk) ok++;
          else failures.push(`${testCase.name}: done=${result.done} steps=${result.steps.length} idsOk=${idsOk}`);
        } catch (error) {
          errors++;
          failures.push(`${testCase.name}: ${(error as { code?: string }).code ?? 'error'}`);
        }
      }
    }
  }
  sessions.close();

  const latencies = metrics.map((m) => m.latencyMs);
  const costs = metrics.map(cost);
  return {
    task: variant.task,
    variant: variant.label,
    calls: metrics.length,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    avgInput: Math.round(metrics.reduce((sum, m) => sum + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0) / Math.max(1, metrics.length)),
    avgCacheRead: Math.round(metrics.reduce((sum, m) => sum + m.cacheReadInputTokens, 0) / Math.max(1, metrics.length)),
    avgOutput: Math.round(metrics.reduce((sum, m) => sum + m.outputTokens, 0) / Math.max(1, metrics.length)),
    usdPerCall: Number((costs.reduce((a, b) => a + b, 0) / Math.max(1, costs.length)).toFixed(5)),
    correct: `${ok}/${total}`,
    errors,
    fallbacks: metrics.filter((m) => m.servedBy !== m.model).length,
    failures,
  };
}

const results = [];
for (const variant of variants) {
  process.stderr.write(`${variant.task} · ${variant.label}…\n`);
  results.push(await runVariant(variant));
}
console.table(results.map(({ failures: _failures, ...row }) => row));
for (const result of results) {
  if (result.failures.length) console.log(`${result.task} · ${result.variant}: ${result.failures.join('; ')}`);
}
console.log(JSON.stringify(results));
