import { describe, expect, it } from 'vitest';

import {
  getDroolAiRuntimeConfig,
  prepareChatRequest,
  DROOL_AI_CHAT_DEFAULT_MODEL,
  DROOL_AI_MODELS,
  DROOL_AI_SITE_BUILDER_MODEL,
} from '../lib/drool-ai';

describe('getDroolAiRuntimeConfig', () => {
  it('is unavailable by default and never points at a third-party provider', () => {
    const config = getDroolAiRuntimeConfig({});
    expect(config.kind).toBe('unavailable');
  });

  it('accepts only credential-free loopback HTTP or HTTPS endpoints', () => {
    expect(
      getDroolAiRuntimeConfig({ WETDROOL_AI_INFERENCE_URL: 'http://127.0.0.1:8600' }),
    ).toMatchObject({ kind: 'configured', defaultModel: DROOL_AI_CHAT_DEFAULT_MODEL });
    expect(
      getDroolAiRuntimeConfig({
        WETDROOL_AI_INFERENCE_URL: 'https://ai.internal.example',
        WETDROOL_AI_DEFAULT_MODEL: 'qwen3-coder-next',
      }),
    ).toMatchObject({ kind: 'configured', defaultModel: 'qwen3-coder-next' });

    for (const endpoint of [
      'http://ai.example.com',
      'https://user:secret@ai.internal.example',
      'https://ai.internal.example/?key=1',
      'not a url',
    ]) {
      expect(getDroolAiRuntimeConfig({ WETDROOL_AI_INFERENCE_URL: endpoint }).kind).toBe(
        'unavailable',
      );
    }
  });

  it('falls back to the default chat model for unknown model ids', () => {
    expect(
      getDroolAiRuntimeConfig({
        WETDROOL_AI_INFERENCE_URL: 'http://127.0.0.1:8600',
        WETDROOL_AI_DEFAULT_MODEL: 'gpt-x',
      }),
    ).toMatchObject({ defaultModel: DROOL_AI_CHAT_DEFAULT_MODEL });
  });
});

describe('model catalog', () => {
  it('keeps every model self-hosted-planned with the builder on Qwen3 Coder Next', () => {
    expect(DROOL_AI_MODELS.every((model) => model.status === 'planned')).toBe(true);
    expect(DROOL_AI_SITE_BUILDER_MODEL).toBe('qwen3-coder-next');
    expect(DROOL_AI_MODELS.map((model) => model.id)).toContain(DROOL_AI_CHAT_DEFAULT_MODEL);
  });
});

describe('prepareChatRequest', () => {
  it('freezes the exact request with the fail-closed safety contract', () => {
    const request = prepareChatRequest('drool-kairos', [{ role: 'user', text: 'gm' }]);
    expect(request).toEqual({
      kind: 'chat',
      model: 'drool-kairos',
      messages: [{ role: 'user', text: 'gm' }],
      safety: {
        platformPolicy: 'wetdrool-community-rules',
        refuseFinancialAdvice: true,
      },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.safety)).toBe(true);
  });
});
