import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_GATEWAY_PRESETS,
  DEFAULT_BYOK_CONFIG,
  detectGatewayFromBaseUrl,
  findModelEntry,
  getDefaultModelForProvider,
  getModelDisplayLabel,
  normalizeProviderConfigToStudio,
  PROVIDER_CATALOG,
} from './models';

test('DEFAULT_BYOK_CONFIG configures OpenRouter BYOK without hardcoded keys or fictional models', () => {
  assert.equal(DEFAULT_BYOK_CONFIG.provider, 'custom');
  assert.equal(DEFAULT_BYOK_CONFIG.name, 'OpenRouter');
  assert.equal(DEFAULT_BYOK_CONFIG.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(DEFAULT_BYOK_CONFIG.apiKey, '');
  assert.equal(DEFAULT_BYOK_CONFIG.model, 'nvidia/llama-3.3-nemotron-super-49b-v1:free');
});

test('All presets label models with Free or Paid billing and use real models only', () => {
  const gatewayIds = CUSTOM_GATEWAY_PRESETS.map((g) => g.id);
  assert.ok(gatewayIds.includes('openrouter'));
  assert.ok(gatewayIds.includes('groq'));
  assert.ok(gatewayIds.includes('gemini_byok'));
  assert.ok(gatewayIds.includes('nvidia'));
  assert.ok(gatewayIds.includes('openai'));
  assert.ok(gatewayIds.includes('custom_url'));

  const geminiPreset = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === 'gemini_byok')!;
  const geminiIds = geminiPreset.models.map((m) => m.id);
  assert.ok(geminiIds.includes('gemini-2.5-flash'));
  assert.ok(geminiIds.includes('gemini-2.5-pro'));
  assert.ok(!geminiIds.includes('gemini-3.8-live'));
  assert.ok(!geminiIds.includes('gemini-4-hydrogen'));

  for (const preset of CUSTOM_GATEWAY_PRESETS) {
    assert.ok(preset.models.length > 0);
    for (const model of preset.models) {
      assert.ok(
        model.billing === 'free' || model.billing === 'paid',
        `Expected free/paid billing on ${preset.id}/${model.id}`,
      );
      assert.ok(model.billingLabel.length > 0);
    }
  }
});

test('normalizeProviderConfigToStudio maps legacy providers cleanly into BYOK custom config', () => {
  const normalizedOr = normalizeProviderConfigToStudio({
    provider: 'openrouter',
    model: 'openai/gpt-4.1',
    apiKey: 'sk-or-test',
  });
  assert.equal(normalizedOr.provider, 'custom');
  assert.equal(normalizedOr.name, 'OpenRouter');
  assert.equal(normalizedOr.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(detectGatewayFromBaseUrl(normalizedOr.baseUrl), 'openrouter');

  const normalizedGroq = normalizeProviderConfigToStudio({
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    apiKey: 'gsk-test',
  });
  assert.equal(normalizedGroq.provider, 'custom');
  assert.equal(normalizedGroq.name, 'Groq');
  assert.equal(normalizedGroq.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(detectGatewayFromBaseUrl(normalizedGroq.baseUrl), 'groq');

  const normalizedLegacyGemini = normalizeProviderConfigToStudio({
    provider: 'gemini',
    model: 'gemini-3.8-live',
    apiKey: 'AIza-test',
  });
  assert.equal(normalizedLegacyGemini.provider, 'custom');
  assert.equal(normalizedLegacyGemini.name, 'Gemini (BYOK)');
  assert.equal(normalizedLegacyGemini.model, 'gemini-2.5-flash');
  assert.equal(
    normalizedLegacyGemini.baseUrl,
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  assert.equal(detectGatewayFromBaseUrl(normalizedLegacyGemini.baseUrl), 'gemini_byok');
});

test('getModelDisplayLabel, getDefaultModelForProvider & findModelEntry resolve cleanly', () => {
  assert.equal(
    getDefaultModelForProvider('custom'),
    'nvidia/llama-3.3-nemotron-super-49b-v1:free',
  );
  assert.equal(PROVIDER_CATALOG.custom.requiresUserKey, true);
  assert.equal(
    getModelDisplayLabel('custom', 'nvidia/llama-3.3-nemotron-super-49b-v1.5'),
    'NVIDIA Nemotron Super 49B v1.5',
  );
  assert.equal(
    getModelDisplayLabel('custom', 'my-org/custom-coder-v1'),
    'my-org/custom-coder-v1',
  );
  const meta = findModelEntry('custom', 'gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(meta?.billing, 'free');
});
