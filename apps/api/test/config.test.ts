import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { TOKEN } from './helpers.js';

describe('loadConfig', () => {
  it('exige ANTHROPIC_API_KEY con el proveedor real', () => {
    expect(() => loadConfig({ API_ACCESS_TOKENS: TOKEN, AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('no permite mocks en producción', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', API_ACCESS_TOKENS: TOKEN })).toThrow(/mock/);
  });

  it('rechaza tokens cortos sin mostrar su valor', () => {
    expect(() => loadConfig({ API_ACCESS_TOKENS: 'corto' })).toThrow(/24 caracteres/);
    expect(() => loadConfig({ API_ACCESS_TOKENS: 'corto' })).not.toThrow(/corto/);
  });

  it('usa 16000 como tope de tokens de Claude por defecto', () => {
    expect(loadConfig({ API_ACCESS_TOKENS: TOKEN }).CLAUDE_MAX_TOKENS).toBe(16_000);
    expect(loadConfig({ API_ACCESS_TOKENS: TOKEN, CLAUDE_MAX_TOKENS: '32000' }).CLAUDE_MAX_TOKENS).toBe(32_000);
  });

  it('rechaza un CLAUDE_MAX_TOKENS inválido', () => {
    expect(() => loadConfig({ API_ACCESS_TOKENS: TOKEN, CLAUDE_MAX_TOKENS: '0' })).toThrow(/CLAUDE_MAX_TOKENS/);
    expect(() => loadConfig({ API_ACCESS_TOKENS: TOKEN, CLAUDE_MAX_TOKENS: 'mucho' })).toThrow(/CLAUDE_MAX_TOKENS/);
  });

  it('Protección de sitios: sin proveedor de reputación por defecto y claves solo con su proveedor', () => {
    const config = loadConfig({ API_ACCESS_TOKENS: TOKEN });
    expect(config.REPUTATION_PROVIDER).toBe('none');
    expect(config.MCP_ACCESS_TOKENS).toEqual([]);
    expect(() => loadConfig({ API_ACCESS_TOKENS: TOKEN, REPUTATION_PROVIDER: 'safe_browsing' })).toThrow(/GOOGLE_SAFE_BROWSING_API_KEY/);
    expect(() => loadConfig({ API_ACCESS_TOKENS: TOKEN, REPUTATION_PROVIDER: 'web_risk' })).toThrow(/GOOGLE_WEB_RISK_API_KEY/);
  });

  it('no permite reputación simulada en producción', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', API_ACCESS_TOKENS: TOKEN, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', REPUTATION_PROVIDER: 'mock' })).toThrow(/REPUTATION_PROVIDER/);
  });

  it('los tokens MCP son distintos a los de la API', () => {
    expect(() => loadConfig({ API_ACCESS_TOKENS: TOKEN, MCP_ACCESS_TOKENS: TOKEN })).toThrow(/MCP_ACCESS_TOKENS/);
  });
});
