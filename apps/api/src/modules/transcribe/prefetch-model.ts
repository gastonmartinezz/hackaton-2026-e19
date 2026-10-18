// Descarga el modelo de voz a STT_MODEL_DIR y comprueba que carga.
// Se usa al construir la imagen para que el contenedor no lo baje en cada arranque:
//   node apps/api/dist/modules/transcribe/prefetch-model.js
import { SttEnvSchema } from '../../config/env.js';
import { loadWhisper } from './whisper-pipeline.js';

const config = SttEnvSchema.parse(process.env);
const startedAt = performance.now();
const whisper = await loadWhisper({
  model: config.STT_MODEL,
  dtype: config.STT_DTYPE,
  cacheDir: config.STT_MODEL_DIR,
  threads: 0,
  allowRemote: true,
});
await whisper(new Float32Array(16_000));
console.log(
  `Modelo ${config.STT_MODEL} (${config.STT_DTYPE}) listo en ${config.STT_MODEL_DIR} en ${Math.round(performance.now() - startedAt)} ms`,
);
